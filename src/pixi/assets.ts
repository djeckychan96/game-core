import { Assets, type Texture } from 'pixi.js';
import type { NineSliceSpec } from './nineSlice';

/**
 * Every texture the Ready UI kit draws with, keyed by a stable name. The files ship with the
 * package under `assets/pixi-ui/` (Trail Arrow art extracted into game-core); a host serves that
 * folder from any URL and passes it as `baseUrl`.
 */
export const READY_UI_ASSET_FILES = {
  // level map
  badgeBase: 'level/badge_base.webp',
  badgeCurrent: 'level/badge_current.webp',
  badgeLocked: 'level/badge_locked.webp',
  starGold: 'level/star_gold.webp',
  starGoldL: 'level/star_gold_l.webp',
  starGoldR: 'level/star_gold_r.webp',
  starEmpty: 'level/star_empty.webp',
  starEmptyL: 'level/star_empty_l.webp',
  starEmptyR: 'level/star_empty_r.webp',
  lock: 'level/lock.webp',
  pillHard: 'level/pill_hard_bg.webp',
  rail: 'level/rail.webp',
  shine: 'level/shine.webp',
  // backgrounds
  mapBackground: 'bg/level_select_bg.webp',
  topShadow: 'bg/top_shadow.webp',
  // hud
  hudCapsule: 'hud/capsule.webp',
  hudCoin: 'hud/coin.webp',
  hudHeart: 'hud/heart.webp',
  hudPlus: 'hud/plus.webp',
  hudGear: 'hud/gear.webp',
  hudGearBack: 'hud/gear_back.webp',
  // buttons
  btnPlay: 'button/btn_play.webp',
  btnGreen: 'button/btn_green.webp',
  btnGreenShort: 'button/btn_green_short.webp',
  btnYellow: 'button/btn_yellow.webp',
  btnYellowWide: 'button/btn_yellow_wide.webp',
  btnClose: 'button/btn_close.webp',
  confirmButton: 'button/btn_confirm.webp',
  // icons
  coinBig: 'icons/coin_big.webp',
  coinSmall: 'icons/coin_small.webp',
  ads: 'icons/ads.webp',
  heartBig: 'icons/heart_big.webp',
  heartPlus1: 'icons/heart_plus1.webp',
  // windows
  victoryRibbon: 'window/victory_ribbon.webp',
  panelPurple: 'window/panel_purple.webp',
  panelInner: 'window/panel_inner.webp',
  /** Donor ConfirmWindow panel: the broken heart and its "-1" are part of the art. No Core view draws it since the Figma confirm-exit. */
  confirmPanel: 'window/confirm_panel.webp',
  // shop
  shopHeader: 'shop/header_bg.webp',
  shopCard: 'shop/card.webp',
  shopBuy: 'shop/btn_buy.webp',
  shopRibbon: 'shop/ribbon_blue.webp',
  shopCoins1: 'shop/coins_1.webp',
  shopCoins2: 'shop/coins_2.webp',
  shopCoins3: 'shop/coins_3.webp',
  shopCoins4: 'shop/coins_4.webp',
  shopCoins5: 'shop/coins_5.webp',
  shopCoins6: 'shop/coins_6.webp',
  // settings
  settingsPanel: 'settings/panel.webp',
  settingsSound: 'settings/btn_sound.webp',
  settingsMusic: 'settings/btn_music.webp',
  settingsHaptic: 'settings/btn_haptic.webp',
  settingsOff: 'settings/deactivated.webp',
  settingsBtnHome: 'settings/btn_home.webp',
  settingsBtnRestart: 'settings/btn_restart.webp',
  settingsIconHome: 'settings/icon_home.webp',
  settingsIconRestart: 'settings/icon_restart.webp',
  // offers
  noAdsPanel: 'offer/noads_panel.webp',
  noAdsBuy: 'offer/noads_btn_buy.webp',
  noAdsIcon: 'offer/noads_icon.webp',
  starterPanel: 'offer/starter_panel.webp',
  starterImage: 'offer/starter_image.webp',
  starterIcon: 'offer/starter_icon.webp',
  starterBuy: 'offer/starter_btn_buy.webp',
  starterGold: 'offer/icon_gold.webp',
  starterHearts: 'offer/icon_hearts.webp',
  starterNoAds: 'offer/icon_noads_small.webp',
  starterBorder: 'offer/border.webp',
  starterBooster1: 'offer/icon_booster_1.webp',
  starterBooster2: 'offer/icon_booster_2.webp',
  starterBooster3: 'offer/icon_booster_3.webp',
  bulb: 'offer/bulb.webp'
} as const;

/**
 * Kit textures outside the required pack: nothing requests them unless a host lists them in
 * `loadReadyUiAssets({ include })` for the feature that draws them (e.g. CONFIRM_EXIT_FIGMA_TEXTURES for the
 * Figma confirm-exit window). Core's own pack ships them. The Figma confirm-exit art (docs/figma/confirm-exit,
 * rendered by `node scripts/figma-assets.mjs`): no text inside any of them.
 */
export const READY_UI_OPTIONAL_ASSET_FILES = {
  /** Figma `ui/window/base`: the 9-slice window shell (surface/body + surface/header); caps in READY_UI_NINE_SLICES. */
  windowBase: 'window/window_base@2x.webp',
  /** The window's `action/close` glyph (its 51 × 51 SVG box). */
  windowClose: 'window/window_close@2x.webp',
  /** `surface/message-card`: the blurred glow behind a window's hero art. */
  messageGlow: 'window/message_glow@0.5x.webp',
  /** `art/broken-heart` (crack included, no "-1": the life delta is runtime text). */
  brokenHeart: 'icons/broken_heart@2x.webp',
  /** Figma `ui/button/surface` style=green: 9-slice; caps in READY_UI_NINE_SLICES. */
  buttonGreen: 'button/button_green@2x.webp'
} as const;

