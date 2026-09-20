// Ads Policy Config V1 — the per-game policy over AdsRuntime. Gameplay reports a placement
// (`ads.requestInterstitial('level_complete')`); the policy says whether that kind of ad is on, which
// placements exist, the cadence, the session guards, the cooldown floors and what NO_ADS blocks; the
// optional segmentation tables (Trail Arrow's `AdsConfig`) refine it per player segment. Showing the
// ad stays the platform's job. Presets are frozen; `resolveAdsPolicy` builds a fresh policy from a
// preset and nested overrides without touching either.
import { validateAdsConfig } from './config';
import type { AdPlacementType, AdsConfig } from './types';

/** A placement id is the game's own string (`level_complete`, `hint_rewarded`, …); a game may narrow it to a union. */
export type AdsPlacementId = string;

/**
 * Every N-th request of an interstitial placement passes. Requests are counted per placement,
 * in the session, only when the request got as far as the cadence check (earlier gates — the
 * kind switched off, NO_ADS, a disabled placement, the first-show delay … — do not count), and the
 * count restarts at 0 after a CONFIRMED show of that placement (`registerShown`). A request that
 * passed the cadence but was refused later (cooldown, limit, the platform had no fill) keeps the
 * count, so the NEXT request passes again — "an ad that could not show is due at the next moment".
 */
export interface AdsCadence {
  /** 1 = every request, 3 = the 3rd, 6th, 9th … request since the last show. Integer ≥ 1. */
  every: number;
  /** The request that passes BEFORE the first show of the placement in this session (integer ≥ 1); defaults to `every`. */
  first?: number | null;
}

export interface AdsInterstitialPlacementPolicy {
  enabled: boolean;
  cadence?: AdsCadence | null;
  /** Not below this level; on top of `interstitial.minLevel` and the segmentation's start level. */
  minLevel?: number | null;
  /** Calendar day / hour caps of this placement (the counters `registerShown` keeps); on top of the segmentation's limits. */
  dayLimit?: number | null;
  hourLimit?: number | null;
}

export interface AdsRewardedPlacementPolicy {
  enabled: boolean;
  minLevel?: number | null;
  dayLimit?: number | null;
  hourLimit?: number | null;
  /** V1.1: this placement's answer watchdog, ms, instead of `timeouts.rewardedAnswerMs` (see `AdsRequestTimeouts`). */
  answerTimeoutMs?: number | null;
}

export interface AdsBannerPlacementPolicy {
  enabled: boolean;
  minLevel?: number | null;
}

export interface AdsInterstitialPolicy {
  enabled: boolean;
  /**
   * Minimum interval between two interstitials, ms, across every placement. A FLOOR: with
   * segmentation tables the effective interval is `max(cooldownMs, segment.delayBetweenInters · 1000)`.
   */
  cooldownMs: number;
  /** An interstitial stays away this long after ANY rewarded, ms. A floor over `segment.delayAfterReward`. */
  afterRewardedCooldownMs: number;
  /** No interstitial before the session is this old, ms (the session starts with the runtime or at `startSession()`). 0 = none. */
  firstShowDelayMs: number;
  /** No interstitial below this level, whatever the placement says. */
  minLevel: number;
  /** The allow-list: a placement that is not here, or is here with `enabled: false`, answers `placement_disabled`. */
  placements: Record<AdsPlacementId, AdsInterstitialPlacementPolicy>;
}

export interface AdsRewardedPolicy {
  enabled: boolean;
  minLevel: number;
  placements: Record<AdsPlacementId, AdsRewardedPlacementPolicy>;
}

export interface AdsBannerPolicy {
  enabled: boolean;
  minLevel: number;
  /** Usually one entry, `banner` (`ADS_BANNER_PLACEMENT`, what `canShowBanner()` asks for). */
  placements: Record<AdsPlacementId, AdsBannerPlacementPolicy>;
}

