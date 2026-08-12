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

458 unit tests. Every phase green on typecheck, lint, test, knip, build, budget
and the lazy-load assertion.

**But "phase done" has meant "page exists", not "phase acceptance met".** An
audit of the §8.3 chart catalogue against the code found nine of twenty-four
charts absent and three in the wrong form — including every chart the
`/calculator` page was supposed to have. See §"What is actually still missing"
before planning any cleanup work.

**After Phase 7, on a machine with chain egress:** the reward query, stash
decoding and slashing policy were all corrected against real mainnet, and
`@polymeshassociation/polymesh-types` was adopted (types only). See the two
sections below — that work found more real bugs than any phase.

## Start here if you are picking this up cold

Read this section, then §"Next: Phase 8". Everything else is reference.

**Where the work happens:** branch `claude/polymesh-staking-rebuild-tetxaz`.
Never push to another branch without asking. Do not open a PR unless asked.

**Before anything else:** `npm ci`, then `npm run fixtures` if `public/data` is
empty. The build *fails* without that directory — see open item 7. If it
already holds real ingested data, `fixtures` will refuse rather than delete it.

**The gate is** `npm run format:check && npm run check && npm run knip && npm run build && npm run budget && npm run assert:lazy`.

`format:check` is easy to forget — `npm run check` is typecheck + lint + test
only, and CI runs Prettier separately. It has broken the build twice.
All of it must pass before a commit. `budget` and `assert:lazy` read the built
output, so they need `npm run build` first.

**This machine has chain egress; the previous sandbox did not.** That matters
enormously — see §"Phase 7 against real mainnet". Four probes exist for
re-validating against the live chain, and every one of them has already found a
bug that review did not:

| Probe | Checks |
|---|---|
| `npm run probe:indexer` | the reward GraphQL query against the live schema |
| `npm run probe:stash` | `readStashPosition` decoding, incl. the controller indirection |
| `npm run probe:slashes` | that slash storage exists and is genuinely empty |
| `npm run probe:slashing-switch` | `validators.slashingAllowedFor` |
| `npm run probe:payouts` | that every exposure page is actually claimed and paid |
| `npm run probe:indexer-caps` | page-size cap, server-side aggregates, era-transition events |
| `npm run probe:archive` | that pruned era storage still reads at a historical block |

**Local data state:** `public/data` holds a real mainnet ingest, eras 1664–1748,
86 operators, plus `latest.json`, `slashes.json` (`scope: Validator`, zero
offences) and `era-index.json` (all 1,749 eras, 34 KB). It is gitignored. The `data` branch on GitHub is **still empty** —
nothing is deployed yet. Populating it is either the `Ingest era` workflow once
this is merged to `main`, or a deliberate push of `public/data` to that branch.
That decision is the user's; it has not been made.

### The single most useful lesson from this session

**Nothing written against a chain without running it against that chain was
correct.** Three of four items flagged "unverified" in Phase 7 turned out to be
wrong, one of them silently: a renamed event enum that dropped 30% of reward
history while still looking plausible. Then `/slashing` was found to be stating
the opposite of Polymesh's actual slashing policy, and `/operators` to be
warning people off the most-nominated nodes on a false premise.

If you write chain-facing code here, run it against mainnet before believing
it. Add a probe if one does not exist.

**And the corollary, learned the hard way twice:** a *fix* made without running
it against the chain is no safer than the bug. This file previously recorded
that ordering the reward query by `CREATED_BLOCK_ID_ASC` shuffled history
lexicographically, and it was "fixed" to `DATETIME_ASC` on that reasoning.
Both halves were wrong — the block id is deliberately zero-padded so a string
sort is a numeric sort, and `datetime` is the field that is *not* fixed-width.
The "fix" moved the query onto the less safe key and nobody noticed, because
the two orders agree on today's data.

---

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

### Review pass on `/operators` — five findings, four of them real bugs

Done after Phase 7, from a read of the rendered page rather than the code. Data
refreshed to era 1748 first.

**1. The "full" badge was materially wrong — removed.** Any operator with more
than 64 nominators was badged `full`, with "new nominators may earn nothing" on
the tooltip, the stat tile and the `/my-staking` warnings, plus a "Hide full"
filter. Polymesh uses paged exposures and rewards **every** page; the runtime
has a test named `test_nominators_over_max_exposure_page_size_are_rewarded`, and
`validators::payouts()` pays each page automatically. Verified on mainnet — see
the probe table above. Seven operators were affected, including the three
most-nominated on the network, so the site was steering people *away* from the
most popular nodes on a false premise. The `oversubscribed` field is gone from
the schema; `pageCount` stays as a neutral fact and reaches only the CSV.

This is the second instance of the same failure mode as the slashing claim:
**Substrate's default semantics assumed, and wrong for Polymesh.** Both were
found by reading the runtime rather than the docs. Worth doing again for any
remaining claim about what a nominator earns or risks.

**2. Pinned operators did not survive navigation — fixed.** The selection lived
only in `?ops=`, and `<Link>` carries no query string, so pinning in the
directory and clicking Compare landed on an empty page — while the copy claimed
the selection travelled with you. Now `lib/data/selection-store.ts` mirrors it
to `localStorage`, consulted only when the URL is silent, so a shared link still
wins. Clearing writes `[]` — distinct from "never pinned" — or the restore path
would put the pins straight back and the clear button would look broken.
Verified in a browser across nav, reload, a pass through `/network`, clear, and
a shared link overriding stored pins.

