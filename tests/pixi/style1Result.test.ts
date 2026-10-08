import { describe, expect, it, vi } from 'vitest';
import { Assets, type Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer } from './setup';
import { LocalizationRuntime } from '../../src/localization';
import { READY_UI_CATALOGS } from '../../src/pixi';
import { LivesWindowView, type LivesWindowParams } from '../../src/pixi/LivesWindowView';
import { ResultWindowView, WIN_CONFETTI_TEXTURES, type ResultWindowParams, type ResultWindowViewOptions } from '../../src/pixi/ResultWindowView';
import { formatAmount } from '../../src/pixi/text';
import { READY_UI_OPTIONAL_ASSET_FILES, loadReadyUiAssets, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_SKIN_WINDOW_ROLES, requiredSkinRoles, type ReadyUiSkin, type ReadyUiSkinRole, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const S1 = READY_UI_STYLE_1;
const R = S1.windows.result;
/** Style 1 frame → panel units (the styled panel origin is the frame centre). */
const X = (x: number): number => x - S1.frame.width / 2;
const Y = (y: number): number => y - S1.frame.height / 2;

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

/** The required pack only (no optional kit texture), plus the style's role textures as loadReadyUiAssets({ skin }) files them. */
function styled(kit: Kit, skin: ReadyUiSkin = S1): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinRole[]) roles[role] = labelled(`${skin.id}:${role}`);
  return { ...required, victoryRibbon: labelled('donor:victoryRibbon'), coinBig: labelled('donor:coinBig'), btnGreen: labelled('donor:btnGreen'), btnYellow: labelled('donor:btnYellow'), skins: { [skin.id]: roles } };
}

function result(kit: Kit, textures: ReadyUiTextures, extra: Partial<ResultWindowViewOptions> = {}, log: string[] = []): ResultWindowView {
  return new ResultWindowView({
    ui: kit.ui, motion: kit.motion, textures, id: 'result',
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

function tap(kit: Kit, target: UiButton): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 400);
}

const texture = (node: Container): string => ((node as Sprite).texture ?? (node as unknown as UiButton).background.texture).source.label ?? '';
const panel = (view: ResultWindowView): Container => field<Container>(view, 'panel');
/** The visible sprites (and buttons' backgrounds) of the panel, by texture label: what the composition is drawn with. */
function drawn(view: ResultWindowView): string[] {
  const out: string[] = [];
  for (const child of panel(view).children as Container[]) {
    if (!child.visible) continue;
    if (child instanceof Sprite || child instanceof NineSliceSprite) out.push(texture(child));
    else if ('background' in child) out.push(texture(child));
  }
  return out;
}
function texts(view: ResultWindowView): string[] {
  const out: string[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children as Container[]) {
      if (!child.visible) continue;
      if (child instanceof Text) out.push(child.text);
      else visit(child);
    }
  };
  visit(panel(view));
  return out;
}

describe('Style 1 Result — the package (Figma screen/result-win 1:3854, screen/result-fail 1:4029)', () => {
  it('covers result with every role it draws; the files are the Figma exports (no text baked in), shared art reused', () => {
    expect(S1.covers).toContain('result');
    // theme_light_6's dark WIN has no glow: every role but resultGlowWin (the FAIL keeps its glow)
    expect(S1.windows.result.win.glow).toBeNull();
    expect(requiredSkinRoles(S1, 'result')).toEqual(READY_UI_SKIN_WINDOW_ROLES.result.filter((role) => role !== 'resultGlowWin'));
    for (const role of requiredSkinRoles(S1, 'result')) expect((S1.assets as Record<string, { file: string } | undefined>)[role]?.file, role).toBeTruthy();
    expect('resultGlowWin' in S1.assets).toBe(false);
    // the stars are the kit's gold star file; the WIN × is theme_light_6's black 45 % glyph
    expect(S1.assets.resultStar.file).toBe('level/star_gold.webp');
    expect(S1.assets.resultCloseWin.file).toBe('result/style1_close_dark@2x.webp');
    // the life-lost art, the button surfaces and the highlight are Confirm's / Lives' files; EXIT = the RETURN HOME art
    expect(S1.assets.lifeLostArt.file).toBe('icons/broken_heart@2x.webp');
    expect(S1.assets.buttonPrimary.nineSlice).toEqual({ left: 67, top: 69, right: 67, bottom: 89 });
    expect(S1.assets.buttonExit.file).toBe(S1.assets.settingsBtnHome.file);
    expect(S1.assets.resultRibbonWin.file).toBe('result/style1_ribbon_win@2x.webp');
    expect(S1.assets.resultRibbonFail.file).toBe('result/style1_ribbon_fail@2x.webp');
    // Style 2 covers it too now (theme_light_6 28:48352): its own Result, never Style 1's
    expect(READY_UI_STYLE_2.covers).toContain('result');
  });
});

