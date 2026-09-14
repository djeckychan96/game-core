import type { FxSurface } from './FxSurface';
import { FxPool } from './FxPool';
import {
  clamp01,
  easeInOutCubic01,
  easeOutCubic01,
  interpolateKeyframes,
  lerp
} from './easing';
import {
  createQuadraticControlPoint,
  quadraticBezierPointInto,
  quadraticBezierTangentAngleInto
} from './trajectories';
import type {
  FxEffectCallback,
  FxEffectCallbackContext,
  FxEffectCallbackPhase,
  FxEffectErrorContext,
  FxEffectErrorHandler,
  FxEffectHandle,
  FxPoint,
  FxPoolKey,
  FxPoolRegistration,
  FxProjectileOptions,
  FxRadialBurstOptions,
  FxRuntimeStats,
  FxScalarKeyframe,
  FxScope
} from './types';

interface FxRuntimeOptions<TNode extends object = object> {
  random?: () => number;
  /**
   * Called whenever a host callback (onImpact/onComplete/onCancel) throws. Defaults to a
   * console.error fallback so failures are never silently swallowed even when FxRuntime is
   * used standalone. Wire this to a shared error boundary (e.g. CoreRuntime.reportError) when
   * this runtime is registered as a CoreRuntime module. This handler itself is never allowed
   * to propagate an exception back into update()/cancel().
   */
  onEffectError?: FxEffectErrorHandler<TNode>;
}

function defaultOnEffectError<TNode extends object>(
  error: unknown,
  context: FxEffectErrorContext<TNode>
): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[FxRuntime] effect callback threw', context, error);
  }
}

type RuntimeEffect<TNode extends object> = ProjectileEffect<TNode> | RadialBurstParticleEffect<TNode>;

interface RuntimeEffectBase<TNode extends object> {
  id: number;
  node: TNode;
  pool: FxPool<TNode>;
  elapsedMs: number;
  delayMs: number;
  durationMs: number;
  started: boolean;
  scope?: FxScope;
}

interface ProjectileEffect<TNode extends object> extends RuntimeEffectBase<TNode> {
  kind: 'projectile';
  from: FxPoint;
  control: FxPoint;
  to: FxPoint;
  impactT: number;
  impactFired: boolean;
  rotationMode: 'none' | 'trajectory' | 'spin';
  startRotation: number;
  endRotation: number;
  startScale: number;
  endScale: number;
  scaleKeyframes: FxScalarKeyframe[];
  alphaBase: number;
  alphaKeyframes: FxScalarKeyframe[];
  onImpact?: (context: FxEffectCallbackContext<TNode>) => void;
  onComplete?: (context: FxEffectCallbackContext<TNode>) => void;
  onCancel?: (context: FxEffectCallbackContext<TNode>) => void;
}

interface RadialBurstParticleEffect<TNode extends object> extends RuntimeEffectBase<TNode> {
  kind: 'radial-burst-particle';
  start: FxPoint;
  end: FxPoint;
  baseScale: number;
  startScale: number;
  endScale: number;
  scaleKeyframes: FxScalarKeyframe[];
  alphaBase: number;
  alphaKeyframes: FxScalarKeyframe[];
}

const defaultProjectileAlphaKeyframes: FxScalarKeyframe[] = [
  { t: 0, value: 1 },
  { t: 1, value: 1 }
];

const defaultBurstAlphaKeyframes: FxScalarKeyframe[] = [
  { t: 0, value: 0, easing: 'linear' },
  { t: 0.1, value: 1, easing: 'linear' },
  { t: 0.65, value: 1, easing: 'linear' },
  { t: 1, value: 0, easing: 'outCubic' }
];

const defaultBurstScaleKeyframes: FxScalarKeyframe[] = [
  { t: 0, value: 0.001 },
  { t: 0.18, value: 1, easing: 'outBackLite' },
  { t: 1, value: 0.6, easing: 'outCubic' }
];

