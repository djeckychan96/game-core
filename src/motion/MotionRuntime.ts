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
  MotionScope,
  MotionSequenceOptions,
  MotionSequenceStep,
  MotionTweenOptions,
  MotionUpdateCallback
} from './types';

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
  // Reused every update() call so completing/cancelled operations don't allocate a new array
  // per frame; update() only ever needs it to remember which top-level ids to delete afterward.
  private readonly completedScratch: number[] = [];
  private readonly onMotionError: MotionErrorHandler;
  private callbackErrors = 0;
  private bindingErrors = 0;

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
    let changed = false;
    const deltaMs = Math.max(0, finiteOr(frameMs, 0));
    this.completedScratch.length = 0;

    for (const op of this.operations.values()) {
      if (op.paused) continue;

      if (op.kind === 'tween') {
        const result = this.advanceTweenFrame(op, deltaMs);
        changed = true;
        if (result !== 'running') this.completedScratch.push(op.id);
        continue;
      }

      if (op.kind === 'delay') {
        const result = this.advanceDelayFrame(op, deltaMs);
        if (result !== 'running') this.completedScratch.push(op.id);
        continue;
      }

      // sequence
      const result = advanceSequence(op, deltaMs, this);
      changed = true;
      if (result !== 'running') this.completedScratch.push(op.id);
    }

    for (const id of this.completedScratch) {
      this.operations.delete(id);
    }

    return changed;
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

    const progress = clamp01(localMs / op.durationMs);
    const eased = op.ease(progress);

    try {
      for (let i = 0; i < op.bindingSpecs.length; i++) {
        const binding = op.bindingSpecs[i];
        const from = op.resolvedFrom[i];
        if (!binding || from === undefined) continue;
        const passStart = op.direction === 1 ? from : binding.to;
        const passEnd = op.direction === 1 ? binding.to : from;
        binding.set(lerp(passStart, passEnd, eased));
      }
    } catch (error) {
      return this.failTween(op, error, 'binding-set');
    }

    this.invokeUpdateCallback(op, progress);

    if (progress < 1) return 'running';

    if (op.passIndex < op.repeat) {
      // More passes remain: snap to this pass's exact end, flip direction if yoyo, and let any
      // overshoot carry into the next pass on a later update()/advance call (no per-frame
      // allocation, no same-frame multi-pass loop needed for ordinary frame deltas).
      try {
        this.snapToPassEnd(op);
      } catch (error) {
        return this.failTween(op, error, 'binding-set');
      }
      op.elapsedMs -= op.durationMs;
      op.passIndex += 1;
      if (op.yoyo) op.direction = op.direction === 1 ? -1 : 1;
      return 'running';
    }

    try {
      this.snapToPassEnd(op);
    } catch (error) {
      return this.failTween(op, error, 'binding-set');
    }
    this.invokeCallback(op.onComplete, op.kind, 'onComplete');
    return 'completed';
  }

  advanceDelayFrame(op: RuntimeDelay, deltaMs: number): SequenceStatus {
    op.elapsedMs += deltaMs;
    const progress = clamp01(op.elapsedMs / op.durationMs);
    if (progress < 1) return 'running';
    this.invokeCallback(op.onComplete, op.kind, 'onComplete');
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

  private snapToPassEnd(op: RuntimeTween): void {
    for (let i = 0; i < op.bindingSpecs.length; i++) {
      const binding = op.bindingSpecs[i];
      const from = op.resolvedFrom?.[i];
      if (!binding || from === undefined) continue;
      binding.set(op.direction === 1 ? binding.to : from);
    }
  }

  private failTween(op: RuntimeTween, error: unknown, phase: MotionErrorPhase): 'cancelled' {
    this.bindingErrors += 1;
    this.reportError(error, op.kind, phase);
    this.invokeCallback(op.onCancel, op.kind, 'onCancel');
    return 'cancelled';
  }

  private cancelOperation(op: RuntimeOperation): void {
    this.operations.delete(op.id);
    if (op.kind === 'sequence' && op.currentStepOperation) {
      this.invokeCallback(op.currentStepOperation.onCancel, op.currentStepOperation.kind, 'onCancel');
    }
    this.invokeCallback(op.onCancel, op.kind, 'onCancel');
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
