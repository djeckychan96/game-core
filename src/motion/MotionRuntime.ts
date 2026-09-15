import { advanceSequence, type SequenceHost, type SequenceStatus } from './MotionSequenceRunner';
import { resolveEase } from './easing';
import type {
  EaseFn,
  MotionBinding,
  MotionCancelCallback,
  MotionCompleteCallback,
  MotionDelayOptions,
  MotionErrorContext,
  MotionErrorHandler,
  MotionErrorPhase,
  MotionHandle,
  MotionRuntimeOptions,
  MotionRuntimeStats,
  MotionScope,
  MotionSequenceOptions,
  MotionSequenceStep,
  MotionTweenOptions,
  MotionUpdateCallback
} from './types';

// Same shape as FxRuntime.ts's own readNow — independently re-declared here (module boundary
// rule). Exactly one call at the start and one at the end of update(), never inside the
// per-operation loop.
function readNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// Shared by every operation kind (tween/delay/sequence): identity, pause state, scope, and the
// two outer lifecycle callbacks. Deliberately does NOT include elapsedMs/durationMs — a
// RuntimeSequence has neither of its own (those live on whichever step is current).
interface RuntimeOperationBase {
  id: number;
  paused: boolean;
  scope?: MotionScope;
  onComplete?: MotionCompleteCallback;
  onCancel?: MotionCancelCallback;
}

export interface RuntimeTween extends RuntimeOperationBase {
  kind: 'tween';
  elapsedMs: number;
  delayMs: number;
  durationMs: number;
  bindingSpecs: MotionBinding[];
  resolvedFrom: number[] | null;
  ease: EaseFn;
  repeat: number; // 0 = one pass; finite N = N extra passes; Infinity = unbounded
  yoyo: boolean;
  passIndex: number;
  direction: 1 | -1;
  onUpdate?: MotionUpdateCallback;
}

export interface RuntimeDelay extends RuntimeOperationBase {
  kind: 'delay';
  elapsedMs: number;
  durationMs: number;
}

export interface RuntimeSequence extends RuntimeOperationBase {
  kind: 'sequence';
  steps: MotionSequenceStep[];
  currentStepIndex: number;
  currentStepOperation: RuntimeTween | RuntimeDelay | null;
}

type RuntimeOperation = RuntimeTween | RuntimeDelay | RuntimeSequence;

function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeRepeat(repeat: number | undefined): number {
  if (repeat === Infinity) return Infinity;
  if (!Number.isFinite(Number(repeat))) return 0;
  return Math.max(0, Math.floor(Number(repeat)));
}

// Same shape as FxRuntime.ts's own defaultOnEffectError — independently re-declared here
// (src/motion/** must never import from src/fx/**).
function defaultOnMotionError(error: unknown, context: MotionErrorContext): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[MotionRuntime] callback/binding threw', context, error);
  }
}

export class MotionRuntime implements SequenceHost {
  private readonly operations = new Map<number, RuntimeOperation>();
  private nextId = 1;
  private readonly onMotionError: MotionErrorHandler;
  private callbackErrors = 0;
  private bindingErrors = 0;
  private completedMotions = 0;
  private cancelledMotions = 0;
  private lastUpdateMs = 0;
  private maxUpdateMs = 0;

  constructor(options: MotionRuntimeOptions = {}) {
    this.onMotionError = options.onMotionError ?? defaultOnMotionError;
  }

  tween(options: MotionTweenOptions): MotionHandle {
    const tween = this.buildTweenRecord(options);
    if (options.scope !== undefined) tween.scope = options.scope;
    this.operations.set(tween.id, tween);
    return this.createHandle(tween.id);
  }

  delay(options: MotionDelayOptions): MotionHandle {
    const delayOp = this.buildDelayRecord(options);
    if (options.scope !== undefined) delayOp.scope = options.scope;
    this.operations.set(delayOp.id, delayOp);
    return this.createHandle(delayOp.id);
  }

