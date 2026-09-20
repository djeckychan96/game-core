// The scenarios of ADS_RUNTIME_EXTRACTION_MAP §7, by their numbers (A 1–10, B 11–20, C 21–25,
// D 26–32, E 33–38, F 39–42). Everything runs on the REAL donor tables (tests/ads/fixtures/*.tsv).
import { expect, test, vi } from 'vitest';
import { AdsRuntime, MemoryAdsStateStore } from '../../src/ads';
import type { AdsDenyReason, AdsStateStore } from '../../src/ads';
import { DAY, HOUR, INTERS, MIN, REWARDED, SEC, T0, donorConfig, makeAds, noCooldownConfig } from './fixtures';

const reasonOf = (host: ReturnType<typeof makeAds>, placement: string, expect?: 'inter' | 'rewarded' | 'banner') =>
  host.ads.decide(placement, expect).reason;

// ---------------------------------------------------------------- A. segment selection

test('A1–A2: a non-payer is segmented by level — every boundary of np_1 … deep_np', () => {
  const host = makeAds();
  const expected: Array<[number, string]> = [
    [1, 'np_1'], [19, 'np_1'], [20, 'np_2'], [39, 'np_2'], [40, 'np_3'], [59, 'np_3'], [60, 'np_4'], [79, 'np_4'],
    [80, 'np_5'], [99, 'np_5'], [100, 'np_6'], [119, 'np_6'], [120, 'deep_np'], [9999, 'deep_np']
  ];
  for (const [level, segment] of expected) {
    host.player.level = level;
    expect(host.ads.segmentId(), `L${level}`).toBe(segment);
  }
});

test('A3: NO_ADS alone makes a payer; with no recorded payment it is pay_1 (avg 0 / max 0)', () => {
  const host = makeAds({ level: 50, noAds: true });
  expect(host.ads.segmentId()).toBe('pay_1');
  expect(host.ads.getStats().payer).toBe(true);
});

test('A4–A6: payers are segmented by average and largest payment — the donor seg.mts cases', () => {
  const host = makeAds({ level: 50 });
  host.setPayments(100, 200);
  expect(host.ads.segmentId()).toBe('pay_4');
  host.setPayments(300, 10);
  expect(host.ads.segmentId()).toBe('pay_10');
  host.setPayments(150, 250);
  expect(host.ads.segmentId()).toBe('pay_7');
});

test('payer segmentation: every avg / max threshold of pay_1 … pay_10, and the level is ignored', () => {
  const host = makeAds();
  const table: Array<[number, number, string]> = [
    [0, 0, 'pay_1'], [52.99, 57.99, 'pay_1'], [52.99, 58, 'pay_2'], [10, 5000, 'pay_2'],
    [53, 173.99, 'pay_3'], [100.99, 173.99, 'pay_3'], [53, 174, 'pay_4'], [100.99, 9999, 'pay_4'],
    [101, 173.99, 'pay_5'], [159.99, 0, 'pay_5'], [101, 174, 'pay_6'], [159.99, 231.99, 'pay_6'], [101, 232, 'pay_7'], [159.99, 9999, 'pay_7'],
    [160, 405.99, 'pay_8'], [292.99, 0, 'pay_8'], [160, 406, 'pay_9'], [292.99, 9999, 'pay_9'],
    [293, 0, 'pay_10'], [100000, 100000, 'pay_10']
  ];
  for (const level of [1, 19, 500]) {
    host.player.level = level;
    for (const [avg, max, segment] of table) {
      host.setPayments(avg, max);
      expect(host.ads.segmentId(), `L${level} avg ${avg} max ${max}`).toBe(segment);
    }
  }
  // the average is sum / count: three payments of 29 + 99 + 499 ₽ → avg 209, max 499 → pay_9
  const real = makeAds({ level: 30 });
  for (const amount of [29, 99, 499]) real.pay(amount);
  expect(real.ads.segmentId()).toBe('pay_9');
});

