import { z } from 'zod';

/**
 * Deterministic ranking. The model explains; it never chooses.
 *
 * Hard constraints eliminate; risk flags demote; among the remaining, the
 * order is a pure lexicographic sort on engine-computed totals. Every
 * decision emits a reason code that the UI and the explanation cite.
 */

export const RANKING_ENGINE_VERSION = 'rank-1.1';

export interface RankableQuote {
  quote_id: string;
  call_id: string;
  supplier_id: string;
  supplier_name: string;
  status: 'draft' | 'confirmed' | 'expired' | 'declined';
  availability_status: 'confirmed' | 'unconfirmed' | 'unavailable' | null;
  validity_until: string | null;
  is_benchmark_outlier: boolean;
  missing_information: string[];
  guaranteed_net_cents: number | null;
  conditional_cents: number | null;
  refundable_deposit_cents: number | null;
  tax_cents: number | null;
  cash_required_cents: number | null;
  expected_case_cents: number | null;
  worst_case_cents: number | null;
  total_before_negotiation_cents: number | null;
  total_after_negotiation_cents: number | null;
  line_count: number;
}

export const ReasonCode = z.enum([
  // hard constraint failures
  'NOT_SUPPLIER_CONFIRMED',
  'AVAILABILITY_NOT_CONFIRMED',
  'QUOTE_EXPIRED',
  'NO_TRANSCRIPT_EVIDENCE',
  'NO_ENGINE_TOTAL',
  'DEPOSIT_EXCEEDS_TOLERANCE',
  // risk flags (demote, never auto-prefer)
  'BELOW_BENCHMARK_FLAG',
  'UNPRICED_CATEGORIES',
  'HIGH_CONDITIONAL_EXPOSURE',
  // positive codes
  'LOWEST_EXPECTED_TOTAL',
  'COMPLETE_ITEMIZED_QUOTE',
  'AVAILABILITY_CONFIRMED',
  'SUPPLIER_CONFIRMED_TOTAL',
  'NEGOTIATED_IMPROVEMENT',
  'NO_DEPOSIT_REQUIRED',
  'LOWEST_CASH_REQUIRED',
]);
export type ReasonCodeT = z.infer<typeof ReasonCode>;

export interface RankedEntry {
  quote_id: string;
  supplier_id: string;
  supplier_name: string;
  rank: number | null; // null = ineligible
  eligible: boolean;
  demoted: boolean;
  reason_codes: ReasonCodeT[];
  negotiated_delta_cents: number | null;
}

export interface RankingResult {
  engine_version: string;
  entries: RankedEntry[];
  recommended_quote_id: string | null;
}

const DEPOSIT_TOLERANCE_CENTS: Record<string, number> = {
  none: 0,
  up_to_500: 50_000,
  up_to_1000: 100_000,
  any: Number.MAX_SAFE_INTEGER,
};

