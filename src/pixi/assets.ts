import { Assets, type Texture } from 'pixi.js';
import type { NineSliceSpec } from './nineSlice';
import { skinAssetAlias, skinFontAlias, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from './skin';
import { READY_UI_STYLE_1 } from './skins/style1';

const STYLE_1 = READY_UI_STYLE_1.assets;

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
 * Figma confirm-exit window, LIVES_FIGMA_TEXTURES for the Figma Lives window, WIN_CONFETTI_TEXTURES for the Result WIN confetti). Core's own pack ships them.
 * The Figma window art is Style 1's (READY_UI_STYLE_1 owns its files and caps; these are its pre-style kit names):
 * no text inside any of them.
 */
export const READY_UI_OPTIONAL_ASSET_FILES = {
  /** Style 1 `windowSurface` (Figma `ui/window/base`): the 9-slice window shell; caps in READY_UI_NINE_SLICES. */
  windowBase: STYLE_1.windowSurface.file,
  /** Style 1 `windowClose`: the window's `action/close` glyph (its 51 × 51 SVG box). */
  windowClose: STYLE_1.windowClose.file,
  /** Style 1 `heroGlow` (`surface/message-card`): the blurred glow behind a window's hero art. */
  messageGlow: STYLE_1.heroGlow.file,
  /** Style 1 `lifeLostArt` (`art/broken-heart`, crack included, no "-1": the life delta is runtime text). */
  brokenHeart: STYLE_1.lifeLostArt.file,
  /** Style 1 `buttonPrimary` (Figma `ui/button/surface` style=green): 9-slice; caps in READY_UI_NINE_SLICES. */
  buttonGreen: STYLE_1.buttonPrimary.file,
  /** Trail Arrow's LevelComplete firework spark (128², additive): the Result WIN confetti. */
  fxSparkStar: 'fx/spark_star.webp',
  /** Trail Arrow's soft core glow (128², additive): the flash at the centre of each confetti burst. */
  fxGlowSoft: 'fx/glow_soft.webp',
  // Figma Lives (docs/figma/lives, `node scripts/figma-assets.mjs docs/figma/lives`): no text inside
  /** Style 1 `buttonRewarded` (Figma `ui/button/surface` style=orange): 9-slice; caps in READY_UI_NINE_SLICES. */
  buttonOrange: STYLE_1.buttonRewarded.file,
  /** Style 1 `buttonHighlight`: the button's gold `surface/highlight` gradient (307 × 172), drawn over a surface's face. */
  buttonHighlight: STYLE_1.buttonHighlight.file,
  /** Style 1 `panelInset`: a window's flat inner panel (Lives `section/next-life`): 9-slice; caps in READY_UI_NINE_SLICES. */
  panelInset: STYLE_1.panelInset.file,
  /** Style 1 `lifeArt`: the Lives heart, the broken heart's art without the crack (the count is runtime text). */
  livesHeart: STYLE_1.lifeArt.file,
  /** Style 1 `priceIcon`: coin icon of a price (100 × 100). */
  iconCoin: STYLE_1.priceIcon.file,
  /** Style 1 `rewardIcon`: heart icon of a reward (154 × 154; its "+1" is runtime text). */
  iconHeart: STYLE_1.rewardIcon.file,
  /** Style 1 `adIcon`: rewarded-ad clapper icon (128 × 134, the flattened `icon/reward` of the Lives screen). */
  iconAd: STYLE_1.adIcon.file
} as const;

export type ReadyUiTextureName = keyof typeof READY_UI_ASSET_FILES;
export type ReadyUiOptionalTextureName = keyof typeof READY_UI_OPTIONAL_ASSET_FILES;
export type ReadyUiTextures = Record<ReadyUiTextureName, Texture> & Partial<Record<ReadyUiOptionalTextureName, Texture>> & {
  /** Only after `loadReadyUiAssets({ skin })`: that style's role textures under its id (absent otherwise). */
  skins?: Readonly<Record<string, ReadyUiSkinTextures>>;
};

/**
 * 9-slice caps of the stretchable kit textures under their pre-style kit names: Style 1's caps (READY_UI_STYLE_1
 * owns them — measured by `scripts/figma-assets.mjs` on the Figma raster, docs/figma/confirm-exit/README.md).
 */
export const READY_UI_NINE_SLICES = {
  windowBase: STYLE_1.windowSurface.nineSlice,
  buttonGreen: STYLE_1.buttonPrimary.nineSlice,
  buttonOrange: STYLE_1.buttonRewarded.nineSlice,
  panelInset: STYLE_1.panelInset.nineSlice
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
  /**
   * The game's Ready UI style (e.g. READY_UI_STYLE_1): its assets load too — only this style's, each strictly — and
   * land under `textures.skins[skin.id]` by role; a style with its own font (`skin.font`) registers it as well (strictly,
   * even with `skipFont`, which only skips the kit font). Pass the same style as `theme: { skin }` to the views. Default: none.
   */
  skin?: ReadyUiSkin;
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
 * Only the required pack is requested by default; optional textures only when `include` lists them, a style's
 * assets only when `skin` names it (cached under that style's id). Any requested texture that fails rejects the load.
 */
export async function loadReadyUiAssets(options: LoadReadyUiAssetsOptions = {}): Promise<ReadyUiTextures> {
  const skin = options.skin;
  if (skin) validateReadyUiSkin(skin); // a broken style package fails before anything is requested
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
  // the chosen style's assets, under its own alias namespace (a role of another style never answers from the cache)
  const skinRoles: ReadyUiSkinAssetKey[] = [];
  const styled: Promise<Texture>[] = [];
  if (skin) {
    for (const role of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) {
      const file = skin.assets[role]?.file;
      if (!file) continue;
      skinRoles.push(role);
      styled.push(Assets.load<Texture>({ alias: skinAssetAlias(skin.id, role), src: joinUrl(baseUrl, file) }).catch((error: unknown) => {
        throw new Error(`loadReadyUiAssets: style '${skin.id}' "${role}" (${file}) was requested but did not load from ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }));
    }
  }
  if (skin?.font) {
    const font = skin.font;
    loads.push(Assets.load({ alias: skinFontAlias(skin.id), src: joinUrl(baseUrl, font.file), data: { family: font.family } }).catch((error: unknown) => {
      throw new Error(`loadReadyUiAssets: style '${skin.id}' font "${font.family}" (${font.file}) was requested but did not load from ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }));
  }
  await Promise.all([...loads, ...optional, ...styled]);
  const textures = {} as ReadyUiTextures;
  for (const name of names) {
    textures[name] = prepareTexture(Assets.get<Texture>(ALIAS_PREFIX + name));
  }
  const loaded = await Promise.all(optional);
  include.forEach((name, i) => {
    const texture = loaded[i];
    if (texture) textures[name] = prepareTexture(texture);
  });
  if (skin) {
    const roleTextures: ReadyUiSkinTextures = {};
    const styledLoaded = await Promise.all(styled);
    skinRoles.forEach((role, i) => {
      const texture = styledLoaded[i];
      if (texture) roleTextures[role] = prepareTexture(texture);
    });
    textures.skins = { [skin.id]: roleTextures };
  }
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