export class FxRuntime<TNode extends object = object> {
  private readonly surface: FxSurface<TNode>;
  private readonly pools = new Map<FxPoolKey, FxPool<TNode>>();
  private readonly effects = new Map<number, RuntimeEffect<TNode>>();
  private readonly random: () => number;
  private readonly onEffectError: FxEffectErrorHandler<TNode>;
  private nextEffectId = 1;
  private droppedEffects = 0;
  private lastUpdateMs = 0;
  private maxUpdateMs = 0;
  private needsRender = false;
  // Reused every applyProjectile() call so trajectory math allocates no {x,y} objects per frame.
  private readonly scratchPoint: FxPoint = { x: 0, y: 0 };
  private readonly scratchDerivative: FxPoint = { x: 0, y: 0 };

  constructor(surface: FxSurface<TNode>, options: FxRuntimeOptions<TNode> = {}) {
    this.surface = surface;
    this.random = options.random ?? Math.random;
    this.onEffectError = options.onEffectError ?? defaultOnEffectError;
  }

  registerPool(key: FxPoolKey, registration: FxPoolRegistration<TNode>): FxPool<TNode> {
    if (this.pools.has(key)) {
      throw new Error(`FxRuntime: a pool registered under key "${key}" already exists`);
    }
    const poolOptions = {
      surface: this.surface,
      createNode: registration.createNode,
      maxSize: registration.maxSize
    };
    const pool = new FxPool(
      registration.prewarm === undefined
        ? poolOptions
        : { ...poolOptions, prewarm: registration.prewarm }
    );
    this.pools.set(key, pool);
    return pool;
  }

  addProjectile(options: FxProjectileOptions<TNode>): FxEffectHandle | null {
    const pool = this.pools.get(options.poolKey);
    if (!pool) {
      this.droppedEffects += 1;
      return null;
    }

    const node = pool.acquire();
    if (!node) {
      this.droppedEffects += 1;
      return null;
    }

    const id = this.nextEffectId++;
    const startScale = finiteOr(options.startScale, 1);
    const endScale = finiteOr(options.endScale, startScale);
    const effect: ProjectileEffect<TNode> = {
      id,
      kind: 'projectile',
      node,
      pool,
      elapsedMs: 0,
      delayMs: Math.max(0, finiteOr(options.delayMs, 0)),
      durationMs: Math.max(1, finiteOr(options.durationMs, 1)),
      started: false,
      from: copyPoint(options.from),
      control: createQuadraticControlPoint(
        options.from,
        options.to,
        finiteOr(options.controlOffsetX, 0),
        finiteOr(options.controlOffsetY, 0)
      ),
      to: copyPoint(options.to),
      impactT: clamp01(finiteOr(options.impactT, 1)),
      impactFired: false,
      rotationMode: options.rotationMode ?? 'none',
      startRotation: finiteOr(options.startRotation, 0),
      endRotation: finiteOr(options.endRotation, finiteOr(options.startRotation, 0)),
      startScale,
      endScale,
      scaleKeyframes: normalizedKeyframes(options.scaleKeyframes),
      alphaBase: finiteOr(options.alpha, 1),
      alphaKeyframes: normalizedKeyframes(options.alphaKeyframes, defaultProjectileAlphaKeyframes)
    };

    if (options.scope !== undefined) effect.scope = options.scope;
    if (options.onImpact) effect.onImpact = options.onImpact;
    if (options.onComplete) effect.onComplete = options.onComplete;
    if (options.onCancel) effect.onCancel = options.onCancel;

    pool.surface.attach(node);
    this.applyProjectile(effect, 0);
    if (effect.delayMs > 0) {
      pool.surface.setVisible(node, false);
    } else {
      effect.started = true;
      pool.surface.setVisible(node, true);
    }
    this.effects.set(id, effect);
    this.needsRender = true;
    return this.createHandle(id);
  }

