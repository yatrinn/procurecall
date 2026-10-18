import { Shell } from '@/components/shell';

/** Instant paint while the demo RSC stream finishes. */
export default function DemoLoading() {
  return (
    <Shell>
      <div className="max-w-3xl">
        <p className="text-sm text-steel">Public demo. No login.</p>
        <div className="mt-2 h-10 w-64 animate-pulse bg-line sm:h-12 sm:w-80" />
        <div className="mt-4 h-16 max-w-2xl animate-pulse bg-line/70" />
        <div className="mt-6 grid max-w-2xl gap-2 sm:grid-cols-3 sm:gap-3">
          <div className="h-20 animate-pulse bg-line/50" />
          <div className="h-20 animate-pulse bg-line/50" />
          <div className="h-20 animate-pulse bg-line/50" />
        </div>
      </div>
      <div className="mt-12 space-y-4 sm:mt-14" aria-hidden>
        <div className="h-40 animate-pulse bg-line/60" />
        <div className="h-40 animate-pulse bg-line/60" />
      </div>
    </Shell>
  );
}
