export type FxPoolKey = string;
export type FxScope = string;

export interface FxPoint {
  x: number;
  y: number;
}

export type FxEasingName = 'linear' | 'inOutCubic' | 'outCubic' | 'outBackLite';

export interface FxScalarKeyframe {
  t: number;
  value: number;
  easing?: FxEasingName;
}

export interface FxEffectCallbackContext<TNode extends object> {
  id: number;
  node: TNode;
  elapsedMs: number;
  progress: number;
}

export type FxEffectCallback<TNode extends object> = (context: FxEffectCallbackContext<TNode>) => void;

export type FxEffectKind = 'projectile' | 'radial-burst-particle';

export type FxEffectCallbackPhase = 'onImpact' | 'onComplete' | 'onCancel';

export interface FxEffectErrorContext<TNode extends object> {
  id: number;
  kind: FxEffectKind;
  phase: FxEffectCallbackPhase;
  node: TNode;
}

export type FxEffectErrorHandler<TNode extends object> = (
  error: unknown,
  context: FxEffectErrorContext<TNode>
) => void;

export interface FxProjectileOptions<TNode extends object> {
  poolKey: FxPoolKey;
  from: FxPoint;
  to: FxPoint;
  durationMs: number;
  delayMs?: number;
  controlOffsetX?: number;
  controlOffsetY?: number;
  impactT?: number;
  rotationMode?: 'none' | 'trajectory' | 'spin';
  startRotation?: number;
  endRotation?: number;
  startScale?: number;
  endScale?: number;
  scaleKeyframes?: FxScalarKeyframe[];
  alpha?: number;
  alphaKeyframes?: FxScalarKeyframe[];
  onImpact?: FxEffectCallback<TNode>;
  onComplete?: FxEffectCallback<TNode>;
  /** Fires exactly once if the effect is cancelled (handle.cancel/cancelScope/cancelAll) instead of completing normally. Never fires together with onComplete for the same effect. */
  onCancel?: FxEffectCallback<TNode>;
  scope?: FxScope;
}

export interface FxRadialBurstOptions {
  poolKey: FxPoolKey;
  center: FxPoint;
  count: number;
  distanceMin: number;
  distanceMax: number;
  durationMinMs: number;
  durationMaxMs: number;
  delayMs?: number;
  startDistanceMin?: number;
  startDistanceMax?: number;
  angleOffsetRadians?: number;
  angleJitterRadians?: number;
  jitterX?: number;
  jitterY?: number;
  scaleMin?: number;
  scaleMax?: number;
  startScale?: number;
  endScale?: number;
  scaleKeyframes?: FxScalarKeyframe[];
  alpha?: number;
  alphaKeyframes?: FxScalarKeyframe[];
  scope?: FxScope;
}

export interface FxPoolRegistration<TNode extends object> {
  createNode: () => TNode;
  maxSize: number;
  prewarm?: number;
}

export interface FxEffectHandle {
  id: number;
  cancel: () => boolean;
}

export interface FxRuntimeStats {
  activeEffects: number;
  poolAcquires: number;
  poolReleases: number;
  poolMisses: number;
  createdNodes: number;
  droppedEffects: number;
  lastUpdateMs: number;
  maxUpdateMs: number;
}
