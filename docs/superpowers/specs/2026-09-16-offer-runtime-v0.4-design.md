# OfferRuntime v0.4 — Design Spec

- **Status:** Implemented on `feat/offer-runtime-v0.4` (from `feat/pixi-click-ripple`). Not merged, not tagged, not pushed.
- **Date:** 2026-09-16
- **Source of truth:** `trail_arrow-latest` 0.1.22 — `src/app/OfferChain.ts` (the pure chain), `src/systems/OfferChainSystem.ts` (tick + analytics), `src/systems/DataUpdateSystem.ts` (purchase / restore / load), `src/windows/OfferStarterPackWindow.ts` + `OfferStarterPackWindowSystem.ts` (the window), `src/systems/MainScreenSystem.ts` (map icon + once-per-session auto-show); `REVIEW_2026-09-08.md` №41, `REVIEW_2026-09-15.md` №2 / №3 / №7 / №9 / №13 / №22 / №24; the read-only audit `offerchain-source-of-truth-2026-09-16.md`.
- **Depends on:** Game Core `CoreRuntime` (module contract). Nothing else.

This document fixes what the fifth Game Core module is, which production semantics it carries 1:1 from Trail Arrow, and where it deliberately differs. It is the reference for the future Trail Arrow adapter and for any other game that wants the same LiveOps chain.

## 1. Goal

`OfferRuntime` is Game Core's renderer-independent **LiveOps offer chain**: one welcome offer, then a ladder of tiers × two variants that climbs on purchases and descends on expiries, with a live catalog gate and a late-purchase window. It is the production mechanic of Trail Arrow 0.1.22 (decision of 15.09), extracted so that:

- a game keeps only an adapter (state store over its profile, a server clock, its catalog, its rewards) and no chain logic;
- the 39 production scenarios are tested once, in Game Core, against pure functions;
- the window (`StarterPackWindowView`) stays data-only.

`OfferRuntime`:

- does not import Pixi, DOM, `window`/`document`, `localStorage`, GSAP, timers or `requestAnimationFrame`;
- never calls `Date.now()` or `performance.now()` — the host injects `now()` (Trail Arrow: `LOGIN_AT + app.time`, the server-anchored clock);
- does not do IAP and does not grant rewards — it only moves the chain and hands the host the `OfferDef` whose `rewards` to grant;
- does not implement analytics — it emits generic events to an injected `onEvent`;
- advances only through the host's `CoreRuntime.update(frameMs)` (cadence) and explicit `tick()` calls.

## 2. Module shape

```
src/offers/
  types.ts        OfferDef, OfferChainConfig, OfferStateStore, OfferChainInput, OfferEvent, options, stats
  config.ts       DEFAULT_OFFER_CHAIN_TIMING (production constants), validateOfferChainConfig
  chain.ts        the pure port of OfferChain.ts
  state.ts        MemoryOfferStateStore (tests, demos, hosts without their own profile model)
  OfferRuntime.ts the CoreRuntimeModule over the pure chain
  index.ts        public surface, re-exported from src/index.ts (root entry `game-core`)
```

Registered like every module: `core.registerRuntime('offers', offers)`. It has no scopes, so `cancelScope` / `pauseScope` fan-outs skip it; it exposes `getStats()`.

## 3. Public API

