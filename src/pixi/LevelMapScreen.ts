import { Container, type Text } from 'pixi.js';
import type { LocalizationTextProvider, MotionRuntime, UiRuntime } from '../index';
import type { ReadyUiTextures } from './assets';
import { BottomNavView, type BottomNavViewOptions } from './BottomNavView';
import { HudView, type HudInsets, type HudViewOptions } from './HudView';
import { LevelMapView, type LevelMapFocusInfo, type LevelMapViewOptions } from './LevelMapView';
import { READY_UI_EN } from './locales/en';
import { resolveSkinView, selectSkinView, type ReadyUiSkinLevelMapScreenLayout, type ReadyUiSkinTextBox } from './skin';
import { applyTextResolution, createFigmaLabel, placeFigmaLabel } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';
import { UiButton } from './UiButton';

type Shared = 'ui' | 'motion' | 'textures' | 'theme' | 'i18n' | 'id' | 'width' | 'height';

export interface LevelMapScreenInsets extends HudInsets {
  bottom?: number;
}

export interface LevelMapScreenResizeOptions {
  /** Safe-area / reserved space in viewport px. */
  insets?: LevelMapScreenInsets;
  pixelRatio?: number;
}

export interface LevelMapScreenOptions {
  ui: UiRuntime;
  motion: MotionRuntime;
  textures: ReadyUiTextures;
  /** Must carry a style that covers `levelMapScreen` and `bottomNav`; the same theme goes to every part. */
  theme?: ReadyUiThemeOverrides;
  i18n?: LocalizationTextProvider;
  /** Unique id per UiRuntime; the parts register as `<id>:map`, `<id>:hud`, `<id>:nav`, `<id>:play`. Default `level-map-screen`. */
  id?: string;
  /** The LevelMapView part (progress and its callbacks); `onFocusChange` still reaches the host. */
  map: Omit<LevelMapViewOptions, Shared>;
  /** The HudView part (values and taps). */
  hud?: Omit<HudViewOptions, Shared>;
  /** The BottomNavView part (items, selection and its callbacks). */
  nav: Omit<BottomNavViewOptions, Shared>;
  /** Settled tap on PLAY with the map's playable level under the focus (`map.selectedLevel`). */
  onPlay: (level: number) => void;
  /** PLAY caption; default the localized `core.level_map.play`. */
  playLabel?: string;
  /** The level caption under it, `{level}` replaced; default the localized `core.level_map.level`. */
  levelLabel?: string;
  width?: number;
  height?: number;
}

/**
 * The level-map screen composition (renderer side only): the map with its background, PLAY, the bottom navigation and
 * the HUD, laid out together. It owns no game state and no routing — it wires PLAY to the map's playable level and
 * places the parts: the HUD at the top, the navigation at the bottom edge, PLAY the style's distance above the
 * navigation, the map from the top inset down to PLAY. Each part keeps its own API (`screen.map`, `screen.hud`,
 * `screen.nav`, `screen.play`).
 */