describe('Style 1 Result — WIN', () => {
  it('is selected by theme.skin: the red ribbon, reward coin, 9-slice CTAs (theme_light_6: no glow); no donor art', () => {
    const kit = createKit();
    const created = result(kit, styled(kit), { theme: { skin: S1 } });
    // the style's × from construction (never the kit's red btnClose, not even before the first show)
    expect(texture(field<UiButton>(created, 'closeButton'))).toBe('style-1:resultCloseWin');
    const view = shown(kit, created, { level: 7, stars: 3, rewardCoins: 1250 });
    expect(view.skin).toBe(S1);
    const art = drawn(view);
    for (const role of ['rewardCoin', 'buttonPrimary', 'buttonRewarded', 'resultRibbonWin']) expect(art).toContain(`style-1:${role}`);
    expect(art.some((label) => label.includes('Glow'))).toBe(false);
    // the stars are the style's resultStar
    expect(field<Sprite[]>(view, 'stars').map((star) => star.texture.source.label)).toEqual(['style-1:resultStar', 'style-1:resultStar', 'style-1:resultStar']);
    expect(art.some((label) => label.startsWith('donor:'))).toBe(false);
    expect(art).not.toContain('style-1:resultRibbonFail');
    expect(art).not.toContain('style-1:resultGlowFail');
    // the CTAs are the style's 9-slices at the Figma boxes; the secondary carries the gold highlight under its label
    const next = field<UiButton>(view, 'nextButton');
    const retry = field<UiButton>(view, 'retryButton');
    expect(next.background).toBeInstanceOf(NineSliceSprite);
    // theme_light_6 28:48286 re-laid on x 540: 440 × 200 / 460 × 200 on one row
    expect([next.x, next.y]).toEqual([X(71.5 + 440 / 2), Y(1292 + 200 / 2)]);
    expect([retry.x, retry.y]).toEqual([X(548.5 + 460 / 2), Y(1292 + 200 / 2)]);
    expect([next.background.width, next.background.height, retry.background.width, retry.background.height]).toEqual([440, 200, 460, 200]);
    expect(texture(retry.children[1] as Container)).toBe('style-1:buttonHighlight');
    // the × is the ribbon's tinted glyph at the Figma box
    const close = field<UiButton>(view, 'closeButton');
    expect(texture(close)).toBe('style-1:resultCloseWin');
    expect([close.x, close.y]).toEqual([X(957 + 25), Y(695 + 25)]);
    // runtime text: title / subtitle on the ribbon, the caption, the amount, the labels
    expect(texts(view)).toEqual(expect.arrayContaining(['LEVEL 7', 'COMPLETED!', 'REWARDS', formatAmount(1250), 'CONTINUE', 'RETRY']));
    view.destroy();
  });

  it('keeps the WIN semantics: the stars land on the style crown boxes, the backdrop is the style dim, one frame-fit scale', () => {
    const kit = createKit();
    const view = shown(kit, result(kit, styled(kit), { theme: { skin: S1 } }), { level: 3, stars: 2, rewardCoins: 10 });
    const stars = field<Sprite[]>(view, 'stars');
    expect(stars.map((s) => [s.x, s.y])).toEqual(R.win.stars.map((s) => [X(s.x), Y(s.y)]));
    expect(stars.map((s) => s.visible)).toEqual([true, true, false]); // never more than earned
    expect([field<number>(view, 'backdropColor'), field<number>(view, 'backdropAlpha')]).toEqual([S1.backdrop.color, S1.backdrop.alpha]);
    // the styled scale is the style frame's contain-fit (as Figma: the 1080 × 2344 screen on a 390 × 844 phone)
    expect(field<number>(view, 'fitScale')).toBeCloseTo(Math.min(390 / 1080, 844 / 2344), 6);
    // the earned stars at rest are part of the tap area (a tap on a landed star never dismisses)
    const hit = panel(view).hitArea as { contains(x: number, y: number): boolean };
    expect(hit.contains(X(R.win.stars[0].x), Y(R.win.stars[0].y))).toBe(true);
    view.destroy();
  });

  it('values stay dynamic: a second show re-lays the level and the amount; without RETRY, CONTINUE moves to the centre', () => {
    const kit = createKit();
    const view = result(kit, styled(kit), { theme: { skin: S1 } });
    shown(kit, view, { level: 1, stars: 1, rewardCoins: 5 });
    view.close('programmatic', () => {});
    advance(kit.core, 400);
    shown(kit, view, { level: 205, stars: 3, rewardCoins: 999999, retry: false, title: 'LEVEL 205!' });
    expect(texts(view)).toEqual(expect.arrayContaining(['LEVEL 205!', formatAmount(999999)]));
    expect(field<UiButton>(view, 'retryButton').visible).toBe(false);
    expect(field<UiButton>(view, 'nextButton').x).toBe(0);
    view.destroy();
  });
});

