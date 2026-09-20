// Ads Policy V1 — the config layer: resolveAdsPolicy (nested merge, no mutation, deterministic),
// adsPolicyFromConfig, validateAdsPolicy, and TRAIL_ARROW_AD_POLICY_V1 parity with the verbatim donor TSVs.
import { expect, test } from 'vitest';
import {
  ADS_POLICY_NEUTRAL, TRAIL_ARROW_ADS_CONFIG_V1, TRAIL_ARROW_AD_POLICY_V1, adsPolicyFromConfig, freezeAdsPolicy, resolveAdsPolicy, validateAdsPolicy
} from '../../src/ads';
import type { AdsConfig, AdsPolicy, AdsPolicyOverrides } from '../../src/ads';
import { GENERATED_JSON, donorConfig } from './fixtures';

const simple = (): AdsPolicy => ({
  name: 'simple',
  version: 1,
  interstitial: {
    enabled: true, cooldownMs: 60_000, afterRewardedCooldownMs: 30_000, firstShowDelayMs: 0, minLevel: 1,
    placements: { level_complete: { enabled: true, cadence: { every: 3, first: 1 } }, level_fail: { enabled: true } }
  },
  rewarded: { enabled: true, minLevel: 1, placements: { hint_rewarded: { enabled: true }, continue_rewarded: { enabled: true, dayLimit: 2 } } },
  banner: { enabled: true, minLevel: 3, placements: { banner: { enabled: true } } },
  noAds: { blocksInterstitial: true, blocksBanner: true, blocksRewarded: false },
  session: { maxInterstitials: null, blockWhileAdInFlight: true },
  segmentation: null
});

const isDeepFrozen = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isDeepFrozen);
};

// ---------------------------------------------------------------- resolveAdsPolicy

test('an override patches in depth: the named knob changes, every sibling and every other placement stays', () => {
  const base = simple();
  const policy = resolveAdsPolicy(base, { interstitial: { cooldownMs: 120_000, placements: { level_fail: { enabled: false } } } });
  expect(policy.interstitial.cooldownMs).toBe(120_000);
  expect(policy.interstitial.afterRewardedCooldownMs).toBe(30_000);
  expect(policy.interstitial.placements).toEqual({ level_complete: { enabled: true, cadence: { every: 3, first: 1 } }, level_fail: { enabled: false } });
  expect(policy.rewarded).toEqual(base.rewarded);
  expect(policy.banner).toEqual(base.banner);
  expect(policy.noAds).toEqual(base.noAds);
  expect(policy.session).toEqual(base.session);
  expect(policy.name).toBe('simple');
});

test('a nested object merges key by key (a cadence keeps `first` when only `every` changes); a new placement can be added', () => {
  const policy = resolveAdsPolicy(simple(), {
    interstitial: { placements: { level_complete: { cadence: { every: 5 } }, return_to_map: { enabled: true, minLevel: 4 } } }
  });
  expect(policy.interstitial.placements['level_complete']).toEqual({ enabled: true, cadence: { every: 5, first: 1 } });
  expect(policy.interstitial.placements['return_to_map']).toEqual({ enabled: true, minLevel: 4 });
});

test('null clears an optional knob, undefined is no override, several overrides apply left to right', () => {
  const policy = resolveAdsPolicy(
    simple(),
    { interstitial: { cooldownMs: 10, placements: { level_complete: { cadence: null } } }, session: { maxInterstitials: 3 } },
    undefined,
    { interstitial: { cooldownMs: undefined, firstShowDelayMs: 5_000 }, session: { maxInterstitials: null } }
  );
  expect(policy.interstitial.placements['level_complete']).toEqual({ enabled: true, cadence: null });
  expect(policy.interstitial.cooldownMs).toBe(10);
  expect(policy.interstitial.firstShowDelayMs).toBe(5_000);
  expect(policy.session.maxInterstitials).toBeNull();
});

