import { describe, expect, it, vi } from 'vitest';
import { Assets, Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer, type TestKit } from './setup';
import * as pixiEntry from '../../src/pixi/index';
import { LocalizationRuntime } from '../../src/localization';
import { BottomNavView, type BottomNavItem, type BottomNavViewOptions } from '../../src/pixi/BottomNavView';
import { HudView } from '../../src/pixi/HudView';
import { LevelMapScreen, type LevelMapScreenOptions } from '../../src/pixi/LevelMapScreen';
import { LevelMapView } from '../../src/pixi/LevelMapView';
import { SettingsWindowView, type SettingsWindowParams, type SettingsWindowViewOptions } from '../../src/pixi/SettingsWindowView';
import { ConfirmWindowView, type ConfirmWindowViewOptions } from '../../src/pixi/ConfirmWindowView';
import { LivesWindowView, type LivesWindowParams, type LivesWindowViewOptions } from '../../src/pixi/LivesWindowView';
import { formatAmount } from '../../src/pixi/text';
import type { UiButton } from '../../src/pixi/UiButton';
import { loadReadyUiAssets, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { READY_UI_SKINS, READY_UI_SKIN_VIEW_ROLES, READY_UI_SKIN_WINDOW_ROLES, requiredSkinRoles, skinAssetKey, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinRole, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { ReadyUiThemeOverrides } from '../../src/pixi/theme';

const rootDir = resolve(__dirname, '../..');
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });
const STYLE_2_THEME: ReadyUiThemeOverrides = {
  skin: READY_UI_STYLE_2,
  levelMap: { badgeSize: 288, nodeScale: 1, levelGap: 402, focusBoost: 4 / 3, focusRatio: 1260 / 2344, contentScale: 1 }
};

/** One labelled texture per role of `skin` (as `loadReadyUiAssets({ skin })` files them), on top of the white required pack. */
function styled(kit: TestKit, skin: ReadyUiSkin = READY_UI_STYLE_2, drop: readonly ReadyUiSkinAssetKey[] = []): ReadyUiTextures {
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

const labels = (root: Container): string[] => descendants(root, Sprite).filter((sprite) => sprite.visible).map((sprite) => sprite.texture.source.label);
const texts = (root: Container): string[] => descendants(root, Text).filter((text) => text.visible).map((text) => text.text);

function spriteByLabel(root: Container, label: string): Sprite {
  const sprite = descendants(root, Sprite).find((entry) => entry.texture.source.label === label);
  if (!sprite) throw new Error(`no sprite ${label}`);
  return sprite;
}

function field<T>(view: object, name: string): T {
  return (view as Record<string, unknown>)[name] as T;
}

/** A settled tap on a pointer-driven container. */
function tap(target: Container, kit: TestKit): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 200);
}

const NAV_ITEMS: BottomNavItem[] = [
  { id: 'shop', icon: 'iconShop', label: 'SHOP' },
  { id: 'home', icon: 'iconHome', label: 'HOME' },
  { id: 'events', label: 'EVENTS', locked: true }
];

function createNav(kit: TestKit, overrides: Partial<BottomNavViewOptions> = {}) {
  const selected: string[] = [];
  const locked: string[] = [];
  const nav = new BottomNavView({
    ui: kit.ui,
    textures: styled(kit),
    theme: STYLE_2_THEME,
    items: NAV_ITEMS,
    selectedId: 'shop',
    onSelect: (id) => selected.push(id),
    onLockedTap: (id) => locked.push(id),
    width: 1422,
    height: 800,
    ...overrides
  });
  return { nav, selected, locked };
}

function createScreen(kit: TestKit, overrides: Partial<LevelMapScreenOptions> = {}) {
  const played: number[] = [];
  const nav: string[] = [];
  const screen = new LevelMapScreen({
    ui: kit.ui,
    motion: kit.motion,
    textures: styled(kit),
    theme: STYLE_2_THEME,
    map: { levels: 60, currentLevel: 38, onSelectLevel: () => {} },
    hud: { coins: 120, lives: 3, maxLives: 5, stars: 45 },
    nav: { items: NAV_ITEMS, selectedId: 'shop', onSelect: (id) => nav.push(id) },
    onPlay: (level) => played.push(level),
    width: 1422,
    height: 800,
    ...overrides
  });
  return { screen, played, nav };
}

describe('Style 2 — the theme_light_3 LevelMap screen package', () => {
  it('is a selectable data package next to Style 1: exported, in the catalog, valid, its files and its font shipped', () => {
    expect(pixiEntry.READY_UI_STYLE_2).toBe(READY_UI_STYLE_2);
    expect(READY_UI_SKINS).toEqual({ 'style-1': READY_UI_STYLE_1, 'style-2': READY_UI_STYLE_2 });
    expect(READY_UI_STYLE_2.id).toBe('style-2');
    expect(READY_UI_STYLE_2.covers).toEqual(['hud', 'levelMap', 'bottomNav', 'levelMapScreen', 'settings', 'confirm', 'lives', 'result', 'moves', 'settingsButton', 'noAds']);
    expect(() => validateReadyUiSkin(READY_UI_STYLE_2)).not.toThrow();
    const assetsDir = resolve(rootDir, 'assets/pixi-ui');
    for (const [role, asset] of Object.entries(READY_UI_STYLE_2.assets)) expect(existsSync(resolve(assetsDir, asset.file)), `${role} -> ${asset.file}`).toBe(true);
    expect(existsSync(resolve(assetsDir, READY_UI_STYLE_2.font.file))).toBe(true);
    expect(readFileSync(resolve(assetsDir, 'fonts/Carlito-OFL.txt'), 'utf8')).toMatch(/Reserved Font Name "Carlito"[\s\S]*SIL OPEN FONT LICENSE Version 1.1/);
    // every Style 2 file lives under its own folder, or is one of Style 1's own entries shared as is (the Confirm
    // window): nothing of Style 1 or the donor pack is replaced
    const style1Entries = Object.values(READY_UI_STYLE_1.assets);
    for (const asset of Object.values(READY_UI_STYLE_2.assets)) expect(asset.file.startsWith('style2/') || style1Entries.includes(asset as never), asset.file).toBe(true);
  });

  it('roles a style must ship follow its layout: Style 1 unchanged, Style 2 without gear / HARD / glow art', () => {
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'hud')).toEqual(['hudCapsule', 'hudHeart', 'hudCoin', 'hudPlus', 'hudGear', 'hudGearBack', 'hudStar']);
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'levelMap')).toEqual(['levelNodeNormal', 'levelNodeHard', 'levelLock', 'levelHardBadge', 'levelRail', 'levelCurrentGlow', 'levelStarGold', 'levelStarGoldL', 'levelStarGoldR']);
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'hud')).toEqual(['hudCapsule', 'hudHeart', 'hudCoin', 'hudPlus', 'hudStar']);
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'levelMap')).toEqual(['levelNodeNormal', 'levelLock', 'levelRail', 'levelStarGold', 'levelStarGoldL', 'levelStarGoldR', 'levelNodeLocked', 'levelMapBackground']);
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'bottomNav')).toEqual(['navPanel', 'navSelected', 'navLock']);
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'levelMapScreen')).toEqual(['playButton', 'iconShop', 'iconHome']);
    // a role the layout draws is still strict: dropping the locked-node art breaks the package
    const broken = { ...READY_UI_STYLE_2, assets: { ...READY_UI_STYLE_2.assets, levelNodeLocked: undefined } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(broken)).toThrow("ReadyUiSkin 'style-2' covers 'levelMap' but has no asset for role 'levelNodeLocked'");
    const noCaps = { ...READY_UI_STYLE_2, assets: { ...READY_UI_STYLE_2.assets, navSelected: { file: 'style2/nav_selected.webp' } } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(noCaps)).toThrow("ReadyUiSkin 'style-2': role 'navSelected' is drawn as a 9-slice but has no nineSlice caps");
    expect(Object.keys(READY_UI_SKIN_VIEW_ROLES)).toEqual(['confirm', 'lives', 'settings', 'result', 'noAds', 'hud', 'levelMap', 'bottomNav', 'levelMapScreen', 'moves', 'settingsButton']);
  });

  it('loads only when chosen, strictly, with its font; the donor path requests no Style 2 file', async () => {
    const requested: string[] = [];
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (input: unknown) => {
      const entries = Array.isArray(input) ? input : [input];
      for (const entry of entries as Array<{ src: string }>) requested.push(entry.src);
      return labelled('loaded');
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => labelled('got')) as never);
    try {
      const donor = await loadReadyUiAssets({ baseUrl: './ui/' });
      expect(donor.skins).toBeUndefined();
      expect(requested.some((src) => src.includes('style2/') || src.includes('Carlito'))).toBe(false);

      requested.length = 0;
      const style1 = await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_1 });
      expect(Object.keys(style1.skins ?? {})).toEqual(['style-1']);
      expect(requested.some((src) => src.includes('style2/') || src.includes('Carlito'))).toBe(false);

      requested.length = 0;
      const style2 = await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_2 });
      expect(Object.keys(style2.skins ?? {})).toEqual(['style-2']);
      expect(Object.keys(style2.skins!['style-2']!).sort()).toEqual(Object.keys(READY_UI_STYLE_2.assets).sort());
      expect(requested).toEqual(expect.arrayContaining(['./ui/fonts/Carlito-Bold.woff', './ui/style2/level_node_open.webp', './ui/style2/bg_sky.webp', './ui/style2/nav_selected.webp']));
      expect(load).toHaveBeenCalledWith({ alias: 'game-core-ui:skin:style-2:font', src: './ui/fonts/Carlito-Bold.woff', data: { family: 'Carlito' } });

      load.mockImplementation((async (input: unknown) => {
        const entry = input as { src?: string };
        if (!Array.isArray(input) && entry.src?.endsWith('Carlito-Bold.woff')) throw new Error('404');
        return labelled('loaded');
      }) as never);
      await expect(loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_2 })).rejects.toThrow(
        `loadReadyUiAssets: style 'style-2' font "Carlito" (fonts/Carlito-Bold.woff) was requested but did not load from ./ui/: 404`
      );
    } finally {
      load.mockRestore();
      get.mockRestore();
    }
  });
});

