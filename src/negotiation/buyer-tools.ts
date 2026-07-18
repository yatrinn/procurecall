import 'server-only';
import { z } from 'zod';
import { getVerifiedLeverage } from '@/core/truth-layer';
import { supabaseAdmin } from '@/integrations/supabase-server';
import type { AuthorizedLevers } from '@/core/jobspec';
import type { VerticalConfig } from '@/config/vertical-schema';
import { QuoteLineArgsSchema, OutcomeSchema, type ToolCallRecord } from './types';

/**
 * The buyer agent's tool surface. This is the enforcement point of the whole
 * product:
 *
 * - Competing figures exist ONLY behind request_verified_leverage, which runs
 *   the truth-layer checks server-side and picks the quote itself (the model
 *   cannot pass an arbitrary id, so it cannot cite anything unverified).
 * - Unauthorized levers are ABSENT from the tool list for the session. The
 *   model cannot claim authority it was never handed.
 */

export interface BuyerToolContext {
  callId: string;
  specId: string;
  specFingerprint: string;
  supplierId: string;
  vertical: VerticalConfig;
  levers: AuthorizedLevers;
  budgetNet: number | null;
  currentTurnIndex: () => number;
  nowMs: () => number;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown) => Promise<unknown>;
}

const NO_ARGS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
  required: [],
} as const;

