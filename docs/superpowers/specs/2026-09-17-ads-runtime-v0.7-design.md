# AdsRuntime v0.7 — design

Branch `feat/ads-runtime-v0.7` (from `feat/purchase-runtime-v0.6` @ 8a594e3). Not merged, no tag, no push.
Extraction map: `ADS_RUNTIME_EXTRACTION_MAP.md` (read-only audit of 2026-09-17; its §1 / §4 / §5 / §7 are mirrored below).

## 1. Goal

Port Trail Arrow's production ad decision layer (`src/app/AdsGate.ts`, 154 lines, + `ads_config/*.tsv`) 1:1 into a renderer- and platform-independent root module. AdsRuntime decides WHO may see an ad, WHEN, in WHICH placement and WHY it is denied. **It never calls an advertising SDK** — the platform layer does, later.

Eligibility is not improved in this slice: the donor issues of §8 are kept and pinned by tests.

## 2. Module layout

```
src/ads/
  types.ts       AdsConfig / AdSegment / AdPlacement(Rule), AdsDenyReason, AdsDecision, AdsStateStore, AdsInput, AdsEvent, stats
  config.ts      parseAdsTsv (the donor generator's logic), validateAdsConfig, ADS_DEFAULT_SEGMENT_ID, ADS_BANNER_PLACEMENT
  state.ts       MemoryAdsStateStore (snapshot / load), ADS_STATE_KEYS
  AdsRuntime.ts  segmentId / decide / canShowInter / canShowRewarded / canShowBanner / registerShown / markPayer / getStats / update
  index.ts
src/composition/adsAnalytics.ts   AdsRuntime events → AnalyticsRuntime (types only)
src/composition/purchaseAds.ts    PurchaseRuntime confirmed payment → ads.markPayer() (types only)
```

`src/ads` imports only `../core/CoreRuntime` (the module type). No Pixi, DOM, storage, `Date`, timers, SDK globals — enforced by `tests/ads/public-api.test.ts` and `scripts/check-pixi-build.mjs`.

## 3. Injected ports

