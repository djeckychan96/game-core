# UiRuntime v0.3 — Implementation Plan

- **Status:** Ready to implement. Not yet started — no `src/ui/**` exists yet.
- **Date:** 2026-09-15
- **Branch:** `feat/ui-runtime-v0.3` (created from `design/ui-runtime-v0.3`, commit `59ce7a1`, which sits on `main` / tag `v0.2.0`)
- **Spec this plan implements:** [`docs/superpowers/specs/2026-09-15-ui-runtime-v0.3-design.md`](../specs/2026-09-15-ui-runtime-v0.3-design.md) — approved, do not deviate from it. If anything below appears to conflict with that spec, the spec wins; stop and raise it rather than silently resolving it differently than this plan says.

This plan is self-contained. Read the spec once, then this plan is sufficient to implement, task by task, in order.

**Explicitly out of scope for this plan** (do not do these as part of implementing it):
- Any change inside `trail_arrow/` or `gorodki/`.
- Any change to `CoreRuntime`, `FxRuntime`, or `MotionRuntime` source. `UiRuntime` depends on them only through `CoreRuntimeModule` (type) and the structural `UiMotionDriver` interface that `MotionRuntime` already satisfies.
- A package version bump, a tag, a release, or `npm run sync:word-tide`.
- Anything listed in spec §3 ("Non-goals for v0.3"): no `ScreenController`, no window stack, no renderer adapter, no DOM/Pixi/Three code, no timers.

## Conventions used by every task below

**The TDD loop.** Every task follows exactly this sequence, with its own commit at the end:

1. Write the concrete failing test(s) listed under that task, in the exact file the task names.
2. Run `npx vitest run <that test file>` and confirm they fail for the expected reason (missing export / not-yet-implemented behavior), not for an unrelated syntax error.
3. Implement the minimal code that makes them pass — no more than what the task's "Implement" section describes.
4. Run `npm test` (the full suite) and confirm everything passes, including every pre-existing test.
5. Run `npx tsc --noEmit` and confirm no errors (tests are type-checked too; `tsconfig.json` includes `tests`).
6. Commit with exactly the message given under the task's "Commit" heading.

Do not batch tasks into one commit. Do not leave a task partially done across a commit boundary.

**TypeScript strictness** (from `tsconfig.json`, already governing the package): `strict`, `exactOptionalPropertyTypes` (an optional field is *absent* when unset — never assign `undefined`; copy optional callbacks with `if (options.onTap) this.onTap = options.onTap;`), `noUncheckedIndexedAccess` (array indexing yields `T | undefined`).

**Module boundary rule** (spec §15.1): `src/ui/**` may `import type` from `src/motion/types` and from `src/core/CoreRuntime` (`CoreRuntimeModule`). It must not import any runtime value from `src/motion/**` or `src/fx/**`, and neither may import from `src/ui/**`. Nothing under `src/ui/**` may reference `window`, `document`, `navigator`, `performance`, `Date`, `requestAnimationFrame`, `setTimeout`, or `setInterval`.

**File layout** (fixed by spec §15.1):

```
src/ui/types.ts
src/ui/layout.ts
src/ui/ButtonController.ts     (internal class ButtonControllerImpl)
src/ui/WindowController.ts     (internal class WindowControllerImpl)
src/ui/UiRuntime.ts
tests/ui/fakeMotionDriver.ts
tests/ui/layout.test.ts
tests/ui/button.test.ts
tests/ui/window.test.ts
tests/ui/blocking.test.ts
tests/ui/runtime.test.ts
tests/ui/integration.test.ts
tests/ui/public-api.test.ts
tests/ui/performance.test.ts
```

`performance.test.ts` is the one file this plan adds beyond the spec's list; spec §14 and §17 require its checks and no other file is a natural home for them.

**Internal host seam.** The two controller classes talk to the runtime through one internal interface, `UiHost`, declared in `src/ui/UiRuntime.ts` and imported by the controllers with `import type` (a type-only cycle, no runtime cycle). It is never exported from `src/index.ts`:

```ts
export interface UiHost {
  readonly motion: UiMotionDriver;
  readonly stats: UiMutableStats;                 // the counters, mutated in place
  activeWindowImpl: WindowControllerImpl | null;  // read/write by WindowControllerImpl only
  reportError(kind: UiControllerKind, id: string, phase: UiErrorPhase, error: unknown): void;
  recomputeBlocking(): void;
  unregisterButton(id: string): void;
  unregisterWindow(id: string): void;
}
```

`UiMutableStats` is the same shape as `UiRuntimeStats` minus the three derived fields (`buttons`, `windows`, `activeWindowId`, `blocking` are computed in `getStats()`).

**Lifecycle generation** (spec §6.1), implemented identically in both controllers: a private `generation = 0` incremented at every transition; every method captures `const gen = this.generation` right after its own transition and `if (this.generation !== gen) return …;` after each host callback; the driver request's `onComplete`/`onCancel` compare a private `tweenGeneration` (set when the tween starts) with `generation` and return early when they differ. A controller-initiated cancel always bumps `generation` **before** calling `handle.cancel()`.

## Task 1 — Public types and `computeLayout`

**Depends on:** nothing.

**Files created:** `src/ui/types.ts`, `src/ui/layout.ts`, `tests/ui/layout.test.ts`.

**Types to define in `src/ui/types.ts`** — exactly the public shapes of spec §5, §6, §7.2, §8.2, §10.1, §12, §13:

```ts
import type { EaseFn, EaseName, MotionBinding } from '../motion/types';

export type UiScope = string;
export interface UiMotionHandle { cancel(): boolean; readonly active: boolean; }
export interface UiMotionTweenRequest {
  scope: UiScope; durationMs: number; ease?: EaseName | EaseFn;
  bindings: MotionBinding[]; onComplete?: () => void; onCancel?: () => void;
}
export interface UiMotionDriver { tween(request: UiMotionTweenRequest): UiMotionHandle; cancelScope(scope: UiScope): number; }

export type ButtonState = 'idle' | 'pressed' | 'disabled';
export type ButtonCancelReason = 'swipe' | 'outside' | 'leave' | 'pointerCancel' | 'disabled' | 'programmatic';
export type ButtonPointerCancelReason = 'leave' | 'pointerCancel';
export interface ButtonControllerOptions { id: string; enabled?: boolean; tapThreshold?: number; pressDurationMs?: number; releaseDurationMs?: number; pressEase?: EaseName | EaseFn; releaseEase?: EaseName | EaseFn; onProgress?: (progress: number) => void; onPress?: () => void; onTap?: () => void; onCancel?: (reason: ButtonCancelReason) => void; }
export interface ButtonController { readonly id: string; readonly scope: UiScope; readonly state: ButtonState; readonly progress: number; readonly enabled: boolean; readonly tapThreshold: number; readonly disposed: boolean; pointerDown(pointerId: number, x: number, y: number): boolean; pointerMove(pointerId: number, x: number, y: number): boolean; pointerUp(pointerId: number, x: number, y: number, inside: boolean): boolean; pointerCancel(pointerId: number, reason?: ButtonPointerCancelReason): boolean; setEnabled(enabled: boolean): void; setTapThreshold(value: number): void; cancel(): boolean; dispose(): void; }

export type WindowState = 'hidden' | 'entering' | 'shown' | 'leaving';
export type WindowTransitionPhase = 'entering' | 'leaving';
export type WindowCloseReason = 'button' | 'background' | 'escape' | 'back' | 'programmatic';
export type WindowHiddenReason = WindowCloseReason | 'cancelled';
export interface WindowCloseIntent { readonly reason: WindowCloseReason; readonly state: 'entering' | 'shown'; }
export interface WindowControllerOptions<TParams = void> { id: string; blocksGameplay?: boolean; enterDurationMs?: number; leaveDurationMs?: number; enterEase?: EaseName | EaseFn; leaveEase?: EaseName | EaseFn; onShow?: (params: TParams) => void; onTransition?: (progress: number, phase: WindowTransitionPhase) => void; onShown?: () => void; onBeforeClose?: (intent: WindowCloseIntent) => boolean | void; onHidden?: (reason: WindowHiddenReason) => void; }
export interface WindowController<TParams = void> { readonly id: string; readonly scope: UiScope; readonly state: WindowState; readonly progress: number; readonly blocksGameplay: boolean; readonly disposed: boolean; show(params: TParams): boolean; close(reason: WindowCloseReason, onClosed?: () => void): boolean; cancel(): boolean; dispose(): void; }

export type LayoutOrientation = 'portrait' | 'landscape';
export interface LayoutInsets { top: number; right: number; bottom: number; left: number; }
export interface LayoutRect { x: number; y: number; width: number; height: number; }
export interface LayoutInput { viewportWidth: number; viewportHeight: number; designWidth: number; designHeight: number; safeInsets?: Partial<LayoutInsets>; }
export interface LayoutResult { orientation: LayoutOrientation; scale: number; offsetX: number; offsetY: number; visibleRect: LayoutRect; safeRect: LayoutRect; }

export type UiControllerKind = 'button' | 'window' | 'runtime';
export type UiErrorPhase = 'onProgress' | 'onPress' | 'onTap' | 'onCancel' | 'onShow' | 'onTransition' | 'onShown' | 'onBeforeClose' | 'onHidden' | 'onClosed' | 'onBlockingChanged';
export interface UiErrorContext { kind: UiControllerKind; id: string; phase: UiErrorPhase; }
export type UiErrorHandler = (error: unknown, context: UiErrorContext) => void;
export interface UiRuntimeOptions { motion: UiMotionDriver; onUiError?: UiErrorHandler; onBlockingChanged?: (blocking: boolean) => void; }
export interface UiRuntimeStats { buttons: number; windows: number; activeWindowId: string | null; blocking: boolean; presses: number; taps: number; cancelledPresses: number; shows: number; rejectedShows: number; closes: number; vetoedCloses: number; rejectedCloses: number; forcedHides: number; callbackErrors: number; }
```

**`src/ui/layout.ts`** — `export function computeLayout(input: LayoutInput): LayoutResult` implementing spec §10.2 and §10.5 verbatim: `designWidth`/`designHeight` not finite or `<= 0` → `throw new RangeError(...)` before any arithmetic; viewport dims not finite or `<= 0` → `1`; each inset not finite or `< 0` → `0`; `scale = min(vw/dw, vh/dh)`; `offsetX = (vw - dw*scale)/2`, `offsetY` likewise; `visibleRect = { x: -offsetX/scale, y: -offsetY/scale, width: vw/scale, height: vh/scale }`; `safeRect = { x: (l-offsetX)/scale, y: (t-offsetY)/scale, width: max(0, vw-l-r)/scale, height: max(0, vh-t-b)/scale }`; `orientation = vw > vh ? 'landscape' : 'portrait'`. Never throws for a valid design size.

