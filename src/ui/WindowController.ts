import type { EaseFn, EaseName, MotionBinding } from '../motion/types';
import type {
  UiMotionHandle,
  UiMotionTweenRequest,
  UiScope,
  WindowCloseIntent,
  WindowCloseReason,
  WindowController,
  WindowControllerOptions,
  WindowHiddenReason,
  WindowState,
  WindowTransitionPhase
} from './types';
import type { UiHost } from './UiRuntime';

/**
 * Internal implementation of WindowController (spec §8). Owns one number — the transition
 * progress — and one tween at a time. `onHidden` is view cleanup and fires on every path to
 * hidden; the business continuation passed to close() runs only when that close completes.
 * Reentrancy is handled by the lifecycle generation (spec §6.1).
 */
export class WindowControllerImpl<TParams> implements WindowController<TParams> {
  readonly id: string;
  readonly scope: UiScope;
  readonly blocksGameplay: boolean;
  private stateValue: WindowState = 'hidden';
  private progressValue = 0;
  private disposedValue = false;

  private generation = 0;
  private tweenGeneration = -1;
  private target = 0;
  private handle: UiMotionHandle | null = null;
  private phase: WindowTransitionPhase = 'entering';
  private evaluatingClose = false;
  private pendingOnClosed: (() => void) | null = null;
  private pendingReason: WindowCloseReason = 'programmatic';

  private readonly enterDurationMs: number;
  private readonly leaveDurationMs: number;
  private readonly enterEase: EaseName | EaseFn;
  private readonly leaveEase: EaseName | EaseFn;
  private readonly onShow: ((params: TParams) => void) | null;
  private readonly onTransition: ((progress: number, phase: WindowTransitionPhase) => void) | null;
  private readonly onShown: (() => void) | null;
  private readonly onBeforeClose: ((intent: WindowCloseIntent) => boolean | void) | null;
  private readonly onHidden: ((reason: WindowHiddenReason) => void) | null;

  // Preallocated once; `to` and the request's duration/ease are mutated before each tween.
  private readonly binding: MotionBinding;
  private readonly bindings: MotionBinding[];
  private readonly request: UiMotionTweenRequest;

  constructor(private readonly host: UiHost, options: WindowControllerOptions<TParams>) {
    this.id = options.id;
    this.scope = `ui:window:${options.id}`;
    this.blocksGameplay = options.blocksGameplay ?? true;
    this.enterDurationMs = options.enterDurationMs ?? 0;
    this.leaveDurationMs = options.leaveDurationMs ?? 0;
    this.enterEase = options.enterEase ?? 'linear';
    this.leaveEase = options.leaveEase ?? 'linear';
    this.onShow = options.onShow ?? null;
    this.onTransition = options.onTransition ?? null;
    this.onShown = options.onShown ?? null;
    this.onBeforeClose = options.onBeforeClose ?? null;
    this.onHidden = options.onHidden ?? null;

    this.binding = {
      get: () => this.progressValue,
      set: (value: number) => this.setProgress(value),
      to: 0
    };
    this.bindings = [this.binding];
    this.request = {
      scope: this.scope,
      durationMs: 1,
      ease: 'linear',
      bindings: this.bindings,
      onComplete: () => this.onTweenComplete(),
      onCancel: () => this.onTweenCancel()
    };
  }

  get state(): WindowState {
    return this.stateValue;
  }

  get progress(): number {
    return this.progressValue;
  }

  get disposed(): boolean {
    return this.disposedValue;
  }

  // --- show ---

  show(params: TParams): boolean {
    if (this.disposedValue || this.stateValue !== 'hidden' || this.host.activeWindowImpl !== null) {
      this.host.stats.rejectedShows += 1;
      return false;
    }
    this.host.activeWindowImpl = this;
    this.stateValue = 'entering';
    this.progressValue = 0;
    this.generation += 1;
    const gen = this.generation;
    this.host.stats.shows += 1;

    this.callShow(params);
    if (this.generation !== gen) return true;
    this.host.recomputeBlocking();
    if (this.generation !== gen) return true;
    this.callTransition(0, 'entering');
    if (this.generation !== gen) return true;

    this.phase = 'entering';
    this.animateTo(1, this.enterDurationMs, this.enterEase);
    if (this.generation !== gen) return true;
    if (this.handle === null) this.becomeShown();
    return true;
  }

  // --- close intent ---

