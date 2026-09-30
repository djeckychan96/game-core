import type { Texture } from 'pixi.js';
import type { ReadyUiTextures } from './assets';
import type { NineSliceSpec } from './nineSlice';
import { READY_UI_STYLE_1, STYLE_1_INCLUDE_NAMES } from './skins/style1';

/**
 * Ready UI styles (UI Skin V1): a style is a typed DATA package — its assets by semantic role (file + 9-slice caps),
 * its text and dim look, and the layout of every window it covers. A game picks one in its Ready UI config
 * (`theme: { skin }` for the views, `loadReadyUiAssets({ skin })` for the files); the window code stays the same
 * for every style. A window the style does not cover keeps its donor look.
 */

/** The windows a style can cover (V1: the two Figma-exact windows). */
export type ReadyUiSkinWindow = 'confirm' | 'lives';

/** The roles each covered window draws with, in the view's order. A covering style must give every one an asset. */
export const READY_UI_SKIN_WINDOW_ROLES = {
  confirm: ['windowSurface', 'windowClose', 'heroGlow', 'lifeLostArt', 'buttonPrimary'],
  lives: ['windowSurface', 'windowClose', 'buttonPrimary', 'buttonRewarded', 'buttonHighlight', 'panelInset', 'lifeArt', 'priceIcon', 'rewardIcon', 'adIcon']
} as const satisfies Record<ReadyUiSkinWindow, readonly string[]>;

export type ReadyUiSkinRole = (typeof READY_UI_SKIN_WINDOW_ROLES)[ReadyUiSkinWindow][number];

/** The roles the views stretch as 9-slices: their asset must carry `nineSlice` caps. */
const NINE_SLICE_ROLES: readonly ReadyUiSkinRole[] = ['windowSurface', 'buttonPrimary', 'buttonRewarded', 'panelInset'];

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
 * Confirm (exit with a life lost). Boxes are WINDOW-LOCAL: x / y from the window box's top-left (the panel origin is
 * the window centre); `buttonLabel` is button-local. The art boxes are the render (export) boxes.
 */
export interface ReadyUiSkinConfirmLayout {
  readonly window: { readonly width: number; readonly height: number };
  readonly title: ReadyUiSkinTextBox;
  readonly close: ReadyUiSkinBox;
  /** `heroGlow` */
  readonly glow: ReadyUiSkinBox;
  /** `lifeLostArt` */
  readonly heart: ReadyUiSkinBox;
  readonly lifeDelta: ReadyUiSkinTextBox;
  readonly body: ReadyUiSkinTextBox;
  readonly button: ReadyUiSkinBox;
  readonly buttonLabel: ReadyUiSkinTextBox;
}

/**
 * Lives (refill hearts). Boxes are FRAME coordinates: x / y in the style's `frame` (the panel origin is the frame
 * centre). The Confirm / Lives conventions differ on purpose (each is its Figma read, unchanged).
 */
export interface ReadyUiSkinLivesLayout {
  readonly window: ReadyUiSkinBox;
  readonly title: ReadyUiSkinTextBox;
  readonly close: ReadyUiSkinBox;
  /** `panelInset` */
  readonly inset: ReadyUiSkinBox;
  /** `lifeArt` */
  readonly heart: ReadyUiSkinBox;
  /** The lives count, centred on this box. */
  readonly count: ReadyUiSkinTextBox;
  readonly nextLabel: ReadyUiSkinTextBox;
  readonly timer: ReadyUiSkinTextBox;
  /** `buttonPrimary` */
  readonly refill: ReadyUiSkinBox;
  readonly refillLabel: ReadyUiSkinTextBox;
  /** The price text, `gap`, then the `priceIcon` (`coin` box), as one row centred on the refill button. */
  readonly priceRow: { readonly y: number; readonly height: number; readonly gap: number; readonly fontSize: number };
  readonly coin: { readonly width: number; readonly height: number };
  /** `buttonRewarded` */
  readonly ad: ReadyUiSkinBox;
  /** `buttonHighlight` */
  readonly adHighlight: ReadyUiSkinBox;
  readonly adLabel: ReadyUiSkinTextBox;
  /** `adIcon` */
  readonly adIcon: ReadyUiSkinBox;
  /** `rewardIcon` */
  readonly rewardIcon: ReadyUiSkinBox;
  readonly rewardLabel: ReadyUiSkinTextBox;
}

export interface ReadyUiSkinLayouts {
  readonly confirm?: ReadyUiSkinConfirmLayout;
  readonly lives?: ReadyUiSkinLivesLayout;
}

