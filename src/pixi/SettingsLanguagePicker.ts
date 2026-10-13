// SettingsLanguagePicker — the device's own language list for the Settings language row.
//
// A Pixi game cannot open the system picker itself: iOS Safari opens a `<select>` only for a REAL tap on that element
// (a scripted `click()` / `focus()` / `showPicker()` is ignored or refused there). So the picker is one transparent native
// `<select>` laid exactly over the row's button while the Settings window is up: the player's tap lands on the select,
// and the browser shows its own list — the iOS wheel, the Android dialog, a desktop drop-down. The choice comes back
// through the select's `change` and goes to `SettingsWindowView.selectLanguage` (the row shows it, `onLanguage` reports
// it; applying the locale stays the host's). The options are the window's `languages` — the host lists only the locales
// it has copy for.
//
// Host-driven, like the kit's other DOM pieces: the host calls `update()` from its frame (or after each layout) — the
// select follows the button (the window's entrance included) and is `display: none` whenever the row is not on screen
// (the window leaving, hidden or destroyed, a hidden ancestor, no row), so it never takes a tap meant for the game.
// It owns ONE element and that element's `change` listener — no timer, no requestAnimationFrame, no observer, no window /
// document listener, no synthetic event. `destroy()` removes both.
import type { Container } from 'pixi.js';
import type { SettingsLanguage, SettingsWindowView } from './SettingsWindowView';

export interface SettingsLanguagePickerOptions {
  /** The Settings window whose language row the picker serves (`languageButton`, `languageOptions`, `selectLanguage`). */
  settings: SettingsWindowView;
  /** The canvas the window is drawn into: the stage's coordinates are mapped onto its box on the page. */
  canvas: HTMLCanvasElement;
  /**
   * The stage's logical size (Pixi `app.screen`, read live on every `update`). Default: the canvas' CSS size — the same
   * thing with `autoDensity`.
   */
  screen?: { readonly width: number; readonly height: number };
  /** Where the select is appended (as the last child); default the canvas' parent. It is `position: fixed` either way. */
  container?: HTMLElement;
  /** Default 10: above the canvas, under full-screen covers (OrientationGuard). */
  zIndex?: number;
  /** A language's name in the native list; default its `label` (the row's text). */
  optionLabel?: (language: SettingsLanguage) => string;
  /** The select's accessible name. Default 'Language'. */
  label?: string;
}

/** The node and every ancestor are visible (a flag walk: the render-time global status may be a frame old). */
function shownOnStage(node: Container): boolean {
  for (let current: Container | null = node; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

/** The part of DOMRect the picker reads. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class SettingsLanguagePicker {
  /** The native select, or null when the canvas has no document (a headless host): then the picker does nothing. */
  readonly element: HTMLSelectElement | null;

  private readonly settings: SettingsWindowView;
  private readonly canvas: HTMLCanvasElement;
  private readonly screen: { readonly width: number; readonly height: number } | null;
  private readonly optionLabel: (language: SettingsLanguage) => string;
  private optionsKey = '';
  private placeKey = '';
  private isDestroyed = false;
  private readonly onChange = (): void => {
    const select = this.element;
    if (!select) return;
    const chosen = select.value;
    // the desktop list keeps focus after a choice: drop it so arrow keys do not keep switching the language
    select.blur();
    if (!this.settings.destroyed) this.settings.selectLanguage(chosen);
  };

  /** Use `createSettingsLanguagePicker(options)`. */
  constructor(options: SettingsLanguagePickerOptions) {
    this.settings = options.settings;
    this.canvas = options.canvas;
    this.screen = options.screen ?? null;
    this.optionLabel = options.optionLabel ?? ((language) => language.label);
    const doc = options.canvas.ownerDocument as Document | null | undefined;
    const container = options.container ?? options.canvas.parentElement ?? doc?.body ?? null;
    if (!doc || !container) {
      this.element = null;
      return;
    }
    const select = doc.createElement('select');
    select.dataset.gameCore = 'settings-language-picker';
    select.setAttribute('aria-label', options.label ?? 'Language');
    Object.assign(select.style, {
      position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: String(options.zIndex ?? 10), display: 'none',
      margin: '0', padding: '0', border: '0', borderRadius: '0', boxSizing: 'border-box',
      // invisible, yet the browser's own control: the tap opens the system list (the Pixi row stays the visual)
      opacity: '0', background: 'transparent', color: 'transparent', appearance: 'none', webkitAppearance: 'none',
      // 16 px: iOS zooms the page into a focused control with smaller text
      fontSize: '16px', cursor: 'pointer', pointerEvents: 'auto', touchAction: 'manipulation', webkitTapHighlightColor: 'transparent'
    });
    select.addEventListener('change', this.onChange);
    container.append(select);
    this.element = select;
    this.update();
  }

  /** True while the select covers the language row (it takes the taps there). */
  get active(): boolean {
    return this.element !== null && this.element.style.display !== 'none';
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * Puts the select over the row's button (or hides it). Cheap when nothing moved — the host calls it every frame or
   * after each layout; it touches the DOM only on a change.
   */
  update(): void {
    const select = this.element;
    if (!select || this.isDestroyed) return;
    const settings = this.settings;
    const state = settings.destroyed ? 'hidden' : settings.state;
    const button = state === 'entering' || state === 'shown' ? settings.languageButton : null;
    if (!button || !shownOnStage(button)) {
      this.hide();
      return;
    }
    this.syncOptions(settings.languageOptions);
    const current = settings.currentLocale ?? '';
    if (select.value !== current) select.value = current;
    const stage = button.background.getBounds();
    const page = this.canvas.getBoundingClientRect() as Box;
    const sx = page.width / Math.max(1, this.screen?.width ?? page.width);
    const sy = page.height / Math.max(1, this.screen?.height ?? page.height);
    const box = {
      left: page.left + stage.x * sx, top: page.top + stage.y * sy, width: stage.width * sx, height: stage.height * sy
    };
    const key = [box.left, box.top, box.width, box.height].map((v) => v.toFixed(2)).join();
    if (key === this.placeKey) return;
    this.placeKey = key;
    Object.assign(select.style, {
      left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, display: 'block'
    });
  }

  /** Removes the select and its listener. Repeat-safe. */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    const select = this.element;
    if (!select) return;
    select.removeEventListener('change', this.onChange);
    select.remove();
  }

  private hide(): void {
    const select = this.element;
    if (!select || this.placeKey === 'hidden') return;
    this.placeKey = 'hidden';
    select.style.display = 'none';
    select.blur();
  }

  /** One `<option>` per language, rebuilt only when the list changes. */
  private syncOptions(languages: readonly SettingsLanguage[]): void {
    const select = this.element as HTMLSelectElement;
    const options = languages.map((language) => ({ value: language.id, text: this.optionLabel(language) }));
    const key = JSON.stringify(options);
    if (key === this.optionsKey) return;
    this.optionsKey = key;
    select.replaceChildren(...options.map(({ value, text }) => {
      const option = select.ownerDocument.createElement('option');
      option.value = value;
      option.textContent = text;
      return option;
    }));
  }
}

/** The native language list over a Settings window's language row (see `SettingsLanguagePicker`). */
export function createSettingsLanguagePicker(options: SettingsLanguagePickerOptions): SettingsLanguagePicker {
  return new SettingsLanguagePicker(options);
}
