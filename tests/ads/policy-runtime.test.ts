// Ads Policy V1 through the runtime: the decision matrix of a policy-only game (no segmentation),
// the policy gates over the Trail Arrow tables, and the differential proof that
// TRAIL_ARROW_AD_POLICY_V1 decides exactly like AdsRuntime v0.7 over the same tables.
import { expect, test } from 'vitest';
import { AdsRuntime, MemoryAdsStateStore, TRAIL_ARROW_AD_POLICY_V1, adsPolicyFromConfig, resolveAdsPolicy } from '../../src/ads';
import type { AdsPolicy, AdsPolicyDecision, AdsPolicyOverrides, AdsRuntimeStats } from '../../src/ads';
import { DAY, HOUR, INTERS, MIN, REWARDED, SEC, T0, donorConfig, makeAds } from './fixtures';
import type { Player } from './fixtures';

/** A policy-only game: the SoliPix-shaped placements of the brief, no segment tables. */
const SIMPLE: AdsPolicy = Object.freeze({
  name: 'simple',
  version: 1,
  interstitial: {
    enabled: true, cooldownMs: 60 * SEC, afterRewardedCooldownMs: 30 * SEC, firstShowDelayMs: 0, minLevel: 1,
    placements: { level_complete: { enabled: true }, level_fail: { enabled: true }, return_to_map: { enabled: false } }
  },
  rewarded: { enabled: true, minLevel: 1, placements: { hint_rewarded: { enabled: true }, continue_rewarded: { enabled: true, dayLimit: 2 }, double_reward: { enabled: true, minLevel: 5 } } },
  banner: { enabled: true, minLevel: 3, placements: { banner: { enabled: true } } },
  noAds: { blocksInterstitial: true, blocksBanner: true, blocksRewarded: false },
  session: { maxInterstitials: null, blockWhileAdInFlight: true },
  segmentation: null
});

const simple = (overrides?: AdsPolicyOverrides, player: Partial<Player> = {}) =>
  makeAds({ level: 10, ...player }, { policy: resolveAdsPolicy(SIMPLE, overrides) });
const trailArrow = (overrides?: AdsPolicyOverrides, player: Partial<Player> = {}) =>
  makeAds({ level: 30, ...player }, { policy: resolveAdsPolicy(TRAIL_ARROW_AD_POLICY_V1, overrides) });

const brief = (d: AdsPolicyDecision) => `${d.allowed ? 'ok' : d.reason}${d.source ? `@${d.source}` : ''}`;

// ---------------------------------------------------------------- the decision object

test('requestInterstitial / requestRewarded / requestBanner answer an explainable decision; decide() keeps the v0.7 shape', () => {
  const host = simple();
  expect(host.ads.requestInterstitial('level_complete')).toEqual({
    allowed: true, reason: null, segmentId: null, placement: 'level_complete', adType: 'inter', level: 10, source: null, policy: { name: 'simple', version: 1 }
  });
  expect(host.ads.requestInterstitial('return_to_map')).toEqual({
    allowed: false, reason: 'placement_disabled', segmentId: null, placement: 'return_to_map', adType: 'inter', level: 10, source: 'policy', policy: { name: 'simple', version: 1 }
  });
  expect(host.ads.requestRewarded('hint_rewarded')).toMatchObject({ allowed: true, adType: 'rewarded', source: null });
  expect(host.ads.requestBanner()).toMatchObject({ allowed: true, placement: 'banner', adType: 'banner' });
  expect(host.ads.evaluate('nope')).toMatchObject({ allowed: false, reason: 'unknown_placement', adType: null, source: 'policy' });
  expect(host.ads.decide('level_complete')).toEqual({ allowed: true, reason: null, segmentId: null });
  expect(host.ads.decide('return_to_map')).toEqual({ allowed: false, reason: 'placement_disabled', segmentId: null });
  // events keep their v0.7 shape; a policy refusal is a plain `denied` with its reason
  expect(host.events.at(-1)).toEqual({ type: 'denied', placement: 'return_to_map', adType: 'inter', reason: 'placement_disabled', segmentId: null, level: 10 });
  expect(host.ads.getStats()).toMatchObject({ policy: { name: 'simple', version: 1 }, session: { startedAt: T0, interstitials: 0, shown: {}, cadence: {} } });
  expect(host.ads.getPolicy().name).toBe('simple');
});