export interface ReadyUiSkin {
  /** Stable id: the key of its textures (`textures.skins[id]`) and of its Pixi Assets cache entries. Never reused. */
  readonly id: string;
  /** The windows this style draws; every other window keeps its donor look. Each one listed needs its layout and assets. */
  readonly covers: readonly ReadyUiSkinWindow[];
  /** The design frame the layouts are measured in; a covered window keeps its share of it (contain-fit). */
  readonly frame: { readonly width: number; readonly height: number };
  /** Semantic role → asset. Only these files load for the style (`loadReadyUiAssets({ skin })`). */
  readonly assets: { readonly [R in ReadyUiSkinRole]?: ReadyUiSkinAsset };
  /** Runtime text: OUTSIDE stroke width and hard drop-shadow offset, in the stroke colour (font / fill / stroke colour = `theme.text`). */
  readonly text: { readonly strokeOutside: number; readonly shadowY: number };
  /** The dim layer behind a covered window. */
  readonly backdrop: { readonly color: number; readonly alpha: number };
  readonly windows: ReadyUiSkinLayouts;
}

/** A skin's role textures, as `loadReadyUiAssets({ skin })` puts them under `textures.skins[skin.id]`. */
export type ReadyUiSkinTextures = { [R in ReadyUiSkinRole]?: Texture };

/** The ready-made styles of this Core, by id (no runtime registration: a new style is a new package here). */
export const READY_UI_SKINS = {
  [READY_UI_STYLE_1.id]: READY_UI_STYLE_1
} as const satisfies Record<string, ReadyUiSkin>;

/** Checks a style package: every covered window has its layout and an asset (with caps where it stretches) per role. */
export function validateReadyUiSkin(skin: ReadyUiSkin): void {
  if (typeof skin?.id !== 'string' || !skin.id) throw new Error('ReadyUiSkin: a style needs a non-empty string id');
  for (const window of skin.covers) {
    const roles: readonly ReadyUiSkinRole[] | undefined = READY_UI_SKIN_WINDOW_ROLES[window];
    if (!roles) throw new Error(`ReadyUiSkin '${skin.id}' covers '${String(window)}', which no style can cover yet (${Object.keys(READY_UI_SKIN_WINDOW_ROLES).join(', ')})`);
    if (!skin.windows[window]) throw new Error(`ReadyUiSkin '${skin.id}' covers '${window}' but has no windows.${window} layout`);
    for (const role of roles) {
      const asset = skin.assets[role];
      if (!asset?.file) throw new Error(`ReadyUiSkin '${skin.id}' covers '${window}' but has no asset for role '${role}'`);
      if (NINE_SLICE_ROLES.includes(role) && !asset.nineSlice) throw new Error(`ReadyUiSkin '${skin.id}': role '${role}' is drawn as a 9-slice but has no nineSlice caps`);
    }
  }
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
  const pick = (source: (role: ReadyUiSkinRole) => Texture | undefined): { art: Record<string, Texture>; missing: ReadyUiSkinRole[] } => {
    const art: Record<string, Texture> = {};
    const missing: ReadyUiSkinRole[] = [];
    for (const role of roles) {
      const texture = source(role);
      if (texture) art[role] = texture;
      else missing.push(role);
    }
    return { art, missing };
  };
  const fileOf = (role: ReadyUiSkinRole): string => skin.assets[role]?.file ?? '?';
  const styleError = (missing: readonly ReadyUiSkinRole[]): Error =>
    new Error(`${view} style '${skin.id}': no ${missing.map((role) => `${role} (${fileOf(role)})`).join(', ')} in textures — load them with loadReadyUiAssets({ skin })`);

  // the pre-style path: Style 1's files loaded by `include` under their kit names
  const included = !loaded && skin === READY_UI_STYLE_1;
  const found = pick(included ? (role) => textures[STYLE_1_INCLUDE_NAMES[role]] : (role) => loaded?.[role]);
  if (found.missing.length && included && legacy.variant) {
    const list = found.missing.map((role) => `${STYLE_1_INCLUDE_NAMES[role]} (${fileOf(role)})`).join(', ');
    throw new Error(`${view} variant 'figma': no ${list} in textures — load them with loadReadyUiAssets({ include: ${legacy.include} })`);
  }
  if (found.missing.length) throw styleError(found.missing);
  return { skin, layout, art: found.art as WindowSkinLook<W>['art'] };
}

/** The caps of a 9-slice role (checked by validateReadyUiSkin). */
export function skinNineSlice(skin: ReadyUiSkin, role: ReadyUiSkinRole): NineSliceSpec {
  const spec = skin.assets[role]?.nineSlice;
  if (!spec) throw new Error(`ReadyUiSkin '${skin.id}': role '${role}' has no nineSlice caps`);
  return spec;
}

/** The Pixi Assets alias of a style asset: namespaced by the style id, so one role in two styles never collides. */
export function skinAssetAlias(skinId: string, role: ReadyUiSkinRole): string {
  return `game-core-ui:skin:${skinId}:${role}`;
}
