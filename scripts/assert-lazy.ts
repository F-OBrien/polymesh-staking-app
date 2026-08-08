/**
 * Asserts that the heavy chain stack is absent from every eagerly-loaded bundle.
 *
 * This is the Phase 7 acceptance criterion, checked against the built output
 * rather than trusted to the lint rule. The rule forbids static imports of
 * `@polkadot/*`; it cannot tell you that a *dynamic* import got hoisted into a
 * shared chunk because two routes happened to reference it, which is exactly
 * how a megabyte lands on the critical path without anyone writing a bad
 * import.
 *
 * The stakes are the whole performance argument. The previous app shipped
 * `@polkadot/api` and the Polymesh SDK to every visitor whether they connected
 * a wallet or not — megabytes before a single number rendered. Here, a visitor
 * who never touches `/my-staking` must never download any of it, and a visitor
 * who lands on `/my-staking` disconnected must not either.
 *
 *   npm run build && npm run assert:lazy
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const OUT_DIR = 'out';

/**
 * Markers that appear only inside the libraries themselves.
 *
 * These are the package specifiers each library embeds in its own
 * `packageInfo` banner, and picking them took one wrong attempt worth
 * recording. The obvious markers are the exported identifiers — `ApiPromise`,
 * `WsProvider`, `web3Enable` — but those also appear at every *call site*,
 * because `const { ApiPromise } = await import('@polkadot/api')` leaves the
 * destructured names in the calling chunk while the library sits in a separate
 * lazily-fetched one. Using them flagged a correctly-lazy 30 KB chunk as if it
 * held a 732 KB library.
 *
 * The specifier strings do not survive into call sites — a bundler rewrites
 * `import('@polkadot/api')` to a numeric module id — so their presence means
 * the library's own source is genuinely in the chunk.
 */
const FORBIDDEN: { marker: string; what: string }[] = [
  { marker: '@polkadot/api', what: '@polkadot/api' },
  { marker: '@polkadot/rpc-provider', what: '@polkadot/rpc-provider' },
  { marker: '@polkadot/extension-dapp', what: '@polkadot/extension-dapp' },
  { marker: '@polkadot/wasm-crypto', what: '@polkadot/wasm-crypto' },
  { marker: '@polkadot/util-crypto', what: '@polkadot/util-crypto' },
];

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith('.html')) yield path;
  }
}

/**
 * Scripts the document fetches on load.
 *
 * `nomodule` is excluded for the same reason `scripts/budget.ts` excludes it —
 * no browser this site targets downloads it. Chunks reached only through
 * `next/dynamic` are not referenced here at all, which is the entire point:
 * their absence from this list is what "lazy" means.
 */
function eagerScripts(html: string): Set<string> {
  const refs = new Set<string>();
  const legacy = new Set<string>();

  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = /src="(\/[^"]*?\.js)"/.exec(tag[0])?.[1];
    if (src == null) continue;
    if (/\bnomodule\b/i.test(tag[0])) legacy.add(src);
    else refs.add(src);
  }

  for (const match of html.matchAll(/(?:src|href)="(\/[^"]*?\.js)"/g)) refs.add(match[1]!);
  for (const match of html.matchAll(/"(\/_next\/static\/[^"]*?\.js)"/g)) refs.add(match[1]!);

  for (const src of legacy) refs.delete(src);
  return refs;
}

/**
 * Every chunk in the build carrying a marker, largest first.
 *
 * Used only to confirm the markers still detect something — if the stack is
 * present at all, it must show up here.
 */
async function findMarkersAnywhere(): Promise<{ file: string; kb: number }[]> {
  const dir = join(OUT_DIR, '_next', 'static', 'chunks');
  const hits: { file: string; kb: number }[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return hits;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.js')) continue;
    const path = join(dir, entry);
    const source = await readFile(path, 'utf8');
    if (FORBIDDEN.some(({ marker }) => source.includes(marker))) {
      hits.push({ file: entry, kb: Math.round((await stat(path)).size / 1024) });
    }
  }

  return hits.sort((a, b) => b.kb - a.kb);
}

async function main(): Promise<void> {
  const cache = new Map<string, string[]>();
  const failures: { route: string; chunk: string; found: string[] }[] = [];
  let routesChecked = 0;
  let chunksScanned = 0;

  const scan = async (path: string): Promise<string[]> => {
    const cached = cache.get(path);
    if (cached) return cached;

    chunksScanned += 1;
    const source = await readFile(path, 'utf8');
    const found = FORBIDDEN.filter(({ marker }) => source.includes(marker)).map(
      ({ marker, what }) => `${marker} (${what})`,
    );
    cache.set(path, found);
    return found;
  };

  for await (const file of htmlFiles(OUT_DIR)) {
    const route = `/${relative(OUT_DIR, file).split(sep).join('/')}`.replace(/index\.html$/, '');
    routesChecked += 1;

    for (const ref of eagerScripts(await readFile(file, 'utf8'))) {
      const path = join(OUT_DIR, ref.replace(/^\/polymesh-staking-app/, ''));
      try {
        await stat(path);
      } catch {
        continue;
      }

      const found = await scan(path);
      if (found.length > 0) {
        failures.push({ route, chunk: ref.split('/').pop() ?? ref, found });
      }
    }
  }

  console.log(
    `Checked ${routesChecked} routes and ${chunksScanned} eagerly-loaded chunks for the chain stack.`,
  );

  // Self-check. An assertion whose markers match nothing anywhere in the build
  // passes for the wrong reason and would keep passing after someone renamed a
  // package or changed bundlers. Proving the markers still find the library in
  // the lazy chunks is what makes a green result mean something.
  const lazyHits = await findMarkersAnywhere();
  if (lazyHits.length === 0) {
    console.error(
      '\nNone of the markers matched any chunk, eager or lazy — so this check proved nothing.\n' +
        'Either the chain stack is no longer bundled at all, or the markers in FORBIDDEN are stale.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Markers verified against ${lazyHits.length} lazily-loaded chunk(s), largest ${lazyHits[0]!.kb} KB.`,
  );

  if (failures.length === 0) {
    console.log('None of it is loaded before the user connects. ✓');
    return;
  }

  console.error('\nThe chain stack is on the critical path:\n');
  // One line per route/chunk pair: the same chunk failing on several routes
  // means it landed in a shared bundle, which is the more serious diagnosis.
  for (const failure of failures) {
    console.error(`  ${failure.route}  ${failure.chunk}\n    ${failure.found.join('\n    ')}`);
  }
  console.error(
    '\nReach the chain only through `await import()` inside a function — never at module scope,\n' +
      'and never from a module that an eagerly-rendered component imports.',
  );
  process.exitCode = 1;
}

await main();
