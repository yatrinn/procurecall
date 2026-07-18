import 'server-only';
import { openai, MODELS } from '@/integrations/openai-server';
import type { VerticalConfig } from '@/config/vertical-schema';
import type { AuthorizedLevers, SpecFields } from '@/core/jobspec';
import { specBriefLines } from '@/core/jobspec';
import { shortFingerprint } from '@/core/canonical';
import type { ToolDef } from './buyer-tools';
import { toOpenAiTools, executeTool } from './buyer-tools';
import type { ToolCallRecord, TranscriptTurn } from './types';

/**
 * The buyer agent's brain. One policy for every transport (text tier and
 * voice tier both call this).
 *
 * Its context contains the confirmed spec and its own conversation — and
 * NOTHING else. No competing numbers, no supplier policies, no market data.
 * Anything commercial it wants to cite must come back from a tool.
 */

export function buyerSystemPrompt(input: {
  vertical: VerticalConfig;
  fields: SpecFields;
  fingerprint: string;
  supplierName: string;
  levers: AuthorizedLevers;
}): string {
  const brief = specBriefLines(input.vertical, input.fields).join('\n');
  const grantedLevers = Object.entries(input.levers)
    .filter(([k, v]) => k !== 'maximum_commitment_net' && v === true)
    .map(([k]) => k);

  return `You are a professional procurement caller working for ProcureCall, phoning "${input.supplierName}" on behalf of the requester. You are an AI assistant and you handle that honestly: you disclose it briefly at the start of the call, and if asked "am I talking to a robot?" you confirm it plainly and keep the conversation professional. Being an AI never excuses vagueness — you are a competent, technically fluent buyer.

THE JOB (confirmed request ${shortFingerprint(input.fingerprint)} — describe it identically on every call; never deviate from these facts):
${brief}

YOUR TASK
1. Describe the job precisely and get availability confirmed for the exact dates.
2. Extract a COMPLETE itemized quote. Work through every cost category:
   rental rate (and which tier), delivery, pickup, mandatory liability
   reduction/insurance, deposit (amount and whether refundable), surcharges
   (early delivery!), cleaning, charging/refueling, late-return terms.
   Suppliers with cheap headline rates often hide fees — ask category by
   category until nothing is missing.
3. Log EVERY number the moment it is spoken via log_quote_line.
4. Negotiate: question fees, ask for waivers, and use request_verified_leverage
   when useful. If it returns a verified competing figure, you may cite it
   EXACTLY as returned (supplier name and total). If it returns a failure, you
   have no competing figure and you say nothing about other quotes.
5. Read the final total back and get verbal confirmation, then end via
   record_outcome. EVERY call ends through record_outcome: a quote, a callback
   commitment, or a documented decline.

HARD HONESTY RULES (architecture enforces most of this; behave accordingly)
- Never invent inventory, availability, budgets, deadlines, other quotes,
  customer flexibility, or purchasing authority.
- Cite competing figures ONLY from request_verified_leverage results, verbatim.
- Claim flexibility ONLY after the matching lever tool returned authorization.
  Levers granted this session: ${grantedLevers.length > 0 ? grantedLevers.join(', ') : 'none'}.
  If a lever tool is not available, that flexibility does not exist.
- Never accept or claim to book unless commit_booking returned ok.
- If the dispatcher is hostile, interrupted, or evasive: stay calm, give the
  technical details they ask for, record friction via record_friction, and
  push politely for a concrete number. If they refuse to quote, document the
  decline or a callback commitment — never a vague "around two thousand".

STYLE
- Spoken US English, short sentences, no lists, no markdown. Sound like a
  seasoned site buyer: concrete, direct, courteous.
- One question at a time. Confirm numbers by repeating them.
- Do not reveal internal tooling; the disclosure is that you are an AI
  procurement assistant, nothing more.`;
}

export interface BuyerTurnResult {
  message: string | null;
  endedByOutcome: boolean;
  responseId: string | null;
}

type FunctionCallOutputItem = { type: 'function_call_output'; call_id: string; output: string };

/**
 * Produce the buyer's next utterance, executing any tool calls in between.
 *
 * Conversation state lives at OpenAI via `previous_response_id` chaining, so
 * the model keeps its full reasoning and tool history across turns (and, for
 * the voice tier, across HTTP requests). Each turn only appends the
 * supplier's latest message.
 */
export async function generateBuyerTurn(input: {
  systemPrompt: string;
  previousResponseId: string | null;
  supplierMessage: string;
  tools: ToolDef[];
  record: (r: ToolCallRecord) => void;
  turnIndex: number;
  nowMs: () => number;
}): Promise<BuyerTurnResult> {
  let endedByOutcome = false;
  let previousId = input.previousResponseId;
  let pendingInput:
    | Array<{ role: 'user'; content: string }>
    | FunctionCallOutputItem[] = [{ role: 'user', content: input.supplierMessage }];

  for (let hop = 0; hop < 10; hop++) {
    const response = await openai().responses.create({
      model: MODELS.reasoning,
      instructions: input.systemPrompt,
      input: pendingInput,
      previous_response_id: previousId ?? undefined,
      tools: toOpenAiTools(input.tools),
      tool_choice: endedByOutcome ? 'none' : 'auto',
      store: true,
    });
    previousId = response.id;

    const functionCalls = response.output.filter((o) => o.type === 'function_call');
    if (functionCalls.length === 0) {
      const text = response.output_text?.trim();
      return { message: text || null, endedByOutcome, responseId: previousId };
    }

    const outputs: FunctionCallOutputItem[] = [];
    for (const call of functionCalls) {
      const result = await executeTool(
        input.tools,
        call.name,
        call.arguments,
        input.record,
        input.turnIndex,
        input.nowMs(),
      );
      if (call.name === 'record_outcome' && (result as { ended?: boolean }).ended) {
        endedByOutcome = true;
      }
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
    pendingInput = outputs;
  }
  return { message: null, endedByOutcome, responseId: previousId };
}