test('A7: a USD platform scales the rouble thresholds by currencyScale (1/85)', () => {
  const host = makeAds({ level: 50, usd: true });
  host.setPayments(1.5, 2.5); // = 127.5 ₽ / 212.5 ₽
  expect(host.ads.segmentId()).toBe('pay_6');
  // exactly on the scaled thresholds: 101/85 and 174/85 dollars
  host.player.payCount = 1;
  host.player.paySumCents = 101 / 85 * 100;
  host.player.payMaxCents = 174 / 85 * 100;
  expect(host.ads.segmentId()).toBe('pay_6');
  host.setPayments(0.99, 0.99); // one $0.99 pack = 84 ₽ → avg 53–101, max < 174
  expect(host.ads.segmentId()).toBe('pay_3');
  host.player.usd = false; // the same numbers read as roubles
  expect(host.ads.segmentId()).toBe('pay_1');
});

test('A8: the starter pack alone (input.isPayer) puts the player into the payer branch', () => {
  const host = makeAds({ level: 50, starterPack: true });
  expect(host.ads.segmentId()).toBe('pay_1');
  host.player.starterPack = false;
  expect(host.ads.segmentId()).toBe('np_3');
});

test('A9: payer mark semantics — sticky, idempotent, survives a reload, needs no payment data', () => {
  const host = makeAds({ level: 50 });
  expect(host.ads.segmentId()).toBe('np_3');
  host.ads.markPayer();
  host.ads.markPayer();
  expect(host.state.get('payer')).toBe(1);
  expect(host.ads.segmentId()).toBe('pay_1');
  // a new runtime over the persisted state, the profile still says nothing
  const reloaded = makeAds({ level: 50 }, { state: new MemoryAdsStateStore(host.state.snapshot()) });
  expect(reloaded.ads.segmentId()).toBe('pay_1');
  // markPayer writes ONLY the flag (donor: readStats → payer = true → writeStats)
  expect(host.state.snapshot()).toEqual({ values: { dayStamp: 0, hourStamp: 0, payer: 1, lastInterAt: 0, lastRewardAt: 0 }, counts: {} });
});

test('A10: level 0 / negative falls into `default` — NO ADS intentionally: every placement is denied', () => {
  for (const level of [0, -5]) {
    const host = makeAds({ level });
    expect(host.ads.segmentId()).toBe('default');
    for (const placement of INTERS) expect(host.ads.canShowInter(placement)).toBe(false);
    for (const placement of REWARDED) expect(host.ads.canShowRewarded(placement)).toBe(false);
    expect(host.ads.canShowBanner()).toBe(false);
  }
  // a config without `default` → no segment at all
  const config = donorConfig();
  delete config.segments['default'];
  const host = makeAds({ level: 0 }, { config });
  expect(host.ads.segmentId()).toBeNull();
  expect(reasonOf(host, 'level_win_inter')).toBe('no_segment');
  expect(reasonOf(host, 'ad_refill_hearts_rewarded')).toBe('no_segment');
  expect(reasonOf(host, 'banner')).toBe('no_segment');
});

// ---------------------------------------------------------------- B. placement gating

test('B11–B13: exact start-level gates — L15 for np_1, L20 for everybody else; np_1 L15–19 is the only sub-L20 window', () => {
  const host = makeAds({ level: 14 });
  for (const placement of [...INTERS, ...REWARDED]) expect(reasonOf(host, placement), placement).toBe('below_start_level');
  host.player.level = 15;
  for (const placement of INTERS) expect(host.ads.canShowInter(placement), placement).toBe(true);
  for (const placement of REWARDED) expect(host.ads.canShowRewarded(placement), placement).toBe(true);
  host.player.level = 20;
  expect(host.ads.decide('level_win_inter')).toEqual({ allowed: true, reason: null, segmentId: 'np_2' });
  // payers start at L20 whatever their level
  const payer = makeAds({ level: 19 });
  payer.setPayments(100, 200);
  expect(payer.ads.decide('level_win_inter')).toEqual({ allowed: false, reason: 'below_start_level', segmentId: 'pay_4' });
  expect(reasonOf(payer, 'ad_refill_hearts_rewarded')).toBe('below_start_level');
  payer.player.level = 20;
  expect(payer.ads.canShowInter('level_win_inter')).toBe(true);
  expect(payer.ads.canShowRewarded('ad_refill_hearts_rewarded')).toBe(true);
});

