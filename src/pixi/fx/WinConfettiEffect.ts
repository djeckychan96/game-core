import { Container, Sprite, type Texture } from 'pixi.js';
import type { MotionHandle, MotionRuntime } from '../../index';

/**
 * Density presets: volleys × particles per volley. The Result window cannot know the device; the host picks the tier
 * (default `mobile`).
 */
export type WinConfettiTier = 'desktop' | 'mobile' | 'lowPerf';

export const WIN_CONFETTI_TIERS: Readonly<Record<WinConfettiTier, { bursts: number; sparksPerBurst: number }>> = Object.freeze({
  desktop: Object.freeze({ bursts: 9, sparksPerBurst: 48 }),
  mobile: Object.freeze({ bursts: 8, sparksPerBurst: 40 }),
  lowPerf: Object.freeze({ bursts: 6, sparksPerBurst: 24 })
});

/**
 * Look and timing of the WIN fireworks, in the Result window's design units (a portrait phone is ≈ 1150 of them wide
 * under the Result frame fit). A few large single-colour volleys go off around the window, alternating sides: each one
 * a bright flash, a soft colour bloom, a sphere of streaks flying out, then small twinkling glitter falling and fading.
 */
export interface WinConfettiConfig {
  /** Picks `bursts` / `sparksPerBurst` when they are not given. Default `mobile`. */
  tier: WinConfettiTier;
  /** Number of volleys. Default from `tier`. */
  bursts: number;
  /** Particles per volley besides its flash: one colour bloom, streaks and every 4th one glitter. Default from `tier`. */
  sparksPerBurst: number;
  /** First volley after play() — the window entrance lands first. Default 280. */
  startDelayMs: number;
  /** Between two volleys. Default 300. */
  burstIntervalMs: number;
  /** Life of one volley; its flash lives the first 15 % of it. Default 1400. */
  lifetimeMs: number;
  /** Size base in design units: volley radius 0.21–0.27 of it, streaks and glitter scale with it too. Default 1150. */
  size: number;
  /**
   * Box the volley centres are spread over, centred on the effect's origin (the Result frame centre), in design units.
   * Default 1150 × 1700: on a portrait phone its sides are the screen edges, its top and bottom rows sit above the
   * crown and below the buttons, so no volley is centred on the title, the stars, the reward or a button.
   */
  areaWidth: number;
  areaHeight: number;
  /** Volley palette: consecutive volleys take consecutive colours; streaks take it, glitter is white, gold or it. */
  colors: ReadonlyArray<number>;
  /** Random source in [0, 1); inject a seeded one for deterministic tests / captures. Default Math.random. */
  random: () => number;
}

/**
 * Volley centres as fractions of the area, in firing order: left / right beside the reward, then the corners above
 * the crown and below the buttons, alternating sides; more volleys reuse the table.
 */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-0.47, 0.03], [0.47, 0.01],
  [0.33, -0.45], [-0.34, 0.465],
  [-0.33, -0.44], [0.34, 0.46],
  [-0.49, -0.02], [0.49, 0.04],
  [0, -0.52], [0, 0.53]
];

const DEFAULTS: Omit<WinConfettiConfig, 'bursts' | 'sparksPerBurst'> = {
  tier: 'mobile',
  startDelayMs: 280,
  burstIntervalMs: 300,
  lifetimeMs: 1400,
  size: 1150,
  areaWidth: 1150,
  areaHeight: 1700,
  colors: [0xff4d5a, 0xffa23a, 0x4cff6a, 0x3fd2ff, 0xb35cff, 0xff5cc8, 0xffd23f],
  random: Math.random
};

/** Hard bound of the pool: a config beyond it is a mistake, not a bigger celebration. */
export const WIN_CONFETTI_MAX_PARTICLES = 512;

/** Particle kinds; a pool slot keeps its kind (and texture) for the effect's lifetime. */
const FLASH = 0; // bright glow at the volley centre (white towards its colour), the first FLASH_SHARE of its life
const BLOOM = 1; // soft glow in the volley colour behind the streaks
const STREAK = 2; // stretched glow along its flight direction, shrinking into a falling dot
const GLITTER = 3; // small twinkling spark star that fades in after the flash and falls