describe('Style 1 Result — FAIL', () => {
  it('grey ribbon with one title line, the broken heart and its runtime "-1", the outcome line under it, RETRY + optional EXIT', () => {
    const kit = createKit();
    const view = shown(kit, result(kit, styled(kit), { theme: { skin: S1 } }), { level: 12, outcome: 'fail', rewardCoins: 0 });
    const art = drawn(view);
    for (const role of ['resultGlowFail', 'lifeLostArt', 'buttonPrimary', 'buttonExit', 'resultRibbonFail']) expect(art).toContain(`style-1:${role}`);
    for (const role of ['resultRibbonWin', 'resultGlowWin', 'rewardCoin', 'buttonRewarded']) expect(art).not.toContain(`style-1:${role}`);
    expect(texture(field<UiButton>(view, 'closeButton'))).toBe('style-1:resultCloseFail');
    expect(texts(view)).toEqual(expect.arrayContaining(['LEVEL 12', 'FAILED', '-1', 'RETRY', 'EXIT']));
    expect(texts(view)).not.toContain('COMPLETED!');
    const retry = field<UiButton>(view, 'failRetryButton');
    expect([retry.x, retry.y]).toEqual([X(240 + 300), Y(1461 + 103)]);
    expect(retry.background).toBeInstanceOf(NineSliceSprite);
    const exit = field<UiButton>(view, 'exitButton');
    expect(exit.background).not.toBeInstanceOf(NineSliceSprite); // fixed art drawn at its box
    expect([exit.background.width, exit.background.height]).toEqual([509, 176]);
    view.destroy();
  });

  it('EXIT only with onExit; lifeDelta overrides the delta text, null drops the life-lost art (a game without lives)', () => {
    const kit = createKit();
    const noExit = shown(kit, result(kit, styled(kit), { theme: { skin: S1 }, onExit: undefined as never, lifeDelta: '-2' }), { level: 2, outcome: 'fail', rewardCoins: 0 });
    expect(field<UiButton>(noExit, 'exitButton').visible).toBe(false);
    expect(texts(noExit)).toContain('-2');
    noExit.destroy();
    const kit2 = createKit();
    const noLives = shown(kit2, result(kit2, styled(kit2), { theme: { skin: S1 }, lifeDelta: null }), { level: 2, outcome: 'fail', rewardCoins: 0 });
    expect(drawn(noLives)).not.toContain('style-1:lifeLostArt');
    expect(texts(noLives)).not.toContain('-1');
    noLives.destroy();
  });

  it('one scale for both outcomes; the same instance switches ribbon, glow and × between WIN and FAIL', () => {
    const kit = createKit();
    const view = result(kit, styled(kit), { theme: { skin: S1 } });
    shown(kit, view, { level: 4, stars: 3, rewardCoins: 20 }, 1280, 800);
    const winScale = field<number>(view, 'fitScale');
    view.close('programmatic', () => {});
    advance(kit.core, 400);
    shown(kit, view, { level: 4, outcome: 'fail', rewardCoins: 0 }, 1280, 800);
    expect(field<number>(view, 'fitScale')).toBe(winScale);
    expect(winScale).toBeCloseTo(Math.min(1280 / 1080, 800 / 2344), 6);
    expect(drawn(view)).toContain('style-1:resultRibbonFail');
    view.close('programmatic', () => {});
    advance(kit.core, 400);
    shown(kit, view, { level: 5, stars: 1, rewardCoins: 3 }, 1280, 800);
    expect(drawn(view)).toContain('style-1:resultRibbonWin');
    expect(drawn(view)).not.toContain('style-1:lifeLostArt');
    expect(texture(field<UiButton>(view, 'closeButton'))).toBe('style-1:resultCloseWin');
    view.destroy();
  });
});

