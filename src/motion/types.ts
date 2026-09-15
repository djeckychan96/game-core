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
  /** 0 = one pass (default); a finite N = N extra passes after the first; Infinity = unbounded. */
  repeat?: number;
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

export type MotionErrorPhase = 'onUpdate' | 'onComplete' | 'onCancel' | 'binding-get' | 'binding-set' | 'ease';

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
  /** Caught lifecycle callback and custom easing exceptions. */
  callbackErrors: number;
  bindingErrors: number;
}

export interface MotionRuntimeOptions {
  onMotionError?: MotionErrorHandler;
}
