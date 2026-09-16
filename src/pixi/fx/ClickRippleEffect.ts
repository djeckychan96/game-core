import { type BLEND_MODES, Container, Graphics, Matrix } from 'pixi.js';
import type { EaseFn, EaseName, MotionHandle, MotionRuntime } from '../../index';
import { resolveFxEase } from './easing';

/**
 * Look and timing of the click ripple. Every field is configurable; the defaults ARE the
 * production "ocean" of Trail Arrow (`ArrowRenderer.spawnOceanRipple`): two white rings with
 * phases 0 and 0.18, radius 10 → 56 px, width 3 → 1.2 px, alpha 0.6 → 0, linear, 620 ms in
 * total, no halo, normal blending, at most 8 ripples, constant size on screen under world zoom.
 */
export interface ClickRippleConfig {
  /**
   * Normalized start phase of every ring, each in [0, 1). Over the ripple's lifetime t ∈ [0, 1]
   * ring i runs k = clamp((t − phase_i) / (1 − phase_i)): a later phase starts later but every
   * ring ends together at t = 1. The array length is the number of rings (≥ 1).
   */
  ringPhases: ReadonlyArray<number>;
  /** Radius a ring starts at, in px (see `sizeSpace`). */
  startRadius: number;
  /** Radius a ring ends at, in px (see `sizeSpace`). */
  endRadius: number;
  /** Total lifetime of a ripple in ms (> 0); every ring has faded by then. */
  durationMs: number;
  /** Stroke width at the start of a ring's life. */
  lineWidth: number;
  /** Stroke width at the end of a ring's life (a thinning line reads as a fading wave). */
  lineWidthEnd: number;
  /** Ring color. */
  color: number;
  /** Peak alpha of the first ring (0..1). */
  alpha: number;
  /** Each later ring peaks at the previous ring's alpha × this factor (0..1). */
  ringAlphaDecay: number;
  /** Radius (and stroke width) interpolation curve. */
  radiusEase: EaseName | EaseFn;
  /** Fade curve: alpha = peak × (1 − alphaEase(t)); `easeIn` holds bright, then fades. */
  alphaEase: EaseName | EaseFn;
  /** A wider, darker stroke drawn under the ring so it still reads on a light background. */
  haloColor: number;
  /** 0 disables the halo. */
  haloAlpha: number;
  /** How far the halo extends beyond the ring on each side, in local px. */
  haloWidth: number;
  blendMode: BLEND_MODES;
  /** Concurrent ripples cap: spawning past it recycles the oldest ripple (never the newest tap). */
  maxActive: number;
  /**
   * `screen`: radii and widths are screen px — every frame the effect divides them by its own
   * world scale (all ancestors included), so a ripple keeps the same on-screen size whether the
   * effect sits in a zoomed world or in a contain-fit UI layer. `local`: plain local units.
   */
  sizeSpace: 'screen' | 'local';
}

export const DEFAULT_CLICK_RIPPLE: Readonly<ClickRippleConfig> = Object.freeze({
  ringPhases: Object.freeze([0, 0.18]) as ReadonlyArray<number>,
  startRadius: 10,
  endRadius: 56,
  durationMs: 620,
  lineWidth: 3,
  lineWidthEnd: 1.2,
  color: 0xffffff,
  alpha: 0.6,
  ringAlphaDecay: 1,
  radiusEase: 'linear',
  alphaEase: 'linear',
  haloColor: 0x000000,
  haloAlpha: 0,
  haloWidth: 1.5,
  blendMode: 'normal',
  maxActive: 8,
  sizeSpace: 'screen'
});

export interface ClickRippleEffectOptions extends Partial<ClickRippleConfig> {
  /** The host's MotionRuntime: every ripple is one tween in it, ticked by the host's `core.update`. */
  motion: MotionRuntime;
  /** Scope suffix (`fx:click-ripple:<id>`); make it unique per runtime when several effects exist. */
  id?: string;
  /** Ring Graphics created up front (default: two ripples' worth). The pool never exceeds maxActive × rings. */
  prewarm?: number;
}

export interface ClickRippleSpawnOptions {
  /** Per-spawn color override (e.g. tint the ripple like the object under the finger). */
  color?: number;
  /** Per-spawn size multiplier on top of `setSizeScale`. */
  sizeScale?: number;
}

export interface ClickRippleHandle {
  /** True until the ripple's last ring has faded or it was cancelled/recycled. */
  readonly active: boolean;
  cancel(): boolean;
}

export interface ClickRippleStats {
  activeRipples: number;
  activeRings: number;
  /** Idle ring Graphics waiting in the pool. */
  pooledRings: number;
  /** Ring Graphics created over the effect's lifetime (pool hits keep this flat). */
  createdRings: number;
  spawned: number;
  completed: number;
  cancelled: number;
  /** Ripples cancelled early because `maxActive` was reached by a newer spawn. */
  recycled: number;
}

