import Link from 'next/link';

const NAV: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Overview' },
  { href: '/request', label: 'New request' },
  { href: '/demo', label: 'Demo' },
];

/**
 * Application shell: quiet header, alignment over borders.
 * Nav renders only routes that exist — no dead links, ever.
 */
export function Shell({
  children,
  nav = NAV,
}: {
  children: React.ReactNode;
  nav?: Array<{ href: string; label: string }>;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl items-baseline gap-8 px-6 py-4">
          <Link href="/" className="display text-lg tracking-tight">
            ProcureCall
          </Link>
          <nav className="flex items-baseline gap-5 text-sm text-steel">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-steel">
            <span className="inline-block h-2 w-2 rounded-full bg-hivis" aria-hidden />
            <span>Simulated market — no real businesses are called</span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl items-baseline justify-between px-6 py-4 text-xs text-steel">
          <span>Hack-Nation 6th Global AI Hackathon — Challenge 01, The Negotiator</span>
          <span className="figure">MIT license</span>
        </div>
      </footer>
    </div>
  );
}