export function rankQuotes(
  quotes: RankableQuote[],
  ctx: { depositTolerance: string | null; now: Date },
): RankingResult {
  const entries: RankedEntry[] = quotes.map((q) => {
    const codes: ReasonCodeT[] = [];
    let eligible = true;

    // Hard constraints
    if (q.status !== 'confirmed') {
      codes.push('NOT_SUPPLIER_CONFIRMED');
      eligible = false;
    }
    if (q.availability_status !== 'confirmed') {
      codes.push('AVAILABILITY_NOT_CONFIRMED');
      eligible = false;
    }
    if (q.validity_until && new Date(q.validity_until).getTime() < ctx.now.getTime()) {
      codes.push('QUOTE_EXPIRED');
      eligible = false;
    }
    if (q.line_count === 0) {
      codes.push('NO_TRANSCRIPT_EVIDENCE');
      eligible = false;
    }
    if (q.expected_case_cents === null || q.guaranteed_net_cents === null) {
      codes.push('NO_ENGINE_TOTAL');
      eligible = false;
    }
    const tolerance =
      ctx.depositTolerance !== null
        ? (DEPOSIT_TOLERANCE_CENTS[ctx.depositTolerance] ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
    if ((q.refundable_deposit_cents ?? 0) > tolerance) {
      codes.push('DEPOSIT_EXCEEDS_TOLERANCE');
      eligible = false;
    }

    // Risk flags: demote below every clean quote, never auto-prefer.
    let demoted = false;
    if (q.is_benchmark_outlier) {
      codes.push('BELOW_BENCHMARK_FLAG');
      demoted = true;
    }
    if (q.missing_information.length > 0) {
      codes.push('UNPRICED_CATEGORIES');
      demoted = true;
    }
    if (
      q.guaranteed_net_cents !== null &&
      q.conditional_cents !== null &&
      q.guaranteed_net_cents > 0 &&
      q.conditional_cents > q.guaranteed_net_cents * 0.25
    ) {
      codes.push('HIGH_CONDITIONAL_EXPOSURE');
      demoted = true;
    }

    // Positive facts
    if (eligible) {
      codes.push('SUPPLIER_CONFIRMED_TOTAL', 'AVAILABILITY_CONFIRMED');
      if (q.missing_information.length === 0) codes.push('COMPLETE_ITEMIZED_QUOTE');
      if ((q.refundable_deposit_cents ?? 0) === 0) codes.push('NO_DEPOSIT_REQUIRED');
    }
    const delta =
      q.total_before_negotiation_cents !== null && q.total_after_negotiation_cents !== null
        ? q.total_before_negotiation_cents - q.total_after_negotiation_cents
        : null;
    if (delta !== null && delta > 0) codes.push('NEGOTIATED_IMPROVEMENT');

    return {
      quote_id: q.quote_id,
      supplier_id: q.supplier_id,
      supplier_name: q.supplier_name,
      rank: null,
      eligible,
      demoted,
      reason_codes: codes,
      negotiated_delta_cents: delta,
    };
  });

  // Deterministic order:
  //   0. clean eligibles
  //   1. demoted for other risk (conditional exposure, unpriced categories)
  //   2. below-benchmark outliers last — "flagged, never auto-preferred"
  // Within a tier: expected case, worst case, cash required, then name.
  const byId = new Map(quotes.map((q) => [q.quote_id, q]));
  const isBelowBenchmark = (e: RankedEntry) => e.reason_codes.includes('BELOW_BENCHMARK_FLAG');
  const tier = (e: RankedEntry): number => {
    if (!e.demoted) return 0;
    if (isBelowBenchmark(e)) return 2;
    return 1;
  };
  const sortKey = (e: RankedEntry): [number, number, number, string] => {
    const q = byId.get(e.quote_id)!;
    return [
      q.expected_case_cents ?? Number.MAX_SAFE_INTEGER,
      q.worst_case_cents ?? Number.MAX_SAFE_INTEGER,
      q.cash_required_cents ?? Number.MAX_SAFE_INTEGER,
      e.supplier_name,
    ];
  };
  const eligibles = entries
    .filter((e) => e.eligible)
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });

  eligibles.forEach((e, i) => {
    e.rank = i + 1;
  });

  // Never auto-prefer a below-benchmark quote. Recommend the best eligible that
  // is not an outlier; if every eligible is flagged below the field, recommend
  // nothing — the UI must say so in those words.
  const recommendable = eligibles.filter((e) => !isBelowBenchmark(e));
  const recommended = recommendable[0] ?? null;
  if (recommended) {
    const q0 = byId.get(recommended.quote_id)!;
    const lowestAmongRecommendable = recommendable.every(
      (e) =>
        (byId.get(e.quote_id)!.expected_case_cents ?? Infinity) >= (q0.expected_case_cents ?? Infinity),
    );
    if (lowestAmongRecommendable) recommended.reason_codes.push('LOWEST_EXPECTED_TOTAL');
    const lowestCash = recommendable.every(
      (e) => (byId.get(e.quote_id)!.cash_required_cents ?? Infinity) >= (q0.cash_required_cents ?? Infinity),
    );
    if (lowestCash) recommended.reason_codes.push('LOWEST_CASH_REQUIRED');
  }

  return {
    engine_version: RANKING_ENGINE_VERSION,
    entries,
    recommended_quote_id: recommended?.quote_id ?? null,
  };
}
