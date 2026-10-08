import { describe, expect, it } from 'vitest';
import { type Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer } from './setup';
import { LocalizationRuntime } from '../../src/localization';
import { READY_UI_CATALOGS } from '../../src/pixi';
import { NoAdsWindowView, type NoAdsWindowParams } from '../../src/pixi/NoAdsWindowView';
import { ResultWindowView, WIN_CONFETTI_TEXTURES, type ResultWindowParams, type ResultWindowViewOptions } from '../../src/pixi/ResultWindowView';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_SKIN_WINDOW_ROLES, requiredSkinRoles, skinAssetKey, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const S2 = READY_UI_STYLE_2;
const R2 = S2.windows.result;
const rootDir = resolve(__dirname, '../..');
const X = (x: number): number => x - 540;
const Y = (y: number): number => y - 1172;
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

/** The required pack only, plus the style's role textures (by asset key) as loadReadyUiAssets({ skin }) files them. */
function styled(kit: Kit, skin: ReadyUiSkin): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  const roles: ReadyUiSkinTextures = {};
  for (const key of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[key] = labelled(`${skin.id}:${key}`);
  return { ...required, victoryRibbon: labelled('donor:victoryRibbon'), noAdsPanel: labelled('donor:noAdsPanel'), noAdsBuy: labelled('donor:noAdsBuy'), skins: { [skin.id]: roles } };
}

const texture = (node: Container): string => ((node as Sprite).texture ?? (node as unknown as Partial<UiButton>).background?.texture)?.source.label ?? '';
const panel = (view: object): Container => field<Container>(view, 'panel');
function drawn(view: object): string[] {
  const out: string[] = [];
  for (const child of panel(view).children as Container[]) {
    if (!child.visible) continue;
    if (child instanceof Sprite || child instanceof NineSliceSprite) out.push(texture(child));
    else if ('background' in child) out.push(texture(child));
  }
  return out;
}
function texts(root: Container): string[] {
  const out: string[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children as Container[]) {
      if (!child.visible) continue;
      if (child instanceof Text) out.push(child.text);
      else visit(child);
    }
  };
  visit(root);
  return out;
}
function tap(kit: Kit, target: UiButton): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 400);
}

function result(kit: Kit, textures: ReadyUiTextures, extra: Partial<ResultWindowViewOptions> = {}, log: string[] = []): ResultWindowView {
  return new ResultWindowView({
    ui: kit.ui, motion: kit.motion, textures, theme: { skin: S2 }, id: 'result',
    onNext: (p) => log.push(`next:${p.level}`), onRetry: (p) => log.push(`retry:${p.outcome ?? 'win'}:${p.level}`), onExit: (p) => log.push(`exit:${p.level}`),
    onDismiss: (r) => log.push(`dismiss:${r}`), ...extra
  });
}
function shown(kit: Kit, view: ResultWindowView, params: ResultWindowParams, width = 390, height = 844): ResultWindowView {
  view.resize(width, height);
  view.show(params);
  advance(kit.core, 2400);
  return view;
}