const FLASH_SHARE = 0.15; // 210 ms of a 1400 ms volley: shorter than the 300 ms interval
const FLASH_SIZE = 2.5; // flash sprite diameter at its end / volley radius
const FLASH_TINT = 0.3; // the flash is white moved this far towards the volley colour
const BLOOM_SIZE = 1.95; // bloom sprite diameter at its end / volley radius
const BLOOM_ALPHA = 0.9; // along (1 − t)⁴: lights the launch, gone by mid-life
const DRAG = 5.5; // spread = (1 − e^(−DRAG·t)) / (1 − e^(−DRAG)): fast out, then hanging in the air
const SPREAD_NORM = 1 / (1 - Math.exp(-DRAG));
const STREAK_DECAY = 2.6; // the streak's stretch fades as e^(−STREAK_DECAY·t) with its speed
const FALL_STRETCH = 0.8; // late elongation while falling
const TURN = 0.7; // share of the turn from the launch direction to straight down reached at the end of life
const GRAVITY = 0.9; // drop at the end of life / volley radius, along t²
const SHRINK = 0.5; // streaks end at half their size
const TWINKLE_RATE = 34; // rad per unit of normalized life
const TWINKLE_DEPTH = 0.35; // how much a streak flickers at the end of its life
const GLITTER_IN = 0.18; // glitter fades in over the first 18 % of the volley
const SPIN_PER_SECOND = 0.06 * 60; // glitter spin: ±0.03 rad per frame at 60 fps, as rad per second of age
const GOLD = 0xffd966;
const WHITE = 0xffffff;

/** Kind of spark slot `i` of a volley (its flash is the slot before them). */
function sparkKind(i: number): number {
  if (i === 0) return BLOOM;
  return i % 4 === 0 ? GLITTER : STREAK;
}

