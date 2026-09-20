import type { CoreRuntimeModule } from '../core/CoreRuntime';
import { ADS_BANNER_PLACEMENT, ADS_DEFAULT_SEGMENT_ID, validateAdsConfig } from './config';
import { ADS_POLICY_NEUTRAL, adsPolicyFromConfig, validateAdsPolicy } from './policy';
import type { AdsRequestTimeouts } from './policy';
import type {
  AdsBannerPlacementPolicy,
  AdsCadence,
  AdsInterstitialPlacementPolicy,
  AdsPolicy,
  AdsRewardedPlacementPolicy
} from './policy';
import type {
  AdPlacementRule,
  AdPlacementType,
  AdSegment,
  AdsCount,
  AdsDecision,
  AdsDecisionSource,
  AdsDenyReason,
  AdsErrorHandler,
  AdsEvent,
  AdsEventHandler,
  AdsInput,
  AdsPolicyDecision,
  AdsRuntimeOptions,
  AdsRuntimeStats,
  AdsStateKey,
  AdsStateStore
} from './types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const DENY_REASONS: readonly AdsDenyReason[] = [
  'disabled', 'no_ads', 'unknown_placement', 'wrong_type', 'placement_disabled', 'ad_in_flight', 'first_show_delay', 'session_limit', 'cadence',
  'no_segment', 'segment_disabled', 'no_rule', 'below_start_level', 'day_limit', 'hour_limit', 'inter_cooldown', 'reward_cooldown'
];

// Same shape as the other modules' default handlers — independently re-declared (module boundary rule).
function defaultOnAdsError(error: unknown, context: { phase: string; event: AdsEvent }): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[AdsRuntime] onEvent threw', context, error);
  }
}

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** A refusal: the reason and the layer that produced it. null = allowed. */
type Verdict = { reason: AdsDenyReason; source: AdsDecisionSource } | null;
const policyDeny = (reason: AdsDenyReason): Verdict => ({ reason, source: 'policy' });
const tablesDeny = (reason: AdsDenyReason): Verdict => ({ reason, source: 'segmentation' });

const recordOf = (map: Map<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, value] of map) out[key] = value;
  return out;
};

/**
 * The ad decision layer as a Game Core module. Gameplay reports a placement
 * (`requestInterstitial('level_complete')`, `requestRewarded('hint_rewarded')`, `canShowBanner()`)
 * and gets an explainable decision; it never holds an ad condition itself. Two layers decide, in
 * this order:
 *
 * 1. the per-game **policy** (`AdsPolicy`): is the kind on, is the placement listed and enabled,
 *    what NO_ADS blocks, the in-flight guard, the policy start level, the first-show delay, the
 *    session cap, the cadence — then, after the tables, the placement's own day / hour caps and the
 *    cooldown floors;
 * 2. the optional **segmentation** tables (`AdsConfig`, Trail Arrow's `AdsGate` 1:1): WHO (segment
 *    by level or by average / largest payment), the per-segment start level, day / hour limits and
 *    the two global cooldowns.
 *
 * Built from `{ config }` alone (AdsRuntime v0.7) the policy is `adsPolicyFromConfig(config)`,
 * whose gates are all neutral — the tables decide exactly as before. It never shows an ad and knows
 * no SDK: the host asks, the platform shows, the host reports a confirmed show through `registerShown`.
 *
 * Donor semantics kept as they are in production (see the specs for the full list):
 * - NO_ADS blocks interstitials and the banner, NOT rewarded; rewarded has no cooldowns; the
 *   banner has neither counters nor cooldowns;
 * - the fallback segment `default` has no placement rules = no ads at all;
 * - counters reset by the CALENDAR day / hour, cooldowns are global across placements, a show of
 *   an unknown placement still arms the after-reward cooldown;
 * - only `registerShown` and `markPayer` write state; a decision never does.
 */
