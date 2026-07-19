import { Shell } from '@/components/shell';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { TruthConsole } from './truth-console';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evaluation lab | ProcureCall' };

/**
 * The evaluation lab shows REAL numbers from real runs. Latest result per
 * adversarial scenario (attempt history preserved), the newest held-out
 * evaluation, and recent validator findings. Nothing here is hard-coded.
 */

interface ScenarioRow {
  id: string;
  slug: string;
  category: string;
  description: string;
}

interface ResultRow {
  scenario_id: string;
  passed: boolean;
  run_at: string;
  details: unknown;
}

export default async function LabPage() {
  const supabase = supabaseAdmin();
  const [{ data: scenarios }, { data: results }, { data: evalRuns }, { data: findings }] =
    await Promise.all([
      supabase.from('adversarial_scenarios').select('id, slug, category, description'),
      supabase
        .from('adversarial_results')
        .select('scenario_id, passed, run_at, details')
        .order('run_at', { ascending: false })
        .limit(1000),
      supabase
        .from('eval_runs')
        .select('results, run_at')
        .eq('kind', 'held_out_profiles')
        .order('run_at', { ascending: false })
        .limit(1),
      supabase
        .from('validator_findings')
        .select('claim_type, severity, supported_by_tool_call, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

  const latestByScenario = new Map<string, ResultRow>();
  const attempts = new Map<string, number>();
  for (const r of (results ?? []) as ResultRow[]) {
    attempts.set(r.scenario_id, (attempts.get(r.scenario_id) ?? 0) + 1);
    if (!latestByScenario.has(r.scenario_id)) latestByScenario.set(r.scenario_id, r);
  }

  const rows = ((scenarios ?? []) as ScenarioRow[])
    .map((s) => ({
      ...s,
      latest: latestByScenario.get(s.id) ?? null,
      attempts: attempts.get(s.id) ?? 0,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));

  const withResults = rows.filter((r) => r.latest !== null);
  const passed = withResults.filter((r) => r.latest!.passed).length;
  const lastRunAt = withResults
    .map((r) => r.latest!.run_at)
    .sort()
    .at(-1);

  const categories = [...new Set(rows.map((r) => r.category))];

  const heldOut = evalRuns?.[0] as
    | {
        run_at: string;
        results: {
          totals: Record<string, number>;
          profiles: Array<{
            profile: string;
            outcome_type: string | null;
            no_violations: boolean;
            itemization: boolean | null;
            engine_agreement: boolean | null;
            floor_respected: boolean | null;
            quote_total_cents: number | null;
          }>;
        };
      }
    | undefined;

  const violationCount = (findings ?? []).filter((f) => f.severity === 'violation').length;

  return (
    <Shell>
      <h1 className="display text-3xl">Evaluation lab</h1>
      <p className="mt-2 max-w-2xl text-sm text-steel">
        Every number on this page comes from actually running the attacks and evaluations
        against this system. The latest result per scenario counts; earlier attempts stay on
        record.
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Try to make it lie</h2>
        <p className="mt-1 max-w-2xl text-xs text-steel">
          This runs the real buyer brain with its real tool surface in a sandbox without
          confirmed quotes. Watch the verification tool return a typed error and the agent
          refuse, live, in about ten seconds.
        </p>
        <div className="mt-3">
          <TruthConsole />
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h2 className="text-sm font-medium">Adversarial suite</h2>
          <span className="figure text-2xl">
            {passed}/{withResults.length}
          </span>
          <span className="text-sm text-steel">
            scenarios passing{lastRunAt ? ` · last run ${new Date(lastRunAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}
          </span>
          {rows.length > withResults.length ? (
            <span className="text-sm text-flag">
              {rows.length - withResults.length} scenario(s) never ran
            </span>
          ) : null}
        </div>

        <div className="mt-4 space-y-6">
          {categories.map((category) => (
            <div key={category}>
              <h3 className="figure text-xs uppercase tracking-wide text-steel">{category}</h3>
              <ul className="mt-1 divide-y divide-line border-t border-line">
                {rows
                  .filter((r) => r.category === category)
                  .map((r) => (
                    <li key={r.slug} className="flex items-baseline gap-3 py-1.5 text-sm">
                      <span
                        className={`figure w-12 flex-none text-xs ${
                          r.latest === null
                            ? 'text-steel'
                            : r.latest.passed
                              ? 'text-verified'
                              : 'text-flag'
                        }`}
                      >
                        {r.latest === null ? 'n/a' : r.latest.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <span className="figure flex-none text-xs text-steel">{r.slug}</span>
                      <span className="hidden max-w-xl truncate text-steel sm:inline">
                        {r.description}
                      </span>
                      {r.attempts > 1 ? (
                        <span className="figure ml-auto flex-none text-xs text-steel">
                          {r.attempts} attempts
                        </span>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Negotiation performance on held-out market scenarios</h2>
        <p className="mt-1 max-w-2xl text-xs text-steel">
          Eight supplier behaviors the policy never saw during development. This demonstrates
          the architecture is testable and the policy generalizes. It is not evidence of
          real-world savings.
        </p>
        {heldOut ? (
          <>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              {Object.entries(heldOut.results.totals).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-steel">{k.replaceAll('_', ' ')}</dt>
                  <dd className="figure">{k === 'n' ? v : `${v}/${heldOut.results.totals.n}`}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-steel">
                    <th className="py-1.5 pr-3 font-normal">Profile</th>
                    <th className="py-1.5 pr-3 font-normal">Outcome</th>
                    <th className="py-1.5 pr-3 font-normal">Violation-free</th>
                    <th className="py-1.5 pr-3 font-normal">Itemized ≥4</th>
                    <th className="py-1.5 pr-3 font-normal">Engine agrees</th>
                    <th className="py-1.5 font-normal">Quote total</th>
                  </tr>
                </thead>
                <tbody>
                  {heldOut.results.profiles.map((p) => (
                    <tr key={p.profile} className="border-b border-line">
                      <td className="figure py-1.5 pr-3 text-xs">{p.profile}</td>
                      <td className="py-1.5 pr-3">{p.outcome_type?.replaceAll('_', ' ') ?? '-'}</td>
                      <td className={`py-1.5 pr-3 ${p.no_violations ? 'text-verified' : 'text-flag'}`}>
                        {p.no_violations ? 'yes' : 'NO'}
                      </td>
                      <td className="py-1.5 pr-3">{p.itemization === null ? '-' : p.itemization ? 'yes' : 'no'}</td>
                      <td className="py-1.5 pr-3">
                        {p.engine_agreement === null ? '-' : p.engine_agreement ? 'yes' : 'no (quote held as draft)'}
                      </td>
                      <td className="figure py-1.5">
                        {p.quote_total_cents !== null ? `${(p.quote_total_cents / 100).toFixed(2)} EUR` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="figure mt-2 text-xs text-steel">
              run {new Date(heldOut.run_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-steel">No held-out evaluation has run yet.</p>
        )}
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Post-call validator</h2>
        <p className="mt-1 max-w-2xl text-xs text-steel">
          Every call is scanned for commercial claims; code, not the model, decides whether a
          tool call supported each one.
        </p>
        <p className="mt-3 text-sm">
          <span className="figure">{(findings ?? []).length}</span>
          <span className="text-steel"> findings on record in the last 200 · </span>
          <span className={violationCount === 0 ? 'figure text-verified' : 'figure text-flag'}>
            {violationCount} unsupported-claim violations
          </span>
        </p>
      </section>
    </Shell>
  );
}
