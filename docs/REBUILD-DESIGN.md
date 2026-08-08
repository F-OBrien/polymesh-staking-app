# Polymesh Staking Analytics — Rebuild Design Document

**Status:** Proposed
**Target:** Full replacement of the current `polymesh-staking-app`
**Audience:** Agentic implementation workflow + human reviewer

---

## 0. How to use this document

This document is written to be executed. It is organised as:

- **§1–4** — audit of the existing app. Read once, for context. Not actionable.
- **§5–12** — the specification. This is the contract. Build to it.
- **§13** — the phased execution plan, with acceptance criteria per phase. Work through it in order.
- **§14** — the resolved decisions, plus the few unknowns still to be measured. Settled; do not re-litigate.

Rules for the executing agent:

1. **Do not skip Phase 0.** The baseline measurements it produces are how we prove the rebuild worked.
2. **Each phase ends green.** Typecheck, lint, unit tests, and the phase's acceptance criteria all pass before the next phase starts. Commit at each phase boundary.
3. **The design tokens in §7 and the chart rules in §8 are normative.** No ad-hoc colours, no ad-hoc chart forms. If a chart doesn't fit a form in §8, stop and raise it rather than inventing one.
4. **Numbers marked `‹measure›` must be measured, not guessed.** They are inputs to decisions, and a fabricated value will produce a wrong decision.
5. Where this document says *verify*, verify before relying on it.

---

## 1. Audit — what exists today

### 1.1 Summary

A Next.js 14 Pages-Router app, statically exported (`output: 'export'`) and deployed to GitHub Pages at `/polymesh-staking-app`. It renders 20 Chart.js charts of Polymesh staking history. Every visitor's browser opens a WebSocket to a public Polymesh RPC node, pulls the full staking history out of chain storage, and computes every metric client-side. There is no server, no database, no cache beyond in-memory React Query.

It works, and the domain modelling is genuinely good — the APR/commission/points maths is careful and correct, and the v6→v7→v8 compatibility shims show real understanding of the chain. The problems are architectural and presentational, not analytical.

### 1.2 Feature inventory

**Routes**

| Route | Nav label | Contents |
|---|---|---|
| `/` | Home | Placeholder. Literally: *"This is the home page. Not much to see here."* |
| `/overview-charts` | Overview | 6 network-level charts |
| `/operator-charts` | History | 8 per-operator historical charts |
| `/operator-trends` | Trends | 3 deviation-from-average charts + an era-window `<select>` |
| `/operator-info` | Current Info | 3 current-era charts |
| `/page2` | *(unlinked)* | Leftover scaffolding: "This is my second test page as an index" |
| `/404` | — | Bare |

**Charts (20)**

*Overview* — Reward/Inflation Curve (with a live marker for the current staking ratio); Unresponsiveness & Equivocation Fines; Average APR/APY per Era; Total POLYX Staked per Era; Total Points per Era; Total POLYX Rewards per Era.

*Operator history* — Node APR per Era (after commission); Node APR per Era (before commission); Operator Rewards per Era; Total POLYX Assigned to Node per Era; Node Points per Era; Node % of Reward/Total Points per Era; POLYX Rewards per Era by Node; Operator Commission per Era.

*Trends* — Cumulative % Deviation from Average APR (after commission); Cumulative % Deviation from Average Era Points; the same, Commission-Adjusted.

*Current info* — Node Points (active era); Total POLYX Nominated by Operator; Total POLYX Assigned to Nodes (current era).

**Other capabilities**

- Optional Polymesh browser-extension wallet connection. Used for exactly one thing: highlighting the connected account's nominated operators inside the line charts (`operatorsToHighlight`).
- Network switching, driven passively by whatever network the wallet extension is set to. Not user-selectable in the UI.
- Chart pan/zoom via `chartjs-plugin-zoom`, with a per-chart "Reset Zoom" button.

### 1.3 Architecture as built

```
_app.tsx
  └─ QueryClientProvider          (react-query v3, cacheTime 6h, in-memory only)
      └─ Layout                   (Navbar / children / Footer)
          └─ SdkAppWrapper        ← full-page spinner until SDK + chain data resolve
              └─ StakingContext…  ← full-page spinner until eraInfo + constants resolve
                  └─ <Component/> ← page; every chart mounts and fetches at once
```

- `context/SdkContext.tsx` — connects `@polymeshassociation/polymesh-sdk`, derives chain data, connects the wallet, resolves the stash address.
- `context/StakingContext.tsx` — subscribes to `activeEra`/`currentEra`, reads `historyDepth`, builds the three era arrays every chart iterates.
- `hooks/stakingPalletHooks/*` — one React Query hook per storage item, in singular (`useEraX`) and plural (`useErasX`) forms.
- `components/charts/**` — 20 components, each ~130–370 lines, each repeating the same five-stage pipeline: mounted-ref tracking → query gating → raw-data effect → chart-data effect → render.

---

## 2. Diagnosis — why it is slow

> *"The current site can be slow to load even when historic data doesn't change."*

That observation is exactly right, and it identifies the root cause. **Historic era data is immutable and identical for every visitor, but the app recomputes it from raw chain storage in every browser, on every visit.** Everything below follows from that one decision.

### 2.1 The fan-out

`historyDepth` on Polymesh is 84 (*verify at runtime*), so `historicWithCurrent` holds 85 eras. Opening `/operator-charts` issues:

| Hook | Calls | Shape |
|---|---|---|
| `useErasRewardPoints` | 1 | `erasRewardPoints.multi(85 eras)` ✅ efficient |
| `useErasRewards` | 1 | `erasValidatorReward.multi(85)` ✅ efficient |
| `useErasTotalStaked` | 1 | `erasTotalStake.multi(85)` ✅ efficient |
| `useErasPreferences` | **85** | `Promise.all(eras.map(era => erasValidatorPrefs.entries(era)))` ❌ |
| `useErasStakers` | **170** | per era: `erasStakersOverview.entries(era)` + `erasStakersPaged.entries(era)` ❌ |

**≈255 concurrent storage prefix scans on one WebSocket**, fired simultaneously via `Promise.all`. `erasStakersPaged.entries(era)` returns *every nominator edge for every operator* in that era — the single heaviest thing you can ask a Substrate node for, requested 85 times over.

Public RPC nodes queue and rate-limit this. The browser then SCALE-decodes all of it on the main thread through `@polkadot/types`, allocating a codec object per field.

`‹measure›` — capture actual wire bytes and wall-clock time for `/operator-charts` cold load in Phase 0.

### 2.2 Nothing is persisted

`cacheTime: 21600000` (6h) is **in-memory only**. A hard reload discards it. `staleTime` is never set, so it defaults to `0` — every query is stale the instant it lands, and `refetchOnMount` (default `true`) re-runs it on the next mount. `queryClient.clear()` fires on every network change.

Net effect: **era 1200's reward points — a value that has been frozen since it was written — are re-fetched from the chain on every single page load, by every single visitor.**

### 2.3 No incremental update

When a new era finalises, `activeEra` ticks, every chart's gating effect flips `fetchQueries` back to `true`, and all 85 eras are re-fetched from scratch. The correct delta is one era.

### 2.4 The critical path is maximally serial

Nothing renders until the SDK connects → chain data resolves → era subscriptions fire → constants load. Two nested full-page spinners guarantee a blank screen for the entire connection handshake, including the multi-megabyte chain metadata download and registry construction that `@polkadot/api` performs on connect.

### 2.5 Bundle weight

`@polymeshassociation/polymesh-sdk` + `@polkadot/api` + `chart.js` + 4 Chart.js plugins + `d3` (full package, not submodules) all sit on the critical path. The Polkadot stack alone is multiple megabytes of JavaScript, parsed and executed before a pixel of chart appears — and it is needed only for chain reads and the optional wallet.

### 2.6 Redundant work per chart

Each of the 8 operator charts independently re-derives near-identical intermediate structures (per-era, per-operator maps) inside `useEffect`, in the main thread, from the shared query results. React Query dedupes the *fetches*; nothing dedupes the *computation*.

### 2.7 Smaller correctness and hygiene issues

- `reactStrictMode: false` — masks effect-cleanup bugs rather than fixing them.
- Roughly 30 `@ts-ignore` directives, several hiding genuine type drift across chain upgrades.
- `constants/rewardCurve.ts` — **625 lines of precomputed curve data, entirely unused.** `RewardCurve.tsx` recomputes the curve at runtime.
- `didInfo` — a rich DID → `{name, website}` map, **unused**.
- `useHistoricalEras` — exported, **never consumed**; `StakingContext` duplicates the logic inline.
- `pages/page2` — scaffolding left in the production build.
- `operatorsNames` — 100+ hardcoded addresses, manually maintained, visibly stale (`'Marketlend 1 (old)'`, a commit titled *"Rename Tigerwit to Calico Capital"*). Operator identity is available on-chain and from the indexer; it should never have been a source file.
- `OperatorsTokensNominated` polls `api.query.system.events` and refetches three full storage-map scans (`nominators.entries()`, `ledger.entries()`, `validators.entries()`) on matching events — three of the largest maps on the chain.
- README is the unmodified `create-next-app` template.
- No tests. CI runs deploy only.

---

## 3. Weaknesses — design and UX

### 3.1 It is not responsive; it is not even mobile-*capable*

```html
<meta name='viewport' content='width=1200, maximum-scale=2.0' />
```

The app force-renders at a 1200px viewport and asks phones to scale it down. Chart font sizing is then patched with an eight-branch `if` ladder on `window.innerWidth` in `_app.tsx`, mutating **global** `Chart.defaults` on resize. There is no mobile layout, no tablet layout, and no fluid behaviour — only a fixed desktop canvas, shrunk.

### 3.2 The core chart form is unreadable

Every operator chart plots **~100 series** coloured by `d3.interpolateTurbo(index / count)` at `opacity: 0.2`, with a 100-entry legend below. This is the canonical spaghetti chart, and it breaks several hard rules at once:

- A rainbow interpolant used as a **categorical** scale. Turbo is a *sequential* ramp; using it for identity means hue encodes nothing but array index.
- Colour assigned by **position in the array**, so filtering or a change in operator count **repaints every survivor**. An operator has no stable colour between eras or between charts.
- ~100 hues are not distinguishable by anyone, and are actively hostile under any colour-vision deficiency.
- A 100-row legend is not a legend; it is a wall.
- Series identity is carried by colour alone — no direct labels, no table alternative.