describe('Style 1 Result — behaviour unchanged', () => {
  it('callbacks are close continuations; × / backdrop only dismiss (both outcomes)', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = result(kit, styled(kit), { theme: { skin: S1 } }, log);
    shown(kit, view, { level: 9, stars: 3, rewardCoins: 1 });
    tap(kit, field<UiButton>(view, 'nextButton'));
    shown(kit, view, { level: 9, stars: 3, rewardCoins: 1 });
    tap(kit, field<UiButton>(view, 'retryButton'));
    shown(kit, view, { level: 9, outcome: 'fail', rewardCoins: 0 });
    tap(kit, field<UiButton>(view, 'failRetryButton'));
    shown(kit, view, { level: 9, outcome: 'fail', rewardCoins: 0 });
    tap(kit, field<UiButton>(view, 'exitButton'));
    shown(kit, view, { level: 9, outcome: 'fail', rewardCoins: 0 });
    tap(kit, field<UiButton>(view, 'closeButton'));
    expect(log).toEqual(['next:9', 'retry:win:9', 'retry:fail:9', 'exit:9', 'dismiss:button']);
    view.destroy();
  });

  it('localization: catalog copy through i18n, explicit options and params still win; the skin does not fork by locale', () => {
    const kit = createKit();
    const ru = new LocalizationRuntime({ rawLocale: 'ru-RU', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const win = shown(kit, result(kit, styled(kit), { theme: { skin: S1 }, i18n: ru }), { level: 8, stars: 3, rewardCoins: 40 });
    expect(texts(win)).toEqual(expect.arrayContaining(['УРОВЕНЬ 8', 'ПРОЙДЕН!', 'НАГРАДА', 'ДАЛЕЕ', 'ЗАНОВО']));
    win.destroy();
    const kit2 = createKit();
    const fail = shown(kit2, result(kit2, styled(kit2), { theme: { skin: S1 }, i18n: ru, exitLabel: 'НА КАРТУ' }), { level: 8, outcome: 'fail', rewardCoins: 0, subtitle: 'НЕТ ХОДОВ' });
    expect(texts(fail)).toEqual(expect.arrayContaining(['УРОВЕНЬ 8', 'НЕТ ХОДОВ', 'ЗАНОВО', 'НА КАРТУ']));
    fail.destroy();
  });

  it('confetti and the star entrance still run on the styled WIN (same effect objects, same scope)', () => {
    const kit = createKit();
    const textures = styled(kit);
    for (const name of WIN_CONFETTI_TEXTURES) textures[name] = labelled(`fx:${name}`);
    const view = result(kit, textures, { theme: { skin: S1 }, confetti: true });
    view.resize(390, 844);
    view.show({ level: 1, stars: 3, rewardCoins: 1 });
    expect(field<{ playing?: boolean }>(view, 'confetti')).toBeTruthy();
    expect(panel(view).children).toContain(field<Container>(view, 'confetti'));
    advance(kit.core, 2400);
    expect(field<Sprite[]>(view, 'stars').every((s) => s.visible)).toBe(true);
    view.destroy();
  });
});

describe('Style 1 Result — isolation and strict assets', () => {
  it('no skin = the donor Result, unchanged (victory ribbon, kit coin and buttons, donor geometry and fit)', () => {
    const kit = createKit();
    const view = shown(kit, result(kit, styled(kit)), { level: 7, stars: 3, rewardCoins: 1250 });
    expect(view.skin).toBeNull();
    const art = drawn(view);
    expect(art).toEqual(expect.arrayContaining(['donor:victoryRibbon', 'donor:coinBig', 'donor:btnGreen', 'donor:btnYellow']));
    expect(art.some((label) => label.startsWith('style-1:'))).toBe(false);
    expect([field<UiButton>(view, 'nextButton').x, field<UiButton>(view, 'nextButton').y]).toEqual([-230, 310]);
    expect(field<number>(view, 'fitScale')).toBeCloseTo(0.3368, 3); // the accepted donor phone scale
    view.destroy();
  });

  it('Style 2 draws its own Result (never Style 1\'s or the donor\'s); a style that does not cover result keeps the donor look', () => {
    const kit = createKit();
    const view = shown(kit, result(kit, styled(kit, READY_UI_STYLE_2), { theme: { skin: READY_UI_STYLE_2 } }), { level: 2, outcome: 'fail', rewardCoins: 0 });
    expect(view.skin).toBe(READY_UI_STYLE_2);
    expect(drawn(view).every((label) => label.startsWith('style-2:'))).toBe(true);
    view.destroy();
    const kit2 = createKit();
    const { result: _r, ...windows } = S1.windows;
    const uncovering = { ...S1, id: 'no-result', covers: S1.covers.filter((v) => v !== 'result'), windows } as unknown as ReadyUiSkin;
    const donor = shown(kit2, result(kit2, styled(kit2, uncovering), { theme: { skin: uncovering } }), { level: 2, outcome: 'fail', rewardCoins: 0 });
    expect(donor.skin).toBeNull();
    expect(drawn(donor)).toContain('donor:victoryRibbon');
    donor.destroy();
  });

  it('a selected style never falls back silently: missing role textures throw before anything registers', () => {
    const kit = createKit();
    const textures = styled(kit);
    const roles = { ...(textures.skins?.['style-1'] ?? {}) };
    delete roles.resultRibbonFail;
    expect(() => result(kit, { ...textures, skins: { 'style-1': roles } }, { theme: { skin: S1 } }))
      .toThrow("ResultWindowView style 'style-1': no resultRibbonFail (result/style1_ribbon_fail@2x.webp) in textures — load them with loadReadyUiAssets({ skin })");
    // nothing registered: the id is still free for a correct window
    expect(() => result(kit, textures, { theme: { skin: S1 } }).destroy()).not.toThrow();
    const { resultGlowFail: _g, ...brokenAssets } = S1.assets;
    const broken = { ...S1, id: 'broken', assets: brokenAssets } as unknown as ReadyUiSkin;
    expect(() => result(kit, textures, { theme: { skin: broken } })).toThrow("ReadyUiSkin 'broken' covers 'result' but has no asset for role 'resultGlowFail'");
  });

  it('loadReadyUiAssets({ skin: Style 1 }) requests the Result files; no skin requests none of them', async () => {
    const requested: string[] = [];
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (urls: unknown) => {
      if (Array.isArray(urls)) return {};
      const { src } = urls as { src: string };
      requested.push(src);
      return labelled(src);
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => labelled('required')) as never);
    try {
      await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true });
      expect(requested.some((src) => src.includes('/result/'))).toBe(false);
      const textures = await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: S1 });
      for (const role of ['resultRibbonWin', 'resultRibbonFail', 'resultGlowFail', 'resultCloseWin', 'resultCloseFail', 'rewardCoin', 'resultStar'] as const) {
        expect(requested).toContain(`/pack/${S1.assets[role].file}`);
        expect(textures.skins?.['style-1']?.[role]).toBeDefined();
      }
    } finally {
      load.mockRestore();
      get.mockRestore();
    }
  });
});

