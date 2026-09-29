import { Container, Sprite, type Texture } from 'pixi.js';
import type { MotionHandle, MotionRuntime } from '../../index';

/**
 * Density presets of the Trail Arrow LevelComplete screen fireworks (`playScreenFireworks`): bursts × sparks.
 * The Result window cannot know the device; the host picks the tier (default `mobile`).
 */
export type WinConfettiTier = 'desktop' | 'mobile' | 'lowPerf';

export const WIN_CONFETTI_TIERS: Readonly<Record<WinConfettiTier, { bursts: number; sparksPerBurst: number }>> = Object.freeze({
  desktop: Object.freeze({ bursts: 13, sparksPerBurst: 16 }),
  mobile: Object.freeze({ bursts: 10, sparksPerBurst: 12 }),
  lowPerf: Object.freeze({ bursts: 7, sparksPerBurst: 10 })
});

/**
 * Look and timing of the WIN confetti. Defaults = the Trail Arrow screen fireworks, re-expressed in the Result
 * window's design units: the donor sized everything from min(screen w, h) in css px, which is ≈ 1150 design units
 * under the Result frame fit on both reference viewports (390 × 844 at 0.337, 1280 × 800 at 0.705).
 */
export interface WinConfettiConfig {
  /** Picks `bursts` / `sparksPerBurst` when they are not given. Default `mobile`. */
  tier: WinConfettiTier;
  /** Number of bursts (donor volleys). Default from `tier`. */
  bursts: number;
  /** Sparks per burst (each burst also has one core glow). Default from `tier`. */
  sparksPerBurst: number;
  /** First burst after play() — the donor lets the window entrance land first. Default 280. */
  startDelayMs: number;
  /** Between two bursts. Default 200. */
  burstIntervalMs: number;
  /** Life of one burst; its core glow lives the first `coreShare` of it. Default 1050. */
  lifetimeMs: number;
  /** The donor's `base` = min(w, h), in design units: burst radius 0.20–0.30 of it, sparks 0.010–0.018. Default 1150. */
  size: number;
  /** Box the burst spots are fractions of, centred on the effect's origin, in design units. Default 1150 × 1150. */
  areaWidth: number;
  areaHeight: number;
  /** Burst palette: even sparks take the burst colour, odd ones gold or white (the donor's two-colour salute). */
  colors: ReadonlyArray<number>;
  /** Random source in [0, 1); inject a seeded one for deterministic tests / captures. Default Math.random. */
  random: () => number;
}

/** Burst spots as fractions of the area: a ring around the window, then the far perimeter (donor order). */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-0.30, -0.20], [0.30, -0.20],
  [-0.32, 0.16], [0.32, 0.16],
  [0, -0.26], [0, 0.26],
  [-0.36, 0], [0.36, 0],
  [-0.34, -0.38], [0.34, -0.38],
  [0, -0.42],
  [-0.30, 0.36], [0.30, 0.36]
];

const DEFAULTS: Omit<WinConfettiConfig, 'bursts' | 'sparksPerBurst'> = {
  tier: 'mobile',
  startDelayMs: 280,
  burstIntervalMs: 200,
  lifetimeMs: 1050,
  size: 1150,
  areaWidth: 1150,
  areaHeight: 1150,
  colors: [0xff5a5a, 0xffd02e, 0xa8e63c, 0x4ec9f5, 0xc678f5, 0xffd966, 0xff8ac2],
  random: Math.random
};

/** Hard bound of the pool: a config beyond it is a mistake, not a bigger celebration. */
export const WIN_CONFETTI_MAX_PARTICLES = 512;

/** Donor constants, kept by name. */
const SPARK_SPRITE_K = 5.2; // sprite size / the donor's spark circle radius
const CORE_SHARE = 0.18; // the core glow lives the first 18 % of a burst
const CORE_ALPHA = 0.95;
const FADE_FROM = 0.72; // sparks hold full alpha until 72 % of their life
const SHRINK = 0.35; // sparks end at 65 % of their size
const TWINKLE_RATE = 34; // rad per unit of normalized life
const SPIN_PER_SECOND = 0.06 * 60; // donor ±0.03 rad per frame at 60 fps, now per second of age
const GOLD = 0xffd966;
const WHITE = 0xffffff;

export interface WinConfettiTextures {
  spark: Texture;
  glow: Texture;
}