describe('Style 2 — HudView', () => {
  it('draws the Style 2 roles with runtime values: no gear, no count in the heart, #3f598c Carlito counters, Figma bar pitch', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), theme: STYLE_2_THEME, coins: 1234, lives: 2, maxLives: 5, stars: 17, onLivesTap: () => {}, onCoinsTap: () => {}, width: 1422, height: 800 });
    hud.setLives(2, '12:34');
    expect(labels(hud)).toEqual(expect.arrayContaining(['style-2:hudCapsule', 'style-2:hudHeart', 'style-2:hudCoin', 'style-2:hudPlus', 'style-2:hudStar']));
    expect(labels(hud).some((label) => label.includes('Gear'))).toBe(false);
    expect(field(hud, 'gear')).toBeNull();
    // runtime values only; the heart shows no count (Figma), the capsule shows the timer
    expect(texts(hud)).toEqual(expect.arrayContaining(['12:34', '1\u2009234', '17']));
    expect(texts(hud)).not.toContain('2');
    const counter = descendants(hud, Text).find((text) => text.text === '1\u2009234')!;
    expect(counter.style.fill).toBe(0x3f598c);
    expect(counter.style.fontFamily).toBe('Carlito');
    expect(counter.style.stroke).toBeFalsy();
    const badges = field<Container>(hud, 'row').children;
    expect(badges.map((badge) => badge.x)).toEqual([0, 610, 1220]);
    // Figma size at the frame's height (no area rule): the row is unscaled at 1422 × 800
    expect(field<Container>(hud, 'row').scale.x).toBeCloseTo(800 / 2344, 6);
    // full lives: MAX, no plus
    hud.setLives(5);
    expect(texts(hud)).toContain('MAX');
    hud.destroy();
  });

  it('a Style 2 HUD with a gear asked for fails clearly; Style 1 and the donor keep their gear', () => {
    const kit = createKit();
    expect(() => new HudView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), theme: STYLE_2_THEME, settings: true }))
      .toThrow("HudView: style 'style-2' has no settings gear art — pass settings: false");
    const style1 = new HudView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 'h1' });
    expect(field(style1, 'gear')).not.toBeNull();
    const donor = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'h0' });
    expect(field(donor, 'gear')).not.toBeNull();
    style1.destroy();
    donor.destroy();
  });

  it('a missing Style 2 HUD texture fails clearly', () => {
    const kit = createKit();
    expect(() => new HudView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_2, ['hudCapsule']), theme: STYLE_2_THEME }))
      .toThrow("HudView style 'style-2': no hudCapsule (style2/hud_capsule.webp) in textures — load them with loadReadyUiAssets({ skin })");
  });
});

describe('Style 2 — LevelMapView', () => {
  function createMap(kit: TestKit) {
    const levels = [
      { index: 1, stars: 3 },
      { index: 2, stars: 1, hard: true },
      { index: 3 },
      { index: 4, hard: true },
      { index: 5 }
    ];
    return new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), theme: STYLE_2_THEME, levels, currentLevel: 3, buildWindow: 8, onSelectLevel: () => {}, width: 1422, height: 800 });
  }
  const node = (map: LevelMapView, level: number): Container => map.getNodeContainer(level)!;

  it('open nodes are orange, locked ones blue with the lock and their own number box; stars are runtime', () => {
    const kit = createKit();
    const map = createMap(kit);
    expect(map.getNodeState(1)).toBe('completed');
    expect(map.getNodeState(3)).toBe('current');
    expect(map.getNodeState(5)).toBe('locked');
    // completed: orange + the earned stars (L, C, R) at the Figma crown
    expect(labels(node(map, 1))).toEqual(['style-2:levelNodeNormal', 'style-2:levelStarGoldL', 'style-2:levelStarGold', 'style-2:levelStarGoldR']);
    const [l, c, r] = READY_UI_STYLE_2.levelMap.stars;
    expect([spriteByLabel(node(map, 1), 'style-2:levelStarGoldL').position.x, spriteByLabel(node(map, 1), 'style-2:levelStarGoldL').position.y]).toEqual([l.x, l.y]);
    expect(spriteByLabel(node(map, 1), 'style-2:levelStarGold').width).toBeCloseTo(c.size, 6);
    expect(spriteByLabel(node(map, 1), 'style-2:levelStarGoldR').position.x).toBe(r.x);
    // the current level: orange, no stars (it is not completed yet)
    expect(labels(node(map, 3))).toEqual(['style-2:levelNodeNormal']);
    const art = spriteByLabel(node(map, 3), 'style-2:levelNodeNormal');
    expect([art.width, art.height]).toEqual([288, 288]);
    // locked: blue + lock, the locked number box
    expect(labels(node(map, 5))).toEqual(['style-2:levelNodeLocked', 'style-2:levelLock']);
    const lock = spriteByLabel(node(map, 5), 'style-2:levelLock');
    expect([lock.x, lock.y, lock.width, lock.height]).toEqual([0, 100, 86.4, 86.4]);
    const lockedNumber = descendants(node(map, 5), Text)[0]!;
    expect([lockedNumber.text, lockedNumber.style.fontSize, lockedNumber.y]).toEqual(['5', 75, 31]);
    const openNumber = descendants(node(map, 3), Text)[0]!;
    expect([openNumber.text, openNumber.style.fontSize, openNumber.y]).toEqual(['3', 105, 60.375]);
    expect(openNumber.style.fontFamily).toBe('Carlito');
    expect(openNumber.style.stroke).toBeFalsy();
    expect(openNumber.style.dropShadow).toBeFalsy();
    // two-digit numbers keep the Figma size (no donor shrink), only the width fit
    map.destroy();
  });

  it('no HARD art in Style 2: a hard level draws like a normal one; the background is the sky, no glow, the Figma rail', () => {
    const kit = createKit();
    const map = createMap(kit);
    expect(labels(node(map, 2))).toEqual(['style-2:levelNodeNormal', 'style-2:levelStarGoldL']);
    expect(labels(node(map, 4))).toEqual(['style-2:levelNodeLocked', 'style-2:levelLock']);
    expect(texts(map)).not.toContain('HARD');
    expect(field(map, 'shine')).toBeNull();
    const background = field<Sprite>(map, 'background');
    expect(background.texture.source.label).toBe('style-2:levelMapBackground');
    expect(labels(map)).toContain('style-2:levelRail');
    expect(spriteByLabel(map, 'style-2:levelRail').width).toBe(80);
    expect(labels(map).some((label) => label.includes('Glow') || label.includes('Hard'))).toBe(false);
    map.destroy();
  });

  it('behaviour is the shared code: focus, snap and the level ordering follow theme.levelMap, taps settle through the controller', () => {
    const kit = createKit();
    const selected: string[] = [];
    const map = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), theme: STYLE_2_THEME, levels: 60, currentLevel: 38, onSelectLevel: (level, state) => selected.push(`${level}:${state}`), width: 1422, height: 800 });
    expect(map.focusLevel).toBe(38);
    expect(map.levelY(39) - map.levelY(38)).toBe(-402);
    expect(map.levelScreenY(38)).toBeCloseTo(800 * (1260 / 2344), 6);
    map.scrollToLevel(36, false);
    expect(map.focusLevel).toBe(36);
    expect(map.selectedLevel).toBe(36);
    map.scrollToLevel(45, false);
    expect(map.selectedLevel).toBe(38);
    map.scrollToLevel(38, false);
    tap(node(map, 37), kit);
    expect(selected).toEqual(['37:completed']);
    map.destroy();
  });
});