**Tests in `tests/ui/layout.test.ts`** (spec §17 "Layout"):
- portrait `390 × 844`, design `1080 × 1920`: `scale === 390/1080`, `offsetX === 0`, `offsetY === (844 - 1920 * scale) / 2`, `visibleRect` equals `{ x: 0, y: -offsetY/scale, width: 1080, height: 844/scale }`, `scale * designWidth === Math.min(390, 844 * 9 / 16)`;
- landscape `1280 × 800`, design `1080 × 1920`: `orientation === 'landscape'`, `offsetX > 0`, `offsetY === 0`;
- square `500 × 500` is `'portrait'`;
- safe insets `{ top: 47, bottom: 34 }` shrink `safeRect` only: `safeRect.y === (47 - offsetY)/scale`, `safeRect.height === (844 - 81)/scale`, `visibleRect` unchanged;
- opposite insets exceeding the viewport (`left: 300, right: 300` on width `390`) give `safeRect.width === 0` and `safeRect.x === (300 - offsetX)/scale`;
- trail_arrow reproduction: for `(320, 568, 1080, 2344)` and `(1440, 900, 4088, 2344)`, `scale === Math.min(vw/dw, vh/dh)` exactly (`toBe`, not `toBeCloseTo`);
- design size `0`, `-1`, `NaN`, `Infinity`, `undefined as unknown as number` → `toThrow(RangeError)` for each of width and height;
- viewport `0`, `-5`, `NaN` → does not throw, every output `Number.isFinite`; insets `NaN` and `-10` → treated as `0`;
- determinism: two calls with the same input → `toEqual`.
- Type-level check of the driver contract (spec §5): `const driver: UiMotionDriver = new MotionRuntime(); expect(driver).toBeDefined();` — this compiles only if `MotionRuntime` structurally satisfies `UiMotionDriver`; `npx tsc --noEmit` enforces it.

**Verify:** `npx vitest run tests/ui/layout.test.ts`, `npm test`, `npx tsc --noEmit`.

**Commit:** `feat(ui): add public types and computeLayout`

## Task 2 — Fake driver, `UiRuntime` skeleton, `ButtonController` basic lifecycle

**Depends on:** Task 1.

**Files created:** `tests/ui/fakeMotionDriver.ts`, `tests/ui/button.test.ts`, `src/ui/UiRuntime.ts`, `src/ui/ButtonController.ts`.

**`tests/ui/fakeMotionDriver.ts`** — `export class FakeMotionDriver implements UiMotionDriver` obeying spec §5's seven contract rules and §17's preamble:
- `tween(request)`: **copies** `scope`, `durationMs`, `ease` (resolved through `resolveEase` from `src/motion/easing`), `bindings`, `onComplete`, `onCancel` into a private `FakeTween` record (the controllers mutate and reuse their request object, exactly like `MotionRuntime` copies fields); pushes it to `active`; records the request in `requests: UiMotionTweenRequest[]` and the `bindings` array instance in `bindingArrays: MotionBinding[][]`; returns `{ cancel, get active }` where `cancel()` returns `false` if the tween is already gone, otherwise removes it and fires `onCancel` synchronously.
- `advance(ms)`: iterates a snapshot of `active`; for each tween still active, resolves `from = binding.get()` on its first advance, adds `ms`, computes `p = min(1, elapsed / durationMs)`, sets `binding.set(from + (to - from) * ease(p))` — with `p === 1` it sets exactly `to` — and, if `p === 1` and the tween is still active after `set()` (a reentrant cancel may have removed it), removes it and fires `onComplete`.
- `cancelScope(scope)` and `cancelAll()`: snapshot, cancel each still-active tween, return the count.
- `activeCount` getter; `pauseScope = vi.fn()` and `resumeScope = vi.fn()` (must never be called); `replayComplete(index)`: calls the recorded `onComplete` of request `index` again (stale replay); `lastTween` getter.

**`src/ui/UiRuntime.ts` (skeleton in this task)** — `export class UiRuntime implements CoreRuntimeModule, UiHost` with: constructor storing `motion`, `onUiError` (default console.error fallback, same shape as `defaultOnMotionError`), `onBlockingChanged`; `createButton(options)` (throws `Error` on duplicate id — message contains `already`; throws `Error` after `dispose()`); `update()` → `return false`; `getStats()`; `reportError()` (increments `callbackErrors`, calls the handler inside try/catch); `unregisterButton()`. `createWindow`, `cancelScope`, `cancelAll`, `dispose`, `activeWindow`, `isBlocking`, `recomputeBlocking` are added in later tasks (a stub `recomputeBlocking() {}` and `activeWindowImpl = null` are declared now so `UiHost` is complete).