export interface WinConfettiEffectOptions extends Partial<WinConfettiConfig> {
  /** The host's MotionRuntime: one run = one tween in `scope`, ticked by the host's `core.update`. */
  motion: MotionRuntime;
  /** MotionRuntime scope of the run's tween (the owning window's fx scope, so its cleanup cancels the run). */
  scope: string;
  textures: WinConfettiTextures;
}

export interface WinConfettiStats {
  /** Sprites created over the effect's lifetime: all of them up front, so this never grows. */
  created: number;
  /** Particles drawn right now. */
  active: number;
  /** Idle sprites: created − active. */
  pooled: number;
  /** Most particles ever drawn at once. */
  peakActive: number;
  /** created = bursts × (sparksPerBurst + 1). */
  maxParticles: number;
  running: boolean;
  /** Effect time of the current run (0 when idle). */
  elapsedMs: number;
  plays: number;
  completed: number;
  cancelled: number;
}

/** One pooled particle: its sprite and the numeric state the frame is derived from. Fixed shape, created once. */
interface Particle {
  sprite: Sprite;
  core: boolean;
  active: boolean;
  /** Effect time the particle appears at, and how long it lives. */
  spawnMs: number;
  lifetimeMs: number;
  /** Burst centre. */
  x0: number;
  y0: number;
  /** Spread offset reached at the end of life, along 1 − (1 − t)³ (the donor's power-out spread). */
  dx: number;
  dy: number;
  /** Drop reached at the end of life, along t². */
  gravity: number;
  rotation0: number;
  /** rad / s of age: rotation is a function of age, never an increment per frame. */
  angularVelocity: number;
  /** Base sprite scale (core: the scale at the end of its life). */
  scale: number;
  twinklePhase: number;
}

function assertRange(name: string, value: number, min: number, max = Number.POSITIVE_INFINITY): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`WinConfettiEffect: ${name} must be a finite number in [${min}, ${max}], got ${String(value)}`);
  }
}

/** Defaults ← tier ← the defined overrides, validated. */
export function resolveWinConfettiConfig(overrides: Partial<WinConfettiConfig> = {}): WinConfettiConfig {
  const defined: Partial<WinConfettiConfig> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (defined as Record<string, unknown>)[key] = value;
  }
  const tier = defined.tier ?? DEFAULTS.tier;
  const preset = WIN_CONFETTI_TIERS[tier];
  if (!preset) throw new RangeError(`WinConfettiEffect: tier must be desktop, mobile or lowPerf, got ${String(tier)}`);
  const cfg: WinConfettiConfig = { ...DEFAULTS, ...preset, ...defined, tier };
  assertRange('bursts', cfg.bursts, 1);
  assertRange('sparksPerBurst', cfg.sparksPerBurst, 1);
  if (!Number.isInteger(cfg.bursts) || !Number.isInteger(cfg.sparksPerBurst)) {
    throw new RangeError('WinConfettiEffect: bursts and sparksPerBurst must be integers');
  }
  if (cfg.bursts * (cfg.sparksPerBurst + 1) > WIN_CONFETTI_MAX_PARTICLES) {
    throw new RangeError(`WinConfettiEffect: bursts × (sparksPerBurst + 1) must stay ≤ ${WIN_CONFETTI_MAX_PARTICLES}`);
  }
  assertRange('startDelayMs', cfg.startDelayMs, 0);
  assertRange('burstIntervalMs', cfg.burstIntervalMs, 0);
  assertRange('lifetimeMs', cfg.lifetimeMs, 1);
  assertRange('size', cfg.size, 0);
  assertRange('areaWidth', cfg.areaWidth, 0);
  assertRange('areaHeight', cfg.areaHeight, 0);
  if (!Array.isArray(cfg.colors) || cfg.colors.length === 0) throw new RangeError('WinConfettiEffect: colors must be a non-empty array');
  if (typeof cfg.random !== 'function') throw new TypeError('WinConfettiEffect: random must be a function');
  cfg.colors = Object.freeze([...cfg.colors]);
  return cfg;
}

