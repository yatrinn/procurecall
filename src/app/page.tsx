import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { PhoneCloudIntro } from '@/components/phone-hero';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

export const revalidate = 60;

const getMarketState = unstable_cache(
  async () => {
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
  },
  ['home-market-state'],
  { revalidate: 60 },
);

export default async function Home() {
  const vertical = getVertical(DEFAULT_VERTICAL_SLUG);
  const { supplierCount, dbReachable } = await getMarketState();

  return (
    <Shell>
      <PhoneCloudIntro />
      <div className="max-w-3xl">
        <p className="text-sm text-steel">Equipment rental procurement</p>
        <h1 className="display mt-3 text-3xl sm:text-4xl md:text-5xl">
          One brief in.
          <br />
          Itemized quotes out.
        </h1>
        <p className="mt-5 max-w-xl text-base text-steel sm:text-[15px]">
          ProcureCall calls suppliers in parallel, uncovers every fee, negotiates and ranks the
          true total costs.
        </p>
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
          <Link
            href="/demo"
            className="rounded-sm bg-ink px-4 py-2.5 text-center text-sm font-medium text-paper hover:bg-black"
          >
            Watch a recorded run
          </Link>
          <Link
            href="/demo#talk"
            className="rounded-sm border border-line bg-paper px-4 py-2.5 text-center text-sm text-ink hover:border-steel"
          >
            Talk to the agent yourself
          </Link>
        </div>
        <p className="mt-3 text-xs text-steel">No login required.</p>
      </div>

      <section
        aria-labelledby="how-it-works-heading"
        className="mt-10 max-w-3xl border border-line border-l-[3px] border-l-hivis bg-paper px-5 py-5 sm:mt-12 sm:px-6 sm:py-6"
      >
        <p className="figure text-xs font-medium tracking-wide text-ink">How ProcureCall works</p>
        <h2 id="how-it-works-heading" className="display mt-2 text-xl text-ink sm:text-2xl">
          From 10 supplier calls to one clear decision
        </h2>
        <div className="mt-4 space-y-3 text-sm text-steel sm:text-[15px]">
          <p>
            Complex products often hide costs across delivery, insurance, deposits, late fees
            and optional services. Comparing ten suppliers properly means hours of calls,
            negotiation and manual spreadsheets.
          </p>
          <p>
            ProcureCall contacts every supplier in parallel with the same brief, asks each cost
            question and negotiates using verified competing quotes.
          </p>
          <p className="font-medium text-ink">
            Buyers save time, reduce costs and avoid hidden fees. Suppliers receive one clear,
            complete request.
          </p>
        </div>
      </section>

      <div className="mt-10 grid max-w-3xl grid-cols-1 gap-8 sm:mt-12 sm:grid-cols-3 sm:gap-x-10 sm:gap-y-6">
        <div>
          <p className="figure text-xs text-steel">1</p>
          <h2 className="mt-1 font-medium">Write the brief</h2>
          <p className="mt-1 text-sm text-steel">
            Type it, upload a PDF or complete a short voice interview.
          </p>
        </div>
        <div>
          <p className="figure text-xs text-steel">2</p>
          <h2 className="mt-1 font-medium">Watch the calls</h2>
          <p className="mt-1 text-sm text-steel">
            In this demo, the same request goes to three simulated suppliers. Every fee links to
            the exact moment it was spoken.
          </p>
        </div>
        <div>
          <p className="figure text-xs text-steel">3</p>
          <h2 className="mt-1 font-medium">Compare real totals</h2>
          <p className="mt-1 text-sm text-steel">
            See itemized costs, deposits and negotiated offers in one ranked view. Click any
            number to hear when it was confirmed.
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
              {dbReachable ? supplierCount : '-'}
              <span className="ml-2 font-sans text-steel">simulated, labeled</span>
            </dd>
          </div>
          <div>
            <dt className="text-steel">Public benchmark</dt>
            <dd className="mt-0.5">
              <span className="figure">
                {vertical.benchmark.medianDailyRateNet?.toFixed(0)} EUR
              </span>
              <span className="text-steel">
                {' '}
                / day machine-only (from {vertical.benchmark.references.length} public rate
                cards)
              </span>
            </dd>
          </div>
        </dl>
        {!dbReachable ? (
          <p className="mt-4 text-sm text-flag">
            Database unreachable right now. Data sections show a dash.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
