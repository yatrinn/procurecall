import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { getSpec } from '@/core/specs-repo';
import { getVertical } from '@/config/verticals';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { BoardClient } from './board-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Negotiation board | ProcureCall' };

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ specId: string }>;
  searchParams: Promise<{ voice?: string }>;
}) {
  const { specId } = await params;
  const { voice } = await searchParams;
  const spec = await getSpec(specId).catch(() => null);
  if (!spec) notFound();
  const vertical = getVertical(spec.vertical_slug);

  if (!spec.confirmed_by_user || !spec.spec_fingerprint) {
    return (
      <Shell>
        <div className="max-w-xl">
          <h1 className="display text-3xl">Not confirmed yet</h1>
          <p className="mt-3 text-sm text-steel">
            This request has not been confirmed. No supplier is called before you confirm the
            brief and its fingerprint is computed.
          </p>
          <Link href={`/request/${spec.id}`} className="mt-4 inline-block text-sm underline">
            Go to the confirmation screen
          </Link>
        </div>
      </Shell>
    );
  }

  const { data: suppliers } = await supabaseAdmin()
    .from('suppliers')
    .select('id, name')
    .eq('vertical_slug', spec.vertical_slug)
    .order('name');

  return (
    <Shell>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="display text-2xl sm:text-3xl">Negotiation board</h1>
        <span className="figure text-sm text-verified" title={spec.spec_fingerprint}>
          {spec.spec_fingerprint.slice(0, 12)}
        </span>
        <span className="text-sm text-steel">{vertical.label}</span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-steel">
        Three suppliers, one identical brief. Every number is pinned to the moment it was
        spoken. Simulated market. No real businesses are called.
      </p>
      <div className="mt-8">
        <BoardClient
          specId={spec.id}
          supplierIds={(suppliers ?? []).map((s) => s.id)}
          voiceOpen={voice === '1'}
        />
      </div>
    </Shell>
  );
}
