// Game Production Profile V1 — one game's production DECISIONS as one declarative object. Types and a
// validator only, in the style of validateGamePlatformConfig: no section has behaviour yet (SaveGate, the
// wallet, ads / purchase composition, Ready UI options and the bootstrap are the slices that read it).
import { validateAdsPolicy } from '../ads/policy';
import type { AdsPolicy } from '../ads/policy';
import { PLATFORM_PROVIDERS } from '../platform/config';
import type { PlatformProvider } from '../platform/config';
import type { GameplayLevelResult } from './contract';

export type ProductionOwner = 'core' | 'gameplay';

/** linear: a level opens once the previous one is won (SoliPix); open: every level is playable (Gorodki's figure picker). */
export type ProgressionMode = 'linear' | 'open';

export interface ProductionProgressionProfile {
  mode: ProgressionMode;
}

/** Ready UI decisions of the game; no view reads them yet (the Ready UI options slice will). */
export interface ProductionUiProfile {
  /** Who shows the level result: Core's result window or the gameplay's own screen (SoliPix victory screen). */
  result: ProductionOwner;
  /** The HUD lives counter (Trail Arrow's HUD has one; SoliPix hides the badge, Gorodki has no lives). */
  lives: boolean;
  /** The Settings MUSIC switch (SoliPix has music; Gorodki sound effects only). */
  music: boolean;
}

/** Coins for one level end, an integer ≥ 0. Gets the gameplay's levelEnd result as is; Core never inspects the function. */
export type LevelRewardPolicy = (result: GameplayLevelResult) => number;

/** Core keeps the balance (a new player starts at `startBalance`) and pays the level reward. */
export interface CoreSoftCurrencyProfile {
  id: string;
  owner: 'core';
  startBalance: number;
  /** Omitted = no level reward (the currency comes from packs only). */
  levelReward?: LevelRewardPolicy;
}

/** The gameplay keeps the balance and its own level reward (SoliPix: its save + computeVictoryCoins); Core only grants into it (packs). */
export interface GameplaySoftCurrencyProfile {
  id: string;
  owner: 'gameplay';
}

export type SoftCurrencyProfile = CoreSoftCurrencyProfile | GameplaySoftCurrencyProfile;

export interface ProductionEconomyProfile {
  /** false = the game has no soft currency. */
  softCurrency: false | SoftCurrencyProfile;
}

export interface ProductionAdsProfile {
  /** The existing AdsPolicy — the object AdsRuntime takes. */
  policy: AdsPolicy;
}

/**
 * `fallbackPrice` is the display price while the platform catalog has none (`PlatformCatalog.priceText`
 * is "" until a priced catalog arrives; the DEV platform needs a priceText per product).
 */
export interface ProductionNoAdsProduct {
  productId: string;
  fallbackPrice?: string;
}

/** A consumable that grants `amount` of the soft currency. */
export interface ProductionCoinPack {
  productId: string;
  amount: number;
  fallbackPrice?: string;
}

export interface ProductionMonetizationProfile {
  ads: false | ProductionAdsProfile;
  /** The permanent "no ads" right: a PurchaseRuntime 'entitlement' (never consumed). */
  noAds?: ProductionNoAdsProduct;
  coinPacks?: readonly ProductionCoinPack[];
}

/** The target INTENTION only: app / project ids live in GamePlatformConfig, tokens in the build env. */
export interface ProductionPlatformProfile {
  target: PlatformProvider;
}

/** The game's own keys in platform storage; their format stays the gameplay's. */
export interface ProductionSaveProfile {
  keys: readonly string[];
}

export interface GameProductionProfile {
  /** The game's name for namespacing (ads policy name, storage prefixes). */
  id: string;
  progression: ProductionProgressionProfile;
  ui: ProductionUiProfile;
  economy: ProductionEconomyProfile;
  monetization: ProductionMonetizationProfile;
  platform: ProductionPlatformProfile;
  save: ProductionSaveProfile;
}

export const PROGRESSION_MODES: readonly ProgressionMode[] = ['linear', 'open'];
export const PRODUCTION_OWNERS: readonly ProductionOwner[] = ['core', 'gameplay'];

// validateGamePlatformConfig's list, widened: a profile holds no JWT by any name (not even a jwtRef),
// no token and no platform project id — those belong to GamePlatformConfig and the build env
const FORBIDDEN_KEY = /secret|private[_-]?key|service[_-]?key|public[_-]?key|password|passwd|credential|signature|jwt|token|api[_-]?key|project[_-]?id/i;
const JWT_VALUE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const PRODUCT_ID = /^\S{1,128}$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function scanForSecrets(value: unknown, path: string, fail: (message: string) => never, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (JWT_VALUE.test(value)) fail(`${path} holds something that looks like a JWT — a profile never carries tokens`);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail(`${path}.${key} is a secret / credential / project id field — keep it out of the profile (GamePlatformConfig or the build env)`);
    scanForSecrets(child, `${path}.${key}`, fail, seen);
  }
}

