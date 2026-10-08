import type { Texture } from 'pixi.js';
import type { ReadyUiOptionalTextureName, ReadyUiTextures } from './assets';
import type { NineSliceSpec } from './nineSlice';
import type { FigmaTextLook } from './text';
import { READY_UI_STYLE_1, STYLE_1_INCLUDE_NAMES } from './skins/style1';
import { READY_UI_STYLE_2 } from './skins/style2';

/**
 * Ready UI styles (UI Skin V1): a style is a typed DATA package — its assets by semantic role (file + 9-slice caps),
 * its text and dim look, and the layout of every window it covers. A game picks one in its Ready UI config
 * (`theme: { skin }` for the views, `loadReadyUiAssets({ skin })` for the files); the window code stays the same
 * for every style. A window the style does not cover keeps its donor look.
 */

/** The modal windows a style can cover. */
export type ReadyUiSkinWindow = 'confirm' | 'lives' | 'settings' | 'result' | 'noAds';

/** Non-modal Core views whose visuals may come from the same selected skin. */
export type ReadyUiSkinView = ReadyUiSkinWindow | 'hud' | 'levelMap' | 'bottomNav' | 'levelMapScreen' | 'moves' | 'settingsButton' | 'shopScreen';

/** The roles each covered window draws with, in the view's order. A covering style must give every one an asset. */
export const READY_UI_SKIN_WINDOW_ROLES = {
  confirm: ['windowSurface', 'windowClose', 'heroGlow', 'lifeLostArt', 'buttonPrimary', 'priceIcon', 'offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt'],
  lives: [
    'windowSurface', 'windowClose', 'buttonPrimary', 'buttonRewarded', 'buttonHighlight', 'panelInset', 'lifeArt', 'priceIcon', 'rewardIcon', 'adIcon',
    'offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt'
  ],
  settings: [
    'settingsPanel', 'settingsClose', 'settingsSound', 'settingsMusic', 'settingsHaptic', 'settingsOff', 'settingsBtnHome', 'settingsBtnRestart', 'settingsIconRestart',
    'settingsSoundOff', 'settingsMusicOff', 'settingsHapticOff', 'settingsIconHome', 'settingsBtnLanguage', 'settingsIconLanguage'
  ],
  result: [
    'resultGlowWin', 'resultGlowFail', 'rewardCoin', 'lifeLostArt', 'buttonPrimary', 'buttonRewarded', 'buttonHighlight', 'buttonExit',
    'resultRibbonWin', 'resultRibbonFail', 'resultCloseWin', 'resultCloseFail', 'resultStar'
  ],
  noAds: ['noAdsPanel', 'noAdsClose', 'noAdsDecor', 'noAdsArt', 'buttonPrimary', 'priceIcon']
} as const satisfies Record<ReadyUiSkinWindow, readonly string[]>;

/**
 * The roles each view can draw. A modal window draws all of its roles. For the non-modal views the style's layout
 * decides which optional parts exist (a HUD without a settings gear, a map without a HARD badge or a current glow, a
 * map with its own background or locked-node art), so the roles a covering style must ship are
 * `requiredSkinRoles(skin, view)`. `iconShop` / `iconHome` are item icons a style may ship for a BottomNavView item
 * (an item names its icon by role or passes a texture); the nav itself draws `navPanel`, `navSelected`, `navLock`.
 * LevelMapScreen draws PLAY and its fixed SHOP | HOME | LOCK slots, so a style covering it ships both item icons.
 * ShopScreen draws its awning, title tape, pack cards (card + one pack art per slot) and × — `shopBackground` only when
 * its layout has a background picture (`background.art`).
 */
export const READY_UI_SKIN_VIEW_ROLES = {
  ...READY_UI_SKIN_WINDOW_ROLES,
  hud: ['hudCapsule', 'hudHeart', 'hudCoin', 'hudPlus', 'hudGear', 'hudGearBack', 'hudStar'],
  levelMap: ['levelNodeNormal', 'levelNodeHard', 'levelLock', 'levelHardBadge', 'levelRail', 'levelCurrentGlow', 'levelStarGold', 'levelStarGoldL', 'levelStarGoldR', 'levelNodeLocked', 'levelMapBackground'],
  bottomNav: ['navPanel', 'navSelected', 'navLock', 'iconShop', 'iconHome'],
  levelMapScreen: ['playButton', 'iconShop', 'iconHome'],
  moves: ['movesPanel'],
  settingsButton: ['settingsButtonBack', 'settingsButtonIcon'],
  shopScreen: ['shopBackground', 'shopAwning', 'shopTitle', 'shopCard', 'shopPack1', 'shopPack2', 'shopPack3', 'shopPack4', 'shopPack5', 'shopPack6', 'shopClose']
} as const satisfies Record<ReadyUiSkinView, readonly string[]>;

export type ReadyUiSkinRole = (typeof READY_UI_SKIN_VIEW_ROLES)[ReadyUiSkinView][number];

/**
 * A window's own asset for one of its roles: `'<window>:<role>'` (e.g. `'confirm:windowSurface'`). In that window it
 * wins over the style's role asset — for a style whose windows draw the same role with different art (Style 2: the
 * violet Confirm shell next to the white / blue popup of Lives and Settings).
 */
export type ReadyUiSkinWindowAssetKey = { [W in ReadyUiSkinWindow]: `${W}:${(typeof READY_UI_SKIN_WINDOW_ROLES)[W][number]}` }[ReadyUiSkinWindow];

/** A key of a style's `assets`: a role, or a window's own role (`ReadyUiSkinWindowAssetKey`). */
export type ReadyUiSkinAssetKey = ReadyUiSkinRole | ReadyUiSkinWindowAssetKey;

/** The roles the views stretch as 9-slices: their asset must carry `nineSlice` caps. */
const NINE_SLICE_ROLES: readonly ReadyUiSkinRole[] = ['windowSurface', 'buttonPrimary', 'buttonRewarded', 'panelInset', 'settingsPanel', 'navPanel', 'navSelected', 'offerPanel', 'noAdsPanel', 'shopTitle'];

/** The roles of the OFFER panel (`windows.offer`) that Lives and Confirm draw under themselves; required only with that layout. */
const OFFER_ROLES: readonly ReadyUiSkinRole[] = ['offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt', 'buttonPrimary', 'priceIcon'];

/** One asset of a style: its file under the served `assets/pixi-ui/` folder, and its caps when it stretches. */
export interface ReadyUiSkinAsset {
  readonly file: string;
  readonly nineSlice?: NineSliceSpec;
}

export interface ReadyUiSkinBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A one-line text box (Figma fixed box, vertical CENTER). */
export interface ReadyUiSkinTextBox extends ReadyUiSkinBox {
  readonly fontSize: number;
}

