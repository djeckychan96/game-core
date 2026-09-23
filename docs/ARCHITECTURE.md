# Game Core Architecture

## Scope

Game Core is a reusable runtime library for shared HTML5 game systems. It is organized as a small `CoreRuntime` kernel plus independent runtime modules registered into it:

- `CoreRuntime` — a fan-out orchestrator: registers named runtime modules, ticks them all through one `update(frameMs)` call, fans out scope cancellation/pause/resume, aggregates stats, and gives every module's failures one error-reporting boundary. It never renders and never knows a module's internals.
- `FxRuntime` (module name `"fx"`) — effect lifecycle, pooled node acquisition and release, trajectories and easing, impact/completion/cancellation callbacks, cleanup and diagnostics.
- `MotionRuntime` (module name `"motion"`) — numeric tween/delay/sequence scheduling over host-supplied bindings, for UI/game motion that isn't pooled FX.
- `UiRuntime` (module name `"ui"`) — renderer-agnostic button and modal-window lifecycles, a single "UI is blocking gameplay" flag, and pure contain-fit layout arithmetic; animates through `MotionRuntime` behind a narrow driver interface.
- `OfferRuntime` (module name `"offers"`) — the LiveOps offer chain of Trail Arrow 0.1.22 (one welcome offer, then a ladder of tiers × two variants) over an injected state store, server clock and live catalog gate; emits generic events, never does IAP, rewards or analytics itself.
- `AnalyticsRuntime` (module name `"analytics"`) — the one analytics API of a game: Hazar-compatible envelopes built from an injected context, queued and sent in batches through an injected transport on the `update(frameMs)` cadence, with retry, a queue cap and an optional injected queue store.

The host owns rendering, asset loading, DOM, canvases, application objects, and tickers, and is the only thing that ever calls `CoreRuntime.update(frameMs)`.

On top of that renderer-agnostic core sits one optional, renderer-specific layer: the **Pixi Ready UI** kit (`game-core/pixi`, see `docs/PIXI_READY_UI.md`) — the drawn level map, HUD, buttons and result/lives/shop windows a PixiJS 8 game gets out of the box. It is a separate build with `pixi.js` as an external optional peer dependency, imports the core as types only, and drives everything through the host's `UiRuntime`/`MotionRuntime`, so the root entry stays free of any renderer.

## Core Runtime

`CoreRuntime` registers runtime modules under a stable name and fans out to all of them:

```ts
core.registerRuntime('fx', fxRuntime);
core.registerRuntime('motion', motionRuntime);
core.registerRuntime('ui', uiRuntime);
core.registerRuntime('offers', offerRuntime);
core.update(frameMs);          // ticks every registered module
core.cancelScope(scope);       // sums cancelled counts across modules that support it
core.pauseScope(scope);
core.resumeScope(scope);
core.getStats();               // { fx: {...}, motion: {...}, ui: {...}, offers: {...} }
```

A module's own `cancelScope`/`cancelAll`/`pauseScope`/`resumeScope`/`getStats`/`dispose` are all optional — `CoreRuntime` skips a module that doesn't implement one, rather than requiring every module to support everything. If a module throws from any of these, `CoreRuntime` catches it, reports it through the single handler registered via `onError`, and every other registered module keeps working. A throwing error handler can never itself escape into the host's own ticker.

## FX Runtime

`FxRuntime` updates all active effects through one host-driven call:

```ts
const changed = fxRuntime.update(frameMs);
```

`true` means a visible FX state changed and the host can render its own FX surface. `false` means nothing changed. The runtime never starts `requestAnimationFrame`, never creates a rendering application, and never calls render.

## Surface Boundary

The runtime targets `FxSurface` and opaque `FxNode` objects. It only needs:

- `attach`
- `detach`
- `setPosition`
- `setScale`
- `setRotation`
- `setAlpha`
- `setVisible`

The Pixi adapter uses a small duck-typed display object subset compatible with PixiJS 7 and PixiJS 8. The production bundle does not include PixiJS.

## Pooling

`FxPool` is fully configurable by the host:

- `createNode`
- `prewarm`
- `maxSize`

Release detaches the node and resets visibility, alpha, transform, and position. Nodes are reused instead of destroyed during normal effect sequences when prewarmed capacity is sufficient.

## Effects

Version 0.1 includes two generic primitives:

- `projectile`: quadratic Bezier movement with delay, scale/alpha keyframes, optional trajectory rotation, impact callback, and completion callback.
- `radialBurst`: pooled radial particles with configurable start radius, travel distance, jitter, scale, alpha, duration, and scope.

## Diagnostics

`FxRuntime.getStats()` reports:

- active effects
- pool acquires
- pool releases
- pool misses
- created nodes
- dropped effects
- last update time
- max update time

Stats can be reset through `resetStats()`.

## Motion Runtime

`MotionRuntime` schedules numeric tweens, delays, and simple tween/delay sequences over host-supplied bindings — it has no concept of a node, a renderer, or a specific engine:

```ts
type MotionBinding = {
  get(): number;
  set(value: number): void;
  to: number;
  from?: number;
};
```

