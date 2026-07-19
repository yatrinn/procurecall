import { describe, expect, it } from 'vitest';
import { explanationClaimsLowestWhileCheaperExists } from '@/core/explanation-guards';
import type { RankableQuote, RankingResult } from '@/core/ranking';

function q(
  partial: Partial<RankableQuote> & Pick<RankableQuote, 'quote_id' | 'supplier_name' | 'expected_case_cents'>,
): RankableQuote {
  return {
    call_id: 'c',
    supplier_id: `s-${partial.quote_id}`,
    status: 'confirmed',
    availability_status: 'confirmed',
    validity_until: null,
    is_benchmark_outlier: false,
    missing_information: [],
    guaranteed_net_cents: partial.expected_case_cents,
    conditional_cents: 0,
    refundable_deposit_cents: 0,
    tax_cents: 0,
    cash_required_cents: partial.expected_case_cents,
    worst_case_cents: partial.expected_case_cents,
    total_before_negotiation_cents: partial.expected_case_cents,
    total_after_negotiation_cents: partial.expected_case_cents,
    line_count: 4,
    ...partial,
  };
}

describe('explanationClaimsLowestWhileCheaperExists', () => {
  const quotes = [
    q({ quote_id: 'bw', supplier_name: 'BW Lift', expected_case_cents: 58000 }),
    q({
      quote_id: 'neckar',
      supplier_name: 'Neckar',
      expected_case_cents: 50000,
      is_benchmark_outlier: true,
    }),
  ];
  const ranking: RankingResult = {
    engine_version: 'rank-1.2',
    recommended_quote_id: 'bw',
    entries: [
      {
        quote_id: 'bw',
        supplier_id: 's-bw',
        supplier_name: 'BW Lift',
        rank: 1,
        eligible: true,
        demoted: true,
        reason_codes: ['PREFERRED_OVER_FLAGGED_CHEAPER'],
        negotiated_delta_cents: 3000,
      },
      {
        quote_id: 'neckar',
        supplier_id: 's-neckar',
        supplier_name: 'Neckar',
        rank: 2,
        eligible: true,
        demoted: true,
        reason_codes: ['BELOW_BENCHMARK_FLAG'],
        negotiated_delta_cents: 0,
      },
    ],
  };

  it('fails when the text claims lowest total while a cheaper ranked quote exists', () => {
    const bad =
      'BW Lift Rentals ranks first because it has the lowest expected total at 580.00 EUR net. Neckar is 80.00 EUR lower.';
    expect(explanationClaimsLowestWhileCheaperExists(bad, ranking, quotes)).toBe(true);
  });

  it('passes when the text states the cheaper quote is flagged and not preferred', () => {
    const good =
      'BW Lift is recommended at 580.00 EUR expected net. Neckar is cheaper at 500.00 EUR, but that quote sits far below the public market benchmark and is flagged — never auto-preferred.';
    expect(explanationClaimsLowestWhileCheaperExists(good, ranking, quotes)).toBe(false);
  });
});
