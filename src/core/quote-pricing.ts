import 'server-only';
import { computePriceBreakdown, type LineCategory, type PriceLine } from '@/core/price-engine';
import type { VerticalConfig } from '@/config/vertical-schema';
import type { SpecFields } from '@/core/jobspec';
import type { QuoteLineArgs } from '@/negotiation/types';

/**
 * Deterministic bridge from a call's logged lines + negotiation events to the
 * persisted price breakdown. Totals come from the engine, never from the
 * model's own arithmetic; the model's claimed total is cross-checked and any
 * mismatch is recorded as a note.
 */

export interface ConcessionDelta {
  category_hint: string | null;
  amount_before_cents: number | null;
  amount_after_cents: number | null;
}

export function pricingContextFor(vertical: VerticalConfig, fields: SpecFields) {
  const duration = Number(fields.duration_business_days ?? fields.duration_days ?? 1);
  const probable: LineCategory[] = [];
  if (fields.charging_or_fuel === 'diesel_refuel_needed') probable.push('fuel');
  return {
    durationBusinessDays: Number.isFinite(duration) && duration > 0 ? duration : 1,
    vatRate: vertical.vatRate,
    benchmarkMedianDailyCents: vertical.benchmark.medianDailyRateNet
      ? Math.round(vertical.benchmark.medianDailyRateNet * 100)
      : null,
    belowBenchmarkFraction: vertical.redFlagRules.belowBenchmarkMedianFraction,
    probableConditionCategories: probable,
    requiredCategories: vertical.quoteCategories
      .filter((c) => c.typicallyMandatory)
      .map((c) => c.id as LineCategory),
  };
}

/**
 * Deduplication rules, deterministic:
 * - Singleton categories (rental, delivery, pickup, insurance, deposit): a call
 *   has exactly one live value; the LATEST logged line supersedes earlier ones
 *   (re-quotes replace, they never double-count).
 * - Multi categories (surcharge, accessory, discount, conditionals): distinct
 *   labels are distinct lines; the latest logging of the same label wins.
 */
const SINGLETON_CATEGORIES: ReadonlySet<string> = new Set([
  'rental',
  'delivery',
  'pickup',
  'insurance',
  'deposit',
]);

export function dedupeLines(lines: Array<QuoteLineArgs & { turn_index: number }>): PriceLine[] {
  const byKey = new Map<string, QuoteLineArgs & { turn_index: number }>();
  for (const l of lines) {
    const key = SINGLETON_CATEGORIES.has(l.category)
      ? `${l.category}::${l.is_conditional ? 'conditional' : 'live'}`
      : `${l.category}::${l.label.trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || l.turn_index >= existing.turn_index) byKey.set(key, l);
  }
  return Array.from(byKey.values()).map((l) => ({
    label: l.label,
    category: l.category,
    amount_cents: l.amount_cents,
    unit: l.unit,
    is_mandatory: l.is_mandatory,
    is_conditional: l.is_conditional,
    condition_trigger: l.condition_trigger,
  }));
}

export function computeQuoteTotals(input: {
  vertical: VerticalConfig;
  fields: SpecFields;
  lines: Array<QuoteLineArgs & { turn_index: number }>;
  concessions: ConcessionDelta[];
  modelClaimedTotalCents: number | null;
}) {
  const ctx = pricingContextFor(input.vertical, input.fields);
  const priceLines = dedupeLines(input.lines);
  const before = computePriceBreakdown(priceLines, ctx);

  // Concession deltas (verified negotiation events) applied to the before-state.
  const concessionTotal = input.concessions.reduce((sum, c) => {
    if (c.amount_before_cents === null || c.amount_after_cents === null) return sum;
    return sum + (c.amount_before_cents - c.amount_after_cents);
  }, 0);

  const afterGuaranteed = before.guaranteed_net_cents - concessionTotal;
  const notes = [...before.computation_notes];
  if (
    input.modelClaimedTotalCents !== null &&
    input.modelClaimedTotalCents !== afterGuaranteed
  ) {
    notes.push(
      `Supplier-stated total (${input.modelClaimedTotalCents} cents) differs from the engine total (${afterGuaranteed} cents). Engine total is authoritative; review the transcript.`,
    );
  }

  const after = {
    ...before,
    guaranteed_net_cents: afterGuaranteed,
    tax_cents: Math.round(afterGuaranteed * ctx.vatRate),
    cash_required_cents:
      afterGuaranteed + Math.round(afterGuaranteed * ctx.vatRate) + before.refundable_deposit_cents,
    best_case_cents: afterGuaranteed,
    expected_case_cents: before.expected_case_cents - concessionTotal,
    worst_case_cents: before.worst_case_cents - concessionTotal,
    computation_notes: notes,
  };

  return {
    totalBeforeCents: before.guaranteed_net_cents,
    totalAfterCents: afterGuaranteed,
    breakdown: after,
    breakdownBefore: before,
    engineDisagreesWithModel:
      input.modelClaimedTotalCents !== null && input.modelClaimedTotalCents !== afterGuaranteed,
  };
}
