import type { EaseFn, EaseName, MotionBinding } from '../motion/types';
import type {
  ButtonCancelReason,
  ButtonController,
  ButtonControllerOptions,
  ButtonPointerCancelReason,
  ButtonState,
  UiMotionHandle,
  UiMotionTweenRequest,
  UiScope
} from './types';
import type { UiHost } from './UiRuntime';

const DEFAULT_TAP_THRESHOLD = 24;
const DEFAULT_DURATION_MS = 80;

function assertThreshold(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`ButtonController: tapThreshold must be a finite number >= 0, got ${String(value)}`);
  }
  return value;
}

/**
 * Internal implementation of ButtonController (spec §7). Owns one number — the press progress —
 * and one tween at a time; never reads a host visual property. Reentrancy is handled by the
 * lifecycle generation (spec §6.1): every method transitions first, then runs its callbacks and
 * stops as soon as a callback moved the generation.
 */
export class ButtonControllerImpl implements ButtonController {
  readonly id: string;
  readonly scope: UiScope;
  private stateValue: ButtonState;
  private progressValue = 0;
  private enabledValue: boolean;
  private tapThresholdValue: number;
  private disposedValue = false;

  private ownerPointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private generation = 0;
  private tweenGeneration = -1;
  private target = 0;
  private handle: UiMotionHandle | null = null;

  private readonly pressDurationMs: number;
  private readonly releaseDurationMs: number;
  private readonly pressEase: EaseName | EaseFn;
  private readonly releaseEase: EaseName | EaseFn;
  private readonly onProgress: ((progress: number) => void) | null;
  private readonly onPress: (() => void) | null;
  private readonly onTap: (() => void) | null;
  private readonly onCancel: ((reason: ButtonCancelReason) => void) | null;

  // Preallocated once; `to` and the request's duration/ease are mutated before each tween.
  private readonly binding: MotionBinding;
  private readonly bindings: MotionBinding[];
  private readonly request: UiMotionTweenRequest;

  constructor(private readonly host: UiHost, options: ButtonControllerOptions) {
    this.id = options.id;
    this.scope = `ui:button:${options.id}`;
    this.enabledValue = options.enabled ?? true;
    this.stateValue = this.enabledValue ? 'idle' : 'disabled';
    this.tapThresholdValue = assertThreshold(options.tapThreshold ?? DEFAULT_TAP_THRESHOLD);
    this.pressDurationMs = options.pressDurationMs ?? DEFAULT_DURATION_MS;
    this.releaseDurationMs = options.releaseDurationMs ?? DEFAULT_DURATION_MS;
    this.pressEase = options.pressEase ?? 'linear';
    this.releaseEase = options.releaseEase ?? 'linear';
    this.onProgress = options.onProgress ?? null;
    this.onPress = options.onPress ?? null;
    this.onTap = options.onTap ?? null;
    this.onCancel = options.onCancel ?? null;

    this.binding = {
      get: () => this.progressValue,
      set: (value: number) => this.setProgress(value),
      to: 0
    };
    this.bindings = [this.binding];
    this.request = {
      scope: this.scope,
      durationMs: DEFAULT_DURATION_MS,
      ease: 'linear',
      bindings: this.bindings,
      onComplete: () => this.onTweenComplete(),
      onCancel: () => this.onTweenCancel()
    };
  }

  get state(): ButtonState {
    return this.stateValue;
  }

