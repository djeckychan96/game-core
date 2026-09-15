import { resolveEase } from './easing';
import type {
  EaseFn,
  MotionBinding,
  MotionCancelCallback,
  MotionCompleteCallback,
  MotionErrorContext,
  MotionErrorHandler,
  MotionErrorPhase,
  MotionHandle,
  MotionRuntimeOptions,
  MotionTweenOptions,
  MotionUpdateCallback
} from './types';

interface RuntimeTween {
  id: number;
  kind: 'tween';
  elapsedMs: number;
  delayMs: number;
  durationMs: number;
  paused: boolean;
  bindingSpecs: MotionBinding[];
  resolvedFrom: number[] | null;
  ease: EaseFn;
  repeat: number; // 0 = one pass; finite N = N extra passes; Infinity = unbounded
  yoyo: boolean;
  passIndex: number;
  direction: 1 | -1;
  onUpdate?: MotionUpdateCallback;
  onComplete?: MotionCompleteCallback;
  onCancel?: MotionCancelCallback;
}

type RuntimeOperation = RuntimeTween;

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

export class MotionRuntime {
  private readonly operations = new Map<number, RuntimeOperation>();
  private nextId = 1;
  // Reused every update() call so completing operations doesn't allocate a new array per frame.
  private readonly completedScratch: number[] = [];
  private readonly onMotionError: MotionErrorHandler;
  private callbackErrors = 0;
  private bindingErrors = 0;

  constructor(options: MotionRuntimeOptions = {}) {
    this.onMotionError = options.onMotionError ?? defaultOnMotionError;
  }

  tween(options: MotionTweenOptions): MotionHandle {
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

    this.operations.set(id, tween);
    return this.createHandle(id);
  }

  update(frameMs: number): boolean {
    let changed = false;
    const deltaMs = Math.max(0, finiteOr(frameMs, 0));
    this.completedScratch.length = 0;

    for (const op of this.operations.values()) {
      if (op.paused) continue;

      op.elapsedMs += deltaMs;
      const localMs = op.elapsedMs - op.delayMs;
      if (localMs < 0) continue;

      if (op.resolvedFrom === null) {
        try {
          op.resolvedFrom = op.bindingSpecs.map((binding) =>
            binding.from !== undefined ? binding.from : binding.get()
          );
        } catch (error) {
          this.bindingErrors += 1;
          this.reportError(error, op.kind, 'binding-get');
          this.cancelOperation(op);
          continue;
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
        this.bindingErrors += 1;
        this.reportError(error, op.kind, 'binding-set');
        this.cancelOperation(op);
        continue;
      }

      this.invokeUpdateCallback(op, progress);
      changed = true;

      if (progress >= 1) {
        if (op.passIndex < op.repeat) {
          // More passes remain: snap to this pass's exact end, flip direction if yoyo, and let
          // any overshoot carry into the next pass on a later update() call (no per-frame
          // allocation, no same-frame multi-pass loop needed for ordinary frame deltas).
          try {
            for (let i = 0; i < op.bindingSpecs.length; i++) {
              const binding = op.bindingSpecs[i];
              const from = op.resolvedFrom[i];
              if (!binding || from === undefined) continue;
              binding.set(op.direction === 1 ? binding.to : from);
            }
          } catch (error) {
            this.bindingErrors += 1;
            this.reportError(error, op.kind, 'binding-set');
            this.cancelOperation(op);
            continue;
          }
          op.elapsedMs -= op.durationMs;
          op.passIndex += 1;
          if (op.yoyo) op.direction = op.direction === 1 ? -1 : 1;
        } else {
          this.completedScratch.push(op.id);
        }
      }
    }

    for (const id of this.completedScratch) {
      const op = this.operations.get(id);
      if (!op) continue;
      try {
        for (let i = 0; i < op.bindingSpecs.length; i++) {
          const binding = op.bindingSpecs[i];
          const from = op.resolvedFrom?.[i];
          if (!binding || from === undefined) continue;
          binding.set(op.direction === 1 ? binding.to : from);
        }
      } catch (error) {
        this.bindingErrors += 1;
        this.reportError(error, op.kind, 'binding-set');
        this.cancelOperation(op);
        continue;
      }
      this.invokeCallback(op.onComplete, op.kind, 'onComplete');
      this.operations.delete(id);
      changed = true;
    }

    return changed;
  }

  private cancelOperation(op: RuntimeOperation): void {
    this.operations.delete(op.id);
    this.invokeCallback(op.onCancel, op.kind, 'onCancel');
  }

  private invokeCallback(
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
