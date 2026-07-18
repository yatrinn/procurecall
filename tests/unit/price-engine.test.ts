import { describe, expect, it } from 'vitest';
import { computePriceBreakdown, type PriceContext, type PriceLine } from '@/core/price-engine';

const baseCtx: PriceContext = {
  durationBusinessDays: 5,
  vatRate: 0.19,
  benchmarkMedianDailyCents: 9900,
  belowBenchmarkFraction: 0.7,
  probableConditionCategories: [],
  requiredCategories: ['rental', 'delivery', 'pickup', 'insurance'],
};

function line(partial: Partial<PriceLine> & Pick<PriceLine, 'label' | 'category' | 'amount_cents' | 'unit'>): PriceLine {
  return { is_mandatory: true, is_conditional: false, ...partial };
}

describe('computePriceBreakdown — supplier A shape (transparent premium)', () => {
  const lines: PriceLine[] = [
    line({ label: '5-day rental', category: 'rental', amount_cents: 60000, unit: 'flat' }),
    line({ label: 'delivery', category: 'delivery', amount_cents: 9000, unit: 'flat' }),
    line({ label: 'pickup', category: 'pickup', amount_cents: 9000, unit: 'flat' }),
    line({ label: 'liability reduction', category: 'insurance', amount_cents: 1400, unit: 'per_day' }),
    line({ label: 'early delivery surcharge', category: 'surcharge', amount_cents: 4500, unit: 'flat' }),
    line({
      label: 'cleaning if unusually dirty',
      category: 'cleaning',
      amount_cents: 8000,
      unit: 'flat',
      is_mandatory: false,
      is_conditional: true,
    }),
  ];

  it('computes guaranteed, conditional, tax, cash', () => {
    const b = computePriceBreakdown(lines, baseCtx);
    expect(b.guaranteed_net_cents).toBe(89500);
    expect(b.conditional_cents).toBe(8000);
    expect(b.refundable_deposit_cents).toBe(0);
    expect(b.tax_cents).toBe(Math.round(89500 * 0.19));
    expect(b.cash_required_cents).toBe(89500 + Math.round(89500 * 0.19));
    expect(b.best_case_cents).toBe(89500);
    expect(b.expected_case_cents).toBe(89500);
    expect(b.worst_case_cents).toBe(97500);
    expect(b.unknown_categories).toEqual([]);
    expect(b.is_benchmark_outlier).toBe(false);
  });

  it('a waived pickup (discount line) lowers guaranteed cost', () => {
    const withWaiver = [
      ...lines,
      line({ label: 'pickup waived', category: 'discount', amount_cents: 9000, unit: 'flat' }),
    ];
    const b = computePriceBreakdown(withWaiver, baseCtx);
    expect(b.guaranteed_net_cents).toBe(80500);
  });
});

describe('computePriceBreakdown — supplier B shape (low headline)', () => {
  const lines: PriceLine[] = [
    line({ label: 'day rate', category: 'rental', amount_cents: 7500, unit: 'per_day' }),
    line({ label: 'delivery', category: 'delivery', amount_cents: 16500, unit: 'flat' }),
    line({ label: 'pickup', category: 'pickup', amount_cents: 16500, unit: 'flat' }),
    line({ label: 'liability 15% of rental', category: 'insurance', amount_cents: 1500, unit: 'percent_of_rental' }),
    line({ label: 'early delivery', category: 'surcharge', amount_cents: 6000, unit: 'flat' }),
    line({ label: 'deposit', category: 'deposit', amount_cents: 50000, unit: 'flat', is_mandatory: false }),
    line({
      label: 'cleaning',
      category: 'cleaning',
      amount_cents: 12000,
      unit: 'flat',
      is_mandatory: false,
      is_conditional: true,
    }),
  ];

  it('normalizes per-day rates, resolves percent-of-rental, separates deposit', () => {
    const b = computePriceBreakdown(lines, baseCtx);
    // rental 5*7500=37500; insurance 15% of 37500 = 5625
    expect(b.normalized_rental_cents).toBe(37500);
    expect(b.guaranteed_net_cents).toBe(37500 + 16500 + 16500 + 5625 + 6000);
    expect(b.refundable_deposit_cents).toBe(50000);
    // deposit is cash impact, not cost
    expect(b.cash_required_cents).toBe(
      b.guaranteed_net_cents + b.tax_cents + 50000,
    );
    expect(b.worst_case_cents).toBe(b.guaranteed_net_cents + 12000);
  });

  it('cheap headline day rate alone is a benchmark outlier', () => {
    const headlineOnly = [
      line({ label: 'day rate', category: 'rental', amount_cents: 6500, unit: 'per_day' }),
    ];
    const b = computePriceBreakdown(headlineOnly, baseCtx);
    expect(b.rental_per_day_cents).toBe(6500);
    expect(b.is_benchmark_outlier).toBe(true);
    expect(b.unknown_categories).toEqual(['delivery', 'pickup', 'insurance']);
  });
});

describe('computePriceBreakdown — edge cases', () => {
  it('weekly rates normalize via ceil(days/5)', () => {
    const b = computePriceBreakdown(
      [line({ label: 'week rate', category: 'rental', amount_cents: 54000, unit: 'per_week' })],
      { ...baseCtx, durationBusinessDays: 7 },
    );
    expect(b.normalized_rental_cents).toBe(108000);
  });

  it('deterministically probable conditionals move the expected case', () => {
    const lines = [
      line({ label: 'rental', category: 'rental', amount_cents: 50000, unit: 'flat' }),
      line({
        label: 'refuel',
        category: 'fuel',
        amount_cents: 4500,
        unit: 'flat',
        is_mandatory: false,
        is_conditional: true,
      }),
    ];
    const b = computePriceBreakdown(lines, {
      ...baseCtx,
      probableConditionCategories: ['fuel'],
      requiredCategories: ['rental'],
    });
    expect(b.expected_case_cents).toBe(54500);
    expect(b.best_case_cents).toBe(50000);
  });

  it('unpriced mandatory categories are reported unknown, never guessed', () => {
    const b = computePriceBreakdown(
      [line({ label: 'rental', category: 'rental', amount_cents: 50000, unit: 'flat' })],
      baseCtx,
    );
    expect(b.unknown_categories).toEqual(['delivery', 'pickup', 'insurance']);
    expect(b.computation_notes.join(' ')).toContain('incomplete quote is not a cheap quote');
  });
});