  sequence(options: MotionSequenceOptions): MotionHandle {
    const id = this.nextId++;
    const seq: RuntimeSequence = {
      id,
      kind: 'sequence',
      paused: false,
      steps: options.steps,
      currentStepIndex: 0,
      currentStepOperation: null
    };
    if (options.scope !== undefined) seq.scope = options.scope;
    if (options.onComplete) seq.onComplete = options.onComplete;
    if (options.onCancel) seq.onCancel = options.onCancel;

    this.operations.set(id, seq);
    return this.createHandle(id);
  }

  update(frameMs: number): boolean {
    const startedAt = readNow();
    let changed = false;
    const deltaMs = Math.max(0, finiteOr(frameMs, 0));
    // Operations created reentrantly during THIS call (e.g. from another operation's onComplete)
    // get an id >= idBoundary (ids are a single monotonic counter, never reused) and are skipped
    // this pass — they first tick on a later update() call. Scalar comparison, no allocation.
    const idBoundary = this.nextId;

    for (const op of this.operations.values()) {
      if (op.id >= idBoundary) continue;
      if (op.paused) continue;

      if (op.kind === 'tween') {
        this.advanceTweenFrame(op, deltaMs);
        changed = true;
        continue;
      }

      if (op.kind === 'delay') {
        this.advanceDelayFrame(op, deltaMs);
        continue;
      }

      // sequence
      advanceSequence(op, deltaMs, this);
      changed = true;
    }

    this.recordUpdateDuration(startedAt);
    return changed;
  }

  /** Snapshot of current counts, running totals, and the last/max update() duration. Allocates one
   * plain object per call (diagnostic, not part of the per-frame hot path) — never called from
   * inside update() itself. */
  getStats(): MotionRuntimeStats {
    let activeTweens = 0;
    let activeDelays = 0;
    let activeSequences = 0;
    let pausedMotions = 0;

    for (const op of this.operations.values()) {
      if (op.kind === 'tween') activeTweens += 1;
      else if (op.kind === 'delay') activeDelays += 1;
      else activeSequences += 1;
      if (op.paused) pausedMotions += 1;
    }

    return {
      activeMotions: this.operations.size,
      activeTweens,
      activeDelays,
      activeSequences,
      pausedMotions,
      completedMotions: this.completedMotions,
      cancelledMotions: this.cancelledMotions,
      lastUpdateMs: this.lastUpdateMs,
      maxUpdateMs: this.maxUpdateMs,
      callbackErrors: this.callbackErrors,
      bindingErrors: this.bindingErrors
    };
  }

  private recordUpdateDuration(startedAt: number): void {
    const elapsed = Math.max(0, readNow() - startedAt);
    this.lastUpdateMs = elapsed;
    if (elapsed > this.maxUpdateMs) this.maxUpdateMs = elapsed;
  }

  /** Cancels every operation currently in `scope`. Returns the count actually cancelled. */
  cancelScope(scope: MotionScope): number {
    let count = 0;
    for (const op of Array.from(this.operations.values())) {
      if (op.scope !== scope) continue;
      if (!this.operations.has(op.id)) continue; // already cancelled reentrantly above
      this.cancelOperation(op);
      count += 1;
    }
    return count;
  }

  /** Cancels every operation regardless of scope. Returns the count actually cancelled. */
  cancelAll(): number {
    let count = 0;
    for (const op of Array.from(this.operations.values())) {
      if (!this.operations.has(op.id)) continue; // already cancelled reentrantly above
      this.cancelOperation(op);
      count += 1;
    }
    return count;
  }

  /** Pauses every not-already-paused operation in `scope`. Returns the count actually transitioned. */
  pauseScope(scope: MotionScope): number {
    let count = 0;
    for (const op of this.operations.values()) {
      if (op.scope !== scope || op.paused) continue;
      op.paused = true;
      count += 1;
    }
    return count;
  }

  /** Resumes every paused operation in `scope`. Returns the count actually transitioned. */
  resumeScope(scope: MotionScope): number {
    let count = 0;
    for (const op of this.operations.values()) {
      if (op.scope !== scope || !op.paused) continue;
      op.paused = false;
      count += 1;
    }
    return count;
  }

