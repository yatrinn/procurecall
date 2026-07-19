import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { getSpec } from '@/core/specs-repo';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getOrComputeRecommendation } from '@/core/recommendation';
import type { ReasonCodeT } from '@/core/ranking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Decision room — ProcureCall' };

function eur(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents === null || cents === undefined) return '—';
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

const CODE_TEXT: Record<ReasonCodeT, string> = {
  NOT_SUPPLIER_CONFIRMED: 'total was never verbally confirmed by the supplier',
  AVAILABILITY_NOT_CONFIRMED: 'availability was not confirmed for the exact dates',
  QUOTE_EXPIRED: 'quote validity has lapsed',
  NO_TRANSCRIPT_EVIDENCE: 'no transcript-backed line items',
  NO_ENGINE_TOTAL: 'the price engine could not compute a total',
  DEPOSIT_EXCEEDS_TOLERANCE: 'deposit exceeds what you authorized',
  BELOW_BENCHMARK_FLAG: 'far below the public market benchmark — flagged, never auto-preferred',
  UNPRICED_CATEGORIES: 'some mandatory cost categories were never priced',
  HIGH_CONDITIONAL_EXPOSURE: 'conditional fees exceed a quarter of the guaranteed cost',
  LOWEST_EXPECTED_TOTAL: 'lowest expected total',
  COMPLETE_ITEMIZED_QUOTE: 'complete itemized quote',
  AVAILABILITY_CONFIRMED: 'availability confirmed',
  SUPPLIER_CONFIRMED_TOTAL: 'total read back and confirmed',
  NEGOTIATED_IMPROVEMENT: 'price improved during the call',
  NO_DEPOSIT_REQUIRED: 'no deposit required',
  LOWEST_CASH_REQUIRED: 'lowest cash required',
};

interface LineRow {
  id: string;
  quote_id: string;
  call_id: string;
  label: string;
  amount_cents: number | null;
  unit: string | null;
  is_conditional: boolean;
  category: string;
  transcript_ref: { call_id?: string; turn_index?: number } | null;
}