/**
 * A window's own runtime text look instead of the style's: the THEME font (the kit's), this OUTSIDE stroke and hard
 * shadow in the theme's stroke colour, this fill (absent: the theme's) — for a style whose window keeps the kit's type
 * (Style 2's Confirm is the Style 1 window).
 */
export interface ReadyUiSkinWindowText {
  readonly strokeOutside: number;
  readonly shadowY: number;
  readonly fill?: number;
}

/**
 * Confirm (exit / restart with a life lost). Boxes are WINDOW-LOCAL: x / y from the window box's top-left (the panel
 * origin is the window centre); `buttonLabel` is button-local. The art boxes are the render (export) boxes. A text box
 * may carry its own `fill` / `stroke` / `align` (absent: the style's look; `lifeDelta` left-aligned, the others centred).
 */
export interface ReadyUiSkinConfirmLayout {
  readonly window: { readonly width: number; readonly height: number };
  /** This window's own text look (absent: the style's text look and font). */
  readonly text?: ReadyUiSkinWindowText;
  readonly title: ReadyUiSkinLivesTextBox;
  readonly close: ReadyUiSkinBox;
  /** `heroGlow` */
  readonly glow: ReadyUiSkinBox;
  /** `lifeLostArt` */
  readonly heart: ReadyUiSkinBox;
  readonly lifeDelta: ReadyUiSkinLivesTextBox;
  readonly body: ReadyUiSkinLivesTextBox;
  readonly button: ReadyUiSkinBox;
  readonly buttonLabel: ReadyUiSkinLivesTextBox;
}

/**
 * A Lives text box with its own look over the style's: `fill`, an OUTSIDE `stroke` in its own colour (instead of the
 * style's stroke; a style shadow takes the same colour), `align` (absent: the view's alignment for that text).
 */
export interface ReadyUiSkinLivesTextBox extends ReadyUiSkinTextBox {
  readonly fill?: number;
  readonly stroke?: { readonly width: number; readonly color: number };
  readonly align?: 'left' | 'center';
}

/**
 * Lives (refill hearts). Boxes are FRAME coordinates: x / y in the style's `frame` (the panel origin is the frame
 * centre). The Confirm / Lives conventions differ on purpose (each is its Figma read, unchanged).
 */
export interface ReadyUiSkinLivesLayout {
  readonly window: ReadyUiSkinBox;
  readonly title: ReadyUiSkinLivesTextBox;
  readonly close: ReadyUiSkinBox;
  /** `panelInset` */
  readonly inset: ReadyUiSkinBox;
  /** `lifeArt` */
  readonly heart: ReadyUiSkinBox;
  /** The lives count, centred on this box. */
  readonly count: ReadyUiSkinLivesTextBox;
  readonly nextLabel: ReadyUiSkinLivesTextBox;
  readonly timer: ReadyUiSkinLivesTextBox;
  /** `buttonPrimary` */
  readonly refill: ReadyUiSkinBox;
  readonly refillLabel: ReadyUiSkinLivesTextBox;
  /**
   * The price text, `gap`, then the `priceIcon` (`coin` box), as one row centred on `x` (frame; absent: the refill
   * button's centre) — the row moves with the button.
   */
  readonly priceRow: { readonly y: number; readonly height: number; readonly gap: number; readonly fontSize: number; readonly x?: number };
  /** `y`: the icon's top (frame; absent: the row's top). */
  readonly coin: { readonly width: number; readonly height: number; readonly y?: number };
  /** `buttonRewarded` */
  readonly ad: ReadyUiSkinBox;
  /** `buttonHighlight`; `null` = this style's rewarded button has no highlight layer (no `buttonHighlight` art). */
  readonly adHighlight: ReadyUiSkinBox | null;
  readonly adLabel: ReadyUiSkinLivesTextBox;
  /** `adIcon` */
  readonly adIcon: ReadyUiSkinBox;
  /** `rewardIcon` */
  readonly rewardIcon: ReadyUiSkinBox;
  readonly rewardLabel: ReadyUiSkinLivesTextBox;
}

/** One OFFER item: its icon box (the host's texture, contain-fit) and its count under it. Panel-local. */
export interface ReadyUiSkinOfferItemLayout {
  readonly icon: ReadyUiSkinBox;
  readonly label: ReadyUiSkinLivesTextBox;
}

/**
 * The OFFER panel a window may show under itself (Lives, Confirm): its own shell (`offerPanel`, 9-slice), title, an
 * optional corner badge (`offerBadge` + rotated runtime text), the hero (the style's `offerLivesArt` / `offerCoinArt`
 * or a host texture) with its caption, up to two host items with their counts, and the buy button (`buttonPrimary`)
 * with the coin price (`priceIcon`). Boxes are PANEL-LOCAL (x / y from the panel box's top-left); the price row is
 * button-local. The window above and the panel are one composition, centred together; without an offer the window is
 * alone and centred as before.
 */
export interface ReadyUiSkinOfferLayout {
  /** The panel box, horizontally centred under the window box; `gap` = its distance under that box. */
  readonly panel: { readonly width: number; readonly height: number; readonly gap: number };
  readonly title: ReadyUiSkinLivesTextBox;
  /** The panel's own × (closes the window like the window's ×); `null` = none. */
  readonly close: ReadyUiSkinBox | null;
  /** `offerBadge` render box (it may stick out of the panel). */
  readonly badge: ReadyUiSkinBox;
  /** The badge text (`x3`, `-60%`): centred on the box, turned by `rotation` degrees (clockwise positive). */
  readonly badgeLabel: ReadyUiSkinLivesTextBox & { readonly rotation: number };
  /** The hero: a host texture contain-fits this box … */
  readonly icon: ReadyUiSkinBox;
  /** … the style's own hero art is drawn at its own render box, with its own caption box when it has one. */
  readonly iconArt: {
    readonly offerLivesArt: ReadyUiSkinBox & { readonly label?: ReadyUiSkinLivesTextBox };
    readonly offerCoinArt: ReadyUiSkinBox & { readonly label?: ReadyUiSkinLivesTextBox };
  };
  /** The hero's caption (`35d`, `2000`). */
  readonly iconLabel: ReadyUiSkinLivesTextBox;
  /** Two item slots; a single item takes the centre between them. */
  readonly items: readonly [ReadyUiSkinOfferItemLayout, ReadyUiSkinOfferItemLayout];
  /** `buttonPrimary` */
  readonly button: ReadyUiSkinBox;
  /** Button-local: the price text, `gap`, the `priceIcon` (`coin`), as one row centred on the button; `y` = the row's top. */
  readonly price: { readonly y: number; readonly height: number; readonly gap: number; readonly fontSize: number };
  /** The price coin: `priceIcon`, or the style's `offerCoinArt` when `art` names it. */
  readonly coin: { readonly width: number; readonly height: number; readonly y: number; readonly art?: 'offerCoinArt' };
}