describe('LivesWindowView refillOffer (a game without a refill economy)', () => {
  const PARAMS: LivesWindowParams = { lives: 0, maxLives: 5, timerText: '29:59', refillPrice: 0 };
  function lives(kit: Kit, textures: ReadyUiTextures, extra: object = {}): LivesWindowView {
    return new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures, id: 'lives', onRefill: () => {}, ...extra });
  }

  it('default unchanged; false hides REFILL (also not tappable), the rewarded button then takes the centre — donor and Style 1', () => {
    for (const skin of [null, S1] as const) {
      const kit = createKit();
      const textures = skin ? styled(kit) : kit.textures;
      const theme = skin ? { theme: { skin } } : {};
      const withAd = lives(kit, textures, { ...theme, onWatchAd: () => {} });
      withAd.resize(390, 844);
      withAd.show({ ...PARAMS });
      const refill = field<UiButton>(withAd, 'refillButton');
      const ad = field<UiButton>(withAd, 'adButton');
      const adX = ad.x;
      expect(refill.visible).toBe(true);
      expect(adX).not.toBe(0);
      withAd.close('programmatic', () => {});
      advance(kit.core, 400);
      withAd.show({ ...PARAMS, refillOffer: false });
      expect(refill.visible).toBe(false);
      expect(refill.controller.enabled).toBe(false);
      expect(ad.visible).toBe(true);
      expect(ad.x).toBe(0);
      withAd.close('programmatic', () => {});
      advance(kit.core, 400);
      withAd.show({ ...PARAMS });
      expect(refill.visible).toBe(true);
      expect(ad.x).toBe(adX);
      withAd.destroy();
    }
  });
});
