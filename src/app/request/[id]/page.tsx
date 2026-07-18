import { notFound } from 'next/navigation';
import { Shell } from '@/components/shell';
import { getSpec } from '@/core/specs-repo';
import { getVertical } from '@/config/verticals';
import { ConfirmForm, type SpecDto } from './confirm-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Confirm request — ProcureCall' };

export default async function ConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spec = await getSpec(id).catch(() => null);
  if (!spec) notFound();
  const vertical = getVertical(spec.vertical_slug);

  return (
    <Shell>
      <div className="max-w-5xl">
        <p className="text-sm text-steel">{vertical.label}</p>
        <h1 className="display mt-2 text-3xl">
          {spec.confirmed_by_user ? 'Confirmed request' : 'Confirm request'}
        </h1>
        <p className="mt-3 max-w-xl text-sm text-steel">
          {spec.confirmed_by_user
            ? 'This request is frozen under its fingerprint and reused verbatim on every call.'
            : 'Check every field — this exact brief is what every supplier hears. Nothing is called until you confirm.'}
        </p>
        <div className="mt-8">
          <ConfirmForm
            spec={spec as unknown as SpecDto}
            specFields={vertical.specFields}
            levers={vertical.levers}
            currencyLabel={vertical.currency}
          />
        </div>
      </div>
    </Shell>
  );
}