/**
 * A Settings text box; `fill` = this text's colour (absent: the style's text fill, the theme's version colour for the
 * version); `outline: false` = plain text without the style's stroke and shadow.
 */
export interface ReadyUiSkinSettingsTextBox extends ReadyUiSkinTextBox {
  readonly fill?: number;
  readonly outline?: boolean;
}

/** One current Settings toggle: the button and label are window-local; `off` is button-local. */
export interface ReadyUiSkinSettingsToggleLayout {
  readonly button: ReadyUiSkinBox;
  readonly label: ReadyUiSkinSettingsTextBox;
  readonly off: ReadyUiSkinBox;
}

/** A current Settings game action: the button is window-local; label/icon are button-local. */
export interface ReadyUiSkinSettingsActionLayout {
  readonly button: ReadyUiSkinBox;
  readonly label: ReadyUiSkinSettingsTextBox;
  readonly icon?: ReadyUiSkinBox;
  /**
   * Figma's hugging icon + label row (auto-layout): `label` is the sample text's box; the runtime text's advance
   * replaces its width and the icon and label shift together so the row stays centred. A text wider than `maxWidth`
   * shrinks to it.
   */
  readonly hug?: { readonly maxWidth: number };
}

/**
 * The Settings surface shared by the map and gameplay layouts. Every box is window-local. A layout lays out every row it
 * has; the rows a show does not draw (an absent continuation, no languages) close up — the rest moves up with the window
 * bottom (with no row left, everything under them moves up to the toggles by their gap).
 */
export interface ReadyUiSkinSettingsBaseLayout {
  readonly window: { readonly width: number; readonly height: number };
  readonly title: ReadyUiSkinSettingsTextBox;
  readonly close: ReadyUiSkinBox;
  readonly sound: ReadyUiSkinSettingsToggleLayout;
  readonly music: ReadyUiSkinSettingsToggleLayout;
  /** `null` = this style has no haptic toggle (no `settingsHaptic` art; asking SettingsWindowView for one throws). */
  readonly haptic: ReadyUiSkinSettingsToggleLayout | null;
  /**
   * The language row (`settingsBtnLanguage`, a 9-slice when its asset has caps, + `settingsIconLanguage` when `icon`):
   * its label is the current language's name. Absent = the style draws no language row (the option is ignored).
   */
  readonly language?: ReadyUiSkinSettingsActionLayout;
  readonly version: ReadyUiSkinSettingsTextBox;
}

export type ReadyUiSkinSettingsMapLayout = ReadyUiSkinSettingsBaseLayout;

export interface ReadyUiSkinSettingsGameplayLayout extends ReadyUiSkinSettingsBaseLayout {
  readonly restart: ReadyUiSkinSettingsActionLayout & { readonly icon: ReadyUiSkinBox };
  readonly home: ReadyUiSkinSettingsActionLayout;
}

export interface ReadyUiSkinSettingsLayouts {
  readonly map: ReadyUiSkinSettingsMapLayout;
  readonly gameplay: ReadyUiSkinSettingsGameplayLayout;
  /**
   * OFF also swaps a toggle's button art for its own OFF role (`settingsSoundOff` / `settingsMusicOff` /
   * `settingsHapticOff`: a muted button) under the `settingsOff` mark; absent = the ON art stays and only the mark
   * shows OFF.
   */
  readonly offButtons?: boolean;
}

/** Style-owned visual geometry for HudView. Interaction and responsive fitting remain shared. */
export interface ReadyUiSkinHudLayout {
  readonly capsule: ReadyUiSkinBox;
  readonly iconSize: number;
  readonly starIconSize: number;
  readonly plus: ReadyUiSkinBox;
  readonly badgeGap: number;
  /** The lives count inside the heart; `null` = this style's heart carries no count (the lives value still drives MAX / timer and "+"). */
  readonly heartCount: { readonly x: number; readonly y: number; readonly fontSize: number; readonly stroke: number } | null;
  readonly capsuleText: { readonly x: number; readonly y: number; readonly fontSize: number };
  readonly resourceCount: { readonly x: number; readonly y: number; readonly fontSize: number };
  /** Counter / capsule text colour; absent = the theme's text fill. */
  readonly textFill?: number;
  /** The settings gear; `null` = this style has no gear art (HudView then shows none unless asked, and asking throws). */
  readonly gear: { readonly size: number; readonly backWidth: number; readonly backHeight: number; readonly rowWidthFactor: number; readonly minHitSize: number } | null;
  readonly margins: { readonly left: number; readonly right: number; readonly top: number; readonly settingsTop: number; readonly rowGap: number; readonly bottom: number };
  /** The donor's area rule; `null` = the row keeps its design size and only shrinks to fit the width. */
  readonly responsive: { readonly portraitAreaRatio: number; readonly landscapeAreaRatio: number } | null;
  /** Default for this skin; an explicit HudView `shadow` option still wins. */
  readonly shadow: boolean;
}

/** Style-owned art boxes for LevelMapView. Scrolling, focus, culling and level spacing remain in theme.levelMap. */
export interface ReadyUiSkinLevelMapLayout {
  /** Every open node (current and completed); also locked nodes when there is no `lockedNode`. */
  readonly normalNode: { readonly width: number; readonly height: number };
  /** Locked nodes drawn with their own art (`levelNodeLocked`); absent = the normal / HARD art. */
  readonly lockedNode?: { readonly width: number; readonly height: number };
  /** The HARD node art (`levelNodeHard`); `null` together with `hardBadge` = no HARD art: a hard level draws like a normal one. */
  readonly hardNode: { readonly width: number; readonly height: number } | null;
  readonly number: { readonly x: number; readonly y: number; readonly width: number; readonly fontSize: number };
  /** The number on a locked node, when it differs from an open one. */
  readonly lockedNumber?: { readonly x: number; readonly y: number; readonly width: number; readonly fontSize: number };
  /** Font size factor for 1-, 2- and 3+-digit numbers; absent = Core's [1, 0.92, 0.74]. The width fit still applies. */
  readonly digitScale?: readonly [number, number, number];
  readonly lock: ReadyUiSkinBox;
  readonly hardBadge: (ReadyUiSkinBox & { readonly textY: number; readonly fontSize: number }) | null;
  readonly rail: { readonly width: number };
  /** The glow under the focused node (`levelCurrentGlow`); `null` = this style has none. */
  readonly currentGlow: { readonly width: number; readonly height: number } | null;
  /** The style's own map background (`levelMapBackground`, cover-fit); false = the view's donor background. */
  readonly background?: boolean;
  /** Figma shows HARD on locked nodes; donor compatibility keeps its old open-only rule. */
  readonly showHardWhenLocked: boolean;
  /** Earned rating stars (left, centre, right) as boxes in node units: Core's crown composition fitted to this node's art. */
  readonly stars: readonly [
    { readonly x: number; readonly y: number; readonly size: number },
    { readonly x: number; readonly y: number; readonly size: number },
    { readonly x: number; readonly y: number; readonly size: number }
  ];
  /** The HARD badge covers the rim the crown sits on: a HARD node's crown rests on the badge's top edge, in front of it. */
  readonly starsOnHardBadge: boolean;
}