interface RippleRecord {
  id: number;
  cfg: Readonly<ClickRippleConfig>;
  radiusEase: EaseFn;
  alphaEase: EaseFn;
  totalMs: number;
  color: number;
  sizeScale: number;
  rings: Array<Graphics | null>;
  live: number;
  t: number;
  handle: MotionHandle | null;
  finished: boolean;
  recycled: boolean;
}

function assertFinite(name: string, value: number, min: number, max = Number.POSITIVE_INFINITY): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`ClickRippleEffect: ${name} must be a finite number in [${min}, ${max}], got ${String(value)}`);
  }
}

function validateConfig(cfg: ClickRippleConfig): void {
  if (!Array.isArray(cfg.ringPhases) || cfg.ringPhases.length === 0) {
    throw new RangeError('ClickRippleEffect: ringPhases must be a non-empty array of phases in [0, 1)');
  }
  for (const phase of cfg.ringPhases) {
    if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
      throw new RangeError(`ClickRippleEffect: every ring phase must be a finite number in [0, 1), got ${String(phase)}`);
    }
  }
  assertFinite('startRadius', cfg.startRadius, 0);
  assertFinite('endRadius', cfg.endRadius, 0);
  assertFinite('durationMs', cfg.durationMs, 1);
  assertFinite('lineWidth', cfg.lineWidth, 0);
  assertFinite('lineWidthEnd', cfg.lineWidthEnd, 0);
  assertFinite('alpha', cfg.alpha, 0, 1);
  assertFinite('ringAlphaDecay', cfg.ringAlphaDecay, 0, 1);
  assertFinite('haloAlpha', cfg.haloAlpha, 0, 1);
  assertFinite('haloWidth', cfg.haloWidth, 0);
  assertFinite('maxActive', cfg.maxActive, 1);
  if (!Number.isInteger(cfg.maxActive)) throw new RangeError(`ClickRippleEffect: maxActive must be an integer, got ${String(cfg.maxActive)}`);
  if (cfg.sizeSpace !== 'screen' && cfg.sizeSpace !== 'local') {
    throw new RangeError(`ClickRippleEffect: sizeSpace must be "screen" or "local", got ${String(cfg.sizeSpace)}`);
  }
}

/** Copies the defined fields of `overrides` over `base` and validates the result. */
function mergeConfig(base: Readonly<ClickRippleConfig>, overrides: Partial<ClickRippleConfig>): ClickRippleConfig {
  const cfg: ClickRippleConfig = { ...base };
  const target = cfg as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) target[key] = value;
  }
  validateConfig(cfg);
  cfg.ringPhases = Object.freeze([...cfg.ringPhases]);
  return cfg;
}

/**
 * Expanding "ocean" rings from a tap on empty space — a reusable Pixi FX of Game Core.
 *
 * The effect is a `Container` the host places wherever the rings should draw (over the play
 * field, under the modals). `spawn(x, y)` takes the effect's own local coordinates;
 * `spawnGlobal(x, y)` takes screen (Pixi global) coordinates and converts them through the
 * container's transform, which absorbs a stage offset or a scaled world.
 *
 * Every ripple is exactly one linear `MotionRuntime` tween in the scope `fx:click-ripple:<id>`:
 * the runtime the host ticks through `core.update(frameMs)` is the only clock (no ticker, no
 * timers, no requestAnimationFrame here), `core.pauseScope` / `cancelScope` / `cancelAll` apply
 * to the rings like to everything else. The tween's progress t drives every ring through its
 * phase (`ringPhases`), so all rings of a ripple end together. Ring `Graphics` are pooled —
 * spawns reuse them, nothing is allocated per frame; a ring is redrawn (radius, width, alpha)
 * on each tween update.
 *
 * What is deliberately NOT here: deciding which pointer-up counts as a tap on empty space (a
 * drag threshold, "was that the UI", "is something being dragged"). That is host policy.
 */
export class ClickRippleEffect extends Container {
  /** MotionRuntime scope of every ripple tween of this effect. */
  readonly scope: string;

  private readonly motion: MotionRuntime;
  private cfg: Readonly<ClickRippleConfig>;
  private radiusEaseFn: EaseFn;
  private alphaEaseFn: EaseFn;
  private readonly idle: Graphics[] = [];
  private readonly active: RippleRecord[] = [];
  private readonly worldMatrix = new Matrix();
  private sizeScaleValue = 1;
  private nextId = 1;
  private createdRings = 0;
  private spawnedCount = 0;
  private completedCount = 0;
  private cancelledCount = 0;
  private recycledCount = 0;
  private disposed = false;

