import { Container, Sprite, type Texture } from 'pixi.js';
import type { EaseFn, MotionHandle, MotionRuntime } from '../../index';

// An artist's keyframe animation from Figma, played on the host's MotionRuntime. Figma gives the frame's layers
// (get_design_context: each layer's box, rotation and image) and, per layer, the keyframe tracks it exports as CSS
// (get_motion_context: translate / scale / rotate / opacity, every segment with its own timing function) over one
// timeline cohort that loops. Port one: the layers and the keyframes as data (`KeyframeMotion`), the textures by layer
// name, `KeyframeMotionView` plays them. One MotionRuntime tween drives the whole timeline; a frame only writes the
// layers' transforms (no texture, no Graphics, no allocation).

/** A CSS / Figma timing function: a keyword or the four numbers of `cubic-bezier(x1, y1, x2, y2)`. */
export type KeyframeEase = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | readonly [x1: number, y1: number, x2: number, y2: number];

export interface Keyframe<V> {
  /** Where on the timeline, 0…1 (the CSS keyframe's % / 100). */
  readonly at: number;
  readonly value: V;
  /** The timing of the segment from this keyframe to the next (the keyframe's `animation-timing-function`); absent = linear. */
  readonly ease?: KeyframeEase;
}

export type KeyframeVec = readonly [x: number, y: number];

/** One layer's tracks, as Figma exports them; an absent track keeps the layer's rest value. */
export interface KeyframeLayerTracks {
  /** The offset from the layer's place, frame units (CSS `translate`). */
  readonly translate?: readonly Keyframe<KeyframeVec>[];
  /** Around the layer's centre (CSS `scale`). */
  readonly scale?: readonly Keyframe<KeyframeVec>[];
  /** Radians, clockwise, on top of the layer's own rotation (CSS `rotate`). */
  readonly rotate?: readonly Keyframe<number>[];
  /** 0…1 (CSS `opacity`). */
  readonly opacity?: readonly Keyframe<number>[];
}

export interface KeyframeLayer {
  /** The layer's key: its image in `KeyframeMotionViewOptions.textures` (e.g. a skin role). */
  readonly name: string;
  /**
   * The layer's box in the frame before its own rotation, frame units. Its centre is the transform origin (Figma's and
   * CSS's default), and the layer's image is drawn over the whole box.
   */
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The layer's own rotation in the frame, radians clockwise. */
  readonly rotation?: number;
  readonly tracks?: KeyframeLayerTracks;
}

/** One Figma frame's animation: its layers bottom to top and one timeline that loops (a Figma timeline cohort). */
export interface KeyframeMotion {
  /** One loop, ms. */
  readonly durationMs: number;
  readonly frame: { readonly width: number; readonly height: number };
  readonly layers: readonly KeyframeLayer[];
}

const KEYWORD_EASES: Record<Exclude<KeyframeEase, readonly number[]>, readonly [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1]
};

