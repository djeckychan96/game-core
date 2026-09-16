// OfferRuntime demo data for the showcase: Trail Arrow's production ladder (compositions from
// OfferChain.ts / REVIEW №41), a fake platform catalog (the donor's USD fallback grid), English
// titles for the title keys, and the donor's time formats. Demo only — a game brings its own
// config, catalog, i18n and reward ids.
import { DEFAULT_OFFER_CHAIN_TIMING, DEFAULT_TIER_TIMER_SEC, DEFAULT_WELCOME_TIMER_SEC, OFFER_DAY_SEC, OFFER_HOUR_SEC } from 'game-core';
import type { OfferChainConfig, OfferDef, OfferReward, OfferVariant } from 'game-core';
import type { StarterPackWindowParams } from 'game-core/pixi';

/** Reward ids are host-owned; the demo uses these three like the donor's SOFT / LIVES_UNLIMITED_UNTIL / FINGER_BOOSTER. */
export const REWARD_COINS = 'coins';
export const REWARD_LIVES_SEC = 'lives_unlimited_sec';
export const REWARD_BULBS = 'bulbs';

function rewards(coins: number, bulbs: number, livesSec: number): OfferReward[] {
  const list: OfferReward[] = [{ id: REWARD_COINS, amount: coins }];
  if (livesSec > 0) list.push({ id: REWARD_LIVES_SEC, amount: livesSec });
  if (bulbs > 0) list.push({ id: REWARD_BULBS, amount: bulbs });
  return list;
}

function tier(t: number, variant: OfferVariant, coins: number, bulbs: number, livesSec: number): OfferDef {
  return { productId: `offer_t${t}_${variant === 0 ? 'a' : 'b'}`, tier: t, variant, titleKey: `ui.offer.t${t}`, timerSec: DEFAULT_TIER_TIMER_SEC, rewards: rewards(coins, bulbs, livesSec) };
}

const H = OFFER_HOUR_SEC;
const D = OFFER_DAY_SEC;

/** Trail Arrow 0.1.22: the welcome pack (12 h) and six tiers × A/B (24 h each). */
export const DEMO_OFFER_CHAIN: OfferChainConfig = {
  ...DEFAULT_OFFER_CHAIN_TIMING,
  welcome: { productId: 'starter_pack', tier: 0, variant: 0, titleKey: 'ui.starterPack.header', timerSec: DEFAULT_WELCOME_TIMER_SEC, rewards: rewards(3500, 3, H) },
  tiers: [
    [tier(1, 0, 1000, 1, 30 * 60), tier(1, 1, 1500, 0, H)],
    [tier(2, 0, 5000, 3, 3 * H), tier(2, 1, 6000, 2, 6 * H)],
    [tier(3, 0, 12000, 5, 12 * H), tier(3, 1, 15000, 3, D)],
    [tier(4, 0, 25000, 10, D), tier(4, 1, 28000, 8, 2 * D)],
    [tier(5, 0, 50000, 20, 3 * D), tier(5, 1, 60000, 15, 5 * D)],
    [tier(6, 0, 110000, 40, 7 * D), tier(6, 1, 130000, 30, 7 * D)]
  ]
};

/** The fake platform catalog (the donor's USD fallback grid). `hasPrice` = the product is in here. */
export const DEMO_OFFER_CATALOG: Record<string, string> = {
  starter_pack: '$0.99',
  offer_t1_a: '$0.99', offer_t1_b: '$0.99',
  offer_t2_a: '$2.99', offer_t2_b: '$2.99',
  offer_t3_a: '$5.99', offer_t3_b: '$5.99',
  offer_t4_a: '$9.99', offer_t4_b: '$9.99',
  offer_t5_a: '$19.99', offer_t5_b: '$19.99',
  offer_t6_a: '$39.99', offer_t6_b: '$39.99'
};

/** Title keys → the window's two-line header (the donor's English locale). */
export const DEMO_OFFER_TITLES: Record<string, string> = {
  'ui.starterPack.header': 'STARTER\nPACK',
  'ui.offer.t1': 'MINI\nPACK',
  'ui.offer.t2': 'VALUE\nPACK',
  'ui.offer.t3': 'BIG\nPACK',
  'ui.offer.t4': 'MEGA\nPACK',
  'ui.offer.t5': 'ROYAL\nPACK',
  'ui.offer.t6': 'LEGENDARY\nPACK'
};

/** Donor `formatClock`: always HH:MM:SS (the offer countdown). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** Donor `formatDuration` (en): 30m / 3h / 5d. */
export function formatDuration(sec: number): string {
  if (sec >= D) return `${Math.round(sec / D)}d`;
  if (sec >= H) return `${Math.round(sec / H)}h`;
  return `${Math.round(sec / 60)}m`;
}

/** Short label for the status strip: `WELCOME`, `T3-A`, … */
export function offerLabel(offer: OfferDef): string {
  return offer.tier === 0 ? 'WELCOME' : `T${offer.tier}-${offer.variant === 0 ? 'A' : 'B'}`;
}

/** What the window shows for a chain offer — the host adapter's job, done here for the demo. */
export function offerToWindowParams(offer: OfferDef, price: string): StarterPackWindowParams {
  const amount = (id: string) => offer.rewards.find((reward) => reward.id === id)?.amount ?? 0;
  const lives = amount(REWARD_LIVES_SEC);
  const bulbs = amount(REWARD_BULBS);
  const params: StarterPackWindowParams = {
    price,
    title: DEMO_OFFER_TITLES[offer.titleKey] ?? offer.titleKey,
    rewards: { coins: amount(REWARD_COINS) }
  };
  if (lives > 0) params.rewards.infiniteLives = formatDuration(lives);
  if (bulbs > 0) params.rewards.boosters = `x${bulbs}`;
  return params;
}