A host describes *what number to move and where to*; `MotionRuntime` only ever calls `get()`/`set()` on the bindings it's given. It never imports Pixi, GSAP, or Cocos, and never creates a ticker or `requestAnimationFrame` — like `FxRuntime`, it only advances through a host-driven `update(frameMs)` call, normally reached via `CoreRuntime.update(frameMs)`.

Three operation kinds: `tween` (interpolates one or more bindings, with optional easing, delay, repeat/yoyo), `delay` (a first-class timed wait, not `setTimeout`), and `sequence` (an ordered list of tween/delay steps that behaves as a single cancellable operation to the host). All three return a `MotionHandle` (`cancel`/`pause`/`resume`/`active`/`paused`) — no Promise API in this version.

A binding whose `get()`/`set()` throws (a stale or destroyed host object) cancels only that one operation; every other active motion is unaffected. See `docs/superpowers/specs/2026-09-15-motion-runtime-v0.2-design.md` for the full design.

## UI Runtime

`UiRuntime` owns the two UI lifecycles every game re-implements by hand, without knowing any renderer:

- `ButtonController` — press/release/tap with pointer ownership, tap-vs-swipe detection (checked on move and again on release), a `setTapThreshold` for resize, disabled handling, and a renderer-independent `0..1` press progress. The host maps progress to a Pixi scale or a CSS variable from an explicit baseline it owns; the controller never reads a visual property, so an animation baseline can never drift.
- `WindowController` — `hidden → entering → shown → leaving → hidden` with a `0..1` transition progress. `close(reason, onClosed?)` is the one intent funnel: `onBeforeClose` may veto, `onHidden` is view cleanup and fires on every path to hidden, and the business continuation `onClosed` runs only when that close completes. `cancel()` force-hides with `onHidden('cancelled')` and never runs a continuation. At most one window is active at a time.
- Blocking — `isBlocking()` is a stored value recomputed at every change of the active window and published through `onBlockingChanged` without duplicates; it never pauses motion.
- `computeLayout(input)` — pure contain-fit math: design size fails fast with `RangeError`, measured viewport/insets are coerced, results are rects in design units.

Motion is delegated to `MotionRuntime` through `UiMotionDriver` (`tween` + `cancelScope`), a strict structural subset that a `MotionRuntime` instance satisfies with no adapter. Each controller owns one tween at a time in a reserved scope (`ui:button:<id>`, `ui:window:<id>`) and arms its driver callbacks with a lifecycle generation, so stale completions and controller-initiated replacements are ignored while a cancellation delivered through the driver settles the controller.

## Offer Runtime

`OfferRuntime` is the production LiveOps chain of Trail Arrow 0.1.22 (`OfferChain.ts`, decision of 15.09) ported 1:1 into `src/offers/` as pure functions plus a thin `CoreRuntimeModule`: a one-time welcome offer (12 h) from `startLevel`, then a ladder of `topTier` tiers × two variants (24 h each) that climbs a tier 24 h after a purchase and descends a tier 48 h after an expiry, showing the opposite variant on every revisit. One offer is active at a time.

Everything external is injected and nothing is owned:

```ts
const offers = new OfferRuntime({
  config: { ...DEFAULT_OFFER_CHAIN_TIMING, welcome, tiers },     // productIds, titleKeys, timers, rewards (host data)
  state,                                                          // OfferStateStore: ten numeric keys in the host's profile
  input: { now: serverNow, level: () => profile.level, hasPrice: catalog.has, welcomeOwned: () => profile.starterPack > 0 },
  onEvent: createOfferAnalyticsHandler(analytics)                 // activated / expired / purchased{moved} / blocked_no_price → `interaction`
});
core.registerRuntime('offers', offers);
// host: on a successful receipt
grant(offers.offerByProduct(productId)?.rewards); offers.onPurchased(productId);
```

