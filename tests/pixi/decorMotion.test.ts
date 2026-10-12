import { describe, expect, it } from 'vitest';
import { type Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { advance, createKit } from './setup';
import { DecorBurst, DECOR_BURST_MOTION } from '../../src/pixi/fx/DecorBurst';
import { SparkleView, SPARKLE_FLASH, playSparkleLoop } from '../../src/pixi/fx/Sparkle';
import { NoAdsWindowView, NO_ADS_SPARKS_LOOP } from '../../src/pixi/NoAdsWindowView';
import { ResultWindowView } from '../../src/pixi/ResultWindowView';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { requiredSkinRoles, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import * as pixi from '../../src/pixi';

type Kit = ReturnType<typeof createKit>;
const S1 = READY_UI_STYLE_1 as ReadyUiSkin;
const S2 = READY_UI_STYLE_2 as ReadyUiSkin;

const labelled = (label: string, size = 2): Texture => new Texture({ source: new TextureSource({ width: size, height: size, label }) });
const field = <T>(view: object, name: string): T => (view as Record<string, unknown>)[name] as T;

function styled(kit: Kit, skin: ReadyUiSkin, glow = false): ReadyUiTextures {
  const textures = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) if (!(glow && name === 'fxGlowSoft')) delete textures[name];
  const roles: ReadyUiSkinTextures = {};
  for (const key of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[key] = labelled(`${skin.id}:${key}`, 4);
  return { ...textures, skins: { [skin.id]: roles } };
}
const styledNodes = (view: object): { burst: DecorBurst | null; sparks?: SparkleView[] } => field(view, 'styled');
const decorMotions = (kit: Kit, id: string): number => {
  // the burst + sparkle loop run in `<id>:decor`: count them without stopping them (pause → resume)
  const n = kit.motion.pauseScope(`${id}:decor`);
  kit.motion.resumeScope(`${id}:decor`);
  return n;
};

function noAds(kit: Kit, skin: ReadyUiSkin, words: { wordNo?: string; wordAds?: string } = {}, glow = false, id?: string): NoAdsWindowView {
  const view = new NoAdsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, skin, glow), theme: { skin }, ...words, ...(id ? { id } : {}), onBuy: () => {} });
  view.resize(390, 844);
  return view;
}

describe('decor motion — the contract', () => {
  it('the motion roles are needed only with the layout that draws them (a style without them stays still and valid)', () => {
    expect(requiredSkinRoles(S2, 'noAds')).toEqual(expect.arrayContaining(['noAdsStars', 'noAdsSpark', 'noAdsTitle']));
    expect(requiredSkinRoles(S1, 'noAds')).toContain('noAdsStars');
    expect(requiredSkinRoles(S1, 'noAds')).not.toContain('noAdsSpark');
    expect(requiredSkinRoles(S1, 'noAds')).not.toContain('noAdsTitle');
    expect(requiredSkinRoles(S2, 'result')).toContain('resultStarsWin');
    const still = { ...S2, id: 'still', windows: { ...S2.windows, noAds: { ...S2.windows.noAds!, burst: undefined, sparks: undefined, titleArt: undefined } } } as unknown as ReadyUiSkin;
    expect(requiredSkinRoles(still, 'noAds')).toEqual(['noAdsPanel', 'noAdsClose', 'noAdsDecor', 'noAdsArt', 'buttonPrimary', 'priceIcon']);
    // the Figma counts: 17 No Ads stars (both styles share the decor), 13 WIN stars, two title sparkles
    expect(S2.windows.noAds?.burst?.stars).toHaveLength(17);
    expect(S1.windows.noAds?.burst).toBe(S2.windows.noAds?.burst);
    expect(S2.windows.result?.win.burst?.stars).toHaveLength(13);
    expect(S2.windows.noAds?.sparks).toHaveLength(2);
  });

  it('SparkleView / playSparkleLoop are public; the decor burst stays internal', () => {
    expect(pixi.SparkleView).toBe(SparkleView);
    expect(pixi.playSparkleLoop).toBe(playSparkleLoop);
    expect('DecorBurst' in pixi).toBe(false);
  });
});

