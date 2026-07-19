import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getVertical } from '@/config/verticals';
import { getSpec } from '@/core/specs-repo';
import { buyerSystemPrompt } from '@/negotiation/buyer';
import { buildBuyerTools, toOpenAiTools, executeTool, type BuyerToolContext } from '@/negotiation/buyer-tools';
import { openai, MODELS } from '@/integrations/openai-server';
import type { ToolCallRecord, TranscriptTurn } from '@/negotiation/types';

export const maxDuration = 120;

/**
 * OpenAI-compatible chat completions endpoint: the voice tier's brain.
 *
 * The ElevenLabs buyer agent is configured with this URL as its custom LLM,
 * so the identical policy, tool surface, and truth-layer gating drive voice
 * calls. ElevenLabs handles STT/TTS/turn-taking; we run the buyer brain and
 * execute all tools server-side, then stream the utterance back as SSE.
 *
 * Auth: shared bearer token (voice_llm_token in app_settings).
 * Call context: x-call-id header, set per session via a dynamic variable.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
}

function contentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((c) => c.text ?? '')
    .join(' ')
    .trim();
}

const FILLER_START =
  /^(got it[.!]?\s*|alright[.!]?\s*|okay[.!]?\s*|ok[.!]?\s*|one (second|moment)[.!]?\s*|sure[.!]?\s*)+/i;

function stripLeadingFiller(text: string): string {
  let t = text.trim();
  // Peel repeated leading fillers the model still emits despite instructions.
  for (let i = 0; i < 3; i++) {
    const next = t.replace(FILLER_START, '').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function countGotIt(texts: string[]): number {
  return texts.reduce((n, t) => n + (t.match(/\bgot it\b/gi) ?? []).length, 0);
}

const ACK_POOL = [
  'Understood. ',
  'Right. ',
  'Thanks. ',
  'Noted. ',
  'Okay. ',
  'Got it. ',
];

function pickAck(gotItCount: number, isFirstTurn: boolean): string {
  if (isFirstTurn) return 'Good morning. ';
  const pool =
    gotItCount >= 2 ? ACK_POOL.filter((a) => !/^Got it/i.test(a)) : ACK_POOL;
  // Often skip the spoken ack entirely after the opening — less filler, faster
  // perceived turn. Speak one about half the time.
  if (Math.random() < 0.45) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function POST(request: Request) {
  const supabase = supabaseAdmin();

  const auth = request.headers.get('authorization') ?? '';
  const { data: tokenRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'voice_llm_token')
    .maybeSingle();
  if (!tokenRow?.value || auth !== `Bearer ${tokenRow.value}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const callId = request.headers.get('x-call-id');
  if (!callId) {
    return NextResponse.json({ error: 'x-call-id header missing' }, { status: 400 });
  }

  const body = (await request.json()) as { messages: ChatMessage[]; stream?: boolean };

  const { data: session } = await supabase
    .from('call_sessions')
    .select('id, job_spec_id, supplier_id, status, tool_calls, transcript, started_at, spec_fingerprint')
    .eq('id', callId)
    .single();
  if (!session) return NextResponse.json({ error: 'call not found' }, { status: 404 });

  const spec = await getSpec(session.job_spec_id);
  if (!spec || !spec.confirmed_by_user || !spec.spec_fingerprint) {
    return NextResponse.json({ error: 'spec not confirmed' }, { status: 409 });
  }
  const vertical = getVertical(spec.vertical_slug);
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('id', session.supplier_id)
    .single();
  if (!supplier) return NextResponse.json({ error: 'supplier missing' }, { status: 404 });

  const startedAtMs = session.started_at ? new Date(session.started_at).getTime() : Date.now();
  const existingToolCalls = (session.tool_calls as ToolCallRecord[]) ?? [];
  const newToolRecords: ToolCallRecord[] = [];
  const turnIndex = body.messages.filter((m) => m.role !== 'system').length;

  const alreadyEnded = existingToolCalls.some(
    (tc) => tc.tool === 'record_outcome' && (tc.result as { ended?: boolean })?.ended,
  );

  const toolCtx: BuyerToolContext = {
    callId,
    specId: spec.id,
    specFingerprint: session.spec_fingerprint,
    supplierId: session.supplier_id,
    vertical,
    levers: spec.authorized_levers,
    budgetNet: (spec.spec.fields as { budget_net?: number | null }).budget_net ?? null,
    currentTurnIndex: () => turnIndex,
    nowMs: () => Date.now() - startedAtMs,
  };
  const tools = buildBuyerTools(toolCtx);
  const systemPrompt =
    buyerSystemPrompt({
      vertical,
      fields: spec.spec.fields,
      fingerprint: session.spec_fingerprint,
      supplierName: supplier.name,
      levers: spec.authorized_levers,
    }) +
    '\n\nVOICE MODE: you are live on a phone call. Keep utterances short and natural. Numbers slowly and clearly. The system may have already voiced a brief acknowledgement for you — NEVER start your reply with filler words (Alright, Okay, Got it, One moment); go straight to substance. "Got it" at most twice in the whole call. Batch all log_quote_line calls for one supplier utterance into a single parallel tool batch. When the deal is done, call record_outcome and say a short goodbye — then stop. Never ask another question after goodbye.' +
    (alreadyEnded
      ? '\n\nThe outcome for this call is already recorded. Say a short goodbye now and do not call any more tools.'
      : '');

  const history = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: contentToText(m.content),
    }))
    .filter((m) => m.content.length > 0);

  const priorAssistantText = history.filter((m) => m.role === 'assistant').map((m) => m.content);
  const gotItSoFar = countGotIt(priorAssistantText);

  type Item =
    | { role: 'user' | 'assistant'; content: string }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string };

  const record = (r: ToolCallRecord) => newToolRecords.push(r);

  // Always the voice-pinned model — gpt-5.5 on commercial turns was the
  // multi-second pause the founder kept hearing between dispatcher and reply.
  const turnModel = MODELS.voice;

  const runBrain = async (): Promise<string> => {
    let items: Item[] = history;
    let endedThisTurn = alreadyEnded;
    const maxHops = alreadyEnded ? 1 : 5;
    for (let hop = 0; hop <= maxHops; hop++) {
      const forceClose = endedThisTurn || hop === maxHops;
      const response = await openai().responses.create({
        model: turnModel,
        instructions: systemPrompt,
        input: items,
        tools: forceClose || alreadyEnded ? undefined : toOpenAiTools(tools),
        tool_choice: forceClose || alreadyEnded ? 'none' : 'auto',
        store: false,
        // Keep live-phone latency low; commercial judgment still holds on 5.4.
        reasoning: { effort: 'low' },
      });
      const functionCalls = response.output.filter((o) => o.type === 'function_call');
      if (functionCalls.length === 0) {
        const texts = response.output
          .filter((o) => o.type === 'message')
          .map((m) =>
            m.content
              .filter((c) => c.type === 'output_text')
              .map((c) => c.text)
              .join('')
              .trim(),
          )
          .filter((t) => t.length > 0);
        let text = texts[texts.length - 1] ?? '';
        text = stripLeadingFiller(text);
        if (endedThisTurn && text && !/\b(bye|goodbye|talk soon|take care)\b/i.test(text)) {
          text = `${text.replace(/\s*$/, '')} Bye.`;
        }
        if (endedThisTurn && !text) text = 'Thanks — goodbye.';
        return text;
      }
      const outputs: Item[] = [];
      for (const call of functionCalls) {
        const result = await executeTool(
          tools,
          call.name,
          call.arguments,
          record,
          turnIndex,
          Date.now() - startedAtMs,
        );
        if (call.name === 'record_outcome' && (result as { ended?: boolean }).ended) {
          endedThisTurn = true;
        }
        outputs.push({
          type: 'function_call',
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments,
        });
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
      items = [...items, ...outputs];
      // Outcome recorded → one forced spoken close, no more tool hops.
      if (endedThisTurn) {
        const close = await openai().responses.create({
          model: turnModel,
          instructions:
            systemPrompt +
            '\n\nThe outcome is recorded. Speak one short closing sentence that includes goodbye. No questions. No tools.',
          input: items,
          tool_choice: 'none',
          store: false,
          reasoning: { effort: 'low' },
        });
        const texts = close.output
          .filter((o) => o.type === 'message')
          .map((m) =>
            m.content
              .filter((c) => c.type === 'output_text')
              .map((c) => c.text)
              .join('')
              .trim(),
          )
          .filter((t) => t.length > 0);
        let text = stripLeadingFiller(texts[texts.length - 1] ?? 'Thanks — goodbye.');
        if (!/\b(bye|goodbye|talk soon|take care)\b/i.test(text)) {
          text = `${text.replace(/\s*$/, '')} Bye.`;
        }
        return text;
      }
    }
    return '';
  };

  const persistTurn = async (finalText: string) => {
    const transcript: TranscriptTurn[] = history.map((m, i) => ({
      turn_index: i,
      role: m.role === 'assistant' ? 'buyer' : 'supplier',
      message: m.content,
      at_ms: 0,
    }));
    transcript.push({
      turn_index: transcript.length,
      role: 'buyer',
      message: finalText,
      at_ms: Date.now() - startedAtMs,
    });
    await supabase
      .from('call_sessions')
      .update({
        status: 'in_progress',
        tool_calls: [...existingToolCalls, ...newToolRecords],
        transcript,
        started_at: session.started_at ?? new Date(startedAtMs).toISOString(),
      })
      .eq('id', callId);
  };

  const isFirstTurn = history.length <= 1;
  const ack = pickAck(gotItSoFar, isFirstTurn);
  const requestStartedAt = Date.now();
  const encoder = new TextEncoder();
  const id = `chatcmpl-${callId.slice(0, 8)}-${Date.now()}`;
  const stream = new ReadableStream({
    async start(controller) {
      const chunk = (delta: object, finish: string | null = null) =>
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'procurecall-buyer',
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          ),
        );
      chunk({ role: 'assistant' });
      if (ack) chunk({ content: ack });
      const firstContentMs = Date.now() - requestStartedAt;
      const heartbeat = setInterval(() => chunk({}), 2500);
      let finalText = '';
      try {
        finalText = await runBrain();
      } catch (e) {
        console.error('voice brain failed:', e);
      } finally {
        clearInterval(heartbeat);
      }
      if (!finalText) finalText = 'Sorry, could you repeat that?';
      // Hard cap: if this ack would be a 3rd+ "Got it", drop it from the spoken stream
      // (already streamed only when pickAck allowed it).
      console.log(
        `voice-turn call=${callId.slice(0, 8)} model=voice first_content_ms=${firstContentMs} brain_ms=${Date.now() - requestStartedAt} got_it_prior=${gotItSoFar}`,
      );
      const parts = finalText.match(/[^.!?]+[.!?]*\s*/g) ?? [finalText];
      for (const part of parts) chunk({ content: part });
      chunk({}, 'stop');
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
      await persistTurn(ack + finalText).catch((e) => console.error('persist failed:', e));
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