/**
 * V1.1 — the NO_ADS offer cadence (donor `InterstitialAdsSystem`): every N-th CONFIRMED interstitial
 * (`registerShown` of an interstitial placement — never a rewarded, never a failed / cancelled ad)
 * raises the "offer NO_ADS now" trigger. The runtime only raises it: the host takes it with
 * `consumeNoAdsOffer()` at a moment of its choice (the donor: the map is up, no window open) and
 * shows whatever window it has. Confirmed interstitials are not counted while the player owns
 * NO_ADS or is below `minLevel` (the donor: L17, "the counter is not accumulated before it"), the
 * counter is session-local (in memory; `startSession()` restarts it) and restarts at 0 on a trigger.
 */
export interface AdsNoAdsOfferPolicy {
  enabled: boolean;
  /** 3 = the 3rd, 6th, 9th … confirmed interstitial since the last trigger. Integer ≥ 1. */
  every: number;
  /** The confirmed interstitial that raises the FIRST trigger of the session (integer ≥ 1); defaults to `every`. The donor starts at 1. */
  first?: number | null;
  /** Below this level a confirmed interstitial is not counted. */
  minLevel: number;
}

/** What the NO_ADS entitlement (`input.hasNoAds()`) switches off. Rewarded stays on by default: it is opt-in value. */
export interface AdsNoAdsPolicy {
  blocksInterstitial: boolean;
  blocksBanner: boolean;
  blocksRewarded: boolean;
  /** V1.1: the offer cadence; null / omitted = no trigger. */
  offerAfterInterstitials?: AdsNoAdsOfferPolicy | null;
}

/**
 * V1.1 — the platform-answer watchdogs, per game (donor `AdsTimeouts.ts`): how long the game waits
 * for the platform's answer to an ad request before it treats the silence as an error and unlocks
 * its window. Data only: the runtime never runs a timer (it has no clock of its own) — the host
 * reads the numbers through `getRequestTimeouts(placement)` and arms its own watchdog. The donor:
 * a rewarded belt of 130 s (REVIEW 15.09 №14: longer than the platform's own 90 / 120 s show
 * timeouts, so a late ok after the unlock cannot lose the reward); an interstitial start timeout of
 * 12 s (REVIEW 15.09 №5: only while the show has NOT begun), a 150 s hard cap while a show is in
 * progress, re-checked every 5 s.
 */
export interface AdsRequestTimeouts {
  /** The host waits this long for the platform's rewarded answer; a rewarded placement may override it (`answerTimeoutMs`). */
  rewardedAnswerMs: number;
  /** The interstitial transition goes on by itself after this long if the show never began. */
  interstitialStartMs: number;
  /** … but a show that is in progress is waited for, up to this long. */
  interstitialShowHardCapMs: number;
  /** How often the "still showing?" question is asked while waiting. */
  interstitialRecheckMs: number;
}

export interface AdsSessionPolicy {
  /** Confirmed interstitials per session; null = unlimited. */
  maxInterstitials: number | null;
  /** While the host reports an ad in flight (`input.isAdInFlight()`), no new interstitial or rewarded — the donor's "x2 in flight → Continue waits". */
  blockWhileAdInFlight: boolean;
}

export interface AdsPolicy {
  /** Who this policy is (`trail_arrow`, `solipix`, `legacy-config`), for analytics and for telling presets apart. */
  name: string;
  /** Preset version; bump it when the numbers change, so analytics can split the cohorts. Integer ≥ 0. */
  version: number;
  interstitial: AdsInterstitialPolicy;
  rewarded: AdsRewardedPolicy;
  banner: AdsBannerPolicy;
  noAds: AdsNoAdsPolicy;
  session: AdsSessionPolicy;
  /** V1.1: the platform-answer watchdogs; omitted = `ADS_POLICY_NEUTRAL.timeouts` (the donor's numbers). */
  timeouts?: AdsRequestTimeouts;
  /**
   * The segment tables (`parseAdsTsv` / the donor's `AdsConfig`) — WHO sees an ad by level and
   * payments, per-segment start levels, day / hour limits and cooldowns. null = no segmentation:
   * the policy gates above are the whole decision. Replaced as a whole by an override, never merged.
   */
  segmentation: AdsConfig | null;
}

type DeepPartial<T> = { [K in keyof T]?: PartialValue<T[K]> | undefined };
/** Distributes over a union, so `AdsCadence | null` becomes `DeepPartial<AdsCadence> | null`. */
type PartialValue<V> = V extends object ? DeepPartial<V> : V;

