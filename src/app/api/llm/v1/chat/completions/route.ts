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
 * Voice brain — speak-first architecture.
 *
 * The old path waited for every log_quote_line hop before any audio left the
 * model (~6s of dead air after a useless "Mm-hmm"). Now speech and tool
 * logging run in parallel: TTS starts as soon as the spoken reply is ready,
 * while fees are logged silently in the background.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
}

type HistoryItem = { role: 'user' | 'assistant'; content: string };

type Item =
  | HistoryItem
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

function contentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((c) => c.text ?? '')
    .join(' ')
    .trim();
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const BYE_RE = /\b(bye|goodbye|good bye|talk soon|take care|have a good (one|day))\b/i;
const FILLER_START =
  /^(got it[.!, -]*\s*|alright[.!, -]*\s*|all right[.!, -]*\s*|okay[.!, -]*\s*|ok[.!, -]*\s*|right[.!, -]*\s*|sure[.!, -]*\s*|understood[.!, -]*\s*|noted[.!, -]*\s*|thanks[.!, -]*\s*|thank you[.!, -]*\s*|one (second|moment)[.!, -]*\s*|mm-?hmm[.!, -]*\s*|yeah[.!, -]*\s*|yep[.!, -]*\s*)+/i;

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

/** Compact fee ledger from tools already on the call — keeps speech coherent. */
function feeLedger(toolCalls: ToolCallRecord[]): string {
  const lines: string[] = [];
  for (const tc of toolCalls) {
    if (tc.tool !== 'log_quote_line') continue;
    const result = tc.result as {
      logged?: boolean;
      line?: { label?: string; category?: string; amount_cents?: number; is_conditional?: boolean };
    };
    if (!result?.logged || !result.line) continue;
    const amt = ((result.line.amount_cents ?? 0) / 100).toFixed(0);
    lines.push(
      `${result.line.category ?? '?'}: ${result.line.label ?? '?'} = ${amt} EUR${result.line.is_conditional ? ' (conditional)' : ''}`,
    );
  }
  const outcome = [...toolCalls].reverse().find((t) => t.tool === 'record_outcome');
  if (outcome) lines.push('outcome: already recorded');
  return lines.length > 0 ? lines.join('\n') : '(no fees logged yet)';
}

function speakInstructions(base: string, ledger: string): string {
  return (
    base +
    '\n\nVOICE SPEAK TURN (no tools — logging runs in parallel):\n' +
    '- Reply ONLY with what you would say aloud on the phone. US English only.\n' +
    '- One or two short sentences. Aim under 30 words. One question max unless clarifying a number.\n' +
    '- Sound like a real buyer: direct, calm, competent. No filler openers (Got it, Mm-hmm, Okay, Sure, Right, Alright, Thanks, Yeah).\n' +
    '- Do not repeat the dispatcher verbatim. Confirm numbers cleanly in your own words ("500 for the five days, and 300 for delivery — is pickup in that 300?").\n' +
    '- Advance the deal every turn: either confirm a number, ask the next missing fee, negotiate one point, or read back the total. Never stall.\n' +
    '- If audio was unclear or contradictory, ask one short clarifying question. Never invent a figure.\n' +
    '- If delivery and pickup were given as one figure, confirm whether pickup is included, then move on — do not re-ask forever.\n' +
    '- If you have enough for a full mandatory total, read it back and ask for confirmation.\n' +
    '- If the dispatcher said goodbye and the deal is confirmed, say one short bye and stop.\n' +
    '- Opening greeting may already have been spoken. Do not re-introduce yourself.\n' +
    '\nFEES ALREADY LOGGED ON THIS CALL:\n' +
    ledger
  );
}

