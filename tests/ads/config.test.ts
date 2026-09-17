// ADS_RUNTIME_EXTRACTION_MAP §7 group G (45–48): the TSV parser and the validator, on the REAL donor tables.
import { expect, test } from 'vitest';
import { parseAdsTsv, validateAdsConfig } from '../../src/ads';
import type { AdsConfig } from '../../src/ads';
import { GENERATED_JSON, PLACEMENTS_TSV, SEGMENTS_TSV, donorConfig } from './fixtures';

/** The donor's generated config: the JSON fixture with `"Infinity"` back as a number (the generator's own trick). */
const generated = (): AdsConfig => JSON.parse(GENERATED_JSON, (_key, value) => (value === 'Infinity' ? Infinity : value));

test('G45: parseAdsTsv on the real donor TSVs reproduces adsConfig.generated.ts — 18 segments, 8 placements, key order, Infinity', () => {
  const parsed = donorConfig();
  const donor = generated();
  expect(parsed).toEqual(donor);
  // key order IS semantics (the first matching segment wins) — toEqual does not look at it
  expect(Object.keys(parsed.segments)).toEqual(Object.keys(donor.segments));
  expect(Object.keys(parsed.placements)).toEqual(Object.keys(donor.placements));
  for (const name of Object.keys(donor.placements)) {
    expect(Object.keys(parsed.placements[name]!.bySegment), name).toEqual(Object.keys(donor.placements[name]!.bySegment));
  }
  expect(Object.keys(parsed.segments)).toEqual([
    'np_1', 'np_2', 'np_3', 'np_4', 'np_5', 'np_6', 'deep_np',
    'pay_1', 'pay_2', 'pay_3', 'pay_4', 'pay_5', 'pay_6', 'pay_7', 'pay_8', 'pay_9', 'pay_10', 'default'
  ]);
  expect(Object.keys(parsed.placements)).toEqual([
    'level_win_inter', 'level_fail_inter', 'level_exit_inter', 'ad_hint_booster_rewarded', 'ad_extra_moves_rewarded',
    'ad_level_win_x2_rewarded', 'ad_refill_hearts_rewarded', 'banner'
  ]);
  // Infinity is a number, not a string and not null
  expect(parsed.segments['deep_np']!.levelTo).toBe(Infinity);
  expect(parsed.segments['pay_10']).toMatchObject({ avgFrom: 293, avgTo: Infinity, maxFrom: 0, maxTo: Infinity });
  expect(parsed.segments['np_1']).toEqual({
    payer: 'NON_PAYER', levelFrom: 1, levelTo: 20, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity,
    delayAfterReward: 60, delayBetweenInters: 240, disableInter: false
  });
  // 126 rule rows: 17 segments × 7 placements + 7 banner rows; `default` and the payers' banner have none
  const rows = Object.values(parsed.placements).reduce((sum, p) => sum + Object.keys(p.bySegment).length, 0);
  expect(rows).toBe(126);
  for (const placement of Object.values(parsed.placements)) expect(placement.bySegment['default']).toBeUndefined();
  expect(Object.keys(parsed.placements['banner']!.bySegment)).toEqual(['np_1', 'np_2', 'np_3', 'np_4', 'np_5', 'np_6', 'deep_np']);
  expect(() => validateAdsConfig(parsed)).not.toThrow();
});

test('G46: the placement type comes from its name; CRLF, a missing avg/max column and disableInter=TRUE parse like the generator', () => {
  const config = parseAdsTsv(
    'segment_id\tpayer\tlevelFrom\tlevelTo\tdelayAfterReward\tdelayBetweenInters\tdisableInter\r\nall\tNON_PAYER\t1\tInfinity\t30\t45\tTRUE\r\n',
    'segment_id\tplacement_name\tstart_from_level\tday_limit\thour_limit\nall\tbanner\t5\t1\t1\nall\tpause_inter\t5\t10\t2\nall\tdouble_coins\t5\tInfinity\t3\nall\tinter_bonus\t5\t1\t1\n'
  );
  expect(config.segments['all']).toEqual({
    payer: 'NON_PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity,
    delayAfterReward: 30, delayBetweenInters: 45, disableInter: true
  });
  expect(Object.fromEntries(Object.entries(config.placements).map(([name, p]) => [name, p.type]))).toEqual({
    banner: 'banner', pause_inter: 'inter', double_coins: 'rewarded', inter_bonus: 'rewarded' // only the `_inter` SUFFIX is an interstitial
  });
  expect(config.placements['double_coins']!.bySegment['all']).toEqual({ startFromLevel: 5, dayLimit: Infinity, hourLimit: 3 });
  // the real tables once more, through a Windows checkout
  expect(parseAdsTsv(SEGMENTS_TSV.replace(/\n/g, '\r\n'), PLACEMENTS_TSV.replace(/\n/g, '\r\n'))).toEqual(donorConfig());
});

test('G47: validateAdsConfig rejects what the runtime cannot decide with', () => {
  const broken: Array<[string, (config: AdsConfig) => void]> = [
    ['unknown segment', (c) => { c.placements['banner']!.bySegment['np_77'] = { startFromLevel: 1, dayLimit: 1, hourLimit: 1 }; }],
    ['levelFrom must be below levelTo', (c) => { c.segments['np_2']!.levelTo = 20; }],
    ['avgFrom must be below avgTo', (c) => { c.segments['pay_3']!.avgTo = 10; }],
    ['maxFrom must be below maxTo', (c) => { c.segments['pay_2']!.maxFrom = Infinity; }],
    ['delayBetweenInters', (c) => { c.segments['np_1']!.delayBetweenInters = -1; }],
    ['delayAfterReward', (c) => { c.segments['np_1']!.delayAfterReward = Infinity; }],
    ['levelFrom / levelTo must be numbers', (c) => { c.segments['np_1']!.levelFrom = Number('1O'); }], // a typo in a TSV cell
    ['unknown payer class', (c) => { (c.segments['np_1'] as { payer: string }).payer = 'WHALE'; }],
    ['disableInter', (c) => { (c.segments['np_1'] as { disableInter: unknown }).disableInter = 'FALSE'; }],
    ['unknown type', (c) => { (c.placements['banner'] as { type: string }).type = 'video'; }],
    ['dayLimit', (c) => { c.placements['banner']!.bySegment['np_1']!.dayLimit = NaN; }],
    ['startFromLevel', (c) => { c.placements['level_win_inter']!.bySegment['np_1']!.startFromLevel = -1; }],
    ['segments must not be empty', (c) => { c.segments = {}; c.placements = {}; }]
  ];
  for (const [message, breakIt] of broken) {
    const config = donorConfig();
    breakIt(config);
    expect(() => validateAdsConfig(config), message).toThrow(RangeError);
    expect(() => validateAdsConfig(config), message).toThrow(message);
  }
  expect(() => validateAdsConfig(undefined as never)).toThrow(RangeError);
});

test('G48: a segment with ZERO placement rows is a supported configuration — the donor\'s `default` means "no ads"', () => {
  const config = donorConfig();
  expect(Object.values(config.placements).some((p) => 'default' in p.bySegment)).toBe(false);
  expect(() => validateAdsConfig(config)).not.toThrow();
  // also valid: no placements at all, and no `default` segment
  expect(() => validateAdsConfig({ segments: { default: config.segments['default']! }, placements: {} })).not.toThrow();
  delete config.segments['default'];
  expect(() => validateAdsConfig(config)).not.toThrow();
});