/** Throws a RangeError naming the first problem. Does not call or inspect `levelReward`. */
export function validateGameProductionProfile(profile: GameProductionProfile): void {
  const fail = (message: string): never => {
    throw new RangeError(`validateGameProductionProfile: ${message}`);
  };
  const section = (path: string, value: unknown, allowed: readonly string[]): Record<string, unknown> => {
    if (!isObject(value)) fail(`${path} must be an object`);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${path}.${key} is not a profile field (allowed: ${allowed.join(', ')})`);
    return record;
  };
  const oneOf = <T extends string>(path: string, value: unknown, values: readonly T[]): void => {
    if (!values.includes(value as T)) fail(`${path} must be one of ${values.join(' / ')}`);
  };
  const name = (path: string, value: unknown): void => {
    if (typeof value !== 'string' || !NAME.test(value)) fail(`${path} must be a name (a letter, then letters / digits / _ . -, at most 64)`);
  };
  const price = (path: string, value: unknown): void => {
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) fail(`${path} must be a non-empty string when given`);
  };

  if (!isObject(profile)) fail('profile is required');
  scanForSecrets(profile, 'profile', fail, new WeakSet());
  const root = section('profile', profile, ['id', 'progression', 'ui', 'economy', 'monetization', 'platform', 'save']);
  name('id', root.id);

  oneOf('progression.mode', section('progression', root.progression, ['mode']).mode, PROGRESSION_MODES);

  const ui = section('ui', root.ui, ['result', 'lives', 'music']);
  oneOf('ui.result', ui.result, PRODUCTION_OWNERS);
  if (typeof ui.lives !== 'boolean') fail('ui.lives must be a boolean');
  if (typeof ui.music !== 'boolean') fail('ui.music must be a boolean');

  const currency = section('economy', root.economy, ['softCurrency']).softCurrency;
  if (currency !== false) {
    if (!isObject(currency)) fail('economy.softCurrency must be false or an object');
    const owner = (currency as Record<string, unknown>).owner;
    oneOf('economy.softCurrency.owner', owner, PRODUCTION_OWNERS);
    if (owner === 'gameplay') {
      const { startBalance, levelReward } = currency as Record<string, unknown>;
      if (startBalance !== undefined || levelReward !== undefined) {
        fail(`economy.softCurrency.${startBalance !== undefined ? 'startBalance' : 'levelReward'} is for a core-owned currency — a gameplay-owned one keeps its own balance and rewards`);
      }
    }
    const soft = section('economy.softCurrency', currency, owner === 'core' ? ['id', 'owner', 'startBalance', 'levelReward'] : ['id', 'owner']);
    name('economy.softCurrency.id', soft.id);
    if (owner === 'core') {
      if (!Number.isSafeInteger(soft.startBalance) || (soft.startBalance as number) < 0) fail('economy.softCurrency.startBalance must be an integer ≥ 0 for a core-owned currency');
      if (soft.levelReward !== undefined && typeof soft.levelReward !== 'function') fail('economy.softCurrency.levelReward must be a function (result) => integer ≥ 0');
    }
  }

  const monetization = section('monetization', root.monetization, ['ads', 'noAds', 'coinPacks']);
  if (monetization.ads !== false) {
    const ads = section('monetization.ads', monetization.ads, ['policy']);
    try {
      validateAdsPolicy(ads.policy as AdsPolicy);
    } catch (error) {
      fail(`monetization.ads.policy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const productIds = new Set<string>();
  const product = (path: string, id: unknown): void => {
    if (typeof id !== 'string' || !PRODUCT_ID.test(id)) fail(`${path} must be a non-empty product id without spaces`);
    if (productIds.has(id as string)) fail(`${path} "${id as string}" is used by another product`);
    productIds.add(id as string);
  };
  if (monetization.noAds !== undefined) {
    if (monetization.ads === false) fail('monetization.noAds needs monetization.ads — "no ads" in a game without ads sells nothing');
    const noAds = section('monetization.noAds', monetization.noAds, ['productId', 'fallbackPrice']);
    product('monetization.noAds.productId', noAds.productId);
    price('monetization.noAds.fallbackPrice', noAds.fallbackPrice);
  }
  if (monetization.coinPacks !== undefined) {
    if (!Array.isArray(monetization.coinPacks)) fail('monetization.coinPacks must be an array');
    const packs = monetization.coinPacks as unknown[];
    if (packs.length > 0 && currency === false) fail('monetization.coinPacks need economy.softCurrency — a pack grants the soft currency');
    packs.forEach((entry, i) => {
      const at = `monetization.coinPacks[${i}]`;
      const pack = section(at, entry, ['productId', 'amount', 'fallbackPrice']);
      product(`${at}.productId`, pack.productId);
      if (!Number.isSafeInteger(pack.amount) || (pack.amount as number) <= 0) fail(`${at}.amount must be an integer > 0`);
      price(`${at}.fallbackPrice`, pack.fallbackPrice);
    });
  }

  oneOf('platform.target', section('platform', root.platform, ['target']).target, PLATFORM_PROVIDERS);

  const keys = section('save', root.save, ['keys']).keys;
  if (!Array.isArray(keys) || keys.length === 0) fail('save.keys must be a non-empty array');
  (keys as unknown[]).forEach((key, i) => {
    if (typeof key !== 'string' || key.trim() === '') fail(`save.keys[${i}] must be a non-empty string`);
    if ((keys as unknown[]).indexOf(key) !== i) fail(`save.keys[${i}] "${key as string}" is listed twice`);
  });
}
