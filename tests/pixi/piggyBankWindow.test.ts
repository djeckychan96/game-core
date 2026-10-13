import { describe, expect, it } from 'vitest';
import { NineSliceSprite, Sprite, Texture, TextureSource, type Container } from 'pixi.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer } from './setup';
import { LocalizationRuntime, PiggyBankService, SaveGate, SoftCurrencyWallet, piggyBankGddExample } from '../../src/index';
import type { GameProductionProfile, PiggyBankConfig, PiggyBankSnapshot, PlatformStorage } from '../../src/index';
import { PiggyBankWindowView } from '../../src/pixi/PiggyBankWindowView';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_SKIN_VIEW_ROLES, requiredSkinRoles, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const rootDir = resolve(__dirname, '../..');
const PROFILE: Pick<GameProductionProfile, 'id' | 'save' | 'economy'> = {
  id: 'game',
  save: { keys: ['game_state'] },
  economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0 } }
};
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

function styled(kit: Kit, skin: ReadyUiSkin): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  const roles: ReadyUiSkinTextures = {};
  for (const key of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[key] = labelled(`${skin.id}:${key}`);
  return { ...required, skins: { [skin.id]: roles } };
}

/** A lossless WebP's pixel size (VP8L header). */
function px(file: string): number[] {
  const b = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
  expect(b.toString('ascii', 12, 16), file).toBe('VP8L');
  const bits = b.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

function memoryStorage(): PlatformStorage {
  const data: Record<string, unknown> = {};
  return {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, JSON.parse(JSON.stringify(data[key]))])),
    set: (patch) => {
      Object.assign(data, JSON.parse(JSON.stringify(patch)));
      return Promise.resolve(true);
    },
    clear: async (keys) => {
      for (const key of keys) delete data[key];
    }
  };
}

/** The approved Puzzle numbers: 150 %, from 50 %, 3000 → 5000 → 7500 → 10000, each sold for 900 coins. */
const CONFIG: PiggyBankConfig = { ...piggyBankGddExample(), levels: piggyBankGddExample().levels.map((level) => ({ ...level, price: { kind: 'wallet' as const, amount: 900 } })) };

async function bank(config: PiggyBankConfig = CONFIG) {
  const gate = new SaveGate({ storage: memoryStorage(), profile: PROFILE });
  const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
  const piggy = new PiggyBankService({ gate, wallet, config });
  await Promise.all([gate.load(), wallet.load(), piggy.load()]);
  gate.open();
  return { gate, wallet, piggy };
}

/** Puts exactly `amount` into the bank (a staged level share, collected). */
function fill(piggy: PiggyBankService, amount: number, key = `k${amount}:${Math.random()}`): void {
  expect(piggy.stage({ key, amount }).ok).toBe(true);
  expect(piggy.collect().ok).toBe(true);
}

const i18n = (locale: string) => new LocalizationRuntime({ rawLocale: locale, supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });

function windowFor(kit: Kit, piggy: PiggyBankService, skin: ReadyUiSkin = READY_UI_STYLE_2, extra: Partial<ConstructorParameters<typeof PiggyBankWindowView>[0]> = {}): PiggyBankWindowView {
  const view = new PiggyBankWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, skin), theme: { skin }, i18n: i18n('en'), bank: piggy, onBuy: () => {}, ...extra });
  view.resize(390, 844);
  return view;
}

function open(kit: Kit, view: PiggyBankWindowView, params: { tutorial?: boolean } = {}): void {
  view.show(params);
  advance(kit.core, 400);
  expect(view.state).toBe('shown');
}

function tap(kit: Kit, target: UiButton): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 400);
}

/** Every visible Text under a container. */
function texts(root: Container): string[] {
  const out: string[] = [];
  const walk = (node: Container & { text?: unknown }): void => {
    if (node.visible === false) return;
    if (typeof node.text === 'string' && node.text !== '') out.push(node.text);
    for (const child of node.children) walk(child as never);
  };
  walk(root as never);
  return out;
}

