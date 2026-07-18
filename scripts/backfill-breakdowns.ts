/**
 * Backfills price_breakdown on quotes created before the engine wiring.
 * Deterministic recomputation from persisted lines + negotiation events.
 * Run: pnpm tsx scripts/backfill-breakdowns.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { computePriceBreakdown, type LineCategory, type PriceLine } from '../src/core/price-engine';
import { getVertical } from '../src/config/verticals';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function main() {
  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('id, call_id, job_spec_id, total_after_negotiation_cents, price_breakdown')
    .is('price_breakdown', null);
  if (error) throw error;
  console.log(`quotes to backfill: ${quotes?.length ?? 0}`);

  for (const quote of quotes ?? []) {
    const [{ data: lines }, { data: spec }, { data: events }] = await Promise.all([
      supabase
        .from('quote_lines')
        .select('label, amount_cents, unit, is_mandatory, is_conditional, condition_trigger, category, transcript_ref')
        .eq('quote_id', quote.id),
      supabase.from('job_specs').select('vertical_slug, spec').eq('id', quote.job_spec_id).single(),
      supabase
        .from('negotiation_events')
        .select('event_type, amount_before_cents, amount_after_cents')
        .eq('call_id', quote.call_id)
        .in('event_type', ['concession', 'fee_waived', 'fee_reduced', 'rate_reduced']),
    ]);
    if (!spec || !lines) continue;
    const vertical = getVertical(spec.vertical_slug);
    const fields = (spec.spec as { fields: Record<string, unknown> }).fields;
    const duration = Number(fields.duration_business_days ?? 1);

    // Dedupe: singleton categories keep the line from the LATEST turn.
    const singleton = new Set(['rental', 'delivery', 'pickup', 'insurance', 'deposit']);
    const byKey = new Map<string, (typeof lines)[number]>();
    for (const l of lines) {
      const turn = (l.transcript_ref as { turn_index?: number })?.turn_index ?? 0;
      const key = singleton.has(l.category)
        ? `${l.category}::${l.is_conditional ? 'c' : 'l'}`
        : `${l.category}::${l.label.trim().toLowerCase()}`;
      const prev = byKey.get(key);
      const prevTurn = prev ? ((prev.transcript_ref as { turn_index?: number })?.turn_index ?? 0) : -1;
      if (!prev || turn >= prevTurn) byKey.set(key, l);
    }
    const priceLines: PriceLine[] = Array.from(byKey.values())
      // Historical data glitches: drop pseudo-lines (grand totals in 'other', VAT lines, validity)
      .filter((l) => !(l.category === 'other' && (l.amount_cents ?? 0) > 20000))
      .filter((l) => !/vat|validity/i.test(l.label))
      .map((l) => ({
        label: l.label,
        category: l.category as LineCategory,
        amount_cents: l.amount_cents ?? 0,
        unit: (l.unit ?? 'flat') as PriceLine['unit'],
        is_mandatory: l.is_mandatory,
        is_conditional: l.is_conditional,
        condition_trigger: l.condition_trigger,
      }));

    const before = computePriceBreakdown(priceLines, {
      durationBusinessDays: Number.isFinite(duration) && duration > 0 ? duration : 1,
      vatRate: vertical.vatRate,
      benchmarkMedianDailyCents: vertical.benchmark.medianDailyRateNet
        ? Math.round(vertical.benchmark.medianDailyRateNet * 100)
        : null,
      belowBenchmarkFraction: vertical.redFlagRules.belowBenchmarkMedianFraction,
      probableConditionCategories: [],
      requiredCategories: vertical.quoteCategories
        .filter((c) => c.typicallyMandatory)
        .map((c) => c.id as LineCategory),
    });

    const concession = (events ?? []).reduce((sum, e) => {
      if (e.amount_before_cents === null || e.amount_after_cents === null) return sum;
      return sum + (e.amount_before_cents - e.amount_after_cents);
    }, 0);
    const afterGuaranteed = before.guaranteed_net_cents - concession;
    const after = {
      ...before,
      guaranteed_net_cents: afterGuaranteed,
      tax_cents: Math.round(afterGuaranteed * vertical.vatRate),
      cash_required_cents:
        afterGuaranteed + Math.round(afterGuaranteed * vertical.vatRate) + before.refundable_deposit_cents,
      best_case_cents: afterGuaranteed,
      expected_case_cents: before.expected_case_cents - concession,
      worst_case_cents: before.worst_case_cents - concession,
    };

    const { error: upErr } = await supabase
      .from('quotes')
      .update({
        price_breakdown: after,
        total_before_negotiation_cents: before.guaranteed_net_cents,
        total_after_negotiation_cents: afterGuaranteed,
        is_benchmark_outlier: after.is_benchmark_outlier,
        missing_information: after.unknown_categories,
        vat_rate: vertical.vatRate,
      })
      .eq('id', quote.id);
    if (upErr) throw upErr;
    console.log(
      `backfilled ${quote.id}: before ${before.guaranteed_net_cents} after ${afterGuaranteed} (model said ${quote.total_after_negotiation_cents})`,
    );
  }
  console.log('done');
}

void main();
