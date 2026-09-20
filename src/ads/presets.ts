// Ads Policy presets. TRAIL_ARROW_AD_POLICY_V1 is Trail Arrow 0.1.22's production ad scheme
// (`ads_config/segments.tsv` + `placements.tsv`, Oleg's table of 15.09) as a frozen, versioned
// policy: the tables verbatim as the segmentation, every placement of the tables enabled, and
// every policy-level knob neutral — so a runtime built from it decides exactly like AdsRuntime
// v0.7 built from `parseAdsTsv(...)` (tests/ads/preset-parity.test.ts pins both the tables and
// the knobs). It is NOT the default of anything yet: Oleg is still reading the results of this
// scheme. When it is, `DEFAULT_AD_POLICY = TRAIL_ARROW_AD_POLICY_V1` — or a
// `resolveAdsPolicy(TRAIL_ARROW_AD_POLICY_V1, { … })` with the changed numbers — is one line.
import { freezeAdsPolicy } from './policy';
import type { AdsPolicy } from './policy';
import type { AdsConfig } from './types';

/** The donor tables as data. A change here is a change of production ad behavior: bump the policy version with it. */
export const TRAIL_ARROW_ADS_CONFIG_V1: Readonly<AdsConfig> = {
  segments: {
    np_1: { payer: 'NON_PAYER', levelFrom: 1, levelTo: 20, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 240, disableInter: false },
    np_2: { payer: 'NON_PAYER', levelFrom: 20, levelTo: 40, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 180, disableInter: false },
    np_3: { payer: 'NON_PAYER', levelFrom: 40, levelTo: 60, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 140, disableInter: false },
    np_4: { payer: 'NON_PAYER', levelFrom: 60, levelTo: 80, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 30, delayBetweenInters: 90, disableInter: false },
    np_5: { payer: 'NON_PAYER', levelFrom: 80, levelTo: 100, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 30, delayBetweenInters: 60, disableInter: false },
    np_6: { payer: 'NON_PAYER', levelFrom: 100, levelTo: 120, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 30, delayBetweenInters: 45, disableInter: false },
    deep_np: { payer: 'NON_PAYER', levelFrom: 120, levelTo: Infinity, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 30, delayBetweenInters: 45, disableInter: false },
    pay_1: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 0, avgTo: 53, maxFrom: 0, maxTo: 58, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_2: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 0, avgTo: 53, maxFrom: 58, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_3: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 53, avgTo: 101, maxFrom: 0, maxTo: 174, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_4: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 53, avgTo: 101, maxFrom: 174, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_5: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 101, avgTo: 160, maxFrom: 0, maxTo: 174, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_6: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 101, avgTo: 160, maxFrom: 174, maxTo: 232, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_7: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 101, avgTo: 160, maxFrom: 232, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_8: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 160, avgTo: 293, maxFrom: 0, maxTo: 406, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_9: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 160, avgTo: 293, maxFrom: 406, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    pay_10: { payer: 'PAYER', levelFrom: 1, levelTo: Infinity, avgFrom: 293, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false },
    default: { payer: 'ANY', levelFrom: 1, levelTo: Infinity, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 300, disableInter: false }
  },
  placements: {
    level_win_inter: {
      type: 'inter',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 10000, hourLimit: 500 },
        np_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_7: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_8: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_9: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_10: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 }
      }
    },
    level_fail_inter: {
      type: 'inter',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 10000, hourLimit: 500 },
        np_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_7: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_8: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_9: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_10: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 }
      }
    },
    level_exit_inter: {
      type: 'inter',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 10000, hourLimit: 500 },
        np_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_7: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_8: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_9: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_10: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 }
      }
    },
    ad_hint_booster_rewarded: {
      type: 'rewarded',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 1, hourLimit: 1 },
        np_2: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        np_3: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        np_4: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        np_5: { startFromLevel: 20, dayLimit: 10, hourLimit: 10 },
        np_6: { startFromLevel: 20, dayLimit: 20, hourLimit: 20 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_2: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_3: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_4: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_5: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_6: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_7: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_8: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_9: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 },
        pay_10: { startFromLevel: 20, dayLimit: 1, hourLimit: 1 }
      }
    },
    ad_extra_moves_rewarded: {
      type: 'rewarded',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 3, hourLimit: 3 },
        np_2: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        np_3: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        np_4: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        np_5: { startFromLevel: 20, dayLimit: 20, hourLimit: 20 },
        np_6: { startFromLevel: 20, dayLimit: 40, hourLimit: 40 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_2: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_3: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_4: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_5: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_6: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_7: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_8: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_9: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 },
        pay_10: { startFromLevel: 20, dayLimit: 2, hourLimit: 2 }
      }
    },
    ad_level_win_x2_rewarded: {
      type: 'rewarded',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 5, hourLimit: 5 },
        np_2: { startFromLevel: 20, dayLimit: 5, hourLimit: 5 },
        np_3: { startFromLevel: 20, dayLimit: 5, hourLimit: 5 },
        np_4: { startFromLevel: 20, dayLimit: 5, hourLimit: 5 },
        np_5: { startFromLevel: 20, dayLimit: 20, hourLimit: 20 },
        np_6: { startFromLevel: 20, dayLimit: 40, hourLimit: 40 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_2: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_3: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_4: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_5: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_6: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_7: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_8: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_9: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 },
        pay_10: { startFromLevel: 20, dayLimit: 3, hourLimit: 3 }
      }
    },
    ad_refill_hearts_rewarded: {
      type: 'rewarded',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 10000, hourLimit: 500 },
        np_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_1: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_7: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_8: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_9: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        pay_10: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 }
      }
    },
    banner: {
      type: 'banner',
      bySegment: {
        np_1: { startFromLevel: 15, dayLimit: 10000, hourLimit: 500 },
        np_2: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_3: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_4: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_5: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        np_6: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 },
        deep_np: { startFromLevel: 20, dayLimit: 10000, hourLimit: 500 }
      }
    }
  }
};

export const TRAIL_ARROW_AD_POLICY_V1: Readonly<AdsPolicy> = freezeAdsPolicy({
  name: 'trail_arrow',
  version: 1,
  interstitial: {
    enabled: true,
    // the segments carry the real cooldowns (delayBetweenInters 45–300 s, delayAfterReward 30–60 s); no floor on top
    cooldownMs: 0,
    afterRewardedCooldownMs: 0,
    firstShowDelayMs: 0,
    minLevel: 0,
    placements: {
      level_win_inter: { enabled: true },
      level_fail_inter: { enabled: true },
      level_exit_inter: { enabled: true }
    }
  },
  rewarded: {
    enabled: true,
    minLevel: 0,
    placements: {
      ad_hint_booster_rewarded: { enabled: true },
      ad_extra_moves_rewarded: { enabled: true },
      ad_level_win_x2_rewarded: { enabled: true },
      ad_refill_hearts_rewarded: { enabled: true }
    }
  },
  banner: {
    enabled: true,
    minLevel: 0,
    placements: { banner: { enabled: true } }
  },
  // NO_ADS: no interstitials, no banner; rewarded stays — donor 1:1
  noAds: { blocksInterstitial: true, blocksBanner: true, blocksRewarded: false },
  // the donor's AdsGate has no per-session cap and does not know about ads in flight (its windows guard that themselves)
  session: { maxInterstitials: null, blockWhileAdInFlight: false },
  segmentation: TRAIL_ARROW_ADS_CONFIG_V1 as AdsConfig
});