test('B14: NO_ADS blocks interstitials and the banner — and does NOT block rewarded', () => {
  const host = makeAds({ level: 50, noAds: true });
  for (const placement of INTERS) expect(host.ads.decide(placement), placement).toEqual({ allowed: false, reason: 'no_ads', segmentId: 'pay_1' });
  expect(host.ads.canShowBanner()).toBe(false);
  expect(reasonOf(host, 'banner')).toBe('no_ads');
  for (const placement of REWARDED) expect(host.ads.canShowRewarded(placement), placement).toBe(true);
});

test('B15–B17: an unknown placement and a placement of the wrong type', () => {
  const host = makeAds({ level: 50 });
  expect(reasonOf(host, 'no_such_placement')).toBe('unknown_placement');
  expect(host.ads.canShowInter('no_such_placement')).toBe(false);
  expect(host.ads.canShowRewarded('no_such_placement')).toBe(false);
  expect(host.ads.canShowInter('toString')).toBe(false); // never an Object.prototype hit
  expect(host.ads.canShowInter('ad_level_win_x2_rewarded')).toBe(false);
  expect(reasonOf(host, 'ad_level_win_x2_rewarded', 'inter')).toBe('wrong_type');
  expect(host.ads.canShowRewarded('level_win_inter')).toBe(false);
  expect(reasonOf(host, 'level_win_inter', 'rewarded')).toBe('wrong_type');
  expect(reasonOf(host, 'banner', 'inter')).toBe('wrong_type');
  // without `expect` the placement's own type picks the check
  expect(host.ads.decide('ad_level_win_x2_rewarded').allowed).toBe(true);
});

test('B18: the `default` segment has no rules — every placement answers no_rule', () => {
  const host = makeAds({ level: 0 });
  for (const placement of [...INTERS, ...REWARDED, 'banner']) expect(reasonOf(host, placement), placement).toBe('no_rule');
});

test('B19: disableInter closes the interstitials of a segment, nothing else', () => {
  const config = donorConfig();
  config.segments['np_3']!.disableInter = true;
  const host = makeAds({ level: 50 }, { config });
  expect(reasonOf(host, 'level_win_inter')).toBe('segment_disabled');
  expect(host.ads.canShowRewarded('ad_refill_hearts_rewarded')).toBe(true);
  expect(host.ads.canShowBanner()).toBe(true);
});

test('B20: banner availability — np_1 from L15, the others from L20, payers never (no row), no counters, no cooldowns (B8)', () => {
  const host = makeAds({ level: 14 });
  expect(reasonOf(host, 'banner')).toBe('below_start_level');
  host.player.level = 15;
  expect(host.ads.canShowBanner()).toBe(true);
  host.player.level = 120;
  expect(host.ads.canShowBanner()).toBe(true);
  // 1:1 donor; see B8 — the banner's day / hour limits are dead data: counts and cooldowns never bind
  host.state.set('dayStamp', host.ads.getStats().dayStamp);
  host.state.set('hourStamp', host.ads.getStats().hourStamp);
  host.state.setCount('banner', { day: 99999, hour: 99999 });
  host.ads.registerShown('level_win_inter');
  host.ads.registerShown('ad_refill_hearts_rewarded');
  expect(host.ads.canShowBanner()).toBe(true);
  host.setPayments(10, 10);
  expect(host.ads.decide('banner')).toEqual({ allowed: false, reason: 'no_rule', segmentId: 'pay_1' });
});

// ---------------------------------------------------------------- C. limits

test('C21–C23: np_1 rewarded day limits — hint 1, extra moves 3, x2 5', () => {
  const limits: Array<[string, number]> = [['ad_hint_booster_rewarded', 1], ['ad_extra_moves_rewarded', 3], ['ad_level_win_x2_rewarded', 5]];
  for (const [placement, limit] of limits) {
    const host = makeAds({ level: 15 });
    for (let i = 0; i < limit; i++) {
      expect(host.ads.canShowRewarded(placement), `${placement} #${i + 1}`).toBe(true);
      host.ads.registerShown(placement);
    }
    expect(reasonOf(host, placement), `${placement} #${limit + 1}`).toBe('day_limit');
    // limits are per placement: the others are untouched
    expect(host.ads.canShowRewarded('ad_refill_hearts_rewarded')).toBe(true);
  }
  // payers: 1 / 2 / 3 a day at any level (REVIEW 15.09 №17 — a data decision)
  const payer = makeAds({ level: 100 });
  payer.setPayments(100, 200);
  for (let i = 0; i < 3; i++) payer.ads.registerShown('ad_level_win_x2_rewarded');
  expect(reasonOf(payer, 'ad_level_win_x2_rewarded')).toBe('day_limit');
});

