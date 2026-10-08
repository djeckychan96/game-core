import { describe, expect, it, vi } from 'vitest';
import { Assets, Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer } from './setup';
import * as pixiEntry from '../../src/pixi/index';
import { ConfirmWindowView, type ConfirmWindowViewOptions } from '../../src/pixi/ConfirmWindowView';
import { LivesWindowView, type LivesWindowParams, type LivesWindowViewOptions } from '../../src/pixi/LivesWindowView';
import { SettingsWindowView, type SettingsWindowParams, type SettingsWindowViewOptions } from '../../src/pixi/SettingsWindowView';
import { READY_UI_NINE_SLICES, READY_UI_OPTIONAL_ASSET_FILES, loadReadyUiAssets, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { READY_UI_SKIN_VIEW_ROLES, READY_UI_SKIN_WINDOW_ROLES, requiredSkinRoles, type ReadyUiSkin, type ReadyUiSkinRole, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1, STYLE_1_INCLUDE_NAMES } from '../../src/pixi/skins/style1';
import { resolveTheme } from '../../src/pixi/theme';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const LIVES: LivesWindowParams = { lives: 3, maxLives: 5, timerText: '17:42', refillPrice: 900 };
const ROLES = Object.keys(READY_UI_STYLE_1.assets) as ReadyUiSkinRole[];

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

function tap(target: UiButton, kit: Kit): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
}

const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

/** The required pack only: no optional kit texture, so nothing can come from the pre-style `include` path. */
function requiredOnly(kit: Kit): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  return required;
}

/** One labelled texture per role of `skin`, as loadReadyUiAssets({ skin }) files them. */
function roleTextures(skin: ReadyUiSkin): ReadyUiSkinTextures {
  const out: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinRole[]) out[role] = labelled(`${skin.id}:${role}`);
  return out;
}

function styled(kit: Kit, skin: ReadyUiSkin, roles = roleTextures(skin)): ReadyUiTextures {
  return { ...requiredOnly(kit), skins: { [skin.id]: roles } };
}

/** The pre-style path with the very same Texture objects: Style 1's files under their kit names (`include`). */
function included(kit: Kit, roles: ReadyUiSkinTextures): ReadyUiTextures {
  const out: ReadyUiTextures = { ...requiredOnly(kit) };
  const names = STYLE_1_INCLUDE_NAMES as Partial<Record<ReadyUiSkinRole, ReadyUiOptionalTextureName>>;
  for (const role of ROLES) {
    const texture = roles[role];
    const name = names[role];
    if (texture && name) out[name] = texture;
  }
  return out;
}

/** Every drawn node of the panel, depth first: kind, texture, geometry, caps, text — what the frame is made of. */
function scene(root: Container): unknown[] {
  const out: unknown[] = [];
  const visit = (node: Container, depth: number): void => {
    for (const child of node.children as Container[]) {
      const entry: Record<string, unknown> = { depth, kind: child.constructor.name, x: child.x, y: child.y, scale: [child.scale.x, child.scale.y], visible: child.visible, eventMode: child.eventMode };
      if (child instanceof NineSliceSprite) Object.assign(entry, { texture: child.texture.source.label, w: child.width, h: child.height, caps: [child.leftWidth, child.topHeight, child.rightWidth, child.bottomHeight] });
      else if (child instanceof Sprite) Object.assign(entry, { texture: child.texture.source.label, w: child.width, h: child.height });
      if (child instanceof Text) Object.assign(entry, { text: child.text, size: child.style.fontSize, stroke: (child.style.stroke as { width?: number } | null | undefined)?.width ?? null, shadow: child.style.dropShadow ? child.style.dropShadow.distance : null });
      out.push(entry);
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function frame(view: ConfirmWindowView | LivesWindowView): { scene: unknown[]; fitScale: number; backdrop: [number, number]; hitArea: unknown } {
  const panel = field<Container>(view, 'panel');
  return { scene: scene(panel), fitScale: field<number>(view, 'fitScale'), backdrop: [field<number>(view, 'backdropColor'), field<number>(view, 'backdropAlpha')], hitArea: panel.hitArea };
}

function confirm(kit: Kit, textures: ReadyUiTextures, extra: Partial<ConfirmWindowViewOptions> = {}, log: string[] = []): ConfirmWindowView {
  return new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures, id: 'exit-confirm', onConfirm: () => log.push('confirm'), onDismiss: (r) => log.push(`dismiss:${r}`), ...extra });
}

function lives(kit: Kit, textures: ReadyUiTextures, extra: Partial<LivesWindowViewOptions> = {}, log: string[] = []): LivesWindowView {
  return new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures, id: 'lives',
    onRefill: (p) => log.push(`refill:${p.lives}`), onWatchAd: (p) => log.push(`ad:${p.lives}`), onDismiss: (r) => log.push(`dismiss:${r}`), ...extra });
}

