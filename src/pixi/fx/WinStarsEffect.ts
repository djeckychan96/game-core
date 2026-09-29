import { Container, Sprite, type Texture } from 'pixi.js';
import type { MotionHandle, MotionRuntime } from '../../index';

/**
 * Timeline of the WIN star entrance, in ms of effect time (reference: Vlad's WIN, a 60 fps capture — a star every
 * ≈ 0.35 s, ≈ 0.25 s from appearing above its place to touching down).
 */
export const WIN_STARS_TIMING = Object.freeze({
  /** First star after play() (the owner calls it once the window entrance has landed). */
  startDelayMs: 80,
  /** Between two stars, left to right. */
  intervalMs: 350,
  /** A star's flight: it appears above its place, large and see-through, and drops onto it. */
  flyMs: 240
});

// the flight
const RISE = 0.85; // start height above the rest spot, in star sizes
const FROM_SCALE = 1.7; // start size / rest size
const TURN = 0.5; // rad the star turns clockwise in flight: it starts at −TURN and lands upright
const FADE_IN = 0.55; // share of the flight until the star is opaque
// the spring after touchdown: scale = rest × (1 − AMP · e^(−t / DECAY) · sin(2π t / PERIOD)), a dip to ≈ 0.89, then ≈ 1.03
const SPRING_MS = 520;
const SPRING_AMP = 0.2;
const SPRING_DECAY_MS = 110;
const SPRING_PERIOD_MS = 280;

// the landing, in star sizes and ms from touchdown (the glow art is visible over ≈ 48 % of its width)
const GLOW_LEAD_MS = 110; // the landing spot starts to glow this long before touchdown…
const GLOW_LEAD_ALPHA = 0.35; // …up to this, then the flash
const FLASH_MS = 340; // the yellow bloom: short, bright, fading along (1 − t)²
const BLOOM_SIZE = 5.0; // bloom sprite diameter at its end
const CORE_SHARE = 0.8; // the white core behind the star fades faster
const CORE_SIZE = 2.6;
const HALO_MS = 420; // a glow of the star's own shape widening behind it
const HALO_GROW = 0.45;
const HALO_ALPHA = 0.6;
const RAYS = 10; // short coloured rays (the fireworks' streak, about half its thickness and length)
const RAY_MS = 460;
const RAY_FROM = 0.42; // from the star's rim…
const RAY_REACH_MIN = 1.05; // …out to this
const RAY_REACH_SPAN = 0.35;
const RAY_THICKNESS_MIN = 0.07; // sprite height
const RAY_THICKNESS_SPAN = 0.02;
const RAY_STRETCH_MIN = 4.5; // extra length at touchdown, in thicknesses
const RAY_STRETCH_SPAN = 1.5;
const RAY_FADE_FROM = 0.4;
const SPARKS = 7; // a few small twinkling sparks around the landed star
const SPARK_MS = 640;
const SPARK_STAGGER_MS = 60;
const SPARK_FROM = 0.3;
const SPARK_REACH_MIN = 0.6;
const SPARK_REACH_SPAN = 0.35;
const SPARK_SIZE_MIN = 0.12; // sprite size
const SPARK_SIZE_SPAN = 0.08;
const SPARK_SPIN = 3.2; // rad / s at most
const DRAG = 5; // spread = (1 − e^(−DRAG·t)) / (1 − e^(−DRAG)): fast out, then hanging
const SPREAD_NORM = 1 / (1 - Math.exp(-DRAG));

const BLOOM_TINT = 0xffd24a;
const CORE_TINT = 0xfff4c8;
const HALO_TINT = 0xffe27a;
const PALE_GOLD = 0xfff1a8;
/** The WIN fireworks' palette: the rays take it in turn, every 5th one pale gold. */
const RAY_COLORS: ReadonlyArray<number> = [0xff4d5a, 0xffa23a, 0x4cff6a, 0x3fd2ff, 0xb35cff, 0xff5cc8, 0xffd23f];
const SPARK_TINTS: ReadonlyArray<number> = [0xffffff, 0xffe27a, 0xfff6d0];

