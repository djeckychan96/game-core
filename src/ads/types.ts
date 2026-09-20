import type { AdsPolicy } from './policy';

// AdsRuntime v0.7 — types. The ad decision layer of Trail Arrow 0.1.22 (`src/app/AdsGate.ts` +
// `ads_config/*.tsv`) without the game model, storage, the wall clock or any advertising SDK:
// WHO may see an ad, WHEN, in WHICH placement, and WHY not. Showing the ad is the platform's job.

export type AdPlacementType = 'inter' | 'rewarded' | 'banner';
export type AdPayerClass = 'PAYER' | 'NON_PAYER' | 'ANY';

/** One row of `segments.tsv`. Payment thresholds are in the config's base currency (the donor: roubles). */
export interface AdSegment {
  payer: AdPayerClass;
  /** NON_PAYER segments match `levelFrom <= level < levelTo`; PAYER segments ignore the level. */
  levelFrom: number;
  levelTo: number;
  /** PAYER segments match `avgFrom*k <= avg < avgTo*k && maxFrom*k <= max < maxTo*k`, `k = input.currencyScale()`. */
  avgFrom: number;
  avgTo: number;
  maxFrom: number;
  maxTo: number;
  /** Seconds an interstitial stays away after ANY rewarded (global, across placements). */
  delayAfterReward: number;
  /** Seconds between two interstitials (global, across placements). */
  delayBetweenInters: number;
  disableInter: boolean;
}

/** One row of `placements.tsv`: the rule of a placement for one segment. */
export interface AdPlacementRule {
  startFromLevel: number;
  dayLimit: number;
  hourLimit: number;
}

export interface AdPlacement {
  type: AdPlacementType;
  /** A segment without a rule here never gets this placement (the donor's `default` has no rules at all = no ads). */
  bySegment: Record<string, AdPlacementRule>;
}

export interface AdsConfig {
  /** Insertion order matters: the first matching segment wins, like the donor's `Object.entries(AD_SEGMENTS)`. */
  segments: Record<string, AdSegment>;
  placements: Record<string, AdPlacement>;
}

/**
 * Why a placement was refused, in check order: first the per-game policy gates (`disabled` … `cadence`),
 * then the segmentation tables (`no_segment` … `reward_cooldown`, the donor's branches, which
 * return a bare `false` there — the reasons only name the branch, eligibility is unchanged).
 * `no_ads`, `below_start_level`, `day_limit`, `hour_limit` and the two cooldowns can come from
 * either layer; `AdsPolicyDecision.source` tells which.
 */
export type AdsDenyReason =
  /** The kind of ad is switched off in the policy (`interstitial.enabled: false` …). */
  | 'disabled'
  | 'no_ads'
  | 'unknown_placement'
  | 'wrong_type'
  /** The placement is not in the policy's list for this kind, or is listed with `enabled: false`. */
  | 'placement_disabled'
  /** The host reports an ad in flight and the policy blocks a second one. */
  | 'ad_in_flight'
  /** The session is younger than `interstitial.firstShowDelayMs`. */
  | 'first_show_delay'
  /** `session.maxInterstitials` confirmed interstitials were already shown this session. */
  | 'session_limit'
  /** The placement's cadence says this request is not the N-th. */
  | 'cadence'
  | 'no_segment'
  | 'segment_disabled'
  | 'no_rule'
  | 'below_start_level'
  | 'day_limit'
  | 'hour_limit'
  | 'inter_cooldown'
  | 'reward_cooldown';

export interface AdsDecision {
  allowed: boolean;
  /** null when allowed. */
  reason: AdsDenyReason | null;
  segmentId: string | null;
}

/** Which layer refused: the per-game policy gates or the segmentation tables. */
export type AdsDecisionSource = 'policy' | 'segmentation';

/** `AdsDecision` with everything analytics wants to know about a refusal — what `evaluate` / `request*` answer. */
export interface AdsPolicyDecision extends AdsDecision {
  placement: string;
  /** The kind the decision was made for; null when the placement is unknown and no kind was asked. */
  adType: AdPlacementType | null;
  level: number;
  /** null when allowed. */
  source: AdsDecisionSource | null;
  /** The policy that decided (`name@version`), so cohorts of different presets can be split. */
  policy: { name: string; version: number };
}

export type AdsStateKey = 'dayStamp' | 'hourStamp' | 'payer' | 'lastInterAt' | 'lastRewardAt';

export interface AdsCount {
  day: number;
  hour: number;
}

/**
 * The persisted ad state (the donor's `hazargames.arrow.adstats` blob), injected: the host picks
 * localStorage or the cloud profile. A missing key reads as 0. Every method may throw (private
 * mode) — the runtime then reads defaults and drops the write, like the donor's swallowed
 * try/catch (donor issue B2: the limits stop binding when the storage is gone).
 */
export interface AdsStateStore {
  get(key: AdsStateKey): number;
  set(key: AdsStateKey, value: number): void;
  getCount(placement: string): AdsCount;
  setCount(placement: string, value: AdsCount): void;
  /** Placements that have a stored count — the runtime resets them on a day / hour change. */
  listCounts(): string[];
}

