# Rebuild status

Working notes for picking this up cold. The plan is `REBUILD-DESIGN.md`; this
file is only *where we are* and *what to watch out for*.

**Branch:** `claude/polymesh-staking-rebuild-tetxaz` · **Last phase:** 7 of 8

---

## Done

| Phase | What landed |
|---|---|
| 1a | Next 16 App Router scaffold, TS strict, Tailwind 4, ESLint 9, Vitest, knip, CI |
| 1b | Zod schemas, metric derivations, deterministic synthetic fixtures |
| 1c | Ingestion pipeline, chain compat layer, two scheduled workflows |
| 2 | Design system, app shell, client data layer, `/about` |
| 3 | Chart kit: banded multi-series, frame + table toggle, legend, sparkline, `/kitchen-sink` |
| 4 | `/network` — returns, stake, participation, decentralisation; URL-encoded era range; bundle brought under budget |
| 5 | `/operators` directory + 100 prerendered detail pages; sort/filter/CSV; global `?ops=` pin model; `npm run budget` |
| 6 | `/compare`, `/calculator`, `/slashing`; slash ingestion + `slashes.json`; penalty-curve maths; numeric-x chart |
| 7 | `/my-staking`; indexer client; lazy wallet + refcounted chain connection; tier-4 Live; `npm run assert:lazy` |

368 unit tests. Every phase green on typecheck, lint, test, knip, build, budget
and the lazy-load assertion.

## Next: Phase 8 — polish and launch

Every page now exists. What remains is the work that makes it shippable:

- **SEO and Open Graph** per route, social preview images, sitemap.
- **A11y audit** — automated (axe), then manual keyboard and screen reader.
  Charts and the two hand-rolled tables are where to look hardest.
- **Performance audit** against every §11 budget. `npm run budget` covers JS;
  LCP, INP, CLS and Lighthouse are still `‹measure›` in the design doc.
- **Delete `legacy/`.** It has served its purpose as a porting reference, and
  it is the source of the 64 Dependabot alerts on the default branch.
- **Restore the full knip check** — see item 3 below. This is an acceptance
  criterion, not a tidy-up.
- **Rewrite `README.md`**, and record a before/after comparison in
  `docs/baseline.md`.

### Carried into Phase 8 from earlier phases

- **`/slashing` has no offence-type column**, because `validatorSlashInEra`
  does not record one (see the note in `lib/schemas/data.ts`). The indexer
  client now exists, so the real type can come from `offences` events. Do not
  infer it from the fraction — the ranges overlap.
- **Unverified against a real wallet or chain.** See item 5.

## The one big caveat on Phase 7

**Nothing in `/my-staking` has ever talked to a real chain, indexer or wallet
extension.** The sandbox has no outbound chain egress and no browser extension,
so what is verified is: the pure logic (68 tests over the indexer client,
connection lifecycle, live subscriptions and address handling), the bundle
behaviour, and every failure path — which was exercised for real, because from
here every endpoint is unreachable.

What is *not* verified is the happy path. Specifically, treat these as
unproven until someone runs them against mainnet:

1. The GraphQL query shape in `lib/indexer/rewards.ts` — field names,
   `orderBy: [BLOCK_ID_ASC]`, and the `Rewarded` enum filter.
2. `readStashPosition` decoding, particularly the `bonded → ledger` controller
   indirection and the `RewardDestination` variants.
3. The extension handshake in `lib/chain/wallet.ts`.
4. Whether the tier-4 subscription names match the current runtime — the
   `validators` pallet split is handled, but only from the design doc's
   reading of the Portal.

Every one of these degrades to a visible, specific error rather than a wrong
number, which is the property that made it acceptable to ship unverified.

Run `npm run budget` after any change that touches an import graph, not just at
the end of a phase — three separate regressions have come in that way.

---

## Open items

### 1. Bundle — every route passes, with ~35 KB of headroom

Measure it with **`npm run build && npm run budget`**. Do not read the sizes
`next build` prints: Turbopack reports chunks uncompressed and grouped by entry,
which hid both regressions below completely. `scripts/budget.ts` gzips what each
exported HTML file actually references, and exits non-zero on a breach.

```
 ok     184.8 KB  /kitchen-sink/       loads every chart primitive by design
 ok     164.9 KB  /operators/
 ok     164.1 KB  /compare/
 ok     163.8 KB  /operators/[address]/
 ok     163.4 KB  /calculator/
 ok     161.9 KB  /network/
 ok     159.0 KB  /slashing/
 ok     155.7 KB  /
 ok     147.1 KB  /about/              ← shared floor
```

