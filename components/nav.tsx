'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SITE } from '@/config/site';
import { ThemeToggle } from './theme-toggle';

/**
 * Primary navigation.
 *
 * Labels say what the pages contain. The previous app used "Overview /
 * History / Trends / Current Info", which describe the *shape* of the data
 * rather than the question each page answers — you had to click to find out.
 *
 * Slashing and About are reachable from the footer: real destinations, but not
 * competing for attention with the five things most visitors want.
 */
const LINKS = [
  { href: '/network', label: 'Network' },
  { href: '/operators', label: 'Operators' },
  { href: '/compare', label: 'Compare' },
  { href: '/my-staking', label: 'My Staking' },
  { href: '/calculator', label: 'Calculator' },
] as const;

export function Nav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    // Trailing slashes are on (static export), so compare on the prefix and
    // treat a section's detail pages as part of that section.
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--page-plane) 88%, transparent)',
      }}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span
            aria-hidden="true"
            className="block size-2.5 rounded-full"
            style={{ background: 'var(--series-1)' }}
          />
          <span className="font-semibold tracking-tight">{SITE.shortName}</span>
        </Link>

        <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex flex-wrap items-center gap-1">
            {LINKS.map(({ href, label }) => {
              const active = isActive(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className="block rounded-md px-2.5 py-1.5 text-sm no-underline transition-colors"
                    style={{
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: active ? 'var(--surface-1)' : 'transparent',
                      // Active state is carried by weight and background, not
                      // colour alone.
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