/** The visible sprite drawing `role` of `skin`. */
function spriteOf(root: Container, skin: ReadyUiSkin, role: string): Sprite | null {
  let found: Sprite | null = null;
  const walk = (node: Container): void => {
    if (node.visible === false || found) return;
    if ((node instanceof Sprite || node instanceof NineSliceSprite) && node.texture.source.label === `${skin.id}:${role}`) found = node as Sprite;
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return found;
}

describe('PiggyBankWindowView — styles', () => {
  it('both styles cover piggyBank with every role it draws, and every file is the committed render', () => {
    for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2] as ReadyUiSkin[]) {
      validateReadyUiSkin(skin);
      expect(skin.covers).toContain('piggyBank');
      const roles = requiredSkinRoles(skin, 'piggyBank');
      for (const role of roles) {
        const asset = skin.assets[`piggyBank:${role}` as ReadyUiSkinAssetKey] ?? skin.assets[role];
        expect(asset?.file, `${skin.id} ${role}`).toBeTruthy();
        expect(existsSync(resolve(rootDir, 'assets/pixi-ui', asset!.file)), asset!.file).toBe(true);
      }
      expect(READY_UI_SKIN_VIEW_ROLES.levelMapScreen).toEqual(expect.arrayContaining(['iconPiggyBank', 'featurePill']));
      expect(skin.assets.iconPiggyBank?.file).toBeTruthy();
      expect(skin.assets.featurePill?.file).toBeTruthy();
    }
    // the frame on the fill only where Figma draws one (Style 1), the tutorial's own glowing pig only there too
    expect(requiredSkinRoles(READY_UI_STYLE_1, 'piggyBank')).toEqual(expect.arrayContaining(['piggyBarFrame', 'piggyTutorialArt']));
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'piggyBank')).not.toContain('piggyBarFrame');
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'piggyBank')).not.toContain('piggyTutorialArt');
    expect(px('piggy/panel.webp')).toEqual([112, 118]);
    expect(px('style2/piggy_pig.webp')).toEqual([856, 684]);
    expect(px('piggy/style1_pig.webp')).toEqual([700, 700]);
    expect(px('style2/piggy_bar_fill.webp')).toEqual([68, 122]);
    expect(px('piggy/style1_bar_fill.webp')).toEqual([104, 89]);
    expect(px('style2/icon_piggy.webp')).toEqual([250, 250]);
    expect(px('level/style1_icon_piggy.webp')).toEqual([250, 250]);
    expect(px('style2/feature_pill.webp')).toEqual([220, 100]);
  });

  it('needs a style: no donor piggy bank', async () => {
    const kit = createKit();
    const { piggy } = await bank();
    expect(() => new PiggyBankWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, bank: piggy, onBuy: () => {} })).toThrow(/covers 'piggyBank'/);
  });
});

