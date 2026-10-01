import { Container, Rectangle, Sprite, type NineSliceSprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { createNineSlice } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import {
  resolveWindowSkin,
  selectWindowSkin,
  skinNineSlice,
  skinTextLook,
  type ReadyUiSkin,
  type ReadyUiSkinBox,
  type ReadyUiSkinSettingsActionLayout,
  type ReadyUiSkinSettingsBaseLayout,
  type ReadyUiSkinSettingsGameplayLayout,
  type ReadyUiSkinSettingsTextBox,
  type WindowSkinLook
} from './skin';
import { UiButton } from './UiButton';
import { createFigmaLabel, createLabel, figmaLabelAdvance, fitLabelWidth, placeFigmaLabel } from './text';

export interface SettingsState {
  sound: boolean;
  music: boolean;
  haptic?: boolean;
}

export interface SettingsWindowParams extends SettingsState {
  /** Caption at the bottom, e.g. `VERSION 1.0.75`. Omit to hide. */
  version?: string;
  /** Show the in-level HOME / RESTART buttons (donor: only on the game screen). Default false. */
  gameButtons?: boolean;
}

export interface SettingsWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  title?: string;
  soundLabel?: string;
  musicLabel?: string;
  hapticLabel?: string;
  homeLabel?: string;
  restartLabel?: string;
  /** Show the haptic toggle at all. Default false (donor hides it). */
  haptic?: boolean;
  /** Toggles fire immediately while the window stays open (like the donor). */
  onToggle: (setting: 'sound' | 'music' | 'haptic', enabled: boolean) => void;
  /** Close continuations for the in-level buttons. */
  onHome?: () => void;
  onRestart?: () => void;
}

interface ToggleView {
  button: UiButton;
  off: Sprite;
  label: Text;
  /** A style's own OFF button art (`offButtons`): swapped in while the setting is off. */
  onArt?: Texture;
  offArt?: Texture;
}

type SettingKey = 'sound' | 'music' | 'haptic';

/** Donor Settings prefab: 968 × 1102 panel, title fs 122 at −463, toggles 300 apart at y 45. */
const ITEM_GAP = 300;
const LABEL_OFFSET_Y = -185;
const MAIN_ITEM_Y = 0;
const GAME_ITEM_Y = -150;
const GAME_BUTTON_Y = 100;
const GAME_BUTTON_GAP = 150;
const GAME_BUTTON_SCALE = 0.72;

type SettingsLook = WindowSkinLook<'settings'>;
type SettingsLayout = ReadyUiSkinSettingsBaseLayout | ReadyUiSkinSettingsGameplayLayout;

/** The style drawing Settings, or null for the unchanged donor path. */
function settingsLook(options: SettingsWindowViewOptions): SettingsLook | null {
  const skin = selectWindowSkin('settings', undefined, options.theme?.skin);
  if (!skin) return null;
  const look = resolveWindowSkin('SettingsWindowView', 'settings', skin, options.textures, { variant: false, include: '' });
  if (options.haptic && look.layout.map.haptic === null) {
    throw new Error(`SettingsWindowView: style '${skin.id}' has no haptic toggle (windows.settings.map.haptic is null) — omit the haptic option`);
  }
  return look;
}

/** Modal options use the map layout initially; applyParams switches the fit before a gameplay show is laid out. */
function modalOptions(options: SettingsWindowViewOptions, look: SettingsLook | null): ModalWindowOptions {
  const id = options.id ?? 'settings-window';
  if (!look) return { ...options, id, fit: options.fit ?? { widthRatio: 0.92, heightRatio: 0.72 } };
  const { skin, layout } = look;
  return {
    ...options,
    id,
    backdropColor: options.backdropColor ?? skin.backdrop.color,
    backdropAlpha: options.backdropAlpha ?? skin.backdrop.alpha,
    fit: {
      widthRatio: layout.map.window.width / skin.frame.width,
      heightRatio: layout.map.window.height / skin.frame.height,
      ...(options.fit ?? {})
    }
  };
}

/**
 * Settings window with SOUND / MUSIC (optionally HAPTIC) toggles — a blue square button with the
 * red "deactivated" slash when off — an optional version caption and the donor's in-level
 * HOME / RESTART buttons. The view keeps no business state of its own beyond what it displays:
 * the host passes the current state in and receives `onToggle` calls.
 */