function settings(kit: Kit, textures: ReadyUiTextures, extra: Partial<SettingsWindowViewOptions> = {}, log: string[] = []): SettingsWindowView {
  return new SettingsWindowView({
    ui: kit.ui, motion: kit.motion, textures, id: 'settings', onToggle: (setting, enabled) => log.push(`${setting}:${enabled}`),
    onHome: () => log.push('home'), onRestart: () => log.push('restart'), ...extra
  });
}

function shownSettings(kit: Kit, view: SettingsWindowView, params: SettingsWindowParams): SettingsWindowView {
  view.show(params);
  advance(kit.core, 400);
  return view;
}

function shown<T extends ConfirmWindowView | LivesWindowView>(kit: Kit, view: T): T {
  if (view instanceof LivesWindowView) view.show({ ...LIVES });
  else view.show();
  advance(kit.core, 400);
  return view;
}

/** A copy of Style 1 under another id (and optionally other files / layout / caps): a second style package. */
function restyle(id: string, change: (skin: { -readonly [K in keyof ReadyUiSkin]: ReadyUiSkin[K] }) => void = () => {}): ReadyUiSkin {
  const skin = JSON.parse(JSON.stringify(READY_UI_STYLE_1)) as { -readonly [K in keyof ReadyUiSkin]: ReadyUiSkin[K] };
  skin.id = id;
  change(skin);
  return skin;
}

describe('UI Skin V1 — Style 1 is a data package for Confirm, Lives, Settings, HUD, LevelMap and Result', () => {
  it('is exported from game-core/pixi: Style 1, the catalog and the per-window roles; the package states its coverage', () => {
    expect(pixiEntry.READY_UI_STYLE_1).toBe(READY_UI_STYLE_1);
    expect(pixiEntry.READY_UI_SKINS['style-1']).toBe(READY_UI_STYLE_1);
    expect(pixiEntry.READY_UI_SKIN_WINDOW_ROLES).toBe(READY_UI_SKIN_WINDOW_ROLES);
    expect(pixiEntry.READY_UI_SKIN_VIEW_ROLES).toBe(READY_UI_SKIN_VIEW_ROLES);
    expect(READY_UI_STYLE_1.id).toBe('style-1');
    expect(READY_UI_STYLE_1.covers).toEqual(['confirm', 'lives', 'settings', 'hud', 'levelMap', 'result', 'bottomNav', 'levelMapScreen', 'moves', 'settingsButton', 'noAds']);
    expect(Object.keys(READY_UI_STYLE_1.windows).sort()).toEqual(['confirm', 'lives', 'noAds', 'offer', 'result', 'settings']);
    expect('hud' in READY_UI_STYLE_1).toBe(true);
    expect('levelMap' in READY_UI_STYLE_1).toBe(true);
    expect('bottomNav' in READY_UI_STYLE_1).toBe(true);
    expect('levelMapScreen' in READY_UI_STYLE_1).toBe(true);
    // the roles Style 1 ships = the roles its covered views' layouts draw (requiredSkinRoles)
    expect(ROLES.sort()).toEqual([...new Set(READY_UI_STYLE_1.covers.flatMap((view) => requiredSkinRoles(READY_UI_STYLE_1, view)))].sort());
    // one dense column (the language row included; the rows a show does not draw close up)
    expect(READY_UI_STYLE_1.windows.settings.map.window).toEqual({ width: 960, height: 907 });
    expect(READY_UI_STYLE_1.windows.settings.gameplay.window).toEqual({ width: 960, height: 1371 });
  });

  it('owns the files and caps: the pre-style kit names (READY_UI_OPTIONAL_ASSET_FILES / READY_UI_NINE_SLICES) are the same values', () => {
    for (const [role, name] of Object.entries(STYLE_1_INCLUDE_NAMES) as Array<[ReadyUiSkinRole, ReadyUiOptionalTextureName]>) {
      expect(READY_UI_OPTIONAL_ASSET_FILES[name], role).toBe((READY_UI_STYLE_1.assets as ReadyUiSkin['assets'])[role]?.file);
    }
    expect(READY_UI_NINE_SLICES).toEqual({
      windowBase: READY_UI_STYLE_1.assets.windowSurface.nineSlice,
      buttonGreen: READY_UI_STYLE_1.assets.buttonPrimary.nineSlice,
      buttonOrange: READY_UI_STYLE_1.assets.buttonRewarded.nineSlice,
      panelInset: READY_UI_STYLE_1.assets.panelInset.nineSlice
    });
  });

  it('resolveTheme carries the style; no overrides is still the default theme object', () => {
    expect(resolveTheme({ skin: READY_UI_STYLE_1 }).skin).toBe(READY_UI_STYLE_1);
    expect('skin' in resolveTheme({ text: { fontFamily: 'X' } })).toBe(false);
    expect(resolveTheme()).toBe(pixiEntry.DEFAULT_READY_UI_THEME);
  });
});