**`src/ui/ButtonController.ts`** — `export class ButtonControllerImpl implements ButtonController`:
- fields: `id`, `scope = 'ui:button:' + id`, `state`, `progress = 0`, `enabled`, `tapThreshold`, `disposed = false`, `ownerPointerId: number | null`, `originX/originY`, `generation`, `tweenGeneration`, `target`, `handle: UiMotionHandle | null`, the preallocated `binding: MotionBinding` (`get: () => this.progress`, `set: (v) => this.setProgress(v)`, `to: 0`), `bindings = [binding]`, the preallocated `request: UiMotionTweenRequest` whose `onComplete`/`onCancel` are fixed arrow functions, and the copied option callbacks.
- constructor validates `tapThreshold` (`Number.isFinite(v) && v >= 0`, else `RangeError`), defaults `24`, `pressDurationMs`/`releaseDurationMs` default `80`, eases default `'linear'`, `enabled` default `true` (state `'disabled'` when `false`).
- `pointerDown/pointerMove/pointerUp/pointerCancel/setEnabled/setTapThreshold/cancel/dispose` exactly per spec §7.5 table and text; private `endPress(outcome)`, `animateTo(target, durationMs, ease)`, `setProgress(v)`, `dropHandle()`, `distanceFromOrigin(x, y)`, and one guarded invoker per callback (`callProgress(v)`, `callPress()`, `callTap()`, `callCancel(reason)`) that catch and `host.reportError('button', id, phase, error)`.
- `onComplete` arrow: `if (this.tweenGeneration !== this.generation) return; this.handle = null; if (this.progress !== this.target) this.setProgress(this.target);`
- `onCancel` arrow: `if (this.tweenGeneration !== this.generation) return; this.cancel();` (the handle is left in place; `cancel()`'s `dropHandle()` then gets `false` from the dead handle).

**Tests in `tests/ui/button.test.ts`, first batch** (each test builds `new UiRuntime({ motion: driver })` with a `FakeMotionDriver` and records callbacks in arrays):
- normal press then release: `pointerDown(1, 0, 0)` → `state 'pressed'`, `onPress` once; `driver.advance(80)` → `progress === 1`; `pointerUp(1, 0, 0, true)` → `state 'idle'`; `driver.advance(80)` → `progress === 0`; `onTap` once; `onCancel` never;
- tap within threshold → `onTap`, no `onCancel`;
- `pointerUp(inside=false)` within threshold → `onCancel('outside')`;
- `pointerCancel(1)` → `'pointerCancel'`; `pointerCancel(1, 'leave')` → `'leave'`;
- second pointer during a press: `pointerDown(2, …)` returns `false`, `pointerUp(2, …)` returns `false`, `pointerUp(1, …)` returns `true`;
- disabled: `createButton({ enabled: false })` → state `'disabled'`, `pointerDown` returns `false`; `setEnabled(false)` during a press → `onCancel('disabled')`, state `'disabled'`, `driver.advance(80)` → `progress 0`; `setEnabled(true)` → `'idle'`;
- instant durations (`pressDurationMs: 0, releaseDurationMs: 0`): `driver.requests.length === 0` after a full press/release, `onProgress` received `[1, 0]`;
- pointer methods on a disposed controller return `false`;
- `createButton` with a duplicate id throws `/already/`; `createButton({ tapThreshold: NaN })` throws `RangeError`.

**Verify:** `npx vitest run tests/ui/button.test.ts`, `npm test`, `npx tsc --noEmit`.

**Commit:** `feat(ui): add UiRuntime skeleton and ButtonController lifecycle`

## Task 3 — Button swipe, final-distance rule, threshold changes, re-press, baseline

**Depends on:** Task 2.

**Files changed:** `tests/ui/button.test.ts` (second batch), `src/ui/ButtonController.ts` only if a test exposes a gap (the Task 2 implementation is expected to already satisfy spec §7.4–7.5; this task is the proof).

**Tests added** (spec §17 "Button"):
- swipe on move: `pointerDown(1, 0, 0)`, `pointerMove(1, 30, 0)` (default threshold `24`) → `onCancel('swipe')`; a later `pointerUp(1, …)` returns `false`;
- movement within threshold (`pointerMove(1, 10, 10)`) keeps `'pressed'`;
- swipe on release without any move: `pointerDown(1, 0, 0)`, `pointerUp(1, 100, 0, true)` → `onCancel('swipe')`, no `onTap`; `pointerUp(1, 10, 0, true)` → `onTap`; `pointerUp(1, 100, 0, false)` → `'swipe'` (precedence over `'outside'`);
- `setTapThreshold(60)` during a press: `pointerMove(1, 40, 0)` keeps the press; `pointerMove(1, 70, 0)` swipes; `tapThreshold === 60`;
- `setTapThreshold(NaN | -1 | Infinity)` throws `RangeError`, `tapThreshold` unchanged; `setTapThreshold(0)` accepted and `pointerMove(1, 1, 0)` swipes;
- gorodki resize formula: `setTapThreshold(Math.max(24, Math.min(390, 844) * 0.06))` makes a `30`-unit release a tap where the default made it a swipe;
- re-press during release, no jump: press, `advance(80)`, release, `advance(40)` (progress `0.5`), `pointerDown` again → the next `driver.advance(1)` first `set()` value is greater than `0.5` and less than `0.51` (started from `0.5`, not from `0` or `1`); `advance(79)` → `progress === 1`;
- baseline never compounds: ten cycles of press/`advance(80)`/release/`advance(80)` end at `progress === 0` each time and reach `progress === 1` each time;
- release interrupted by `cancel()`: press, `advance(80)`, release, `advance(20)`, `cancel()` → `progress === 0`, `onProgress` last value `0`, no `onCancel` (state was `idle`); next press still reaches `1`;
- preallocation: after a press and release, `driver.bindingArrays[0] === driver.bindingArrays[1]` (same array instance) and `driver.requests.length === 2`.

**Verify:** `npx vitest run tests/ui/button.test.ts`, `npm test`, `npx tsc --noEmit`.

**Commit:** `feat(ui): button swipe threshold and re-press semantics`

## Task 4 — Button settle, reentrancy, error isolation, driver-delivered cancellation

**Depends on:** Task 3.

**Files changed:** `tests/ui/button.test.ts` (third batch), `src/ui/ButtonController.ts` as needed.

**Tests added:**
- `cancel()` while pressed: `onProgress(0)` recorded **before** `onCancel('programmatic')` (assert a combined event log); returns `true`; `cancel()` on an idle settled button returns `false` and records nothing;
- callbacks that throw: `onProgress`, `onPress`, `onTap`, `onCancel` each throw once → `onUiError` called with `{ kind: 'button', id, phase }` for the right phase, the lifecycle still completes (state/progress as normal), `getStats().callbackErrors` increments by one per throw;
- reentrancy: `dispose()` from inside `onPress` → no `onTap`/`onCancel` afterwards, `pointerUp` returns `false`, `disposed === true`; `dispose()` from inside `onTap` and from inside `onCancel` → nothing further; with instant release, `dispose()` from inside `onProgress(0)` → `onTap` never fires; `cancel()` from inside `onTap` → `progress 0` and a subsequent press reaches `1`; `pointerDown(2, …)` from inside `onCancel` re-presses → state `'pressed'` with owner `2`;
- driver-delivered cancellation: press, `advance(40)`, `driver.cancelAll()` → state `'idle'`, `progress 0`, `onProgress(0)` then `onCancel('programmatic')` once, `onUiError` not called, `driver.activeCount === 0`; release tween + `driver.cancelAll()` → `onProgress(0)` only, no `onCancel`;
- stale completion: press, `advance(80)`, release (re-press replaced the press tween) then `driver.replayComplete(0)` → state and progress unchanged, no extra callback;
- `dispose()` during a press: `onProgress(0)` and `onCancel('programmatic')` once, `driver.activeCount === 0`, later `pointerDown` returns `false`, `getStats().buttons` drops by one;
- `dispose()` twice is a no-op.

**Verify:** as above.

**Commit:** `feat(ui): button settle, reentrancy and error isolation`

## Task 5 — `WindowController` lifecycle, close continuation, one active modal

**Depends on:** Task 4.

**Files created:** `src/ui/WindowController.ts`, `tests/ui/window.test.ts`. **Files changed:** `src/ui/UiRuntime.ts` (`createWindow`, `activeWindow`, `activeWindowImpl`, `unregisterWindow`).

**`src/ui/WindowController.ts`** — `export class WindowControllerImpl<TParams> implements WindowController<TParams>` with the same generation/binding/request machinery as the button plus: `phase: WindowTransitionPhase`, `evaluatingClose = false`, `pendingOnClosed: (() => void) | null`, `pendingReason: WindowCloseReason`. Methods exactly per spec §8.3 (`show`), §8.4 (`close`, `finalizeHidden`, `cancel`), §8.7 (motion), §8.8 (driver `onCancel` → `this.cancel()`); `onComplete` arrow: stale check, `handle = null`, snap if needed, then `becomeShown()` when `phase === 'entering'` or `finalizeHidden(pendingReason)` when `phase === 'leaving'`. `show()` rejects when `host.activeWindowImpl !== null`; on acceptance sets `host.activeWindowImpl = this`. `finalizeHidden` takes the continuation into a local before `onHidden`, runs it only if `!this.disposed` afterwards, then always `host.recomputeBlocking()`. Force-hide sets `progress` directly (no `onTransition`), drops the continuation, increments `forcedHides`, fires `onHidden('cancelled')`, then `recomputeBlocking()`.

**Tests in `tests/ui/window.test.ts`, first batch** (spec §17 "Window"):
- instant show/close (`0 ms`): event log is exactly `['onShow', 'onTransition:0:entering', 'onTransition:1:entering', 'onShown']` then, on `close('button', cont)`, `['onBeforeClose:button:shown', 'onTransition:1:leaving', 'onTransition:0:leaving', 'onHidden:button', 'onClosed']`; `driver.requests.length === 0`;
- tweened show (`enterDurationMs: 440`): after `show()` state `'entering'`, `driver.advance(440)` → `progress === 1`, state `'shown'`, `onShown` once; `close('escape', cont)` with `leaveDurationMs: 200`: state `'leaving'`, `onTransition(1,'leaving')` first, `advance(200)` → `'hidden'`, `onHidden('escape')`, then `onClosed`;
- `show(params)` passes the exact object to `onShow`;
- every `WindowCloseReason` (`button`, `background`, `escape`, `back`, `programmatic`) reaches the intent and `onHidden`;
- `close()` without a continuation completes normally; a duplicate `close()` during `leaving` returns `false`, counts `rejectedCloses`, keeps the first continuation (it still runs once);
- duplicate close when `hidden` returns `false`;
- `show()` during `entering`/`shown`/`leaving` returns `false`, counts `rejectedShows`, does not call `onShow` again;
- close during entering: `show()`, `advance(100)` (progress `100/440`), `close('button')` → intent state `'entering'`, `onTransition(100/440, 'leaving')`, no `onShown` ever;
- one active modal: `A.show()`; `B.show()` returns `false`; `A.close('button', () => { expect(B.show()).toBe(true); })` → `B` reaches `shown`; `ui.activeWindow === B`;
- `show(B)` from inside `A.onHidden` succeeds; `show(A)` from inside `A.onHidden` succeeds;
- `ui.activeWindow` is `null` before show, `A` while active, `null` after hidden.

**Verify:** `npx vitest run tests/ui/window.test.ts`, `npm test`, `npx tsc --noEmit`.

**Commit:** `feat(ui): WindowController lifecycle and close continuation`

## Task 6 — Window veto, reentrancy, stale callbacks, force-hide, dispose

**Depends on:** Task 5.

**Files changed:** `tests/ui/window.test.ts` (second batch), `src/ui/WindowController.ts` as needed.

**Tests added:**
- veto: `onBeforeClose` returns `false` → `close()` returns `false`, state unchanged, `vetoedCloses === 1`, continuation never runs even after a later successful close with no continuation; veto during `entering` still reaches `shown`;
- throwing `onBeforeClose` → reported with phase `'onBeforeClose'`, close proceeds;
- nested `close()` inside `onBeforeClose` returns `false`, `rejectedCloses === 1`, no recursion; outer proceeds on `undefined`, vetoes on `false`;
- `dispose()` inside `onBeforeClose` → outer `close()` returns `false`, no `onTransition`/`onHidden` beyond the `onHidden('cancelled')` the dispose itself fired, continuation never stored; `cancel()` inside `onBeforeClose` → same outcome;
- `close()` inside `onShow` → `show()` returns `true`, `driver.requests.length === 0`, log `['onShow', 'onBeforeClose', 'onTransition:0:leaving', 'onHidden:button', 'onClosed']`, no `onShown`; `dispose()` inside `onShow` → `show()` returns `true`, log `['onShow', 'onHidden:cancelled']`, `activeWindow === null`;
- `close()` inside an entering `onTransition` (from the driver's `advance`) → enter tween gone, no `onShown`, leaving completes to `hidden`; `dispose()` inside `onTransition` → `onHidden('cancelled')` and nothing further;
- `close()` and `dispose()` inside `onShown` proceed normally;
- stale completion: `show()` (tweened), `advance(100)`, `close('button')` (instant leave), then `driver.replayComplete(0)` → state stays `'hidden'`, no extra `onShown`;
- force-hide: `cancel()` during `entering` → `'hidden'`, `onHidden('cancelled')`, no `onBeforeClose`, no `onShown`, `driver.activeCount === 0`, `forcedHides === 1`; during `shown` → same; during `leaving` with a continuation → continuation never runs; `cancel()` when `hidden` returns `false`;
- `dispose()` while active → `onHidden('cancelled')` once, `activeWindow === null`, `getStats().windows` drops by one, later `show()` returns `false`; `dispose()` inside `onHidden` of a completing close drops the continuation;
- callbacks that throw (`onShow`, `onTransition`, `onShown`, `onHidden`, `onClosed`) → reported with the right phase, lifecycle completes; a throwing `onClosed` still leaves `activeWindow === null`;
- driver-delivered cancellation: `show()` (tweened), `driver.cancelAll()` → `'hidden'`, `onHidden('cancelled')` once, no `onShown`, `onUiError` not called; during `leaving` with a continuation → continuation never runs.

**Commit:** `feat(ui): window veto, reentrancy and force-hide`

## Task 7 — Blocking state

**Depends on:** Task 6.

**Files created:** `tests/ui/blocking.test.ts`. **Files changed:** `src/ui/UiRuntime.ts` (`blocking` field, `isBlocking()`, `recomputeBlocking()` per spec §6.2 with the `onBlockingChanged` guard reporting `{ kind: 'runtime', id: 'ui', phase: 'onBlockingChanged' }`).

**Tests** (spec §17 "Blocking"):
- `isBlocking()` false with no window; `true` right after `show()` of a `blocksGameplay` window; `false` after close completes; `onBlockingChanged` recorded `[true, false]`;
- ordering: inside `onShow`, `isBlocking()` is still `false`; inside `onShown` it is `true`; inside `onHidden` it is still `true`; inside `onClosed` it is still `true`; after `close()` returns (instant) it is `false`;
- hand-over blocking → blocking via `onClosed`: `A.close('button', () => B.show())` → recording `[true]` until `B.close()`, then `[true, false]`; the same via `onHidden`;
- hand-over blocking → non-blocking: recording `[true, false]`, the `false` published inside `B.show()` after `B.onShow` (assert from inside `B.onShow` that `isBlocking()` is `true`, from inside `B.onShown` that it is `false`); nothing on `B.close()`;
- re-show `A` from inside `A.onHidden` → recording stays `[true]`;
- a `blocksGameplay: false` window never changes blocking and never calls `onBlockingChanged`;
- `A.cancel()`, `A.dispose()`, `ui.cancelAll()`, `ui.dispose()` (each from a blocking `shown` state) → `isBlocking() === false`, exactly one `onBlockingChanged(false)`;
- a throwing `onBlockingChanged` → reported with `kind 'runtime'`, `isBlocking()` still reflects the new value, the show still completes;
- an `onBlockingChanged(true)` that closes the window → `show()` returns `true`, final recording `[true, false]`;
- `driver.pauseScope`/`resumeScope` never called across every scenario.

**Commit:** `feat(ui): blocking state`

## Task 8 — Runtime registry, `cancelScope`/`cancelAll`/`dispose`, stats

**Depends on:** Task 7.

**Files created:** `tests/ui/runtime.test.ts`. **Files changed:** `src/ui/UiRuntime.ts` (`cancelScope`, `cancelAll`, `dispose`, full `getStats`).

**Implement:** `cancelScope(scope)`: if `scope` starts with `'ui:button:'` look up the button by the remainder, else if it starts with `'ui:window:'` look up the window; return `controller.cancel() ? 1 : 0`, `0` when nothing matches. `cancelAll()`: snapshot windows then buttons, `cancel()` each, return the count of `true`. `dispose()`: if already disposed return; `cancelAll()`; dispose every window then every button (snapshots); clear both maps; `disposed = true`. `getStats()` returns a fresh object with the counters plus `buttons`, `windows`, `activeWindowId`, `blocking`.

**Tests** (spec §17 "UiRuntime"):
- `update(16)` returns `false` and `driver.requests` stays empty;
- counters: `presses`, `taps`, `cancelledPresses`, `shows`, `rejectedShows`, `closes`, `vetoedCloses`, `rejectedCloses`, `forcedHides`, `callbackErrors` each move through the corresponding scenario; `activeWindowId` tracks the active window; `buttons`/`windows` count live controllers;
- duplicate window id throws `/already/`; `createButton`/`createWindow` after `dispose()` throw;
- `ui.cancelScope('ui:window:<id>')` force-hides only that window and returns `1`; `'ui:button:<id>'` settles only that button; `'something-else'` returns `0` and touches nothing; a second call returns `0`;
- `ui.cancelAll()` with one pressed button and one shown window returns `2`, fires the settle callbacks once each, second call returns `0` and fires nothing;
- `ui.dispose()` after `ui.cancelAll()` fires nothing further, `disposed` controllers, `createButton` throws; `ui.dispose()` twice is a no-op;
- `ui.dispose()` with an active window → `onHidden('cancelled')` once, `onBlockingChanged(false)` once, `activeWindow === null`.

**Commit:** `feat(ui): runtime cancellation fan-out and dispose`

## Task 9 — Integration with the real `MotionRuntime` and `CoreRuntime`

**Depends on:** Task 8.

**Files created:** `tests/ui/integration.test.ts`.

**Harness:** a `setup(order: 'ui-first' | 'motion-first')` helper that builds `new CoreRuntime()`, `new MotionRuntime()`, `new UiRuntime({ motion, onBlockingChanged, onUiError })`, registers the two modules in the requested order, creates one button (`80 ms` press/release) and one window (`440 ms` enter, `200 ms` leave, `blocksGameplay: true`) with full callback logging including `onClosed` and `onShown` flags, and returns everything. Every scenario below is wrapped in `describe.each(['ui-first', 'motion-first'])` and asserts the **same** log, state, and return value for both orders.

**Scenarios** (spec §17 "Cancellation and teardown"):
- press, `core.update(40)`, `core.cancelAll()` → button `'idle'`, `progress 0`, log `['onProgress:…', …, 'onProgress:0', 'onCancel:programmatic']` ending with exactly those two entries after the cancel, `motion.getStats().activeMotions === 0`;
- press, `core.update(80)`, release, `core.update(40)`, `core.cancelAll()` → log ends with `'onProgress:0'` only, no `onCancel`;
- window `entering` (`show()`, `core.update(100)`), `core.cancelAll()` → `'hidden'`, `onHidden:cancelled` once, no `onShown`, no `onClosed`, `activeMotions === 0`;
- window `shown` and blocking, `core.cancelAll()` → `'hidden'`, `onHidden:cancelled` once, `activeWindow === null`, `isBlocking() === false`, `onBlockingChanged` recorded `[true, false]`;
- window `leaving` with a continuation (`close('button', cont)`, `core.update(50)`), `core.cancelAll()` → `'hidden'`, `onHidden:cancelled` once, `cont` never called;
- no business callback: with a `shown` window whose continuation and `onShown` set flags, each of `core.cancelAll()`, `core.cancelScope(window.scope)`, `motion.cancelAll()`, `ui.cancelAll()`, `core.dispose()` (fresh setup each) leaves the continuation flag unset;
- `activeWindow === null`, `isBlocking() === false`, `activeMotions === 0` after every global cancellation above;
- repeated `core.cancelAll()`: second call returns `0` and appends nothing to the log;
- `core.dispose()` after `core.cancelAll()`: no throw, nothing appended, `createButton` throws afterwards; `ui.dispose()` after `ui.cancelAll()` likewise;
- `core.cancelScope('ui:window:<id>')` with the window `entering` and the button pressed → window hidden, button still pressed, return value `1` in both orders; `core.cancelScope('ui:button:<id>')` → button settled, window untouched; `core.cancelScope('other')` → nothing;
- direct `motion.cancelAll()` and direct `motion.dispose()` with a pressed button and an entering window → same log as `core.cancelAll()`; a following `ui.cancelAll()` returns `0`;
- return count: with a pressed button, an entering window, and one non-UI tween (`motion.tween({ bindings: [...], durationMs: 1000, scope: 'game' })`), `core.cancelAll()` returns `3` in both orders (`N = 2`, `M = 1`);
- `core.dispose()` in both orders with the button pressed and the window shown → log equals the `core.cancelAll()` log for the same state, then `createButton` throws;
- a `close()` issued from inside `onTransition` during `core.update()` (reentrant `tween()` inside `MotionRuntime.update`) → the leave tween starts and completes on later `core.update()` calls, `onShown` never fires;
- the type check `const module: CoreRuntimeModule = ui;` compiles.

**Commit:** `test(ui): integrate with real CoreRuntime and MotionRuntime`

## Task 10 — Public exports, declaration test, performance tests, architecture note

**Depends on:** Task 9.

**Files changed:** `src/index.ts`, `docs/ARCHITECTURE.md`. **Files created:** `tests/ui/public-api.test.ts`, `tests/ui/performance.test.ts`.

**`src/index.ts` additions** (spec §15.1, exactly): values `UiRuntime`, `computeLayout`; types `UiRuntimeOptions`, `UiRuntimeStats`, `UiMotionDriver`, `UiMotionTweenRequest`, `UiMotionHandle`, `UiScope`, `ButtonController`, `ButtonControllerOptions`, `ButtonState`, `ButtonCancelReason`, `ButtonPointerCancelReason`, `WindowController`, `WindowControllerOptions`, `WindowState`, `WindowTransitionPhase`, `WindowCloseReason`, `WindowHiddenReason`, `WindowCloseIntent`, `LayoutInput`, `LayoutResult`, `LayoutRect`, `LayoutInsets`, `LayoutOrientation`, `UiErrorContext`, `UiErrorHandler`, `UiErrorPhase`, `UiControllerKind`. Not exported: `ButtonControllerImpl`, `WindowControllerImpl`, `UiHost`.

**`tests/ui/public-api.test.ts`** — the compile-in-memory consumer in the style of `tests/motion/public-api.test.ts`: imports every name above from `../../src/index`; `const driver: UiMotionDriver = new MotionRuntime();`; `const module: CoreRuntimeModule = new UiRuntime({ motion: driver });`; `// @ts-expect-error` lines for `ButtonControllerImpl`, `WindowControllerImpl`, and `UiHost` imports from `../../src/index`; `Record<keyof UiRuntime, true>` listing exactly `createButton, createWindow, activeWindow, isBlocking, update, cancelScope, cancelAll, getStats, dispose`; diagnostics must be `[]`.

**`tests/ui/performance.test.ts`** (spec §14, §17 "Performance"):
- installs throwing stubs on `globalThis` for `requestAnimationFrame`, `setTimeout`, `setInterval` for the duration of a full press/release and show/close cycle on the fake driver (restored in `finally`); nothing throws;
- `ui.update(16)` returns `false` and calls nothing on the driver;
- one `tween()` per animated phase: a press/release records exactly `2` requests, a tweened show/close exactly `2`; `bindingArrays` for the same controller are the same array instance every time;
- `src/ui/**` static guard: read the five source files with `node:fs` and assert none contains `requestAnimationFrame`, `setTimeout`, `setInterval`, `performance.`, `Date.`, `window.`, `document.`, `navigator.`, or an import from `'pixi'`, `'three'`, `'gsap'`; and assert the only `../motion` / `../core` imports are `import type`.

**`docs/ARCHITECTURE.md`** — add a "UI Runtime" section after "Motion Runtime": module name `"ui"`, what it owns (button and modal-window lifecycles, blocking flag, `computeLayout`), the `UiMotionDriver` seam, the cancellation convergence (any registration order), and the `onHidden` / `onClosed` split. Also add `'ui'` to the `registerRuntime` example and the `getStats()` aggregate line in "Core Runtime".

**Commit:** `feat(ui): export public API and document UiRuntime`

## Task 11 — Full verification and self-review against the spec

**Depends on:** Task 10.

1. Fresh `npm test`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, `git status`.
2. Inspect `dist/index.d.ts` for every exported UI name and confirm `ButtonControllerImpl`/`WindowControllerImpl`/`UiHost` are absent.
3. `grep -rn "requestAnimationFrame\|setTimeout\|setInterval\|document\|window\.\|navigator\|pixi\|three\|gsap" src/ui` returns nothing; `grep -rn "^import " src/ui` shows only `import type` from `../motion/types` and `../core/CoreRuntime` and value imports within `src/ui`.
4. Re-read the diff against spec §6.1, §6.2, §7.5, §7.7, §8.3–8.5, §8.8, §9, §11, §12, §13, §14, §15.1 and record any deviation as a regression test plus a fix, then repeat step 1.
5. Confirm `git diff v0.2.0 -- src/core src/fx src/motion package.json` is empty.

No commit unless step 4 produced a fix (then `fix(ui): <what>`).

## Plan self-review (done before implementation starts)

1. **Spec coverage.** Every spec section maps to a task: §5 → Task 1 (types) + Task 2 (fake driver rules) + Task 9 (real driver); §6 → Tasks 2, 7, 8; §6.1 → Tasks 4, 6 (reentrancy tests) and the shared generation convention; §6.2/§9 → Task 7; §7.1–7.8 → Tasks 2–4; §8.1–8.9 → Tasks 5–6; §10 → Task 1; §11 → Tasks 8–9; §12 → Tasks 4, 6, 7; §13 → Task 8; §14 → Task 10; §15.1 → Task 10; §16 is post-implementation (not in this plan); §17 test matrix → every bullet appears in a task's test list; §18/§19 are satisfied by construction.
2. **Type/signature consistency.** Task 1's `types.ts` is copied from spec §5/§7.2/§8.2/§10.1/§12/§13 with no renamed field; `pointerUp(pointerId, x, y, inside)`, `close(reason, onClosed?)`, `cancel()` on both controllers, `setTapThreshold`, `WindowHiddenReason`, `forcedHides` all present.
3. **Cancellation semantics.** Both controllers converge on `cancel()`; the driver's `onCancel` with a current generation calls `cancel()`; `UiRuntime.cancelScope/cancelAll` call `cancel()`; `dispose()` calls `cancel()`; Task 9 proves both registration orders and the `N + M` return value.
4. **Reentrancy semantics.** Generation capture after the transition and comparison after every callback; `evaluatingClose` flag for nested `close()`; `finalizeHidden` reads the continuation before `onHidden` and checks `disposed` after; `recomputeBlocking()` always last. Tasks 4 and 6 test every case in spec §8.5 and §7.5.
5. **Blocking semantics.** Stored field, recompute after `onShow` and at the end of finalize/force-hide, `onClosed` before the final recompute; Task 7 tests both hand-over variants and the exception case.
6. **Public exports.** Task 10 lists spec §15.1 verbatim and the declaration test forbids the internal classes and `UiHost`.
7. **Performance constraints.** No per-frame work (`update` returns `false`), preallocated binding/array/request, no rest-parameter invokers on the progress path, Task 10's static guard and stub tests.
8. **No renderer dependencies.** Enforced by the module boundary rule, the static guard test, and the Node test environment.
9. **No ScreenController.** No task creates one; the export list contains none.
