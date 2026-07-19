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
    '\n\nVOICE MODE: you are live on a phone call. Keep utterances short and natural. Numbers slowly and clearly. The system may have already voiced a brief acknowledgement for you — NEVER start your reply with filler words (Alright, Okay, Got it, One moment); go straight to substance. Batch all log_quote_line calls for one supplier utterance into a single parallel tool batch.';

  // Rebuild the conversation for the Responses API from the full history
  // ElevenLabs sends on every request (stateless on our side).
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

  // Voice latency: conversational turns (no numbers in play) run on the fast
  // model; anything commercial — figures, prices, booking, leverage — runs on
  // the strong model. The tool surface is identical either way.
  const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const commercialSignal =
    /\d|euro|price|rate|fee|discount|quote|book|total|deposit|surcharge|liab|insur|percent|cost/i.test(
      lastUserText,
    ) || history.length <= 1;
  const turnModel = commercialSignal ? MODELS.reasoning : MODELS.fast;

  const runBrain = async (): Promise<string> => {
    let items: Item[] = history;
    for (let hop = 0; hop <= 6; hop++) {
      const response = await openai().responses.create({
        model: turnModel,
        instructions: systemPrompt,
        input: items,
        tools: toOpenAiTools(tools),
        tool_choice: hop === 6 ? 'none' : 'auto',
        store: false,
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
        return texts[texts.length - 1] ?? '';
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

  // OpenAI-compatible SSE tuned for time-to-first-AUDIO:
  // 1. first byte immediately (prevents LLM cascading),
  // 2. from the second turn on, a short spoken acknowledgement streams at
  //    once so TTS starts while the tool loop still runs,
  // 3. then the utterance in sentence-sized chunks.
  const ACKS = ['Alright. ', 'Okay. ', 'Got it. ', 'One second. '];
  // Turn 1 (the pickup) gets a natural greeting ack so the caller hears a
  // voice within a second even while the brain composes the opening.
  const isFirstTurn = history.length <= 1;
  const speakAck = true;
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
      let ack = '';
      if (speakAck) {
        ack = isFirstTurn ? 'Good morning. ' : ACKS[Math.floor(Math.random() * ACKS.length)];
        chunk({ content: ack });
      }
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
        `voice-turn call=${callId.slice(0, 8)} model=${turnModel === MODELS.fast ? 'fast' : 'reasoning'} first_content_ms=${firstContentMs} brain_ms=${Date.now() - requestStartedAt}`,
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