**3. "The five largest operators" was vague *and* nearly meaningless.** It
ranked on total stake, which the election equalises: the whole active set spans
3.9% and the top five sit within 0.1% of each other. Now the five
highest-returning by mean net APR over the selected range, named as such.
`rankOperators` takes `aprNet`/`aprGross` and ranks those on the mean rather
than the latest era, since one era's return is noisy enough to reshuffle the
chart daily.

**4. "Return" meant three different things.** One column, labelled `Return`,
was a mean over whatever range was selected, after commission, and said none of
that. Split into **This era (est.)**, **Last era**, and **Mean (N eras)**, each
labelled with its period, under one "after/before commission" control — the
basis being invisible is the usual reason two staking sites appear to disagree
about the same operator. Also on `/compare` as three rows and on the detail page
as three tiles.

**5. Page prose folded into tooltips.** `components/info-tip.tsx` — hand-rolled,
not Radix, for the same budget reason as the table. Two mechanics are
load-bearing: the panel is `position: fixed` and measured in the event handler,
because `overflow-x-auto` on the table clipped an absolutely-positioned one and
measuring in an effect trips `react-hooks/set-state-in-effect`; and it forces
`white-space: normal`, because table headers set `nowrap` and the prose ran off
the side of the panel.

### The forward-looking return, and where Live went

This closes the request below. `deriveEstimatedEraApr` in `lib/metrics/derive.ts`
annualises an operator's *share of points so far this era* against its current
stake:

```
gross = inflation × issuance × points ÷ (totalPoints × stake)
```

`erasPerYear` cancels, so it does not depend on knowing the era length. Two
things make it trustworthy rather than a guess:

- **It reconciles with the network figure.** Equal points and equal stake for
  every operator returns `inflation ÷ stakingRatio` exactly — the same number
  `stakingReturns` derives from the reward curve. Pinned by a unit test.
- **The curve matches what the chain actually pays.** Measured over eras
  1744–1748: curve-implied pot 339,042 POLYX against 338,670 actual, a 0.11%
  gap. The model is not drifting from reality.

The estimate is honest about its own noise: the column header shows how far into
the era we are (tier 3, no network), and the tooltip says that sorting by it
puts the *lucky* near the top alongside the genuinely performing.

**Live lives on `/operators`**, in the filter row. With it on, the two
current-era columns — This era and Points — stop being a 15-minute snapshot and
update per block from `LiveState.eraPoints`. That is the "is my node producing
right now" confirmation, and it feeds the forward-looking number rather than
sitting in a chart of its own.

Still open from the original request: a **points-accruing-now chart** rather
than a column, if watching the race block by block turns out to matter. The data
is already wired; it is a chart, not a pipeline change.

### Era index, indexer cost, and what is still open

Three of the six things raised after the `/operators` review are done. The
research behind them is in the probes above; run those before trusting any of
it again.

**`data/era-index.json` — every era's start block and time, all 1,749 of them,
34 KB.** Built from indexer era-transition events by `npm run ingest:era-index`
(~18 requests, no RPC). Verified against chain-sourced chunk data: all 85
overlapping eras match exactly. This one artefact answers three separate
questions — which era a reward was earned in, what date an era was, and which
block the backfill should read an era at.

It is **not** on any critical path: chunks already carry `eraStart` for the eras
they hold, so `useEraIndex(enabled)` is opt-in and currently loads only
alongside the reward detail on `/my-staking`.

**Reward history is now two queries, not 119.** The headline total and payout
count come from one server-side aggregate; the event walk is behind an explicit
"Load full payout history" button that states its own cost. Measured on a real
stash: the page went from 19 requests to 2, and the walk still agrees with the
aggregate to the base unit.

**The era column in the reward CSV is populated.** It used to be blank for
almost every row — the block→era map came from our ~85 chunks. Payouts from
November 2021 now resolve to eras 8, 9, 10, … The attribution is block-based
(exact integer) rather than timestamp-based, and rests on one documented
inference: Polymesh pays automatically as soon as an era closes, so a payout
belongs to the era before the one it landed in. Measured at 14 blocks in 2026
and 6 seconds in 2021.

### Bonded is not assigned — `/my-staking` now says so

Raised by the user: the page showed what was *bonded* and never what the
election actually did with it. Three separate facts were invisible, and the
first stash tested demonstrated all of them.

**2,019,000 POLYX, nominating eight elected operators, 100% assigned to one.**
Phragmén optimises the network's spread of stake, not the nominator's, so
nominating more operators is not by itself diversification. Anyone reading the
old nomination list would have believed they were spread across eight.

**That same stash was assigned nothing in the previous era** — it nominated
during it, and a nomination does not take effect until the next election. Since
rewards for era N are paid during era N+1, it was earning nothing right then
while everything on screen looked correct.

`lib/chain/allocation.ts` reads both eras: one prefix scan per nomination per
era (`erasStakersPaged` is keyed `(era, validator, page)`, and nominations cap
at 16, so it is bounded). The page gains an "Assigned this era" tile, an
"Assigned this era" column per nomination, and notes that fire only when there
is something to explain.

