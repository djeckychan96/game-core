import { Assets, type Texture } from 'pixi.js';

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
  shopCoins6: 'shop/coins_6.webp'
} as const;

export type ReadyUiTextureName = keyof typeof READY_UI_ASSET_FILES;
export type ReadyUiTextures = Record<ReadyUiTextureName, Texture>;

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
  await Promise.all(loads);
  const textures = {} as ReadyUiTextures;
  for (const name of names) {
    textures[name] = prepareTexture(Assets.get<Texture>(ALIAS_PREFIX + name));
  }
  return textures;
}

/** Builds a texture record from a single texture — for tests and for hosts that stub art. */
export function createReadyUiTextures(fill: Texture): ReadyUiTextures {
  const textures = {} as ReadyUiTextures;
  for (const name of Object.keys(READY_UI_ASSET_FILES) as ReadyUiTextureName[]) {
    textures[name] = fill;
  }
  return textures;
}