export class SettingsWindowView extends ModalWindow<SettingsWindowParams> {
  /** The Ready UI style drawing this window, or null (donor). */
  readonly skin: ReadyUiSkin | null;
  private readonly look: SettingsLook | null;
  private readonly styleFit: SettingsWindowViewOptions['fit'];
  private activeLayout: SettingsLayout | null;
  private readonly surface: Sprite | NineSliceSprite;
  private readonly title: Text;
  private readonly version: Text;
  private readonly toggleRow: Container;
  /** `haptic` is null when the style has no haptic toggle. */
  private readonly toggles: Record<'sound' | 'music', ToggleView> & { haptic: ToggleView | null };
  private readonly homeButton: UiButton;
  private readonly restartButton: UiButton;
  private readonly homeLabel: Text | null;
  private readonly restartLabel: Text | null;
  private readonly restartIcon: Sprite;
  private readonly homeIcon: Sprite | null = null;
  private readonly hapticVisible: boolean;
  private readonly onToggle: (setting: 'sound' | 'music' | 'haptic', enabled: boolean) => void;
  private readonly onHome: (() => void) | null;
  private readonly onRestart: (() => void) | null;
  private settings: SettingsState = { sound: true, music: true, haptic: true };

  constructor(options: SettingsWindowViewOptions) {
    const look = settingsLook(options);
    super(modalOptions(options, look));
    this.skin = look?.skin ?? null;
    this.look = look;
    this.styleFit = options.fit;
    this.activeLayout = look?.layout.map ?? null;
    this.onToggle = options.onToggle;
    this.onHome = options.onHome ?? null;
    this.onRestart = options.onRestart ?? null;
    this.hapticVisible = options.haptic ?? false;
    const t = this.textures;

    if (!look) {
      this.surface = this.sprite(t.settingsPanel, 968, 1102);
      this.panel.addChildAt(this.surface, 0);
      this.title = createLabel(this.theme, localizedText(options.title, this.i18n, 'core.settings.title', READY_UI_LEGACY_TEXT.settings.title), { fontSize: 122, stroke: 11 });
      this.title.y = -463;
      fitLabelWidth(this.title, 760);
      this.panel.addChild(this.title);

      this.version = createLabel(this.theme, '', { fontSize: 59, stroke: false, fill: this.theme.colors.versionText });
      this.version.position.set(20, 471);
      this.panel.addChild(this.version);

      this.toggleRow = new Container();
      this.toggleRow.y = 45;
      this.panel.addChild(this.toggleRow);

      const makeToggle = (key: 'sound' | 'music' | 'haptic', texture: Texture, label: string): ToggleView => {
        const button = this.addButton(new UiButton({ ui: this.ui, id: `${this.id}:${key}`, theme: this.theme, texture, width: 224, height: 220, pressScale: 0.9, onTap: () => this.toggle(key) }));
        const off = this.sprite(t.settingsOff, 159, 162);
        off.visible = false;
        button.addChild(off);
        const text = createLabel(this.theme, label, { fontSize: 70, stroke: 11 });
        fitLabelWidth(text, 280);
        this.toggleRow.addChild(button, text);
        return { button, off, label: text };
      };
      this.toggles = {
        sound: makeToggle('sound', t.settingsSound, localizedText(options.soundLabel, this.i18n, 'core.settings.sound', READY_UI_LEGACY_TEXT.settings.sound)),
        music: makeToggle('music', t.settingsMusic, localizedText(options.musicLabel, this.i18n, 'core.settings.music', READY_UI_LEGACY_TEXT.settings.music)),
        haptic: makeToggle('haptic', t.settingsHaptic, localizedText(options.hapticLabel, this.i18n, 'core.settings.haptic', READY_UI_LEGACY_TEXT.settings.haptic))
      };

      this.homeButton = this.createButton('home', t.settingsBtnHome, localizedText(options.homeLabel, this.i18n, 'core.settings.exit', READY_UI_LEGACY_TEXT.settings.exit), () => this.finish('home'), 599, 207, 70, -12);
      this.restartButton = this.createButton('restart', t.settingsBtnRestart, localizedText(options.restartLabel, this.i18n, 'core.settings.restart', READY_UI_LEGACY_TEXT.settings.restart), () => this.finish('restart'), 599, 207, 70, -12);
      this.homeLabel = this.homeButton.labelText;
      this.restartLabel = this.restartButton.labelText;
      this.restartIcon = this.sprite(t.settingsIconRestart, 170, 155);
      this.restartIcon.position.set(-170, -10);
      this.restartButton.addChild(this.restartIcon);
      if (this.restartLabel) this.restartLabel.x = 66;
      this.homeButton.setIdleScale(GAME_BUTTON_SCALE);
      this.restartButton.setIdleScale(GAME_BUTTON_SCALE);
      this.toggleRow.addChild(this.homeButton, this.restartButton);
      this.placeClose();
      this.layoutButtons(false);
      return;
    }

    const { skin, layout: layouts, art: A } = look;
    const L = layouts.map;
    const textLook = skinTextLook(skin);
    const label = (text: string, box: ReadyUiSkinSettingsTextBox, fill?: number): Text => {
      const node = createFigmaLabel(this.theme, text, box.fontSize, textLook);
      const color = box.fill ?? fill;
      if (color !== undefined) node.style.fill = color;
      return node;
    };
    this.surface = createNineSlice(A.settingsPanel, skinNineSlice(skin, 'settingsPanel'), L.window.width, L.window.height);
    this.title = label(localizedText(options.title, this.i18n, 'core.settings.title', READY_UI_LEGACY_TEXT.settings.title), L.title);
    this.version = label('', L.version, this.theme.colors.versionText);
    if (this.closeButton) {
      this.closeButton.background.texture = A.settingsClose;
      this.closeButton.background.width = L.close.width;
      this.closeButton.background.height = L.close.height;
    }
    this.toggleRow = new Container();

    const makeToggle = (key: SettingKey, texture: Texture, offArt: Texture | undefined, text: string): ToggleView => {
      const layout = L[key] as NonNullable<SettingsLayout[SettingKey]>;
      const button = this.addButton(new UiButton({
        ui: this.ui, id: `${this.id}:${key}`, theme: this.theme, texture,
        width: layout.button.width, height: layout.button.height, pressScale: 0.9, onTap: () => this.toggle(key)
      }));
      const off = this.sprite(A.settingsOff, layout.off.width, layout.off.height);
      off.visible = false;
      button.addChild(off);
      const caption = label(text, layout.label);
      this.toggleRow.addChild(button, caption);
      return { button, off, label: caption, ...(layouts.offButtons && offArt ? { onArt: texture, offArt } : {}) };
    };
    this.toggles = {
      sound: makeToggle('sound', A.settingsSound, A.settingsSoundOff, localizedText(options.soundLabel, this.i18n, 'core.settings.sound', READY_UI_LEGACY_TEXT.settings.sound)),
      music: makeToggle('music', A.settingsMusic, A.settingsMusicOff, localizedText(options.musicLabel, this.i18n, 'core.settings.music', READY_UI_LEGACY_TEXT.settings.music)),
      haptic: L.haptic ? makeToggle('haptic', A.settingsHaptic, A.settingsHapticOff, localizedText(options.hapticLabel, this.i18n, 'core.settings.haptic', READY_UI_LEGACY_TEXT.settings.haptic)) : null
    };

    const makeAction = (id: 'home' | 'restart', texture: Texture, text: string, layout: ReadyUiSkinSettingsActionLayout, onTap: () => void): { button: UiButton; label: Text } => {
      const button = this.addButton(new UiButton({
        ui: this.ui, id: `${this.id}:${id}`, theme: this.theme, texture,
        width: layout.button.width, height: layout.button.height, pressScale: 0.9, onTap
      }));
      const caption = label(text, layout.label);
      button.addChild(caption);
      return { button, label: caption };
    };
    const home = makeAction('home', A.settingsBtnHome, localizedText(options.homeLabel, this.i18n, 'core.settings.exit', READY_UI_LEGACY_TEXT.settings.exit), layouts.gameplay.home, () => this.finish('home'));
    const restart = makeAction('restart', A.settingsBtnRestart, localizedText(options.restartLabel, this.i18n, 'core.settings.restart', READY_UI_LEGACY_TEXT.settings.restart), layouts.gameplay.restart, () => this.finish('restart'));
    this.homeButton = home.button;
    this.homeLabel = home.label;
    this.restartButton = restart.button;
    this.restartLabel = restart.label;
    const restartIcon = layouts.gameplay.restart.icon;
    this.restartIcon = this.sprite(A.settingsIconRestart, restartIcon.width, restartIcon.height);
    this.restartButton.addChildAt(this.restartIcon, 1);
    const homeIcon = layouts.gameplay.home.icon;
    if (homeIcon) {
      this.homeIcon = this.sprite(A.settingsIconHome, homeIcon.width, homeIcon.height);
      this.homeButton.addChildAt(this.homeIcon, 1);
    }
    this.toggleRow.addChild(this.homeButton, this.restartButton);

    const toggleParts = this.toggleViews().flatMap((toggle) => [toggle.off, toggle.label]);
    const decorations = [this.surface, this.title, this.version, ...toggleParts, this.homeLabel, this.restartLabel, this.restartIcon, this.homeIcon];
    for (const node of decorations) {
      if (node) node.eventMode = 'none';
    }
    this.panel.addChildAt(this.surface, 0);
    this.panel.addChild(this.title, this.version, this.toggleRow);
    this.layoutButtons(false);
    this.placeClose();
  }