export class AdsRuntime implements CoreRuntimeModule {
  private readonly policy: AdsPolicy;
  private readonly state: AdsStateStore;
  private readonly input: AdsInput;
  private readonly onEvent: AdsEventHandler | null;
  private readonly onAdsError: AdsErrorHandler;
  private offered = 0;
  private denied = 0;
  private shown = 0;
  private readonly denyByReason: Record<AdsDenyReason, number>;
  private events = 0;
  private callbackErrors = 0;
  private storeErrors = 0;
  private lastBannerReport: string | null = null;
  // the session: in memory, from the runtime's birth (or `startSession()`) on
  private sessionStartedAt: number;
  private sessionInterstitials = 0;
  private sessionShown = new Map<string, number>();
  private cadenceCounts = new Map<string, number>();
  // V1.1: the NO_ADS offer cadence (donor InterstitialAdsSystem: an in-memory counter, a pending flag the map consumes)
  private interstitialsSinceOffer = 0;
  private noAdsOfferDue = false;
  private noAdsOffersRaised = 0;

  constructor(options: AdsRuntimeOptions) {
    if (options.config && options.policy) throw new RangeError('AdsRuntime: pass either options.config or options.policy, not both');
    if (options.policy) {
      validateAdsPolicy(options.policy);
      this.policy = options.policy;
    } else if (options.config) {
      validateAdsConfig(options.config);
      this.policy = adsPolicyFromConfig(options.config);
    } else {
      throw new RangeError('AdsRuntime: options.config or options.policy is required');
    }
    if (!options.state) throw new RangeError('AdsRuntime: options.state is required');
    if (!options.input) throw new RangeError('AdsRuntime: options.input is required');
    this.state = options.state;
    this.input = options.input;
    this.onEvent = options.onEvent ?? null;
    this.onAdsError = options.onAdsError ?? defaultOnAdsError;
    this.denyByReason = {} as Record<AdsDenyReason, number>;
    for (const reason of DENY_REASONS) this.denyByReason[reason] = 0;
    this.sessionStartedAt = finite(this.input.now());
  }

  /** Nothing is paced by frame time — the module only keeps the CoreRuntimeModule contract. */
  update(_frameMs: number): boolean {
    return false;
  }

  /** The policy in force (a preset is frozen; a bare `config` is wrapped by reference). */
  getPolicy(): AdsPolicy {
    return this.policy;
  }

  /**
   * A new session starts now: the first-show delay counts from here, the session cap and the
   * cadence counters restart at zero. The persisted counters and cooldowns are not touched. Call it
   * where the game's own session begins (e.g. once the host's clock is anchored), if not at construction.
   */
  startSession(): void {
    this.sessionStartedAt = finite(this.input.now());
    this.sessionInterstitials = 0;
    this.sessionShown = new Map();
    this.cadenceCounts = new Map();
    this.interstitialsSinceOffer = 0;
    this.noAdsOfferDue = false;
    this.noAdsOffersRaised = 0;
  }

  /**
   * V1.1: the platform-answer watchdogs the host should arm for this placement (`policy.timeouts`, or
   * the neutral donor numbers when the policy has none; a rewarded placement's `answerTimeoutMs`
   * overrides `rewardedAnswerMs`). Data only — the runtime never runs a timer.
   */
  getRequestTimeouts(placement?: string): AdsRequestTimeouts {
    const base = this.policy.timeouts ?? ADS_POLICY_NEUTRAL.timeouts;
    const own = placement !== undefined && Object.prototype.hasOwnProperty.call(this.policy.rewarded.placements, placement)
      ? this.policy.rewarded.placements[placement]?.answerTimeoutMs
      : undefined;
    return { ...base, rewardedAnswerMs: own ?? base.rewardedAnswerMs };
  }

  /** V1.1: is the NO_ADS offer trigger waiting for the host? (a peek; `consumeNoAdsOffer()` takes it) */
  isNoAdsOfferDue(): boolean {
    return this.noAdsOfferDue;
  }

  /**
   * V1.1: takes the NO_ADS offer trigger — true once per trigger, then false until the cadence raises
   * the next one. Re-checks the entitlement at this moment (donor: the map drops a pending offer when
   * the player bought NO_ADS meanwhile): with NO_ADS owned the trigger is dropped and false is answered.
   * The runtime never opens a window: what to show, and when, is the host's.
   */
  consumeNoAdsOffer(): boolean {
    if (!this.noAdsOfferDue) return false;
    this.noAdsOfferDue = false;
    return !this.input.hasNoAds();
  }

