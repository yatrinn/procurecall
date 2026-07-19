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
        <p className="text-sm text-steel">Buyer-side procurement agent</p>
        <h1 className="display mt-3 text-5xl">
          One brief. Every supplier.
          <br />
          The best verified deal.
        </h1>
        <p className="mt-6 max-w-xl text-steel">
          Rental prices are not hidden. They are simply never written down — they exist only
          while someone is speaking them. ProcureCall takes your brief once, calls the market,
          extracts every fee, and pins each number to the second of the recording where it was
          said.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-black"
          >
            See the demo
          </Link>
          <Link
            href="/request"
            className="rounded-sm border border-line bg-paper px-4 py-2 text-sm text-ink hover:border-steel"
          >
            Start a request
          </Link>
        </div>
      </div>

      <div className="mt-14 grid max-w-3xl grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-3">
        <div>
          <p className="figure text-xs text-steel">01</p>
          <h2 className="mt-1 font-medium">Brief</h2>
          <p className="mt-1 text-sm text-steel">
            One structured job spec, by voice interview or document. You confirm it; it freezes
            with a fingerprint.
          </p>
        </div>
        <div>
          <p className="figure text-xs text-steel">02</p>
          <h2 className="mt-1 font-medium">Calls</h2>
          <p className="mt-1 text-sm text-steel">
            The agent describes the job identically to every supplier and extracts an itemized
            quote from each call.
          </p>
        </div>
        <div>
          <p className="figure text-xs text-steel">03</p>
          <h2 className="mt-1 font-medium">Decision</h2>
          <p className="mt-1 text-sm text-steel">
            A deterministic engine ranks the real totals. Every number links to the moment it
            was spoken.
          </p>
        </div>
      </div>

      <div className="mt-14 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Current market configuration</h2>
        <dl className="mt-3 grid max-w-3xl grid-cols-1 gap-x-12 gap-y-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-steel">Vertical</dt>
            <dd className="mt-0.5">{vertical.label}</dd>
          </div>
          <div>
            <dt className="text-steel">Suppliers seeded</dt>
            <dd className="figure mt-0.5">
              {dbReachable ? supplierCount : '—'}
              <span className="ml-2 font-sans text-steel">simulated, labeled</span>
            </dd>
          </div>
          <div>
            <dt className="text-steel">Benchmark median (machine-only day rate)</dt>
            <dd className="figure mt-0.5">
              {vertical.benchmark.medianDailyRateNet?.toFixed(2)} EUR/day net
              <span className="ml-2 font-sans text-steel">
                from {vertical.benchmark.references.length} sourced public rate cards — quotes on
                the board are 5-day guaranteed totals incl. transport and mandatory liability;
                the engine normalizes each back to a machine-only day rate before comparing
              </span>
            </dd>
          </div>
        </dl>
        {!dbReachable ? (
          <p className="mt-4 text-sm text-flag">
            The database is not reachable right now. The page still renders; data-backed
            sections are marked with a dash.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
