// Public UiRuntime types. Type-only imports from src/motion/types keep this module free of any
// runtime dependency on MotionRuntime: the driver seam below is satisfied structurally.
import type { EaseFn, EaseName, MotionBinding } from '../motion/types';

export type UiScope = string;

/** The narrow subset of MotionHandle that UI controllers need. */
export interface UiMotionHandle {
  cancel(): boolean;
  readonly active: boolean;
}

/** A strict subset of MotionTweenOptions, so a MotionRuntime instance satisfies UiMotionDriver as-is. */
export interface UiMotionTweenRequest {
  scope: UiScope;
  durationMs: number;
  ease?: EaseName | EaseFn;
  bindings: MotionBinding[];
  onComplete?: () => void;
  onCancel?: () => void;
}

/** The explicit, narrow dependency of UiRuntime on motion. MotionRuntime satisfies it structurally. */
export interface UiMotionDriver {
  tween(request: UiMotionTweenRequest): UiMotionHandle;
  cancelScope(scope: UiScope): number;
}

// --- Button ---

export type ButtonState = 'idle' | 'pressed' | 'disabled';

export type ButtonCancelReason =
  | 'swipe' // pointer travelled beyond tapThreshold, detected on pointerMove or on pointerUp
  | 'outside' // pointerUp(inside = false) within the threshold
  | 'leave' // host reported the pointer left the button
  | 'pointerCancel' // host reported a platform pointer cancel
  | 'disabled' // setEnabled(false) while pressed
  | 'programmatic'; // cancel() while pressed (also cancelScope/cancelAll/dispose and driver-delivered cancellation)

export type ButtonPointerCancelReason = 'leave' | 'pointerCancel';

export interface ButtonControllerOptions {
  id: string;
  /** default true */
  enabled?: boolean;
  /** default 24, in the host's pointer coordinate units; finite and >= 0, else RangeError */
  tapThreshold?: number;
  /** default 80 */
  pressDurationMs?: number;
  /** default 80 */
  releaseDurationMs?: number;
  /** default 'linear' */
  pressEase?: EaseName | EaseFn;
  /** default 'linear' */
  releaseEase?: EaseName | EaseFn;
  onProgress?: (progress: number) => void;
  onPress?: () => void;
  onTap?: () => void;
  onCancel?: (reason: ButtonCancelReason) => void;
}

export interface ButtonController {
  readonly id: string;
  /** 'ui:button:<id>' */
  readonly scope: UiScope;
  readonly state: ButtonState;
  /** 0 = idle, 1 = fully pressed; outside [0, 1] only with an overshooting ease. */
  readonly progress: number;
  readonly enabled: boolean;
  readonly tapThreshold: number;
  readonly disposed: boolean;

  pointerDown(pointerId: number, x: number, y: number): boolean;
  pointerMove(pointerId: number, x: number, y: number): boolean;
  /** x, y are the release position; the distance from the pointerDown origin is checked here too. */
  pointerUp(pointerId: number, x: number, y: number, inside: boolean): boolean;
  pointerCancel(pointerId: number, reason?: ButtonPointerCancelReason): boolean;

  setEnabled(enabled: boolean): void;
  /** Replaces the threshold for every later distance check, including a press already in progress. RangeError on invalid input; the old value stays. */
  setTapThreshold(value: number): void;
  /** Settle: stops any animation, releases the pointer, snaps progress to 0, then reports onCancel('programmatic') if a press was in progress. Also the path taken by cancelScope/cancelAll and dispose. */
  cancel(): boolean;
  dispose(): void;
}

// --- Window ---

export type WindowState = 'hidden' | 'entering' | 'shown' | 'leaving';
export type WindowTransitionPhase = 'entering' | 'leaving';

/** Reasons a host passes to close(). */
export type WindowCloseReason = 'button' | 'background' | 'escape' | 'back' | 'programmatic';
/** What onHidden receives: the close reason, or 'cancelled' for a force-hide (cancel(), cancelScope, cancelAll, dispose). */
export type WindowHiddenReason = WindowCloseReason | 'cancelled';

export interface WindowCloseIntent {
  readonly reason: WindowCloseReason;
  /** the state the close request found the window in */
  readonly state: 'entering' | 'shown';
}