  /**
   * The player's segment (donor `currentSegmentId`): a payer — the sticky mark, NO_ADS,
   * `input.isPayer()`, or a recorded payment — goes by average and largest payment (thresholds ×
   * `currencyScale`), everybody else by level; the first match in config order wins; nothing
   * matched → `default` when the config has it, else null. Always null without segmentation tables.
   */
  segmentId(): string | null {
    const tables = this.policy.segmentation;
    if (!tables) return null;
    const level = this.input.level();
    if (this.isPayer()) {
      const count = this.input.payCount();
      const avg = count > 0 ? this.input.paySumCents() / count / 100 : 0;
      const max = this.input.payMaxCents() / 100;
      const k = this.input.currencyScale();
      for (const [id, seg] of Object.entries(tables.segments)) {
        if (seg.payer !== 'PAYER') continue;
        if (avg >= seg.avgFrom * k && avg < seg.avgTo * k && max >= seg.maxFrom * k && max < seg.maxTo * k) return id;
      }
    } else {
      for (const [id, seg] of Object.entries(tables.segments)) {
        if (seg.payer === 'NON_PAYER' && level >= seg.levelFrom && level < seg.levelTo) return id;
      }
    }
    return own(tables.segments, ADS_DEFAULT_SEGMENT_ID) ? ADS_DEFAULT_SEGMENT_ID : null;
  }

  /**
   * May this placement be shown right now, and if not — why, by which layer, under which policy.
   * The checks and their order are the policy gates first, then the donor's
   * `canShowInter` / `canShowRewarded` / `canShowBanner`, picked by `expect`, or by the placement's
   * own kind when it is omitted. Reads state, never writes it; a cadence counter (session memory)
   * is the one thing a request moves. Emits `offered` / `denied` (a banner decision only when it
   * changed — hosts poll it).
   */
  evaluate(placement: string, expect?: AdPlacementType): AdsPolicyDecision {
    const kind = expect ?? this.kindOf(placement);
    const segmentId = this.segmentId();
    const level = this.input.level();
    const verdict: Verdict =
      kind === 'inter' ? this.denyInter(placement, segmentId, level)
      : kind === 'rewarded' ? this.denyRewarded(placement, segmentId, level)
      : kind === 'banner' ? this.denyBanner(placement, segmentId, level)
      : policyDeny('unknown_placement');
    const reason = verdict?.reason ?? null;
    const decision: AdsPolicyDecision = {
      allowed: verdict === null,
      reason,
      segmentId,
      placement,
      adType: kind ?? null,
      level,
      source: verdict?.source ?? null,
      policy: { name: this.policy.name, version: this.policy.version }
    };

    if (reason === null) this.offered++;
    else {
      this.denied++;
      this.denyByReason[reason]++;
    }
    if (kind === 'banner') {
      const report = `${placement}|${reason ?? 'ok'}|${segmentId ?? ''}`;
      if (report === this.lastBannerReport) return decision;
      this.lastBannerReport = report;
    }
    // an allowed decision always has its kind: every path refuses an unknown placement first
    if (reason === null && kind) this.emit({ type: 'offered', placement, adType: kind, segmentId, level });
    else if (reason !== null) this.emit({ type: 'denied', placement, adType: this.kindOf(placement) ?? null, reason, segmentId, level });
    return decision;
  }

  /** `evaluate` reduced to the v0.7 shape `{ allowed, reason, segmentId }`. */
  decide(placement: string, expect?: AdPlacementType): AdsDecision {
    const { allowed, reason, segmentId } = this.evaluate(placement, expect);
    return { allowed, reason, segmentId };
  }

  /** Gameplay reached a moment that may carry an interstitial (`level_complete`, `level_fail` …): may it? */
  requestInterstitial(placement: string): AdsPolicyDecision {
    return this.evaluate(placement, 'inter');
  }

