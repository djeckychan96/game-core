import type { CoreRuntimeModule } from '../core/CoreRuntime';
import { ADS_BANNER_PLACEMENT, ADS_DEFAULT_SEGMENT_ID, validateAdsConfig } from './config';
import type {
  AdPlacement,
  AdPlacementType,
  AdsConfig,
  AdsCount,
  AdsDecision,
  AdsDenyReason,
  AdsErrorHandler,
  AdsEvent,
  AdsEventHandler,
  AdsInput,
  AdsRuntimeOptions,
  AdsRuntimeStats,
  AdsStateKey,
  AdsStateStore
} from './types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const DENY_REASONS: readonly AdsDenyReason[] = [
  'no_ads', 'unknown_placement', 'wrong_type', 'no_segment', 'segment_disabled', 'no_rule',
  'below_start_level', 'day_limit', 'hour_limit', 'inter_cooldown', 'reward_cooldown'
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

/**
 * The ad decision layer as a Game Core module: a 1:1 port of Trail Arrow's `AdsGate` over an
 * injected config, state store and input. It answers WHO may see an ad (segment: non-payers by
 * level, payers by average / largest payment), WHEN (start level, calendar day / hour limits, the
 * two global cooldowns), in WHICH placement, and WHY not (`AdsDenyReason`). It never shows an ad
 * and knows no SDK: the platform layer asks `canShow*`, shows the ad, and reports a confirmed
 * show through `registerShown`.
 *
 * Donor semantics kept as they are in production (see the spec for the full list):
 * - NO_ADS blocks interstitials and the banner, NOT rewarded; rewarded has no cooldowns; the
 *   banner has neither counters nor cooldowns;
 * - the fallback segment `default` has no placement rules = no ads at all;
 * - counters reset by the CALENDAR day / hour, cooldowns are global across placements, a show of
 *   an unknown placement still arms the after-reward cooldown;
 * - only `registerShown` and `markPayer` write state; a decision never does.
 */
export class AdsRuntime implements CoreRuntimeModule {
  private readonly config: AdsConfig;
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

  constructor(options: AdsRuntimeOptions) {
    validateAdsConfig(options.config);
    if (!options.state) throw new RangeError('AdsRuntime: options.state is required');
    if (!options.input) throw new RangeError('AdsRuntime: options.input is required');
    this.config = options.config;
    this.state = options.state;
    this.input = options.input;
    this.onEvent = options.onEvent ?? null;
    this.onAdsError = options.onAdsError ?? defaultOnAdsError;
    this.denyByReason = {} as Record<AdsDenyReason, number>;
    for (const reason of DENY_REASONS) this.denyByReason[reason] = 0;
  }

  /** Nothing is paced by frame time — the module only keeps the CoreRuntimeModule contract. */
  update(_frameMs: number): boolean {
    return false;
  }

  /**
   * The player's segment (donor `currentSegmentId`): a payer — the sticky mark, NO_ADS,
   * `input.isPayer()`, or a recorded payment — goes by average and largest payment (thresholds ×
   * `currencyScale`), everybody else by level; the first match in config order wins; nothing
   * matched → `default` when the config has it, else null.
   */
  segmentId(): string | null {
    const level = this.input.level();
    if (this.isPayer()) {
      const count = this.input.payCount();
      const avg = count > 0 ? this.input.paySumCents() / count / 100 : 0;
      const max = this.input.payMaxCents() / 100;
      const k = this.input.currencyScale();
      for (const [id, seg] of Object.entries(this.config.segments)) {
        if (seg.payer !== 'PAYER') continue;
        if (avg >= seg.avgFrom * k && avg < seg.avgTo * k && max >= seg.maxFrom * k && max < seg.maxTo * k) return id;
      }
    } else {
      for (const [id, seg] of Object.entries(this.config.segments)) {
        if (seg.payer === 'NON_PAYER' && level >= seg.levelFrom && level < seg.levelTo) return id;
      }
    }
    return own(this.config.segments, ADS_DEFAULT_SEGMENT_ID) ? ADS_DEFAULT_SEGMENT_ID : null;
  }

