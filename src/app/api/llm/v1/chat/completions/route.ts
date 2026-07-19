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
 * Latency strategy:
 * 1. ElevenLabs first_message greets immediately (no brain wait on connect).
 * 2. While the brain runs, we stream a short bridge (varied filler or a brief
 *    echo of what the dispatcher just said) so the line never goes silent.
 * 3. After a mutual goodbye / recorded outcome, we emit ElevenLabs end_call
 *    so the agent hangs up instead of looping "bye".
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
  /^(got it[.!,—-]*\s*|alright[.!,—-]*\s*|all right[.!,—-]*\s*|okay[.!,—-]*\s*|ok[.!,—-]*\s*|right[.!,—-]*\s*|sure[.!,—-]*\s*|understood[.!,—-]*\s*|noted[.!,—-]*\s*|thanks[.!,—-]*\s*|thank you[.!,—-]*\s*|one (second|moment)[.!,—-]*\s*|mm-?hmm[.!,—-]*\s*|yeah[.!,—-]*\s*|yep[.!,—-]*\s*)+/i;

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const BYE_RE = /\b(bye|goodbye|good bye|talk soon|take care|have a good (one|day))\b/i;

const BRIDGE_FILLERS: Array<{ key: string; text: string; pattern: RegExp }> = [
  { key: 'mmhmm', text: 'Mm-hmm. ', pattern: /\bmm-?hmm\b/i },
  { key: 'okay', text: 'Okay - ', pattern: /\bokay\b|\bok\b/i },
  { key: 'sure', text: 'Sure - ', pattern: /\bsure\b/i },
  { key: 'yeah', text: 'Yeah - ', pattern: /\byeah\b|\byep\b/i },
  { key: 'gotit', text: 'Got it - ', pattern: /\bgot it\b/i },
  { key: 'alright', text: 'Alright - ', pattern: /\bal+right\b/i },
  { key: 'thanks', text: 'Thanks - ', pattern: /\bthanks\b|\bthank you\b/i },
];

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

function countFillerUses(assistantTexts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { key, pattern } of BRIDGE_FILLERS) {
    let n = 0;
    for (const t of assistantTexts) n += (t.match(new RegExp(pattern.source, 'gi')) ?? []).length;
    counts.set(key, n);
  }
  return counts;
}

function lastFillerKey(assistantTexts: string[]): string | null {
  const last = [...assistantTexts].reverse()[0] ?? '';
  for (const { key, pattern } of BRIDGE_FILLERS) {
    if (pattern.test(last.slice(0, 40))) return key;
  }
  return null;
}

