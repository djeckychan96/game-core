// Pure port of Trail Arrow 0.1.22 `src/app/OfferChain.ts` (decision of 15.09: one welcome offer,
// then a ladder of `topTier` tiers × 2 variants). Every function is side-effect free except for
// the writes it makes through the injected `OfferStateStore`; there is no clock, no timer, no
// storage and no renderer here. Comments name the donor's transition (T1…T6) or review item they
// preserve. See docs/superpowers/specs/2026-09-16-offer-runtime-v0.4-design.md.
import type { OfferChainConfig, OfferDef, OfferStateStore, OfferVariant } from './types';
import { OFFER_WELCOME } from './types';

/** The live catalog gate: does the platform sell this product right now? */
export type OfferPriceGate = (productId: string) => boolean;

function tierOffer(config: OfferChainConfig, tier: number, variant: OfferVariant): OfferDef {
  const offer = config.tiers[tier - 1]?.[variant];
  if (!offer) throw new Error(`OfferChain: config has no offer for tier ${tier} variant ${variant}`);
  return offer;
}

/** The welcome offer or a ladder offer by its product id; null for a product outside the chain. */
export function offerByProduct(config: OfferChainConfig, productId: string): OfferDef | null {
  if (productId === config.welcome.productId) return config.welcome;
  for (const pair of config.tiers) for (const offer of pair) if (offer.productId === productId) return offer;
  return null;
}

/**
 * The offer the state says is on screen, ignoring `until`: the welcome while `welcome` is ACTIVE,
 * else the active tier/variant, else null. Internal — the runtime diffs it around a tick to name
 * the offer that expired or appeared (`activeOffer` already returns null at the expiry moment).
 */
export function shownOffer(config: OfferChainConfig, state: OfferStateStore): OfferDef | null {
  if (state.get('welcome') === OFFER_WELCOME.ACTIVE) return config.welcome;
  const tier = state.get('activeTier');
  if (tier < 1 || tier > config.topTier) return null;
  return tierOffer(config, tier, state.get('activeVariant') === 1 ? 1 : 0);
}

/** The currently active offer (or null), without side effects. */
export function activeOffer(config: OfferChainConfig, state: OfferStateStore, now: number): OfferDef | null {
  if (state.get('until') <= now) return null;
  return shownOffer(config, state);
}

/** Seconds until the active offer ends; 0 when none is active. */
export function secondsLeft(config: OfferChainConfig, state: OfferStateStore, now: number): number {
  return activeOffer(config, state, now) ? Math.max(0, state.get('until') - now) : 0;
}

function bit(mask: number, tier: number): number {
  return (mask >> (tier - 1)) & 1;
}

function withBit(mask: number, tier: number, value: number): number {
  return value ? mask | (1 << (tier - 1)) : mask & ~(1 << (tier - 1));
}

/** Tier variant: A on the first visit; on a revisit the opposite of the variant shown last time. */
function preferredVariant(state: OfferStateStore, tier: number): OfferVariant {
  const seen = state.get('seenMask');
  const last = state.get('variantMask');
  return bit(seen, tier) ? (bit(last, tier) ? 0 : 1) : 0;
}

/**
 * REVIEW 15.09 №3: the platform may sell one variant but not the other (e.g. offer_t4_a without
 * offer_t4_b); the chain used to stall forever. Order: wanted tier → the tiers at distance 1, 2, …
 * (below first, then above); inside a tier the preferred variant, then the other. The first
 * product with a price wins; null when nothing in the ladder has one.
 */
export function pickAvailableOffer(config: OfferChainConfig, state: OfferStateStore, wantedTier: number, hasPrice: OfferPriceGate): OfferDef | null {
  const order: number[] = [wantedTier];
  for (let d = 1; d < config.topTier; d++) {
    if (wantedTier - d >= 1) order.push(wantedTier - d);
    if (wantedTier + d <= config.topTier) order.push(wantedTier + d);
  }
  for (const tier of order) {
    if (tier < 1 || tier > config.topTier) continue; // callers clamp; a stray tier must not throw
    const preferred = preferredVariant(state, tier);
    for (const variant of [preferred, preferred === 0 ? 1 : 0] as OfferVariant[]) {
      const offer = tierOffer(config, tier, variant);
      if (hasPrice(offer.productId)) return offer;
    }
  }
  return null;
}

