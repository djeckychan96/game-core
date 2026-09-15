import { resolveEase } from './easing';
import type {
  EaseFn,
  MotionBinding,
  MotionCancelCallback,
  MotionCompleteCallback,
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

export class MotionRuntime {
  private readonly operations = new Map<number, RuntimeOperation>();
  private nextId = 1;

  constructor(_options: MotionRuntimeOptions = {}) {
    // options.onMotionError is wired in a later task (error isolation).
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
      ease: resolveEase(options.ease)
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
    const completedIds: number[] = [];

    for (const op of this.operations.values()) {
      if (op.paused) continue;

      op.elapsedMs += deltaMs;
      const localMs = op.elapsedMs - op.delayMs;
      if (localMs < 0) continue;

      if (op.resolvedFrom === null) {
        op.resolvedFrom = op.bindingSpecs.map((binding) =>
          binding.from !== undefined ? binding.from : binding.get()
        );
      }

      const progress = clamp01(localMs / op.durationMs);
      const eased = op.ease(progress);

      for (let i = 0; i < op.bindingSpecs.length; i++) {
        const binding = op.bindingSpecs[i];
        const from = op.resolvedFrom[i];
        if (!binding || from === undefined) continue;
        binding.set(lerp(from, binding.to, eased));
      }

      op.onUpdate?.(progress);
      changed = true;

      if (progress >= 1) {
        completedIds.push(op.id);
      }
    }

    for (const id of completedIds) {
      const op = this.operations.get(id);
      if (!op) continue;
      for (const binding of op.bindingSpecs) {
        binding.set(binding.to);
      }
      op.onComplete?.();
      this.operations.delete(id);
      changed = true;
    }

    return changed;
  }

  private createHandle(id: number): MotionHandle {
    const runtime = this;
    return {
      cancel(): boolean {
        const op = runtime.operations.get(id);
        if (!op) return false;
        runtime.operations.delete(id);
        op.onCancel?.();
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