  protected applyParams(params: SettingsWindowParams): void {
    this.settings = { sound: params.sound, music: params.music, haptic: params.haptic ?? true };
    this.version.text = params.version ?? '';
    this.version.visible = Boolean(params.version);
    if (!this.look) fitLabelWidth(this.version, 800);
    this.layoutButtons(params.gameButtons ?? false);
    this.syncState();
  }

  /** Reflect a state change made elsewhere (e.g. a hardware mute) while the window is open. */
  setSettings(state: Partial<SettingsState>): void {
    this.settings = { ...this.settings, ...state };
    this.syncState();
  }

  get currentSettings(): SettingsState {
    return { ...this.settings };
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    const L = this.activeLayout;
    return L ? { x: this.px(L, L.close.x + L.close.width / 2), y: this.py(L, L.close.y + L.close.height / 2) } : { x: 402, y: -461 };
  }

  protected override panelBounds(): Rectangle {
    const L = this.activeLayout;
    return L ? new Rectangle(-L.window.width / 2, -L.window.height / 2, L.window.width, L.window.height) : super.panelBounds();
  }

  private layoutButtons(gameButtons: boolean): void {
    const items: Array<{ view: ToggleView; visible: boolean }> = [
      { view: this.toggles.sound, visible: true },
      { view: this.toggles.music, visible: true },
      ...(this.toggles.haptic ? [{ view: this.toggles.haptic, visible: this.hapticVisible && !gameButtons }] : [])
    ];
    const visible = items.filter((it) => it.visible);
    for (const it of items) {
      it.view.button.visible = it.visible;
      it.view.label.visible = it.visible;
      it.view.button.setEnabled(it.visible);
    }
    if (this.look) this.applySkinLayout(gameButtons);
    else {
      const startX = -((visible.length - 1) * ITEM_GAP) / 2;
      visible.forEach((it, index) => {
        const x = startX + index * ITEM_GAP;
        const y = gameButtons ? GAME_ITEM_Y : MAIN_ITEM_Y;
        it.view.button.position.set(x, y);
        it.view.label.position.set(x, y + LABEL_OFFSET_Y);
      });
    }
    const showGame = gameButtons && (this.onHome !== null || this.onRestart !== null);
    this.homeButton.visible = showGame && this.onHome !== null;
    this.restartButton.visible = showGame && this.onRestart !== null;
    this.homeButton.setEnabled(this.homeButton.visible);
    this.restartButton.setEnabled(this.restartButton.visible);
    if (!this.look) {
      this.homeButton.position.set(0, GAME_BUTTON_Y);
      this.restartButton.position.set(0, GAME_BUTTON_Y + GAME_BUTTON_GAP);
    }
  }