  get progress(): number {
    return this.progressValue;
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  get tapThreshold(): number {
    return this.tapThresholdValue;
  }

  get disposed(): boolean {
    return this.disposedValue;
  }

  // --- pointer input ---

  pointerDown(pointerId: number, x: number, y: number): boolean {
    if (this.disposedValue || this.stateValue === 'disabled' || this.ownerPointerId !== null) return false;
    this.ownerPointerId = pointerId;
    this.originX = x;
    this.originY = y;
    this.stateValue = 'pressed';
    this.generation += 1;
    const gen = this.generation;
    this.host.stats.presses += 1;
    this.animateTo(1, this.pressDurationMs, this.pressEase);
    if (this.generation !== gen) return true;
    this.callPress();
    return true;
  }

  pointerMove(pointerId: number, x: number, y: number): boolean {
    if (this.ownerPointerId !== pointerId) return false;
    if (this.distanceFromOrigin(x, y) > this.tapThresholdValue) this.endPress('swipe');
    return true;
  }

  pointerUp(pointerId: number, x: number, y: number, inside: boolean): boolean {
    if (this.ownerPointerId !== pointerId) return false;
    if (this.distanceFromOrigin(x, y) > this.tapThresholdValue) this.endPress('swipe');
    else if (inside) this.endPress('tap');
    else this.endPress('outside');
    return true;
  }

  pointerCancel(pointerId: number, reason: ButtonPointerCancelReason = 'pointerCancel'): boolean {
    if (this.ownerPointerId !== pointerId) return false;
    this.endPress(reason);
    return true;
  }

  // --- configuration ---

  setEnabled(enabled: boolean): void {
    if (this.disposedValue) return;
    this.enabledValue = enabled;
    if (!enabled) {
      if (this.stateValue === 'pressed') {
        this.endPress('disabled');
      } else if (this.stateValue !== 'disabled') {
        this.stateValue = 'disabled';
        this.generation += 1;
      }
      return;
    }
    if (this.stateValue === 'disabled') {
      this.stateValue = 'idle';
      this.generation += 1;
    }
  }

  setTapThreshold(value: number): void {
    this.tapThresholdValue = assertThreshold(value);
  }

  // --- settle and dispose ---

  /**
   * Settle (spec §7.5): the one path for every cancellation that does not come from the pointer —
   * the host's cancel(), cancelScope/cancelAll, a cancellation delivered through the driver, dispose().
   */
  cancel(): boolean {
    if (this.disposedValue) return false;
    const wasPressed = this.stateValue === 'pressed';
    if (!wasPressed && this.handle === null && this.progressValue === 0) return false;
    this.ownerPointerId = null;
    this.stateValue = this.enabledValue ? 'idle' : 'disabled';
    this.generation += 1;
    const gen = this.generation;
    this.dropHandle();
    this.setProgress(0);
    if (this.generation !== gen) return true;
    if (wasPressed) {
      this.host.stats.cancelledPresses += 1;
      this.callCancel('programmatic');
    }
    return true;
  }

  dispose(): void {
    if (this.disposedValue) return;
    this.cancel();
    if (this.disposedValue) return; // a callback of cancel() disposed us reentrantly
    this.ownerPointerId = null;
    this.generation += 1;
    this.disposedValue = true;
    this.dropHandle();
    this.host.motion.cancelScope(this.scope);
    this.host.unregisterButton(this.id);
  }

  // --- internals ---

  /** Ends a press with `outcome` (spec §7.5): transition, release animation, then the one callback. */
  private endPress(outcome: 'tap' | ButtonCancelReason): void {
    this.ownerPointerId = null;
    this.stateValue = outcome === 'disabled' ? 'disabled' : 'idle';
    this.generation += 1;
    const gen = this.generation;
    if (outcome === 'tap') this.host.stats.taps += 1;
    else this.host.stats.cancelledPresses += 1;
    this.animateTo(0, this.releaseDurationMs, this.releaseEase);
    if (this.generation !== gen) return;
    if (outcome === 'tap') this.callTap();
    else this.callCancel(outcome);
  }

  /** Callers have already incremented the generation, so the replaced tween's onCancel is stale. */
  private animateTo(target: number, durationMs: number, ease: EaseName | EaseFn): void {
    this.dropHandle();
    if (durationMs <= 0 || this.progressValue === target) {
      this.setProgress(target);
      return;
    }
    this.binding.to = target;
    this.request.durationMs = durationMs;
    this.request.ease = ease;
    this.target = target;
    this.tweenGeneration = this.generation;
    this.handle = this.host.motion.tween(this.request);
  }

  private dropHandle(): void {
    const handle = this.handle;
    if (handle === null) return;
    this.handle = null;
    handle.cancel();
  }

  private onTweenComplete(): void {
    if (this.tweenGeneration !== this.generation) return;
    this.handle = null;
    if (this.progressValue !== this.target) this.setProgress(this.target);
  }

  /** A current-generation onCancel means the driver cancelled the tween from outside: settle (spec §7.7). */
  private onTweenCancel(): void {
    if (this.tweenGeneration !== this.generation) return;
    this.cancel();
  }

  private setProgress(value: number): void {
    if (value === this.progressValue) return;
    this.progressValue = value;
    this.callProgress(value);
  }

  private distanceFromOrigin(x: number, y: number): number {
    const dx = x - this.originX;
    const dy = y - this.originY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --- guarded host callbacks (one per phase; no rest parameters on the progress path) ---

  private callProgress(value: number): void {
    if (this.onProgress === null) return;
    try {
      this.onProgress(value);
    } catch (error) {
      this.host.reportError('button', this.id, 'onProgress', error);
    }
  }

  private callPress(): void {
    if (this.onPress === null) return;
    try {
      this.onPress();
    } catch (error) {
      this.host.reportError('button', this.id, 'onPress', error);
    }
  }

  private callTap(): void {
    if (this.onTap === null) return;
    try {
      this.onTap();
    } catch (error) {
      this.host.reportError('button', this.id, 'onTap', error);
    }
  }

  private callCancel(reason: ButtonCancelReason): void {
    if (this.onCancel === null) return;
    try {
      this.onCancel(reason);
    } catch (error) {
      this.host.reportError('button', this.id, 'onCancel', error);
    }
  }
}
