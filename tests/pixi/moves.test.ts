import { describe, expect, it } from 'vitest';
import { Container, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer } from './setup';
import { LocalizationRuntime } from '../../src/localization';
import * as pixiEntry from '../../src/pixi/index';
import { READY_UI_CATALOGS } from '../../src/pixi';
import { HudView } from '../../src/pixi/HudView';
import { MovesView } from '../../src/pixi/MovesView';
import { SettingsButtonView } from '../../src/pixi/SettingsButtonView';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { requiredSkinRoles, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinRole, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const rootDir = resolve(__dirname, '../..');
const labelled = (label: string, width = 2, height = 2): Texture => new Texture({ source: new TextureSource({ width, height, label }) });

/** The required pack plus the style's role textures as loadReadyUiAssets({ skin }) files them. */
function styled(kit: Kit, skin: ReadyUiSkin): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinRole[]) roles[role] = labelled(`${skin.id}:${role}`);
  return { ...required, hudGear: labelled('donor:hudGear'), hudGearBack: labelled('donor:hudGearBack'), skins: { [skin.id]: roles } };
}

const texts = (root: Container): Text[] => {
  const out: Text[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children as Container[]) {
      if (child instanceof Text) out.push(child);
      else visit(child);
    }
  };
  visit(root);
  return out;
};

describe('MovesView — the generic moves counter', () => {
  for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2] as const) {
    it(`${skin.id}: covered, one role (movesPanel), its file shipped`, () => {
      expect(skin.covers).toContain('moves');
      expect(requiredSkinRoles(skin, 'moves')).toEqual(['movesPanel']);
      expect(() => validateReadyUiSkin(skin)).not.toThrow();
      expect(existsSync(resolve(rootDir, 'assets/pixi-ui', skin.assets.movesPanel.file))).toBe(true);
    });

    it(`${skin.id}: draws the style's box with the caption and the runtime number at the layout boxes; origin = box centre`, () => {
      const kit = createKit();
      const L = skin.moves;
      const view = new MovesView({ textures: styled(kit, skin), theme: { skin }, remaining: 38 });
      expect(view.skin).toBe(skin);
      expect([view.boxWidth, view.boxHeight]).toEqual([L.box.width, L.box.height]);
      const panel = view.children.find((child) => child instanceof Sprite) as Sprite;
      expect(panel.texture.source.label).toBe(`${skin.id}:movesPanel`);
      expect([panel.x, panel.y, panel.width, panel.height]).toEqual([L.panel.x - L.box.width / 2, L.panel.y - L.box.height / 2, L.panel.width, L.panel.height]);
      const [caption, count] = texts(view);
      expect(caption!.text).toBe('MOVES');
      expect(count!.text).toBe('38');
      expect(caption!.style.fontSize).toBe(L.label.fontSize);
      expect(count!.style.fontSize).toBe(L.count.fontSize);
      if (L.count.fill !== undefined) expect(count!.style.fill).toBe(L.count.fill);
      // the declared box, never the shadow or the text: what a host lays the view out by
      const bounds = view.getLocalBounds();
      expect([bounds.x, bounds.y, bounds.width, bounds.height]).toEqual([-L.box.width / 2, -L.box.height / 2, L.box.width, L.box.height]);
      expect(view.eventMode).toBe('none');
    });
  }

  it('setRemaining: 38 / 10 / 1 / 0, whole numbers only; a long number shrinks into its box, never past it', () => {
    const kit = createKit();
    const skin = READY_UI_STYLE_2;
    const view = new MovesView({ textures: styled(kit, skin), theme: { skin } });
    const count = (): Text => texts(view)[1]!;
    expect(view.remaining).toBe(0);
    expect(count().text).toBe('0');
    for (const value of [38, 10, 1, 0]) {
      view.setRemaining(value);
      expect(view.remaining).toBe(value);
      expect(count().text).toBe(String(value));
    }
    view.setRemaining(7.9);
    expect(count().text).toBe('7');
    view.setRemaining(-3);
    expect(count().text).toBe('0');
    view.setRemaining(Number.NaN);
    expect(count().text).toBe('0');
    view.setRemaining(123456789);
    expect(count().scale.x).toBeLessThan(1);
    expect(count().width).toBeLessThanOrEqual(skin.moves.count.width + 0.001);
    view.setRemaining(5);
    expect(count().scale.x).toBe(1);
  });

  it('show / hide: visibility only; `hidden` starts it hidden', () => {
    const kit = createKit();
    const view = new MovesView({ textures: styled(kit, READY_UI_STYLE_1), theme: { skin: READY_UI_STYLE_1 }, hidden: true });
    expect(view.shown).toBe(false);
    view.show();
    expect([view.shown, view.visible]).toEqual([true, true]);
    view.hide();
    expect([view.shown, view.visible]).toEqual([false, false]);
  });

  it('caption: explicit text wins, then the provider (RU ХОДЫ), then MOVES', () => {
    const kit = createKit();
    const ru = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const base = { textures: styled(kit, READY_UI_STYLE_2), theme: { skin: READY_UI_STYLE_2 } };
    expect(texts(new MovesView({ ...base, i18n: ru }))[0]!.text).toBe('ХОДЫ');
    expect(texts(new MovesView({ ...base, i18n: ru, label: 'STEPS' }))[0]!.text).toBe('STEPS');
    expect(texts(new MovesView(base))[0]!.text).toBe('MOVES');
  });

  it('needs a style that covers moves (no donor art); a missing texture fails clearly; it is exported', () => {
    const kit = createKit();
    expect(() => new MovesView({ textures: kit.textures })).toThrow("MovesView needs a Ready UI style that covers 'moves'");
    const textures = styled(kit, READY_UI_STYLE_2);
    delete (textures.skins!['style-2'] as Record<string, Texture>).movesPanel;
    expect(() => new MovesView({ textures, theme: { skin: READY_UI_STYLE_2 } })).toThrow(`MovesView style 'style-2': no movesPanel (${READY_UI_STYLE_2.assets.movesPanel.file}) in textures`);
    expect(pixiEntry).toHaveProperty('MovesView');
  });
});

