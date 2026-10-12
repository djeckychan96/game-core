import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { MotionHandle, MotionRuntime } from '../../index';
import type { ReadyUiSkinBox, ReadyUiSkinDecorBurst } from '../skin';

/**
 * The look of a decor burst's motion. `lively` = the No Ads window (the burst is the window's whole background), `calm` =
 * the WIN glow (far quieter than the WIN fireworks over it).
 */
export const DECOR_BURST_MOTION = Object.freeze({
  lively: Object.freeze({
    /** The rays' entrance: from this scale and alpha 0 to the art, ease-out. */
    enterMs: 420,
    fromScale: 0.85,
    /** One clockwise turn of the rays. */
    turnMs: 24000,
    /** A star fades in over `starFadeMs`, after its own delay of up to `starDelayMs`. */
    starFadeMs: 360,
    starDelayMs: 700,
    /** Twinkle periods (each divides the 12 s clock loop), the alpha range around the star's own alpha, the scale swing. */
    periodsMs: [1500, 2000, 2400, 3000, 4000],
    alphaLow: [0.15, 0.5],
    alphaHigh: [1, 1.4],
    scaleShare: 0.5,
    scaleAmp: [0.06, 0.14]
  }),
  calm: Object.freeze({
    enterMs: 480,
    fromScale: 0.85,
    turnMs: 30000,
    starFadeMs: 480,
    starDelayMs: 900,
    periodsMs: [2000, 2400, 3000, 4000],
    alphaLow: [0.4, 0.7],
    alphaHigh: [1, 1.2],
    scaleShare: 0.35,
    scaleAmp: [0.04, 0.08]
  })
});

export type DecorBurstMotion = keyof typeof DECOR_BURST_MOTION;

/** The clock tween's pass: the time is (passes + progress) × LOOP_MS, so the motion never jumps at a pass. */
const LOOP_MS = 12000;

/** A fixed seeded generator: a burst's stars twinkle the same way on every show. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StarTwinkle {
  sprite: Sprite;
  alpha: number;
  periodMs: number;
  phase: number;
  low: number;
  high: number;
  amp: number;
  delayMs: number;
}

export interface DecorBurstOptions {
  motion: MotionRuntime;
  /** The scope of the burst's one clock tween. */
  scope: string;
  /** The rays (the decor picture) and their render box in the parent's units. */
  rays: Texture;
  box: ReadyUiSkinBox;
  burst: ReadyUiSkinDecorBurst;
  /** The star atlas (`burst.stars` cells); null = no stars layer. */
  stars: Texture | null;
  look: DecorBurstMotion;
  /** Clip the rays to this box (parent units): a window's own box, so the turning rays never leave it. */
  clip?: ReadyUiSkinBox;
  seed?: number;
}

/**
 * Internal: the decor burst behind a Ready UI window's hero (No Ads, the WIN glow). The rays fade in growing from
 * `fromScale`, then turn clockwise around the burst centre without end; the separate Figma stars over them twinkle, each
 * on its own seeded period, phase, alpha range and (for some) scale swing — calm, never all at once. One MotionRuntime
 * tween per play (a 12 s clock repeating without end, `bindings: []`); every frame is a pure function of the elapsed
 * time, and only transforms / alpha change (no texture, graphics or text per frame). At rest (not playing) it draws the
 * Figma picture: the rays upright at full size, every star at its own alpha. Decoration: no input, never measured.
 */
export class DecorBurst extends Container {
  readonly rays: Sprite;
  private readonly motion: MotionRuntime;
  private readonly scope: string;
  private readonly timing: (typeof DECOR_BURST_MOTION)[DecorBurstMotion];
  private readonly raysScale: { x: number; y: number };
  private readonly twinkles: StarTwinkle[] = [];
  private readonly starTextures: Texture[] = [];
  private handle: MotionHandle | null = null;
  private passes = 0;
  private lastProgress = 0;