```ts
type OfferVariant = 0 | 1;
interface OfferReward { id: string; amount: number }
interface OfferDef { productId: string; tier: number; variant: OfferVariant; titleKey: string; timerSec: number; rewards: OfferReward[] }
interface OfferChainConfig {
  startLevel: number; topTier: number; welcome: OfferDef; tiers: OfferDef[][];   // tiers[tier−1][variant]
  nextAfterBuySec: number; nextAfterDeclineSec: number; latePurchaseWindowSec: number;
  maxUntilAheadSec: number; maxNextAheadSec: number;
}
type OfferStateKey = 'welcome' | 'until' | 'activeTier' | 'activeVariant' | 'seenMask' | 'variantMask' | 'nextTier' | 'nextAt' | 'declined' | 'declinedAt';
interface OfferStateStore { get(key: OfferStateKey): number; set(key: OfferStateKey, value: number): void }
interface OfferChainInput { now(): number; level(): number; hasPrice(productId: string): boolean; welcomeOwned(): boolean }
type OfferEvent =
  | { type: 'activated'; offer: OfferDef; level: number; now: number }
  | { type: 'expired'; offer: OfferDef; level: number; now: number }
  | { type: 'purchased'; offer: OfferDef; moved: boolean; level: number; now: number }
  | { type: 'blocked_no_price'; level: number; now: number };
interface OfferRuntimeOptions { config; state; input; onEvent?; onOfferError?; tickIntervalMs? /* 1000 */ }

// pure (chain.ts) — every function takes the config and the store explicitly
offerByProduct(config, productId): OfferDef | null
activeOffer(config, state, now): OfferDef | null
secondsLeft(config, state, now): number
pickAvailableOffer(config, state, wantedTier, hasPrice): OfferDef | null
isChainBlocked(config, state, now, level, hasPrice, welcomeOwned): boolean
clampOfferTimes(config, state, now): boolean
tickOffers(config, state, now, level, hasPrice, welcomeOwned): boolean
onOfferPurchased(config, state, productId, now): boolean

class OfferRuntime implements CoreRuntimeModule {
  update(frameMs): boolean; tick(): boolean; getActive(): OfferDef | null; secondsLeft(): number;
  offerByProduct(productId): OfferDef | null; onPurchased(productId): boolean; clampTimes(): boolean; getStats(): OfferRuntimeStats;
}
// helpers
DEFAULT_OFFER_CHAIN_TIMING, DEFAULT_WELCOME_TIMER_SEC (12 h), DEFAULT_TIER_TIMER_SEC (24 h), OFFER_HOUR_SEC, OFFER_DAY_SEC,
validateOfferChainConfig(config), MemoryOfferStateStore, OFFER_STATE_KEYS, OFFER_WELCOME { NEW: 0, ACTIVE: 1, DONE: 2 }
```