function zodToJsonParams(shape: Record<string, { type: string; description?: string; enum?: string[]; nullable?: boolean }>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, def] of Object.entries(shape)) {
    const type = def.nullable ? [def.type, 'null'] : def.type;
    properties[key] = def.enum
      ? { type, enum: def.enum, description: def.description }
      : { type, description: def.description };
    required.push(key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

export function buildBuyerTools(ctx: BuyerToolContext): ToolDef[] {
  const supabase = supabaseAdmin();
  const tools: ToolDef[] = [];

  tools.push({
    name: 'log_quote_line',
    description:
      'Record one itemized fee, rate, discount, or deposit the supplier just stated, pinned to this moment of the call. Use immediately every time a number is spoken. amount_cents: integer cents (e.g. 9300 for 93.00); for percent_of_rental use basis points (10% = 1000).',
    parameters: zodToJsonParams({
      label: { type: 'string', description: 'Short label as the supplier named it' },
      category: {
        type: 'string',
        enum: [
          'rental',
          'delivery',
          'pickup',
          'insurance',
          'accessory',
          'surcharge',
          'discount',
          'deposit',
          'cleaning',
          'fuel',
          'late_fee',
          'damage_waiver',
          'overtime',
          'other',
        ],
      },
      amount_cents: { type: 'integer', description: 'Integer cents, or basis points for percent_of_rental' },
      unit: { type: 'string', enum: ['flat', 'per_day', 'per_week', 'percent_of_rental'] },
      is_mandatory: { type: 'boolean' },
      is_conditional: { type: 'boolean', description: 'True if it only applies when triggered (cleaning, refuel, late return...)' },
      condition_trigger: { type: 'string', nullable: true },
    }),
    execute: async (args) => {
      const line = QuoteLineArgsSchema.parse(args);
      return { logged: true, line };
    },
  });

  tools.push({
    name: 'request_verified_leverage',
    description:
      'Ask the ProcureCall server for a verified competing figure usable against this supplier. Returns a figure ONLY if another supplier has a confirmed, transcript-backed, unexpired quote for the IDENTICAL job fingerprint. You may only cite a competing figure returned by this tool, exactly as returned. If it fails, you negotiate without leverage.',
    parameters: NO_ARGS,
    execute: async () => {
      const { data: candidates, error } = await supabase
        .from('quotes')
        .select('id, supplier_id, total_after_negotiation_cents, total_before_negotiation_cents')
        .eq('spec_fingerprint', ctx.specFingerprint)
        .eq('status', 'confirmed')
        .neq('supplier_id', ctx.supplierId);
      if (error) return { ok: false, reason: 'lookup_failed', detail: error.message };
      const sorted = (candidates ?? [])
        .map((c) => ({
          id: c.id,
          total: c.total_after_negotiation_cents ?? c.total_before_negotiation_cents ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => a.total - b.total);
      if (sorted.length === 0) {
        return {
          ok: false,
          reason: 'no_confirmed_competing_quote',
          detail: 'No confirmed quote with a matching fingerprint from another supplier exists yet.',
        };
      }
      const result = await getVerifiedLeverage({
        currentSpecFingerprint: ctx.specFingerprint,
        quoteId: sorted[0].id,
        currency: ctx.vertical.currency,
        taxBasis: 'net',
      });
      if (result.ok) {
        // Structural record: leverage was fetched with tool-returned evidence.
        await supabase.from('negotiation_events').insert({
          call_id: ctx.callId,
          event_type: 'leverage_used',
          lever_used: 'verified_competing_quote',
          verified_source_quote_id: result.quote_id,
          tool_returned_evidence: result,
          transcript_ref: { call_id: ctx.callId, turn_index: ctx.currentTurnIndex() },
        });
      }
      return result;
    },
  });

  tools.push({
    name: 'log_concession',
    description:
      'Record that the supplier just improved a price or term (or explicitly refused). Use immediately when it happens.',
    parameters: zodToJsonParams({
      event_type: {
        type: 'string',
        enum: ['concession', 'fee_waived', 'fee_reduced', 'rate_reduced', 'term_improved', 'refusal', 'floor_reached'],
      },
      concession_type: { type: 'string', description: 'What moved, e.g. "pickup fee waived"' },
      amount_before_cents: { type: 'integer', nullable: true },
      amount_after_cents: { type: 'integer', nullable: true },
    }),
    execute: async (args) => {
      const schema = z.object({
        event_type: z.enum(['concession', 'fee_waived', 'fee_reduced', 'rate_reduced', 'term_improved', 'refusal', 'floor_reached']),
        concession_type: z.string(),
        amount_before_cents: z.number().int().nullable(),
        amount_after_cents: z.number().int().nullable(),
      });
      const parsed = schema.parse(args);
      const delta =
        parsed.amount_before_cents !== null && parsed.amount_after_cents !== null
          ? parsed.amount_before_cents - parsed.amount_after_cents
          : null;
      await supabase.from('negotiation_events').insert({
        call_id: ctx.callId,
        event_type: parsed.event_type,
        concession_type: parsed.concession_type,
        amount_before_cents: parsed.amount_before_cents,
        amount_after_cents: parsed.amount_after_cents,
        delta_abs_cents: delta,
        delta_pct:
          delta !== null && parsed.amount_before_cents
            ? Math.round((delta / parsed.amount_before_cents) * 10_000) / 100
            : null,
        transcript_ref: { call_id: ctx.callId, turn_index: ctx.currentTurnIndex() },
      });
      return { recorded: true };
    },
  });

  tools.push({
    name: 'record_friction',
    description:
      'Record a friction event: interruption, evasion, refusal to quote, being challenged as a robot, hangup threat, hold.',
    parameters: zodToJsonParams({
      kind: {
        type: 'string',
        enum: ['interruption', 'evasion', 'refusal', 'robot_challenge', 'hangup_threat', 'hangup', 'hold', 'other'],
      },
      note: { type: 'string' },
    }),
    execute: async (args) => {
      const parsed = z.object({ kind: z.string(), note: z.string() }).parse(args);
      return { recorded: true, ...parsed };
    },
  });

  tools.push({
    name: 'record_outcome',
    description:
      'End the call with its structured outcome. EVERY call must end through this tool: an itemized quote, a callback commitment, or a documented decline. For quotes, first read the total back to the supplier and only set supplier_confirmed_total=true if they verbally confirmed.',
    parameters: zodToJsonParams({
      type: { type: 'string', enum: ['quote', 'callback_commitment', 'documented_decline'] },
      summary: { type: 'string', description: 'Two sentences max, operational' },
      supplier_confirmed_total: { type: 'boolean', nullable: true },
      total_net_cents: { type: 'integer', nullable: true, description: 'All-in guaranteed net total for the full job, if quoted' },
      availability_confirmed: { type: 'boolean', nullable: true },
      validity_days: { type: 'integer', nullable: true },
      callback_when: { type: 'string', nullable: true },
      decline_reason: { type: 'string', nullable: true },
    }),
    execute: async (args) => {
      const outcome = OutcomeSchema.parse(args);
      return { ended: true, outcome };
    },
  });

  // ---- Lever-gated tools: absent unless authorized. ----

  if (ctx.levers.may_reveal_budget && ctx.budgetNet !== null) {
    tools.push({
      name: 'reveal_budget',
      description:
        'Returns the budget the requester authorized you to reveal. Only cite the budget after calling this.',
      parameters: NO_ARGS,
      execute: async () => ({ ok: true, budget_net_cents: Math.round(ctx.budgetNet! * 100) }),
    });
  }
  if (ctx.levers.may_adjust_delivery_window) {
    tools.push({
      name: 'use_lever_adjust_delivery_window',
      description:
        'Returns authorization to accept a wider delivery window in exchange for a better price. Only offer this after calling this tool.',
      parameters: NO_ARGS,
      execute: async () => ({ ok: true, authorized: 'may accept a wider delivery window if compensated' }),
    });
  }
  if (ctx.levers.may_extend_rental_period) {
    tools.push({
      name: 'use_lever_extend_rental_period',
      description: 'Returns authorization to extend the rental period to reach a better tier.',
      parameters: NO_ARGS,
      execute: async () => ({ ok: true, authorized: 'may extend rental period for a better weekly tier' }),
    });
  }
  if (ctx.levers.may_accept_equivalent_equipment) {
    tools.push({
      name: 'use_lever_accept_equivalent_equipment',
      description: 'Returns authorization to accept a technically equivalent machine.',
      parameters: NO_ARGS,
      execute: async () => ({ ok: true, authorized: 'may accept technically equivalent equipment meeting all spec constraints' }),
    });
  }
  if (ctx.levers.may_offer_repeat_business) {
    tools.push({
      name: 'use_lever_offer_repeat_business',
      description: 'Returns authorization to mention realistic future rental volume.',
      parameters: NO_ARGS,
      execute: async () => ({ ok: true, authorized: 'may mention realistic repeat business, no invented volumes' }),
    });
  }
  if (ctx.levers.may_accept_pickup_instead_of_delivery) {
    tools.push({
      name: 'use_lever_accept_pickup',
      description: 'Returns authorization to accept self-pickup instead of delivery.',
      parameters: NO_ARGS,
      execute: async () => ({ ok: true, authorized: 'may accept self-pickup instead of delivery' }),
    });
  }
  if (ctx.levers.may_commit_immediately && ctx.levers.maximum_commitment_net !== null) {
    tools.push({
      name: 'commit_booking',
      description:
        'Commit to booking at the stated all-in net total. Fails above your commitment ceiling. Only commit after availability and the total are confirmed.',
      parameters: zodToJsonParams({
        total_net_cents: { type: 'integer', description: 'All-in net total in cents' },
      }),
      execute: async (args) => {
        const parsed = z.object({ total_net_cents: z.number().int() }).parse(args);
        const ceiling = Math.round((ctx.levers.maximum_commitment_net ?? 0) * 100);
        if (parsed.total_net_cents > ceiling) {
          return {
            ok: false,
            reason: 'above_commitment_ceiling',
            detail: `Ceiling is ${ceiling} cents net.`,
          };
        }
        return { ok: true, committed_total_net_cents: parsed.total_net_cents };
      },
    });
  }

  return tools;
}

export function toOpenAiTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true,
  }));
}

export async function executeTool(
  tools: ToolDef[],
  name: string,
  argsJson: string,
  record: (r: ToolCallRecord) => void,
  turnIndex: number,
  nowMs: number,
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, reason: 'unknown_tool', detail: `No tool named ${name} on this session.` };
  let args: unknown;
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    return { ok: false, reason: 'invalid_arguments' };
  }
  try {
    const result = await tool.execute(args);
    record({ turn_index: turnIndex, tool: name, arguments: args, result, at_ms: nowMs });
    return result;
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'tool failed';
    const result = { ok: false, reason: 'tool_error', detail };
    record({ turn_index: turnIndex, tool: name, arguments: args, result, at_ms: nowMs });
    return result;
  }
}