  /**
   * Permanent shutdown: cancels every still-active operation (onCancel fires for each, no
   * onComplete). MotionRuntime owns no persistent resources beyond its own operations map, so
   * this is defined as cancelAll() and nothing else — unlike FxRuntime.dispose(), there is no
   * pool-owned render node to tear down.
   */
  dispose(): void {
    this.cancelAll();
  }

  // --- SequenceHost surface (called only from MotionSequenceRunner.advanceSequence) ---

  buildStepOperation(step: MotionSequenceStep): RuntimeTween | RuntimeDelay {
    return step.type === 'tween' ? this.buildTweenRecord(step) : this.buildDelayRecord(step);
  }

  /** Removes a top-level operation (used by MotionSequenceRunner to finalize a sequence BEFORE
   * its own terminal callback fires) and records the sequence's own completedMotions/
   * cancelledMotions count exactly once. A no-op if `id` was never a top-level entry (e.g. a
   * sequence-internal step's own id, which is never inserted into `operations`). */
  removeOperation(id: number, outcome: 'completed' | 'cancelled'): void {
    if (!this.operations.delete(id)) return;
    if (outcome === 'completed') this.completedMotions += 1;
    else this.cancelledMotions += 1;
  }

  /** Whether a top-level operation is still present. Lets MotionSequenceRunner detect that a
   * sequence was already finalized reentrantly (e.g. its own current step's callback cancelled
   * the parent sequence) before proceeding with its own completion/cancellation handling. */
  isOperationActive(id: number): boolean {
    return this.operations.has(id);
  }

  advanceTweenFrame(op: RuntimeTween, deltaMs: number): SequenceStatus {
    op.elapsedMs += deltaMs;
    const localMs = op.elapsedMs - op.delayMs;
    if (localMs < 0) return 'running';

    if (op.resolvedFrom === null) {
      try {
        op.resolvedFrom = op.bindingSpecs.map((binding) =>
          binding.from !== undefined ? binding.from : binding.get()
        );
      } catch (error) {
        return this.failTween(op, error, 'binding-get');
      }
    }

    // How many FULL passes' worth of time localMs spans, counted from op's current pass. 0 means
    // still mid-pass (the common case, exactly one update() worth of progress). >=1 means this
    // single call's deltaMs was large enough to fully consume one or more passes (a long-paused
    // tab waking up, or repeat with a small durationMs relative to a frame) — handled below with
    // bounded scalar arithmetic, never a per-pass loop, and never a per-skipped-pass callback
    // (v0.2 has no onRepeat; only the final landed onUpdate this call, and onComplete exactly
    // once if this call's overshoot reaches exhaustion).
    const passesCompleted = Math.floor(localMs / op.durationMs);

    if (passesCompleted === 0) {
      const progress = localMs / op.durationMs;
      const eased = op.ease(progress);
      try {
        this.applyEasedValue(op, eased);
      } catch (error) {
        return this.failTween(op, error, 'binding-set');
      }
      this.invokeUpdateCallback(op, progress);
      return 'running';
    }

    const remainderMs = localMs - passesCompleted * op.durationMs;
    const lastCompletedPassIndex = op.passIndex + passesCompleted - 1;

    if (op.repeat !== Infinity && lastCompletedPassIndex >= op.repeat) {
      // Exhausted partway through this overshoot: the tween ends at the pass whose index equals
      // `repeat`, regardless of how much further overshoot time there was beyond that — any
      // remainder past exhaustion is simply discarded, matching normal (non-overshooting)
      // exhaustion, which also never looks at leftover time.
      const transitionsToExhaustion = op.repeat - op.passIndex; // pass completions from here through `repeat`, inclusive
      if (op.yoyo && transitionsToExhaustion % 2 === 1) {
        op.direction = op.direction === 1 ? -1 : 1;
      }
      try {
        this.snapToPassEnd(op);
      } catch (error) {
        return this.failTween(op, error, 'binding-set');
      }
      // Finalize BEFORE the terminal callback: a reentrant cancel()/cancelScope() triggered from
      // inside onComplete (by this or a sibling operation processed later this same update())
      // must see this operation as already gone, never re-cancellable after it has completed.
      // Map.delete's own return value doubles as the "was this a top-level operation" check: a
      // sequence-owned step (never inserted into `operations`) yields false here, so its own
      // completion is correctly NOT counted as a top-level completedMotions (the sequence itself
      // is counted once, separately, by MotionSequenceRunner via host.removeOperation).
      const wasTopLevel = this.operations.delete(op.id);
      this.invokeUpdateCallback(op, 1);
      this.invokeCallback(op.onComplete, op.kind, 'onComplete');
      if (wasTopLevel) this.completedMotions += 1;
      return 'completed';
    }

    if (remainderMs === 0) {
      // Landed exactly on a pass boundary, not exhausted: render the pass that just finished, at
      // its own end, using the direction that was active DURING that pass — deferring entry into
      // the next pass's own content to a later call, exactly like the ordinary (non-overshooting)
      // single-pass case already does. (Only matters for non-yoyo, where a new pass restarts
      // from `from` rather than continuing from where the previous one ended.)
      const transitionsIntoLastCompleted = passesCompleted - 1;
      if (op.yoyo && transitionsIntoLastCompleted % 2 === 1) {
        op.direction = op.direction === 1 ? -1 : 1;
      }
      try {
        this.snapToPassEnd(op);
      } catch (error) {
        return this.failTween(op, error, 'binding-set');
      }
      op.passIndex = lastCompletedPassIndex + 1;
      op.elapsedMs = op.delayMs;
      if (op.yoyo) op.direction = op.direction === 1 ? -1 : 1; // now entering the next pass
      this.invokeUpdateCallback(op, 1);
      return 'running';
    }

    // Genuine overshoot past the boundary: land directly inside pass `passIndex + passesCompleted`
    // at `remainderMs`, without ever observably stopping at any intermediate pass's endpoint
    // (nothing callback-visible happens there, so nothing needs to be applied there either).
    if (op.yoyo && passesCompleted % 2 === 1) {
      op.direction = op.direction === 1 ? -1 : 1;
    }
    op.passIndex += passesCompleted;
    op.elapsedMs = op.delayMs + remainderMs;
    const progress = remainderMs / op.durationMs; // in (0, 1)
    const eased = op.ease(progress);
    try {
      this.applyEasedValue(op, eased);
    } catch (error) {
      return this.failTween(op, error, 'binding-set');
    }
    this.invokeUpdateCallback(op, progress);
    return 'running';
  }

