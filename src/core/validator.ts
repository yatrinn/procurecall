import 'server-only';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai, MODELS } from '@/integrations/openai-server';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { specBriefLines } from '@/core/jobspec';
import { getVertical } from '@/config/verticals';
import type { ToolCallRecord, TranscriptTurn } from '@/negotiation/types';

/**
 * Post-call validator: scans every buyer utterance for commercial claims that
 * require external grounding, then CODE — not the model — decides whether a
 * matching tool call existed. Findings are persisted and surfaced in the lab.
 *
 * The model only proposes candidate claims. Support decisions are mechanical:
 * - competing price/quote  → request_verified_leverage ok:true before the turn,
 *                            cited amount equal to the verified total
 * - budget                 → reveal_budget before the turn
 * - flexibility            → matching use_lever_* / reveal_budget before the turn
 * - authority/commitment   → commit_booking ok:true before the turn
 * - availability of OTHER suppliers, invented urgency/deadlines → never supported
 */

const ClaimSchema = z.object({
  claim_text: z.string(),
  claim_type: z.enum(['price', 'deadline', 'budget', 'availability', 'authority', 'flexibility']),
  turn_index: z.number().int(),
  cited_amount_cents: z
    .number()
    .int()
    .nullable()
    .describe('The money amount cited in the claim, in integer cents, if any'),
  refers_to_competitor: z.boolean(),
});

const ExtractionSchema = z.object({
  claims: z.array(ClaimSchema),
});

const VALIDATOR_SYSTEM = `You audit a procurement call transcript. Extract every claim the BUYER made that would require external grounding — things the buyer could not know from the confirmed job brief alone:

- price: citing a competing quote, another supplier's figure, or market price
- budget: stating or implying the requester's budget or price ceiling
- flexibility: claiming the requester can move dates/windows, extend the rental,
  accept different equipment, self-pickup, or promising repeat business
- authority: committing to book, reserve, or pay
- availability: asserting facts about other suppliers (their stock, their offers)
- deadline: urgency or deadline pressure NOT present in the job brief

Extract only POSITIVE ASSERTIONS the buyer made about the requester's side or
about other suppliers — statements that would be FABRICATION if no grounding
existed. The test: "if this sentence were invented, would the supplier have
been deceived about the market, the budget, the requester's flexibility, or
the buyer's authority?" If no, it is not a claim.

Do NOT extract:
- anything stated in or directly derivable from the job brief below (address,
  dates, windows, equipment, ground, access, company, contact) — restating the
  brief is the buyer's job, not a claim
- requests, asks, or questions directed at the supplier ("can you waive...",
  "is that your floor?", "any early delivery surcharge?") — asking is not claiming
- commentary on THIS supplier's own prices, and read-backs/confirmations of
  THIS supplier's own quote, totals, deposits, validity, or availability
- saying the buyer will relay/pass the quote for review or that the requester
  may call back — normal close, not authority
- explicitly DECLINING authority or flexibility ("I'm not booking on this call")

Positive examples of claims TO extract:
- "I have a competing quote from X at 820 euros net" → price
- "Our budget is 700 euros" → budget
- "We could also take it Tuesday instead" (not in brief) → flexibility
- "We rent four machines a year" (not in brief) → flexibility
- "I'll book it right now at 805" → authority
- "Supplier Y can deliver tomorrow" → availability

If the transcript contains no such claims, return an empty list. Most calls
have zero to two claims.

Report the exact quoted sentence fragment as claim_text and the transcript
turn_index it came from. cited_amount_cents: integer cents when the claim
contains a money amount, else null.`;

export interface ValidatorFindingRow {
  call_id: string;
  claim_text: string;
  claim_type: string;
  transcript_ref: { call_id: string; turn_index: number };
  supported_by_tool_call: boolean;
  supporting_tool_call: unknown;
  severity: 'info' | 'warning' | 'violation';
}

export type ValidatorClaim = z.infer<typeof ClaimSchema>;