describe('PiggyBankWindowView — the bank', () => {
  for (const skin of [READY_UI_STYLE_2, READY_UI_STYLE_1] as ReadyUiSkin[]) {
    it(`${skin.id}: renders the snapshot — empty, partial, purchasable (BUY 900), full`, async () => {
      const kit = createKit();
      const { piggy } = await bank();
      const view = windowFor(kit, piggy, skin);
      const L = skin.windows.piggyBank!;
      open(kit, view);
      // empty: 0 in the bubble, no fill, the grey inert button with the price
      expect(texts(view)).toEqual(expect.arrayContaining(['0', '1500', '3000', 'The piggy bank is ', 'empty', '!', 'BUY', '900']));
      expect(spriteOf(view, skin, 'piggyBarFill')).toBeNull();
      expect(spriteOf(view, skin, 'piggyButtonOff')).not.toBeNull();
      expect(view.controls.buy.enabled).toBe(false);
      expect(view.controls.buy.alpha).toBe(1);
      // the threshold tick sits on 50 % of the fill box
      const marker = spriteOf(view, skin, 'piggyBarMarker')!;
      expect(marker.x + marker.width / 2).toBeCloseTo(L.bar.fill.x + L.bar.fill.width / 2, 5);

      // partial (live: the window follows the bank's changes while it is up)
      fill(piggy, 600);
      expect(texts(view)).toEqual(expect.arrayContaining(['600', 'The piggy bank is ', 'not full', ' yet!', 'Keep collecting coins!']));
      const bar = spriteOf(view, skin, 'piggyBarFill')!;
      expect(bar.width).toBeCloseTo(Math.max(L.bar.fill.fillMin, L.bar.fill.width * 0.2), 5);
      expect(view.controls.buy.enabled).toBe(false);

      // purchasable from the threshold: the green button
      fill(piggy, 900);
      expect(piggy.snapshot().state).toBe('purchasable');
      expect(texts(view)).toEqual(expect.arrayContaining(['1500', 'can be bought']));
      expect(view.controls.buy.enabled).toBe(true);
      expect(spriteOf(view, skin, 'piggyButtonOff')).toBeNull();
      expect(spriteOf(view, skin, 'buttonPrimary') ?? spriteOf(view, skin, 'piggyBank:buttonPrimary')).not.toBeNull();

      // full: the fill spans the bar
      fill(piggy, 1500);
      expect(piggy.snapshot().state).toBe('full');
      expect(texts(view)).toEqual(expect.arrayContaining(['3000', 'full', 'Buy it to collect your coins!']));
      expect(spriteOf(view, skin, 'piggyBarFill')!.width).toBeCloseTo(L.bar.fill.width, 5);
      view.destroy();
    });
  }

  it('BUY closes the window and hands the snapshot over; below the threshold it does nothing', async () => {
    const kit = createKit();
    const { piggy } = await bank();
    const bought: PiggyBankSnapshot[] = [];
    const view = windowFor(kit, piggy, READY_UI_STYLE_2, { onBuy: (snapshot) => bought.push(snapshot) });
    fill(piggy, 1000);
    open(kit, view);
    tap(kit, view.controls.buy);
    expect(view.state).toBe('shown');
    expect(bought).toEqual([]);
    fill(piggy, 500);
    tap(kit, view.controls.buy);
    expect(view.state).toBe('hidden');
    expect(bought.map((b) => [b.balance, b.state, b.price])).toEqual([[1500, 'purchasable', { kind: 'wallet', amount: 900 }]]);
  });

  it('a level not for sale or a closed gate shows the grey button; a product price shows the host label without a coin', async () => {
    const kit = createKit();
    const forSale = await bank({ ...CONFIG, levels: [{ capacity: 3000, price: null }] });
    fill(forSale.piggy, 2000);
    const view = windowFor(kit, forSale.piggy);
    open(kit, view);
    expect(view.controls.buy.enabled).toBe(false);
    expect(texts(view)).not.toContain('900');

    const kit2 = createKit();
    const product = await bank({ ...CONFIG, levels: [{ capacity: 3000, price: { kind: 'product', productId: 'piggy_1' } }] });
    fill(product.piggy, 2000);
    const view2 = windowFor(kit2, product.piggy, READY_UI_STYLE_2, { productPrice: (id) => (id === 'piggy_1' ? '99 ₽' : null) });
    open(kit2, view2);
    expect(view2.controls.buy.enabled).toBe(true);
    expect(texts(view2)).toContain('99 ₽');
    expect((view2['priceCoin'] as Sprite).visible).toBe(false);
  });

  it('× and the backdrop dismiss; the change listener goes with the window', async () => {
    const kit = createKit();
    const { piggy } = await bank();
    const dismissed: string[] = [];
    const view = windowFor(kit, piggy, READY_UI_STYLE_2, { onDismiss: (reason) => dismissed.push(reason) });
    open(kit, view);
    view['backdrop'].emit('pointertap', { target: view['backdrop'] } as never);
    advance(kit.core, 400);
    expect(view.state).toBe('hidden');
    expect(dismissed).toEqual(['background']);
    // hidden: no re-render on changes (the listener was removed)
    const before = texts(view).join('|');
    fill(piggy, 700);
    expect(texts(view).join('|')).toBe(before);
    open(kit, view);
    tap(kit, view.controls.close!);
    expect(dismissed).toEqual(['background', 'button']);
  });
});

