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
}

/** A hard drop shadow (a second silhouette under the body), inside the surface's box. */
export interface UiShadow {
  color: number;
  alpha: number;
  offsetY: number;
}

/** Any rounded surface: window body, button, badge, card, well. */
export interface UiSurfaceStyle {
  fill: UiFill;
  /** Corner radius in the surface's units; a negative value = capsule (half the height). */
  radius: number;
  border: UiBorder | null;
  depth: UiDepth | null;
  shadow: UiShadow | null;
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
  pressed: { fill?: UiFill; depth?: UiDepth | null; border?: UiBorder | null } | null;
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
}

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
  }
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