  private applySkinLayout(gameButtons: boolean): void {
    const look = this.look as SettingsLook;
    const L = gameButtons ? look.layout.gameplay : look.layout.map;
    this.activeLayout = L;
    this.fit.widthRatio = this.styleFit?.widthRatio ?? L.window.width / look.skin.frame.width;
    this.fit.heightRatio = this.styleFit?.heightRatio ?? L.window.height / look.skin.frame.height;

    const caps = skinNineSlice(look.skin, 'settingsPanel');
    const pad = caps.pad ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const fullWidth = L.window.width + pad.left + pad.right;
    const fullHeight = L.window.height + pad.top + pad.bottom;
    this.surface.position.set(0, 0);
    this.surface.width = fullWidth;
    this.surface.height = fullHeight;
    // the window box stays centred on the origin at either height (the bleed may differ top / bottom)
    this.surface.anchor.set((pad.left + L.window.width / 2) / fullWidth, (pad.top + L.window.height / 2) / fullHeight);
    placeFigmaLabel(this.title, { ...this.panelBox(L, L.title), align: 'center' });
    placeFigmaLabel(this.version, { ...this.panelBox(L, L.version), align: 'center' });

    for (const key of ['sound', 'music', 'haptic'] as const) {
      const toggle = this.toggles[key];
      const layout = L[key];
      if (!toggle || !layout) continue;
      this.placeButton(L, toggle.button, layout.button);
      placeFigmaLabel(toggle.label, { ...this.panelBox(L, layout.label), align: 'center' });
      toggle.off.position.set(
        layout.off.x + layout.off.width / 2 - layout.button.width / 2,
        layout.off.y + layout.off.height / 2 - layout.button.height / 2
      );
      toggle.off.width = layout.off.width;
      toggle.off.height = layout.off.height;
    }

    if (gameButtons) {
      const gameplay = L as ReadyUiSkinSettingsGameplayLayout;
      this.placeAction(gameplay, this.restartButton, this.restartLabel as Text, this.restartIcon, gameplay.restart);
      this.placeAction(gameplay, this.homeButton, this.homeLabel as Text, this.homeIcon, gameplay.home);
    }
    this.placeClose();
  }