describe('BottomNavView — generic items, host routing', () => {
  it('needs a style that covers it (no donor art) and well-formed items', () => {
    const kit = createKit();
    expect(() => new BottomNavView({ ui: kit.ui, textures: kit.textures, items: NAV_ITEMS, onSelect: () => {} }))
      .toThrow("BottomNavView needs a Ready UI style that covers 'bottomNav' (theme.skin): Core has no donor bottom navigation art");
    expect(() => createNav(kit, { items: [] })).toThrow('BottomNavView: no items');
    expect(() => createNav(kit, { items: [{ id: 'a' }, { id: 'a' }] })).toThrow("BottomNavView: duplicate item id 'a'");
    expect(() => createNav(kit, { selectedId: 'nope' })).toThrow("BottomNavView: no item 'nope' to select");
    expect(() => createNav(kit, { items: [{ id: 'x', icon: 'iconHome' }], selectedId: null, textures: styled(kit, READY_UI_STYLE_2, ['iconHome']) }))
      .toThrow("BottomNavView: item 'x' names icon role 'iconHome', which style 'style-2' did not load");
  });

  it('selected state: the raised background, the theme_light_5 icon / label boxes; normal and locked states', () => {
    const kit = createKit();
    const { nav } = createNav(kit);
    const shop = nav.getItemContainer('shop')!;
    const home = nav.getItemContainer('home')!;
    const events = nav.getItemContainer('events')!;
    const background = (item: Container) => descendants(item, NineSliceSprite)[0]!;
    expect(background(shop).visible).toBe(true);
    expect(background(home).visible).toBe(false);
    expect([background(shop).x, background(shop).y, background(shop).width]).toEqual([-182.169, -28, 365]);
    // the selected background reaches the viewport bottom: from -28 to the panel's bottom (286, no inset)
    expect(background(shop).height).toBeCloseTo(286 + 28, 6);
    expect(spriteByLabel(shop, 'style-2:iconShop').width).toBeCloseTo(288, 6);
    expect(spriteByLabel(shop, 'style-2:iconShop').y).toBe(43);
    expect(spriteByLabel(home, 'style-2:iconHome').width).toBeCloseTo(267.034, 6);
    expect(spriteByLabel(home, 'style-2:iconHome').y).toBe(93.517);
    const shopLabel = descendants(shop, Text)[0]!;
    const homeLabel = descendants(home, Text)[0]!;
    expect([shopLabel.text, shopLabel.style.fontSize, shopLabel.style.fill, shopLabel.style.fontFamily]).toEqual(['SHOP', 60, 0xffffff, 'Carlito']);
    expect([homeLabel.text, homeLabel.style.fontSize]).toEqual(['HOME', 40]);
    // locked: the style's lock instead of the icon, with the item's caption (theme_light_5 captions its LOCK slot)
    expect(labels(events)).toEqual(['style-2:navLock']);
    expect(texts(events)).toEqual(['EVENTS']);
    expect(spriteByLabel(events, 'style-2:navLock').width).toBeCloseTo(267.034, 6);
    expect(spriteByLabel(events, 'style-2:navLock').y).toBe(97.517);
    // slots: pitch 664 around the centre
    expect([shop.x, home.x, events.x]).toEqual([-664, 0, 664]);
    // the host moves the selection
    nav.setSelected('home');
    expect(nav.selectedId).toBe('home');
    expect(background(shop).visible).toBe(false);
    expect(background(home).visible).toBe(true);
    expect(spriteByLabel(home, 'style-2:iconHome').width).toBeCloseTo(288, 6);
    expect(descendants(home, Text)[0]!.style.fontSize).toBe(60);
    nav.setLocked('events', false);
    expect(labels(events)).toEqual([]);
    expect(texts(events)).toEqual(['EVENTS']);
    nav.destroy();
  });

  it('callback semantics: a tap reports the id and never selects by itself; a locked item only reports onLockedTap; a cancelled press reports nothing', () => {
    const kit = createKit();
    const { nav, selected, locked } = createNav(kit);
    tap(nav.getItemContainer('home')!, kit);
    expect(selected).toEqual(['home']);
    expect(nav.selectedId).toBe('shop');
    tap(nav.getItemContainer('shop')!, kit);
    expect(selected).toEqual(['home', 'shop']);
    tap(nav.getItemContainer('events')!, kit);
    expect(selected).toEqual(['home', 'shop']);
    expect(locked).toEqual(['events']);
    const home = nav.getItemContainer('home')!;
    home.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 40);
    kit.core.cancelAll();
    home.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 200);
    expect(selected).toEqual(['home', 'shop']);
    nav.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('labels: explicit text wins, then the provider through labelKey, else no label', () => {
    const kit = createKit();
    const i18n = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: { en: { ...READY_UI_CATALOGS.en, 'game.nav.home': 'HOME' }, ru: { ...READY_UI_CATALOGS.ru, 'game.nav.home': 'ДОМ' } } });
    const nav = new BottomNavView({
      ui: kit.ui, textures: styled(kit), theme: STYLE_2_THEME, i18n,
      items: [{ id: 'a', icon: 'iconShop', label: 'МАГАЗИН', labelKey: 'game.nav.home' }, { id: 'b', icon: 'iconHome', labelKey: 'game.nav.home' }, { id: 'c', icon: 'iconHome' }],
      onSelect: () => {}
    });
    expect(texts(nav.getItemContainer('a')!)).toEqual(['МАГАЗИН']);
    expect(texts(nav.getItemContainer('b')!)).toEqual(['ДОМ']);
    expect(texts(nav.getItemContainer('c')!)).toEqual([]);
    nav.destroy();
  });

  it('responsive: the panel top sits 286 units above the bottom inset and reaches through it; slots shrink to fit', () => {
    const kit = createKit();
    const { nav } = createNav(kit);
    nav.resize(390, 844, { insets: { bottom: 34 } });
    const s = Math.min(390 / 1080, 844 / 2344);
    expect(nav.top).toBeCloseTo(844 - 34 - 286 * s, 6);
    expect(nav.barHeight).toBeCloseTo(34 + 286 * s, 6);
    const panel = field<NineSliceSprite>(nav, 'panel');
    expect(panel.height).toBeCloseTo(10 + 286 + 34 / s, 6);
    expect(panel.width).toBeCloseTo(390 / s, 6);
    const pitch = 390 / s / 3;
    expect(nav.getItemContainer('home')!.x).toBeCloseTo(0, 6);
    expect(nav.getItemContainer('events')!.x).toBeCloseTo(pitch, 6);
    expect(nav.getItemContainer('shop')!.scale.x).toBeCloseTo(Math.min(1, pitch / 365), 6);
    nav.destroy();
  });
});

describe('LevelMapScreen — the minimal composition', () => {
  it('needs a style that covers it; composes map (with the sky), PLAY, navigation, HUD bottom to top', () => {
    const kit = createKit();
    expect(() => new LevelMapScreen({ ui: kit.ui, motion: kit.motion, textures: kit.textures, map: { levels: 3, currentLevel: 1, onSelectLevel: () => {} }, nav: { items: NAV_ITEMS, onSelect: () => {} }, onPlay: () => {} }))
      .toThrow("LevelMapScreen needs a Ready UI style that covers 'levelMapScreen' (theme.skin)");
    const { screen } = createScreen(kit);
    expect(screen.children).toEqual([screen.map, screen.play, screen.nav, screen.hud]);
    expect(screen.play.background.texture.source.label).toBe('style-2:playButton');
    expect([screen.play.background.width, screen.play.background.height]).toEqual([550, 280]);
    screen.destroy();
  });

  it('PLAY shows the runtime level, follows the focus and launches the playable level; captions are localized', () => {
    const kit = createKit();
    const { screen, played } = createScreen(kit);
    expect(texts(screen.play)).toEqual(['PLAY', 'Level 38']);
    screen.map.scrollToLevel(35, false);
    expect(texts(screen.play)).toEqual(['PLAY', 'Level 35']);
    tap(screen.play, kit);
    expect(played).toEqual([35]);
    // a locked focus still launches the playable level
    screen.map.scrollToLevel(50, false);
    expect(texts(screen.play)).toEqual(['PLAY', 'Level 38']);
    tap(screen.play, kit);
    expect(played).toEqual([35, 38]);
    screen.destroy();

    const ru = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const { screen: localized } = createScreen(createKit(), { i18n: ru });
    expect(texts(localized.play)).toEqual(['ИГРАТЬ', 'Уровень 38']);
    localized.destroy();
    const { screen: explicit } = createScreen(createKit(), { playLabel: 'GO', levelLabel: 'Stage {level}' });
    expect(texts(explicit.play)).toEqual(['GO', 'Stage 38']);
    explicit.destroy();
  });

  it('layout: the Figma frame at 1422 × 800 — HUD at 60, the nav at the bottom, PLAY 296 units above it, the map down to PLAY', () => {
    const kit = createKit();
    const { screen } = createScreen(kit);
    const s = 800 / 2344;
    expect(screen.nav.top).toBeCloseTo(800 - 286 * s, 6);
    expect(screen.play.x).toBeCloseTo(711, 6);
    expect(screen.play.y).toBeCloseTo(1762 * s, 6);
    expect(screen.play.scale.x).toBeCloseTo(s, 6);
    expect(screen.map.levelScreenY(38)).toBeCloseTo(1260 * s, 6);
    expect(screen.map.levelScreenY(40) - screen.map.levelScreenY(38)).toBeCloseTo(-804 * s, 6);
    const playTop = 1762 * s - 140 * s;
    expect(field<number>(screen.map, 'mapBottom')).toBeCloseTo(playTop, 6);
    expect(field<Container>(screen.hud, 'row').x).toBeGreaterThan(0);
    // phone portrait: the parts keep their order, PLAY above the nav, inside the width
    screen.resize(320, 568, { insets: { top: 20, bottom: 20 } });
    expect(screen.play.y + 140 * screen.play.scale.y).toBeLessThanOrEqual(screen.nav.top - 100 * Math.min(320 / 1080, 568 / 2344));
    expect(screen.play.x).toBeCloseTo(160, 6);
    expect(screen.hud.barHeight).toBeLessThan(screen.play.y);
    screen.destroy();
    expect(kit.uiErrors).toEqual([]);
    expect(kit.motionErrors).toEqual([]);
  });
});

