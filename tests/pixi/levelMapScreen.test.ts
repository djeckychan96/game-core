import { describe, expect, it, vi } from 'vitest';
import { Assets, Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer, type TestKit } from './setup';
import { LocalizationRuntime } from '../../src/localization';
import { LevelMapScreen, type LevelMapScreenOptions } from '../../src/pixi/LevelMapScreen';
import { LevelMapView } from '../../src/pixi/LevelMapView';
import { loadReadyUiAssets, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { requiredSkinRoles, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { ReadyUiThemeOverrides } from '../../src/pixi/theme';

const rootDir = resolve(__dirname, '../..');
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });
const STYLE_2_MAP = { badgeSize: 288, nodeScale: 1, levelGap: 402, focusBoost: 4 / 3, focusRatio: 1260 / 2344, contentScale: 1 };
const STYLES: ReadonlyArray<{ name: string; skin: ReadyUiSkin; theme: ReadyUiThemeOverrides }> = [
  { name: 'Style 1', skin: READY_UI_STYLE_1, theme: { skin: READY_UI_STYLE_1 } },
  { name: 'Style 2', skin: READY_UI_STYLE_2, theme: { skin: READY_UI_STYLE_2, levelMap: STYLE_2_MAP } }
];

/** One labelled texture per asset of `skin` (as `loadReadyUiAssets({ skin })` files them), on top of the white required pack. */
function styled(kit: TestKit, skin: ReadyUiSkin, drop: readonly ReadyUiSkinAssetKey[] = []): ReadyUiTextures {
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) if (!drop.includes(role)) roles[role] = labelled(`${skin.id}:${role}`);
  return { ...kit.textures, skins: { [skin.id]: roles } };
}

function descendants<T>(root: Container, type: new (...args: never[]) => T): T[] {
  const found: T[] = [];
  const visit = (container: Container): void => {
    for (const child of container.children) {
      if (child instanceof type) found.push(child as T);
      if (child instanceof Container) visit(child);
    }
  };
  visit(root);
  return found;
}

const visibleSprites = (root: Container): Sprite[] => descendants(root, Sprite).filter((sprite) => sprite.visible);
const labels = (root: Container): string[] => visibleSprites(root).map((sprite) => sprite.texture.source.label);
const texts = (root: Container): string[] => descendants(root, Text).filter((text) => text.visible).map((text) => text.text);
const sprite = (root: Container, label: string): Sprite => {
  const found = descendants(root, Sprite).find((entry) => entry.texture.source.label === label);
  if (!found) throw new Error(`no sprite ${label}`);
  return found;
};

/** A settled tap on a pointer-driven container. */
function tap(target: Container, kit: TestKit): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 200);
}

function createScreen(kit: TestKit, style: (typeof STYLES)[number], overrides: Partial<LevelMapScreenOptions> = {}) {
  const played: number[] = [];
  const screen = new LevelMapScreen({
    ui: kit.ui,
    motion: kit.motion,
    textures: styled(kit, style.skin),
    theme: style.theme,
    map: { levels: 60, currentLevel: 38 },
    hud: { coins: 120, lives: 3, maxLives: 5 },
    onPlay: (level) => played.push(level),
    width: 390,
    height: 844,
    ...overrides
  });
  return { screen, played };
}

const SLOTS = ['shop', 'home', 'lock'] as const;

