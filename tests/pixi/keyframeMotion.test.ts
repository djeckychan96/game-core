import { describe, expect, it } from 'vitest';
import { type Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit } from './setup';
import { KeyframeMotionView, cubicBezier, type KeyframeEase, type KeyframeMotion } from '../../src/pixi/fx/KeyframeMotion';
import { PIGGY_ICON_MOTION } from '../../src/pixi/fx/piggyIconMotion';
import { READY_UI_SKIN_VIEW_ROLES, requiredSkinRoles, type ReadyUiSkin } from '../../src/pixi/skin';
import { PIGGY_ICON_COIN, PIGGY_ICON_PIG, READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import * as pixi from '../../src/pixi';

const rootDir = resolve(__dirname, '../..');
const labelled = (label: string, size = 4): Texture => new Texture({ source: new TextureSource({ width: size, height: size, label }) });
const ROLES = ['iconPiggyBankCoin', 'iconPiggyBankPig', 'iconPiggyBankSpark'] as const;
const textures = (): Record<string, Texture> => Object.fromEntries(ROLES.map((role) => [role, labelled(role)]));

/** CSS cubic-bezier by brute force: the y of the curve point whose x is closest to `p`. */
function bezierReference(points: readonly [number, number, number, number], p: number): number {
  const [x1, y1, x2, y2] = points;
  const at = (a: number, b: number, t: number): number => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let best = 0;
  let bestError = Infinity;
  for (let i = 0; i <= 200000; i++) {
    const t = i / 200000;
    const error = Math.abs(at(x1, x2, t) - p);
    if (error < bestError) {
      bestError = error;
      best = t;
    }
  }
  return at(y1, y2, best);
}

const layerOf = (view: KeyframeMotionView, name: string): Container => view.layers[name] as Container;
const centre = (name: string): { x: number; y: number } => {
  const box = PIGGY_ICON_MOTION.layers.find((layer) => layer.name === name)!.box;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe('cubicBezier — CSS timing functions', () => {
  it('solves like the browser: keywords, the artist curves (a dip below 0, an overshoot past 1), exact ends', () => {
    const curves: Array<readonly [number, number, number, number]> = [[0.42, 0, 1, 1], [0, 0, 0.58, 1], [0.25, 0.1, 0.25, 1], [0.3, -0.05, 0.7, -0.5], [0.45, 1.45, 0.8, 1], [0.5, 0, 0.5, 1]];
    for (const points of curves) {
      const ease = cubicBezier(...points);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      for (const p of [0.05, 0.2, 0.37, 0.5, 0.63, 0.8, 0.95]) expect(ease(p), `${points} @ ${p}`).toBeCloseTo(bezierReference(points, p), 4);
    }
    // the squat ease dips below 0 before shooting up, the spring overshoots 1 — the keyframes run past their values
    const squat = cubicBezier(0.3, -0.05, 0.7, -0.5);
    expect(Math.min(...[0.3, 0.5, 0.7].map(squat))).toBeLessThan(0);
    const spring = cubicBezier(0.45, 1.45, 0.8, 1);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(spring))).toBeGreaterThan(1);
    expect(cubicBezier(0.2, 0.2, 0.8, 0.8)(0.3)).toBe(0.3);
    expect(() => cubicBezier(-0.1, 0, 1, 1)).toThrow(RangeError);
    expect(() => cubicBezier(0.4, 0, 1.2, 1)).toThrow(RangeError);
  });
});