describe('Style 2 — Settings (8:17493) through the existing SettingsWindowView', () => {
  const STYLE_2_SETTINGS_ROLES = ['settingsPanel', 'settingsClose', 'settingsSound', 'settingsMusic', 'settingsOff', 'settingsBtnHome', 'settingsBtnRestart', 'settingsIconRestart', 'settingsSoundOff', 'settingsMusicOff', 'settingsIconHome', 'settingsBtnLanguage', 'settingsIconLanguage'];
  type Toggle = { button: UiButton; off: Sprite; label: Text };

  function settingsView(kit: TestKit, extra: Partial<SettingsWindowViewOptions> = {}, log: string[] = [], textures = styled(kit)): SettingsWindowView {
    return new SettingsWindowView({
      ui: kit.ui, motion: kit.motion, textures, theme: { skin: READY_UI_STYLE_2 }, id: 'settings',
      onToggle: (setting, enabled) => log.push(`${setting}:${enabled}`), onHome: () => log.push('home'), onRestart: () => log.push('restart'),
      onDismiss: (reason) => log.push(`dismiss:${reason}`), width: 390, height: 844, ...extra
    });
  }
  function show(kit: TestKit, view: SettingsWindowView, params: Partial<SettingsWindowParams> = {}): SettingsWindowView {
    view.show({ sound: true, music: true, version: 'VERSION 1.2.3', gameButtons: true, ...params });
    advance(kit.core, 400);
    return view;
  }
  const placedTop = (text: Text): number => text.y;
  const toggles = (view: SettingsWindowView) => field<{ sound: Toggle; music: Toggle; haptic: Toggle | null }>(view, 'toggles');

  it('is part of the Style 2 package: covered, its roles follow the layout (no haptic art), strict files under style2/, Style 1 roles unchanged', () => {
    expect(READY_UI_STYLE_2.covers).toContain('settings');
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'settings')).toEqual(STYLE_2_SETTINGS_ROLES);
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'settings')).toEqual(['settingsPanel', 'settingsClose', 'settingsSound', 'settingsMusic', 'settingsHaptic', 'settingsOff', 'settingsBtnHome', 'settingsBtnRestart', 'settingsIconRestart', 'settingsBtnLanguage']);
    expect(READY_UI_STYLE_2.assets).not.toHaveProperty('settingsHaptic');
    expect(READY_UI_STYLE_2.windows.settings.map.haptic).toBeNull();
    expect(READY_UI_STYLE_2.windows.settings.gameplay.haptic).toBeNull();
    for (const role of STYLE_2_SETTINGS_ROLES) expect((READY_UI_STYLE_2.assets as ReadyUiSkin['assets'])[role as ReadyUiSkinRole]?.file).toMatch(/^style2\/settings_/);
    // the one window frame: 1080 × 2344 (8:17493); only windows read it
    expect(READY_UI_STYLE_2.frame).toEqual({ width: 1080, height: 2344 });
    expect(READY_UI_STYLE_2.backdrop).toEqual({ color: 0x080b0d, alpha: 0.8 });
    const noOffArt = { ...READY_UI_STYLE_2, assets: { ...READY_UI_STYLE_2.assets, settingsMusicOff: undefined } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(noOffArt)).toThrow("ReadyUiSkin 'style-2' covers 'settings' but has no asset for role 'settingsMusicOff'");
  });

  it('is chosen only by the theme: Style 2 draws its roles; no skin stays donor, Style 1 stays Style 1', () => {
    const kit = createKit();
    const view = show(kit, settingsView(kit));
    expect(view.skin).toBe(READY_UI_STYLE_2);
    expect(field<NineSliceSprite>(view, 'surface').texture.source.label).toBe('style-2:settingsPanel');
    expect(field<UiButton>(view, 'closeButton').background.texture.source.label).toBe('style-2:settingsClose');
    expect(labels(view)).toEqual(expect.arrayContaining(['style-2:settingsSound', 'style-2:settingsMusic', 'style-2:settingsBtnRestart', 'style-2:settingsBtnHome', 'style-2:settingsIconRestart', 'style-2:settingsIconHome']));
    view.destroy();
    const donor = show(kit, new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), id: 'donor', onToggle: () => {} }));
    expect(donor.skin).toBeNull();
    expect(labels(donor).some((label) => label.startsWith('style-2:'))).toBe(false);
    donor.destroy();
    const style1 = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 'style1', onToggle: () => {} });
    expect(style1.skin).toBe(READY_UI_STYLE_1);
    style1.destroy();
  });

  it('Sound / Music ON = the blue art, OFF = the muted art under the red slash; the slash shows only while disabled; state stays the host\'s', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = show(kit, settingsView(kit, {}, log), { sound: true, music: false });
    const { sound, music } = toggles(view);
    expect(sound.button.background.texture.source.label).toBe('style-2:settingsSound');
    expect(sound.off.visible).toBe(false);
    expect(music.button.background.texture.source.label).toBe('style-2:settingsMusicOff');
    expect(music.off.visible).toBe(true);
    expect(music.off.texture.source.label).toBe('style-2:settingsOff');
    tap(sound.button, kit);
    expect(log).toEqual(['sound:false']);
    expect(sound.button.background.texture.source.label).toBe('style-2:settingsSoundOff');
    expect(sound.off.visible).toBe(true);
    // the art keeps the layout size whatever the texture
    expect([sound.button.background.width, sound.button.background.height]).toEqual([228, 228]);
    view.setSettings({ music: true });
    expect(music.button.background.texture.source.label).toBe('style-2:settingsMusic');
    expect(music.off.visible).toBe(false);
    expect(view.currentSettings).toMatchObject({ sound: false, music: true });
    view.destroy();
  });

  it('has no Haptic in the approved layout, while the generic API keeps it: asking Style 2 for it fails clearly, donor and Style 1 still draw it', () => {
    const kit = createKit();
    const view = show(kit, settingsView(kit), { gameButtons: false });
    expect(toggles(view).haptic).toBeNull();
    expect(texts(view)).not.toContain('HAPTIC');
    view.destroy();
    expect(() => settingsView(kit, { haptic: true })).toThrow("SettingsWindowView: style 'style-2' has no haptic toggle (windows.settings.map.haptic is null) — omit the haptic option");
    expect(kit.ui.getStats()).toMatchObject({ windows: 0 });
    const donor = show(kit, new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'donor', haptic: true, onToggle: () => {} }), { gameButtons: false });
    expect(toggles(donor).haptic?.button.visible).toBe(true);
    donor.destroy();
    const style1 = show(kit, new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 'style1', haptic: true, onToggle: () => {} }), { gameButtons: false });
    expect(toggles(style1).haptic?.button.visible).toBe(true);
    style1.destroy();
  });

  it('close, Restart level and Return home keep their callbacks (close continuations)', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = show(kit, settingsView(kit, {}, log));
    tap(field<UiButton>(view, 'restartButton'), kit);
    advance(kit.core, 200);
    show(kit, view);
    tap(field<UiButton>(view, 'homeButton'), kit);
    advance(kit.core, 200);
    show(kit, view);
    tap(field<UiButton>(view, 'closeButton') as unknown as Container, kit);
    advance(kit.core, 200);
    expect(log).toEqual(['restart', 'home', 'dismiss:button']);
    view.destroy();
  });

  it('lays out 22:28904 without its Language row: the popup closes up to 1056 with its header bleed, Figma boxes, the hugging icon + label rows; the map variant drops the action rows', () => {
    const kit = createKit();
    const view = show(kit, settingsView(kit, { restartLabel: 'Restart level', homeLabel: 'Return home' }));
    const surface = field<NineSliceSprite>(view, 'surface');
    // no languages: the 1290 popup without its Language row (1056) centred on the panel origin, the header 49 above it
    expect([surface.width, surface.height]).toEqual([1000, 1105]);
    expect(surface.anchor.y * surface.height).toBeCloseTo(49 + 528, 6);
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 887 + 76.5 - 500, y: -37 + 79 - 528 });
    const { sound, music } = toggles(view);
    expect(sound.button.position).toMatchObject({ x: 237 + 114 - 500, y: 220 + 114 - 528 });
    expect(music.button.position).toMatchObject({ x: 534 + 114 - 500, y: 220 + 114 - 528 });
    const restart = field<UiButton>(view, 'restartButton');
    expect(restart.position).toMatchObject({ x: 0, y: 482 + 100 - 528 });
    expect(field<UiButton>(view, 'homeButton').position).toMatchObject({ x: 0, y: 716 + 100 - 528 });
    expect(field<{ button: UiButton }>(view, 'languageRow').button.visible).toBe(false);
    // text: Carlito, no stroke; labels and version #3f598c, title / actions white
    const title = field<Text>(view, 'title');
    expect(title.style.fontFamily).toBe('Carlito');
    expect(title.style.stroke).toBeFalsy();
    expect(title.style.fill).toBe(0xffffff);
    expect(sound.label.style.fill).toBe(0x3f598c);
    expect(field<Text>(view, 'version').style.fill).toBe(0x3f598c);
    expect(field<Text>(view, 'restartLabel').style.fill).toBe(0xffffff);
    // hugging row: a shorter runtime text moves the icon and the label together, the row stays centred
    const restartIcon = field<Sprite>(view, 'restartIcon');
    const iconX = restartIcon.x;
    view.destroy();
    const short = show(kit, settingsView(kit, { restartLabel: 'GO' }));
    const shortIcon = field<Sprite>(short, 'restartIcon');
    const shortLabel = field<Text>(short, 'restartLabel');
    expect(shortIcon.x).toBeGreaterThan(iconX);
    const left = shortIcon.x - 79;
    const right = shortLabel.x + shortLabel.width;
    expect(left + right).toBeCloseTo(0, 0);
    // map without languages: no row, the version 29 under the toggles (Figma's version gap), a 588-unit window
    short.destroy();
    const map = show(kit, settingsView(kit), { gameButtons: false });
    const mapSurface = field<NineSliceSprite>(map, 'surface');
    expect([mapSurface.width, mapSurface.height]).toEqual([1000, 637]);
    expect(mapSurface.anchor.y * mapSurface.height).toBeCloseTo(49 + 294, 6);
    expect(field<UiButton>(map, 'restartButton').visible).toBe(false);
    expect(field<UiButton>(map, 'homeButton').visible).toBe(false);
    expect(placedTop(field<Text>(map, 'version'))).toBeGreaterThan(448 - 294);
    map.destroy();
  });

  it('copy: explicit text wins, then the localization provider (RU / EN), then the legacy default', () => {
    const kit = createKit();
    const i18n = (locale: string) => new LocalizationRuntime({ rawLocale: locale, supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const ru = show(kit, settingsView(kit, { i18n: i18n('ru') }));
    expect(texts(ru)).toEqual(expect.arrayContaining(['НАСТРОЙКИ', 'ЗВУК', 'МУЗЫКА', 'ЗАНОВО', 'ВЫХОД', 'VERSION 1.2.3']));
    ru.destroy();
    const en = show(kit, settingsView(kit, { i18n: i18n('en') }));
    expect(texts(en)).toEqual(expect.arrayContaining(['SETTINGS', 'SOUND', 'MUSIC', 'RESTART', 'EXIT']));
    en.destroy();
    const explicit = show(kit, settingsView(kit, { i18n: i18n('ru'), title: 'НАСТРОЙКИ', soundLabel: 'Sound', restartLabel: 'Restart level', homeLabel: 'Return home' }));
    expect(texts(explicit)).toEqual(expect.arrayContaining(['НАСТРОЙКИ', 'Sound', 'МУЗЫКА', 'Restart level', 'Return home']));
    explicit.destroy();
    const legacy = show(kit, settingsView(kit));
    expect(texts(legacy)).toEqual(expect.arrayContaining(['SETTINGS', 'SOUND', 'MUSIC', 'RESTART', 'EXIT']));
    legacy.destroy();
  });

  it('strict art: a missing Settings role fails clearly; its files load only with Style 2 (Carlito once, shared with the LevelMap views)', async () => {
    const kit = createKit();
    expect(() => settingsView(kit, {}, [], styled(kit, READY_UI_STYLE_2, ['settingsSoundOff'])))
      .toThrow("SettingsWindowView style 'style-2': no settingsSoundOff (style2/settings_sound_off.webp) in textures — load them with loadReadyUiAssets({ skin })");
    expect(kit.ui.getStats()).toMatchObject({ windows: 0 });
    const requested: string[] = [];
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (input: unknown) => {
      for (const entry of (Array.isArray(input) ? input : [input]) as Array<{ src: string }>) requested.push(entry.src);
      return labelled('loaded');
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => labelled('got')) as never);
    try {
      await loadReadyUiAssets({ baseUrl: './ui/' });
      await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_1 });
      expect(requested.filter((src) => src.includes('style2/settings_'))).toEqual([]);
      requested.length = 0;
      const textures = await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_2 });
      // 13 Settings files; the popup and the close are also the Lives window's (one file, two roles)
      expect(new Set(requested.filter((src) => src.includes('style2/settings_'))).size).toBe(13);
      expect(requested.filter((src) => src.includes('Carlito'))).toEqual(['./ui/fonts/Carlito-Bold.woff']);
      expect(Object.keys(textures.skins!['style-2']!)).toEqual(expect.arrayContaining(STYLE_2_SETTINGS_ROLES));
    } finally {
      load.mockRestore();
      get.mockRestore();
    }
  });
});