test('C24: refill hearts is 10000 a day / 500 an hour — the hour cap bites first, and the next hour reopens it', () => {
  const host = makeAds({ level: 15 });
  for (let i = 0; i < 499; i++) host.ads.registerShown('ad_refill_hearts_rewarded');
  expect(host.ads.canShowRewarded('ad_refill_hearts_rewarded')).toBe(true); // the 500th is still allowed
  host.ads.registerShown('ad_refill_hearts_rewarded');
  expect(reasonOf(host, 'ad_refill_hearts_rewarded')).toBe('hour_limit');
  host.player.now += HOUR;
  expect(host.ads.canShowRewarded('ad_refill_hearts_rewarded')).toBe(true);
});

test('C25: interstitials — 500 shows in an hour, the 501st is hour_limit (cooldowns stubbed out)', () => {
  const host = makeAds({ level: 20 }, { config: noCooldownConfig() });
  for (let i = 0; i < 500; i++) {
    expect(host.ads.canShowInter('level_win_inter')).toBe(true);
    host.ads.registerShown('level_win_inter');
  }
  expect(reasonOf(host, 'level_win_inter')).toBe('hour_limit');
  expect(host.ads.canShowInter('level_fail_inter')).toBe(true); // counts are per placement
});

// ---------------------------------------------------------------- D. cooldowns

test('D26–D28: delayBetweenInters to the second — np_1 240 s, np_5 60 s, pay_3 300 s', () => {
  const cases: Array<[string, () => ReturnType<typeof makeAds>, number]> = [
    ['np_1', () => makeAds({ level: 15 }), 240],
    ['np_5', () => makeAds({ level: 80 }), 60],
    ['pay_3', () => { const h = makeAds({ level: 50 }); h.setPayments(60, 60); return h; }, 300]
  ];
  for (const [segment, make, delay] of cases) {
    const host = make();
    expect(host.ads.segmentId()).toBe(segment);
    expect(host.ads.canShowInter('level_win_inter')).toBe(true);
    host.ads.registerShown('level_win_inter');
    host.player.now = T0 + (delay - 1) * SEC;
    expect(reasonOf(host, 'level_win_inter'), `${segment} at ${delay - 1} s`).toBe('inter_cooldown');
    host.player.now = T0 + delay * SEC;
    expect(host.ads.canShowInter('level_win_inter'), `${segment} at ${delay} s`).toBe(true);
  }
});

test('D29–D30: delayAfterReward keeps an interstitial away after ANY rewarded — np_1 60 s, np_4 30 s', () => {
  for (const [level, delay] of [[15, 60], [60, 30]] as const) {
    const host = makeAds({ level });
    host.ads.registerShown('ad_refill_hearts_rewarded');
    host.player.now = T0 + (delay - 1) * SEC;
    for (const placement of INTERS) expect(reasonOf(host, placement), `L${level} ${placement}`).toBe('reward_cooldown');
    host.player.now = T0 + delay * SEC;
    expect(host.ads.canShowInter('level_win_inter')).toBe(true);
  }
});

test('D31: cooldowns are global across placements — one interstitial blocks the other two', () => {
  const host = makeAds({ level: 20 });
  host.ads.registerShown('level_win_inter');
  host.player.now += 179 * SEC;
  for (const placement of INTERS) expect(reasonOf(host, placement), placement).toBe('inter_cooldown');
  host.player.now += 1 * SEC;
  for (const placement of INTERS) expect(host.ads.canShowInter(placement), placement).toBe(true);
});

test('D32: both cooldowns pending → inter_cooldown wins (the donor checks it first)', () => {
  const host = makeAds({ level: 15 });
  host.ads.registerShown('level_win_inter');
  host.ads.registerShown('ad_refill_hearts_rewarded');
  host.player.now += 30 * SEC;
  expect(reasonOf(host, 'level_fail_inter')).toBe('inter_cooldown');
  host.player.now = T0 + 240 * SEC; // the inter cooldown is over, the reward one (60 s) long gone
  expect(host.ads.canShowInter('level_fail_inter')).toBe(true);
});

