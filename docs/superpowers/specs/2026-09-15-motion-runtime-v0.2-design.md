# MotionRuntime v0.2 — Design Spec

- **Status:** Approved design, not yet implemented.
- **Date:** 2026-09-15
- **Branch:** `feat/motion-runtime` (created from `main` / tag `v0.1.0`, commit `5a7d0b4`)
- **Depends on:** Game Core v0.1 (`FxRuntime`, `CoreRuntime`) — already shipped and real-device validated on iPhone (see `docs/ARCHITECTURE.md`).

This document fixes the **already-approved** design for `MotionRuntime`. It is a specification to build against, not a proposal — no alternative architecture is considered here. Where the approved rules left a mechanical detail unstated, this document states one unambiguous reading, called out explicitly under "Clarifications" at the end of each section, so implementation has nothing left to guess.

Nothing in this document is implemented yet. `MotionRuntime` does not exist in `src/` as of this spec.

## 1. Goal

`MotionRuntime` is a rendering-agnostic runtime for numeric UI/game motion animation (position, scale, alpha, rotation, or any other single numeric property). It exists to gradually replace ad-hoc GSAP/UI-tween code scattered across production games with one shared, tested, host-driven motion scheduler.

`MotionRuntime`:

- does not import Pixi;
- does not import GSAP;
- does not import Cocos;
- does not create `requestAnimationFrame`;
- does not create a ticker;
- does not render;
- only advances through host-driven `CoreRuntime.update(frameMs)`;
- does not know about any specific game.

**First production proof**, once implemented, is intentionally narrow:

1. Button press/release scale in `trail_arrow`.
2. One representative window's `animateIn()` in `trail_arrow`.

The rest of Twin Arrow's GSAP usage is explicitly **not** migrated as part of this first version (see §19).

## 2. Internal model — numeric bindings

**Approved: Option B — generic numeric bindings.** `MotionRuntime` has no concept of `x`/`y`/`scale`/`alpha`, no concept of a Pixi/Cocos/DOM node. It only knows how to read and write a plain number through a pair of host-supplied closures.

```ts
type MotionBinding = {
  get(): number;
  set(value: number): void;
  to: number;
  from?: number;
};
```

Host-side examples:

```ts
{ get: () => view.x, set: (value) => { view.x = value; }, to: 100 }
```

```ts
{ get: () => view.scale.x, set: (value) => view.scale.set(value), to: 1 }
```

A tween operates on one or more bindings at once (e.g. `scale.x` and `scale.y` together).

**`from` resolution:**

- If `from` is provided, that value is used as-is.
- If `from` is **not** provided, the starting value is read via `get()` **at the moment the tween actually starts** — i.e. after `delayMs` has elapsed, not at the moment `motion.tween(...)` was called. Before that moment, `get()` is not called for this purpose.
- For `repeat`/`yoyo`, the endpoints used for every subsequent pass are the ones resolved at that first real start (see §8). They are never re-read from `get()` on later passes.

## 3. Tween API

The first version supports, conceptually:

```ts
motion.tween({
  bindings,
  durationMs,
  delayMs?,
  ease?,
  scope?,
  repeat?,
  yoyo?,
  onUpdate?,
  onComplete?,
  onCancel?
});
```

All time units in the public API are **milliseconds**: `durationMs`, `delayMs`. No seconds anywhere in the public surface.

## 4. Motion handle

Every started operation (`tween`, `delay`, `sequence`) returns a handle with this exact shape:

```ts
interface MotionHandle {
  cancel(): boolean;
  pause(): boolean;
  resume(): boolean;
  readonly active: boolean;
  readonly paused: boolean;
}
```

`MotionHandle` is the **only** return shape for a started operation in v0.2.

- **No Promise API** is added in v0.2.
- **No async/await lifecycle** is added in v0.2.

## 5. Delay

`delay` is a first-class `MotionRuntime` operation, not a `setTimeout` wrapper.

```ts
motion.delay({
  durationMs,
  scope?,
  onComplete?,
  onCancel?
});
```

A delay:

- is ticked by the same host-driven clock as everything else (`CoreRuntime.update(frameMs)` → `MotionRuntime.update(frameMs)`);
- supports `pause()`/`resume()`/`cancel()`;
- is scope-aware (participates in `cancelScope`/`pauseScope`/`resumeScope`);
- returns a `MotionHandle`.

## 6. Sequence

In v0.2, `sequence` supports **only** two step kinds: `tween` steps and `delay` steps.

```ts
motion.sequence({
  scope,
  steps: [
    { type: 'tween', /* same fields as motion.tween(), minus scope */ },
    { type: 'delay', durationMs: 100 },
    { type: 'tween', /* ... */ }
  ],
  onComplete,
  onCancel
});
```

