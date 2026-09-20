// Ads Policy V1.1: the NO_ADS offer cadence (donor InterstitialAdsSystem 1:1 — confirmed interstitials only,
// nothing counted with NO_ADS or below the level, a pending trigger the host consumes) and the platform-answer
// watchdog numbers (donor AdsTimeouts.ts: 130 s rewarded belt, 12 / 150 / 5 s interstitial), per game and per placement.
import { expect, test } from 'vitest';
import {
  ADS_POLICY_NEUTRAL, TRAIL_ARROW_AD_POLICY_V1, TRAIL_ARROW_AD_POLICY_V2, adsPolicyFromConfig, resolveAdsPolicy, validateAdsPolicy
} from '../../src/ads';
import type { AdsEvent, AdsPolicy, AdsPolicyOverrides } from '../../src/ads';
import { adsEventToAnalytics } from '../../src/composition/adsAnalytics';
import { SEC, T0, donorConfig, makeAds } from './fixtures';
import type { Player } from './fixtures';

const SIMPLE: AdsPolicy = Object.freeze({
  name: 'simple',
  version: 1,
  interstitial: { enabled: true, cooldownMs: 0, afterRewardedCooldownMs: 0, firstShowDelayMs: 0, minLevel: 1, placements: { level_complete: { enabled: true }, level_fail: { enabled: true } } },
  rewarded: { enabled: true, minLevel: 1, placements: { hint_rewarded: { enabled: true }, continue_rewarded: { enabled: true, answerTimeoutMs: 75 * SEC } } },
  banner: { enabled: true, minLevel: 1, placements: { banner: { enabled: true } } },
  noAds: { blocksInterstitial: true, blocksBanner: true, blocksRewarded: false, offerAfterInterstitials: { enabled: true, every: 3, minLevel: 1 } },
  session: { maxInterstitials: null, blockWhileAdInFlight: false },
  segmentation: null
});
const simple = (overrides?: AdsPolicyOverrides, player: Partial<Player> = {}) => makeAds({ level: 10, ...player }, { policy: resolveAdsPolicy(SIMPLE, overrides) });
const offerLog = (events: AdsEvent[]) => events.filter((e) => e.type === 'no_ads_offer').map((e) => (e.type === 'no_ads_offer' ? `${e.placement}@${e.interstitials}` : ''));

/** Confirmed interstitials one by one; answers whether the trigger was due after each. */
function showInters(host: ReturnType<typeof makeAds>, n: number, placement = 'level_complete'): boolean[] {
  const due: boolean[] = [];
  for (let i = 0; i < n; i++) {
    host.ads.registerShown(placement);
    due.push(host.ads.isNoAdsOfferDue());
  }
  return due;
}

// ---------------------------------------------------------------- the NO_ADS offer cadence

test('every: 3 → the trigger is raised by the 3rd and the 6th confirmed interstitial, not by 1, 2, 4, 5', () => {
  const host = simple();
  expect(showInters(host, 6)).toEqual([false, false, true, true, true, true]); // due stays up until the host consumes it
  expect(host.ads.getStats().session.noAdsOffer).toEqual({ due: true, raised: 2, interstitialsSinceOffer: 0 });
  expect(offerLog(host.events)).toEqual(['level_complete@3', 'level_complete@3']);
});

test('consumeNoAdsOffer takes the trigger once: 1, 2 → false; 3 → true then false; 4, 5 → false; 6 → true', () => {
  const host = simple();
  const taken: boolean[] = [];
  for (let i = 1; i <= 6; i++) {
    host.ads.registerShown(i % 2 ? 'level_complete' : 'level_fail');
    taken.push(host.ads.consumeNoAdsOffer());
  }
  expect(taken).toEqual([false, false, true, false, false, true]);
  expect(host.ads.consumeNoAdsOffer()).toBe(false); // nothing pending
  expect(host.ads.isNoAdsOfferDue()).toBe(false);
});

