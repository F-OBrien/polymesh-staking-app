# Rebuild status

Working notes for picking this up cold. The plan is `REBUILD-DESIGN.md`; this
file is only *where we are* and *what to watch out for*.

**Branch:** `claude/polymesh-staking-rebuild-tetxaz` · **Last phase:** 3 of 8

---

## Done

| Phase | What landed |
|---|---|
| 1a | Next 16 App Router scaffold, TS strict, Tailwind 4, ESLint 9, Vitest, knip, CI |
| 1b | Zod schemas, metric derivations, deterministic synthetic fixtures |
| 1c | Ingestion pipeline, chain compat layer, two scheduled workflows |
| 2 | Design system, app shell, client data layer, `/about` |
| 3 | Chart kit: banded multi-series, frame + table toggle, legend, sparkline, `/kitchen-sink` |

218 unit tests. Every phase green on typecheck, lint, test, knip and build.

## Next: Phase 4 — `/network`

Charts C1–C10 from the design doc, plus the era-range control with URL state.
Everything it needs already exists: `EraSeriesChart` is the composition to
reuse, and `useEraSeries()` supplies range-resolved, stitched data.

**Settle the bundle question here** (see below) — it is the one open item that
gets worse the longer it is left.

---

## Open items

### 1. Chart pages exceed the JS budget

`/kitchen-sink` measures **218 KB gzip against a 200 KB budget**. Home is
unaffected (191 KB) because chart code is route-split, but `/network` will land
where kitchen-sink is.

Measured contributions: `d3-scale` + `d3-shape` **14.4 KB**, Radix Tabs
**9.0 KB**. The framework floor is ~182 KB (`/about`, which has no application
code at all).

Not yet fixed because the right approach depends on Phase 4's layout. Most
likely: lazy-load below-the-fold charts so only the first is on the critical
path. Do not raise the budget again without measuring first.

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
