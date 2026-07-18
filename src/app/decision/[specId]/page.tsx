import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { getSpec } from '@/core/specs-repo';
import { supabaseAdmin } from '@/integrations/supabase-server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Decision room — ProcureCall' };

function eur(cents: number | null): string {
  if (cents === null) return '—';
  return `${(cents / 100).toFixed(2)} EUR`;
}

/**
 * Decision room, functional version: quotes with structured outcomes, sorted
 * by quoted net total. The deterministic price engine, ranking with reason
 * codes, and the evidence rail land in later steps — nothing here pretends
 * to be a recommendation yet.
 */
export default async function DecisionPage({ params }: { params: Promise<{ specId: string }> }) {
  const { specId } = await params;
  const spec = await getSpec(specId).catch(() => null);
  if (!spec) notFound();

  const supabase = supabaseAdmin();
  const [{ data: quotes }, { data: sessions }, { data: suppliers }] = await Promise.all([
    supabase
      .from('quotes')
      .select(
        'id, call_id, supplier_id, status, availability_status, validity_until, total_after_negotiation_cents',
      )
      .eq('job_spec_id', specId),
    supabase
      .from('call_sessions')
      .select('id, supplier_id, outcome_type, outcome, status, failure_state')
      .eq('job_spec_id', specId),
    supabase.from('suppliers').select('id, name, is_simulated'),
  ]);

  const supplierName = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? 'Supplier';
  const sorted = (quotes ?? [])
    .slice()
    .sort(
      (a, b) =>
        (a.total_after_negotiation_cents ?? Number.MAX_SAFE_INTEGER) -
        (b.total_after_negotiation_cents ?? Number.MAX_SAFE_INTEGER),
    );
  const nonQuoteSessions = (sessions ?? []).filter((s) => s.outcome_type !== 'quote');

  return (
    <Shell>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="display text-3xl">Decision room</h1>
        {spec.spec_fingerprint ? (
          <span className="figure text-sm text-verified">{spec.spec_fingerprint.slice(0, 12)}</span>
        ) : null}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-steel">
        Sorted by quoted net total. The deterministic price engine and ranked recommendation
        with evidence follow; a sort is not a recommendation.
      </p>

      <div className="mt-8 max-w-3xl">
        {sorted.length === 0 ? (
          <p className="text-sm text-steel">
            No quotes yet.{' '}
            <Link href={`/board/${specId}`} className="underline">
              Run the calls first.
            </Link>
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-steel">
                <th className="py-2 pr-4 font-normal">Supplier</th>
                <th className="py-2 pr-4 font-normal">Quoted net total</th>
                <th className="py-2 pr-4 font-normal">Status</th>
                <th className="py-2 font-normal">Availability</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((q) => (
                <tr key={q.id} className="border-b border-line">
                  <td className="py-2 pr-4">{supplierName(q.supplier_id)}</td>
                  <td className="figure py-2 pr-4">{eur(q.total_after_negotiation_cents)}</td>
                  <td className="py-2 pr-4">
                    <span className={q.status === 'confirmed' ? 'text-verified' : 'text-steel'}>
                      {q.status}
                    </span>
                  </td>
                  <td className="py-2">{q.availability_status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {nonQuoteSessions.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-sm font-medium">Calls without a quote</h2>
            <ul className="mt-2 space-y-1 text-sm text-steel">
              {nonQuoteSessions.map((s) => (
                <li key={s.id}>
                  {supplierName(s.supplier_id)} —{' '}
                  {s.outcome_type?.replaceAll('_', ' ') ?? s.failure_state ?? s.status}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-8">
          <Link href={`/board/${specId}`} className="text-sm underline">
            Back to the negotiation board
          </Link>
        </div>
      </div>
    </Shell>
  );
}