test('rewarded uses NO cooldowns: right after an interstitial and right after another rewarded it is still offered', () => {
  const host = makeAds({ level: 15 });
  host.ads.registerShown('level_win_inter');
  host.ads.registerShown('ad_extra_moves_rewarded');
  expect(host.ads.canShowRewarded('ad_extra_moves_rewarded')).toBe(true);
  expect(host.ads.canShowRewarded('ad_level_win_x2_rewarded')).toBe(true);
  expect(reasonOf(host, 'level_win_inter')).toBe('inter_cooldown');
});

test('decision priority is the donor\'s: no_ads → placement → type → segment → disabled → rule → start level → day → hour → inter cooldown → reward cooldown', () => {
  const config = donorConfig();
  config.segments['pay_1']!.disableInter = true;
  config.placements['level_win_inter']!.bySegment['pay_1'] = { startFromLevel: 20, dayLimit: 1, hourLimit: 1 };
  delete config.segments['default'];
  const host = makeAds({ level: 10, noAds: true }, { config });
  const inter = () => reasonOf(host, 'level_win_inter', 'inter');
  const peel: Array<[AdsDenyReason, () => void]> = [
    ['no_ads', () => { host.player.noAds = false; host.ads.markPayer(); }],
    ['segment_disabled', () => { config.segments['pay_1']!.disableInter = false; }],
    ['below_start_level', () => { host.player.level = 20; }],
    ['day_limit', () => { host.state.setCount('level_win_inter', { day: 0, hour: 5 }); }],
    ['hour_limit', () => { host.state.setCount('level_win_inter', { day: 0, hour: 0 }); }],
    ['inter_cooldown', () => { host.state.set('lastInterAt', 0); }],
    ['reward_cooldown', () => { host.state.set('lastRewardAt', 0); }]
  ];
  // everything is wrong at once: a show in this very hour left both counts over the limit and both cooldowns armed
  host.ads.registerShown('level_win_inter');
  host.ads.registerShown('ad_refill_hearts_rewarded');
  host.state.setCount('level_win_inter', { day: 5, hour: 5 });
  // NO_ADS outranks even an unknown placement and a wrong type on the inter path
  expect(reasonOf(host, 'nope', 'inter')).toBe('no_ads');
  expect(reasonOf(host, 'ad_refill_hearts_rewarded', 'inter')).toBe('no_ads');
  for (const [reason, fix] of peel) {
    expect(inter(), `expected ${reason}`).toBe(reason);
    fix();
  }
  expect(inter()).toBeNull();
  // placement / type outrank the segment checks
  host.player.level = 0;
  host.state.set('payer', 0);
  expect(host.ads.segmentId()).toBeNull();
  expect(reasonOf(host, 'nope', 'inter')).toBe('unknown_placement');
  expect(reasonOf(host, 'banner', 'inter')).toBe('wrong_type');
  expect(inter()).toBe('no_segment');
  // no rule outranks the start level; rewarded: day before hour, and never a NO_ADS / cooldown reason
  const np = makeAds({ level: 14 });
  np.setPayments(10, 10);
  expect(reasonOf(np, 'banner')).toBe('no_rule');
  const rewarded = makeAds({ level: 15, noAds: false });
  rewarded.ads.registerShown('ad_hint_booster_rewarded');
  expect(reasonOf(rewarded, 'ad_hint_booster_rewarded')).toBe('day_limit');
  rewarded.player.now += HOUR; // the hour bucket is fresh, the day one is not
  expect(reasonOf(rewarded, 'ad_hint_booster_rewarded')).toBe('day_limit');
});

// ---------------------------------------------------------------- E. counter reset

test('E33: a new calendar day wipes every count — rewarded is available again', () => {
  const host = makeAds({ level: 15 });
  host.ads.registerShown('ad_hint_booster_rewarded');
  for (let i = 0; i < 3; i++) host.ads.registerShown('ad_extra_moves_rewarded');
  expect(reasonOf(host, 'ad_hint_booster_rewarded')).toBe('day_limit');
  host.player.now = T0 + 14 * HOUR; // 00:00 of the next UTC day
  expect(host.ads.canShowRewarded('ad_hint_booster_rewarded')).toBe(true);
  expect(host.ads.canShowRewarded('ad_extra_moves_rewarded')).toBe(true);
  expect(host.ads.getStats().counts).toEqual({ ad_hint_booster_rewarded: { day: 0, hour: 0 }, ad_extra_moves_rewarded: { day: 0, hour: 0 } });
  // a decision never writes: the stale counts are still in the store until the next confirmed show
  expect(host.state.getCount('ad_extra_moves_rewarded')).toEqual({ day: 3, hour: 3 });
  host.ads.registerShown('ad_extra_moves_rewarded');
  expect(host.state.snapshot().counts).toEqual({ ad_hint_booster_rewarded: { day: 0, hour: 0 }, ad_extra_moves_rewarded: { day: 1, hour: 1 } });
});

