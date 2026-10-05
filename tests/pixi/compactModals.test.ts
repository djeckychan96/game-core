import { describe, expect, it } from 'vitest';
import { Container, NineSliceSprite, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer, type TestKit } from './setup';
import { ConfirmWindowView, type ConfirmWindowViewOptions } from '../../src/pixi/ConfirmWindowView';
import { SettingsWindowView, type SettingsWindowParams, type SettingsWindowViewOptions } from '../../src/pixi/SettingsWindowView';
import type { ReadyUiTextures } from '../../src/pixi/assets';
import type { ReadyUiSkin, ReadyUiSkinAssetKey, ReadyUiSkinBox, ReadyUiSkinSettingsGameplayLayout, ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

// A game shows the subset of a style's controls it uses (Puzzle: SOUND + MUSIC + RESTART, no HAPTIC / HOME; a restart
// confirm without the broken heart): the style's layout closes up around what is drawn — no empty slot, row or band.

type Toggle = { button: UiButton; off: Sprite; label: Text };
type Toggles = { sound: Toggle; music: Toggle; haptic: Toggle | null };

const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

function styled(kit: TestKit, skin: ReadyUiSkin): ReadyUiTextures {
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[role] = labelled(`${skin.id}:${role}`);
  return { ...kit.textures, skins: { [skin.id]: roles } };
}

function field<T>(view: object, name: string): T {
  return (view as Record<string, unknown>)[name] as T;
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

const labels = (root: Container): string[] => descendants(root, Sprite).map((sprite) => sprite.texture.source.label);
const texts = (root: Container): string[] => descendants(root, Text).filter((text) => text.visible).map((text) => text.text);

function tap(target: Container, kit: TestKit): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 300);
}

/** Everything the panel draws, as data: kind, texture, geometry, visibility, text. */
function scene(root: Container): unknown[] {
  return descendants(root, Container).map((node) => ({
    kind: node.constructor.name, x: node.x, y: node.y, visible: node.visible,
    ...(node instanceof Sprite ? { texture: node.texture.source.label, w: node.width, h: node.height } : {}),
    ...(node instanceof Text ? { text: node.text } : {})
  }));
}