describe('UI Skin V1 — choosing a style once in the game config', () => {
  it('1. one chosen Style 1 draws Confirm AND Lives (no per-window variant): the accepted Figma frame, same actions', () => {
    const kit = createKit();
    const roles = roleTextures(READY_UI_STYLE_1);
    // the game's Ready UI config: the one place the style is chosen
    const readyUi = { ui: kit.ui, motion: kit.motion, textures: styled(kit, READY_UI_STYLE_1, roles), theme: { skin: READY_UI_STYLE_1 } };
    const log: string[] = [];
    const exit = shown(kit, new ConfirmWindowView({ ...readyUi, id: 'exit-confirm', onConfirm: () => log.push('confirm'), onDismiss: (r) => log.push(`dismiss:${r}`) }));
    expect(exit.variant).toBe('figma');
    expect(exit.skin).toBe(READY_UI_STYLE_1);
    expect(field<NineSliceSprite>(exit, 'surface').texture).toBe(roles.windowSurface);
    expect(field<Sprite>(exit, 'heart').texture).toBe(roles.lifeLostArt);

    // the frame is the accepted `variant: 'figma'` one, layer by layer (same textures, the pre-style include path)
    const kit2 = createKit();
    const accepted = shown(kit2, confirm(kit2, included(kit2, roles), { variant: 'figma' }));
    expect(frame(exit).scene.length).toBe(11); // shell, title, ×(+glyph), glow, button(+surface, label), body, heart, "-1"
    expect(frame(exit)).toEqual(frame(accepted));

    tap(field<UiButton>(exit, 'confirmButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm']);
    exit.destroy();

    const heart = shown(kit, new LivesWindowView({ ...readyUi, id: 'lives', onRefill: (p) => log.push(`refill:${p.lives}`), onWatchAd: (p) => log.push(`ad:${p.lives}`), onDismiss: (r) => log.push(`dismiss:${r}`) }));
    expect(heart.variant).toBe('figma');
    expect(heart.skin).toBe(READY_UI_STYLE_1);
    expect(field<UiButton>(heart, 'adButton').background.texture).toBe(roles.buttonRewarded);
    const kit3 = createKit();
    const acceptedLives = shown(kit3, lives(kit3, included(kit3, roles), { variant: 'figma' }));
    expect(frame(heart).scene.length).toBeGreaterThan(20);
    expect(frame(heart)).toEqual(frame(acceptedLives));
    // the timer, the count and the actions behave as before
    heart.setTimer('00:59');
    acceptedLives.setTimer('00:59');
    expect(frame(heart)).toEqual(frame(acceptedLives));
    tap(field<UiButton>(heart, 'adButton'), kit);
    advance(kit.core, 300);
    heart.show({ ...LIVES, adOffer: false });
    advance(kit.core, 400);
    expect(field<UiButton>(heart, 'adButton').visible).toBe(false);
    tap(field<UiButton>(heart, 'refillButton'), kit);
    advance(kit.core, 300);
    heart.show({ ...LIVES, lives: 5 });
    advance(kit.core, 400);
    expect(field<Text>(heart, 'timerText').text).toBe('MAX');
    tap(field<UiButton>(heart, 'closeButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm', 'ad:3', 'refill:3', 'dismiss:button']);
    heart.destroy();
    accepted.destroy();
    acceptedLives.destroy();
  });

  it('2. no style chosen: both windows stay donor, on the required pack alone (a theme without `skin` changes nothing)', () => {
    const kit = createKit();
    const textures = requiredOnly(kit);
    for (const theme of [undefined, { text: { fill: 0xffffff } }]) {
      const exit = shown(kit, confirm(kit, textures, theme ? { theme } : {}));
      expect(exit.variant).toBe('donor');
      expect(exit.skin).toBeNull();
      expect(field<Container>(exit, 'panel').children.some((c) => (c as Sprite).texture === textures.confirmPanel)).toBe(true);
      exit.destroy();
      const heart = shown(kit, lives(kit, textures, theme ? { theme } : {}));
      expect(heart.variant).toBe('donor');
      expect(heart.skin).toBeNull();
      expect(field<Text>(heart, 'countText').text).toBe('3/5');
      heart.destroy();
    }
  });

  it('8. Settings resolves Style 1 assets and map layout while ON/OFF stays runtime state', () => {
    const kit = createKit();
    const roles = roleTextures(READY_UI_STYLE_1);
    const log: string[] = [];
    const view = shownSettings(kit, settings(kit, styled(kit, READY_UI_STYLE_1, roles), {
      theme: { skin: READY_UI_STYLE_1 }, haptic: true
    }, log), { sound: true, music: false, haptic: true, version: 'VERSION 1.2.3' });
    const toggles = field<Record<'sound' | 'music' | 'haptic', { button: UiButton; off: Sprite; label: Text }>>(view, 'toggles');
    expect(view.skin).toBe(READY_UI_STYLE_1);
    expect(field<NineSliceSprite>(view, 'surface').texture).toBe(roles.settingsPanel);
    expect(field<UiButton>(view, 'closeButton').background.texture).toBe(roles.settingsClose);
    expect(toggles.sound.button.background.texture).toBe(roles.settingsSound);
    expect(toggles.music.button.background.texture).toBe(roles.settingsMusic);
    expect(toggles.haptic.button.background.texture).toBe(roles.settingsHaptic);
    // the dense column: the toggles under the header (buttons at 291), no language row → the 660-unit window
    expect(toggles.sound.button.position).toMatchObject({ x: -306, y: 71 });
    expect(toggles.music.button.position).toMatchObject({ x: 0, y: 71 });
    expect(toggles.haptic.button.position).toMatchObject({ x: 306, y: 71 });
    expect(field<{ window: object }>(view, 'activeLayout').window).toEqual({ width: 960, height: 660 });
    expect(field<Text>(view, 'version').text).toBe('VERSION 1.2.3');
    // theme_light_4: SETTINGS at 100, the version plain #716dd0 (no stroke / shadow), the shell's own violet ×
    expect(field<Text>(view, 'title').style.fontSize).toBe(100);
    expect([field<Text>(view, 'version').style.stroke, field<Text>(view, 'version').style.dropShadow]).toEqual([null, null]);
    expect(READY_UI_STYLE_1.assets.settingsClose.file).toBe(READY_UI_STYLE_1.assets.windowClose.file);
    expect(toggles.sound.off.visible).toBe(false);
    expect(toggles.music.off.visible).toBe(true);
    tap(toggles.sound.button, kit);
    expect(toggles.sound.off.visible).toBe(true);
    expect(log).toEqual(['sound:false']);
    view.setSettings({ music: true, haptic: false });
    expect(toggles.music.off.visible).toBe(false);
    expect(toggles.haptic.off.visible).toBe(true);
    tap(toggles.haptic.button, kit);
    expect(log).toEqual(['sound:false', 'haptic:true']);
    const text = scene(field<Container>(view, 'panel'))
      .flatMap((entry) => typeof entry === 'object' && entry !== null && 'text' in entry ? [String((entry as { text: unknown }).text)] : []);
    expect(text).not.toContain('NOTIFICATION');
    expect(text).not.toContain('PRIVACY POLICY');
    expect(text).not.toContain('RESTORE PURCHASES');
    view.destroy();
  });

  it('9. gameButtons selects the gameplay layout and keeps the existing action / haptic visibility behavior', () => {
    const kit = createKit();
    const roles = roleTextures(READY_UI_STYLE_1);
    const log: string[] = [];
    const view = shownSettings(kit, settings(kit, styled(kit, READY_UI_STYLE_1, roles), {
      theme: { skin: READY_UI_STYLE_1 }, haptic: true
    }, log), { sound: true, music: true, haptic: true, version: 'VERSION 1.2.3', gameButtons: true });
    const toggles = field<Record<'sound' | 'music' | 'haptic', { button: UiButton; off: Sprite; label: Text }>>(view, 'toggles');
    const restart = field<UiButton>(view, 'restartButton');
    const home = field<UiButton>(view, 'homeButton');
    expect(field<NineSliceSprite>(view, 'surface').height).toBe(1151); // 1371 − the language row 232 + 4 top / 8 bottom bleed
    // haptic is never drawn in-level: the pair is centred (it used to keep the empty third slot at x 306)
    expect(toggles.sound.button.position).toMatchObject({ x: -153, y: -168.5 });
    expect(toggles.music.button.position).toMatchObject({ x: 153, y: -168.5 });
    expect(toggles.haptic.button.visible).toBe(false);
    expect(restart.position).toMatchObject({ x: 0.5, y: 85 });
    expect(home.position).toMatchObject({ x: 0.5, y: 317 });
    expect(restart.background.texture).toBe(roles.settingsBtnRestart);
    expect(home.background.texture).toBe(roles.settingsBtnHome);
    tap(restart, kit);
    advance(kit.core, 200);
    expect(log).toEqual(['restart']);
    view.show({ sound: true, music: true, gameButtons: true });
    advance(kit.core, 400);
    tap(home, kit);
    advance(kit.core, 200);
    expect(log).toEqual(['restart', 'home']);
    view.destroy();
  });

  it('10. Settings without a skin stays on the unchanged donor path', () => {
    const kit = createKit();
    const view = shownSettings(kit, settings(kit, requiredOnly(kit)), { sound: true, music: false, version: 'VERSION 1' });
    const toggles = field<Record<'sound' | 'music' | 'haptic', { button: UiButton }>>(view, 'toggles');
    expect(view.skin).toBeNull();
    expect(field<Container>(view, 'panel').children.some((child) => (child as Sprite).texture === kit.textures.settingsPanel)).toBe(true);
    expect(toggles.sound.button.position).toMatchObject({ x: -150, y: 0 });
    expect(toggles.music.button.position).toMatchObject({ x: 150, y: 0 });
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 402, y: -461 });
    view.destroy();
  });

  it('11. a covered Settings window with a missing required role fails clearly', () => {
    const kit = createKit();
    const roles = roleTextures(READY_UI_STYLE_1);
    delete roles.settingsOff;
    expect(() => settings(kit, styled(kit, READY_UI_STYLE_1, roles), { theme: { skin: READY_UI_STYLE_1 } }))
      .toThrow("SettingsWindowView style 'style-1': no settingsOff (settings/deactivated.webp) in textures — load them with loadReadyUiAssets({ skin })");
    expect(kit.ui.getStats()).toMatchObject({ windows: 0, buttons: 0 });
  });

  it("3. explicit 'donor' wins over the theme's style; the old `variant: 'figma'` (include textures, no theme) is unchanged", () => {
    const kit = createKit();
    const roles = roleTextures(READY_UI_STYLE_1);
    const theme = { skin: READY_UI_STYLE_1 };
    // theme says Style 1, the window says donor: donor art, exactly the frame of a game without a style
    const donorConfirm = shown(kit, confirm(kit, styled(kit, READY_UI_STYLE_1, roles), { theme, variant: 'donor' }));
    const donorLives = shown(kit, lives(kit, styled(kit, READY_UI_STYLE_1, roles), { theme, variant: 'donor' }));
    const kit2 = createKit();
    const plainConfirm = shown(kit2, confirm(kit2, requiredOnly(kit2)));
    const plainLives = shown(kit2, lives(kit2, requiredOnly(kit2)));
    expect([donorConfirm.variant, donorLives.variant, donorConfirm.skin, donorLives.skin]).toEqual(['donor', 'donor', null, null]);
    expect(frame(donorConfirm)).toEqual(frame(plainConfirm));
    expect(frame(donorLives)).toEqual(frame(plainLives));

    // the pre-style path: `include` textures + `variant: 'figma'`, no theme → Style 1, pixel for pixel the same layers
    const kit3 = createKit();
    const legacyConfirm = shown(kit3, confirm(kit3, included(kit3, roles), { variant: 'figma' }));
    const legacyLives = shown(kit3, lives(kit3, included(kit3, roles), { variant: 'figma' }));
    expect([legacyConfirm.variant, legacyLives.variant]).toEqual(['figma', 'figma']);
    expect([legacyConfirm.skin, legacyLives.skin]).toEqual([READY_UI_STYLE_1, READY_UI_STYLE_1]);
    expect(field<NineSliceSprite>(legacyConfirm, 'surface').texture).toBe(roles.windowSurface);
    // and `variant: 'figma'` with style textures loaded works the same (the style's textures, the same frame)
    const kit4 = createKit();
    const figmaStyled = shown(kit4, confirm(kit4, styled(kit4, READY_UI_STYLE_1, roles), { variant: 'figma' }));
    expect(frame(figmaStyled)).toEqual(frame(legacyConfirm));
    for (const view of [donorConfirm, donorLives, plainConfirm, plainLives, legacyConfirm, legacyLives, figmaStyled]) view.destroy();
  });

  it('4. a chosen window without one of its assets / layout fails clearly — never a silent donor window', () => {
    const kit = createKit();
    const theme = { skin: READY_UI_STYLE_1 };
    // the style's textures lack the inner panel: Lives fails naming role + file + the load call; nothing registered
    const { panelInset: _drop, ...partial } = roleTextures(READY_UI_STYLE_1);
    expect(() => lives(kit, styled(kit, READY_UI_STYLE_1, partial), { theme }))
      .toThrow("LivesWindowView style 'style-1': no panelInset (window/panel_inset@2x.webp) in textures — load them with loadReadyUiAssets({ skin })");
    expect(kit.ui.getStats().windows).toBe(0);
    expect(kit.ui.getStats().buttons).toBe(0);
    // Confirm does not draw the inner panel: the same textures are enough for it
    const exit = confirm(kit, styled(kit, READY_UI_STYLE_1, partial), { theme });
    expect(exit.skin).toBe(READY_UI_STYLE_1);
    exit.destroy();

    // style chosen, its textures never loaded (and no include either)
    expect(() => confirm(kit, requiredOnly(kit), { theme }))
      .toThrow(/^ConfirmWindowView style 'style-1': no windowSurface \(window\/window_base@2x\.webp\), windowClose .*heroGlow .*lifeLostArt .*buttonPrimary .* in textures — load them with loadReadyUiAssets\(\{ skin \}\)$/);

    // a package that covers Lives without an asset for one of its roles / without its layout / a 9-slice without caps
    const noAsset = restyle('broken-asset', (s) => { const { panelInset: _p, ...assets } = s.assets; s.assets = assets; });
    expect(() => lives(kit, styled(kit, noAsset), { theme: { skin: noAsset } })).toThrow("ReadyUiSkin 'broken-asset' covers 'lives' but has no asset for role 'panelInset'");
    const noLayout = restyle('broken-layout', (s) => { s.windows = { confirm: READY_UI_STYLE_1.windows.confirm }; });
    expect(() => confirm(kit, styled(kit, noLayout), { theme: { skin: noLayout } })).toThrow("ReadyUiSkin 'broken-layout' covers 'lives' but has no windows.lives layout");
    const noCaps = restyle('broken-caps', (s) => { s.assets = { ...s.assets, buttonPrimary: { file: 'button/button_green@2x.webp' } }; });
    expect(() => confirm(kit, styled(kit, noCaps), { theme: { skin: noCaps } })).toThrow("ReadyUiSkin 'broken-caps': role 'buttonPrimary' is drawn as a 9-slice but has no nineSlice caps");
    expect(kit.ui.getStats().windows).toBe(0);
  });

  it("6. the package drives the layout, the 9-slice caps, the text look and the dim — the window code is not touched", () => {
    const kit = createKit();
    const moved = restyle('test-layout', (s) => {
      s.windows = {
        confirm: { ...READY_UI_STYLE_1.windows.confirm, button: { ...READY_UI_STYLE_1.windows.confirm.button, y: 725 + 40 } },
        lives: { ...READY_UI_STYLE_1.windows.lives, refill: { ...READY_UI_STYLE_1.windows.lives.refill, x: 90 + 30 } },
        settings: READY_UI_STYLE_1.windows.settings,
        result: READY_UI_STYLE_1.windows.result,
        noAds: READY_UI_STYLE_1.windows.noAds
      };
      s.assets = {
        ...s.assets,
        windowSurface: { file: READY_UI_STYLE_1.assets.windowSurface.file, nineSlice: { left: 100, top: 190, right: 100, bottom: 120 } },
        buttonPrimary: { file: READY_UI_STYLE_1.assets.buttonPrimary.file, nineSlice: { left: 50, top: 50, right: 50, bottom: 70 } }
      };
      s.text = { strokeOutside: 6, shadowY: 2 };
      s.backdrop = { color: 0x123456, alpha: 0.5 };
    });
    const exit = shown(kit, confirm(kit, styled(kit, moved), { theme: { skin: moved } }));
    const base = shown(kit, confirm(kit, styled(kit, READY_UI_STYLE_1), { id: 'base', theme: { skin: READY_UI_STYLE_1 } }));
    expect(field<UiButton>(exit, 'confirmButton').y).toBe(field<UiButton>(base, 'confirmButton').y + 40);
    const shell = field<NineSliceSprite>(exit, 'surface');
    expect([shell.leftWidth, shell.topHeight, shell.rightWidth, shell.bottomHeight]).toEqual([100, 190, 100, 120]);
    const button = field<UiButton>(exit, 'confirmButton').background as NineSliceSprite;
    expect([button.leftWidth, button.topHeight, button.rightWidth, button.bottomHeight]).toEqual([50, 50, 50, 70]);
    const title = field<Text>(exit, 'title');
    expect([(title.style.stroke as { width: number }).width, title.style.dropShadow && title.style.dropShadow.distance]).toEqual([12, 2]);
    expect([field<number>(exit, 'backdropColor'), field<number>(exit, 'backdropAlpha')]).toEqual([0x123456, 0.5]);
    exit.destroy();
    base.destroy();

    const heart = shown(kit, lives(kit, styled(kit, moved), { theme: { skin: moved } }));
    const baseLives = shown(kit, lives(kit, styled(kit, READY_UI_STYLE_1), { id: 'base-lives', theme: { skin: READY_UI_STYLE_1 } }));
    expect(field<UiButton>(heart, 'refillButton').x).toBe(field<UiButton>(baseLives, 'refillButton').x + 30);
    const refill = field<UiButton>(heart, 'refillButton').background as NineSliceSprite;
    expect([refill.leftWidth, refill.topHeight, refill.rightWidth, refill.bottomHeight]).toEqual([50, 50, 50, 70]);
    heart.destroy();
    baseLives.destroy();
  });
});