  addRadialBurst(options: FxRadialBurstOptions): FxEffectHandle[] {
    const pool = this.pools.get(options.poolKey);
    if (!pool) {
      this.droppedEffects += Math.max(0, Math.floor(options.count));
      return [];
    }

    const count = Math.max(0, Math.floor(options.count));
    const handles: FxEffectHandle[] = [];
    const angleOffset = finiteOr(options.angleOffsetRadians, 0);
    const angleJitter = Math.max(0, finiteOr(options.angleJitterRadians, 0));
    const startDistanceMin = Math.max(0, finiteOr(options.startDistanceMin, 0));
    const startDistanceMax = Math.max(startDistanceMin, finiteOr(options.startDistanceMax, startDistanceMin));
    const distanceMin = Math.max(0, finiteOr(options.distanceMin, 0));
    const distanceMax = Math.max(distanceMin, finiteOr(options.distanceMax, distanceMin));
    const durationMinMs = Math.max(1, finiteOr(options.durationMinMs, 1));
    const durationMaxMs = Math.max(durationMinMs, finiteOr(options.durationMaxMs, durationMinMs));
    const scaleMin = Math.max(0.0001, finiteOr(options.scaleMin, 1));
    const scaleMax = Math.max(scaleMin, finiteOr(options.scaleMax, scaleMin));
    const delayMs = Math.max(0, finiteOr(options.delayMs, 0));
    const jitterX = Math.max(0, finiteOr(options.jitterX, 0));
    const jitterY = Math.max(0, finiteOr(options.jitterY, 0));
    const scaleKeyframes = normalizedKeyframes(options.scaleKeyframes, defaultBurstScaleKeyframes);
    const alphaKeyframes = normalizedKeyframes(options.alphaKeyframes, defaultBurstAlphaKeyframes);

    for (let i = 0; i < count; i++) {
      const node = pool.acquire();
      if (!node) {
        this.droppedEffects += 1;
        continue;
      }

      const id = this.nextEffectId++;
      const angleJitterValue = angleJitter > 0 ? randomSigned(this.random) * angleJitter : 0;
      const angle = angleOffset + (Math.PI * 2 * i) / Math.max(1, count) + angleJitterValue;
      const startDistance = lerp(startDistanceMin, startDistanceMax, this.random());
      const distance = lerp(distanceMin, distanceMax, this.random());
      const start = {
        x: options.center.x + Math.cos(angle) * startDistance,
        y: options.center.y + Math.sin(angle) * startDistance
      };
      const end = {
        x: start.x + Math.cos(angle) * distance + randomSigned(this.random) * jitterX,
        y: start.y + Math.sin(angle) * distance + randomSigned(this.random) * jitterY
      };
      const effect: RadialBurstParticleEffect<TNode> = {
        id,
        kind: 'radial-burst-particle',
        node,
        pool,
        elapsedMs: 0,
        delayMs,
        durationMs: lerp(durationMinMs, durationMaxMs, this.random()),
        started: false,
        start,
        end,
        baseScale: lerp(scaleMin, scaleMax, this.random()),
        startScale: finiteOr(options.startScale, 0.001),
        endScale: finiteOr(options.endScale, 0.6),
        scaleKeyframes,
        alphaBase: finiteOr(options.alpha, 1),
        alphaKeyframes
      };

      if (options.scope !== undefined) effect.scope = options.scope;

      pool.surface.attach(node);
      this.applyRadialBurstParticle(effect, 0);
      if (delayMs > 0) {
        pool.surface.setVisible(node, false);
      } else {
        effect.started = true;
        pool.surface.setVisible(node, true);
      }
      this.effects.set(id, effect);
      handles.push(this.createHandle(id));
    }

    if (handles.length > 0) this.needsRender = true;
    return handles;
  }

  update(frameMs: number): boolean {
    const startedAt = readNow();
    let changed = this.needsRender;
    this.needsRender = false;
    const deltaMs = Math.max(0, finiteOr(frameMs, 0));

    if (this.effects.size === 0) {
      this.recordUpdateDuration(startedAt);
      return changed;
    }

    const completedIds: number[] = [];
    for (const effect of this.effects.values()) {
      effect.elapsedMs += deltaMs;
      const localMs = effect.elapsedMs - effect.delayMs;

      if (localMs < 0) {
        continue;
      }

      if (!effect.started) {
        effect.started = true;
        effect.pool.surface.setVisible(effect.node, true);
      }

      const progress = clamp01(localMs / effect.durationMs);
      if (effect.kind === 'projectile') {
        this.applyProjectile(effect, progress);
        if (!effect.impactFired && progress >= effect.impactT) {
          effect.impactFired = true;
          this.invokeEffectCallback(effect, effect.onImpact, 'onImpact', progress);
        }
      } else {
        this.applyRadialBurstParticle(effect, progress);
      }
      changed = true;

      if (progress >= 1) {
        completedIds.push(effect.id);
      }
    }

    for (const id of completedIds) {
      const effect = this.effects.get(id);
      if (!effect) continue;
      if (effect.kind === 'projectile') {
        if (!effect.impactFired) {
          effect.impactFired = true;
          this.invokeEffectCallback(effect, effect.onImpact, 'onImpact', 1);
        }
        this.invokeEffectCallback(effect, effect.onComplete, 'onComplete', 1);
      }
      // Callbacks above never throw past invokeEffectCallback, so cleanup below always runs
      // even if onImpact/onComplete failed.
      this.releaseEffect(effect);
      this.effects.delete(id);
      changed = true;
    }

    this.recordUpdateDuration(startedAt);
    return changed;
  }

