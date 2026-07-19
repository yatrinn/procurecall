import { describe, expect, it } from 'vitest';
import { computeQuoteTotals, dedupeLines } from '@/core/quote-pricing';
import { getVertical } from '@/config/verticals';
import type { QuoteLineArgs } from '@/negotiation/types';

function l(
  partial: Partial<QuoteLineArgs> &
    Pick<QuoteLineArgs, 'label' | 'category' | 'amount_cents' | 'unit'> & { turn_index: number },
): QuoteLineArgs & { turn_index: number } {
  return {
    is_mandatory: true,
    is_conditional: false,
    condition_trigger: null,
    ...partial,
  };
}

describe('dedupeLines', () => {
  it('later rental quote supersedes the earlier one even with a different label', () => {
    const lines = dedupeLines([
      l({ label: 'day rate', category: 'rental', amount_cents: 7900, unit: 'per_day', turn_index: 2 }),
      l({ label: '5-day rental package', category: 'rental', amount_cents: 37500, unit: 'flat', turn_index: 5 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount_cents).toBe(37500);
  });

  it('conditional and live singleton lines coexist (deposit vs conditional deposit)', () => {
    const lines = dedupeLines([
      l({ label: 'deposit', category: 'deposit', amount_cents: 50000, unit: 'flat', turn_index: 2, is_mandatory: false }),
      l({
        label: 'extra deposit for weekend',
        category: 'deposit',
        amount_cents: 10000,
        unit: 'flat',
        turn_index: 3,
        is_mandatory: false,
        is_conditional: true,
        condition_trigger: 'weekend extension',
      }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('distinct surcharges are kept; same-label surcharge is replaced by the latest', () => {
    const lines = dedupeLines([
      l({ label: 'early delivery', category: 'surcharge', amount_cents: 4500, unit: 'flat', turn_index: 2 }),
      l({ label: 'weekend surcharge', category: 'surcharge', amount_cents: 3000, unit: 'flat', turn_index: 3 }),
      l({ label: 'early delivery', category: 'surcharge', amount_cents: 4000, unit: 'flat', turn_index: 6 }),
    ]);
    expect(lines).toHaveLength(2);
    const early = lines.find((x) => x.label === 'early delivery');
    expect(early?.amount_cents).toBe(4000);
  });
});

describe('computeQuoteTotals — totals never aggregate or go negative', () => {
  const vertical = getVertical('equipment-rental-stuttgart');
  const fields = { duration_business_days: 5 };

  it('a full re-quote within one call supersedes; guaranteed never sums across versions', () => {
    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: [
        // initial quote
        l({ label: 'rental', category: 'rental', amount_cents: 60000, unit: 'flat', turn_index: 2 }),
        l({ label: 'delivery', category: 'delivery', amount_cents: 9000, unit: 'flat', turn_index: 2 }),
        l({ label: 'pickup', category: 'pickup', amount_cents: 9000, unit: 'flat', turn_index: 2 }),
        l({ label: 'liability', category: 'insurance', amount_cents: 7000, unit: 'flat', turn_index: 2 }),
        // re-quote after negotiation (same call, later turns)
        l({ label: 'rental (renegotiated)', category: 'rental', amount_cents: 55000, unit: 'flat', turn_index: 8 }),
        l({ label: 'delivery (renegotiated)', category: 'delivery', amount_cents: 9000, unit: 'flat', turn_index: 8 }),
        l({ label: 'pickup (renegotiated)', category: 'pickup', amount_cents: 0, unit: 'flat', turn_index: 8 }),
        l({ label: 'liability (renegotiated)', category: 'insurance', amount_cents: 7000, unit: 'flat', turn_index: 8 }),
      ],
      concessions: [],
      modelClaimedTotalCents: 71000,
    });
    // 55000 + 9000 + 0 + 7000 — never 60000+55000 or any cross-version sum.
    expect(totals.totalAfterCents).toBe(71000);
    expect(totals.engineDisagreesWithModel).toBe(false);
  });

  it('a concession already reflected in the line state is not subtracted again', () => {
    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: [
        l({ label: 'rental', category: 'rental', amount_cents: 60000, unit: 'flat', turn_index: 2 }),
        // pickup was waived and RE-LOGGED at zero:
        l({ label: 'pickup', category: 'pickup', amount_cents: 0, unit: 'flat', turn_index: 9 }),
      ],
      concessions: [
        { category_hint: 'pickup waived', amount_before_cents: 9000, amount_after_cents: 0 },
      ],
      modelClaimedTotalCents: 60000,
    });
    expect(totals.totalAfterCents).toBe(60000);
  });

  it('REGRESSION (the 625 bug): waivers logged as discount lines are never subtracted twice', () => {
    // The real Hebetec call: 895 opening → waive early 45 → 850 → waive pickup 90
    // → 760 confirmed. The buyer logged the waivers as DISCOUNT lines AND the
    // concession events carried the same deltas. Expected: 760, never 625.
    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: [
        l({ label: 'five business day rental', category: 'rental', amount_cents: 60000, unit: 'flat', turn_index: 3 }),
        l({ label: 'delivery', category: 'delivery', amount_cents: 9000, unit: 'flat', turn_index: 3 }),
        l({ label: 'pickup', category: 'pickup', amount_cents: 9000, unit: 'flat', turn_index: 3 }),
        l({ label: 'mandatory liability reduction', category: 'insurance', amount_cents: 7000, unit: 'flat', turn_index: 3 }),
        l({ label: 'early-delivery surcharge before 07:00', category: 'surcharge', amount_cents: 4500, unit: 'flat', turn_index: 3 }),
        l({ label: 'conditional cleaning fee if returned dirty', category: 'cleaning', amount_cents: 8000, unit: 'flat', turn_index: 5, is_mandatory: false, is_conditional: true }),
        l({ label: 'pickup fee waived', category: 'discount', amount_cents: 9000, unit: 'flat', turn_index: 9, is_mandatory: false }),
        l({ label: 'early-delivery surcharge waived', category: 'discount', amount_cents: 4500, unit: 'flat', turn_index: 9, is_mandatory: false }),
      ],
      concessions: [
        { category_hint: 'early-delivery surcharge waived', amount_before_cents: 4500, amount_after_cents: 0 },
        { category_hint: 'pickup fee waived', amount_before_cents: 9000, amount_after_cents: 0 },
      ],
      modelClaimedTotalCents: 76000,
    });
    expect(totals.totalAfterCents).toBe(76000);
    expect(totals.totalBeforeCents).toBe(89500);
    expect(totals.engineDisagreesWithModel).toBe(false);
  });

  it('the golden-run shape (event only, line state pre-concession) still applies once', () => {
    // 895 line state, pickup waiver exists only as an event → after 805, was 895.
    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: [
        l({ label: 'rental', category: 'rental', amount_cents: 60000, unit: 'flat', turn_index: 2 }),
        l({ label: 'delivery', category: 'delivery', amount_cents: 9000, unit: 'flat', turn_index: 2 }),
        l({ label: 'pickup', category: 'pickup', amount_cents: 9000, unit: 'flat', turn_index: 2 }),
        l({ label: 'liability', category: 'insurance', amount_cents: 7000, unit: 'flat', turn_index: 2 }),
        l({ label: 'early surcharge', category: 'surcharge', amount_cents: 4500, unit: 'flat', turn_index: 2 }),
      ],
      concessions: [
        { category_hint: 'pickup fee waived', amount_before_cents: 9000, amount_after_cents: 0 },
      ],
      modelClaimedTotalCents: 80500,
    });
    expect(totals.totalAfterCents).toBe(80500);
    expect(totals.totalBeforeCents).toBe(89500);
  });

  it("REGRESSION (the 79.50 report): Neckar's confirmed lines total exactly 795.00", () => {
    // The real call: 540 rental → rate_reduced to 515 (event), plus 110
    // delivery, 110 pickup, 60 liability; 300 deposit separate.
    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: [
        l({ label: '5 business day rental', category: 'rental', amount_cents: 54000, unit: 'flat', turn_index: 4 }),
        l({ label: 'delivery', category: 'delivery', amount_cents: 11000, unit: 'flat', turn_index: 4 }),
        l({ label: 'pickup', category: 'pickup', amount_cents: 11000, unit: 'flat', turn_index: 4 }),
        l({ label: 'mandatory liability reduction', category: 'insurance', amount_cents: 6000, unit: 'flat', turn_index: 4 }),
        l({ label: 'deposit', category: 'deposit', amount_cents: 30000, unit: 'flat', turn_index: 5, is_mandatory: false }),
        l({ label: 'late return day rate', category: 'late_fee', amount_cents: 11800, unit: 'per_day', turn_index: 8, is_mandatory: false, is_conditional: true }),
      ],
      concessions: [
        { category_hint: 'rental reduced after competitive comparison', amount_before_cents: 54000, amount_after_cents: 51500 },
      ],
      modelClaimedTotalCents: 79500,
    });
    expect(totals.totalAfterCents).toBe(79500); // 795.00 EUR — never 7950
    expect(totals.totalBeforeCents).toBe(82000);
    expect(totals.breakdown.refundable_deposit_cents).toBe(30000);
    expect(totals.engineDisagreesWithModel).toBe(false);
    expect(totals.breakdown.is_benchmark_outlier).toBe(false);
  });

  it('PROPERTY: recomputing from persisted lines never shifts a total by a power of ten', () => {
    // Pseudo-random quote generator (seeded, deterministic).
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i++) {
      const rentalCents = Math.round((30000 + rand() * 90000) / 100) * 100;
      const lines = [
        l({ label: 'rental', category: 'rental', amount_cents: rentalCents, unit: 'flat', turn_index: 2 }),
        l({ label: 'delivery', category: 'delivery', amount_cents: Math.round(rand() * 20000), unit: 'flat', turn_index: 2 }),
        l({ label: 'pickup', category: 'pickup', amount_cents: Math.round(rand() * 20000), unit: 'flat', turn_index: 2 }),
        l({ label: 'liability', category: 'insurance', amount_cents: Math.round(rand() * 10000), unit: 'flat', turn_index: 2 }),
      ];
      const expectedSum = lines.reduce((s2, x) => s2 + x.amount_cents, 0);
      const concessionDelta = rand() > 0.5 ? Math.round((rand() * rentalCents) / 4) : 0;
      const concessions =
        concessionDelta > 0
          ? [{ category_hint: 'rental discount', amount_before_cents: rentalCents, amount_after_cents: rentalCents - concessionDelta }]
          : [];
      const first = computeQuoteTotals({ vertical, fields, lines, concessions, modelClaimedTotalCents: null });
      // recompute from the same persisted state (what repair scripts do)
      const second = computeQuoteTotals({ vertical, fields, lines, concessions, modelClaimedTotalCents: first.totalAfterCents });
      expect(second.totalAfterCents).toBe(first.totalAfterCents); // idempotent
      const ratio = first.totalAfterCents / (expectedSum - concessionDelta);
      expect(Math.abs(Math.log10(ratio))).toBeLessThan(0.05); // no magnitude drift
    }
  });

  it('an absurd discount cannot drive the guaranteed total negative', () => {
    const totals = computeQuoteTotals({
      vertical,
      fields,
      lines: [
        l({ label: 'rental', category: 'rental', amount_cents: 187500, unit: 'flat', turn_index: 2 }),
        l({ label: 'phantom discount', category: 'discount', amount_cents: 500000, unit: 'flat', turn_index: 7, is_mandatory: false }),
      ],
      concessions: [],
      modelClaimedTotalCents: 187500,
    });
    expect(totals.totalAfterCents).toBeGreaterThanOrEqual(0);
    expect(totals.breakdown.computation_notes.join(' ')).toContain('NOT applied');
  });
});