test('a rewarded show never moves the counter; a request that was refused or never confirmed is not a show', () => {
  const host = simple();
  host.ads.registerShown('level_complete');
  host.ads.registerShown('level_complete');
  for (let i = 0; i < 5; i++) host.ads.registerShown('hint_rewarded'); // confirmed rewarded ads: not interstitials
  expect(host.ads.isNoAdsOfferDue()).toBe(false);
  expect(host.ads.getStats().session.noAdsOffer.interstitialsSinceOffer).toBe(2);
  // the platform failed / the player cancelled: the host does not call registerShown — the counter stands still
  for (let i = 0; i < 4; i++) expect(host.ads.requestInterstitial('level_complete').allowed).toBe(true);
  expect(host.ads.isNoAdsOfferDue()).toBe(false);
  host.ads.registerShown('level_complete'); // the 3rd CONFIRMED one
  expect(host.ads.isNoAdsOfferDue()).toBe(true);
});

test('NO_ADS owned: confirmed interstitials are not counted and a pending trigger is dropped on consumption (donor: the map drops it)', () => {
  const owner = simple(undefined, { noAds: true });
  expect(showInters(owner, 9)).toEqual(Array(9).fill(false));
  expect(owner.ads.getStats().session.noAdsOffer).toEqual({ due: false, raised: 0, interstitialsSinceOffer: 0 });

  const late = simple(); // the trigger is up, then the player buys NO_ADS before the host got to show the window
  showInters(late, 3);
  expect(late.ads.isNoAdsOfferDue()).toBe(true);
  late.player.noAds = true;
  expect(late.ads.consumeNoAdsOffer()).toBe(false);
  expect(late.ads.isNoAdsOfferDue()).toBe(false);
});

test('below minLevel nothing is counted (donor: the counter is not accumulated before L17); counting starts at the level', () => {
  const host = simple({ noAds: { offerAfterInterstitials: { minLevel: 17 } } }, { level: 16 });
  expect(showInters(host, 5)).toEqual(Array(5).fill(false));
  expect(host.ads.getStats().session.noAdsOffer.interstitialsSinceOffer).toBe(0);
  host.player.level = 17;
  expect(showInters(host, 3)).toEqual([false, false, true]);
});

