import { Shell } from '@/components/shell';
import { IntakePanel } from './intake-panel';
import { getVertical, DEFAULT_VERTICAL_SLUG } from '@/config/verticals';

export const metadata = { title: 'New request — ProcureCall' };

export default function RequestPage() {
  const vertical = getVertical(DEFAULT_VERTICAL_SLUG);
  return (
    <Shell>
      <div className="max-w-3xl">
        <p className="text-sm text-steel">{vertical.label}</p>
        <h1 className="display mt-2 text-3xl">New request</h1>
        <p className="mt-3 max-w-xl text-sm text-steel">
          One brief, three ways to give it. Every path produces the same structured request,
          which you review and confirm before any supplier is called.
        </p>
        <div className="mt-8">
          <IntakePanel />
        </div>
      </div>
    </Shell>
  );
}
