import Link from 'next/link';
import { Suspense } from 'react';
import { Shell } from '@/components/shell';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';
import { getDemoReplay } from '@/core/demo-replay';
import { ReplayClient, RunLive, TalkToAgent } from './replay-client';

export const revalidate = 120;
export const metadata = { title: 'Demo | ProcureCall' };

function ReplaySkeleton() {
  return (
    <div className="mt-12 space-y-4 sm:mt-14" aria-hidden>
      <div className="h-4 w-24 animate-pulse bg-line" />
      <div className="h-7 w-48 animate-pulse bg-line" />
      <div className="h-40 animate-pulse bg-line/60" />
      <div className="h-40 animate-pulse bg-line/60" />
    </div>
  );
}

async function DemoBody() {
  const { fingerprint, decisionHref, sessions: replaySessions } = await getDemoReplay();

  return (
    <>
      {fingerprint ? (
        <p className="mt-5 text-sm">
          <span className="text-steel">Locked request ID </span>
          <span className="figure text-verified">{fingerprint.slice(0, 12)}</span>
          <span className="text-steel">. Same on every call in this run.</span>
        </p>
      ) : null}

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
    </>
  );
}

export default function DemoPage() {
  const vertical = getVertical(DEFAULT_VERTICAL_SLUG);

  return (
    <Shell>
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
      </div>

      <Suspense fallback={<ReplaySkeleton />}>
        <DemoBody />
      </Suspense>

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
          <li>The replay is a recorded run re-shown as-is. A live run can end differently.</li>
          <li>
            A competing price can only be cited after it was verified. No invented leverage.
          </li>
        </ul>
      </section>
    </Shell>
  );
}
