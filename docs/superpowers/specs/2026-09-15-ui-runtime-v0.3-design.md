# UiRuntime v0.3 — Design Spec

- **Status:** Design spec, awaiting approval. Not implemented.
- **Date:** 2026-09-15
- **Branch:** `design/ui-runtime-v0.3` (created from `main` / tag `v0.2.0`, commit `bb42fc6`)
- **Depends on:** Game Core v0.2.0 (`CoreRuntime`, `FxRuntime`, `MotionRuntime`). `MotionRuntime` is production-proven in `trail_arrow` (`LevelCompleteWindow.animateIn()` and `LevelCompleteWindow.btnClose` press/release).

This document fixes the design for `UiRuntime`, the fourth Game Core module. It is a specification to build against. Where a rule could be read two ways, this document states one unambiguous reading, called out under "Clarifications" at the end of the section, so implementation has nothing left to guess. Section 18 records every design decision that was open before this spec, with the reason it was decided the way it was.

Nothing in this document is implemented. `UiRuntime` does not exist in `src/` as of this spec. This spec does not change `src/`, `tests/`, `package.json`, or the package version.

## 1. Goal

`UiRuntime` gives games one shared, tested, renderer-agnostic implementation of the two UI lifecycles every HTML5 game in this workspace re-implements by hand, plus the layout arithmetic they both compute in different places:

- a **button** press/release/tap lifecycle with correct pointer ownership, tap-vs-swipe detection, disabled handling, and an animation baseline that can never drift;
- a **modal window** lifecycle (`hidden → entering → shown → leaving → hidden`) with a close-intent hook that lets the host veto a close, and a single source of truth for "the UI is currently blocking gameplay";
- a **layout** function that turns a viewport, a design resolution, and safe-area insets into the numbers a host applies to a Pixi stage, a DOM overlay, or a Three camera frame.

`UiRuntime`:

- does not import Pixi, Three, GSAP, or any DOM API;
- does not create `requestAnimationFrame`, a ticker, `setTimeout`, or `setInterval`;
- does not own a Pixi `Application`, a Three `WebGLRenderer`, a `<dialog>`, or a canvas;
- does not attach browser event listeners — the host feeds it pointer events and close intents;
- does not render and does not know what a "scale", "alpha", "opacity", or "transform" is;
- animates through the existing `MotionRuntime` behind a small, explicit driver interface (section 5);
- only ever advances because the host advances `MotionRuntime` through `CoreRuntime.update(frameMs)`.

Game Core stays an infrastructure layer. It is not a replacement for PixiJS, Three.js, Rapier, or either game's own gameplay engine.

## 2. The two production cases this design must fit

Both games were audited read-only before this spec. The design below is the smallest one that serves both without a renderer-specific branch inside Game Core.

### 2.1 trail_arrow (PixiJS 8 + GSAP + own ECS)

- Host loop: the Pixi `Application.ticker`. `App` already registers one `CoreRuntime` with one `MotionRuntime` and calls `core.update(ticker.deltaMS)` from that ticker.
- Buttons: `src/components/Button.ts`, a Pixi `Container` with press/release scale tweens (press to `0.9` of an explicit idle scale over `80 ms`, linear; release back over `80 ms`). The cumulative-shrink bug (`1.0 → 0.9 → 0.81 → …`) was caused by re-capturing the animated scale as the new baseline; it was fixed in the `btnClose` proof by settling to the explicit idle scale on cancel.
- Windows: `WindowsSystem` creates a window instance once, reuses it forever, fits it to the viewport per class, and mounts it as the single child of the `windows` layer. `LevelCompleteWindow.animateIn()` tweens `alpha 0 → 1`, `y 130 → 0`, `scale 0.7 → 1` over `440 ms` with a `back.out(1.9)` ease. There is no animate-out: close removes the children synchronously.
- Tap-vs-swipe: the engine's event queue only plays the click sound when the pointer moved at most `24` CSS px since pointer-down.
- Layout: `scaleFactor = min(viewportWidth / designWidth, viewportHeight / designHeight)` applied to `stage.scale`, with the design resolution `1080 × 2344` on mobile and `4088 × 2344` on desktop, and every layer centered at the viewport center. Safe-area insets are not handled anywhere.
- Blocking: an open window sits on a background locker that swallows pointer events; there is no explicit "UI is blocking" flag for gameplay systems.

### 2.2 gorodki (Three.js r169 + Rapier 0.14 wasm + DOM/CSS UI)

- Host loop: exactly one `renderer.setAnimationLoop(...)` with a fixed `1/120 s` physics accumulator. Physics does not step while the level picker is open, while paused, or while the tab is hidden; `render()` runs every frame regardless.
- Buttons: plain `<button>` elements with `onclick`, CSS `:active` press feedback, no disabled state, no sound. The throw gesture on the canvas ignores a pointer-up that lands on a `button` or `dialog` and ignores gestures shorter than `max(24, 6 % of the smaller viewport side)` px.
- Windows: two static native `<dialog>` elements (`#result`, `#picker`) driven by `showModal()`/`close()`. No lifecycle. Native `Escape` closes `#result` while gameplay state stays `win`/`lose` — a confirmed defect (REVIEW.md item 4). This is exactly the class of bug the close-intent hook exists to prevent.
- Layout: a CSS column `width: min(100%, 56.25dvh)` centers a `9:16` UI frame; `env(safe-area-inset-*)` is applied in CSS; the 3D camera aspect is updated on `resize`.
- Blocking: "the picker is open" is read directly from `dialog.open` inside the frame loop.
- Distribution: no bundler. A Game Core dependency must be the built `dist/game-core.es.js` served as a static file, exactly like the vendored Three and Rapier files.

### 2.3 Invariants both games need

1. A button's animation baseline is owned by the host and never derived from the animated visual — Game Core exposes only a `0..1` press progress.
2. A window can only leave `entering`/`shown` through one funnel (`close(reason)`) that the host can veto, whatever the host's view technology does on `Escape`, backdrop tap, or hardware back.
3. "The UI is blocking gameplay" is a single boolean the frame loop can read, and it never pauses UI motion.
4. Layout is arithmetic over numbers the host already has; Game Core never reads `window`, `document`, or CSS.

## 3. Non-goals for v0.3

Explicitly **not** part of this design or its implementation:

- `ScreenController` or any screen/state-machine API (trail_arrow has a real screen system, gorodki has none; a universal Screen API would be designed from a single production case);
- any renderer implementation — no Pixi, Three, or DOM code inside Game Core, not even as an optional adapter;
- a window stack, nested modals, navigation history, or a router;
- assets, preload, localization, themes/skins;
- scroll lists, tooltips, hover states;
- shop, daily rewards, or any feature UI;
- a generic gesture system (long press, drag, pinch, multi-touch arbitration between controllers);
- gameplay, physics, Rapier or Three optimization, GSAP migration beyond the two proof targets;
- platform SDKs, ads, analytics implementation, save/profile;
- a Promise-based lifecycle API (same rule as `MotionRuntime` v0.2);
- a large UI framework of any kind.

## 4. Module shape and CoreRuntime integration

`UiRuntime` is an ordinary `CoreRuntimeModule`, registered like the other two:

```ts
const core = new CoreRuntime();
const motion = new MotionRuntime({ onMotionError });
const ui = new UiRuntime({ motion, onUiError, onBlockingChanged });

core.registerRuntime('motion', motion);
core.registerRuntime('ui', ui);

// host loop (Pixi ticker in trail_arrow, setAnimationLoop callback in gorodki):
core.update(frameMs);
```

`UiRuntime` implements exactly these `CoreRuntimeModule` members:

- `update(frameMs): boolean` — **always returns `false` and does no work.** UI motion is advanced by `MotionRuntime.update()` (through the driver in section 5), which calls back into the controllers' bindings. `UiRuntime` has no timers, no queues, and no deferred notifications of its own, so there is nothing to tick.
- `getStats(): UiRuntimeStats` — section 13.
- `dispose(): void` — section 11.

