# MotionRuntime v0.2 — Implementation Plan

- **Status:** Ready to implement. Not yet started — no `src/motion/**` exists yet.
- **Date:** 2026-09-15
- **Branch:** `feat/motion-runtime` (created from `main` / tag `v0.1.0`, commit `5a7d0b4`)
- **Spec this plan implements:** [`docs/superpowers/specs/2026-09-15-motion-runtime-v0.2-design.md`](../specs/2026-09-15-motion-runtime-v0.2-design.md) — approved, do not deviate from it. If anything below appears to conflict with that spec, the spec wins; stop and raise it rather than silently resolving it differently than this plan says.

This plan is self-contained. It does not assume the reader has seen any prior discussion about MotionRuntime. Read the spec above once, then this plan is sufficient on its own to implement, task by task, in order.

**Explicitly out of scope for this plan** (do not do these as part of implementing it):
- Any change inside `word_tide/`, `trail_arrow/`, or `reference-vlad-bubbles/`.
- Migrating any real Twin Arrow UI code (Button, windows) to MotionRuntime — that is a separate, later, bounded integration plan.
- Running `npm run sync:word-tide` — word_tide keeps the game-core build it already has until a deliberate, separate release decision is made.
- Anything listed in spec §17 ("Out of scope for v0.2").

## Conventions used by every task below

**The TDD loop.** Every task follows exactly this sequence, with its own commit at the end:

1. Write the concrete failing test(s) listed under that task, in the exact file the task names.
2. Run `npx vitest run <path-to-the-new-or-changed-test-file>` and confirm they fail for the expected reason (missing export / not-yet-implemented behavior) — not for an unrelated syntax error.
3. Implement the minimal code that makes them pass — no more than what that task's "Implement" section describes.
4. Run `npm test` (the full suite, not just the new file) and confirm everything passes, including every pre-existing test.
5. Run `npx tsc --noEmit` and confirm no errors.
6. Commit with exactly the message given under that task's "Commit" heading, then move to the next task.

Do not batch multiple tasks into one commit. Do not leave a task partially done across a commit boundary.

**TypeScript strictness (from `tsconfig.json`, already governing this whole package — nothing new to configure):**
- `strict: true`, `exactOptionalPropertyTypes: true`: an optional field (`foo?: number`) must be *absent* when not set, never explicitly assigned `undefined`. Follow the existing pattern already used throughout `src/fx/FxRuntime.ts`, e.g. `if (options.scope !== undefined) effect.scope = options.scope;` rather than an unconditional assignment. Do this everywhere a `MotionTweenOptions`-style optional field is copied into an internal record.
- `noUncheckedIndexedAccess: true`: indexing an array or object (`bindings[i]`, `steps[i]`) yields `T | undefined`. Prefer `for...of` iteration over indexed loops where the code doesn't need the index; where an index is needed, check for `undefined` or use `.at()`-with-check before use.

**Directory/module boundary rule (from spec §13):** nothing under `src/motion/**` imports from `src/fx/**`, and nothing under `src/fx/**` imports from `src/motion/**`. Any formula or pattern that happens to resemble something in `src/fx/*` (e.g. an easing curve, the callback-error-catching shape) is *independently re-stated* in `src/motion/*`, not imported. This plan calls out every place this applies.