export type ReadyUiTextureName = keyof typeof READY_UI_ASSET_FILES;
export type ReadyUiOptionalTextureName = keyof typeof READY_UI_OPTIONAL_ASSET_FILES;
export type ReadyUiTextures = Record<ReadyUiTextureName, Texture> & Partial<Record<ReadyUiOptionalTextureName, Texture>>;

/**
 * 9-slice caps of the stretchable kit textures, in texture (design) units, measured by `scripts/figma-assets.mjs`
 * on the Figma raster: the Figma @stretch insets plus the art's bleed, grown where an effect or a corner reaches
 * into the stretch area, plus an 8-unit uniform gutter at every seam so texture filtering never blends art into
 * the stretched centre (docs/figma/confirm-exit/README.md lists the numbers).
 */
export const READY_UI_NINE_SLICES = {
  /** Figma @stretch 80 / 175 / 80 / 80 + bleed 4 / 4 / 4 / 8 (bottom: the −23 inner shadow reaches 14 more) + gutter 8. */
  windowBase: { left: 92, top: 187, right: 92, bottom: 110, pad: { left: 4, top: 4, right: 4, bottom: 8 } },
  /** Figma @stretch 51 is short of the rounded corners and the shadow (they end at 59 / 61 / 59 / 81) + gutter 8. */
  buttonGreen: { left: 67, top: 69, right: 67, bottom: 89 }
} as const satisfies Partial<Record<ReadyUiOptionalTextureName, NineSliceSpec>>;

/** The kit's font file, also under `assets/pixi-ui/`. Registered as the theme's font family. */
export const READY_UI_FONT_FILE = 'fonts/FiraSans-Black.woff2';
export const READY_UI_FONT_FAMILY = 'Firasans Black';

export interface LoadReadyUiAssetsOptions {
  /** URL prefix where `assets/pixi-ui/` is served from. Default `./pixi-ui/`. */
  baseUrl?: string;
  /** Skip the font (host already registered `Firasans Black`, or uses its own family). */
  skipFont?: boolean;
  /** Font family name to register the woff2 under. Default READY_UI_FONT_FAMILY. */
  fontFamily?: string;
  /**
   * Optional textures (READY_UI_OPTIONAL_ASSET_FILES) the host's features need, e.g. CONFIRM_EXIT_FIGMA_TEXTURES.
   * Only these are requested, and each one must load: a missing file rejects, naming it. Default: none.
   */
  include?: readonly ReadyUiOptionalTextureName[];
}

const ALIAS_PREFIX = 'game-core-ui:';

function joinUrl(base: string, file: string): string {
  return base.endsWith('/') ? base + file : `${base}/${file}`;
}

/** Linear filtering + mipmaps: the kit renders every sprite minified under a contain-fit scale. */
function prepareTexture(texture: Texture): Texture {
  const source = texture.source;
  source.scaleMode = 'linear';
  source.autoGenerateMipmaps = true;
  source.updateMipmaps?.();
  return texture;
}

/**
 * Loads every kit texture (and the font) through Pixi Assets and returns them keyed by name.
 * Idempotent: repeated calls resolve from the Assets cache. The host owns the Pixi Application;
 * this only needs Assets, which works before or after `Application.init()`.
 * Only the required pack is requested by default; optional textures only when `include` lists them.
 * Any requested texture that fails rejects the load.
 */
export async function loadReadyUiAssets(options: LoadReadyUiAssetsOptions = {}): Promise<ReadyUiTextures> {
  const baseUrl = options.baseUrl ?? './pixi-ui/';
  const names = Object.keys(READY_UI_ASSET_FILES) as ReadyUiTextureName[];
  const bundle = names.map((name) => ({
    alias: ALIAS_PREFIX + name,
    src: joinUrl(baseUrl, READY_UI_ASSET_FILES[name])
  }));
  const loads: Promise<unknown>[] = [Assets.load(bundle)];
  if (!options.skipFont) {
    loads.push(
      Assets.load({
        alias: ALIAS_PREFIX + 'font',
        src: joinUrl(baseUrl, READY_UI_FONT_FILE),
        data: { family: options.fontFamily ?? READY_UI_FONT_FAMILY }
      })
    );
  }
  // optional textures only on request, after the required ones (the first load initialises Assets)
  const include = [...new Set(options.include ?? [])];
  const optional = include.map((name) => {
    const file = READY_UI_OPTIONAL_ASSET_FILES[name];
    return Assets.load<Texture>({ alias: ALIAS_PREFIX + name, src: joinUrl(baseUrl, file) }).catch((error: unknown) => {
      throw new Error(`loadReadyUiAssets: "${name}" (${file}) was requested but did not load from ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  await Promise.all([...loads, ...optional]);
  const textures = {} as ReadyUiTextures;
  for (const name of names) {
    textures[name] = prepareTexture(Assets.get<Texture>(ALIAS_PREFIX + name));
  }
  const loaded = await Promise.all(optional);
  include.forEach((name, i) => {
    const texture = loaded[i];
    if (texture) textures[name] = prepareTexture(texture);
  });
  return textures;
}

/** Builds a texture record from a single texture (optional ones included) — for tests and for hosts that stub art. */
export function createReadyUiTextures(fill: Texture): ReadyUiTextures {
  const textures = {} as ReadyUiTextures;
  for (const name of Object.keys(READY_UI_ASSET_FILES) as ReadyUiTextureName[]) {
    textures[name] = fill;
  }
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) {
    textures[name] = fill;
  }
  return textures;
}
