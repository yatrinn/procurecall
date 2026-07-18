'use client';

/** Small form primitives following DESIGN_SYSTEM.md: 4px radius, quiet borders. */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-steel">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && !error ? <span className="mt-1 block text-xs text-steel">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-flag">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-sm border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-steel disabled:opacity-50';

export const monoInputClass = `${inputClass} figure`;

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function QuietButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-sm border border-line bg-paper px-4 py-2 text-sm text-ink hover:border-steel disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