**A second, worse bug — found by the user, proven on the same stash.**
Nominations can be changed at any time; exposure is fixed at the election. Change
them mid-era and the stake stays with the operator just dropped, who is no longer
in `staking.nominators(stash).targets`. The first implementation iterated the
nomination list, so it could not see that stake at all — and did not merely omit
it, it stated the opposite: *"Payouts landing now are for era 1749, when none of
this stake was assigned — so expect nothing from them."*

Live on mainnet, that stash held **2,019,000 POLYX assigned in era 1749 to an
operator it no longer nominates**. It was earning, and would be paid.

Fixed by searching the whole era's exposure instead: `erasStakersPaged.entries(era)`
with no validator argument cannot miss anything. Measured against the
per-nomination reads it replaces — **1 RPC call vs 16, ~425ms vs ~356ms, 74 KB,
2,034 edges across 86 operators**. Fewer round trips and no way to be wrong. The
design doc calls this the heaviest query available (§2.1), but that warning is
about the previous app issuing it 85 times on every page load; twice, on demand,
for one address, is a different thing. `npm run probe:exposure-scan`.

The result is the **union** of nominated and exposed, so both differences are
visible: nominated-but-not-backed, and backed-but-no-longer-nominated. The latter
gets its own table row and its own note. There is also no `targets.length === 0`
shortcut any more — a chilled stash still has exposure and still earns.

**One real bug found doing it: a tier mismatch.** The allocation read was keyed
on `latest.json`'s `activeEra`, which lags the chain by up to fifteen minutes —
and exposure is keyed by era. Across a boundary it read the *previous* era and
reported a fully-assigned stash as assigned nothing. Anything read over the
socket must ask the socket what era it is; the snapshot's era is right for
snapshot-derived figures and wrong for these. `npm run probe:allocation -- <stash>`.

### Node numbers dropped — they were ours, and they were unstable

Raised by the user: the numbers beside operator names ("Bitgo 5", "DigiClear 2")
looked authoritative and were not. Nothing on chain or in the official registry
carries them — `assignNodeLabels` invented them from each stash's position in a
lexicographic sort of that identity's addresses.

That makes them **actively unstable**, not merely arbitrary: an operator adding a
stash that sorts earlier renumbers every node after it, so a "Bitgo 5" noted
today can be a different node tomorrow, silently and with no version bump.

`nodeLabel` is gone from the schema, the pipeline and every consumer. Operators
are identified by `name` plus address.

**The consequence needed handling.** 25 of 86 mainnet names are now shared —
DigiClear and Entoro run three nodes each — so a chart legend would have read
"DigiClear" three times, which §8.1 rule 5 forbids. `lib/data/operator-label.ts`
appends a truncated address *only* where a name is shared:

    Assetera                    — the only node under that name
    DigiClear (2HW34b…sNz3Dz)   — one of three

Ambiguity is judged against the whole registry rather than what is on screen, so
a label never changes as a filter or selection changes.

### Chain status surfaced — era, session and election

Raised by the user: none of the era index, era progress, era start/end, session
position or election status appeared anywhere. All of it was already in
`latest.json`'s anchors; only a single countdown tile used any of it.

`components/era-status.tsx` on `/network` shows four cells — current era with
progress, era start and end, session *n* of 6 with its own progress, and the
election phase. **Tier 3 throughout**: derived in the browser from the anchors
against the local clock. Verified in a browser that the values tick with
**zero network requests**.

Session position is derived from elapsed time rather than from the snapshot's
`currentSessionIndex`, which is fixed at write time and would sit on the wrong
session for most of the fifteen minutes until the next snapshot. It clamps to
the last session rather than reporting "session 7 of 6" when the snapshot lags
a boundary.

**`readElectionPhase` returned `'Off'` when the pallet was absent** — inventing
a status for machinery that might not exist, the same trap as reading an absent
storage map as "no entries". It now returns `'Unknown'`, which the UI renders as
"Not reported". Polymesh mainnet *does* carry `electionProviderMultiPhase`
(verified), so the phase shown is real.

Worth knowing when reading `latest.json`: **`activeEra` and
`eraStatus.currentEra` are different numbers.** The first is the era running;
the second is `staking.currentEra`, which runs one ahead once the next era is
planned. The panel uses `activeEra` and mentions the planned era only when they
differ.

## What is actually still missing

Audited against §8.3 and §9 of the design doc by reading the code, not the
phase log. Phases were marked done when the *page* existed; several of their
charts never landed.

### Chart triage — build on merit, not to complete the catalogue

The catalogue was written before anyone had measured Polymesh. Several of its
charts turn out to say nothing *here*, because the election equalises exposure
and because there has never been a slash. Judged one at a time:

| # | Verdict | Why |
|---|---|---|
| C3 | **built** | Explains every APR on the site, and corrected a wrong claim |
| C23 | **built** | Was an axis-less sparkline; now daily bars + cumulative |
| C22 | **built, redesigned** | The specced bar-with-whiskers restates the tiles; an accumulation curve with a widening band does not |
| C2 gauge | **dropped** | C3 says everything a gauge would, with the cap marked. A gauge is low data-ink and would repeat it |
| C10 top-N stake share | **dropped** | The election equalises exposure — Gini 0.008 — so this is eight identical bands |
| C17 stake by operator | **dropped** | Same reason: 86 near-identical bars, spanning 3.9% |
| C21 slashing timeline | **dropped for now** | Zero offences have ever occurred. A timeline of nothing. Revisit if one does |
| C6 rewards as a bar | **left as a line** | Semantically a bar, but 90+ daily bars read as a solid block. A deviation, recorded |
| C18 points by operator | **built, redesigned** | The specced form is a leaderboard of luck — see below. Rebuilt as production against expected, over the range, with the noise band drawn |
| C24 my operators | **built, plus a second chart** | The specced banded chart shows outages and trend but cannot rank; the production chart, with the reader's picks coloured, can |
| C15 cumulative deviation | **superseded** | It exists to show *persistent* over/under-performance, which the production chart now does with an explicit significance test |
| C19 consistency beeswarm | **marginal** | Distribution shape is real information, but box plots are hard to read and Steadiness covers most of it |
| C20 nominator histogram | **deferred** | Needs `data/eras/{era}.json`, which is not generated. High cost for medium value |