  /** Gameplay wants to offer a rewarded (`hint_rewarded`, `continue_rewarded` …): may it? */
  requestRewarded(placement: string): AdsPolicyDecision {
    return this.evaluate(placement, 'rewarded');
  }

  /** May the banner (or another banner placement) be on screen right now? */
  requestBanner(placement: string = ADS_BANNER_PLACEMENT): AdsPolicyDecision {
    return this.evaluate(placement, 'banner');
  }

  /** Donor `canShowInter`: NO_ADS → placement / type → segment → rule / start level → day / hour limit → the two cooldowns. */
  canShowInter(placement: string): boolean {
    return this.evaluate(placement, 'inter').allowed;
  }

  /** Donor `canShowRewarded`: placement / type → segment → rule / start level → day / hour limit. No NO_ADS check, no cooldowns. */
  canShowRewarded(placement: string): boolean {
    return this.evaluate(placement, 'rewarded').allowed;
  }

  /** Donor `canShowBanner`: NO_ADS → the `banner` placement, segment, rule → start level. No limits, no cooldowns. */
  canShowBanner(): boolean {
    return this.evaluate(ADS_BANNER_PLACEMENT, 'banner').allowed;
  }

  /**
   * A CONFIRMED show (the platform answered ok): the placement's day and hour counts go up and the
   * global cooldown clock is armed — `lastInterAt` for an interstitial, `lastRewardAt` for
   * everything else, an unknown placement included (donor behavior). This is the only place the
   * calendar reset is persisted. The session counters move too: the interstitial cap, the
   * placement's shows, and its cadence count restarts. Emits `shown` with the counts after the increment.
   */
  registerShown(placement: string): void {
    const kind = this.kindOf(placement);
    const now = this.input.now();
    const buckets = this.buckets(now);
    const fresh = this.freshCount(placement, buckets);
    const next: AdsCount = { day: fresh.day + 1, hour: fresh.hour + 1 };
    try {
      if (this.state.get('dayStamp') !== buckets.day) {
        this.state.set('dayStamp', buckets.day);
        this.state.set('hourStamp', buckets.hour);
        for (const key of this.state.listCounts()) this.state.setCount(key, { day: 0, hour: 0 });
      } else if (this.state.get('hourStamp') !== buckets.hour) {
        this.state.set('hourStamp', buckets.hour);
        for (const key of this.state.listCounts()) this.state.setCount(key, { day: finite(this.state.getCount(key).day), hour: 0 });
      }
      this.state.setCount(placement, next);
      this.state.set(kind === 'inter' ? 'lastInterAt' : 'lastRewardAt', now);
    } catch {
      this.storeErrors++; // donor: a failed write is swallowed
    }
    this.shown++;
    if (kind === 'inter') this.sessionInterstitials++;
    this.sessionShown.set(placement, (this.sessionShown.get(placement) ?? 0) + 1);
    if (this.cadenceCounts.has(placement)) this.cadenceCounts.set(placement, 0);
    const level = this.input.level();
    const segmentId = this.segmentId();
    this.emit({ type: 'shown', placement, adType: kind ?? null, segmentId, level, day: next.day, hour: next.hour });
    if (kind === 'inter') this.countForNoAdsOffer(placement, segmentId, level);
  }

  /**
   * V1.1 — donor `InterstitialAdsSystem.onAdsInterstitial` 1:1: only a CONFIRMED interstitial counts;
   * nothing is counted (the counter stands still) while the player owns NO_ADS or is below the offer's
   * level; the N-th count restarts the counter and raises the trigger (`first` for the first trigger
   * of the session, `every` afterwards).
   */
  private countForNoAdsOffer(placement: string, segmentId: string | null, level: number): void {
    const offer = this.policy.noAds.offerAfterInterstitials;
    if (!offer || !offer.enabled) return;
    if (this.input.hasNoAds() || level < offer.minLevel) return;
    this.interstitialsSinceOffer++;
    const threshold = this.noAdsOffersRaised === 0 ? offer.first ?? offer.every : offer.every;
    if (this.interstitialsSinceOffer < threshold) return;
    const interstitials = this.interstitialsSinceOffer;
    this.interstitialsSinceOffer = 0;
    this.noAdsOfferDue = true;
    this.noAdsOffersRaised++;
    this.emit({ type: 'no_ads_offer', placement, segmentId, level, interstitials });
  }

