/**
 * One-shot repair after the double-concession fix:
 * 1. purge the zero-turn BW voice call (fabricated-looking pins, no evidence)
 * 2. recompute every quote's totals from its persisted lines + events using
 *    the fixed computeQuoteTotals, and set status per the confirmation rules
 * Run: pnpm tsx scripts/repair-quotes.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { computeQuoteTotals } from '../src/core/quote-pricing';
import { getVertical } from '../src/config/verticals';
import type { QuoteLineArgs } from '../src/negotiation/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function purgeZeroTurnCalls() {
  const { data: sessions } = await supabase
    .from('call_sessions')
    .select('id, transcript, status, tier')
    .eq('tier', 'voice');
  const dead = (sessions ?? []).filter(
    (s) => (s.transcript as unknown[]).length === 0 && s.status !== 'in_progress' && s.status !== 'pending',
  );
  for (const s of dead) {
    await supabase.from('validator_findings').delete().eq('call_id', s.id);
    await supabase.from('negotiation_events').delete().eq('call_id', s.id);
    await supabase.from('quote_lines').delete().eq('call_id', s.id);
    await supabase.from('quotes').delete().eq('call_id', s.id);
    await supabase.from('call_sessions').delete().eq('id', s.id);
    console.log('purged zero-turn voice call', s.id);
  }
}

async function recomputeQuotes() {
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, call_id, job_spec_id, status, total_after_negotiation_cents');
  for (const quote of quotes ?? []) {
    const [{ data: lines }, { data: spec }, { data: events }, { data: session }] =
      await Promise.all([
        supabase
          .from('quote_lines')
          .select('label, amount_cents, unit, is_mandatory, is_conditional, condition_trigger, category, transcript_ref')
          .eq('quote_id', quote.id),
        supabase.from('job_specs').select('vertical_slug, spec').eq('id', quote.job_spec_id).single(),
        supabase
          .from('negotiation_events')
          .select('event_type, concession_type, amount_before_cents, amount_after_cents')
          .eq('call_id', quote.call_id)
          .in('event_type', ['concession', 'fee_waived', 'fee_reduced', 'rate_reduced']),
        supabase.from('call_sessions').select('outcome').eq('id', quote.call_id).single(),
      ]);
    if (!spec || !lines || lines.length === 0) continue;
    const vertical = getVertical(spec.vertical_slug);
    const fields = (spec.spec as { fields: Record<string, unknown> }).fields;
    const outcome = session?.outcome as {
      total_net_cents?: number | null;
      supplier_confirmed_total?: boolean | null;
      availability_confirmed?: boolean | null;
    } | null;

    const quoteLines: Array<QuoteLineArgs & { turn_index: number }> = lines.map((l) => ({
      label: l.label,
      category: l.category as QuoteLineArgs['category'],
      amount_cents: l.amount_cents ?? 0,
      unit: (l.unit ?? 'flat') as QuoteLineArgs['unit'],
      is_mandatory: l.is_mandatory,
      is_conditional: l.is_conditional,
      condition_trigger: l.condition_trigger,
      turn_index: (l.transcript_ref as { turn_index?: number })?.turn_index ?? 0,
    }));

    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: quoteLines,
      concessions: (events ?? []).map((e) => ({
        category_hint: e.concession_type,
        amount_before_cents: e.amount_before_cents,
        amount_after_cents: e.amount_after_cents,
      })),
      modelClaimedTotalCents: outcome?.total_net_cents ?? null,
    });

    const shouldConfirm =
      quote.status !== 'expired' &&
      outcome?.supplier_confirmed_total === true &&
      outcome?.availability_confirmed === true &&
      !totals.engineDisagreesWithModel;

    const newStatus = quote.status === 'expired' ? 'expired' : shouldConfirm ? 'confirmed' : quote.status === 'confirmed' && totals.engineDisagreesWithModel ? 'draft' : quote.status;

    await supabase
      .from('quotes')
      .update({
        total_before_negotiation_cents: totals.totalBeforeCents,
        total_after_negotiation_cents: totals.totalAfterCents,
        price_breakdown: totals.breakdown,
        is_benchmark_outlier: totals.breakdown.is_benchmark_outlier,
        missing_information: totals.breakdown.unknown_categories,
        status: newStatus,
      })
      .eq('id', quote.id);
    console.log(
      `quote ${quote.id.slice(0, 8)}: before ${totals.totalBeforeCents} after ${totals.totalAfterCents} (model ${outcome?.total_net_cents ?? 'n/a'}) status ${quote.status} → ${newStatus}`,
    );
  }
  // stale recommendations recompute on next decision-room load
  await supabase.from('recommendations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}

async function main() {
  await purgeZeroTurnCalls();
  await recomputeQuotes();
  console.log('repair done');
}

void main();