Production invariants the module preserves: **one transition per tick** in the strict order expiry → level gate → welcome → next tier (an expiry and the following activation are always two ticks, even after a long background); the **server clock is injected** (`input.now()` in unix seconds — Trail Arrow's `LOGIN_AT + app.time`), and `update(frameMs)` only paces the once-a-second tick, never computes a deadline; the **catalog is live** (`hasPrice` is asked on every decision and the chain falls back to the other variant, then to neighbouring tiers, and reports `blocked_no_price` once per runtime when nothing is priced); **late purchase semantics** (a receipt for the offer that just expired counts as bought for 24 h while nothing else is active); the **state is non-monotonic** (ten keys whose timers move back and forth, so a cloud merge must take the whole block from one winner); **rewards are host-owned** data on `OfferDef`. `clampTimes()` repairs a save written under a future clock. See `docs/superpowers/specs/2026-09-16-offer-runtime-v0.4-design.md`.

## Analytics Runtime

```
gameplay events ─┐
base events ─────┼─▶ AnalyticsRuntime ─▶ AnalyticsTransport ─▶ Hazar transport today ─▶ (another backend later)
Core events ─────┘   envelope · queue      injected seam         createHazarAnalyticsTransport
(composition)        batches · retry                             ({ endpoint, token, fetchFn })
```

`AnalyticsRuntime` (`src/analytics/`) is the single analytics API of a game. Games and Core talk to the runtime; only the transport knows the backend, so replacing Hazar later is a new `AnalyticsTransport`, not a rewrite of the game. **Core-owned behavior is instrumented at composition level; gameplay adds game-specific events**: the runtimes never import each other — `src/composition/offerAnalytics.ts` (types only on both sides) turns `OfferRuntime` events into Hazar `interaction` events (`offer_activated`, `offer_expired`, `offer_purchased{moved}`, `offer_blocked_no_price`), and the host plugs it in where it builds its core.

```ts
const analytics = new AnalyticsRuntime({
  transport: createHazarAnalyticsTransport({ endpoint: ANALYTICS_ENDPOINT, token: ANALYTICS_JWT, fetchFn: fetch }), // host config, never in this repo
  context: () => ({ app, platform: 'YA', appVersion: BUILD.version, buildVersion: BUILD.number, profileId: identity.profileId(),
                    installedAt, device, platformOs, configName, configGroup, baseData: { level: profile.level, lives: profile.lives } }),
  store: localStorageQueueStore,          // optional, host-owned: load() / save(pending)
  now: serverNow                          // optional: stamps event.created_at (unix seconds)
});
core.registerRuntime('analytics', analytics);                       // core.update(frameMs) paces the flush
const offers = new OfferRuntime({ …, onEvent: createOfferAnalyticsHandler(analytics) });

analytics.trackSessionStart({ sessionNumber });                     // base events: typed helpers, Hazar names
analytics.level({ level, levelId, status: 'win', durationMs });
analytics.track('booster_used', { booster: 'bulb' });               // anything game-specific
document.addEventListener('visibilitychange', () => document.hidden && analytics.flush()); // host lifecycle, not Core's
```

**Wire contract (Hazar ingest).** `POST https://analytics.hazargames.ru/ingest` (RU) or `https://analytics.hazargames.com/ingest` (EU), `Authorization: Bearer <JWT>`, `Content-Type: application/json`, body = a JSON **array** of `{ app, p, event: { name, app_ver, build_ver?, created_at?, data: { profile_id, installed_at?, device, platform_os?, config_name?, config_group?, …event fields } } }`. The JWT differs per project/platform and comes from the host's build config — no token lives in this repository, in fixtures or in docs. `fetchFn` is injected (Core never reads a global); a non-2xx answer or a network failure keeps the batch, HTTP 400/413/422 drops it as non-retryable (`AnalyticsTransportError`) so a poisoned batch cannot block a persisted queue.

**Envelope.** The context is read on every `track`, so a profile id that changes when the platform SDK answers is picked up without re-init; `app_ver` is the host's real build version. Merge order: `context.baseData` < the event's data < the identity block (`profile_id`, `device`, `installed_at`, `platform_os`, `config_name`, `config_group`) — gameplay can never overwrite identity. An event without `profile_id` (or `app` / `platform` / `appVersion` / a valid `device`) is rejected and reported, never sent anonymous. `config_name` / `config_group` ride on every event when the context has them; Core does not interpret the experiment (a baseline is just the control group's value).

**Queue.** Events accumulate and leave in batches: every `flushIntervalMs` of frame time (default 10 s), when `batchSize` (default 20) events are waiting, or on an explicit `flush()`. `install` / `sessions` / `loading` ask for a flush at once; flushes asked for by `track` coalesce to the end of the tick, so the boot events are one request. One `send` at a time — concurrent `flush()` calls share the running promise, which never rejects. A failed batch returns to the head of the queue in order and the next flush retries it; after a failure the batch-size trigger pauses until a flush succeeds (no request per event while offline). A `send` that never settles is failed by frame time (`sendTimeoutMs`, default 30 s). The queue is capped (`maxQueueSize`, default 500, oldest dropped). With a store, the pending snapshot (in flight + queued) is saved after every change and restored at construction; without one the queue is memory-only. No timers, no `Date`, no DOM listeners: `update(frameMs)` is the only clock, and nothing in the pipeline throws into gameplay (`onError` + `getStats()`).

**Typed events** (camelCase in, Hazar snake_case out): `install`, `trackSessionStart` → `sessions`, `loading` / `trackLoadingStart` / `trackLoadingDone(loadMs)`, `tutorial`, `level`, `uiClick` → `ui_click`, `advertisement` (`type`, `placement`, `status`, `revenue?`), `economy` (`currency`, `action`, `delta`, `balance`), `purchase` (`offer_name`, `product_id?`, `revenue`, `currency`, `order_id`, `status`, `source`), `livesRefill` → `lives_refill`, `interaction(action, data)`; every helper takes game-specific extras in `data`. The purchase shape is what `PurchaseRuntime` reports through `src/composition/purchaseAnalytics.ts`; the advertisement shape is what `AdsRuntime` reports through `src/composition/adsAnalytics.ts`. Proof without a game: `npm run showcase:analytics` (fake transport, system Chrome). See `docs/superpowers/specs/2026-09-17-analytics-runtime-v0.5-design.md`.

## Purchase Runtime

```
BUY tap ─▶ PurchaseRuntime.purchase(productId, source) ─▶ PaymentsAdapter.purchase   (injected: Yandex / CleverApps / Samsung / fake)
boot, waves ─▶ PurchaseRuntime.restore() ──────────────▶ PaymentsAdapter.restore
                     │ platform ok
                     ▼
        claim: has(token)? → add(token)         one synchronous block — GrantedPurchaseStore injected
                     ▼
        PaymentsAdapter.consume                 a failure is only reported; the next restore() finishes it without a grant
                     ▼
        resolveGrant ─▶ grant ─▶ `granted` event ─▶ composition: analytics.purchase(…) · offers.onPurchased(id) · profile save
```

`PurchaseRuntime` (`src/purchases/`) is Trail Arrow 0.1.22's real-money pipeline — `DataUpdateSystem.onShopPurchase` / `onCheckConsummations` plus the `shop.purchase` / `check.consummations` handlers of its Yandex and CleverApps platforms — with the platform, the granted-token registry and the rewards injected. Two rules hold on every path: **nothing is granted before the platform confirmed the payment**, and **one payment is granted once** — after a reload, a retry, a repeated platform answer, a concurrent `restore()`. The runtime knows no SDK, no storage, no DOM, no clock and schedules nothing.

```ts
const purchases = new PurchaseRuntime<Reward[]>({
  payments: yandexPaymentsAdapter,                                   // host: purchase / restore / consume over the SDK, with ITS timeouts
  granted: createGrantedPurchaseStore({ initial: load(), onChange: save }),   // or the host's own { has, add } over localStorage
  resolveGrant: (productId) => offers.offerByProduct(productId)?.rewards ?? shopRewards[productId],
  grant: (productId, rewards) => profile.add(rewards),               // synchronous, in memory
  isPayer: () => profile.payCount > 0,
  onEvent: createPurchaseAnalyticsHandler(analytics, priceOf, (event) => {   // priceOf: the REAL catalog → { revenue, currency }
    if (event.type !== 'granted') return;
    offers.onPurchased(event.productId);                             // PurchaseRuntime never imports OfferRuntime
    profile.recordPayment(priceOf(event.productId)); profile.save();
  })
});
const result = await purchases.purchase('gold_1', 'shop');           // never rejects: ok | cancelled | error | duplicate | busy | disposed
if (result.restoreAdvised) scheduleRestoreWaves();                   // host: 3 s / 15 s / 45 s, like the donor
await purchases.restore();                                           // host: at boot
```

**Grant ordering — the donor's, the grant is always last.** In Trail Arrow the platform handler marks and consumes, and only its answer makes the game grant. Direct purchase (Yandex and CleverApps alike): platform ok → mark → consume (failure swallowed) → grant → `granted` event (the host saves). "Already granted?" + mark is one synchronous block (`claim`), so nothing can interleave between the check and the mark, and the token is in the registry **before** the consume is attempted — a failed consume must not pay the receipt out again at the next launch. The consequences of that order are kept as they are in production: a paid product without a reward mapping (`error: no_grant`) or a throwing `grant` (`grant_threw`) is already marked and consumed — reported, never retried. The grant follows the product the **platform** reports (`requestedProductId` travels along). A purchase without a token is granted but cannot be deduplicated (donor: a rare double grant in the player's favour beats an unpaid purchase). A known token on a direct purchase is `duplicate` — consumed, not granted (the one idempotency check the donor does not have on this path).

**Restore.** One `restore()` = one pass over what the platform still holds; a known token is only consumed; a second call while one runs is `busy` (donor review 15.09 №11: two parallel restores paid one receipt twice). `PaymentsAdapter.restoreGrant` keeps both production orders: `after-consume` (Yandex, default) — known? → consume → mark → grant, a failed consume keeps the purchase for the next pass (no mark, no grant), so nothing over-grants even when the registry cannot persist and the payment service is down; `before-consume` (CleverApps) — known? → mark → consume (failure ignored) → grant. Like the donor's `check.consummations` answer, a pass consumes everything first and grants after it. Boot restore, the three waves after a purchase that did not answer ok, and the retries of a failed `restore()` are host orchestration.

**Product kinds (v0.9.1, SoliPix production).** `productKinds: { no_ads: 'entitlement' }` is the consume policy, from the host's config — read and validated once at construction (an unknown kind throws: a typo must never read as "consumable" and burn a permanent purchase), never a product id inside the runtime. Everything not listed is a `consumable` and runs the pipeline above byte-for-byte. An `entitlement` is a permanent right bought once: the same pipeline minus the consume — direct = mark → grant, restore = mark → grant after the pass — because the unconsumed receipt is what lets the platform give the right back on another device. The consequence: the platform lists that receipt on EVERY `restore()`, forever. So a known entitlement token is the steady state, not an anomaly: no `duplicate` event, no consume, no grant — it is answered in `RestoreResult.owned`, from which the host re-asserts the right (production sets the flag on every start, so a profile that lost it heals). One token is still one grant. The `granted` event carries `kind: 'entitlement'`, and `createPurchaseAnalyticsHandler` sends NO Hazar revenue for a RESTORED entitlement (a new device or a lost registry grants it again — the money was counted at the direct purchase; SoliPix sends nothing on a `no_ads` restore); a restored consumable is still revenue. `owned` and `kind` exist only for entitlements, so every v0.6 object is unchanged. No subscriptions, expiry or server receipts. Known gap: an entitlement the platform reports WITHOUT a token cannot be marked, so every pass grants it again (the host's flag is idempotent; Yandex always sends `purchaseToken`).

