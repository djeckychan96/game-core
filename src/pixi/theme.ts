// Minimal theme seam for the Pixi Ready UI kit (v0.4): colors, text style, a few spacings.
// Deliberately small — the default theme is meant to look right out of the box.

export interface ReadyUiTextTheme {
  /** CSS font family registered by loadReadyUiAssets (Fira Sans Black by default). */
  fontFamily: string;
  fill: number;
  strokeColor: number;
  /** Stroke width as a fraction of the font size (donor UI: ~0.09). */
  strokeRatio: number;
}

export interface ReadyUiColors {
  /** Solid backdrop behind the map when the background art is not used. */
  mapBackground: number;
  /** Modal dim layer color/alpha (donor: dark slate at 0.94). */
  backdrop: number;
  backdropAlpha: number;
  /** Fill of a locked node's shake / a hard pill's text etc. */
  accent: number;
  /** Secondary text color (timers, captions). */
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
  /** Focus point as a fraction of the visible map height (0 = top, 1 = bottom). */
  focusRatio: number;
}

export interface ReadyUiTheme {
  text: ReadyUiTextTheme;
  colors: ReadyUiColors;
  levelMap: ReadyUiLevelMapTheme;
  /** Portrait design box the kit lays out against (contain-fit, like the donor's 1080 × 2344). */
  designWidth: number;
  designHeight: number;
}

export const DEFAULT_READY_UI_THEME: ReadyUiTheme = {
  text: {
    fontFamily: 'Firasans Black',
    fill: 0xffffff,
    strokeColor: 0x1d1428,
    strokeRatio: 0.09
  },
  colors: {
    mapBackground: 0x1d2231,
    backdrop: 0x2c2f37,
    backdropAlpha: 0.94,
    accent: 0xff5a5a,
    textMuted: 0xfff3d6
  },
  levelMap: {
    badgeSize: 300,
    nodeScale: 1.215,
    levelGap: 442 * 1.215,
    focusBoost: 1.18,
    focusRatio: 0.56
  },
  designWidth: 1080,
  designHeight: 2344
};

export type ReadyUiThemeOverrides = {
  text?: Partial<ReadyUiTextTheme>;
  colors?: Partial<ReadyUiColors>;
  levelMap?: Partial<ReadyUiLevelMapTheme>;
  designWidth?: number;
  designHeight?: number;
};

/** Shallow-merges overrides over the default theme, one level deep per section. */
export function resolveTheme(overrides?: ReadyUiThemeOverrides): ReadyUiTheme {
  if (!overrides) return DEFAULT_READY_UI_THEME;
  const base = DEFAULT_READY_UI_THEME;
  return {
    text: { ...base.text, ...(overrides.text ?? {}) },
    colors: { ...base.colors, ...(overrides.colors ?? {}) },
    levelMap: { ...base.levelMap, ...(overrides.levelMap ?? {}) },
    designWidth: overrides.designWidth ?? base.designWidth,
    designHeight: overrides.designHeight ?? base.designHeight
  };
}