**The floor is 147.1 KB** — React 19, the Next 16 runtime, the app shell, the
query client and nuqs. A data-driven page adds 12–18 KB on top, comfortably
inside the 200 KB budget.

#### Correction: the Phase 5 "over budget" finding was a measurement bug

Phase 5 recorded `/operators` at 203.3 KB against a 185.6 KB floor, and left an
open question about whether the budget was even reachable. **Both numbers were
wrong by the same 39 KB, and the question was invented.**

`scripts/budget.ts` was counting Next's core-js polyfill bundle, which is
emitted as `<script noModule>` and therefore **never downloaded by any browser
that supports ES modules** — that is, every browser this site targets. It
inflated every route identically, which is precisely why it looked like a real
floor problem rather than a bug: the offset was invisible in comparisons between
routes and only showed up against the absolute budget line.

Two things worth keeping from it. First, a measurement tool needs its own
scrutiny — this one was written to catch a regression it did catch, and shipped
a 39 KB error in the same commit. Second, both optimisations it prompted were
still correct: the d3 and `cmdk` chunks were genuinely on the wire, and removing
them saved 17 KB each of bytes real browsers really fetch.

`/kitchen-sink` was exempt while the bug stood. The exemption is gone — it now
passes on merit, and one that nothing needs would only hide the next regression.

#### The same regression, three times

Each time, a module needed *one small thing* from a heavy dependency and got all
of it, on the critical path, defeating a `next/dynamic` split elsewhere.

1. **Phase 4** — `Sparkline` reused `valueScale`/`linePath` from
   `lib/charts/geometry`, putting d3 on every page with a stat tile. Rewritten
   dependency-free; it is now the most-instantiated chart component in the app,
   one per table row.
2. **Phase 5** — `useSelectedOperators` imported `MAX_NAMED_SERIES` from
   `banded-line-chart`, putting d3-scale + d3-shape (**17.1 KB gzip**) on every
   page that can pin an operator. Fixed by moving the palette to
   `lib/charts/palette.ts`, which has no imports and must keep it that way. Also
   removed a verbatim duplicate of `SERIES_TOKENS` in `legend.tsx`.
3. **Phase 6** — `OperatorPicker` imported `cmdk` (**13.3 KB gzip**) directly,
   putting it on `/compare` and `/calculator`. Fixed by code-splitting the
   implementation behind `next/dynamic`; `components/operator-picker.tsx` is now
   a thin wrapper and `-impl.tsx` holds the cmdk code.

The lesson: **a value import from a chart or widget module drags its whole
dependency in.** Type-only imports are fine — they are erased. If you need a
constant, put it somewhere with no imports; if you need a widget, split it.

### 2. `legacy/` still present

The previous app is preserved for reference while porting. Phase 8 deletes it.

### 3. knip is scoped down

`knip.jsonc` currently checks only unused *files* and duplicates, and `config/`
sits outside the project glob — both because modules are written a phase ahead
of their consumers. **Phase 8 must restore the full check.** This is an
acceptance criterion, not a tidy-up: dead code was a real problem in the old app
(625 unused lines in one file).

### 4. Every nav route now exists

Nothing in the nav or footer 404s any more. Resolved in Phase 7.

### 5. The chain stack must stay lazy — and it is checked

`@polkadot/api` and friends are **runtime dependencies** now, not dev-only, so
the browser can load them. They must never appear in a bundle fetched before
the user connects a wallet, enters an address or enables Live.

Two things enforce this, and both are needed:

- The **lint rule** in `eslint.config.mjs` bans static `@polkadot/*` imports.
- **`npm run assert:lazy`** greps the built output. This is the one that
  matters: a lint rule cannot see a *dynamic* import getting hoisted into a
  shared chunk because two routes happened to reference it, which is how a
  megabyte lands on the critical path without anyone writing a bad import.

Measured: `/my-staking` disconnected downloads no part of the 732 KB chain
chunk; it arrives only once a stash is set.

**Note on the assertion's markers.** They are package specifier strings
(`@polkadot/api`), not exported identifiers (`ApiPromise`). The first attempt
used identifiers and produced a false positive, because
`const { ApiPromise } = await import('@polkadot/api')` leaves the destructured
name in the *calling* chunk while the library sits in a separate lazy one. The
script also self-checks that its markers still match something in the build —
an assertion that can no longer fail is worse than no assertion.

### 6. Connection lifecycle

One websocket, reference-counted, in `lib/chain/browser-api.ts`. Wallet reads,
stash reads and Live all lease the same connection; it opens on the first lease
and closes on the last. That is what makes "turning Live off tears down every
subscription" true without each caller having to remember it — and what stops
turning Live off from disconnecting a wallet session.