`UiRuntime` deliberately does **not** implement `cancelScope`, `cancelAll`, `pauseScope`, or `resumeScope`. Every motion a UI controller starts lives in `MotionRuntime` under a `ui:`-prefixed scope (section 11), so `core.cancelScope(...)` and `core.cancelAll()` already reach it through the `motion` module. Controllers observe such external cancellation through their tween's `onCancel` and finalize deterministically (sections 7.7 and 8.8). Implementing the fan-out methods on `UiRuntime` too would cancel the same motions twice and add nothing.

**Why keep `update()` at all if it is a no-op?** `CoreRuntimeModule` requires it, and being a registered module is what gives `UiRuntime` the same `dispose`/`getStats`/error-boundary treatment as `fx` and `motion` without a second registration mechanism. The no-op is one early `return false`.

**Clarifications:**

- The host must register the **same** `MotionRuntime` instance in `CoreRuntime` that it passes to `UiRuntime` as `motion`. `UiRuntime` never ticks the driver itself; if the host forgets to register or update `MotionRuntime`, UI transitions with a non-zero duration never progress. This is a host wiring responsibility, stated here so it is tested in the integration proofs.
- Registration order between `'motion'` and `'ui'` does not affect per-frame behavior (`ui.update` does nothing). It affects only teardown ordering through `core.dispose()`; see section 11.
- `UiRuntime` never calls `pauseScope`/`resumeScope` on anything. Blocking gameplay (section 9) is a flag the host reads; it is not a motion pause.

## 5. UiMotionDriver — the explicit, narrow dependency on MotionRuntime

`UiRuntime` depends on motion through one small interface. It does not take a `MotionRuntime` class reference, does not import `MotionRuntime` at runtime, and does not use delays, sequences, pause/resume, repeat, or yoyo.

```ts
// src/ui/types.ts — type-only imports from src/motion/types; no runtime import of src/motion/** or src/fx/**
import type { EaseFn, EaseName, MotionBinding } from '../motion/types';

export type UiScope = string;

export interface UiMotionHandle {
  cancel(): boolean;
  readonly active: boolean;
}

export interface UiMotionTweenRequest {
  scope: UiScope;
  durationMs: number;
  ease?: EaseName | EaseFn;
  bindings: MotionBinding[];
  onComplete?: () => void;
  onCancel?: () => void;
}

export interface UiMotionDriver {
  tween(request: UiMotionTweenRequest): UiMotionHandle;
  cancelScope(scope: UiScope): number;
}
```

**`MotionRuntime` satisfies `UiMotionDriver` structurally, with no adapter.** `UiMotionTweenRequest` is a strict subset of `MotionTweenOptions` (same field names, same types), and `MotionHandle` is a superset of `UiMotionHandle`. The production host writes `new UiRuntime({ motion: motionRuntime })`. Tests pass a hand-written fake driver. The public API test (section 17) compiles `const driver: UiMotionDriver = new MotionRuntime();` and must stay green — if a future `MotionRuntime` change breaks that line, the spec is what the change has to satisfy, not the other way round.

Contract every driver must honour (these are exactly `MotionRuntime` v0.2 semantics, restated so a fake driver in tests is held to the same rules):

1. `tween()` returns synchronously; the first `binding.set()` happens on a later driver update, never inside `tween()`.
2. On normal completion every binding is set to exactly `binding.to`, then `onComplete` fires once.
3. `cancel()` leaves values where they are, fires `onCancel` once synchronously inside the `cancel()` call, and never fires `onComplete` afterwards. A second `cancel()` returns `false` and fires nothing.
4. `cancelScope(scope)` cancels every active tween in that scope with the same per-tween semantics and returns the count.
5. A throwing `binding.set()` cancels only that tween (with `onCancel`). The controllers never let a host callback reach `set()` unhandled (section 12), so in practice this path is not exercised by UI.
6. `ease` accepts the same `EaseName | EaseFn` union as `MotionRuntime`; `'linear'` is the default when omitted.

**Clarifications:**

- **`durationMs <= 0` never reaches the driver.** `MotionRuntime` clamps durations to at least `1 ms`; UI needs true instant transitions (trail_arrow's close, gorodki's dialogs). The controllers special-case non-positive durations themselves: they snap the value and run the completion path synchronously without calling `tween()`.
- Every controller calls `tween()` with **exactly one binding**. The type is `MotionBinding[]` only so that `MotionRuntime` satisfies the interface without an adapter.
- `from` is never set on the binding; the driver reads `get()` at start, which is the controller's current progress. This is what makes "re-press during release" continue from the current visual value with no jump (section 7.5).
- `UiRuntime` does not use `delay`, `sequence`, `pause`, `resume`, `pauseScope`, or `resumeScope`. They are not part of `UiMotionDriver` on purpose; adding them later is an additive interface change.

## 6. UiRuntime public API

```ts
export interface UiRuntimeOptions {
  motion: UiMotionDriver;
  /** Every host callback error lands here. Defaults to a console.error fallback. See section 12. */
  onUiError?: UiErrorHandler;
  /** Fires only when isBlocking() changes value. See section 9. */
  onBlockingChanged?: (blocking: boolean) => void;
}

export class UiRuntime implements CoreRuntimeModule {
  constructor(options: UiRuntimeOptions);

  createButton(options: ButtonControllerOptions): ButtonController;
  createWindow<TParams = void>(options: WindowControllerOptions<TParams>): WindowController<TParams>;

  /** The single window whose state is not 'hidden', or null. */
  readonly activeWindow: WindowController<unknown> | null;
  isBlocking(): boolean;

  /** CoreRuntimeModule: always false, no per-frame work. */
  update(frameMs: number): boolean;
  getStats(): UiRuntimeStats;
  /** Disposes every controller, cancels every ui: scope, clears blocking. See section 11. */
  dispose(): void;
}
```

Rules:

- `id` is required on every controller and must be unique **per kind** (`button` ids among buttons, `window` ids among windows). A duplicate id makes `createButton`/`createWindow` throw an `Error` — the same "never silently replace" policy as `CoreRuntime.registerRuntime`.
- `createButton`/`createWindow` after `dispose()` throw an `Error`.
- Controllers are returned as interfaces; the implementing classes are internal and not exported. This keeps the public surface as small as `MotionHandle`'s.
- `activeWindow` and `isBlocking()` are plain reads with no allocation.

## 7. ButtonController

### 7.1 Model: press progress, not scale

The controller owns one number, `progress`, in `[0, 1]` in the common case:

- `0` = fully idle;
- `1` = fully pressed;
- intermediate values while the press or release animation runs;
- values outside `[0, 1]` occur only if the host chooses an overshooting ease (`backOut`); the terminal value of every animation is exactly `0` or `1`.

The host maps progress to its own visual every time `onProgress(progress)` fires. Examples:

- Pixi (`trail_arrow`): `view.scale.set(idleScale * (1 - 0.1 * progress))` — with `idleScale` an explicit host-owned number, never read back from `view.scale`.
- DOM (`gorodki`): `button.style.setProperty('--press', String(progress))`, with CSS `transform: translateY(calc(2px * var(--press)))` and `filter: brightness(calc(1 + 0.08 * var(--press)))`.

Because the controller never reads a host property and its only animated quantity is bounded and rebased to `0` or `1` at every terminal, **the cumulative-baseline bug is structurally impossible inside Game Core.** The remaining host obligation is stated once: *keep the baseline as an explicit number; never derive it from the property you animate.*

### 7.2 Public types