describe('PiggyBankWindowView — the tutorial', () => {
  for (const skin of [READY_UI_STYLE_2, READY_UI_STYLE_1] as ReadyUiSkin[]) {
    it(`${skin.id}: info opens the tutorial with this level's threshold; a tap anywhere returns to the bank`, async () => {
      const kit = createKit();
      const { piggy } = await bank();
      const view = windowFor(kit, piggy, skin);
      open(kit, view);
      expect(view.screen).toBe('bank');
      tap(kit, view.controls.info);
      expect(view.screen).toBe('tutorial');
      expect(view.controls.close?.visible).toBe(false);
      expect(texts(view)).toEqual(['Buy the PIG BANK when you have 1500 coins!', 'Tap to continue']);
      expect(spriteOf(view, skin, skin.windows.piggyBank!.tutorial.hero.ownArt ? 'piggyTutorialArt' : 'piggyArt')).not.toBeNull();
      // the backdrop on the tutorial: back to the bank, the window stays
      view['backdrop'].emit('pointertap', { target: view['backdrop'] } as never);
      expect(view.state).toBe('shown');
      expect(view.screen).toBe('bank');
      expect(view.controls.close?.visible).toBe(true);
      view.destroy();
    });
  }

  it('opens on the tutorial when asked (the first open) and goes on to the bank on a tap', async () => {
    const kit = createKit();
    const { piggy } = await bank();
    const view = windowFor(kit, piggy);
    open(kit, view, { tutorial: true });
    expect(view.screen).toBe('tutorial');
    const catcher = view['tutorialScreen'].children.at(-1) as Container;
    catcher.emit('pointertap', pointer(1, 1) as never);
    expect(view.screen).toBe('bank');
    tap(kit, view.controls.buy);
    expect(view.state).toBe('shown');
  });
});

describe('PiggyBankWindowView — copy and motion', () => {
  it('RU: the style\'s title picture for exactly its lines, RU state copy; EN: the runtime title lines', async () => {
    const kit = createKit();
    const { piggy } = await bank();
    fill(piggy, 600);
    const ru = windowFor(kit, piggy, READY_UI_STYLE_2, { i18n: i18n('ru') });
    open(kit, ru);
    expect(spriteOf(ru, READY_UI_STYLE_2, 'piggyTitle')).not.toBeNull();
    expect(texts(ru)).toEqual(expect.arrayContaining(['Копилка еще ', 'не полная', '!', 'Продолжайте копить монеты!', 'КУПИТЬ', '900']));
    expect(texts(ru)).not.toContain('СВИНКА');
    const kit2 = createKit();
    const en = windowFor(kit2, piggy, READY_UI_STYLE_1);
    open(kit2, en);
    expect(spriteOf(en, READY_UI_STYLE_1, 'piggyTitle')).toBeNull();
    expect(texts(en)).toEqual(expect.arrayContaining(['PIGGY', 'BANK']));
  });

  it('the decor runs on the MotionRuntime while the window is up and stops on hidden', async () => {
    const kit = createKit();
    const { piggy } = await bank();
    const view = windowFor(kit, piggy);
    open(kit, view);
    const burst = view['burst'] as { rays: Sprite } | null;
    expect(burst).not.toBeNull();
    const before = burst!.rays.rotation;
    advance(kit.core, 2000);
    expect(burst!.rays.rotation).not.toBe(before);
    view.close('button');
    advance(kit.core, 400);
    expect(view.state).toBe('hidden');
    const rest = burst!.rays.rotation;
    advance(kit.core, 2000);
    expect(burst!.rays.rotation).toBe(rest);
  });
});