describe('PIGGY_ICON_MOTION — Figma pig_anima 90:27944', () => {
  it('is the artist timeline: 2000 ms loop, coin / pig / spark bottom to top, Figma boxes, every track from 0 % to 100 %', () => {
    expect(PIGGY_ICON_MOTION.durationMs).toBe(2000);
    expect(PIGGY_ICON_MOTION.frame).toEqual({ width: 400, height: 400 });
    expect(PIGGY_ICON_MOTION.layers.map((layer) => layer.name)).toEqual([...ROLES]);
    // the coin: 100 × 100 turned 20°, its bounding box 128.171 at 174.91, 67.91
    const coin = PIGGY_ICON_MOTION.layers[0];
    const turned = 100 * (Math.cos(coin.rotation) + Math.sin(coin.rotation));
    expect(turned).toBeCloseTo(128.171, 3);
    expect(coin.box.x + 50 - turned / 2).toBeCloseTo(174.91, 3);
    expect(coin.box.y + 50 - turned / 2).toBeCloseTo(67.91, 3);
    // the pig's 250 box centred at 50 % − 10, 50 % − 9 is the static icon's box
    expect(centre('iconPiggyBankPig')).toEqual({ x: 190, y: 191 });
    expect(PIGGY_ICON_MOTION.iconBox).toEqual(PIGGY_ICON_MOTION.layers[1].box);
    expect(centre('iconPiggyBankSpark')).toEqual({ x: 275, y: 90 });
    for (const layer of PIGGY_ICON_MOTION.layers) {
      for (const track of Object.values(layer.tracks) as ReadonlyArray<ReadonlyArray<{ at: number }>>) {
        expect(track[0]!.at).toBe(0);
        expect(track[track.length - 1]!.at).toBe(1);
      }
    }
    expect(Object.keys(PIGGY_ICON_MOTION.layers[1].tracks)).toEqual(['translate', 'scale']);
    expect(Object.keys(PIGGY_ICON_MOTION.layers[2].tracks)).toEqual(['rotate', 'translate', 'scale']);
  });

  it('both styles ship the layers as optional levelMapScreen art: the original Figma images, shared, no Style 2 file in Style 1', () => {
    expect(READY_UI_SKIN_VIEW_ROLES.levelMapScreen).toEqual(expect.arrayContaining([...ROLES]));
    for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2] as ReadyUiSkin[]) {
      for (const role of ROLES) {
        const file = skin.assets[role]?.file;
        expect(file, `${skin.id} ${role}`).toBeTruthy();
        expect(existsSync(resolve(rootDir, 'assets/pixi-ui', file!)), file).toBe(true);
      }
      expect(requiredSkinRoles(skin, 'levelMapScreen')).toEqual(['playButton', 'iconShop', 'iconHome']);
    }
    expect(READY_UI_STYLE_1.assets.iconPiggyBankPig).toBe(PIGGY_ICON_PIG);
    expect(READY_UI_STYLE_2.assets.iconPiggyBankPig).toBe(PIGGY_ICON_PIG);
    expect(READY_UI_STYLE_2.assets.iconPiggyBankCoin).toBe(PIGGY_ICON_COIN);
    expect(Object.values(READY_UI_STYLE_1.assets).some((asset) => asset.file.startsWith('style2/'))).toBe(false);
    // the spark is pic_spark_1 in both styles (the same bytes under each style's own path)
    expect(readFileSync(resolve(rootDir, 'assets/pixi-ui', READY_UI_STYLE_1.assets.iconPiggyBankSpark!.file)))
      .toEqual(readFileSync(resolve(rootDir, 'assets/pixi-ui', READY_UI_STYLE_2.assets.iconPiggyBankSpark!.file)));
    const px = (file: string): [number, number] => {
      const bytes = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
      // VP8L (lossless) header: 14 bits width − 1, 14 bits height − 1
      const bits = bytes.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    };
    expect(px(PIGGY_ICON_PIG.file)).toEqual([250, 250]);
    expect(px(PIGGY_ICON_COIN.file)).toEqual([100, 100]);
  });

  it('every layer stands exactly on its Figma keyframes at the keyframe times', () => {
    const view = new KeyframeMotionView({ motion: createKit().motion, animation: PIGGY_ICON_MOTION, textures: textures() });
    const pig = layerOf(view, 'iconPiggyBankPig');
    const coin = layerOf(view, 'iconPiggyBankCoin');
    const spark = layerOf(view, 'iconPiggyBankSpark');
    view.pose(0.1);
    expect([pig.x, pig.y, pig.scale.x, pig.scale.y]).toEqual([190, 191 + 3.75, 1, 0.95]);
    view.pose(0.4);
    expect(pig.y).toBeCloseTo(191 - 25.637, 9);
    expect(pig.scale.y).toBeCloseTo(1.05, 9);
    expect(coin.x).toBeCloseTo(238.9955 - 0.342, 9);
    expect(coin.y).toBeCloseTo(131.9955 - 22, 9);
    expect(coin.rotation).toBeCloseTo(Math.PI / 9, 9);
    expect(spark.scale.x).toBeCloseTo(1.3, 9);
    view.pose(0.65);
    expect(spark.x).toBeCloseTo(275 - 4.934, 9);
    expect(spark.y).toBeCloseTo(90 - 67.934, 9);
    expect(spark.scale.x).toBeCloseTo(1.5, 9);
    expect(spark.rotation).toBeCloseTo(-Math.PI * 0.35, 9);
    view.pose(0.85);
    expect(pig.x).toBeCloseTo(190 - 0.329, 9);
    expect(pig.y).toBeCloseTo(191 + 4.942, 9);
    expect(spark.scale.x).toBeCloseTo(1, 9);
    view.pose(1);
    expect(coin.x).toBeCloseTo(238.9955 - 0.342, 9);
    expect(coin.y).toBeCloseTo(131.9955 + 0.06, 9);
    expect(spark.rotation).toBeCloseTo(0, 9);
    view.pose(0);
    expect([spark.x, spark.y, spark.rotation]).toEqual([273, 92, -Math.PI]);
    // between keyframes: the segment's own ease (pig 10 % → 40 %: the squat curve) — y dips below the 10 % value first
    const squat = cubicBezier(0.3, -0.05, 0.7, -0.5);
    view.pose(0.25);
    expect(pig.y).toBeCloseTo(191 + 3.75 + (-25.637 - 3.75) * squat(0.5), 9);
    view.pose(0.13);
    expect(pig.y).toBeGreaterThan(191 + 3.75);
    view.rest();
    expect([pig.x, pig.y, pig.scale.y, spark.rotation, coin.rotation]).toEqual([190, 191, 1, 0, coin.rotation]);
  });
});