export default async function DecisionPage({ params }: { params: Promise<{ specId: string }> }) {
  const { specId } = await params;
  const spec = await getSpec(specId).catch(() => null);
  if (!spec) notFound();

  const supabase = supabaseAdmin();
  const recommendation = await getOrComputeRecommendation(specId).catch(() => null);

  const [{ data: quotes }, { data: sessions }, { data: suppliers }] = await Promise.all([
    supabase
      .from('quotes')
      .select(
        'id, call_id, supplier_id, status, availability_status, validity_until, total_before_negotiation_cents, total_after_negotiation_cents, currency, price_breakdown, is_benchmark_outlier, missing_information',
      )
      .eq('job_spec_id', specId),
    supabase
      .from('call_sessions')
      .select('id, supplier_id, outcome_type, outcome, status, failure_state, transcript')
      .eq('job_spec_id', specId),
    supabase.from('suppliers').select('id, name, is_simulated'),
  ]);

  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? 'Supplier';

  const entries = recommendation?.ranking.entries ?? [];
  const ranked = entries.filter((e) => e.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const ineligible = entries.filter((e) => e.rank === null);
  const recommendedEntry = ranked.find((e) => e.quote_id === recommendation?.ranking.recommended_quote_id);
  const recommendedQuote = quotes?.find((q) => q.id === recommendedEntry?.quote_id);

  let recommendedLines: LineRow[] = [];
  if (recommendedQuote) {
    const { data } = await supabase
      .from('quote_lines')
      .select('id, quote_id, call_id, label, amount_cents, unit, is_conditional, category, transcript_ref')
      .eq('quote_id', recommendedQuote.id)
      .order('created_at', { ascending: true });
    recommendedLines = (data as LineRow[]) ?? [];
  }

  // Public hygiene: only sessions that produced a real structured outcome
  // appear here; smoke tests and never-started calls stay out.
  const nonQuoteSessions = (sessions ?? []).filter(
    (s) =>
      s.outcome_type !== 'quote' &&
      s.outcome_type !== null &&
      s.failure_state !== 'smoke_test_session',
  );
  const currency = recommendedQuote?.currency ?? 'EUR';

  return (
    <Shell>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="display text-3xl">Decision room</h1>
        {spec.spec_fingerprint ? (
          <span className="figure text-sm text-verified" title="Every quote below carries this exact fingerprint">
            {spec.spec_fingerprint.slice(0, 12)}
          </span>
        ) : null}
        <Link href={`/board/${specId}`} className="ml-auto text-sm text-steel underline hover:text-ink">
          Negotiation board
        </Link>
      </div>

      {!recommendation ? (
        <p className="mt-8 max-w-xl text-sm text-steel">
          No quotes to rank yet.{' '}
          <Link href={`/board/${specId}`} className="underline">
            Run the calls first.
          </Link>
        </p>
      ) : (
        <>
          {/* Recommendation with evidence rail */}
          {recommendedEntry && recommendedQuote ? (
            <section className="mt-10 max-w-3xl">
              <p className="text-sm text-steel">Recommended — deterministic ranking, engine {recommendation.engine_version}</p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <h2 className="display text-2xl">{recommendedEntry.supplier_name}</h2>
                <a
                  href={`/board/${specId}#call=${recommendedQuote.call_id}&turn=${lastTurnIndex(sessions, recommendedQuote.call_id)}`}
                  className="figure text-2xl text-verified underline-offset-4 hover:underline"
                  title="Opens the exact moment this total was confirmed"
                >
                  {eur(recommendedQuote.total_after_negotiation_cents, currency)} net
                </a>
                {recommendedEntry.negotiated_delta_cents ? (
                  <span className="figure text-sm text-verified">
                    −{eur(recommendedEntry.negotiated_delta_cents, currency)} negotiated in-call
                  </span>
                ) : null}
              </div>
              <p className="mt-3 max-w-2xl text-sm">{recommendation.explanation}</p>

              {/* Evidence rail: total → component fees → tape moments */}
              <div className="mt-6 border-l-2 border-verified/50 pl-5">
                <p className="text-xs text-steel">
                  Evidence rail — every component links to the second it was spoken
                </p>
                <ul className="mt-2 space-y-1.5">
                  {recommendedLines.map((line) => (
                    <li key={line.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className={line.is_conditional ? 'text-steel' : ''}>
                        {line.label}
                        {line.is_conditional ? ' (conditional)' : ''}
                      </span>
                      <a
                        href={`/board/${specId}#call=${line.call_id}&turn=${line.transcript_ref?.turn_index ?? 0}`}
                        className="figure underline-offset-4 hover:underline"
                        title="Open transcript at this moment"
                      >
                        {line.unit === 'percent_of_rental'
                          ? `${((line.amount_cents ?? 0) / 100).toFixed(1)}%`
                          : eur(line.amount_cents, currency)}
                        {line.unit === 'per_day' ? '/day' : ''}
                      </a>
                      <span className="figure text-xs text-steel">
                        turn {line.transcript_ref?.turn_index ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 grid max-w-md grid-cols-2 gap-y-1 text-sm">
                  <BreakdownRow label="Guaranteed net" value={eur(recommendedQuote.price_breakdown?.guaranteed_net_cents, currency)} strong />
                  <BreakdownRow label="Conditional (worst case adds)" value={eur(recommendedQuote.price_breakdown?.conditional_cents, currency)} />
                  <BreakdownRow label="Refundable deposit (not a cost)" value={eur(recommendedQuote.price_breakdown?.refundable_deposit_cents, currency)} />
                  <BreakdownRow label="VAT" value={eur(recommendedQuote.price_breakdown?.tax_cents, currency)} />
                  <BreakdownRow label="Cash required" value={eur(recommendedQuote.price_breakdown?.cash_required_cents, currency)} strong />
                </dl>
              </div>
            </section>
          ) : (
            <section className="mt-10 max-w-2xl">
              <h2 className="text-lg font-medium">Nothing is recommended</h2>
              <p className="mt-2 text-sm text-steel">{recommendation.explanation}</p>
            </section>
          )}

          {/* Full comparison */}
          <section className="mt-12">
            <h2 className="text-sm font-medium">All quotes, ranked deterministically</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-steel">
                    <th className="py-2 pr-3 font-normal">#</th>
                    <th className="py-2 pr-3 font-normal">Supplier</th>
                    <th className="py-2 pr-3 font-normal">Guaranteed net</th>
                    <th className="py-2 pr-3 font-normal">Conditional</th>
                    <th className="py-2 pr-3 font-normal">Deposit</th>
                    <th className="py-2 pr-3 font-normal">Cash required</th>
                    <th className="py-2 pr-3 font-normal">Moved in call</th>
                    <th className="py-2 font-normal">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ranked, ...ineligible].map((entry) => {
                    const q = quotes?.find((x) => x.id === entry.quote_id);
                    if (!q) return null;
                    const flags = entry.reason_codes.filter((c) =>
                      ['BELOW_BENCHMARK_FLAG', 'UNPRICED_CATEGORIES', 'HIGH_CONDITIONAL_EXPOSURE'].includes(c),
                    );
                    return (
                      <tr key={entry.quote_id} className={`border-b border-line ${entry.rank === null ? 'text-steel' : ''}`}>
                        <td className="figure py-2 pr-3">{entry.rank ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <a href={`/board/${specId}#call=${q.call_id}&turn=0`} className="underline-offset-4 hover:underline">
                            {entry.supplier_name}
                          </a>
                        </td>
                        <td className="figure py-2 pr-3">{eur(q.price_breakdown?.guaranteed_net_cents, currency)}</td>
                        <td className="figure py-2 pr-3">{eur(q.price_breakdown?.conditional_cents, currency)}</td>
                        <td className="figure py-2 pr-3">{eur(q.price_breakdown?.refundable_deposit_cents, currency)}</td>
                        <td className="figure py-2 pr-3">{eur(q.price_breakdown?.cash_required_cents, currency)}</td>
                        <td className="figure py-2 pr-3">
                          {entry.negotiated_delta_cents && entry.negotiated_delta_cents > 0 ? (
                            <span className="text-verified">−{eur(entry.negotiated_delta_cents, currency)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="max-w-[260px] py-2 text-xs">
                          {entry.rank === null ? (
                            <span className="text-flag">
                              Not rankable: {entry.reason_codes.filter((c) => CODE_TEXT[c]).slice(0, 3).map((c) => CODE_TEXT[c]).join('; ')}
                            </span>
                          ) : flags.length > 0 ? (
                            <span className="text-flag">{flags.map((c) => CODE_TEXT[c]).join('; ')}</span>
                          ) : (
                            <span className="text-steel">
                              {entry.reason_codes.includes('COMPLETE_ITEMIZED_QUOTE') ? 'complete quote' : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-steel">
              A refundable deposit is tied-up capital, not a cost — it affects cash required, never the rank.
            </p>
          </section>
        </>
      )}

      {nonQuoteSessions.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-medium">Calls without a quote</h2>
          <ul className="mt-2 space-y-1 text-sm text-steel">
            {nonQuoteSessions.map((s) => (
              <li key={s.id}>
                <a href={`/board/${specId}#call=${s.id}&turn=0`} className="underline-offset-4 hover:underline">
                  {supplierName(s.supplier_id)}
                </a>{' '}
                — {s.outcome_type?.replaceAll('_', ' ') ?? s.failure_state ?? s.status}
                {s.outcome && typeof s.outcome === 'object' && 'summary' in s.outcome
                  ? `: ${(s.outcome as { summary?: string }).summary ?? ''}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
}

function BreakdownRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? '' : 'text-steel'}>{label}</dt>
      <dd className={`figure text-right ${strong ? 'font-medium' : ''}`}>{value}</dd>
    </>
  );
}

function lastTurnIndex(
  sessions: Array<{ id: string; transcript: unknown }> | null,
  callId: string,
): number {
  const s = sessions?.find((x) => x.id === callId);
  const transcript = (s?.transcript as Array<{ turn_index: number }>) ?? [];
  return transcript.length > 0 ? transcript[transcript.length - 1].turn_index : 0;
}