test('first: the first trigger of the session has its own count; every: afterwards. Different N per game', () => {
  const donorLike = simple({ noAds: { offerAfterInterstitials: { every: 3, first: 1 } } });
  expect(showInters(donorLike, 7)).toEqual([true, true, true, true, true, true, true]);
  expect(donorLike.ads.getStats().session.noAdsOffer.raised).toBe(3); // 1st, 4th, 7th
  const everyFive = simple({ noAds: { offerAfterInterstitials: { every: 5 } } });
  expect(showInters(everyFive, 10).map(Number)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  expect(everyFive.ads.getStats().session.noAdsOffer.raised).toBe(2);
});

test('disabled / null: no trigger, no event, no counting', () => {
  for (const host of [simple({ noAds: { offerAfterInterstitials: { enabled: false } } }), simple({ noAds: { offerAfterInterstitials: null } })]) {
    expect(showInters(host, 9)).toEqual(Array(9).fill(false));
    expect(host.ads.consumeNoAdsOffer()).toBe(false);
    expect(host.events.filter((e) => e.type === 'no_ads_offer')).toEqual([]);
    expect(host.ads.getStats().session.noAdsOffer).toEqual({ due: false, raised: 0, interstitialsSinceOffer: 0 });
  }
});

test('startSession restarts the offer counter and drops a pending trigger; the persisted counters are untouched', () => {
  const host = simple();
  showInters(host, 5); // due since the 3rd, 2 more counted
  host.ads.startSession();
  expect(host.ads.getStats().session.noAdsOffer).toEqual({ due: false, raised: 0, interstitialsSinceOffer: 0 });
  expect(host.ads.getStats().counts['level_complete']).toEqual({ day: 5, hour: 5 });
  expect(showInters(host, 3)).toEqual([false, false, true]);
});

test('the trigger event and its analytics record', () => {
  const host = simple();
  showInters(host, 3);
  const event = host.events.find((e) => e.type === 'no_ads_offer');
  expect(event).toEqual({ type: 'no_ads_offer', placement: 'level_complete', segmentId: null, level: 10, interstitials: 3 });
  expect(adsEventToAnalytics(event as AdsEvent)).toEqual({ kind: 'interaction', action: 'no_ads_offer', data: { placement: 'level_complete', segment: undefined, level: 10, interstitials: 3 } });
});

test('the decisions themselves are not touched by the offer rule (an interstitial is still allowed right after the trigger)', () => {
  const host = simple();
  showInters(host, 3);
  expect(host.ads.requestInterstitial('level_complete').allowed).toBe(true);
  expect(host.ads.requestRewarded('hint_rewarded').allowed).toBe(true);
});

// ---------------------------------------------------------------- the platform-answer watchdog numbers

test('getRequestTimeouts: the policy numbers, a rewarded placement override, the neutral donor numbers when the policy has none', () => {
  const host = simple({ timeouts: { rewardedAnswerMs: 100 * SEC, interstitialStartMs: 10 * SEC, interstitialShowHardCapMs: 120 * SEC, interstitialRecheckMs: 4 * SEC } });
  expect(host.ads.getRequestTimeouts()).toEqual({ rewardedAnswerMs: 100 * SEC, interstitialStartMs: 10 * SEC, interstitialShowHardCapMs: 120 * SEC, interstitialRecheckMs: 4 * SEC });
  expect(host.ads.getRequestTimeouts('hint_rewarded').rewardedAnswerMs).toBe(100 * SEC);
  expect(host.ads.getRequestTimeouts('continue_rewarded').rewardedAnswerMs).toBe(75 * SEC); // the placement's own belt
  expect(host.ads.getRequestTimeouts('level_complete').rewardedAnswerMs).toBe(100 * SEC); // not a rewarded placement: the default
  const noTimeouts = simple();
  expect(noTimeouts.ads.getPolicy().timeouts).toBeUndefined();
  expect(noTimeouts.ads.getRequestTimeouts()).toEqual(ADS_POLICY_NEUTRAL.timeouts);
  expect(ADS_POLICY_NEUTRAL.timeouts).toEqual({ rewardedAnswerMs: 130_000, interstitialStartMs: 12_000, interstitialShowHardCapMs: 150_000, interstitialRecheckMs: 5_000 });
});

test('validation: a bad offer cadence or a bad timeout is refused, null clears the cadence', () => {
  expect(() => resolveAdsPolicy(SIMPLE, { noAds: { offerAfterInterstitials: { every: 0 } } })).toThrow(/offerAfterInterstitials\.every/);
  expect(() => resolveAdsPolicy(SIMPLE, { noAds: { offerAfterInterstitials: { first: 1.5 } } })).toThrow(/offerAfterInterstitials\.first/);
  expect(() => resolveAdsPolicy(SIMPLE, { timeouts: { rewardedAnswerMs: -1 } })).toThrow(/timeouts\.rewardedAnswerMs/);
  expect(() => resolveAdsPolicy(SIMPLE, { rewarded: { placements: { hint_rewarded: { answerTimeoutMs: -5 } } } })).toThrow(/answerTimeoutMs/);
  expect(resolveAdsPolicy(SIMPLE, { noAds: { offerAfterInterstitials: null } }).noAds.offerAfterInterstitials).toBeNull();
  expect(() => validateAdsPolicy(TRAIL_ARROW_AD_POLICY_V2)).not.toThrow();
});

// ---------------------------------------------------------------- the presets

test('TRAIL_ARROW_AD_POLICY_V2 = V1 + the donor offer cadence (1st, then every 3rd from L17) + the donor watchdogs (75 s belt of ad_extra_moves kept); V1 unchanged and frozen', () => {
  expect(TRAIL_ARROW_AD_POLICY_V2.version).toBe(2);
  expect(TRAIL_ARROW_AD_POLICY_V2.noAds).toEqual({ blocksInterstitial: true, blocksBanner: true, blocksRewarded: false, offerAfterInterstitials: { enabled: true, every: 3, first: 1, minLevel: 17 } });
  expect(TRAIL_ARROW_AD_POLICY_V2.timeouts).toEqual({ rewardedAnswerMs: 130_000, interstitialStartMs: 12_000, interstitialShowHardCapMs: 150_000, interstitialRecheckMs: 5_000 });
  expect(TRAIL_ARROW_AD_POLICY_V2.rewarded.placements['ad_extra_moves_rewarded']).toEqual({ enabled: true, answerTimeoutMs: 75_000 });
  expect(TRAIL_ARROW_AD_POLICY_V2.rewarded.placements['ad_level_win_x2_rewarded']).toEqual({ enabled: true });
  expect(TRAIL_ARROW_AD_POLICY_V2.segmentation).toEqual(TRAIL_ARROW_AD_POLICY_V1.segmentation);
  expect(Object.isFrozen(TRAIL_ARROW_AD_POLICY_V2) && Object.isFrozen(TRAIL_ARROW_AD_POLICY_V2.noAds.offerAfterInterstitials)).toBe(true);
  // V1 keeps its meaning: no offer cadence, the neutral numbers, and it still equals a policy built from the bare tables
  expect(TRAIL_ARROW_AD_POLICY_V1.version).toBe(1);
  expect(TRAIL_ARROW_AD_POLICY_V1.noAds.offerAfterInterstitials).toBeNull();
  expect(TRAIL_ARROW_AD_POLICY_V1).toEqual(adsPolicyFromConfig(donorConfig(), { name: 'trail_arrow', version: 1 }));
  expect(() => { (TRAIL_ARROW_AD_POLICY_V2.noAds as { offerAfterInterstitials: unknown }).offerAfterInterstitials = null; }).toThrow();
});

test('the donor cadence on the Trail Arrow tables: a L30 non-payer, the 1st confirmed level_win_inter raises the offer, then the 4th and the 7th', () => {
  const host = makeAds({ level: 30 }, { policy: TRAIL_ARROW_AD_POLICY_V2 });
  const raised: number[] = [];
  for (let i = 1; i <= 7; i++) {
    host.player.now = T0 + i * 600 * SEC;
    host.ads.registerShown('level_win_inter');
    if (host.ads.consumeNoAdsOffer()) raised.push(i);
  }
  expect(raised).toEqual([1, 4, 7]);
  const below = makeAds({ level: 16 }, { policy: TRAIL_ARROW_AD_POLICY_V2 });
  below.ads.registerShown('level_win_inter');
  expect(below.ads.consumeNoAdsOffer()).toBe(false);
  expect(host.ads.getRequestTimeouts('ad_level_win_x2_rewarded').rewardedAnswerMs).toBe(130_000);
  expect(host.ads.getRequestTimeouts('ad_extra_moves_rewarded').rewardedAnswerMs).toBe(75_000);
});

test('resolveAdsPolicy never mutates the presets or the neutral object when overriding the V1.1 knobs', () => {
  const before = JSON.stringify([TRAIL_ARROW_AD_POLICY_V2, ADS_POLICY_NEUTRAL, SIMPLE]);
  const tuned = resolveAdsPolicy(TRAIL_ARROW_AD_POLICY_V2, { noAds: { offerAfterInterstitials: { every: 5 } }, timeouts: { rewardedAnswerMs: 90_000 } });
  expect(tuned.noAds.offerAfterInterstitials).toEqual({ enabled: true, every: 5, first: 1, minLevel: 17 });
  expect(tuned.timeouts?.rewardedAnswerMs).toBe(90_000);
  expect(tuned.timeouts?.interstitialStartMs).toBe(12_000);
  expect(JSON.stringify([TRAIL_ARROW_AD_POLICY_V2, ADS_POLICY_NEUTRAL, SIMPLE])).toBe(before);
});
