import { Container, type Text } from 'pixi.js';
import type { LocalizationTextProvider, MotionRuntime, UiRuntime } from '../index';
import type { ReadyUiTextures } from './assets';
import { BottomNavView, type BottomNavItem, type BottomNavViewOptions } from './BottomNavView';
import { HudView, type HudInsets, type HudViewOptions } from './HudView';
import { LevelMapView, type LevelMapFocusInfo, type LevelMapViewOptions } from './LevelMapView';
import { localizedText } from './localization';
import { READY_UI_EN } from './locales/en';
import { resolveSkinView, selectSkinView, skinTextLook, type ReadyUiSkinLevelMapScreenLayout, type ReadyUiSkinRole, type ReadyUiSkinTextBox } from './skin';
import { applyTextResolution, createFigmaLabel, placeFigmaLabel } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';
import { UiButton, type UiButtonBreathing } from './UiButton';

type Shared = 'ui' | 'motion' | 'textures' | 'theme' | 'i18n' | 'id' | 'width' | 'height';

/** The level-map navigation slots, left to right: SHOP, HOME (this screen: drawn selected), LOCK (a future feature). */
export type LevelMapNavSlotId = 'shop' | 'home' | 'lock';

/** One level-map navigation slot. What it opens (a shop, a teaser) stays the host's; Core only reports the tap. */
export interface LevelMapNavSlot {
  /** Settled tap. Absent on SHOP / HOME = the slot is disabled: drawn as the style draws it, inert. LOCK still shakes. */
  onTap?: () => void;
  /** Start disabled even with `onTap` (enable it later with `screen.nav.setDisabled(id, false)`); a disabled LOCK does not shake. Default false. */
  disabled?: boolean;
  /** Caption, already localized; default the localized `core.nav.<slot>` (SHOP / HOME / LOCK). */
  label?: string;
}

/**
 * The level-map navigation contract, the same for every style: SHOP | HOME | LOCK, always all three. SHOP = the
 * shop slot (active with `onTap`, else disabled), HOME = this screen (selected), LOCK = a future feature, drawn in
 * the style's locked state: a tap shakes it and reports to its `onTap` when there is one (callback optional);
 * `lock: { disabled: true }` makes it inert. A SHOP / HOME slot left out is drawn and inert.
 */
export interface LevelMapNavSlots {
  shop?: LevelMapNavSlot;
  home?: LevelMapNavSlot;
  lock?: LevelMapNavSlot;
}

/** `LevelMapScreenOptions.nav`: the three level-map slots, or a generic BottomNavView item list (the earlier form, kept). */
export type LevelMapScreenNav = LevelMapNavSlots | Omit<BottomNavViewOptions, Shared>;

/** The slots' fixed order, item icons (style roles) and states; the art and boxes are the style's. */
const NAV_SLOTS: readonly { readonly id: LevelMapNavSlotId; readonly icon?: ReadyUiSkinRole; readonly locked?: true }[] = [
  { id: 'shop', icon: 'iconShop' },
  { id: 'home', icon: 'iconHome' },
  { id: 'lock', locked: true }
];
const NAV_LABEL_KEYS = { shop: 'core.nav.shop', home: 'core.nav.home', lock: 'core.nav.lock' } as const;

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
  /**
   * The LevelMapView part (progress and its callbacks); `onFocusChange` still reaches the host. A tap on an open node
   * SELECTS its level (scrolls it under the focus, so PLAY shows and launches it); `onSelectLevel`, when given, is
   * still told about the tap, as before.
   */
  map: Omit<LevelMapViewOptions, Shared | 'onSelectLevel'> & { onSelectLevel?: LevelMapViewOptions['onSelectLevel'] };
  /** The HudView part (values and taps). */
  hud?: Omit<HudViewOptions, Shared>;
  /** The bottom navigation: the SHOP | HOME | LOCK slots (default: all three drawn; SHOP / HOME inert, LOCK shakes), or a generic item list. */
  nav?: LevelMapScreenNav;
  /** Settled tap on PLAY with the selected level: the map's playable level under the focus (`map.selectedLevel`). */
  onPlay: (level: number) => void;
  /** PLAY caption; default the localized `core.level_map.play`. */
  playLabel?: string;
  /**
   * Opt-in idle breathing of PLAY (the screen's primary call to action): `true` = UI_BUTTON_BREATHING (4 % over 1.3 s),
   * an object overrides its numbers. Default off. Stop / restart it with `screen.play.setBreathing(…)`.
   */
  playBreathing?: boolean | Partial<UiButtonBreathing>;
  /** The level caption under it (when the style draws one), `{level}` replaced; default the localized `core.level_map.level`. */
  levelLabel?: string;
  width?: number;
  height?: number;
}