/** Particle kinds; a pool slot keeps its kind (and texture) for the effect's lifetime. */
const HALO = 0;
const BLOOM = 1;
const CORE = 2;
const RAY = 3;
const SPARK = 4;

export interface WinStarsTextures {
  /** Soft round glow (`fxGlowSoft`): the landing flash and the rays. */
  glow: Texture;
  /** Small 4-point spark (`fxSparkStar`): the sparks. */
  spark: Texture;
}

export interface WinStarsEffectOptions {
  /** The host's MotionRuntime: one run = one tween in `scope`, ticked by the host's `core.update`. */
  motion: MotionRuntime;
  /** MotionRuntime scope of the run's tween (the owning window's fx scope, so its cleanup cancels the run). */
  scope: string;
  /** The owner's star sprites, left to right, already at rest (position, scale, texture); they stay the owner's children. */
  stars: ReadonlyArray<Sprite>;
  /** Landing art. Without it a star still flies in, springs and glows (the halo is its own texture): no flash, rays or sparks. */
  textures?: WinStarsTextures | null;
}

export interface WinStarsStats {
  /** Landing sprites created over the effect's lifetime: all of them up front, so this never grows. */
  created: number;
  /** Landing sprites drawn right now. */
  active: number;
  peakActive: number;
  running: boolean;
  /** Effect time of the current run (0 when idle). */
  elapsedMs: number;
  /** Length of the current / last run. */
  durationMs: number;
  /** Stars of the current show (0 after a reset). */
  earned: number;
  plays: number;
  completed: number;
  cancelled: number;
}

/** A star at rest, read once from the owner's sprite. */
interface Slot {
  sprite: Sprite;
  x: number;
  y: number;
  scale: number;
  /** Rest size in design units. */
  size: number;
}

/** One pooled landing sprite and the numbers its frame is derived from. Fixed shape, created once. */
interface Particle {
  sprite: Sprite;
  kind: number;
  slot: number;
  active: boolean;
  /** Start relative to the star's touchdown (negative: before it), and life. */
  fromMs: number;
  lifeMs: number;
  /** Base sprite scale (halo: the star's rest scale; ray: its thickness). */
  scale: number;
  angle: number;
  /** Ray / spark: end distance from the star centre, in star sizes. */
  reach: number;
  stretch: number;
  rotation0: number;
  spin: number;
  phase: number;
}

/** mulberry32: the look is fixed (same jitter every show), like an authored animation. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The Result WIN star entrance (internal to the kit; its one consumer is ResultWindowView WIN).
 *
 * The earned stars come in one by one, left to right: each appears above its place, large, see-through and turned,
 * drops onto it turning clockwise upright and settles with a small spring. At touchdown a short yellow-white flash lights up behind it (the WIN
 * fireworks' glow), a few short coloured rays and small sparks fly out and a halo of the star's own shape widens and
 * fades; the star stays. Stars beyond the earned count are never shown.
 *
 * The star sprites stay the owner's children (its layout and fit read them); this Container is the layer BEHIND them
 * (halo, flash, rays) and `front` the layer over them (sparks) — the owner places both around its stars. All landing
 * sprites are created in the constructor; `play()` starts ONE MotionRuntime tween in the owner's scope, and its update
 * derives every star and sprite from the run's elapsed time alone (no ticker, no rAF, no timer, no per-sprite tween, no
 * allocation per frame). Both layers take no input, are excluded from bounds and are hidden while nothing is drawn.
 *
 * Lifecycle: `play(earned)` restarts from t = 0; `cancel()` (also the owner's scope cancellation) ends the run at once
 * with the earned stars at rest and every landing sprite hidden; `reset()` also hides the stars (the owner's show and
 * hidden paths); `destroy()` is idempotent and leaves the star sprites to their owner.
 */
export class WinStarsEffect extends Container {
  readonly scope: string;
  /** The layer over the stars (sparks). */
  readonly front: Container;

  private readonly motion: MotionRuntime;
  private readonly slots: Slot[] = [];
  private readonly particles: Particle[] = [];
  /** Time from touchdown until the last landing sprite and the spring are done. */
  private readonly tailMs: number;
  private handle: MotionHandle | null = null;
  private earned = 0;
  private totalMs = 0;
  private elapsedMs = 0;
  private activeCount = 0;
  private peakActive = 0;
  private plays = 0;
  private completedCount = 0;
  private cancelledCount = 0;
  private disposed = false;