function activateTier(config: OfferChainConfig, state: OfferStateStore, tier: number, variant: OfferVariant, now: number): void {
  const seen = state.get('seenMask');
  const last = state.get('variantMask');
  state.set('activeTier', tier);
  state.set('activeVariant', variant);
  state.set('seenMask', withBit(seen, tier, 1));
  state.set('variantMask', withBit(last, tier, variant));
  state.set('until', now + tierOffer(config, tier, variant).timerSec);
}

/** Code of a declined offer for the late-purchase check (№2): 0 none, 1 welcome, 2.. = 2 + (tier − 1) × 2 + variant. */
function declinedCode(offer: OfferDef): number {
  return offer.tier === 0 ? 1 : 2 + (offer.tier - 1) * 2 + offer.variant;
}

/**
 * Ends the active offer: bought → the tier above (capped at the top) after `nextAfterBuySec`;
 * declined → the tier below (floored at 1) after `nextAfterDeclineSec`, remembering the declined
 * offer for a late purchase. A purchase clears the declined code.
 */
function finish(config: OfferChainConfig, state: OfferStateStore, bought: boolean, fromTier: number, now: number, declined: OfferDef | null = null): void {
  const next = bought ? Math.min(config.topTier, fromTier + 1) : Math.max(1, fromTier - 1);
  state.set('activeTier', 0);
  state.set('until', 0);
  state.set('nextTier', next);
  state.set('nextAt', now + (bought ? config.nextAfterBuySec : config.nextAfterDeclineSec));
  state.set('declined', declined ? declinedCode(declined) : 0);
  state.set('declinedAt', declined ? now : 0);
}

/**
 * The chain "should" show an offer but nothing has a price (the `blocked_no_price` condition):
 * at/after `startLevel`, nothing active, and either the welcome is due but unpriced and not
 * owned, or a tier is due (`nextAt` reached) and `pickAvailableOffer` finds nothing.
 */
export function isChainBlocked(config: OfferChainConfig, state: OfferStateStore, now: number, level: number, hasPrice: OfferPriceGate, welcomeOwned: boolean): boolean {
  if (level < config.startLevel || activeOffer(config, state, now)) return false;
  const welcome = state.get('welcome');
  if (welcome === OFFER_WELCOME.NEW) return !welcomeOwned && !hasPrice(config.welcome.productId);
  if (welcome !== OFFER_WELCOME.DONE || state.get('activeTier') !== 0 || now < state.get('nextAt')) return false;
  return pickAvailableOffer(config, state, Math.min(config.topTier, Math.max(1, state.get('nextTier') || 1)), hasPrice) === null;
}

/**
 * REVIEW 15.09 №13: on profile load, cap the chain times — a save written under a device clock
 * set to the future used to freeze the ladder for years. Returns true if anything was repaired.
 */
export function clampOfferTimes(config: OfferChainConfig, state: OfferStateStore, now: number): boolean {
  let changed = false;
  const until = state.get('until');
  if (until > now + config.maxUntilAheadSec) {
    state.set('until', now + config.maxUntilAheadSec);
    changed = true;
  }
  const nextAt = state.get('nextAt');
  if (nextAt > now + config.maxNextAheadSec) {
    state.set('nextAt', now + config.maxNextAheadSec);
    changed = true;
  }
  const declinedAt = state.get('declinedAt');
  if (declinedAt > now) {
    state.set('declinedAt', now);
    changed = true;
  }
  return changed;
}