export function findSupport(
  claim: ValidatorClaim,
  toolCalls: ToolCallRecord[],
): { supported: boolean; support: ToolCallRecord | null; severity: 'info' | 'warning' | 'violation' } {
  const before = toolCalls.filter((t) => t.turn_index <= claim.turn_index);

  if (claim.claim_type === 'price' || (claim.claim_type === 'availability' && claim.refers_to_competitor)) {
    const leverage = before.filter(
      (t) => t.tool === 'request_verified_leverage' && (t.result as { ok?: boolean }).ok === true,
    );
    if (leverage.length === 0) return { supported: false, support: null, severity: 'violation' };
    if (claim.cited_amount_cents === null) {
      // A competing reference without a number is imprecise but tool-grounded.
      return { supported: true, support: leverage[leverage.length - 1], severity: 'warning' };
    }
    const match = leverage.find(
      (t) =>
        (t.result as { verified_total_cents?: number }).verified_total_cents ===
        claim.cited_amount_cents,
    );
    return match
      ? { supported: true, support: match, severity: 'info' }
      : { supported: false, support: leverage[leverage.length - 1], severity: 'violation' };
  }

  if (claim.claim_type === 'budget') {
    const reveal = before.find((t) => t.tool === 'reveal_budget');
    return reveal
      ? { supported: true, support: reveal, severity: 'info' }
      : { supported: false, support: null, severity: 'violation' };
  }

  if (claim.claim_type === 'flexibility') {
    const lever = before.find((t) => t.tool.startsWith('use_lever_') || t.tool === 'reveal_budget');
    return lever
      ? { supported: true, support: lever, severity: 'info' }
      : { supported: false, support: null, severity: 'violation' };
  }

  if (claim.claim_type === 'authority') {
    const commit = before.find(
      (t) => t.tool === 'commit_booking' && (t.result as { ok?: boolean }).ok === true,
    );
    return commit
      ? { supported: true, support: commit, severity: 'info' }
      : { supported: false, support: null, severity: 'violation' };
  }

  // availability (non-competitor) and deadline claims have no tool basis.
  return { supported: false, support: null, severity: 'violation' };
}

export async function runPostCallValidator(callId: string): Promise<ValidatorFindingRow[]> {
  const supabase = supabaseAdmin();
  const { data: session, error } = await supabase
    .from('call_sessions')
    .select('id, job_spec_id, transcript, tool_calls')
    .eq('id', callId)
    .single();
  if (error || !session) throw new Error('Call not found');

  const { data: spec } = await supabase
    .from('job_specs')
    .select('vertical_slug, spec')
    .eq('id', session.job_spec_id)
    .single();
  if (!spec) throw new Error('Spec not found');

  const vertical = getVertical(spec.vertical_slug);
  const brief = specBriefLines(vertical, (spec.spec as { fields: Record<string, unknown> }).fields);
  const transcript = session.transcript as TranscriptTurn[];
  const toolCalls = session.tool_calls as ToolCallRecord[];

  const transcriptText = transcript
    .map((t) => `[${t.turn_index}] ${t.role.toUpperCase()}: ${t.message}`)
    .join('\n');

  const response = await openai().responses.parse({
    model: MODELS.reasoning,
    instructions: VALIDATOR_SYSTEM,
    input: [
      {
        role: 'user',
        content: `CONFIRMED JOB BRIEF (buyer may state these facts freely):\n${brief.join('\n')}\n\nTRANSCRIPT:\n${transcriptText}`,
      },
    ],
    text: { format: zodTextFormat(ExtractionSchema, 'claim_extraction') },
  });
  const parsed = response.output_parsed;
  if (!parsed) throw new Error('Validator returned no parsed output');

  const findings: ValidatorFindingRow[] = parsed.claims.map((claim) => {
    const { supported, support, severity } = findSupport(claim, toolCalls);
    return {
      call_id: callId,
      claim_text: claim.claim_text,
      claim_type: claim.claim_type,
      transcript_ref: { call_id: callId, turn_index: claim.turn_index },
      supported_by_tool_call: supported,
      supporting_tool_call: support,
      severity,
    };
  });

  // Idempotent per call: replace previous findings.
  await supabase.from('validator_findings').delete().eq('call_id', callId);
  if (findings.length > 0) {
    const { error: insErr } = await supabase.from('validator_findings').insert(findings);
    if (insErr) throw new Error(`validator insert failed: ${insErr.message}`);
  }
  return findings;
}
