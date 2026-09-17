import { readFileSync } from 'node:fs';
import { AdsRuntime, MemoryAdsStateStore, parseAdsTsv } from '../../src/ads';
import type { AdsConfig, AdsEvent, AdsInput, AdsRuntimeOptions, AdsStateStore } from '../../src/ads';

// The REAL donor tables, copied verbatim from trail_arrow-latest/ads_config (0.1.22) — never edited here.
export const SEGMENTS_TSV = readFileSync(new URL('./fixtures/segments.tsv', import.meta.url), 'utf-8');
export const PLACEMENTS_TSV = readFileSync(new URL('./fixtures/placements.tsv', import.meta.url), 'utf-8');
/** `AD_SEGMENTS` / `AD_PLACEMENTS` of the donor's `src/app/adsConfig.generated.ts`, `Infinity` spelled as a string. */
export const GENERATED_JSON = readFileSync(new URL('./fixtures/adsConfig.generated.json', import.meta.url), 'utf-8');

export const donorConfig = (): AdsConfig => parseAdsTsv(SEGMENTS_TSV, PLACEMENTS_TSV);

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** 2026-09-17 10:00:00 UTC — an epoch-like clock, like the donor's `Date.now()`. */
export const T0 = Date.UTC(2026, 8, 17, 10, 0, 0);
export const RUB_PER_USD = 85;

export const INTERS = ['level_win_inter', 'level_fail_inter', 'level_exit_inter'] as const;
export const REWARDED = ['ad_hint_booster_rewarded', 'ad_extra_moves_rewarded', 'ad_level_win_x2_rewarded', 'ad_refill_hearts_rewarded'] as const;

/** The game model the donor's AdsGate reads, as plain data. */
export interface Player {
  now: number;
  level: number;
  noAds: boolean;
  starterPack: boolean;
  payCount: number;
  paySumCents: number;
  payMaxCents: number;
  usd: boolean;
  /** JS getTimezoneOffset() minutes; undefined = the input has no calendar (UTC buckets). */
  tzOffsetMin: number | undefined;
}

export interface AdsHost {
  ads: AdsRuntime;
  player: Player;
  state: MemoryAdsStateStore;
  events: AdsEvent[];
  /** `type:placement[:reason]` per event. */
  log(): string[];
  /** One payment of `amount` in the platform's currency, recorded like the donor's `recordPayment` (no markPayer). */
  pay(amount: number): void;
  /** Average / largest payment straight into the profile (count = 1). */
  setPayments(avg: number, max: number): void;
}

export function makeAds(
  player: Partial<Player> = {},
  options: Partial<Omit<AdsRuntimeOptions, 'state'>> & { state?: AdsStateStore } = {}
): AdsHost {
  const p: Player = {
    now: T0, level: 1, noAds: false, starterPack: false, payCount: 0, paySumCents: 0, payMaxCents: 0, usd: false, tzOffsetMin: undefined,
    ...player
  };
  const memory = new MemoryAdsStateStore();
  const events: AdsEvent[] = [];
  const input: AdsInput = {
    now: () => p.now,
    level: () => p.level,
    hasNoAds: () => p.noAds,
    payCount: () => p.payCount,
    paySumCents: () => p.paySumCents,
    payMaxCents: () => p.payMaxCents,
    currencyScale: () => (p.usd ? 1 / RUB_PER_USD : 1),
    isPayer: () => p.starterPack,
    timezoneOffsetMinutes: () => p.tzOffsetMin ?? 0
  };
  const ads = new AdsRuntime({
    config: donorConfig(),
    input,
    onEvent: (event) => events.push(event),
    ...options,
    state: options.state ?? memory
  });
  return {
    ads, player: p, state: memory, events,
    log: () => events.map((e) => `${e.type}:${e.placement}${e.type === 'denied' ? `:${e.reason}` : ''}`),
    pay: (amount) => {
      const cents = Math.round(amount * 100);
      p.payCount += 1;
      p.paySumCents += cents;
      p.payMaxCents = Math.max(p.payMaxCents, cents);
    },
    setPayments: (avg, max) => {
      p.payCount = 1;
      p.paySumCents = Math.round(avg * 100);
      p.payMaxCents = Math.round(max * 100);
    }
  };
}

/** The donor config with every cooldown switched off — for the limit tests ("cooldown stubbed out"). */
export function noCooldownConfig(): AdsConfig {
  const config = donorConfig();
  for (const seg of Object.values(config.segments)) {
    seg.delayBetweenInters = 0;
    seg.delayAfterReward = 0;
  }
  return config;
}