Naming vs the donor: `OfferModel`/`ResourceId.OFFER_*` → `OfferStateStore` with ten string keys; `InAppProductId` → `string`; `coins/bulbs/livesSec` → generic `rewards: OfferReward[]` (the donor's `offerRewards()` becomes host data); `STARTER_PACK > 0` → `input.welcomeOwned()`; `OFFER_START_LEVEL` etc. → `OfferChainConfig` fields with `DEFAULT_OFFER_CHAIN_TIMING`.

## 4. State — ten numeric keys, non-monotonic

| key | donor resource | meaning |
|---|---|---|
| `welcome` | `offer_welcome` | 0 never shown · 1 active · 2 finished (bought or expired) |
| `until` | `offer_until` | end of the active offer, unix s |
| `activeTier` | `offer_active_tier` | 0 none · 1..topTier |
| `activeVariant` | `offer_active_variant` | 0 A · 1 B (read as `=== 1 ? B : A`) |
| `seenMask` | `offer_seen_mask` | bit `tier−1`: the tier was shown before |
| `variantMask` | `offer_variant_mask` | bit `tier−1`: the last shown variant was B |
| `nextTier` | `offer_next_tier` | which tier to show next |
| `nextAt` | `offer_next_at` | not before this, unix s |
| `declined` | `offer_declined` | code of the last expired offer: 0 none · 1 welcome · `2 + (tier−1)·2 + variant` |
| `declinedAt` | `offer_declined_at` | when it expired, unix s |

A missing key reads as 0 (the donor's `getResourceAmount`). **Invariant (REVIEW 15.09 №9): the block is not monotonic** — timers move back and forth — so a cloud merge must take all ten keys from one winner and never max-merge them. `MemoryOfferStateStore.snapshot()/load()` exist for exactly that kind of whole-block save.

## 5. Time — server clock injected, frame time only paces

- Every deadline is computed from `input.now()` in unix seconds. In Trail Arrow that is `serverNow() = LOGIN_AT + app.time` (the platform's `serverTime` at login, device clock as fallback, session seconds by wall clock that catch up after background).
- `update(frameMs)` accumulates frame time and runs one `tick()` when `tickIntervalMs` (1000) has passed, then resets the accumulator — exactly the donor's `if (Date.now() − lastCheckMs < 1000) return; lastCheckMs = Date.now()`. The very first `update` ticks at once (`lastCheckMs = 0`). A huge frame after the tab was hidden yields **one** tick, not a catch-up burst.
- After a resume or a profile load the host calls `clampTimes()` and/or `tick()` itself; both use `input.now()`.
- `clampOfferTimes` (REVIEW 15.09 №13): `until ≤ now + 24 h`, `nextAt ≤ now + 48 h`, `declinedAt ≤ now`; returns whether anything changed (the donor sends an `offer_times_clamped` marker then).

## 6. Transitions — strict order, one per tick

`tickOffers` returns after the first transition that applies:

| # | condition | effect |
|---|---|---|
| T1 | `welcome === 1 && until ≤ now` | `welcome = 2`; finish(declined, from tier 2) → `nextTier = 1`, `nextAt = now + 48 h`, `declined = 1`, `declinedAt = now` |
| T2 | `welcome === 2 && activeTier > 0 && until ≤ now` | finish(declined, from that tier) → `nextTier = max(1, tier − 1)`, `nextAt = now + 48 h`, `declined = code`, `declinedAt = now` |
| T3 | `level < startLevel` | nothing (expiries above are processed below the level gate) |
| T4a | `welcome === 0 && welcomeOwned()` | `welcome = 2`; finish(bought, from tier 1) → `nextTier = 2`, `nextAt = now + 24 h`, `declined = 0` |
| T4b | `welcome === 0 && !hasPrice(welcome)` | nothing (wait for the catalog) |
| T4c | `welcome === 0` | `welcome = 1`, `until = now + welcome.timerSec` |
| T5 | `welcome === 2 && activeTier === 0 && now ≥ nextAt` | `pickAvailableOffer(clamp(nextTier ‖ 1))`; null → nothing; else `activateTier` (`activeTier/variant`, `seenMask ‖= bit`, `variantMask` bit = variant, `until = now + timerSec`) |
| T6 | otherwise | nothing |

`finish(bought, fromTier)`: `next = bought ? min(topTier, from + 1) : max(1, from − 1)`; `activeTier = 0`, `until = 0`; `nextAt = now + (bought ? nextAfterBuySec : nextAfterDeclineSec)`; declined code/time only on a decline, cleared on a purchase. Consequences preserved: tier 6 bought → tier 6 again with the opposite variant; tier 1 expired → tier 1 again with the opposite variant; a revisit shows the variant opposite to the last one shown; the cooldown counts from the **observed** `now`, not from `until`.

**Invariant: one transition per tick.** A welcome expiry and the following activation are always two ticks, even when `nextAt` is already in the past. `OfferRuntime.update` never collapses several transitions into one update.

## 7. Catalog gate — live, with neighbour fallback

`hasPrice(productId)` is a provider consulted on every decision (`T4b`, `T5`, `isChainBlocked`), never snapshotted: the platform catalog arrives late or refreshes mid-session (REVIEW 15.09 №4) and the next tick picks it up. `pickAvailableOffer` (№3) walks tiers `[w, w−1, w+1, w−2, w+2, …]` clipped to `1..topTier`, inside a tier `[preferred variant, the other]`, and returns the first priced offer or null. `nextTier` is not rewritten by a fallback; the next `finish` counts from the tier actually shown. When a tier is due and nothing is priced, `isChainBlocked` is true and the runtime emits `blocked_no_price` **once per runtime lifetime** (the donor: once per session).

## 8. Purchases — host does IAP and rewards, the chain only moves

`onPurchased(productId)`:

- product outside the chain → `false`, no event (the host handles its own products);
- `lateOk = !active && activeTier === 0 && declined === code(offer) && now − declinedAt < latePurchaseWindowSec` (strict);
- welcome: moves if `welcome === 1` or (`lateOk && welcome === 2`) → tier 2 after 24 h;
- ladder: moves if it is the active offer or `lateOk` → the tier above after 24 h;
- otherwise `false`: an old receipt or a foreign product still grants its product (host) but does not move the chain; a late purchase while the **next** offer is already active never moves it.

The event `purchased` always carries `moved`. The host grants `offers.offerByProduct(productId)?.rewards` regardless of `moved` (Trail Arrow: `DataUpdateSystem` grants, sets `STARTER_PACK = 1` for tier 0, then calls the chain).

## 9. Events

| event | when | donor analytics |
|---|---|---|
| `activated {offer, level, now}` | a tick put an offer on screen (T4c, T5) | `offer_activated {level, product}` |
| `expired {offer, level, now}` | a tick took the on-screen offer off (T1, T2) | `offer_expired {level, product}` |
| `purchased {offer, moved, level, now}` | `onPurchased` of a chain product | `purchase` is sent by the host's IAP path |
| `blocked_no_price {level, now}` | a tier/welcome is due and nothing has a price; once per runtime | `offer_blocked_no_price {level}` |

A throwing `onEvent` is caught, counted in `callbackErrors` and reported to `onOfferError` (default `console.error`); the chain state is already written by then. Input functions that throw propagate — `CoreRuntime.update` catches them per module and reports through its `onError`.

## 10. Intentional differences from the donor

1. **`expired` fires.** The donor's `OfferChainSystem` diffs `activeOffer()` before/after the tick, but `activeOffer()` already returns null at `until ≤ now`, so `offer_expired` never actually fired in 0.1.22. The runtime names the offer that was on screen (state without the `until` gate) around the tick, so `expired` carries the real offer. Same intent (REVIEW №41: "сейв + offer_activated/offer_expired"), working implementation.
2. **Generic rewards.** `coins/bulbs/livesSec` and `offerRewards()` are host data (`rewards: OfferReward[]`); Game Core never interprets a reward id.
3. **Config, not constants.** `OFFER_START_LEVEL`, `OFFER_TOP_TIER`, the five second-constants and the two timers are fields of `OfferChainConfig`, with the production values in `DEFAULT_OFFER_CHAIN_TIMING`; `validateOfferChainConfig` fails fast on a malformed ladder.
4. **`blocked_no_price` once per runtime lifetime** instead of "per session" — the runtime is the session.
5. **Robustness only:** `pickAvailableOffer` skips a stray tier outside `1..topTier` instead of dereferencing `undefined`; `tierOffer` throws a clear error on a malformed config (unreachable after validation).
6. **Not ported (host-side in Trail Arrow):** `hasPrice`'s DEV/localhost exception, `serverNow`/`LOGIN_AT`, `STARTER_PACK = 1`, cloud merge / `save_seq`, the window's `purchasing` veto and `detach`, the once-per-session auto-show, the map icon — all remain adapter code.

## 11. Tests (acceptance)

`tests/offers/chain.test.ts` — the 39 production scenarios (21 base + 18 from REVIEW 15.09), numbered after the source-of-truth report §7, plus tier-clamp edge cases. `tests/offers/runtime.test.ts` — update cadence (first tick at once, 999/1000 ms, one tick per huge frame, invalid frames), frozen-clock proof, the event log of a full life, `expired` naming the offer, `blocked_no_price` once per lifetime and not while merely waiting, purchase semantics, live `hasPrice`, `clampTimes`, explicit `tick()` after resume, stats, error isolation, the `CoreRuntime` contract. `tests/offers/public-api.test.ts` — the exact public surface compiled as a consumer, a source scan for forbidden globals/imports, and a full chain life run with `Date.now`/`performance.now` throwing and zero timers scheduled.

**Honesty note:** the donor's original scratchpad tests (`offertest/test.ts`, 21 + 18) are not in the `trail_arrow-latest` copy; the fixtures were reconstructed from the production code and the reviews, not copied.

## 12. Kit and showcase

`StarterPackWindowView` (`game-core/pixi`) gained two data-only hooks: `setTimer(text)` — the countdown under the rotated header, positioned like the donor's `layoutTimer` (half the header height + 40 along its tilt; long tier titles shrink to the donor's 430-unit cap) — and `setBuyEnabled(enabled)` — BUY blocked while the host's purchase is in flight (donor `setPurchaseState`, alpha 0.85). The kit still does not import `OfferRuntime`.

The showcase (`examples/pixi-showcase`) hosts the runtime on a **fake server clock** advanced by the Pixi ticker and jumped by the OFFER strip (`+12H` / `+24H` / `+48H` / `EXPIRE` / `NEXT` / `RESET`); the welcome offer activates on the first tick and pops once per session like the donor, the map icon shows the countdown, BUY runs a demo purchase (a MotionRuntime delay stands in for the payment sheet; the host grants the coins and calls `onPurchased`). `npm run showcase:offers` drives the whole chain with Playwright on the installed Chrome and writes `showcase-shots/offer-*.png` (390 × 844).

## 13. Next slices (not in v0.4)

`PurchaseRuntime` (platform IAP + restore, `purchasing` veto), `AnalyticsRuntime` (event → tracker mapping), `AdsRuntime`, `PlatformAdapter`, cloud save, the Trail Arrow adapter (`OfferStateStore` over `app.model.resources`, `OfferChainSystem` → `offers.update`, `DataUpdateSystem` → `offers.offerByProduct(...).rewards` + `offers.onPurchased`).