/**
 * Advances the chain by time. Exactly ONE transition per call, in this strict order:
 *   T1  the welcome expired            → declined from "tier 2": next tier 1 after the decline cooldown
 *   T2  a ladder tier expired          → declined: the tier below after the decline cooldown
 *   T3  level below startLevel         → nothing (expiries above are still processed below it)
 *   T4a welcome never shown but owned  → skip it: tier 2 after the buy cooldown
 *   T4b welcome has no catalog price   → nothing (wait for the catalog)
 *   T4c activate the welcome
 *   T5  a tier is due (nextAt reached) → activate the first priced offer around the wanted tier
 *   T6  otherwise nothing
 * Returns true if the state changed (the host saves the profile).
 */
export function tickOffers(config: OfferChainConfig, state: OfferStateStore, now: number, level: number, hasPrice: OfferPriceGate, welcomeOwned: boolean): boolean {
  const welcome = state.get('welcome');
  const until = state.get('until');

  // T1: the welcome expired — "not bought" from tier 2 → max(1, 2 − 1) = tier 1 after the decline cooldown
  if (welcome === OFFER_WELCOME.ACTIVE && until <= now) {
    state.set('welcome', OFFER_WELCOME.DONE);
    finish(config, state, false, 2, now, config.welcome);
    return true;
  }
  // T2: a ladder tier expired
  const tier = state.get('activeTier');
  if (welcome === OFFER_WELCOME.DONE && tier > 0 && until <= now) {
    const expired = tierOffer(config, tier, state.get('activeVariant') === 1 ? 1 : 0);
    finish(config, state, false, tier, now, expired);
    return true;
  }
  // T3
  if (level < config.startLevel) return false;

  // T4: the welcome. Bought before the chain existed → straight to the ladder (tier 2 after the buy cooldown)
  if (welcome === OFFER_WELCOME.NEW) {
    if (welcomeOwned) {
      state.set('welcome', OFFER_WELCOME.DONE);
      finish(config, state, true, 1, now);
      return true;
    }
    if (!hasPrice(config.welcome.productId)) return false;
    state.set('welcome', OFFER_WELCOME.ACTIVE);
    state.set('until', now + config.welcome.timerSec);
    return true;
  }
  // T5: the next tier when its time has come
  if (welcome === OFFER_WELCOME.DONE && tier === 0 && now >= state.get('nextAt')) {
    const next = Math.min(config.topTier, Math.max(1, state.get('nextTier') || 1));
    const pick = pickAvailableOffer(config, state, next, hasPrice);
    if (!pick) return false;
    activateTier(config, state, pick.tier, pick.variant, now);
    return true;
  }
  // T6
  return false;
}

/**
 * A chain product was purchased. "Bought" — the ladder moves up — if it is the active offer OR
 * (№2) the offer that just expired, inside `latePurchaseWindowSec` while nothing else is active
 * (the payment sheet was open in the timer's last seconds, or the receipt was restored on the
 * next launch). An older or foreign receipt still grants its product (host) but returns false.
 */
export function onOfferPurchased(config: OfferChainConfig, state: OfferStateStore, productId: string, now: number): boolean {
  const offer = offerByProduct(config, productId);
  if (!offer) return false;
  const active = activeOffer(config, state, now);
  const lateOk =
    !active &&
    state.get('activeTier') === 0 &&
    state.get('declined') === declinedCode(offer) &&
    now - state.get('declinedAt') < config.latePurchaseWindowSec;
  if (offer.tier === 0) {
    const welcome = state.get('welcome');
    if (welcome === OFFER_WELCOME.ACTIVE || (lateOk && welcome === OFFER_WELCOME.DONE)) {
      state.set('welcome', OFFER_WELCOME.DONE);
      finish(config, state, true, 1, now); // min(topTier, 1 + 1) = tier 2
      return true;
    }
    return false;
  }
  if ((active && active.productId === productId) || lateOk) {
    finish(config, state, true, offer.tier, now);
    return true;
  }
  return false;
}
