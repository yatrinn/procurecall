// Pure pricing logic — no secrets, safe anywhere (tests, scripts, server).
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
// Categories that describe exactly one real-world fee per job: restating it
// with slightly different wording across turns ("Other" -> "other mandatory
// charge" -> "other mandatory package charge") must collapse to the LATEST
// value, never sum. Only categories where a job can legitimately carry
// several distinctly-named items (accessory, surcharge, discount) stay
// label-keyed. Found via the founder's golden voice run: Neckar's single
// restated "other" fee (100 EUR, mentioned at turns 7 and 9 with different
// wording) was double-counted to 200 EUR, inflating the guaranteed total by
// exactly the missing 100 EUR and permanently blocking confirmation because
// it no longer matched the supplier's read-back total.
const SINGLETON_CATEGORIES: ReadonlySet<string> = new Set([
  'rental',
  'delivery',
  'pickup',
  'insurance',
  'deposit',
  'cleaning',
  'fuel',
  'late_fee',
  'damage_waiver',
  'overtime',
  'other',
]);

/** Categories that are often the same package component restated under a new name. */
const PACKAGE_COMPONENT_CATEGORIES: ReadonlySet<string> = new Set([
  'other',
  'surcharge',
  'accessory',
]);

export function collapseActiveQuoteLines(
  lines: Array<QuoteLineArgs & { turn_index: number }>,
): Array<QuoteLineArgs & { turn_index: number }> {
  const byKey = new Map<string, QuoteLineArgs & { turn_index: number }>();
  for (const l of lines) {
    const key = SINGLETON_CATEGORIES.has(l.category)
      ? `${l.category}::${l.is_conditional ? 'conditional' : 'live'}`
      : `${l.category}::${l.label.trim().toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || l.turn_index >= existing.turn_index) byKey.set(key, l);
  }
  let collapsed = Array.from(byKey.values());

  // Cross-category package restatement: the same 10 EUR logged once as
  // "package split component" (surcharge) and again as "other mandatory
  // package charge" (other) must collapse to the latest turn. Matching on
  // label alone cannot catch this — categories differ, amounts match.
  const packageByAmount = new Map<string, number[]>();
  collapsed.forEach((l, i) => {
    if (!PACKAGE_COMPONENT_CATEGORIES.has(l.category)) return;
    if (l.is_conditional) return;
    const key = `${l.amount_cents}::live`;
    const positions = packageByAmount.get(key) ?? [];
    positions.push(i);
    packageByAmount.set(key, positions);
  });
  const dropPackage = new Set<number>();
  for (const positions of packageByAmount.values()) {
    if (positions.length < 2) continue;
    const categories = new Set(positions.map((p) => collapsed[p].category));
    if (categories.size < 2) continue; // same-category already handled by singleton
    const latestPos = positions.reduce((a, b) =>
      collapsed[b].turn_index >= collapsed[a].turn_index ? b : a,
    );
    for (const p of positions) if (p !== latestPos) dropPackage.add(p);
  }
  collapsed = collapsed.filter((_, i) => !dropPackage.has(i));

  // Second pass, 'discount' only: the buyer's habit of reading the whole
  // deal back on every turn ("closing at 570, that's a 30 discount" ...
  // then again two turns later with new wording) produces several discount
  // LABELS for the one concession that was actually granted once. Two
  // distinctly-labeled discounts of the identical amount within a call are
  // overwhelmingly a restatement, not two separate concessions — collapse
  // to the latest. (Found via the founder's golden BW Lift call: "conclusion
  // discount" -30 and "all-in package discount" -30 summed to -60 for a
  // single 600->570 concession, which drove the engine below the confirmed
  // 570 and blocked confirmation. Distinct discount AMOUNTS still coexist.)
  const discountByAmount = new Map<string, number[]>();
  collapsed.forEach((l, i) => {
    if (l.category !== 'discount') return;
    const key = `${l.amount_cents}::${l.is_conditional ? 'conditional' : 'live'}`;
    const positions = discountByAmount.get(key) ?? [];
    positions.push(i);
    discountByAmount.set(key, positions);
  });
  const dropIndexes = new Set<number>();
  for (const positions of discountByAmount.values()) {
    if (positions.length < 2) continue;
    const latestPos = positions.reduce((a, b) =>
      collapsed[b].turn_index >= collapsed[a].turn_index ? b : a,
    );
    for (const p of positions) if (p !== latestPos) dropIndexes.add(p);
  }
  collapsed = collapsed.filter((_, i) => !dropIndexes.has(i));
  return collapsed;
}

export function dedupeLines(lines: Array<QuoteLineArgs & { turn_index: number }>): PriceLine[] {
  return collapseActiveQuoteLines(lines).map((l) => ({
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
  const lineState = computePriceBreakdown(priceLines, ctx);

  // INVARIANT: a concession is counted against the money exactly ONCE.
  // The same concession can be represented two ways:
  //   (1) inside the line state — as a discount line or a re-logged line —
  //       in which case the engine sum over lines ALREADY reflects it;
  //   (2) only as a negotiation event, in which case (and only then) its
  //       delta is subtracted on top of the line state.
  // Consolidation: an event whose delta matches an unconsumed discount line
  // is representation (1) → display-only. An event whose pre-amount still
  // appears on a non-discount line is representation (2) → applied. Anything
  // else is unverifiable → ignored with a note. "was X" is reconstructed as
  // after + all recognized deltas, so the shown total never drifts below the
  // transcript evidence.
  const unconsumedDiscounts = priceLines
    .filter((l) => l.category === 'discount')
    .map((l) => Math.abs(l.amount_cents));
  const nonDiscountAmounts = priceLines
    .filter((l) => l.category !== 'discount')
    .map((l) => l.amount_cents);

  let appliedDeltas = 0;
  let recognizedDeltas = 0;
  for (const c of input.concessions) {
    if (c.amount_before_cents === null || c.amount_after_cents === null) continue;
    const delta = c.amount_before_cents - c.amount_after_cents;
    if (delta <= 0) continue;
    const discountIdx = unconsumedDiscounts.indexOf(delta);
    if (discountIdx !== -1) {
      // Already inside the line state as a discount line.
      unconsumedDiscounts.splice(discountIdx, 1);
      recognizedDeltas += delta;
      continue;
    }
    if (nonDiscountAmounts.includes(c.amount_before_cents)) {
      // Line state still shows the pre-concession amount → apply once.
      appliedDeltas += delta;
      recognizedDeltas += delta;
      continue;
    }
    lineState.computation_notes.push(
      `Concession "${c.category_hint ?? 'unnamed'}" (${c.amount_before_cents} → ${c.amount_after_cents}) matches neither a discount line nor a pre-concession line; NOT applied. Review the transcript.`,
    );
  }

  let afterGuaranteed = lineState.guaranteed_net_cents - appliedDeltas;
  if (afterGuaranteed < 0) {
    // Structural guard: a negative guaranteed total is impossible; fall back
    // to the evidence-backed line state and record the anomaly.
    lineState.computation_notes.push(
      `Concession arithmetic would drive the total below zero (${afterGuaranteed}); falling back to the line state. Review the negotiation events.`,
    );
    afterGuaranteed = lineState.guaranteed_net_cents;
  }
  // "was X": the pre-negotiation position is the final total plus every
  // recognized concession delta — reconstructed upward, never guessed.
  const beforeGuaranteed = afterGuaranteed + recognizedDeltas;

  const notes = [...lineState.computation_notes];
  if (
    input.modelClaimedTotalCents !== null &&
    input.modelClaimedTotalCents !== afterGuaranteed
  ) {
    notes.push(
      `Supplier-stated total (${input.modelClaimedTotalCents} cents) differs from the engine total (${afterGuaranteed} cents). Engine total is authoritative; review the transcript.`,
    );
  }

  const after = {
    ...lineState,
    guaranteed_net_cents: afterGuaranteed,
    tax_cents: Math.round(afterGuaranteed * ctx.vatRate),
    cash_required_cents:
      afterGuaranteed +
      Math.round(afterGuaranteed * ctx.vatRate) +
      lineState.refundable_deposit_cents,
    best_case_cents: afterGuaranteed,
    expected_case_cents: lineState.expected_case_cents - appliedDeltas,
    worst_case_cents: lineState.worst_case_cents - appliedDeltas,
    computation_notes: notes,
  };

  return {
    totalBeforeCents: beforeGuaranteed,
    totalAfterCents: afterGuaranteed,
    breakdown: after,
    breakdownBefore: lineState,
    engineDisagreesWithModel:
      input.modelClaimedTotalCents !== null && input.modelClaimedTotalCents !== afterGuaranteed,
  };
}