**Not in the catalogue, and arguably better than several things in it.** These
come from what this session actually learned about the chain:

- **Performance against expected — built**, as `components/production-chart.tsx`
  on `/operators` and `/my-staking`. It replaced C18 rather than joining it.
- **Earned versus the network average — built**, as the choice verdict on
  `/my-staking`, but *forward*-looking. The retrospective version cannot be
  built honestly: reward events carry no validator (introspected, `StakingEvent`
  has `stashAccount`/`amount`/`identityId` and nothing else), and the
  counterfactual also needs per-era exposure, which is an archive read per era.
- **Commission distribution — built**, as `components/commission-spread.tsx`,
  and as a tally rather than the proposed histogram: mainnet has four distinct
  commissions and 68 of 86 operators charge exactly 10%, so bins would imply a
  continuum that does not exist.

### What measuring the chain did to the chart plan

Three charts were changed or dropped because the data said the question they
asked has no answer here. Recorded because the reasoning is not recoverable
from the code alone:

- **One era's reward points are pure slot luck.** A third of the way into era
  1750 the field's spread was 12.5% against the 13.4% a lottery predicts; over
  a *complete* era, 8.1% against 7.9%. Sorting that produces a leaderboard of
  coin flips. Accumulated over 86 eras, ±1.38% of spread remains, of which
  ±0.85% is luck and ±1.09% is real — small, but 21 of 90 operators sit beyond
  two standard errors.
- **Per-era APR is the same problem.** Measured cross-sectional spread 8.1% an
  era, which is the points noise passed through. C11 and C24 are therefore
  charts of *outages and trend*, and their copy now says so instead of inviting
  a ranking.
- **Commission is the bigger lever, by an order of magnitude.** Production
  separates the field by ~1.1% relative; commission spans 7% to 10%, worth
  ~0.22 points of APR each. A nominator optimising performance is working on
  the smaller term.

### Chart catalogue — after the triage above

| # | Chart | Page | State |
|---|---|---|---|
| C2 | Staking ratio vs the 70% ideal — gauge | Home, Network | **dropped** — C3 says it all, with the cap marked |
| C3 | Reward & inflation curve | Network, Calculator | **built** |
| C6 | Rewards per era | Network | left as a line, deliberately — 90 daily bars read as a solid block |
| C10 | Top-N stake share, stacked area | Network | **dropped** — the election equalises exposure, Gini 0.008 |
| C15 | Cumulative deviation from average | Operators, Detail | **superseded** by the production chart, which tests significance |
| C17 | Current-era stake by operator | Operators | **dropped** — 86 near-identical bars spanning 3.9% |
| C18 | Current-era points by operator | Operators | **built, redesigned** — production against expected, over the range |
| C19 | Operator consistency, box/beeswarm | Detail | **absent** |
| C20 | Nominator distribution histogram | Detail | **absent** |
| C21 | Slashing timeline | Slashing | **dropped for now** — zero offences have ever occurred |
| C22 | Reward projection | Calculator | **built**, as an accumulation curve with a widening band |
| C23 | My rewards over time | My Staking | **built** — bars with day/week/month/year grouping, plus a cumulative panel |
| C24 | My operators' performance | My Staking | **built**, plus the production chart for the ranking it cannot give |

**The chart kit now has five primitives.** Axes, a banded line, an xy line, a
sparkline, `TimeBarChart` (bars over time, optional companion panel) and
`DeviationChart` (a field of categories diverging from a baseline over a
per-category tolerance band). The last two were the blocker for everything
above.

Only C19 and C20 remain unbuilt, both judged marginal or deferred above.

### Features specced and never built

- **Home: "recent activity"** (§9.1) — last five commission changes, new
  operators, slashes.
- **`/operators`: column-visibility control and density toggle** (§9.3).
- **`/operators/[address]`: nominator table and event history** (§9.4). The
  table needs `data/eras/{era}.json`, and **the pipeline never generates that
  file** — the whole optional per-era detail artefact from §6.4 is missing.

### §12 quality gates that do not exist

`playwright` is a devDependency, but there is **no config, no spec file, no e2e
directory, no `@axe-core/playwright` and no visual-regression baseline**. §12
requires e2e, visual regression and axe-on-every-route; Phase 8's acceptance
criterion is "zero axe violations". This is build work, not an audit.

### Carried unknowns, still unverified

- **The wallet extension handshake** and **the tier-4 subscription names**. Both
  need a browser with a wallet. Every other unverified item in this project
  turned out to be wrong, so do these before launch.