describe('Settings — a style lays out only the controls a game shows', () => {
  const STYLE_1 = READY_UI_STYLE_1.windows.settings;

  /** A shown Settings window on its own kit (UiRuntime shows one modal at a time). */
  function open(extra: Partial<SettingsWindowViewOptions>, params: Partial<SettingsWindowParams>, skin: ReadyUiSkin | null = READY_UI_STYLE_1, log: string[] = []): { kit: TestKit; view: SettingsWindowView } {
    const kit = createKit();
    const view = new SettingsWindowView({
      ui: kit.ui, motion: kit.motion, textures: skin ? styled(kit, skin) : kit.textures, id: 'settings', ...(skin ? { theme: { skin } } : {}),
      onToggle: (setting, enabled) => log.push(`${setting}:${enabled}`), onDismiss: (reason) => log.push(`dismiss:${reason}`), ...extra
    });
    reopen(kit, view, params);
    return { kit, view };
  }
  function reopen(kit: TestKit, view: SettingsWindowView, params: Partial<SettingsWindowParams>): void {
    expect(view.show({ sound: true, music: true, version: 'VERSION 1.2.3', ...params })).toBe(true);
    advance(kit.core, 400);
  }
  const toggles = (view: SettingsWindowView): Toggles => field<Toggles>(view, 'toggles');
  const layout = (view: SettingsWindowView): ReadyUiSkinSettingsGameplayLayout => field<ReadyUiSkinSettingsGameplayLayout>(view, 'activeLayout');
  const surface = (view: SettingsWindowView): NineSliceSprite => field<NineSliceSprite>(view, 'surface');
  const bottom = (box: ReadyUiSkinBox): number => box.y + box.height;

  it('1. two toggles (no haptic): a centred pair at the style pitch, no empty third slot — map and in-level (Puzzle)', () => {
    // the Puzzle shell: SOUND + MUSIC + RESTART, no HOME, no HAPTIC; and the map (no game buttons)
    const puzzle = open({ onRestart: () => {} }, { gameButtons: true }).view;
    const map = open({}, { gameButtons: false }).view;
    const three = open({ haptic: true }, { gameButtons: false, haptic: true }).view;
    for (const view of [puzzle, map]) {
      const { sound, music, haptic } = toggles(view);
      expect(haptic?.button.visible).toBe(false);
      expect(sound.button.visible && music.button.visible).toBe(true);
      // symmetric about the window centre (the third slot's x 306 is not kept free) at the style's own pitch
      expect(sound.button.x + music.button.x).toBeCloseTo(0, 6);
      expect(music.button.x - sound.button.x).toBe(STYLE_1.map.music.button.x - STYLE_1.map.sound.button.x);
      expect([sound.button.x, music.button.x]).toEqual([-153, 153]);
      // captions move with their buttons; sizes and rows unchanged
      for (const key of ['sound', 'music'] as const) {
        expect(toggles(view)[key].label.x - toggles(three)[key].label.x).toBeCloseTo(toggles(view)[key].button.x - toggles(three)[key].button.x, 9);
      }
      expect(sound.button.background.width).toBe(STYLE_1.map.sound.button.width);
      expect(sound.button.y).toBe(STYLE_1.map.sound.button.y + 110 - layout(view).window.height / 2);
    }
    for (const view of [puzzle, map, three]) view.destroy();
  });

  it('2. hidden HOME leaves no empty row: RESTART keeps its row, the version and the window bottom move up by the freed row', () => {
    const { view } = open({ onRestart: () => {} }, { gameButtons: true });
    const L = layout(view);
    const full = STYLE_1.gameplay;
    const last = full.language as NonNullable<typeof full.language>;
    // HOME and the language row (no languages) are not drawn: their two rows close up
    const freed = bottom(last.button) - bottom(full.restart.button);
    expect(freed).toBe(464);
    expect(L.window).toEqual({ width: 960, height: full.window.height - freed });
    expect(surface(view).height).toBe(907 + 12); // + 4 top / 8 bottom bleed
    expect(L.restart.button).toEqual(full.restart.button);
    expect(field<UiButton>(view, 'homeButton').visible).toBe(false);
    // the version sits under RESTART exactly as it sat under the last row
    expect(L.version.y - bottom(L.restart.button)).toBe(full.version.y - bottom(last.button));
    expect(bottom(L.version) <= L.window.height).toBe(true);
    // the panel's fit box and hit area are the shorter window (same design-unit scale as the full one)
    const panel = field<Container>(view, 'panel');
    expect(panel.hitArea).toMatchObject({ y: -453.5, height: 907 });
    const fullView = open({ onRestart: () => {}, onHome: () => {} }, { gameButtons: true }).view;
    expect(field<number>(view, 'fitScale')).toBeCloseTo(field<number>(fullView, 'fitScale'), 9);
    // RESTART hidden instead: HOME moves up into the first action row
    const homeOnly = open({ onHome: () => {} }, { gameButtons: true }).view;
    expect(layout(homeOnly).home.button.y).toBe(full.restart.button.y);
    expect(layout(homeOnly).window.height).toBe(full.window.height - freed);
    // in-level with no action at all: the style's map composition (no action band; no language row either)
    const none = open({}, { gameButtons: true }).view;
    expect(layout(none).window).toEqual({ width: 960, height: STYLE_1.map.window.height - (bottom((STYLE_1.map.language as { button: ReadyUiSkinBox }).button) - bottom(STYLE_1.map.sound.button)) });
    expect(field<UiButton>(none, 'restartButton').visible).toBe(false);
    // Style 2 closes its action rows the same way
    const style2 = open({ onRestart: () => {} }, { gameButtons: true }, READY_UI_STYLE_2).view;
    const s2 = READY_UI_STYLE_2.windows.settings.gameplay;
    const s2last = (s2.language as { button: ReadyUiSkinBox }).button;
    expect(layout(style2).window.height).toBe(s2.window.height - (bottom(s2last) - bottom(s2.restart.button)));
    expect(layout(style2).version.y - bottom(s2.restart.button)).toBe(s2.version.y - bottom(s2last));
    for (const v of [view, fullView, homeOnly, none, style2]) v.destroy();
  });

  it('3. every control shown keeps the accepted composition: the style\'s own layout objects, positions unchanged; donor unchanged', () => {
    const LANGS = { languages: [{ id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }], onLanguage: () => {} };
    // map with HAPTIC and the language row: all three slots, every row
    const map = open({ haptic: true, ...LANGS }, { gameButtons: false, haptic: true }).view;
    expect(layout(map)).toBe(STYLE_1.map);
    const t = toggles(map);
    expect([t.sound.button.x, t.music.button.x, t.haptic?.button.x]).toEqual([-306, 0, 306]);
    // in-level with HOME and RESTART: the action rows, the version and the window are the style's, untouched
    const game = open({ onRestart: () => {}, onHome: () => {}, ...LANGS }, { gameButtons: true }).view;
    const G = layout(game);
    expect(G.restart).toBe(STYLE_1.gameplay.restart);
    expect(G.home).toBe(STYLE_1.gameplay.home);
    expect(G.version).toBe(STYLE_1.gameplay.version);
    expect(G.window).toBe(STYLE_1.gameplay.window);
    expect(surface(game).height).toBe(1371 + 12);
    expect(field<UiButton>(game, 'restartButton').position).toMatchObject({ x: 0.5, y: 551 + 103.5 - 685.5 });
    expect(field<UiButton>(game, 'homeButton').position).toMatchObject({ x: 0.5, y: 783 + 103.5 - 685.5 });
    expect(field<{ button: UiButton }>(game, 'languageRow').button.position).toMatchObject({ x: 0.5, y: 1015 + 103.5 - 685.5 });
    // Style 2 draws two toggles by design (no haptic slot): its full in-level layout is its own object
    const style2 = open({ onRestart: () => {}, onHome: () => {}, ...LANGS }, { gameButtons: true }, READY_UI_STYLE_2).view;
    expect(layout(style2)).toBe(READY_UI_STYLE_2.windows.settings.gameplay);
    // no style: the donor path is untouched (its own centring, fixed HOME / RESTART slots)
    const donor = open({ onRestart: () => {} }, { gameButtons: true }, null).view;
    expect([toggles(donor).sound.button.position.x, toggles(donor).music.button.position.x]).toEqual([-150, 150]);
    expect(field<UiButton>(donor, 'restartButton').position).toMatchObject({ x: 0, y: 250 });
    expect(field<UiButton>(donor, 'homeButton').visible).toBe(false);
    for (const v of [map, game, style2, donor]) v.destroy();
  });

  it('4. callbacks unchanged in a compact layout: toggles, RESTART continuation, × dismiss; a hidden action is disabled', () => {
    const log: string[] = [];
    const { kit, view } = open({ onRestart: () => log.push('restart') }, { gameButtons: true }, READY_UI_STYLE_1, log);
    const { sound, music } = toggles(view);
    tap(sound.button, kit);
    tap(music.button, kit);
    expect(log).toEqual(['sound:false', 'music:false']);
    expect([sound.off.visible, music.off.visible]).toEqual([true, true]);
    expect(field<UiButton>(view, 'homeButton').controller.enabled).toBe(false);
    tap(field<UiButton>(view, 'restartButton'), kit);
    expect(log).toEqual(['sound:false', 'music:false', 'restart']);
    reopen(kit, view, { gameButtons: true });
    tap(field<UiButton>(view, 'closeButton'), kit);
    expect(log).toEqual(['sound:false', 'music:false', 'restart', 'dismiss:button']);
    view.destroy();
  });
});