test('segmentation is atomic: an override replaces the tables whole (or removes them with null), never merges rows', () => {
  const tables = donorConfig();
  const withTables = resolveAdsPolicy(simple(), { segmentation: tables });
  expect(withTables.segmentation).toEqual(tables);
  expect(withTables.segmentation).not.toBe(tables); // a copy — the caller's tables are not frozen
  expect(Object.isFrozen(tables)).toBe(false);
  const smaller = { segments: { all: tables.segments['np_1']! }, placements: { level_fail: { type: 'inter' as const, bySegment: { all: { startFromLevel: 1, dayLimit: 3, hourLimit: 3 } } } } };
  const replaced = resolveAdsPolicy(withTables, { segmentation: smaller });
  expect(Object.keys(replaced.segmentation!.segments)).toEqual(['all']);
  expect(Object.keys(replaced.segmentation!.placements)).toEqual(['level_fail']);
  expect(resolveAdsPolicy(withTables, { segmentation: null }).segmentation).toBeNull();
  // the merge does not silently keep the old tables when the placement kinds contradict them
  expect(() => resolveAdsPolicy(withTables, { interstitial: { placements: { ad_hint_booster_rewarded: { enabled: true } } } })).toThrow(/ad_hint_booster_rewarded is inter in the policy but rewarded/);
});

test('overrides never mutate the base, the override object or a preset; the result is a frozen deep copy', () => {
  const base = simple();
  const baseSnapshot = JSON.stringify(base);
  const overrides: AdsPolicyOverrides = { interstitial: { cooldownMs: 1, placements: { level_complete: { cadence: { every: 9 } } } }, segmentation: donorConfig() };
  const overridesSnapshot = JSON.stringify(overrides);
  const policy = resolveAdsPolicy(base, overrides);
  expect(JSON.stringify(base)).toBe(baseSnapshot);
  expect(JSON.stringify(overrides)).toBe(overridesSnapshot);
  expect(isDeepFrozen(policy)).toBe(true);
  expect(policy.interstitial.placements['level_complete']!.cadence).not.toBe(overrides.interstitial!.placements!['level_complete']!.cadence);
  expect(() => {
    (policy as AdsPolicy).interstitial.cooldownMs = 0;
  }).toThrow(TypeError);
  // the preset
  const presetSnapshot = JSON.stringify(TRAIL_ARROW_AD_POLICY_V1);
  const tuned = resolveAdsPolicy(TRAIL_ARROW_AD_POLICY_V1, { interstitial: { cooldownMs: 600_000, placements: { level_exit_inter: { enabled: false } } }, noAds: { blocksBanner: false } });
  expect(tuned.interstitial.cooldownMs).toBe(600_000);
  expect(tuned.interstitial.placements['level_exit_inter']).toEqual({ enabled: false });
  expect(tuned.noAds.blocksBanner).toBe(false);
  expect(JSON.stringify(TRAIL_ARROW_AD_POLICY_V1)).toBe(presetSnapshot);
  expect(isDeepFrozen(TRAIL_ARROW_AD_POLICY_V1)).toBe(true);
  expect(isDeepFrozen(TRAIL_ARROW_ADS_CONFIG_V1)).toBe(true);
  expect(() => {
    (TRAIL_ARROW_AD_POLICY_V1 as AdsPolicy).interstitial.placements['level_win_inter']!.enabled = false;
  }).toThrow(TypeError);
  expect(() => {
    (TRAIL_ARROW_AD_POLICY_V1.segmentation as { segments: Record<string, { delayBetweenInters: number }> }).segments['np_1']!.delayBetweenInters = 0;
  }).toThrow(TypeError);
});

test('the nested merge is deterministic: the same base and overrides give the same policy, whatever the key order', () => {
  const a = resolveAdsPolicy(simple(), { session: { maxInterstitials: 2 }, interstitial: { placements: { level_fail: { minLevel: 2 } }, cooldownMs: 5 } });
  const b = resolveAdsPolicy(simple(), { interstitial: { cooldownMs: 5, placements: { level_fail: { minLevel: 2 } } }, session: { maxInterstitials: 2 } });
  expect(a).toEqual(b);
  expect(resolveAdsPolicy(a, {})).toEqual(a);
  expect(resolveAdsPolicy(simple())).toEqual(simple());
});

test('a bad override is refused as a RangeError that names the path; a non-object override too', () => {
  expect(() => resolveAdsPolicy(simple(), { interstitial: { cooldownMs: -1 } })).toThrow(/interstitial\.cooldownMs/);
  expect(() => resolveAdsPolicy(simple(), { interstitial: { placements: { level_complete: { cadence: { every: 0 } } } } })).toThrow(/cadence\.every/);
  expect(() => resolveAdsPolicy(simple(), { interstitial: { placements: { extra: { minLevel: 3 } } } })).toThrow(/extra\.enabled must be a boolean/);
  expect(() => resolveAdsPolicy(simple(), 'nope' as unknown as AdsPolicyOverrides)).toThrow(RangeError);
});

// ---------------------------------------------------------------- adsPolicyFromConfig / validateAdsPolicy

