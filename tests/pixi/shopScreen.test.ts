import { describe, expect, it } from 'vitest';
import { Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer, type TestKit } from './setup';
import { LocalizationRuntime } from '../../src/localization';
import * as pixiEntry from '../../src/pixi/index';
import { LevelMapScreen } from '../../src/pixi/LevelMapScreen';
import { ShopScreen, type ShopScreenItem, type ShopScreenOptions } from '../../src/pixi/ShopScreen';
import { ShopWindowView } from '../../src/pixi/ShopWindowView';
import { ModalWindow } from '../../src/pixi/ModalWindow';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { requiredSkinRoles, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { ReadyUiTextures } from '../../src/pixi/assets';
import type { ReadyUiThemeOverrides } from '../../src/pixi/theme';
import type { UiButton } from '../../src/pixi/UiButton';

const rootDir = resolve(__dirname, '../..');
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });
const STYLES: ReadonlyArray<{ name: string; skin: ReadyUiSkin; theme: ReadyUiThemeOverrides }> = [
  { name: 'Style 1', skin: READY_UI_STYLE_1, theme: { skin: READY_UI_STYLE_1 } },
  { name: 'Style 2', skin: READY_UI_STYLE_2, theme: { skin: READY_UI_STYLE_2 } }
];
/** Host data in the tests: ids / amounts / prices the host's catalog would give (none of them is Core's). */
const ITEMS: ShopScreenItem[] = [
  { id: 'pack_a', amount: 1000, price: 'P1' },
  { id: 'pack_b', amount: 2500, price: 'P2' },
  { id: 'pack_c', amount: 5000, price: 'P3' },
  { id: 'pack_d', amount: 12500, price: 'P4' },
  { id: 'pack_e', amount: 25000, price: 'P5' },
  { id: 'pack_f', amount: 50000, price: 'P6' }
];

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

const field = <T>(view: object, name: string): T => (view as Record<string, unknown>)[name] as T;
const labels = (root: Container): string[] => descendants(root, Sprite).filter((s) => s.visible && !(s instanceof NineSliceSprite)).map((s) => s.texture.source.label);
const texts = (root: Container): string[] => descendants(root, Text).filter((t) => t.visible).map((t) => t.text);

/** A settled tap on a pointer-driven container. */
function tap(target: Container, kit: TestKit): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 200);
}

function createShop(kit: TestKit, style: (typeof STYLES)[number], overrides: Partial<ShopScreenOptions> = {}) {
  const bought: string[] = [];
  const shop = new ShopScreen({
    ui: kit.ui,
    motion: kit.motion,
    textures: styled(kit, style.skin),
    theme: style.theme,
    items: ITEMS,
    onBuy: (item) => bought.push(item.id),
    width: 390,
    height: 844,
    ...overrides
  });
  return { shop, bought };
}

const card = (shop: ShopScreen, id: string): UiButton => shop.getCardContainer(id) as UiButton;

