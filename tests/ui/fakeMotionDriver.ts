import { vi } from 'vitest';
import { resolveEase } from '../../src/motion/easing';
import type { EaseFn, MotionBinding } from '../../src/motion/types';
import type { UiMotionDriver, UiMotionHandle, UiMotionTweenRequest, UiScope } from '../../src/ui/types';

interface FakeTween {
  scope: UiScope;
  durationMs: number;
  ease: EaseFn;
  bindings: MotionBinding[];
  onComplete: (() => void) | undefined;
  onCancel: (() => void) | undefined;
  elapsed: number;
  from: number[] | null;
  active: boolean;
}

/**
 * A UiMotionDriver that obeys the seven contract rules of spec §5 and is driven manually through
 * advance(ms). It copies every request field at tween() time (the controllers reuse and mutate
 * their request object, exactly like MotionRuntime copies fields), fires onCancel synchronously
 * inside cancel()/cancelScope()/cancelAll(), returns false from a dead handle's cancel(), and
 * tolerates reentrant tween()/cancel() calls from inside its own callbacks.
 */
export class FakeMotionDriver implements UiMotionDriver {
  readonly requests: UiMotionTweenRequest[] = [];
  readonly bindingArrays: MotionBinding[][] = [];
  readonly pauseScope = vi.fn((_scope: UiScope) => 0);
  readonly resumeScope = vi.fn((_scope: UiScope) => 0);
  private readonly tweens: FakeTween[] = [];
  private readonly recorded: FakeTween[] = [];

  get activeCount(): number {
    return this.tweens.length;
  }

  get lastTween(): FakeTween | undefined {
    return this.recorded[this.recorded.length - 1];
  }

  tween(request: UiMotionTweenRequest): UiMotionHandle {
    this.requests.push({ ...request });
    this.bindingArrays.push(request.bindings);
    const tween: FakeTween = {
      scope: request.scope,
      durationMs: request.durationMs,
      ease: resolveEase(request.ease),
      bindings: request.bindings,
      onComplete: request.onComplete,
      onCancel: request.onCancel,
      elapsed: 0,
      from: null,
      active: true
    };
    this.tweens.push(tween);
    this.recorded.push(tween);
    return {
      cancel: () => this.cancelTween(tween),
      get active() {
        return tween.active;
      }
    };
  }

  cancelScope(scope: UiScope): number {
    let count = 0;
    for (const tween of [...this.tweens]) {
      if (tween.scope !== scope) continue;
      if (this.cancelTween(tween)) count += 1;
    }
    return count;
  }

  cancelAll(): number {
    let count = 0;
    for (const tween of [...this.tweens]) {
      if (this.cancelTween(tween)) count += 1;
    }
    return count;
  }

  advance(ms: number): void {
    for (const tween of [...this.tweens]) {
      if (!tween.active) continue;
      if (tween.from === null) tween.from = tween.bindings.map((binding) => binding.get());
      tween.elapsed += ms;
      const progress = Math.min(1, tween.elapsed / tween.durationMs);
      const eased = tween.ease(progress);
      for (let i = 0; i < tween.bindings.length; i++) {
        const binding = tween.bindings[i];
        const from = tween.from[i];
        if (!binding || from === undefined) continue;
        binding.set(progress === 1 ? binding.to : from + (binding.to - from) * eased);
      }
      if (progress === 1 && tween.active) {
        this.remove(tween);
        tween.onComplete?.();
      }
    }
  }

  /** Replays the recorded onComplete of the request at `index` — a stale completion the controller must ignore. */
  replayComplete(index: number): void {
    const tween = this.recorded[index];
    if (!tween) throw new Error(`no recorded tween at index ${index}`);
    tween.onComplete?.();
  }

  private cancelTween(tween: FakeTween): boolean {
    if (!tween.active) return false;
    this.remove(tween);
    tween.onCancel?.();
    return true;
  }

  private remove(tween: FakeTween): void {
    tween.active = false;
    const index = this.tweens.indexOf(tween);
    if (index >= 0) this.tweens.splice(index, 1);
  }
}
