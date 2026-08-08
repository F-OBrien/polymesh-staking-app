# Rebuild status

Working notes for picking this up cold. The plan is `REBUILD-DESIGN.md`; this
file is only *where we are* and *what to watch out for*.

**Branch:** `claude/polymesh-staking-rebuild-tetxaz` · **Last phase:** 5 of 8

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

239 unit tests. Every phase green on typecheck, lint, test, knip and build.

## Next: Phase 6 — `/compare`, `/calculator`, `/slashing`

Three pages, all of which can lean on what Phase 5 built:

- **`/compare`** is mostly assembled already. `useSelectedOperators` is the
  selection model, `buildOperatorRows` produces the rows, and
  `LazyEraSeriesChart` draws them against the field band. What is missing is a
  side-by-side layout and the `cmdk` combobox for adding operators without
  going back to the directory — `cmdk` is installed and still unused.
- **`/calculator`** needs no new data: `stakingReturns`, `curveInflation` and
  `operatorApr` in `lib/metrics/staking.ts` are ported and tested. Keep the
  inputs in the URL so a scenario can be shared, same as `?eras=` and `?ops=`.
- **`/slashing`** is the one with an open question. Nothing in the pipeline
  currently writes slash events; check `lib/chain/compat.ts` for what the
  historical storage shape allows before designing the page, because slashing
  APIs are among the things that moved across the v6/v7/v8 upgrades.

Watch the bundle — `/operators` is 3.3 KB over. Run `npm run budget` after any
change that touches an import graph, not just at the end of a phase.

---

## Open items

### 1. Bundle — `/operators` is 3.3 KB over, everything else passes

Measure it with **`npm run build && npm run budget`**. Do not read the sizes
`next build` prints: Turbopack reports chunks uncompressed and grouped by entry,
which hid the d3 regression below completely. `scripts/budget.ts` gzips what
each exported HTML file actually references, and exits non-zero on a breach.

```
skip    221.9 KB  /kitchen-sink/     exempt — workbench, loads every primitive
OVER    203.3 KB  /operators/        (+3.3 KB)
OVER    202.2 KB  /operators/[address]/  (+2.2 KB)
 ok     199.7 KB  /network/
 ok     194.2 KB  /
 ok     185.6 KB  /about/            ← shared floor
```

**The floor is 185.6 KB** — React 19, the Next 16 runtime, the app shell, the
query client and nuqs. Every route pays it, so the 200 KB budget leaves about
14 KB for a page's own code. `/operators` uses 17.7 KB: the table, the
per-row sparklines, sorting, filtering and CSV. That is the honest cost of the
densest page in the app, and closing the gap would mean splitting cohesive
modules for ~700 bytes each. Left for the Phase 8 perf audit to settle
deliberately — either by trimming the floor (the query provider is mounted for
static pages that never query) or by re-expressing the budget as page code over
the floor, which is what it is really trying to constrain.

**Do not "fix" it by raising the number.** One revision is already recorded in
§11 of the design doc; a second without a measurement behind it turns the budget
into decoration.

#### The d3 regression, twice

Both times, a module needed *one constant* from the chart kit and got d3 with it.

1. Phase 4: `Sparkline` reused `valueScale`/`linePath` from `lib/charts/geometry`.
   Rewritten dependency-free — it is now the most-instantiated chart component
   in the app, one per table row.
2. Phase 5: `useSelectedOperators` imported `MAX_NAMED_SERIES` from
   `banded-line-chart`, putting d3-scale + d3-shape (**17.1 KB gzip**) on the
   critical path of every page that can pin an operator — including pages whose
   charts are all behind `next/dynamic`. Fixed by moving the palette to
   `lib/charts/palette.ts`, which has no imports and must keep it that way.
   This also removed a verbatim duplicate of `SERIES_TOKENS` in `legend.tsx`.

The lesson worth carrying: **a value import from a chart module is a dependency
on d3.** Type-only imports are fine — they are erased. If you need a constant,
put it somewhere with no imports.

`/kitchen-sink` is an internal `noindex` workbench that loads every primitive at
once by design. It is exempt in `scripts/budget.ts`, and should not be optimised.

### 2. `legacy/` still present

The previous app is preserved for reference while porting. Phase 8 deletes it.

### 3. knip is scoped down

`knip.jsonc` currently checks only unused *files* and duplicates, and `config/`
sits outside the project glob — both because modules are written a phase ahead
of their consumers. **Phase 8 must restore the full check.** This is an
acceptance criterion, not a tidy-up: dead code was a real problem in the old app
(625 unused lines in one file).

### 4. Pages that 404 in nav

`/network`, `/operators`, `/compare`, `/my-staking`, `/calculator` are linked in
the nav but not built yet, so Next prefetch logs 404s. Expected until Phases 4–7.

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