describe('SettingsButtonView — the gameplay settings button', () => {
  for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2] as const) {
    it(`${skin.id}: covered (back + icon roles); the style's back and icon at its layout, in the top-right safe corner by its margins`, () => {
      const kit = createKit();
      const L = skin.settingsButton;
      expect(skin.covers).toContain('settingsButton');
      expect(requiredSkinRoles(skin, 'settingsButton')).toEqual(['settingsButtonBack', 'settingsButtonIcon']);
      for (const role of ['settingsButtonBack', 'settingsButtonIcon'] as const) expect(existsSync(resolve(rootDir, 'assets/pixi-ui', skin.assets[role].file)), role).toBe(true);
      const view = new SettingsButtonView({ ui: kit.ui, textures: styled(kit, skin), theme: { skin }, onTap: () => {} });
      expect(view.skin).toBe(skin);
      expect(view.button.background.texture.source.label).toBe(`${skin.id}:settingsButtonBack`);
      expect(view.button.icon!.texture.source.label).toBe(`${skin.id}:settingsButtonIcon`);
      expect([view.button.background.width, view.button.background.height]).toEqual([L.back.width, L.back.height]);
      expect([view.button.icon!.x, view.button.icon!.y]).toEqual([L.icon.x + L.icon.width / 2 - L.back.width / 2, L.icon.y + L.icon.height / 2 - L.back.height / 2]);
      view.resize(1280, 800, { insets: { top: 20, right: 30 } });
      const s = Math.min(1280 / 1080, 800 / 2344);
      expect(view.button.x).toBeCloseTo(1280 - 30 - (L.margins.right + L.back.width / 2) * s, 6);
      expect(view.button.y).toBeCloseTo(20 + (L.margins.top + L.back.height / 2) * s, 6);
      expect(view.button.scale.x).toBeCloseTo(s, 6);
      view.destroy();
    });
  }

  it('theme_light_6 numbers: 214 at 90 / 90; Style 1 lifts the gear 10 above the centre, Style 2 centres it', () => {
    expect(READY_UI_STYLE_2.settingsButton).toEqual({ back: { width: 214, height: 214 }, icon: { x: 28, y: 28, width: 158, height: 158 }, margins: { top: 90, right: 90 }, minHitSize: 214 });
    expect(READY_UI_STYLE_1.settingsButton.icon.y).toBe(18);
    expect(READY_UI_STYLE_1.settingsButton.margins).toEqual({ top: 90, right: 90 });
  });

  it('the map HUD is untouched: Style 2 still draws no gear, Style 1 keeps its HUD gear art', () => {
    expect(READY_UI_STYLE_2.hud.gear).toBeNull();
    expect(requiredSkinRoles(READY_UI_STYLE_2, 'hud')).not.toContain('hudGear');
    expect(READY_UI_STYLE_1.assets.hudGear.file).toBe('hud/gear.webp');
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_2), theme: { skin: READY_UI_STYLE_2 } });
    expect((hud as unknown as { gear: UiButton | null }).gear).toBeNull();
    hud.destroy();
  });

  it('the tap is the host\'s; no onTap = drawn but inert; no style = the donor HUD gear; insets.top moves it under a host row', () => {
    const kit = createKit();
    const taps: string[] = [];
    const view = new SettingsButtonView({ ui: kit.ui, textures: styled(kit, READY_UI_STYLE_2), theme: { skin: READY_UI_STYLE_2 }, onTap: () => taps.push('tap') });
    view.button.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 80);
    view.button.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 400);
    expect(taps).toEqual(['tap']);
    const inert = new SettingsButtonView({ ui: kit.ui, id: 'inert', textures: styled(kit, READY_UI_STYLE_2), theme: { skin: READY_UI_STYLE_2 } });
    expect(inert.button.controller.enabled).toBe(false);
    const donor = new SettingsButtonView({ ui: kit.ui, id: 'donor', textures: styled(kit, READY_UI_STYLE_1) });
    expect(donor.skin).toBeNull();
    expect(donor.button.background.texture.source.label).toBe('donor:hudGearBack');
    expect(donor.button.icon!.texture.source.label).toBe('donor:hudGear');
    view.resize(390, 844);
    const y0 = view.button.y;
    view.resize(390, 844, { insets: { top: 120 } });
    expect(view.button.y).toBeCloseTo(y0 + 120, 6);
    const textures = styled(kit, READY_UI_STYLE_2);
    delete (textures.skins!['style-2'] as Record<string, Texture>).settingsButtonIcon;
    expect(() => new SettingsButtonView({ ui: kit.ui, id: 'broken', textures, theme: { skin: READY_UI_STYLE_2 } })).toThrow("SettingsButtonView style 'style-2': no settingsButtonIcon (style2/icon_settings.webp) in textures");
    expect(pixiEntry).toHaveProperty('SettingsButtonView');
  });
});