  constructor(options: WinStarsEffectOptions) {
    super();
    this.motion = options.motion;
    this.scope = options.scope;
    this.front = new Container();
    for (const layer of [this, this.front]) {
      layer.eventMode = 'none';
      layer.interactiveChildren = false;
      // decoration: never part of the owner's measured bounds (a resize mid-run must not grow its tap area)
      layer.measurable = false;
      layer.visible = false;
    }
    for (const sprite of options.stars) {
      this.slots.push({ sprite, x: sprite.x, y: sprite.y, scale: sprite.scale.x, size: Math.max(1, sprite.width, sprite.height) });
    }

    const glow = options.textures?.glow ?? null;
    const spark = options.textures?.spark ?? null;
    const glowWidth = Math.max(1, glow?.width ?? 1);
    const sparkWidth = Math.max(1, spark?.width ?? 1);
    const rnd = sequence(0x57a125);
    let tail = SPRING_MS;
    this.slots.forEach((slot, s) => {
      const size = slot.size;
      const add = (kind: number, texture: Texture, layer: Container, fromMs: number, lifeMs: number, scale: number): Particle => {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.blendMode = 'add';
        sprite.eventMode = 'none';
        sprite.visible = false;
        layer.addChild(sprite);
        const p: Particle = { sprite, kind, slot: s, active: false, fromMs, lifeMs, scale, angle: 0, reach: 0, stretch: 0, rotation0: 0, spin: 0, phase: 0 };
        this.particles.push(p);
        tail = Math.max(tail, fromMs + lifeMs);
        return p;
      };
      if (glow) {
        add(BLOOM, glow, this, -GLOW_LEAD_MS, GLOW_LEAD_MS + FLASH_MS, (size * BLOOM_SIZE) / glowWidth).sprite.tint = BLOOM_TINT;
        add(CORE, glow, this, 0, FLASH_MS * CORE_SHARE, (size * CORE_SIZE) / glowWidth).sprite.tint = CORE_TINT;
      }
      const halo = add(HALO, slot.sprite.texture, this, 0, HALO_MS, slot.scale);
      halo.sprite.tint = HALO_TINT;
      if (glow) {
        const turn = rnd() * Math.PI * 2;
        for (let j = 0; j < RAYS; j++) {
          const p = add(RAY, glow, this, 0, RAY_MS, (size * (RAY_THICKNESS_MIN + rnd() * RAY_THICKNESS_SPAN)) / glowWidth);
          p.angle = turn + (j / RAYS) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
          p.reach = RAY_REACH_MIN + rnd() * RAY_REACH_SPAN;
          p.stretch = RAY_STRETCH_MIN + rnd() * RAY_STRETCH_SPAN;
          p.sprite.tint = j % 5 === 2 ? PALE_GOLD : RAY_COLORS[(s * 3 + j) % RAY_COLORS.length]!;
        }
      }
      if (spark) {
        const turn = rnd() * Math.PI * 2;
        for (let j = 0; j < SPARKS; j++) {
          const lifeMs = SPARK_MS * (0.8 + rnd() * 0.2);
          const p = add(SPARK, spark, this.front, rnd() * SPARK_STAGGER_MS, lifeMs, (size * (SPARK_SIZE_MIN + rnd() * SPARK_SIZE_SPAN)) / sparkWidth);
          p.angle = turn + (j / SPARKS) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
          p.reach = SPARK_REACH_MIN + rnd() * SPARK_REACH_SPAN;
          p.rotation0 = rnd() * Math.PI * 2;
          p.spin = (rnd() - 0.5) * 2 * SPARK_SPIN;
          p.phase = rnd() * Math.PI * 2;
          p.sprite.tint = SPARK_TINTS[j % SPARK_TINTS.length]!;
        }
        tail = Math.max(tail, SPARK_STAGGER_MS + SPARK_MS); // the bound, so the run length is a round number
      }
    });
    this.tailMs = tail;
  }