A sequence is **one single operation** from the host's point of view: it gets one `MotionHandle`, one `scope`, one `onComplete`, one `onCancel`.

**On `sequence.cancel()`:**

- the step currently running is stopped in place (same as cancelling that step directly — see §7 CANCEL);
- no later step in `steps` is ever started;
- the sequence's own `onCancel` fires exactly once;
- the sequence's own `onComplete` never fires.

**Explicitly excluded from v0.2 sequences** (see also §17):

- parallel steps;
- nested sequences;
- conditional branches;
- callback-as-step;
- Promise steps.

**Clarifications** (direct consequences of the rules above, made explicit for implementation):

- A step's own `scope` field is not used; only the sequence's top-level `scope` is registered with `CoreRuntime`/`MotionRuntime` for scope operations. Cancelling/pausing/resuming a sequence by scope acts on the sequence as a whole, not on an individual step.
- `sequence()` has no `repeat`/`yoyo` field of its own in v0.2. A tween **step** inside a sequence may declare its own `repeat`/`yoyo` exactly as a standalone tween would; the sequence itself does not loop.
- Calling `pause()` on a sequence's handle pauses whichever step is currently active (its elapsed time stops advancing, per §7 PAUSE); `resume()` continues that same step from where it stopped. This follows directly from "sequence is one operation" plus `MotionHandle`'s uniform pause/resume contract.

## 7. Lifecycle semantics

**NORMAL COMPLETE:**

1. The tween reaches the end of its duration.
2. Binding values are set to exactly the final (`to`) values.
3. `onComplete` fires exactly once.
4. The operation is removed from the runtime.

**CANCEL:**

1. `cancel()` is called.
2. Binding values are left exactly where they currently are — **no jump-to-end**.
3. `onCancel` fires exactly once.
4. `onComplete` never fires for this operation.
5. The operation is removed from the runtime.

Calling `cancel()` again on the same handle:

- returns `false`;
- never fires `onCancel` (or any other callback) a second time.

**PAUSE:**

1. `pause()` is called.
2. The operation's elapsed time stops advancing on subsequent `update(frameMs)` calls.
3. Binding values stay at their current value (nothing is written while paused).
4. No callback (`onUpdate`/`onComplete`/`onCancel`) fires as a result of pausing.

**RESUME:**

1. `resume()` is called.
2. The operation continues advancing its elapsed time from exactly the state it was paused at — no time is lost or fabricated.

## 8. Repeat / yoyo

```
repeat: 0          → one pass
repeat: 2          → one pass + two more = three passes total
repeat: Infinity   → unbounded
```

`yoyo: true` alternates direction every pass: `from → to`, then `to → from`, then `from → to`, …

The `from`/`to` endpoints used across every pass are fixed once, at the tween's first real start (per §2's `from`-resolution rule) — they are never re-read from `get()` on later passes, including on yoyo direction flips.

## 9. Easing

Internal shape:

```ts
type EaseFn = (t: number) => number;
```

Minimum built-in set to ship:

- `linear`
- `easeIn`
- `easeOut`
- `easeInOut`
- `backOut`

A caller may also pass a custom `EaseFn` directly. No larger, GSAP-style easing catalogue is added in v0.2.

## 10. onUpdate

```ts
onUpdate?: (progress: number) => void;
```

- `progress` is the **raw, un-eased** normalized progress in `[0, 1]`. Eased values are applied to the bindings; `progress` handed to `onUpdate` is not eased.
- `onUpdate` fires **after** this frame's binding values have already been applied (`set()` already called for every binding of this operation this frame).
- If `onUpdate` throws: the error is caught, reported (see §14), the scheduler keeps running, and — unlike a binding error (§11) — the tween itself is **not** cancelled by an `onUpdate` exception; it keeps advancing on subsequent frames.

## 11. Binding error semantics

If `binding.get()` or `binding.set()` throws for any binding of an operation:

- the exception is caught;
- that specific motion operation is cancelled (its cleanup runs exactly as in §7 CANCEL: current values are left as-is where set already succeeded, the operation is removed from the runtime, `onComplete` never fires);
- `onCancel` fires exactly once for that operation, same as an explicit `cancel()` — a binding failure is one more trigger for the same cancel path, not a separate code path with different guarantees;
- the error itself is additionally reported through the optional motion error handler (§14);
- every other active motion keeps running unaffected;
- the host ticker never receives the exception;
- there is no global runtime crash.

This is the load-bearing protection against stale/destroyed host objects (a bound view already torn down by the host, etc.).

## 12. Scopes

A scope is a plain `string`. Examples: `"main-screen"`, `"settings-window"`, `"level-unlock"`.