The information the user actually wants — *how is my operator doing versus the field?* — is present but unreadable.

### 3.3 Multi-axis charts

`OperatorsTokensNominated` renders **three** y-axes (`y` amount, `y1` commission %, `y2` nomination count) on one plot. Two independent y-scales already make a chart unfalsifiable — any correlation can be manufactured by rescaling. Three is worse. `OperatorsTokensAssigned` and `OperatorsActiveEraPoints` do the same.

### 3.4 No visual design system

- Two ad-hoc stylesheets, ~156 lines total. Colours are hardcoded hex, inline `style={{}}`, and Chart.js literals (`'rgb(255,0,0)'`, `'rgb(0,128,255)'`).
- No spacing scale, no type scale, no elevation model, no component library.
- No dark mode.
- Poppins loaded via a render-blocking `@import` to Google Fonts.
- The Polymesh brand (deep purple `#4A125E`, magenta `#FF2E72` — present in `public/polymesh-logo.svg`) appears nowhere in the UI.
- Nav links are blue pill buttons (`#4979ff`), unrelated to the brand and with no active state.
- Nav labels are ambiguous: "Overview / History / Trends / Current Info" don't say what they contain.

### 3.5 Loading, empty, and error states

- Two nested full-page spinners; the first has no label at all.
- If the RPC connection fails, the spinner **spins forever**. There is no error state, no retry, no fallback endpoint, no diagnostic.
- No skeletons — charts pop in and shove the page around.
- No empty states.

### 3.6 No state is addressable

Zoom, pan, the trend-period `<select>`, and the (implicit) operator highlighting are all local component state. Nothing is in the URL. **You cannot link anyone to anything you are looking at.** No sharing, no bookmarking, no deep links from Discord or a forum post.

### 3.7 Accessibility

Effectively absent. Canvas charts expose no accessible content; identity is colour-only across ~100 series; there is no table view, no keyboard access to data, no focus styling, no landmarks, no skip link, no `prefers-reduced-motion`, no `lang` refinement. Contrast of 0.2-alpha lines on white fails by a wide margin.

### 3.8 Metadata and SEO

`<meta name="description" content="Generated by create next app" />`. No Open Graph tags, no social preview, no sitemap, no per-page titles beyond the home page.

---

## 4. Gaps — analysis and features that are missing

The current app answers exactly one question well: *how have per-era network metrics moved over the last 84 days?* It answers almost nothing else.

### 4.1 There is no operator detail view

100 operators, and no page for any one of them. No way to see a single operator's identity, commission history, points consistency, stake trend, nominator count, self-stake ratio, slash history, or era-by-era record. This is the most obvious gap in the product.

### 4.2 There is no table

No sortable, filterable, searchable list of operators. For "which operator should I nominate?" — the primary job a staking site exists to serve — a ranked table is the single most useful artefact, and it does not exist. Neither does CSV/JSON export.

### 4.3 There is no nominator view

The wallet connects, the stash resolves, and the app uses it only to change some line opacities. It never tells you:

- what you have staked, and with whom;
- what you have earned, per era and cumulatively;
- your realised APR (as opposed to the network average);
- which of your operators is underperforming;
- your unbonding chunks and when they unlock;
- whether you are in an oversubscribed page and therefore **not earning**;
- whether you have unclaimed payouts.

### 4.4 No operator comparison

No way to pin 2–5 operators and compare them side by side. The spaghetti charts are the only comparison tool, and they are not one.

### 4.5 No network-health or decentralisation analysis

Missing: staking ratio versus the 70% ideal (the reward curve is drawn, but the *implication* is never stated); Nakamoto coefficient; stake concentration (HHI / Gini / top-N share); active versus waiting validator counts; validator-set churn; nominator count trend; average and median nomination size.

### 4.6 No forward-looking analysis

Everything is backward-looking. Missing: a reward projection calculator ("stake X POLYX with operator Y → expected annual return"); expected APR at different staking ratios given the curve; commission-change alerts; oversubscription risk.

### 4.7 Slashing is buried and thin

`FineCurves` is one chart on the Overview page. There is no offence history, no per-operator slash record, no chain-wide slashing timeline, no severity context.

### 4.8 Eras are shown, dates are not

Every x-axis is labelled with a raw era index. An era is 24 hours on Polymesh, so era 1403 *is* a date — but the user has to know the mapping. **Nobody thinks in era indices.** Dates should be primary and the era index secondary.

### 4.9 No context on any number

Stat values appear without deltas, sparklines, percentiles, or plain-language explanation. "APR 12.4%" — up or down? Good or bad? Versus what?

### 4.10 No glossary or explanation

The site assumes fluency in Substrate staking vocabulary: era, points, exposure, commission, clipped/paged exposure, oversubscription, nomination, stash versus controller. A staking site's audience includes people deciding whether to stake at all.

### 4.11 No watchlist or persistence

No favouriting operators, no saved comparisons, no persisted preferences.

---

## 5. Product definition for the rebuild

### 5.1 Positioning

**Polymesh Staking Analytics** — the reference source for understanding staking on Polymesh: fast, legible, and honest about what the numbers mean.

Three things must be true:

1. **Fast.** Historic data is immutable. It should load like a static document, because that is what it is.
2. **Legible.** Every chart answers a stated question. Nothing is drawn because the data exists.
3. **Actionable.** A visitor can decide who to nominate, and a nominator can see how their choice is performing.

### 5.2 Audiences and jobs

| Audience | Job | Primary surface |
|---|---|---|
| **Prospective nominator** | "Is staking worth it, and who should I pick?" | Home, Operators table, Operator detail, Calculator |
| **Active nominator** | "How is my stake performing? Should I switch?" | My Staking, Operator detail, Compare |
| **Operator** | "How do I rank? Is my node performing?" | Operator detail, Compare, Operators table |
| **Analyst / Association** | "How healthy and decentralised is the network?" | Network, Decentralisation, Data export |
| **Curious observer** | "What is going on with Polymesh staking?" | Home, Network |

### 5.3 Information architecture

```
/                        Home — network pulse + entry points
/network                 Network analytics (history, rewards, inflation, decentralisation)
/operators               Operator directory: sortable/filterable table + overview charts
/operators/[address]     Operator detail
/compare?ops=a,b,c       Side-by-side comparison (2–5 operators)
/my-staking              Personal view (wallet-gated, graceful when disconnected)
/calculator              Reward projection
/slashing                Offences and fines history
/about                   Glossary, methodology, data sources, formulas
```

Removed: `/page2`, and the placeholder home page.

Nav labels become plain: **Network · Operators · Compare · My Staking · Calculator**. Slashing and About live in the footer and are reachable by direct link.

**URL is the state container.** Selected operators, era range, active metric, sort column, and table filters all live in the query string. Every view is linkable.

---

## 6. Technical architecture

### 6.1 The governing rule

> **Immutable data is computed once, ahead of time, and served as static files. The browser never re-derives history.**

An era, once finalised, never changes: its reward points, validator preferences, exposures, total stake, and payout are frozen forever. There is no reason for 1,000 visitors to each perform 255 storage scans to rediscover the same 85 frozen numbers.

This single change is worth more than every other optimisation combined.

### 6.2 Is there an existing indexer we can use?

**Checked, and no — not for this.** The public Polymesh SubQuery indexer exposes:

- `StakingEvent` — event-level: `Bonded`, `Unbonded`, `Nominated`, `Rewarded`, `Slashed`, with `stashAccount`, `amount`, `nominatedValidators`, `datetime`.
- Generic `Block`, `Event`, `Extrinsic`, `Account`, `Identity`.

It has **no era-level aggregate entities** — no `erasRewardPoints`, no exposures, no per-era validator preferences. So:

- **Era aggregates must come from our own RPC snapshot pipeline** (§6.3).
- **The indexer is still valuable** for the nominator view (§9.6): reward payment history per stash, bonding/unbonding events, and nomination changes over time — data that is *not* available from current chain state at all, since it is historical event data. Use it there, lazily, client-side.

**Endpoints (Q5) — R1 resolved.** Confirmed against <https://developers.polymesh.network/developer-resources/links/>. Put these in `config/networks.ts`, never inline.

| Role | Mainnet | Testnet |
|---|---|---|
| RPC (WebSocket) | `wss://mainnet-rpc.polymesh.network/` | `wss://testnet-rpc.polymesh.live/` |
| RPC (HTTP) | `https://mainnet-rpc.polymesh.network/http` | `https://testnet-rpc.polymesh.live/http` |
| **SubQuery GraphQL** | `https://mainnet-graphql.polymesh.network/` | `https://testnet-graphql.polymesh.live/` |
| REST API | `https://mainnet-restapi.polymesh.network/` | `https://testnet-restapi.polymesh.live/` |
| Explorer (Subscan) | `https://polymesh.subscan.io/` | `https://polymesh-testnet.subscan.io/` |
| **Archive access** | ✅ the public RPCs above are archive nodes | ✅ same |

The mainnet RPC and indexer URLs match what `constants/constants.ts` already uses. **The public RPCs retain historical state** — undocumented on the resources page but confirmed, and the basis for §6.5.

Rate limits exist but are not quantified anywhere official. The client must therefore treat the indexer as unreliable by design: **paginate at 100 results, retry with exponential backoff and jitter on 429, and degrade gracefully** — `/my-staking` shows position and current operators from chain state even when reward history fails to load. Never let an indexer failure blank the page. Measure the real limit empirically in Phase 7 and record it in `docs/data-sources.md`.

**Considered and rejected: network telemetry** (`https://stats.polymesh.network/`). It is the only available source of node-health signal — software version, uptime, peer count, sync state — but it is keyed by self-reported node name rather than stash address, so joining a telemetry row to an operator is guesswork, and nodes can disable telemetry entirely. The effort is real and the result would be unreliable enough that it could not be allowed to affect a ranking anyway. **Not in scope.** Revisit only if operators start publishing a verifiable name↔stash mapping on-chain.

**Useful but not required: the REST API.** A friendlier wrapper over the same chain data. The pipeline speaks to the node directly, but this is handy for one-off verification when debugging a metric.