/**
 * One-shot WIN confetti (internal to the kit; its one consumer is ResultWindowView WIN).
 *
 * A Container of a fixed pool — `bursts × (sparksPerBurst + 1)` additive sprites over two textures, all created
 * in the constructor — and a fixed array of numeric particle state. `play()` re-seeds that state (no allocation)
 * and starts ONE MotionRuntime tween in the owner's scope; its update derives every particle from the run's
 * elapsed time alone (age = elapsed − spawn; position, alpha, scale and rotation are functions of age), so the
 * picture at a given time does not depend on the frame steps that led there. No ticker, no rAF, no timers, no
 * per-particle tween, no Graphics redraw. The layer never takes input and is excluded from bounds.
 *
 * Lifecycle: `play()` restarts from t = 0; `cancel()` (also the owner's scope cancellation) hides every particle at
 * once; `destroy()` is idempotent. After a run, `active` = 0 and `pooled` = `created`.
 */
export class WinConfettiEffect extends Container {
  readonly scope: string;
  readonly config: Readonly<WinConfettiConfig>;

  private readonly motion: MotionRuntime;
  private readonly particles: Particle[] = [];
  private readonly totalMs: number;
  private readonly sparkTextureWidth: number;
  private readonly glowTextureWidth: number;
  private handle: MotionHandle | null = null;
  private elapsedMs = 0;
  private activeCount = 0;
  private peakActive = 0;
  private plays = 0;
  private completedCount = 0;
  private cancelledCount = 0;
  private disposed = false;

  constructor(options: WinConfettiEffectOptions) {
    super();
    const { motion, scope, textures, ...overrides } = options;
    if (!textures?.spark || !textures?.glow) throw new Error('WinConfettiEffect: textures.spark and textures.glow are required');
    this.motion = motion;
    this.scope = scope;
    this.config = Object.freeze(resolveWinConfettiConfig(overrides));
    const cfg = this.config;
    this.totalMs = cfg.startDelayMs + (cfg.bursts - 1) * cfg.burstIntervalMs + cfg.lifetimeMs;
    this.sparkTextureWidth = Math.max(1, textures.spark.width);
    this.glowTextureWidth = Math.max(1, textures.glow.width);
    this.eventMode = 'none';
    this.interactiveChildren = false;
    // decoration: never part of the owner's measured bounds (a resize mid-run must not grow the panel's tap area)
    this.measurable = false;

    for (let b = 0; b < cfg.bursts; b++) {
      for (let i = 0; i <= cfg.sparksPerBurst; i++) {
        const core = i === 0;
        const sprite = new Sprite(core ? textures.glow : textures.spark);
        sprite.anchor.set(0.5);
        sprite.blendMode = 'add';
        sprite.eventMode = 'none';
        sprite.visible = false;
        this.addChild(sprite);
        this.particles.push({
          sprite, core, active: false, spawnMs: 0, lifetimeMs: 1, x0: 0, y0: 0, dx: 0, dy: 0, gravity: 0,
          rotation0: 0, angularVelocity: 0, scale: 0, twinklePhase: 0
        });
      }
    }
  }

  /** Total length of one run: delay + (bursts − 1) × interval + lifetime. */
  get durationMs(): number {
    return this.totalMs;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Starts a run from t = 0 (an unfinished one is cancelled first). False after destroy. */
  play(): boolean {
    if (this.disposed) return false;
    this.cancel();
    this.seed();
    this.elapsedMs = 0;
    this.plays += 1;
    const handle = this.motion.tween({
      scope: this.scope,
      durationMs: this.totalMs,
      ease: 'linear',
      bindings: [],
      onUpdate: (progress) => {
        if (this.handle === handle) this.render(progress * this.totalMs);
      },
      onComplete: () => {
        if (this.handle !== handle) return;
        this.handle = null;
        this.completedCount += 1;
        this.settle();
      },
      onCancel: () => {
        if (this.handle !== handle) return;
        this.handle = null;
        this.cancelledCount += 1;
        this.settle();
      }
    });
    this.handle = handle;
    return true;
  }

  /** Stops the run now: every particle hidden, back in the pool. Returns whether a run was stopped. */
  cancel(): boolean {
    const handle = this.handle;
    if (handle === null) {
      this.settle();
      return false;
    }
    // onCancel settles; if the runtime no longer had the tween (disposed first), settle here
    if (!handle.cancel() || this.handle === handle) {
      this.handle = null;
      this.cancelledCount += 1;
      this.settle();
    }
    return true;
  }

  getStats(): WinConfettiStats {
    return {
      created: this.particles.length,
      active: this.activeCount,
      pooled: this.particles.length - this.activeCount,
      peakActive: this.peakActive,
      maxParticles: this.particles.length,
      running: this.handle !== null,
      elapsedMs: this.elapsedMs,
      plays: this.plays,
      completed: this.completedCount,
      cancelled: this.cancelledCount
    };
  }

  /** Cancels the run and destroys the sprites (not the shared textures). Idempotent. */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.particles.length = 0;
    super.destroy(options ?? { children: true });
  }

