import Link from 'next/link';
import { SITE } from '@/config/site';

/**
 * Footer. Carries the secondary destinations and, importantly, the honesty
 * links: where the numbers come from and how they are calculated.
 */
export function Footer() {
  return (
    <footer
      className="mt-16 border-t"
      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Secondary">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <li>
              <Link href="/slashing">Slashing</Link>
            </li>
            <li>
              <Link href="/about">Methodology &amp; glossary</Link>
            </li>
            <li>
              <a href={SITE.repository} target="_blank" rel="noreferrer noopener">
                Source
              </a>
            </li>
          </ul>
        </nav>

        <p className="m-0" style={{ color: 'var(--text-muted)' }}>
          Community project. Not affiliated with Polymesh Labs. Not financial advice.
        </p>
      </div>
    </footer>
  );
}
