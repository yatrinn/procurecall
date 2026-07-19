import Link from 'next/link';
import { Shell } from '@/components/shell';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

export const dynamic = 'force-dynamic';

async function getMarketState() {
  try {
    const supabase = supabaseAdmin();
    const { count } = await supabase
      .from('suppliers')
      .select('*', { count: 'exact', head: true })
      .eq('vertical_slug', DEFAULT_VERTICAL_SLUG);
    return { supplierCount: count ?? 0, dbReachable: true };
  } catch {
    return { supplierCount: 0, dbReachable: false };
  }
}

export default async function Home() {
  const vertical = getVertical(DEFAULT_VERTICAL_SLUG);
  const { supplierCount, dbReachable } = await getMarketState();

  return (
    <Shell>
      <div className="max-w-3xl">
        <p className="text-sm text-steel">AI buyer for equipment rental</p>
        <h1 className="display mt-3 text-3xl sm:text-4xl md:text-5xl">
          One brief.
          <br />
          Three suppliers called.
          <br />
          Every fee on the tape.
        </h1>
        <p className="mt-5 max-w-xl text-base text-steel sm:text-[15px]">
          You describe the job once. ProcureCall calls the suppliers, pulls an itemized quote
          out of each conversation, and ranks the real totals — not the headline day rate.
          Click any number and you land on the second it was said.
        </p>
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
          <Link
            href="/demo"
            className="rounded-sm bg-ink px-4 py-2.5 text-center text-sm font-medium text-paper hover:bg-black"
          >
            Watch a recorded run
          </Link>
          <Link
            href="/request"
            className="rounded-sm border border-line bg-paper px-4 py-2.5 text-center text-sm text-ink hover:border-steel"
          >
            Start your own request
          </Link>
        </div>
        <p className="mt-3 text-xs text-steel">
          No login. Demo market is simulated — nobody&apos;s real business gets a call.
        </p>
      </div>

      <div className="mt-12 grid max-w-3xl grid-cols-1 gap-8 sm:mt-14 sm:grid-cols-3 sm:gap-x-10 sm:gap-y-6">
        <div>
          <p className="figure text-xs text-steel">1</p>
          <h2 className="mt-1 font-medium">Write the brief</h2>
          <p className="mt-1 text-sm text-steel">
            Type it, upload a PDF, or do a short voice interview. You confirm once — then the
            request is locked.
          </p>
        </div>
        <div>
          <p className="figure text-xs text-steel">2</p>
          <h2 className="mt-1 font-medium">Watch the calls</h2>
          <p className="mt-1 text-sm text-steel">
            Same job, three suppliers. Delivery, pickup, insurance, extras — each fee sticks to
            the moment it was spoken.
          </p>
        </div>
        <div>
          <p className="figure text-xs text-steel">3</p>
          <h2 className="mt-1 font-medium">Pick with evidence</h2>
          <p className="mt-1 text-sm text-steel">
            Totals are calculated from the fees on the tape — not guessed by the model.
            Deposits count as cash, not cost. Oddly cheap quotes get flagged.
          </p>
        </div>
      </div>

      <div className="mt-12 border-t border-line pt-6 sm:mt-14">
        <h2 className="text-sm font-medium">What&apos;s configured right now</h2>
        <dl className="mt-3 grid max-w-3xl grid-cols-1 gap-4 text-sm sm:grid-cols-3 sm:gap-x-10">
          <div>
            <dt className="text-steel">Market</dt>
            <dd className="mt-0.5">{vertical.label}</dd>
          </div>
          <div>
            <dt className="text-steel">Suppliers</dt>
            <dd className="figure mt-0.5">
              {dbReachable ? supplierCount : '—'}
              <span className="ml-2 font-sans text-steel">simulated, labeled</span>
            </dd>
          </div>
          <div>
            <dt className="text-steel">Public benchmark</dt>
            <dd className="mt-0.5">
              <span className="figure">
                {vertical.benchmark.medianDailyRateNet?.toFixed(0)} EUR
              </span>
              <span className="text-steel"> / day machine-only (from{' '}
              {vertical.benchmark.references.length} public rate cards)</span>
            </dd>
          </div>
        </dl>
        {!dbReachable ? (
          <p className="mt-4 text-sm text-flag">
            Database unreachable right now — data sections show a dash.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
