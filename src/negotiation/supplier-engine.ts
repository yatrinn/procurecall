import 'server-only';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai, MODELS } from '@/integrations/openai-server';
import type { TranscriptTurn } from './types';

/**
 * Supplier policy engine: a dynamic, stateful counterparty. Each supplier has
 * a PRIVATE commercial policy — price sheet, floor, concession ladder,
 * disclosure policy, behavioral profile. Never a script, never a
 * predetermined final price.
 *
 * The model produces each turn; the ENGINE enforces the policy:
 * - a price below the floor is rejected and regenerated once, then clamped
 * - concession steps must follow the ladder and each is consumed at most once
 * - the floor and the policy itself are never revealed
 *
 * A price moves ONLY when the buyer supplies a reason the policy accepts.
 */

export interface SupplierPolicyRow {
  behavior_profile: string;
  price_sheet: Record<string, unknown>;
  floor: Record<string, unknown>;
  concession_ladder: Array<Record<string, unknown>>;
  disclosure_policy: Record<string, unknown>;
}

export interface SupplierState {
  consumed_concession_steps: number[];
  disclosed_categories: string[];
  committed_total_net_cents: number | null;
  hangup: boolean;
}

export const INITIAL_SUPPLIER_STATE: SupplierState = {
  consumed_concession_steps: [],
  disclosed_categories: [],
  committed_total_net_cents: null,
  hangup: false,
};

const SupplierTurnSchema = z.object({
  message: z.string().min(1),
  internal: z.object({
    concession_step_used: z.number().int().nullable(),
    concession_reason: z.string().nullable(),
    newly_disclosed_categories: z.array(z.string()),
    quoted_or_committed_total_net_cents: z
      .number()
      .int()
      .nullable()
      .describe('Only when a concrete all-in net total for the full job was stated'),
    wants_to_hang_up: z.boolean(),
  }),
});
export type SupplierTurn = z.infer<typeof SupplierTurnSchema>;

function systemPrompt(
  supplierName: string,
  policy: SupplierPolicyRow,
  state: SupplierState,
): string {
  const priceSheet = { ...policy.price_sheet };
  const styleNotes = (priceSheet as { style_notes?: string }).style_notes ?? '';
  delete (priceSheet as { style_notes?: unknown }).style_notes;

  const availableSteps = policy.concession_ladder.filter(
    (step) => !state.consumed_concession_steps.includes(step.step as number),
  );

  return `You are the dispatcher answering the phone at "${supplierName}", an equipment rental company. You are a HUMAN dispatcher in this simulation and you behave commercially, not helpfully.

BEHAVIORAL PROFILE: ${policy.behavior_profile}
${styleNotes}

YOUR PRIVATE PRICE SHEET (never read it out as a list; quote from it naturally):
${JSON.stringify(priceSheet, null, 2)}

YOUR PRIVATE FLOOR (never reveal it, never go below it under any circumstances):
${JSON.stringify(policy.floor, null, 2)}

YOUR CONCESSION LADDER — the ONLY ways you may improve your offer, in order,
each usable once. A concession requires the caller to have actually supplied
the reason listed in "requires" (e.g. a concrete competing quote with a number,
or a firm commitment to book today). Steps already used: ${JSON.stringify(
    state.consumed_concession_steps,
  )}.
Available steps:
${JSON.stringify(availableSteps, null, 2)}

YOUR DISCLOSURE POLICY:
${JSON.stringify(policy.disclosure_policy, null, 2)}
Categories you have already disclosed this call: ${JSON.stringify(state.disclosed_categories)}.

HARD RULES:
- Never invent prices not derivable from your price sheet.
- If disclosure policy says fees are disclosed only when asked, do NOT volunteer
  them; answer honestly when the caller asks about the specific category.
- A price improvement without an available ladder step whose condition is met
  is FORBIDDEN — decline politely or hold your position.
- Never state or hint at your floor or that you have a "policy".
- If the caller is vague or wastes your time, act per your profile.
- Stay consistent with everything you already said this call.
- Speak in short, natural spoken-dialogue sentences. US English. You are on
  the phone: no lists, no markdown.
- In "internal", report faithfully what you did this turn. If you stated a
  concrete all-in net total for the whole job, report it; else null.`;
}