  constructor(options: DecorBurstOptions) {
    super();
    this.motion = options.motion;
    this.scope = options.scope;
    this.timing = DECOR_BURST_MOTION[options.look];
    this.eventMode = 'none';
    this.interactiveChildren = false;
    // decoration that reaches outside its window: never part of the fit, the centring or the tap area
    this.measurable = false;
    const { box, burst } = options;

    this.rays = new Sprite(options.rays);
    this.rays.anchor.set(burst.pivot.x / box.width, burst.pivot.y / box.height);
    this.rays.position.set(box.x + burst.pivot.x, box.y + burst.pivot.y);
    this.raysScale = { x: box.width / options.rays.width, y: box.height / options.rays.height };
    this.addChild(this.rays);
    if (options.clip) {
      const clip = new Graphics().rect(options.clip.x, options.clip.y, options.clip.width, options.clip.height).fill(0xffffff);
      this.addChild(clip);
      this.rays.mask = clip;
    }

    const atlas = options.stars;
    if (atlas && burst.stars?.length) {
      const random = mulberry32(options.seed ?? 0x5eed);
      const t = this.timing;
      const pick = (range: readonly number[]): number => (range[0] ?? 0) + random() * ((range[1] ?? 0) - (range[0] ?? 0));
      for (const star of burst.stars) {
        const [cx, cy, cw, ch] = star.cell;
        const texture = new Texture({ source: atlas.source, frame: new Rectangle(atlas.frame.x + cx, atlas.frame.y + cy, cw, ch) });
        this.starTextures.push(texture);
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.position.set(box.x + star.x, box.y + star.y);
        sprite.rotation = (-star.rotation * Math.PI) / 180;
        this.addChild(sprite);
        const scaled = random() < t.scaleShare;
        this.twinkles.push({
          sprite,
          alpha: star.alpha,
          periodMs: t.periodsMs[Math.floor(random() * t.periodsMs.length)] ?? LOOP_MS,
          phase: random(),
          low: pick(t.alphaLow),
          high: pick(t.alphaHigh),
          amp: scaled ? pick(t.scaleAmp) : 0,
          delayMs: random() * t.starDelayMs
        });
      }
    }
    this.rest();
  }

  /** True while the burst moves. */
  get running(): boolean {
    return this.handle?.active === true;
  }

  /** Stars drawn over the rays. */
  get starCount(): number {
    return this.twinkles.length;
  }

  /** Starts from t = 0: the entrance, then the endless turn and twinkle (a running burst restarts). */
  play(): void {
    this.cancelClock();
    this.passes = 0;
    this.lastProgress = 0;
    this.render(0);
    const handle = this.motion.tween({
      scope: this.scope,
      bindings: [],
      durationMs: LOOP_MS,
      ease: 'linear',
      repeat: Infinity,
      onUpdate: (progress) => {
        if (progress < this.lastProgress) this.passes += 1;
        this.lastProgress = progress;
        this.render((this.passes + progress) * LOOP_MS);
      },
      onCancel: () => {
        if (this.handle === handle) this.handle = null;
      }
    });
    this.handle = handle;
  }

  /** Stops and shows the still Figma picture again. */
  stop(): void {
    this.cancelClock();
    this.rest();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.cancelClock();
    super.destroy(options);
    for (const texture of this.starTextures) texture.destroy(false);
    this.starTextures.length = 0;
  }

  private cancelClock(): void {
    const handle = this.handle;
    this.handle = null;
    handle?.cancel();
  }

  private rest(): void {
    this.rays.scale.set(this.raysScale.x, this.raysScale.y);
    this.rays.alpha = 1;
    this.rays.rotation = 0;
    for (const star of this.twinkles) {
      star.sprite.alpha = star.alpha;
      star.sprite.scale.set(1);
    }
  }

  /** The frame at `elapsedMs` since play(). */
  private render(elapsedMs: number): void {
    const t = this.timing;
    const enter = Math.min(1, elapsedMs / t.enterMs);
    const eased = 1 - (1 - enter) ** 3;
    const k = t.fromScale + (1 - t.fromScale) * eased;
    this.rays.scale.set(this.raysScale.x * k, this.raysScale.y * k);
    this.rays.alpha = eased;
    this.rays.rotation = ((elapsedMs % t.turnMs) / t.turnMs) * Math.PI * 2;
    for (const star of this.twinkles) {
      const fade = Math.max(0, Math.min(1, (elapsedMs - star.delayMs) / t.starFadeMs));
      const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * (elapsedMs / star.periodMs + star.phase));
      star.sprite.alpha = Math.min(1, star.alpha * (star.low + (star.high - star.low) * wave)) * fade;
      star.sprite.scale.set(1 + star.amp * (2 * wave - 1));
    }
  }
}