describe.each(STYLES)('LevelMapScreen — one functional contract ($name)', (style) => {
  it('draws PLAY and the SHOP | HOME | LOCK navigation: HOME selected, LOCK in the locked state, the art the style\'s', () => {
    const kit = createKit();
    const { screen } = createScreen(kit, style);
    const id = style.skin.id;
    expect(screen.children).toEqual([screen.map, screen.play, screen.nav, screen.hud]);
    expect(screen.play.background.texture.source.label).toBe(`${id}:playButton`);
    expect(screen.nav.itemIds).toEqual(['shop', 'home', 'lock']);
    expect(screen.nav.selectedId).toBe('home');
    expect(SLOTS.map((slot) => screen.nav.isLocked(slot))).toEqual([false, false, true]);
    const item = (slot: string): Container => screen.nav.getItemContainer(slot)!;
    expect(labels(item('shop'))).toEqual([`${id}:iconShop`]);
    expect(labels(item('home'))).toEqual([`${id}:iconHome`]);
    expect(descendants(item('home'), NineSliceSprite)[0]!.texture.source.label).toBe(`${id}:navSelected`);
    expect(labels(item('lock'))).toEqual([`${id}:navLock`]);
    // the captions are Core's localized defaults
    expect(SLOTS.map((slot) => texts(item(slot)))).toEqual([['SHOP'], ['HOME'], ['LOCK']]);
    expect(descendants(item('home'), NineSliceSprite)[0]!.visible).toBe(true);
    screen.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('slot callbacks: a slot with onTap reports its taps (selection stays the host\'s); without onTap it is disabled', () => {
    const kit = createKit();
    const taps: string[] = [];
    const { screen } = createScreen(kit, style, {
      nav: { shop: { onTap: () => taps.push('shop') }, home: { onTap: () => taps.push('home') }, lock: { onTap: () => taps.push('lock') } }
    });
    for (const slot of SLOTS) tap(screen.nav.getItemContainer(slot)!, kit);
    expect(taps).toEqual(['shop', 'home', 'lock']);
    expect(screen.nav.selectedId).toBe('home');
    expect(SLOTS.map((slot) => screen.nav.isDisabled(slot))).toEqual([false, false, false]);
    screen.destroy();

    // nothing given: every slot is drawn; SHOP / HOME inert, LOCK a locked slot that still answers a tap with a shake
    const { screen: inert } = createScreen(createKit(), style, { nav: {} });
    expect(SLOTS.map((slot) => inert.nav.isDisabled(slot))).toEqual([true, true, false]);
    expect(inert.nav.getItemContainer('shop')!.cursor).toBe('default');
    inert.destroy();

    // SHOP disabled by the host, enabled later; a disabled item never calls back and shows no press feedback
    const kit2 = createKit();
    const shop: string[] = [];
    const { screen: gated } = createScreen(kit2, style, { nav: { shop: { onTap: () => shop.push('shop'), disabled: true } } });
    const shopItem = gated.nav.getItemContainer('shop')!;
    shopItem.emit('pointerdown', pointer(1, 1) as never);
    advance(kit2.core, 80);
    expect(shopItem.children[0]!.scale.x).toBe(1);
    shopItem.emit('pointerup', pointer(1, 1) as never);
    advance(kit2.core, 200);
    expect(shop).toEqual([]);
    gated.nav.setDisabled('shop', false);
    expect(shopItem.cursor).toBe('pointer');
    tap(shopItem, kit2);
    expect(shop).toEqual(['shop']);
    gated.destroy();
    expect(kit2.uiErrors).toEqual([]);
  });

  it('select level → PLAY → host callback: a node tap selects its level, PLAY launches it; a node launch hook still hears the tap', () => {
    const kit = createKit();
    const legacy: string[] = [];
    const locked: number[] = [];
    const { screen, played } = createScreen(kit, style, {
      map: { levels: 60, currentLevel: 38, onSelectLevel: (level, state) => legacy.push(`${level}:${state}`), onLockedTap: (level) => locked.push(level) }
    });
    expect(screen.playLevel).toBe(38);
    tap(screen.map.getNodeContainer(35)!, kit);
    // the tap told the host and selected the level (the map scrolls it under the focus); nothing launched yet
    expect(legacy).toEqual(['35:completed']);
    expect(played).toEqual([]);
    advance(kit.core, 1000);
    expect(screen.map.focusLevel).toBe(35);
    expect(screen.playLevel).toBe(35);
    tap(screen.play, kit);
    expect(played).toEqual([35]);
    // a locked node shakes and reports; the selection stays
    tap(screen.map.getNodeContainer(40)!, kit);
    advance(kit.core, 600);
    expect(locked).toEqual([40]);
    expect(screen.playLevel).toBe(35);
    // the current level is selected the same way
    tap(screen.map.getNodeContainer(38)!, kit);
    advance(kit.core, 1000);
    tap(screen.play, kit);
    expect(played).toEqual([35, 38]);
    screen.destroy();
    expect(kit.uiErrors).toEqual([]);
    expect(kit.motionErrors).toEqual([]);
  });

  it('PLAY right after a node tap launches the tapped level, not one the select-scroll is passing; a drag or the host\'s scroll takes over', () => {
    const kit = createKit();
    const { screen, played } = createScreen(kit, style);
    // tap a far node, then PLAY at once (the scroll to it is still running)
    tap(screen.map.getNodeContainer(30)!, kit);
    expect(screen.map.focusLevel).not.toBe(30);
    expect(screen.playLevel).toBe(30);
    tap(screen.play, kit);
    expect(played).toEqual([30]);
    advance(kit.core, 1000);
    expect([screen.map.focusLevel, screen.playLevel]).toEqual([30, 30]);
    // a new press on the map replaces a selection still scrolling in
    tap(screen.map.getNodeContainer(34)!, kit);
    expect(screen.playLevel).toBe(34);
    screen.map.emit('pointerdown', { ...pointer(1, 1), pointerId: 7 } as never);
    expect(screen.playLevel).toBe(screen.map.selectedLevel);
    screen.map.emit('pointerup', { ...pointer(1, 1), pointerId: 7 } as never);
    advance(kit.core, 1000);
    // the host's own scroll away from a pending selection wins too
    tap(screen.map.getNodeContainer(25)!, kit);
    advance(kit.core, 48);
    screen.map.scrollToLevel(36);
    advance(kit.core, 1000);
    expect([screen.map.focusLevel, screen.playLevel]).toEqual([36, 36]);
    tap(screen.play, kit);
    expect(played).toEqual([30, 36]);
    screen.destroy();
    expect(kit.uiErrors).toEqual([]);
    expect(kit.motionErrors).toEqual([]);
  });

  it('captions: explicit labels win, then the provider (RU), then Core\'s English', () => {
    const ru = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const { screen } = createScreen(createKit(), style, { i18n: ru, nav: { shop: { label: 'ЛАВКА' } } });
    expect(SLOTS.map((slot) => texts(screen.nav.getItemContainer(slot)!))).toEqual([['ЛАВКА'], ['ДОМОЙ'], ['ЗАКРЫТО']]);
    expect(texts(screen.play)[0]).toBe('ИГРАТЬ');
    screen.destroy();
  });

  it('keeps the earlier generic nav form (an item list with the host\'s routing)', () => {
    const kit = createKit();
    const routed: string[] = [];
    const { screen } = createScreen(kit, style, {
      nav: { items: [{ id: 'a', icon: 'iconShop', label: 'A' }, { id: 'b', icon: 'iconHome', label: 'B' }], selectedId: 'a', onSelect: (id) => routed.push(id) }
    });
    expect(screen.nav.itemIds).toEqual(['a', 'b']);
    expect(screen.nav.selectedId).toBe('a');
    tap(screen.nav.getItemContainer('b')!, kit);
    expect(routed).toEqual(['b']);
    screen.destroy();
  });

  it('lays out on a phone, a small phone and a desktop: PLAY above the nav, inside the width, the map down to PLAY', () => {
    const kit = createKit();
    const { screen } = createScreen(kit, style);
    const play = style.skin.levelMapScreen!.play;
    for (const [w, h] of [[390, 844], [320, 568], [1280, 800]] as const) {
      screen.resize(w, h, { insets: { top: 20, bottom: 20 } });
      const s = Math.min(w / 1080, h / 2344);
      expect(screen.nav.top).toBeCloseTo(h - 20 - style.skin.bottomNav!.panelHeight * s, 6);
      expect(screen.play.y).toBeCloseTo(screen.nav.top - play.aboveNav * s, 6);
      expect(screen.play.x).toBeCloseTo(w / 2, 6);
      expect(play.width * screen.play.scale.x).toBeLessThanOrEqual(w + 1e-6);
      expect((screen.map as unknown as { mapBottom: number }).mapBottom).toBeCloseTo(screen.play.y - (play.height / 2) * screen.play.scale.y, 6);
      expect(screen.hud.barHeight).toBeLessThan(screen.play.y);
      // three slots inside the width
      const xs = SLOTS.map((slot) => screen.nav.getItemContainer(slot)!.x);
      expect(xs[1]).toBeCloseTo(0, 6);
      expect((xs[2]! - xs[0]!) * s).toBeLessThanOrEqual(w);
    }
    screen.destroy();
  });
});

describe('LevelMapScreen — the look stays the style\'s', () => {
  it('Style 1 (theme_light_5 purple): PLAY without a level line, kit-outlined; the dark nav components on a 364 pitch', () => {
    const kit = createKit();
    const { screen } = createScreen(kit, STYLES[0]!, { width: 1080, height: 2344 });
    expect([screen.play.background.width, screen.play.background.height]).toEqual([522, 228]);
    expect(texts(screen.play)).toEqual(['PLAY']);
    const playText = descendants(screen.play, Text)[0]!;
    expect([playText.style.fontSize, playText.style.fill, playText.style.fontFamily]).toEqual([110, 0xffffff, 'Firasans Black']);
    expect(playText.style.stroke).toMatchObject({ width: 8 });
    expect(playText.style.dropShadow).toMatchObject({ distance: 4 });
    // PLAY's render centre 286 units above the panel rect
    expect(screen.play.y).toBeCloseTo(2344 - 286 - 286, 6);
    const item = (slot: string): Container => screen.nav.getItemContainer(slot)!;
    // the 1080 frame fits three 360-unit slots (Core's shrink-to-fit rule: width / 3); a wider screen keeps the 364 pitch
    expect(SLOTS.map((slot) => item(slot).x)).toEqual([-360, 0, 360]);
    screen.resize(1280, 800);
    expect(SLOTS.map((slot) => item(slot).x)).toEqual([-364, 0, 364]);
    // active HOME: the column (its render box down to the viewport bottom), the 288 icon at 51, the 54 caption;
    // inactive SHOP / LOCK: 220 at 98, 40 captions
    const column = descendants(item('home'), NineSliceSprite)[0]!;
    expect([column.x, column.y, column.width, column.height]).toEqual([-182, -28, 364, 314]);
    screen.resize(1080, 2344);
    expect([sprite(item('home'), 'style-1:iconHome').y, sprite(item('home'), 'style-1:iconHome').width]).toEqual([51, 288]);
    expect([sprite(item('shop'), 'style-1:iconShop').y, sprite(item('shop'), 'style-1:iconShop').width]).toEqual([98, 220]);
    expect([sprite(item('lock'), 'style-1:navLock').y, sprite(item('lock'), 'style-1:navLock').width]).toEqual([98, 220]);
    const caption = (slot: string): Text => descendants(item(slot), Text)[0]!;
    expect([caption('home').style.fontSize, caption('shop').style.fontSize, caption('lock').style.fontSize]).toEqual([54, 40, 40]);
    // white Fira Sans Black, a 3-unit OUTSIDE #261a30 stroke and its 4-unit hard shadow
    expect(caption('home').style.stroke).toMatchObject({ width: 6, color: 0x261a30 });
    expect(caption('home').style.dropShadow).toMatchObject({ distance: 4, color: 0x261a30 });
    expect(caption('shop').style.fontFamily).toBe('Firasans Black');
    screen.destroy();
  });

  it('Style 2 (theme_light_5 light): PLAY with the level line, plain Carlito; HOME selected, captioned LOCK on a 664 pitch', () => {
    const kit = createKit();
    const { screen } = createScreen(kit, STYLES[1]!, { width: 1422, height: 800 });
    expect([screen.play.background.width, screen.play.background.height]).toEqual([550, 280]);
    expect(texts(screen.play)).toEqual(['PLAY', 'Level 38']);
    const item = (slot: string): Container => screen.nav.getItemContainer(slot)!;
    expect(SLOTS.map((slot) => item(slot).x)).toEqual([-664, 0, 664]);
    expect([sprite(item('home'), 'style-2:iconHome').y, sprite(item('home'), 'style-2:iconHome').width]).toEqual([43, 288]);
    expect(sprite(item('shop'), 'style-2:iconShop').y).toBe(93.517);
    expect(sprite(item('shop'), 'style-2:iconShop').width).toBeCloseTo(267.034, 6);
    expect(sprite(item('lock'), 'style-2:navLock').y).toBe(97.517);
    const caption = (slot: string): Text => descendants(item(slot), Text)[0]!;
    expect([caption('home').style.fontSize, caption('lock').style.fontSize, caption('lock').style.fontFamily]).toEqual([60, 40, 'Carlito']);
    expect(caption('lock').style.stroke).toBeFalsy();
    expect(caption('lock').style.dropShadow).toBeFalsy();
    screen.destroy();
  });
});

describe('LevelMapScreen — Style 1 package and compatibility', () => {
  it('Style 1 now covers the nav and the screen: valid, its roles shipped, the files on disk under nav/ and button/', () => {
    expect(() => validateReadyUiSkin(READY_UI_STYLE_1)).not.toThrow();
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'bottomNav')).toEqual(['navPanel', 'navSelected', 'navLock']);
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'levelMapScreen')).toEqual(['playButton', 'iconShop', 'iconHome']);
    const assetsDir = resolve(rootDir, 'assets/pixi-ui');
    for (const role of ['playButton', 'navPanel', 'navSelected', 'navLock', 'iconShop', 'iconHome'] as const) {
      const file = READY_UI_STYLE_1.assets[role]!.file;
      expect(file.startsWith('nav/style1_') || file === 'button/style1_play.webp', file).toBe(true);
      expect(existsSync(resolve(assetsDir, file)), file).toBe(true);
    }
    expect(existsSync(resolve(assetsDir, READY_UI_STYLE_2.assets.navLock.file))).toBe(true);
    // a style covering the screen without its slot icons is not a valid package
    const noIcon = { ...READY_UI_STYLE_1, id: 'no-icon', assets: { ...READY_UI_STYLE_1.assets, iconShop: undefined } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(noIcon)).toThrow("ReadyUiSkin 'no-icon' covers 'levelMapScreen' but has no asset for role 'iconShop'");
  });

  it('a missing Style 1 nav texture fails clearly (never a silent donor fallback)', () => {
    const kit = createKit();
    expect(() => createScreen(kit, STYLES[0]!, { textures: styled(kit, READY_UI_STYLE_1, ['playButton']) }))
      .toThrow("LevelMapScreen style 'style-1': no playButton (button/style1_play.webp) in textures — load them with loadReadyUiAssets({ skin })");
  });

  it('the nav files load only with their style; the donor pack requests none', async () => {
    const requested: string[] = [];
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (input: unknown) => {
      for (const entry of (Array.isArray(input) ? input : [input]) as Array<{ src: string }>) requested.push(entry.src);
      return labelled('loaded');
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => labelled('got')) as never);
    try {
      await loadReadyUiAssets({ baseUrl: './ui/' });
      expect(requested.some((src) => src.includes('/nav/') || src.includes('style1_play') || src.includes('nav_lock'))).toBe(false);
      requested.length = 0;
      await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_1 });
      expect(requested).toEqual(expect.arrayContaining(['./ui/button/style1_play.webp', './ui/nav/style1_panel.webp', './ui/nav/style1_selected.webp', './ui/nav/style1_icon_lock.webp']));
      expect(requested.some((src) => src.includes('style2/'))).toBe(false);
      requested.length = 0;
      await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_2 });
      expect(requested).toContain('./ui/style2/nav_lock.webp');
      expect(requested.some((src) => src.includes('/nav/'))).toBe(false);
    } finally {
      load.mockRestore();
      get.mockRestore();
    }
  });

  it('LevelMapView alone keeps the direct node launch: a node tap only reports, nothing scrolls', () => {
    const kit = createKit();
    for (const style of STYLES) {
      const launched: string[] = [];
      const map = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, style.skin), theme: style.theme, id: `map-${style.skin.id}`, levels: 60, currentLevel: 38, onSelectLevel: (level, state) => launched.push(`${level}:${state}`), width: 390, height: 844 });
      tap(map.getNodeContainer(36)!, kit);
      advance(kit.core, 1000);
      expect(launched).toEqual(['36:completed']);
      expect(map.focusLevel).toBe(38);
      map.destroy();
    }
    // no style: the donor map, the same direct launch
    const launched: number[] = [];
    const donor = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'map-donor', levels: 10, currentLevel: 5, onSelectLevel: (level) => launched.push(level) });
    tap(donor.getNodeContainer(3)!, kit);
    expect(launched).toEqual([3]);
    expect(donor.focusLevel).toBe(5);
    donor.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('no style still has no LevelMapScreen (Core has no donor nav / PLAY art): it fails clearly', () => {
    const kit = createKit();
    expect(() => new LevelMapScreen({ ui: kit.ui, motion: kit.motion, textures: kit.textures, map: { levels: 3, currentLevel: 1 }, onPlay: () => {} }))
      .toThrow("LevelMapScreen needs a Ready UI style that covers 'levelMapScreen' (theme.skin)");
  });
});
