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
  /^(got it[.!]?\s*|alright[.!]?\s*|all right[.!]?\s*|okay[.!]?\s*|ok[.!]?\s*|right[.!]?\s*|sure[.!]?\s*|understood[.!]?\s*|noted[.!]?\s*|thanks[.!]?\s*|thank you[.!]?\s*|one (second|moment)[.!]?\s*|mm-?hmm[.!]?\s*|yeah[.!]?\s*|yep[.!]?\s*)+/i;

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

function stripLeadingFiller(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(FILLER_START, '').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function isEnglishSafe(text: string): boolean {
  return !CJK.test(text);
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
    '\n\nVOICE MODE — live phone call:\n' +
    '- LANGUAGE: US English only. Never Chinese, never any other language. If you catch yourself drifting, switch back to English immediately.\n' +
    '- LENGTH: one or two short questions per turn. Do not ask about delivery, pickup, insurance, deposit, cleaning, and late fees in the same breath — pick the next missing piece and ask that.\n' +
    '- NO FILLER OPENERS: never start with Got it / Right / Okay / Understood / Noted / Alright. Start with the substance.\n' +
    '- Numbers slowly and clearly. Batch log_quote_line calls for one supplier utterance into one parallel tool batch.\n' +
    '- When done: record_outcome, one short goodbye, stop. No more questions after goodbye.' +
    (alreadyEnded
      ? '\n\nThe outcome for this call is already recorded. Say a short English goodbye now and do not call any more tools.'
      : '');

  const history = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: contentToText(m.content),
    }))
    .filter((m) => m.content.length > 0);

  type Item =
    | { role: 'user' | 'assistant'; content: string }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string };

  const record = (r: ToolCallRecord) => newToolRecords.push(r);

  // gpt-5.5 + low effort: sharp enough for negotiation, fast enough for phone.
  const turnModel = MODELS.voice;

  const extractText = (response: {
    output: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  }): string => {
    const texts = response.output
      .filter((o) => o.type === 'message')
      .map((m) =>
        (m.content ?? [])
          .filter((c) => c.type === 'output_text')
          .map((c) => c.text ?? '')
          .join('')
          .trim(),
      )
      .filter((t) => t.length > 0);
    return stripLeadingFiller(texts[texts.length - 1] ?? '');
  };

  const finalizeSpoken = async (
    text: string,
    items: Item[],
    endedThisTurn: boolean,
  ): Promise<string> => {
    let spoken = text;
    if (!isEnglishSafe(spoken)) {
      // Hard guard: never let CJK (or other script slips) reach TTS.
      try {
        const retry = await openai().responses.create({
          model: turnModel,
          instructions:
            systemPrompt +
            '\n\nCRITICAL: your previous draft was not US English. Rewrite the SAME meaning in plain US English only. No Chinese characters. No filler openers. One or two short sentences.',
          input: [
            ...items,
            {
              role: 'user',
              content:
                'Rewrite your last reply in US English only. Keep it under 35 words. No filler.',
            },
          ],
          tool_choice: 'none',
          store: false,
          reasoning: { effort: 'low' },
        });
        spoken = extractText(retry);
      } catch {
        spoken = '';
      }
      if (!spoken || !isEnglishSafe(spoken)) {
        spoken = endedThisTurn
          ? 'Thanks — goodbye.'
          : 'Sorry, could you say that again?';
      }
    }
    if (endedThisTurn && spoken && !/\b(bye|goodbye|talk soon|take care)\b/i.test(spoken)) {
      spoken = `${spoken.replace(/\s*$/, '')} Bye.`;
    }
    if (endedThisTurn && !spoken) spoken = 'Thanks — goodbye.';
    return spoken;
  };

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
        reasoning: { effort: 'low' },
      });
      const functionCalls = response.output.filter((o) => o.type === 'function_call');
      if (functionCalls.length === 0) {
        return finalizeSpoken(extractText(response), items, endedThisTurn);
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
      if (endedThisTurn) {
        const close = await openai().responses.create({
          model: turnModel,
          instructions:
            systemPrompt +
            '\n\nThe outcome is recorded. Speak one short US-English closing sentence that includes goodbye. No questions. No tools. No filler.',
          input: items,
          tool_choice: 'none',
          store: false,
          reasoning: { effort: 'low' },
        });
        return finalizeSpoken(
          extractText(close) || 'Thanks — goodbye.',
          items,
          true,
        );
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

  // No spoken filler ack — that was the "Right." / "Got it." spam. First SSE
  // byte is role-only so ElevenLabs still starts the turn without dead air.
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
      console.log(
        `voice-turn call=${callId.slice(0, 8)} model=voice first_content_ms=${firstContentMs} brain_ms=${Date.now() - requestStartedAt}`,
      );
      const parts = finalText.match(/[^.!?]+[.!?]*\s*/g) ?? [finalText];
      for (const part of parts) chunk({ content: part });
      chunk({}, 'stop');
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
      await persistTurn(finalText).catch((e) => console.error('persist failed:', e));
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