const linearEase: EaseFn = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` as an ease, solved the way browsers solve it (Newton steps on x, bisection when
 * they stall). x1 / x2 must lie in 0…1; y1 / y2 may leave it — the anticipation and the overshoot of an artist's curve,
 * so the eased value runs past the keyframes between them. The ends are exact: 0 → 0, 1 → 1.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError(`cubicBezier: x1 and x2 must be in 0…1 and every number finite, got ${x1}, ${y1}, ${x2}, ${y2}`);
  }
  if (x1 === y1 && x2 === y2) return linearEase;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) return t;
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60 && hi - lo > 1e-7; i++) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-7) return t;
      if (x > value) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const t = solveT(p);
    return ((ay * t + by) * t + cy) * t;
  };
}

function resolveKeyframeEase(ease: KeyframeEase | undefined): EaseFn {
  if (ease === undefined || ease === 'linear') return linearEase;
  const points = typeof ease === 'string' ? KEYWORD_EASES[ease] : ease;
  if (!points) throw new RangeError(`KeyframeMotion: unknown ease "${String(ease)}"`);
  return cubicBezier(points[0], points[1], points[2], points[3]);
}

/** A track ready for frames: its stops, the values per component and each segment's ease. */
interface CompiledTrack {
  readonly at: readonly number[];
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly ease: readonly EaseFn[];
}

function compileTrack(layer: string, property: string, keyframes: readonly Keyframe<number | KeyframeVec>[] | undefined): CompiledTrack | null {
  if (!keyframes) return null;
  if (keyframes.length === 0) throw new RangeError(`KeyframeMotion: layer '${layer}' ${property} has no keyframes`);
  let previous = 0;
  for (const keyframe of keyframes) {
    if (!(keyframe.at >= previous && keyframe.at <= 1)) {
      throw new RangeError(`KeyframeMotion: layer '${layer}' ${property} keyframes must run 0…1 in order, got at ${keyframe.at}`);
    }
    previous = keyframe.at;
  }
  const vec = (value: number | KeyframeVec): KeyframeVec => (typeof value === 'number' ? [value, value] : value);
  return {
    at: keyframes.map((keyframe) => keyframe.at),
    x: keyframes.map((keyframe) => vec(keyframe.value)[0]),
    y: keyframes.map((keyframe) => vec(keyframe.value)[1]),
    ease: keyframes.map((keyframe) => resolveKeyframeEase(keyframe.ease))
  };
}

/** Segment of `track` at `t` and its eased progress, written into `out` (no allocation): [index, eased]. */
function locate(track: CompiledTrack, t: number, out: [number, number]): void {
  const last = track.at.length - 1;
  if (last === 0 || t <= (track.at[0] ?? 0)) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  if (t >= (track.at[last] ?? 1)) {
    out[0] = last - 1;
    out[1] = 1;
    return;
  }
  let i = 0;
  while (i < last - 1 && t >= (track.at[i + 1] ?? 1)) i++;
  const from = track.at[i] ?? 0;
  const span = (track.at[i + 1] ?? 1) - from;
  out[0] = i;
  out[1] = span > 0 ? (track.ease[i] ?? linearEase)((t - from) / span) : 1;
}

function component(values: readonly number[], at: [number, number]): number {
  const from = values[at[0]] ?? 0;
  if (values.length === 1) return from;
  return from + ((values[at[0] + 1] ?? from) - from) * at[1];
}

interface CompiledLayer {
  readonly node: Container;
  readonly centerX: number;
  readonly centerY: number;
  readonly rotation: number;
  readonly translate: CompiledTrack | null;
  readonly scale: CompiledTrack | null;
  readonly rotate: CompiledTrack | null;
  readonly opacity: CompiledTrack | null;
}

export interface KeyframeMotionViewOptions {
  /** The host's MotionRuntime: the timeline is one of its tweens. */
  motion: MotionRuntime;
  animation: KeyframeMotion;
  /** Each layer's image by the layer's `name` (e.g. a style's role textures); every layer needs one. */
  textures: Readonly<Record<string, Texture | undefined>>;
  /** The scope of the timeline's tween. */
  scope?: string;
}

/**
 * The layers of a `KeyframeMotion`, in frame units (origin = the frame's top-left; the host places and scales the
 * view), and their looping timeline. At rest every layer stands where the frame draws it; `play()` starts the loop
 * (one tween, never a second one), `stop()` puts the layers back at rest, `setPaused()` holds the loop while the view
 * is off screen, `destroy()` stops it. Decoration: no input, never measured.
 */
export class KeyframeMotionView extends Container {
  /** One container per layer, by name (its position = the box centre; the layer's image is its child). */
  readonly layers: Readonly<Record<string, Container>>;
  private readonly motion: MotionRuntime;
  private readonly animation: KeyframeMotion;
  private readonly scope: string | undefined;
  private readonly compiled: CompiledLayer[] = [];
  private readonly at: [number, number] = [0, 0];
  private handle: MotionHandle | null = null;
  private paused = false;

  constructor(options: KeyframeMotionViewOptions) {
    super();
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.measurable = false;
    this.motion = options.motion;
    this.animation = options.animation;
    this.scope = options.scope;
    if (!(options.animation.durationMs > 0)) throw new RangeError(`KeyframeMotion: durationMs must be > 0, got ${options.animation.durationMs}`);
    const layers: Record<string, Container> = {};
    for (const layer of options.animation.layers) {
      const texture = options.textures[layer.name];
      if (!texture) throw new Error(`KeyframeMotionView: no texture for layer '${layer.name}'`);
      const node = new Container();
      node.label = layer.name;
      const image = new Sprite(texture);
      image.anchor.set(0.5);
      image.width = layer.box.width;
      image.height = layer.box.height;
      node.addChild(image);
      this.addChild(node);
      layers[layer.name] = node;
      const tracks = layer.tracks ?? {};
      this.compiled.push({
        node,
        centerX: layer.box.x + layer.box.width / 2,
        centerY: layer.box.y + layer.box.height / 2,
        rotation: layer.rotation ?? 0,
        translate: compileTrack(layer.name, 'translate', tracks.translate),
        scale: compileTrack(layer.name, 'scale', tracks.scale),
        rotate: compileTrack(layer.name, 'rotate', tracks.rotate),
        opacity: compileTrack(layer.name, 'opacity', tracks.opacity)
      });
    }
    this.layers = layers;
    this.rest();
  }

  /** The loop is running (held or not). */
  get playing(): boolean {
    return this.handle?.active ?? false;
  }

  /** Starts the loop from its first frame; already playing = nothing (never a second tween). Held views start held. */
  play(): void {
    if (this.handle?.active || this.destroyed) return;
    this.pose(0);
    const tween: Parameters<MotionRuntime['tween']>[0] = {
      bindings: [],
      durationMs: this.animation.durationMs,
      ease: 'linear',
      repeat: Infinity,
      onUpdate: (progress) => this.pose(progress),
      onCancel: () => {
        if (this.handle === handle) this.handle = null;
        if (!this.destroyed) this.rest();
      }
    };
    if (this.scope !== undefined) tween.scope = this.scope;
    const handle = this.motion.tween(tween);
    if (this.paused) handle.pause();
    this.handle = handle;
  }

  /** Ends the loop; the layers go back to rest. */
  stop(): void {
    const handle = this.handle;
    this.handle = null;
    handle?.cancel();
    if (!this.destroyed) this.rest();
  }

  /** Holds the loop where it is (true) or lets it run on (false); a later `play()` honours it. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.handle?.pause();
    else this.handle?.resume();
  }

  /** The frame at `t` of the loop (0…1): every layer's keyframes at that time over its rest place. */
  pose(t: number): void {
    const at = this.at;
    for (const layer of this.compiled) {
      let x = layer.centerX;
      let y = layer.centerY;
      let scaleX = 1;
      let scaleY = 1;
      let rotation = layer.rotation;
      let alpha = 1;
      if (layer.translate) {
        locate(layer.translate, t, at);
        x += component(layer.translate.x, at);
        y += component(layer.translate.y, at);
      }
      if (layer.scale) {
        locate(layer.scale, t, at);
        scaleX = component(layer.scale.x, at);
        scaleY = component(layer.scale.y, at);
      }
      if (layer.rotate) {
        locate(layer.rotate, t, at);
        rotation += component(layer.rotate.x, at);
      }
      if (layer.opacity) {
        locate(layer.opacity, t, at);
        alpha = Math.min(1, Math.max(0, component(layer.opacity.x, at)));
      }
      layer.node.position.set(x, y);
      layer.node.scale.set(scaleX, scaleY);
      layer.node.rotation = rotation;
      layer.node.alpha = alpha;
    }
  }

  /** Every layer where the frame draws it (no keyframe applied). */
  rest(): void {
    for (const layer of this.compiled) {
      layer.node.position.set(layer.centerX, layer.centerY);
      layer.node.scale.set(1, 1);
      layer.node.rotation = layer.rotation;
      layer.node.alpha = 1;
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    const handle = this.handle;
    this.handle = null;
    handle?.cancel();
    super.destroy(options);
  }
}