export class LevelMapScreen extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  readonly map: LevelMapView;
  readonly hud: HudView;
  readonly nav: BottomNavView;
  readonly play: UiButton;
  private readonly layout: ReadyUiSkinLevelMapScreenLayout;
  private readonly playText: Text;
  private readonly levelText: Text;
  private readonly levelLabel: (level: number) => string;
  private shownLevel = 0;
  private pixelRatio = 1;
  private disposed = false;

  constructor(options: LevelMapScreenOptions) {
    super();
    this.id = options.id ?? 'level-map-screen';
    this.theme = resolveTheme(options.theme);
    const skin = selectSkinView('levelMapScreen', this.theme.skin);
    if (!skin) throw new Error("LevelMapScreen needs a Ready UI style that covers 'levelMapScreen' (theme.skin)");
    const look = resolveSkinView('LevelMapScreen', 'levelMapScreen', skin, options.textures);
    this.layout = look.layout;
    const shared = { ui: options.ui, motion: options.motion, textures: options.textures, ...(options.theme ? { theme: options.theme } : {}), ...(options.i18n ? { i18n: options.i18n } : {}) };
    const i18n = options.i18n;
    const template = options.levelLabel;
    this.levelLabel = (level) => template !== undefined
      ? template.replace('{level}', String(level))
      : i18n?.t('core.level_map.level', { level }) ?? READY_UI_EN['core.level_map.level'].replace('{level}', String(level));

    const hostFocus = options.map.onFocusChange;
    this.map = new LevelMapView({
      ...shared,
      ...options.map,
      id: `${this.id}:map`,
      onFocusChange: (info: LevelMapFocusInfo) => {
        this.refreshPlayLevel();
        hostFocus?.(info);
      }
    });

    const play = this.layout.play;
    this.play = new UiButton({
      ui: options.ui,
      id: `${this.id}:play`,
      theme: this.theme,
      texture: look.art.playButton!,
      width: play.width,
      height: play.height,
      onTap: () => options.onPlay(this.map.selectedLevel)
    });
    const textLook = { strokeOutside: 0, shadowY: 0, fill: play.textFill, ...(skin.font ? { fontFamily: skin.font.family } : {}) };
    this.playText = createFigmaLabel(this.theme, options.playLabel ?? i18n?.t('core.level_map.play') ?? READY_UI_EN['core.level_map.play'], play.label.fontSize, textLook);
    this.levelText = createFigmaLabel(this.theme, '', play.level.fontSize, textLook);
    this.playText.eventMode = 'none';
    this.levelText.eventMode = 'none';
    this.play.addChild(this.playText, this.levelText);
    placeFigmaLabel(this.playText, slot(play.label));

    this.nav = new BottomNavView({ ...shared, ...options.nav, id: `${this.id}:nav` });
    this.hud = new HudView({ ...shared, ...(options.hud ?? {}), id: `${this.id}:hud` });

    // bottom → top: map (with its background), PLAY, navigation, HUD
    this.addChild(this.map, this.play, this.nav, this.hud);
    this.refreshPlayLevel();
    this.resize(options.width ?? 390, options.height ?? 844);
  }

  /** The level PLAY launches (the map's playable level under the focus). */
  get playLevel(): number {
    return this.map.selectedLevel;
  }

  /** Re-reads the map's playable level into the PLAY caption (called on every focus change; call it after `map.setProgress` if needed). */
  refreshPlayLevel(): void {
    if (!this.levelText) return; // the map reports its first focus while it is being built
    const level = this.map.selectedLevel;
    if (level === this.shownLevel) return;
    this.shownLevel = level;
    this.levelText.text = this.levelLabel(level);
    placeFigmaLabel(this.levelText, slot(this.layout.play.level));
    applyTextResolution(this.play, this.play.scale.x * this.pixelRatio);
  }

  resize(width: number, height: number, options: LevelMapScreenResizeOptions = {}): void {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    const insets = options.insets ?? {};
    const top = Math.max(0, insets.top ?? 0);
    const bottom = Math.max(0, insets.bottom ?? 0);
    const left = Math.max(0, insets.left ?? 0);
    const right = Math.max(0, insets.right ?? 0);
    this.pixelRatio = options.pixelRatio ?? this.pixelRatio;
    const pixelRatio = this.pixelRatio;
    const s = Math.min(w / this.theme.designWidth, h / this.theme.designHeight);

    this.hud.resize(w, h, { insets: { top, left, right }, pixelRatio });
    this.nav.resize(w, h, { insets: { bottom, left, right }, pixelRatio });

    // PLAY: the style's distance above the navigation, centred, never wider than the viewport
    const play = this.layout.play;
    const scale = s * Math.min(1, (w - left - right) / (play.width * s));
    this.play.setIdleScale(scale);
    const playY = this.nav.top - play.aboveNav * s;
    this.play.position.set(left + (w - left - right) / 2, playY);
    applyTextResolution(this.play, scale * pixelRatio);

    // the map runs from the top inset (under the HUD) down to PLAY's top edge
    const playTop = playY - (play.height / 2) * scale;
    this.map.resize(w, h, { insets: { top, bottom: Math.max(0, h - playTop), left, right }, pixelRatio });
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.play.destroy();
    super.destroy(options ?? { children: true });
  }
}

function slot(box: ReadyUiSkinTextBox) {
  return { x: box.x, y: box.y, width: box.width, height: box.height, align: 'center' as const };
}