  constructor(options: ClickRippleEffectOptions) {
    super();
    const { motion, id, prewarm, ...overrides } = options;
    this.motion = motion;
    this.scope = `fx:click-ripple:${id ?? 'default'}`;
    const cfg = mergeConfig(DEFAULT_CLICK_RIPPLE, overrides);
    this.cfg = Object.freeze(cfg);
    this.radiusEaseFn = resolveFxEase(cfg.radiusEase);
    this.alphaEaseFn = resolveFxEase(cfg.alphaEase);
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.prewarm(prewarm ?? cfg.ringPhases.length * 2);
  }

  /** The current configuration (frozen; change it through `configure`). */
  get config(): Readonly<ClickRippleConfig> {
    return this.cfg;
  }

  /** Multiplier applied to every radius and stroke width (set it from the host's UI scale on resize). */
  get sizeScale(): number {
    return this.sizeScaleValue;
  }

  setSizeScale(scale: number): void {
    assertFinite('sizeScale', scale, 0);
    this.sizeScaleValue = scale;
  }

  /** Replaces part of the configuration for future spawns; ripples already in flight keep theirs. */
  configure(overrides: Partial<ClickRippleConfig>): void {
    const cfg = mergeConfig(this.cfg, overrides);
    const radiusEase = resolveFxEase(cfg.radiusEase);
    const alphaEase = resolveFxEase(cfg.alphaEase);
    this.cfg = Object.freeze(cfg);
    this.radiusEaseFn = radiusEase;
    this.alphaEaseFn = alphaEase;
    this.trimPool();
  }

  /** Creates idle ring Graphics ahead of the first tap; capped at maxActive × rings. */
  prewarm(count: number): number {
    if (this.disposed) return 0;
    const cap = this.cfg.maxActive * this.cfg.ringPhases.length;
    const target = Math.max(0, Math.min(cap, Math.floor(count)));
    let created = 0;
    while (this.idle.length + this.activeRingCount() < target) {
      this.idle.push(this.createRing());
      created += 1;
    }
    return created;
  }

  /** Starts a ripple at the effect's local `(x, y)`. Returns null after destroy or for non-finite input. */
  spawn(x: number, y: number, options?: ClickRippleSpawnOptions): ClickRippleHandle | null {
    if (this.disposed) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const sizeScale = options?.sizeScale ?? 1;
    if (!Number.isFinite(sizeScale) || sizeScale < 0) return null;

    while (this.active.length >= this.cfg.maxActive) {
      const oldest = this.active[0]!;
      oldest.recycled = true;
      if (!oldest.handle?.cancel()) this.finish(oldest, 'cancelled');
    }

    const cfg = this.cfg;
    const ringCount = cfg.ringPhases.length;
    const record: RippleRecord = {
      id: this.nextId++,
      cfg,
      radiusEase: this.radiusEaseFn,
      alphaEase: this.alphaEaseFn,
      totalMs: cfg.durationMs,
      color: options?.color ?? cfg.color,
      sizeScale,
      rings: [],
      live: ringCount,
      t: 0,
      handle: null,
      finished: false,
      recycled: false
    };
    for (let i = 0; i < ringCount; i++) {
      const ring = this.acquireRing();
      ring.position.set(x, y);
      ring.blendMode = cfg.blendMode;
      record.rings.push(ring);
    }
    this.active.push(record);
    this.spawnedCount += 1;

    record.handle = this.motion.tween({
      scope: this.scope,
      durationMs: record.totalMs,
      ease: 'linear',
      bindings: [{ get: () => record.t, set: (value) => { record.t = value; }, from: 0, to: 1 }],
      onUpdate: (progress) => this.render(record, progress),
      onComplete: () => this.finish(record, 'completed'),
      onCancel: () => this.finish(record, 'cancelled')
    });
    // Draw the first frame now: a tap must read on the very next render, not one update later.
    this.render(record, 0);

    return {
      get active(): boolean {
        return !record.finished;
      },
      cancel: () => {
        if (record.finished) return false;
        return record.handle?.cancel() ?? false;
      }
    };
  }

  /** Starts a ripple at a Pixi global (screen) point, converted through this container's transform. */
  spawnGlobal(globalX: number, globalY: number, options?: ClickRippleSpawnOptions): ClickRippleHandle | null {
    if (this.disposed) return null;
    if (!Number.isFinite(globalX) || !Number.isFinite(globalY)) return null;
    const local = this.toLocal({ x: globalX, y: globalY });
    return this.spawn(local.x, local.y, options);
  }

