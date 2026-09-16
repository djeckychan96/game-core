# Game Core Architecture

## Scope

Game Core is a reusable runtime library for shared HTML5 game systems. It is organized as a small `CoreRuntime` kernel plus independent runtime modules registered into it:

- `CoreRuntime` — a fan-out orchestrator: registers named runtime modules, ticks them all through one `update(frameMs)` call, fans out scope cancellation/pause/resume, aggregates stats, and gives every module's failures one error-reporting boundary. It never renders and never knows a module's internals.
- `FxRuntime` (module name `"fx"`) — effect lifecycle, pooled node acquisition and release, trajectories and easing, impact/completion/cancellation callbacks, cleanup and diagnostics.
- `MotionRuntime` (module name `"motion"`) — numeric tween/delay/sequence scheduling over host-supplied bindings, for UI/game motion that isn't pooled FX.
- `UiRuntime` (module name `"ui"`) — renderer-agnostic button and modal-window lifecycles, a single "UI is blocking gameplay" flag, and pure contain-fit layout arithmetic; animates through `MotionRuntime` behind a narrow driver interface.
- `OfferRuntime` (module name `"offers"`) — the LiveOps offer chain of Trail Arrow 0.1.22 (one welcome offer, then a ladder of tiers × two variants) over an injected state store, server clock and live catalog gate; emits generic events, never does IAP, rewards or analytics itself.

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
  onEvent: (e) => analytics.track(e)                              // activated / expired / purchased{moved} / blocked_no_price
});
core.registerRuntime('offers', offers);
// host: on a successful receipt
grant(offers.offerByProduct(productId)?.rewards); offers.onPurchased(productId);
```

Production invariants the module preserves: **one transition per tick** in the strict order expiry → level gate → welcome → next tier (an expiry and the following activation are always two ticks, even after a long background); the **server clock is injected** (`input.now()` in unix seconds — Trail Arrow's `LOGIN_AT + app.time`), and `update(frameMs)` only paces the once-a-second tick, never computes a deadline; the **catalog is live** (`hasPrice` is asked on every decision and the chain falls back to the other variant, then to neighbouring tiers, and reports `blocked_no_price` once per runtime when nothing is priced); **late purchase semantics** (a receipt for the offer that just expired counts as bought for 24 h while nothing else is active); the **state is non-monotonic** (ten keys whose timers move back and forth, so a cloud merge must take the whole block from one winner); **rewards are host-owned** data on `OfferDef`. `clampTimes()` repairs a save written under a future clock. See `docs/superpowers/specs/2026-09-16-offer-runtime-v0.4-design.md`.

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