```ts
export type ButtonState = 'idle' | 'pressed' | 'disabled';

export type ButtonCancelReason =
  | 'swipe'          // pointer moved beyond tapThreshold while pressed
  | 'outside'        // pointerUp(inside = false)
  | 'leave'          // host reported the pointer left the button (Pixi pointerleave)
  | 'pointerCancel'  // host reported a platform pointer cancel
  | 'disabled'       // setEnabled(false) while pressed
  | 'programmatic';  // cancel() while pressed

export type ButtonPointerCancelReason = 'leave' | 'pointerCancel';

export interface ButtonControllerOptions {
  id: string;
  enabled?: boolean;                 // default true
  tapThreshold?: number;             // default 24, in the host's pointer coordinate units (section 7.4)
  pressDurationMs?: number;          // default 80
  releaseDurationMs?: number;        // default 80
  pressEase?: EaseName | EaseFn;     // default 'linear'
  releaseEase?: EaseName | EaseFn;   // default 'linear'
  onProgress?: (progress: number) => void;
  onPress?: () => void;
  onTap?: () => void;
  onCancel?: (reason: ButtonCancelReason) => void;
}

export interface ButtonController {
  readonly id: string;
  readonly scope: UiScope;           // 'ui:button:<id>'
  readonly state: ButtonState;
  readonly progress: number;
  readonly enabled: boolean;
  readonly disposed: boolean;

  pointerDown(pointerId: number, x: number, y: number): boolean;
  pointerMove(pointerId: number, x: number, y: number): boolean;
  pointerUp(pointerId: number, inside: boolean): boolean;
  pointerCancel(pointerId: number, reason?: ButtonPointerCancelReason): boolean;

  setEnabled(enabled: boolean): void;
  /** Programmatic settle: ends any press, stops any release animation, snaps progress to 0. */
  cancel(): boolean;
  dispose(): void;
}
```

Every pointer method returns `true` when the event was consumed by this controller and `false` when it was ignored (wrong pointer, disabled, disposed, no press in progress). The host can use the return value to decide whether to stop propagation.

### 7.3 States and pointer ownership

- `idle`: no owning pointer. `progress` may still be animating toward `0` (a release in flight).
- `pressed`: exactly one owning `pointerId`. `progress` is animating toward `1` or is `1`.
- `disabled`: `enabled === false`. No owning pointer. `progress` may still be animating toward `0`.

**Pointer ownership is one pointer per controller.** The first `pointerDown` that is accepted records its `pointerId` as the owner; `pointerMove`/`pointerUp`/`pointerCancel` from any other pointer return `false` and change nothing until the owner is released. `UiRuntime` does not arbitrate pointers **between** controllers: if the host delivers the same pointer to two overlapping buttons, both press. Preventing that is the host's hit-testing responsibility, as it is today in both games.

### 7.4 Tap threshold

`tapThreshold` is a Euclidean distance in **whatever units the host passes as `x`/`y`** — the controller never converts. Both games pass CSS pixels today (Pixi 8 global coordinates and DOM `clientX/clientY` are both CSS px), and the default `24` is trail_arrow's existing gate. A host that wants gorodki's viewport-relative threshold computes `Math.max(24, Math.min(w, h) * 0.06)` itself and passes it in `options`; the value is fixed for the controller's lifetime in v0.3 (no setter — neither proof target needs one).

The check is `distance(origin, current) > tapThreshold` on every accepted `pointerMove`. Non-finite or negative values are coerced to the default `24`.

### 7.5 Event semantics

| Event | Precondition | Effect |
|---|---|---|
| `pointerDown(id, x, y)` | not disposed, state ≠ `disabled`, no owner | owner = `id`; origin = `(x, y)`; state = `pressed`; start animation to `1` (`pressDurationMs`, `pressEase`); fire `onPress`; return `true` |
| `pointerDown` | otherwise | return `false`, nothing changes (a second finger never steals a press; a press on a disabled button is silently ignored) |
| `pointerMove(id, x, y)` | `id` is owner | if `distance > tapThreshold`: end press with `'swipe'`; otherwise nothing changes; return `true` either way |
| `pointerUp(id, inside)` | `id` is owner | end press with `'tap'` if `inside`, else with `'outside'`; return `true` |
| `pointerCancel(id, reason = 'pointerCancel')` | `id` is owner | end press with `reason`; return `true` |
| `setEnabled(false)` | — | if `pressed`: end press with `'disabled'`; state = `disabled` |
| `setEnabled(true)` | — | if state is `disabled`: state = `idle` (the release animation, if any, keeps running to `0`) |
| `cancel()` | — | if `pressed`: end press with `'programmatic'`; then, if any animation is active, self-cancel it and snap `progress` to `0`; return `true` if either happened, else `false` |
| `dispose()` | — | owner cleared, animation self-cancelled **without** snapping or callbacks, scope cancelled, removed from the runtime; every later call returns `false`/no-op |

**Ending a press** (`endPress(outcome)`), the one shared path for tap and every cancel reason:

1. owner cleared; state becomes `idle` (or `disabled` if the outcome is `'disabled'`);
2. start animation to `0` (`releaseDurationMs`, `releaseEase`) **from the current progress** — a fast tap that releases at `progress 0.6` animates `0.6 → 0`, exactly as trail_arrow's GSAP path does today;
3. then, and only then, fire `onTap` (outcome `'tap'`) or `onCancel(reason)` (any other outcome).

Stats: `presses` increments on every accepted `pointerDown`; `taps` on the `'tap'` outcome; `cancelledPresses` on every other outcome (section 13).

Step order matters: state and animation are already consistent before the host callback runs, so a host that calls `cancel()`, `dispose()`, or closes the parent window from inside `onTap` sees a controller in a terminal-safe state. This is the "close during release" case from the trail_arrow proof.

**Re-press during release.** `pointerDown` while a release animation is active: the release tween is self-cancelled (no snap), and the press tween starts from the current progress. No visual jump, no baseline drift.

**No separate `onRelease`.** Every press ends in exactly one of `onTap` or `onCancel(reason)`; both animate to `0`. A host that wants a press sound uses `onPress`; a click sound and the action go in `onTap`. Three callbacks cover both games' needs; nothing else is added in v0.3.

### 7.6 Motion inside the controller

- The controller preallocates one `MotionBinding` (`get: () => progress`, `set: (v) => setProgress(v)`) and one single-element `bindings` array at construction, and mutates `binding.to` before each tween. Per press, the only allocation left is `MotionRuntime`'s own operation record. The implementation SHOULD also preallocate and mutate the `UiMotionTweenRequest` object, since the driver consumes it synchronously; this is an allowed optimization, not a contract.
- `setProgress(v)`: if `v === progress` return; store; fire `onProgress(v)` under the error guard (section 12). A throwing `onProgress` is caught **inside** `set()`, so the driver never sees a binding error and the tween keeps running.
- `animateTo(target, durationMs, ease)`: self-cancel any active handle first (flagged so its `onCancel` is recognized as self-inflicted); if `durationMs <= 0` or `progress === target`, `setProgress(target)` synchronously and stop; otherwise set `binding.to = target` and call `driver.tween(...)`.
- On `onComplete`: clear the handle; if `progress !== target` (a non-`MotionRuntime` driver that forgot to snap), `setProgress(target)`.

### 7.7 External cancellation

If the tween is cancelled by anything other than the controller itself (`core.cancelScope('ui:button:x')`, `core.cancelAll()`, `motion.dispose()`), the controller's `onCancel` runs with the self-cancel flag clear and the rule is: **finalize to the target of the interrupted animation** — `setProgress(target)`, handle cleared, state and owner untouched. A press interrupted this way lands at `1` (still pressed, pointer still owned); a release lands at `0`. This makes the controller's state deterministic under host-wide teardown without inventing a fourth button state.

### 7.8 Host mapping (documentation for the future adapters, not Core code)