  cancelScope(scope: FxScope): number {
    let cancelled = 0;
    for (const effect of Array.from(this.effects.values())) {
      if (effect.scope !== scope) continue;
      if (!this.effects.has(effect.id)) continue; // already cancelled by a reentrant call above
      this.cancelEffect(effect);
      cancelled += 1;
    }
    if (cancelled > 0) this.needsRender = true;
    return cancelled;
  }

  cancelAll(): number {
    let cancelled = 0;
    for (const effect of Array.from(this.effects.values())) {
      if (!this.effects.has(effect.id)) continue; // already cancelled by a reentrant call above
      this.cancelEffect(effect);
      cancelled += 1;
    }
    if (cancelled > 0) this.needsRender = true;
    return cancelled;
  }

  /**
   * Tears down every registered pool's owned nodes (via FxSurface.destroyNode) and clears all
   * active effects. Intended for permanent shutdown, not for routine scene/level transitions
   * (use cancelScope/cancelAll for those, which keep the pools reusable).
   */
  dispose(): void {
    this.cancelAll();
    for (const pool of this.pools.values()) {
      pool.clear();
    }
    this.pools.clear();
  }

  getStats(): FxRuntimeStats {
    let poolAcquires = 0;
    let poolReleases = 0;
    let poolMisses = 0;
    let createdNodes = 0;

    for (const pool of this.pools.values()) {
      const stats = pool.stats();
      poolAcquires += stats.acquires;
      poolReleases += stats.releases;
      poolMisses += stats.misses;
      createdNodes += stats.createdNodes;
    }

    return {
      activeEffects: this.effects.size,
      poolAcquires,
      poolReleases,
      poolMisses,
      createdNodes,
      droppedEffects: this.droppedEffects,
      lastUpdateMs: this.lastUpdateMs,
      maxUpdateMs: this.maxUpdateMs
    };
  }

  resetStats(): void {
    this.droppedEffects = 0;
    this.lastUpdateMs = 0;
    this.maxUpdateMs = 0;
    for (const pool of this.pools.values()) {
      pool.resetStats();
    }
  }

  private applyProjectile(effect: ProjectileEffect<TNode>, progress: number): void {
    const eased = easeInOutCubic01(progress);
    const point = quadraticBezierPointInto(this.scratchPoint, effect.from, effect.control, effect.to, eased);
    const scale = effect.scaleKeyframes.length > 0
      ? interpolateKeyframes(progress, effect.scaleKeyframes, effect.endScale)
      : lerp(effect.startScale, effect.endScale, easeOutCubic01(progress));
    const alpha = effect.alphaBase * interpolateKeyframes(progress, effect.alphaKeyframes, 1);

    effect.pool.surface.setPosition(effect.node, point.x, point.y);
    effect.pool.surface.setScale(effect.node, Math.max(0.0001, scale));
    effect.pool.surface.setAlpha(effect.node, Math.max(0, alpha));
    if (effect.rotationMode === 'trajectory') {
      effect.pool.surface.setRotation(
        effect.node,
        quadraticBezierTangentAngleInto(effect.from, effect.control, effect.to, eased, this.scratchDerivative)
      );
    } else if (effect.rotationMode === 'spin') {
      effect.pool.surface.setRotation(effect.node, lerp(effect.startRotation, effect.endRotation, eased));
    } else {
      effect.pool.surface.setRotation(effect.node, effect.startRotation);
    }
  }