  advanceDelayFrame(op: RuntimeDelay, deltaMs: number): SequenceStatus {
    op.elapsedMs += deltaMs;
    const progress = clamp01(op.elapsedMs / op.durationMs);
    if (progress < 1) return 'running';
    // Finalize BEFORE onComplete — same reentrancy reasoning as advanceTweenFrame; same
    // wasTopLevel-via-delete-return-value stats guard.
    const wasTopLevel = this.operations.delete(op.id);
    this.invokeCallback(op.onComplete, op.kind, 'onComplete');
    if (wasTopLevel) this.completedMotions += 1;
    return 'completed';
  }

  invokeCallback(
    fn: (() => void) | undefined,
    kind: RuntimeOperation['kind'],
    phase: MotionErrorPhase
  ): void {
    if (!fn) return;
    try {
      fn();
    } catch (error) {
      this.callbackErrors += 1;
      this.reportError(error, kind, phase);
    }
  }

  // --- internal helpers ---

  private buildTweenRecord(options: Omit<MotionTweenOptions, 'scope'>): RuntimeTween {
    const id = this.nextId++;
    const tween: RuntimeTween = {
      id,
      kind: 'tween',
      elapsedMs: 0,
      delayMs: Math.max(0, finiteOr(options.delayMs, 0)),
      durationMs: Math.max(1, finiteOr(options.durationMs, 1)),
      paused: false,
      bindingSpecs: options.bindings,
      resolvedFrom: null,
      ease: resolveEase(options.ease),
      repeat: normalizeRepeat(options.repeat),
      yoyo: options.yoyo ?? false,
      passIndex: 0,
      direction: 1
    };
    if (options.onUpdate) tween.onUpdate = options.onUpdate;
    if (options.onComplete) tween.onComplete = options.onComplete;
    if (options.onCancel) tween.onCancel = options.onCancel;
    return tween;
  }