**Registry.** `GrantedPurchaseStore` is `{ has, add }`; `createGrantedPurchaseStore` is the donor's list in memory (insertion order, last 50 tokens, `onChange` for persistence). A store that throws (private mode) degrades to "no registry", like the donor. **Payer / profile.** `isPayer()` = the host's knowledge OR a payment confirmed in this session; payment sums (`pay_*`), the profile schema and cloud save stay in the game, driven by the `granted` event. **Analytics.** `src/composition/purchaseAnalytics.ts` (types only on both sides) logs `purchase_started` / `purchase_ok` / `purchase_restored` / `purchase_cancelled` / `purchase_error` (+ `purchase_duplicate`, `purchase_consume_failed`) and, on every grant — direct or restored — the Hazar `purchase` event (`offer_name`, `revenue`, `currency`, `order_id`, `source`); revenue comes from the host's price resolver, never from the runtime. A restored receipt IS revenue, exactly as in the donor (its single `trackPurchase` point is reached from `check.consummations` too), and never a second time: `granted` fires once per claimed token, a known token only yields `purchase_duplicate`. `dispose()` refuses new calls and does not act on a platform answer that arrives later (the purchase stays on the platform) — a purchase that was already claimed is still carried through to its grant. Proof without a game: `npm run showcase:purchase` (fake adapter, system Chrome). See `docs/superpowers/specs/2026-09-17-purchase-runtime-v0.6-design.md`.