describe('UI Skin V1 — loading a style', () => {
  /** Pixi Assets stand-in with a real alias cache: a known alias answers from the cache whatever its new src is. */
  function fakeAssets() {
    const cache = new Map<string, Texture>();
    const requested: { alias: string; src: string }[] = [];
    let missing = new Set<string>();
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (urls: unknown) => {
      if (Array.isArray(urls)) return {}; // the required bundle
      const { alias, src } = urls as { alias: string; src: string };
      requested.push({ alias, src });
      if (missing.has(src)) throw new Error('404');
      if (!cache.has(alias)) cache.set(alias, labelled(src));
      return cache.get(alias);
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => labelled('required')) as never);
    return { requested, setMissing: (files: string[]) => { missing = new Set(files); }, restore: () => { load.mockRestore(); get.mockRestore(); } };
  }
  const second = restyle('test-b', (s) => {
    s.assets = Object.fromEntries(Object.entries(s.assets).map(([role, asset]) => [role, { ...asset, file: `skins/test-b/${role}.webp` }]));
  });

  it('5. the cache is keyed by style id: the same role in two styles loads two textures, each under its own id', async () => {
    const assets = fakeAssets();
    try {
      const one = await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: READY_UI_STYLE_1 });
      const two = await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: second });
      const aliases = assets.requested.filter((r) => r.alias.endsWith(':windowSurface')).map((r) => r.alias);
      expect(aliases).toEqual(['game-core-ui:skin:style-1:windowSurface', 'game-core-ui:skin:test-b:windowSurface']);
      const a = one.skins?.['style-1']?.windowSurface;
      const b = two.skins?.['test-b']?.windowSurface;
      expect(a?.source.label).toBe('/pack/window/window_base@2x.webp');
      expect(b?.source.label).toBe('/pack/skins/test-b/windowSurface.webp');
      expect(Object.keys(one.skins ?? {})).toEqual(['style-1']);
      expect(Object.keys(two.skins ?? {})).toEqual(['test-b']);
      // and the pre-style `include` aliases stay apart from both (game-core-ui:<name>)
      await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, include: ['windowBase'] });
      expect(assets.requested.at(-1)).toEqual({ alias: 'game-core-ui:windowBase', src: '/pack/window/window_base@2x.webp' });
    } finally {
      assets.restore();
    }
  });

  it('7. only the chosen style is requested (strictly); no style = no style file and no `skins` key (71 required textures)', async () => {
    const assets = fakeAssets();
    const filesOf = (skin: ReadyUiSkin) => Object.values(skin.assets).map((a) => `/pack/${a?.file}`).sort();
    try {
      const plain = await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true });
      expect(assets.requested).toEqual([]);
      expect('skins' in plain).toBe(false);
      expect(Object.keys(plain).length).toBe(71);

      const one = await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: READY_UI_STYLE_1 });
      expect(assets.requested.map((r) => r.src).sort()).toEqual(filesOf(READY_UI_STYLE_1));
      expect(assets.requested.some((r) => r.src.includes('test-b') || r.src.includes('/fx/'))).toBe(false);
      expect(Object.keys(one.skins?.['style-1'] ?? {}).sort()).toEqual([...ROLES].sort());
      expect(Object.keys(one).length).toBe(71 + 1); // the required pack + `skins`; no kit-name optional texture

      assets.requested.length = 0;
      await loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: second });
      expect(assets.requested.map((r) => r.src).sort()).toEqual(filesOf(second));
      expect(assets.requested.some((r) => filesOf(READY_UI_STYLE_1).includes(r.src))).toBe(false);

      // a chosen style's file that does not load rejects, naming the style, the role and the file
      assets.setMissing(['/pack/icons/icon_ad@2x.webp']);
      await expect(loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: READY_UI_STYLE_1 }))
        .rejects.toThrow(`loadReadyUiAssets: style 'style-1' "adIcon" (icons/icon_ad@2x.webp) was requested but did not load from /pack/`);
      // a broken package is refused before a single request
      assets.requested.length = 0;
      const broken = restyle('broken', (s) => { const { adIcon: _a, ...rest } = s.assets; s.assets = rest; });
      await expect(loadReadyUiAssets({ baseUrl: '/pack/', skipFont: true, skin: broken })).rejects.toThrow("ReadyUiSkin 'broken' covers 'lives' but has no asset for role 'adIcon'");
      expect(assets.requested).toEqual([]);
    } finally {
      assets.restore();
    }
  });
});