  /**
   * May this placement be shown right now, and if not — why. The checks and their order are the
   * donor's `canShowInter` / `canShowRewarded` / `canShowBanner`, picked by `expect`, or by the
   * placement's own type when it is omitted. Reads state, never writes it. Emits `offered` /
   * `denied` (a banner decision only when it changed — hosts poll it).
   */
  decide(placement: string, expect?: AdPlacementType): AdsDecision {
    const p = own(this.config.placements, placement);
    const segmentId = this.segmentId();
    const level = this.input.level();
    const kind = expect ?? p?.type;
    const reason =
      kind === 'inter' ? this.denyInter(placement, p, segmentId, level)
      : kind === 'rewarded' ? this.denyRewarded(placement, p, segmentId, level)
      : kind === 'banner' ? this.denyBanner(p, segmentId, level)
      : 'unknown_placement';

    if (reason === null) this.offered++;
    else {
      this.denied++;
      this.denyByReason[reason]++;
    }
    if (kind === 'banner') {
      const report = `${placement}|${reason ?? 'ok'}|${segmentId ?? ''}`;
      if (report === this.lastBannerReport) return { allowed: reason === null, reason, segmentId };
      this.lastBannerReport = report;
    }
    // an allowed decision always has its placement: every path denies an unknown one first
    if (reason === null && p) this.emit({ type: 'offered', placement, adType: p.type, segmentId, level });
    else if (reason !== null) this.emit({ type: 'denied', placement, adType: p ? p.type : null, reason, segmentId, level });
    return { allowed: reason === null, reason, segmentId };
  }

  /** Donor `canShowInter`: NO_ADS → placement / type → segment → rule / start level → day / hour limit → the two cooldowns. */
  canShowInter(placement: string): boolean {
    return this.decide(placement, 'inter').allowed;
  }

  /** Donor `canShowRewarded`: placement / type → segment → rule / start level → day / hour limit. No NO_ADS check, no cooldowns. */
  canShowRewarded(placement: string): boolean {
    return this.decide(placement, 'rewarded').allowed;
  }

  /** Donor `canShowBanner`: NO_ADS → the `banner` placement, segment, rule → start level. No type check, no limits, no cooldowns. */
  canShowBanner(): boolean {
    return this.decide(ADS_BANNER_PLACEMENT, 'banner').allowed;
  }

  /**
   * A CONFIRMED show (the platform answered ok): the placement's day and hour counts go up and the
   * global cooldown clock is armed — `lastInterAt` for an interstitial, `lastRewardAt` for
   * everything else, an unknown placement included (donor behavior). This is the only place the
   * calendar reset is persisted. Emits `shown` with the counts after the increment.
   */
  registerShown(placement: string): void {
    const p = own(this.config.placements, placement);
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
      this.state.set(p?.type === 'inter' ? 'lastInterAt' : 'lastRewardAt', now);
    } catch {
      this.storeErrors++; // donor: a failed write is swallowed
    }
    this.shown++;
    this.emit({ type: 'shown', placement, adType: p ? p.type : null, segmentId: this.segmentId(), level: this.input.level(), day: next.day, hour: next.hour });
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
      storeErrors: this.storeErrors
    };
  }

  private denyInter(placement: string, p: AdPlacement | undefined, segmentId: string | null, level: number): AdsDenyReason | null {
    if (this.input.hasNoAds()) return 'no_ads';
    if (!p) return 'unknown_placement';
    if (p.type !== 'inter') return 'wrong_type';
    const seg = segmentId !== null ? own(this.config.segments, segmentId) : undefined;
    if (!seg) return 'no_segment';
    if (seg.disableInter) return 'segment_disabled';
    const rule = own(p.bySegment, segmentId!);
    if (!rule) return 'no_rule';
    if (level < rule.startFromLevel) return 'below_start_level';
    const now = this.input.now();
    const count = this.freshCount(placement, this.buckets(now));
    if (count.day >= rule.dayLimit) return 'day_limit';
    if (count.hour >= rule.hourLimit) return 'hour_limit';
    if (now - this.read('lastInterAt') < seg.delayBetweenInters * 1000) return 'inter_cooldown';
    if (now - this.read('lastRewardAt') < seg.delayAfterReward * 1000) return 'reward_cooldown';
    return null;
  }

  private denyRewarded(placement: string, p: AdPlacement | undefined, segmentId: string | null, level: number): AdsDenyReason | null {
    if (!p) return 'unknown_placement';
    if (p.type !== 'rewarded') return 'wrong_type';
    if (segmentId === null) return 'no_segment';
    const rule = own(p.bySegment, segmentId);
    if (!rule) return 'no_rule';
    if (level < rule.startFromLevel) return 'below_start_level';
    const count = this.freshCount(placement, this.buckets(this.input.now()));
    if (count.day >= rule.dayLimit) return 'day_limit';
    if (count.hour >= rule.hourLimit) return 'hour_limit';
    return null;
  }

  private denyBanner(p: AdPlacement | undefined, segmentId: string | null, level: number): AdsDenyReason | null {
    if (this.input.hasNoAds()) return 'no_ads';
    if (!p) return 'unknown_placement';
    if (segmentId === null) return 'no_segment';
    const rule = own(p.bySegment, segmentId);
    if (!rule) return 'no_rule';
    return level >= rule.startFromLevel ? null : 'below_start_level';
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
