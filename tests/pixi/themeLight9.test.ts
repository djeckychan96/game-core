import { describe, expect, it } from 'vitest';
import { NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer } from './setup';
import { LevelMapScreen } from '../../src/pixi/LevelMapScreen';
import { MovesView } from '../../src/pixi/MovesView';
import { NoAdsWindowView, type NoAdsWindowParams } from '../../src/pixi/NoAdsWindowView';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_SKIN_VIEW_ROLES, requiredSkinRoles, resolveSkinView, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const S1 = READY_UI_STYLE_1;
const S2 = READY_UI_STYLE_2;
const rootDir = resolve(__dirname, '../..');
const FEATURE_ROLES = ['iconNoAds', 'featureGlow', 'featureSpark'] as const;
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

/** The required pack only, plus the style's role textures (by asset key) as loadReadyUiAssets({ skin }) files them. */
function styled(kit: Kit, skin: ReadyUiSkin): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  const roles: ReadyUiSkinTextures = {};
  for (const key of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[key] = labelled(`${skin.id}:${key}`);
  return { ...required, skins: { [skin.id]: roles } };
}

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

/** A lossless WebP's pixel size (VP8L header). */
function px(file: string): number[] {
  const b = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
  expect(b.toString('ascii', 12, 16), file).toBe('VP8L');
  const bits = b.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

function tap(kit: Kit, target: UiButton): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 400);
}

describe('theme_light_9 Style 2 MOVES tab — MovesView with a stretchable 9-slice panel', () => {
  const panelOf = (view: MovesView): NineSliceSprite => view.children[0] as NineSliceSprite;
  const box = (panel: NineSliceSprite) => [panel.x - panel.anchor.x * panel.width, panel.y - panel.anchor.y * panel.height, panel.width, panel.height];

  it('Style 2: the orange tab 50:26381 (250 × 310) is a 9-slice; the texts at moves_txt 50:28930', () => {
    expect(S2.assets.movesPanel.file).toBe('style2/moves_tab.webp');
    expect(px(S2.assets.movesPanel.file)).toEqual([250, 310]);
    expect(S2.assets.movesPanel.nineSlice).toEqual({ left: 36, top: 36, right: 36, bottom: 40 });
    expect(S2.moves).toEqual({
      box: { width: 250, height: 310 },
      panel: { x: 0, y: 0, width: 250, height: 310 },
      label: { x: 20, y: 20, width: 200, height: 60, fontSize: 50, fill: 0xffffff },
      count: { x: 20, y: 80, width: 200, height: 140, fontSize: 150, fill: 0xffffff }
    });
    const kit = createKit();
    const view = new MovesView({ textures: styled(kit, S2), theme: { skin: S2 }, remaining: 38 });
    expect(view.panelStretches).toBe(true);
    const panel = panelOf(view);
    expect(panel).toBeInstanceOf(NineSliceSprite);
    expect([panel.leftWidth, panel.topHeight, panel.rightWidth, panel.bottomHeight]).toEqual([36, 36, 36, 40]);
    expect(box(panel)).toEqual([-125, -155, 250, 310]);
    expect(view.panelBottom).toBe(155);
  });

  it('stretchPanel: only the panel reaches down (top fixed, never shorter than the layout); null = the layout height', () => {
    const kit = createKit();
    const view = new MovesView({ textures: styled(kit, S2), theme: { skin: S2 }, remaining: 7 });
    const panel = panelOf(view);
    const [caption, count] = view.children.filter((child) => child instanceof Text) as Text[];
    const before = { caption: [caption!.x, caption!.y], count: [count!.x, count!.y], bounds: view.getLocalBounds() };
    view.stretchPanel(600);
    expect(box(panel)).toEqual([-125, -155, 250, 755]);
    expect(view.panelBottom).toBe(600);
    // the box, the texts and the layout bounds keep their place
    expect([caption!.x, caption!.y]).toEqual(before.caption);
    expect([count!.x, count!.y]).toEqual(before.count);
    const bounds = view.getLocalBounds();
    expect([bounds.x, bounds.y, bounds.width, bounds.height]).toEqual([before.bounds.x, before.bounds.y, before.bounds.width, before.bounds.height]);
    // never shorter than the layout's panel
    view.stretchPanel(0);
    expect(box(panel)).toEqual([-125, -155, 250, 310]);
    view.stretchPanel(400);
    view.stretchPanel(null);
    expect(box(panel)).toEqual([-125, -155, 250, 310]);
    view.stretchPanel(Number.NaN);
    expect(view.panelBottom).toBe(155);
  });

  it('Style 1: a plain render panel keeps its size (stretching would distort it)', () => {
    const kit = createKit();
    const view = new MovesView({ textures: styled(kit, S1), theme: { skin: S1 } });
    expect((S1.assets.movesPanel as { nineSlice?: unknown }).nineSlice).toBeUndefined();
    expect(view.panelStretches).toBe(false);
    const panel = view.children[0] as Sprite;
    expect(panel).toBeInstanceOf(Sprite);
    const before = [panel.x, panel.y, panel.width, panel.height];
    view.stretchPanel(900);
    expect([panel.x, panel.y, panel.width, panel.height]).toEqual(before);
    expect(view.panelBottom).toBe(S1.moves.box.height / 2);
  });
});

