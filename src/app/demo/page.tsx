import Link from 'next/link';
import { Shell } from '@/components/shell';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getAppSetting } from '@/integrations/elevenlabs-server';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';
import { derivePins, type PinSourceEvent, type PinSourceSession } from '@/components/derive-pins';
import { ReplayClient, RunLive, type ReplaySession } from './replay-client';
import type { TapeTurn } from '@/components/call-tape';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demo — ProcureCall' };

const BEHAVIOR_LABELS: Record<string, string> = {
  transparent_premium: 'transparent premium',
  low_headline: 'low headline, fees on request',
  hard_dispatcher: 'hard dispatcher',
};

export default async function DemoPage() {
  const vertical = getVertical(DEFAULT_VERTICAL_SLUG);
  const supabase = supabaseAdmin();

  const [specId, callIdsJson] = await Promise.all([
    getAppSetting('demo_spec_id'),
    getAppSetting('demo_call_ids'),
  ]);

  let replaySessions: ReplaySession[] = [];
  let fingerprint: string | null = null;
  let decisionHref: string | null = null;

  if (specId && callIdsJson) {
    const callIds = JSON.parse(callIdsJson) as string[];
    const [{ data: spec }, { data: sessions }, { data: quotes }, { data: events }, { data: suppliers }, { data: policies }] =
      await Promise.all([
        supabase.from('job_specs').select('spec_fingerprint').eq('id', specId).single(),
        supabase
          .from('call_sessions')
          .select(
            'id, supplier_id, transcript, tool_calls, friction_events, disclosure_event, outcome, outcome_type',
          )
          .in('id', callIds),
        supabase
          .from('quotes')
          .select('call_id, total_before_negotiation_cents, total_after_negotiation_cents')
          .in('call_id', callIds),
        supabase
          .from('negotiation_events')
          .select(
            'id, call_id, event_type, concession_type, amount_before_cents, amount_after_cents, transcript_ref',
          )
          .in('call_id', callIds),
        supabase.from('suppliers').select('id, name, location'),
        supabase.from('supplier_policies').select('supplier_id, behavior_profile'),
      ]);

    fingerprint = spec?.spec_fingerprint ?? null;
    decisionHref = `/decision/${specId}`;

    replaySessions = callIds
      .map((callId) => {
        const session = sessions?.find((s) => s.id === callId);
        if (!session) return null;
        const supplier = suppliers?.find((s) => s.id === session.supplier_id);
        const behavior =
          policies?.find((p) => p.supplier_id === session.supplier_id)?.behavior_profile ?? '';
        const quote = quotes?.find((q) => q.call_id === callId);
        const transcript = session.transcript as TapeTurn[];
        const lastTurn = transcript[transcript.length - 1];
        const outcome = session.outcome as { summary?: string } | null;
        return {
          id: session.id,
          supplier_name: supplier?.name ?? 'Supplier',
          supplier_location: supplier?.location ?? null,
          behavior_label: BEHAVIOR_LABELS[behavior] ?? behavior,
          turns: transcript,
          pins: derivePins(session as unknown as PinSourceSession, (events ?? []) as PinSourceEvent[]),
          duration_ms: (lastTurn?.at_ms ?? 0) + 4000,
          outcome_line: outcome?.summary ?? '',
          quote_before_cents: quote?.total_before_negotiation_cents ?? null,
          quote_after_cents: quote?.total_after_negotiation_cents ?? null,
        } satisfies ReplaySession;
      })
      .filter((x): x is ReplaySession => x !== null);
  }

  return (
    <Shell
      nav={[
        { href: '/', label: 'Overview' },
        { href: '/request', label: 'New request' },
        { href: '/demo', label: 'Demo' },
      ]}
    >
      <div className="max-w-3xl">
        <p className="text-sm text-steel">Public demo — no login</p>
        <h1 className="display mt-2 text-4xl">
          One brief. Three dispatchers.
          <br />
          Every number traceable.
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-steel">
          The request: {vertical.demoRequestSummary.toLowerCase()}. Three simulated suppliers with
          genuinely different commercial behavior take the same call. Fees pin to each tape at
          the moment they are spoken; a competing figure may only be cited after the server
          verified it — that is the deep petrol color. Deterministic engine math, deterministic
          ranking; the model explains, it never chooses.
        </p>
        {fingerprint ? (
          <p className="mt-3 text-sm">
            <span className="text-steel">Request fingerprint </span>
            <span className="figure text-verified">{fingerprint.slice(0, 12)}</span>
            <span className="text-steel"> — identical on every call below.</span>
          </p>
        ) : null}
      </div>

      {replaySessions.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-sm font-medium">The recorded run</h2>
          <div className="mt-4">
            <ReplayClient sessions={replaySessions} />
          </div>
          {decisionHref ? (
            <p className="mt-6 text-sm">
              <Link href={decisionHref} className="underline underline-offset-4 hover:text-ink">
                Open the decision room for this run
              </Link>
              <span className="text-steel"> — ranked totals, evidence rail, reason codes.</span>
            </p>
          ) : null}
        </section>
      ) : (
        <section className="mt-12 max-w-xl border border-line bg-paper p-4">
          <h2 className="text-sm font-medium">The demo is not seeded yet</h2>
          <p className="mt-1 text-sm text-steel">
            The recorded run has not been published. You can still start a request from scratch
            under “New request”.
          </p>
        </section>
      )}

      <section className="mt-14 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Run it live</h2>
        <div className="mt-3">
          <RunLive />
        </div>
      </section>

      <section className="mt-14 border-t border-line pt-6 text-xs text-steel">
        <h2 className="text-sm font-medium text-ink">What is real here</h2>
        <ul className="mt-2 max-w-2xl list-disc space-y-1 pl-4">
          <li>
            The three suppliers are simulated and labeled as such. Their price sheets are
            grounded in sourced public rate cards; their concessions come from private policy
            ladders, never from a script.
          </li>
          <li>
            The replay is a faithful re-render of a recorded run — nothing in it is generated at
            view time. Live runs are genuinely live and can end differently.
          </li>
          <li>
            The buyer agent can only cite competing figures returned by a server-side
            verification tool. Unverified numbers do not reach the model.
          </li>
        </ul>
      </section>
    </Shell>
  );
}
