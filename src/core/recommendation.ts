import 'server-only';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { openai, MODELS } from '@/integrations/openai-server';
import { rankQuotes, RANKING_ENGINE_VERSION, type RankableQuote, type RankingResult } from './ranking';
import { formatCents } from './price-engine';

/**
 * Computes and persists the deterministic recommendation for a spec. The
 * ranking is pure code; the model turns the finished ranking + reason codes
 * into two plain-language sentences and nothing else.
 *
 * Recomputed only when the underlying quote set changes (input hash).
 */

interface QuoteRow {
  id: string;
  call_id: string;
  supplier_id: string;
  status: 'draft' | 'confirmed' | 'expired' | 'declined';
  availability_status: 'confirmed' | 'unconfirmed' | 'unavailable' | null;
  validity_until: string | null;
  is_benchmark_outlier: boolean;
  missing_information: string[];
  total_before_negotiation_cents: number | null;
  total_after_negotiation_cents: number | null;
  currency: string;
  price_breakdown: {
    guaranteed_net_cents?: number;
    conditional_cents?: number;
    refundable_deposit_cents?: number;
    tax_cents?: number;
    cash_required_cents?: number;
    expected_case_cents?: number;
    worst_case_cents?: number;
  } | null;
}

export interface RecommendationRow {
  id: string;
  job_spec_id: string;
  computed_at: string;
  hard_constraint_results: unknown;
  normalized_costs: unknown;
  risk: unknown;
  evidence_coverage: unknown;
  ranking: RankingResult & { input_hash: string };
  explanation: string | null;
  engine_version: string;
}

export async function getOrComputeRecommendation(specId: string): Promise<RecommendationRow | null> {
  const supabase = supabaseAdmin();

  const [{ data: spec }, { data: quotes }, { data: suppliers }] = await Promise.all([
    supabase.from('job_specs').select('id, spec, vertical_slug').eq('id', specId).single(),
    supabase
      .from('quotes')
      .select(
        'id, call_id, supplier_id, status, availability_status, validity_until, is_benchmark_outlier, missing_information, total_before_negotiation_cents, total_after_negotiation_cents, currency, price_breakdown',
      )
      .eq('job_spec_id', specId),
    supabase.from('suppliers').select('id, name'),
  ]);
  if (!spec || !quotes || quotes.length === 0) return null;

  const lineCounts = new Map<string, number>();
  for (const q of quotes as QuoteRow[]) {
    const { count } = await supabase
      .from('quote_lines')
      .select('*', { count: 'exact', head: true })
      .eq('quote_id', q.id);
    lineCounts.set(q.id, count ?? 0);
  }

  const supplierName = (id: string) =>
    suppliers?.find((s) => s.id === id)?.name ?? 'Unknown supplier';

  const rankable: RankableQuote[] = (quotes as QuoteRow[]).map((q) => ({
    quote_id: q.id,
    call_id: q.call_id,
    supplier_id: q.supplier_id,
    supplier_name: supplierName(q.supplier_id),
    status: q.status,
    availability_status: q.availability_status,
    validity_until: q.validity_until,
    is_benchmark_outlier: q.is_benchmark_outlier,
    missing_information: q.missing_information ?? [],
    guaranteed_net_cents: q.price_breakdown?.guaranteed_net_cents ?? null,
    conditional_cents: q.price_breakdown?.conditional_cents ?? null,
    refundable_deposit_cents: q.price_breakdown?.refundable_deposit_cents ?? null,
    tax_cents: q.price_breakdown?.tax_cents ?? null,
    cash_required_cents: q.price_breakdown?.cash_required_cents ?? null,
    expected_case_cents: q.price_breakdown?.expected_case_cents ?? q.price_breakdown?.guaranteed_net_cents ?? null,
    worst_case_cents: q.price_breakdown?.worst_case_cents ?? null,
    total_before_negotiation_cents: q.total_before_negotiation_cents,
    total_after_negotiation_cents: q.total_after_negotiation_cents,
    line_count: lineCounts.get(q.id) ?? 0,
  }));

  const depositTolerance =
    ((spec.spec as { fields?: { deposit_tolerance?: string } }).fields?.deposit_tolerance as string | undefined) ?? null;

  const inputHash = createHash('sha256')
    .update(
      JSON.stringify(
        rankable
          .map((r) => [r.quote_id, r.status, r.expected_case_cents, r.total_after_negotiation_cents, r.line_count])
          .sort(),
      ),
    )
    .digest('hex');

  const { data: existing } = await supabase
    .from('recommendations')
    .select('*')
    .eq('job_spec_id', specId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && (existing.ranking as { input_hash?: string })?.input_hash === inputHash) {
    return existing as RecommendationRow;
  }

  const ranking = rankQuotes(rankable, { depositTolerance, now: new Date() });

  const currency = (quotes as QuoteRow[])[0]?.currency ?? 'EUR';
  const explanation = await writeExplanation(ranking, rankable, currency);

  const row = {
    job_spec_id: specId,
    hard_constraint_results: ranking.entries.map((e) => ({
      quote_id: e.quote_id,
      supplier: e.supplier_name,
      eligible: e.eligible,
      codes: e.reason_codes,
    })),
    normalized_costs: rankable.map((r) => ({
      quote_id: r.quote_id,
      supplier: r.supplier_name,
      guaranteed_net_cents: r.guaranteed_net_cents,
      conditional_cents: r.conditional_cents,
      refundable_deposit_cents: r.refundable_deposit_cents,
      tax_cents: r.tax_cents,
      cash_required_cents: r.cash_required_cents,
      expected_case_cents: r.expected_case_cents,
      worst_case_cents: r.worst_case_cents,
    })),
    risk: ranking.entries.map((e) => ({
      quote_id: e.quote_id,
      demoted: e.demoted,
      flags: e.reason_codes.filter((c) =>
        ['BELOW_BENCHMARK_FLAG', 'UNPRICED_CATEGORIES', 'HIGH_CONDITIONAL_EXPOSURE'].includes(c),
      ),
    })),
    evidence_coverage: rankable.map((r) => ({
      quote_id: r.quote_id,
      transcript_backed_lines: r.line_count,
    })),
    ranking: { ...ranking, input_hash: inputHash },
    explanation,
    engine_version: RANKING_ENGINE_VERSION,
  };

  const { data: inserted, error } = await supabase
    .from('recommendations')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new Error(`recommendation insert failed: ${error.message}`);
  return inserted as RecommendationRow;
}

