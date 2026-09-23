// Regression fixtures for Production Profile V1 — they prove the API shape only; no game reads them.
import { freezeAdsPolicy } from '../../src/index';
import type { GameProductionProfile } from '../../src/index';

/** The smallest valid profile: no currency, no ads, no products. */
export const MINIMAL_PROFILE: GameProductionProfile = {
  id: 'minimal',
  progression: { mode: 'linear' },
  ui: { result: 'core', lives: false, music: false },
  economy: { softCurrency: false },
  monetization: { ads: false },
  platform: { target: 'dev' },
  save: { keys: ['minimal-save'] }
};

/**
 * SoliPix as solipix-core-clean ships it (b4c9710): linear map, its own victory screen, music, the
 * gameplay keeps the coins (save + computeVictoryCoins; purchases grant through gameplay.grantCoins),
 * the production ad policy (host/ads.js), no_ads + the six coin packs with their fallback labels
 * (host/purchases.js), Yandex target, one save key (host/main.js SAVE_KEY).
 */
export const SOLIPIX_PROFILE: GameProductionProfile = {
  id: 'solipix',
  progression: { mode: 'linear' },
  ui: { result: 'gameplay', lives: false, music: true },
  economy: { softCurrency: { id: 'coins', owner: 'gameplay' } },
  monetization: {
    ads: {
      policy: freezeAdsPolicy({
        name: 'solipix',
        version: 1,
        interstitial: { enabled: true, cooldownMs: 35000, afterRewardedCooldownMs: 0, firstShowDelayMs: 0, minLevel: 0,
          placements: { level_complete: { enabled: true } } },
        rewarded: { enabled: true, minLevel: 0, placements: { hint_rewarded: { enabled: true }, moves_rewarded: { enabled: true } } },
        banner: { enabled: false, minLevel: 0, placements: {} },
        noAds: { blocksInterstitial: true, blocksBanner: true, blocksRewarded: false, offerAfterInterstitials: { enabled: true, every: 3, first: 1, minLevel: 0 } },
        session: { maxInterstitials: null, blockWhileAdInFlight: true },
        segmentation: null
      })
    },
    noAds: { productId: 'no_ads', fallbackPrice: '199 ₽' },
    coinPacks: [
      { productId: 'pack_1_coins', amount: 200, fallbackPrice: '49 ₽' },
      { productId: 'pack_2_coins', amount: 700, fallbackPrice: '149 ₽' },
      { productId: 'pack_3_coins', amount: 2700, fallbackPrice: '499 ₽' },
      { productId: 'pack_4_coins', amount: 6200, fallbackPrice: '999 ₽' },
      { productId: 'pack_5_coins', amount: 10500, fallbackPrice: '1499 ₽' },
      { productId: 'pack_6_coins', amount: 40000, fallbackPrice: '4999 ₽' }
    ]
  },
  platform: { target: 'yandex' },
  save: { keys: ['solipics_state'] }
};

/**
 * Gorodki: open figure picker, no lives, no music, Core shows the result, Core keeps the coins — the
 * production-scope decisions of the next cold run. The ids, prices, reward and ad numbers below are
 * FIXTURE VALUES, not Gorodki decisions: gorodki-core-clean (74a8808) has no ads, payments or currency
 * yet; they only prove that the shop / no_ads representation fits. Save keys = its host/main.js.
 */
export const GORODKI_PROFILE: GameProductionProfile = {
  id: 'gorodki',
  progression: { mode: 'open' },
  ui: { result: 'core', lives: false, music: false },
  economy: {
    softCurrency: {
      id: 'coins',
      owner: 'core',
      startBalance: 0,
      levelReward: (result) => (result.win && result.firstCompletion ? 10 * (result.stars ?? 1) : 0)
    }
  },
  monetization: {
    ads: {
      policy: freezeAdsPolicy({
        name: 'gorodki_fixture',
        version: 1,
        interstitial: { enabled: true, cooldownMs: 60000, afterRewardedCooldownMs: 0, firstShowDelayMs: 0, minLevel: 3,
          placements: { level_complete: { enabled: true } } },
        rewarded: { enabled: false, minLevel: 0, placements: {} },
        banner: { enabled: false, minLevel: 0, placements: {} },
        noAds: { blocksInterstitial: true, blocksBanner: true, blocksRewarded: false, offerAfterInterstitials: null },
        session: { maxInterstitials: null, blockWhileAdInFlight: true },
        segmentation: null
      })
    },
    noAds: { productId: 'gorodki_no_ads' },
    coinPacks: [{ productId: 'gorodki_coins_small', amount: 100, fallbackPrice: '49 ₽' }]
  },
  platform: { target: 'dev' },
  save: { keys: ['gorodki-progress-v2', 'gorodki-progress-v1', 'gorodki-background-v2'] }
};