`AdsInput`: `now()` (epoch ms — the donor uses the device clock), `level()`, `hasNoAds()`, `payCount()`, `paySumCents()`, `payMaxCents()`, `currencyScale()` (1 on rouble platforms, 1/85 on the donor's USD ones). Two optional members were needed for a 1:1 port and are not in the map's list:

- `isPayer?()` — the donor's payer test is `payer flag || no_ads || starter_pack > 0 || pay_count > 0`; the starter pack is a game resource, so it arrives as a host fact.
- `timezoneOffsetMinutes?()` — the donor buckets counters by the DEVICE calendar (`new Date()` getters). Core has no `Date`, so the local calendar is injected as JS `getTimezoneOffset()`; buckets are `floor((now − offset·60000) / 86400000 | 3600000)` — the same identity as the donor's `"Y-M-D"` / `"Y-M-D-H"` keys. Omitted = UTC. The Trail Arrow adapter passes `() => new Date().getTimezoneOffset()`.

`AdsStateStore`: `get / set` of `dayStamp | hourStamp | payer | lastInterAt | lastRewardAt`, `getCount / setCount / listCounts` — the donor's `hazargames.arrow.adstats` blob as keys. Host-side: localStorage today.

## 4. Donor semantics (kept exactly)

**Segments** (`segments.tsv`, first match in row order): non-payers by `levelFrom <= level < levelTo` — np_1 1–19, np_2 20–39, np_3 40–59, np_4 60–79, np_5 80–99, np_6 100–119, deep_np 120+; payers by `avg = sum/count/100` (0 when count is 0) and `max = maxCents/100` against `avgFrom·k <= avg < avgTo·k && maxFrom·k <= max < maxTo·k`, `k = currencyScale()` — pay_1 … pay_10, level ignored. Nothing matched → `default` if the config has it, else null. `default` has zero placement rows **on purpose** (REVIEW 15.09 №21) = no ads.

**Decision order**

| `canShowInter` | `canShowRewarded` | `canShowBanner` |
| --- | --- | --- |
| `no_ads` | — | `no_ads` |
| `unknown_placement`, `wrong_type` | `unknown_placement`, `wrong_type` | `unknown_placement` (no type check) |
| `no_segment`, `segment_disabled` | `no_segment` | `no_segment` |
| `no_rule`, `below_start_level` | `no_rule`, `below_start_level` | `no_rule`, `below_start_level` |
| `day_limit`, `hour_limit` | `day_limit`, `hour_limit` | — |
| `inter_cooldown`, `reward_cooldown` | — | — |

NO_ADS blocks interstitials and the banner, **not** rewarded. Rewarded uses no cooldowns. The banner uses no counters and no cooldowns. Start levels: L15 for np_1, L20 for every other segment; payers have no banner row.

**Counters / cooldowns.** `registerShown`: fresh view → `day++`, `hour++` → `lastInterAt = now` for an interstitial, else `lastRewardAt = now` → persist (the only write besides `markPayer`, and the only place the calendar reset is persisted). Reset: another calendar day → all counts 0; another hour of the same day → hour parts 0. Cooldowns are global across placements and read the CURRENT segment's delays: `now − lastInterAt < delayBetweenInters·1000` → `inter_cooldown`, then `now − lastRewardAt < delayAfterReward·1000` → `reward_cooldown`. An unset timestamp is 0, so `now()` must be epoch-like. `markPayer`: sticky flag, never cleared, writes nothing else.

**Storage failures.** Every store read / write is guarded: a throw reads as defaults (0) and drops the write — the donor's swallowed `try/catch` (B2).

## 5. API notes

- `decide(placement, expect?)` → `{ allowed, reason, segmentId }`. `expect` selects the donor function (`'inter' | 'rewarded' | 'banner'`); omitted, the placement's configured type does. The three `canShow*` are `decide(...).allowed`.
- `AdsDenyReason` names the donor branch that returned `false`; it changes no outcome (map B4).
- Events: `offered` / `denied` per decision, `shown` per `registerShown`. The banner decision is reported **only when it changes** (placement | reason | segment): the donor's CleverApps host polls `canShowBanner()` every 2 s, and an event per poll would flood the host's analytics. Stats count every decision.
- No `bucketPolicy` / rolling window option — not needed for the port; B1 stays a future, approved change.
- `update(frameMs)` is a no-op (CoreRuntimeModule contract).

## 6. Config parser parity

`parseAdsTsv` is `utils/gen-ads-config.mjs` line for line: header-keyed rows, `Infinity` literal → number, missing avg/max columns → `0 … Infinity`, `disableInter === "TRUE"`, type by name (`banner` → banner, `*_inter` → inter, else rewarded), first row of a placement creates it. `tests/ads/fixtures/{segments,placements}.tsv` are verbatim donor copies; `adsConfig.generated.json` is the donor's generated `AD_SEGMENTS` / `AD_PLACEMENTS`. Test G45: deep equality, key order of segments / placements / `bySegment`, 18 segments, 8 placements, 126 rule rows, `Infinity` as a number, `default` rule-less. `validateAdsConfig` rejects NaN cells, inverted ranges, negative delays / limits, unknown payer class / type / segment; it accepts a rule-less segment and a config without `default`.

## 7. Analytics composition

`shown` → `analytics.advertisement({ type, placement, status: 'complete' })` with `inter` → `interstitial` (the donor's name). **The donor emits `advertisement {type, placement}` only after a successful platform ad and without a status; `AnalyticsRuntime` v0.5 requires one. Core uses `status: 'complete'` because this event corresponds to a confirmed platform success.** No revenue (the donor has none). `offered` → `interaction('ad_offered', { placement, type, segment, level })`, `denied` → `interaction('ad_denied', { …, reason })` — new telemetry. `createPurchaseAdsHandler(ads, next)`: `granted` and the errors that only follow a confirmed payment (`no_grant`, `grant_threw`, `no_product_id`) → `ads.markPayer()` — the donor calls `AdsGate.markPayer()` on every status-ok purchase answer. `pay_count / pay_sum_cents / pay_max_cents` stay in the host's profile.

## 8. Known donor issues — kept, NOT fixed

| # | Issue | In Core |
| --- | --- | --- |
| B1 | calendar hour, not a rolling 60 min (10:59 → 11:00 refreshes the limit) | ported; test E35 pins it |
| B2 | counters are device-local; an unreadable storage = limits never bind | ported; test E37 pins it |
| B3 | cooldowns on the device wall clock, no clamp | `input.now()` — the host injects the donor's `Date.now()` |
| B4 | no `ad_offered` / `ad_denied` | events + reasons exist now; eligibility unchanged |
| B5 | `OutOfSpaceWindowSystem` rewarded belt is 75 s, not `REWARDED_BELT_SEC` 130 | host / platform layer, untouched |
| B6 | the same belt's error carries no `placement` | host, untouched |
| B7 | `registerShown` of an unknown placement arms `lastRewardAt` | ported; test E38 pins it (banner too) |
| B8 | the banner's day / hour limits are dead data | ported; test B20 pins it |
| B10 | banner no-fill retry has no budget | platform layer, untouched |
| B12 | Yandex `rewardedAvailableLocal` is never reset | platform layer, untouched |

## 9. Tests / proof

`tests/ads/` — runtime 36, config 4, purity / public API 4; `tests/composition/adsAnalytics.test.ts` 4. They cover the map's 48 vitest scenarios (A 1–10, B 11–20, C 21–25, D 26–32, E 33–38, F 39–44, G 45–48), several per test, plus: every pay_* threshold, decision priority, the local-calendar offset, banner report-on-change, "a decision never writes", the purchase → payer bridge. Scenario 49: `npm run showcase:ads` — the scripted fake player (L1 → L15 → L20 → rewarded → cooldown → payer → NO_ADS) on the real tables, timeline + stats + analytics checked under system Chrome.

## 10. Platform-specific (not in Core)

Showing ads (Yandex `adv.*`, CleverApps `connector.ads.*`, FB banner), ok / no-ad mapping, watchdogs and timeouts, `REWARDED_BELT_SEC` / `INTER_*` belts, gameplay and audio pause, `AdsShowingComponent`, the banner inset / generation guard / 2 s sync, rewarded availability, the NO_ADS offer cadence (every 3rd interstitial from L17), reward granting, `recordPayment`, the localStorage `AdsStateStore` and the `AdsInput` over the game model. Next slice: the Trail Arrow adapter (`AdsGate` becomes a shim over the runtime, call sites untouched).
