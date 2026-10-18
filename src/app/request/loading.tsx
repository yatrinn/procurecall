import { Shell } from '@/components/shell';

export default function RequestLoading() {
  return (
    <Shell>
      <div className="max-w-3xl">
        <div className="h-4 w-40 animate-pulse bg-line" />
        <div className="mt-2 h-8 w-48 animate-pulse bg-line" />
        <div className="mt-3 h-12 max-w-xl animate-pulse bg-line/70" />
        <div className="mt-8 h-48 animate-pulse bg-line/50" />
      </div>
    </Shell>
  );
}