test('adsPolicyFromConfig: every placement of the tables enabled under its kind, neutral knobs, the tables by reference and unfrozen', () => {
  const config = donorConfig();
  const policy = adsPolicyFromConfig(config);
  expect(policy.name).toBe('legacy-config');
  expect(policy.version).toBe(0);
  expect(Object.keys(policy.interstitial.placements)).toEqual(['level_win_inter', 'level_fail_inter', 'level_exit_inter']);
  expect(Object.keys(policy.rewarded.placements)).toEqual(['ad_hint_booster_rewarded', 'ad_extra_moves_rewarded', 'ad_level_win_x2_rewarded', 'ad_refill_hearts_rewarded']);
  expect(Object.keys(policy.banner.placements)).toEqual(['banner']);
  expect(Object.values({ ...policy.interstitial.placements, ...policy.rewarded.placements, ...policy.banner.placements }).every((p) => p.enabled)).toBe(true);
  expect(policy.interstitial).toMatchObject(ADS_POLICY_NEUTRAL.interstitial);
  expect(policy.noAds).toEqual(ADS_POLICY_NEUTRAL.noAds);
  expect(policy.session).toEqual(ADS_POLICY_NEUTRAL.session);
  expect(policy.rewarded.minLevel).toBe(0);
  expect(policy.banner.minLevel).toBe(0);
  expect(policy.segmentation).toBe(config);
  expect(Object.isFrozen(policy)).toBe(false);
  expect(() => validateAdsPolicy(policy)).not.toThrow();
  expect(adsPolicyFromConfig(config, { name: 'x', version: 7 })).toMatchObject({ name: 'x', version: 7 });
});

test('validateAdsPolicy: the matrix of refusals, each naming its path', () => {
  const cases: Array<[string, (p: AdsPolicy) => void, RegExp]> = [
    ['name', (p) => { p.name = ''; }, /name/],
    ['version', (p) => { p.version = 1.5; }, /version/],
    ['interstitial.enabled', (p) => { (p.interstitial as { enabled: unknown }).enabled = 'yes'; }, /interstitial\.enabled/],
    ['cooldownMs NaN', (p) => { p.interstitial.cooldownMs = NaN; }, /cooldownMs/],
    ['cooldownMs Infinity', (p) => { p.interstitial.cooldownMs = Infinity; }, /cooldownMs/],
    ['afterRewardedCooldownMs', (p) => { p.interstitial.afterRewardedCooldownMs = -5; }, /afterRewardedCooldownMs/],
    ['firstShowDelayMs', (p) => { p.interstitial.firstShowDelayMs = -1; }, /firstShowDelayMs/],
    ['interstitial.minLevel', (p) => { p.interstitial.minLevel = NaN; }, /interstitial\.minLevel/],
    ['placement enabled', (p) => { (p.interstitial.placements['level_fail'] as { enabled: unknown }).enabled = 1; }, /level_fail\.enabled/],
    ['placement minLevel', (p) => { p.interstitial.placements['level_fail']!.minLevel = NaN; }, /level_fail\.minLevel/],
    ['placement dayLimit', (p) => { p.interstitial.placements['level_fail']!.dayLimit = -1; }, /level_fail\.dayLimit/],
    ['placement hourLimit', (p) => { p.rewarded.placements['hint_rewarded']!.hourLimit = -1; }, /hint_rewarded\.hourLimit/],
    ['cadence.every', (p) => { p.interstitial.placements['level_complete']!.cadence = { every: 2.5 }; }, /cadence\.every/],
    ['cadence.first', (p) => { p.interstitial.placements['level_complete']!.cadence = { every: 2, first: 0 }; }, /cadence\.first/],
    ['rewarded.enabled', (p) => { (p.rewarded as { enabled: unknown }).enabled = null; }, /rewarded\.enabled/],
    ['rewarded.placements', (p) => { (p.rewarded as { placements: unknown }).placements = []; }, /rewarded\.placements/],
    ['banner.minLevel', (p) => { (p.banner as { minLevel: unknown }).minLevel = '3'; }, /banner\.minLevel/],
    ['banner placement', (p) => { (p.banner.placements as Record<string, unknown>)['banner'] = true; }, /banner\.placements\.banner/],
    ['noAds', (p) => { (p.noAds as { blocksRewarded: unknown }).blocksRewarded = 0; }, /noAds\.blocksRewarded/],
    ['maxInterstitials', (p) => { p.session.maxInterstitials = -1; }, /maxInterstitials/],
    ['maxInterstitials fraction', (p) => { p.session.maxInterstitials = 1.5; }, /maxInterstitials/],
    ['blockWhileAdInFlight', (p) => { (p.session as { blockWhileAdInFlight: unknown }).blockWhileAdInFlight = 'no'; }, /blockWhileAdInFlight/],
    ['one kind per id', (p) => { p.rewarded.placements['level_fail'] = { enabled: true }; }, /level_fail is listed under both inter and rewarded/],
    ['segmentation undefined', (p) => { (p as { segmentation: unknown }).segmentation = undefined; }, /segmentation/],
    ['segmentation invalid', (p) => { p.segmentation = { segments: {}, placements: {} }; }, /validateAdsConfig/],
    ['kind vs tables', (p) => { p.segmentation = donorConfig(); p.rewarded.placements['level_win_inter'] = { enabled: true }; }, /level_win_inter is rewarded in the policy but inter in the segmentation/]
  ];
  for (const [name, mutate, message] of cases) {
    const policy = simple();
    mutate(policy);
    expect(() => validateAdsPolicy(policy), name).toThrow(RangeError);
    expect(() => validateAdsPolicy(policy), name).toThrow(message);
  }
  // valid edges: empty placement records, a policy-only game, Infinity limits, a cadence without `first`
  const edge = simple();
  edge.interstitial.placements = {};
  edge.rewarded.placements = { hint_rewarded: { enabled: true, dayLimit: Infinity, hourLimit: null, minLevel: null } };
  edge.banner.placements = {};
  edge.session.maxInterstitials = 0;
  expect(() => validateAdsPolicy(edge)).not.toThrow();
  expect(() => validateAdsPolicy(resolveAdsPolicy(simple(), { interstitial: { placements: { level_fail: { cadence: { every: 1 } } } } }))).not.toThrow();
  expect(() => validateAdsPolicy(null as unknown as AdsPolicy)).toThrow(RangeError);
});

