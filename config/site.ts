/**
 * Site-level constants. `BASE_PATH` and the data origin are the two values that
 * change when the site moves host (design doc Q3/Q7), so nothing may hardcode
 * either — including the data layer, which resolves every fetch through
 * `dataUrl()`.
 */

export const SITE = {
  name: 'Polymesh Staking Analytics',
  shortName: 'Polymesh Staking',
  description:
    'Track staking on Polymesh: operator performance, rewards, network health, and your own position.',
  repository: 'https://github.com/F-OBrien/polymesh-staking-app',
} as const;

/** Matches `basePath` in next.config.ts. Empty string, or a path with a leading slash. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/polymesh-staking-app';

/**
 * Where the generated data files live. Defaults to the site's own origin, which
 * is what GitHub Pages gives us. Point this at R2 or any CDN to move the data
 * without touching client code.
 */
const DATA_BASE_URL = process.env.NEXT_PUBLIC_DATA_BASE_URL ?? `${BASE_PATH}/data`;

/** Builds a URL for a generated data file. `path` is relative to the data root. */
export function dataUrl(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${DATA_BASE_URL.replace(/\/$/, '')}/${clean}`;
}

/**
 * Eras per chunk file. Shared by the pipeline (which writes them) and the
 * client (which resolves an era range to a chunk set), so it lives here rather
 * than being duplicated. Changing it invalidates every existing chunk.
 */
export const CHUNK_SIZE = 32;

/**
 * Era window shown by default. Full history runs to ~1,700 eras (design doc
 * §6.5a) and loading all of it on every visit would blow the payload budget;
 * 90 eras is roughly three chunks.
 */
export const DEFAULT_ERA_WINDOW = 90;