**Network configuration (Q6).** Mainnet only for v1. Testnet is reachable for local development through env vars (`POLYMESH_RPC_URL`, `POLYMESH_INDEXER_URL`, `POLYMESH_NETWORK`) consumed by both the pipeline and the build — never a UI network switcher, and never a hardcoded URL. Because `manifest.json` is keyed by `genesisHash`, adding a second network later is purely additive: a second data directory and a route prefix. The current app's passive "whatever network the wallet extension happens to be on" behaviour is removed — it was a silent correctness hazard, since wallet-driven network changes wiped the cache and re-fetched everything.

### 6.3 The ingestion pipeline

A Node script, run on a schedule, that turns chain storage into static JSON.

```
┌────────────────────────────────────────────────────────────┐
│  scripts/ingest/  (Node, @polkadot/api, run in CI)         │
│                                                             │
│  1. Read data/manifest.json → lastIngestedEra               │
│  2. Connect RPC, read activeEra                             │
│  3. For each era in (lastIngestedEra, activeEra):           │
│       – erasRewardPoints, erasValidatorReward,              │
│         erasTotalStake, erasValidatorPrefs.entries,         │
│         erasStakersOverview/Paged (v8) or Clipped (v6/7)    │
│       – resolve era start block + timestamp                 │
│       – derive: per-operator APR, commission-adjusted APR,  │
│         reward share, points share, nominator count,        │
│         self-stake ratio, network averages & percentiles    │
│  4. Write/refresh immutable era chunks                      │
│  5. Regenerate manifest.json + latest.json                  │
│  6. Commit to the `data` branch                             │
└────────────────────────────────────────────────────────────┘
```

Key properties:

- **Incremental.** A normal run fetches exactly one era. A cold rebuild fetches `historyDepth + 1`, throttled with a small concurrency limit (4–6) so we are a good citizen to the public RPC — the pipeline can afford to be slow; the browser cannot.
- **Idempotent and resumable.** Re-running produces byte-identical output for already-ingested eras. Assert this in CI.
- **Version-tolerant.** Keep the existing v6/v7/v8 fallbacks from `useEraStakers.ts` — they encode real knowledge about the chain's history and are needed for eras that predate the v8 upgrade. Record the `specVersion` each era was read under, per era, in the chunk (see §6.4) — this is what makes later backfill tractable.
- **Validated.** Every generated file is checked against a Zod schema before commit. A failed validation fails the run and leaves the previous data in place.

**Cadence — two jobs, not one.** An era on Polymesh mainnet is 24 hours, so era-level data changes exactly once per day. A blanket 30-minute cron would do 48 pointless full runs a day. Split it:

| Job | Schedule | Work | Writes |
|---|---|---|---|
| **`ingest-era`** | hourly | Read `activeEra`. If unchanged since the manifest, exit immediately (a few seconds, one RPC call). Otherwise ingest the newly completed era. | chunks, `manifest.json`, `operators.json` |
| **`snapshot-latest`** | every 15 min | Read active-era state: points so far, current exposures, oversubscription, validator set, issuance, election phase, and the era/epoch **anchors** the client derives progress from (§6.6a). | `latest.json` only |

The hourly no-op is essentially free and bounds new-era staleness at one hour — irrelevant for data that moves daily. Do **not** try to schedule against the era boundary: GitHub Actions cron is best-effort and routinely delayed under load, so a self-checking hourly poll is more reliable than a clever schedule.

You are right that **live data is not indexed** — `latest.json` is a direct RPC snapshot, not an indexer read. That is the one place we still talk to a node on a schedule, and it is also the one place where a stale value is visible to users, so it carries a `generatedAt` that the UI surfaces ("as of 12 minutes ago").

**Where it runs.** GitHub Actions, writing to an orphan `data` branch which the site build consumes. This preserves the current zero-cost, zero-ops deployment. Squash the `data` branch history periodically so the repo does not bloat.

*Cloudflare note (Q3):* Cloudflare Pages is free with unlimited bandwidth and 500 builds/month, and Workers Cron Triggers + R2 have usable free tiers — so the migration is free, not just cheap. It is worth doing if you ever want sub-15-minute freshness or outgrow Actions minutes, and it does not require a custom domain (`*.pages.dev` works). Nothing in the client depends on the host: it reads a manifest and fetches relative URLs, with the base path from config (Q7).

### 6.4 Data contract

Balances in **chunk files** are POLYX as `number` (base units ÷ 10⁶), rounded to 6 dp — precise enough for charting and far smaller on the wire. Balances in **detail files** are exact base-unit **strings**. Never mix the two.

Columnar arrays, indexed by position in `eras`. `null` means "operator not in the active set that era".

**`data/manifest.json`** — small, `Cache-Control: no-cache`, always fetched first.

```jsonc
{
  "schemaVersion": 1,
  "chain": { "name": "Polymesh Mainnet", "genesisHash": "0x…", "tokenSymbol": "POLYX", "tokenDecimals": 6 },
  "generatedAt": "2026-08-08T09:30:00Z",
  "activeEra": 1403,
  "firstEra": 1319,
  "lastCompleteEra": 1402,
  "erasPerYear": 365,
  "chunkSize": 32,
  "chunks": [
    { "from": 1280, "to": 1311, "path": "chunks/1280.json", "hash": "b1946ac9", "complete": true },
    { "from": 1312, "to": 1343, "path": "chunks/1312.json", "hash": "3a7bd3e2", "complete": true },
    { "from": 1344, "to": 1375, "path": "chunks/1344.json", "hash": "9f2c1d4a", "complete": true },
    { "from": 1376, "to": 1402, "path": "chunks/1376.json", "hash": "c8e0f31b", "complete": false }
  ]
}
```

**`data/chunks/{from}.json`** — up to 32 eras. Chunks with `"complete": true` are immutable forever → `Cache-Control: public, max-age=31536000, immutable`.

```jsonc
{
  "from": 1376, "to": 1402,
  "eras": [1376, 1377, "…"],
  "eraStart": [1754308800, 1754395200, "…"],          // unix seconds
  "network": {
    "totalStaked":      [524310000.0, "…"],
    "totalIssuance":    [1004200000.0, "…"],
    "validatorReward":  [38412.5, "…"],
    "totalPoints":      [1284000, "…"],
    "activeOperators":  [98, "…"],
    "nominatorCount":   [4312, "…"],
    "avgCommission":    [0.0812, "…"],                 // points-weighted, 0–1
    "avgApr":           [0.1241, "…"],                 // after commission, 0–1
    "aprP10":           [0.0980, "…"],
    "aprP50":           [0.1233, "…"],
    "aprP90":           [0.1402, "…"]
  },
  "operators": {
    "2F5rUD5cYMmHqSSmV14UmMExgeaeR4Xdgu2zM2PQZeEFaBNz": {
      "points":         [13200, "…"],
      "commission":     [0.10, "…"],                   // 0–1, Perbill ÷ 1e9
      "totalStake":     [5240000.0, "…"],
      "ownStake":       [120000.0, "…"],
      "nominatorCount": [63, "…"],
      "reward":         [402.13, "…"],                 // gross, before commission
      "apr":            [0.1288, "…"],                 // after commission
      "aprGross":       [0.1431, "…"]
    }
  }
}
```

**`data/operators.json`** — identity registry, regenerated each run. Replaces the hardcoded `operatorsNames`.

```jsonc
{
  "2F5rUD…": {
    "did": "0x047422…",
    "name": "Assetera",
    "nodeLabel": "Assetera 1",
    "website": "https://…",
    "firstSeenEra": 1102,
    "lastSeenEra": 1403,
    "status": "active"        // active | waiting | inactive
  }
}
```

**Identity source — use the official registry.** The Polymesh Association maintains a DID-keyed operator name list at:

```
https://raw.githubusercontent.com/PolymeshAssociation/polymesh-operators/refs/heads/main/operatorNames.json
```

~42 entries, keyed by **DID** (not stash), annotated for departures (`"B89 - Removed"`), and used by the official Portal. Resolution chain: **stash → DID** (on-chain, `identity`) **→ name** (registry) **→ truncated address** (fallback).

The *pipeline* fetches this each run and bakes the result into `operators.json`, so the client makes no extra request and we hold a snapshot if the upstream file ever moves. Fall back to the last good copy on fetch failure — never fail a run over a name.

This retires both the hardcoded `operatorsNames` address map and the unused `didInfo` map (§2.7). Keep `didInfo`'s `website` values as a local supplement — the official registry carries names only — but never hand-maintain addresses again.

**`data/latest.json`** — live-ish state, regenerated every run, `Cache-Control: public, max-age=60`.

```jsonc
{
  "activeEra": 1403,
  "generatedAt": "2026-08-08T09:30:00Z",
  // Anchors only — the client derives progress and countdowns from these
  // against its own clock (§6.6a). No `eraProgress` field: it would be stale
  // the moment it was written.
  "eraStatus": {
    "currentEra": 1403,
    "eraStart": 1754481600,
    "eraStartSlot": "284419200",
    "eraStartSessionIndex": 8412,
    "currentSlot": "284433600",
    "currentSessionIndex": 8415,
    "epochIndex": 8415,
    "genesisSlot": "265680000",
    "sessionsPerEra": 4,
    "epochDurationBlocks": 3600,
    "expectedBlockTimeMs": 6000,
    "electionPhase": "Off"          // Off | Signed | Unsigned | Emergency
  },
  "totalIssuance": "1004200000000000",     // exact base units
  "totalStaked": "524310000000000",
  "stakingRatio": 0.5221,
  "inflation": 0.0929,
  "impliedApr": 0.1779,
  "validatorCount": { "active": 98, "waiting": 14, "max": 120 },
  "operators": [
    { "address": "2F5rUD…", "points": 5400, "commission": 0.10,
      "totalStake": "5240000000000", "ownStake": "120000000000",
      "nominatorCount": 63, "oversubscribed": false, "pageCount": 1, "blocked": false }
  ]
}
```

**`data/rollup-weekly.json`** — network-level metrics only, one row per week, covering all available history. No per-operator arrays, so it stays a few tens of KB even at 1,700+ eras. Long-range overview charts read this instead of chunks (see §6.5a).

**`data/eras/{era}.json`** *(optional, lazy)* — full nominator-level exposure for one era. Only fetched when a user opens nominator-level detail. Keeps the hot path small.

Every chunk additionally carries, per era, the provenance needed for §6.5:

```jsonc
"provenance": {
  "specVersion":  [7000000, 7000000, 8000000, "…"],
  "exposureShape": ["clipped", "clipped", "paged", "…"],
  "source":        ["live", "live", "live", "…"]     // live | backfill-archive | backfill-indexer
}
```

### 6.5 Deep history beyond `historyDepth` (Q9)

You flagged the real constraint here, and it is the reason this is a separate, later phase rather than part of Phase 1.

**Why it is hard.** Era storage (`erasRewardPoints`, `erasStakersClipped`/`Paged`, `erasValidatorPrefs`, `erasTotalStake`, `erasValidatorReward`) is *pruned from current state* once an era ages past `historyDepth`. It is not merely unindexed — it is gone from the current chain state. Recovering it requires reading state **at a historical block**, which needs a node running with state pruning disabled (an archive node). On top of that, Polymesh v6 → v7 → v8 changed both the storage shape (clipped → paged exposures) and the pallet location of staking constants, so a single code path will not read the whole range.

**The good news: `api.at(blockHash)` handles the decoding.** polkadot-js fetches the runtime metadata *as of that block*, so SCALE decoding is correct per spec version automatically. What we must handle ourselves is the *derivation* branching — and the existing `useEraStakers.ts` compat logic already encodes exactly that knowledge. Preserve it; do not rewrite it from scratch.

**Three sources, in descending order of fidelity:**

| Source | Gives us | Needs | Fidelity |
|---|---|---|---|
| **Archive node** via `api.at(hash)` | Everything — points, exposures, prefs, rewards | An archive RPC endpoint | Full |
| **Subscan API** | Era rewards, validator stats | A free API key, rate limits | Partial, and a third-party dependency |
| **SubQuery indexer** (`StakingEvent`) | Realised `Rewarded` payouts per stash, from genesis | Nothing new | Rewards only — no points, no exposures |

**R2 resolved: the public Polymesh RPCs are archive nodes.** They retain historical state, so `api.at(oldBlockHash)` works against `wss://mainnet-rpc.polymesh.network/` with no node of our own. This is not advertised on the resources page — record it in `docs/data-sources.md` as a verified-but-undocumented property, and re-verify it at the start of any backfill run, because an undocumented guarantee can be withdrawn without notice.

That makes full-history backfill genuinely viable, and changes Q9 from "probably not worth it" to "worth doing, once."

**Scale.** Polymesh mainnet launched in 2021 and an era is 24 hours, so full history is on the order of **1,700+ eras** — roughly twenty times `historyDepth`. Establish the exact first era in Phase 1; it sets the size of everything below.

**Finding the block to read each era at.** Era N's storage is present in state from the moment era N is written until it ages out — so read it at a block shortly *after* era N ends. Do not binary-search `staking.activeEra` across the chain to find era boundaries; **use the indexer**, which already knows. Query `Event` for `moduleId: staking` with `eventId: EraPaid` (and `EraPayout` on pre-v7 runtimes — the enum documents the rename) to get the exact block for every era transition in one paginated pass. That is the efficient join between the two data sources, and it is the only place in this design where the indexer feeds the pipeline rather than the client.

**Be a good citizen — this is the heaviest thing in the whole design.** A full backfill is ~1,700 eras × three prefix scans at historical blocks, against someone else's shared public node. That is an order of magnitude more load than the current app's already-abusive 255 scans, and it is exactly the kind of traffic that gets endpoints locked down. Therefore:

- Run it **once, offline, by hand.** Never on the cron, never in CI, never from the browser.
- Serial or concurrency ≤ 2, with a deliberate inter-request delay. Slow is fine — this job has no deadline.
- **Checkpoint after every era** so an interrupted run resumes rather than restarts.
- **Cache metadata per `specVersion`.** `api.at()` fetches runtime metadata for each distinct spec version; without a cache that refetch dominates the run.
- Consider running against a local node synced from a snapshot if the public endpoint shows strain. Falling back is cheaper than getting blocked.

**The default remains natural accumulation.** Every era the pipeline ingests is ours permanently, so history grows on its own with no archive dependency at all. Backfill is strictly additive on top of that, and `provenance.source` keeps backfilled eras distinguishable — if a backfill turns out subtly wrong, drop exactly those eras and the natively-ingested history is untouched.

### 6.5a Consequence: the client must be built for unbounded history

This is the part worth catching now rather than after Phase 5.

At 84 eras the whole dataset is ~120 KB and the client can simply load all of it. At 1,700 eras it is on the order of **2–3 MB brotli**, which cannot go on every page load. Since backfill is now likely, **build the client for arbitrary history from Phase 2 onward, regardless of when the backfill actually runs.** Retrofitting range-based loading after the fact would touch every chart.

Three changes, all cheap if made now:

1. **Load chunks by visible range, not all of them.** The manifest already lists each chunk's era span, so the client resolves the selected range to a chunk set and fetches only those. Default range is **90 days (3 chunks)**; widening the range fetches more, with a progress indicator rather than a blocking spinner.
2. **Add a network-level rollup for long ranges.** `data/rollup-weekly.json` — network metrics only (total staked, issuance, reward, points, average APR, operator count), one row per week, no per-operator arrays. A few tens of KB for all of history. Long-range overview charts (C4–C8) read the rollup; per-operator charts stay on chunks and cap their range accordingly.
3. **Say what is loaded.** The era-range control must never imply data exists where it does not: ranges beyond available history are disabled with an explanatory tooltip, and every chart states its actual coverage ("1,712 eras — Oct 2021 to today" or "84 eras — history accumulates daily from 2026-08-08", whichever is true).

### 6.6 Client runtime

```
App shell (static, instant)
  ├─ fetch manifest.json                          ~1 KB
  ├─ resolve selected era range → chunk set       default 90d = 3 chunks (§6.5a)
  ├─ fetch those chunks in parallel               cached forever after first visit
  │    └─ hydrate into a typed in-memory store, persisted to IndexedDB by chunk hash
  ├─ fetch latest.json                            ~20 KB, 60s cache
  ├─ [long ranges] rollup-weekly.json             network metrics only, all history
  └─ [lazy, on demand only]
       ├─ @polkadot/api + wallet   → only when the user connects a wallet
       ├─ indexer GraphQL          → only on /my-staking
       └─ eras/{era}.json          → only on nominator-level drill-down
```

- **No `@polkadot/api` on the critical path.** It is dynamically imported behind the "Connect wallet" action and the optional live-data toggle.
- **Derived metrics are memoised once** in a selector layer (`lib/selectors/*`), not recomputed per chart. Heavy aggregations (percentile bands, small-multiples grids) run in a Web Worker via Comlink and are cached by `(metric, eraRange)`.
- **IndexedDB persistence** keyed by chunk hash. A returning visitor with no new era does zero data fetching beyond the manifest. Chunks already held are never refetched when the range widens — only the newly-needed ones are.
- **Progressive rendering.** The shell, nav, and stat-tile skeletons paint immediately. Charts fill in as chunks land. Nothing is gated behind a full-page spinner ever again.

### 6.6a Data freshness: live, snapshot, and derived

Not everything is a static snapshot, and not everything needs to be. Four tiers, and the assignment matters more than it looks.

| Tier | Mechanism | Cost | Used for |
|---|---|---|---|
| **1 — Immutable** | Era chunks, `max-age=31536000` | Zero after first load | All completed eras |
| **2 — Snapshot** | `latest.json`, regenerated every 15 min | One small fetch | Current-era points, exposures, validator set, oversubscription, issuance, election phase |
| **3 — Derived** | Computed in-browser from tier-2 anchors + local clock | **Zero network** | Era/epoch progress, countdowns, time-to-next-election |
| **4 — Live** | Opt-in WSS subscription, lazily loaded | `@polkadot/api` | A narrow set, only when the user asks or connects a wallet |

**Era progress is tier 3, not tier 4 — it needs no connection at all.** This is the key realisation. `latest.json` carries the *anchors* (era start slot, era start session index, current slot and its timestamp, epoch duration, sessions per era, expected block time) and the browser ticks its own clock against them. A countdown rendered locally is smoother and cheaper than one polled over a socket.

