import { z } from 'zod';

/**
 * Deterministic price engine. No model involvement in arithmetic.
 *
 * All money is integer cents. A refundable deposit is tied-up capital, not a
 * cost. A conditional fee is not a guaranteed cost. An incomplete quote is
 * not a cheap quote — unpriced mandatory categories are surfaced as unknown.
 */

export const LineUnitSchema = z.enum(['flat', 'per_day', 'per_week', 'percent_of_rental']);
export type LineUnit = z.infer<typeof LineUnitSchema>;

export const LineCategorySchema = z.enum([
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
]);
export type LineCategory = z.infer<typeof LineCategorySchema>;

export interface PriceLine {
  label: string;
  category: LineCategory;
  /** Integer cents for money units; for percent_of_rental this is basis points (10% = 1000). */
  amount_cents: number;
  unit: LineUnit;
  is_mandatory: boolean;
  is_conditional: boolean;
  condition_trigger?: string | null;
}

export interface PriceContext {
  durationBusinessDays: number;
  vatRate: number;
  /** Benchmark median daily rate (net, cents) for the red-flag rule, if known. */
  benchmarkMedianDailyCents: number | null;
  /** Fraction of the benchmark median below which a quote is flagged (e.g. 0.7). */
  belowBenchmarkFraction: number;
  /** Deterministic expected-case triggers derived from the confirmed spec. */
  probableConditionCategories: LineCategory[];
  /** Categories the vertical treats as mandatory for a complete quote. */
  requiredCategories: LineCategory[];
}

export interface PriceBreakdown {
  guaranteed_net_cents: number;
  conditional_cents: number;
  refundable_deposit_cents: number;
  tax_cents: number;
  cash_required_cents: number;
  best_case_cents: number;
  expected_case_cents: number;
  worst_case_cents: number;
  normalized_rental_cents: number;
  rental_per_day_cents: number | null;
  unknown_categories: LineCategory[];
  is_benchmark_outlier: boolean;
  computation_notes: string[];
}

function normalizeToDuration(line: PriceLine, days: number, weeks: number): number {
  switch (line.unit) {
    case 'flat':
      return line.amount_cents;
    case 'per_day':
      return line.amount_cents * days;
    case 'per_week':
      return line.amount_cents * weeks;
    case 'percent_of_rental':
      throw new Error('percent_of_rental must be resolved against normalized rental');
  }
}

