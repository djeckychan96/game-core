// Theme of the Pixi Ready UI kit — Theme System V1.
//
// One theme colours the whole standard Game Core UI: window panels (body / header / border / depth), the semantic
// button roles, the close control, badges, cards, and the text colours. The kit draws those surfaces with Pixi
// Graphics from these tokens (see `skin.ts`); complex art — icons, coins, hearts, stars, gears, illustrations, the shop
// awning, the level-map badges — stays a texture and is never tinted by the theme.
//
// Colour is a property of the theme, never of the UI code: a view asks for `role: 'positive'`, the theme decides that
// positive is green today and blue in another game. Geometry that affects layout (positions, sizes, hit areas) never
// comes from the theme, so the same window under two themes has the same geometry; the skin numbers here (radius,
// border width, depth band, shadow offset) are drawn INSIDE the surface's own box.

export interface ReadyUiTextTheme {
  /** CSS font family registered by loadReadyUiAssets (Fira Sans Black by default). */
  fontFamily: string;
  /** Primary label colour (titles, counters). */
  fill: number;
  strokeColor: number;
  /** Stroke width as a fraction of the font size (donor UI: ~0.09). */
  strokeRatio: number;
  /** Secondary text (captions under a headline). */
  secondary: number;
  /** Muted text (versions, hints, disabled captions). */
  muted: number;
  /** Fallback label colour on buttons whose style has no `text` of its own. */
  onButton: number;
}

export interface ReadyUiColors {
  /** Solid backdrop behind the map when the background art is not used. */
  mapBackground: number;
  /** Modal dim layer (donor: black at 0.55 for shop/lives/settings/offers). */
  backdrop: number;
  backdropAlpha: number;
  /** The victory window's dim layer (donor: slate at 0.94, so it reads as part of the game screen). */
  resultBackdrop: number;
  resultBackdropAlpha: number;
  /** Settings version caption. */
  versionText: number;
  /** Fill of a locked node's shake / a hard pill's text etc. */
  accent: number;
  /** Secondary text color (timers, captions). Same as `text.secondary`; kept for v0.4 consumers. */
  textMuted: number;
}