  private applyRadialBurstParticle(effect: RadialBurstParticleEffect<TNode>, progress: number): void {
    const travel = easeOutCubic01(progress);
    const x = lerp(effect.start.x, effect.end.x, travel);
    const y = lerp(effect.start.y, effect.end.y, travel);
    const scaleUnit = effect.scaleKeyframes.length > 0
      ? interpolateKeyframes(progress, effect.scaleKeyframes, effect.endScale)
      : lerp(effect.startScale, effect.endScale, travel);
    const alpha = effect.alphaBase * interpolateKeyframes(progress, effect.alphaKeyframes, 1);

    effect.pool.surface.setPosition(effect.node, x, y);
    effect.pool.surface.setScale(effect.node, Math.max(0.0001, effect.baseScale * scaleUnit));
    effect.pool.surface.setAlpha(effect.node, Math.max(0, alpha));
    effect.pool.surface.setRotation(effect.node, 0);
  }

  private releaseEffect(effect: RuntimeEffect<TNode>): void {
    effect.pool.release(effect.node);
  }

  /**
   * Cancels one effect: removes it from the active map FIRST (so a reentrant cancel of the same
   * id from inside onCancel itself is a safe no-op instead of firing/releasing twice), then fires
   * onCancel (projectile only, never onImpact/onComplete), then always releases the node — even
   * if onCancel threw.
   */
  private cancelEffect(effect: RuntimeEffect<TNode>): void {
    this.effects.delete(effect.id);
    if (effect.kind === 'projectile') {
      this.invokeEffectCallback(effect, effect.onCancel, 'onCancel', this.currentProgress(effect));
    }
    this.releaseEffect(effect);
  }

  private currentProgress(effect: RuntimeEffect<TNode>): number {
    return clamp01((effect.elapsedMs - effect.delayMs) / effect.durationMs);
  }

  private invokeEffectCallback(
    effect: RuntimeEffect<TNode>,
    callback: FxEffectCallback<TNode> | undefined,
    phase: FxEffectCallbackPhase,
    progress: number
  ): void {
    if (!callback) return;
    try {
      callback(createContext(effect, progress));
    } catch (error) {
      this.reportEffectError(error, effect, phase);
    }
  }

  private reportEffectError(error: unknown, effect: RuntimeEffect<TNode>, phase: FxEffectCallbackPhase): void {
    try {
      this.onEffectError(error, { id: effect.id, kind: effect.kind, phase, node: effect.node });
    } catch {
      // the error handler itself must never be able to take down update()/cancel()
    }
  }

  private createHandle(id: number): FxEffectHandle {
    return {
      id,
      cancel: () => {
        const effect = this.effects.get(id);
        if (!effect) return false;
        this.cancelEffect(effect);
        this.needsRender = true;
        return true;
      }
    };
  }

  private recordUpdateDuration(startedAt: number): void {
    const elapsed = Math.max(0, readNow() - startedAt);
    this.lastUpdateMs = elapsed;
    if (elapsed > this.maxUpdateMs) this.maxUpdateMs = elapsed;
  }
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function copyPoint(point: FxPoint): FxPoint {
  return { x: Number(point.x) || 0, y: Number(point.y) || 0 };
}

function normalizedKeyframes(
  keyframes: readonly FxScalarKeyframe[] | undefined,
  fallback: readonly FxScalarKeyframe[] = []
): FxScalarKeyframe[] {
  const source = keyframes ?? fallback;
  return source
    .map((frame) => {
      const normalized: FxScalarKeyframe = {
        t: clamp01(Number(frame.t) || 0),
        value: Number.isFinite(Number(frame.value)) ? Number(frame.value) : 0
      };
      if (frame.easing !== undefined) normalized.easing = frame.easing;
      return normalized;
    })
    .sort((a, b) => a.t - b.t);
}

function randomSigned(random: () => number): number {
  return random() * 2 - 1;
}

function createContext<TNode extends object>(
  effect: RuntimeEffect<TNode>,
  progress: number
): FxEffectCallbackContext<TNode> {
  return {
    id: effect.id,
    node: effect.node,
    elapsedMs: effect.elapsedMs,
    progress
  };
}

function readNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
