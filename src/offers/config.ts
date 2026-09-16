import type { OfferChainConfig, OfferDef } from './types';

export const OFFER_HOUR_SEC = 60 * 60;
export const OFFER_DAY_SEC = 24 * OFFER_HOUR_SEC;

/** The welcome offer's production timer (Trail Arrow: 12 h). */
export const DEFAULT_WELCOME_TIMER_SEC = 12 * OFFER_HOUR_SEC;
/** A ladder tier's production timer (Trail Arrow: 24 h). */
export const DEFAULT_TIER_TIMER_SEC = OFFER_DAY_SEC;

/**
 * Trail Arrow 0.1.22 production timing (`OfferChain.ts` constants): the chain starts at level 8,
 * six tiers, next offer 24 h after a purchase and 48 h after an expiry, a late purchase counts for
 * 24 h, and a save from a future clock is clamped to +24 h (`until`) / +48 h (`nextAt`).
 * A host spreads it and adds its own `welcome` and `tiers`.
 */
export const DEFAULT_OFFER_CHAIN_TIMING: Readonly<Omit<OfferChainConfig, 'welcome' | 'tiers'>> = Object.freeze({
  startLevel: 8,
  topTier: 6,
  nextAfterBuySec: OFFER_DAY_SEC,
  nextAfterDeclineSec: 2 * OFFER_DAY_SEC,
  latePurchaseWindowSec: OFFER_DAY_SEC,
  maxUntilAheadSec: OFFER_DAY_SEC,
  maxNextAheadSec: 2 * OFFER_DAY_SEC
});

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function checkOffer(offer: OfferDef | undefined, where: string, tier: number, variant: 0 | 1): OfferDef {
  if (!offer || typeof offer !== 'object') throw new RangeError(`OfferChainConfig: ${where} is missing`);
  if (typeof offer.productId !== 'string' || offer.productId.length === 0) throw new RangeError(`OfferChainConfig: ${where} needs a productId`);
  if (offer.tier !== tier) throw new RangeError(`OfferChainConfig: ${where} must have tier ${tier}, got ${offer.tier}`);
  if (offer.variant !== variant) throw new RangeError(`OfferChainConfig: ${where} must have variant ${variant}, got ${offer.variant}`);
  if (!(typeof offer.timerSec === 'number' && Number.isFinite(offer.timerSec) && offer.timerSec > 0)) {
    throw new RangeError(`OfferChainConfig: ${where} needs a positive timerSec`);
  }
  if (typeof offer.titleKey !== 'string') throw new RangeError(`OfferChainConfig: ${where} needs a titleKey`);
  if (!Array.isArray(offer.rewards)) throw new RangeError(`OfferChainConfig: ${where} needs a rewards array`);
  return offer;
}

/**
 * Fails fast (RangeError) on a config the chain could not run: wrong tier/variant placement,
 * a missing variant, duplicate product ids, non-finite or negative seconds.
 */
export function validateOfferChainConfig(config: OfferChainConfig): void {
  if (!config || typeof config !== 'object') throw new RangeError('OfferChainConfig: config is required');
  if (!(Number.isInteger(config.startLevel) && config.startLevel >= 0)) throw new RangeError('OfferChainConfig: startLevel must be an integer ≥ 0');
  if (!(Number.isInteger(config.topTier) && config.topTier >= 1 && config.topTier <= 30)) throw new RangeError('OfferChainConfig: topTier must be an integer in 1..30');
  for (const key of ['nextAfterBuySec', 'nextAfterDeclineSec', 'latePurchaseWindowSec', 'maxUntilAheadSec', 'maxNextAheadSec'] as const) {
    if (!isNonNegative(config[key])) throw new RangeError(`OfferChainConfig: ${key} must be a finite number ≥ 0`);
  }
  const ids = new Set<string>();
  const remember = (offer: OfferDef, where: string) => {
    if (ids.has(offer.productId)) throw new RangeError(`OfferChainConfig: duplicate productId "${offer.productId}" at ${where}`);
    ids.add(offer.productId);
  };
  remember(checkOffer(config.welcome, 'welcome', 0, 0), 'welcome');
  if (!Array.isArray(config.tiers) || config.tiers.length !== config.topTier) {
    throw new RangeError(`OfferChainConfig: tiers must hold exactly topTier (${config.topTier}) entries`);
  }
  config.tiers.forEach((pair, index) => {
    const tier = index + 1;
    if (!Array.isArray(pair) || pair.length !== 2) throw new RangeError(`OfferChainConfig: tier ${tier} must hold exactly two variants`);
    remember(checkOffer(pair[0], `tier ${tier} variant A`, tier, 0), `tier ${tier} variant A`);
    remember(checkOffer(pair[1], `tier ${tier} variant B`, tier, 1), `tier ${tier} variant B`);
  });
}
