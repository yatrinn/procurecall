import { describe, expect, it } from 'vitest';
import { dedupeLines } from '@/core/quote-pricing';
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