describe('theme_light_9 gameplay row and feature column — host art', () => {
  it('Style 2 row art: the booster diamond, the grey slot 240; the superseded theme_light_6 / 8 files are gone', () => {
    expect(S2.assets.boosterBack.file).toBe('style2/booster_diamond.webp');
    expect(S2.assets.lockedSlotBack.file).toBe('style2/locked_slot.webp');
    for (const gone of ['style2/booster_back.webp', 'style2/moves_panel.webp']) expect(existsSync(resolve(rootDir, 'assets/pixi-ui', gone)), gone).toBe(false);
  });

  it('the feature column roles are optional levelMapScreen roles: LevelMapScreen requires PLAY + its icons only', () => {
    expect(READY_UI_SKIN_VIEW_ROLES.levelMapScreen).toEqual([
      'playButton', 'iconShop', 'iconHome', 'iconNoAds', 'iconQuests', 'iconPiggyBank', 'featureGlow', 'featureSpark', 'featurePill',
      'iconPiggyBankCoin', 'iconPiggyBankPig', 'iconPiggyBankSpark'
    ]);
    for (const skin of [S1, S2]) expect(requiredSkinRoles(skin, 'levelMapScreen')).toEqual(['playButton', 'iconShop', 'iconHome']);
    const assets = Object.fromEntries(Object.entries(S2.assets).filter(([key]) => !(FEATURE_ROLES as readonly string[]).includes(key)));
    const bare = { ...S2, id: 'style-2-bare', assets } as ReadyUiSkin;
    expect(() => validateReadyUiSkin(bare)).not.toThrow();
    const kit = createKit();
    const screen = new LevelMapScreen({ ui: kit.ui, motion: kit.motion, textures: styled(kit, bare), theme: { skin: bare }, map: { levels: 10, currentLevel: 2 }, onPlay: () => {}, width: 390, height: 844 });
    expect(screen.map.levelCount).toBe(10);
    screen.destroy({ children: true });
  });

  it('both styles ship them (Figma renders, 1 px / unit); a host reads them from textures.skins by role', () => {
    // Style 2: icon_no_ads 250 (its image 2 above the box), blur_bg_3 render 384 × 273, pic_spark_1 190
    expect(FEATURE_ROLES.map((role) => px(S2.assets[role].file))).toEqual([[250, 252], [384, 274], [190, 190]]);
    // Style 1: the dark icon_no_ads 250, blur_bg_dark_3 render, pic_spark_2 42
    expect(FEATURE_ROLES.map((role) => px(S1.assets[role].file))).toEqual([[250, 250], [384, 274], [42, 42]]);
    for (const role of FEATURE_ROLES) expect(S1.assets[role].file, role).not.toBe(S2.assets[role].file);
    for (const skin of [S1, S2]) {
      const kit = createKit();
      const textures = styled(kit, skin);
      const look = resolveSkinView('host', 'levelMapScreen', skin, textures);
      for (const role of FEATURE_ROLES) expect(look.art[role]?.source.label).toBe(`${skin.id}:${role}`);
    }
  });
});