  /** Cancels every ripple in flight (rings return to the pool). Returns how many were cancelled. */
  cancelAll(): number {
    if (this.active.length === 0) return 0;
    const before = this.active.length;
    this.motion.cancelScope(this.scope);
    // Defensive: if the runtime no longer had the tweens (e.g. it was disposed first) settle locally.
    for (const record of this.active.slice()) this.finish(record, 'cancelled');
    return before;
  }

  getStats(): ClickRippleStats {
    return {
      activeRipples: this.active.length,
      activeRings: this.activeRingCount(),
      pooledRings: this.idle.length,
      createdRings: this.createdRings,
      spawned: this.spawnedCount,
      completed: this.completedCount,
      cancelled: this.cancelledCount,
      recycled: this.recycledCount
    };
  }

  /** Cancels every tween, destroys every ring (idle and live) and the container. Idempotent. */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    for (const ring of this.idle) ring.destroy();
    this.idle.length = 0;
    super.destroy(options ?? { children: true });
  }

  // --- internals ---

  private activeRingCount(): number {
    let count = 0;
    for (const record of this.active) count += record.live;
    return count;
  }

  private createRing(): Graphics {
    const ring = new Graphics();
    ring.eventMode = 'none';
    ring.visible = false;
    this.createdRings += 1;
    return ring;
  }

  private acquireRing(): Graphics {
    const ring = this.idle.pop() ?? this.createRing();
    ring.visible = false;
    this.addChild(ring);
    return ring;
  }

  private releaseRing(ring: Graphics): void {
    ring.clear();
    ring.visible = false;
    ring.position.set(0, 0);
    if (ring.parent === this) this.removeChild(ring);
    if (this.disposed) {
      ring.destroy();
      return;
    }
    this.idle.push(ring);
  }

  private trimPool(): void {
    const cap = this.cfg.maxActive * this.cfg.ringPhases.length;
    while (this.idle.length > 0 && this.idle.length + this.activeRingCount() > cap) {
      this.idle.pop()!.destroy();
    }
  }

  /** 1 / (scale of this container's full world transform), clamped like the donor so a collapsed world never explodes the rings. */
  private inverseWorldScale(): number {
    const m = this.getGlobalTransform(this.worldMatrix, false);
    const scale = Math.hypot(m.a, m.b) || 1;
    return 1 / Math.max(0.05, scale);
  }

  private render(record: RippleRecord, progress: number): void {
    if (this.disposed || record.finished) return;
    const cfg = record.cfg;
    let k = record.sizeScale * this.sizeScaleValue;
    if (cfg.sizeSpace === 'screen') k *= this.inverseWorldScale();
    for (let i = 0; i < record.rings.length; i++) {
      const ring = record.rings[i];
      if (!ring) continue;
      const phase = cfg.ringPhases[i] ?? 0;
      // donor semantics: k = clamp((t − phase) / (1 − phase)); a phased ring stays hidden until
      // its phase and every ring reaches k = 1 exactly when the ripple's own t reaches 1
      const local = (progress - phase) / (1 - phase);
      if (local <= 0 && phase > 0) {
        ring.visible = false;
        continue;
      }
      if (local >= 1) {
        record.rings[i] = null;
        record.live -= 1;
        this.releaseRing(ring);
        continue;
      }
      const grow = record.radiusEase(local);
      const fade = 1 - record.alphaEase(local);
      const decay = Math.pow(cfg.ringAlphaDecay, i);
      const radius = (cfg.startRadius + (cfg.endRadius - cfg.startRadius) * grow) * k;
      const width = (cfg.lineWidth + (cfg.lineWidthEnd - cfg.lineWidth) * grow) * k;
      ring.clear();
      if (radius > 0 && width > 0 && fade > 0) {
        if (cfg.haloAlpha > 0 && cfg.haloWidth > 0) {
          ring.circle(0, 0, radius).stroke({ width: width + 2 * cfg.haloWidth * k, color: cfg.haloColor, alpha: cfg.haloAlpha * decay * fade });
        }
        ring.circle(0, 0, radius).stroke({ width, color: record.color, alpha: cfg.alpha * decay * fade });
        ring.visible = true;
      } else {
        ring.visible = false;
      }
    }
  }

  private finish(record: RippleRecord, outcome: 'completed' | 'cancelled'): void {
    if (record.finished) return;
    record.finished = true;
    for (let i = 0; i < record.rings.length; i++) {
      const ring = record.rings[i];
      if (!ring) continue;
      record.rings[i] = null;
      this.releaseRing(ring);
    }
    record.live = 0;
    const index = this.active.indexOf(record);
    if (index >= 0) this.active.splice(index, 1);
    if (outcome === 'completed') this.completedCount += 1;
    else if (record.recycled) this.recycledCount += 1;
    else this.cancelledCount += 1;
  }
}
