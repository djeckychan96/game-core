import { Container, Sprite, type Texture } from 'pixi.js';
import type { MotionHandle, MotionRuntime } from '../../index';

/** A sparkle's flash: up to `peakScale` and back over `flashMs`, the soft glow behind it peaking at `glowAlpha`. */
export const SPARKLE_FLASH = Object.freeze({
  flashMs: 640,
  peakScale: 1.32,
  /** The glow's size, in sparkle sizes, and its alpha at the peak. */
  glowSize: 2.2,
  glowAlpha: 0.55,
  /** Share of the flash spent growing (the rest settles back). */
  rise: 0.4
});

export interface SparkleViewOptions {
  /** The sparkle art (e.g. Figma's `pic_spark_1`: a style's `featureSpark` / `noAdsSpark`). */
  texture: Texture;
  /** The art's box, in the parent's units. */
  width: number;
  height?: number;
  /** The art's rotation, radians (clockwise). */
  rotation?: number;
  /**
   * A soft round glow (e.g. the kit's `fxGlowSoft`) that brightens the flash behind the art; null / absent = the flash
   * only grows the art (a white sparkle cannot get brighter by itself).
   */
  glow?: Texture | null;
}

/**
 * A sparkle that can flash: the art at rest exactly as drawn (origin = its centre), plus an optional soft glow behind it,
 * invisible at rest. `setFlash(k)` moves both (k 0 = rest, 1 = the peak); the view's own transform stays the host's.
 * Decoration: no input, never measured.
 */
export class SparkleView extends Container {
  readonly art: Sprite;
  readonly glow: Sprite | null;
  private readonly artScale: { x: number; y: number };
  private readonly glowScale: number;

  constructor(options: SparkleViewOptions) {
    super();
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.measurable = false;
    const width = options.width;
    const height = options.height ?? width;
    if (options.glow) {
      const glow = new Sprite(options.glow);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      this.glowScale = (Math.max(width, height) * SPARKLE_FLASH.glowSize) / Math.max(1, options.glow.width);
      glow.scale.set(this.glowScale);
      glow.alpha = 0;
      this.glow = glow;
      this.addChild(glow);
    } else {
      this.glow = null;
      this.glowScale = 1;
    }
    this.art = new Sprite(options.texture);
    this.art.anchor.set(0.5);
    this.art.rotation = options.rotation ?? 0;
    this.artScale = { x: width / Math.max(1, options.texture.width), y: height / Math.max(1, options.texture.height) };
    this.art.scale.set(this.artScale.x, this.artScale.y);
    this.addChild(this.art);
  }

  /** 0 = at rest (the art as drawn, no glow), 1 = the flash peak (`peakScale`, the glow at `SPARKLE_FLASH.glowAlpha`). */
  setFlash(k: number, peakScale: number = SPARKLE_FLASH.peakScale): void {
    const p = k <= 0 ? 0 : k >= 1 ? 1 : k;
    const s = 1 + (peakScale - 1) * p;
    this.art.scale.set(this.artScale.x * s, this.artScale.y * s);
    if (this.glow) {
      this.glow.alpha = SPARKLE_FLASH.glowAlpha * p;
      this.glow.scale.set(this.glowScale * (0.7 + 0.3 * p));
    }
  }
}

export interface SparkleLoopOptions {
  /** One loop of the timeline, ms; it repeats without end. */
  loopMs: number;
  /** The flashes inside one loop: which sparkle (index into `sparkles`) and when it starts (ms from the loop start). */
  flashes: ReadonlyArray<{ readonly sparkle: number; readonly atMs: number }>;
  /** Before the first loop, ms. Default 0. */
  delayMs?: number;
  flashMs?: number;
  peakScale?: number;
  scope?: string;
}

/** The flash curve over one flash (0..1): a quick rise, then a softer settle back to rest. */
function flashCurve(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const rise = SPARKLE_FLASH.rise;
  return t < rise ? Math.sin((Math.PI / 2) * (t / rise)) : 0.5 + 0.5 * Math.cos((Math.PI * (t - rise)) / (1 - rise));
}

/**
 * Flashes sparkles on a looping timeline (a sparkle now and then with uneven gaps, or several in turn) through ONE
 * MotionRuntime tween repeating without end. Cancel the handle to stop (every sparkle goes back to rest); cancel it
 * before the sparkles are destroyed, and when they leave the screen.
 */
export function playSparkleLoop(motion: MotionRuntime, sparkles: readonly SparkleView[], options: SparkleLoopOptions): MotionHandle {
  const loopMs = Math.max(1, options.loopMs);
  const flashMs = Math.max(1, options.flashMs ?? SPARKLE_FLASH.flashMs);
  const peakScale = options.peakScale ?? SPARKLE_FLASH.peakScale;
  const level = new Array<number>(sparkles.length).fill(0);
  const render = (timeMs: number): void => {
    level.fill(0);
    for (const flash of options.flashes) {
      if (flash.sparkle < 0 || flash.sparkle >= sparkles.length) continue;
      const t = (((timeMs - flash.atMs) % loopMs) + loopMs) % loopMs; // a flash may run over the loop's end
      level[flash.sparkle] = Math.max(level[flash.sparkle] ?? 0, flashCurve(t / flashMs));
    }
    sparkles.forEach((sparkle, i) => sparkle.setFlash(level[i] ?? 0, peakScale));
  };
  const rest = (): void => {
    for (const sparkle of sparkles) if (!sparkle.destroyed) sparkle.setFlash(0, peakScale);
  };
  rest();
  const tween: Parameters<MotionRuntime['tween']>[0] = {
    bindings: [],
    durationMs: loopMs,
    ease: 'linear',
    repeat: Infinity,
    onUpdate: (progress) => render(progress * loopMs),
    onCancel: rest
  };
  if (options.delayMs) tween.delayMs = options.delayMs;
  if (options.scope !== undefined) tween.scope = options.scope;
  return motion.tween(tween);
}
