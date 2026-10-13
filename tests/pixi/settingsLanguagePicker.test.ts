import { describe, expect, it } from 'vitest';
import { Container, Text, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer, type TestKit } from './setup';
import { LocalizationRuntime } from '../../src/localization';
import * as pixiEntry from '../../src/pixi/index';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { SettingsWindowView, type SettingsWindowParams, type SettingsWindowViewOptions } from '../../src/pixi/SettingsWindowView';
import { createSettingsLanguagePicker, type SettingsLanguagePickerOptions } from '../../src/pixi/SettingsLanguagePicker';
import type { ReadyUiTextures } from '../../src/pixi/assets';
import type { ReadyUiSkin, ReadyUiSkinAssetKey, ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

// --- a tiny page: the elements the picker creates, with the browser semantics it relies on (a select's value is one of
// its options' values, else ''; listeners on the element itself; remove / replaceChildren) ---
class FakeElement {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  blurs = 0;
  private ownValue = '';
  listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get value(): string {
    return this.ownValue;
  }
  set value(next: string) {
    // a select takes only a value one of its options has (the browser leaves it empty otherwise)
    this.ownValue = this.tagName !== 'select' || this.children.some((option) => option.value === next) ? next : '';
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  blur(): void {
    this.blurs += 1;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
  /** The player picked `value` in the system list: the browser sets it and fires `change` on the select. */
  choose(value: string): void {
    this.value = value;
    for (const listener of this.listeners.get('change') ?? []) listener({ type: 'change' });
  }
}

class FakeDocument {
  readonly body = new FakeElement('body', this);
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

/** The page box of the canvas (CSS px): 12 / 30 from the viewport corner, its CSS size twice the stage's (the test's own). */
const CANVAS_BOX = { left: 12, top: 30, width: 780, height: 1688 };
const STAGE = { width: 390, height: 844 };

const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });
function styled(kit: TestKit, skin: ReadyUiSkin): ReadyUiTextures {
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[role] = labelled(`${skin.id}:${role}`);
  return { ...kit.textures, skins: { [skin.id]: roles } };
}
const LANGUAGES = [{ id: 'ru', label: 'РУССКИЙ' }, { id: 'en', label: 'ENGLISH' }];
const NAMES: Record<string, string> = { ru: 'Русский', en: 'English' };
const i18nFor = (locale: string): LocalizationRuntime =>
  new LocalizationRuntime({ rawLocale: locale, supportedLocales: ['ru', 'en'], defaultLocale: 'en', fallbackLocale: 'en', catalogs: READY_UI_CATALOGS });

function settingsFor(skin: ReadyUiSkin | null, extra: Partial<SettingsWindowViewOptions> = {}, log: string[] = []) {
  const kit = createKit();
  const settings = new SettingsWindowView({
    ui: kit.ui, motion: kit.motion, textures: skin ? styled(kit, skin) : kit.textures, id: 'settings', ...(skin ? { theme: { skin } } : {}),
    i18n: i18nFor('ru'), onToggle: (setting, enabled) => log.push(`${setting}:${enabled}`), onDismiss: (reason) => log.push(`dismiss:${reason}`),
    languages: LANGUAGES, onLanguage: (locale) => log.push(`language:${locale}`), onRestart: () => log.push('restart'), ...extra
  });
  settings.resize(STAGE.width, STAGE.height);
  return { kit, settings };
}

function pickerFor(settings: SettingsWindowView, extra: Partial<SettingsLanguagePickerOptions> = {}) {
  const doc = new FakeDocument();
  const container = new FakeElement('div', doc);
  doc.body.append(container);
  const canvas = { ownerDocument: doc, parentElement: container, getBoundingClientRect: () => ({ ...CANVAS_BOX }) };
  const picker = createSettingsLanguagePicker({
    settings, canvas: canvas as unknown as HTMLCanvasElement, screen: STAGE, optionLabel: (language) => NAMES[language.id] ?? language.label, ...extra
  });
  return { doc, container, picker, select: picker.element as unknown as FakeElement };
}

const open = (kit: TestKit, settings: SettingsWindowView, params: Partial<SettingsWindowParams> = {}): void => {
  settings.show({ sound: true, music: true, locale: 'ru', ...params });
  advance(kit.core, 400);
};
const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN');
const texts = (root: Container): string[] => {
  const found: string[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children) {
      if (child instanceof Text && child.visible) found.push(child.text);
      visit(child);
    }
  };
  visit(root);
  return found;
};

describe('SettingsLanguagePicker — the device\'s own language list over the Settings language row', () => {
  it('is exported from game-core/pixi', () => {
    expect(pixiEntry.createSettingsLanguagePicker).toBe(createSettingsLanguagePicker);
    expect(typeof pixiEntry.SettingsLanguagePicker).toBe('function');
  });

  for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2]) {
    it(`${skin.id}: one native select, hidden until the window is up, then exactly over the language button (canvas box × stage scale)`, () => {
      const { kit, settings } = settingsFor(skin);
      const { container, picker, select } = pickerFor(settings);
      expect(select.tagName).toBe('select');
      expect(container.children).toEqual([select]);
      expect(select.dataset.gameCore).toBe('settings-language-picker');
      expect(select.style).toMatchObject({ position: 'fixed', display: 'none', opacity: '0', fontSize: '16px', pointerEvents: 'auto' });
      expect(picker.active).toBe(false);

      open(kit, settings);
      picker.update();
      expect(picker.active).toBe(true);
      const b = (settings.languageButton as UiButton).background.getBounds();
      const k = CANVAS_BOX.width / STAGE.width;
      expect(px(select.style.left)).toBeCloseTo(CANVAS_BOX.left + b.x * k, 6);
      expect(px(select.style.top)).toBeCloseTo(CANVAS_BOX.top + b.y * k, 6);
      expect(px(select.style.width)).toBeCloseTo(b.width * k, 6);
      expect(px(select.style.height)).toBeCloseTo(b.height * k, 6);
      expect(px(select.style.width)).toBeGreaterThan(100);
      // only the window's languages, named by the host, the current one selected
      expect(select.children.map((option) => [option.value, option.textContent])).toEqual([['ru', 'Русский'], ['en', 'English']]);
      expect(select.value).toBe('ru');
      settings.destroy();
      picker.destroy();
    });
  }

  it('a choice in the list = the row\'s language: shown in the row, reported once through onLanguage, the window stays open', () => {
    const log: string[] = [];
    const { kit, settings } = settingsFor(READY_UI_STYLE_2, {}, log);
    const { picker, select } = pickerFor(settings);
    open(kit, settings);
    picker.update();
    select.choose('en');
    expect(log).toEqual(['language:en']);
    expect(settings.currentLocale).toBe('en');
    expect(settings.state).toBe('shown');
    expect(texts(settings.languageButton as UiButton)).toContain('ENGLISH');
    expect(select.blurs).toBeGreaterThan(0); // no keyboard switching after a desktop choice
    // the same language again (a list closed without a change) reports nothing
    select.choose('en');
    expect(log).toEqual(['language:en']);
    select.choose('ru');
    expect(log).toEqual(['language:en', 'language:ru']);
    settings.destroy();
    picker.destroy();
  });

  it('follows the entrance, and leaves no tap catcher: leaving, hidden, a hidden ancestor, destroyed — display none', () => {
    const log: string[] = [];
    const { kit, settings } = settingsFor(READY_UI_STYLE_1, {}, log);
    const { picker, select } = pickerFor(settings);
    settings.show({ sound: true, music: true, locale: 'ru' });
    advance(kit.core, 48);
    picker.update();
    expect(settings.state).toBe('entering');
    expect(picker.active).toBe(true); // the row is tappable from the first frame: never the cycling tap under it
    const early = px(select.style.width);
    advance(kit.core, 400);
    picker.update();
    expect(px(select.style.width)).toBeGreaterThan(early); // the 0.84 → 1 pop
    const placed = { ...select.style };
    picker.update();
    expect(select.style).toEqual(placed); // nothing moved: no write
    // ×: leaving → gone at once; hidden; reopened → back
    settings.close('button');
    picker.update();
    expect(settings.state).toBe('leaving');
    expect(select.style.display).toBe('none');
    advance(kit.core, 400);
    picker.update();
    expect([settings.state, select.style.display]).toEqual(['hidden', 'none']);
    open(kit, settings);
    picker.update();
    expect(select.style.display).toBe('block');
    // a hidden parent (the host hid its UI layer)
    const layer = new Container();
    layer.addChild(settings);
    layer.visible = false;
    picker.update();
    expect(select.style.display).toBe('none');
    layer.visible = true;
    picker.update();
    expect(select.style.display).toBe('block');
    // the window destroyed under a live picker: hidden, and a late change does nothing
    settings.destroy();
    picker.update();
    expect(select.style.display).toBe('none');
    select.choose('en');
    expect(log.filter((entry) => entry.startsWith('language'))).toEqual([]);
    picker.destroy();
  });

  it('never shown without a language row: the donor look, one language, no onLanguage; in level the row is covered too', () => {
    const cases: Array<[ReadyUiSkin | null, Partial<SettingsWindowViewOptions>]> = [
      [null, { languages: LANGUAGES, onLanguage: () => {} }],
      [READY_UI_STYLE_2, { languages: LANGUAGES.slice(0, 1), onLanguage: () => {} }],
      [READY_UI_STYLE_1, { languages: LANGUAGES }]
    ];
    for (const [skin, extra] of cases) {
      const kit = createKit();
      const settings = new SettingsWindowView({
        ui: kit.ui, motion: kit.motion, textures: skin ? styled(kit, skin) : kit.textures, ...(skin ? { theme: { skin } } : {}), onToggle: () => {}, ...extra
      });
      const { picker } = pickerFor(settings);
      open(kit, settings);
      picker.update();
      expect(picker.active).toBe(false);
      expect(settings.languageButton).toBeNull();
      settings.destroy();
      picker.destroy();
    }
    const { kit, settings } = settingsFor(READY_UI_STYLE_2);
    const { picker } = pickerFor(settings);
    open(kit, settings, { gameButtons: true });
    picker.update();
    expect(picker.active).toBe(true);
    settings.destroy();
    picker.destroy();
  });

  it('destroy() removes the select and its listener; a page-less host gets an inert picker', () => {
    const { kit, settings } = settingsFor(READY_UI_STYLE_2);
    const { container, picker, select } = pickerFor(settings);
    open(kit, settings);
    picker.update();
    expect(select.listenerCount()).toBe(1);
    picker.destroy();
    picker.destroy();
    expect(container.children).toEqual([]);
    expect(select.listenerCount()).toBe(0);
    expect(picker.destroyed).toBe(true);
    picker.update(); // no throw, nothing comes back
    expect(container.children).toEqual([]);
    const headless = createSettingsLanguagePicker({ settings, canvas: { ownerDocument: null, parentElement: null } as unknown as HTMLCanvasElement });
    expect(headless.element).toBeNull();
    headless.update();
    expect(headless.active).toBe(false);
    settings.destroy();
  });

  it('a tap on the Pixi row without a picker still cycles (hosts without a page keep the old behaviour)', () => {
    const log: string[] = [];
    const { kit, settings } = settingsFor(READY_UI_STYLE_2, {}, log);
    open(kit, settings);
    const row = settings.languageButton as UiButton;
    row.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 80);
    row.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 300);
    expect(log).toEqual(['language:en']);
    settings.destroy();
  });
});