describe('Settings — the language row (one public API, both styles)', () => {
  const LANGUAGES = [{ id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }, { id: 'de', label: 'Deutsch' }];
  type Row = { button: UiButton; label: Text; icon: Sprite | null };

  function open(skin: ReadyUiSkin | null, extra: Partial<SettingsWindowViewOptions>, params: Partial<SettingsWindowParams> = {}, log: string[] = []): { kit: TestKit; view: SettingsWindowView } {
    const kit = createKit();
    const view = new SettingsWindowView({
      ui: kit.ui, motion: kit.motion, textures: skin ? styled(kit, skin) : kit.textures, id: 'settings', ...(skin ? { theme: { skin } } : {}),
      onToggle: (setting, enabled) => log.push(`${setting}:${enabled}`), onDismiss: (reason) => log.push(`dismiss:${reason}`), ...extra
    });
    view.show({ sound: true, music: true, version: 'VERSION 1', ...params });
    advance(kit.core, 400);
    return { kit, view };
  }
  const row = (view: SettingsWindowView): Row => field<Row>(view, 'languageRow');
  const height = (view: SettingsWindowView): number => field<{ window: { height: number } }>(view, 'activeLayout').window.height;

  for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2]) {
    it(`${skin.id}: drawn with two or more languages and onLanguage; shows the current one; a tap moves to the next in place`, () => {
      const log: string[] = [];
      const { kit, view } = open(skin, { languages: LANGUAGES, onLanguage: (locale) => log.push(`language:${locale}`) }, { locale: 'ru' }, log);
      const r = row(view);
      expect(r.button.visible).toBe(true);
      expect(r.label.text).toBe('Русский');
      expect(view.currentLocale).toBe('ru');
      expect(r.button.background.texture.source.label).toBe(`${skin.id}:settingsBtnLanguage`);
      // Style 1: its own blue Btn as a 9-slice, text only; Style 2: the Figma row with the globe
      if (skin === READY_UI_STYLE_1) {
        expect(r.button.background).toBeInstanceOf(NineSliceSprite);
        expect(r.icon).toBeNull();
      } else {
        expect(r.icon?.texture.source.label).toBe('style-2:settingsIconLanguage');
      }
      tap(r.button, kit);
      expect(view.state).toBe('shown'); // in place, like a toggle
      expect([r.label.text, view.currentLocale]).toEqual(['Deutsch', 'de']);
      tap(r.button, kit);
      expect([r.label.text, view.currentLocale]).toEqual(['English', 'en']); // wraps
      expect(log).toEqual(['language:de', 'language:en']);
      // the map window with the row is the style's own map layout, taller than without it
      const withRow = height(view);
      view.destroy();
      const none = open(skin, {}).view;
      expect(field<Row>(none, 'languageRow').button.visible).toBe(false);
      expect(height(none)).toBeLessThan(withRow);
      expect(none.currentLocale).toBeNull();
      none.destroy();
      // one language or no callback: no row
      const single = open(skin, { languages: LANGUAGES.slice(0, 1), onLanguage: () => {} }).view;
      expect(row(single).button.visible).toBe(false);
      single.destroy();
      const silent = open(skin, { languages: LANGUAGES }).view;
      expect(row(silent).button.visible).toBe(false);
      silent.destroy();
    });

    it(`${skin.id}: in-level the row closes up with the actions — any subset leaves no empty row`, () => {
      const G = skin.windows.settings.gameplay;
      const rowH = (key: 'restart' | 'home' | 'language'): number => (G[key] as { button: ReadyUiSkinBox }).button.height;
      const all = open(skin, { onRestart: () => {}, onHome: () => {}, languages: LANGUAGES, onLanguage: () => {} }, { gameButtons: true }).view;
      expect(height(all)).toBe(G.window.height);
      const languageOnly = open(skin, { onRestart: () => {}, languages: LANGUAGES, onLanguage: () => {} }, { gameButtons: true }).view;
      // HOME gone: the language row takes its slot, the window loses one row pitch
      expect(row(languageOnly).button.y).toBeCloseTo(field<UiButton>(all, 'homeButton').y + (height(all) - height(languageOnly)) / 2, 6);
      expect(height(all) - height(languageOnly)).toBe(G.language!.button.y - G.home.button.y);
      expect(rowH('language')).toBe(rowH('home'));
      for (const v of [all, languageOnly]) v.destroy();
    });
  }

  it('the donor look and a style without a language layout ignore the option (no row, nothing breaks)', () => {
    const donor = open(null, { languages: LANGUAGES, onLanguage: () => {} }).view;
    expect((donor as unknown as { languageRow: unknown }).languageRow).toBeNull();
    donor.destroy();
    const plain = JSON.parse(JSON.stringify(READY_UI_STYLE_2)) as { -readonly [K in keyof ReadyUiSkin]: ReadyUiSkin[K] } & { windows: { settings: { map: { language?: unknown }; gameplay: { language?: unknown } } } };
    delete plain.windows.settings.map.language;
    delete plain.windows.settings.gameplay.language;
    plain.id = 'style-2-no-language';
    const kit = createKit();
    const view = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, plain as ReadyUiSkin), theme: { skin: plain as ReadyUiSkin }, id: 'plain', onToggle: () => {}, languages: LANGUAGES, onLanguage: () => {} });
    view.show({ sound: true, music: true });
    advance(kit.core, 400);
    expect((view as unknown as { languageRow: unknown }).languageRow).toBeNull();
    view.destroy();
  });
});