describe('No Ads — rays, stars, title sparkles (Style 2)', () => {
  it('on show the rays grow in (0.85 → 1, alpha 0 → 1), then turn clockwise without end; the stars twinkle; hidden = all stopped and still', () => {
    const kit = createKit();
    const view = noAds(kit, S2);
    const burst = styledNodes(view).burst!;
    expect(burst).toBeInstanceOf(DecorBurst);
    expect(burst.starCount).toBe(17);
    expect(burst.measurable).toBe(false);
    expect(burst.eventMode).toBe('none');
    const rest = burst.rays.scale.x;
    expect(burst.rays.mask).toBeTruthy(); // clipped to the window box
    expect(burst.running).toBe(false);

    view.show({ price: '900' });
    expect(burst.running).toBe(true);
    expect(burst.rays.alpha).toBe(0);
    expect(burst.rays.scale.x).toBeCloseTo(rest * DECOR_BURST_MOTION.lively.fromScale, 6);
    advance(kit.core, 500);
    expect(burst.rays.alpha).toBe(1);
    expect(burst.rays.scale.x).toBeCloseTo(rest, 6);
    const r1 = burst.rays.rotation;
    advance(kit.core, 6000);
    // a quarter turn in 6 s (24 s per turn), clockwise = growing rotation
    expect(burst.rays.rotation - r1).toBeCloseTo((Math.PI / 2) * (6000 / 6000), 1);
    // over the 12 s clock pass the turn never jumps
    advance(kit.core, 12000 - 6500 - 16);
    const before = burst.rays.rotation;
    advance(kit.core, 32);
    expect(burst.rays.rotation - before).toBeGreaterThan(0);
    expect(burst.rays.rotation - before).toBeLessThan(0.02);
    // the stars: not all alike at one moment (own phases), none above 1
    const stars = burst.children.filter((c): c is Sprite => c instanceof Sprite && c !== burst.rays);
    expect(stars).toHaveLength(17);
    const alphas = stars.map((s) => s.alpha);
    expect(new Set(alphas.map((a) => a.toFixed(3))).size).toBeGreaterThan(5);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
    const children = burst.children.length;
    expect(decorMotions(kit, 'noads-window')).toBe(2); // the burst's clock + the sparkles' loop

    view.close('button');
    advance(kit.core, 400);
    expect(burst.running).toBe(false);
    expect(decorMotions(kit, 'noads-window')).toBe(0);
    expect(burst.rays.rotation).toBe(0);
    expect(burst.rays.alpha).toBe(1);
    expect(burst.children.length).toBe(children); // nothing created per frame
    view.destroy();
  });

  it('the two title sparkles flash in turn (left, then right), and rest when the window hides', () => {
    const kit = createKit();
    const view = noAds(kit, S2, {}, true);
    const sparks = styledNodes(view).sparks!;
    expect(sparks).toHaveLength(2);
    expect(sparks.every((s) => s.glow !== null)).toBe(true); // the kit's soft glow brightens the flash when loaded
    const [left, right] = sparks as [SparkleView, SparkleView];
    const restLeft = left.art.scale.x;
    const restRight = right.art.scale.x;
    view.show({ price: '900' });
    const peakMs = SPARKLE_FLASH.flashMs * SPARKLE_FLASH.rise;
    advance(kit.core, NO_ADS_SPARKS_LOOP.delayMs + peakMs);
    expect(left.art.scale.x / restLeft).toBeGreaterThan(1.25);
    expect(right.art.scale.x / restRight).toBeCloseTo(1, 6);
    advance(kit.core, NO_ADS_SPARKS_LOOP.gapMs);
    expect(right.art.scale.x / restRight).toBeGreaterThan(1.25);
    expect(left.art.scale.x / restLeft).toBeLessThan(1.05);
    view.close('button');
    advance(kit.core, 400);
    expect(left.art.scale.x).toBeCloseTo(restLeft, 9);
    expect(right.art.scale.x).toBeCloseTo(restRight, 9);
    expect(left.glow!.alpha).toBe(0);
    view.destroy();
  });

  it('the title picture only for its own lines; other copy (EN) stays runtime text', () => {
    const kit = createKit();
    const ru = noAds(kit, S2, { wordNo: 'ОТКЛЮЧЕНИЕ', wordAds: 'РЕКЛАМЫ' });
    const panelOf = (view: object): Container => field<Container>(view, 'panel');
    const arts = (view: object): string[] => (panelOf(view).children as Container[]).filter((c): c is Sprite => c instanceof Sprite).map((s) => s.texture.source.label);
    expect(arts(ru)).toContain('style-2:noAdsTitle');
    const en = noAds(kit, S2, { wordNo: 'REMOVE', wordAds: 'ADS' }, false, 'noads-en');
    expect(arts(en)).not.toContain('style-2:noAdsTitle');
    // Style 1: the same rays and stars, no sparkles, no title picture
    const dark = noAds(kit, S1, {}, false, 'noads-dark');
    expect(styledNodes(dark).burst?.starCount).toBe(17);
    expect(styledNodes(dark).sparks).toHaveLength(0);
    for (const view of [ru, en, dark]) view.destroy();
  });

  it('destroy while open stops everything', () => {
    const kit = createKit();
    const view = noAds(kit, S2);
    view.show({ price: '900' });
    advance(kit.core, 200);
    expect(decorMotions(kit, 'noads-window')).toBe(2);
    view.destroy();
    expect(decorMotions(kit, 'noads-window')).toBe(0);
    expect(kit.motionErrors).toEqual([]);
  });
});

