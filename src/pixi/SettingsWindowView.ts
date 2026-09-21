import { Container, Sprite, type Text } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { UiButton } from './UiButton';
import { createLabel, fitLabelWidth } from './text';

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
}

/** Donor Settings prefab: 968 × 1102 panel, title fs 122 at −463, toggles 300 apart at y 45. */
const ITEM_GAP = 300;
const LABEL_OFFSET_Y = -185;
const MAIN_ITEM_Y = 0;
const GAME_ITEM_Y = -150;
const GAME_BUTTON_Y = 100;
const GAME_BUTTON_GAP = 150;
const GAME_BUTTON_SCALE = 0.72;

/**
 * Settings window with SOUND / MUSIC (optionally HAPTIC) toggles — a blue square button with the
 * red "deactivated" slash when off — an optional version caption and the donor's in-level
 * HOME / RESTART buttons. The view keeps no business state of its own beyond what it displays:
 * the host passes the current state in and receives `onToggle` calls.
 */
export class SettingsWindowView extends ModalWindow<SettingsWindowParams> {
  private readonly title: Text;
  private readonly version: Text;
  private readonly toggleRow: Container;
  private readonly toggles: Record<'sound' | 'music' | 'haptic', ToggleView>;
  private readonly homeButton: UiButton;
  private readonly restartButton: UiButton;
  private readonly hapticVisible: boolean;
  private readonly onToggle: (setting: 'sound' | 'music' | 'haptic', enabled: boolean) => void;
  private readonly onHome: (() => void) | null;
  private readonly onRestart: (() => void) | null;
  private settings: SettingsState = { sound: true, music: true, haptic: true };

  constructor(options: SettingsWindowViewOptions) {
    super({ ...options, id: options.id ?? 'settings-window', fit: options.fit ?? { widthRatio: 0.92, heightRatio: 0.72 } });
    this.onToggle = options.onToggle;
    this.onHome = options.onHome ?? null;
    this.onRestart = options.onRestart ?? null;
    this.hapticVisible = options.haptic ?? false;
    const t = this.textures;

    this.panel.addChildAt(this.sprite(t.settingsPanel, 968, 1102), 0);
    this.title = createLabel(this.theme, options.title ?? 'SETTINGS', { fontSize: 122, stroke: 11 });
    this.title.y = -463;
    fitLabelWidth(this.title, 760);
    this.panel.addChild(this.title);

    this.version = createLabel(this.theme, '', { fontSize: 59, stroke: false, fill: this.theme.colors.versionText });
    this.version.position.set(20, 471);
    this.panel.addChild(this.version);

    this.toggleRow = new Container();
    this.toggleRow.y = 45;
    this.panel.addChild(this.toggleRow);

    const makeToggle = (key: 'sound' | 'music' | 'haptic', texture: typeof t.settingsSound, label: string): ToggleView => {
      const button = new UiButton({ ui: this.ui, id: `${this.id}:${key}`, theme: this.theme, texture, width: 224, height: 220, pressScale: 0.9, onTap: () => this.toggle(key) });
      const off = this.sprite(t.settingsOff, 159, 162);
      off.visible = false;
      button.addChild(off);
      const text = createLabel(this.theme, label, { fontSize: 70, stroke: 11 });
      fitLabelWidth(text, 280);
      this.toggleRow.addChild(button, text);
      this.addButton(button);
      return { button, off, label: text };
    };
    this.toggles = {
      sound: makeToggle('sound', t.settingsSound, options.soundLabel ?? 'SOUND'),
      music: makeToggle('music', t.settingsMusic, options.musicLabel ?? 'MUSIC'),
      haptic: makeToggle('haptic', t.settingsHaptic, options.hapticLabel ?? 'HAPTIC')
    };

    this.homeButton = this.createButton('home', t.settingsBtnHome, options.homeLabel ?? 'EXIT', () => this.finish('home'), 599, 207, 70, -12);
    this.restartButton = this.createButton('restart', t.settingsBtnRestart, options.restartLabel ?? 'RESTART', () => this.finish('restart'), 599, 207, 70, -12);
    const restartIcon = this.sprite(t.settingsIconRestart, 170, 155);
    restartIcon.position.set(-170, -10);
    this.restartButton.addChild(restartIcon);
    if (this.restartButton.labelText) this.restartButton.labelText.x = 66;
    this.homeButton.setIdleScale(GAME_BUTTON_SCALE);
    this.restartButton.setIdleScale(GAME_BUTTON_SCALE);
    this.toggleRow.addChild(this.homeButton, this.restartButton);
    this.placeClose();
    this.layoutButtons(false);
  }

  protected applyParams(params: SettingsWindowParams): void {
    this.settings = { sound: params.sound, music: params.music, haptic: params.haptic ?? true };
    this.version.text = params.version ?? '';
    this.version.visible = Boolean(params.version);
    fitLabelWidth(this.version, 800);
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
    return { x: 402, y: -461 };
  }

  private layoutButtons(gameButtons: boolean): void {
    const items: Array<{ view: ToggleView; visible: boolean }> = [
      { view: this.toggles.sound, visible: true },
      { view: this.toggles.music, visible: true },
      { view: this.toggles.haptic, visible: this.hapticVisible && !gameButtons }
    ];
    const visible = items.filter((it) => it.visible);
    const startX = -((visible.length - 1) * ITEM_GAP) / 2;
    for (const it of items) {
      it.view.button.visible = it.visible;
      it.view.label.visible = it.visible;
      it.view.button.setEnabled(it.visible);
    }
    visible.forEach((it, index) => {
      const x = startX + index * ITEM_GAP;
      const y = gameButtons ? GAME_ITEM_Y : MAIN_ITEM_Y;
      it.view.button.position.set(x, y);
      it.view.label.position.set(x, y + LABEL_OFFSET_Y);
    });
    const showGame = gameButtons && (this.onHome !== null || this.onRestart !== null);
    this.homeButton.visible = showGame && this.onHome !== null;
    this.restartButton.visible = showGame && this.onRestart !== null;
    this.homeButton.setEnabled(this.homeButton.visible);
    this.restartButton.setEnabled(this.restartButton.visible);
    this.homeButton.position.set(0, GAME_BUTTON_Y);
    this.restartButton.position.set(0, GAME_BUTTON_Y + GAME_BUTTON_GAP);
  }

  private syncState(): void {
    this.toggles.sound.off.visible = !this.settings.sound;
    this.toggles.music.off.visible = !this.settings.music;
    this.toggles.haptic.off.visible = !(this.settings.haptic ?? true);
  }

  private toggle(key: 'sound' | 'music' | 'haptic'): void {
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