describe('Confirm — optional illustration', () => {
  const L = READY_UI_STYLE_1.windows.confirm;

  /** A shown Confirm window on its own kit (UiRuntime shows one modal at a time). */
  function confirm(extra: Partial<ConfirmWindowViewOptions> = {}, log: string[] = [], skin: ReadyUiSkin | null = READY_UI_STYLE_1, kit: TestKit = createKit()): ConfirmWindowView {
    const view = new ConfirmWindowView({
      ui: kit.ui, motion: kit.motion, textures: skin ? styled(kit, skin) : kit.textures, id: 'confirm', ...(skin ? { theme: { skin } } : {}),
      onConfirm: () => log.push('confirm'), onDismiss: (reason) => log.push(`dismiss:${reason}`), ...extra
    });
    expect(view.show()).toBe(true);
    advance(kit.core, 400);
    return view;
  }
  const panel = (view: ConfirmWindowView): Container => field<Container>(view, 'panel');

  it('5. default still draws the illustration (glow, broken heart, -1) in the accepted layout; `true` is the same frame', () => {
    const view = confirm();
    expect(labels(panel(view))).toEqual(expect.arrayContaining(['style-1:heroGlow', 'style-1:lifeLostArt']));
    expect(texts(panel(view))).toContain('-1');
    expect(panel(view).hitArea).toMatchObject({ x: -480, y: -497, width: 960, height: 994 });
    expect(field<UiButton>(view, 'confirmButton').position).toMatchObject({ x: 0, y: L.button.y + L.button.height / 2 - 497 });
    const explicit = confirm({ illustration: true });
    expect(scene(panel(explicit))).toEqual(scene(panel(view)));
    view.destroy();
    explicit.destroy();
  });

  it('6. `illustration: false` removes the art, its "-1" and the glow (nothing hidden behind, nothing to hit)', () => {
    const view = confirm({ illustration: false, action: 'restart', body: 'LEVEL PROGRESS WILL BE LOST' });
    expect(labels(panel(view))).not.toContain('style-1:lifeLostArt');
    expect(labels(panel(view))).not.toContain('style-1:heroGlow');
    expect(texts(panel(view))).not.toContain('-1');
    expect(texts(panel(view))).toEqual(expect.arrayContaining(['ARE YOU SURE?', 'LEVEL PROGRESS WILL BE LOST', 'RESTART']));
    for (const name of ['heart', 'glow', 'lifeDelta']) expect(field<unknown>(view, name)).toBeNull();
    view.destroy();
  });

  it('7. without it the band closes up: body and button move into the art\'s place, the window is shorter by the same height', () => {
    const full = confirm();
    const view = confirm({ illustration: false });
    const lift = L.body.y - L.heart.y;
    expect(lift).toBe(322);
    const height = L.window.height - lift;
    expect(panel(view).hitArea).toMatchObject({ x: -480, y: -height / 2, width: 960, height });
    // the 9-slice shell (with its pad bleed) is shorter by exactly the band
    expect(field<NineSliceSprite>(full, 'surface').height - field<NineSliceSprite>(view, 'surface').height).toBe(lift);
    const top = (y: number): number => y + height / 2; // panel units → window-local
    // the body takes the art's top: the title → content gap of the style is kept
    const body = field<Text>(view, 'body');
    const fullBody = field<Text>(full, 'body');
    expect(top(body.y) - (fullBody.y + L.window.height / 2)).toBeCloseTo(-lift, 6);
    // the button keeps its distance to the body and to the window bottom
    const button = field<UiButton>(view, 'confirmButton');
    expect(top(button.y)).toBe(L.button.y - lift + L.button.height / 2);
    expect(height - (top(button.y) + L.button.height / 2)).toBe(L.window.height - (L.button.y + L.button.height));
    // title and × stay at the top; the design-unit scale is the full window's
    expect(top(field<Text>(view, 'title').y)).toBeCloseTo(field<Text>(full, 'title').y + L.window.height / 2, 6);
    expect(top(field<UiButton>(view, 'closeButton').y)).toBe(field<UiButton>(full, 'closeButton').y + L.window.height / 2);
    expect(field<number>(view, 'fitScale')).toBeCloseTo(field<number>(full, 'fitScale'), 9);
    // Style 2's own theme_light_4 Confirm closes by the same rule (its band: heart 148 → body 467); the donor art bakes
    // its heart in and ignores it
    const L2 = READY_UI_STYLE_2.windows.confirm;
    const style2 = confirm({ illustration: false }, [], READY_UI_STYLE_2);
    expect(panel(style2).hitArea).toMatchObject({ height: L2.window.height - (L2.body.y - L2.heart.y) });
    const donor = confirm({}, [], null);
    const donorNoArt = confirm({ illustration: false }, [], null);
    expect(scene(panel(donorNoArt))).toEqual(scene(panel(donor)));
    for (const v of [full, view, style2, donor, donorNoArt]) v.destroy();
  });

  it('8. callbacks unchanged without the illustration: the button confirms after the close, × and backdrop dismiss', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = confirm({ illustration: false }, log, READY_UI_STYLE_1, kit);
    tap(field<UiButton>(view, 'confirmButton'), kit);
    expect(log).toEqual(['confirm']);
    view.show();
    advance(kit.core, 400);
    tap(field<UiButton>(view, 'closeButton'), kit);
    view.show();
    advance(kit.core, 400);
    const backdrop = field<Container>(view, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm', 'dismiss:button', 'dismiss:background']);
    view.destroy();
  });
});