test('E34: a new hour of the same day zeroes the hour part only — the day limit still binds', () => {
  const config = donorConfig();
  config.placements['ad_extra_moves_rewarded']!.bySegment['np_1'] = { startFromLevel: 15, dayLimit: 4, hourLimit: 2 };
  const host = makeAds({ level: 15 }, { config });
  host.ads.registerShown('ad_extra_moves_rewarded');
  host.ads.registerShown('ad_extra_moves_rewarded');
  expect(reasonOf(host, 'ad_extra_moves_rewarded')).toBe('hour_limit');
  host.player.now += HOUR;
  expect(host.ads.getStats().counts['ad_extra_moves_rewarded']).toEqual({ day: 2, hour: 0 });
  host.ads.registerShown('ad_extra_moves_rewarded');
  host.ads.registerShown('ad_extra_moves_rewarded');
  expect(host.state.getCount('ad_extra_moves_rewarded')).toEqual({ day: 4, hour: 2 });
  host.player.now += HOUR;
  expect(reasonOf(host, 'ad_extra_moves_rewarded')).toBe('day_limit');
});

test('E35 — 1:1 donor; see B1: the hour bucket is the CALENDAR hour, so 10:59 → 11:00 refreshes the limit two minutes later', () => {
  const config = donorConfig();
  config.placements['ad_extra_moves_rewarded']!.bySegment['np_1'] = { startFromLevel: 15, dayLimit: 100, hourLimit: 3 };
  const host = makeAds({ level: 15, now: T0 + 59 * MIN }, { config }); // 10:59
  for (let i = 0; i < 3; i++) host.ads.registerShown('ad_extra_moves_rewarded');
  expect(reasonOf(host, 'ad_extra_moves_rewarded')).toBe('hour_limit');
  host.player.now = T0 + 61 * MIN; // 11:01 — not a rolling 60 minutes
  expect(host.ads.canShowRewarded('ad_extra_moves_rewarded')).toBe(true);
});

test('the day / hour buckets follow the host\'s LOCAL calendar (donor: the device calendar), UTC without an offset', () => {
  const at = (h: number, m: number) => Date.UTC(2026, 8, 17, h, m, 0);
  const moscow = makeAds({ level: 15, now: at(20, 59), tzOffsetMin: -180 }); // 23:59 local
  moscow.ads.registerShown('ad_hint_booster_rewarded');
  expect(reasonOf(moscow, 'ad_hint_booster_rewarded')).toBe('day_limit');
  moscow.player.now = at(21, 0); // local midnight
  expect(moscow.ads.canShowRewarded('ad_hint_booster_rewarded')).toBe(true);
  const utc = makeAds({ level: 15, now: at(20, 59) });
  utc.ads.registerShown('ad_hint_booster_rewarded');
  utc.player.now = at(21, 0);
  expect(reasonOf(utc, 'ad_hint_booster_rewarded')).toBe('day_limit');
  utc.player.now = at(24, 0);
  expect(utc.ads.canShowRewarded('ad_hint_booster_rewarded')).toBe(true);
  // a half-hour zone (UTC+5:30): the hour turns at :30 UTC
  const india = makeAds({ level: 15, now: at(10, 29), tzOffsetMin: -330 });
  const hourBefore = india.ads.getStats().hourStamp;
  india.player.now = at(10, 30);
  expect(india.ads.getStats().hourStamp).toBe(hourBefore + 1);
});