  /** Length of a run with `earned` stars: delay + (earned − 1) × interval + flight + the landing of the last one. */
  durationFor(earned: number): number {
    const n = this.clampEarned(earned);
    if (n === 0) return 0;
    return WIN_STARS_TIMING.startDelayMs + (n - 1) * WIN_STARS_TIMING.intervalMs + WIN_STARS_TIMING.flyMs + this.tailMs;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Starts the entrance of `earned` stars from t = 0 (0 draws nothing). False after destroy or with no star. */
  play(earned: number): boolean {
    if (this.disposed) return false;
    this.reset();
    const n = this.clampEarned(earned);
    if (n === 0) return false;
    this.earned = n;
    this.totalMs = this.durationFor(n);
    this.plays += 1;
    let handle: MotionHandle | null = null;
    handle = this.motion.tween({
      scope: this.scope,
      durationMs: this.totalMs,
      ease: 'linear',
      bindings: [{
        get: () => this.elapsedMs,
        set: (ms: number) => {
          if (this.handle === handle) this.render(ms);
        },
        from: 0,
        to: this.totalMs
      }],
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

  /** Ends the run now: the earned stars at rest, every landing sprite hidden. Returns whether a run was stopped. */
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

  /** Stops the run and hides the stars too (nothing earned until the next play). */
  reset(): void {
    this.cancel();
    this.earned = 0;
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.sprite.destroyed) continue;
      this.rest(slot);
      slot.sprite.visible = false;
    }
  }

  getStats(): WinStarsStats {
    return {
      created: this.particles.length,
      active: this.activeCount,
      peakActive: this.peakActive,
      running: this.handle !== null,
      elapsedMs: this.elapsedMs,
      durationMs: this.totalMs,
      earned: this.earned,
      plays: this.plays,
      completed: this.completedCount,
      cancelled: this.cancelledCount
    };
  }

  /** Cancels the run and destroys both layers (not the stars, not the shared textures). Idempotent. */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.particles.length = 0;
    this.slots.length = 0;
    this.front.destroy({ children: true });
    super.destroy(options ?? { children: true });
  }

  // --- internals ---

  private clampEarned(earned: number): number {
    return Math.max(0, Math.min(this.slots.length, Math.round(Number.isFinite(earned) ? earned : 0)));
  }

  private rest(slot: Slot): void {
    slot.sprite.position.set(slot.x, slot.y);
    slot.sprite.scale.set(slot.scale);
    slot.sprite.rotation = 0;
    slot.sprite.alpha = 1;
  }

  /** The frame at effect time `elapsed`: a pure function of it (no allocation, no per-frame increments). */
  private render(elapsed: number): void {
    if (this.disposed) return;
    this.elapsedMs = elapsed;
    const { startDelayMs, intervalMs, flyMs } = WIN_STARS_TIMING;
    for (let i = 0; i < this.earned; i++) this.renderStar(this.slots[i]!, elapsed - startDelayMs - i * intervalMs);
    let active = 0;
    let back = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const age = elapsed - (startDelayMs + p.slot * intervalMs + flyMs) - p.fromMs;
      if (p.slot >= this.earned || age < 0 || age >= p.lifeMs) {
        if (p.active) {
          p.active = false;
          p.sprite.visible = false;
        }
        continue;
      }
      this.renderParticle(p, age);
      if (!p.active) {
        p.active = true;
        p.sprite.visible = true;
      }
      active += 1;
      if (p.kind !== SPARK) back += 1;
    }
    this.visible = back > 0;
    this.front.visible = active > back;
    this.activeCount = active;
    if (active > this.peakActive) this.peakActive = active;
  }