/** Nested overrides for `resolveAdsPolicy`: any subset of the policy; `null` clears an optional knob; `segmentation` is replaced whole. */
export type AdsPolicyOverrides = DeepPartial<Omit<AdsPolicy, 'segmentation'>> & { segmentation?: AdsConfig | null | undefined };

/** The knobs a policy built from a bare `AdsConfig` gets: everything neutral — the tables decide, like AdsRuntime v0.7. */
export const ADS_POLICY_NEUTRAL = Object.freeze({
  interstitial: Object.freeze({ cooldownMs: 0, afterRewardedCooldownMs: 0, firstShowDelayMs: 0, minLevel: 0 }),
  noAds: Object.freeze({ blocksInterstitial: true, blocksBanner: true, blocksRewarded: false, offerAfterInterstitials: null }),
  session: Object.freeze({ maxInterstitials: null, blockWhileAdInFlight: false }),
  /** The donor's platform-answer watchdogs (`AdsTimeouts.ts`): what a policy without `timeouts` gets. */
  timeouts: Object.freeze({ rewardedAnswerMs: 130_000, interstitialStartMs: 12_000, interstitialShowHardCapMs: 150_000, interstitialRecheckMs: 5_000 })
});

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = deepClone(item);
    return out as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    Object.freeze(value);
  } else if (isPlainObject(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/** Freezes a policy in depth (presets are shipped this way). Returns the same object. */
export function freezeAdsPolicy(policy: AdsPolicy): Readonly<AdsPolicy> {
  return deepFreeze(policy);
}

/**
 * AdsRuntime v0.7 semantics as a policy: the placements of `config` are all enabled, no cadence, no
 * cooldown floors, no first-show delay, no session cap, NO_ADS blocks interstitials and the banner
 * (not rewarded), and `config` itself is the segmentation — by REFERENCE, not a copy, and not
 * frozen (the runtime built from `{ config }` reads the caller's tables as they are).
 */
export function adsPolicyFromConfig(config: AdsConfig, meta: { name?: string; version?: number } = {}): AdsPolicy {
  const interstitial: Record<string, AdsInterstitialPlacementPolicy> = {};
  const rewarded: Record<string, AdsRewardedPlacementPolicy> = {};
  const banner: Record<string, AdsBannerPlacementPolicy> = {};
  for (const [id, placement] of Object.entries(config.placements)) {
    if (placement.type === 'inter') interstitial[id] = { enabled: true };
    else if (placement.type === 'rewarded') rewarded[id] = { enabled: true };
    else banner[id] = { enabled: true };
  }
  return {
    name: meta.name ?? 'legacy-config',
    version: meta.version ?? 0,
    interstitial: { ...ADS_POLICY_NEUTRAL.interstitial, enabled: true, placements: interstitial },
    rewarded: { enabled: true, minLevel: 0, placements: rewarded },
    banner: { enabled: true, minLevel: 0, placements: banner },
    noAds: { ...ADS_POLICY_NEUTRAL.noAds },
    session: { ...ADS_POLICY_NEUTRAL.session },
    timeouts: { ...ADS_POLICY_NEUTRAL.timeouts },
    segmentation: config
  };
}

/**
 * A new policy = `base` with `overrides` merged in, key by key and in depth: an object patches an
 * object (a placement record keeps the placements the override does not name; a cadence keeps the
 * field the override does not name), any other value replaces (`null` included — it clears an
 * optional knob), `undefined` means "no override". `segmentation` is the one atomic key: given, it
 * replaces the tables whole (merging two TSV tables row by row is never what a game means).
 * Several overrides apply left to right. Neither `base` nor any override is touched: the result is
 * a deep copy, validated (`RangeError` on a bad value) and frozen.
 */
export function resolveAdsPolicy(base: AdsPolicy, ...overrides: Array<AdsPolicyOverrides | undefined>): Readonly<AdsPolicy> {
  let result = deepClone(base) as unknown as Record<string, unknown>;
  for (const patch of overrides) {
    if (patch === undefined) continue;
    if (!isPlainObject(patch)) throw new RangeError('resolveAdsPolicy: an override must be a plain object');
    result = mergeInto(result, patch, '');
  }
  const policy = result as unknown as AdsPolicy;
  validateAdsPolicy(policy);
  return deepFreeze(policy);
}

const ATOMIC_KEYS: ReadonlySet<string> = new Set(['segmentation']);

function mergeInto(target: Record<string, unknown>, patch: Record<string, unknown>, path: string): Record<string, unknown> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const fullPath = path ? `${path}.${key}` : key;
    const current = target[key];
    if (isPlainObject(value) && isPlainObject(current) && !ATOMIC_KEYS.has(fullPath)) {
      target[key] = mergeInto(current, value, fullPath);
    } else {
      target[key] = deepClone(value);
    }
  }
  return target;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/**
 * Throws a RangeError on a policy the runtime cannot decide with: a non-boolean switch, a negative
 * or NaN duration / level / limit, a cadence below 1, a placement id listed under two kinds, a
 * placement whose kind in the policy contradicts its type in the segmentation, or segmentation
 * tables `validateAdsConfig` rejects. An empty placement record is valid (the kind is on but no
 * placement asks for it); so is `segmentation: null`.
 */
export function validateAdsPolicy(policy: AdsPolicy): void {
  const fail = (message: string): never => {
    throw new RangeError(`validateAdsPolicy: ${message}`);
  };
  if (!isPlainObject(policy)) fail('policy must be a plain object');
  if (typeof policy.name !== 'string' || policy.name.length === 0) fail('name must be a non-empty string');
  if (!(isInteger(policy.version) && policy.version >= 0)) fail('version must be an integer ≥ 0');

  const section = (name: string, value: unknown): Record<string, unknown> => {
    if (!isPlainObject(value)) fail(`${name} must be an object`);
    return value as Record<string, unknown>;
  };
  const bool = (name: string, value: unknown): void => {
    if (typeof value !== 'boolean') fail(`${name} must be a boolean`);
  };
  const nonNegative = (name: string, value: unknown): void => {
    if (!(isNumber(value) && value >= 0)) fail(`${name} must be a number ≥ 0`);
  };
  const optionalNonNegative = (name: string, value: unknown): void => {
    if (value !== undefined && value !== null) nonNegative(name, value);
  };
  const level = (name: string, value: unknown): void => {
    if (!isNumber(value)) fail(`${name} must be a number`);
  };
  const optionalLevel = (name: string, value: unknown): void => {
    if (value !== undefined && value !== null) level(name, value);
  };

  const inter = section('interstitial', policy.interstitial);
  bool('interstitial.enabled', inter['enabled']);
  for (const key of ['cooldownMs', 'afterRewardedCooldownMs', 'firstShowDelayMs'] as const) {
    const value = inter[key];
    if (!(isNumber(value) && Number.isFinite(value) && value >= 0)) fail(`interstitial.${key} must be a finite number ≥ 0`);
  }
  level('interstitial.minLevel', inter['minLevel']);
  const interPlacements = section('interstitial.placements', inter['placements']);
  for (const [id, entry] of Object.entries(interPlacements)) {
    const p = section(`interstitial.placements.${id}`, entry);
    bool(`interstitial.placements.${id}.enabled`, p['enabled']);
    optionalLevel(`interstitial.placements.${id}.minLevel`, p['minLevel']);
    optionalNonNegative(`interstitial.placements.${id}.dayLimit`, p['dayLimit']);
    optionalNonNegative(`interstitial.placements.${id}.hourLimit`, p['hourLimit']);
    const cadence = p['cadence'];
    if (cadence !== undefined && cadence !== null) {
      const c = section(`interstitial.placements.${id}.cadence`, cadence);
      const every = c['every'];
      if (!(isInteger(every) && every >= 1)) fail(`interstitial.placements.${id}.cadence.every must be an integer ≥ 1`);
      const first = c['first'];
      if (first !== undefined && first !== null && !(isInteger(first) && first >= 1)) fail(`interstitial.placements.${id}.cadence.first must be an integer ≥ 1`);
    }
  }

  const rewarded = section('rewarded', policy.rewarded);
  bool('rewarded.enabled', rewarded['enabled']);
  level('rewarded.minLevel', rewarded['minLevel']);
  const rewardedPlacements = section('rewarded.placements', rewarded['placements']);
  for (const [id, entry] of Object.entries(rewardedPlacements)) {
    const p = section(`rewarded.placements.${id}`, entry);
    bool(`rewarded.placements.${id}.enabled`, p['enabled']);
    optionalLevel(`rewarded.placements.${id}.minLevel`, p['minLevel']);
    optionalNonNegative(`rewarded.placements.${id}.dayLimit`, p['dayLimit']);
    optionalNonNegative(`rewarded.placements.${id}.hourLimit`, p['hourLimit']);
    optionalNonNegative(`rewarded.placements.${id}.answerTimeoutMs`, p['answerTimeoutMs']);
  }

  const banner = section('banner', policy.banner);
  bool('banner.enabled', banner['enabled']);
  level('banner.minLevel', banner['minLevel']);
  const bannerPlacements = section('banner.placements', banner['placements']);
  for (const [id, entry] of Object.entries(bannerPlacements)) {
    const p = section(`banner.placements.${id}`, entry);
    bool(`banner.placements.${id}.enabled`, p['enabled']);
    optionalLevel(`banner.placements.${id}.minLevel`, p['minLevel']);
  }

  const noAds = section('noAds', policy.noAds);
  for (const key of ['blocksInterstitial', 'blocksBanner', 'blocksRewarded'] as const) bool(`noAds.${key}`, noAds[key]);
  const offer = noAds['offerAfterInterstitials'];
  if (offer !== undefined && offer !== null) {
    const o = section('noAds.offerAfterInterstitials', offer);
    bool('noAds.offerAfterInterstitials.enabled', o['enabled']);
    if (!(isInteger(o['every']) && (o['every'] as number) >= 1)) fail('noAds.offerAfterInterstitials.every must be an integer ≥ 1');
    const first = o['first'];
    if (first !== undefined && first !== null && !(isInteger(first) && first >= 1)) fail('noAds.offerAfterInterstitials.first must be an integer ≥ 1');
    level('noAds.offerAfterInterstitials.minLevel', o['minLevel']);
  }

  const timeouts = policy.timeouts;
  if (timeouts !== undefined) {
    const t = section('timeouts', timeouts);
    for (const key of ['rewardedAnswerMs', 'interstitialStartMs', 'interstitialShowHardCapMs', 'interstitialRecheckMs'] as const) {
      const value = t[key];
      if (!(isNumber(value) && Number.isFinite(value) && value >= 0)) fail(`timeouts.${key} must be a finite number ≥ 0`);
    }
  }

  const session = section('session', policy.session);
  const max = session['maxInterstitials'];
  if (max !== null && !(isInteger(max) && max >= 0)) fail('session.maxInterstitials must be null or an integer ≥ 0');
  bool('session.blockWhileAdInFlight', session['blockWhileAdInFlight']);

  // one kind per placement id
  const kinds = new Map<string, AdPlacementType>();
  const claim = (id: string, kind: AdPlacementType): void => {
    const taken = kinds.get(id);
    if (taken !== undefined && taken !== kind) fail(`placement ${id} is listed under both ${taken} and ${kind}`);
    kinds.set(id, kind);
  };
  for (const id of Object.keys(interPlacements)) claim(id, 'inter');
  for (const id of Object.keys(rewardedPlacements)) claim(id, 'rewarded');
  for (const id of Object.keys(bannerPlacements)) claim(id, 'banner');

  if (policy.segmentation !== null) {
    if (policy.segmentation === undefined) fail('segmentation must be an AdsConfig or null');
    validateAdsConfig(policy.segmentation);
    for (const [id, kind] of kinds) {
      const inTables = Object.prototype.hasOwnProperty.call(policy.segmentation.placements, id) ? policy.segmentation.placements[id] : undefined;
      if (inTables && inTables.type !== kind) fail(`placement ${id} is ${kind} in the policy but ${inTables.type} in the segmentation`);
    }
  }
}
