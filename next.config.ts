import type { NextConfig } from 'next';

/**
 * The site is a fully static export served from GitHub Pages under a sub-path
 * (design doc Q3/Q7). Both the base path and the data origin are read from the
 * environment so that moving hosts — or serving data from R2 instead of the
 * same origin — is a config change rather than a code change.
 *
 * `NEXT_PUBLIC_BASE_PATH` must be empty or start with `/` and must not end
 * with one, which is what Next expects.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/polymesh-staking-app';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,

  // Static export cannot run the image optimiser, and every image we ship is
  // either an inline SVG or a small static asset, so optimisation buys nothing.
  images: { unoptimized: true },

  // GitHub Pages serves `/foo/` as `/foo/index.html`; trailing slashes keep
  // client-side routing and direct navigation resolving to the same URL.
  trailingSlash: true,

  reactStrictMode: true,

  typescript: {
    // Type errors must fail the build. The previous app disabled strictness and
    // accumulated ~30 `@ts-ignore`s as a result (design doc §2.7).
    ignoreBuildErrors: false,
  },

  // Next 16 dropped the `eslint` config key along with the built-in `next lint`
  // command. Linting runs as its own CI step (`npm run lint`) instead.
};

export default nextConfig;