export async function generateSupplierTurn(input: {
  supplierName: string;
  policy: SupplierPolicyRow;
  state: SupplierState;
  transcript: TranscriptTurn[];
}): Promise<SupplierTurn> {
  const floorCents = (input.policy.floor as { min_total_net_cents_5d?: number })
    .min_total_net_cents_5d;

  const history = input.transcript.map((t) => ({
    role: t.role === 'supplier' ? ('assistant' as const) : ('user' as const),
    content: t.message,
  }));

  const run = async (correction?: string): Promise<SupplierTurn> => {
    const response = await openai().responses.parse({
      model: MODELS.fast,
      instructions:
        systemPrompt(input.supplierName, input.policy, input.state) +
        (correction ? `\n\nCORRECTION (your previous draft violated policy): ${correction}` : ''),
      input: history,
      text: { format: zodTextFormat(SupplierTurnSchema, 'supplier_turn') },
    });
    const parsed = response.output_parsed;
    if (!parsed) throw new Error('Supplier turn: no parsed output');
    return parsed;
  };

  let turn = await run();

  // Policy enforcement: floor and ladder are checked by code, not trusted to the model.
  const violations: string[] = [];
  if (
    typeof floorCents === 'number' &&
    turn.internal.quoted_or_committed_total_net_cents !== null &&
    turn.internal.quoted_or_committed_total_net_cents < floorCents
  ) {
    violations.push(
      `You quoted a total below your floor. Re-answer without going below your minimum position; you may decline instead.`,
    );
  }
  if (turn.internal.concession_step_used !== null) {
    const step = input.policy.concession_ladder.find(
      (s) => (s.step as number) === turn.internal.concession_step_used,
    );
    const alreadyUsed = input.state.consumed_concession_steps.includes(
      turn.internal.concession_step_used,
    );
    const lowerUnused = input.policy.concession_ladder.some(
      (s) =>
        (s.step as number) < (turn.internal.concession_step_used as number) &&
        !input.state.consumed_concession_steps.includes(s.step as number),
    );
    if (!step || alreadyUsed) {
      violations.push('You used a concession step that does not exist or is already spent.');
    } else if (lowerUnused) {
      violations.push('You skipped a ladder step. Concessions go in order.');
    }
  }
  if (violations.length > 0) {
    turn = await run(violations.join(' '));
    // Final clamp: if the regenerated turn still violates the floor, refuse the number.
    if (
      typeof floorCents === 'number' &&
      turn.internal.quoted_or_committed_total_net_cents !== null &&
      turn.internal.quoted_or_committed_total_net_cents < floorCents
    ) {
      turn = {
        message:
          "Look, I've sharpened my pencil as far as it goes. That last number stands — take it or leave it.",
        internal: {
          concession_step_used: null,
          concession_reason: null,
          newly_disclosed_categories: [],
          quoted_or_committed_total_net_cents: null,
          wants_to_hang_up: false,
        },
      };
    }
  }
  return turn;
}

export function applySupplierTurn(state: SupplierState, turn: SupplierTurn): SupplierState {
  return {
    consumed_concession_steps:
      turn.internal.concession_step_used !== null
        ? [...state.consumed_concession_steps, turn.internal.concession_step_used]
        : state.consumed_concession_steps,
    disclosed_categories: Array.from(
      new Set([...state.disclosed_categories, ...turn.internal.newly_disclosed_categories]),
    ),
    committed_total_net_cents:
      turn.internal.quoted_or_committed_total_net_cents ?? state.committed_total_net_cents,
    hangup: turn.internal.wants_to_hang_up,
  };
}