  // --- internals ---

  /** New random state for every slot of the pool (numbers only; the sprites keep their textures). */
  private seed(): void {
    const cfg = this.config;
    const rnd = cfg.random;
    const w = cfg.areaWidth;
    const h = cfg.areaHeight;
    const n = cfg.sparksPerBurst;
    let index = 0;
    for (let b = 0; b < cfg.bursts; b++) {
      const spot = SPOTS[b % SPOTS.length]!;
      const cx = spot[0] * w + (rnd() - 0.5) * w * 0.10;
      const cy = spot[1] * h + (rnd() - 0.5) * h * 0.06;
      const main = cfg.colors[Math.floor(rnd() * cfg.colors.length) % cfg.colors.length]!;
      const radius = cfg.size * (0.20 + rnd() * 0.10);
      const spawnMs = cfg.startDelayMs + b * cfg.burstIntervalMs;

      const core = this.particles[index++]!;
      core.spawnMs = spawnMs;
      core.lifetimeMs = cfg.lifetimeMs * CORE_SHARE;
      core.x0 = cx;
      core.y0 = cy;
      core.dx = 0;
      core.dy = 0;
      core.gravity = 0;
      core.rotation0 = 0;
      core.angularVelocity = 0;
      core.scale = (radius * 0.60) / this.glowTextureWidth; // donor: diameter 2 × 0.30 R at the end of the flash
      core.twinklePhase = 0;
      core.sprite.tint = WHITE;

      for (let i = 0; i < n; i++) {
        const p = this.particles[index++]!;
        const angle = (i / n) * Math.PI * 2 + rnd() * 0.4;
        const distance = radius * (0.7 + rnd() * 0.5);
        const sparkRadius = cfg.size * (0.010 + rnd() * 0.008);
        p.spawnMs = spawnMs;
        p.lifetimeMs = cfg.lifetimeMs;
        p.x0 = cx;
        p.y0 = cy;
        p.dx = Math.cos(angle) * distance;
        p.dy = Math.sin(angle) * distance;
        p.gravity = radius * 0.55;
        p.rotation0 = rnd() * Math.PI * 2;
        p.angularVelocity = (rnd() - 0.5) * SPIN_PER_SECOND;
        p.scale = (sparkRadius * SPARK_SPRITE_K) / this.sparkTextureWidth;
        p.twinklePhase = rnd() * Math.PI * 2;
        p.sprite.tint = i % 2 === 0 ? main : rnd() < 0.5 ? GOLD : WHITE;
      }
    }
  }

  /** The frame at effect time `elapsed`: a pure function of it (no allocation, no per-frame increments). */
  private render(elapsed: number): void {
    if (this.disposed) return;
    this.elapsedMs = elapsed;
    const particles = this.particles;
    let active = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      const age = elapsed - p.spawnMs;
      if (age < 0 || age >= p.lifetimeMs) {
        if (p.active) {
          p.active = false;
          p.sprite.visible = false;
        }
        continue;
      }
      const t = age / p.lifetimeMs;
      const sprite = p.sprite;
      if (p.core) {
        sprite.position.set(p.x0, p.y0);
        sprite.scale.set(p.scale * t);
        sprite.alpha = (1 - t) * CORE_ALPHA;
      } else {
        const u = 1 - t;
        const spread = 1 - u * u * u;
        const fade = t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM);
        sprite.position.set(p.x0 + p.dx * spread, p.y0 + p.dy * spread + p.gravity * t * t);
        sprite.alpha = fade * (0.72 + 0.28 * Math.sin(t * TWINKLE_RATE + p.twinklePhase));
        sprite.scale.set(p.scale * (1 - t * SHRINK));
        sprite.rotation = p.rotation0 + p.angularVelocity * (age / 1000);
      }
      if (!p.active) {
        p.active = true;
        sprite.visible = true;
      }
      active += 1;
    }
    this.activeCount = active;
    if (active > this.peakActive) this.peakActive = active;
  }

  /** Every particle hidden and idle. */
  private settle(): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.active) continue;
      p.active = false;
      p.sprite.visible = false;
    }
    this.activeCount = 0;
    this.elapsedMs = 0;
  }
}
