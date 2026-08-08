# Rebuild status

Working notes for picking this up cold. The plan is `REBUILD-DESIGN.md`; this
file is only *where we are* and *what to watch out for*.

**Branch:** `claude/polymesh-staking-rebuild-tetxaz` · **Last phase:** 6 of 8

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

299 unit tests. Every phase green on typecheck, lint, test, knip and build.

## Next: Phase 7 — `/my-staking`

The last page, and the only one that needs a wallet. Three pieces:

- **Lazy wallet integration.** `@polkadot/api` must appear in no bundle loaded
  before the user connects — the lint rule already forbids static imports, and
  Phase 7's acceptance criterion is a CI assertion against the build output.
- **An indexer client.** Reward history is not in chain state; it comes from
  `StakingEvent` where `eventId` is `Rewarded`, filtered by `stashAccount`.
  The endpoint caps at 100 results, so pagination is required, not optional.
  Endpoints are in `config/networks.ts`.
- **The tier-4 Live toggle** (§6.6a), which shares the same lazy load.

The disconnected state is the part worth getting right, and the acceptance
criteria say so: it must be fully usable, including the manual-address
fallback, so anyone can inspect any stash without an extension.

**`/slashing` has an open follow-up.** The offence table has no type column
because `validatorSlashInEra` does not record one — see the note in
`lib/schemas/data.ts`. The indexer being built for `/my-staking` can supply the
real offence type, and that is the natural moment to add it. Do not infer it
from the fraction.

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

### 4. Pages that 404 in nav

Only `/my-staking` remains, which lands in Phase 7. Next prefetch will log a 404
for it until then.

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