describe('KeyframeMotionView — one tween, a clean lifecycle', () => {
  const tiny: KeyframeMotion = {
    durationMs: 1000,
    frame: { width: 100, height: 100 },
    layers: [{
      name: 'dot', box: { x: 0, y: 0, width: 10, height: 10 },
      tracks: { translate: [{ at: 0, value: [0, 0] }, { at: 1, value: [100, 0] }], opacity: [{ at: 0, value: 1 }, { at: 0.5, value: 0, ease: 'ease-out' as KeyframeEase }, { at: 1, value: 1 }] }
    }]
  };

  it('play loops on one MotionRuntime tween; a second play adds none; pause holds; stop and destroy end it, layers at rest', () => {
    const kit = createKit();
    const view = new KeyframeMotionView({ motion: kit.motion, animation: tiny, textures: { dot: labelled('dot') }, scope: 'test:keys' });
    const dot = layerOf(view, 'dot');
    const image = dot.children[0] as Sprite;
    expect(image.texture.source.label).toBe('dot');
    expect([image.width, image.height, dot.x, dot.y]).toEqual([10, 10, 5, 5]);
    expect(view.playing).toBe(false);
    view.play();
    view.play();
    expect(view.playing).toBe(true);
    expect(kit.motion.getStats().activeTweens).toBe(1);
    advance(kit.core, 250, 50);
    expect(dot.x).toBeCloseTo(5 + 25, 6);
    advance(kit.core, 1000, 50); // one loop later: the same frame again
    expect(dot.x).toBeCloseTo(5 + 25, 6);
    expect(dot.alpha).toBeGreaterThan(0);
    view.setPaused(true);
    advance(kit.core, 300, 50);
    expect(dot.x).toBeCloseTo(5 + 25, 6);
    view.setPaused(false);
    advance(kit.core, 100, 50);
    expect(dot.x).toBeCloseTo(5 + 35, 6);
    expect(image.texture.source.label).toBe('dot'); // frames move layers, never swap textures
    expect(view.children).toHaveLength(1);
    view.stop();
    expect(view.playing).toBe(false);
    expect([dot.x, dot.alpha]).toEqual([5, 1]);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    // held before play: starts held; an outside cancel of the scope leaves it stopped and at rest
    view.setPaused(true);
    view.play();
    advance(kit.core, 200, 50);
    expect(dot.x).toBe(5);
    expect(kit.motion.getStats().pausedMotions).toBe(1);
    expect(kit.motion.cancelScope('test:keys')).toBe(1);
    expect(view.playing).toBe(false);
    expect(dot.x).toBe(5);
    view.setPaused(false);
    view.play();
    view.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);
    view.play(); // destroyed: nothing
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);
  });

  it('the ease on a keyframe times the segment that starts at it (CSS); opacity stays in 0…1; missing texture / disorder fail fast', () => {
    const kit = createKit();
    const view = new KeyframeMotionView({ motion: kit.motion, animation: tiny, textures: { dot: labelled('dot') } });
    view.pose(0.25);
    expect(layerOf(view, 'dot').alpha).toBeCloseTo(0.5, 9); // 0 % → 50 %: no ease = linear
    view.pose(0.5);
    expect(layerOf(view, 'dot').alpha).toBe(0);
    view.pose(0.75);
    expect(layerOf(view, 'dot').alpha).toBeCloseTo(cubicBezier(0, 0, 0.58, 1)(0.5), 9); // 50 % → 100 %: the 50 % keyframe's ease-out
    const overshoot = { ...tiny, layers: [{ ...tiny.layers[0]!, tracks: { opacity: [{ at: 0, value: 0, ease: [0.45, 1.45, 0.8, 1] as KeyframeEase }, { at: 1, value: 1 }] } }] };
    const springy = new KeyframeMotionView({ motion: kit.motion, animation: overshoot, textures: { dot: labelled('dot') } });
    springy.pose(0.7);
    expect(layerOf(springy, 'dot').alpha).toBe(1);
    expect(() => new KeyframeMotionView({ motion: kit.motion, animation: tiny, textures: {} })).toThrow("KeyframeMotionView: no texture for layer 'dot'");
    const backwards = { ...tiny, layers: [{ ...tiny.layers[0]!, tracks: { rotate: [{ at: 0.5, value: 0 }, { at: 0.2, value: 1 }] } }] };
    expect(() => new KeyframeMotionView({ motion: kit.motion, animation: backwards, textures: { dot: labelled('dot') } })).toThrow(RangeError);
  });

  it('is public in game-core/pixi with the pig_anima recipe', () => {
    expect(pixi.KeyframeMotionView).toBe(KeyframeMotionView);
    expect(pixi.cubicBezier).toBe(cubicBezier);
    expect(pixi.PIGGY_ICON_MOTION).toBe(PIGGY_ICON_MOTION);
  });
});