// ---------------------------------------------------------------- enabled / disabled

test('a kind switched off answers `disabled` for every placement of that kind and nothing else', () => {
  const inter = simple({ interstitial: { enabled: false } });
  expect(brief(inter.ads.requestInterstitial('level_complete'))).toBe('disabled@policy');
  expect(brief(inter.ads.requestInterstitial('level_fail'))).toBe('disabled@policy');
  expect(brief(inter.ads.requestInterstitial('nope'))).toBe('disabled@policy'); // the switch outranks the placement
  expect(brief(inter.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  expect(brief(inter.ads.requestBanner())).toBe('ok');
  const rewarded = simple({ rewarded: { enabled: false } });
  expect(brief(rewarded.ads.requestRewarded('hint_rewarded'))).toBe('disabled@policy');
  expect(rewarded.ads.canShowRewarded('hint_rewarded')).toBe(false);
  expect(brief(rewarded.ads.requestInterstitial('level_complete'))).toBe('ok');
  const banner = simple({ banner: { enabled: false } });
  expect(brief(banner.ads.requestBanner())).toBe('disabled@policy');
  expect(banner.ads.canShowBanner()).toBe(false);
  expect(brief(banner.ads.requestInterstitial('level_complete'))).toBe('ok');
  // the same switch over the Trail Arrow tables: the segment would allow it, the policy does not
  const ta = trailArrow({ interstitial: { enabled: false } });
  for (const placement of INTERS) expect(brief(ta.ads.requestInterstitial(placement)), placement).toBe('disabled@policy');
  for (const placement of REWARDED) expect(ta.ads.canShowRewarded(placement), placement).toBe(true);
});

// ---------------------------------------------------------------- placement enabled / disabled

test('placements: listed and on → ok; listed and off → placement_disabled; another kind → wrong_type; nowhere → unknown_placement', () => {
  const host = simple();
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  expect(brief(host.ads.requestInterstitial('return_to_map'))).toBe('placement_disabled@policy');
  expect(brief(host.ads.requestInterstitial('hint_rewarded'))).toBe('wrong_type@policy');
  expect(brief(host.ads.requestRewarded('level_complete'))).toBe('wrong_type@policy');
  expect(brief(host.ads.requestBanner('level_complete'))).toBe('wrong_type@policy');
  expect(brief(host.ads.requestInterstitial('level_restart'))).toBe('unknown_placement@policy');
  expect(brief(host.ads.requestInterstitial('toString'))).toBe('unknown_placement@policy');
  // an override switches one placement off and leaves the other alone
  const tuned = simple({ interstitial: { placements: { level_fail: { enabled: false } } } });
  expect(brief(tuned.ads.requestInterstitial('level_fail'))).toBe('placement_disabled@policy');
  expect(brief(tuned.ads.requestInterstitial('level_complete'))).toBe('ok');
  // over the tables: a placement the tables know but the policy does not list is off — the policy is the allow-list
  const partial: AdsPolicy = { ...TRAIL_ARROW_AD_POLICY_V1, interstitial: { ...TRAIL_ARROW_AD_POLICY_V1.interstitial, placements: { level_win_inter: { enabled: true } } } };
  const ta = makeAds({ level: 30 }, { policy: partial });
  expect(brief(ta.ads.requestInterstitial('level_win_inter'))).toBe('ok');
  expect(brief(ta.ads.requestInterstitial('level_fail_inter'))).toBe('placement_disabled@policy');
  expect(brief(ta.ads.requestRewarded('level_fail_inter'))).toBe('wrong_type@policy');
  // a game's own ids work with the tables too, once the tables name them
  const tables = donorConfig();
  tables.placements['level_complete'] = tables.placements['level_win_inter']!;
  const own = makeAds({ level: 30 }, { policy: resolveAdsPolicy(TRAIL_ARROW_AD_POLICY_V1, { segmentation: tables, interstitial: { placements: { level_complete: { enabled: true } } } }) });
  expect(own.ads.requestInterstitial('level_complete')).toMatchObject({ allowed: true, segmentId: 'np_2' });
});

// ---------------------------------------------------------------- cooldowns

test('policy cooldowns to the millisecond: inter_cooldown until cooldownMs, reward_cooldown until afterRewardedCooldownMs', () => {
  const host = simple();
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  host.ads.registerShown('level_complete');
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('inter_cooldown@policy');
  host.player.now = T0 + 60 * SEC - 1;
  expect(brief(host.ads.requestInterstitial('level_fail'))).toBe('inter_cooldown@policy'); // global across placements
  host.player.now = T0 + 60 * SEC;
  expect(brief(host.ads.requestInterstitial('level_fail'))).toBe('ok');
  // a rewarded arms the after-reward floor; rewarded itself has no cooldown
  host.ads.registerShown('hint_rewarded');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('reward_cooldown@policy');
  host.player.now += 30 * SEC - 1;
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('reward_cooldown@policy');
  host.player.now += 1;
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  // both pending → inter_cooldown first (the donor order)
  host.ads.registerShown('level_complete');
  host.ads.registerShown('hint_rewarded');
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('inter_cooldown@policy');
});

test('over the tables the policy cooldown is a FLOOR: it lengthens a segment delay, never shortens it, and the source says who bound', () => {
  // np_2 (L20–39): delayBetweenInters 180 s, delayAfterReward 60 s
  const longer = trailArrow({ interstitial: { cooldownMs: 10 * MIN, afterRewardedCooldownMs: 2 * MIN } });
  longer.ads.registerShown('level_win_inter');
  longer.player.now = T0 + 5 * MIN;
  expect(brief(longer.ads.requestInterstitial('level_fail_inter'))).toBe('inter_cooldown@policy'); // the table's 180 s passed, the floor did not
  longer.player.now = T0 + 10 * MIN;
  expect(brief(longer.ads.requestInterstitial('level_fail_inter'))).toBe('ok');
  longer.ads.registerShown('ad_hint_booster_rewarded');
  longer.player.now += 90 * SEC;
  expect(brief(longer.ads.requestInterstitial('level_fail_inter'))).toBe('reward_cooldown@policy');
  longer.player.now += 30 * SEC;
  expect(brief(longer.ads.requestInterstitial('level_fail_inter'))).toBe('ok');

  const shorter = trailArrow({ interstitial: { cooldownMs: 10 * SEC, afterRewardedCooldownMs: SEC } });
  shorter.ads.registerShown('level_win_inter');
  shorter.player.now = T0 + 100 * SEC;
  expect(brief(shorter.ads.requestInterstitial('level_fail_inter'))).toBe('inter_cooldown@segmentation'); // 180 s still binds
  shorter.player.now = T0 + 180 * SEC;
  expect(brief(shorter.ads.requestInterstitial('level_fail_inter'))).toBe('ok');
});

// ---------------------------------------------------------------- first-show delay / session

test('firstShowDelayMs: no interstitial until the session is that old; startSession() restarts the clock; rewarded is untouched', () => {
  const host = simple({ interstitial: { firstShowDelayMs: 90 * SEC } });
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('first_show_delay@policy');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  expect(brief(host.ads.requestBanner())).toBe('ok');
  host.player.now = T0 + 90 * SEC - 1;
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('first_show_delay@policy');
  host.player.now = T0 + 90 * SEC;
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  host.ads.startSession();
  expect(host.ads.getStats().session.startedAt).toBe(T0 + 90 * SEC);
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('first_show_delay@policy');
  host.player.now = T0 + 180 * SEC;
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  // the same delay over the Trail Arrow tables: the segment says yes at L30, the session says not yet
  const ta = trailArrow({ interstitial: { firstShowDelayMs: 2 * MIN } });
  expect(brief(ta.ads.requestInterstitial('level_win_inter'))).toBe('first_show_delay@policy');
  ta.player.now = T0 + 2 * MIN;
  expect(brief(ta.ads.requestInterstitial('level_win_inter'))).toBe('ok');
});

test('session.maxInterstitials caps confirmed interstitials per session; rewarded shows do not count; startSession() resets', () => {
  const host = simple({ session: { maxInterstitials: 2 }, interstitial: { cooldownMs: 0, afterRewardedCooldownMs: 0 } });
  host.ads.registerShown('hint_rewarded');
  host.ads.registerShown('level_complete');
  expect(brief(host.ads.requestInterstitial('level_fail'))).toBe('ok');
  host.ads.registerShown('level_fail');
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('session_limit@policy');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  expect(host.ads.getStats().session).toMatchObject({ interstitials: 2, shown: { hint_rewarded: 1, level_complete: 1, level_fail: 1 } });
  host.ads.startSession();
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  expect(brief(simple({ session: { maxInterstitials: 0 } }).ads.requestInterstitial('level_complete'))).toBe('session_limit@policy');
});

test('blockWhileAdInFlight: an ad in flight blocks a new interstitial and a rewarded, not the banner; the Trail Arrow preset ignores the flag', () => {
  const host = simple(undefined, { adInFlight: true });
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ad_in_flight@policy');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('ad_in_flight@policy');
  expect(brief(host.ads.requestBanner())).toBe('ok');
  host.player.adInFlight = false;
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('ok');
  const off = simple({ session: { blockWhileAdInFlight: false } }, { adInFlight: true });
  expect(brief(off.ads.requestInterstitial('level_complete'))).toBe('ok');
  const ta = trailArrow(undefined, { adInFlight: true });
  expect(brief(ta.ads.requestInterstitial('level_win_inter'))).toBe('ok');
  expect(brief(trailArrow({ session: { blockWhileAdInFlight: true } }, { adInFlight: true }).ads.requestInterstitial('level_win_inter'))).toBe('ad_in_flight@policy');
});

// ---------------------------------------------------------------- cadence

test('cadence { every: 3 }: the 3rd request passes, a confirmed show restarts the count, and other placements keep their own count', () => {
  const host = simple({ interstitial: { cooldownMs: 0, placements: { level_complete: { cadence: { every: 3 } } } } });
  const ask = () => brief(host.ads.requestInterstitial('level_complete'));
  expect([ask(), ask(), ask()]).toEqual(['cadence@policy', 'cadence@policy', 'ok']);
  host.ads.registerShown('level_complete');
  expect(host.ads.getStats().session.cadence).toEqual({ level_complete: 0 });
  expect([ask(), ask(), ask()]).toEqual(['cadence@policy', 'cadence@policy', 'ok']);
  // level_fail has no cadence: every request passes, and it never touches level_complete's count
  expect(brief(host.ads.requestInterstitial('level_fail'))).toBe('ok');
  host.ads.registerShown('level_fail');
  expect(host.ads.getStats().session.cadence).toEqual({ level_complete: 3 });
  expect(ask()).toBe('ok'); // still due: the count is past the threshold and level_complete itself was not shown
});

test('cadence { every: 3, first: 1 }: the first request passes, then every 3rd after a show; a pass that did not show stays due', () => {
  const host = simple({ interstitial: { cooldownMs: 0, placements: { level_complete: { cadence: { every: 3, first: 1 } } } } });
  const ask = () => brief(host.ads.requestInterstitial('level_complete'));
  expect(ask()).toBe('ok');
  expect(ask()).toBe('ok'); // the platform had no fill: nothing was registered, so the next request is due again
  host.ads.registerShown('level_complete');
  expect([ask(), ask(), ask(), ask()]).toEqual(['cadence@policy', 'cadence@policy', 'ok', 'ok']);
});

test('cadence counts only requests that reached it: a refusal earlier in the pipeline (NO_ADS, disabled placement, delay) does not advance it', () => {
  const host = simple({ interstitial: { cooldownMs: 0, firstShowDelayMs: 10 * SEC, placements: { level_complete: { cadence: { every: 2 } } } } }, { noAds: true });
  const ask = () => brief(host.ads.requestInterstitial('level_complete'));
  expect([ask(), ask(), ask()]).toEqual(['no_ads@policy', 'no_ads@policy', 'no_ads@policy']);
  host.player.noAds = false;
  expect(ask()).toBe('first_show_delay@policy');
  host.player.now = T0 + 10 * SEC;
  expect(host.ads.getStats().session.cadence).toEqual({});
  expect([ask(), ask()]).toEqual(['cadence@policy', 'ok']);
  // a request refused AFTER the cadence (here: the day cap) still counted — the next one is due
  const capped = simple({ interstitial: { cooldownMs: 0, placements: { level_complete: { cadence: { every: 2 }, dayLimit: 1 } } } });
  capped.ads.registerShown('level_complete');
  expect([brief(capped.ads.requestInterstitial('level_complete')), brief(capped.ads.requestInterstitial('level_complete'))]).toEqual(['cadence@policy', 'day_limit@policy']);
  expect(brief(capped.ads.requestInterstitial('level_complete'))).toBe('day_limit@policy');
  capped.player.now += DAY;
  expect(brief(capped.ads.requestInterstitial('level_complete'))).toBe('ok');
  // cadence over the Trail Arrow tables: every 2nd win asks, the tables still say when
  const ta = trailArrow({ interstitial: { placements: { level_win_inter: { cadence: { every: 2 } } } } });
  expect([brief(ta.ads.requestInterstitial('level_win_inter')), brief(ta.ads.requestInterstitial('level_win_inter'))]).toEqual(['cadence@policy', 'ok']);
  ta.ads.registerShown('level_win_inter');
  expect([brief(ta.ads.requestInterstitial('level_win_inter')), brief(ta.ads.requestInterstitial('level_win_inter'))]).toEqual(['cadence@policy', 'inter_cooldown@segmentation']);
});

// ---------------------------------------------------------------- NO_ADS

test('NO_ADS blocks interstitials and the banner, not rewarded — and each of the three is a policy switch', () => {
  const host = simple(undefined, { noAds: true });
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('no_ads@policy');
  expect(brief(host.ads.requestInterstitial('nope'))).toBe('no_ads@policy'); // NO_ADS outranks the placement (donor order)
  expect(brief(host.ads.requestBanner())).toBe('no_ads@policy');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  expect(brief(host.ads.requestRewarded('continue_rewarded'))).toBe('ok');
  const strict = simple({ noAds: { blocksRewarded: true } }, { noAds: true });
  expect(brief(strict.ads.requestRewarded('hint_rewarded'))).toBe('no_ads@policy');
  const bannerStays = simple({ noAds: { blocksBanner: false } }, { noAds: true });
  expect(brief(bannerStays.ads.requestBanner())).toBe('ok');
  expect(brief(bannerStays.ads.requestInterstitial('level_complete'))).toBe('no_ads@policy');
  const interStays = simple({ noAds: { blocksInterstitial: false } }, { noAds: true });
  expect(brief(interStays.ads.requestInterstitial('level_complete'))).toBe('ok');
  // the preset: NO_ADS makes a payer (pay_1) — interstitials and the banner off, every rewarded of pay_1 on
  const ta = trailArrow(undefined, { noAds: true });
  for (const placement of INTERS) expect(ta.ads.requestInterstitial(placement), placement).toMatchObject({ allowed: false, reason: 'no_ads', source: 'policy', segmentId: 'pay_1' });
  expect(brief(ta.ads.requestBanner())).toBe('no_ads@policy');
  for (const placement of REWARDED) expect(ta.ads.canShowRewarded(placement), placement).toBe(true);
});

// ---------------------------------------------------------------- levels and limits without tables

test('policy start levels and per-placement day / hour caps decide a game without tables; the source is the policy', () => {
  const host = simple(undefined, { level: 0 });
  expect(brief(host.ads.requestInterstitial('level_complete'))).toBe('below_start_level@policy');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('below_start_level@policy');
  expect(brief(host.ads.requestBanner())).toBe('below_start_level@policy');
  host.player.level = 3;
  expect(brief(host.ads.requestBanner())).toBe('ok');
  expect(brief(host.ads.requestRewarded('double_reward'))).toBe('below_start_level@policy'); // its own minLevel 5
  host.player.level = 5;
  expect(brief(host.ads.requestRewarded('double_reward'))).toBe('ok');
  // continue_rewarded: 2 a day; hint_rewarded is not capped by it
  for (let i = 0; i < 2; i++) {
    expect(brief(host.ads.requestRewarded('continue_rewarded')), `#${i + 1}`).toBe('ok');
    host.ads.registerShown('continue_rewarded');
  }
  expect(brief(host.ads.requestRewarded('continue_rewarded'))).toBe('day_limit@policy');
  expect(brief(host.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  host.player.now += DAY;
  expect(brief(host.ads.requestRewarded('continue_rewarded'))).toBe('ok');
  // an hour cap on an interstitial, and the calendar hour reopens it
  const hourly = simple({ interstitial: { cooldownMs: 0, placements: { level_fail: { hourLimit: 1 } } } });
  hourly.ads.registerShown('level_fail');
  expect(brief(hourly.ads.requestInterstitial('level_fail'))).toBe('hour_limit@policy');
  expect(brief(hourly.ads.requestInterstitial('level_complete'))).toBe('ok');
  hourly.player.now += HOUR;
  expect(brief(hourly.ads.requestInterstitial('level_fail'))).toBe('ok');
  // without tables there is never a segment: no_segment / no_rule / segment_disabled cannot happen
  expect(host.ads.segmentId()).toBeNull();
  const reasons = Object.entries(host.ads.getStats().denyByReason).filter(([, n]) => n > 0).map(([r]) => r);
  expect(reasons).toEqual(['below_start_level', 'day_limit']);
});

test('over the tables the tighter of the two caps binds, and the source names it', () => {
  // np_2: ad_hint_booster_rewarded 1 / day (table) vs a policy cap of 5 → the table binds
  const tableWins = trailArrow({ rewarded: { placements: { ad_hint_booster_rewarded: { dayLimit: 5 } } } });
  tableWins.ads.registerShown('ad_hint_booster_rewarded');
  expect(brief(tableWins.ads.requestRewarded('ad_hint_booster_rewarded'))).toBe('day_limit@segmentation');
  // level_win_inter 500 / hour (table) vs a policy cap of 1 → the policy binds
  const policyWins = trailArrow({ interstitial: { placements: { level_win_inter: { hourLimit: 1 } } } });
  policyWins.ads.registerShown('level_win_inter');
  policyWins.player.now += 10 * MIN; // past the 180 s cooldown
  expect(brief(policyWins.ads.requestInterstitial('level_win_inter'))).toBe('hour_limit@policy');
  expect(brief(policyWins.ads.requestInterstitial('level_fail_inter'))).toBe('ok');
  // a policy minLevel above the table's start level
  const later = trailArrow({ interstitial: { minLevel: 35 } });
  expect(brief(later.ads.requestInterstitial('level_win_inter'))).toBe('below_start_level@policy');
  later.player.level = 35;
  expect(brief(later.ads.requestInterstitial('level_win_inter'))).toBe('ok');
  later.player.level = 10; // np_1's own start level (15) now binds, from the tables
  expect(brief(later.ads.requestInterstitial('level_win_inter'))).toBe('below_start_level@policy');
  expect(brief(trailArrow(undefined, { level: 10 }).ads.requestInterstitial('level_win_inter'))).toBe('below_start_level@segmentation');
});

// ---------------------------------------------------------------- determinism

test('the same policy, state and input give the same decision — across two runtimes and across repeated calls', () => {
  const policy = resolveAdsPolicy(SIMPLE, { interstitial: { placements: { level_complete: { cadence: { every: 2 } } } } });
  const script = (host: ReturnType<typeof makeAds>): string[] => {
    const out: string[] = [];
    const log = (d: AdsPolicyDecision) => out.push(`${d.placement}:${brief(d)}`);
    log(host.ads.requestInterstitial('level_complete'));
    log(host.ads.requestInterstitial('level_complete'));
    host.ads.registerShown('level_complete');
    log(host.ads.requestInterstitial('level_fail'));
    host.player.now += 60 * SEC;
    log(host.ads.requestInterstitial('level_fail'));
    host.ads.registerShown('hint_rewarded');
    log(host.ads.requestInterstitial('level_complete'));
    log(host.ads.requestRewarded('continue_rewarded'));
    host.player.noAds = true;
    log(host.ads.requestInterstitial('level_complete'));
    log(host.ads.requestRewarded('hint_rewarded'));
    return out;
  };
  const a = makeAds({ level: 10 }, { policy });
  const storeB = new MemoryAdsStateStore(a.state.snapshot());
  const b = makeAds({ level: 10 }, { policy, state: storeB });
  expect(script(a)).toEqual(script(b));
  expect(a.state.snapshot()).toEqual(storeB.snapshot());
  expect(a.log()).toEqual(b.log());
  const strip = (s: AdsRuntimeStats) => ({ ...s, session: { ...s.session, startedAt: 0 } });
  expect(strip(a.ads.getStats())).toEqual(strip(b.ads.getStats()));
  // a placement without a cadence answers the same thing however often it is asked; a decision writes no state
  const c = simple();
  const before = JSON.stringify(c.state.snapshot());
  const answers = new Set([1, 2, 3, 4, 5].map(() => JSON.stringify(c.ads.requestInterstitial('level_fail'))));
  expect(answers.size).toBe(1);
  expect(JSON.stringify(c.state.snapshot())).toBe(before);
  // a third runtime over the persisted state alone (a reload) sees the same cooldown
  const reloaded = makeAds({ level: 10 }, { policy, state: new MemoryAdsStateStore(a.state.snapshot()) });
  reloaded.player.now = a.player.now;
  reloaded.player.noAds = true;
  expect(brief(reloaded.ads.requestRewarded('hint_rewarded'))).toBe('ok');
  reloaded.player.noAds = false;
  expect(brief(reloaded.ads.requestInterstitial('level_fail'))).toBe('reward_cooldown@policy');
});

// ---------------------------------------------------------------- the constructor

test('the constructor takes a config OR a policy, validates it, and wraps a bare config by reference', () => {
  const config = donorConfig();
  const legacy = makeAds({ level: 30 }, { config });
  expect(legacy.ads.getPolicy()).toEqual(adsPolicyFromConfig(config));
  expect(legacy.ads.getPolicy().segmentation).toBe(config);
  expect(legacy.ads.requestInterstitial('level_win_inter')).toMatchObject({ allowed: true, policy: { name: 'legacy-config', version: 0 } });
  const base = { state: new MemoryAdsStateStore(), input: legacy.ads['input' as never] as never };
  expect(() => new AdsRuntime({ ...base, config, policy: TRAIL_ARROW_AD_POLICY_V1 as AdsPolicy })).toThrow(/not both/);
  expect(() => new AdsRuntime({ ...base })).toThrow(/config or options\.policy/);
  expect(() => new AdsRuntime({ ...base, policy: { ...SIMPLE, session: { maxInterstitials: -1, blockWhileAdInFlight: false } } })).toThrow(RangeError);
  expect(() => new AdsRuntime({ ...base, policy: { ...SIMPLE, segmentation: { segments: {}, placements: {} } } })).toThrow(RangeError);
});

// ---------------------------------------------------------------- TRAIL_ARROW_AD_POLICY_V1 ≡ AdsRuntime v0.7

test('TRAIL_ARROW_AD_POLICY_V1 decides exactly like the bare donor tables: one long scripted life, decision by decision', () => {
  const preset = makeAds({ level: 1 }, { policy: TRAIL_ARROW_AD_POLICY_V1 as AdsPolicy });
  const legacy = makeAds({ level: 1 }, { config: donorConfig() });
  const hosts = [preset, legacy];
  const ask = (placement: string, expect?: 'inter' | 'rewarded' | 'banner') =>
    hosts.map((h) => {
      const d = h.ads.evaluate(placement, expect);
      return `${placement}:${d.allowed ? 'ok' : d.reason}:${d.segmentId}`;
    });
  const show = (placement: string) => hosts.forEach((h) => h.ads.registerShown(placement));
  const set = (patch: Partial<Player>) => hosts.forEach((h) => Object.assign(h.player, patch));
  const tick = (ms: number) => hosts.forEach((h) => { h.player.now += ms; });
  const compared: string[] = [];
  const same = (pair: string[]) => {
    expect(pair[0]).toBe(pair[1]);
    compared.push(pair[0]!);
  };
  const everything = () => {
    for (const p of INTERS) same(ask(p));
    for (const p of REWARDED) same(ask(p));
    same(ask('banner'));
    same(ask('nope'));
    same(ask('level_win_inter', 'rewarded'));
    same(ask('ad_hint_booster_rewarded', 'inter'));
    same(ask('banner', 'inter'));
  };
  // the non-payer life: every segment boundary, wins / fails / exits with real cooldown steps, rewarded limits, calendar turns
  for (const level of [1, 14, 15, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100, 119, 120, 500]) {
    set({ level });
    everything();
    same(ask('level_win_inter'));
    show('level_win_inter');
    same(ask('level_fail_inter'));
    tick(45 * SEC);
    same(ask('level_fail_inter'));
    tick(15 * SEC);
    same(ask('level_fail_inter'));
    tick(30 * SEC);
    same(ask('level_exit_inter'));
    tick(50 * SEC);
    same(ask('level_exit_inter'));
    tick(100 * SEC);
    same(ask('level_exit_inter'));
    tick(60 * SEC);
    same(ask('level_exit_inter'));
    for (let i = 0; i < 6; i++) {
      same(ask('ad_hint_booster_rewarded'));
      same(ask('ad_extra_moves_rewarded'));
      same(ask('ad_level_win_x2_rewarded'));
      show('ad_extra_moves_rewarded');
    }
    show('ad_level_win_x2_rewarded');
    same(ask('level_win_inter'));
    tick(31 * SEC);
    same(ask('level_win_inter'));
    tick(30 * SEC);
    same(ask('level_win_inter'));
    tick(HOUR);
    everything();
    tick(DAY);
    everything();
  }
  // the payer life: the sticky mark, then every pay_* threshold, NO_ADS, the starter pack, a USD platform
  set({ level: 50 });
  hosts.forEach((h) => h.ads.markPayer());
  everything();
  for (const [avg, max] of [[0, 0], [52.99, 58], [53, 174], [101, 232], [160, 406], [293, 0], [10, 5000]] as Array<[number, number]>) {
    hosts.forEach((h) => h.setPayments(avg, max));
    everything();
    show('level_win_inter');
    tick(299 * SEC);
    same(ask('level_fail_inter'));
    tick(SEC);
    same(ask('level_fail_inter'));
    show('ad_hint_booster_rewarded');
    same(ask('ad_hint_booster_rewarded'));
    tick(DAY);
  }
  set({ noAds: true });
  everything();
  set({ noAds: false, starterPack: true, usd: true });
  hosts.forEach((h) => h.setPayments(1.5, 2.5));
  everything();
  set({ level: 0, starterPack: false, usd: false, payCount: 0, paySumCents: 0, payMaxCents: 0 });
  hosts.forEach((h) => h.state.set('payer', 0));
  everything();
  // every event, every counter and every persisted byte agree; the only difference is the policy's name
  expect(preset.log()).toEqual(legacy.log());
  expect(preset.events).toEqual(legacy.events);
  expect(preset.state.snapshot()).toEqual(legacy.state.snapshot());
  const strip = ({ policy: _policy, ...rest }: AdsRuntimeStats) => rest;
  expect(strip(preset.ads.getStats())).toEqual(strip(legacy.ads.getStats()));
  expect(preset.ads.getStats().policy).toEqual({ name: 'trail_arrow', version: 1 });
  expect(legacy.ads.getStats().policy).toEqual({ name: 'legacy-config', version: 0 });
  expect(compared.length).toBeGreaterThan(900);
  // the script exercised the reasons the tables can produce (hour_limit / segment_disabled / no_segment need edited tables — runtime.test.ts covers them)
  expect(new Set(compared.map((c) => c.split(':')[1]))).toEqual(new Set(['ok', 'no_ads', 'unknown_placement', 'wrong_type', 'no_rule', 'below_start_level', 'day_limit', 'inter_cooldown', 'reward_cooldown']));
  // the six policy reasons never fire from the preset: its gates are all neutral
  const fired = Object.entries(preset.ads.getStats().denyByReason).filter(([, n]) => n > 0).map(([r]) => r);
  for (const policyOnly of ['disabled', 'placement_disabled', 'ad_in_flight', 'first_show_delay', 'session_limit', 'cadence']) expect(fired).not.toContain(policyOnly);
});