describe('NoAdsWindowView enabled / dimDisabled — an offer shown but not for sale', () => {
  function open(kit: Kit, view: NoAdsWindowView, params: NoAdsWindowParams): NoAdsWindowView {
    view.resize(390, 844);
    view.show(params);
    advance(kit.core, 600);
    return view;
  }
  const cases: Array<[string, ReadyUiSkin | null]> = [['donor', null], ['style-1', S1], ['style-2', S2]];

  for (const [name, skin] of cases) {
    it(`${name}: enabled false = the button stays, a tap neither closes nor buys; × still dismisses; the next show re-enables`, () => {
      const kit = createKit();
      const log: string[] = [];
      const view = new NoAdsWindowView({
        ui: kit.ui, motion: kit.motion, textures: skin ? styled(kit, skin) : kit.textures, id: `noads-${name}`, ...(skin ? { theme: { skin } } : {}),
        onBuy: (p) => log.push(`buy:${p.price}`), onDismiss: (r) => log.push(`dismiss:${r}`)
      });
      open(kit, view, { price: '900', coinPrice: true, enabled: false });
      const buy = field<UiButton>(view, 'buyButton');
      expect(buy.visible).toBe(true);
      expect(buy.alpha).toBe(0.55);
      tap(kit, buy);
      expect(log).toEqual([]);
      expect(view.state).toBe('shown');
      // full colours on request
      view.close('programmatic', () => {});
      advance(kit.core, 600);
      open(kit, view, { price: '900', enabled: false, dimDisabled: false });
      expect(buy.alpha).toBe(1);
      tap(kit, buy);
      expect(log).toEqual([]);
      tap(kit, field<UiButton>(view, 'closeButton'));
      expect(log).toEqual(['dismiss:button']);
      // omitted = for sale, as before
      open(kit, view, { price: '900' });
      expect(buy.alpha).toBe(1);
      tap(kit, buy);
      advance(kit.core, 400);
      expect(log).toEqual(['dismiss:button', 'buy:900']);
      expect(view.state).toBe('hidden');
      view.destroy();
    });
  }
});

describe('theme_light_9 recipe', () => {
  it('docs/figma/theme-light-9 names every new file and its Figma node', () => {
    const spec = JSON.parse(readFileSync(resolve(rootDir, 'docs/figma/theme-light-9/figma.json'), 'utf8')) as { source: { section: string }; assets: Array<{ file: string; layers: Array<{ image: string }> }> };
    expect(spec.source.section).toBe('50:25954');
    const files = spec.assets.map((a) => a.file).sort();
    expect(files).toEqual([
      S1.assets.featureGlow.file, S1.assets.featureSpark.file, S1.assets.iconNoAds.file,
      S2.assets.boosterBack.file, S2.assets.featureGlow.file, S2.assets.featureSpark.file, S2.assets.iconNoAds.file, S2.assets.lockedSlotBack.file, S2.assets.movesPanel.file
    ].sort());
    for (const asset of spec.assets) {
      expect(existsSync(resolve(rootDir, 'assets/pixi-ui', asset.file)), asset.file).toBe(true);
      for (const layer of asset.layers) expect(existsSync(resolve(rootDir, 'docs/figma/theme-light-9', layer.image)), layer.image).toBe(true);
    }
  });
});