  /** A star `a` ms after its flight began. */
  private renderStar(slot: Slot, a: number): void {
    const star = slot.sprite;
    if (a < 0) {
      star.visible = false;
      return;
    }
    star.visible = true;
    const flyMs = WIN_STARS_TIMING.flyMs;
    if (a < flyMs) {
      const p = a / flyMs;
      const e = p * p; // hangs large above its place, then drops fast
      const f = Math.min(1, p / FADE_IN);
      const q = 1 - p;
      star.alpha = 1 - (1 - f) * (1 - f);
      star.position.set(slot.x, slot.y - RISE * slot.size * (1 - e));
      star.scale.set(slot.scale * (1 + (FROM_SCALE - 1) * (1 - e)));
      star.rotation = -TURN * q * q; // clockwise, easing out: upright by touchdown
      return;
    }
    const b = a - flyMs;
    star.alpha = 1;
    star.rotation = 0;
    star.position.set(slot.x, slot.y);
    const k = b < SPRING_MS ? 1 - SPRING_AMP * Math.exp(-b / SPRING_DECAY_MS) * Math.sin((2 * Math.PI * b) / SPRING_PERIOD_MS) : 1;
    star.scale.set(slot.scale * k);
  }

  /** A landing sprite `age` ms into its life. */
  private renderParticle(p: Particle, age: number): void {
    const slot = this.slots[p.slot]!;
    const sprite = p.sprite;
    const t = age / p.lifeMs;
    const u = 1 - t;
    if (p.kind === BLOOM) {
      sprite.position.set(slot.x, slot.y);
      const after = age - GLOW_LEAD_MS; // ms after touchdown
      if (after < 0) {
        const q = age / GLOW_LEAD_MS;
        sprite.alpha = GLOW_LEAD_ALPHA * q * q;
        sprite.scale.set(p.scale * (0.55 + 0.15 * q));
      } else {
        const v = 1 - after / FLASH_MS;
        sprite.alpha = v * v;
        sprite.scale.set(p.scale * (0.7 + 0.5 * (1 - v * v * v)));
      }
    } else if (p.kind === CORE) {
      sprite.position.set(slot.x, slot.y);
      sprite.alpha = u * u;
      sprite.scale.set(p.scale * (0.8 + 0.35 * (1 - u * u)));
    } else if (p.kind === HALO) {
      sprite.position.set(slot.x, slot.y);
      sprite.alpha = HALO_ALPHA * u * u;
      sprite.scale.set(p.scale * (1 + HALO_GROW * (1 - u * u * u)));
    } else if (p.kind === RAY) {
      const spread = (1 - Math.exp(-DRAG * t)) * SPREAD_NORM;
      const r = (RAY_FROM + (p.reach - RAY_FROM) * spread) * slot.size;
      sprite.position.set(slot.x + Math.cos(p.angle) * r, slot.y + Math.sin(p.angle) * r);
      sprite.rotation = p.angle;
      const thickness = p.scale * (1 - 0.45 * t);
      sprite.scale.set(thickness * (1 + p.stretch * Math.exp(-2.6 * t)), thickness);
      sprite.alpha = t < RAY_FADE_FROM ? 1 : 1 - (t - RAY_FADE_FROM) / (1 - RAY_FADE_FROM);
    } else {
      const spread = (1 - Math.exp(-DRAG * t)) * SPREAD_NORM;
      const r = (SPARK_FROM + (p.reach - SPARK_FROM) * spread) * slot.size;
      sprite.position.set(slot.x + Math.cos(p.angle) * r, slot.y + Math.sin(p.angle) * r + 0.12 * slot.size * t * t);
      sprite.rotation = p.rotation0 + p.spin * (age / 1000);
      const appear = t < 0.12 ? t / 0.12 : 1;
      const fade = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
      const wave = 0.5 + 0.5 * Math.sin(t * 30 + p.phase);
      sprite.alpha = appear * fade * (0.55 + 0.45 * wave);
      sprite.scale.set(p.scale * (0.6 + 0.4 * appear) * (1 - 0.3 * t));
    }
  }

  /** Earned stars at rest, every landing sprite hidden and idle. */
  private settle(): void {
    this.activeCount = 0;
    this.elapsedMs = 0;
    if (this.disposed) return;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.active) continue;
      p.active = false;
      p.sprite.visible = false;
    }
    this.visible = false;
    this.front.visible = false;
    for (let i = 0; i < this.earned; i++) {
      const slot = this.slots[i]!;
      if (slot.sprite.destroyed) continue;
      this.rest(slot);
      slot.sprite.visible = true;
    }
  }
}
