/**
 * Per-route JavaScript budget check.
 *
 * Reads the exported HTML and gzips every script it references, which measures
 * the payload a browser actually fetches for a cold visit to that URL. That is
 * deliberately different from what `next build` prints: Turbopack reports chunk
 * sizes uncompressed and groups them by entry, so it can look reassuring while
 * a shared chunk quietly drags a charting library onto a page that never draws
 * a chart. This catches that; the build summary does not.
 *
 * Written after exactly that happened. `useSelectedOperators` imported the
 * palette cap from `banded-line-chart`, which put d3-scale and d3-shape (17.1
 * KB gzip) on the critical path of `/operators` — a page whose charts are all
 * behind `next/dynamic`. Nothing in the build output said so.
 *
 * Usage: `npm run build && npm run budget`. Exits non-zero on a breach, so CI
 * can gate on it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT_DIR = 'out';

/** §11 of the design doc. Gzipped, because that is what crosses the wire. */
const BUDGET_BYTES = 200 * 1024;

/**
 * Routes the budget does not apply to, with the reason.
 *
 * Keep this list short and justified. An exemption is a promise that the route
 * is not on a user's path, not a way to make a red number go away.
 *
 * Currently empty. `/kitchen-sink` was exempt while the measurement wrongly
 * counted the `nomodule` polyfill bundle; once that was fixed it came in under
 * budget like everything else, and an exemption nothing needs would only hide
 * the next regression.
 */
const EXEMPT: Record<string, string> = {};

/** Turbopack emits the same page under several paths; collapse them to one. */
const canonicalise = (route: string): string =>
  route.replace(/\/operators\/[^/]+\/$/, '/operators/[address]/');

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith('.html')) yield path;
  }
}

/**
 * Every script URL a **modern** browser actually downloads for this document.
 *
 * Both the `<script src>` tags and the bare strings in the Turbopack bootstrap
 * array, since the latter are fetched just as eagerly despite not being tags.
 *
 * `nomodule` scripts are excluded, and that exclusion is the whole reason this
 * function is more than one regex. Next emits a ~39 KB gzip core-js polyfill
 * bundle tagged `noModule`, which every browser that supports ES modules skips
 * entirely — every browser this site targets. Counting it inflated every route
 * by the same 39 KB and made five routes look marginally over budget when none
 * of them were. Measuring the wrong bytes is worse than not measuring: it
 * sends you optimising things that were never on the wire.
 *
 * Excluded by URL rather than by skipping the tag, because the same file is
 * also listed in the preload links and the bootstrap array.
 */
function scriptRefs(html: string): Set<string> {
  const refs = new Set<string>();
  const legacy = new Set<string>();

  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = /src="(\/[^"]*?\.js)"/.exec(tag[0])?.[1];
    if (src == null) continue;
    // React renders the attribute as `noModule`; HTML attribute names are
    // case-insensitive, so match either.
    if (/\bnomodule\b/i.test(tag[0])) legacy.add(src);
    else refs.add(src);
  }

  for (const match of html.matchAll(/(?:src|href)="(\/[^"]*?\.js)"/g)) refs.add(match[1]!);
  for (const match of html.matchAll(/"(\/_next\/static\/[^"]*?\.js)"/g)) refs.add(match[1]!);

  for (const src of legacy) refs.delete(src);
  return refs;
}

async function main(): Promise<void> {
  const gzipCache = new Map<string, number>();

  const gzipSize = async (path: string): Promise<number> => {
    const cached = gzipCache.get(path);
    if (cached != null) return cached;
    const size = gzipSync(await readFile(path), { level: 9 }).length;
    gzipCache.set(path, size);
    return size;
  };

  const seen = new Set<string>();
  const routes: { route: string; bytes: number; files: number; unresolved: number }[] = [];

  for await (const file of htmlFiles(OUT_DIR)) {
    const route = canonicalise(
      `/${relative(OUT_DIR, file).split(sep).join('/')}`
        .replace(/index\.html$/, '')
        .replace(/\.html$/, '/'),
    );
    // One representative per canonical route: the hundred operator pages share
    // a bundle, so measuring all of them says nothing extra.
    if (seen.has(route)) continue;
    seen.add(route);

    const html = await readFile(file, 'utf8');
    let bytes = 0;
    let unresolved = 0;
    const refs = scriptRefs(html);

    for (const ref of refs) {
      // Strip the basePath: refs are absolute URLs, `out/` is its root.
      const path = join(OUT_DIR, ref.replace(/^\/polymesh-staking-app/, ''));
      try {
        await stat(path);
        bytes += await gzipSize(path);
      } catch {
        unresolved += 1;
      }
    }

    routes.push({ route, bytes, files: refs.size, unresolved });
  }

  routes.sort((a, b) => b.bytes - a.bytes);

  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1).padStart(7)} KB`;
  const breaches: typeof routes = [];

  console.log(`Per-route JS, gzipped. Budget ${(BUDGET_BYTES / 1024).toFixed(0)} KB.\n`);

  for (const entry of routes) {
    const exemption = EXEMPT[entry.route];
    const over = entry.bytes > BUDGET_BYTES;
    if (over && !exemption) breaches.push(entry);

    const marker = exemption ? 'skip' : over ? 'OVER' : ' ok ';
    const note = exemption
      ? `  — exempt: ${exemption}`
      : over
        ? `  (+${((entry.bytes - BUDGET_BYTES) / 1024).toFixed(1)} KB)`
        : '';
    const warn = entry.unresolved > 0 ? `  [${entry.unresolved} refs unresolved]` : '';
    console.log(
      `${marker}  ${kb(entry.bytes)}  ${String(entry.files).padStart(2)} files  ${entry.route}${note}${warn}`,
    );
  }

  // The floor every route pays: framework, app shell, query client, router.
  // Worth printing, because a rise here moves every number above it at once and
  // is otherwise easy to misread as a page having grown.
  const floor = routes.at(-1);
  if (floor) console.log(`\nShared floor: ${kb(floor.bytes).trim()} (${floor.route})`);

  if (breaches.length > 0) {
    console.error(`\n${breaches.length} route(s) over budget.`);
    process.exitCode = 1;
  }
}

await main();
