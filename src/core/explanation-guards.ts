import type { RankableQuote, RankingResult } from './ranking';

/**
 * Rejects an explanation that claims "lowest total" (or similar) while a
 * lower expected total exists in the ranked set.
 */
export function explanationClaimsLowestWhileCheaperExists(
  text: string,
  ranking: RankingResult,
  quotes: RankableQuote[],
): boolean {
  const recommended = ranking.entries.find((e) => e.quote_id === ranking.recommended_quote_id);
  if (!recommended) return false;
  const byId = new Map(quotes.map((q) => [q.quote_id, q]));
  const recTotal = byId.get(recommended.quote_id)?.expected_case_cents ?? null;
  if (recTotal === null) return false;
  const cheaperExists = ranking.entries.some((e) => {
    if (e.rank === null) return false;
    const t = byId.get(e.quote_id)?.expected_case_cents;
    return t !== null && t !== undefined && t < recTotal;
  });
  if (!cheaperExists) return false;
  return /\blowest\b.*\b(expected\s+)?total\b|\blowest expected total\b/i.test(text);
}