/** A centre-anchored icon box: centre x / y and its square size. */
export interface ReadyUiSkinIconBox {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** How one BottomNavView item state draws: its icon box and its label box (`null` = no label in that state). */
export interface ReadyUiSkinBottomNavItemLayout {
  readonly icon: ReadyUiSkinIconBox;
  readonly label: ReadyUiSkinTextBox | null;
}

/** A view's own text outline over the style's: OUTSIDE stroke width and hard shadow offset (0 = none), and their colour (absent: the theme's stroke colour). */
export interface ReadyUiSkinTextOutline {
  readonly strokeOutside: number;
  readonly shadowY: number;
  readonly strokeColor?: number;
}

/**
 * BottomNavView geometry. Units are design units; x is relative to an item's slot centre, y to the TOP of the panel
 * (its rect, without the shadow). The panel spans the viewport width and reaches down through the bottom inset.
 */
export interface ReadyUiSkinBottomNavLayout {
  /** The panel rect height above the bottom inset. */
  readonly panelHeight: number;
  /** Texture rows above the panel rect (its top shadow). */
  readonly panelBleedTop: number;
  /** The distance between two slot centres; it shrinks when the items do not fit the width. */
  readonly pitch: number;
  /** The selected item's raised background (`navSelected`): its render box; it reaches down to the viewport bottom. */
  readonly selectedBackground: ReadyUiSkinBox;
  readonly selected: ReadyUiSkinBottomNavItemLayout;
  readonly normal: ReadyUiSkinBottomNavItemLayout;
  /** A locked item shows the style's lock (`navLock`) instead of its icon; its label box (the item's own caption) when the style has one. */
  readonly locked: ReadyUiSkinBottomNavItemLayout;
  /** Label colour. */
  readonly textFill: number;
  /** The labels' outline; absent = the style's text look. */
  readonly text?: ReadyUiSkinTextOutline;
}

/**
 * The level-map screen composition: PLAY (`playButton`, its labels runtime text in the style's text look) above the
 * bottom navigation. Whether PLAY and the navigation exist is not the style's: every covering style draws both.
 */
export interface ReadyUiSkinLevelMapScreenLayout {
  readonly play: {
    /** The `playButton` art box; its centre is the button's centre. */
    readonly width: number;
    readonly height: number;
    /** The PLAY centre sits this many design units above the nav panel's top edge. */
    readonly aboveNav: number;
    /** Button-local text boxes (from the button centre). */
    readonly label: ReadyUiSkinTextBox;
    /** The playable level's caption (`Level N`); `null` = this style's PLAY shows the word only. */
    readonly level: ReadyUiSkinTextBox | null;
    readonly textFill: number;
  };
}

/**
 * SettingsButtonView: the settings button of a screen without a HudView gear (a gameplay screen) — `settingsButtonBack`
 * at `back` with the `settingsButtonIcon` in its `icon` box (back-local, from its top-left), `margins` design units from
 * the safe area's top and right edges.
 */
export interface ReadyUiSkinSettingsButtonLayout {
  readonly back: { readonly width: number; readonly height: number };
  readonly icon: ReadyUiSkinBox;
  readonly margins: { readonly top: number; readonly right: number };
  /** The tap square's minimum side (units). */
  readonly minHitSize: number;
}

/**
 * MovesView: the moves counter of a gameplay screen. Boxes are BOX-LOCAL (x / y from the box's top-left; the view's
 * origin is the box centre): `panel` is the `movesPanel` render box (its shadow may reach outside the box), `label` the
 * caption (`MOVES`), `count` the runtime number — each with its own fill / OUTSIDE stroke over the style's text look.
 */
export interface ReadyUiSkinMovesLayout {
  readonly box: { readonly width: number; readonly height: number };
  readonly panel: ReadyUiSkinBox;
  readonly label: ReadyUiSkinLivesTextBox;
  readonly count: ReadyUiSkinLivesTextBox;
}

/**
 * ShopScreen (the SHOP tab of the main-screen navigation, not a modal): FRAME coordinates (x / y in the style's `frame`;
 * the frame's top edge is the viewport's top edge, its centre the safe area's horizontal centre, contain-fit scale),
 * card parts CARD-LOCAL (from the card box's top-left). The screen fill is `background.color` (the whole viewport) under
 * the optional `shopBackground` picture (cover-fit); `shopAwning` is one tile of the awning, repeated across the viewport
 * width from the frame centre at the top edge; the title tape (`shopTitle`, a horizontal 9-slice at `title.ribbon`) and
 * the card grid scroll together between `scroll.top` and `scroll.bottomGap` units above the navigation panel.
 */
export interface ReadyUiSkinShopScreenLayout {
  /** The screen fill under everything; `art` = the `shopBackground` picture cover-fits the viewport over it. */
  readonly background: { readonly color: number; readonly art: boolean };
  /** `shopAwning`: one tile's render box (its top on the viewport's top edge, tiles `width` apart, one centred on the frame). */
  readonly awning: { readonly width: number; readonly height: number };
  /**
   * `shopClose` render box (shown only when the host gives `onClose`): `right` units from the safe area's right edge, its
   * top `y` units under the viewport's top edge (never above the safe top); `minHitSize` = its tap square.
   */
  readonly close: { readonly y: number; readonly right: number; readonly width: number; readonly height: number; readonly minHitSize: number };
  /** `shopTitle` (9-slice) at `ribbon` with the runtime title in `label` (its own fill / OUTSIDE stroke over the style's look). */
  readonly title: { readonly ribbon: ReadyUiSkinBox; readonly label: ReadyUiSkinLivesTextBox };
  /**
   * The card grid: `columns` per row, the first row's card box top at `top`, card boxes `pitchX` / `pitchY` apart and
   * the columns centred on the frame; a last row with fewer cards is centred too.
   */
  readonly grid: { readonly top: number; readonly columns: number; readonly pitchX: number; readonly pitchY: number };
  /** One pack card: its logical box, the `shopCard` render box, the pack art box (`shopPack<n>` or the item's own), the amount and the price. */
  readonly card: {
    readonly box: { readonly width: number; readonly height: number };
    readonly art: ReadyUiSkinBox;
    readonly pack: ReadyUiSkinBox;
    readonly amount: ReadyUiSkinLivesTextBox;
    readonly price: ReadyUiSkinLivesTextBox;
  };
  /** The scrolled area: from frame y `top` down to `bottomGap` units above the navigation panel's top edge. */
  readonly scroll: { readonly top: number; readonly bottomGap: number };
}

/**
 * No Ads. Boxes are WINDOW-LOCAL (x / y from the window box's top-left; the panel origin is the window centre); the
 * price row is button-local. `noAdsPanel` is the window shell, a 9-slice over the window box (its bleed in the caps' `pad`);
 * the art boxes are render boxes: `noAdsClose` (the ×),
 * `noAdsDecor` (the rays / stars behind the hero, decoration), `noAdsArt` (the hero), `buttonPrimary` (9-slice) and the
 * coin `priceIcon` after a coin price. The copy is runtime: the two title lines are `wordNo` / `wordAds`; the description
 * is split at its first line break — its first part in `description` (it wraps inside the box), the rest in `note`.
 */
export interface ReadyUiSkinNoAdsLayout {
  readonly window: { readonly width: number; readonly height: number };
  readonly close: ReadyUiSkinBox;
  readonly decor: ReadyUiSkinBox;
  readonly hero: ReadyUiSkinBox;
  readonly title: readonly [ReadyUiSkinLivesTextBox, ReadyUiSkinLivesTextBox];
  readonly description: ReadyUiSkinLivesTextBox;
  readonly note: ReadyUiSkinLivesTextBox;
  readonly button: ReadyUiSkinBox;
  /** Button-local: the price text, `gap`, the coin (`priceIcon`, only for a coin price), one row centred on the button; `y` = the row's top. */
  readonly price: { readonly y: number; readonly height: number; readonly gap: number; readonly fontSize: number; readonly fill?: number; readonly stroke?: { readonly width: number; readonly color: number } };
  readonly coin: { readonly width: number; readonly height: number; readonly y: number };
}

/** A Result button: its box in the frame, its label box button-local (from the button box's top-left). */
export interface ReadyUiSkinResultButtonLayout {
  readonly button: ReadyUiSkinBox;
  readonly label: ReadyUiSkinTextBox;
}

/** Shared by both Result outcomes: the ribbon (render box) with its × (`resultCloseWin` / `resultCloseFail`), the glow under the content. */
export interface ReadyUiSkinResultOutcomeLayout {
  /** `resultRibbonWin` / `resultRibbonFail`: the ribbon's render box (tails and shadow included). */
  readonly ribbon: ReadyUiSkinBox;
  /** The ribbon's runtime title (`LEVEL n`). */
  readonly title: ReadyUiSkinTextBox;
  readonly close: ReadyUiSkinBox;
  /**
   * `resultGlowWin` / `resultGlowFail`: the blurred band behind the content (render box; decoration, never measured);
   * `null` = this outcome draws no glow (its role is not needed).
   */
  readonly glow: ReadyUiSkinBox | null;
}

/**
 * Result WIN / FAIL. Boxes are FRAME coordinates (x / y in the style's `frame`; the panel origin is the frame centre);
 * button labels are button-local. The behaviour stays ResultWindowView's: one frame-fit scale for both outcomes, the
 * WIN composition (crown … CTA row) centred, the FAIL composition centred, stars / confetti / callbacks unchanged.
 */
export interface ReadyUiSkinResultLayout {
  readonly win: ReadyUiSkinResultOutcomeLayout & {
    /** The ribbon's second line (`COMPLETED!`). */
    readonly subtitle: ReadyUiSkinTextBox;
    /** The earned stars' rest boxes (centre x / y and size), left to right: Core's crown over this style's ribbon. */
    readonly stars: readonly [ReadyUiSkinIconBox, ReadyUiSkinIconBox, ReadyUiSkinIconBox];
    readonly rewardsLabel: ReadyUiSkinTextBox;
    /** `rewardCoin` (render box). */
    readonly coin: ReadyUiSkinBox;
    /** The reward amount, centred on this box (its own fill / OUTSIDE stroke over the style's look, when given). */
    readonly amount: ReadyUiSkinLivesTextBox;
    /** CONTINUE on `buttonPrimary`. */
    readonly next: ReadyUiSkinResultButtonLayout;
    /**
     * The secondary (RETRY) on `buttonRewarded` with the `buttonHighlight` layer (`highlight`, button-local); `null` =
     * this style's rewarded surface has no highlight layer (no `buttonHighlight` art).
     */
    readonly retry: ReadyUiSkinResultButtonLayout & { readonly highlight: ReadyUiSkinBox | null };
  };
  readonly fail: ReadyUiSkinResultOutcomeLayout & {
    /** `lifeLostArt` (render box) and its runtime delta (`-1`, LEFT / CENTER). */
    readonly lifeLost: ReadyUiSkinBox;
    /** LEFT-aligned unless the box says otherwise; its own fill / OUTSIDE stroke over the style's look, when given. */
    readonly lifeDelta: ReadyUiSkinLivesTextBox;
    /** The outcome line (`FAILED`, the params' subtitle) under the art. */
    readonly status: ReadyUiSkinTextBox;
    /** RETRY on `buttonPrimary`. */
    readonly retry: ReadyUiSkinResultButtonLayout;
    /** The optional EXIT on `buttonExit` (fixed art, drawn at the box). */
    readonly exit: ReadyUiSkinResultButtonLayout;
  };
}

export interface ReadyUiSkinLayouts {
  readonly confirm?: ReadyUiSkinConfirmLayout;
  readonly lives?: ReadyUiSkinLivesLayout;
  /** The OFFER panel under Lives / Confirm (absent: those windows never show an offer). */
  readonly offer?: ReadyUiSkinOfferLayout;
  readonly settings?: ReadyUiSkinSettingsLayouts;
  readonly result?: ReadyUiSkinResultLayout;
  readonly noAds?: ReadyUiSkinNoAdsLayout;
}

/** A style's own font file (under `assets/pixi-ui/`), registered under `family` by `loadReadyUiAssets({ skin })`. */
export interface ReadyUiSkinFont {
  readonly family: string;
  readonly file: string;
}

export interface ReadyUiSkin {
  /** Stable id: the key of its textures (`textures.skins[id]`) and of its Pixi Assets cache entries. Never reused. */
  readonly id: string;
  /** The Core views this style draws; every other view keeps its donor look. Each one listed needs layout + assets. */
  readonly covers: readonly ReadyUiSkinView[];
  /** The design frame the layouts are measured in; a covered window keeps its share of it (contain-fit). */
  readonly frame: { readonly width: number; readonly height: number };
  /**
   * Semantic role → asset; a window's own role (`'<window>:<role>'`) wins over the role in that window. Only these
   * files load for the style (`loadReadyUiAssets({ skin })`).
   */
  readonly assets: { readonly [K in ReadyUiSkinAssetKey]?: ReadyUiSkinAsset };
  /**
   * Runtime text: OUTSIDE stroke width and hard drop-shadow offset, in the stroke colour (font / fill / stroke colour =
   * `theme.text`); 0 = none. `fill` overrides the theme's text fill for this style's views.
   */
  readonly text: { readonly strokeOutside: number; readonly shadowY: number; readonly fill?: number };
  /** The style's font: its views' runtime text uses it (the theme font otherwise). Loaded strictly with the style. */
  readonly font?: ReadyUiSkinFont;
  /** The dim layer behind a covered window. */
  readonly backdrop: { readonly color: number; readonly alpha: number };
  readonly windows: ReadyUiSkinLayouts;
  readonly hud?: ReadyUiSkinHudLayout;
  readonly levelMap?: ReadyUiSkinLevelMapLayout;
  readonly bottomNav?: ReadyUiSkinBottomNavLayout;
  readonly levelMapScreen?: ReadyUiSkinLevelMapScreenLayout;
  readonly moves?: ReadyUiSkinMovesLayout;
  readonly settingsButton?: ReadyUiSkinSettingsButtonLayout;
  readonly shopScreen?: ReadyUiSkinShopScreenLayout;
}

/** A skin's role textures, as `loadReadyUiAssets({ skin })` puts them under `textures.skins[skin.id]` (by asset key). */
export type ReadyUiSkinTextures = { [K in ReadyUiSkinAssetKey]?: Texture };

/** The ready-made styles of this Core, by id (no runtime registration: a new style is a new package here). */
export const READY_UI_SKINS = {
  [READY_UI_STYLE_1.id]: READY_UI_STYLE_1,
  [READY_UI_STYLE_2.id]: READY_UI_STYLE_2
} as const satisfies Record<string, ReadyUiSkin>;

const STANDALONE_VIEWS: readonly ReadyUiSkinView[] = ['hud', 'levelMap', 'bottomNav', 'levelMapScreen', 'moves', 'settingsButton', 'shopScreen'];

function viewLayout(skin: ReadyUiSkin, view: ReadyUiSkinView): unknown {
  return STANDALONE_VIEWS.includes(view) ? skin[view as ReadyUiSkinStandaloneView] : skin.windows[view as ReadyUiSkinWindow];
}

/** Lives / Confirm without the OFFER panel. */
function windowOwnRoles(skin: ReadyUiSkin, view: 'lives' | 'confirm'): readonly ReadyUiSkinRole[] {
  if (view === 'confirm') return ['windowSurface', 'windowClose', 'heroGlow', 'lifeLostArt', 'buttonPrimary'];
  return ['windowSurface', 'windowClose', 'buttonPrimary', 'buttonRewarded', ...(skin.windows.lives?.adHighlight === null ? [] : ['buttonHighlight' as const]), 'panelInset', 'lifeArt', 'priceIcon', 'rewardIcon', 'adIcon'];
}

/** The OFFER panel's roles a window does not already draw. */
function offerOnlyRoles(skin: ReadyUiSkin, view: 'lives' | 'confirm'): readonly ReadyUiSkinRole[] {
  const own = windowOwnRoles(skin, view);
  return OFFER_ROLES.filter((role) => !own.includes(role));
}

/**
 * The roles `skin` must ship for `view`: every role of Confirm / Lives (Lives without `buttonHighlight` when its
 * layout has no highlight; the OFFER panel's roles only when the style has `windows.offer`); for Settings and the non-modal views the parts its layout draws (no haptic toggle → no haptic art, `offButtons` → the OFF buttons, a home icon → `settingsIconHome`;
 * no gear art → no gear roles, no HARD badge → no HARD roles, no glow → no glow role, `lockedNode` → the locked node
 * art, `background` → the map background). BottomNav item icons are never required by the nav alone; LevelMapScreen
 * requires PLAY and the icons of its SHOP / HOME slots. Result needs every role but `buttonHighlight` when its WIN
 * secondary has no highlight layer and an outcome's glow when that outcome draws none. ShopScreen needs every role but
 * `shopBackground` when its layout has no background picture.
 */
export function requiredSkinRoles(skin: ReadyUiSkin, view: ReadyUiSkinView): readonly ReadyUiSkinRole[] {
  if (view === 'hud') {
    const roles: ReadyUiSkinRole[] = ['hudCapsule', 'hudHeart', 'hudCoin', 'hudPlus', 'hudStar'];
    if (skin.hud?.gear !== null) roles.splice(4, 0, 'hudGear', 'hudGearBack');
    return roles;
  }
  if (view === 'levelMap') {
    const layout = skin.levelMap;
    const roles: ReadyUiSkinRole[] = ['levelNodeNormal'];
    if (layout?.hardNode !== null) roles.push('levelNodeHard');
    roles.push('levelLock');
    if (layout?.hardBadge !== null) roles.push('levelHardBadge');
    roles.push('levelRail');
    if (layout?.currentGlow !== null) roles.push('levelCurrentGlow');
    roles.push('levelStarGold', 'levelStarGoldL', 'levelStarGoldR');
    if (layout?.lockedNode) roles.push('levelNodeLocked');
    if (layout?.background) roles.push('levelMapBackground');
    return roles;
  }
  if (view === 'bottomNav') return ['navPanel', 'navSelected', 'navLock'];
  if (view === 'shopScreen') {
    const roles = READY_UI_SKIN_VIEW_ROLES.shopScreen;
    return skin.shopScreen?.background.art ? roles : roles.filter((role) => role !== 'shopBackground');
  }
  if (view === 'lives' || view === 'confirm') {
    // the window's own roles, then the OFFER panel's when the style has one
    const own = windowOwnRoles(skin, view);
    return skin.windows.offer ? [...own, ...offerOnlyRoles(skin, view)] : own;
  }
  if (view === 'settings') {
    const layouts = skin.windows.settings;
    const haptic = layouts?.map.haptic !== null || layouts?.gameplay.haptic !== null;
    const roles: ReadyUiSkinRole[] = ['settingsPanel', 'settingsClose', 'settingsSound', 'settingsMusic'];
    if (haptic) roles.push('settingsHaptic');
    roles.push('settingsOff', 'settingsBtnHome', 'settingsBtnRestart', 'settingsIconRestart');
    if (layouts?.offButtons) roles.push('settingsSoundOff', 'settingsMusicOff', ...(haptic ? ['settingsHapticOff' as const] : []));
    if (layouts?.gameplay.home.icon) roles.push('settingsIconHome');
    if (layouts?.map.language || layouts?.gameplay.language) roles.push('settingsBtnLanguage');
    if (layouts?.map.language?.icon || layouts?.gameplay.language?.icon) roles.push('settingsIconLanguage');
    return roles;
  }
  if (view === 'result') {
    const layout = skin.windows.result;
    const without: ReadyUiSkinRole[] = [];
    if (layout?.win.retry.highlight === null) without.push('buttonHighlight');
    if (layout?.win.glow === null) without.push('resultGlowWin');
    if (layout?.fail.glow === null) without.push('resultGlowFail');
    return READY_UI_SKIN_WINDOW_ROLES.result.filter((role) => !without.includes(role));
  }
  return READY_UI_SKIN_VIEW_ROLES[view];
}

const isWindow = (view: ReadyUiSkinView): view is ReadyUiSkinWindow => !STANDALONE_VIEWS.includes(view);

/** The asset key a view draws `role` with: a window's own `'<window>:<role>'` when the style has one, else the role. */
export function skinAssetKey(skin: ReadyUiSkin, view: ReadyUiSkinView, role: ReadyUiSkinRole): ReadyUiSkinAssetKey {
  if (!isWindow(view)) return role;
  const own = `${view}:${role}` as ReadyUiSkinWindowAssetKey;
  return skin.assets[own] ? own : role;
}

/** Checks a style package: every covered view has its layout and an asset (with caps where it stretches) per role. */
export function validateReadyUiSkin(skin: ReadyUiSkin): void {
  if (typeof skin?.id !== 'string' || !skin.id) throw new Error('ReadyUiSkin: a style needs a non-empty string id');
  if (skin.font && (!skin.font.family || !skin.font.file)) throw new Error(`ReadyUiSkin '${skin.id}': a style font needs a family and a file`);
  for (const key of Object.keys(skin.assets)) {
    const [window, role, extra] = key.split(':');
    if (role === undefined) continue;
    const roles = READY_UI_SKIN_WINDOW_ROLES[window as ReadyUiSkinWindow] as readonly string[] | undefined;
    if (extra !== undefined || !roles?.includes(role) || !skin.covers.includes(window as ReadyUiSkinWindow)) {
      throw new Error(`ReadyUiSkin '${skin.id}': asset '${key}' names no role of a window the style covers`);
    }
  }
  for (const view of skin.covers) {
    if (!READY_UI_SKIN_VIEW_ROLES[view]) throw new Error(`ReadyUiSkin '${skin.id}' covers '${String(view)}', which no style can cover yet (${Object.keys(READY_UI_SKIN_VIEW_ROLES).join(', ')})`);
    if (!viewLayout(skin, view)) {
      const location = STANDALONE_VIEWS.includes(view) ? view : `windows.${view}`;
      throw new Error(`ReadyUiSkin '${skin.id}' covers '${view}' but has no ${location} layout`);
    }
    if (view === 'levelMap' && (skin.levelMap?.hardNode === null) !== (skin.levelMap?.hardBadge === null)) {
      throw new Error(`ReadyUiSkin '${skin.id}': levelMap hardNode and hardBadge are both art or both null`);
    }
    for (const role of requiredSkinRoles(skin, view)) {
      const asset = skin.assets[skinAssetKey(skin, view, role)];
      if (!asset?.file) throw new Error(`ReadyUiSkin '${skin.id}' covers '${view}' but has no asset for role '${role}'`);
      if (NINE_SLICE_ROLES.includes(role) && !asset.nineSlice) throw new Error(`ReadyUiSkin '${skin.id}': role '${role}' is drawn as a 9-slice but has no nineSlice caps`);
    }
  }
}

export type ReadyUiSkinStandaloneView = 'hud' | 'levelMap' | 'bottomNav' | 'levelMapScreen' | 'moves' | 'settingsButton' | 'shopScreen';

export interface ReadyUiSkinViewLayouts {
  readonly hud: ReadyUiSkinHudLayout;
  readonly levelMap: ReadyUiSkinLevelMapLayout;
  readonly bottomNav: ReadyUiSkinBottomNavLayout;
  readonly levelMapScreen: ReadyUiSkinLevelMapScreenLayout;
  readonly moves: ReadyUiSkinMovesLayout;
  readonly settingsButton: ReadyUiSkinSettingsButtonLayout;
  readonly shopScreen: ReadyUiSkinShopScreenLayout;
}

/**
 * A resolved non-modal view: every REQUIRED role (`requiredSkinRoles`) is in `art`; an optional role is there only
 * when the layout draws it (and so it was required) or the style shipped and loaded it (BottomNav item icons).
 */
export interface SkinViewLook<V extends ReadyUiSkinStandaloneView> {
  skin: ReadyUiSkin;
  layout: ReadyUiSkinViewLayouts[V];
  art: Partial<Record<(typeof READY_UI_SKIN_VIEW_ROLES)[V][number], Texture>>;
}

/** Explicit theme selection only: absent or uncovered means the unchanged donor view. */
export function selectSkinView(view: ReadyUiSkinStandaloneView, themeSkin: ReadyUiSkin | undefined): ReadyUiSkin | null {
  return themeSkin?.covers.includes(view) ? themeSkin : null;
}

/** Resolves a non-modal skinned view strictly; a selected skin never falls back to donor art silently. */
export function resolveSkinView<V extends ReadyUiSkinStandaloneView>(
  owner: string,
  view: V,
  skin: ReadyUiSkin,
  textures: ReadyUiTextures
): SkinViewLook<V> {
  validateReadyUiSkin(skin);
  const layout = skin[view] as ReadyUiSkinViewLayouts[V] | undefined;
  if (!skin.covers.includes(view) || !layout) throw new Error(`${owner}: ReadyUiSkin '${skin.id}' does not cover '${view}'`);
  const loaded = textures.skins?.[skin.id];
  const required = requiredSkinRoles(skin, view);
  const art: Record<string, Texture> = {};
  const missing: ReadyUiSkinRole[] = [];
  for (const role of READY_UI_SKIN_VIEW_ROLES[view] as readonly ReadyUiSkinRole[]) {
    const texture = loaded?.[role];
    if (texture) art[role] = texture;
    else if (required.includes(role)) missing.push(role);
  }
  if (missing.length) {
    const list = missing.map((role) => `${role} (${skin.assets[role]?.file ?? '?'})`).join(', ');
    throw new Error(`${owner} style '${skin.id}': no ${list} in textures — load them with loadReadyUiAssets({ skin })`);
  }
  return { skin, layout, art: art as SkinViewLook<V>['art'] };
}

/**
 * The style a window draws with. The per-window `variant` wins: `'donor'` → none; `'figma'` → the theme's style when it
 * covers this window, else Style 1 (what `'figma'` drew before styles). No variant → the theme's style when it covers
 * this window, else none (the donor look).
 */
export function selectWindowSkin(window: ReadyUiSkinWindow, variant: 'donor' | 'figma' | undefined, themeSkin: ReadyUiSkin | undefined): ReadyUiSkin | null {
  if (variant === 'donor') return null;
  const covering = themeSkin && themeSkin.covers.includes(window) ? themeSkin : null;
  return variant === 'figma' ? covering ?? READY_UI_STYLE_1 : covering;
}

export interface WindowSkinLook<W extends ReadyUiSkinWindow> {
  skin: ReadyUiSkin;
  layout: NonNullable<ReadyUiSkinLayouts[W]>;
  /** Every role `requiredSkinRoles(skin, window)` names; a role the layout does not draw is there only if loaded. */
  art: Record<(typeof READY_UI_SKIN_WINDOW_ROLES)[W][number], Texture>;
}

/**
 * The layout and the role textures of a skinned window, or a clear error naming what is missing (never a silent
 * donor fallback). Textures come from `textures.skins[skin.id]`; for Core's Style 1 only, from the same files loaded
 * the pre-style way (`include`, under their kit names) when no style textures were loaded.
 * `legacy` = the window was asked for with `variant: 'figma'`: its error keeps naming the `include` list.
 */
export function resolveWindowSkin<W extends ReadyUiSkinWindow>(
  view: string,
  window: W,
  skin: ReadyUiSkin,
  textures: ReadyUiTextures,
  legacy: { variant: boolean; include: string }
): WindowSkinLook<W> {
  validateReadyUiSkin(skin);
  const layout = skin.windows[window] as NonNullable<ReadyUiSkinLayouts[W]> | undefined;
  if (!skin.covers.includes(window) || !layout) throw new Error(`${view}: ReadyUiSkin '${skin.id}' does not cover '${window}'`);
  const roles = READY_UI_SKIN_WINDOW_ROLES[window] as readonly ReadyUiSkinRole[];
  const loaded = textures.skins?.[skin.id];
  // the pre-style path (Style 1's files loaded by `include`, below) predates the OFFER panel: it never draws one
  const included = !loaded && skin === READY_UI_STYLE_1;
  const withOffer = requiredSkinRoles(skin, window);
  const offerOnly = window === 'lives' || window === 'confirm' ? offerOnlyRoles(skin, window) : [];
  const required = included ? withOffer.filter((role) => !offerOnly.includes(role)) : withOffer;
  const key = (role: ReadyUiSkinRole): ReadyUiSkinAssetKey => skinAssetKey(skin, window, role);
  const pick = (source: (role: ReadyUiSkinRole) => Texture | undefined): { art: Record<string, Texture>; missing: ReadyUiSkinRole[] } => {
    const art: Record<string, Texture> = {};
    const missing: ReadyUiSkinRole[] = [];
    for (const role of roles) {
      const texture = source(role);
      if (texture) art[role] = texture;
      else if (required.includes(role)) missing.push(role);
    }
    return { art, missing };
  };
  const fileOf = (role: ReadyUiSkinRole): string => skin.assets[key(role)]?.file ?? '?';
  const styleError = (missing: readonly ReadyUiSkinRole[]): Error =>
    new Error(`${view} style '${skin.id}': no ${missing.map((role) => `${role} (${fileOf(role)})`).join(', ')} in textures — load them with loadReadyUiAssets({ skin })`);

  // the pre-style path: Style 1's files loaded by `include` under their kit names
  const found = pick(included ? (role) => {
    const name = (STYLE_1_INCLUDE_NAMES as Partial<Record<ReadyUiSkinRole, ReadyUiOptionalTextureName>>)[role];
    return name ? textures[name] : undefined;
  } : (role) => loaded?.[key(role)]);
  if (found.missing.length && included && legacy.variant) {
    const names = STYLE_1_INCLUDE_NAMES as Partial<Record<ReadyUiSkinRole, ReadyUiOptionalTextureName>>;
    const list = found.missing.map((role) => `${names[role] ?? role} (${fileOf(role)})`).join(', ');
    throw new Error(`${view} variant 'figma': no ${list} in textures — load them with loadReadyUiAssets({ include: ${legacy.include} })`);
  }
  if (found.missing.length) throw styleError(found.missing);
  return { skin, layout, art: found.art as WindowSkinLook<W>['art'] };
}

/** A text box's look: the style's (`skinTextLook`), with the box's own fill / OUTSIDE stroke over it. */
export function skinTextBoxLook(look: FigmaTextLook, box: ReadyUiSkinLivesTextBox): FigmaTextLook {
  const own: FigmaTextLook = { ...look };
  if (box.fill !== undefined) own.fill = box.fill;
  if (box.stroke) {
    own.strokeOutside = box.stroke.width;
    own.strokeColor = box.stroke.color;
  }
  return own;
}

/** The runtime text look of a style's views: its stroke / shadow, and its own font and fill when it has them. */
export function skinTextLook(skin: ReadyUiSkin): { strokeOutside: number; shadowY: number; fontFamily?: string; fill?: number } {
  const look: { strokeOutside: number; shadowY: number; fontFamily?: string; fill?: number } = { strokeOutside: skin.text.strokeOutside, shadowY: skin.text.shadowY };
  if (skin.font) look.fontFamily = skin.font.family;
  if (skin.text.fill !== undefined) look.fill = skin.text.fill;
  return look;
}

/** The Pixi Assets alias of a style's font. */
export function skinFontAlias(skinId: string): string {
  return `game-core-ui:skin:${skinId}:font`;
}

/** The caps of a 9-slice role (checked by validateReadyUiSkin); `view` = the view drawing it (a window's own asset wins). */
export function skinNineSlice(skin: ReadyUiSkin, role: ReadyUiSkinRole, view?: ReadyUiSkinView): NineSliceSpec {
  const spec = skin.assets[view ? skinAssetKey(skin, view, role) : role]?.nineSlice;
  if (!spec) throw new Error(`ReadyUiSkin '${skin.id}': role '${role}' has no nineSlice caps`);
  return spec;
}

/** The Pixi Assets alias of a style asset: namespaced by the style id, so one role in two styles never collides. */
export function skinAssetAlias(skinId: string, role: ReadyUiSkinAssetKey): string {
  return `game-core-ui:skin:${skinId}:${role}`;
}