function toolInstructions(base: string): string {
  return (
    base +
    '\n\nVOICE TOOL TURN (silent — do not speak):\n' +
    '- Call tools only. Prefer one parallel batch of log_quote_line for every new figure in the latest dispatcher utterance.\n' +
    '- When the dispatcher gives a combined transport figure (e.g. "500 plus 300"), log rental and the transport components. If they confirm pickup is included in the 300, log pickup at 0 or the stated share — never leave pickup unlogged after they confirmed it is included.\n' +
    '- Log damage waiver / liability under insurance. Deposit under deposit.\n' +
    '- When the dispatcher confirms the final total and availability, call record_outcome.\n' +
    '- Produce NO spoken reply in this turn.'
  );
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
  const basePrompt = buyerSystemPrompt({
    vertical,
    fields: spec.spec.fields,
    fingerprint: session.spec_fingerprint,
    supplierName: supplier.name,
    levers: spec.authorized_levers,
  });

  const history: HistoryItem[] = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: contentToText(m.content),
    }))
    .filter((m) => m.content.length > 0);

  const assistantTexts = history.filter((m) => m.role === 'assistant').map((m) => m.content);
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const byeAlready = assistantTexts.some((t) => BYE_RE.test(t));
  const mutualBye = byeAlready && BYE_RE.test(lastUser);
  const ledger = feeLedger(existingToolCalls);

  const record = (r: ToolCallRecord) => newToolRecords.push(r);

  /**
   * Stream spoken tokens as soon as the model starts — do not wait for the
   * full reply or for fee tools. Buffer briefly only to strip leading filler.
   */
  const streamSpeech = async (onDelta: (part: string) => void): Promise<string> => {
    if (mutualBye || (alreadyEnded && byeAlready)) return '';
    if (byeAlready && alreadyEnded) return '';

    const stream = await openai().responses.create({
      model: MODELS.voiceSpeak,
      instructions: speakInstructions(basePrompt, ledger),
      input: history,
      tool_choice: 'none',
      store: false,
      reasoning: { effort: 'low' },
      stream: true,
    });

    let raw = '';
    let emitted = '';
    let started = false;
    const flushStart = () => {
      const cleaned = stripLeadingFiller(raw);
      if (
        cleaned.length >= 8 ||
        /[.!?…]/.test(cleaned) ||
        (raw.length >= 40 && cleaned.length > 0)
      ) {
        started = true;
        if (cleaned) {
          emitted = cleaned;
          onDelta(cleaned);
        }
      }
    };

    for await (const event of stream) {
      if (event.type !== 'response.output_text.delta') continue;
      raw += event.delta;
      if (!started) {
        flushStart();
        continue;
      }
      const cleaned = stripLeadingFiller(raw);
      const delta = cleaned.slice(emitted.length);
      if (delta) {
        emitted = cleaned;
        onDelta(delta);
      }
    }

    let text = stripLeadingFiller(raw);
    if (!isEnglishSafe(text)) {
      text = alreadyEnded ? 'Thanks, goodbye.' : 'Sorry, could you say that again?';
      if (!emitted) onDelta(text);
      else if (text !== emitted) {
        // Rare language fail after partial emit — send a clean closer instead.
        onDelta(` ${text}`);
        text = `${emitted} ${text}`;
      }
      return text;
    }
    if (!text || /^\.+$/.test(text) || text === '...') {
      text = alreadyEnded
        ? 'Thanks, goodbye.'
        : 'Sorry, I did not catch that. Could you repeat the number?';
      if (!emitted) onDelta(text);
      return text;
    }
    if (alreadyEnded && !BYE_RE.test(text) && !byeAlready) {
      const bye = ' Bye.';
      onDelta(bye);
      text = `${text.replace(/\s*$/, '')}${bye}`;
    }
    if (!emitted && text) onDelta(text);
    return text;
  };

  const runSilentTools = async (): Promise<{ ended: boolean }> => {
    if (mutualBye || (alreadyEnded && byeAlready)) return { ended: true };
    if (alreadyEnded) return { ended: true };

    let items: Item[] = history;
    let ended = false;
    for (let hop = 0; hop <= 4; hop++) {
      const response = await openai().responses.create({
        model: MODELS.voiceTools,
        instructions: toolInstructions(basePrompt),
        input: items,
        tools: toOpenAiTools(tools),
        tool_choice: hop === 4 ? 'none' : 'auto',
        store: false,
        reasoning: { effort: 'low' },
      });
      const functionCalls = response.output.filter((o) => o.type === 'function_call');
      if (functionCalls.length === 0) break;

      const outputs: Item[] = [];
      for (const call of functionCalls) {
        // Speech path owns the goodbye; ignore any spoken content here.
        if (call.name === 'end_call') continue;
        const result = await executeTool(
          tools,
          call.name,
          call.arguments,
          record,
          turnIndex,
          Date.now() - startedAtMs,
        );
        if (call.name === 'record_outcome' && (result as { ended?: boolean }).ended) {
          ended = true;
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
      if (ended) break;
    }
    return { ended };
  };

  const persistTurn = async (finalText: string) => {
    const transcript: TranscriptTurn[] = history.map((m, i) => ({
      turn_index: i,
      role: m.role === 'assistant' ? 'buyer' : 'supplier',
      message: m.content,
      at_ms: 0,
    }));
    if (finalText) {
      transcript.push({
        turn_index: transcript.length,
        role: 'buyer',
        message: finalText,
        at_ms: Date.now() - startedAtMs,
      });
    }
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

      const emitEndCall = (reason: string) => {
        const callToolId = `call_end_${Date.now()}`;
        chunk({
          tool_calls: [
            {
              index: 0,
              id: callToolId,
              type: 'function',
              function: { name: 'end_call', arguments: '' },
            },
          ],
        });
        chunk({
          tool_calls: [
            {
              index: 0,
              function: {
                arguments: JSON.stringify({ reason, message: '' }),
              },
            },
          ],
        });
        chunk({}, 'tool_calls');
      };

      chunk({ role: 'assistant' });
      // Heartbeat keeps the SSE alive; no spoken filler — that was the Mm-hmm spam.
      const heartbeat = setInterval(() => chunk({}), 2000);

      // Tools run in parallel with speech so fee logging never blocks TTS.
      const toolsPromise = runSilentTools();

      let spoken = '';
      let toolsEnded = false;
      let firstTokenLogged = false;
      try {
        spoken = await streamSpeech((part) => {
          if (!firstTokenLogged) {
            firstTokenLogged = true;
            clearInterval(heartbeat);
            console.log(
              `voice-speak call=${callId.slice(0, 8)} first_token_ms=${Date.now() - requestStartedAt}`,
            );
          }
          chunk({ content: part });
        });
        clearInterval(heartbeat);
        console.log(
          `voice-speak call=${callId.slice(0, 8)} speech_done_ms=${Date.now() - requestStartedAt} chars=${spoken.length}`,
        );

        const toolResult = await toolsPromise;
        toolsEnded = toolResult.ended;
        console.log(
          `voice-tools call=${callId.slice(0, 8)} total_ms=${Date.now() - requestStartedAt} ended=${toolsEnded} new_tools=${newToolRecords.length}`,
        );
      } catch (e) {
        clearInterval(heartbeat);
        console.error('voice turn failed:', e);
        if (!spoken) {
          spoken = 'Sorry, could you repeat that?';
          chunk({ content: spoken });
        }
      } finally {
        clearInterval(heartbeat);
      }

      const hangUp =
        mutualBye ||
        (alreadyEnded && byeAlready) ||
        (toolsEnded && (BYE_RE.test(spoken) || byeAlready)) ||
        (BYE_RE.test(spoken) && BYE_RE.test(lastUser));

      // If tools just closed the deal and speech forgot goodbye, add one short bye.
      if (toolsEnded && spoken && !BYE_RE.test(spoken) && !byeAlready) {
        const bye = ' Thanks, bye.';
        chunk({ content: bye });
        spoken += bye;
      }

      if (hangUp) {
        emitEndCall(
          mutualBye || byeAlready
            ? 'Call complete — mutual goodbye'
            : 'Quote outcome recorded',
        );
      } else {
        chunk({}, 'stop');
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
      await persistTurn(spoken).catch((e) => console.error('persist failed:', e));
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