export interface ReadyUiLevelMapTheme {
  /** Badge width in node-local units (donor: 300 over a 232 px Figma base). */
  badgeSize: number;
  /** Scale applied to every node (donor NODE_SCALE 1.215). */
  nodeScale: number;
  /** Distance between two neighbouring levels, in design units (donor 442 × nodeScale). */
  levelGap: number;
  /** How much the focused node grows over a plain one. */
  focusBoost: number;
  /** Focus point as a fraction of the viewport height (donor: the current badge sits at ~0.6). */
  focusRatio: number;
  /** Extra scale the donor's layout applies to the whole progression widget on a phone. */
  contentScale: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Skin tokens
// ---------------------------------------------------------------------------------------------------------------------

/** A surface fill: one colour, or a two-stop linear gradient across the surface's own box. */
export type UiFill =
  | { type: 'solid'; color: number; alpha?: number }
  | { type: 'linear-gradient'; from: number; to: number; direction: 'vertical' | 'horizontal'; alpha?: number };

export interface UiBorder {
  color: number;
  /** Stroke width in the surface's units, drawn inside its box. */
  width: number;
  alpha?: number;
}

/** The donor's "depth" band: a strip of another colour along one edge of the surface (a 3D lip). */
export interface UiDepth {
  color: number;
  height: number;
  /** Default 'bottom'. */
  edge?: 'bottom' | 'top';
  /**
   * 'plate' (default): the body is a smaller rounded rect resting on the lip — the donor's stacked look, the boundary
   * follows the body's corners. 'strip': the lip is the strip of the surface's own outline, a straight boundary (the
   * Bubble skin: a glossy body over a flat darker edge).
   */
  style?: 'plate' | 'strip';
}

/** A hard drop shadow (a second silhouette under the body), inside the surface's box. */
export interface UiShadow {
  color: number;
  alpha: number;
  offsetY: number;
  /** Soft edge: the shadow is stacked from this many silhouettes at growing offsets, each at `alpha / layers`. Default 1 (hard). */
  layers?: number;
}

/** A gloss band along the top edge of a surface (the casual "glass" highlight), drawn over the body and under the border. */
export interface UiBand {
  color: number;
  /** Band height in the surface's units, cut by the surface's own corners. */
  height: number;
  alpha?: number;
}

/** Any rounded surface: window body, button, badge, card, well, tab. */
export interface UiSurfaceStyle {
  fill: UiFill;
  /** Corner radius in the surface's units; a negative value = capsule (half the height). */
  radius: number;
  border: UiBorder | null;
  depth: UiDepth | null;
  shadow: UiShadow | null;
  /** Top gloss band. Omitted or null = none (Theme System V1 surfaces). */
  highlight?: UiBand | null;
}

/** A standard window surface: body + optional header band with its own fill and divider. */
export interface UiPanelStyle extends UiSurfaceStyle {
  /** null = no header band. */
  headerFill: UiFill | null;
  /** Default header band height (design units) when the window does not pass its own. */
  headerHeight: number;
  /** Line under the header, drawn as the band's bottom edge. */
  headerDivider: UiBorder | null;
  /** Inner well inside the body (the donor's `panel_inner`). */
  well: UiSurfaceStyle;
}

/** A content card (shop pack): a surface with an inset area (the icon well) above a plain band. */
export interface UiCardStyle extends UiSurfaceStyle {
  inset: { fill: UiFill; radius: number; top: number; side: number; bottom: number } | null;
}

export interface UiButtonStyle extends UiSurfaceStyle {
  /** Label colour. */
  text: number;
  /** Look at full press; `null` = only the press scale. Omitted fields keep the idle value. */
  pressed: { fill?: UiFill; depth?: UiDepth | null; border?: UiBorder | null; highlight?: UiBand | null } | null;
}

/**
 * A striped awning with a scalloped bottom edge (the shop's header): alternating stripes, each ending in a half-disc.
 * Stripe width = `stripeRatio × height`; the scallops are that wide and half as tall.
 */
export interface UiAwningStyle {
  stripeA: number;
  stripeB: number;
  stripeRatio: number;
  shadow: UiShadow | null;
}

/**
 * A tab bar: the bar surface, an idle tab (usually transparent) and the active tab, drawn with the `'tab'` shape
 * (rounded top corners, a flat bottom edge sitting on the bar).
 */
export interface UiTabStyle {
  bar: UiSurfaceStyle;
  item: UiSurfaceStyle;
  active: UiSurfaceStyle;
  /** Label colour of an idle tab. */
  text: number;
  /** Label colour of the active tab. */
  activeText: number;
}

/** The close control: an × mark drawn programmatically, with an optional backing surface. */
export interface UiCloseStyle {
  foreground: number;
  /** Outline drawn under the arms (the kit's label style: a light mark on a dark outline). null = none. */
  outline: UiBorder | null;
  /** Half-length of an arm as a fraction of the control size. */
  armRatio: number;
  /** Stroke width of an arm as a fraction of the control size. */
  strokeRatio: number;
  /** Backing surface (a light circle …) or null = transparent. */
  background: UiSurfaceStyle | null;
  pressed: { foreground?: number; background?: UiSurfaceStyle | null } | null;
}

/**
 * Semantic button roles. UI code names the role; the theme decides the colour.
 *  primary   — the main call to action of a screen
 *  secondary — an alternative action next to a primary one (RETRY, RESTART)
 *  positive  — confirm / buy / continue
 *  danger    — destructive: EXIT the level, give up
 *  reward    — watch an ad, claim a reward
 *  neutral   — icon buttons (gear, tools)
 *  disabled  — the look every role takes while disabled
 */
export type UiButtonRole = 'primary' | 'secondary' | 'positive' | 'danger' | 'reward' | 'neutral' | 'disabled';
export const UI_BUTTON_ROLES: readonly UiButtonRole[] = ['primary', 'secondary', 'positive', 'danger', 'reward', 'neutral', 'disabled'];

/** Badge variants: the HUD capsule (neutral), a red band (accent), a title ribbon (info). */
export type UiBadgeVariant = 'neutral' | 'accent' | 'info';

/** `programmatic` (default): the kit draws its standard surfaces from the theme. `art`: the v0.4 PNG skins. */
export type ReadyUiSkin = 'programmatic' | 'art';

export interface ReadyUiTheme {
  text: ReadyUiTextTheme;
  colors: ReadyUiColors;
  levelMap: ReadyUiLevelMapTheme;
  /** Portrait design box the kit lays out against (contain-fit, like the donor's 1080 × 2344). */
  designWidth: number;
  designHeight: number;
  skin: ReadyUiSkin;
  /** Standard window surface (Settings, Lives, offers on a plain panel). */
  panel: UiPanelStyle;
  /** Promotional panel (Starter Pack): usually a gradient, no header. */
  promoPanel: UiPanelStyle;
  /** Shop pack card. */
  card: UiCardStyle;
  badge: Record<UiBadgeVariant, UiSurfaceStyle>;
  button: Record<UiButtonRole, UiButtonStyle>;
  close: UiCloseStyle;
  /** Tab bar shells (a bottom navigation, a shop category row). */
  tab: UiTabStyle;
  /** The shop's striped awning drawn from tokens; null = the awning stays the v0.4 art (the default). */
  awning: UiAwningStyle | null;
  /**
   * Level-map node shells drawn from tokens (a disc per state: the ring is the border, the gloss / lip as everywhere);
   * null = the nodes stay the v0.4 badge art (the default). Stars, the lock, the number and the HARD pill stay art / text.
   */
  levelNode: Record<UiLevelNodeVariant, UiSurfaceStyle> | null;
}

/** The three looks of a level-map node (the same states `LevelMapView` reports). */
export type UiLevelNodeVariant = 'completed' | 'current' | 'locked';

// ---------------------------------------------------------------------------------------------------------------------
// Default theme — the donor (Trail Arrow) palette measured from the v0.4 PNG skins, drawn as geometry.
// ---------------------------------------------------------------------------------------------------------------------

const solid = (color: number, alpha?: number): UiFill => (alpha === undefined ? { type: 'solid', color } : { type: 'solid', color, alpha });
const gradient = (from: number, to: number, direction: 'vertical' | 'horizontal' = 'vertical'): UiFill => ({ type: 'linear-gradient', from, to, direction });

/** Donor button skin: 207-tall rounded rect, a 6-unit dark outline and a 14-unit darker lip at the bottom. */
function donorButton(fill: UiFill, depth: number, text = 0xffffff): UiButtonStyle {
  return {
    fill,
    radius: 30,
    border: { color: 0x241c2f, width: 6 },
    depth: { color: depth, height: 14 },
    shadow: null,
    text,
    pressed: { fill: solid(depth), depth: null }
  };
}

export const DEFAULT_READY_UI_THEME: ReadyUiTheme = deepFreeze({
  text: {
    fontFamily: 'Firasans Black',
    fill: 0xffffff,
    strokeColor: 0x000000,
    strokeRatio: 0.12,
    secondary: 0xfff3d6,
    muted: 0x716dd0,
    onButton: 0xffffff
  },
  colors: {
    mapBackground: 0x1d2231,
    backdrop: 0x000000,
    backdropAlpha: 0.55,
    resultBackdrop: 0x2c2f37,
    resultBackdropAlpha: 0.94,
    versionText: 0x716dd0,
    accent: 0xff5a5a,
    textMuted: 0xfff3d6
  },
  levelMap: {
    badgeSize: 300,
    nodeScale: 1.215,
    levelGap: 442 * 1.215,
    focusBoost: 1.18,
    focusRatio: 0.6,
    contentScale: 0.963
  },
  designWidth: 1080,
  designHeight: 2344,
  skin: 'programmatic',
  panel: {
    // window/panel_purple.webp: lavender body, purple header (160 of 1070), a darker divider, a lighter lip at the bottom
    fill: solid(0xc0beff),
    radius: 44,
    border: { color: 0x261a34, width: 6 },
    depth: { color: 0xa8a1f1, height: 20 },
    shadow: null,
    headerFill: solid(0x7354d7),
    headerHeight: 160,
    headerDivider: { color: 0x573da1, width: 14 },
    well: { fill: solid(0xa0a0f5), radius: 36, border: null, depth: null, shadow: null }
  },
  promoPanel: {
    // offer/starter_panel.webp: warm vertical gradient inside a dark outline, no header
    fill: gradient(0xfec001, 0xfc5363),
    radius: 44,
    border: { color: 0x2b1830, width: 8 },
    depth: null,
    shadow: null,
    headerFill: null,
    headerHeight: 0,
    headerDivider: null,
    well: { fill: solid(0xffe9c4, 0.55), radius: 36, border: null, depth: null, shadow: null }
  },
  card: {
    // shop/card.webp at 318 × 418: light blue card, a darker inset for the coin pile, the price band below it
    fill: solid(0x2ea3f2),
    radius: 28,
    border: { color: 0x17203d, width: 4 },
    depth: { color: 0x0573e9, height: 18 },
    shadow: null,
    inset: { fill: solid(0x0074ce), radius: 20, top: 24, side: 18, bottom: 98 }
  },
  badge: {
    // hud/capsule.webp drawn at 218 × 72: dark violet pill, a lighter lip on top, a soft shadow below
    neutral: { fill: solid(0x3e375e), radius: -1, border: null, depth: { color: 0x534791, height: 5, edge: 'top' }, shadow: { color: 0x000000, alpha: 0.21, offsetY: 8 } },
    // offer/border.webp: the red booster band
    accent: { fill: solid(0xd04640), radius: 50, border: null, depth: { color: 0xad3530, height: 14, edge: 'top' }, shadow: null },
    // shop/ribbon_blue.webp: the blue title ribbon
    info: { fill: solid(0x27a2ff), radius: 12, border: { color: 0x102451, width: 6 }, depth: { color: 0x0970eb, height: 16 }, shadow: null }
  },
  button: {
    primary: donorButton(solid(0x2b8cff), 0x0b5fc0),
    secondary: donorButton(solid(0x7a6ce0), 0x4d3fae),
    positive: donorButton(solid(0x3cc026), 0x039438),
    danger: donorButton(solid(0xd02d46), 0xa31a2a),
    reward: donorButton(gradient(0xffe316, 0xffa917, 'horizontal'), 0xd35c1b),
    // hud/gear_back.webp: dark violet rounded square, lighter lip on top, soft shadow
    neutral: { fill: solid(0x3d365f), radius: 34, border: null, depth: { color: 0x52468e, height: 6, edge: 'top' }, shadow: { color: 0x000000, alpha: 0.21, offsetY: 9 }, text: 0xffffff, pressed: { fill: solid(0x2e284a) } },
    disabled: donorButton(solid(0xa3a3b3), 0x737384, 0xeeeef4)
  },
  close: {
    // a light × on the kit's dark label outline, no backing — not the donor's red silhouette (a colour, not a role)
    foreground: 0xffffff,
    outline: { color: 0x241c2f, width: 4 },
    armRatio: 0.34,
    strokeRatio: 0.2,
    background: null,
    pressed: { foreground: 0xd9d6ff }
  },
  tab: {
    // the donor family has no tab bar: the HUD capsule colours as a bar, the header purple as the active tab
    bar: { fill: solid(0x3e375e), radius: 40, border: null, depth: { color: 0x534791, height: 6, edge: 'top' }, shadow: null },
    item: { fill: solid(0xffffff, 0), radius: 36, border: null, depth: null, shadow: null },
    active: { fill: solid(0x7354d7), radius: 36, border: { color: 0x261a34, width: 6 }, depth: null, shadow: null },
    text: 0xc9c4f0,
    activeText: 0xffffff
  },
  awning: null,
  levelNode: null
});

/** Demo theme B ("ocean"): blue header / light-blue body, cyan primary, teal positive, orange reward, dark × on a light disc. */
export const ALT_READY_UI_THEME: ReadyUiTheme = deepFreeze({
  ...DEFAULT_READY_UI_THEME,
  text: { ...DEFAULT_READY_UI_THEME.text, strokeColor: 0x10233f, secondary: 0xdff1ff, muted: 0x5b7fb8 },
  colors: { ...DEFAULT_READY_UI_THEME.colors, mapBackground: 0x0f1c33, resultBackdrop: 0x14213a, versionText: 0x5b7fb8, accent: 0xff8a3d, textMuted: 0xdff1ff },
  panel: {
    fill: solid(0xcfe6ff),
    radius: 44,
    border: { color: 0x10233f, width: 6 },
    depth: { color: 0xb3d2f5, height: 20 },
    shadow: null,
    headerFill: solid(0x1f6fd8),
    headerHeight: 160,
    headerDivider: { color: 0x164fa8, width: 14 },
    well: { fill: solid(0xb8d8fb), radius: 36, border: null, depth: null, shadow: null }
  },
  promoPanel: {
    fill: gradient(0x34d0ff, 0x1d5fe0),
    radius: 44,
    border: { color: 0x10233f, width: 8 },
    depth: null,
    shadow: null,
    headerFill: null,
    headerHeight: 0,
    headerDivider: null,
    well: { fill: solid(0xe6f6ff, 0.5), radius: 36, border: null, depth: null, shadow: null }
  },
  card: {
    fill: solid(0x8fd3ff),
    radius: 28,
    border: { color: 0x10233f, width: 4 },
    depth: { color: 0x4fa8e6, height: 18 },
    shadow: null,
    inset: { fill: solid(0x1a7fd0), radius: 20, top: 24, side: 18, bottom: 98 }
  },
  badge: {
    neutral: { fill: solid(0x17385c), radius: -1, border: null, depth: { color: 0x2b5a8a, height: 5, edge: 'top' }, shadow: { color: 0x000000, alpha: 0.25, offsetY: 8 } },
    accent: { fill: solid(0xff8a3d), radius: 50, border: null, depth: { color: 0xd9662a, height: 14, edge: 'top' }, shadow: null },
    info: { fill: solid(0xffb84d), radius: 12, border: { color: 0x3d2600, width: 6 }, depth: { color: 0xd98a1e, height: 16 }, shadow: null }
  },
  button: {
    primary: { ...donorButton(solid(0x22c8e6), 0x0f8fa8), border: { color: 0x10233f, width: 6 } },
    secondary: { ...donorButton(solid(0x5b8fd6), 0x2f5fa8), border: { color: 0x10233f, width: 6 } },
    positive: { ...donorButton(solid(0x21b5a0), 0x0f7f70), border: { color: 0x10233f, width: 6 } },
    danger: { ...donorButton(solid(0xe04b5a), 0xa8202f), border: { color: 0x10233f, width: 6 } },
    reward: { ...donorButton(gradient(0xffb347, 0xff7a1a, 'horizontal'), 0xc9501a), border: { color: 0x10233f, width: 6 } },
    neutral: { fill: solid(0x17385c), radius: 34, border: null, depth: { color: 0x2b5a8a, height: 6, edge: 'top' }, shadow: { color: 0x000000, alpha: 0.25, offsetY: 9 }, text: 0xffffff, pressed: { fill: solid(0x0f2640) } },
    disabled: { ...donorButton(solid(0x9aa9bb), 0x6b7a8c, 0xf2f6fb), border: { color: 0x10233f, width: 6 } }
  },
  close: {
    foreground: 0x10233f,
    outline: null,
    armRatio: 0.26,
    strokeRatio: 0.16,
    background: { fill: solid(0xe8f3ff), radius: -1, border: { color: 0x10233f, width: 4 }, depth: null, shadow: null },
    pressed: { foreground: 0x10233f, background: { fill: solid(0xbfd9f7), radius: -1, border: { color: 0x10233f, width: 4 }, depth: null, shadow: null } }
  },
  tab: {
    bar: { fill: solid(0x17385c), radius: 40, border: null, depth: { color: 0x2b5a8a, height: 6, edge: 'top' }, shadow: null },
    item: { fill: solid(0xffffff, 0), radius: 36, border: null, depth: null, shadow: null },
    active: { fill: solid(0x1f6fd8), radius: 36, border: { color: 0x10233f, width: 6 }, depth: null, shadow: null },
    text: 0xb8d8fb,
    activeText: 0xffffff
  },
  awning: null,
  levelNode: null
});

// ---------------------------------------------------------------------------------------------------------------------
// Bubble theme — the casual "glossy" language: every surface is a soft vertical gradient with a bright gloss band over
// its top, a flat darker lip under it, a soft outline and a soft shadow; windows are mid-blue with a lighter header zone
// and a much lighter inner card (a clear second layer); the CTAs are green / orange / gold with lime / yellow gloss.
// Measured from a reference casual game's UI (visual principles only — no art is copied), generic enough for any game.
// ---------------------------------------------------------------------------------------------------------------------

/** Bubble button: a gradient body, a gloss band over its top quarter, a flat darker lip, a soft outline and shadow. */
function bubbleButton(top: number, bottom: number, gloss: number, lip: number, outline: number, text = 0xfff6e2): UiButtonStyle {
  return {
    fill: gradient(top, bottom),
    radius: 34,
    border: { color: outline, width: 5, alpha: 0.85 },
    depth: { color: lip, height: 26, style: 'strip' },
    shadow: { color: 0x000000, alpha: 0.22, offsetY: 8, layers: 2 },
    highlight: { color: gloss, height: 48, alpha: 0.9 },
    text,
    pressed: { fill: solid(bottom), depth: null, highlight: null }
  };
}

const BUBBLE_SHADOW: UiShadow = { color: 0x000000, alpha: 0.3, offsetY: 14, layers: 3 };

export const BUBBLE_READY_UI_THEME: ReadyUiTheme = deepFreeze({
  ...DEFAULT_READY_UI_THEME,
  text: { ...DEFAULT_READY_UI_THEME.text, fill: 0xfff6e2, strokeColor: 0x1e2c4f, strokeRatio: 0.09, secondary: 0xdbe6fb, muted: 0x8fa5d8, onButton: 0xfff6e2 },
  colors: { ...DEFAULT_READY_UI_THEME.colors, mapBackground: 0x263048, backdrop: 0x0b1224, backdropAlpha: 0.62, resultBackdrop: 0x1e2740, resultBackdropAlpha: 0.94, versionText: 0x8fa5d8, accent: 0xff6b57, textMuted: 0xdbe6fb },
  panel: {
    // mid-blue window: lighter at the top, a thin light edge, a flat darker lip, a dark-blue outline, a soft shadow
    fill: gradient(0x6486ca, 0x4c62a9),
    radius: 52,
    border: { color: 0x33478a, width: 6, alpha: 0.9 },
    depth: { color: 0x43569c, height: 18, style: 'strip' },
    shadow: BUBBLE_SHADOW,
    highlight: { color: 0xa2bdf2, height: 8, alpha: 0.55 },
    // the header zone: a translucent lighter band with a soft line under it (a separation, not a second slab)
    headerFill: solid(0xffffff, 0.09),
    headerHeight: 160,
    headerDivider: { color: 0x2c3f78, width: 4, alpha: 0.35 },
    // the inner card: much lighter than the window, an inset darker bottom edge — the second layer
    well: { fill: gradient(0xc8ddfc, 0xa6bce6), radius: 36, border: { color: 0x7d95c6, width: 4, alpha: 0.9 }, depth: { color: 0x94aad8, height: 12, style: 'strip' }, shadow: null, highlight: { color: 0xe6f0ff, height: 8, alpha: 0.7 } }
  },
  promoPanel: {
    fill: gradient(0xffc94a, 0xff7b3e),
    radius: 52,
    border: { color: 0xa8481c, width: 8, alpha: 0.9 },
    depth: { color: 0xe5642c, height: 18, style: 'strip' },
    shadow: BUBBLE_SHADOW,
    highlight: { color: 0xffe9a0, height: 10, alpha: 0.6 },
    headerFill: null,
    headerHeight: 0,
    headerDivider: null,
    well: { fill: solid(0xfff1d6, 0.55), radius: 36, border: null, depth: null, shadow: null, highlight: { color: 0xffffff, height: 8, alpha: 0.4 } }
  },
  card: {
    // cream card with a green price band along the bottom (the band is the flat lip), no darker icon inset
    fill: gradient(0xfff3dc, 0xf7e3c4),
    radius: 30,
    border: { color: 0xd8bf95, width: 4, alpha: 0.9 },
    depth: { color: 0x33b41f, height: 98, style: 'strip' },
    shadow: { color: 0x000000, alpha: 0.22, offsetY: 10, layers: 2 },
    highlight: { color: 0xffffff, height: 10, alpha: 0.5 },
    inset: null
  },
  badge: {
    // HUD capsule: a slate pill a little lighter than the map, gloss on top, a flat darker lip, a soft shadow
    neutral: { fill: gradient(0x6d7dae, 0x4f587f), radius: -1, border: { color: 0x2b3454, width: 3, alpha: 0.7 }, depth: { color: 0x424a6c, height: 8, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.28, offsetY: 7, layers: 2 }, highlight: { color: 0x8c9ac4, height: 9, alpha: 0.7 } },
    accent: { fill: gradient(0xff7b5c, 0xe2452e), radius: 50, border: { color: 0x8f2416, width: 5, alpha: 0.8 }, depth: { color: 0xbb3320, height: 14, style: 'strip' }, shadow: null, highlight: { color: 0xffa892, height: 20, alpha: 0.6 } },
    info: { fill: gradient(0x6a78ab, 0x4d5788), radius: 16, border: { color: 0x2b3454, width: 5, alpha: 0.8 }, depth: { color: 0x3f4870, height: 14, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.25, offsetY: 8, layers: 2 }, highlight: { color: 0x8f9cc6, height: 16, alpha: 0.6 } }
  },
  button: {
    primary: bubbleButton(0x5a8cf0, 0x2f62d0, 0x8fb4ff, 0x1d49b0, 0x163a8a),
    secondary: bubbleButton(0xffb322, 0xf98f06, 0xffd257, 0xd97404, 0xb5640a),
    positive: bubbleButton(0x4fd02c, 0x31ad1d, 0x84f846, 0x229417, 0x196e10),
    danger: bubbleButton(0xff6b57, 0xe23d2b, 0xff9d8a, 0xba2818, 0x8f1d10),
    reward: bubbleButton(0xffe04a, 0xffb01e, 0xfff59a, 0xe8920e, 0xb5640a),
    // icon-button shell (gear, tools): a slate square with the same gloss / lip language
    neutral: { fill: gradient(0x8593b5, 0x5f6a8c), radius: 30, border: { color: 0x2f3854, width: 4, alpha: 0.8 }, depth: { color: 0x4a5474, height: 16, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.25, offsetY: 8, layers: 2 }, highlight: { color: 0xa9b7d6, height: 30, alpha: 0.75 }, text: 0xffffff, pressed: { fill: solid(0x525c7c), depth: null, highlight: null } },
    disabled: { ...bubbleButton(0x9aa4b8, 0x7d869a, 0xb7c0d2, 0x687089, 0x4c536a, 0xe6eaf2), highlight: { color: 0xb7c0d2, height: 48, alpha: 0.5 }, border: { color: 0x4c536a, width: 5, alpha: 0.7 } }
  },
  close: {
    // a bold light-blue × with round caps on a soft dark outline (it must read on the light awning stripes too), no backing
    foreground: 0xd2e5fb,
    outline: { color: 0x22345f, width: 4, alpha: 0.75 },
    armRatio: 0.32,
    strokeRatio: 0.24,
    background: null,
    pressed: { foreground: 0xa6c2ea }
  },
  tab: {
    bar: { fill: gradient(0x445684, 0x35446c), radius: 40, border: { color: 0x243055, width: 4, alpha: 0.8 }, depth: null, shadow: null, highlight: { color: 0x5d6f9e, height: 8, alpha: 0.6 } },
    item: { fill: solid(0xffffff, 0), radius: 36, border: null, depth: null, shadow: null },
    active: { fill: gradient(0x6b8ad0, 0x4f6fbd), radius: 36, border: { color: 0x2c3f78, width: 4, alpha: 0.8 }, depth: null, shadow: null, highlight: { color: 0x9ab6ee, height: 10, alpha: 0.6 } },
    text: 0xc7d3ea,
    activeText: 0xfff3d0
  },
  // the shop awning in the same blue family: light / mid-blue stripes with scalloped ends and a soft shadow
  awning: { stripeA: 0xbfd6f6, stripeB: 0x5f88ce, stripeRatio: 0.7, shadow: { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 } },
  // level nodes: green discs in a gold ring (the current one brighter), a grey disc in a slate ring when locked
  levelNode: {
    completed: { fill: gradient(0x8ae651, 0x4db82b), radius: -1, border: { color: 0xd9a93c, width: 16 }, depth: { color: 0x3e9a22, height: 40, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 }, highlight: { color: 0xc3ff8a, height: 56, alpha: 0.55 } },
    current: { fill: gradient(0x9bf05c, 0x5bc733), radius: -1, border: { color: 0xf2c14e, width: 18 }, depth: { color: 0x45a626, height: 44, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 }, highlight: { color: 0xd6ff9e, height: 60, alpha: 0.65 } },
    locked: { fill: gradient(0xbdbcc8, 0x8e8f9e), radius: -1, border: { color: 0x6d7386, width: 14 }, depth: { color: 0x7a7d8f, height: 40, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 }, highlight: { color: 0xe2e3ea, height: 56, alpha: 0.45 } }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------------------------------

/** Every field optional, at every depth. `null` is a value (it removes a border / shadow / header). */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<unknown>
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export type ReadyUiThemeOverrides = DeepPartial<ReadyUiTheme>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function mergeDeep<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const value = override[key];
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? mergeDeep(current, value) : cloneValue(value);
  }
  return out as T;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = cloneValue(value[key]);
    return out as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Resolves a game's theme over a base (the default theme unless another is given): merged in depth, deterministically,
 * without mutating either input; a nested override keeps every sibling value of the base. Without overrides the base
 * itself is returned. A fully resolved theme passed as overrides resolves to an equal theme, so one `theme` object can
 * be handed to every view.
 */
export function resolveTheme(overrides?: ReadyUiThemeOverrides, base: ReadyUiTheme = DEFAULT_READY_UI_THEME): ReadyUiTheme {
  if (!overrides) return base;
  return mergeDeep(base, overrides);
}

/** The style of a semantic button role in a theme (`disabled` is the role every button takes while disabled). */
export function buttonStyleOf(theme: ReadyUiTheme, role: UiButtonRole): UiButtonStyle {
  return theme.button[role];
}