/**
 * The level-map screen composition (renderer side only): the map with its background, PLAY, the bottom navigation and
 * the HUD, laid out together. One functional contract for every style — select a level (scroll, or tap its node) →
 * PLAY → `onPlay(level)`; the navigation's SHOP | HOME | LOCK slots → their `onTap` — while the style decides only
 * how they look. It owns no game state and no routing: it places the parts (the HUD at the top, the navigation at the
 * bottom edge, PLAY the style's distance above the navigation, the map from the top inset down to PLAY). Each part
 * keeps its own API (`screen.map`, `screen.hud`, `screen.nav`, `screen.play`). A host that launches from a node uses
 * `LevelMapView` alone, unchanged.
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
  /** null = the style's PLAY has no level caption. */
  private readonly levelText: Text | null;
  private readonly levelLabel: (level: number) => string;
  private built = false;
  /**
   * The level a node tap selected while the map is still scrolling it under the focus: PLAY launches it, not a level
   * the scroll is passing. Cleared when the focus arrives, when the focus moves away from it (a drag, a fling, the
   * host's own scroll) and on the next press on the map.
   */
  private pendingLevel: number | null = null;
  private lastFocus = 0;
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
    const hostSelect = options.map.onSelectLevel;
    this.map = new LevelMapView({
      ...shared,
      ...options.map,
      id: `${this.id}:map`,
      // a node tap selects its level; PLAY launches it (a host still launching from the node is told as before)
      onSelectLevel: (level, state) => {
        this.pendingLevel = level;
        this.map.scrollToLevel(level);
        if (this.map.selectedLevel === level) this.pendingLevel = null; // already under the focus
        this.refreshPlayLevel();
        hostSelect?.(level, state);
      },
      onFocusChange: (info: LevelMapFocusInfo) => {
        this.trackPendingLevel(info.focusLevel);
        this.refreshPlayLevel();
        hostFocus?.(info);
      }
    });
    this.lastFocus = this.map.focusLevel;
    // a new press on the map (a drag, another node) replaces a selection still scrolling in; a node tap sets it again
    const takeOver = (): void => {
      this.pendingLevel = null;
    };
    this.map.on('pointerdown', takeOver);
    this.map.on('wheel', takeOver);

    const play = this.layout.play;
    this.play = new UiButton({
      ui: options.ui,
      id: `${this.id}:play`,
      theme: this.theme,
      texture: look.art.playButton!,
      width: play.width,
      height: play.height,
      motion: options.motion,
      breathing: options.playBreathing ?? false,
      onTap: () => options.onPlay(this.playLevel)
    });
    const textLook = { ...skinTextLook(skin), fill: play.textFill };
    this.playText = createFigmaLabel(this.theme, options.playLabel ?? i18n?.t('core.level_map.play') ?? READY_UI_EN['core.level_map.play'], play.label.fontSize, textLook);
    this.levelText = play.level ? createFigmaLabel(this.theme, '', play.level.fontSize, textLook) : null;
    this.playText.eventMode = 'none';
    this.play.addChild(this.playText);
    if (this.levelText) {
      this.levelText.eventMode = 'none';
      this.play.addChild(this.levelText);
    }
    placeFigmaLabel(this.playText, slot(play.label));

    this.nav = new BottomNavView({ ...shared, ...navOptions(options.nav ?? {}, i18n), id: `${this.id}:nav` });
    this.hud = new HudView({ ...shared, ...(options.hud ?? {}), id: `${this.id}:hud` });

    // bottom → top: map (with its background), PLAY, navigation, HUD
    this.addChild(this.map, this.play, this.nav, this.hud);
    this.built = true;
    this.refreshPlayLevel();
    this.resize(options.width ?? 390, options.height ?? 844);
  }

  /**
   * The level PLAY launches: the selected level — the map's playable level under the focus, or the level a node tap
   * selected while the map is still scrolling it there.
   */
  get playLevel(): number {
    return this.pendingLevel ?? this.map.selectedLevel;
  }

  /** Re-reads the map's playable level into the PLAY caption (called on every focus change; call it after `map.setProgress` if needed). */
  refreshPlayLevel(): void {
    if (!this.built) return; // the map reports its first focus while it is being built
    const level = this.playLevel;
    if (level === this.shownLevel) return;
    this.shownLevel = level;
    const box = this.layout.play.level;
    if (!this.levelText || !box) return;
    this.levelText.text = this.levelLabel(level);
    placeFigmaLabel(this.levelText, slot(box));
    applyTextResolution(this.play, this.play.scale.x * this.pixelRatio);
  }

  /** Keeps a node-tap selection while the focus scrolls toward it; drops it once the focus is there or moves away. */
  private trackPendingLevel(focus: number): void {
    const pending = this.pendingLevel;
    const previous = this.lastFocus;
    this.lastFocus = focus;
    if (pending === null) return;
    if (focus === pending || Math.abs(focus - pending) > Math.abs(previous - pending)) this.pendingLevel = null;
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

/**
 * The BottomNavView options of `nav`: a generic item list as it is; the level-map slots as SHOP | HOME | LOCK items —
 * HOME selected, LOCK in the style's locked state (tappable: it shakes, its `onTap` optional; inert only with
 * `disabled`), a SHOP / HOME slot without `onTap` (or `disabled`) disabled, each tap routed to its slot's `onTap`.
 */
function navOptions(nav: LevelMapScreenNav, i18n: LocalizationTextProvider | undefined): Omit<BottomNavViewOptions, Shared> {
  if ('items' in nav) return nav;
  const tap = (id: string): void => nav[id as LevelMapNavSlotId]?.onTap?.();
  const items: BottomNavItem[] = NAV_SLOTS.map(({ id, icon, locked }) => {
    const slotOptions = nav[id];
    const key = NAV_LABEL_KEYS[id];
    return {
      id,
      ...(icon ? { icon } : {}),
      ...(locked ? { locked } : {}),
      label: localizedText(slotOptions?.label, i18n, key, READY_UI_EN[key]),
      disabled: locked ? slotOptions?.disabled === true : !slotOptions?.onTap || slotOptions.disabled === true
    };
  });
  return { items, selectedId: 'home', onSelect: tap, onLockedTap: tap };
}