**Always bound a browser dial.** `WsProvider` auto-reconnects by default, so
`ApiPromise.create` against an unreachable node never rejects — it retries
silently forever while the UI shows a skeleton. That is exactly the "spinner
turning forever with no message" failure this rebuild exists to remove, and it
was reproduced here before being fixed with a 12s timeout and `retry: false`.

### 7. The build needs `public/data`, and that directory is gitignored

Generated data lives on the orphan `data` branch. A source checkout therefore
has no `public/data`, and **the build fails without it** — `generateStaticParams()`
for `/operators/[address]` returns nothing, and Next 16 rejects an empty result
under `output: export`.

How each workflow gets data:

| Workflow | Source of `public/data` |
|---|---|
| `ci` | `npm run fixtures` — synthetic, deterministic |
| `pages` | checks out the `data` branch; falls back to fixtures with a warning |
| `ingest-era`, `snapshot-latest` | check out the `data` branch, then push back to it |

CI uses fixtures rather than the real branch on purpose: the job is a build
check, it must pass on a fork PR that has no access to the branch, and it must
not start failing because an ingestion run was mid-flight.

Locally: **`npm run fixtures` once after cloning**, or the build fails with a
message telling you exactly that.

### 8. A data change requires a redeploy

`dataUrl()` resolves to the site's own origin, so GitHub Pages serves the copy
of `public/data` baked into the last deployment. Writing to the `data` branch
changes nothing a visitor sees until the site is rebuilt — which is why `pages`
triggers on `workflow_run` from **both** ingestion workflows, not just the daily
era one. `latest.json` is tier 2 and carries an "as of HH:MM" stamp; without the
15-minute trigger that stamp would be pinned to deploy time.

The cost is a full rebuild for one small JSON file, four times an hour. If that
becomes a nuisance, `NEXT_PUBLIC_DATA_BASE_URL` points the data root at a CDN
and the snapshot stops needing a deploy at all.

---

## Things that will bite you

Each of these cost real debugging time. They are all fixed; the notes are so
they are not re-introduced.

- **`new WsProvider(url, 0)` does not connect.** `autoConnectMs: 0` disables
  dialling entirely, not just the retry loop. `connect()` dials explicitly and
  wraps readiness in a timeout.
- **The ingest cursor is the *contiguous* span, recomputed from chunks on disk.**
  Never write the chain's `lastCompleteEra` to the manifest — a bounded run then
  claims eras it never stored and the next run skips them silently. Regression
  tests in `scripts/ingest/coverage.test.ts`.
- **`--full` starts at `activeEra - historyDepth + 1`**, anchored on the active
  era, not the last complete one.
- **`keyRecords` `SecondaryKey` holds the DID directly**, not a tuple. Candidates
  are validated against the DID pattern before being returned.
- **A fixed SVG `viewBox` scaled to 100% shrinks text with the marks.** Charts
  measure their container (`useMeasuredWidth`) and draw at real pixel
  dimensions. Do not "simplify" this back to a viewBox.
- **`.at(-1)` returns the element for a one-item array**, so a `??` fallback
  never fires. This collapsed the time scale for single-era ranges.
- **Zod is development-only on the client** (`lib/data/validate.ts`). It costs
  64.6 KB gzip. The pipeline validates before publishing; production does a
  `schemaVersion` check. Do not add a static Zod import to app code.
- **`@polkadot/*` may only be reached via `await import()`.** Enforced by lint.
  A static import puts megabytes on the critical path.

---

## Conventions worth knowing

- **`null` is not zero.** An operator absent from an era did not score nothing.
  Nulls propagate through derivations, break chart lines rather than bridging
  them, and render as an em dash.
- **Ratios, not percentages,** everywhere except `lib/format`.
- **Chunks store chain facts only.** Anything derivable lives in
  `lib/metrics/derive.ts`, so there is one definition of each formula.
- **Colour follows the entity, never its rank.** Filtering must not repaint the
  survivors. Palette order is fixed and never cycled.
- **Every chart states its coverage** and ships a table view.

---

## Running it

```bash
npm ci
npm run fixtures     # synthetic dataset — no chain access needed
npm run dev

npm run check        # typecheck + lint + test
npm run build

# Needs a real RPC endpoint; will not run in a sandbox without egress:
npm run ingest:era -- --full
npm run ingest:latest
```

Real mainnet data compresses about twice as well as the synthetic fixtures
(90-era window: 55 KB real vs 112 KB synthetic), because actual operator counts
and commissions repeat far more than generated ones.