`MotionRuntime` exposes:

```ts
cancelScope(scope: string): number;
pauseScope(scope: string): number;
resumeScope(scope: string): number;
```

`CoreRuntime` gains matching fan-out entry points:

```ts
core.cancelScope(scope);
core.pauseScope(scope);
core.resumeScope(scope);
```

`cancelScope`/`pauseScope`/`resumeScope` on `CoreRuntimeModule` are **optional** methods, exactly like today's `cancelScope?`/`cancelAll?`/`getStats?`/`dispose?`. `FxRuntime` is not required to implement `pauseScope`/`resumeScope` — pause/resume is a `MotionRuntime`-only concept in v0.2; `CoreRuntime`'s fan-out simply skips any module that doesn't implement a given optional method (same behavior it already has for `cancelScope`/`cancelAll` today).

**Explicitly excluded from v0.2:**

- hierarchical scopes;
- wildcards;
- parent/child scopes.

## 13. CoreRuntime integration

`MotionRuntime` registers as an ordinary `CoreRuntime` module, exactly like `FxRuntime` does today:

```ts
core.registerRuntime('motion', motion);
```

The production host calls `core.update(frameMs)` — never `motion.update(frameMs)` directly. This is the same rule already enforced for `FxRuntime` in the word_tide integration: one host-driven tick, fanned out by `CoreRuntime` to every registered module.

`CoreRuntime` stays a small fan-out orchestrator — this design adds two more optional module methods (`pauseScope?`, `resumeScope?`) to the existing pattern; it does not add a module registry redesign, a dependency graph, or knowledge of any specific module's internals.

- `MotionRuntime` does not know `FxRuntime`'s internals.
- `FxRuntime` does not know `MotionRuntime`'s internals.

## 14. Error boundaries

Two independent layers, matching the layered exception-safety model already shipped for `FxRuntime`/`CoreRuntime` in v0.1:

1. **`MotionRuntime` (inner layer):** catches binding errors (§11) and callback errors (§10, and the equivalent for `onComplete`/`onCancel`/sequence `onComplete`/`onCancel`) locally, reports each through an optional motion-level error handler, and keeps its own scheduler running regardless.
2. **`CoreRuntime` (outer layer):** if `MotionRuntime.update`/`cancelScope`/`cancelAll`/`pauseScope`/`resumeScope`/`dispose` itself throws unexpectedly (a bug inside `MotionRuntime`, not a caught binding/callback error), `CoreRuntime` catches that module-level exception the same way it already does for any registered module, reports it, and every other registered runtime keeps working.

In both layers, if the error handler itself throws, that is also caught — an error handler can never be the thing that reaches the host ticker.

**Clarification:** "callback errors" in layer 1 covers every callback `MotionRuntime` invokes on the host's behalf: a tween's `onUpdate`/`onComplete`/`onCancel`, a delay's `onComplete`/`onCancel`, and a sequence's `onComplete`/`onCancel`. All of them are caught and reported the same way; none of them is allowed to abort processing of other active operations in the same `update()` call.

## 15. Stats

Minimum `MotionRuntime.getStats()` shape:

```ts
interface MotionRuntimeStats {
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
```

Through `CoreRuntime.getStats()`, the aggregate shape is:

```json
{ "fx": { "...": "..." }, "motion": { "...": "..." } }
```

— the same aggregation-by-registered-name `CoreRuntime` already does today for `fx` alone.

No p95/p99 or rolling averages are added in v0.2.

**Clarification:** `activeMotions` is the total count of currently active top-level operations — every registered tween, delay, and sequence, i.e. `activeTweens + activeDelays + activeSequences`. A tween or delay **step running inside a sequence** is internal machinery of that one sequence operation; it is not a separately registered top-level operation, so it is counted only within `activeSequences`, never separately added into `activeTweens`/`activeDelays`.

## 16. Performance rules

`MotionRuntime.update(frameMs)`'s hot path must be allocation-conscious. Concretely, the per-frame path must not create, unless truly unavoidable:

- arrays;
- object literals;
- closures;
- `map`/`filter`/`forEach` temporary result collections;
- sorted copies.

Motions must not be sorted every frame. `performance.now()`/`Date.now()` must not be read separately per motion — one runtime-level timing measurement per `update()` call is the budget, matching how `FxRuntime.update()` already measures its own duration today.

Bindings are created once, at tween/delay/sequence start — that allocation is expected and fine; it is not part of the per-frame hot path. The per-frame path itself is expected to be, in the common case, scalar math followed by `binding.set(value)` calls.

## 17. Out of scope for v0.2

Explicitly **not** implemented:

- parallel;
- nested sequences;
- relative values (`"+=100"`-style);
- color tween;
- string tween;
- CSS tween;
- spring physics;
- keyframes;
- Promise API;
- DOM adapter;
- Pixi adapter;
- Cocos adapter;
- target overwrite semantics;
- `killTweensOf(target)`-style API;
- automatic destroyed-node detection;
- target ownership;
- pooling of persistent UI nodes;
- dependency injection;
- an event bus;
- a command framework.

## 18. reference-vlad-bubbles

Used strictly as a **read-only** architectural benchmark — never a source of code, never a source of package structure to reuse. Ideas already confirmed useful from studying it:

- a single, uniform animator lifecycle contract (`play`/`stop`/`reset`-shaped, matched by our `MotionHandle`'s `cancel`/`pause`/`resume`);
- a small, cancellable `Process`-like completion-handle model;
- pooling transient nodes as a concern kept separate from persistent UI nodes;
- adaptive/lifecycle services as a general concept (not their concrete implementation).

**Not** carried over: their proprietary code, their MVCS/DI framework, or an attempt to reproduce Cocos's own engine-native tween scheduler. `MotionRuntime` stays host-driven (`CoreRuntime.update(frameMs)`) specifically because, unlike Cocos, Pixi (and DOM) have no engine-native tween scheduler to lean on — this is a real engine-capability gap already documented in the prior `reference-vlad-bubbles` benchmark writeup for this workspace, not a stylistic choice.

## 19. trail_arrow

Used as a production donor and verification target, not modified as part of this spec.

After `MotionRuntime` is implemented, the **first** migration is limited to exactly:

1. Button press/release scale.
2. One representative window's `animateIn()`.

**Not** migrated in this pass:

- every window;
- the level map (scroll/chain/highlight tweens);
- the gameplay `ArrowRenderer` ticker;
- fireworks/reward FX;
- scroll logic;
- the rest of Twin Arrow's GSAP usage.

## 20. Testing requirements for the future implementation

The implementation must ship with, at minimum, the following test categories:

**Tween:**
- interpolation correctness;
- exact final value on normal completion;
- explicit `from`;
- implicit `from`, read at the actual start after `delayMs`;
- custom `EaseFn`;
- each built-in ease;
- `onUpdate` receives raw (un-eased) progress;
- completes exactly once;
- cancels exactly once;
- double cancel (second call returns `false`, no second callback);
- pause/resume;
- fixed `repeat` count;
- `repeat: Infinity`;
- `yoyo` endpoints stay fixed across passes.

**Bindings:**
- `get()` throws → operation isolated, cancelled, reported;
- `set()` throws → operation isolated, cancelled, reported;
- the failing motion does not affect any other active motion;
- the rest of the runtime keeps updating on the same and later frames.

**Delay:**
- completion;
- pause/resume;
- cancel;
- scope cancellation.

**Sequence:**
- steps run in declared order;
- a `delay` step followed by a `tween` step (and vice versa) behaves correctly;
- cancelling a sequence stops the currently running step in place;
- no later step ever starts after a sequence is cancelled;
- sequence `onComplete` fires exactly once, only on full completion;
- sequence `onCancel` fires exactly once, only on cancellation.

**Scopes:**
- `cancelScope`;
- `pauseScope`;
- `resumeScope`;
- operations in unrelated scopes are unaffected by any of the above.

**CoreRuntime:**
- `pauseScope`/`resumeScope` fan out to every registered module that implements them;
- module-level exception isolation (already proven for `fx`) still holds once `motion` is also registered.

**Stats:**
- active/paused/completed/cancelled counts move correctly through each lifecycle transition;
- `callbackErrors`/`bindingErrors` increment correctly;
- `lastUpdateMs`/`maxUpdateMs` are recorded.

**Performance:**
- a regression check (code review / static check, not a timing assertion) confirming no obvious per-frame allocation pattern was introduced in the `update()` hot path, matching §16.

## 21. Success criteria

- `MotionRuntime` remains renderer-independent.
- `CoreRuntime` remains small.
- No duplicate scheduler/lifecycle architecture is created alongside `FxRuntime`'s.
- `FxRuntime` remains unchanged, except for a minimal, additive `CoreRuntimeModule` interface extension if one turns out to be needed (`pauseScope?`/`resumeScope?` — both optional, both skippable by `FxRuntime`).
- No new `requestAnimationFrame`/ticker is introduced anywhere.
- `MotionRuntime` is capable of replacing GSAP for simple Twin Arrow UI motion (button press/release scale, one `animateIn()`).
- Safe under stale/destroyed host bindings (§11).
- Observable through `getStats()` (§15).
- A suitable foundation for the next 5–10 HTML5 games sharing this Game Core.