/** Everything the runtime needs from the game, injected. It never reads a model, a clock or a storage itself. */
export interface AdsInput {
  /**
   * Epoch milliseconds. The donor uses the DEVICE wall clock (`Date.now()`, donor issue B3); the
   * host decides. Must be epoch-like: an unset timestamp is 0, so a clock that starts near 0
   * reads as "an ad was just shown".
   */
  now(): number;
  /** The player's current level. */
  level(): number;
  /** The player bought NO_ADS: no interstitials, no banner. Rewarded stays available — it is opt-in value. */
  hasNoAds(): boolean;
  /** Payments recorded in the profile (the donor's `pay_count`). */
  payCount(): number;
  /** Sum of the recorded payments, in cents of the platform's currency (`pay_sum_cents`). */
  paySumCents(): number;
  /** The largest recorded payment, in cents of the platform's currency (`pay_max_cents`). */
  payMaxCents(): number;
  /** Scale of the config's payment thresholds to the platform's currency: 1 on rouble platforms, 1/85 on the donor's USD ones. */
  currencyScale(): number;
  /**
   * Any other host-side fact that makes the player a payer (the donor: the starter pack is owned).
   * OR-ed with the sticky payer mark, `hasNoAds()` and `payCount() > 0`.
   */
  isPayer?(): boolean;
  /**
   * The local calendar of the day / hour counters, as JS `getTimezoneOffset()` gives it (UTC minus
   * local, in minutes). The donor buckets by the DEVICE calendar — 1:1 is
   * `() => new Date().getTimezoneOffset()`. Omitted = UTC days and hours.
   */
  timezoneOffsetMinutes?(): number;
  /**
   * An ad is in flight right now (the host asked the platform to show one and has no answer yet).
   * Read only when the policy's `session.blockWhileAdInFlight` is on. Omitted = never in flight.
   */
  isAdInFlight?(): boolean;
}

/**
 * `offered` / `denied` — one per decision (the banner decision, which the donor's host polls every
 * 2 s, only when it changes). `shown` — one per `registerShown`, with the counts AFTER the increment.
 */
export type AdsEvent =
  | { type: 'offered'; placement: string; adType: AdPlacementType; segmentId: string | null; level: number }
  | {
      type: 'denied';
      placement: string;
      /** The placement's configured type; null for an unknown placement. */
      adType: AdPlacementType | null;
      reason: AdsDenyReason;
      segmentId: string | null;
      level: number;
    }
  | {
      type: 'shown';
      placement: string;
      adType: AdPlacementType | null;
      segmentId: string | null;
      level: number;
      day: number;
      hour: number;
    };

export type AdsEventType = AdsEvent['type'];
export type AdsEventHandler = (event: AdsEvent) => void;

export type AdsErrorPhase = 'onEvent';

export interface AdsErrorContext {
  phase: AdsErrorPhase;
  event: AdsEvent;
}

export type AdsErrorHandler = (error: unknown, context: AdsErrorContext) => void;

export interface AdsRuntimeOptions {
  /** The tables alone (AdsRuntime v0.7): the same as `policy: adsPolicyFromConfig(config)`. Exactly one of `config` / `policy`. */
  config?: AdsConfig;
  /** The per-game policy (a preset, or `resolveAdsPolicy(preset, overrides)`). */
  policy?: AdsPolicy;
  state: AdsStateStore;
  input: AdsInput;
  onEvent?: AdsEventHandler;
  /** Where a throwing `onEvent` lands; defaults to console.error. Decisions and state are never affected. */
  onAdsError?: AdsErrorHandler;
}

export interface AdsRuntimeStats {
  segmentId: string | null;
  payer: boolean;
  level: number;
  /** Decisions that came out allowed / denied (every call, the polled banner included). */
  offered: number;
  denied: number;
  /** `registerShown` calls. */
  shown: number;
  denyByReason: Record<AdsDenyReason, number>;
  lastInterAt: number;
  lastRewardAt: number;
  /** The CURRENT calendar buckets (not the stored ones). */
  dayStamp: number;
  hourStamp: number;
  /** Counts as the next decision will see them (after the calendar reset). */
  counts: Record<string, AdsCount>;
  /** Events delivered to `onEvent`. */
  events: number;
  /** Caught `onEvent` exceptions. */
  callbackErrors: number;
  /** Reads / writes of the state store that threw. */
  storeErrors: number;
  /** The policy in force. */
  policy: { name: string; version: number };
  /** Session-local counters (in memory; a new runtime or `startSession()` starts at zero). */
  session: AdsSessionStats;
}

export interface AdsSessionStats {
  /** `input.now()` when the session started. */
  startedAt: number;
  /** Confirmed interstitials this session (what `session.maxInterstitials` caps). */
  interstitials: number;
  /** Confirmed shows per placement this session. */
  shown: Record<string, number>;
  /** Requests per placement since its last show — the cadence counters (only placements with a cadence). */
  cadence: Record<string, number>;
}