  /** The player made ANY purchase → the payer branch for good (donor: a sticky flag, never cleared). */
  markPayer(): void {
    try {
      if (this.state.get('payer') > 0) return;
      this.state.set('payer', 1);
    } catch {
      this.storeErrors++;
    }
  }

  getStats(): AdsRuntimeStats {
    const buckets = this.buckets(this.input.now());
    const counts: Record<string, AdsCount> = {};
    let placements: string[] = [];
    try {
      placements = this.state.listCounts();
    } catch {
      this.storeErrors++;
    }
    for (const placement of placements) counts[placement] = this.freshCount(placement, buckets);
    return {
      segmentId: this.segmentId(),
      payer: this.isPayer(),
      level: this.input.level(),
      offered: this.offered,
      denied: this.denied,
      shown: this.shown,
      denyByReason: { ...this.denyByReason },
      lastInterAt: this.read('lastInterAt'),
      lastRewardAt: this.read('lastRewardAt'),
      dayStamp: buckets.day,
      hourStamp: buckets.hour,
      counts,
      events: this.events,
      callbackErrors: this.callbackErrors,
      storeErrors: this.storeErrors,
      policy: { name: this.policy.name, version: this.policy.version },
      session: {
        startedAt: this.sessionStartedAt,
        interstitials: this.sessionInterstitials,
        shown: recordOf(this.sessionShown),
        cadence: recordOf(this.cadenceCounts),
        noAdsOffer: { due: this.noAdsOfferDue, raised: this.noAdsOffersRaised, interstitialsSinceOffer: this.interstitialsSinceOffer }
      }
    };
  }

  // ------------------------------------------------------------------ the three pipelines

  /**
   * Interstitial: `disabled` → `no_ads` → `unknown_placement` / `wrong_type` / `placement_disabled`
   * → `ad_in_flight` → policy `below_start_level` → `first_show_delay` → `session_limit` → `cadence`
   * → tables: `no_segment` → `segment_disabled` → `no_rule` → `below_start_level` → `day_limit` →
   * `hour_limit` → `inter_cooldown` → `reward_cooldown`.
   */
  private denyInter(placement: string, segmentId: string | null, level: number): Verdict {
    const pol = this.policy.interstitial;
    if (!pol.enabled) return policyDeny('disabled');
    if (this.policy.noAds.blocksInterstitial && this.input.hasNoAds()) return policyDeny('no_ads');
    const gate = this.placementGate(pol.placements, placement, 'inter');
    if (gate) return gate;
    const entry = pol.placements[placement] as AdsInterstitialPlacementPolicy;
    if (this.adInFlight()) return policyDeny('ad_in_flight');
    if (level < Math.max(pol.minLevel, entry.minLevel ?? -Infinity)) return policyDeny('below_start_level');
    const now = this.input.now();
    if (pol.firstShowDelayMs > 0 && now - this.sessionStartedAt < pol.firstShowDelayMs) return policyDeny('first_show_delay');
    const cap = this.policy.session.maxInterstitials;
    if (cap !== null && this.sessionInterstitials >= cap) return policyDeny('session_limit');
    if (entry.cadence && !this.passesCadence(placement, entry.cadence)) return policyDeny('cadence');

    let seg: AdSegment | undefined;
    let rule: AdPlacementRule | undefined;
    const tables = this.policy.segmentation;
    if (tables) {
      seg = segmentId !== null ? own(tables.segments, segmentId) : undefined;
      if (!seg) return tablesDeny('no_segment');
      if (seg.disableInter) return tablesDeny('segment_disabled');
      const row = own(tables.placements, placement);
      rule = row ? own(row.bySegment, segmentId!) : undefined;
      if (!rule) return tablesDeny('no_rule');
      if (level < rule.startFromLevel) return tablesDeny('below_start_level');
    }
    const limits = this.limitVerdict(placement, now, rule, entry.dayLimit, entry.hourLimit);
    if (limits) return limits;

    const sinceInter = now - this.read('lastInterAt');
    const interMs = Math.max(pol.cooldownMs, (seg?.delayBetweenInters ?? 0) * 1000);
    if (sinceInter < interMs) return sinceInter < pol.cooldownMs ? policyDeny('inter_cooldown') : tablesDeny('inter_cooldown');
    const sinceReward = now - this.read('lastRewardAt');
    const rewardMs = Math.max(pol.afterRewardedCooldownMs, (seg?.delayAfterReward ?? 0) * 1000);
    if (sinceReward < rewardMs) return sinceReward < pol.afterRewardedCooldownMs ? policyDeny('reward_cooldown') : tablesDeny('reward_cooldown');
    return null;
  }

