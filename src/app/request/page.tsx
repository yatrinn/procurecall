import Link from 'next/link';
import { Shell } from '@/components/shell';
import { IntakePanel } from './intake-panel';
import { getVertical, verticals, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

export const metadata = { title: 'New request — ProcureCall' };

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string }>;
}) {
  const { vertical: requested } = await searchParams;
  const slug = verticals.some((v) => v.slug === requested) ? requested! : DEFAULT_VERTICAL_SLUG;
  const vertical = getVertical(slug);

  return (
    <Shell>
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-sm text-steel">{vertical.label}</p>
          <span className="text-xs text-steel">·</span>
          <span className="text-xs text-steel">
            Vertical is configuration, not code — switch it live:
          </span>
          {verticals.map((v) => (
            <Link
              key={v.slug}
              href={`/request?vertical=${v.slug}`}
              className={`text-xs underline-offset-4 ${
                v.slug === slug ? 'text-ink underline' : 'text-steel hover:underline'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <h1 className="display mt-2 text-3xl">New request</h1>
        <p className="mt-3 max-w-xl text-sm text-steel">
          One brief, three ways to give it. Every path produces the same structured request,
          which you review and confirm before any supplier is called.
        </p>
        <div className="mt-8">
          <IntakePanel vertical={slug} placeholder={vertical.demoRequestSummary} />
        </div>
      </div>
    </Shell>
  );
}