- The **v7.4→v8.0 staking changelog** is still unread, and
  `validators.validatorCommissionCap`, `validators.currentPayoutEra` and
  `validators.pendingPayouts` have still never been read despite being directly
  relevant to how payouts work.
- **`/slashing` has no offence-type column** — `validatorSlashInEra` does not
  record one, but the indexer's `offences` events do. Do not infer it from the
  fraction; the ranges overlap.

### Deferred by decision

- **Price history** — the user deferred this to assess separately. Research is
  done: CoinGecko has POLYX (`id: polymesh`) keyless but caps the free tier at
  365 days rolling (366 points, 6 KB); CoinMarketCap needs a paid plan. The
  pattern that fits is to accumulate daily into `data/prices.json` the way eras
  accumulate, and value rewards at the price on the day received.
- **A points-accruing-now chart.** The column and Live toggle cover the need;
  a chart is only worth it if watching the race block by block matters.

### Backfill: built, verified, and partly run

`scripts/ingest/backfill.ts` exists. `npm run ingest:backfill`, by hand, not on
a schedule — it is thousands of prefix scans against someone else's public
node, concurrency 2, resumable from whatever is already on disk. `--from`,
`--to`, `--max-eras`, `--dry-run` and `--force` all work; `--force` refetches
eras already stored, which is how the first bad run was corrected.

`npm run probe:archive` reads pruned era storage at a historical block for eras
0, 100, 500, 1000, 1500 and 1660 — every one succeeds, decoding correctly across
spec versions 3000 → 7004001. Exposures read `clipped` throughout; paged arrives
with v8.

The operator counts are the reason this matters, and they are exactly the
`firstSeenEra` complaint:

| Era | Date | Spec | Operators |
|---|---|---|---|
| 0 | 2021-10-29 | 3000 | 3 |
| 500 | 2023-03-11 | 5002001 | 40 |
| 1000 | 2024-07-23 | 6003020 | 63 |
| 1500 | 2025-12-05 | 7003003 | 100 |

**Read *after* the era transition, never before.** This is the one thing that
is easy to get wrong and looks right when it is. The first run read ten blocks
before the transition, reasoning that era N's storage is live during era N.
Both halves of what came back were wrong:

- `erasValidatorReward(N)` is written when era N is **paid out**, at the
  transition. Read earlier it is `None`, so the reward decodes as zero — and
  APR, the percentile band and the network average all follow it to zero. Four
  eras landed with `avgApr: 0`.
- `erasRewardPoints(N)` **accumulates** through the era. It came back short by
  exactly 200 points: ten blocks at twenty points each.

Era storage survives for `historyDepth` eras *after* the era ends, so reading
just past the transition is both complete and safe. The script now throws if an
era reports points but no reward, rather than writing a plausible flat line.

**Backfilled eras are better than live-ingested ones**, which is not what
anyone expected. Issuance is read at the block, and era start comes from
`era-index.json` rather than being extrapolated. The boundary between the two
sources is what exposed the incremental ingest stamping *today's* issuance on
every era it wrote — see the next section.

Metadata fetch dominates each read (~8s on a cold spec version), so caching per
spec version is what makes a full 1,749-era run practical. In practice a
300-era slice spanning three spec versions took **3 minutes** at concurrency 2,
so the whole chain is roughly twenty.

**Run: the whole chain is stored, eras 1-1749** — 55 chunks, 3.8 MB on disk,
16.8 minutes at concurrency 2, crossing every spec version from 3000 to
7004001. Against the 84-era window the incremental ingest could reach. The payoff is measurable on the production chart,
which is entirely about separating signal from slot luck:

| Window | Field spread | Of which luck | Genuine | Operators beyond 2 sigma |
|---|---|---|---|---|
| 90 eras | ±1.4% | ±0.8% | ±1.1% | 23 of 90 |
| 365 eras | ±1.1% | ±0.4% | ±1.0% | **37 of 91** |

Luck halves as the window quadruples, exactly as it should; the genuine spread
holds, because it is a real property of the operators. Four times the history
means the site can distinguish 60% more operators from chance.

**`firstSeenEra` was wrong, and the backfill made it obvious.** The registry
took each *run's* first era and stamped it on every operator in it, so after a
300-era backfill all 105 operators claimed to have arrived at era 1360 — the
very complaint the backfill existed to fix, restated at a larger scale. Spans
are now per operator and derived from every chunk on disk, then merged with the
existing registry. Deriving matters as much as the per-operator part: a
min-merge alone can never *raise* a too-low value, so a wrong one would have
been permanent. Rebuilt, the field has ten distinct first-seen eras — 86
operators from 1360 and 22 arriving later.

### Long ranges are served from the rollup

`rollup-weekly.json` was built in Phase 1c for exactly this and then never
consumed — `useRollup` had no caller and every range went to the chunks. That
was invisible at 84 eras and stopped being invisible the moment the whole chain
landed. `useNetworkSeries` now switches above a year:

| Range | Files | Chunks | Transferred |
|---|---|---|---|
| 90d | 6 | 4 | 99 KB |
| 1y | 14 | 12 | 187 KB |
| All (1,749 eras) | 3 | **0** | **31 KB** |

Network series only — the rollup has no per-operator columns and should not.
Operator comparison stays on the chunks. The switch is stated in each chart's
coverage line, and points are labelled `weeks` rather than `eras`: the chart
read "250 eras" for 250 buckets spanning 1,749, understating the history
fivefold while looking authoritative.