  /**
   * Rewarded: `disabled` → `no_ads` (only when the policy says NO_ADS blocks rewarded — it does not
   * by default) → placement gates → `ad_in_flight` → policy `below_start_level` → tables:
   * `no_segment` → `no_rule` → `below_start_level` → `day_limit` → `hour_limit`. No cooldowns.
   */
  private denyRewarded(placement: string, segmentId: string | null, level: number): Verdict {
    const pol = this.policy.rewarded;
    if (!pol.enabled) return policyDeny('disabled');
    if (this.policy.noAds.blocksRewarded && this.input.hasNoAds()) return policyDeny('no_ads');
    const gate = this.placementGate(pol.placements, placement, 'rewarded');
    if (gate) return gate;
    const entry = pol.placements[placement] as AdsRewardedPlacementPolicy;
    if (this.adInFlight()) return policyDeny('ad_in_flight');
    if (level < Math.max(pol.minLevel, entry.minLevel ?? -Infinity)) return policyDeny('below_start_level');

    let rule: AdPlacementRule | undefined;
    const tables = this.policy.segmentation;
    if (tables) {
      if (segmentId === null) return tablesDeny('no_segment');
      const row = own(tables.placements, placement);
      rule = row ? own(row.bySegment, segmentId) : undefined;
      if (!rule) return tablesDeny('no_rule');
      if (level < rule.startFromLevel) return tablesDeny('below_start_level');
    }
    return this.limitVerdict(placement, this.input.now(), rule, entry.dayLimit, entry.hourLimit);
  }

  /**
   * Banner: `disabled` → `no_ads` → placement gates → policy `below_start_level` → tables:
   * `no_segment` → `no_rule` → `below_start_level`. No counters, no cooldowns (donor B8).
   */
  private denyBanner(placement: string, segmentId: string | null, level: number): Verdict {
    const pol = this.policy.banner;
    if (!pol.enabled) return policyDeny('disabled');
    if (this.policy.noAds.blocksBanner && this.input.hasNoAds()) return policyDeny('no_ads');
    const gate = this.placementGate(pol.placements, placement, 'banner');
    if (gate) return gate;
    const entry = pol.placements[placement] as AdsBannerPlacementPolicy;
    if (level < Math.max(pol.minLevel, entry.minLevel ?? -Infinity)) return policyDeny('below_start_level');
    const tables = this.policy.segmentation;
    if (tables) {
      if (segmentId === null) return tablesDeny('no_segment');
      const row = own(tables.placements, placement);
      const rule = row ? own(row.bySegment, segmentId) : undefined;
      if (!rule) return tablesDeny('no_rule');
      if (level < rule.startFromLevel) return tablesDeny('below_start_level');
    }
    return null;
  }

  // ------------------------------------------------------------------ policy helpers

  /** The allow-list of one kind: listed and enabled → pass; listed off → `placement_disabled`; known as another kind → `wrong_type`; known nowhere → `unknown_placement`. */
  private placementGate(list: Record<string, { enabled: boolean }>, placement: string, kind: AdPlacementType): Verdict {
    const entry = own(list, placement);
    if (entry) return entry.enabled ? null : policyDeny('placement_disabled');
    const known = this.kindOf(placement);
    if (known === undefined) return policyDeny('unknown_placement');
    if (known !== kind) return policyDeny('wrong_type');
    return policyDeny('placement_disabled'); // in the tables as this kind, but the policy does not list it
  }