// Style 2 windows: frame units (1080 × 2344) → panel units; the Lives panel origin is the frame centre, the Confirm
// panel origin the window centre (the window box at 60, 675 sits centred in the frame, so both are (540, 1172)).
const FX = (x: number): number => x - 540;
const FY = (y: number): number => y - 1172;
const within = (actual: number, expected: number, what?: string): void => expect(actual, what).toBeCloseTo(expected, 6);
const i18nOf = (locale: string) => new LocalizationRuntime({ rawLocale: locale, supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });

describe('Style 2 — Confirm (theme_light_4 Restart 22:28984 / Exit 22:29021) through the existing ConfirmWindowView', () => {
  function confirmView(kit: TestKit, extra: Partial<ConfirmWindowViewOptions> = {}, log: string[] = [], textures = styled(kit)): ConfirmWindowView {
    return new ConfirmWindowView({
      ui: kit.ui, motion: kit.motion, textures, theme: { skin: READY_UI_STYLE_2 }, id: 'confirm',
      onConfirm: () => log.push('confirm'), onDismiss: (reason) => log.push(`dismiss:${reason}`), ...extra
    });
  }
  /** Every drawn layer as [texture, x, y, width, height] (+ the button positions): the layout signature of a window. */
  function geometry(view: ConfirmWindowView): unknown[] {
    const panel = field<Container>(view, 'panel');
    const strip = (label: string) => label.replace(/^style-\d:(confirm:)?/, '');
    const art = [...descendants(panel, NineSliceSprite), ...descendants(panel, Sprite)]
      .map((sprite) => [strip(sprite.texture.source.label), sprite.x, sprite.y, sprite.width, sprite.height]);
    const buttons = ['confirmButton', 'closeButton'].map((name) => { const b = field<UiButton>(view, name); return [name, b.x, b.y]; });
    return [...art, ...buttons];
  }

  it('is part of the Style 2 package: covered, theme_light_4 draws its own popup (the Lives / Settings files), Style 1 unchanged', () => {
    expect(READY_UI_STYLE_2.covers).toContain('confirm');
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'confirm')).toEqual(['windowSurface', 'windowClose', 'heroGlow', 'lifeLostArt', 'buttonPrimary', 'offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt', 'priceIcon']);
    // theme_light_4 22:28984 / 22:29021: the Style 2 popup, close and green button (no window-scoped Style 1 files any more);
    // the only window keys are No Ads' own (theme_light_6: its 200-high button caps, its 84 HUD-coin price)
    const A = READY_UI_STYLE_2.assets as ReadyUiSkin['assets'];
    expect(Object.keys(A).filter((key) => key.includes(':'))).toEqual(['noAds:buttonPrimary', 'noAds:priceIcon']);
    for (const role of ['windowSurface', 'windowClose', 'buttonPrimary', 'heroGlow', 'lifeLostArt'] as const) expect(skinAssetKey(READY_UI_STYLE_2, 'confirm', role)).toBe(role);
    expect(A.windowSurface).toBe(A.settingsPanel);
    expect(A.heroGlow?.file).toBe(A.panelInset?.file);
    expect(A.lifeLostArt?.file).toBe('style2/confirm_heart.webp');
    // Style 1 has no window keys; its Confirm needs the same roles as before plus its OFFER panel's (theme_light_4)
    expect(Object.keys(READY_UI_STYLE_1.assets).some((key) => key.includes(':'))).toBe(false);
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'confirm')).toEqual(['windowSurface', 'windowClose', 'heroGlow', 'lifeLostArt', 'buttonPrimary', 'offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt', 'priceIcon']);
    // window keys stay a generic tool: one must name a role of a covered window and keep the role's caps
    const stray = { ...READY_UI_STYLE_2, assets: { ...READY_UI_STYLE_2.assets, 'lives:heroGlow': { file: 'x.webp' } } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(stray)).toThrow("ReadyUiSkin 'style-2': asset 'lives:heroGlow' names no role of a window the style covers");
    const uncovered = { ...READY_UI_STYLE_2, covers: READY_UI_STYLE_2.covers.filter((view) => view !== 'confirm'), assets: { ...READY_UI_STYLE_2.assets, 'confirm:windowSurface': READY_UI_STYLE_1.assets.windowSurface } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(uncovered)).toThrow("ReadyUiSkin 'style-2': asset 'confirm:windowSurface' names no role of a window the style covers");
    const noCaps = { ...READY_UI_STYLE_2, assets: { ...READY_UI_STYLE_2.assets, 'confirm:buttonPrimary': { file: 'button/button_green@2x.webp' } } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(noCaps)).toThrow("ReadyUiSkin 'style-2': role 'buttonPrimary' is drawn as a 9-slice but has no nineSlice caps");
  });

  it('Restart and Exit are ONE generic window: same class, same layout and art; only the action\'s copy differs', () => {
    const kit = createKit();
    const restart = confirmView(kit, { action: 'restart', id: 'restart' });
    const exit = confirmView(kit, { id: 'exit' });
    expect(restart).toBeInstanceOf(ConfirmWindowView);
    expect(exit.constructor).toBe(restart.constructor);
    expect([restart.action, exit.action]).toEqual(['restart', 'exit']);
    expect([restart.skin, exit.skin]).toEqual([READY_UI_STYLE_2, READY_UI_STYLE_2]);
    expect(geometry(restart)).toEqual(geometry(exit));
    expect([field<Text>(restart, 'confirmLabel').text, field<Text>(exit, 'confirmLabel').text]).toEqual(['RESTART', 'EXIT']);
    // theme_light_4: the Style 2 popup / button / close / blur / broken heart
    expect(field<NineSliceSprite>(restart, 'surface').texture.source.label).toBe('style-2:windowSurface');
    expect(field<UiButton>(restart, 'confirmButton').background.texture.source.label).toBe('style-2:buttonPrimary');
    expect(field<UiButton>(restart, 'closeButton').background.texture.source.label).toBe('style-2:windowClose');
    expect(field<Sprite>(restart, 'glow').texture.source.label).toBe('style-2:heroGlow');
    expect(field<Sprite>(restart, 'heart').texture.source.label).toBe('style-2:lifeLostArt');
    const style1 = new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 's1', onConfirm: () => {} });
    expect(geometry(restart)).not.toEqual(geometry(style1));
    const surface = field<NineSliceSprite>(restart, 'surface');
    expect([surface.leftWidth, surface.topHeight, surface.rightWidth, surface.bottomHeight]).toEqual([191, 167, 191, 88]);
    const b = surface.getLocalBounds(); // the 960 × 980 popup centred (682 of the frame) + its header 49 above
    expect([surface.x + b.x, surface.y + b.y, b.width, b.height]).toEqual([FX(60), FY(633), 960, 1029]);
    within(field<UiButton>(restart, 'confirmButton').x, FX(539.358), 'button x');
    within(field<UiButton>(restart, 'confirmButton').y, FY(1475), 'button y');
    expect([field<Sprite>(restart, 'heart').x, field<Sprite>(restart, 'heart').y]).toEqual([FX(371), FY(830)]);
    for (const name of ['title', 'body', 'lifeDelta', 'confirmLabel']) {
      const style = field<Text>(restart, name).style;
      expect(style.fontFamily, name).toBe('Carlito');
      expect(style.dropShadow, name).toBeFalsy();
    }
    expect(field<Text>(restart, 'title').style.fill).toBe(0xffffff);
    expect(field<Text>(restart, 'body').style.fill).toBe(0x3f598c);
    expect(field<Text>(restart, 'body').style.stroke).toBeFalsy();
    expect(field<Text>(restart, 'lifeDelta').style.stroke).toMatchObject({ color: 0x9b170b, width: 10 }); // 5 outside
    expect([field<number>(restart, 'backdropColor'), field<number>(restart, 'backdropAlpha')]).toEqual([0x080b0d, 0.8]);
    for (const view of [restart, exit, style1]) view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('callbacks: the button runs the host\'s onConfirm after the close (restart / exit routing is the host\'s); × and backdrop cancel', () => {
    const kit = createKit();
    const log: string[] = [];
    const restart = confirmView(kit, { action: 'restart', id: 'restart', onConfirm: () => log.push('restart-level') }, log);
    const exit = confirmView(kit, { action: 'exit', id: 'exit', onConfirm: () => log.push('go-home') }, log);
    restart.show();
    advance(kit.core, 400);
    tap(field<UiButton>(restart, 'confirmButton'), kit);
    advance(kit.core, 300);
    expect(restart.state).toBe('hidden');
    exit.show();
    advance(kit.core, 400);
    tap(field<UiButton>(exit, 'confirmButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['restart-level', 'go-home']);
    restart.show();
    advance(kit.core, 400);
    tap(field<UiButton>(restart, 'closeButton'), kit);
    advance(kit.core, 300);
    exit.show();
    advance(kit.core, 400);
    const backdrop = field<Container>(exit, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 300);
    expect(log).toEqual(['restart-level', 'go-home', 'dismiss:button', 'dismiss:background']);
    expect(kit.uiErrors).toEqual([]);
    restart.destroy();
    exit.destroy();
  });

  it('copy: explicit text wins, then the provider (RU / EN, the action\'s key), then the legacy default', () => {
    const kit = createKit();
    const copy = (view: ConfirmWindowView): string[] => ['title', 'body', 'confirmLabel', 'lifeDelta'].map((name) => field<Text>(view, name).text);
    const cases: Array<[Partial<ConfirmWindowViewOptions>, string[]]> = [
      [{ action: 'restart', i18n: i18nOf('ru') }, ['ВЫ УВЕРЕНЫ?', 'Вы потеряете 1 жизнь', 'ЗАНОВО', '-1']],
      [{ action: 'exit', i18n: i18nOf('ru') }, ['ВЫ УВЕРЕНЫ?', 'Вы потеряете 1 жизнь', 'ВЫХОД', '-1']],
      [{ action: 'restart', i18n: i18nOf('en') }, ['ARE YOU SURE?', 'You will lose 1 heart', 'RESTART', '-1']],
      [{ i18n: i18nOf('en') }, ['ARE YOU SURE?', 'You will lose 1 heart', 'EXIT', '-1']],
      [{ action: 'restart' }, ['ARE YOU SURE?', 'YOU WILL LOSE 1 HEART', 'RESTART', '-1']],
      [{ action: 'restart', i18n: i18nOf('ru'), confirmLabel: 'ЕЩЁ РАЗ', title: 'ТОЧНО?' }, ['ТОЧНО?', 'Вы потеряете 1 жизнь', 'ЕЩЁ РАЗ', '-1']]
    ];
    for (const [options, expected] of cases) {
      const view = confirmView(kit, options);
      expect(copy(view), JSON.stringify({ ...options, i18n: options.i18n?.locale })).toEqual(expected);
      view.destroy();
    }
    expect(READY_UI_CATALOGS.en['core.confirm.restart']).toBe('RESTART');
    expect(READY_UI_CATALOGS.ru['core.confirm.restart']).toBe('ЗАНОВО');
  });

  it('isolation: no skin stays the donor window (the action still picks its copy), Style 1 stays Style 1; a missing Style 2 Confirm file fails clearly', () => {
    const kit = createKit();
    const donor = new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), id: 'donor', action: 'restart', onConfirm: () => {} });
    expect([donor.variant, donor.skin]).toEqual(['donor', null]);
    expect(labels(donor).some((label) => label.startsWith('style-'))).toBe(false);
    expect(field<UiButton>(donor, 'confirmButton').labelText?.text).toBe('RESTART');
    donor.destroy();
    const forcedDonor = confirmView(kit, { variant: 'donor', id: 'forced' });
    expect(forcedDonor.skin).toBeNull();
    forcedDonor.destroy();
    const style1 = new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 's1', onConfirm: () => {} });
    expect(style1.skin).toBe(READY_UI_STYLE_1);
    expect(field<NineSliceSprite>(style1, 'surface').texture.source.label).toBe('style-1:windowSurface');
    expect(field<Text>(style1, 'confirmLabel').text).toBe('EXIT');
    style1.destroy();
    expect(() => confirmView(kit, {}, [], styled(kit, READY_UI_STYLE_2, ['lifeLostArt'])))
      .toThrow("ConfirmWindowView style 'style-2': no lifeLostArt (style2/confirm_heart.webp) in textures — load them with loadReadyUiAssets({ skin })");
    expect(kit.ui.getStats().windows).toBe(0);
  });
});