describe.each(STYLES)('ShopScreen — the SHOP tab ($name)', (style) => {
  const id = style.skin.id;

  it('draws the style\'s shop tab: background, awning, title tape, a card per host pack (slot art), SHOP selected in the nav', () => {
    const kit = createKit();
    const { shop } = createShop(kit, style, { onClose: () => {} });
    expect(shop).not.toBeInstanceOf(ModalWindow);
    const [background, ...rest] = shop.children;
    expect(background!.constructor.name).toBe('Graphics');
    const picture = style.skin === READY_UI_STYLE_1;
    // Style 1 has the gradient + bears picture over its fill; Style 2 is the flat #0f172c fill
    expect(rest.length).toBe(picture ? 3 : 2);
    if (picture) expect((rest[0] as Sprite).texture.source.label).toBe(`${id}:shopBackground`);
    expect(shop.children.at(-1)).toBe(shop.nav);
    const tape = descendants(shop, NineSliceSprite).find((s) => s.texture.source.label === `${id}:shopTitle`)!;
    expect(tape.width).toBe(style.skin.shopScreen!.title.ribbon.width);
    expect(labels(shop).filter((l) => l === `${id}:shopAwning`).length).toBeGreaterThanOrEqual(1);
    expect(shop.items.map((item) => item.id)).toEqual(ITEMS.map((item) => item.id));
    ITEMS.forEach((item, i) => {
      const c = card(shop, item.id);
      expect(c.background.texture.source.label).toBe(`${id}:shopCard`);
      expect(labels(c)).toEqual([`${id}:shopCard`, `${id}:shopPack${i + 1}`]);
      // the amount and the price are the host's, drawn as given (no separator, no currency invented)
      expect(texts(c)).toEqual([String(item.amount), item.price]);
    });
    expect(texts(shop)[0]).toBe('SHOP');
    expect(labels(shop)).toContain(`${id}:shopClose`);
    // the same SHOP | HOME | LOCK navigation as the map screen, SHOP selected; nothing given = SHOP / HOME inert, LOCK shakes
    expect(shop.nav.itemIds).toEqual(['shop', 'home', 'lock']);
    expect(shop.nav.selectedId).toBe('shop');
    expect(['shop', 'home', 'lock'].map((slot) => shop.nav.isDisabled(slot))).toEqual([true, true, false]);
    expect(shop.nav.isLocked('lock')).toBe(true);
    shop.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('lays the cards out on the Figma grid of the frame (3 per row, the phone frame at the width, frame top on the viewport top)', () => {
    const kit = createKit();
    const { shop } = createShop(kit, style);
    const layout = style.skin.shopScreen!;
    const s = 390 / 1080;
    const body = field<Container>(shop, 'body');
    expect(body.scale.x).toBeCloseTo(s, 6);
    expect(body.position.x).toBeCloseTo(195, 6);
    expect(body.position.y).toBe(0);
    ITEMS.forEach((item, i) => {
      const c = card(shop, item.id);
      const art = layout.card.art;
      // card box left / top in frame units = the button position − the art centre offset
      const left = c.x - (art.x + art.width / 2) + 540;
      const top = c.y - (art.y + art.height / 2);
      expect(left).toBeCloseTo([51, 385, 719][i % 3]!, 6);
      expect(top).toBeCloseTo(layout.grid.top + Math.floor(i / 3) * layout.grid.pitchY, 6);
    });
    // six packs fit on a phone: nothing to scroll
    expect(shop.scrollable).toBe(false);
    // a partial last row is centred
    shop.setItems(ITEMS.slice(0, 4));
    expect(card(shop, 'pack_d').x).toBeCloseTo(card(shop, 'pack_b').x, 6);
    // the awning tiles cover a wide viewport from edge to edge
    shop.resize(1280, 800);
    const tiles = descendants(field<Container>(shop, 'awning'), Sprite).filter((t) => t.visible);
    const bounds = tiles.map((t) => t.getBounds());
    expect(Math.min(...bounds.map((b) => b.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...bounds.map((b) => b.right))).toBeGreaterThanOrEqual(1280);
    shop.destroy();
  });

  it('two Figma compositions: MOBILE (phone width, awning under the status bar) while two rows fit, else DESKTOP (PC: compact column, awning raised, x beside the tape)', () => {
    const kit = createKit();
    const { shop } = createShop(kit, style, { onClose: () => {} });
    const layout = style.skin.shopScreen!;
    const body = field<Container>(shop, 'body');
    const awning = field<Container>(shop, 'awning');
    const close = field<UiButton>(shop, 'closeButton');
    const gridWidth = (): number => {
      const bounds = ITEMS.map((item) => card(shop, item.id).getBounds());
      return Math.max(...bounds.map((b) => b.right)) - Math.min(...bounds.map((b) => b.left));
    };
    // phones (19.5:9 and 16:9): the frame at the width, the three cards ~90 % of it like the phone frame (978 of 1080)
    for (const [w, h] of [[390, 844], [320, 568], [360, 640]] as const) {
      shop.resize(w, h);
      expect(body.scale.x, `${w}x${h}`).toBeCloseTo(w / 1080, 6);
      expect(awning.y).toBe(0);
      expect(gridWidth() / w).toBeGreaterThan(0.9);
      expect(close.x).toBeCloseTo(540 - layout.close.right - layout.close.width / 2, 6);
      expect(shop.scrollable).toBe(false);
    }
    // a phone whose bottom inset lifts the navigation keeps the phone frame while the rows still fit above it
    shop.resize(320, 568, { insets: { top: 20, bottom: 34 } });
    expect(body.scale.x).toBeCloseTo(320 / 1080, 6);
    // desktop windows (wide, or too short for the phone frame): the design-height scale, the PC awning and x
    for (const [w, h] of [[1280, 800], [501, 547], [768, 1024]] as const) {
      shop.resize(w, h);
      const s = Math.min(w / 1080, h / 2344);
      expect(body.scale.x, `${w}x${h}`).toBeCloseTo(s, 6);
      expect(gridWidth()).toBeCloseTo(978 * s + (layout.card.art.width - 310) * s, 0);
      expect(awning.y).toBe(layout.desktop.awningY);
      expect([close.x, close.y]).toEqual([layout.desktop.close.x - 540, layout.desktop.close.y]);
      expect(shop.scrollable).toBe(false);
    }
    // the desktop x never leaves the safe area
    shop.resize(400, 520, { insets: { right: 40 } });
    expect(close.x + layout.close.width / 2).toBeLessThanOrEqual((400 - 40 - 180) / body.scale.x + 1e-6);
    shop.destroy();
  });

  it('host config: a card tap reports onBuy(item); unavailable packs and a purchase in flight are inert', () => {
    const kit = createKit();
    const host = labelled('host:pack');
    const items: ShopScreenItem[] = [
      { id: 'a', amount: 10, price: 'X' },
      { id: 'b', amount: 20, price: 'Y', available: false },
      { id: 'c', amount: 30, price: 'Z', icon: host },
      { id: 'd', amount: 40, price: 'W', icon: 'shopPack6' }
    ];
    const { shop, bought } = createShop(kit, style, { items });
    expect(labels(card(shop, 'c'))).toContain('host:pack');
    expect(labels(card(shop, 'd'))).toContain(`${id}:shopPack6`);
    tap(card(shop, 'a'), kit);
    tap(card(shop, 'b'), kit);
    expect(bought).toEqual(['a']);
    expect(card(shop, 'b').enabled).toBe(false);
    expect(card(shop, 'b').alpha).toBeLessThan(1);
    // the host's purchase is in flight: every card is held, the unavailable one stays dimmed
    shop.setBuyEnabled(false);
    expect(shop.buyEnabled).toBe(false);
    tap(card(shop, 'c'), kit);
    expect(bought).toEqual(['a']);
    expect(card(shop, 'c').alpha).toBe(0.85);
    shop.setBuyEnabled(true);
    tap(card(shop, 'c'), kit);
    expect(bought).toEqual(['a', 'c']);
    expect(card(shop, 'b').enabled).toBe(false);
    // a new catalog replaces the cards (the old controllers are gone, the ids reused)
    shop.setItems([{ id: 'z', amount: 1, price: 'Q' }]);
    expect(shop.items.map((item) => item.id)).toEqual(['z']);
    expect(shop.getCardContainer('a')).toBeNull();
    tap(card(shop, 'z'), kit);
    expect(bought).toEqual(['a', 'c', 'z']);
    // a bad catalog entry fails loudly
    expect(() => shop.setItems([{ id: 'x', amount: 1, price: 'A' }, { id: 'x', amount: 2, price: 'B' }])).toThrow("ShopScreen: duplicate item id 'x'");
    expect(() => shop.setItems([{ id: 'x', amount: 1 } as never])).toThrow("ShopScreen: item 'x' needs a price string");
    expect(() => shop.setItems([{ id: 'x', amount: 1, price: 'A', icon: 'playButton' as never }])).toThrow('not a shop pack role');
    shop.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('title and copy: the localized default, the host\'s title, setTitle', () => {
    const kit = createKit();
    const ru = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const { shop } = createShop(kit, style, { i18n: ru });
    expect(texts(shop)[0]).toBe('МАГАЗИН');
    expect(texts(shop.nav)).toEqual(['МАГАЗИН', 'ДОМОЙ', 'ЗАКРЫТО']);
    shop.setTitle('SPECIAL OFFER');
    expect(texts(shop)[0]).toBe('SPECIAL OFFER');
    shop.destroy();
    const { shop: titled } = createShop(createKit(), style, { title: 'GOLD' });
    expect(texts(titled)[0]).toBe('GOLD');
    titled.destroy();
  });

  it('LevelMap → SHOP → HOME: host routing between two live screens, the map never rebuilt, nothing modal', () => {
    const kit = createKit();
    const routes: string[] = [];
    const textures = styled(kit, style.skin);
    let shop: ShopScreen | null = null;
    const toShop = (): void => { map.visible = false; shop!.show(); routes.push('shop'); };
    const toMap = (): void => { shop!.hide(); map.visible = true; routes.push('home'); };
    const map = new LevelMapScreen({
      ui: kit.ui, motion: kit.motion, textures, theme: style.theme,
      map: { levels: 60, currentLevel: 38 }, hud: { coins: 120, lives: 3, maxLives: 5, onCoinsTap: () => toShop() },
      nav: { shop: { onTap: toShop }, home: { onTap: () => routes.push('map:home') }, lock: {} },
      onPlay: () => routes.push('play'), width: 390, height: 844
    });
    shop = new ShopScreen({
      ui: kit.ui, motion: kit.motion, textures, theme: style.theme, items: ITEMS, hidden: true,
      onBuy: (item) => routes.push(`buy:${item.id}`), onClose: toMap,
      nav: { home: { onTap: toMap }, lock: {} }, width: 390, height: 844
    });
    const stage = new Container();
    stage.addChild(map, shop);
    expect(shop.shown).toBe(false);
    // the player scrolled the map somewhere: that state must survive the round trips
    map.map.scrollToLevel(30, false);
    const mapView = map.map;
    const focus = map.map.focusLevel;

    tap(map.nav.getItemContainer('shop')!, kit);
    expect(routes).toEqual(['shop']);
    expect([map.visible, shop.shown]).toEqual([false, true]);
    expect(kit.ui.isBlocking()).toBe(false); // a tab, not a window
    tap(card(shop, 'pack_c'), kit);
    tap(shop.nav.getItemContainer('home')!, kit);
    expect(routes).toEqual(['shop', 'buy:pack_c', 'home']);
    expect([map.visible, shop.shown]).toEqual([true, false]);
    expect(map.map).toBe(mapView);
    expect(map.map.focusLevel).toBe(focus);
    expect(map.playLevel).toBe(30);

    // the × and the HUD coin entry route the same way; SHOP in the shop is the current tab (inert without onTap)
    tap(map.nav.getItemContainer('shop')!, kit);
    tap(shop.nav.getItemContainer('shop')!, kit);
    tap(field<UiButton>(shop, 'closeButton'), kit);
    expect(routes.slice(3)).toEqual(['shop', 'home']);
    expect(map.map.focusLevel).toBe(focus);
    // a hidden shop never buys, even if a stale press settles
    const c = card(shop, 'pack_a');
    c.emit('pointerdown', pointer(1, 1) as never);
    shop.hide();
    c.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 200);
    expect(routes).not.toContain('buy:pack_a');
    map.destroy();
    shop.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('scrolls when the packs do not fit: a drag moves the column and is never a purchase; hide and destroy settle everything', () => {
    const kit = createKit();
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, amount: i + 1, price: `${i}` }));
    const { shop, bought } = createShop(kit, style, { items: many });
    expect(shop.scrollable).toBe(true);
    const area = field<Container>(shop, 'scrollArea');
    const c = card(shop, 'p0');
    c.emit('pointerdown', pointer(100, 400) as never);
    area.emit('pointerdown', pointer(100, 400) as never);
    for (const y of [390, 370, 340, 300]) area.emit('globalpointermove', pointer(100, y) as never);
    c.emit('pointerup', pointer(100, 300) as never);
    area.emit('pointerup', pointer(100, 300) as never);
    expect(bought).toEqual([]);
    expect(shop.scrollY).toBeLessThan(0);
    // the release flings on through MotionRuntime; hide() stops it where it is
    expect(kit.motion.getStats().activeMotions).toBe(1);
    advance(kit.core, 100);
    shop.hide();
    expect(kit.motion.getStats().activeMotions).toBe(0);
    const y = shop.scrollY;
    advance(kit.core, 1000);
    expect(shop.scrollY).toBe(y);
    shop.scrollToTop();
    expect(shop.scrollY).toBe(0);
    // the wheel scrolls too, clamped to the content
    shop.show();
    area.emit('wheel', { deltaY: 100000, stopPropagation(): void {} } as never);
    expect(shop.scrollY).toBeLessThan(0);
    const bottom = shop.scrollY;
    area.emit('wheel', { deltaY: 100000, stopPropagation(): void {} } as never);
    expect(shop.scrollY).toBe(bottom);
    // a fling in flight at destroy: cancelled, listeners off, controllers disposed (their ids free again)
    area.emit('pointerdown', pointer(100, 300) as never);
    for (const yy of [320, 360, 420]) area.emit('globalpointermove', pointer(100, yy) as never);
    area.emit('pointerup', pointer(100, 420) as never);
    expect(kit.motion.getStats().activeMotions).toBe(1);
    shop.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(area.listenerCount('pointerdown')).toBe(0);
    shop.destroy(); // idempotent
    shop.show();
    shop.setItems([]);
    expect(() => new ShopScreen({ ui: kit.ui, motion: kit.motion, textures: styled(kit, style.skin), theme: style.theme, items: many, onBuy: () => {}, onClose: () => {} }).destroy()).not.toThrow();
    expect(kit.uiErrors).toEqual([]);
    expect(kit.motionErrors).toEqual([]);
  });
});

describe('ShopScreen — skin contract and compatibility', () => {
  it('is public, needs a style covering shopScreen, and resolves its roles strictly', () => {
    expect(pixiEntry.ShopScreen).toBe(ShopScreen);
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'shopScreen')).toEqual(['shopBackground', 'shopAwning', 'shopTitle', 'shopCard', 'shopPack1', 'shopPack2', 'shopPack3', 'shopPack4', 'shopPack5', 'shopPack6', 'shopClose']);
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'shopScreen')).toEqual(['shopAwning', 'shopTitle', 'shopCard', 'shopPack1', 'shopPack2', 'shopPack3', 'shopPack4', 'shopPack5', 'shopPack6', 'shopClose']);
    const assetsDir = resolve(rootDir, 'assets/pixi-ui');
    for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2] as ReadyUiSkin[]) {
      expect(() => validateReadyUiSkin(skin)).not.toThrow();
      for (const role of requiredSkinRoles(skin, 'shopScreen')) expect(existsSync(resolve(assetsDir, skin.assets[role]!.file)), `${skin.id} ${role}`).toBe(true);
    }
    const kit = createKit();
    const base = { ui: kit.ui, motion: kit.motion, onBuy: () => {} };
    expect(() => new ShopScreen({ ...base, textures: kit.textures })).toThrow("ShopScreen needs a Ready UI style that covers 'shopScreen'");
    expect(() => new ShopScreen({ ...base, textures: styled(kit, READY_UI_STYLE_2, ['shopCard']), theme: { skin: READY_UI_STYLE_2 } }))
      .toThrow("ShopScreen style 'style-2': no shopCard (style2/shop_card.webp) in textures");
    // the title tape is a 9-slice: a package without its caps is refused
    const noCaps = { ...READY_UI_STYLE_2, id: 'no-caps', assets: { ...READY_UI_STYLE_2.assets, shopTitle: { file: 'style2/shop_title.webp' } } } as ReadyUiSkin;
    expect(() => validateReadyUiSkin(noCaps)).toThrow("role 'shopTitle' is drawn as a 9-slice but has no nineSlice caps");
    expect(kit.uiErrors).toEqual([]);
  });

  it('keeps the modal ShopWindowView as it was: donor art under any style, a WindowController, onBuy as a close continuation', () => {
    for (const skin of [undefined, READY_UI_STYLE_1, READY_UI_STYLE_2]) {
      const kit = createKit();
      expect(skin?.covers.includes('shop' as never) ?? false).toBe(false);
      const bought: string[] = [];
      const textures = skin ? styled(kit, skin) : kit.textures;
      const view = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures, ...(skin ? { theme: { skin } } : {}), onBuy: (item) => bought.push(item.id) });
      view.show({ items: ITEMS });
      advance(kit.core, 600);
      expect(view.state).toBe('shown');
      expect(kit.ui.isBlocking()).toBe(true);
      // donor art (the kit's white test textures), no style role anywhere
      expect(labels(view).some((label) => label.startsWith('style-'))).toBe(false);
      const cards = descendants(view, Container).filter((c) => (c as { controller?: unknown }).controller && texts(c).includes('P1'));
      expect(cards.length).toBe(1);
      tap(cards[0]!, kit);
      advance(kit.core, 400);
      expect(bought).toEqual(['pack_a']);
      expect(view.state).toBe('hidden');
      view.destroy();
      expect(kit.uiErrors).toEqual([]);
    }
  });
});
