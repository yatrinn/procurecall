import { describe, expect, it } from 'vitest';
import { rankQuotes, type RankableQuote } from '@/core/ranking';

const NOW = new Date('2026-07-19T12:00:00Z');

function quote(partial: Partial<RankableQuote> & Pick<RankableQuote, 'quote_id' | 'supplier_name'>): RankableQuote {
  return {
    call_id: 'call-x',
    supplier_id: `sup-${partial.quote_id}`,
    status: 'confirmed',
    availability_status: 'confirmed',
    validity_until: null,
    is_benchmark_outlier: false,
    missing_information: [],
    guaranteed_net_cents: 80000,
    conditional_cents: 8000,
    refundable_deposit_cents: 0,
    tax_cents: 15200,
    cash_required_cents: 95200,
    expected_case_cents: 80000,
    worst_case_cents: 88000,
    total_before_negotiation_cents: 80000,
    total_after_negotiation_cents: 80000,
    line_count: 5,
    ...partial,
  };
}

describe('rankQuotes', () => {
  it('ranks by expected case among clean eligible quotes', () => {
    const result = rankQuotes(
      [
        quote({ quote_id: 'a', supplier_name: 'A', expected_case_cents: 80500 }),
        quote({ quote_id: 'b', supplier_name: 'B', expected_case_cents: 82125 }),
        quote({ quote_id: 'c', supplier_name: 'C', expected_case_cents: 82000 }),
      ],
      { depositTolerance: 'up_to_500', now: NOW },
    );
    expect(result.recommended_quote_id).toBe('a');
    expect(result.entries.find((e) => e.quote_id === 'a')?.rank).toBe(1);
    expect(result.entries.find((e) => e.quote_id === 'c')?.rank).toBe(2);
    expect(result.entries.find((e) => e.quote_id === 'b')?.rank).toBe(3);
    expect(result.entries.find((e) => e.quote_id === 'a')?.reason_codes).toContain(
      'LOWEST_EXPECTED_TOTAL',
    );
  });

  it('a benchmark outlier is never auto-preferred, even when cheapest', () => {
    const result = rankQuotes(
      [
        quote({
          quote_id: 'cheap',
          supplier_name: 'Cheapo',
          expected_case_cents: 40000,
          is_benchmark_outlier: true,
        }),
        quote({ quote_id: 'solid', supplier_name: 'Solid', expected_case_cents: 80000 }),
      ],
      { depositTolerance: 'any', now: NOW },
    );
    expect(result.recommended_quote_id).toBe('solid');
    const cheap = result.entries.find((e) => e.quote_id === 'cheap');
    expect(cheap?.rank).toBe(2);
    expect(cheap?.reason_codes).toContain('BELOW_BENCHMARK_FLAG');
  });

  it('never recommends a below-benchmark quote even when every alternative is also demoted', () => {
    const result = rankQuotes(
      [
        quote({
          quote_id: 'outlier',
          supplier_name: 'Outlier',
          expected_case_cents: 50000,
          cash_required_cents: 59500,
          is_benchmark_outlier: true,
        }),
        quote({
          quote_id: 'conditional',
          supplier_name: 'Conditional',
          expected_case_cents: 58000,
          guaranteed_net_cents: 58000,
          conditional_cents: 15000,
          cash_required_cents: 69020,
        }),
      ],
      { depositTolerance: 'any', now: NOW },
    );
    expect(result.recommended_quote_id).toBe('conditional');
    expect(result.entries.find((e) => e.quote_id === 'conditional')?.rank).toBe(1);
    expect(result.entries.find((e) => e.quote_id === 'outlier')?.rank).toBe(2);
    expect(result.entries.find((e) => e.quote_id === 'outlier')?.reason_codes).toContain(
      'BELOW_BENCHMARK_FLAG',
    );
  });

  it('recommends nothing when every eligible quote is below the benchmark', () => {
    const result = rankQuotes(
      [
        quote({
          quote_id: 'a',
          supplier_name: 'A',
          expected_case_cents: 40000,
          is_benchmark_outlier: true,
        }),
        quote({
          quote_id: 'b',
          supplier_name: 'B',
          expected_case_cents: 45000,
          is_benchmark_outlier: true,
        }),
      ],
      { depositTolerance: 'any', now: NOW },
    );
    expect(result.recommended_quote_id).toBeNull();
    expect(result.entries.every((e) => e.rank !== null)).toBe(true);
  });

  it('hard constraint failures make a quote ineligible with explicit codes', () => {
    const result = rankQuotes(
      [
        quote({ quote_id: 'ok', supplier_name: 'OK' }),
        quote({ quote_id: 'draft', supplier_name: 'Draft', status: 'draft' }),
        quote({
          quote_id: 'noavail',
          supplier_name: 'NoAvail',
          availability_status: 'unconfirmed',
        }),
        quote({
          quote_id: 'expired',
          supplier_name: 'Expired',
          validity_until: '2026-07-01T00:00:00Z',
        }),
        quote({ quote_id: 'noev', supplier_name: 'NoEvidence', line_count: 0 }),
      ],
      { depositTolerance: 'any', now: NOW },
    );
    expect(result.recommended_quote_id).toBe('ok');
    expect(result.entries.find((e) => e.quote_id === 'draft')?.eligible).toBe(false);
    expect(result.entries.find((e) => e.quote_id === 'draft')?.reason_codes).toContain(
      'NOT_SUPPLIER_CONFIRMED',
    );
    expect(result.entries.find((e) => e.quote_id === 'noavail')?.reason_codes).toContain(
      'AVAILABILITY_NOT_CONFIRMED',
    );
    expect(result.entries.find((e) => e.quote_id === 'expired')?.reason_codes).toContain(
      'QUOTE_EXPIRED',
    );
    expect(result.entries.find((e) => e.quote_id === 'noev')?.reason_codes).toContain(
      'NO_TRANSCRIPT_EVIDENCE',
    );
  });

  it('deposit above the requester tolerance is a hard failure', () => {
    const result = rankQuotes(
      [
        quote({
          quote_id: 'bigdep',
          supplier_name: 'BigDeposit',
          refundable_deposit_cents: 60000,
          expected_case_cents: 70000,
        }),
        quote({ quote_id: 'ok', supplier_name: 'OK', expected_case_cents: 80000 }),
      ],
      { depositTolerance: 'up_to_500', now: NOW },
    );
    expect(result.recommended_quote_id).toBe('ok');
    expect(result.entries.find((e) => e.quote_id === 'bigdep')?.eligible).toBe(false);
    expect(result.entries.find((e) => e.quote_id === 'bigdep')?.reason_codes).toContain(
      'DEPOSIT_EXCEEDS_TOLERANCE',
    );
  });

  it('records negotiated improvements', () => {
    const result = rankQuotes(
      [
        quote({
          quote_id: 'neg',
          supplier_name: 'Negotiated',
          total_before_negotiation_cents: 89500,
          total_after_negotiation_cents: 80500,
        }),
      ],
      { depositTolerance: 'any', now: NOW },
    );
    const entry = result.entries[0];
    expect(entry.reason_codes).toContain('NEGOTIATED_IMPROVEMENT');
    expect(entry.negotiated_delta_cents).toBe(9000);
  });

  it('is stable and deterministic on ties', () => {
    const quotes = [
      quote({ quote_id: 'z', supplier_name: 'Zeta' }),
      quote({ quote_id: 'a', supplier_name: 'Alpha' }),
    ];
    const r1 = rankQuotes(quotes, { depositTolerance: 'any', now: NOW });
    const r2 = rankQuotes([...quotes].reverse(), { depositTolerance: 'any', now: NOW });
    expect(r1.recommended_quote_id).toBe('a');
    expect(r2.recommended_quote_id).toBe('a');
  });
});