  private buildDelayRecord(options: Omit<MotionDelayOptions, 'scope'>): RuntimeDelay {
    const id = this.nextId++;
    const delayOp: RuntimeDelay = {
      id,
      kind: 'delay',
      elapsedMs: 0,
      durationMs: Math.max(1, finiteOr(options.durationMs, 1)),
      paused: false
    };
    if (options.onComplete) delayOp.onComplete = options.onComplete;
    if (options.onCancel) delayOp.onCancel = options.onCancel;
    return delayOp;
  }

  // Direct assignment (no lerp) so a true completion lands on the bit-exact `to`/`from` value,
  // never a floating-point-lerp approximation of it.
  private snapToPassEnd(op: RuntimeTween): void {
    for (let i = 0; i < op.bindingSpecs.length; i++) {
      const binding = op.bindingSpecs[i];
      const from = op.resolvedFrom?.[i];
      if (!binding || from === undefined) continue;
      binding.set(op.direction === 1 ? binding.to : from);
    }
  }

  private applyEasedValue(op: RuntimeTween, unit: number): void {
    for (let i = 0; i < op.bindingSpecs.length; i++) {
      const binding = op.bindingSpecs[i];
      const from = op.resolvedFrom?.[i];
      if (!binding || from === undefined) continue;
      const passStart = op.direction === 1 ? from : binding.to;
      const passEnd = op.direction === 1 ? binding.to : from;
      binding.set(lerp(passStart, passEnd, unit));
    }
  }

  private failTween(op: RuntimeTween, error: unknown, phase: MotionErrorPhase): 'cancelled' {
    this.bindingErrors += 1;
    this.reportError(error, op.kind, phase);
    // Finalize BEFORE onCancel, same reasoning as the completion path above; same wasTopLevel
    // stats guard (a step failing inside a sequence must not itself count — the sequence's own
    // cancellation, counted once via MotionSequenceRunner, is what represents this to the host).
    const wasTopLevel = this.operations.delete(op.id);
    this.invokeCallback(op.onCancel, op.kind, 'onCancel');
    if (wasTopLevel) this.cancelledMotions += 1;
    return 'cancelled';
  }

  private cancelOperation(op: RuntimeOperation): void {
    const wasTopLevel = this.operations.delete(op.id);
    if (op.kind === 'sequence' && op.currentStepOperation) {
      this.invokeCallback(op.currentStepOperation.onCancel, op.currentStepOperation.kind, 'onCancel');
    }
    this.invokeCallback(op.onCancel, op.kind, 'onCancel');
    if (wasTopLevel) this.cancelledMotions += 1;
  }

  private invokeUpdateCallback(op: RuntimeTween, progress: number): void {
    if (!op.onUpdate) return;
    try {
      op.onUpdate(progress);
    } catch (error) {
      this.callbackErrors += 1;
      this.reportError(error, op.kind, 'onUpdate');
    }
  }

  private reportError(error: unknown, kind: RuntimeOperation['kind'], phase: MotionErrorPhase): void {
    try {
      this.onMotionError(error, { kind, phase });
    } catch {
      // the error handler itself must never be able to take down update()/cancel()
    }
  }

  private createHandle(id: number): MotionHandle {
    const runtime = this;
    return {
      cancel(): boolean {
        const op = runtime.operations.get(id);
        if (!op) return false;
        runtime.cancelOperation(op);
        return true;
      },
      pause(): boolean {
        const op = runtime.operations.get(id);
        if (!op || op.paused) return false;
        op.paused = true;
        return true;
      },
      resume(): boolean {
        const op = runtime.operations.get(id);
        if (!op || !op.paused) return false;
        op.paused = false;
        return true;
      },
      get active(): boolean {
        return runtime.operations.has(id);
      },
      get paused(): boolean {
        return runtime.operations.get(id)?.paused ?? false;
      }
    };
  }
}