## Ads Runtime

```
window / win-fail-exit flow ─▶ ads.requestInterstitial / requestRewarded / requestBanner → AdsPolicyDecision   (v0.7: canShow* / decide(placement) → { allowed, reason, segmentId })
                                     │ allowed
                                     ▼
                     platform layer shows the ad (Yandex / CleverApps SDK — NOT in Core)
                                     │ platform ok
                                     ▼
                              ads.registerShown(placement) ─▶ `shown` ─▶ composition: analytics.advertisement{status:'complete'}
purchase confirmed ─▶ composition: ads.markPayer()            offered / denied ─▶ ad_offered / ad_denied
```

`AdsRuntime` (`src/ads/`) is Trail Arrow 0.1.22's `AdsGate` — 1:1 — over an injected config, state store and input. It decides WHO may see an ad (segment), WHEN (start level, calendar day / hour limits, two global cooldowns), in WHICH placement, and WHY not (`AdsDenyReason`). **It never calls an advertising SDK**; showing, watchdogs, audio / gameplay pause, the banner inset and rewarded availability stay in the platform layer of the game.

```ts
const ads = new AdsRuntime({
  config: parseAdsTsv(segmentsTsv, placementsTsv),       // game data: ads_config/*.tsv; validateAdsConfig runs in the constructor
  state: adsStateStore,                                   // host: localStorage or the cloud profile (MemoryAdsStateStore in tests)
  input: {
    now: () => Date.now(),                                // donor: the DEVICE clock (B3); the host decides
    level: () => model.level,
    hasNoAds: () => model.noAds > 0,
    payCount: () => model.payCount, paySumCents: () => model.paySumCents, payMaxCents: () => model.payMaxCents,
    currencyScale: () => (isUsdPlatform ? 1 / 85 : 1),    // thresholds are roubles in the donor's table
    isPayer: () => model.starterPack > 0,                 // optional: any other payer fact
    timezoneOffsetMinutes: () => new Date().getTimezoneOffset()   // optional: the LOCAL calendar of the counters (donor 1:1); omitted = UTC
  },
  onEvent: createAdsAnalyticsHandler(analytics)
});
core.registerRuntime('ads', ads);                         // update() is a no-op: nothing is paced by frame time
if (ads.canShowInter('level_win_inter')) platform.showInterstitial().then((ok) => ok && ads.registerShown('level_win_inter'));
```

**Segments.** A payer — the sticky `markPayer()` flag, NO_ADS, `input.isPayer()`, or `payCount() > 0` — is segmented by average (`sum / count / 100`) and largest payment against `avgFrom…avgTo` / `maxFrom…maxTo` × `currencyScale()` (`pay_1…pay_10`), ignoring the level; everybody else by `levelFrom <= level < levelTo` (`np_1…np_6`, `deep_np`). The first match in config (TSV) order wins; nothing matched → `default`, which has NO placement rules on purpose — no ads at all (`validateAdsConfig` accepts a rule-less segment).