| Host event | Pixi 8 (`trail_arrow` Button) | DOM (`gorodki` `#menu`) |
|---|---|---|
| press | `pointerdown` → `pointerDown(e.pointerId, e.global.x, e.global.y)` | `pointerdown` → `setPointerCapture`, then `pointerDown(e.pointerId, e.clientX, e.clientY)` |
| move | `globalpointermove` → `pointerMove(...)` | `pointermove` → `pointerMove(...)` |
| release inside | `pointerup` → `pointerUp(id, true)` | `pointerup` → `pointerUp(id, button.contains(document.elementFromPoint(x, y)))` |
| release outside | `pointerupoutside` → `pointerUp(id, false)` | covered by the `inside` check above |
| leave | `pointerleave` → `pointerCancel(id, 'leave')` | not needed with pointer capture; without capture `pointerleave` → `pointerCancel(id, 'leave')` |
| platform cancel | `pointercancel` → `pointerCancel(id)` | `pointercancel` → `pointerCancel(id)` |
| visual | `onProgress` → scale from explicit idle scale | `onProgress` → CSS custom property |
| action | `onTap` (replaces the engine's `pointerup` handler for this one button) | `onTap` (replaces `onclick`; the native `click` is not used) |

Mapping `pointerleave` to a cancel preserves today's trail_arrow behavior, where leaving the button already voids the tap.

## 8. WindowController

### 8.1 Model: transition progress, not alpha/y/scale

The controller owns one number, `progress`:

- `0` = hidden;
- `1` = shown;
- intermediate while `entering` (`0 → 1`) or `leaving` (current → `0`);
- values outside `[0, 1]` only with an overshooting ease; the terminal value of each phase is exactly `1` or `0`.

The host maps progress to its view every time `onTransition(progress, phase)` fires:

- `trail_arrow` `LevelCompleteWindow`: `alpha = progress`, `y = 130 * (1 - progress)`, `scale = fitScale * (0.7 + 0.3 * progress)`, with `enterEase` the host's own `back.out(1.9)` `EaseFn`. Because every property is a linear function of the same eased progress, this reproduces the current GSAP tween exactly, overshoot included.
- `gorodki` `#result`: `opacity = progress`, `transform = translateY(calc(20px * (1 - progress)))` through CSS custom properties, or nothing at all with `enterDurationMs: 0`.

### 8.2 Public types

```ts
export type WindowState = 'hidden' | 'entering' | 'shown' | 'leaving';
export type WindowTransitionPhase = 'entering' | 'leaving';
export type WindowCloseReason = 'button' | 'background' | 'escape' | 'back' | 'programmatic';

export interface WindowCloseIntent {
  readonly reason: WindowCloseReason;
  readonly state: 'entering' | 'shown';   // the state the close request found the window in
}

export interface WindowControllerOptions<TParams = void> {
  id: string;
  blocksGameplay?: boolean;          // default true
  enterDurationMs?: number;          // default 0 (instant)
  leaveDurationMs?: number;          // default 0 (instant)
  enterEase?: EaseName | EaseFn;     // default 'linear'
  leaveEase?: EaseName | EaseFn;     // default 'linear'
  /** Mount and apply params. Fires once per show(), before the first onTransition. */
  onShow?: (params: TParams) => void;
  /** Fires with the phase's start value, every intermediate value, and its terminal value. */
  onTransition?: (progress: number, phase: WindowTransitionPhase) => void;
  onShown?: () => void;
  /** Return false to veto. A thrown error is reported and does NOT veto (section 12). */
  onBeforeClose?: (intent: WindowCloseIntent) => boolean | void;
  /** Unmount. Fires once per completed close, after the last onTransition(0, 'leaving'). */
  onHidden?: (reason: WindowCloseReason) => void;
}

export interface WindowController<TParams = void> {
  readonly id: string;
  readonly scope: UiScope;           // 'ui:window:<id>'
  readonly state: WindowState;
  readonly progress: number;
  readonly blocksGameplay: boolean;
  readonly disposed: boolean;

  show(params: TParams): boolean;
  close(reason: WindowCloseReason): boolean;
  dispose(): void;
}
```

`TParams` defaults to `void`, so a window without parameters is shown as `w.show()`.

### 8.3 `show(params)`

Returns `false` and changes nothing when: the controller is disposed; its state is not `hidden`; or another window is active in the same `UiRuntime` (section 8.6). Rejections increment `rejectedShows` in stats and are otherwise silent — they are a host sequencing condition, not an error.

Otherwise, in this exact order:

1. the controller becomes `ui.activeWindow`; state = `entering`; `progress = 0`;
2. `onBlockingChanged(true)` if `blocksGameplay` and the runtime was not blocking before — **before** the view exists, so no frame can show an interactive window over unblocked gameplay;
3. `onShow(params)`;
4. `onTransition(0, 'entering')`;
5. if `enterDurationMs > 0`: start the enter tween `0 → 1`; otherwise synchronously `onTransition(1, 'entering')`, state = `shown`, `onShown()`.

When a running enter tween completes: `progress` is exactly `1`, state = `shown`, `onShown()`.

### 8.4 `close(reason)` and close intent

Returns `false` and changes nothing when the controller is disposed, or its state is `hidden` or `leaving` (a duplicate close). Rejected closes increment `rejectedCloses`.

Otherwise:

1. build `intent = { reason, state }` (state is `'entering'` or `'shown'`);
2. call `onBeforeClose(intent)` if provided. `false` vetoes: `vetoedCloses` increments, `close()` returns `false`, and nothing else changes — an enter tween that was running keeps running. Any other return value, and a thrown error, means "proceed";
3. self-cancel a running enter tween (no snap);
4. state = `leaving`; `closes` increments; `onTransition(progress, 'leaving')` with the current progress (`1` from `shown`, a mid value from `entering`);
5. if `leaveDurationMs > 0`: start the leave tween `current → 0`; otherwise synchronously `onTransition(0, 'leaving')` and finalize (step 6);
6. **finalize hidden:** `progress = 0`; state = `hidden`; `ui.activeWindow = null`; `onHidden(reason)`; then `onBlockingChanged(false)` if the runtime was blocking — **after** the view is gone, so gameplay never unblocks under a still-visible window.

`close()` returns `true` as soon as leaving has started, even if the leave tween is still running.

**Why this closes the gorodki Escape bug.** The host's dialog adapter listens to the native `cancel` event, always calls `event.preventDefault()`, and calls `controller.close('escape')`. If `onBeforeClose` returns `false` (the result window requires an explicit "next" or "again" choice), the dialog stays open and gameplay state stays consistent. If it proceeds, `onHidden` is the one place that calls `dialog.close()` and resets the host state. Native UI can no longer close the window behind the game's back.

### 8.5 Cases the lifecycle must define

| Situation | Behavior |
|---|---|
| `close()` during `entering` | intent state `'entering'`; if not vetoed, the enter tween is self-cancelled and leaving starts from the current progress |
| duplicate `close()` (during `leaving` or when `hidden`) | `false`, counted in `rejectedCloses`, no callbacks |
| `show()` during `entering`, `shown`, or `leaving` | `false`, counted in `rejectedShows`; params are **not** re-applied. A host that wants to replay the entrance closes first and shows again from `onHidden` |
| `show(B)` while `A` is active | `false` (section 8.6) |
| veto during `entering` | the entrance simply continues; the window still reaches `shown` and fires `onShown` |
| `dispose()` while active | tween self-cancelled without snap or callbacks; state = `hidden`; `activeWindow` cleared; `onBlockingChanged(false)` fires if the runtime was blocking (blocking must never dangle); **no** `onHidden` |
| external cancellation of the enter tween | finalize to `shown`: `progress = 1`, `onTransition(1, 'entering')`, `onShown()` |
| external cancellation of the leave tween | finalize hidden (section 8.4 step 6) with the reason that started the leave |

### 8.6 One active modal window

`UiRuntime` holds at most one window whose state is not `hidden`. There is no stack, no queue, and no replacement: `show()` on any other window returns `false` until the active one has finalized hidden. The supported pattern for "open B after A" is to call `B.show(...)` from `A`'s `onHidden`, or from any later host code that checks `ui.activeWindow === null`. Both proof targets already behave this way: trail_arrow's `windows` layer holds one child, gorodki's dialogs are exclusive by `showModal()`.

A host that needs an immediate replacement sets `leaveDurationMs: 0` on the outgoing window; then `A.close(...)` finalizes synchronously and `B.show(...)` on the next line succeeds. This is trail_arrow's actual close today.

### 8.7 Motion inside the controller

Identical mechanics to the button (section 7.6): one preallocated binding over `progress`, one tween at a time in scope `ui:window:<id>`, non-positive durations handled synchronously without the driver, `onTransition` errors caught inside `set()`.

### 8.8 External cancellation

Same rule as the button: an externally cancelled UI tween finalizes to its phase target, as defined in the table in section 8.5.

### 8.9 Host mapping (documentation for the future adapters)

`trail_arrow` `LevelCompleteWindow`:

- `WindowsSystem` keeps mounting the Pixi view and fitting it; the controller does not replace it. `onShow(params)` applies params and marks the window interactive. `onTransition(p, 'entering')` drives `alpha`, `y`, `scale` from the fit scale. `enterDurationMs: 440`, `enterEase: backOut(1.9)` as a host `EaseFn` (the built-in `'backOut'` uses overshoot `1.35`, which would change the look). `leaveDurationMs: 0`.
- `btnClose` tap → `close('button')`; background tap → `close('background')`; continue / rewarded flows → `close('programmatic')`. `onBeforeClose` may return `false` while an interstitial is pending; this is optional for the proof, and today's "disable every button" workaround may stay as it is. `onHidden` runs the existing `closeWindowOnly` cleanup.

`gorodki` `#result`:

- `onShow(params)` writes stars/title/summary and calls `dialog.showModal()`. The dialog's native `cancel` event is intercepted as described in section 8.4. `next`/`again` → `close('button')`; `onHidden(reason)` calls `dialog.close()` and only then triggers the next level or restart, so the host never acts on a closed dialog whose game state was not resolved.
- `blocksGameplay: true`; the frame loop gates `step()` on `ui.isBlocking()` in addition to its existing conditions. `render()` and `core.update(frameMs)` keep running every frame.

## 9. Blocking state

```ts
ui.isBlocking(): boolean
onBlockingChanged?: (blocking: boolean) => void   // UiRuntimeOptions
```

Semantics:

- `isBlocking()` is `true` exactly when `ui.activeWindow !== null && ui.activeWindow.blocksGameplay`. An active window is one in `entering`, `shown`, or `leaving`.
- Blocking begins inside `show()` before `onShow` (section 8.3 step 2) and ends inside finalize-hidden after `onHidden` (section 8.4 step 6) or inside `dispose()`.
- `onBlockingChanged` fires synchronously on every change of value and never twice in a row with the same value. It is guarded like every other host callback (section 12).
- `isBlocking()` is a field read; a host may poll it every frame at no cost, which is the recommended wiring for gorodki's frame loop.

What blocking is **not**:

- It is not a motion pause. `UiRuntime` never calls `pauseScope`/`resumeScope` and never touches the driver's clock. UI transitions run on the host's real frame time even while the host has stopped its physics and input. A gorodki modal with `blocksGameplay: true` therefore pauses Rapier stepping and gesture input while the dialog still animates in and out.
- It is not an input filter. `UiRuntime` does not receive gameplay input and cannot swallow it. trail_arrow's background locker and gorodki's `closest('button, dialog')` guard stay where they are; `isBlocking()` is the flag gameplay systems read to decide whether to react at all.
- It is not per-frame state. It only changes inside `show()`, close finalization, and `dispose()`.

## 10. Layout

### 10.1 API

One pure function, no class, no state, no runtime instance required:

```ts
export type LayoutOrientation = 'portrait' | 'landscape';

export interface LayoutInsets { top: number; right: number; bottom: number; left: number; }
export interface LayoutRect { x: number; y: number; width: number; height: number; }

export interface LayoutInput {
  viewportWidth: number;     // viewport units (CSS px in both games)
  viewportHeight: number;
  designWidth: number;       // design units
  designHeight: number;
  safeInsets?: Partial<LayoutInsets>;   // viewport units, missing fields = 0
}

export interface LayoutResult {
  orientation: LayoutOrientation;
  /** design units → viewport units; contain fit */
  scale: number;
  /** viewport-unit position of the design box's top-left corner (letterbox/pillarbox offset, >= 0) */
  offsetX: number;
  offsetY: number;
  /** the whole viewport in design units, relative to the design box origin (x, y <= 0) */
  visibleRect: LayoutRect;
  /** the viewport minus safe insets, in design units, relative to the design box origin */
  safeRect: LayoutRect;
}

export function computeLayout(input: LayoutInput): LayoutResult;
```

### 10.2 Fit semantics: contain

`scale = min(viewportWidth / designWidth, viewportHeight / designHeight)`. The whole design box is always visible; the remaining viewport is letterbox (portrait excess height) or pillarbox (landscape excess width), centered. This is exactly trail_arrow's `scaleFactor` and exactly gorodki's `min(100%, 56.25dvh)` column with a `9:16` design box. No `cover`, no `stretch`, no per-axis modes in v0.3 — neither game uses them.

Formulas, with `vw`, `vh`, `dw`, `dh` the coerced inputs and `t, r, b, l` the coerced insets:

```
scale     = min(vw / dw, vh / dh)
offsetX   = (vw - dw * scale) / 2
offsetY   = (vh - dh * scale) / 2
visibleRect = { x: -offsetX / scale, y: -offsetY / scale, width: vw / scale, height: vh / scale }
safeRect    = { x: (l - offsetX) / scale, y: (t - offsetY) / scale,
                width: max(0, vw - l - r) / scale, height: max(0, vh - t - b) / scale }
orientation = vw > vh ? 'landscape' : 'portrait'
```

Coordinate convention: every rect is in **design units with the design box's top-left corner at `(0, 0)`**. trail_arrow, which centers its stage, converts with `visibleRect.x + visibleRect.width / 2` (and the same for `y`) — one subtraction, done in the host.

### 10.3 Safe area

Safe-area insets are inputs in viewport units. Game Core never reads `env(safe-area-inset-*)`, `visualViewport`, or any platform API; the host measures (gorodki already applies `env()` in CSS and can read it into JS from a probe element; trail_arrow currently has no safe-area handling and will gain `safeRect` for free once it passes insets). `safeRect` is the region the host should keep HUD and buttons inside; the design box itself is not shrunk by insets, because both games position content by design coordinates and would rather move a HUD element than rescale the whole scene.

### 10.4 Orientation, design resolution, resize

- Orientation is decided by the viewport only: `landscape` when width is strictly greater than height, otherwise `portrait` (a square viewport is `portrait`).
- The design resolution is an input. trail_arrow passes `1080 × 2344` on mobile and `4088 × 2344` on desktop, exactly as its `Environment` does today; gorodki passes a `9:16` box such as `1080 × 1920`. `computeLayout` never chooses a design size.
- Resize is the host calling `computeLayout` again with the new viewport. The result is a fresh object each call; this allocation happens on resize only, never per frame. trail_arrow's existing resize deduplication stays in the host.

### 10.5 Invalid input policy

`computeLayout` never throws — a resize storm must not be able to take down the host. Coercion rules, applied before any arithmetic:

- `viewportWidth`, `viewportHeight`, `designWidth`, `designHeight`: non-finite or `< 1` → `1`;
- each inset: non-finite or `< 0` → `0`;
- opposite insets that together exceed the viewport produce a `safeRect` with `width`/`height` `0` (never negative), positioned at the left/top inset.

Every output is a finite number for every input, and the function is deterministic: equal inputs give structurally equal outputs.

## 11. Scopes, lifecycle, and dispose

| Owner | Scope name | Who creates motions in it | Cancelled by |
|---|---|---|---|
| `ButtonController` | `ui:button:<id>` | only that controller | replacement by the next press/release animation (tap, any cancel reason, `setEnabled(false)`, re-press), `cancel()`, `dispose()`, external `core.cancelScope`/`cancelAll` |
| `WindowController` | `ui:window:<id>` | only that controller | close replacement of the enter tween, finalize hidden, `dispose()`, external cancellation |

Rules:

- The `ui:` prefix is **reserved**. Hosts must not start motions in `ui:`-prefixed scopes; `UiRuntime` does not police this, it documents it.
- A controller runs at most one tween at any moment. Replacing a tween always self-cancels the previous one first (flagged), so `onCancel` bookkeeping is never confused with external cancellation.
- Controller `dispose()`: self-cancel any tween without snap and without host callbacks, then `driver.cancelScope(scope)` as a belt-and-braces sweep (it returns `0` when the self-cancel already did the job), then unregister from the runtime. A window that was active also clears `activeWindow` and, if the runtime was blocking, fires `onBlockingChanged(false)`. After `dispose()` every method returns `false`/no-op and `disposed` is `true`. Disposing twice is a no-op.
- Reuse: controllers are long-lived, like trail_arrow's window instances and gorodki's static dialogs. A window is shown and hidden many times over its life; a button is pressed many times. Nothing is recreated per show or per press. A host that wants a fresh controller disposes the old one and creates a new one with the same id (ids are freed on dispose).
- `UiRuntime.dispose()`: disposes every controller (windows first, then buttons; the order is only for determinism in tests), which cancels every `ui:` scope; fires `onBlockingChanged(false)` once if the runtime was blocking; clears the registries; sets `disposed`. Later `createButton`/`createWindow` throw.
- Through `core.dispose()`: `CoreRuntime` disposes modules in registration order. If `'motion'` is registered before `'ui'`, `motion.dispose()` runs first and cancels every UI tween **externally**, so controllers finalize to their targets and may fire `onShown`/`onHidden`/`onProgress` once during teardown; then `ui.dispose()` runs. If `'ui'` is registered first, teardown is silent. Both orders are safe and leave no dangling motion; a host that wants a silent teardown either registers `'ui'` before `'motion'` or calls `ui.dispose()` explicitly before `core.dispose()`. The integration proofs use the explicit call.
- `UiRuntime` never creates browser listeners, so there is nothing to detach on dispose. Host adapters own their listeners and detach them in their own teardown.

## 12. Error isolation

`UiRuntime` follows the two-layer model already shipped for `FxRuntime` and `MotionRuntime`:

1. **Inner layer (`UiRuntime`):** every host callback — `onProgress`, `onPress`, `onTap`, `onCancel`, `onShow`, `onTransition`, `onShown`, `onBeforeClose`, `onHidden`, `onBlockingChanged` — is invoked inside a guard. A throw is caught, `callbackErrors` increments, and the error is reported through the runtime's handler. The controller's own state machine has already transitioned before the callback ran, so a throwing callback never leaves a controller half-transitioned.
2. **Outer layer (`CoreRuntime`):** if `ui.update`/`getStats`/`dispose` itself throws (a bug in `UiRuntime`), `CoreRuntime` reports it through its own `onError` and keeps every other module running, exactly as for `fx` and `motion`.

Handler contract, mirroring `onMotionError`/`onEffectError`:

```ts
export type UiControllerKind = 'button' | 'window' | 'runtime';

export type UiErrorPhase =
  | 'onProgress' | 'onPress' | 'onTap' | 'onCancel'
  | 'onShow' | 'onTransition' | 'onShown' | 'onBeforeClose' | 'onHidden'
  | 'onBlockingChanged';

export interface UiErrorContext {
  kind: UiControllerKind;   // 'runtime' for onBlockingChanged
  id: string;               // controller id, or 'ui' for the runtime itself
  phase: UiErrorPhase;
}

export type UiErrorHandler = (error: unknown, context: UiErrorContext) => void;
```

- Default handler: a `console.error` fallback, so a standalone `UiRuntime` never swallows failures silently — same default as the other two runtimes.
- Recommended production wiring: forward into the host's existing sink, which in trail_arrow is the analytics error event and `CoreRuntime.reportError('ui', error)`; gorodki has no sink today and keeps the console default.
- A throwing error handler is itself caught and ignored; an error handler can never reach the host's frame loop.
- `onProgress`/`onTransition` errors are caught **inside** the binding's `set()`, so `MotionRuntime` never classifies them as binding errors and never cancels the tween for them. The visual may skip a frame; the lifecycle completes.
- `onBeforeClose` that throws: reported with phase `'onBeforeClose'`, and the close **proceeds** (fail-open). Rationale: a veto that happens by accident leaves a modal that blocks the entire game with no way out; a close that happens by accident is recoverable and visible in the error sink. The host's handler sees the failure either way.
- Rejected `show()`/`close()` calls (section 8.3, 8.4) are **not** errors; they are counted in stats and return `false`. A duplicate controller id and `create*` after `dispose()` **are** errors and throw, because they are programming mistakes at wiring time, not runtime conditions.

## 13. Stats

```ts
export interface UiRuntimeStats {
  buttons: number;
  windows: number;
  activeWindowId: string | null;
  blocking: boolean;
  presses: number;
  taps: number;
  cancelledPresses: number;
  shows: number;
  rejectedShows: number;
  closes: number;
  vetoedCloses: number;
  rejectedCloses: number;
  callbackErrors: number;
}
```

Through `core.getStats()` the aggregate becomes `{ fx: {...}, motion: {...}, ui: {...} }`. `getStats()` allocates one plain object per call and is never called from the frame path by the runtime itself. Counters are monotonic for the runtime's lifetime; `dispose()` does not reset them.

## 14. Performance rules and how to test them

Expectations:

- **No per-frame work in `UiRuntime`.** `update()` returns `false` immediately. There is no list of controllers to iterate per frame.
- **Per-interaction cost** is one `MotionRuntime` operation record per press, release, enter, or leave. Bindings and the bindings array are preallocated per controller (section 7.6); the tween request object should be too.
- **No per-frame allocation on the motion path.** The per-frame path is `MotionRuntime` calling `binding.set(v)` → `setProgress(v)` → `onProgress(v)`: scalar compare, scalar store, one guarded call. No closures created per frame, no arrays, no objects.
- **No hidden timers.** `UiRuntime` never references `requestAnimationFrame`, `setTimeout`, `setInterval`, `performance`, `Date`, `window`, `document`, or `navigator`. Instant transitions are synchronous, not deferred.
- `computeLayout` allocates its result object; it is called on resize, not per frame.

How to test:

- Run the `ui` test files under Vitest's `node` environment (the package default). Any accidental DOM reference throws `ReferenceError` in tests.
- A test installs throwing stubs for `requestAnimationFrame`, `setTimeout`, and `setInterval` on `globalThis` for the duration of a full button and window lifecycle and asserts none was called.
- A fake driver test asserts `ui.update(16)` returns `false` and calls nothing on the driver.
- A static review item in the implementation plan, matching section 16 of the MotionRuntime spec: no `map`/`filter`/object literals inside `setProgress` or the binding closures.

## 15. Public API and distribution boundary

### 15.1 Exports added to `src/index.ts`

Values:

- `UiRuntime`
- `computeLayout`

Types:

- `UiRuntimeOptions`, `UiRuntimeStats`
- `UiMotionDriver`, `UiMotionTweenRequest`, `UiMotionHandle`, `UiScope`
- `ButtonController`, `ButtonControllerOptions`, `ButtonState`, `ButtonCancelReason`, `ButtonPointerCancelReason`
- `WindowController`, `WindowControllerOptions`, `WindowState`, `WindowTransitionPhase`, `WindowCloseReason`, `WindowCloseIntent`
- `LayoutInput`, `LayoutResult`, `LayoutRect`, `LayoutInsets`, `LayoutOrientation`
- `UiErrorContext`, `UiErrorHandler`, `UiErrorPhase`, `UiControllerKind`

Not exported: the controller implementation classes, any internal state record, any helper.

Source layout (fixed now so the implementation plan does not have to choose):

```
src/ui/types.ts
src/ui/layout.ts
src/ui/ButtonController.ts     (internal class)
src/ui/WindowController.ts     (internal class)
src/ui/UiRuntime.ts
tests/ui/fakeMotionDriver.ts
tests/ui/button.test.ts
tests/ui/window.test.ts
tests/ui/blocking.test.ts
tests/ui/layout.test.ts
tests/ui/runtime.test.ts
tests/ui/integration.test.ts   (real MotionRuntime through CoreRuntime.update)
tests/ui/public-api.test.ts
```

Module boundary rule, extending the v0.2 rule: `src/ui/**` may `import type` from `src/motion/types` and from `src/core/CoreRuntime` (for `CoreRuntimeModule`). It must not import any runtime value from `src/motion/**` or `src/fx/**`, and neither of those may import from `src/ui/**`.

### 15.2 Distribution rule

The trail_arrow MotionRuntime proof consumed Game Core through relative deep imports into `game-core/src/core/...` and `game-core/src/motion/...` from a sibling checkout. That was acceptable as a spike. It is **not** a production dependency strategy, and this spec fixes the rule for every integration from UiRuntime onward:

- Production integrations depend only on the **public entry** of Game Core: the built `dist/game-core.es.js` (or the IIFE build) with `dist/index.d.ts`, or the package entry `src/index.ts` when a bundler resolves the package. Deep imports into `game-core/src/**` are forbidden in production code.
- Every type and value UiRuntime integrations need is therefore exported from `src/index.ts` (section 15.1). If an integration finds itself needing something that is not exported, the fix is to export it here, not to deep-import it.
- gorodki, which has no bundler, consumes the ES build as a vendored static file, the way word_tide already vendors the IIFE build and the way gorodki already vendors Three and Rapier.
- Packaging, version pinning, and the sync tooling for both games are a separate task and are not designed here.

## 16. Production proof plan

Both proofs happen **after** implementation, as separate bounded integration tasks. Nothing outside the named targets is migrated.

### 16.1 trail_arrow

- **Button:** `LevelCompleteWindow.btnClose` only. The existing `Button` component gains one opt-in path that forwards its Pixi pointer events to a `ButtonController` (mapping in section 7.8) and applies `onProgress` to scale from its explicit idle scale. Every other `Button` keeps the current GSAP path.
- **Window:** `LevelCompleteWindow` only, through a `WindowController` wired as in section 8.9. `WindowsSystem`, `ScreenSystem`, every other window, and all remaining GSAP usage stay untouched.
- **Wiring:** `App` creates `UiRuntime` next to its existing `MotionRuntime` and registers it; `core.update(ticker.deltaMS)` already exists. Game Core is consumed through the public entry, replacing the deep imports of the spike (section 15.2).
- **Verify:** visual identity of the entrance (`440 ms`, `back.out(1.9)`, `alpha`/`y`/`scale`) on a real iPhone; press/release identity (`0.9`, `80 ms`); repeated press; close during release leaves `btnClose` at its idle scale on the next show; `isBlocking()` is `true` from `show()` to `onHidden` and `onBlockingChanged` fires exactly twice per show/close cycle; `motion.getStats().activeMotions` is `0` after the window is hidden; `ui.getStats().callbackErrors` is `0`.

### 16.2 gorodki

- **Button:** `#menu` only, through a DOM adapter (section 7.8) that replaces its `onclick` with `onTap` and drives a CSS custom property from `onProgress`. `#retry`, `#sound`, and the dialog buttons keep their current handlers.
- **Window:** `#result` only, through a `WindowController` with the dialog adapter from section 8.9. `#picker` stays as it is.
- **Allowed host refactor, and nothing more:** the frame loop calls `core.update(frameMs)` every frame before `render()`; `step()` is additionally gated on `!ui.isBlocking()`; Game Core is loaded as a vendored `dist/game-core.es.js` through the existing import map. Rapier, the physics step, level loading, the throw gesture, and `game.js`'s remaining DOM wiring are not touched. The larger `createGame(...)`/`destroy()` refactor recommended by HANDOFF.md is a separate decision and is not a prerequisite for this proof.
- **Verify:** `#menu` reacts through `ButtonController` (press visual, tap opens the picker, a swipe starting on the button does not); `Escape` on `#result` is vetoed by `onBeforeClose` and the dialog stays open with gameplay state intact; `next`/`again` close through `close('button')` and the level changes only from `onHidden`; `isBlocking()` pauses physics stepping while `#result` is active; the dialog's enter/leave transition keeps animating while physics is paused; after the dialog hides, `motion.getStats().activeMotions` is `0`.

## 17. Test matrix for the future implementation

All unit tests use `tests/ui/fakeMotionDriver.ts`: a driver that records requests, exposes `advance(ms)` to interpolate active tweens linearly (calling `binding.set` and `onComplete`), supports `cancelScope`, and can inject an external cancel into a specific tween. `tests/ui/integration.test.ts` uses the real `MotionRuntime` registered in a real `CoreRuntime` and advances through `core.update(frameMs)` only.

**Button:**
- normal press then release reaches `1` then `0`, `onPress` and `onTap` once each;
- tap: `pointerUp(inside = true)` fires `onTap`, never `onCancel`;
- swipe: movement beyond `tapThreshold` fires `onCancel('swipe')` and a later `pointerUp` returns `false`;
- movement within the threshold keeps the press;
- `pointerUp(inside = false)` → `onCancel('outside')`; `pointerCancel()` → `'pointerCancel'`; `pointerCancel(id, 'leave')` → `'leave'`;
- second pointer during a press is ignored; only the owner can release;
- disabled: `pointerDown` ignored; `setEnabled(false)` during a press → `onCancel('disabled')` and progress animates to `0`;
- repeated press during release starts from the current progress with no jump (assert the first `set()` value equals the progress at re-press);
- release interrupted by `cancel()` snaps to `0` and fires nothing extra; the next press starts from `0` and still reaches exactly `1` (baseline never compounds, asserted over ten cycles);
- `cancel()` while pressed → `onCancel('programmatic')` then snap to `0`;
- `onProgress`/`onPress`/`onTap`/`onCancel` that throw are reported with the right phase, the lifecycle completes, `callbackErrors` increments;
- external cancel of a press tween finalizes to `1` with state still `pressed`; of a release tween to `0`;
- `dispose()` during a press cancels the scope, fires no callbacks, and later calls return `false`;
- instant press/release (`durationMs: 0`) never calls the driver.

**Window:**
- normal show then close reaches `shown` and `hidden`, each callback once, in the order of sections 8.3 and 8.4;
- `show(params)` passes params to `onShow` unchanged;
- `entering → shown` only after the tween completes; `progress` is exactly `1`;
- every `WindowCloseReason` is passed through to `onBeforeClose` intent and `onHidden`;
- veto keeps the state, increments `vetoedCloses`, returns `false`; veto during `entering` still reaches `shown`;
- close during entering starts leaving from the current progress;
- duplicate close during `leaving` and when `hidden` returns `false`;
- `show()` during `entering`/`shown`/`leaving` returns `false` and does not re-apply params;
- instant enter and instant leave (`0 ms`) run the full callback sequence synchronously without touching the driver;
- `onTransition` reports the start and terminal value of both phases;
- callbacks that throw are reported with the right phase; a throwing `onBeforeClose` does not veto;
- external cancel during entering finalizes to `shown`; during leaving finalizes to `hidden`;
- `dispose()` while active clears `activeWindow`, fires no `onHidden`, and clears blocking.

**Blocking:**
- `isBlocking()` false with no window; true from `show()` on a `blocksGameplay` window; false after `onHidden`;
- `onBlockingChanged` fires before `onShow` on show and after `onHidden` on close, exactly once each;
- a `blocksGameplay: false` window never changes blocking;
- `dispose()` of a blocking window and `UiRuntime.dispose()` both end with `isBlocking() === false` and one `onBlockingChanged(false)`;
- blocking never calls `pauseScope`/`resumeScope` on the driver (the fake driver has spies that must stay uncalled).

**Layout:**
- portrait viewport: scale by height-limited or width-limited axis as appropriate, offsets centered, `visibleRect` covers the viewport;
- landscape viewport: pillarbox offsets, orientation `landscape`;
- square viewport is `portrait`;
- safe insets shrink `safeRect` only, never the design box; opposite insets exceeding the viewport give zero-size `safeRect`;
- narrow viewport (`320 × 568`) and trail_arrow's real design sizes reproduce its current `scaleFactor` to floating-point equality;
- gorodki's `9:16` design on a `390 × 844` viewport gives `scale * designWidth === min(390, 844 * 9 / 16)`;
- invalid input (`0`, negative, `NaN`, `Infinity`, missing insets) never throws and yields finite outputs;
- determinism: two calls with equal input give deep-equal results.

**UiRuntime:**
- `update()` returns `false` and calls nothing on the driver;
- `getStats()` counters move through each lifecycle; `activeWindowId` tracks the active window;
- duplicate ids throw; `create*` after `dispose()` throws;
- one active modal: `show(B)` while `A` is active returns `false`; succeeds from `A`'s `onHidden`;
- `dispose()` cancels every `ui:` scope on the driver and leaves no active tween;
- error isolation: a throwing `onBlockingChanged` is reported with `kind: 'runtime'` and the show still completes;
- teardown through `core.dispose()` in both registration orders leaves `motion.getStats().activeMotions === 0`.

**Public API:**
- the compile-in-memory export test, in the style of `tests/motion/public-api.test.ts`: every exported name in section 15.1 resolves from `../../src/index`; `const driver: UiMotionDriver = new MotionRuntime();` compiles; controller implementation classes are not reachable.

**Performance:**
- no own RAF/timers (stubs that throw, per section 14);
- a full press/release and show/close cycle on the fake driver records exactly one `tween()` call per animated phase and reuses the same `bindings` array instance across calls of the same controller;
- static review of the `set()` path for allocations, recorded in the implementation plan.

## 18. Decisions record

Each item below was an open question before this spec. The decision is final for v0.3.

1. **`UiMotionDriver` interface** — `{ tween(request), cancelScope(scope) }` with `UiMotionTweenRequest` a strict subset of `MotionTweenOptions`, so `MotionRuntime` satisfies it structurally with no adapter class. Rejected: a value-callback driver (`tween({ from, to, onValue })`) that would have needed an adapter around `MotionRuntime` and a second binding vocabulary.
2. **`UiRuntime.update()`** — exists (required by `CoreRuntimeModule`) and is a no-op returning `false`. All UI motion is ticked by `MotionRuntime` through `CoreRuntime`. Rejected: not registering `UiRuntime` as a module, which would have needed a separate dispose/stats/error path.
3. **Button state model** — three states (`idle`, `pressed`, `disabled`) plus a separate `progress` number. A release in flight is `idle` with `progress > 0`; it is not a fourth state, because no host decision depends on distinguishing "idle" from "releasing", while the visual is fully described by `progress`.
4. **Pointer ownership** — one owning `pointerId` per controller; other pointers are ignored until release; no arbitration between controllers. Both games already hit-test in the host.
5. **Tap threshold units** — the host's own pointer coordinate units, default `24`, fixed per controller. Both games pass CSS pixels; gorodki's viewport-relative rule is computed by the host.
6. **Button progress model** — `0..1` press progress, host maps to scale/CSS. Chosen over "Core animates a host-provided scale binding" because the baseline bug lives exactly in the host reading back its own animated property; a bounded progress removes that path entirely.
7. **Window transition model** — one `0..1` progress per phase, `entering` up and `leaving` down, host maps all properties from it. trail_arrow's entrance is reproducible exactly because every property is linear in the same eased progress; gorodki can ignore it with `0 ms` durations.
8. **Window replacement** — none. `show()` is rejected unless the controller is `hidden` and no other window is active; hosts sequence through `onHidden` or use instant leave. Rejected: a pending-show queue (a stack in disguise).
9. **Blocking semantics** — `isBlocking()` = active window exists and `blocksGameplay`; changes announced before `onShow` and after `onHidden`; never a motion pause; never an input filter.
10. **Scope naming/ownership** — `ui:button:<id>` and `ui:window:<id>`, one tween at a time, reserved `ui:` prefix, controller is the sole creator in its scope, `UiRuntime` does not implement the scope fan-out methods.
11. **Dispose semantics** — controller dispose is silent (no host callbacks except a required `onBlockingChanged(false)`), sweeps its scope, frees its id; runtime dispose disposes all and throws on later `create*`; `core.dispose()` is safe in either registration order, silent only if `ui` is disposed first.
12. **Error phase/type** — `UiErrorContext { kind, id, phase }` with the ten callback phases, handler in `UiRuntimeOptions`, console default, throwing handler swallowed; a throwing `onBeforeClose` fails open. Same shape and layering as `onMotionError`/`onEffectError`; no second mechanism.
13. **Layout fit semantics** — contain only, design box never shrunk by insets, rects in design units from the design box origin, coercion instead of throwing. Matches trail_arrow's `scaleFactor` and gorodki's CSS column exactly.
14. **Public API exports** — listed in section 15.1; controllers exported as interfaces; deep imports forbidden for production integrations.
15. **CoreRuntime / MotionRuntime / UiRuntime interaction** — host loop → `core.update(frameMs)` → `motion.update` advances UI tweens → binding `set` → controller → host callback; `ui.update` is a no-op; host input → controller methods → `driver.tween`; teardown through `ui.dispose()` then `core.dispose()`. No module imports another module's runtime code; `ui` depends on `motion` only through `UiMotionDriver` and type-only imports.

Trade-offs accepted with these decisions:

- Hosts keep the responsibility for hit-testing, pointer capture, and the explicit visual baseline. Game Core owns the lifecycle, not the renderer.
- A rejected `show()` is a silent `false`. The alternative, throwing, would turn a benign race (two wins within one frame) into a crash; the counter in stats keeps it observable.
- Fail-open on a throwing `onBeforeClose` prefers a recoverable close over an unrecoverable stuck modal.
- One active modal means a host that needs "confirm dialog over shop" waits for `onHidden`; neither production case needs more today.

## 19. Success criteria

- `UiRuntime` stays renderer-, DOM-, and platform-independent: no Pixi, Three, GSAP, DOM, timer, or RAF reference anywhere under `src/ui/**`.
- `CoreRuntime`, `FxRuntime`, and `MotionRuntime` are unchanged by the implementation; the only new coupling is the `UiMotionDriver` interface that `MotionRuntime` already satisfies.
- The same `ButtonController` and `WindowController` code drives a Pixi button and window in trail_arrow and a DOM button and native dialog in gorodki, with only host adapters differing.
- The cumulative-baseline bug is impossible by construction, and the gorodki Escape defect is closed by the close-intent funnel.
- `isBlocking()` gives both games one flag for "UI is modal", with UI motion continuing on real frame time while gameplay is stopped.
- `computeLayout` reproduces both games' current fit arithmetic and adds safe-area output without reading a single browser API.
- Every host callback is error-isolated through the same two-layer model as the other runtimes.
- Observable through `getStats()`; testable without a browser; production-consumable through Game Core's public entry only.
