import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SITE } from '@/config/site';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';
import { Providers } from '@/components/providers';
import './globals.css';

/*
 * Fonts are downloaded at build time and served from our own origin, so there
 * is no runtime request to Google and no render-blocking @import — which is
 * what the previous app did with Poppins.
 *
 * Inter over Poppins deliberately: Poppins is a geometric display face with
 * near-circular counters and a single-storey `a`. It reads well at 48px on a
 * marketing page and poorly at 12-13px in a dense table, which is most of this
 * site. Inter was drawn for small-size UI, has true tabular figures, and
 * disambiguates 1/l/I and 0/O — which matters on a page full of SS58 addresses.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-jetbrains',
});

export const metadata: Metadata = {
  title: {
    default: SITE.name,
    template: `%s · ${SITE.shortName}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    title: SITE.name,
    description: SITE.description,
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // The previous app pinned `width=1200`, which meant phones got a shrunken
  // desktop layout rather than a mobile one. This is the fix.
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Must run before paint so a stored theme does not flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Providers>
          {/* The shell renders immediately and is never gated behind a data
              fetch. The previous app put two nested full-page spinners in front
              of everything, so a slow RPC handshake meant a blank screen. */}
          <Nav />
          <div className="mx-auto min-h-[60vh] max-w-[1440px] px-4 py-8">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