**Naming already fixed by this plan (do not rename mid-implementation):**
- Package/class: `MotionRuntime`, not generic (no `<TNode>` type parameter — unlike `FxRuntime<TNode>`, `MotionRuntime` never touches a host node type; a `MotionBinding`'s `get`/`set` closures fully encapsulate whatever object they close over).
- File layout:
  ```
  src/motion/types.ts
  src/motion/easing.ts
  src/motion/MotionSequenceRunner.ts   (internal only, never exported)
  src/motion/MotionRuntime.ts
  tests/motion/easing.test.ts
  tests/motion/tween.test.ts
  tests/motion/delay.test.ts
  tests/motion/sequence.test.ts
  tests/motion/scopes.test.ts
  tests/motion/stats.test.ts
  ```
  This deviates from the plan's own suggested baseline (one `MotionRuntime.test.ts`) by splitting runtime tests into one file per concern instead of one large file. Justification: `tests/fx/` already does exactly this today (`FxRuntime.test.ts`, `FxPool.test.ts`, `trajectories.test.ts` are three separate files for one runtime) — this plan follows that existing precedent instead of introducing a second, different convention.

## Task 1 — Public types + easing primitives

**Depends on:** nothing (first task).

**Files created:**
- `src/motion/types.ts`
- `src/motion/easing.ts`
- `tests/motion/easing.test.ts`

**Files changed:** none.

**Public types to define in `src/motion/types.ts`:**

```ts
export type MotionScope = string;

export type EaseName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'backOut';
export type EaseFn = (t: number) => number;

export interface MotionBinding {
  get(): number;
  set(value: number): void;
  to: number;
  from?: number;
}

export type MotionUpdateCallback = (progress: number) => void;
export type MotionCompleteCallback = () => void;
export type MotionCancelCallback = () => void;

export interface MotionHandle {
  cancel(): boolean;
  pause(): boolean;
  resume(): boolean;
  readonly active: boolean;
  readonly paused: boolean;
}

export interface MotionTweenOptions {
  bindings: MotionBinding[];
  durationMs: number;
  delayMs?: number;
  ease?: EaseName | EaseFn;
  scope?: MotionScope;
  repeat?: number; // 0 = one pass (default); a finite N = N extra passes after the first; Infinity = unbounded
  yoyo?: boolean;
  onUpdate?: MotionUpdateCallback;
  onComplete?: MotionCompleteCallback;
  onCancel?: MotionCancelCallback;
}

export interface MotionDelayOptions {
  durationMs: number;
  scope?: MotionScope;
  onComplete?: MotionCompleteCallback;
  onCancel?: MotionCancelCallback;
}

export type MotionSequenceStep =
  | ({ type: 'tween' } & Omit<MotionTweenOptions, 'scope'>)
  | ({ type: 'delay' } & Omit<MotionDelayOptions, 'scope'>);

export interface MotionSequenceOptions {
  scope?: MotionScope;
  steps: MotionSequenceStep[];
  onComplete?: MotionCompleteCallback;
  onCancel?: MotionCancelCallback;
}

export type MotionErrorPhase = 'onUpdate' | 'onComplete' | 'onCancel' | 'binding-get' | 'binding-set';

export interface MotionErrorContext {
  kind: 'tween' | 'delay' | 'sequence';
  phase: MotionErrorPhase;
}

export type MotionErrorHandler = (error: unknown, context: MotionErrorContext) => void;

export interface MotionRuntimeStats {
  activeMotions: number;
  activeTweens: number;
  activeDelays: number;
  activeSequences: number;
  pausedMotions: number;
  completedMotions: number;
  cancelledMotions: number;
  lastUpdateMs: number;
  maxUpdateMs: number;
  callbackErrors: number;
  bindingErrors: number;
}

export interface MotionRuntimeOptions {
  onMotionError?: MotionErrorHandler;
}
```

**Interpretation notes fixed by the above (the spec's example snippets used `...`/no-`?` shorthand; these are the concrete, unambiguous choices this plan commits to — flag them for confirmation if you disagree, but implement exactly this unless told otherwise):**
- `scope`, `onComplete`, `onCancel` on `motion.sequence(...)` are all **optional**, matching the optionality already established for `tween`/`delay`'s own same-named fields. The spec's own example omitted `?` marks because it was written as a call-site example, not a type signature.
- A sequence step's own type is `motion.tween()`'s/`motion.delay()`'s option type **minus `scope`** (enforced at the type level via `Omit`), matching the spec §6 clarification that a step's scope is never used — this makes passing one a compile error instead of a silent no-op.
- `onComplete`/`onCancel` in `MotionSequenceStep`'s tween/delay variants fire for **that step individually** (e.g. a step's own `onComplete` fires when that step finishes and the sequence moves to the next one) — independent of the sequence's own outer `onComplete`, which fires only once, when the whole sequence finishes.
- `onComplete`/`onCancel` take no arguments. The spec only gave an explicit signature for `onUpdate` (`(progress: number) => void`); nothing in the spec's prose describes payload data for `onComplete`/`onCancel`, so none is invented.

**Easing implementation in `src/motion/easing.ts`:**

```ts
export function clamp01(t: number): number { /* same shape as src/fx/easing.ts's clamp01 — independently re-declared here, not imported */ }
export function linear(t: number): number;      // clamp01(t)
export function easeIn(t: number): number;       // t*t*t (cubic)
export function easeOut(t: number): number;      // 1 - (1-t)^3 (cubic)
export function easeInOut(t: number): number;    // t<0.5 ? 4*t*t*t : 1-((-2*t+2)**3)/2 (cubic)
export function backOut(t: number): number;      // 1 + c3*(t-1)^3 + c1*(t-1)^2, c1=1.35, c3=2.35
export function resolveEase(ease: EaseName | EaseFn | undefined): EaseFn;
```

Interpretation note: the spec names five built-in eases but does not name a curve family for `easeIn`/`easeOut`/`easeInOut`, or an overshoot constant for `backOut`. This plan picks **cubic** curves and the **same 1.35 overshoot constant** `src/fx/easing.ts` already uses for `easeOutBackLite` — not by importing that file (forbidden per the module-boundary rule above), but by independently re-deriving the same well-tested formula. This keeps one game-core-wide "feel" for a back-ease without creating a dependency between the two runtimes. Flag this for confirmation if a different curve family was intended.

`resolveEase`: if given a function, return it as-is (identity — do not wrap it). If given a name, return the matching built-in. If `undefined`, return `linear`.

**Tests to write first, in `tests/motion/easing.test.ts`:**

```ts
linear(0) === 0
linear(1) === 1
linear(0.5) === 0.5
linear(-1) === 0          // clamps below range
linear(2) === 1           // clamps above range

easeIn(0) === 0
easeIn(1) === 1
easeIn(0.5) === 0.125      // 0.5^3

easeOut(0) === 0
easeOut(1) === 1
easeOut(0.5) === 0.875     // 1 - 0.5^3

easeInOut(0) === 0
easeInOut(1) === 1
easeInOut(0.5) === 0.5     // symmetric curve, midpoint maps to midpoint

backOut(0) === 0           // exact endpoint, despite overshoot mid-curve
backOut(1) === 1           // exact endpoint

resolveEase(undefined) === linear                       // by reference
const custom = (t: number) => t * 2;
resolveEase(custom) === custom                            // returned as-is, not wrapped
resolveEase('easeIn')(0.5) === easeIn(0.5)
resolveEase('easeOut')(0.5) === easeOut(0.5)
resolveEase('easeInOut')(0.5) === easeInOut(0.5)
resolveEase('backOut')(0.5) === backOut(0.5)
resolveEase('linear')(0.5) === linear(0.5)
```

(`toBeCloseTo` for the floating-point `backOut` intermediate values is fine; the values shown above for `linear`/`easeIn`/`easeOut`/`easeInOut` are exact and should use `toBe`.)

**Verification:** `npx vitest run tests/motion/easing.test.ts` (fails: module doesn't exist yet) → implement → `npm test` → `npx tsc --noEmit`.

**Commit:** `feat(motion): add public types and easing primitives`

## Task 2 — Basic tween lifecycle (no repeat/yoyo, no error isolation yet)

**Depends on:** Task 1.

**Files created:**
- `src/motion/MotionRuntime.ts`
- `tests/motion/tween.test.ts`

**Files changed:** none.

**What this task deliberately does NOT implement yet** (later tasks add it on top of this one — do not build ahead):
- `repeat`/`yoyo` behavior: a tween always runs exactly one pass. (Task 3.)
- Binding/callback exception isolation: assume `get`/`set`/callbacks never throw. (Task 4.)
- `delay()`, `sequence()`, scopes, stats, `pauseScope`/`resumeScope`: don't exist on the class yet.

**Public shape introduced on `MotionRuntime`:**

```ts
export class MotionRuntime {
  constructor(options?: MotionRuntimeOptions);
  tween(options: MotionTweenOptions): MotionHandle;
  update(frameMs: number): boolean;
}
```

**Internal model (mirror `src/fx/FxRuntime.ts`'s already-proven shape — same idea, independently written, not imported):**

- `private readonly operations = new Map<number, RuntimeTween>()`, `private nextId = 1`.
- A `RuntimeTween` record holds: `id`, `kind: 'tween'` (tag this from the start, even though the discriminated union it tags isn't needed until Task 5 — mirrors `FxRuntime`'s own `ProjectileEffect`/`RadialBurstParticleEffect`, which are tagged with `kind` from their first introduction too), `elapsedMs`, `delayMs`, `durationMs`, `started: boolean` (has the leading `delayMs` elapsed — same `elapsedMs - delayMs < 0 → not started yet` pattern `FxRuntime.update()` already uses), `paused: boolean` (see the pause/resume bullet below), `bindingSpecs: MotionBinding[]`, `resolvedFrom: number[] | null` (`null` until the tween's first real start, see below), `ease: EaseFn`, `onUpdate?`, `onComplete?`, `onCancel?` (needed already in this task — `cancel()` below fires it).
- `tween(options)`: validate/normalize (`durationMs` finite and `> 0` — if not, treat as `1`, same defensive pattern `FxRuntime.addProjectile` uses via its own `finiteOr` helper, independently re-declared here), resolve `ease` via `resolveEase`, store the raw `bindings` array as given (do **not** resolve `from` yet if any binding omits it), insert into `operations`, return a handle (see below). Do not call any binding's `get()`/`set()` yet if `delayMs > 0`.
- `update(frameMs)`: for each operation (via `for (const op of this.operations.values())`, no array copy): `op.elapsedMs += deltaMs`; if `op.elapsedMs - op.delayMs < 0`, skip (still in leading delay, exactly like `FxRuntime`'s own `localMs < 0 → continue`); on the **first** frame where it's no longer skipped, if `op.resolvedFrom === null`, resolve it now: for each binding, `binding.from !== undefined ? binding.from : binding.get()` — this is the exact moment "the tween actually starts" per spec §2, and it happens only once. Compute `progress = clamp01(localMs / op.durationMs)`, `eased = op.ease(progress)`; for each binding index `i`, compute `value = lerp(resolvedFrom[i], binding.to, eased)` and call `binding.set(value)`. After all bindings are set for this frame, call `op.onUpdate?.(progress)` (raw, un-eased `progress`, per spec §10). If `progress >= 1`: for each binding, call `binding.set(binding.to)` one more time (exact final value, per spec §7 — the last eased `set()` above may not land exactly on `to` depending on the ease curve, so this final hard-set is required, not redundant), call `op.onComplete?.()` once, remove the operation from the map.
- Handle: `{ cancel(), pause(), resume(), get active(), get paused() }` closing over `id` and `this`. `cancel()`: if not in `operations`, return `false`; otherwise remove it and return `true` (no `onCancel` wiring yet — that's Task 2 too, actually: `onCancel` firing IS part of "cancel exactly once" from spec §7, which belongs in this task, not Task 4 — Task 4 only adds *exception isolation around* firing it). So: `cancel()` removes the operation and, if `resolvedFrom !== null` and an `onCancel` was given, calls it — but if the tween was cancelled before it ever started (`resolvedFrom === null`, still mid-`delayMs`), still fire `onCancel` if present (cancelling a not-yet-started tween is still a cancel, not a no-op). Bindings are left untouched on cancel (no `set()` call at all) — "no jump-to-end" per spec §7.
- `active`/`paused` getters read a `paused: boolean` field on the record and whether the id is still in `operations`.
- `pause()`/`resume()`: add a `paused: boolean` field to `RuntimeTween` (default `false`). `update()` must skip advancing `elapsedMs` entirely for a paused operation (check `op.paused` first, `continue` before touching `elapsedMs`). `pause()` sets `paused = true` and returns `true` only if it was `false` before (idempotent, mirrors `FxEffectHandle.cancel()`'s already-cancelled → `false` convention). `resume()` mirrors that in the other direction.

**Tests to write first, in `tests/motion/tween.test.ts`:**

```
- interpolation correctness: 1 binding, from:0 to:100 durationMs:100, no ease (linear default);
  update(50) → binding value is 50.
- exact final value: same tween; update(100) → binding value is EXACTLY 100 (assert with toBe, not toBeCloseTo).
- explicit `from`: binding.get() returns 999 (a decoy value the tween must NOT use); from:20, to:100,
  durationMs:100; update(50) → value is 60 ((20+100)/2), proving `from` was used as given, get() ignored.
- implicit `from`, resolved at actual start after delay: binding with NO `from`; get() reads a mutable
  outer variable currently 0; after calling motion.tween({..., delayMs: 50, durationMs: 100}), change the
  outer variable to 40 BEFORE calling update(); call update(50) (consumes exactly the delay — resolution
  must happen now, reading the CURRENT value 40, not 0); call update(50) again (now at full duration) →
  binding value is 100 (the tween's `to`), and re-derive that the midpoint of the actual interpolation used
  40 as its start by checking an update(25) call lands on 70 ((40+100)/2) when done as a separate test case
  with fresh state.
- custom EaseFn: ease: (t) => t (explicit identity, even though default is already linear) →
  same numeric result as the "interpolation correctness" case, proving a supplied function is honored.
- built-in ease each of the 5 names: for each, motion.tween({..., ease: name}) at update() calls that land
  exactly on progress 0.5 produces the same binding value as resolveEase(name)(0.5) applied by hand to
  lerp(from, to, ·) — cross-checks Task 1's easing module through the public tween() API.
- onUpdate receives raw progress: ease: 'easeIn' (cubic, non-linear); durationMs: 100; update(50) →
  onUpdate was called with progress === 0.5 (raw), while the binding's value reflects easeIn(0.5) = 0.125
  of the from→to span, not 0.5 of it.
- onUpdate fires after this frame's binding value is applied: inside the onUpdate callback, read the
  binding's own get() and assert it already reflects this frame's new value.
- completes exactly once: onComplete counter; update(100) then update(50) again (nothing left to complete) →
  counter is 1.
- cancels exactly once: handle.cancel() → onCancel counter is 1; binding value is whatever it was at the
  moment of cancel (not the `to` value) — assert it did NOT jump to `to`.
- double cancel: handle.cancel() twice → second call returns false, onCancel counter stays 1.
- pause/resume: update(50) (halfway), handle.pause(), update(1000) (many frames) → binding value unchanged
  from the halfway value; handle.resume(), update(50) → value now reflects 100ms of total elapsed progress
  (halfway + this 50ms), not 1050ms.
- pause()/resume() return values: pause() on an active tween returns true; pause() again returns false;
  resume() returns true; resume() again returns false.
- handle.active / handle.paused reflect state through create → pause → resume → cancel.
```

**Verification:** `npx vitest run tests/motion/tween.test.ts` (fails: `MotionRuntime` doesn't exist) → implement → `npm test` → `npx tsc --noEmit`.

**Commit:** `feat(motion): implement basic tween lifecycle`

## Task 3 — repeat / yoyo

**Depends on:** Task 2.

**Files changed:** `src/motion/MotionRuntime.ts`, `tests/motion/tween.test.ts` (append; do not restructure Task 2's existing cases).

**Internal model additions to `RuntimeTween`:** `repeat: number` (normalized: `Number.isFinite(options.repeat) ? Math.max(0, Math.floor(options.repeat)) : Infinity` if `repeat` is `Infinity`, else default `0`), `yoyo: boolean`, `passIndex: number` (starts `0`), `direction: 1 | -1` (starts `1`).

**Behavior:** when a pass reaches `progress >= 1`:
- If `op.yoyo` is true, the *next* pass interpolates in the opposite direction: swap which of `resolvedFrom`/`to` is the start vs. end for that pass by flipping `op.direction` (`1` → `-1` or back), rather than re-deriving anything from `get()`. Concretely: the value used each frame is `lerp(op.direction === 1 ? resolvedFrom[i] : bindingTo[i], op.direction === 1 ? bindingTo[i] : resolvedFrom[i], eased)` — i.e. `resolvedFrom`/`to` never change after their one-time resolution (Task 2); only which one plays the role of "this pass's start" flips.
- If `op.passIndex < op.repeat` (or `op.repeat === Infinity`): increment `op.passIndex`, reset this pass's local elapsed accounting (`op.elapsedMs -= op.delayMs + op.durationMs` if overshoot needs distributing into the next pass in the same `update()` call — or simply clamp and let the next `update()` call continue; pick whichever keeps the "no per-frame allocation" rule from spec §16 and is simplest — a clamp-and-continue-next-frame approach is acceptable and simpler), and do **not** fire `onComplete` or remove the operation yet.
- Only when the pass that just finished has `passIndex === op.repeat` (finite case) does normal completion (spec §7, exactly as Task 2 built it: final hard-`set()` to the *current pass's* end value, `onComplete` once, removal) happen. `repeat: Infinity` never completes naturally — only `cancel()`/scope-cancel/a binding or callback error (Task 4) removes it.

**Tests to append to `tests/motion/tween.test.ts`:**

```
- repeat: 0 behaves exactly like Task 2 (one pass, completes normally) — regression guard.
- repeat: 2 → binding reaches `to` exactly 3 times across 3 passes' worth of update() calls, and onComplete
  fires exactly once total (after the 3rd), not once per pass.
- repeat: Infinity → after many passes' worth of update() calls, the operation is still `active`
  (never auto-completes); onComplete has never fired; cancel() still works and fires onCancel exactly once.
- yoyo: true with repeat: 1 → pass 0 goes from→to, pass 1 goes to→from; assert the binding's value at the
  midpoint of pass 1 is the same as at the midpoint of pass 0 (both are the arithmetic midpoint of the same
  from/to pair), and assert the value at the END of pass 1 equals `from`, not `to`.
- yoyo endpoints are fixed across passes: give a binding whose get() would return a DIFFERENT value if
  called again (change the outer mutable variable between pass 0 and pass 1) — assert pass 1's math still
  uses the ORIGINAL resolved `from`, proving get() is never called again after the first real start.
- onUpdate's raw progress resets to the [0,1] range fresh at the start of each new pass (not a
  monotonically increasing [0, repeat+1] range).
```

**Verification:** append tests first → `npx vitest run tests/motion/tween.test.ts` (new cases fail) → implement → `npm test` → `npx tsc --noEmit`.

**Commit:** `feat(motion): implement repeat/yoyo semantics`

## Task 4 — Binding and callback error isolation

**Depends on:** Task 2 (does not depend on Task 3; repeat/yoyo and error isolation are independent extensions of the same base, done in this order only for a single linear read-through).

**Files changed:** `src/motion/MotionRuntime.ts`, `tests/motion/tween.test.ts` (append).

**Internal additions:**
- Constructor stores `private readonly onMotionError: MotionErrorHandler = options?.onMotionError ?? defaultOnMotionError`, where `defaultOnMotionError` is a module-level function that does `console.error('[MotionRuntime] ...', context, error)` guarded in its own `try/catch` — same shape as `FxRuntime.ts`'s `defaultOnEffectError`, independently re-declared (module boundary rule).
- A private `invokeCallback(fn, phase, kind)` helper: if `fn` is undefined, no-op; otherwise call it inside `try/catch`; on catch, increment the `callbackErrors` counter (Task 8 wires the counter fields; this task can add the field to the stats-tracking state now even though `getStats()` itself is finished in Task 8 — or, simpler: add a private counter field now, expose it via `getStats()` in Task 8; either is fine, but do not build `getStats()` itself yet) and call `reportError(error, { kind, phase })` through `onMotionError`, itself wrapped in its own `try/catch` (an error handler must never propagate — same double-guard `FxRuntime.reportEffectError` already uses).
- `update()`'s per-frame `onUpdate` invocation and the completion path's `onComplete` invocation both go through `invokeCallback` now, instead of being called directly. A throwing `onUpdate` does **not** cancel the tween (per spec §10) — the loop continues to the next operation and this same operation keeps running on later frames. A throwing `onComplete` does **not** prevent the operation's removal from the map (cleanup still happens — call `invokeCallback` for `onComplete` *before* removing from the map, but the removal itself is unconditional code that runs regardless of whether the callback threw, exactly mirroring `FxRuntime.update()`'s own comment: "Callbacks above never throw past invokeEffectCallback, so cleanup below always runs").
- `cancel()`'s `onCancel` invocation goes through `invokeCallback` too, for the same reason.
- Binding access: wrap every `binding.get()` and `binding.set(value)` call in the per-frame loop (both the resolve-`from` read and the per-frame interpolated write, and the final-value write on completion) in `try/catch`. On catch: increment a `bindingErrors` counter, report through `onMotionError` with `phase: 'binding-get'` or `'binding-set'` as appropriate, and then run the **same cleanup path a `cancel()` triggers**: remove the operation from the map, fire `onCancel` (via `invokeCallback`, so if `onCancel` *itself* throws that's caught too), and do **not** fire `onComplete`. If more than one binding on the same operation would throw in the same frame, only the first is reported and the operation is cancelled once (it's already removed from the map by the time the loop would reach a second failing binding, because — mirroring `FxRuntime`'s own pattern — bindings for one operation are processed in an inner loop that should check for an already-removed operation, or simpler: break out of the inner per-binding loop immediately on the first binding error for that operation).

**Tests to append to `tests/motion/tween.test.ts`:**

```
- binding.get() throws (during implicit-from resolution) → the operation is cancelled: onCancel fires
  exactly once, onComplete never fires, error is reported via a custom onMotionError handler with
  phase: 'binding-get'.
- binding.set() throws (during a normal per-frame write) → same cancellation/report shape, phase: 'binding-set'.
- a failing motion does not affect a second, healthy motion registered at the same time: after one
  update() call where the first motion's binding throws, assert the second motion's binding value still
  advanced normally in that same update() call, and that update() itself did not throw.
- the runtime keeps updating on later frames after an isolated failure: call update() again after the
  failure and assert the healthy motion keeps progressing.
- onUpdate throws → reported (phase: 'onUpdate'), operation is NOT cancelled — update() called again later
  shows the binding value continuing to advance past where it was when onUpdate threw.
- onComplete throws → the operation is still removed (assert a second update() call after this does not
  invoke onComplete again — proving cleanup happened despite the throw); error reported with phase: 'onComplete'.
- onCancel throws (explicit cancel() path) → cancel() still returns true, the operation is still removed
  (assert getStats-adjacent state via re-cancelling returns false, proving it's gone) — full getStats
  assertions belong to Task 8, but the "handle is gone" behavior must be provable here without it, e.g. via
  a second cancel() call returning false; error reported with phase: 'onCancel'.
- the error handler itself throws → does not escape update()/cancel() (wrap the call to update()/cancel()
  in an assertion that it does not throw), and does not prevent the rest of the runtime from working.
- default handler (no onMotionError given in the constructor): spy on console.error, trigger a binding
  error, assert console.error was called.
```

**Verification:** as above.

**Commit:** `feat(motion): isolate binding and callback errors`

## Task 5 — Standalone delay

**Depends on:** Task 4 (reuses the same operation-registry, id-allocation, and `invokeCallback`/error-reporting scaffolding built for tween).

**Files changed:** `src/motion/MotionRuntime.ts`.
**Files created:** `tests/motion/delay.test.ts`.

**Public shape added:**

```ts
delay(options: MotionDelayOptions): MotionHandle;
```

**Internal model:** a `RuntimeDelay` record: `id`, `kind: 'delay'`, `elapsedMs`, `durationMs`, `paused`, `onComplete?`, `onCancel?`, `scope?`. No bindings, no ease, no repeat/yoyo (matches spec §5's option shape exactly — do not add fields beyond what's listed there). Stored in the **same** `operations` map as tweens (`RuntimeOperation = RuntimeTween | RuntimeDelay` becomes a discriminated union on `kind`, matching the tag each variant already carries) so `update()`'s single loop drives both kinds without a second loop or a second map (this also directly sets up Task 8's `activeTweens`/`activeDelays` split, which is a simple `kind`-based tally over the one map).

`update()`'s per-operation body branches on `op.kind`: the delay case is simpler than tween — no bindings, no easing; `progress = clamp01(op.elapsedMs / op.durationMs)`; on `progress >= 1`, fire `onComplete` (via `invokeCallback`) and remove. Pause/resume/cancel reuse exactly the same handle-shape code Task 2 built (parameterize the existing `createHandle`-equivalent over `RuntimeOperation`, not just `RuntimeTween`, if Task 2's implementation was tween-specific — this is a small refactor of Task 2/4's own handle-creation code to operate on the union type; it must not change Task 2's/Task 4's already-passing tests' behavior).

**Tests to write first, in `tests/motion/delay.test.ts`:**

```
- completion: durationMs: 100; update(100) → onComplete fires exactly once; update(100) again → still
  exactly once (not twice).
- pause/resume: update(50), pause(), update(1000) (no completion despite far exceeding durationMs),
  resume(), update(50) → completes now (50 + 50 = 100 total elapsed while active).
- cancel: cancel() → onCancel fires exactly once, onComplete never fires; double cancel() returns false
  the second time.
- scope cancellation: motion.delay({ durationMs: 100, scope: 'x' }); motion.cancelScope('x') is not
  implemented until Task 7 — so this specific case is written here but marked to run only once Task 7
  lands; alternatively, defer this one assertion into tests/motion/scopes.test.ts (Task 7) instead of here,
  and keep this file's own cancel test to the plain handle.cancel() case above. Do the latter: keep
  scope-specific delay behavior entirely in Task 7's test file, so this file never depends on unfinished
  future work.
```

**Verification:** as above, run against `tests/motion/delay.test.ts` plus the full suite for regressions.

**Commit:** `feat(motion): implement standalone delay`

## Task 6 — Sequence (tween/delay steps)

**Depends on:** Task 3 (a step may use repeat/yoyo) and Task 5 (needs both tween and delay machinery to exist).

**Files created:**
- `src/motion/MotionSequenceRunner.ts` (internal only — not exported from `src/index.ts`, ever)
- `tests/motion/sequence.test.ts`

**Files changed:** `src/motion/MotionRuntime.ts`.

**Why a separate internal file:** `MotionRuntime.ts` already holds the tween/delay scheduling loop, error isolation, and handle creation after Tasks 2–5. Sequence orchestration (which step is current, advancing to the next one, propagating cancel into whichever step is running) is a distinct state machine on top of that, not an extension of the per-frame numeric loop — keeping it in its own file avoids `MotionRuntime.ts` mixing "how one tween/delay advances" with "how a sequence of them is orchestrated."

**Design (internal, not public API):**

- A `RuntimeSequence` record holds: `id`, `kind: 'sequence'`, `paused: boolean`, `scope?`, `steps: MotionSequenceStep[]`, `currentStepIndex: number` (starts `0`), `currentStepOperation: RuntimeTween | RuntimeDelay | null` (the live, currently-advancing step; built lazily — see below), `onComplete?`, `onCancel?`. It carries no `elapsedMs`/`durationMs` of its own — those live on whichever step is current.
- `src/motion/MotionSequenceRunner.ts` exports one plain function, not a class: `advanceSequence(sequence: RuntimeSequence, deltaMs: number, host: SequenceHost): 'running' | 'completed' | 'cancelled'`. `SequenceHost` is a small internal interface `MotionRuntime` implements (passed in as `host` by `MotionRuntime.update()` when it calls this for a `RuntimeSequence` entry), exposing exactly the primitives a step needs without exposing `MotionRuntime`'s full private surface or creating a circular import: `advanceTweenFrame(tween: RuntimeTween, deltaMs: number): 'running' | 'completed' | 'cancelled'`, `advanceDelayFrame(delay: RuntimeDelay, deltaMs: number): 'running' | 'completed' | 'cancelled'`, `buildStepOperation(step: MotionSequenceStep): RuntimeTween | RuntimeDelay`, `invokeCallback(fn, phase, kind): void` (Task 4's helper). `advanceTweenFrame`/`advanceDelayFrame` are the exact same per-frame math Tasks 2/3/4 and 5 already built for a top-level tween/delay, refactored (in this task) out of the inline loop body in `update()` into these two named methods so both the top-level loop and `advanceSequence` call the identical implementation — **the numeric tween/delay math is defined exactly once**, never duplicated into `MotionSequenceRunner.ts`.
- `advanceSequence` builds the *current* step's `RuntimeTween`/`RuntimeDelay` record via `host.buildStepOperation(step)` (same shape Tasks 2/5 already defined) but **never inserts it into `MotionRuntime`'s own top-level `operations` map** — it is held only as `sequence.currentStepOperation`. This is what makes the spec's approved stats clarification true "for free": `activeTweens`/`activeDelays` (a tally over the top-level map) never sees a sequence's internal step, because it was never inserted there; only `activeSequences` counts the one `RuntimeSequence`.
- `MotionRuntime.update()` treats a `RuntimeSequence` (a third variant added to the `RuntimeOperation` union, tagged `kind: 'sequence'`) as one more entry in its single per-frame loop; for a sequence entry, it calls `advanceSequence(sequence, deltaMs, this)` (passing itself as the `SequenceHost`), which drives the current step and returns whether the *sequence* completed, is still running, or was cancelled from within (a binding/callback error inside the current step cancels that step, which per this task's rules also cancels the whole sequence — see below). `MotionRuntime.update()` reacts to `'completed'`/`'cancelled'` by removing the sequence from its own top-level map (same as it already does for a completed/cancelled top-level tween/delay) — `advanceSequence` itself never touches the top-level map.
- Step transition: when the current step's own `advanceTweenFrame`/`advanceDelayFrame` call returns `'completed'`, `advanceSequence` builds the *next* `steps[index + 1]` entry (if any) via `host.buildStepOperation` and continues; if there is no next step, the sequence as a whole completes: fire the sequence's own `onComplete` (via `host.invokeCallback`) and return `'completed'` to `MotionRuntime.update()`.
- Sequence-level `cancel()`: cancel whatever step is *currently* running using that step's own single-operation cancel path (its own `onCancel` fires if it has one, its bindings are left as-is — no jump), then fire the sequence's own `onCancel` once, then remove the sequence from the top-level map. **No later step is ever built or started.**
- Sequence-level `pause()`/`resume()`: forwarded to whichever step is current (the current step's own `paused` flag is toggled); a step that hasn't started yet (steps not-yet-reached) has no state to pause, so nothing extra is needed there.
- A binding or callback error inside the current step (Task 4's isolation) cancels that step (as Task 4 already defines) — for a sequence specifically, that also means the *whole sequence* is cancelled the same way an explicit `cancel()` would: the sequence's own `onCancel` fires once, no next step starts, the sequence's own `onComplete` never fires. (This is the natural extension of "operation cancelled" from Task 4 applied to a step that happens to be sequence-owned rather than top-level.)

**Public shape added to `MotionRuntime`:**

```ts
sequence(options: MotionSequenceOptions): MotionHandle;
```

**Tests to write first, in `tests/motion/sequence.test.ts`:**

```
- ordered steps: 3 steps — tween, delay(100ms), tween — each step's own onComplete pushes its index into an
  order[] array; drive update() through the whole sequence; assert order === [0, 1, 2].
- a delay step blocks the following tween step: assert the third step's binding is never touched (its
  set() is a spy) until enough update() calls have consumed the middle delay step's full durationMs.
- cancelling mid-step: cancel() while step index 1 (the delay) is running → step 1's own onCancel (if
  given) fires, the sequence's own onCancel fires exactly once, the sequence's own onComplete never fires.
- no later step starts after cancel: after the cancel above, assert step 2's tween binding's set() spy was
  never called, even after further update() calls (the sequence is gone; further update() calls have
  nothing left to advance).
- sequence onComplete fires exactly once: run all 3 steps to completion; onComplete counter is 1 even after
  an extra update() call afterward.
- sequence onCancel fires exactly once; double-cancel of the sequence handle returns false the second time.
- stats isolation (the approved clarification, must be directly asserted here even though Task 8 finishes
  getStats(): while the sequence's tween step is currently running, getStats().activeTweens is 0 and
  getStats().activeSequences is 1 — proving the step never registers as a top-level tween. (If Task 8 has
  not landed yet when this test is first written, write this assertion anyway — Task 8 must make it pass
  without needing to revisit this test's expectations.)
- no repeat/yoyo field exists on `motion.sequence()`'s own options at the type level (this is a compile-time
  guarantee, not a runtime test — confirmed instead by `npx tsc --noEmit` rejecting a test file that tries
  to pass `repeat` to `motion.sequence({...})` directly; do not write a runtime test for this, a type-level
  check is the correct verification here).
```

**Verification:** as above.

**Commit:** `feat(motion): implement sequence (tween/delay steps)`

## Task 7 — Scopes and dispose

**Depends on:** Task 6 (exercises scope behavior across tween, delay, and sequence together).

**Files changed:** `src/motion/MotionRuntime.ts`, `tests/motion/delay.test.ts` (add the one deferred scope-cancel case from Task 5, per that task's note).
**Files created:** `tests/motion/scopes.test.ts`.

**Public shape added:**

```ts
cancelScope(scope: string): number;
cancelAll(): number;
pauseScope(scope: string): number;
resumeScope(scope: string): number;
dispose(): void;
```

`dispose()` belongs here (not its own task) because it is defined as `cancelAll()` plus nothing else: unlike `FxRuntime.dispose()`, which also tears down pool-owned render nodes, `MotionRuntime` owns no persistent resources beyond its own `operations` map — `cancelAll()` already empties that and fires every `onCancel`. `dispose()` exists as its own named method (rather than telling callers to just call `cancelAll()`) because spec §14 names it explicitly as one of the methods `CoreRuntime`'s outer error-boundary layer must guard against ("if `MotionRuntime.update`/`cancelScope`/`cancelAll`/`pauseScope`/`resumeScope`/`dispose` itself throws unexpectedly"), and because it is one of `CoreRuntimeModule`'s existing optional methods (`dispose?(): void`) — a registered `"motion"` module should implement it, exactly like `FxRuntime` does today.

**Implementation:** all four iterate the single top-level `operations` map (`Array.from(this.operations.values())` for the cancel variants, exactly mirroring `FxRuntime.cancelScope`/`cancelAll`'s existing reentrancy-safe pattern — snapshot the values first, then check `this.operations.has(id)` before acting on each, so an operation cancelled reentrantly from inside another's callback during the same pass is a safe no-op instead of being processed twice). A `RuntimeSequence`'s `scope` is its own top-level `scope` field (never a step's, per Task 1's clarification) — cancelling/pausing/resuming by scope acts on the whole sequence, which internally cancels/pauses/resumes whatever step is current (reusing Task 6's own sequence-level cancel/pause/resume).

- `cancelScope(scope)`: for each operation whose `scope === scope`, run the same single-operation cancel path Tasks 2/5/6 already built (`onCancel` fires, no jump, removed); return the count actually cancelled.
- `cancelAll()`: same, unfiltered by scope, over every operation.
- `pauseScope(scope)`: for each operation whose `scope === scope` and not already paused, set `paused = true`; return the count actually transitioned (idempotent — pausing an already-paused operation does not count and fires nothing, mirroring the boolean-return convention `MotionHandle.pause()` already established in Task 2).
- `resumeScope(scope)`: the mirror of the above for `paused → active`.

**Tests to write first, in `tests/motion/scopes.test.ts`:**

```
- cancelScope: 2 tweens in scope 'a', 1 tween in scope 'b'; cancelScope('a') returns 2, both 'a' tweens'
  onCancel fire once each; the 'b' tween is unaffected — assert its binding keeps advancing on a
  subsequent update() call.
- cancelAll: 1 tween in scope 'a', 1 delay in scope 'b', 1 sequence with no scope at all; cancelAll()
  returns 3 and every one of their onCancel callbacks fired exactly once.
- pauseScope: 2 operations in scope 'a' (one tween, one delay), 1 in scope 'b'; pauseScope('a') returns 2;
  update() many times afterward → the 'a' operations' values/elapsed are frozen, the 'b' operation keeps
  advancing.
- resumeScope: after the pauseScope case above, resumeScope('a') returns 2; further update() calls show
  the 'a' operations advancing again, continuing from where they were paused (not from scratch, not
  skipping the paused duration).
- pauseScope/resumeScope are idempotent: pauseScope('a') a second time in a row (nothing newly paused)
  returns 0; resumeScope('a') on an already-active scope returns 0.
- unrelated scopes are unaffected by all four methods (a single combined test exercising this across
  cancelScope/cancelAll/pauseScope/resumeScope in one pass is acceptable, provided each method's isolation
  is asserted explicitly).
- (moved here from Task 5, per that task's note) motion.delay({ durationMs: 100, scope: 'x' });
  cancelScope('x') → the delay's onCancel fires exactly once, onComplete never fires.
- dispose(): create at least one tween, one delay, and one sequence, all active; call dispose(); assert
  every one of their onCancel callbacks fired exactly once, none of their onComplete callbacks fired, and
  getStats().activeMotions is 0 immediately after (getStats() itself is finished in Task 8, but the
  underlying "operations map is empty" state must already be true here — assert it via a second
  dispose() call being a safe no-op, or via handle.active being false for all three, rather than via
  getStats() directly in this file).
- calling dispose() when nothing is active does not throw and is a safe no-op.
```

**Verification:** as above.

**Commit:** `feat(motion): implement scope cancel/pause/resume and dispose`

## Task 8 — Stats and performance invariants

**Depends on:** Task 7 (needs every operation kind and every lifecycle transition to exist).

**Files changed:** `src/motion/MotionRuntime.ts`.
**Files created:** `tests/motion/stats.test.ts`.

**Public shape added:**

```ts
getStats(): MotionRuntimeStats;
```

**Implementation:**
- `activeTweens`/`activeDelays`/`activeSequences`: tally the top-level `operations` map by `kind` at call time (a single `for...of` pass incrementing three counters — no `.filter()`/`.map()` copies, per spec §16). `activeMotions` is the sum of those three (or equivalently `this.operations.size`, since a sequence's internal step is never a separate map entry — either expression is correct; use `this.operations.size` since it's cheaper than three increments plus a sum).
- `pausedMotions`: tally operations with `paused === true` in that same pass.
- `completedMotions`/`cancelledMotions`/`callbackErrors`/`bindingErrors`: plain incrementing counters on the instance, bumped at the exact points Tasks 2–7 already fire completion/cancellation/error handling (do not recompute these by scanning history — they are running totals, exactly like `FxRuntime`'s own `droppedEffects` counter). A sequence completing/cancelling increments these counters **once** (for the sequence itself), not once per step — a step's own completion (moving to the next step) is not a top-level completion and must not increment `completedMotions`.
- `lastUpdateMs`/`maxUpdateMs`: call `readNow()` (a `performance.now()`-with-`Date.now()`-fallback helper, independently re-declared here — same shape as `FxRuntime.ts`'s own `readNow`, module boundary rule) exactly once at the start of `update()` and once at the end, exactly like `FxRuntime.update()`/`recordUpdateDuration` already does. Do not call `readNow()`/`performance.now()`/`Date.now()` anywhere inside the per-operation loop.

**Tests to write first, in `tests/motion/stats.test.ts`:**

```
- activeTweens/activeDelays/activeSequences/activeMotions all move correctly as one of each kind is
  created, then as each one completes or is cancelled (this subsumes the sequence-step-isolation assertion
  already written in Task 6's test file — do not duplicate it here, just don't regress it).
- pausedMotions increments on pause() and decrements on resume(), across tween/delay/sequence.
- completedMotions increments by exactly 1 when a tween completes, exactly 1 when a delay completes, and
  exactly 1 when a sequence completes (not 3, even though the sequence had 3 steps).
- cancelledMotions increments by exactly 1 per cancel()/cancelScope()/cancelAll()-cancelled operation,
  and by exactly 1 (not more) when a sequence is cancelled mid-step.
- callbackErrors increments once per caught onUpdate/onComplete/onCancel exception (reuse the throwing
  callbacks already written for Task 4; assert the counter here instead of re-deriving new throwing
  fixtures).
- bindingErrors increments once per caught binding.get()/set() exception (same reuse note as above).
- lastUpdateMs/maxUpdateMs: spy on `performance.now` (or inject via whatever seam Task 2 used inside
  `readNow`, if one was added — if not, spy on the global); assert it is called at most twice per
  update() call, regardless of how many operations (tween/delay/sequence, at least 5 of them together)
  are active in that call — this is the one performance property that is mechanically provable, not just
  reviewable.
- getStats() returns a plain object shape matching MotionRuntimeStats exactly (no extra/missing keys) —
  a simple `Object.keys(...).sort()` equality check against the expected key list is sufficient.
```

**Performance review checklist (manual code read, not a vitest test — record the outcome of walking through this checklist in the commit message body for this task):**
- [ ] `update()`'s per-operation loop contains no `.map()`/`.filter()`/`.forEach()`/spread-copy of `this.operations` or any per-operation array.
- [ ] No `.sort()` anywhere in `update()`, `cancelScope()`, `cancelAll()`, `pauseScope()`, `resumeScope()`, or `getStats()`.
- [ ] No object literal or closure is created inside the per-operation loop body itself (binding arrays and the operation records themselves are created once, at `tween()`/`delay()`/`sequence()` call time — that's expected and fine per spec §16; the loop body should only read existing fields and call existing closures).
- [ ] `performance.now()`/`Date.now()` appears exactly twice in `update()`'s own body (start and end), never inside the per-operation loop — already covered by the mechanical test above, but confirm by reading the code too.

**Verification:** as above.

**Commit:** `feat(motion): finalize stats and verify hot-path allocation profile` — include the completed checklist above in the commit body.

## Task 9 — CoreRuntime integration (optional pauseScope/resumeScope fan-out)

**Depends on:** Task 7 (needs `MotionRuntime.pauseScope`/`resumeScope` to exist to test the fan-out meaningfully end-to-end, though the `CoreRuntime`-side change itself doesn't reference `MotionRuntime` by type).

**Files changed:**
- `src/core/CoreRuntime.ts`
- `tests/core/CoreRuntime.test.ts` (append; do not modify any existing test in this file)

**Files NOT changed:** `src/fx/FxRuntime.ts`, `src/fx/FxPool.ts`, `src/fx/types.ts`, `src/fx/easing.ts`, `src/fx/trajectories.ts`, `src/fx/FxSurface.ts`, `src/adapters/pixi/PixiFxSurface.ts` — `FxRuntime` does not implement `pauseScope`/`resumeScope`; that is expected and correct (spec §12: "FxRuntime может не реализовывать pause/resume — optional runtime methods").

**Exact changes to `src/core/CoreRuntime.ts`:**

1. In `CoreRuntimeModule`, add two more optional methods, in the same style as the four already there:
   ```ts
   export interface CoreRuntimeModule {
     update(frameMs: number): boolean;
     cancelScope?(scope: string): number;
     cancelAll?(): number;
     pauseScope?(scope: string): number;
     resumeScope?(scope: string): number;
     getStats?(): object;
     dispose?(): void;
   }
   ```
2. Extend `CoreRuntimeErrorPhase`:
   ```ts
   export type CoreRuntimeErrorPhase = 'update' | 'cancelScope' | 'cancelAll' | 'pauseScope' | 'resumeScope' | 'getStats' | 'dispose';
   ```
3. Add two public methods on `CoreRuntime`, copying the exact shape of the existing `cancelScope`/`cancelAll` methods (loop over `this.modules`, skip a module without the optional method, `safeInvoke`, sum numeric results):
   ```ts
   pauseScope(scope: string): number {
     let total = 0;
     for (const [name, runtime] of this.modules) {
       if (!runtime.pauseScope) continue;
       const result = this.safeInvoke(name, 'pauseScope', () => runtime.pauseScope!(scope));
       if (typeof result === 'number') total += result;
     }
     return total;
   }

   resumeScope(scope: string): number {
     // identical shape, calling runtime.resumeScope!(scope) and phase 'resumeScope'
   }
   ```

Nothing else in `CoreRuntime.ts` changes. `registerRuntime`, `update`, `cancelScope`, `cancelAll`, `getStats`, `onError`, `reportError`, `dispose`, `safeInvoke` are untouched.

**Tests to append to `tests/core/CoreRuntime.test.ts`:**

```
- pauseScope fans out and sums counts across modules, skipping modules without one — same shape as the
  existing "cancelScope fans out..." test just above it in the file, with pauseScope: () => N fixtures.
- resumeScope fans out and sums counts across modules, skipping modules without one — same shape,
  mirroring the existing "cancelAll fans out..." test.
- a module (standing in for FxRuntime) that implements only update/cancelScope/cancelAll/getStats/dispose
  (no pauseScope/resumeScope) is silently skipped by both new fan-out methods, and its own
  update/cancelScope/cancelAll/getStats/dispose behavior is completely unaffected — run the EXISTING
  relevant assertions from earlier in this file against a module built with pauseScope/resumeScope also
  present on a DIFFERENT registered module, proving the two module "shapes" coexist without interference.
- errors thrown from pauseScope/resumeScope are reported with the correct phase — extend the existing
  "errors from update/cancelScope/cancelAll/dispose are reported..." test's fixture module with throwing
  pauseScope/resumeScope too, and extend its assertions' expected phase list accordingly (this modifies
  the fixture inside that one existing test, not the test's already-passing assertions about the other
  four phases — the existing four expectations must still hold after this addition).
```

**Verification:** `npx vitest run tests/core/CoreRuntime.test.ts` → `npm test` (the entire suite, including every `tests/fx/*` and `tests/motion/*` file from Tasks 1–8, must still be green — this is the regression gate for "FxRuntime remains unchanged") → `npx tsc --noEmit`.

**Commit:** `feat(core): add optional pauseScope/resumeScope fan-out for motion`

## Task 10 — Public exports + architecture docs

**Depends on:** Tasks 1–9 (the public surface must be finished before it's exported/documented).

**Files changed:** `src/index.ts`, `docs/ARCHITECTURE.md`.
**Files created:** none.

**Exact addition to `src/index.ts`** (append; do not reorder or touch the existing FX/CoreRuntime/BUILD_INFO export lines):

```ts
export { MotionRuntime } from './motion/MotionRuntime';
export type {
  MotionScope,
  EaseName,
  EaseFn,
  MotionBinding,
  MotionUpdateCallback,
  MotionCompleteCallback,
  MotionCancelCallback,
  MotionHandle,
  MotionTweenOptions,
  MotionDelayOptions,
  MotionSequenceStep,
  MotionSequenceOptions,
  MotionErrorPhase,
  MotionErrorContext,
  MotionErrorHandler,
  MotionRuntimeStats,
  MotionRuntimeOptions
} from './motion/types';
```

**Explicitly do NOT export:** anything from `src/motion/easing.ts` (the concrete `linear`/`easeIn`/`easeOut`/`easeInOut`/`backOut`/`resolveEase`/`clamp01` functions stay internal — a host never needs to import them directly, it only ever passes an `EaseName` string or its own `EaseFn`; this mirrors the already-fixed precedent from the v0.1 hardening pass, where `src/fx/easing.ts`'s equivalent low-level helpers were deliberately removed from the public barrel for the same reason) and anything from `src/motion/MotionSequenceRunner.ts` (purely internal orchestration, never part of the public surface).

After this change, verify with a throwaway local check (not a committed test) that `import { MotionRuntime } from '<package>'` and every type above resolves, and that `import { linear } from '<package>'` does **not** — e.g. `npx tsc --noEmit` will not by itself catch a missing type-only re-export mistake as clearly as attempting the bad import would; a quick manual sanity import in a scratch file (not committed) is an acceptable way to confirm this before moving on.

**Exact changes to `docs/ARCHITECTURE.md`:**

Replace the opening of the `## Scope` section — currently:

> Game Core is a reusable runtime library for shared HTML5 game systems. Version 0.1 contains only the FX runtime surface:
>
> - effect lifecycle
> - pooled node acquisition and release
> - trajectories and easing
> - impact and completion callbacks
> - cleanup and diagnostics
>
> The host owns rendering, asset loading, DOM, canvases, application objects, and tickers.

with:

> Game Core is a reusable runtime library for shared HTML5 game systems. It is organized as a small `CoreRuntime` kernel plus independent runtime modules registered into it:
>
> - `CoreRuntime` — a fan-out orchestrator: registers named runtime modules, ticks them all through one `update(frameMs)` call, fans out scope cancellation/pause/resume, aggregates stats, and gives every module's failures one error-reporting boundary. It never renders and never knows a module's internals.
> - `FxRuntime` (module name `"fx"`) — effect lifecycle, pooled node acquisition and release, trajectories and easing, impact/completion/cancellation callbacks, cleanup and diagnostics.
> - `MotionRuntime` (module name `"motion"`) — numeric tween/delay/sequence scheduling over host-supplied bindings, for UI/game motion that isn't pooled FX.
>
> The host owns rendering, asset loading, DOM, canvases, application objects, and tickers, and is the only thing that ever calls `CoreRuntime.update(frameMs)`.

Then add two new `##`-level sections. Insert `## Core Runtime` immediately after `## Scope` (before the existing `## FX Runtime` section):

```markdown
## Core Runtime

`CoreRuntime` registers runtime modules under a stable name and fans out to all of them:

​```ts
core.registerRuntime('fx', fxRuntime);
core.registerRuntime('motion', motionRuntime);
core.update(frameMs);          // ticks every registered module
core.cancelScope(scope);       // sums cancelled counts across modules that support it
core.pauseScope(scope);
core.resumeScope(scope);
core.getStats();               // { fx: {...}, motion: {...} }
​```

A module's own `cancelScope`/`cancelAll`/`pauseScope`/`resumeScope`/`getStats`/`dispose` are all optional — `CoreRuntime` skips a module that doesn't implement one, rather than requiring every module to support everything. If a module throws from any of these, `CoreRuntime` catches it, reports it through the single handler registered via `onError`, and every other registered module keeps working. A throwing error handler can never itself escape into the host's own ticker.
```

(Replace the literal `​```` markers above with real triple-backtick fences when writing the file — they are written with a zero-width-joiner-escaped form here only so this plan's own Markdown renders without breaking.)

Then add `## Motion Runtime` immediately after the existing `## FX Runtime`/`## Surface Boundary`/`## Pooling`/`## Effects` sections and before `## Diagnostics` (or after `## Diagnostics`, at the end — either position is fine; put it after `## Diagnostics` since it documents a sibling module, not a continuation of the FX-specific sections above it):

```markdown
## Motion Runtime

`MotionRuntime` schedules numeric tweens, delays, and simple tween/delay sequences over host-supplied bindings — it has no concept of a node, a renderer, or a specific engine:

​```ts
type MotionBinding = {
  get(): number;
  set(value: number): void;
  to: number;
  from?: number;
};
​```

A host describes *what number to move and where to*; `MotionRuntime` only ever calls `get()`/`set()` on the bindings it's given. It never imports Pixi, GSAP, or Cocos, and never creates a ticker or `requestAnimationFrame` — like `FxRuntime`, it only advances through a host-driven `update(frameMs)` call, normally reached via `CoreRuntime.update(frameMs)`.

Three operation kinds: `tween` (interpolates one or more bindings, with optional easing, delay, repeat/yoyo), `delay` (a first-class timed wait, not `setTimeout`), and `sequence` (an ordered list of tween/delay steps that behaves as a single cancellable operation to the host). All three return a `MotionHandle` (`cancel`/`pause`/`resume`/`active`/`paused`) — no Promise API in this version.

A binding whose `get()`/`set()` throws (a stale or destroyed host object) cancels only that one operation; every other active motion is unaffected. See `docs/superpowers/specs/2026-09-15-motion-runtime-v0.2-design.md` for the full design.
```

(Same triple-backtick note as above.)

**Tests:** none — this task is docs/exports only. Still run the standard verification loop's steps 4–5 (`npm test`, `npx tsc --noEmit`) to confirm the export change didn't break anything.

**Commit:** `feat(motion): export public API and update architecture docs`

## Task 11 — Full game-core verification (no code change expected)

**Depends on:** Task 10.

This task produces a **verification report, not a new commit**, unless one of the checks below surfaces something to fix — if it does, fix it, and that fix gets its own commit with its own accurate message describing what was wrong (do not silently fold a fix into a re-run of this task without a commit).

Run, in order, from the `game-core/` directory:

```bash
npm test               # every test file under tests/fx/**, tests/core/**, tests/motion/** — all green
npx tsc --noEmit        # no errors
npm run build           # dist/game-core.es.js and dist/game-core.iife.js both produced without error
git status              # must be clean (nothing to commit) once Task 10's commit is in place
git status --porcelain  # (used by the build's own dirty-detection) must also be empty
```

Then inspect the just-built `dist/game-core.iife.js`'s embedded `BUILD_INFO` (grep for `commit:"` and `dirty:` in that file, the same way prior sessions on this repo have verified it): with a clean working tree, it must show `dirty:!1` (i.e. `false`) and a `commit:"<short-hash>"` **without** a `-dirty` suffix, where `<short-hash>` is Task 10's own commit (or Task 11's fix commit, if one was needed). If it instead shows `dirty:!0`/a `-dirty` suffix, the working tree was not actually clean when `npm run build` ran — resolve that (commit or discard whatever is dirty) before considering this task done; do not treat a dirty result as acceptable.

**Explicitly do not run** `npm run sync:word-tide` as part of this task (see the top of this plan).

**Expected result:** all four commands succeed, the working tree is clean, and `BUILD_INFO` shows a clean, non-dirty commit hash matching the tip of `feat/motion-runtime` at that point.