/** Brief echo of the last dispatcher phrase — keeps the line alive naturally. */
function echoBridge(lastUser: string): string | null {
  const cleaned = lastUser
    .replace(/["""']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 12 || cleaned.length > 120) return null;
  if (BYE_RE.test(cleaned)) return null;
  // Skip pure noise / one-word replies.
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 3 || words.length > 14) return null;
  // Take a short trailing chunk and capitalize.
  const chunk = words.slice(-Math.min(6, words.length)).join(' ');
  const echoed = chunk.charAt(0).toUpperCase() + chunk.slice(1);
  if (!/[.!?]$/.test(echoed)) return `${echoed} - `;
  return `${echoed.replace(/[.!?]+$/, '')} - `;
}

function pickBridge(input: {
  assistantTexts: string[];
  lastUser: string;
  isOpeningContinuation: boolean;
}): string {
  // After the ElevenLabs first_message, the first brain turn should jump
  // straight into substance — no bridge needed (greeting already happened).
  if (input.isOpeningContinuation) return '';

  const uses = countFillerUses(input.assistantTexts);
  const lastKey = lastFillerKey(input.assistantTexts);
  const roll = Math.random();

  // ~40% echo, ~40% filler, ~20% silent (brain content arrives soon enough).
  if (roll < 0.4) {
    const echo = echoBridge(input.lastUser);
    if (echo) return echo;
  }
  if (roll < 0.8) {
    const candidates = BRIDGE_FILLERS.filter(
      (f) => (uses.get(f.key) ?? 0) < 3 && f.key !== lastKey,
    );
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)].text;
    }
  }
  return '';
}

function assistantAlreadySaidBye(assistantTexts: string[]): boolean {
  return assistantTexts.some((t) => BYE_RE.test(t));
}

function userSaidBye(lastUser: string): boolean {
  return BYE_RE.test(lastUser);
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
    '- LANGUAGE: US English only. Never Chinese or any other language.\n' +
    '- OPENING: telephony may already have greeted and disclosed that you are an AI. Do not repeat the full intro — continue with the job specifics.\n' +
    '- LENGTH: one or two short questions per turn. Prefer a follow-up turn over stacking topics.\n' +
    '- CLARIFY: if the dispatcher is unclear, muffled, contradictory, or you are not sure what they meant, ask a short clarifying question. Never invent a number you did not hear.\n' +
    '- BRIDGING: a short spoken bridge may already have been played before your reply arrives — do not start with the same filler again; go to substance.\n' +
    '- CLOSE: after record_outcome, say goodbye ONCE. If the dispatcher has also said goodbye, hang up (end_call) — never say bye repeatedly.\n' +
    '- Numbers slowly and clearly. Batch log_quote_line calls for one supplier utterance into one parallel tool batch.' +
    (alreadyEnded
      ? '\n\nThe outcome is already recorded. If you have not said goodbye yet, say one short goodbye. If goodbye was already said, hang up immediately — say nothing else.'
      : '');

  const history = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: contentToText(m.content),
    }))
    .filter((m) => m.content.length > 0);

  const assistantTexts = history.filter((m) => m.role === 'assistant').map((m) => m.content);
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const byeAlready = assistantAlreadySaidBye(assistantTexts);
  const mutualBye = byeAlready && userSaidBye(lastUser);
  // First brain turn after the static first_message: few/no user turns yet, or
  // only a short pickup like "hello" / "yeah".
  const isOpeningContinuation =
    history.filter((m) => m.role === 'user').length <= 1 &&
    lastUser.length < 40 &&
    !/\d|euro|price|rate|fee|available|lift/i.test(lastUser);

  type Item =
    | { role: 'user' | 'assistant'; content: string }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string };

  const record = (r: ToolCallRecord) => newToolRecords.push(r);
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
      try {
        const retry = await openai().responses.create({
          model: turnModel,
          instructions:
            systemPrompt +
            '\n\nCRITICAL: rewrite in plain US English only. No Chinese. No filler openers. Under 35 words.',
          input: [
            ...items,
            {
              role: 'user',
              content: 'Rewrite your last reply in US English only. Keep it short.',
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
        spoken = endedThisTurn ? 'Thanks — goodbye.' : 'Sorry, could you say that again?';
      }
    }
    if (endedThisTurn && !byeAlready) {
      if (spoken && !BYE_RE.test(spoken)) spoken = `${spoken.replace(/\s*$/, '')} Bye.`;
      if (!spoken) spoken = 'Thanks — goodbye.';
    }
    // Already said bye once — do not speak another farewell.
    if (byeAlready && endedThisTurn) spoken = '';
    return spoken;
  };

  const runBrain = async (): Promise<{ text: string; hangUp: boolean }> => {
    // Mutual goodbye or outcome already closed with a prior bye → hang up now.
    if (mutualBye || (alreadyEnded && byeAlready)) {
      return { text: '', hangUp: true };
    }

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
        const text = await finalizeSpoken(extractText(response), items, endedThisTurn);
        const hangUp =
          endedThisTurn || (BYE_RE.test(text) && userSaidBye(lastUser)) || (byeAlready && endedThisTurn);
        return { text, hangUp };
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
        if (byeAlready) return { text: '', hangUp: true };
        const close = await openai().responses.create({
          model: turnModel,
          instructions:
            systemPrompt +
            '\n\nOutcome recorded. One short US-English goodbye only. No questions. No filler.',
          input: items,
          tool_choice: 'none',
          store: false,
          reasoning: { effort: 'low' },
        });
        const text = await finalizeSpoken(
          extractText(close) || 'Thanks — goodbye.',
          items,
          true,
        );
        return { text, hangUp: true };
      }
    }
    return { text: '', hangUp: false };
  };

  const persistTurn = async (finalText: string) => {
    if (!finalText) return;
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

  const bridge = pickBridge({
    assistantTexts,
    lastUser,
    isOpeningContinuation,
  });
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
                arguments: JSON.stringify({
                  reason,
                  message: '',
                }),
              },
            },
          ],
        });
        chunk({}, 'tool_calls');
      };

      chunk({ role: 'assistant' });
      // Bridge immediately so TTS starts while the brain is still thinking.
      if (bridge) chunk({ content: bridge });
      const firstContentMs = Date.now() - requestStartedAt;
      const heartbeat = setInterval(() => chunk({}), 2500);

      let finalText = '';
      let hangUp = false;
      try {
        const result = await runBrain();
        finalText = result.text;
        hangUp = result.hangUp;
      } catch (e) {
        console.error('voice brain failed:', e);
      } finally {
        clearInterval(heartbeat);
      }

      if (!finalText && !hangUp) finalText = 'Sorry, could you say that again?';

      // Avoid repeating the bridge words at the start of the brain reply.
      if (bridge && finalText) {
        finalText = stripLeadingFiller(finalText);
        // If the brain accidentally echoed the same bridge text, peel it.
        if (finalText.toLowerCase().startsWith(bridge.trim().toLowerCase().slice(0, 8))) {
          finalText = stripLeadingFiller(finalText);
        }
      }

      console.log(
        `voice-turn call=${callId.slice(0, 8)} model=voice first_content_ms=${firstContentMs} brain_ms=${Date.now() - requestStartedAt} bridge=${bridge ? 'y' : 'n'} hangup=${hangUp}`,
      );

      if (finalText) {
        const parts = finalText.match(/[^.!?]+[.!?]*\s*/g) ?? [finalText];
        for (const part of parts) chunk({ content: part });
      }

      if (hangUp) {
        emitEndCall(
          alreadyEnded || mutualBye
            ? 'Call complete — mutual goodbye'
            : 'Quote outcome recorded',
        );
      } else {
        chunk({}, 'stop');
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
      await persistTurn(bridge + finalText).catch((e) => console.error('persist failed:', e));
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
