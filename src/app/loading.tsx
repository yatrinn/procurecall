import { Shell } from '@/components/shell';

export default function HomeLoading() {
  return (
    <Shell>
      <div className="max-w-3xl">
        <div className="h-4 w-48 animate-pulse bg-line" />
        <div className="mt-3 h-12 w-72 animate-pulse bg-line sm:h-14 sm:w-96" />
        <div className="mt-5 h-16 max-w-xl animate-pulse bg-line/70" />
        <div className="mt-7 flex gap-2">
          <div className="h-10 w-40 animate-pulse bg-line" />
          <div className="h-10 w-44 animate-pulse bg-line/60" />
        </div>
      </div>
    </Shell>
  );
}