describe('WIN — the calm rays and stars (Style 2)', () => {
  it('turn and twinkle on a WIN, never on a FAIL, and stop with the window; the fireworks / star entrance keep their own scope', () => {
    const kit = createKit();
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, S2), theme: { skin: S2 }, id: 'result', onNext: () => {}, onRetry: () => {} });
    view.resize(390, 844);
    const burst = styledNodes(view).burst!;
    expect(burst.starCount).toBe(13);
    expect(burst.rays.mask).toBeFalsy(); // the WIN rays reach past the screen anyway
    view.show({ level: 3, stars: 3, rewardCoins: 50 });
    expect(burst.running).toBe(true);
    advance(kit.core, 3000);
    expect(burst.rays.rotation).toBeCloseTo((2 * Math.PI * 3000) / DECOR_BURST_MOTION.calm.turnMs, 1);
    expect(decorMotions(kit, 'result')).toBe(1);
    view.close('button');
    advance(kit.core, 400);
    expect(burst.running).toBe(false);
    expect(decorMotions(kit, 'result')).toBe(0);
    view.show({ level: 3, outcome: 'fail' });
    advance(kit.core, 600);
    expect(burst.running).toBe(false);
    expect(burst.visible).toBe(false);
    view.destroy();
    expect(kit.motionErrors).toEqual([]);
  });
});

describe('playSparkleLoop', () => {
  it('flashes on its timeline (uneven gaps) through one tween; cancel puts every sparkle back at rest', () => {
    const kit = createKit();
    const spark = new SparkleView({ texture: labelled('spark', 190), width: 95 });
    const rest = spark.art.scale.x;
    const handle = playSparkleLoop(kit.motion, [spark], { loopMs: 12000, flashes: [0, 2900, 6300, 9100].map((atMs) => ({ sparkle: 0, atMs })) });
    advance(kit.core, 256);
    expect(spark.art.scale.x / rest).toBeCloseTo(SPARKLE_FLASH.peakScale, 1);
    advance(kit.core, 1500);
    expect(spark.art.scale.x / rest).toBeCloseTo(1, 6);
    advance(kit.core, 2900 - 1756 + 256);
    expect(spark.art.scale.x / rest).toBeGreaterThan(1.25);
    expect(kit.motion.getStats().activeTweens).toBe(1);
    handle.cancel();
    expect(spark.art.scale.x).toBeCloseTo(rest, 9);
    expect(kit.motion.getStats().activeMotions).toBe(0);
  });
});
