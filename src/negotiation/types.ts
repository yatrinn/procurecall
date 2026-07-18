import { z } from 'zod';
import { LineCategorySchema, LineUnitSchema } from '@/core/price-engine';

export interface TranscriptTurn {
  turn_index: number;
  role: 'buyer' | 'supplier';
  message: string;
  at_ms: number;
  /** Voice tier only: seconds into the recording. */
  audio_start_s?: number | null;
}

export interface ToolCallRecord {
  turn_index: number;
  tool: string;
  arguments: unknown;
  result: unknown;
  at_ms: number;
}

export const QuoteLineArgsSchema = z.object({
  label: z.string().min(1),
  category: LineCategorySchema,
  amount_cents: z.number().int(),
  unit: LineUnitSchema,
  is_mandatory: z.boolean(),
  is_conditional: z.boolean(),
  condition_trigger: z.string().nullable(),
});
export type QuoteLineArgs = z.infer<typeof QuoteLineArgsSchema>;

export const OutcomeSchema = z.object({
  type: z.enum(['quote', 'callback_commitment', 'documented_decline']),
  summary: z.string().min(1),
  /** Quote outcomes: did the supplier verbally confirm the read-back total? */
  supplier_confirmed_total: z.boolean().nullable(),
  total_net_cents: z.number().int().nullable(),
  availability_confirmed: z.boolean().nullable(),
  validity_days: z.number().int().nullable(),
  callback_when: z.string().nullable(),
  decline_reason: z.string().nullable(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export interface FrictionEvent {
  turn_index: number;
  kind:
    | 'interruption'
    | 'evasion'
    | 'refusal'
    | 'robot_challenge'
    | 'hangup_threat'
    | 'hangup'
    | 'hold'
    | 'other';
  note: string;
}

export interface NegotiationEventRecord {
  event_type:
    | 'leverage_used'
    | 'concession'
    | 'fee_waived'
    | 'fee_reduced'
    | 'rate_reduced'
    | 'term_improved'
    | 'refusal'
    | 'floor_reached';
  lever_used: string | null;
  verified_source_quote_id: string | null;
  tool_returned_evidence: unknown;
  concession_type: string | null;
  amount_before_cents: number | null;
  amount_after_cents: number | null;
  transcript_turn_index: number;
}