describe('Style 2 — Refill Hearts (theme_light_4 22:28924) through the existing LivesWindowView', () => {
  const PARAMS: LivesWindowParams = { lives: 3, maxLives: 5, timerText: '17:42', refillPrice: 1250 };
  function livesView(kit: TestKit, extra: Partial<LivesWindowViewOptions> = {}, log: string[] = [], textures = styled(kit)): LivesWindowView {
    return new LivesWindowView({
      ui: kit.ui, motion: kit.motion, textures, theme: { skin: READY_UI_STYLE_2 }, id: 'lives',
      onRefill: (p) => log.push(`refill:${p.lives}`), onWatchAd: (p) => log.push(`ad:${p.lives}`), onDismiss: (reason) => log.push(`dismiss:${reason}`), ...extra
    });
  }
  function show(kit: TestKit, view: LivesWindowView, params: LivesWindowParams = PARAMS): LivesWindowView {
    view.show(params);
    advance(kit.core, 400);
    return view;
  }
  const layer = (parent: Container, label: string) => parent.children.find((child) => (child as Sprite).texture?.source.label === label) as Sprite | NineSliceSprite | undefined;
  /** A Carlito label's glyph run (no stroke unless the box has one): its centre in the parent's units. */
  const runCentre = (label: Text): number => {
    const stroke = (label.style.stroke as { width?: number } | null)?.width ?? 0;
    const advanceWidth = label.text.length * (label.style.fontSize as number) * 0.56;
    return label.x + label.scale.x * (stroke / 2 + advanceWidth / 2);
  };

  it('is part of the Style 2 package: covered, its roles follow the layout (no highlight art), the popup / close / heart reused, new files under style2/', () => {
    expect(READY_UI_STYLE_2.covers).toContain('lives');
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'lives')).toEqual(['windowSurface', 'windowClose', 'buttonPrimary', 'buttonRewarded', 'panelInset', 'lifeArt', 'priceIcon', 'rewardIcon', 'adIcon', 'offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt']);
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'lives')).toEqual(READY_UI_SKIN_WINDOW_ROLES.lives);
    expect(READY_UI_STYLE_2.windows.lives.adHighlight).toBeNull();
    const A = READY_UI_STYLE_2.assets as ReadyUiSkin['assets'];
    expect(A.buttonHighlight).toBeUndefined();
    // reused: the Settings popup (same file + caps), the Settings close, the HUD heart
    expect(A.windowSurface).toBe(A.settingsPanel);
    expect(A.windowClose?.file).toBe(A.settingsClose?.file);
    expect(A.lifeArt?.file).toBe(A.hudHeart?.file);
    expect(A.rewardIcon?.file).toBe(A.hudHeart?.file);
    // new leaves of 8:22838
    expect([A.buttonPrimary, A.buttonRewarded, A.panelInset, A.priceIcon, A.adIcon].map((asset) => asset?.file))
      .toEqual(['style2/button_primary.webp', 'style2/button_rewarded.webp', 'style2/lives_glow@0.5x.webp', 'style2/price_coin@2x.webp', 'style2/icon_tv.webp']);
    expect(A.buttonPrimary?.nineSlice).toEqual({ left: 48, top: 103, right: 48, bottom: 103 });
    const noTv = { ...READY_UI_STYLE_2, assets: { ...READY_UI_STYLE_2.assets, adIcon: undefined } } as unknown as ReadyUiSkin;
    expect(() => validateReadyUiSkin(noTv)).toThrow("ReadyUiSkin 'style-2' covers 'lives' but has no asset for role 'adIcon'");
  });

  it('draws 22:28924: the popup 9-slice, the blur, the heart, two 9-slice buttons without highlight, art at the Figma boxes', () => {
    const kit = createKit();
    const view = show(kit, livesView(kit));
    expect([view.variant, view.skin]).toEqual(['figma', READY_UI_STYLE_2]);
    const panel = field<Container>(view, 'panel');
    const shell = layer(panel, 'style-2:windowSurface') as NineSliceSprite;
    expect([shell.leftWidth, shell.topHeight, shell.rightWidth, shell.bottomHeight]).toEqual([191, 167, 191, 88]);
    const s = shell.getLocalBounds(); // the popup 960 × 756 alone, centred (794) + the header 49 above
    [FX(60), FY(745), 960, 805].forEach((value, i) => within([shell.x + s.x, shell.y + s.y, s.width, s.height][i]!, value, 'shell'));
    const glow = layer(panel, 'style-2:panelInset') as NineSliceSprite;
    expect(glow).toBeInstanceOf(NineSliceSprite);
    const g = glow.getLocalBounds();
    expect([glow.x + g.x, glow.y + g.y, g.width, g.height]).toEqual([FX(0), FY(760), 1080, 920]);
    const heart = layer(panel, 'style-2:lifeArt') as Sprite;
    expect([heart.x, heart.y, heart.width, heart.height]).toEqual([FX(150), FY(951), 338, 338]);
    const close = field<UiButton>(view, 'closeButton');
    expect(close.background.texture.source.label).toBe('style-2:windowClose');
    expect([close.x, close.y, close.background.width, close.background.height]).toEqual([FX(907 + 76.5), FY(757 + 79), 153, 158]);

    const refill = field<UiButton>(view, 'refillButton');
    expect(refill.background.texture.source.label).toBe('style-2:buttonPrimary');
    expect([refill.x, refill.y, refill.background.width, refill.background.height]).toEqual([FX(297), FY(1367), 354, 214]);
    const ad = field<UiButton>(view, 'adButton');
    expect(ad.background.texture.source.label).toBe('style-2:buttonRewarded');
    expect([ad.x, ad.y, ad.background.width, ad.background.height]).toEqual([FX(730), FY(1367), 460, 214]);
    expect(labels(ad)).not.toContain('style-2:buttonHighlight');
    const tv = layer(ad, 'style-2:adIcon') as Sprite;
    expect([tv.x, tv.y, tv.width, tv.height]).toEqual([491.27 - 730, 1359.25 - 1367, 127.5, 127.5]); // on the bottom-left corner
    const reward = layer(ad, 'style-2:rewardIcon') as Sprite;
    expect([reward.x, reward.y, reward.width, reward.height]).toEqual([841 - 730, 1224 - 1367, 128, 128]); // on the top-right corner
    // the GET slot is the free space between the tv and the reward heart: a long word shrinks, never runs under an icon
    const L = READY_UI_STYLE_2.windows.lives;
    expect(L.adLabel.x).toBeGreaterThanOrEqual(L.adIcon.x + L.adIcon.width);
    expect(L.adLabel.x + L.adLabel.width).toBeLessThanOrEqual(L.rewardIcon.x);
    // Figma order inside the rewarded button: GET, the heart and its "+1", the tv on top
    expect(ad.children.indexOf(tv)).toBe(ad.children.length - 1);
    // decoration never takes input
    for (const node of [shell, glow, heart, field<Text>(view, 'title'), field<Text>(view, 'countText'), field<Text>(view, 'nextLabel'), field<Text>(view, 'timerText')]) expect(node.eventMode).toBe('none');
    expect(panel.children[panel.children.length - 1]).toBe(close);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('runtime values in the Figma text looks: count / timer / price / reward from the host, Carlito, per-box fill and stroke', () => {
    const kit = createKit();
    const view = show(kit, livesView(kit));
    const count = field<Text>(view, 'countText');
    const timer = field<Text>(view, 'timerText');
    const price = field<Text>(view, 'priceText');
    expect([count.text, timer.text, price.text]).toEqual(['3', '17:42', formatAmount(1250)]);
    expect(count.style.fontFamily).toBe('Carlito');
    expect(count.style.fill).toBe(0xffffff);
    expect(count.style.stroke).toMatchObject({ color: 0x9b170b, width: 10 }); // 5 outside
    expect(count.style.dropShadow).toBeFalsy();
    within(runCentre(count), FX(319), 'count centred in its 200 box');
    for (const text of [field<Text>(view, 'nextLabel'), timer]) {
      expect(text.style.fill).toBe(0x3f598c);
      expect(text.style.stroke).toBeFalsy();
      within(runCentre(text), FX(709), text.text);
    }
    const title = field<Text>(view, 'title');
    expect([title.style.fill, title.style.fontFamily, title.style.fontSize]).toEqual([0xffffff, 'Carlito', 65]);
    within(runCentre(title), FX(540), 'title');
    // the reward "+1": white, a 2-unit #9b170b outside stroke, centred on the heart (872 = Figma's "1" box centre)
    const ad = field<UiButton>(view, 'adButton');
    const adTexts = ad.children.filter((child): child is Text => child instanceof Text);
    expect(adTexts.map((text) => text.text)).toEqual(['GET', '+1']);
    expect(adTexts[1]!.style.stroke).toMatchObject({ color: 0x9b170b, width: 4 });
    within(runCentre(adTexts[1]!), 903 - 730, '+1');
    within(runCentre(adTexts[0]!), 619 + 111 - 730, 'GET');
    // Frame 1244: the price, a 5-unit gap, the 46 coin 13 below the row top; the row centred at 289.5 (button 297)
    const coin = field<Sprite>(view, 'priceCoin');
    expect(coin.texture.source.label).toBe('style-2:priceIcon');
    expect([coin.width, coin.height, coin.y]).toEqual([46, 46, 1380 - 1367]);
    const advanceWidth = price.text.length * 60 * 0.56;
    within(coin.x, price.x + advanceWidth + 5, 'coin follows the price');
    within((price.x + coin.x + 46) / 2, 289.5 - 297, 'row centre');
    view.setTimer('09:05');
    expect(timer.text).toBe('09:05');
    within(runCentre(timer), FX(709), 'timer stays centred');
    view.destroy();
  });

  it('keeps the runtime semantics: MAX + REFILL disabled when full, the ad only when offered and handled, continuations with the params after the close', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = show(kit, livesView(kit, {}, log));
    tap(field<UiButton>(view, 'refillButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['refill:3']);
    expect(view.state).toBe('hidden');
    show(kit, view, { lives: 5, maxLives: 5, refillPrice: 900 });
    expect(field<Text>(view, 'timerText').text).toBe('MAX');
    expect(field<UiButton>(view, 'refillButton').enabled).toBe(false);
    view.setTimer('00:01');
    expect(field<Text>(view, 'timerText').text).toBe('MAX');
    tap(field<UiButton>(view, 'adButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['refill:3', 'ad:5']);
    show(kit, view, { ...PARAMS, adOffer: false });
    expect(field<UiButton>(view, 'adButton').visible).toBe(false);
    expect(field<UiButton>(view, 'refillButton').x).toBe(0);
    tap(field<UiButton>(view, 'closeButton'), kit);
    advance(kit.core, 300);
    show(kit, view);
    expect(field<UiButton>(view, 'refillButton').x).toBe(FX(297));
    const backdrop = field<Container>(view, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 300);
    expect(log).toEqual(['refill:3', 'ad:5', 'dismiss:button', 'dismiss:background']);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
    const noHandler = show(kit, new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), theme: { skin: READY_UI_STYLE_2 }, id: 'no-ad', onRefill: () => {} }));
    expect(field<UiButton>(noHandler, 'adButton').visible).toBe(false);
    noHandler.destroy();
  });

  it('copy: explicit text wins, then the provider (RU / EN), then the legacy default', () => {
    const kit = createKit();
    const copy = (view: LivesWindowView): string[] => [
      field<Text>(view, 'title').text, field<Text>(view, 'nextLabel').text,
      ...field<UiButton>(view, 'refillButton').children.filter((child): child is Text => child instanceof Text && child !== field<Text>(view, 'priceText')).map((text) => text.text),
      ...field<UiButton>(view, 'adButton').children.filter((child): child is Text => child instanceof Text).map((text) => text.text)
    ];
    const cases: Array<[Partial<LivesWindowViewOptions>, string[]]> = [
      [{ i18n: i18nOf('ru') }, ['ЖИЗНИ', 'Новая жизнь через', 'ПОПОЛНИТЬ!', 'ВЗЯТЬ', '+1']],
      [{ i18n: i18nOf('en') }, ['REFILL HEARTS!', 'Next heart in', 'REFILL', 'GET', '+1']],
      [{}, ['REFILL HEARTS!', 'NEXT HEART IN', 'REFILL NOW!', 'GET', '+1']],
      [{ i18n: i18nOf('en'), refillLabel: 'REFILL NOW', adRewardLabel: '1' }, ['REFILL HEARTS!', 'Next heart in', 'REFILL NOW', 'GET', '1']]
    ];
    for (const [options, expected] of cases) {
      const view = livesView(kit, options);
      expect(copy(view), JSON.stringify({ ...options, i18n: options.i18n?.locale })).toEqual(expected);
      view.destroy();
    }
    const ru = show(kit, livesView(kit, { i18n: i18nOf('ru') }), { lives: 5, maxLives: 5, refillPrice: 900 });
    expect(field<Text>(ru, 'timerText').text).toBe('МАКС');
    ru.destroy();
  });

  it('isolation: no skin stays donor, Style 1 keeps its Lives (with the highlight); a missing Style 2 file fails clearly', () => {
    const kit = createKit();
    const donor = show(kit, new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit), id: 'donor', onRefill: () => {}, onWatchAd: () => {} }));
    expect([donor.variant, donor.skin]).toEqual(['donor', null]);
    expect(labels(donor).some((label) => label.startsWith('style-'))).toBe(false);
    donor.destroy();
    const style1 = show(kit, new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, id: 's1', onRefill: () => {}, onWatchAd: () => {} }));
    expect(style1.skin).toBe(READY_UI_STYLE_1);
    expect(labels(style1)).toEqual(expect.arrayContaining(['style-1:lifeArt', 'style-1:buttonHighlight', 'style-1:adIcon']));
    expect(layer(field<Container>(style1, 'panel'), 'style-1:windowSurface')).toBeInstanceOf(NineSliceSprite);
    expect(field<Text>(style1, 'countText').style.stroke).toMatchObject({ color: 0x000000, width: 8 });
    style1.destroy();
    expect(() => livesView(kit, {}, [], styled(kit, READY_UI_STYLE_2, ['buttonRewarded'])))
      .toThrow("LivesWindowView style 'style-2': no buttonRewarded (style2/button_rewarded.webp) in textures — load them with loadReadyUiAssets({ skin })");
    expect(kit.ui.getStats().windows).toBe(0);
  });

  it('loading: Style 2 requests its Confirm / Lives files strictly under its own aliases; the donor and Style 1 request no Style 2 file', async () => {
    const requested: Array<{ alias?: string; src: string }> = [];
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (input: unknown) => {
      for (const entry of (Array.isArray(input) ? input : [input]) as Array<{ alias?: string; src: string }>) requested.push(entry);
      return labelled('loaded');
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => labelled('got')) as never);
    try {
      await loadReadyUiAssets({ baseUrl: './ui/' });
      await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_1 });
      expect(requested.filter((entry) => entry.src.includes('style2/') || entry.src.includes('Carlito'))).toEqual([]);
      expect(requested.filter((entry) => entry.alias?.includes('style-2'))).toEqual([]);
      requested.length = 0;
      const textures = await loadReadyUiAssets({ baseUrl: './ui/', skin: READY_UI_STYLE_2 });
      const src = (alias: string) => requested.find((entry) => entry.alias === `game-core-ui:skin:style-2:${alias}`)?.src;
      expect(src('heroGlow')).toBe('./ui/style2/lives_glow@0.5x.webp');
      expect(src('lifeLostArt')).toBe('./ui/style2/confirm_heart.webp');
      expect(src('windowSurface')).toBe('./ui/style2/settings_panel.webp');
      expect(src('buttonPrimary')).toBe('./ui/style2/button_primary.webp');
      expect(src('panelInset')).toBe('./ui/style2/lives_glow@0.5x.webp');
      expect(src('adIcon')).toBe('./ui/style2/icon_tv.webp');
      expect(src('offerPanel')).toBe('./ui/style2/offer_panel.webp');
      expect(src('offerCoinArt')).toBe('./ui/style2/icon_coin.webp');
      expect(requested.filter((entry) => entry.alias?.includes('style-2:confirm:'))).toEqual([]);
      expect(Object.keys(textures.skins!['style-2']!)).toEqual(expect.arrayContaining(['windowSurface', 'buttonRewarded', 'priceIcon', 'offerPanel', 'offerBadge', 'offerLivesArt']));
      expect(requested.filter((entry) => entry.src.includes('Carlito'))).toHaveLength(1);
    } finally {
      load.mockRestore();
      get.mockRestore();
    }
  });
});