test('freezeAdsPolicy freezes in depth and returns the same object', () => {
  const policy = simple();
  policy.segmentation = donorConfig();
  expect(freezeAdsPolicy(policy)).toBe(policy);
  expect(isDeepFrozen(policy)).toBe(true);
});

// ---------------------------------------------------------------- TRAIL_ARROW_AD_POLICY_V1

test('TRAIL_ARROW_AD_POLICY_V1 = the verbatim donor tables (segments.tsv + placements.tsv, key order included) with every knob neutral', () => {
  const fromTsv = donorConfig();
  // the tables: the same rows, the same numbers, the same order as the TSVs and the donor's generated config
  expect(TRAIL_ARROW_ADS_CONFIG_V1).toEqual(fromTsv);
  expect(Object.keys(TRAIL_ARROW_ADS_CONFIG_V1.segments)).toEqual(Object.keys(fromTsv.segments));
  expect(Object.keys(TRAIL_ARROW_ADS_CONFIG_V1.placements)).toEqual(Object.keys(fromTsv.placements));
  for (const [name, placement] of Object.entries(TRAIL_ARROW_ADS_CONFIG_V1.placements)) {
    expect(Object.keys(placement.bySegment), name).toEqual(Object.keys(fromTsv.placements[name]!.bySegment));
  }
  const generated = JSON.parse(GENERATED_JSON, (_key, value) => (value === 'Infinity' ? Infinity : value)) as AdsConfig;
  expect(TRAIL_ARROW_ADS_CONFIG_V1).toEqual(generated);
  // the policy: exactly what a bare `config` gets (AdsRuntime v0.7), plus a name and a version
  expect(TRAIL_ARROW_AD_POLICY_V1).toEqual(adsPolicyFromConfig(fromTsv, { name: 'trail_arrow', version: 1 }));
  expect(TRAIL_ARROW_AD_POLICY_V1.segmentation).toBe(TRAIL_ARROW_ADS_CONFIG_V1);
  expect(TRAIL_ARROW_AD_POLICY_V1.interstitial).toMatchObject({ enabled: true, cooldownMs: 0, afterRewardedCooldownMs: 0, firstShowDelayMs: 0, minLevel: 0 });
  expect(TRAIL_ARROW_AD_POLICY_V1.noAds).toEqual({ blocksInterstitial: true, blocksBanner: true, blocksRewarded: false });
  expect(TRAIL_ARROW_AD_POLICY_V1.session).toEqual({ maxInterstitials: null, blockWhileAdInFlight: false });
  expect(() => validateAdsPolicy(TRAIL_ARROW_AD_POLICY_V1 as AdsPolicy)).not.toThrow();
});
