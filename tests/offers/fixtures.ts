// Fixtures for the OfferRuntime tests.
//
// HONESTY NOTE: Trail Arrow's original chain tests (scratchpad `offertest/test.ts`, 21 + 18 cases,
// referenced by REVIEW_2026-09-08.md №41 and REVIEW_2026-09-15.md) are NOT present in the
// `trail_arrow-latest` copy. Everything below is reconstructed from the production code
// (`src/app/OfferChain.ts`, `OfferChainSystem.ts`, `DataUpdateSystem.ts`) and the review items
// №2 / №3 / №13 — the same transitions, not the original test names or fixtures.
import { DEFAULT_OFFER_CHAIN_TIMING, DEFAULT_TIER_TIMER_SEC, DEFAULT_WELCOME_TIMER_SEC } from '../../src/offers/config';
import { MemoryOfferStateStore } from '../../src/offers/state';
import type { OfferChainConfig, OfferDef, OfferStateKey, OfferVariant } from '../../src/offers/types';

export const HOUR = 3600;
export const DAY = 24 * HOUR;
/** A fixed server "now" (unix seconds) every scenario starts from. */
export const T0 = 1_760_000_000;

/** Reward ids are host-owned; these mirror the donor's SOFT / LIVES_UNLIMITED_UNTIL / FINGER_BOOSTER. */
export function rewards(coins: number, bulbs: number, livesSec: number): OfferDef['rewards'] {
  const list: OfferDef['rewards'] = [{ id: 'coins', amount: coins }];
  if (livesSec > 0) list.push({ id: 'lives_unlimited_sec', amount: livesSec });
  if (bulbs > 0) list.push({ id: 'bulbs', amount: bulbs });
  return list;
}

function tier(t: number, variant: OfferVariant, coins: number, bulbs: number, livesSec: number): OfferDef {
  return {
    productId: `offer_t${t}_${variant === 0 ? 'a' : 'b'}`,
    tier: t,
    variant,
    titleKey: `ui.offer.t${t}`,
    timerSec: DEFAULT_TIER_TIMER_SEC,
    rewards: rewards(coins, bulbs, livesSec)
  };
}

/** Trail Arrow 0.1.22 `WELCOME_OFFER` + `TIER_OFFERS` (compositions from OfferChain.ts / REVIEW №41). */
export function makeConfig(overrides: Partial<OfferChainConfig> = {}): OfferChainConfig {
  return {
    ...DEFAULT_OFFER_CHAIN_TIMING,
    welcome: {
      productId: 'starter_pack',
      tier: 0,
      variant: 0,
      titleKey: 'ui.starterPack.header',
      timerSec: DEFAULT_WELCOME_TIMER_SEC,
      rewards: rewards(3500, 3, HOUR)
    },
    tiers: [
      [tier(1, 0, 1000, 1, 30 * 60), tier(1, 1, 1500, 0, HOUR)],
      [tier(2, 0, 5000, 3, 3 * HOUR), tier(2, 1, 6000, 2, 6 * HOUR)],
      [tier(3, 0, 12000, 5, 12 * HOUR), tier(3, 1, 15000, 3, DAY)],
      [tier(4, 0, 25000, 10, DAY), tier(4, 1, 28000, 8, 2 * DAY)],
      [tier(5, 0, 50000, 20, 3 * DAY), tier(5, 1, 60000, 15, 5 * DAY)],
      [tier(6, 0, 110000, 40, 7 * DAY), tier(6, 1, 130000, 30, 7 * DAY)]
    ],
    ...overrides
  };
}

export function makeState(initial: Partial<Record<OfferStateKey, number>> = {}): MemoryOfferStateStore {
  return new MemoryOfferStateStore(initial);
}

/** Every chain product is priced (the donor's DEV/localhost gate). */
export const allPriced = (): boolean => true;

/** Only the listed product ids are priced. */
export function pricedOnly(...ids: string[]): (productId: string) => boolean {
  const set = new Set(ids);
  return (productId) => set.has(productId);
}

/** Every product except the listed ones is priced. */
export function pricedExcept(...ids: string[]): (productId: string) => boolean {
  const set = new Set(ids);
  return (productId) => !set.has(productId);
}

/** State after the welcome finished and the ladder is in cooldown before `nextTier` at `nextAt`. */
export function cooldownState(nextTier: number, nextAt: number, extra: Partial<Record<OfferStateKey, number>> = {}): MemoryOfferStateStore {
  return makeState({ welcome: 2, activeTier: 0, until: 0, nextTier, nextAt, ...extra });
}