test('E36: broken stored data reads as defaults and never throws', () => {
  for (const garbage of [null, 'corrupt', 42, [], { values: 'x', counts: 7 }, { values: { dayStamp: 'NaN', payer: {} }, counts: { a: null, b: { day: 'x', hour: NaN } } }]) {
    const store = new MemoryAdsStateStore(garbage);
    expect(store.get('payer')).toBe(0);
    expect(store.getCount('b')).toEqual({ day: 0, hour: 0 });
  }
  // a host store that hands back garbage
  const junk = { get: () => NaN, set: () => undefined, getCount: () => ({ day: 'x', hour: undefined }), setCount: () => undefined, listCounts: () => [] } as unknown as AdsStateStore;
  const host = makeAds({ level: 15 }, { state: junk });
  expect(host.ads.canShowInter('level_win_inter')).toBe(true);
  expect(host.ads.canShowRewarded('ad_hint_booster_rewarded')).toBe(true);
  expect(() => host.ads.registerShown('ad_hint_booster_rewarded')).not.toThrow();
});

test('E37 — 1:1 donor; see B2: a store that throws never breaks the game, and the limits stop binding', () => {
  const broken: AdsStateStore = {
    get: () => { throw new Error('SecurityError'); },
    set: () => { throw new Error('QuotaExceededError'); },
    getCount: () => { throw new Error('SecurityError'); },
    setCount: () => { throw new Error('QuotaExceededError'); },
    listCounts: () => { throw new Error('SecurityError'); }
  };
  const host = makeAds({ level: 15 }, { state: broken });
  for (let i = 0; i < 5; i++) {
    expect(host.ads.canShowRewarded('ad_hint_booster_rewarded')).toBe(true); // the limit is 1 a day
    expect(() => host.ads.registerShown('ad_hint_booster_rewarded')).not.toThrow();
  }
  expect(() => host.ads.markPayer()).not.toThrow();
  expect(host.ads.canShowInter('level_win_inter')).toBe(true); // no cooldown either
  expect(host.ads.segmentId()).toBe('np_1');
  expect(host.ads.getStats()).toMatchObject({ shown: 5, counts: {}, lastInterAt: 0 });
  expect(host.ads.getStats().storeErrors).toBeGreaterThan(0);
  expect(host.events.filter((e) => e.type === 'shown').map((e) => e.type === 'shown' && e.day)).toEqual([1, 1, 1, 1, 1]);
});

test('E38 — 1:1 donor; see B7: a show of an unknown placement arms the after-reward cooldown (and a banner show does too)', () => {
  for (const placement of ['typo_placement', 'banner']) {
    const host = makeAds({ level: 15 });
    host.ads.registerShown(placement);
    expect(host.state.get('lastRewardAt')).toBe(T0);
    expect(host.state.get('lastInterAt')).toBe(0);
    expect(reasonOf(host, 'level_win_inter')).toBe('reward_cooldown');
    expect(host.state.getCount(placement)).toEqual({ day: 1, hour: 1 });
  }
});

// ---------------------------------------------------------------- F. events, stats, callbacks

test('F39–F41: one `offered` per allowed decision, one `denied` with its reason, `shown` with the counts after the increment', () => {
  const host = makeAds({ level: 15 });
  expect(host.ads.canShowInter('level_win_inter')).toBe(true);
  expect(host.ads.canShowRewarded('level_win_inter')).toBe(false);
  host.ads.registerShown('ad_extra_moves_rewarded');
  host.ads.registerShown('ad_extra_moves_rewarded');
  expect(host.events).toEqual([
    { type: 'offered', placement: 'level_win_inter', adType: 'inter', segmentId: 'np_1', level: 15 },
    { type: 'denied', placement: 'level_win_inter', adType: 'inter', reason: 'wrong_type', segmentId: 'np_1', level: 15 },
    { type: 'shown', placement: 'ad_extra_moves_rewarded', adType: 'rewarded', segmentId: 'np_1', level: 15, day: 1, hour: 1 },
    { type: 'shown', placement: 'ad_extra_moves_rewarded', adType: 'rewarded', segmentId: 'np_1', level: 15, day: 2, hour: 2 }
  ]);
  host.ads.decide('nope');
  expect(host.events.at(-1)).toEqual({ type: 'denied', placement: 'nope', adType: null, reason: 'unknown_placement', segmentId: 'np_1', level: 15 });
});