The Polymesh Portal derives progress from **slots** (`babe.currentSlot` less the era's start slot, via `babe.genesisSlot` and `staking.erasStartSessionIndex`), which is exact. Wall-clock interpolation between 15-minute snapshots drifts only by block-time variance across that window — seconds on a 24-hour era, invisible on a progress ring. Turning on Live upgrades it to slot-exact. Anchors, not a precomputed `eraProgress` value, go in the file, so the intent is unmistakable.

**Era points are the one genuinely live thing**, and worth noting: *the official Portal doesn't stream them either.* It reads `erasRewardPoints` once, for the previous era, to rank operators in the nomination modal. At 15-minute granularity on a 24-hour era that is ~1% resolution against a quantity that accrues roughly uniformly — so snapshot is the honest default, with Live available for anyone watching a block-by-block race.

**Election phase is the one place 15 minutes is arguably coarse** — the window is short and sits at the era boundary. It ships in tier 2 with an explicit "as of HH:MM", and Live makes it exact. If it turns out people care, the Cloudflare Worker path (§6.3) makes one-minute snapshots trivial; do not solve this speculatively.

**Tier 4 subscription set.** Narrow and specific — this is the Portal's proven set, not a guess:

```
staking.activeEra · staking.currentEra          era rollover
session.currentIndex · babe.epochIndex          session position
babe.currentSlot                                 slot-exact progress
electionProviderMultiPhase.currentPhase          Off | Signed | Unsigned | Emergency
staking.erasRewardPoints(activeEra)              points accruing now
staking.nominators(stash)                        only when a wallet is connected
system.events  (filtered — see below)            invalidation trigger
```

Live is **off by default**, behind an explicit toggle with a live-dot indicator. It never gates first paint: the page renders fully from tiers 1–3, and the socket upgrades values in place. Anyone who connects a wallet has already paid for `@polkadot/api`, so Live is free for them and can default on.

**Staking-event filter.** For both live invalidation and the pipeline's change detection, watch exactly these — again, the Portal's list, which encodes real knowledge of the v8 pallet split:

- `staking`: `Bonded`, `Unbonded`, `Withdrawn`, `Slashed`, `StakersElected`, `Rewarded`
- `validators`: `Nominated`, `InvalidatedNominators` — note nomination moved to the `validators` pallet in v8
- `offences`: `Offence`
- `imOnline`: `SomeOffline`

This replaces the current app's `OperatorsTokensNominated` pattern of refetching three full storage maps on any matching event.

**Honesty rule.** Every tier-2 value renders with an "as of HH:MM" affordance; tier-3 values tick; tier-4 values carry a live dot. A user must never have to guess whether a number is current — which is precisely what the current app leaves them to do.

### 6.7 Framework decision

**Recommendation: stay on Next.js, upgrade to 16.** This was reconsidered from first principles rather than inherited — the alternatives were weighed and lost on specific grounds.

Note first that **Next.js 16 removes the Pages Router entirely.** The current app is Pages Router, so there is no incremental upgrade path regardless of framework. This is a rewrite either way, which is why the question was worth reopening.

What the site actually is: a fully static host with no server and no rewrites (Q3, Q7); ~150 operator detail pages that want prerendering for SEO; deep URL state across many parameters; and heavy client-side interactivity in charts and tables.

| Candidate | Why it lost |
|---|---|
| **Astro 7 + React islands** | Genuinely better on content routes — near-zero JS and native MDX for the glossary. But of nine routes, only `/about` is actually static. Home has live tiles and a gauge; `/network` is all charts; `/operators` is a large interactive table; compare, calculator and my-staking are entirely interactive. The islands advantage applies to roughly one route, and it costs a second mental model plus cross-island shared state (the pinned-operator selection spans charts) via nanostores. Not worth it for 1/9. |
| **Vite + TanStack Router (SSG)** | Its typed, validated search params are the best-in-class answer to our "URL is the state container" requirement, and it would genuinely be the nicest thing to write. But its prerender/SSG story is the youngest of the three, and we need ~150 prerendered pages with good SEO. Reconsider if the URL-state layer turns out to be the main source of bugs. |
| **SvelteKit** | Smaller bundles and an excellent static adapter, but TanStack Query/Table are React-first, the existing domain code is React, and an agentic workflow is more reliable on the better-documented path. |

Next.js 16 gives us: battle-tested static export under a base path, `generateStaticParams` for the operator pages, and the patterns an agent is most likely to get right first time. Its cost is a React runtime on `/about` that Astro would have avoided — an acceptable price.

**The framework is not where the performance win comes from.** The data architecture in §6.1–6.6 is. Any of these four would hit the §11 budgets once history stops being recomputed in the browser; the choice above optimises for maintainability by one person plus an agent.

### 6.8 Stack

Versions verified against the npm registry at time of writing. Pin majors; let minors float.

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16.3** (App Router, `output: 'export'`) | See §6.7. Pages Router no longer exists in 16 |
| Runtime | **React 19.2** | Required by Next 16 |
| Language | **TypeScript 5.x, `strict: true`** | Zero `@ts-ignore` budget outside a documented `lib/chain/compat.ts` |
| Styling | **Tailwind CSS 4.3** with tokens via `@theme` | Enforces the scale in §7; no ad-hoc values |
| Charts | **`d3-scale` / `d3-shape` / `d3-array` + React-rendered SVG** | No chart library. Once we stop drawing 100 lines, SVG is ample — and gives real DOM, CSS theming, crisp text, and accessibility for free. Import d3 submodules only, never the `d3` meta-package |
| Dense fallback | **uPlot 1.6**, only if a specific view profiles poorly in SVG | ~45 KB, canvas. Do not reach for it pre-emptively |
| Data/cache | **TanStack Query 5.101** + IndexedDB persister | `staleTime: Infinity` for immutable chunks |
| Tables | **TanStack Table 9** | Sorting, filtering, column visibility, virtualisation. Note: v9, not the v8 most examples show |
| Validation | **Zod 4** | One schema, shared by pipeline and client. v4 — the API differs from v3 |
| URL state | **nuqs 2.9** | Typed search-param state; the closest thing to TanStack Router's params without changing framework |
| Wallet | `@polymeshassociation/browser-extension-signing-manager`, lazy | Unchanged, but off the critical path |
| Worker | **Comlink 4.4** | Heavy aggregation off the main thread |
| Tests | **Vitest 4** + Testing Library; **Playwright 1.62** e2e + visual regression | Chart output is visual; regressions must be caught visually |
| A11y CI | **@axe-core/playwright 4.12** | Zero violations, enforced |
| Tooling | ESLint 9 flat config, Prettier, **knip 6** | `knip` would have caught all three dead files in §2.7 |

**Removed:** `chart.js`, `react-chartjs-2`, `chartjs-plugin-zoom`, `chartjs-plugin-datalabels`, `chartjs-plugin-annotation`, `react-query` v3, the `d3` meta-package, and `@polymeshassociation/polymesh-sdk` from the critical path.

---

## 7. Design system

### 7.1 Brand — official palette, measured

**R3 resolved.** The official kit specifies four named swatches plus a gradient:

| Name | Hex | vs light `#FCFBFC` | vs dark `#141019` | Verdict |
|---|---|---|---|---|
| **Poly Pink** | `#EC4673` | **3.58:1** | **5.09:1** | ✅ Works in both modes. **Categorical slot 1 and focus ring** |
| **Poly Purple** | `#43195B` | **13.31:1** | 1.37:1 | Light-mode identity ink only — **unusable on dark** |
| **Poly Fuchsia** | `#FA75F8` | 2.27:1 | **8.02:1** | Dark-mode accent only — too light for light mode |
| **Poly Pink Light** | `#FAD1DC` | 1.34:1 | 13.61:1 | Light-mode surface tint, or dark-mode text. **Never a data colour** |
| *gradient stops* | `#FF2E72` → `#4A125E` | 3.46:1 / 13.22:1 | 5.27:1 / 1.38:1 | The logo SVG's actual values |

Two observations worth recording.

**The kit is internally inconsistent.** The named swatches (`#EC4673`, `#43195B`) and the gradient stops (`#FF2E72`, `#4A125E` — which are what `public/polymesh-logo.svg` actually contains) are near-but-not-equal pairs. Neither is wrong; they were evidently specified at different times. **We use the named swatches**, because they are what the kit presents as the palette, and because `#EC4673` happens to validate slightly better. The logo asset keeps its own gradient untouched.

**Purple and Fuchsia are a mode pair, though the kit never says so.** Poly Purple is superb on light (13.3:1) and invisible on dark (1.37:1); Poly Fuchsia is the exact inverse (2.27 / 8.02). That gives a clean, entirely on-brand light/dark accent pairing at no cost — used in §7.2.

*Correction to an earlier draft of this document:* it claimed `#FF2E72` was unusable for data marks at ≈2.3:1. Measured, it is **3.46:1** and does clear the 3:1 bar. The reason we use `#EC4673` is that it is the official named swatch, not a contrast failure.

**Relationship to the kit (Q2).** The kit is thin and not built with accessibility in mind, so:

- **Logo, wordmark, and clear-space rules: follow it exactly.** Identity is theirs. Observe the stated don'ts — no shadows, no recolouring, no low-resolution use, no containers or rotation.
- **UI and data colours: §7.2–7.4 govern**, and every brand value used there has been measured above. Where a brand colour cannot carry a role (Purple on dark, Fuchsia on light), the validated substitute wins and the reason is the measurement in this table.

Brand colours are chosen to look right on a poster; data colours have to survive being eight thin lines beside each other, in dark mode, read by someone with deuteranopia. The good news here is that the two requirements collided far less than expected — Poly Pink carries slot 1 in both modes unmodified.

### 7.2 Surfaces and ink

| Role | Light | Dark |
|---|---|---|
| Page plane | `#F7F6F8` | `#0D0A10` |
| Chart / card surface | `#FCFBFC` | `#141019` |
| Raised surface | `#FFFFFF` | `#1C1622` |
| Primary ink | `#14101A` | `#FFFFFF` |
| Secondary ink | `#55505E` | `#C4BFCC` |
| Muted (axis, labels) | `#8B8595` | `#8B8595` |
| Gridline (hairline) | `#E6E2EA` | `#2A2432` |
| Baseline / axis | `#C4BFCC` | `#3A3344` |
| Border (hairline ring) | `rgba(20,16,26,0.10)` | `rgba(255,255,255,0.10)` |
| Brand accent (UI, not data) | Poly Purple `#43195B` | Poly Fuchsia `#FA75F8` |
| Brand surface tint | Poly Pink Light `#FAD1DC` | — |
| Focus ring | Poly Pink `#EC4673` | Poly Pink `#EC4673` |

Dark mode is a **selected** palette, not an inversion. Define light values on bare `:root`; redefine dark under **both** `@media (prefers-color-scheme: dark)` guarded with `:root:not([data-theme="light"])` **and** `:root[data-theme="dark"]`, so an explicit toggle wins in both directions.

### 7.3 Categorical data palette — validated

Eight slots, assigned **in fixed order, never cycled**. Colour follows the **entity**, never its rank — an operator keeps its colour across every chart and every filter change.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | **Poly Pink (brand)** | `#EC4673` | `#EC4673` |
| 2 | blue | `#2A78D6` | `#4A93EB` |
| 3 | amber | `#E08A00` | `#C98500` |
| 4 | aqua | `#1BAF7A` | `#199E70` |
| 5 | brand purple | `#7A3FA6` | `#A96FD1` |
| 6 | green | `#008300` | `#2E9E4F` |
| 7 | cyan | `#00A0C6` | `#1B93B0` |
| 8 | rust | `#B4531F` | `#C4661F` |

**Validation results** (`scripts/validate_palette.js`, OKLab ΔE ×100; surfaces `#FCFBFC` / `#141019`):

- Light, 8 slots, adjacent pairs — **all checks pass.** Worst adjacent CVD ΔE **9.3** (protan, aqua↔amber); worst adjacent normal-vision ΔE **22.3**.
- Dark, 8 slots, adjacent pairs — **all checks pass.** Worst adjacent CVD ΔE **8.4** (protan, aqua↔amber); worst adjacent normal-vision ΔE **15.4**; all 8 ≥ 3:1 contrast.
- **Slot 1 is mode-invariant.** Poly Pink `#EC4673` clears the lightness band and the 3:1 bar on *both* surfaces, so the brand colour is one hex everywhere — no dark-mode substitute needed.
- **All-pairs forms cap at 3 slots.** Slots 1–3 pass all-pairs in both modes (CVD ΔE 11.8 light / 9.4 dark). Slot 4 drops the light all-pairs CVD into the 6–8 warn band and fails it in dark (ΔE 4.0). **Scatter, bubble, and small-multiples-with-shared-legend therefore use at most 3 categorical hues**; beyond that, facet or fold to "Other".
- **Relief rule (light mode):** amber (2.61:1), aqua (2.73:1), and cyan (2.97:1) sit below 3:1 on the light surface. Every chart using them **must** ship visible direct labels or the table view. This is not optional.

Re-run the validator if any hex changes.

### 7.4 Other data colour roles

- **Sequential** (magnitude — heatmaps, choropleths): single hue, brand purple, light→dark. Ordinal ramps start no lighter than a 2:1 step against the surface.
- **Diverging** (polarity — deviation from average, above/below): **blue ↔ magenta**, neutral grey midpoint (`#EFEDF1` light / `#332C3C` dark). Equal steps per arm. Never a hue at the midpoint.
- **Status** (reserved; never reused as a series colour, always paired with an icon **and** a label):

| Role | Hex | Use |
|---|---|---|
| good | `#0CA30C` | healthy, elected, earning |
| warning | `#FAB219` | oversubscribed, near capacity |
| serious | `#EC835A` | chilled, blocked, underperforming |
| critical | `#D03B3B` | slashed, offline |

- **"Other operators" cloud:** not a categorical slot. Muted ink at low alpha (`#8B8595` @ 12%), one colour for all of them.
- **The user's own operators:** always slot 1, Poly Pink `#EC4673`, plus a persistent pin icon. Never colour alone.

### 7.5 Typography

**Inter Variable** for everything, **JetBrains Mono** for addresses and hashes. Both SIL OFL 1.1, both self-hosted via `next/font/local` — no Google Fonts request, no render-blocking `@import` like the current app's.

**Deliberately not Poppins.** Polymesh leans on it, and it is the wrong tool here regardless of taste: Poppins is a geometric display sans with a single-storey `a`, near-circular counters, and wide, evenly-weighted figures. It is handsome at 48px on a marketing page and actively poor at 12–13px in a dense table — which is most of this site. Inter was drawn for UI at small sizes, has genuine tabular figures, and disambiguates `1`/`l`/`I` and `0`/`O`, which matters when the screen is full of SS58 addresses and POLYX amounts.

*If you want something less ubiquitous:* **Geist Sans + Geist Mono** (OFL, designed as a pair) is the one swap I would endorse — similar small-size discipline, more personality. Swap both together and re-check the type scale below; change nothing else.

No display or serif face anywhere, including hero numbers.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display` | 40 / 44 | 600 | hero stat |
| `h1` | 30 / 36 | 600 | page title |
| `h2` | 22 / 28 | 600 | section |
| `h3` | 17 / 24 | 600 | card / chart title |
| `body` | 15 / 22 | 400 | prose |
| `body-sm` | 13 / 18 | 400 | secondary |
| `label` | 12 / 16 | 500, +0.01em | axis, legend, table header |
| `mono` | 13 / 18 | 400 | addresses, hashes |

`font-variant-numeric: tabular-nums` on **table cells, axis ticks, and any vertically aligned column** — and nowhere else. Standalone hero figures use proportional figures.

### 7.6 Spacing, radius, elevation, motion

- **Spacing:** 4px base — `4 8 12 16 24 32 48 64 96`. Nothing off-scale.
- **Radius:** `sm 6` (controls) · `md 10` (cards) · `lg 16` (panels) · `full` (pills).
- **Elevation:** hairline border first, shadow second. `shadow-sm` for cards, `shadow-md` for popovers/tooltips only. No 40px drop shadows.
- **Motion:** 120ms for state changes, 200ms for entrances, `cubic-bezier(0.2, 0, 0.2, 1)`. Charts animate on first paint only, never on data update. **All motion respects `prefers-reduced-motion: reduce`.**

### 7.7 Layout

Fluid and mobile-first. **Delete the fixed-width viewport meta tag** — replace with `width=device-width, initial-scale=1`.

| Breakpoint | Width | Behaviour |
|---|---|---|
| `sm` | < 640 | Single column. Charts full-bleed, min-height 240px. Tables → stacked cards. Nav → bottom bar or sheet |
| `md` | 640–1023 | Single column, wider gutters. Tables scroll horizontally with a sticky first column |
| `lg` | 1024–1439 | 2-up chart grid. Persistent top nav. Filter rail collapsible |
| `xl` | ≥ 1440 | 2–3-up grid, max content width 1440px, centred |

Chart font sizes scale via **CSS `clamp()` on the SVG root**, not a JS resize listener mutating globals.

---

## 8. Chart specification

### 8.1 Rules (normative)

1. **Every chart states the question it answers** in its title or subtitle. If it doesn't answer one, delete it.
2. **One y-axis. Never two.** Two measures of different scale → two stacked charts sharing an x-axis, small multiples, or index both to a common base. This retires the three-axis charts in §3.3.
3. **Categorical hues in fixed order, never cycled.** A 9th series is never a generated hue.
4. **Colour follows the entity.** Filtering must not repaint the survivors.
5. **Legend always present for ≥ 2 series** (a single series is named by the title). Series 1–4 are **also** direct-labelled at the right edge. Identity is never colour-alone.
6. **Every chart has a table view** — a `Chart | Table` toggle rendering the same data as an accessible `<table>`, with CSV/JSON copy.
7. **Hover layer by default:** crosshair + shared tooltip on line/area; per-mark tooltip on bar/dot/cell. Hit targets larger than the marks.
8. **Marks:** 2px lines, ≥8px point targets, 4px rounded data-ends on bars anchored to the baseline, 2px surface gap between adjacent fills, 2px surface ring where lines overlap.
9. **Recessive chrome:** hairline grid, muted axes, no chart-area borders, no gradient fills, no drop shadows on data.
10. **X-axis is time.** Primary tick label is a **date**; era index is the secondary label and appears in the tooltip.
11. **Text wears text tokens**, never a series colour. A coloured swatch beside the label carries identity.
12. **Empty, loading, and error states are part of the chart component**, not an afterthought. Skeletons reserve exact final height — CLS budget is 0.

### 8.2 The spaghetti fix

This replaces the ~100-line operator charts and is the most important visual change in the rebuild.

**Form: banded multi-series line.** Four layers, bottom to top:

1. **Distribution band** — p10–p90 across all operators, filled muted ink @ 8%. Labelled *"All operators (10th–90th percentile)"*.
2. **Median line** — 1.5px dashed, muted ink. Labelled at the right edge.
3. **Network average** — 2px dashed, secondary ink. Direct-labelled.
4. **Selected operators** — up to 8, 2px categorical lines in fixed slot order, 2px surface ring at crossings, direct labels at the right edge for the first 4.

**Default selection**, in order of availability: the connected wallet's nominated operators (capped at 8) → the 5 largest by current stake → none (band and average only).

**Selection UI:** a combobox above the chart with search, plus one-click pinning from the operators table and from any operator detail page. Selection is **global across the session and encoded in the URL** (`?ops=addr1,addr2`). Pinning an operator on `/operators` and navigating to `/network` keeps it pinned, in the same colour.

**"Show all operators"** toggles to a **small-multiples grid**: one sparkline per operator, 4–6 per row, each showing the p10–p90 band as background and that operator's line in primary ink (not a categorical hue — there is no cross-panel identity to encode). Sortable by the displayed metric. This is the readable way to see all 100 at once; the overlay never was.

### 8.3 Chart catalogue

| # | Chart | Question | Form | Page |
|---|---|---|---|---|
| C1 | Network stat tiles | What is the network doing right now? | Stat tiles + sparkline + delta | Home, Network |
| C2 | Staking ratio vs ideal | Are we near the 70% ideal? | Gauge/bullet with 70% target marker | Home, Network |
| C3 | Reward & inflation curve | How does APR respond to the staking ratio? | Two lines + annotated current-position marker | Network, Calculator |
| C4 | Total staked over time | Is stake growing? | Area, one series | Network |
| C5 | Average APR / APY over time | What has the return been? | Multi-line (4 series max, slots 1–4) | Network |
| C6 | Total rewards per era | What is being paid out? | Bar | Network |
| C7 | Total points per era | Is block production stable? | Line + band | Network |
| C8 | Validator-set size | Is the active set changing? | Step line, active vs waiting | Network |
| C9 | Stake concentration | How decentralised is stake? | Lorenz curve + Nakamoto/HHI stat tiles | Network |
| C10 | Top-N stake share | Who holds the stake? | Stacked area, top 8 + "Other" | Network |
| C11 | Operator APR over time | How does an operator compare? | **§8.2 banded multi-series** | Operators, Compare, Detail |
| C12 | Operator points over time | Is the node reliable? | **§8.2 banded multi-series** | Operators, Compare, Detail |
| C13 | Operator stake over time | Is it gaining or losing stake? | **§8.2 banded multi-series** | Operators, Compare, Detail |
| C14 | Operator commission over time | Has commission changed? | Step line (commission is stepwise, not continuous) | Detail, Compare |
| C15 | Cumulative deviation from average | Consistently above or below? | Diverging line, zero baseline | Operators, Detail |
| C16 | Operator directory | Who should I nominate? | **Sortable table** with inline bars + sparklines | Operators |
| C17 | Current-era stake by operator | How is stake distributed today? | Horizontal bar, sorted, top 20 + "Other" | Operators |
| C18 | Current-era points by operator | Who is producing today? | Horizontal bar with expected-value reference line | Operators |
| C19 | Operator consistency | Reliable or erratic? | Box plot / beeswarm of per-era points | Detail |
| C20 | Nominator distribution | Whale-dominated or broad? | Histogram, log-x | Detail |
| C21 | Slashing timeline | When did offences occur? | Event timeline with severity status colours | Slashing |
| C22 | Reward projection | What would I earn? | Bar with sensitivity range | Calculator |
| C23 | My rewards over time | What have I earned? | Bar (per era) + cumulative line, **stacked, shared x** — not dual-axis | My Staking |
| C24 | My operators' performance | Are my picks good? | §8.2 with the user's operators pre-pinned | My Staking |

**Retired:** the separate before-/after-commission APR charts (one chart, a toggle); the standalone "% of reward points" chart (a table column); the three-y-axis charts (split per rule 2).

---

## 9. Page specifications

### 9.1 `/` Home

- **Hero:** one sentence stating what the site is, plus the headline number — current average APR after commission, with a 30-day delta and sparkline.
- **Stat tile row (C1):** Total Staked · Staking Ratio (vs 70% ideal) · Active Operators · Current Era + countdown to next · Annual Inflation. Each with a delta and a sparkline.
- **Staking ratio gauge (C2)** with the 70% target marked and a plain-language reading ("below ideal — rewards are above their long-run level").
- **Three entry cards:** *Find an operator* → `/operators` · *Check my staking* → `/my-staking` · *Estimate returns* → `/calculator`.
- **Recent activity:** last 5 notable events (commission changes, new operators, slashes).
- Must render meaningful content **from `latest.json` alone**, before any chunk lands.

### 9.2 `/network`

Sections, each with a one-line explainer: **Rewards & Returns** (C5, C6, C3) · **Stake** (C4, C2) · **Participation** (C7, C8) · **Decentralisation** (C9, C10) with Nakamoto coefficient, HHI, and top-10 share as tiles.

Global era-range control (30d · 90d · All · custom), URL-encoded, applied to every chart on the page.

### 9.3 `/operators`

**The table (C16) is the primary content and appears above the charts.** Columns:

`★ pin` · Operator (name, truncated address, identity badge) · Status · Commission · Total Stake (inline bar) · Self Stake · Nominators · APR 30d · APR 90d (sparkline) · Points 30d · Consistency score · Oversubscribed?

- Sortable on every numeric column; multi-column sort.
- Filters in **one row above** the table: search, status, commission range, oversubscription, "my nominations only".
- Column visibility control; density toggle; CSV/JSON export.
- Row → `/operators/[address]`. Pin → adds to global selection and to `/compare`.
- Virtualised. Sub-16ms sort on 200 rows.
- Below the table: C17, C18, C11 (with pinned operators shown).

### 9.4 `/operators/[address]`

- **Header:** name, identity + website, address with copy button and Subscan link, status badge, pin and compare actions.
- **Stat tiles:** Commission · Total Stake · Self Stake (and self-stake ratio) · Nominators · APR 30d · Points rank · Eras active · Slashes.
- **Charts:** C11, C12, C13 (each with this operator highlighted against the field band), C14, C15, C19, C20.
- **Nominator table** — lazily loads `eras/{era}.json`. Paginated.
- **Event history** — commission changes, chilling, slashes, from the indexer.
- Static export note: pre-render the top ~50 operators via `generateStaticParams`; the remainder resolve client-side from `operators.json` behind a shared `[address]` shell.

### 9.5 `/compare`

2–5 operators from the URL. Header row of operator cards. A **metric-comparison table** (rows = metrics, columns = operators, best value emphasised). Then C11/C12/C13/C14 restricted to the selected set. A "differences that matter" callout listing metrics where the spread exceeds a threshold.

### 9.6 `/my-staking`

**Disconnected state must be useful, not a wall.** Show what the page will contain, a "Connect wallet" button, and an address-input fallback so anyone can inspect any stash without an extension.

Connected: **Position** (bonded, active, unbonding chunks with unlock dates, reward destination) · **Performance** (C23, realised APR versus network average, total earned) · **My operators** (C24, plus a table with a warning row for any operator that is oversubscribed, has raised commission, or has been slashed) · **Payouts** (unclaimed eras, if determinable) · **Export** (CSV of reward history — a regulated-asset chain's users need this for reporting).

Reward history comes from the **indexer** (`StakingEvent` where `eventId` is `Rewarded`, filtered by `stashAccount`) — it is not available from current chain state. Paginate; the endpoint caps at 100 results per query.

`@polkadot/api` loads **only** when the user connects.

### 9.7 `/calculator`

Inputs: amount, operator (or "network average"), duration, compounding on/off. Outputs: projected rewards (C22) with a sensitivity range derived from the operator's historical APR variance, effective APR after commission, and a clear statement of assumptions. Cross-links to C3 so the staking-ratio dependency is visible. Every input in the URL, so results are shareable.

### 9.8 `/slashing`

C21 timeline, a table of all offences (era, operator, type, amount, nominators affected), and per-era fine totals — the current `FineCurves` chart, promoted out of Overview and given context.

### 9.9 `/about`

Glossary (era, points, exposure, commission, oversubscription, stash/controller, chilling, nomination). Methodology — **every formula written out**, including the reward curve constants (I₀ = 2.5%, x_ideal = 70%, I_ideal = 14%, decay = 5%), the APR derivation, and the points-weighted commission average. Data sources and update cadence. Known limitations. Link to the repo.

---

## 10. Accessibility

Target: **WCAG 2.2 AA**, verified, not assumed.

- Semantic landmarks; skip-to-content link; one `<h1>` per page and a correct heading order.
- Full keyboard operability. Visible focus ring (Poly Pink `#EC4673`, 2px, 2px offset) on every interactive element, including chart marks.
- **Charts:** `role="img"` with a generated `aria-label` summarising the trend, plus a visually-hidden `<table>` of the underlying data. The `Chart | Table` toggle exposes the same table visibly.
- **Chart keyboard navigation:** arrow keys move a focus cursor along the x-axis, announcing values via a live region.
- Identity never colour-alone: legend + direct labels always; a texture channel (45°/135° line fill) available behind an accessibility setting, `print`, and `forced-colors`.
- Contrast: text ≥ 4.5:1, UI and marks ≥ 3:1. Where a light-mode series colour falls below 3:1 (amber, aqua, cyan — §7.3), **direct labels or the table view are mandatory**.
- `prefers-reduced-motion: reduce` disables all chart animation and transitions.
- Live regions announce data updates and era transitions politely.
- **Automated:** `axe-core` in Playwright on every route, zero violations, enforced in CI. **Manual:** one keyboard-only and one screen-reader pass per phase.

---

## 11. Performance budgets

Enforced in CI. A build that exceeds a budget fails.

| Metric | Budget | Current `‹measure›` |
|---|---|---|
| LCP (mobile, 4G, mid-tier device) | **< 1.5s** | ‹measure› |
| First meaningful chart | **< 2.0s** | ‹measure› |
| INP | **< 200ms** | ‹measure› |
| CLS | **< 0.05** | ‹measure› |
| Critical-path JS (gzip) | **< 180 KB** | ‹measure› |
| Critical-path data, default 90d range (brotli) | **< 120 KB** | n/a |
| Widening to full history (brotli, incremental) | **< 2.5 MB**, streamed with progress, never blocking | n/a |
| `rollup-weekly.json`, all history (brotli) | **< 60 KB** | n/a |
| Total transfer, cold, home | **< 350 KB** | ‹measure› |
| Repeat visit, same era | **< 5 KB** (manifest only) | ‹measure› |
| Lighthouse Perf / A11y / BP / SEO | **≥ 95** each | ‹measure› |
| Table sort, 200 rows | **< 16 ms** | n/a |

Techniques: route-level code splitting; `@polkadot/api` and the indexer client dynamically imported; d3 submodule imports only; immutable chunk caching (`max-age=31536000, immutable`) + IndexedDB; `content-visibility: auto` on below-fold charts; self-hosted fonts with `font-display: swap` and preload; brotli via GitHub Pages; skeletons that reserve exact final dimensions.

---

## 12. Quality gates

- **Unit (Vitest):** every metric derivation in `lib/metrics/*` tested against fixtures captured from real chain data. Port the existing APR, commission-weighting, and points-share maths — it is correct, and it is the crown jewel of the current codebase. Include the v6/v7/v8 exposure-shape variants.
- **Schema:** every generated data file validated against its Zod schema in the pipeline **and** on load in dev.
- **Pipeline idempotency:** re-ingesting an already-ingested era produces byte-identical output. Asserted in CI.
- **Component (Testing Library):** loading, empty, error, and populated states for every chart and table.
- **E2E (Playwright):** each route loads and renders; wallet-disconnected states are usable; URL state round-trips (set filters → reload → identical view); CSV export produces valid output.
- **Visual regression:** Playwright screenshots of every chart in light and dark, at `sm` and `xl`. Charts fail visually long before they fail functionally.
- **A11y:** `axe-core` on every route, zero violations.
- **Dead code:** `knip` in CI, zero unused exports.
- **Budgets:** Lighthouse CI on every PR.

---

## 13. Execution plan

Each phase is a commit (or a small series). **A phase is not done until its acceptance criteria pass.**

### Phase 0 — Baseline and verification *(no product code)*

1. **Baseline the current app** — Lighthouse (mobile + desktop) on every route; total wire bytes and wall-clock for a cold `/operator-charts` load; RPC request count; JS bundle size. Also measure R4: the real payload of a single `erasStakersPaged.entries(era)`. Write to `docs/baseline.md`.
2. **Verify runtime facts** marked *verify*: `historyDepth`, `sessionsPerEra`, `epochDuration`, `expectedBlockTime`, era duration, active/waiting operator counts, total nominator count.
3. **Re-confirm archive access** — R2 is answered (the public RPCs are archive nodes), but it is undocumented, so verify it still holds: `(await api.at(oldHash)).query.staking.erasRewardPoints(oldEra)` for an era well past `historyDepth`. Also establish the **first era on chain**, which sizes Phase 9. Record both in `docs/baseline.md`.
4. **Transcribe the settled reference data** — endpoints from §6.2 into `config/networks.ts`, brand measurements from §7.1 into `docs/brand-deviations.md`. Both are already resolved in this document; this step just puts them where code reads them.
5. **Capture fixtures** for three eras — one pre-v8 (clipped exposures), one post-v8 (paged), one current — into `fixtures/`. These are the test corpus for every ported metric.

**Acceptance:** `docs/baseline.md` has real numbers including the R4 measurement, the re-confirmed archive read, and the first era on chain (R6); `config/networks.ts` and `docs/brand-deviations.md` exist; fixtures committed for all three era shapes.

### Phase 1 — Data pipeline

Build `scripts/ingest/`. Zod 4 schemas in `lib/schemas/`. Metric derivations in `lib/metrics/`, ported from the existing chart components and unit-tested against Phase 0 fixtures. Cold-ingest the full history depth. Emit `manifest.json`, chunks (with `provenance`), `operators.json`, `latest.json`. Wire **both** GitHub Actions workflows from §6.3 and the orphan `data` branch.

**Acceptance:** full history ingested and schema-valid; operator names resolve stash → DID → registry with a working fallback to the last good copy; `latest.json` carries era/epoch anchors and no precomputed progress; a warm `ingest-era` run with no new era exits in under 10s having made one RPC call; a warm run *with* a new era fetches exactly that era; re-ingest is byte-identical; every era carries correct `provenance.specVersion` and `exposureShape`; ported metrics match the current app's output within floating-point tolerance on all three fixtures; total chunk payload < 120 KB brotli.

### Phase 2 — App shell and design system

Next.js 15 App Router scaffold. Tailwind v4 with every token from §7. Light/dark with a working toggle and correct three-state theming. Typography, spacing, layout primitives. Nav, footer, skip link, landmarks. Data-loading layer: manifest → chunks → IndexedDB, with TanStack Query. Loading / empty / **error** states, including a real RPC/data-failure state with retry. `/about` with the glossary and methodology (it is pure content and validates the type scale early).

**Acceptance:** shell renders < 1s cold; theme toggle correct in all three states; axe clean; responsive at all four breakpoints; a simulated data-fetch failure shows a recoverable error, never an infinite spinner. **The loader resolves an era range to a chunk set and fetches only those chunks** (§6.5a) — verify against a synthetic manifest advertising 1,700 eras, so the range logic is proven before any backfill exists.

### Phase 3 — Chart kit

`components/charts/` primitives: `ChartFrame` (title, subtitle, legend, table toggle, states), axes, grid, tooltip/crosshair, legend, direct labels, band, small-multiples grid, stat tile, sparkline. All SVG, all tokenised, all keyboard-navigable, all with the hidden data table. Storybook or an internal `/kitchen-sink` route.

**Acceptance:** every primitive renders in light and dark at `sm` and `xl`; keyboard navigation announces values; visual-regression baselines captured; a two-series line chart is < 16ms to render.

### Phase 4 — Network analytics

`/` and `/network`. Charts C1–C10. Era-range control with URL state.

**Acceptance:** home LCP < 1.5s on throttled 4G; home renders usefully from `latest.json` before chunks land; **the era countdown ticks with zero network traffic** (tier 3, §6.6a) — verify with the network tab idle; every tier-2 value shows an "as of" affordance; every chart has a working table view; all §11 budgets met on these routes.

### Phase 5 — Operators

`/operators` (C16 table first, then C17, C18, C11), `/operators/[address]` (C11–C15, C19, C20), and the global pin/selection model with URL encoding.

**Acceptance:** table sorts 200 rows in < 16ms; pinning persists across routes and reloads; operator colours are stable across every chart; CSV export valid; top-50 operator pages pre-rendered, the rest resolve client-side.

### Phase 6 — Compare, Calculator, Slashing

`/compare`, `/calculator`, `/slashing` (C21, C22, and the promoted fines charts).

**Acceptance:** comparison URLs round-trip 2–5 operators; calculator inputs are all URL-encoded and shareable; projections match the documented formulas in `/about`.

### Phase 7 — My Staking

Lazy wallet integration, indexer client, `/my-staking` (C23, C24), reward-history CSV export, oversubscription and commission-change warnings. **Also the tier-4 Live toggle** (§6.6a) — same lazy `@polkadot/api` load, the narrow subscription set, and the staking-event filter. Live defaults on for wallet-connected users (they have already paid for the bundle) and off otherwise.

**Acceptance:** `@polkadot/api` appears in **no** bundle loaded before the user connects *or* enables Live (assert in CI against the build manifest); the disconnected state is fully usable, including the manual-address fallback; indexer pagination handles > 100 results; enabling Live upgrades values in place without a re-render storm and never gates first paint; disabling it tears down every subscription (assert no open sockets).

### Phase 8 — Polish and launch

SEO and Open Graph per route; social preview images; sitemap; error boundaries; 404; full a11y audit (automated + manual keyboard + screen reader); performance audit against every §11 budget; rewrite `README.md`; document the pipeline in `docs/`; migrate `didInfo` into the operator seed file; delete all dead code.

**Acceptance:** every §11 budget met on every route; Lighthouse ≥ 95 × 4; zero axe violations; `knip` clean; zero `@ts-ignore` outside `lib/chain/compat.ts`; `docs/baseline.md` updated with a before/after comparison table.

### Phase 9 — Deep-history backfill

Viable, because the public RPCs are archive nodes (§6.5). Extend the pipeline with a `backfill` mode that walks eras backwards from `firstEra`, resolving each era's read-block from indexer `EraPaid`/`EraPayout` events, branching on `exposureShape`, caching metadata per `specVersion`, and writing chunks tagged `provenance.source: "backfill-archive"`.

**Ordering is flexible.** This is pipeline-only work that touches no UI — because the client was built for unbounded history in Phase 2, backfill can run at any point from Phase 1 onward without reworking anything. Listed last because the product should work before it has four years of history, not because it depends on the phases before it.

Run it **once, by hand, offline**, at concurrency ≤ 2 with checkpointing. Re-verify archive access first. See §6.5 for why restraint matters here.

**Acceptance:** backfilled eras are byte-identical on re-run; an interrupted run resumes from its checkpoint; every backfilled era is provenance-tagged and independently droppable; at least five spot-checked against Subscan with the comparison recorded; the era-range control and per-chart coverage labels reflect the extended history; the default 90-day view is **unchanged in payload** after backfill — proof that range-based loading works.

---

## 14. Decisions

All nine opening questions are **resolved**. These are settled inputs — build to them, do not re-litigate.

| # | Question | Decision | Where it lands |
|---|---|---|---|
| Q1 | Brand typeface? | **None official.** Polymesh leans on Poppins; we deliberately do not. **Inter Variable + JetBrains Mono**, self-hosted, both OFL. Geist Sans/Mono is the one endorsed swap | §7.5 |
| Q2 | Design-system package? | **No**, but the kit's four swatches are now measured and folded in. Poly Pink `#EC4673` validates as categorical slot 1 in **both** modes; Poly Purple/Fuchsia form a light/dark accent pair | §7.1 |
| Q3 | Host? | **GitHub Pages** for v1. Cloudflare Pages is genuinely free (unlimited bandwidth, `*.pages.dev`, no domain needed) and is the documented next step — nothing in the client depends on the host | §6.3 |
| Q4 | Refresh cadence? | **Two jobs.** Hourly `ingest-era` that no-ops unless `activeEra` advanced; 30-minute `snapshot-latest` for live state only. Era data moves once per 24h, so a blanket 30-min full run was 48 wasted runs a day | §6.3 |
| Q5 | Indexer endpoint and limits? | **Endpoints confirmed** (`https://mainnet-graphql.polymesh.network/`). Limits exist but are unpublished, so the client treats the indexer as unreliable by design: paginate at 100, backoff on 429, degrade gracefully | §6.2 |
| Q6 | Testnet selectable? | **Mainnet only.** Testnet via env vars for local dev. No UI switcher — the current wallet-driven switching is removed as a correctness hazard | §6.2 |
| Q7 | Base path? | **Keep `/polymesh-staking-app`**, read from config, never hardcoded | §6.3 |
| Q8 | Signing in scope? | **Read-only.** Confirmed | §9.6 |
| Q9 | History beyond `historyDepth`? | **Yes, and now viable** — the public RPCs are archive nodes, so no node of our own is needed. ~1,700 eras available. Backfill is additive, provenance-tagged, run once by hand. The client is built for unbounded history from Phase 2 so timing is free | §6.5, §6.5a |

### Residual unknowns

These do not block anything; they are things to measure rather than decide.

| # | Unknown | Status | Resolved by |
|---|---|---|---|
| R1 | Indexer URLs | ✅ **Closed** — confirmed in §6.2 | — |
| R2 | Public archive access | ✅ **Closed** — the public RPCs are archive nodes | — |
| R3 | Brand-kit hexes | ✅ **Closed** — measured in §7.1, palette updated | — |
| R5 | Telemetry → stash join | ✅ **Closed — not doing it.** Unreliable join, real effort, could not affect rankings anyway | — |
| R1b | Indexer rate limits | Open — unpublished | Phase 7, empirically |
| R4 | Real payload of `erasStakersPaged.entries(era)` | Open | Phase 0 baseline — sizes the pipeline's cold run |
| R6 | First era on chain (sizes the backfill) | Open | Phase 0 |

---

## Appendix A — Chart migration map

| Current component | Disposition |
|---|---|
| `RewardCurve` | → **C3.** Keep the maths, redraw. Delete unused `constants/rewardCurve.ts` |
| `FineCurves` | → **C21**, promoted to `/slashing` with context |
| `ErasAverageAprChart` | → **C5**, 4 series max |
| `ErasTotalsStakedChart` | → **C4** |
| `ErasPointsTotalsChart` | → **C7**, with distribution band |
| `ErasRewardsTotalsChart` | → **C6** |
| `ErasOperatorsAprChart` + `…AprIncCommissionChart` | → **C11**, merged behind a gross/net toggle |
| `ErasOperatorsPointsChart` | → **C12** |
| `ErasOperatorsTotalStakedChart` | → **C13** |
| `ErasOperatorsCommissionChart` | → **C14**, step line |
| `ErasOperatorsRewardsChart` | → **C11** family; also a table column |
| `ErasOperatorsPercentOfPointsChart` | → **retired.** Becomes a table column in C16 |
| `OperatorsRewards` | → merged into C16 and operator detail |
| `…PointDeviationsFromAverageChart` | → **C15** |
| `PointCommissionAdjustedDeviations…` | → **C15**, behind a commission-adjusted toggle |
| `AprDeviationFromAverage` | → **C15**, metric selector |
| `OperatorsActiveEraPoints` | → **C18**, single axis |
| `OperatorsTokensAssigned` | → **C17**, single axis |
| `OperatorsTokensNominated` | → **C17** + C16 columns. Three-axis chart split per §8.1 rule 2 |
| — | **New:** C1, C2, C8, C9, C10, C16, C19, C20, C22, C23, C24 |

## Appendix B — Files to delete outright

- `constants/rewardCurve.ts` — 625 lines, unused
- `hooks/stakingPalletHooks/useHistoricalEras.ts` — exported, never consumed
- `pages/page2/` — scaffolding
- `styles/Home.module.css` — superseded
- `constants/constants.ts` `operatorsNames` — replaced by `operators.json`, generated from the official DID-keyed registry (§6.4)
- `constants/constants.ts` `didInfo` — keep only the `website` values as a local supplement (the registry carries names only); delete the names
