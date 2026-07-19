import Link from 'next/link';
import { Shell } from '@/components/shell';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getAppSetting } from '@/integrations/elevenlabs-server';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';
import { derivePins, type PinSourceEvent, type PinSourceSession } from '@/components/derive-pins';
import { ReplayClient, RunLive, TalkToAgent, type ReplaySession } from './replay-client';
import type { TapeTurn } from '@/components/call-tape';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demo | ProcureCall' };

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
            'id, supplier_id, transcript, tool_calls, friction_events, disclosure_event, outcome, outcome_type, recording_url',
          )
          .in('id', callIds),
        supabase
          .from('quotes')
          .select('call_id, total_before_negotiation_cents, total_after_negotiation_cents, currency')
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

    replaySessions = (
      await Promise.all(
        callIds.map(async (callId) => {
          const session = sessions?.find((s) => s.id === callId);
          if (!session) return null;
          const supplier = suppliers?.find((s) => s.id === session.supplier_id);
          const behavior =
            policies?.find((p) => p.supplier_id === session.supplier_id)?.behavior_profile ?? '';
          const quote = quotes?.find((q) => q.call_id === callId);
          const transcript = session.transcript as TapeTurn[];
          const lastTurn = transcript[transcript.length - 1];
          const outcome = session.outcome as { summary?: string } | null;

          // Voice runs carry a private recording; hand the client a signed URL.
          let audioUrl: string | null = null;
          if (session.recording_url) {
            if (session.recording_url.startsWith('http')) {
              audioUrl = session.recording_url;
            } else {
              const { data: signed } = await supabase.storage
                .from('call-audio')
                .createSignedUrl(session.recording_url, 3600);
              audioUrl = signed?.signedUrl ?? null;
            }
          }

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
            audio_url: audioUrl,
            currency: quote?.currency ?? 'EUR',
          } satisfies ReplaySession;
        }),
      )
    ).filter((x): x is ReplaySession => x !== null);
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
        <p className="text-sm text-steel">Public demo. No login.</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">
          Same job.
          <br />
          Three different calls.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-steel sm:text-sm">
          Brief: {vertical.demoRequestSummary}. One supplier quotes clean, one hides fees, one
          stonewalls. The demo walks you through what happened and what it was worth.
        </p>
        <div className="mt-6 grid max-w-2xl gap-2 sm:grid-cols-3 sm:gap-3">
          <a
            href="#watch"
            className="group border border-line bg-paper p-3 transition-colors hover:border-steel"
          >
            <span className="figure text-xs text-steel">Step 1</span>
            <p className="mt-1 text-sm font-medium">Watch the calls</p>
            <p className="mt-0.5 text-xs text-steel">Fees pin to each tape as they were said</p>
          </a>
          <a
            href="#decision"
            className="group border border-line bg-paper p-3 transition-colors hover:border-steel"
          >
            <span className="figure text-xs text-steel">Step 2</span>
            <p className="mt-1 text-sm font-medium">See who won</p>
            <p className="mt-0.5 text-xs text-steel">Ranked totals, every number has evidence</p>
          </a>
          <a
            href="#talk"
            className="group border border-line bg-paper p-3 transition-colors hover:border-steel"
          >
            <span className="figure text-xs text-steel">Step 3</span>
            <p className="mt-1 text-sm font-medium">Take a call yourself</p>
            <p className="mt-0.5 text-xs text-steel">You play the dispatcher, live over your mic</p>
          </a>
        </div>
        {fingerprint ? (
          <p className="mt-5 text-sm">
            <span className="text-steel">Locked request ID </span>
            <span className="figure text-verified">{fingerprint.slice(0, 12)}</span>
            <span className="text-steel">. Same on every call in this run.</span>
          </p>
        ) : null}
      </div>

      {replaySessions.length > 0 ? (
        <section id="watch" className="mt-12 scroll-mt-6 sm:mt-14">
          <p className="figure text-xs text-steel">Step 1</p>
          <h2 className="display mt-1 text-lg sm:text-xl">Watch the calls</h2>
          <p className="mt-2 max-w-2xl text-sm text-steel">
            Press play for a silent fast-forward of the whole run: each fee lands on the tape at
            the moment it was said. To hear a call, use the audio player under its tape.
          </p>
          <div className="mt-4 min-w-0">
            <ReplayClient sessions={replaySessions} decisionHref={decisionHref} />
          </div>
        </section>
      ) : (
        <section className="mt-10 max-w-xl border border-line bg-paper p-4 sm:mt-12">
          <h2 className="text-sm font-medium">Demo not seeded yet</h2>
          <p className="mt-1 text-sm text-steel">
            No recorded run published. You can still start from scratch under New request.
          </p>
        </section>
      )}

      {decisionHref && replaySessions.length > 0 ? (
        <section
          id="decision"
          className="mt-12 scroll-mt-6 border border-ink bg-paper p-5 sm:mt-14 sm:p-6"
        >
          <p className="figure text-xs text-steel">Step 2</p>
          <h2 className="display mt-1 text-lg sm:text-xl">See who won, and why</h2>
          <p className="mt-2 max-w-2xl text-sm text-steel">
            Three calls, three totals that were never comparable on the phone. The price engine
            normalized every fee and ranked the real totals. In the decision room, clicking any
            number jumps back to the second it was said.
          </p>
          <div className="mt-4 flex max-w-2xl flex-col gap-1.5">
            {replaySessions
              .filter((s) => s.quote_after_cents !== null)
              .sort((a, b) => (a.quote_after_cents ?? 0) - (b.quote_after_cents ?? 0))
              .map((s) => (
                <div
                  key={s.id}
                  className="flex items-baseline justify-between gap-4 border-b border-line pb-1.5 text-sm"
                >
                  <span>{s.supplier_name}</span>
                  <span className="figure">
                    {((s.quote_after_cents ?? 0) / 100).toFixed(2)} {s.currency} net
                  </span>
                </div>
              ))}
            {replaySessions.some((s) => s.quote_after_cents === null) ? (
              <p className="text-xs text-steel">
                {replaySessions
                  .filter((s) => s.quote_after_cents === null)
                  .map((s) => s.supplier_name)
                  .join(', ')}{' '}
                ended without a quote. The decision room documents why.
              </p>
            ) : null}
          </div>
          <div className="mt-5">
            <Link
              href={decisionHref}
              className="inline-block rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-black"
            >
              Open the decision room
            </Link>
          </div>
        </section>
      ) : null}

      <section id="talk" className="mt-12 scroll-mt-6 border border-line bg-paper p-5 sm:mt-14 sm:p-6">
        <p className="figure text-xs text-steel">Step 3</p>
        <h2 className="display mt-1 text-lg sm:text-xl">Take a call yourself</h2>
        <p className="mt-2 max-w-2xl text-sm text-steel">
          This is the live part: a real phone-style call in your browser, over your microphone.
          The AI buyer calls to rent the scissor lift and you answer as the rental company&apos;s
          dispatcher. Name your prices, hide fees, push back. Everything you say lands on a tape
          like the ones above.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-steel">
          <li>Click the button and allow microphone access</li>
          <li>The agent starts talking. Answer out loud as the dispatcher</li>
          <li>Hang up whenever you want; the call caps at 4 minutes</li>
        </ol>
        <div className="mt-4">
          <TalkToAgent />
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-6 sm:mt-14">
        <h2 className="text-sm font-medium">Prefer text? Run it live without a microphone</h2>
        <p className="mt-1 max-w-xl text-sm text-steel">
          Same brief again, three fresh agent-vs-agent negotiations. Limited per IP so the demo
          stays usable for everyone.
        </p>
        <div className="mt-3">
          <RunLive />
        </div>
      </section>

      <section className="mt-12 border-t border-line pt-6 text-xs text-steel sm:mt-14">
        <h2 className="text-sm font-medium text-ink">What&apos;s real vs simulated</h2>
        <ul className="mt-2 max-w-2xl list-disc space-y-1.5 pl-4">
          <li>
            Suppliers are simulated and labeled. Prices are grounded in public rate cards; how
            each dispatcher behaves is private policy, not a fixed script.
          </li>
          <li>
            The replay is a recorded run re-shown as-is. A live run can end differently.
          </li>
          <li>
            A competing price can only be cited after it was verified. No invented leverage.
          </li>
        </ul>
      </section>
    </Shell>
  );
}