**The chain's first week paid 12,564%.** 0.08% of supply staked across three
validators — real, and it set a 15,000% axis that flattened the other 249 weeks
into a line on the floor. `outlierCap` now caps the axis at the highest
non-outlier and states in words how many points run off the top and what they
reached; `BandedLineChart` clips the marks (not the axis or the direct labels)
and the table view keeps the real values. It declines to cap when more than 5%
of a series is above the line, because that is a distribution rather than an
outlier.

### A gap is an outage, not a birth date

Three separate things could hide a missing era, and all three are now closed:
round line caps swallowing five pixels of every break, one era being 0.74px wide
at full history, and `stitchChunks` building its axis from the eras it *held*
rather than the contiguous range. The last is the structural one — a hole in
coverage was skipped, so on a time axis the line simply spanned it.

Then the opposite problem. Marking *every* null run put a "no data here" tint
over four and a half years of `/operators` at full history, because the default
selection is the five highest-returning operators and three of them joined this
year. Those eras are not missing data; the operator did not exist. `interiorGaps`
is the single rule — a run touching either end of a series is not a gap — and
the plot marks, the legend entry and `summariseAvailability` all read from it, so
the chart and the figures beside it cannot disagree.

**The reported 1632–1659 and 1344–1359 hole is not in the data.** Checked three
ways: both chunks carry 32 contiguous eras with 91 and 86 operators reporting
points, no era anywhere in `public/data` has every operator null (the worst is
six of 131, at era 430), and the weekly rollup has no era hole either. What
covered those eras on screen was the shading above.

### The anchors the backfill exposed

`ingest:era` recorded two approximations that were invisible until a second
source disagreed with them across a chunk boundary:

- **Total issuance** has no per-era storage, so it read the value once and
  stamped it on every era. Right for one era that just ended; across a cold
  rebuild of 84 it is a flat line where the real series grows by a validator
  reward a day. The staking ratio inherits it — era 1667 recorded 44.34%
  against an actual 45.08%.
- **Era start** was extrapolated backwards at a nominal era length, when
  `era-index.json` has the real transition times.

Both now come from the index in both entry points, at one archive round trip
per era. Without the index the old approximations still apply and the run says
so out loud.

### Reference

The user's original ask, now met by the three return columns and the Live
toggle on `/operators`:

> from the legacy site two charts I regularly used were the live node points per
> era and total Polyx assigned to nodes. The first confirmed they were still
> producing blocks as the point updated every block by subscription and the
> second allowed me to see the estimated returns for the next era. The Polymesh
> portal showed the returns for the last era so combining this information we
> have both recent and forward looking estimations that were live/semi live.

Read as one need, not two: **is my operator working right now, and what am I
likely to earn next.** Answered by This era (est.) / Last era / Mean, plus the
Points column, all of which upgrade to per-block under Live.

Docs still worth reading, listed here so they are not lost:

- <https://developers.polymesh.network/development/changelogs/v7.4-to-v8.0/staking-and-validators.md>
- <https://developers.polymesh.network/polyx/staking.md>
- <https://developers.polymesh.network/polyx/tokenomics.md>

## Phase 7 against real mainnet — what the first run found

Phase 7 was written with no chain egress, so four things were flagged unproven.
Three have now been run against mainnet (spec version `8000020`). **Every one of
them was wrong**, which is worth remembering the next time something looks
obviously correct on paper.

### 1. The reward query — three bugs, two of them silent · **fixed**

- `blockId` does not exist; the field is `createdBlockId`. This one 400s.
- ~~Ordering by `CREATED_BLOCK_ID_ASC` sorts lexicographically, so history comes
  back shuffled. Now `DATETIME_ASC`.~~ **This was wrong in both directions and
  has been reverted** — `createdBlockId` is deliberately zero-padded to ten
  digits, so a string sort *is* a numeric sort, and `datetime` is the field
  whose width is not fixed. The query now orders by
  `[CREATED_BLOCK_ID_ASC, ID_ASC]`. See the corollary at the top of this file.
- `eventId` matched only `Rewarded`. The enum carries **both** `Reward` and
  `Rewarded`; Polymesh renamed the event across a runtime upgrade. Measured on
  one operator stash: **626 `Rewarded`, 273 `Reward`** — filtering on the new
  name alone silently drops 30% of a lifetime total, all of it the oldest
  history.
- `amount` is `BigFloat`, not an integer string. The old guard turned anything
  non-integral into `'0'`.

Verified: 899 events over 9 pages for one stash, timestamps exactly 86400s
apart. Pagination past the 100-row cap is now proven on real data.

Re-run with **`npm run probe:indexer`** after any runtime upgrade — a renamed
enum member breaks history retrieval without breaking the query.

### 2. `readStashPosition` — mostly right, one real bug · **fixed**

The controller indirection works: a nominator came back with 1,598,506 total /
1,548,506 active, one chunk unlocking at era 1756, and a nomination from era
1741. So `bonded → ledger`, `unlocking`, `active`, `submittedIn` and `targets`
all decode correctly.

`RewardDestination` did not. See item 9 below — this is the types-package issue.

Re-run with **`npm run probe:stash`**.

### 3. Slash storage · **verified, and genuinely empty**

