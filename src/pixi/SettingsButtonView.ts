import { Container, type Texture } from 'pixi.js';
import type { UiRuntime } from '../index';
import type { ReadyUiTextures } from './assets';
import { DONOR_HUD_LAYOUT, type HudResizeOptions } from './HudView';
import { resolveSkinView, selectSkinView, type ReadyUiSkin, type ReadyUiSkinSettingsButtonLayout } from './skin';
import { UiButton } from './UiButton';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';

export interface SettingsButtonViewOptions {
  ui: UiRuntime;
  textures: ReadyUiTextures;
  /** The style whose settings button it draws (`theme.skin` covering `settingsButton`); no style = the donor HUD gear. */
  theme?: ReadyUiThemeOverrides;
  /** Unique id per UiRuntime; the button registers as `<id>`. Default `settings-button`. */
  id?: string;
  /** Settled tap (the host opens its Settings). Without it the button is drawn but inert. */
  onTap?: () => void;
  width?: number;
  height?: number;
}

/** The donor look: HudView's gear (its back, its icon centred) at the donor HUD's right / settings-top margins. */
const DONOR_GEAR = DONOR_HUD_LAYOUT.gear!;
const DONOR_LAYOUT: ReadyUiSkinSettingsButtonLayout = {
  back: { width: DONOR_GEAR.backWidth, height: DONOR_GEAR.backHeight },
  icon: { x: (DONOR_GEAR.backWidth - DONOR_GEAR.size) / 2, y: (DONOR_GEAR.backHeight - DONOR_GEAR.size) / 2, width: DONOR_GEAR.size, height: DONOR_GEAR.size },
  margins: { top: DONOR_HUD_LAYOUT.margins.settingsTop, right: DONOR_HUD_LAYOUT.margins.right },
  minHitSize: DONOR_GEAR.minHitSize
};

/**
 * The settings button of a screen that has no HudView gear (a gameplay screen): the style's `settingsButton` — its back
 * with the gear icon — in the top-right corner of the safe area, `margins.right` from its right edge and `margins.top`
 * from its top, at the design contain-fit scale (theme_light_6: a 214 square, 90 / 90 on the gameplay and victory
 * screens). A host that keeps a row above it (a HUD) passes that row's height in `insets.top`. Visual only: a tap is
 * the host's `onTap` (open its Settings) — it never opens a window by itself.
 */
export class SettingsButtonView extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  /** The style drawing the button, or null (donor). */
  readonly skin: ReadyUiSkin | null;
  readonly button: UiButton;
  private readonly layout: ReadyUiSkinSettingsButtonLayout;

  constructor(options: SettingsButtonViewOptions) {
    super();
    this.id = options.id ?? 'settings-button';
    this.theme = resolveTheme(options.theme);
    const skin = selectSkinView('settingsButton', this.theme.skin);
    this.skin = skin;
    let back: Texture;
    let icon: Texture;
    if (skin) {
      const look = resolveSkinView('SettingsButtonView', 'settingsButton', skin, options.textures);
      this.layout = look.layout;
      back = look.art.settingsButtonBack!;
      icon = look.art.settingsButtonIcon!;
    } else {
      this.layout = DONOR_LAYOUT;
      back = options.textures.hudGearBack;
      icon = options.textures.hudGear;
    }
    const L = this.layout;
    this.button = new UiButton({
      ui: options.ui,
      id: this.id,
      theme: this.theme,
      texture: back,
      width: L.back.width,
      height: L.back.height,
      icon,
      iconSize: Math.max(L.icon.width, L.icon.height),
      // the icon box's centre, from the back's centre
      iconX: L.icon.x + L.icon.width / 2 - L.back.width / 2,
      iconY: L.icon.y + L.icon.height / 2 - L.back.height / 2,
      pressScale: 0.9,
      onTap: options.onTap ?? (() => {}),
      minHitSize: L.minHitSize
    });
    if (!options.onTap) this.button.setEnabled(false);
    this.addChild(this.button);
    this.resize(options.width ?? 390, options.height ?? 844);
  }

  /** Places the button in the top-right corner of the safe area (viewport px). */
  resize(width: number, height: number, options: HudResizeOptions = {}): void {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    const top = Math.max(0, options.insets?.top ?? 0);
    const right = Math.max(0, options.insets?.right ?? 0);
    const s = Math.min(w / this.theme.designWidth, h / this.theme.designHeight);
    const L = this.layout;
    this.button.setIdleScale(s);
    this.button.position.set(w - right - (L.margins.right + L.back.width / 2) * s, top + (L.margins.top + L.back.height / 2) * s);
  }

  setEnabled(enabled: boolean): void {
    this.button.setEnabled(enabled);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return;
    this.button.destroy(); // disposes its ButtonController (UiButton guards a second destroy)
    super.destroy(options ?? { children: true });
  }
}
