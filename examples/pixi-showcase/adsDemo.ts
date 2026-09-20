// AdsRuntime demo for the showcase: ONE scripted fake player walking through the donor's ad rules.
// No ad SDK anywhere — AdsRuntime only DECIDES; "the platform showed the ad" is a plain
// `registerShown` call here. The tables are the REAL Trail Arrow ones (ads_config/*.tsv, copied
// verbatim into tests/ads/fixtures); the profile, the state store and the clock are fakes a game
// replaces with its model, its storage and `Date.now()`.
import { AdsRuntime, MemoryAdsStateStore, parseAdsTsv } from 'game-core';
import type { AdPlacementType, AdsEvent, AdsEventHandler, AdsRuntimeStats } from 'game-core';
import placementsTsv from '../../tests/ads/fixtures/placements.tsv?raw';
import segmentsTsv from '../../tests/ads/fixtures/segments.tsv?raw';

/** What the donor's AdsGate reads from the game model, as plain demo data. */
export interface DemoAdsProfile {
  nowMs: number;
  level: number;
  noAds: boolean;
  payCount: number;
  paySumCents: number;
  payMaxCents: number;
}

export interface AdsTimelineEntry {
  step: string;
  level: number;
  placement: string;
  segment: string | null;
  /** `offered` / `denied` for a decision, `shown` for a confirmed show, `payer` / `no_ads` for a profile change. */
  kind: 'offered' | 'denied' | 'shown' | 'no_ads_offer' | 'profile';
  reason: string | null;
  /** Day / hour counts of the placement after a show. */
  counts: string | null;
}

const DEMO_ADS_EPOCH_MS = 1_789_639_200_000; // 2026-09-17 10:00:00 UTC — an epoch-like clock, like the donor's Date.now()
const RUB_PER_USD = 85; // the demo catalog is in dollars, the donor's thresholds in roubles

export function createAdsDemo(onEvent: (next: AdsEventHandler) => AdsEventHandler) {
  const profile: DemoAdsProfile = { nowMs: DEMO_ADS_EPOCH_MS, level: 1, noAds: false, payCount: 0, paySumCents: 0, payMaxCents: 0 };
  const state = new MemoryAdsStateStore();
  const timeline: AdsTimelineEntry[] = [];
  let step = '';

  const record = (event: AdsEvent) => {
    timeline.push({
      step,
      level: event.level,
      placement: event.placement,
      segment: event.segmentId,
      kind: event.type,
      reason: event.type === 'denied' ? event.reason : null,
      counts: event.type === 'shown' ? `day ${event.day} · hour ${event.hour}` : null
    });
  };

  const ads = new AdsRuntime({
    config: parseAdsTsv(segmentsTsv, placementsTsv),
    state,
    input: {
      now: () => profile.nowMs,
      level: () => profile.level,
      hasNoAds: () => profile.noAds,
      payCount: () => profile.payCount,
      paySumCents: () => profile.paySumCents,
      payMaxCents: () => profile.payMaxCents,
      currencyScale: () => 1 / RUB_PER_USD
    },
    onEvent: onEvent(record)
  });

  /** Host-side payment accounting (the donor's `recordPayment`): the sums pick the pay_* segment. */
  const recordPayment = (amount: number) => {
    const cents = Math.round(amount * 100);
    if (cents <= 0) return;
    profile.payCount += 1;
    profile.paySumCents += cents;
    profile.payMaxCents = Math.max(profile.payMaxCents, cents);
  };

  const note = (text: string) => {
    timeline.push({ step, level: profile.level, placement: text, segment: ads.segmentId(), kind: 'profile', reason: null, counts: null });
  };
  /** The platform layer of a game: ask → (the SDK shows the ad) → report the confirmed show. */
  const offer = (placement: string, expect: AdPlacementType, platformShows = false) => {
    if (ads.decide(placement, expect).allowed && platformShows) ads.registerShown(placement);
  };

  /** L1 → L15 → L20 → rewarded → cooldown → payer → NO_ADS, from a clean state every time. */
  const run = (): AdsTimelineEntry[] => {
    timeline.length = 0;
    state.load({});
    Object.assign(profile, { nowMs: DEMO_ADS_EPOCH_MS, level: 1, noAds: false, payCount: 0, paySumCents: 0, payMaxCents: 0 });

    step = 'L1';
    offer('level_win_inter', 'inter');
    step = 'L15';
    profile.level = 15;
    offer('level_win_inter', 'inter', true);
    profile.nowMs += 10_000;
    offer('level_fail_inter', 'inter'); // the cooldown is global across placements
    step = 'L20';
    profile.level = 20;
    profile.nowMs += 230_000; // 240 s after the interstitial
    offer('level_win_inter', 'inter');
    offer('banner', 'banner');
    step = 'rewarded';
    offer('ad_hint_booster_rewarded', 'rewarded', true);
    offer('ad_hint_booster_rewarded', 'rewarded'); // np_2: one a day
    step = 'cooldown';
    profile.nowMs += 30_000;
    offer('level_win_inter', 'inter'); // 30 s after a rewarded: 60 s are required
    profile.nowMs += 35_000;
    offer('level_win_inter', 'inter');
    step = 'payer';
    recordPayment(2.99);
    ads.markPayer();
    note('paid $2.99 → markPayer');
    offer('level_win_inter', 'inter');
    offer('banner', 'banner'); // payers have no banner row
    offer('ad_level_win_x2_rewarded', 'rewarded');
    step = 'NO_ADS';
    profile.noAds = true;
    note('bought NO_ADS');
    offer('level_win_inter', 'inter');
    offer('banner', 'banner');
    offer('ad_refill_hearts_rewarded', 'rewarded'); // rewarded survives NO_ADS
    return timeline;
  };

  const lines = (): string[] =>
    timeline.map((entry) => {
      const head = `${entry.step.padEnd(8)} L${entry.level} ${(entry.segment ?? '—').padEnd(6)}`;
      if (entry.kind === 'profile') return `${head} · ${entry.placement}`;
      if (entry.kind === 'shown') return `${head} SHOWN   ${entry.placement} · ${entry.counts}`;
      return `${head} ${entry.kind === 'offered' ? 'ALLOWED' : 'DENIED '} ${entry.placement}${entry.reason ? ` · ${entry.reason}` : ''}`;
    });

  const summary = (stats: AdsRuntimeStats): string =>
    `ADS · segment ${stats.segmentId ?? '—'}${stats.payer ? ' · PAYER' : ''} · offered ${stats.offered} · denied ${stats.denied} · shown ${stats.shown}`;

  return { ads, profile, state, timeline, run, lines, summary, recordPayment };
}