`validatorSlashInEra` and `nominatorSlashInEra` both exist and are queryable,
and there are **zero entries across all eras** — Polymesh has had no slashes in
the retained window. That distinction mattered: `readEraSlashes` returns `[]`
when the storage item is absent, so "no offences" and "we are reading the wrong
map" would have looked identical. **`npm run probe:slashes`** tells them apart
by asking for every key in the map at once.

### 3a. Offences did happen — the *slash* record is what is empty

Following on from the above. Slash storage being empty is not the same as no
operator ever having misbehaved, and reading the page that way flatters every
node that has ever been offline. The reports exist, in the indexer:

- **`staking.SlashReported`** — 145 events over the chain's life, carrying the
  offending validator's public key, the fraction, and the era the offence
  occurred in. Grouped per (operator, era) that is **36 incidents across 21
  operators**, every one of them with a zero penalty because
  `slashingAllowedFor` means nothing is taken.
- **`imOnline.SomeOffline` returns zero rows**, as do `offences.Offence` and
  `staking.Slashed`. The indexer does not carry those modules — which is worth
  knowing, because `SomeOffline` is the obvious source and the one the block
  explorer shows. `staking.Chilled` is carried (166 rows) but its argument is
  not always a validator stash, so it is not used.
- **Filter on `moduleIdText`/`eventIdText`, or use the enum literals.**
  `moduleId` and `eventId` are GraphQL enums (`ModuleIdEnum`, `EventIdEnum`);
  binding a `String!` variable to them is a 400 before the query runs.

The eras line up with what the chunks already show, which is the check that
matters. Calico Capital (`2GXMe4KZ…`) is reported in era 1130 and its points
column is null for 1131–1137; it is reported again in era 1670, where its points
fell from ~3,200 to 180 before it left the set for 1671–1672. The offence
records the outage the charts draw.

`npm run probe:offences` re-runs the introspection; `npm run ingest:offences`
writes `offences.json` in two requests.

### 4. Still unproven

- **The extension handshake** in `lib/chain/wallet.ts` — needs a browser with a
  wallet installed.
- **The tier-4 subscription names.** The `validators` pallet split is handled,
  but only from the design doc's reading of the Portal.

Both degrade to a visible, specific error rather than a wrong number.

Run `npm run budget` after any change that touches an import graph, not just at
the end of a phase — three separate regressions have come in that way.

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
 ok     185.5 KB  /kitchen-sink/       loads every chart primitive by design
 ok     174.2 KB  /my-staking/
 ok     173.5 KB  /operators/
 ok     167.4 KB  /compare/
 ok     165.7 KB  /network/
 ok     165.5 KB  /operators/[address]/
 ok     147.1 KB  /about/              ← shared floor