test('the polled banner decision is reported only when it changes; every call still counts', () => {
  const host = makeAds({ level: 14 });
  for (let poll = 0; poll < 5; poll++) host.ads.canShowBanner(); // the donor's host asks every 2 s
  host.player.level = 15;
  for (let poll = 0; poll < 5; poll++) host.ads.canShowBanner();
  host.player.noAds = true;
  for (let poll = 0; poll < 5; poll++) host.ads.canShowBanner();
  expect(host.log()).toEqual(['denied:banner:below_start_level', 'offered:banner', 'denied:banner:no_ads']);
  expect(host.ads.getStats()).toMatchObject({ offered: 5, denied: 10, events: 3 });
});

test('getStats: decisions, deny counts by reason, the segment, timestamps and the fresh counters', () => {
  const host = makeAds({ level: 15 });
  host.ads.canShowInter('level_win_inter');
  host.ads.registerShown('level_win_inter');
  host.ads.canShowInter('level_fail_inter');
  host.ads.canShowInter('nope');
  host.ads.registerShown('ad_hint_booster_rewarded');
  host.ads.canShowRewarded('ad_hint_booster_rewarded');
  const stats = host.ads.getStats();
  expect(stats).toMatchObject({
    segmentId: 'np_1', payer: false, level: 15, offered: 1, denied: 3, shown: 2,
    lastInterAt: T0, lastRewardAt: T0, dayStamp: Math.floor(T0 / DAY), hourStamp: Math.floor(T0 / HOUR),
    counts: { level_win_inter: { day: 1, hour: 1 }, ad_hint_booster_rewarded: { day: 1, hour: 1 } },
    events: 6, callbackErrors: 0, storeErrors: 0
  });
  expect(stats.denyByReason).toEqual({
    // Ads Policy V1: the six policy-gate reasons are part of the exhaustive record (never hit by the bare tables)
    disabled: 0, placement_disabled: 0, ad_in_flight: 0, first_show_delay: 0, session_limit: 0, cadence: 0,
    no_ads: 0, unknown_placement: 1, wrong_type: 0, no_segment: 0, segment_disabled: 0, no_rule: 0,
    below_start_level: 0, day_limit: 1, hour_limit: 0, inter_cooldown: 1, reward_cooldown: 0
  });
  expect(host.ads.update(16)).toBe(false); // nothing is paced by frame time
});

test('F42: a throwing onEvent is caught — decisions, state and counters are unaffected', () => {
  const onAdsError = vi.fn();
  const host = makeAds({ level: 15 }, {
    onEvent: () => {
      throw new Error('host handler bug');
    },
    onAdsError
  });
  expect(host.ads.canShowInter('level_win_inter')).toBe(true);
  expect(() => host.ads.registerShown('level_win_inter')).not.toThrow();
  expect(host.state.getCount('level_win_inter')).toEqual({ day: 1, hour: 1 });
  expect(host.state.get('lastInterAt')).toBe(T0);
  expect(host.ads.decide('level_win_inter').reason).toBe('inter_cooldown');
  expect(onAdsError).toHaveBeenCalledTimes(3);
  expect(onAdsError.mock.calls[1]![1]).toMatchObject({ phase: 'onEvent', event: { type: 'shown' } });
  expect(host.ads.getStats().callbackErrors).toBe(3);
  // a throwing error handler cannot take the runtime down either
  const worse = makeAds({ level: 15 }, {
    onEvent: () => { throw new Error('a'); },
    onAdsError: () => { throw new Error('b'); }
  });
  expect(worse.ads.canShowInter('level_win_inter')).toBe(true);
});

test('a decision never writes state; only registerShown and markPayer do', () => {
  const host = makeAds({ level: 15 });
  const before = JSON.stringify(host.state.snapshot());
  for (const placement of [...INTERS, ...REWARDED, 'banner', 'nope']) host.ads.decide(placement);
  host.ads.segmentId();
  host.ads.getStats();
  expect(JSON.stringify(host.state.snapshot())).toBe(before);
});

test('the constructor validates the config and needs a state and an input', () => {
  const ok = { config: donorConfig(), state: new MemoryAdsStateStore(), input: makeAds().ads['input' as never] };
  expect(() => new AdsRuntime({ ...ok, config: { segments: {}, placements: {} } })).toThrow(RangeError);
  expect(() => new AdsRuntime({ ...ok, state: undefined as never })).toThrow(RangeError);
  expect(() => new AdsRuntime({ ...ok, input: undefined as never })).toThrow(RangeError);
});