async function writeExplanation(
  ranking: RankingResult,
  quotes: RankableQuote[],
  currency: string,
): Promise<string> {
  const recommended = ranking.entries.find((e) => e.quote_id === ranking.recommended_quote_id);
  if (!recommended) {
    return 'No quote passed the hard constraints. Review the reasons on each quote below; nothing is recommended.';
  }
  const byId = new Map(quotes.map((q) => [q.quote_id, q]));
  const facts = ranking.entries
    .filter((e) => e.rank !== null)
    .map((e) => {
      const q = byId.get(e.quote_id)!;
      return `rank ${e.rank}: ${e.supplier_name} — expected ${formatCents(q.expected_case_cents ?? 0, currency)} net, worst case ${formatCents(q.worst_case_cents ?? 0, currency)}, deposit ${formatCents(q.refundable_deposit_cents ?? 0, currency)}, codes: ${e.reason_codes.join(', ')}${e.negotiated_delta_cents ? `, negotiated down by ${formatCents(e.negotiated_delta_cents, currency)}` : ''}`;
    })
    .join('\n');

  try {
    const response = await openai().responses.create({
      model: MODELS.fast,
      instructions:
        'You write the plain-language explanation under a procurement ranking that a deterministic engine already computed. You NEVER change or question the order — you explain it. Two to four short sentences, US English, operational tone, no marketing words. Cite concrete numbers. If a rank-1 exists, start with why it wins per the codes (lowest expected total, complete quote, no deposit...). Mention the strongest runner-up difference and any risk flags in plain words.',
      input: [{ role: 'user', content: `Computed ranking:\n${facts}` }],
    });
    return response.output_text?.trim() || fallbackExplanation(ranking, byId, currency);
  } catch {
    return fallbackExplanation(ranking, byId, currency);
  }
}

function fallbackExplanation(
  ranking: RankingResult,
  byId: Map<string, RankableQuote>,
  currency: string,
): string {
  const top = ranking.entries.find((e) => e.rank === 1);
  if (!top) return 'No quote passed the hard constraints.';
  const q = byId.get(top.quote_id)!;
  return `${top.supplier_name} ranks first at ${formatCents(q.expected_case_cents ?? 0, currency)} expected net (${top.reason_codes.join(', ')}).`;
}