```

Re-measure rather than trusting this table; it is a snapshot and drifts with
every feature. The floor has been stable at 147.1 KB throughout.

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

### 9. `@polymeshassociation/polymesh-types` — adopted, types only

`types/polymesh-chain.d.ts` pulls in the Polymesh augmentations, so
`api.query.staking.payee` is now `Option<PalletStakingRewardDestination>`
rather than a bare `Codec`.

**It is a devDependency and must stay one.** The augmentation lives in a
`.d.ts`, not a `.ts`: the package ships real (if nearly empty) `.js` files, so a
side-effect import from ordinary source would emit a runtime import into the
chain chunk that is supposed to stay unreachable until a user connects.
Declared in a `.d.ts`, TypeScript reads it and no bundler ever sees it —
verified, `/my-staking` is unchanged at 168.6 KB and `assert:lazy` still passes.

We do **not** use its `typesBundle`. That exists for chains whose metadata does
not describe its own types; Polymesh's current runtime carries metadata v14+ and
every read here decodes correctly without it, verified against mainnet. Adding
it would put runtime code in the browser to solve a problem we do not have.

#### Getting it to actually work

Installing it is not enough. `polymesh-types` depends on `@polkadot/*` at an
**exact** version (16.5.2), so against our `^16.5.6` npm nests a second full
copy — and a `declare module '@polkadot/api-base/types/storage'` in the nested
copy augments a different file than the one our code resolves. The interfaces
never merge and every storage read stays `Codec`, silently.

The fix is the `overrides` block in `package.json` forcing one `@polkadot/*`
version across the tree, plus pinning our own `@polkadot/api` to match, since
npm rejects an override that conflicts with a direct dependency. **If storage
reads ever go back to `Codec`, check for a nested `@polkadot` copy first.**

#### It immediately found a real bug

`readPayee` branched on `payee.isAccount`. That is an accessor on the *inner*
enum, but `staking.payee` returns an `Option` — on the wrapper it is simply
`undefined`, so the branch never fired and an account destination rendered as
raw JSON in the UI. I originally diagnosed this as "the accessors do not exist
without augmentation", which was wrong: they exist, I was reading them one level
too high. The compiler pointed straight at it.

#### Still to do

`compat.ts` remains an `any` zone and its `eslint-disable` stays. The
augmentation describes the **current** runtime, and that file exists precisely
to read v6/v7 shapes that are not in it. The `any` surface can now shrink —
`stash.ts` and `live.ts` are the candidates — but it will not vanish, and the
historical probes must keep their loose access.

---

## Polymesh is not vanilla Substrate — verified facts

Each of these was confirmed against mainnet (spec `8000020`) this session, and
several contradict what a reasonable person would assume from Substrate.

- **Exposure paging costs a nominator nothing.** More than
  `maxExposurePageSize` (64) backers splits an operator's exposure into
  multiple pages, and **every page is rewarded**. The runtime carries a test
  called `test_nominators_over_max_exposure_page_size_are_rewarded`, and
  Polymesh pays each page *automatically* via `validators::payouts()` walking
  `PendingPayouts` for `CurrentPayoutEra` — no one has to call
  `payout_stakers`. Confirmed on mainnet for era 1748: all five pages of the
  283-nominator operator were claimed and paid. `npm run probe:payouts`.
- **Nominators are not slashed.** `validators.slashingAllowedFor` reads
  `Validator`. It is a governance switch, so it is read per run into
  `slashes.json.scope` and never hardcoded. The docs' phrasing is "not
  currently subject to slashing, but that could change in the future". Getting
  this wrong is what open item 10 is about.
- **Nomination lives on the `validators` pallet**, not `staking` — v8 moved it.
  The tier-4 event filter already accounts for this; watching `staking.Nominated`
  would fail silently.
- **The election equalises exposure.** Own stake spans 50K–5.3M POLYX while
  *total backing* spans only 6.34M–6.57M across 86 operators. This makes Gini
  ≈ 0.008 and the Lorenz curve sit on the diagonal — correct, not a bug, and
  `components/decentralisation.tsx` now says so.
- **`staking.payee` is an `Option<RewardDestination>`**, not a bare enum.
- **The indexer's `EventIdEnum` carries both `Reward` and `Rewarded`.** Query
  both or lose the older ~30% of any reward history. **The same trap applies to
  era transitions**: `staking.EraPayout` covers eras 0–1120 and `staking.EraPaid`
  1121 onward. 1,121 + 628 = 1,749, contiguous from era 0.
- **An era transition event is tagged with the era that *ended*.** So
  `start(N) = transition(N-1)`. Verified against our own ingest: era 1748 started
  2026-08-09T13:26:12 and `EraPaid(1748)` fired exactly one era later. Getting
  this backwards mislabels every era by a day.
- **Eras are *not* 24h apart over the long run.** Nominal 86,400s, measured
  86,292.9s — 52 hours of accumulated drift across 1,748 eras. Era↔date must be
  a lookup; arithmetic lands in the wrong day at the far end.
- **`createdBlockId` is deliberately zero-padded** to ten digits, so a string
  sort *is* a numeric sort. `datetime` is the unsafe field — also compared as a
  string, but not fixed-width (fractional seconds appear inconsistently). Sort
  on `[CREATED_BLOCK_ID_ASC, ID_ASC]`; `id` is `blockId/eventIdx`, both padded.
- **The indexer page cap is 100 and is a server limit,** not a setting: asking
  for 500 or 1000 returns 100. But `totalCount` and `aggregates { sum { amount } }`
  work, so a lifetime total costs one request instead of N. Verified identical to
  a full walk on a real stash. `min`/`max` over `datetime` are *not* offered.
- **Public RPC archive access still works, for every era including 0.** Read at
  spec versions 3000 through 7004001, decoding correctly at each.
- **Era is exactly 24h**: `sessionsPerEra` 6 × `epochDuration` 2400 ×
  `expectedBlockTime` 6000ms. Derived, never assumed.
- **Zero slashes in the retained window**, and the storage genuinely exists —
  the empty result is real, not a misread map.
- **`waiting` validators is 0**; the set is permissioned, 86 active of max 100.

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
npm run fixtures     # synthetic dataset — refuses to overwrite a real ingest
npm run dev

# The full gate. All of it must pass before a commit.
npm run check        # typecheck + lint + test
npm run knip
npm run build
npm run budget       # per-route JS, gzipped, against the 200 KB budget
npm run assert:lazy  # the chain stack must not load before a user connects

# Need a real RPC endpoint. Will not run without chain egress:
npm run ingest:era -- --full
npm run ingest:latest
npm run ingest:slashes
npm run ingest:era-index   # indexer only, no RPC; ~18 requests for all 1,749 eras

# Re-validate chain-facing code against mainnet. Each has already caught a bug.
npm run probe:indexer          # the reward query against the live schema
npm run probe:indexer-caps     # page cap, server-side aggregates, era transitions
npm run probe:stash            # ledger decoding via the controller indirection
npm run probe:slashes          # slash storage exists and is genuinely empty
npm run probe:slashing-switch  # validators.slashingAllowedFor
npm run probe:payouts          # every exposure page is claimed and paid
npm run probe:session          # era/session/election machinery
npm run probe:archive          # pruned era storage still reads at a historic block
npm run probe:exposure-scan    # cost of a whole-era exposure search
npm run probe:allocation -- <stash>   # where one stash's stake actually sits
```

`npm run ingest:backfill` fills history older than the 84-era retained window.
Run it by hand; see the backfill section above before you do.

`budget` and `assert:lazy` read `out/`, so run `npm run build` first.

To preview the static export, serve it under the base path — the app is built
for `/polymesh-staking-app`, so serving `out/` at the root 404s:

```bash
mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/polymesh-staking-app
npx serve /tmp/site -l 4180
# → http://localhost:4180/polymesh-staking-app/
```

Real mainnet data compresses about twice as well as the synthetic fixtures
(90-era window: 55 KB real vs 112 KB synthetic), because actual operator counts
and commissions repeat far more than generated ones.