  /** The kind of a placement: the policy's lists first, then the segmentation tables; undefined = unknown everywhere. */
  private kindOf(placement: string): AdPlacementType | undefined {
    if (own(this.policy.interstitial.placements, placement)) return 'inter';
    if (own(this.policy.rewarded.placements, placement)) return 'rewarded';
    if (own(this.policy.banner.placements, placement)) return 'banner';
    const tables = this.policy.segmentation;
    return tables ? own(tables.placements, placement)?.type : undefined;
  }

  private adInFlight(): boolean {
    return this.policy.session.blockWhileAdInFlight && this.input.isAdInFlight?.() === true;
  }

  /** Counts this request; passes when the count reached `first` (before the placement's first show this session) or `every`. */
  private passesCadence(placement: string, cadence: AdsCadence): boolean {
    const count = (this.cadenceCounts.get(placement) ?? 0) + 1;
    this.cadenceCounts.set(placement, count);
    const threshold = (this.sessionShown.get(placement) ?? 0) > 0 ? cadence.every : (cadence.first ?? cadence.every);
    return count >= threshold;
  }

  /** The tighter of the table rule's and the policy's day / hour caps; the day before the hour (donor order). */
  private limitVerdict(placement: string, now: number, rule: AdPlacementRule | undefined, dayCap: number | null | undefined, hourCap: number | null | undefined): Verdict {
    if (!rule && dayCap == null && hourCap == null) return null;
    const count = this.freshCount(placement, this.buckets(now));
    const ruleDay = rule ? rule.dayLimit : Infinity;
    const ruleHour = rule ? rule.hourLimit : Infinity;
    if (count.day >= Math.min(ruleDay, dayCap ?? Infinity)) return count.day >= ruleDay ? tablesDeny('day_limit') : policyDeny('day_limit');
    if (count.hour >= Math.min(ruleHour, hourCap ?? Infinity)) return count.hour >= ruleHour ? tablesDeny('hour_limit') : policyDeny('hour_limit');
    return null;
  }

  // donor `isPayer`: the sticky mark, NO_ADS / the starter pack (host facts), or any recorded payment
  private isPayer(): boolean {
    if (this.read('payer') > 0) return true;
    return this.input.hasNoAds() || this.input.isPayer?.() === true || this.input.payCount() > 0;
  }

  /** The calendar buckets of `now` in the host's local time: a day index and an hour index (the donor's "Y-M-D" / "Y-M-D-H" keys). */
  private buckets(now: number): { day: number; hour: number } {
    const offset = this.input.timezoneOffsetMinutes ? finite(this.input.timezoneOffsetMinutes()) : 0;
    const local = now - offset * MINUTE_MS;
    return { day: Math.floor(local / DAY_MS), hour: Math.floor(local / HOUR_MS) };
  }

  /**
   * Donor `freshStats`, read-only: another calendar day → the count reads as 0 / 0, another hour
   * of the same day → the hour part reads as 0. Nothing is written here.
   */
  private freshCount(placement: string, buckets: { day: number; hour: number }): AdsCount {
    if (this.read('dayStamp') !== buckets.day) return { day: 0, hour: 0 };
    let stored: AdsCount | undefined;
    try {
      stored = this.state.getCount(placement);
    } catch {
      this.storeErrors++; // donor: an unreadable storage reads as "nothing was shown"
    }
    const day = finite(stored?.day);
    return { day, hour: this.read('hourStamp') !== buckets.hour ? 0 : finite(stored?.hour) };
  }

  private read(key: AdsStateKey): number {
    try {
      return finite(this.state.get(key));
    } catch {
      this.storeErrors++;
      return 0;
    }
  }

  private emit(event: AdsEvent): void {
    this.events++;
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch (error) {
      this.callbackErrors++;
      try {
        this.onAdsError(error, { phase: 'onEvent', event });
      } catch {
        // an error handler can never take the decisions down
      }
    }
  }
}