describe('Style 2 Result — theme_light_6 28:48352 (P0-A)', () => {
  it('is in the Style 2 package: every result role but the highlight, Style 2 files only (shared HUD coin / star, popup ×)', () => {
    expect(S2.covers).toContain('result');
    expect(() => validateReadyUiSkin(S2)).not.toThrow();
    expect(requiredSkinRoles(S2, 'result')).toEqual(READY_UI_SKIN_WINDOW_ROLES.result.filter((role) => role !== 'buttonHighlight'));
    expect(R2.win.retry.highlight).toBeNull();
    for (const role of requiredSkinRoles(S2, 'result')) {
      const file = S2.assets[skinAssetKey(S2, 'result', role) as keyof typeof S2.assets]?.file;
      expect(file && existsSync(resolve(rootDir, 'assets/pixi-ui', file)), role).toBeTruthy();
      expect(file!.startsWith('style2/'), `${role} -> ${file}`).toBe(true);
    }
    expect(S2.assets.resultStar.file).toBe('style2/icon_star.webp');
    expect(S2.assets.rewardCoin.file).toBe(S2.assets.hudCoin.file);
    expect(S2.assets.resultCloseWin.file).toBe(S2.assets.settingsClose.file);
    expect(S2.assets.buttonExit.nineSlice).toEqual(S2.assets.buttonRewarded.nineSlice);
  });

  it('WIN draws only Style 2 art: the red ribbon, the rays, the coin, the 9-slice CTAs, the popup ×; runtime text in Carlito', () => {
    const kit = createKit();
    const view = shown(kit, result(kit, styled(kit, S2)), { level: 200, stars: 3, rewardCoins: 500 });
    expect(view.skin).toBe(S2);
    const art = drawn(view);
    for (const role of ['resultGlowWin', 'rewardCoin', 'buttonPrimary', 'buttonRewarded', 'resultRibbonWin', 'resultCloseWin']) expect(art).toContain(`style-2:${role}`);
    expect(art.every((label) => label.startsWith('style-2:')), art.join()).toBe(true);
    expect(art).not.toContain('style-2:resultGlowFail');
    expect(field<Sprite[]>(view, 'stars').map((s) => s.texture.source.label)).toEqual(['style-2:resultStar', 'style-2:resultStar', 'style-2:resultStar']);
    expect(texts(panel(view))).toEqual(expect.arrayContaining(['LEVEL 200', 'COMPLETED!', 'REWARDS', '500', 'CONTINUE', 'RETRY']));
    const amount = field<Text>(view, 'rewardAmount');
    expect(amount.style.fontFamily).toBe('Carlito');
    expect(amount.style.fontSize).toBe(100);
    expect(amount.style.stroke).toMatchObject({ color: 0x943300, width: 10 }); // 5 OUTSIDE = 10 centred
    const next = field<UiButton>(view, 'nextButton');
    const retry = field<UiButton>(view, 'retryButton');
    expect([next.x, next.y]).toEqual([X(120 + 354 / 2), Y(1481 + 107)]);
    expect([retry.x, retry.y]).toEqual([X(507 + 458 / 2), Y(1481 + 107)]);
    expect(next.background).toBeInstanceOf(NineSliceSprite);
    // the bare yellow surface: no highlight layer, only the surface and its label
    expect(retry.children.filter((c) => c instanceof Sprite && !(c instanceof Text))).toHaveLength(0);
    const close = field<UiButton>(view, 'closeButton');
    expect([close.x, close.y]).toEqual([X(897 + 153 / 2), Y(441 + 158 / 2)]);
    expect([close.background.width, close.background.height]).toEqual([153, 158]);
    view.destroy();
  });

  it('0 / 1 / 2 / 3 stars: never more than earned, at Figma\'s centres and sizes, inside the tap area', () => {
    for (const stars of [0, 1, 2, 3]) {
      const kit = createKit();
      const view = shown(kit, result(kit, styled(kit, S2)), { level: 7, stars, rewardCoins: 10 });
      const sprites = field<Sprite[]>(view, 'stars');
      expect(sprites.map((s) => s.visible)).toEqual([0, 1, 2].map((i) => i < stars));
      expect(sprites.map((s) => [s.x, s.y, Math.round(s.width * 100) / 100])).toEqual(R2.win.stars.map((s) => [X(s.x), Y(s.y), Math.round(s.size * 100) / 100]));
      const hit = panel(view).hitArea as { contains(x: number, y: number): boolean };
      if (stars > 0) expect(hit.contains(X(R2.win.stars[0].x), Y(R2.win.stars[0].y))).toBe(true);
      view.destroy();
    }
  });

  it('WIN FX stay compatible: confetti and the star entrance run on the Style 2 WIN; the rays are decoration under them, never measured', () => {
    const kit = createKit();
    const textures = styled(kit, S2);
    for (const name of WIN_CONFETTI_TEXTURES) textures[name] = labelled(`fx:${name}`);
    const view = result(kit, textures, { confetti: true });
    view.resize(390, 844);
    view.show({ level: 1, stars: 3, rewardCoins: 1 });
    const children = panel(view).children as Container[];
    const confetti = field<Container>(view, 'confetti');
    const starsFx = field<Container>(view, 'starsFx');
    const stars = field<Sprite[]>(view, 'stars');
    const rays = children.find((c) => texture(c) === 'style-2:resultGlowWin')!;
    const ribbon = children.find((c) => texture(c) === 'style-2:resultRibbonWin')!;
    // bottom → top: the rays, …, the ribbon, the stars' landing layer, the stars, the confetti; the × on top
    expect(children.indexOf(rays)).toBe(0);
    expect(rays.measurable).toBe(false);
    expect(rays.eventMode).toBe('none');
    expect(children.indexOf(ribbon)).toBeLessThan(children.indexOf(starsFx));
    expect(children.indexOf(starsFx)).toBeLessThan(children.indexOf(stars[0]!));
    expect(children.indexOf(stars[2]!)).toBeLessThan(children.indexOf(confetti));
    expect(children.indexOf(field<UiButton>(view, 'closeButton'))).toBe(children.length - 1);
    advance(kit.core, 2400);
    expect(stars.every((s) => s.visible)).toBe(true);
    // one frame-fit scale: the Style 2 frame's contain-fit of the WIN composition (crown … CTA row)
    expect(field<number>(view, 'fitScale')).toBeCloseTo(Math.min((390 * (1020 / 1080)) / 1020, (844 * (1318 / 2344)) / 1318), 6);
    view.destroy();
  });

  it('callbacks unchanged: CONTINUE / the secondary (Map / Levels via retryLabel) are close continuations; × and the backdrop dismiss', () => {
    const kit = createKit();
    const log: string[] = [];
    const ru = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const view = result(kit, styled(kit, S2), { i18n: ru, retryLabel: ru.t('core.result.exit') }, log);
    shown(kit, view, { level: 9, stars: 2, rewardCoins: 5 });
    expect(texts(panel(view))).toEqual(expect.arrayContaining(['УРОВЕНЬ 9', 'ПРОЙДЕН!', 'НАГРАДА', 'ДАЛЕЕ', 'К УРОВНЯМ']));
    tap(kit, field<UiButton>(view, 'nextButton'));
    shown(kit, view, { level: 9, stars: 2, rewardCoins: 5 });
    tap(kit, field<UiButton>(view, 'retryButton'));
    shown(kit, view, { level: 9, stars: 2, rewardCoins: 5 });
    tap(kit, field<UiButton>(view, 'closeButton'));
    expect(log).toEqual(['next:9', 'retry:win:9', 'dismiss:button']);
    view.destroy();
  });

  it('FAIL (derived, no theme_light_6 design): the same ribbon with one line, the broken heart over the blue blur, "-1", RETRY + EXIT 9-slices', () => {
    const kit = createKit();
    const view = shown(kit, result(kit, styled(kit, S2)), { level: 12, outcome: 'fail', rewardCoins: 0 });
    const art = drawn(view);
    for (const role of ['resultGlowFail', 'lifeLostArt', 'buttonPrimary', 'buttonExit', 'resultRibbonFail', 'resultCloseFail']) expect(art).toContain(`style-2:${role}`);
    expect(art).not.toContain('style-2:resultGlowWin');
    expect(texts(panel(view))).toEqual(expect.arrayContaining(['LEVEL 12', 'FAILED', '-1', 'RETRY', 'EXIT']));
    expect(field<UiButton>(view, 'exitButton').background).toBeInstanceOf(NineSliceSprite);
    expect(field<UiButton>(view, 'failRetryButton').background).toBeInstanceOf(NineSliceSprite);
    const delta = (panel(view).children as Container[]).find((c) => c instanceof Text && c.text === '-1') as Text;
    expect(delta.style.stroke).toMatchObject({ color: 0x9b170b, width: 10 });
    view.destroy();
  });

  it('isolation: Style 1 keeps its own Result (never Style 2 art), no skin keeps the donor Result', () => {
    const kit = createKit();
    const s1 = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 's1', onNext: () => {}, onRetry: () => {} });
    shown(kit, s1, { level: 1, stars: 3, rewardCoins: 1 });
    expect(drawn(s1).every((label) => label.startsWith('style-1:'))).toBe(true);
    const donor = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), id: 'donor', onNext: () => {}, onRetry: () => {} });
    shown(kit, donor, { level: 1, stars: 3, rewardCoins: 1 });
    expect(donor.skin).toBeNull();
    expect(drawn(donor)).toContain('donor:victoryRibbon');
  });
});