/** `a` moved `k` of the way to `b`, per 8-bit channel. */
function mixColor(a: number, b: number, k: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
  const g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
  const bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Signed turn in (−π, π] from `angle` to straight down (+π/2 in screen space). */
function turnToDown(angle: number): number {
  const d = Math.PI / 2 - angle;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

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
  /** FLASH, BLOOM, STREAK or GLITTER: fixed per slot, like the sprite's texture. */
  kind: number;
  /** The volley's flash (the slot before its sparks). */
  core: boolean;
  active: boolean;
  /** Effect time the particle appears at, and how long it lives. */
  spawnMs: number;
  lifetimeMs: number;
  /** Volley centre. */
  x0: number;
  y0: number;
  /** Spread offset reached at the end of life, along the DRAG curve. */
  dx: number;
  dy: number;
  /** Drop reached at the end of life, along t². */
  gravity: number;
  rotation0: number;
  /** rad / s of age: rotation is a function of age, never an increment per frame. */
  angularVelocity: number;
  /** Base sprite scale (flash / bloom: the scale at the end of their life; streak: its thickness). */
  scale: number;
  /** Streak: extra length at launch, as a multiple of its thickness. */
  stretch: number;
  /** Normalized life from which the particle fades out. */
  fadeFrom: number;
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
 * One-shot WIN fireworks (internal to the kit; its one consumer is ResultWindowView WIN).
 *
 * A Container of a fixed pool — `bursts × (sparksPerBurst + 1)` additive sprites over two textures, all created
 * in the constructor (per volley: a flash, a bloom and the streaks on the glow texture, the glitter on the spark
 * star) — and a fixed array of numeric particle state. `play()` re-seeds that state (no allocation)
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
        const kind = core ? FLASH : sparkKind(i - 1);
        const sprite = new Sprite(kind === GLITTER ? textures.spark : textures.glow);
        sprite.anchor.set(0.5);
        sprite.blendMode = 'add';
        sprite.eventMode = 'none';
        sprite.visible = false;
        this.addChild(sprite);
        this.particles.push({
          sprite, kind, core, active: false, spawnMs: 0, lifetimeMs: 1, x0: 0, y0: 0, dx: 0, dy: 0, gravity: 0,
          rotation0: 0, angularVelocity: 0, scale: 0, stretch: 0, fadeFrom: 1, twinklePhase: 0
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

  /** New random state for every slot of the pool (numbers and tints only; the sprites keep their textures). */
  private seed(): void {
    const cfg = this.config;
    const rnd = cfg.random;
    const w = cfg.areaWidth;
    const h = cfg.areaHeight;
    const n = cfg.sparksPerBurst;
    const palette = cfg.colors;
    const lifeSeconds = cfg.lifetimeMs / 1000;
    const firstColor = Math.floor(rnd() * palette.length);
    let index = 0;
    for (let b = 0; b < cfg.bursts; b++) {
      const spot = SPOTS[b % SPOTS.length]!;
      const cx = spot[0] * w + (rnd() - 0.5) * w * 0.05;
      const cy = spot[1] * h + (rnd() - 0.5) * h * 0.03;
      const main = palette[(firstColor + b) % palette.length]!;
      const radius = cfg.size * (0.21 + rnd() * 0.06);
      const spawnMs = cfg.startDelayMs + b * cfg.burstIntervalMs;

      for (let i = 0; i <= n; i++) {
        const p = this.particles[index++]!;
        p.spawnMs = spawnMs;
        p.lifetimeMs = p.kind === FLASH ? cfg.lifetimeMs * FLASH_SHARE : cfg.lifetimeMs;
        p.x0 = cx;
        p.y0 = cy;
        p.dx = 0;
        p.dy = 0;
        p.gravity = 0;
        p.rotation0 = 0;
        p.angularVelocity = 0;
        p.stretch = 0;
        p.fadeFrom = 1;
        p.twinklePhase = 0;
        if (p.kind === FLASH) {
          p.scale = (radius * FLASH_SIZE) / this.glowTextureWidth;
          p.sprite.tint = mixColor(WHITE, main, FLASH_TINT);
        } else if (p.kind === BLOOM) {
          p.scale = (radius * BLOOM_SIZE) / this.glowTextureWidth;
          p.sprite.tint = main;
        } else if (p.kind === STREAK) {
          // two shells: every 3rd streak stays inside, the others make the sphere's rim
          const angle = ((i - 1) / n) * Math.PI * 2 + rnd() * 0.35;
          const reach = i % 3 === 0 ? 0.35 + rnd() * 0.25 : 0.82 + rnd() * 0.18;
          p.dx = Math.cos(angle) * radius * reach;
          p.dy = Math.sin(angle) * radius * reach;
          p.gravity = radius * GRAVITY;
          // the streak points along its flight and turns towards the fall: still linear in age
          p.rotation0 = angle;
          p.angularVelocity = (turnToDown(angle) * TURN * Math.abs(Math.cos(angle))) / lifeSeconds;
          p.scale = (cfg.size * (0.030 + rnd() * 0.009)) / this.glowTextureWidth;
          p.stretch = (4.2 + rnd() * 1.45) * reach;
          p.fadeFrom = 0.6 + rnd() * 0.25;
          p.twinklePhase = rnd() * Math.PI * 2;
          p.sprite.tint = i % 7 === 3 ? WHITE : main;
        } else {
          const angle = rnd() * Math.PI * 2;
          const reach = 0.25 + rnd() * 0.6;
          p.dx = Math.cos(angle) * radius * reach;
          p.dy = Math.sin(angle) * radius * reach;
          p.gravity = radius * GRAVITY * 0.75;
          p.rotation0 = rnd() * Math.PI * 2;
          p.angularVelocity = (rnd() - 0.5) * SPIN_PER_SECOND;
          p.scale = (cfg.size * (0.060 + rnd() * 0.025)) / this.sparkTextureWidth;
          p.fadeFrom = 0.55 + rnd() * 0.3;
          p.twinklePhase = rnd() * Math.PI * 2;
          const shade = (i >> 2) % 3;
          p.sprite.tint = shade === 0 ? WHITE : shade === 1 ? GOLD : main;
        }
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
      const u = 1 - t;
      const sprite = p.sprite;
      if (p.kind === FLASH) {
        sprite.position.set(p.x0, p.y0);
        sprite.scale.set(p.scale * (0.45 + 0.55 * (1 - u * u * u)));
        sprite.alpha = u;
      } else if (p.kind === BLOOM) {
        sprite.position.set(p.x0, p.y0);
        sprite.scale.set(p.scale * (0.6 + 0.4 * (1 - u * u * u)));
        sprite.alpha = BLOOM_ALPHA * u * u * u * u;
        sprite.rotation = p.rotation0 + p.angularVelocity * (age / 1000);
      } else {
        const spread = (1 - Math.exp(-DRAG * t)) * SPREAD_NORM;
        const fade = t < p.fadeFrom ? 1 : 1 - (t - p.fadeFrom) / (1 - p.fadeFrom);
        const wave = 0.5 + 0.5 * Math.sin(t * TWINKLE_RATE + p.twinklePhase);
        sprite.position.set(p.x0 + p.dx * spread, p.y0 + p.dy * spread + p.gravity * t * t);
        sprite.rotation = p.rotation0 + p.angularVelocity * (age / 1000);
        if (p.kind === STREAK) {
          const size = p.scale * (1 - SHRINK * t);
          sprite.scale.set(size * (1 + p.stretch * Math.exp(-STREAK_DECAY * t) + FALL_STRETCH * t), size);
          sprite.alpha = fade * (1 - TWINKLE_DEPTH * t * wave);
        } else {
          const appear = t < GLITTER_IN ? t / GLITTER_IN : 1;
          sprite.scale.set(p.scale * (0.55 + 0.45 * appear) * (1 - 0.3 * t));
          sprite.alpha = appear * fade * (0.5 + 0.5 * wave);
        }
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
