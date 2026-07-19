import Link from 'next/link';

const NAV: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Overview' },
  { href: '/request', label: 'New request' },
  { href: '/demo', label: 'Demo' },
];

const FOOTER_LINKS: Array<{ href: string; label: string }> = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/imprint', label: 'Imprint' },
];

/**
 * Application shell: quiet header, alignment over borders.
 * Nav renders only routes that exist — no dead links, ever.
 * Mobile: wraps instead of forcing a single desktop row (which caused
 * horizontal overflow on phones).
 */
export function Shell({
  children,
  nav = NAV,
}: {
  children: React.ReactNode;
  nav?: Array<{ href: string; label: string }>;
}) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="display shrink-0 text-base tracking-tight sm:text-lg">
            ProcureCall
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-steel">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex w-full items-center gap-2 text-xs text-steel sm:ml-auto sm:w-auto">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-hivis" aria-hidden />
            <span className="sm:hidden">Simulated market</span>
            <span className="hidden sm:inline">Simulated market — no real businesses are called</span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
            <div className="max-w-xs">
              <p className="display text-sm tracking-tight text-ink">ProcureCall</p>
              <p className="mt-1 text-sm text-steel">
                AI buyer for equipment rental — one brief, itemized quotes, every fee on the tape.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-6">
              <div>
                <p className="text-xs font-medium text-ink">Product</p>
                <ul className="mt-2 space-y-1.5 text-sm text-steel">
                  {NAV.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="hover:text-ink">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-ink">Legal</p>
                <ul className="mt-2 space-y-1.5 text-sm text-steel">
                  {FOOTER_LINKS.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="hover:text-ink">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-line pt-4 text-xs text-steel sm:flex-row sm:items-center sm:justify-between">
            <span>© {year} ProcureCall. All rights reserved.</span>
            <span>Operated by Yannik Trinn</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