export function computePriceBreakdown(lines: PriceLine[], ctx: PriceContext): PriceBreakdown {
  const notes: string[] = [];
  const days = ctx.durationBusinessDays;
  const weeks = Math.ceil(days / 5);

  const rentalLines = lines.filter((l) => l.category === 'rental' && !l.is_conditional);
  const normalizedRental = rentalLines.reduce(
    (sum, l) => sum + normalizeToDuration(l, days, weeks),
    0,
  );
  if (rentalLines.length > 1) {
    notes.push(`Multiple rental lines (${rentalLines.length}) summed after normalization.`);
  }

  const resolveAmount = (l: PriceLine): number => {
    if (l.unit === 'percent_of_rental') {
      const abs = Math.round((normalizedRental * l.amount_cents) / 10_000);
      notes.push(
        `${l.label}: ${(l.amount_cents / 100).toFixed(2)}% of normalized rental resolved to ${abs} cents.`,
      );
      return abs;
    }
    // A conditional per-day fee (late return, overtime) is exposure per
    // triggered day, not a cost across the whole rental. It enters the
    // conditional bucket as ONE day of exposure, explicitly noted.
    if (l.is_conditional && l.unit === 'per_day') {
      notes.push(`${l.label}: conditional per-day fee counted as one day of exposure.`);
      return l.amount_cents;
    }
    return normalizeToDuration(l, days, weeks);
  };

  let guaranteed = normalizedRental;
  let conditional = 0;
  let probableConditional = 0;
  let deposit = 0;

  for (const line of lines) {
    if (line.category === 'rental' && !line.is_conditional) continue;
    const amount = resolveAmount(line);

    if (line.category === 'deposit') {
      deposit += amount;
      continue;
    }
    if (line.category === 'discount') {
      guaranteed -= Math.abs(amount);
      continue;
    }
    if (line.is_conditional) {
      conditional += amount;
      if (ctx.probableConditionCategories.includes(line.category)) {
        probableConditional += amount;
      }
      continue;
    }
    if (line.is_mandatory) {
      guaranteed += amount;
      continue;
    }
    // Optional, non-conditional extras the buyer chose count as guaranteed.
    guaranteed += amount;
  }

  // Discount sanity: evidence-backed costs can never sum below zero. If
  // discounts exceed the positive cost base, they are anomalous (mislogged or
  // withdrawn mid-call) — exclude them and say so, never emit a negative total.
  if (guaranteed < 0) {
    const discountTotal = lines
      .filter((l) => l.category === 'discount')
      .reduce((sum, l) => sum + Math.abs(resolveAmount(l)), 0);
    notes.push(
      `Discounts (${discountTotal} cents) exceed the cost base; they look mislogged or withdrawn and were NOT applied. Review the transcript.`,
    );
    guaranteed += discountTotal;
  }

  const tax = Math.round(guaranteed * ctx.vatRate);
  const presentCategories = new Set(lines.map((l) => l.category));
  const unknown = ctx.requiredCategories.filter((c) => !presentCategories.has(c));
  if (unknown.length > 0) {
    notes.push(
      `Unpriced categories: ${unknown.join(', ')}. An incomplete quote is not a cheap quote.`,
    );
  }

  const rentalPerDay = days > 0 && normalizedRental > 0 ? Math.round(normalizedRental / days) : null;
  const rentalOutlier =
    ctx.benchmarkMedianDailyCents !== null &&
    rentalPerDay !== null &&
    rentalPerDay < ctx.benchmarkMedianDailyCents * ctx.belowBenchmarkFraction;

  // Second, independent red-flag layer on the GUARANTEED TOTAL: the total for
  // the whole job includes transport and mandatory insurance on top of the
  // machine, so a guaranteed total below the flagged machine-only floor
  // (median day rate × days × fraction) is impossible in an honest quote.
  // This catches corrupted or lowballed totals even when the per-line rental
  // looks plausible — a magnitude slip (e.g. 79.50 instead of 795.00) can
  // never pass silently.
  const totalFloorCents =
    ctx.benchmarkMedianDailyCents !== null
      ? ctx.benchmarkMedianDailyCents * days * ctx.belowBenchmarkFraction
      : null;
  const totalOutlier =
    totalFloorCents !== null && guaranteed > 0 && guaranteed < totalFloorCents;

  const isOutlier = rentalOutlier || totalOutlier;
  if (rentalOutlier) {
    notes.push(
      'Normalized rate is far below the public benchmark median. In this market a price far below the field usually means something is missing. Flagged for review, never auto-preferred.',
    );
  }
  if (totalOutlier) {
    notes.push(
      `Guaranteed total (${guaranteed} cents) is below the machine-only benchmark floor for this job (${Math.round(totalFloorCents!)} cents = median day rate × ${days} days × ${Math.round(ctx.belowBenchmarkFraction * 100)}%). Either the quote is missing cost, or a figure is corrupted. Flagged for review, never auto-preferred.`,
    );
  }

  return {
    guaranteed_net_cents: guaranteed,
    conditional_cents: conditional,
    refundable_deposit_cents: deposit,
    tax_cents: tax,
    cash_required_cents: guaranteed + tax + deposit,
    best_case_cents: guaranteed,
    expected_case_cents: guaranteed + probableConditional,
    worst_case_cents: guaranteed + conditional,
    normalized_rental_cents: normalizedRental,
    rental_per_day_cents: rentalPerDay,
    unknown_categories: unknown,
    is_benchmark_outlier: isOutlier,
    computation_notes: notes,
  };
}

export function formatCents(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}