describe('SettingsWindowView — relocalize and selectLanguage', () => {
  for (const skin of [READY_UI_STYLE_1, READY_UI_STYLE_2, null]) {
    it(`${skin?.id ?? 'donor'}: relocalize(i18n) turns the OPEN window to the new language in place — no close, state kept`, () => {
      const { kit, settings } = settingsFor(skin);
      open(kit, settings, { gameButtons: true });
      settings.setSettings({ music: false });
      const before = texts(settings);
      expect(before).toEqual(expect.arrayContaining(['НАСТРОЙКИ', 'ЗВУК', 'МУЗЫКА', 'ЗАНОВО']));
      settings.relocalize(i18nFor('en'));
      const after = texts(settings);
      expect(after).toEqual(expect.arrayContaining(['SETTINGS', 'SOUND', 'MUSIC', 'RESTART']));
      expect(after).not.toEqual(expect.arrayContaining(['НАСТРОЙКИ']));
      expect(settings.state).toBe('shown');
      expect(settings.currentSettings.music).toBe(false);
      settings.relocalize(i18nFor('ru'));
      expect(texts(settings)).toEqual(before);
      settings.destroy();
    });
  }

  it('explicit copy stays explicit; the languages keep their own names', () => {
    const { kit, settings } = settingsFor(READY_UI_STYLE_2, { title: 'OPTIONS' });
    open(kit, settings);
    settings.relocalize(i18nFor('en'));
    expect(texts(settings)).toEqual(expect.arrayContaining(['OPTIONS', 'SOUND', 'РУССКИЙ']));
    settings.destroy();
  });

  it('selectLanguage: a listed, different language with a drawn row only', () => {
    const log: string[] = [];
    const { kit, settings } = settingsFor(READY_UI_STYLE_1, {}, log);
    open(kit, settings);
    expect(settings.languageOptions).toBe(LANGUAGES);
    expect(settings.selectLanguage('de')).toBe(false);
    expect(settings.selectLanguage('ru')).toBe(false);
    expect(settings.selectLanguage('en')).toBe(true);
    expect([settings.currentLocale, ...log]).toEqual(['en', 'language:en']);
    settings.destroy();
  });
});