describe('No Ads — theme_light_6 screen_ads_off (P1-D)', () => {
  const PARAMS: NoAdsWindowParams = { price: '900' };
  function noAds(kit: Kit, skin: ReadyUiSkin | null, log: string[] = []): NoAdsWindowView {
    return new NoAdsWindowView({
      ui: kit.ui, motion: kit.motion, textures: styled(kit, skin ?? READY_UI_STYLE_1), id: 'noads', ...(skin ? { theme: { skin } } : {}),
      onBuy: (p) => log.push(`buy:${p.price}`), onDismiss: (r) => log.push(`dismiss:${r}`)
    });
  }
  function open(kit: Kit, view: NoAdsWindowView, params: NoAdsWindowParams = PARAMS): NoAdsWindowView {
    view.resize(390, 844);
    view.show(params);
    advance(kit.core, 600);
    return view;
  }

  for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2] as const) {
    it(`${skin.id}: covered; the purple promo window (9-slice), its ×, the rays, the hero, the two title lines and the copy, the buy button`, () => {
      expect(skin.covers).toContain('noAds');
      for (const role of requiredSkinRoles(skin, 'noAds')) {
        const file = skin.assets[skinAssetKey(skin, 'noAds', role) as keyof typeof skin.assets]?.file;
        expect(file && existsSync(resolve(rootDir, 'assets/pixi-ui', file)), role).toBeTruthy();
      }
      // both rows draw the same purple window and rays (byte-identical Figma renders)
      expect(skin.assets.noAdsPanel).toBe(READY_UI_STYLE_1.assets.noAdsPanel);
      const kit = createKit();
      const log: string[] = [];
      const view = open(kit, noAds(kit, skin, log));
      expect(view.skin).toBe(skin);
      const L = skin.windows.noAds;
      const art = drawn(view);
      expect(art[0]).toBe(`${skin.id}:noAdsPanel`);
      expect(art).toEqual(expect.arrayContaining([`${skin.id}:noAdsDecor`, `${skin.id}:noAdsArt`]));
      expect(art.some((label) => label.startsWith('donor:'))).toBe(false);
      const shell = panel(view).children[0] as NineSliceSprite;
      expect(shell).toBeInstanceOf(NineSliceSprite);
      expect([shell.width, shell.height]).toEqual([L.window.width + 12, L.window.height + 12]); // the 6-unit ring on every side
      const close = field<UiButton>(view, 'closeButton');
      expect(texture(close)).toBe(`${skin.id}:noAdsClose`);
      expect([close.x, close.y]).toEqual([L.close.x + L.close.width / 2 - 500, L.close.y + L.close.height / 2 - 930]);
      // the title lines are wordNo / wordAds; the description's first line wraps, its second is the note
      expect(texts(panel(view))).toEqual(expect.arrayContaining(['NO', 'ADS', 'Removes pop-up ads.', 'Rewarded ads still available', '900']));
      const buy = field<UiButton>(view, 'buyButton');
      expect(buy.background).toBeInstanceOf(NineSliceSprite);
      expect(texture(buy)).toBe(`${skin.id}:${skinAssetKey(skin, 'noAds', 'buttonPrimary')}`);
      expect([buy.x, buy.y]).toEqual([L.button.x + L.button.width / 2 - 500, L.button.y + L.button.height / 2 - 930]);
      tap(kit, buy);
      expect(log).toEqual(['buy:900']);
      view.destroy();
    });
  }

  it('the coin follows only a coin price (`coinPrice`); a store price is the text alone; the row shrinks inside the button', () => {
    const kit = createKit();
    const view = open(kit, noAds(kit, S2));
    const styledNodes = field<{ coin: Sprite; priceRow: Container }>(view, 'styled');
    expect(styledNodes.coin.visible).toBe(false);
    expect(styledNodes.coin.texture.source.label).toBe('style-2:noAds:priceIcon');
    view.close('programmatic', () => {});
    advance(kit.core, 400);
    open(kit, view, { price: '900', coinPrice: true });
    expect(styledNodes.coin.visible).toBe(true);
    expect(styledNodes.priceRow.scale.x).toBe(1);
    view.close('programmatic', () => {});
    advance(kit.core, 400);
    open(kit, view, { price: 'USD 1 234 567 890.99 per month', coinPrice: true });
    expect(styledNodes.priceRow.scale.x).toBeLessThan(1);
    expect(styledNodes.priceRow.width).toBeLessThanOrEqual(S2.windows.noAds.button.width * 0.84 + 0.01);
    view.destroy();
  });

  it('copy: explicit words / description win, then the provider (RU), then the defaults; the note is the description\'s second line', () => {
    const kit = createKit();
    const ru = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const view = new NoAdsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, S2), theme: { skin: S2 }, i18n: ru, onBuy: () => {} });
    open(kit, view);
    expect(texts(panel(view))).toEqual(expect.arrayContaining(['БЕЗ', 'РЕКЛАМЫ', 'Убирает всплывающую рекламу.', 'Реклама за награду остается']));
    view.destroy();
    const kit2 = createKit();
    const explicit = new NoAdsWindowView({ ui: kit2.ui, motion: kit2.motion, textures: styled(kit2, S2), theme: { skin: S2 }, wordNo: 'ОТКЛЮЧЕНИЕ', wordAds: 'РЕКЛАМЫ', onBuy: () => {} });
    open(kit2, explicit, { price: '900', description: 'Убирает Видео Рекламу\nОставляет награждаемую рекламу!' });
    expect(texts(panel(explicit))).toEqual(expect.arrayContaining(['ОТКЛЮЧЕНИЕ', 'Убирает Видео Рекламу', 'Оставляет награждаемую рекламу!']));
    explicit.destroy();
  });

  it('no skin = the donor No Ads, unchanged (its panel art, rotated words, price button)', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = open(kit, noAds(kit, null, log));
    expect(view.skin).toBeNull();
    expect(drawn(view)).toEqual(expect.arrayContaining(['donor:noAdsPanel', 'donor:noAdsBuy']));
    const buy = field<UiButton>(view, 'buyButton');
    expect([buy.x, buy.y]).toEqual([0, 517]);
    expect(buy.labelText?.text).toBe('900');
    tap(kit, buy);
    expect(log).toEqual(['buy:900']);
    view.destroy();
  });

  it('a missing No Ads texture fails clearly, before anything registers', () => {
    const kit = createKit();
    const textures = styled(kit, S2);
    delete (textures.skins!['style-2'] as Record<string, Texture>).noAdsArt;
    expect(() => noAds(kit, S2)).not.toThrow();
    expect(() => new NoAdsWindowView({ ui: kit.ui, motion: kit.motion, textures, theme: { skin: S2 }, id: 'broken', onBuy: () => {} }))
      .toThrow("NoAdsWindowView style 'style-2': no noAdsArt (style2/noads_hero.webp) in textures");
  });
});
