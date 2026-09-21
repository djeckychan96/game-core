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
  /**
   * Fill of the big display numbers (a shop pack's amount): a solid colour or a gradient across the label's own box.
   * Omitted = `fill`. This is the one display style of the kit — not a typography system.
   */
  numberFill?: UiFill;
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

/** One stop of a gradient: where along the gradient (0..1), which colour, optionally how opaque. */
export interface UiColorStop {
  offset: number;
  color: number;
  alpha?: number;
}

/**
 * A surface fill: one colour, a linear gradient across the surface's own box (two stops `from` → `to`, or any list of
 * `stops`, which wins when given), or a radial gradient in the box's own space: the last stop is reached on the box's
 * inscribed circle, `center` (0..1 of the box, default 0.5 / 0.4) is where the first stop — the light — sits.
 */
export type UiFill =
  | { type: 'solid'; color: number; alpha?: number }
  | { type: 'linear-gradient'; from: number; to: number; direction: 'vertical' | 'horizontal'; alpha?: number; stops?: UiColorStop[] }
  | { type: 'radial-gradient'; stops: UiColorStop[]; center?: { x: number; y: number }; alpha?: number };

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
  /** A `'strip'` lip may carry a fill of its own (a gradient zone that darkens into its edge) instead of the flat colour. */
  fill?: UiFill;
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
  /**
   * How much of the band fades out towards its inner edge (0..1 of the height). 0 (default) = a hard edge (a flat
   * stripe); 1 = full strength at the surface's edge fading to nothing at the band's inner edge (a soft gloss).
   */
  soft?: number;
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
 * A striped awning with a scalloped bottom edge (the shop's header): `segments` alternating stripes across the width
 * (each filled in its own box, so a gradient runs down every stripe), each ending in a half-disc scallop as wide as the
 * stripe; an optional soft gloss across the top; a soft shadow under the cloth.
 */
export interface UiAwningStyle {
  fillA: UiFill;
  fillB: UiFill;
  /** Stripes across the width (an odd count keeps both ends the same colour). The width follows the viewport. */
  segments: number;
  gloss: UiBand | null;
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
// Bubble theme — the casual "glossy" language, as three INDEPENDENT layers on every surface: the body is a SMOOTH
// vertical gradient (three stops: light → the colour → a little darker), the gloss is a soft light that fades into the
// body over the top, the lip is a flat darker mechanical edge under it; plus a soft outline and a soft shadow. Windows
// are mid-blue with a lighter header zone and a much lighter inner card (a clear second layer); the CTAs are green /
// orange / gold with lime / yellow gloss; the level nodes are radial "spheres" in a ring. Measured from a reference
// casual game's UI (visual principles only — no art is copied), generic enough for any game.
// ---------------------------------------------------------------------------------------------------------------------

/** A smooth three-stop vertical body: light at the top, the colour through the middle, a little darker at the bottom. */
function body(top: number, mid: number, bottom: number): UiFill {
  return { type: 'linear-gradient', from: top, to: bottom, direction: 'vertical', stops: [{ offset: 0, color: top }, { offset: 0.55, color: mid }, { offset: 1, color: bottom }] };
}

/** A soft gloss: full strength along the top edge, fading to nothing over `soft` of the band (1 = the whole band). */
function gloss(color: number, height: number, alpha: number, soft = 1): UiBand {
  return { color, height, alpha, soft };
}

/** A sphere-like radial body for a disc: light near the upper centre, the colour, darker towards the rim. */
function sphere(light: number, mid: number, dark: number): UiFill {
  return { type: 'radial-gradient', center: { x: 0.5, y: 0.34 }, stops: [{ offset: 0, color: light }, { offset: 0.5, color: mid }, { offset: 1, color: dark }] };
}

/** Bubble button: a smooth body, a soft gloss over its top, a flat darker lip, a soft outline and shadow. */
function bubbleButton(top: number, mid: number, bottom: number, glossColor: number, lip: number, outline: number, text = 0xfff6e2): UiButtonStyle {
  return {
    fill: body(top, mid, bottom),
    radius: 34,
    border: { color: outline, width: 5, alpha: 0.85 },
    depth: { color: lip, height: 24, style: 'strip' },
    shadow: { color: 0x000000, alpha: 0.22, offsetY: 8, layers: 2 },
    highlight: gloss(glossColor, 64, 0.55, 0.8),
    text,
    pressed: { fill: solid(bottom), depth: null, highlight: null }
  };
}

const BUBBLE_SHADOW: UiShadow = { color: 0x000000, alpha: 0.3, offsetY: 14, layers: 3 };
const NODE_SHADOW: UiShadow = { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 };

export const BUBBLE_READY_UI_THEME: ReadyUiTheme = deepFreeze({
  ...DEFAULT_READY_UI_THEME,
  text: {
    ...DEFAULT_READY_UI_THEME.text,
    fill: 0xfff6e2,
    strokeColor: 0x1e2c4f,
    strokeRatio: 0.09,
    secondary: 0xdbe6fb,
    muted: 0x8fa5d8,
    onButton: 0xfff6e2,
    // display numbers: light gold at the top into orange below (the shop amounts)
    numberFill: { type: 'linear-gradient', from: 0xfff3a6, to: 0xff9f1c, direction: 'vertical', stops: [{ offset: 0, color: 0xfff6b8 }, { offset: 0.45, color: 0xffd23c }, { offset: 1, color: 0xff9f1c }] }
  },
  colors: { ...DEFAULT_READY_UI_THEME.colors, mapBackground: 0x263048, backdrop: 0x0b1224, backdropAlpha: 0.62, resultBackdrop: 0x1e2740, resultBackdropAlpha: 0.94, versionText: 0x8fa5d8, accent: 0xff6b57, textMuted: 0xdbe6fb },
  panel: {
    // mid-blue window: a smooth body lighter at the top, a soft light zone over it, a flat darker lip, a dark-blue
    // outline, a soft shadow
    fill: body(0x6b8ccf, 0x5872bc, 0x4b61a8),
    radius: 52,
    border: { color: 0x33478a, width: 6, alpha: 0.9 },
    depth: { color: 0x43569c, height: 18, style: 'strip' },
    shadow: BUBBLE_SHADOW,
    highlight: gloss(0xb4caf6, 110, 0.32),
    // the header zone: a translucent lighter band with a soft line under it (a separation, not a second slab)
    headerFill: solid(0xffffff, 0.08),
    headerHeight: 160,
    headerDivider: { color: 0x2c3f78, width: 4, alpha: 0.3 },
    // the inner card: much lighter than the window, an inset darker bottom edge — the second layer
    well: { fill: body(0xd2e4fd, 0xbbcff2, 0xa4bae5), radius: 36, border: { color: 0x7d95c6, width: 4, alpha: 0.9 }, depth: { color: 0x92a8d6, height: 10, style: 'strip' }, shadow: null, highlight: gloss(0xffffff, 30, 0.45) }
  },
  promoPanel: {
    fill: body(0xffd35a, 0xffa042, 0xff7a3d),
    radius: 52,
    border: { color: 0xa8481c, width: 8, alpha: 0.9 },
    depth: { color: 0xe5642c, height: 18, style: 'strip' },
    shadow: BUBBLE_SHADOW,
    highlight: gloss(0xfff0b0, 70, 0.45),
    headerFill: null,
    headerHeight: 0,
    headerDivider: null,
    well: { fill: solid(0xfff1d6, 0.55), radius: 36, border: null, depth: null, shadow: null, highlight: gloss(0xffffff, 24, 0.35) }
  },
  card: {
    // cream card: a smooth warm body; the price zone is the lip strip with a green gradient of its own that darkens
    // into its bottom edge (the smooth green zone + the dark lip of the reference); no darker icon inset
    fill: body(0xfff7e8, 0xfbeed8, 0xf4e2c5),
    radius: 30,
    border: { color: 0xd9c39c, width: 4, alpha: 0.9 },
    depth: {
      color: 0x2fae1d,
      height: 98,
      style: 'strip',
      fill: { type: 'linear-gradient', from: 0x74dd4e, to: 0x1c8512, direction: 'vertical', stops: [{ offset: 0, color: 0x74dd4e }, { offset: 0.6, color: 0x3cc027 }, { offset: 0.85, color: 0x2fae1d }, { offset: 0.86, color: 0x1f9214 }, { offset: 1, color: 0x1c8512 }] }
    },
    shadow: { color: 0x000000, alpha: 0.22, offsetY: 10, layers: 2 },
    highlight: gloss(0xffffff, 22, 0.55),
    inset: null
  },
  badge: {
    // HUD capsule: a slate pill a little lighter than the map, a soft gloss, a flat darker lip, a soft shadow
    neutral: { fill: body(0x7f8ebd, 0x62709c, 0x4c567f), radius: -1, border: { color: 0x2b3454, width: 3, alpha: 0.6 }, depth: { color: 0x3f486c, height: 7, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.28, offsetY: 7, layers: 2 }, highlight: gloss(0xaebbdf, 30, 0.45) },
    accent: { fill: body(0xff9a7e, 0xf1614a, 0xdc4030), radius: 50, border: { color: 0x8f2416, width: 5, alpha: 0.8 }, depth: { color: 0xb32f1d, height: 14, style: 'strip' }, shadow: null, highlight: gloss(0xffc4b4, 56, 0.45) },
    info: { fill: body(0x7585b8, 0x5c6a99, 0x4a5586), radius: 16, border: { color: 0x2b3454, width: 3, alpha: 0.6 }, depth: { color: 0x3d4669, height: 10, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.2, offsetY: 8, layers: 2 }, highlight: gloss(0x9fadd2, 40, 0.35) }
  },
  button: {
    primary: bubbleButton(0x6f9cf5, 0x4a7ae4, 0x2f5fd0, 0xa9c6ff, 0x1f48ad, 0x163a8a),
    secondary: bubbleButton(0xffcf3d, 0xffb020, 0xf5920a, 0xffe680, 0xd86f04, 0xb35d08),
    positive: bubbleButton(0x62dc3a, 0x3fc424, 0x2fa61a, 0xa8ff5a, 0x1f8f14, 0x1a6e10),
    danger: bubbleButton(0xff8a6c, 0xf25a44, 0xd83a2a, 0xffb8a4, 0xb02416, 0x8a1c10),
    reward: bubbleButton(0xffe873, 0xffcf2e, 0xffa91c, 0xfff5b0, 0xe08a0d, 0xb5640a),
    // icon-button shell (gear, tools, the moves box): a slate square with the same smooth body / gloss / lip language
    neutral: { fill: body(0x93a1c4, 0x7382a8, 0x5b6a90), radius: 30, border: { color: 0x2f3854, width: 4, alpha: 0.8 }, depth: { color: 0x48527a, height: 14, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.25, offsetY: 8, layers: 2 }, highlight: gloss(0xc0cce6, 44, 0.5), text: 0xffffff, pressed: { fill: solid(0x525c7c), depth: null, highlight: null } },
    disabled: { ...bubbleButton(0xa8b0c2, 0x8f97aa, 0x7a8296, 0xc7cdd9, 0x666e84, 0x4c536a, 0xe6eaf2), highlight: gloss(0xc7cdd9, 64, 0.3, 0.8), border: { color: 0x4c536a, width: 5, alpha: 0.7 } }
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
    bar: { fill: body(0x4a5c8c, 0x3d4d7a, 0x33426a), radius: 40, border: { color: 0x243055, width: 4, alpha: 0.8 }, depth: null, shadow: null, highlight: gloss(0x6d7fae, 24, 0.4) },
    item: { fill: solid(0xffffff, 0), radius: 36, border: null, depth: null, shadow: null },
    active: { fill: body(0x7394d8, 0x5a7bc6, 0x4b6cb6), radius: 36, border: { color: 0x2c3f78, width: 4, alpha: 0.8 }, depth: null, shadow: null, highlight: gloss(0xa8c1f2, 30, 0.45) },
    text: 0xc7d3ea,
    activeText: 0xfff3d0
  },
  // the shop awning in the same blue family: seven light / mid-blue stripes (each a smooth gradient down to its scallop),
  // a soft gloss across the top, a soft shadow under the cloth
  awning: { fillA: body(0xd8e7fb, 0xbfd6f6, 0xa6c2ec), fillB: body(0x7ea3de, 0x5f88ce, 0x4a72bb), segments: 7, gloss: gloss(0xffffff, 34, 0.3), shadow: { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 } },
  // level nodes: radial spheres in a ring, a thin darker rim under the ring (green in gold; grey in slate when locked)
  levelNode: {
    completed: { fill: sphere(0x9ff062, 0x5cc432, 0x3b9a22), radius: -1, border: { color: 0xd9a93c, width: 16 }, depth: { color: 0x2f8a1e, height: 34, style: 'strip' }, shadow: NODE_SHADOW },
    current: { fill: sphere(0xc6ff7c, 0x6fd63b, 0x43a827), radius: -1, border: { color: 0xf2c14e, width: 18 }, depth: { color: 0x3a9a25, height: 36, style: 'strip' }, shadow: NODE_SHADOW },
    locked: { fill: sphere(0xd3d3dc, 0xa4a5b2, 0x767889), radius: -1, border: { color: 0x6d7386, width: 14 }, depth: { color: 0x5f6273, height: 32, style: 'strip' }, shadow: NODE_SHADOW }
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