  private placeAction(
    layout: ReadyUiSkinSettingsGameplayLayout,
    button: UiButton,
    label: Text,
    icon: Sprite | null,
    action: ReadyUiSkinSettingsActionLayout
  ): void {
    this.placeButton(layout, button, action.button);
    // a hugging row: the runtime text's advance replaces the sample box width, the icon and label shift together
    const width = action.hug ? Math.min(figmaLabelAdvance(label), action.hug.maxWidth) : action.label.width;
    const shift = action.hug ? (action.label.width - width) / 2 : 0;
    placeFigmaLabel(label, {
      x: action.label.x + shift - action.button.width / 2,
      y: action.label.y - action.button.height / 2,
      width,
      height: action.label.height,
      align: action.hug ? 'left' : 'center'
    });
    if (icon && action.icon) {
      icon.position.set(
        action.icon.x + shift + action.icon.width / 2 - action.button.width / 2,
        action.icon.y + action.icon.height / 2 - action.button.height / 2
      );
      icon.width = action.icon.width;
      icon.height = action.icon.height;
    }
  }

  private placeButton(layout: SettingsLayout, button: UiButton, box: ReadyUiSkinBox): void {
    button.position.set(this.px(layout, box.x + box.width / 2), this.py(layout, box.y + box.height / 2));
    button.background.width = box.width;
    button.background.height = box.height;
    button.hitArea = new Rectangle(-box.width / 2, -box.height / 2, box.width, box.height);
  }

  private panelBox(layout: SettingsLayout, box: ReadyUiSkinBox): ReadyUiSkinBox {
    return { x: this.px(layout, box.x), y: this.py(layout, box.y), width: box.width, height: box.height };
  }

  private px(layout: SettingsLayout, x: number): number {
    return x - layout.window.width / 2;
  }

  private py(layout: SettingsLayout, y: number): number {
    return y - layout.window.height / 2;
  }

  private toggleViews(): ToggleView[] {
    return [this.toggles.sound, this.toggles.music, ...(this.toggles.haptic ? [this.toggles.haptic] : [])];
  }

  private syncState(): void {
    this.syncToggle(this.toggles.sound, this.settings.sound);
    this.syncToggle(this.toggles.music, this.settings.music);
    if (this.toggles.haptic) this.syncToggle(this.toggles.haptic, this.settings.haptic ?? true);
  }

  private syncToggle(toggle: ToggleView, enabled: boolean): void {
    toggle.off.visible = !enabled;
    if (!toggle.onArt || !toggle.offArt) return;
    const background = toggle.button.background;
    const { width, height } = background;
    background.texture = enabled ? toggle.onArt : toggle.offArt;
    background.width = width;
    background.height = height;
  }

  private toggle(key: SettingKey): void {
    const next = !(this.settings[key] ?? true);
    this.settings = { ...this.settings, [key]: next };
    this.syncState();
    this.onToggle(key, next);
  }

  private finish(action: 'home' | 'restart'): void {
    this.close('button', () => {
      if (action === 'home') this.onHome?.();
      else this.onRestart?.();
    });
  }
}