export interface WindowControllerOptions<TParams = void> {
  id: string;
  /** default true */
  blocksGameplay?: boolean;
  /** default 0 (instant) */
  enterDurationMs?: number;
  /** default 0 (instant) */
  leaveDurationMs?: number;
  /** default 'linear' */
  enterEase?: EaseName | EaseFn;
  /** default 'linear' */
  leaveEase?: EaseName | EaseFn;
  /** Mount and apply params. Fires once per show(), before the first onTransition. */
  onShow?: (params: TParams) => void;
  /** Fires with the phase's start value, every intermediate value, and its terminal value. */
  onTransition?: (progress: number, phase: WindowTransitionPhase) => void;
  onShown?: () => void;
  /** Return false to veto. A thrown error is reported and does NOT veto. */
  onBeforeClose?: (intent: WindowCloseIntent) => boolean | void;
  /**
   * View cleanup only: unmount. Fires once on EVERY path to hidden — a completed close and a
   * force-hide alike. Must not run business flow; that belongs to the close() continuation.
   */
  onHidden?: (reason: WindowHiddenReason) => void;
}

export interface WindowController<TParams = void> {
  readonly id: string;
  /** 'ui:window:<id>' */
  readonly scope: UiScope;
  readonly state: WindowState;
  /** 0 = hidden, 1 = shown; outside [0, 1] only with an overshooting ease. */
  readonly progress: number;
  readonly blocksGameplay: boolean;
  readonly disposed: boolean;

  show(params: TParams): boolean;
  /**
   * Close intent. `onClosed` is the business continuation of THIS request: it runs once, after
   * onHidden, only if this close completes. A veto, a force-hide, or a dispose drops it.
   */
  close(reason: WindowCloseReason, onClosed?: () => void): boolean;
  /**
   * Force-hide: no onBeforeClose, no veto, no onClosed; onHidden('cancelled') fires. The path taken
   * by cancelScope/cancelAll/dispose and by a cancellation delivered through the driver.
   */
  cancel(): boolean;
  dispose(): void;
}

// --- Layout ---

export type LayoutOrientation = 'portrait' | 'landscape';

export interface LayoutInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutInput {
  /** viewport units (CSS px in both games); measured, coerced if transiently invalid */
  viewportWidth: number;
  viewportHeight: number;
  /** design units; finite and > 0, else RangeError */
  designWidth: number;
  designHeight: number;
  /** viewport units, missing fields = 0 */
  safeInsets?: Partial<LayoutInsets>;
}

export interface LayoutResult {
  orientation: LayoutOrientation;
  /** design units → viewport units; contain fit */
  scale: number;
  /** viewport-unit position of the design box's top-left corner (letterbox/pillarbox offset, >= 0) */
  offsetX: number;
  offsetY: number;
  /** the whole viewport in design units, relative to the design box origin (x, y <= 0) */
  visibleRect: LayoutRect;
  /** the viewport minus safe insets, in design units, relative to the design box origin */
  safeRect: LayoutRect;
}

// --- Runtime ---

export type UiControllerKind = 'button' | 'window' | 'runtime';

export type UiErrorPhase =
  | 'onProgress'
  | 'onPress'
  | 'onTap'
  | 'onCancel'
  | 'onShow'
  | 'onTransition'
  | 'onShown'
  | 'onBeforeClose'
  | 'onHidden'
  | 'onClosed'
  | 'onBlockingChanged';

export interface UiErrorContext {
  /** 'runtime' for onBlockingChanged */
  kind: UiControllerKind;
  /** controller id, or 'ui' for the runtime itself */
  id: string;
  phase: UiErrorPhase;
}

export type UiErrorHandler = (error: unknown, context: UiErrorContext) => void;

export interface UiRuntimeOptions {
  motion: UiMotionDriver;
  /** Every host callback error lands here. Defaults to a console.error fallback. */
  onUiError?: UiErrorHandler;
  /** Fires only when isBlocking() changes value. */
  onBlockingChanged?: (blocking: boolean) => void;
}

export interface UiRuntimeStats {
  buttons: number;
  windows: number;
  activeWindowId: string | null;
  blocking: boolean;
  presses: number;
  taps: number;
  cancelledPresses: number;
  shows: number;
  rejectedShows: number;
  closes: number;
  vetoedCloses: number;
  rejectedCloses: number;
  forcedHides: number;
  callbackErrors: number;
}