  close(reason: WindowCloseReason, onClosed?: () => void): boolean {
    if (
      this.disposedValue ||
      this.stateValue === 'hidden' ||
      this.stateValue === 'leaving' ||
      this.evaluatingClose
    ) {
      this.host.stats.rejectedCloses += 1;
      return false;
    }

    const intent: WindowCloseIntent = { reason, state: this.stateValue };
    const gen = this.generation;
    this.evaluatingClose = true;
    let vetoed = false;
    if (this.onBeforeClose !== null) {
      try {
        vetoed = this.onBeforeClose(intent) === false;
      } catch (error) {
        // fail-open: a veto that happens by accident would leave a stuck modal
        this.host.reportError('window', this.id, 'onBeforeClose', error);
      }
    }
    this.evaluatingClose = false;
    if (vetoed) {
      this.host.stats.vetoedCloses += 1;
      return false;
    }
    if (this.generation !== gen) return false;

    this.stateValue = 'leaving';
    this.generation += 1;
    const gen2 = this.generation;
    this.host.stats.closes += 1;
    this.pendingOnClosed = onClosed ?? null;
    this.pendingReason = reason;
    this.dropHandle();

    this.callTransition(this.progressValue, 'leaving');
    if (this.generation !== gen2) return true;
    this.phase = 'leaving';
    this.animateTo(0, this.leaveDurationMs, this.leaveEase);
    if (this.generation !== gen2) return true;
    if (this.handle === null) this.finalizeHidden(reason);
    return true;
  }

  // --- force-hide (spec §8.4) ---

  cancel(): boolean {
    if (this.disposedValue || this.stateValue === 'hidden') return false;
    this.stateValue = 'hidden';
    this.progressValue = 0;
    if (this.host.activeWindowImpl === this) this.host.activeWindowImpl = null;
    this.generation += 1;
    this.dropHandle();
    this.pendingOnClosed = null;
    this.host.stats.forcedHides += 1;
    this.callHidden('cancelled');
    this.host.recomputeBlocking();
    return true;
  }

  dispose(): void {
    if (this.disposedValue) return;
    this.cancel();
    if (this.disposedValue) return; // a callback of cancel() disposed us reentrantly
    this.generation += 1;
    this.disposedValue = true;
    this.dropHandle();
    this.host.motion.cancelScope(this.scope);
    this.host.unregisterWindow(this.id);
  }

  // --- internals ---

  private becomeShown(): void {
    this.stateValue = 'shown';
    this.generation += 1;
    this.callShown();
  }

  /** Finalize hidden (spec §8.4): view cleanup, then the continuation of the completed close, then blocking. */
  private finalizeHidden(reason: WindowCloseReason): void {
    this.stateValue = 'hidden';
    this.progressValue = 0;
    if (this.host.activeWindowImpl === this) this.host.activeWindowImpl = null;
    this.generation += 1;
    const continuation = this.pendingOnClosed;
    this.pendingOnClosed = null;

    this.callHidden(reason);
    if (continuation !== null && !this.disposedValue) this.callClosed(continuation);
    this.host.recomputeBlocking();
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

  /** Same stale-callback rule as ButtonController: stale generation, or the current tween is still active. */
  private isStaleDriverCallback(): boolean {
    if (this.tweenGeneration !== this.generation) return true;
    return this.handle !== null && this.handle.active;
  }

  private onTweenComplete(): void {
    if (this.isStaleDriverCallback()) return;
    this.handle = null;
    const gen = this.generation;
    if (this.progressValue !== this.target) this.setProgress(this.target);
    if (this.generation !== gen) return;
    if (this.phase === 'entering') this.becomeShown();
    else this.finalizeHidden(this.pendingReason);
  }

  /** A current-generation onCancel means the driver cancelled the tween from outside: force-hide (spec §8.8). */
  private onTweenCancel(): void {
    if (this.isStaleDriverCallback()) return;
    this.cancel();
  }

  private setProgress(value: number): void {
    if (value === this.progressValue) return;
    this.progressValue = value;
    this.callTransition(value, this.phase);
  }

  // --- guarded host callbacks (one per phase; no rest parameters on the transition path) ---

  private callShow(params: TParams): void {
    if (this.onShow === null) return;
    try {
      this.onShow(params);
    } catch (error) {
      this.host.reportError('window', this.id, 'onShow', error);
    }
  }

  private callTransition(progress: number, phase: WindowTransitionPhase): void {
    if (this.onTransition === null) return;
    try {
      this.onTransition(progress, phase);
    } catch (error) {
      this.host.reportError('window', this.id, 'onTransition', error);
    }
  }

  private callShown(): void {
    if (this.onShown === null) return;
    try {
      this.onShown();
    } catch (error) {
      this.host.reportError('window', this.id, 'onShown', error);
    }
  }

  private callHidden(reason: WindowHiddenReason): void {
    if (this.onHidden === null) return;
    try {
      this.onHidden(reason);
    } catch (error) {
      this.host.reportError('window', this.id, 'onHidden', error);
    }
  }

  private callClosed(continuation: () => void): void {
    try {
      continuation();
    } catch (error) {
      this.host.reportError('window', this.id, 'onClosed', error);
    }
  }
}