**Decision order (the donor's, a deny reason per branch).** Interstitial: `no_ads` → `unknown_placement` → `wrong_type` → `no_segment` → `segment_disabled` → `no_rule` → `below_start_level` → `day_limit` → `hour_limit` → `inter_cooldown` → `reward_cooldown`. Rewarded: `unknown_placement` → `wrong_type` → `no_segment` → `no_rule` → `below_start_level` → `day_limit` → `hour_limit` — **no NO_ADS check and no cooldowns** (rewarded is opt-in value and survives the NO_ADS purchase). Banner: `no_ads` → `unknown_placement` → `no_segment` → `no_rule` → `below_start_level` — no type check, no counters, no cooldowns; payers have no banner row. `decide(placement, expect?)` is the primitive (`expect` picks the check like the donor's three functions; omitted = the placement's own type); `canShowInter` / `canShowRewarded` / `canShowBanner` are its boolean aliases.

**Counters and cooldowns.** `registerShown(placement)` (a CONFIRMED show) raises the placement's day and hour counts and arms a GLOBAL cooldown clock: `lastInterAt` for an interstitial, `lastRewardAt` for anything else — a rewarded, the banner, an unknown placement. `delayBetweenInters` and `delayAfterReward` of the CURRENT segment gate every interstitial placement. Counts reset by the calendar: another day → all counts read 0, another hour of the same day → the hour parts read 0; buckets are `floor((now − tzOffset) / day|hour)` — the donor's `"Y-M-D"` / `"Y-M-D-H"` keys without `Date`. A decision never writes; only `registerShown` (which also persists the reset) and `markPayer` do. A store that throws reads as defaults and drops the write, like the donor's swallowed try/catch.

**Events / analytics.** `offered` / `denied` — one per decision (the banner decision, which hosts poll, only when it changes); `shown` — one per `registerShown` with the counts after the increment. `src/composition/adsAnalytics.ts` (types only on both sides): `shown` → `advertisement({ type, placement, status: 'complete' })` — the donor sends `advertisement {type, placement}` WITHOUT a status and only after the platform confirmed the ad, so `'complete'` states the same fact; `offered` / `denied` → `interaction('ad_offered' | 'ad_denied')` with placement, type, segment, level and reason (new telemetry, eligibility untouched). `src/composition/purchaseAds.ts`: a confirmed payment of `PurchaseRuntime` → `ads.markPayer()`; the payment sums that pick the `pay_*` segment stay in the host's profile. **Known donor issues kept on purpose** (B1 calendar hour, B2 device-only counters, B3 device clock, B7 unknown placement arms `lastRewardAt`, B8 dead banner limits, and the host-side B5 / B6 / B10 / B12) are listed in the spec. Proof without a game: `npm run showcase:ads` (scripted fake player, system Chrome). See `docs/superpowers/specs/2026-09-17-ads-runtime-v0.7-design.md`.

**Ads Policy V1 (per-game config).** Gameplay holds no ad condition: it reports a placement and gets an explainable decision — `ads.requestInterstitial('level_complete')` / `requestRewarded('hint_rewarded')` / `requestBanner()` (or `evaluate(placement, expect?)`) → `AdsPolicyDecision { allowed, reason, segmentId, placement, adType, level, source: 'policy' | 'segmentation' | null, policy: { name, version } }`. The runtime is built from a **policy** (`new AdsRuntime({ policy, state, input })`) — an `AdsPolicy`: `interstitial { enabled, cooldownMs, afterRewardedCooldownMs, firstShowDelayMs, minLevel, placements }`, `rewarded { enabled, minLevel, placements }`, `banner { … }`, `noAds { blocksInterstitial, blocksBanner, blocksRewarded }` (rewarded stays on by default), `session { maxInterstitials, blockWhileAdInFlight }` and an optional `segmentation` (the tables above; `null` = a policy-only game). Placement ids are the game's own strings; each `placements` record is an allow-list, and an interstitial placement may carry a `cadence { every, first? }` (every N-th request since the last confirmed show; the count moves only for requests that got that far and stays due after a pass that did not show). Policy gates run first, then the tables: `disabled` → `no_ads` → `unknown_placement` / `wrong_type` / `placement_disabled` → `ad_in_flight` → policy `below_start_level` → `first_show_delay` → `session_limit` → `cadence` → the v0.7 order; the policy cooldowns are FLOORS over the segment delays and the tighter of a policy cap and a table limit binds. `resolveAdsPolicy(preset, ...overrides)` merges in depth (objects key by key, `null` clears, `undefined` is no override, `segmentation` replaced whole), never mutates, returns a validated frozen copy. `TRAIL_ARROW_AD_POLICY_V1` (`src/ads/presets.ts`, frozen) is Trail Arrow 0.1.22's production scheme: the tables verbatim, every knob neutral — a runtime built from it decides exactly like `{ config }` (differential test), and it is NOT yet the default of anything: `DEFAULT_AD_POLICY = TRAIL_ARROW_AD_POLICY_V1` is a later, one-line decision. `{ config }` alone still works (= `adsPolicyFromConfig(config)`, the tables by reference), `decide` / `canShow*` are unchanged, events keep their shapes. Session = the runtime's lifetime or from `startSession()`; `input.isAdInFlight?()` is the one new (optional) input. See `docs/superpowers/specs/2026-09-20-ads-policy-v1-design.md`.

**Ads Policy V1.1 (offer cadence + watchdog numbers).** Two more rules of the donor's ad system are config now. `noAds.offerAfterInterstitials { enabled, every, first?, minLevel }`: every N-th CONFIRMED interstitial (`registerShown` of an interstitial placement — a rewarded never counts, a failed / cancelled ad is never registered) raises the NO_ADS offer trigger; nothing is counted while the player owns NO_ADS or is below `minLevel`; the counter is session-local and restarts on a trigger. The runtime never opens a window: it emits `no_ads_offer` and keeps the trigger until the host takes it with `consumeNoAdsOffer()` (true once; re-checks NO_ADS at that moment, like the donor's map dropping a pending offer), `isNoAdsOfferDue()` peeks, `stats.session.noAdsOffer` shows the counters. `timeouts { rewardedAnswerMs, interstitialStartMs, interstitialShowHardCapMs, interstitialRecheckMs }` (+ a rewarded placement's `answerTimeoutMs`) are the platform-answer watchdogs the HOST arms — data only, read through `getRequestTimeouts(placement)`; the timers, the button locks and the pending-transition flags (`pendingContinue` / `pendingFail`) stay in the host's windows, because they are UI orchestration around a platform answer, not eligibility. `TRAIL_ARROW_AD_POLICY_V2` = V1 + the donor cadence (`first: 1, every: 3, minLevel: 17`) + the donor numbers (130 s rewarded belt; the 75 s belt of `ad_extra_moves_rewarded` kept verbatim as production drift); V1 is unchanged; neither is a default.

## Platform Layer

`src/platform/` (v0.8, slice A) is the contract between a game and the platform it runs on, as independent capabilities instead of one giant adapter: `GamePlatform = { identity, environment, storage, gameplay, ads?, payments?, lifecycle? }`. The first four are required; a missing optional one means the platform cannot (Yandex has no banner or shortcut, MSN no payments) and stays `undefined` — Core never stubs it. Every call answers its caller with its own Promise (the donor's platform layer is a broadcast bus without correlation ids).

- `PlatformRuntime` is a small facade over ONE platform built by the host for its explicit build target: it checks the required capabilities, exposes them as given, offers `ready()` (identity, then storage), `capabilities()` and the `catalog`. No SDK detection, no fallbacks.
- Storage invariant: a read that failed REJECTS — never an empty profile (both production save-loss incidents). The facade turns a non-object `storage.get()` answer of any adapter into a rejection. The local mirror, rollback guard and `save_seq` stay in the host.
- `PlatformAdResult { status: shown | rewarded | dismissed | no_fill | timeout | error, rewarded, placement }` — `rewarded` is the only reward signal. `AdsRuntime` still decides; the host calls the platform and registers a real show. Core never calls a show method.
- `PlatformPayments extends PaymentsAdapter` (+ `getCatalog()`): `platform.payments` is handed to `PurchaseRuntime` as is. `PlatformCatalog` holds the live merged catalog for `OfferRuntime.hasPrice`, shop labels and `AdsInput.currencyScale`; refresh schedules stay with adapters / hosts.
- `createDevPlatform()` implements every capability without an SDK, a network or money (held receipts, restore, scripted ad / purchase outcomes, an injected Web-Storage-shaped store).
- `GamePlatformConfig` is the client-safe per-platform config shape (`provider`, `platformCode`, `analytics { endpoint, jwtRef }`, `connector`, `publicIds`): no field for a server secret, a JWT only by reference name; `validateGamePlatformConfig` refuses both.
- `src/composition/platformAnalytics.ts` feeds `AnalyticsRuntime`'s context with `p` / player id / device override / language; everything else, the profile-id policy included, stays with the host.

The module imports only `PaymentsAdapter` types from `src/purchases`. Spec: `docs/superpowers/specs/2026-09-17-platform-layer-v0.8-design.md`.

### Platform adapter entries

SDK adapters never enter the root bundle. Each is its own public entry, built separately like the Pixi kit, and knows the root as types only:

| entry | source | bundle |
|---|---|---|
| `game-core` | `src/index.ts` | contract, `PlatformRuntime`, `PlatformCatalog`, DEV platform — no SDK name |
| `game-core/platform/yandex` | `src/platform/adapters/yandex/` | `YandexPlatform` — the only bundle that names `YaGames` |

`YandexPlatform` (v0.8-B1) is a 1:1 port of Trail Arrow's production Yandex integration: 20 s init + one retry + a 30 s dead-SDK memory, a player that never blocks the entry (guest mode, 5 × 15 s background retry), a cloud read of 8 s × 3 that REJECTS on failure and for a guest, one throttled `setData` in flight (≥ 3 s), the rewarded answer only when the show ends, the local rewarded-availability latch, audio / gameplay restored in `finally`, the 2 s / 120 s ad watchdog, every payments timeout, `restoreGrant: 'after-consume'`. The game's ECS components, sound and analytics calls are injected hooks; the mirror, rollback guard, `save_seq`, identity adoption, the granted registry, `registerShown` and every retry schedule stay in the host. `src/platform/support/` (`withTimeout`, `createAdWatchdog`) is adapter support — timers and `document` live only there and are injected. `scripts/check-platform-build.mjs` enforces the boundary on the built files. Spec: `docs/superpowers/specs/2026-09-17-platform-yandex-v0.8-b1-design.md`. CleverApps, autodetect and the JWT resolver are later slices.

## Save Gate

`SaveGate` (`src/save/`, root entry, V1) is the load-before-write rule that both clean integrations (SoliPix, Gorodki) wrote by hand, over `PlatformStorage` — no second storage abstraction. `new SaveGate({ storage: platform.storage, profile })` reads `profile.id` and `profile.save`; `load()` (once, never rejects) issues one `storage.get` per read group — `save.groups` (optional, a partition of `save.keys`; absent = one group) — and answers `{ values, groups: [{ keys, status, error? }], core }`. A group is `loaded`, `missing` (the read succeeded and nothing is stored — a new player starts from defaults and may save them) or `failed` (the read rejected or answered a non-object — the gate never writes those keys, so a default can never overwrite a save that could not be read). The phases are `idle → loading → loaded → open`: writes answer `not_open` until the host has applied the loaded values and called `open()`; `write(patch)` refuses a key outside `save.keys` (`unknown_key`) or in a failed group (`read_failed`) without touching the storage, otherwise it is one `storage.set` answered `ok` / `storage_refused` / `storage_rejected` — never a throw. Core-owned state is one object under `<profile.id>.core` (`readCore` / `writeCore(record, value)`), read with the first group (one read, one failure domain), never merged into a game key; the profile validator rejects a game key equal to it. Out of scope by design: the game's save format and migrations, the local mirror, cloud / local and guest / player merges, retries, timers. Known limit: correctness of a multi-key gate relies on the `PlatformStorage.set` patch contract — the Yandex adapter forwards the patch to `setData`, which the SDK documents as the data of the last call, so it must merge before the Core record is written on Yandex.

## Pixi Ready UI

`game-core/pixi` (source `src/pixi/`, bundle `dist/pixi/`, art `assets/pixi-ui/`) contains `LevelMapView`, `HudView`, `UiButton`, `ModalWindow` with `ResultWindowView` / `LivesWindowView` / `ShopWindowView` / `SettingsWindowView` / `NoAdsWindowView` / `StarterPackWindowView`, `loadReadyUiAssets` and a minimal theme; geometry, assets and entrances are taken 1:1 from the Trail Arrow prefabs. The kit never imports `OfferRuntime`: `StarterPackWindowView` only receives data (`show` params, `setTimer`, `setBuyEnabled`) from the host's offer adapter. The views are PixiJS containers laid out in viewport px over a contain-fit design box; every tap is a `ButtonController`, every modal a `WindowController`, every animation a `MotionRuntime` tween or sequence in a view-owned scope, so `core.cancelAll()` settles the whole interface and no business callback (level selection, NEXT, BUY) can fire from a cancelled press or a force-hidden window — they run only as settled taps and `close()` continuations. The standalone showcase (`npm run showcase`) proves the layer without any game attached.

The same entry also ships Game Core's reusable **Pixi FX** (`src/pixi/fx/`), the first being
`ClickRippleEffect`: Trail Arrow's production "ocean" (rings from a tap on empty space), its
defaults 1:1 with `ArrowRenderer.spawnOceanRipple`. An FX is a Pixi container that only draws —
pooled `Graphics`, nothing allocated per frame — and animates through exactly one `MotionRuntime`
tween per spawn in its own scope (`fx:click-ripple:<id>`), so the host's `core.update` is its only
clock and `pauseScope` / `cancelScope` / `cancelAll` apply to it like to any motion. Timing inside a
ripple is expressed as normalized ring phases (`k = clamp((t − phase) / (1 − phase))`, all rings
end together), sizes as screen px divided by the effect's own world scale each frame. Input policy
stays in the host: which pointer-up counts as a tap on empty space, what "empty" means in that
game, pan/pinch state. The FX exposes `spawn(x, y)` in its local coordinates and `spawnGlobal(x, y)`
for screen points, so a stage offset or a zoomed world is absorbed by parenting, never by game
knowledge inside the effect.

`UiRuntime.update()` is a no-op; it participates in `CoreRuntime`'s `cancelScope`/`cancelAll`/`dispose` fan-out so that `core.cancelAll()` leaves the whole Game Core consistent: every button idle, every window hidden with its view cleanup fired once, `activeWindow` null, blocking false, no motion left. Whichever module reaches a controller first — `ui` or `motion` — the outcome is the same settle, so registration order does not matter. Every host callback is error-isolated through `onUiError`, mirroring `onMotionError`/`onEffectError`. See `docs/superpowers/specs/2026-09-15-ui-runtime-v0.3-design.md` for the full design.

### ReadyUiOverlay (v0.9)

`createReadyUiOverlay` (`src/pixi/ReadyUiOverlay.ts`, `game-core/pixi` only) is the host infrastructure for games that
are not drawn with Pixi — DOM gameplay, a Three.js canvas, another renderer. It is the one kit module allowed to create a
Pixi `Application` and DOM, and it is the generic half of the Gorodki integration: a transparent never-started
Application inside the container it is given, DPR / host-callable resize / safe area, the Ready UI asset load,
visibility, dispose. The clock stays the host's: `overlay.update(frameMs)` runs the optional core runtime, advances
Pixi's disarmed global tickers on the host's frame times and renders once — no second `requestAnimationFrame` exists.
Input is native DOM hit testing on the overlay's own hit layer: `'passthrough'` (nothing), `'ui'` (only the
interactive regions, via `clip-path`), `'modal'` (everything; automatic while `ui.isBlocking()`), so DOM gameplay keeps
its taps and drags without synthetic events. It imports no runtime (`core` / `ui` are structural options), owns no game
state and is not a screen manager: views, navigation, the model and every callback stay in the game.
