// The 39 production scenarios of Trail Arrow's offer chain (21 base transitions from REVIEW
// 2026-09-08 №41 + 18 from REVIEW 2026-09-15 №2 / №3 / №13), reconstructed from the production
// code — the original scratchpad `offertest/test.ts` is not in the donor copy (see fixtures.ts).
// Numbers in test names follow the source-of-truth report §7.
import { describe, expect, test } from 'vitest';
import {
  activeOffer,
  clampOfferTimes,
  isChainBlocked,
  offerByProduct,
  onOfferPurchased,
  pickAvailableOffer,
  secondsLeft,
  tickOffers
} from '../../src/offers/chain';
import { OFFER_WELCOME } from '../../src/offers/types';
import { DAY, HOUR, T0, allPriced, cooldownState, makeConfig, makeState, pricedExcept, pricedOnly } from './fixtures';

const cfg = makeConfig();
const L8 = 8;

/** Runs the chain until it settles, one transition per call, returning how many calls changed state. */
function settle(state: ReturnType<typeof makeState>, now: number, level: number, hasPrice = allPriced, welcomeOwned = false): number {
  let changed = 0;
  while (tickOffers(cfg, state, now, level, hasPrice, welcomeOwned)) changed++;
  return changed;
}

describe('OfferChain — base transitions (REVIEW 2026-09-08 №41, 21 scenarios)', () => {
  test('[1] below startLevel (L7): the welcome does not start, tick=false, state untouched', () => {
    const state = makeState();
    expect(tickOffers(cfg, state, T0, 7, allPriced, false)).toBe(false);
    expect(state.snapshot()).toEqual(makeState().snapshot());
    expect(activeOffer(cfg, state, T0)).toBeNull();
  });

  test('[2] L8 with a catalog price: the welcome activates, until = now + 12h, tick=true', () => {
    const state = makeState();
    expect(tickOffers(cfg, state, T0, L8, allPriced, false)).toBe(true);
    expect(state.get('welcome')).toBe(OFFER_WELCOME.ACTIVE);
    expect(state.get('until')).toBe(T0 + 12 * HOUR);
    expect(activeOffer(cfg, state, T0)).toBe(cfg.welcome);
    expect(activeOffer(cfg, state, T0 + 12 * HOUR - 1)).toBe(cfg.welcome);
  });

  test('[3] L8 without a price on the welcome product: tick=false and isChainBlocked=true', () => {
    const state = makeState();
    const noWelcome = pricedExcept('starter_pack');
    expect(tickOffers(cfg, state, T0, L8, noWelcome, false)).toBe(false);
    expect(state.get('welcome')).toBe(OFFER_WELCOME.NEW);
    expect(isChainBlocked(cfg, state, T0, L8, noWelcome, false)).toBe(true);
    // not blocked below the start level or when the welcome is owned
    expect(isChainBlocked(cfg, state, T0, 7, noWelcome, false)).toBe(false);
    expect(isChainBlocked(cfg, state, T0, L8, noWelcome, true)).toBe(false);
  });

  test('[4] welcome expiry: welcome=2, tier=0, until=0, nextTier=1, nextAt=now+48h, declined=1, declinedAt=now', () => {
    const state = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    const expiry = T0 + 12 * HOUR;
    expect(tickOffers(cfg, state, expiry - 1, L8, allPriced, false)).toBe(false);
    expect(tickOffers(cfg, state, expiry, L8, allPriced, false)).toBe(true);
    expect(state.snapshot()).toMatchObject({
      welcome: OFFER_WELCOME.DONE,
      activeTier: 0,
      until: 0,
      nextTier: 1,
      nextAt: expiry + 2 * DAY,
      declined: 1,
      declinedAt: expiry
    });
    expect(activeOffer(cfg, state, expiry)).toBeNull();
  });

  test('[5] welcome purchased while active: welcome=2, nextTier=2, nextAt=now+24h, declined=0, moved=true', () => {
    const state = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    const now = T0 + HOUR;
    expect(onOfferPurchased(cfg, state, 'starter_pack', now)).toBe(true);
    expect(state.snapshot()).toMatchObject({ welcome: OFFER_WELCOME.DONE, activeTier: 0, until: 0, nextTier: 2, nextAt: now + DAY, declined: 0, declinedAt: 0 });
    expect(activeOffer(cfg, state, now)).toBeNull();
  });

  test('[6] welcome already owned (starter pack bought before the chain): welcome=2, nextTier=2 in 24h, nothing shown', () => {
    const state = makeState();
    expect(tickOffers(cfg, state, T0, L8, allPriced, true)).toBe(true);
    expect(state.snapshot()).toMatchObject({ welcome: OFFER_WELCOME.DONE, activeTier: 0, until: 0, nextTier: 2, nextAt: T0 + DAY, declined: 0 });
    expect(activeOffer(cfg, state, T0)).toBeNull();
    // T4a wins over T4b: owned + no price still goes straight to the ladder
    const other = makeState();
    expect(tickOffers(cfg, other, T0, L8, pricedExcept('starter_pack'), true)).toBe(true);
    expect(other.get('welcome')).toBe(OFFER_WELCOME.DONE);
  });

  test('[7] before nextAt nothing activates', () => {
    const state = cooldownState(1, T0 + 2 * DAY);
    expect(tickOffers(cfg, state, T0, L8, allPriced, false)).toBe(false);
    expect(tickOffers(cfg, state, T0 + 2 * DAY - 1, L8, allPriced, false)).toBe(false);
    expect(state.get('activeTier')).toBe(0);
    expect(isChainBlocked(cfg, state, T0, L8, allPriced, false)).toBe(false);
  });

  test('[8] at nextAt: tier 1 variant A activates, seenMask bit 1, variantMask bit 1 = 0, until = now + 24h', () => {
    const at = T0 + 2 * DAY;
    const state = cooldownState(1, at);
    expect(tickOffers(cfg, state, at, L8, allPriced, false)).toBe(true);
    expect(state.snapshot()).toMatchObject({ activeTier: 1, activeVariant: 0, seenMask: 0b1, variantMask: 0b0, until: at + DAY });
    expect(activeOffer(cfg, state, at)?.productId).toBe('offer_t1_a');
  });

  test('[9] tier 1 expiry stays on tier 1: nextTier=1, declined=2 (code of t1 A), nextAt = now + 48h', () => {
    const state = makeState({ welcome: 2, activeTier: 1, activeVariant: 0, seenMask: 1, variantMask: 0, until: T0 + DAY });
    const expiry = T0 + DAY;
    expect(tickOffers(cfg, state, expiry, L8, allPriced, false)).toBe(true);
    expect(state.snapshot()).toMatchObject({ activeTier: 0, until: 0, nextTier: 1, nextAt: expiry + 2 * DAY, declined: 2, declinedAt: expiry });
  });

  test('[10] the second visit to tier 1 shows variant B', () => {
    const state = cooldownState(1, T0, { seenMask: 0b1, variantMask: 0b0 });
    expect(tickOffers(cfg, state, T0, L8, allPriced, false)).toBe(true);
    expect(activeOffer(cfg, state, T0)?.productId).toBe('offer_t1_b');
    expect(state.get('variantMask')).toBe(0b1);
  });

  test('[11] tier 1 purchased: nextTier=2 in 24h, declined cleared', () => {
    const state = makeState({ welcome: 2, activeTier: 1, activeVariant: 0, seenMask: 1, until: T0 + DAY });
    expect(onOfferPurchased(cfg, state, 'offer_t1_a', T0 + HOUR)).toBe(true);
    expect(state.snapshot()).toMatchObject({ activeTier: 0, until: 0, nextTier: 2, nextAt: T0 + HOUR + DAY, declined: 0, declinedAt: 0 });
  });

  test('[12] purchases climb the ladder from tier 1 to tier 6', () => {
    const state = cooldownState(1, T0);
    let now = T0;
    const climbed: string[] = [];
    for (let expected = 1; expected <= 6; expected++) {
      expect(tickOffers(cfg, state, now, L8, allPriced, false)).toBe(true);
      const active = activeOffer(cfg, state, now)!;
      expect(active.tier).toBe(expected);
      climbed.push(active.productId);
      expect(onOfferPurchased(cfg, state, active.productId, now + 10)).toBe(true);
      expect(state.get('nextTier')).toBe(Math.min(6, expected + 1));
      now = state.get('nextAt');
    }
    expect(climbed).toEqual(['offer_t1_a', 'offer_t2_a', 'offer_t3_a', 'offer_t4_a', 'offer_t5_a', 'offer_t6_a']);
  });

  test('[13] tier 6 purchased stays on tier 6 and the next visit shows the opposite variant', () => {
    const state = makeState({ welcome: 2, activeTier: 6, activeVariant: 0, seenMask: 0b111111, variantMask: 0, until: T0 + DAY });
    expect(onOfferPurchased(cfg, state, 'offer_t6_a', T0)).toBe(true);
    expect(state.get('nextTier')).toBe(6);
    expect(state.get('nextAt')).toBe(T0 + DAY);
    expect(tickOffers(cfg, state, T0 + DAY, L8, allPriced, false)).toBe(true);
    expect(activeOffer(cfg, state, T0 + DAY)?.productId).toBe('offer_t6_b');
  });

  test('[14] tier 6 expiry → tier 5', () => {
    const state = makeState({ welcome: 2, activeTier: 6, activeVariant: 1, seenMask: 0b111111, variantMask: 0b100000, until: T0 + DAY });
    expect(tickOffers(cfg, state, T0 + DAY, L8, allPriced, false)).toBe(true);
    expect(state.snapshot()).toMatchObject({ nextTier: 5, nextAt: T0 + DAY + 2 * DAY, declined: 2 + 5 * 2 + 1 });
    expect(tickOffers(cfg, state, state.get('nextAt'), L8, allPriced, false)).toBe(true);
    expect(activeOffer(cfg, state, state.get('nextAt'))?.tier).toBe(5);
  });

  test('[15] revisiting a seen tier flips the variant each time (A → B → A)', () => {
    const state = cooldownState(3, T0);
    const shown: string[] = [];
    let now = T0;
    for (let i = 0; i < 3; i++) {
      expect(tickOffers(cfg, state, now, L8, allPriced, false)).toBe(true);
      shown.push(activeOffer(cfg, state, now)!.productId);
      // expire → tier below; buy the tier below → back to tier 3
      now = state.get('until');
      expect(tickOffers(cfg, state, now, L8, allPriced, false)).toBe(true);
      now = state.get('nextAt');
      expect(tickOffers(cfg, state, now, L8, allPriced, false)).toBe(true);
      expect(activeOffer(cfg, state, now)!.tier).toBe(2);
      expect(onOfferPurchased(cfg, state, activeOffer(cfg, state, now)!.productId, now)).toBe(true);
      now = state.get('nextAt');
    }
    expect(shown).toEqual(['offer_t3_a', 'offer_t3_b', 'offer_t3_a']);
  });

  test('[16] one active offer at a time: a tick while an offer is active changes nothing', () => {
    const state = makeState({ welcome: 2, activeTier: 2, activeVariant: 0, seenMask: 0b11, until: T0 + DAY, nextTier: 2, nextAt: T0 - 1 });
    for (const now of [T0, T0 + HOUR, T0 + DAY - 1]) {
      expect(tickOffers(cfg, state, now, L8, allPriced, false)).toBe(false);
    }
    expect(activeOffer(cfg, state, T0)?.productId).toBe('offer_t2_a');
    const welcome = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    expect(tickOffers(cfg, welcome, T0 + HOUR, L8, allPriced, false)).toBe(false);
  });

  test('[17] a purchase of another chain product while a different offer is active: moved=false, state untouched', () => {
    const state = makeState({ welcome: 2, activeTier: 2, activeVariant: 0, seenMask: 0b11, until: T0 + DAY });
    const before = state.snapshot();
    expect(onOfferPurchased(cfg, state, 'offer_t5_b', T0)).toBe(false);
    expect(onOfferPurchased(cfg, state, 'offer_t2_b', T0)).toBe(false); // the other variant of the same tier
    expect(state.snapshot()).toEqual(before);
    // a ladder product bought while the welcome is active does not move the chain either
    const welcome = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    expect(onOfferPurchased(cfg, welcome, 'offer_t1_a', T0)).toBe(false);
    expect(welcome.get('welcome')).toBe(OFFER_WELCOME.ACTIVE);
  });

  test('[18] a product outside the chain: offerByProduct=null and onOfferPurchased=false', () => {
    const state = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    expect(offerByProduct(cfg, 'gold_purchase_1')).toBeNull();
    expect(offerByProduct(cfg, '')).toBeNull();
    expect(onOfferPurchased(cfg, state, 'gold_purchase_1', T0)).toBe(false);
    expect(state.get('welcome')).toBe(OFFER_WELCOME.ACTIVE);
    // and the chain products are all found
    expect(offerByProduct(cfg, 'starter_pack')).toBe(cfg.welcome);
    expect(offerByProduct(cfg, 'offer_t4_b')).toBe(cfg.tiers[3]![1]);
  });

  test('[19] activeOffer edge cases: null when until <= now, when the tier is outside 1..6, when welcome=0', () => {
    expect(activeOffer(cfg, makeState({ welcome: 1, until: T0 }), T0)).toBeNull();
    expect(activeOffer(cfg, makeState({ welcome: 1, until: T0 + 1 }), T0)).toBe(cfg.welcome);
    expect(activeOffer(cfg, makeState({ welcome: 2, activeTier: 0, until: T0 + DAY }), T0)).toBeNull();
    expect(activeOffer(cfg, makeState({ welcome: 2, activeTier: 7, until: T0 + DAY }), T0)).toBeNull();
    expect(activeOffer(cfg, makeState({ welcome: 0, activeTier: 0, until: T0 + DAY }), T0)).toBeNull();
    // activeVariant is read as `=== 1 ? B : A`: any other value means A
    expect(activeOffer(cfg, makeState({ welcome: 2, activeTier: 3, activeVariant: 5, until: T0 + DAY }), T0)?.productId).toBe('offer_t3_a');
    expect(activeOffer(cfg, makeState({ welcome: 2, activeTier: 3, activeVariant: 1, until: T0 + DAY }), T0)?.productId).toBe('offer_t3_b');
  });

  test('[20] secondsLeft: until − now while active, 0 when inactive or expired', () => {
    const state = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    expect(secondsLeft(cfg, state, T0)).toBe(12 * HOUR);
    expect(secondsLeft(cfg, state, T0 + 12 * HOUR - 1)).toBe(1);
    expect(secondsLeft(cfg, state, T0 + 12 * HOUR)).toBe(0);
    expect(secondsLeft(cfg, state, T0 + 13 * HOUR)).toBe(0);
    expect(secondsLeft(cfg, makeState(), T0)).toBe(0);
  });

  test('[21] one transition per tick: the welcome expiry and the next activation never happen in one call', () => {
    // nextAt is already in the past relative to the expiry moment (a 3-day gap): still two ticks
    const state = makeState({ welcome: 1, until: T0 + 12 * HOUR });
    const late = T0 + 12 * HOUR + 3 * DAY;
    expect(tickOffers(cfg, state, late, L8, allPriced, false)).toBe(true);
    expect(state.get('welcome')).toBe(OFFER_WELCOME.DONE);
    expect(state.get('activeTier')).toBe(0);
    expect(state.get('nextAt')).toBe(late + 2 * DAY); // the cooldown counts from the observed now
    expect(tickOffers(cfg, state, late, L8, allPriced, false)).toBe(false);
    expect(tickOffers(cfg, state, late + 2 * DAY, L8, allPriced, false)).toBe(true);
    expect(activeOffer(cfg, state, late + 2 * DAY)?.productId).toBe('offer_t1_a');
    // a tier expiry followed by its successor is two calls as well
    const tierState = makeState({ welcome: 2, activeTier: 3, activeVariant: 0, seenMask: 0b111, until: T0 });
    expect(settle(tierState, T0, L8)).toBe(1);
    expect(settle(tierState, T0 + 2 * DAY, L8)).toBe(1);
    expect(activeOffer(cfg, tierState, T0 + 2 * DAY)?.tier).toBe(2);
  });
});

describe('OfferChain — REVIEW 2026-09-15 №2 late purchase, №3 catalog gate, №13 clock clamp (18 scenarios)', () => {
  test('[22] late welcome purchase within 24h after its expiry counts as bought: nextTier=2 in 24h', () => {
    const state = makeState({ welcome: 1, until: T0 });
    expect(tickOffers(cfg, state, T0, L8, allPriced, false)).toBe(true); // expired → declined=1
    const late = T0 + 23 * HOUR;
    expect(onOfferPurchased(cfg, state, 'starter_pack', late)).toBe(true);
    expect(state.snapshot()).toMatchObject({ welcome: OFFER_WELCOME.DONE, activeTier: 0, nextTier: 2, nextAt: late + DAY, declined: 0, declinedAt: 0 });
  });

  test('[23] late tier purchase within 24h after its expiry counts as bought: the ladder climbs', () => {
    const state = makeState({ welcome: 2, activeTier: 3, activeVariant: 1, seenMask: 0b111, variantMask: 0b100, until: T0 });
    expect(tickOffers(cfg, state, T0, L8, allPriced, false)).toBe(true); // expired → nextTier 2, declined = 2 + 2*2 + 1 = 7
    expect(state.get('declined')).toBe(7);
    expect(onOfferPurchased(cfg, state, 'offer_t3_b', T0 + DAY - 1)).toBe(true);
    expect(state.snapshot()).toMatchObject({ nextTier: 4, nextAt: T0 + DAY - 1 + DAY, declined: 0 });
  });

  test('[24] a late purchase more than 24h after the expiry does not move the chain (the product is still granted by the host)', () => {
    const state = makeState({ welcome: 2, activeTier: 3, activeVariant: 0, seenMask: 0b111, until: T0 });
    tickOffers(cfg, state, T0, L8, allPriced, false);
    const before = state.snapshot();
    expect(onOfferPurchased(cfg, state, 'offer_t3_a', T0 + DAY + 1)).toBe(false);
    expect(state.snapshot()).toEqual(before);
    expect(offerByProduct(cfg, 'offer_t3_a')?.rewards).toEqual([{ id: 'coins', amount: 12000 }, { id: 'lives_unlimited_sec', amount: 12 * HOUR }, { id: 'bulbs', amount: 5 }]);
  });

  test('[25] a late purchase while the next offer is already active (activeTier ≠ 0) does not move the chain', () => {
    const state = makeState({ welcome: 2, activeTier: 3, activeVariant: 0, seenMask: 0b111, until: T0 });
    tickOffers(cfg, state, T0, L8, allPriced, false); // t3 A expired → nextTier 2 in 48h
    const activation = state.get('nextAt');
    expect(tickOffers(cfg, state, activation, L8, allPriced, false)).toBe(true); // t2 active
    expect(activeOffer(cfg, state, activation)?.tier).toBe(2);
    // the receipt of t3 A arrives an hour later: 49 h after its expiry, and t2 is on screen anyway
    const before = state.snapshot();
    expect(onOfferPurchased(cfg, state, 'offer_t3_a', activation + HOUR)).toBe(false);
    expect(state.snapshot()).toEqual(before);
    // even inside the window: a declined welcome whose successor is already active
    const welcome = makeState({ welcome: 2, activeTier: 1, activeVariant: 0, seenMask: 1, until: T0 + DAY, declined: 1, declinedAt: T0 - HOUR });
    expect(onOfferPurchased(cfg, welcome, 'starter_pack', T0)).toBe(false);
    expect(welcome.get('activeTier')).toBe(1);
  });

  test('[26] a declined code that does not match the purchased product does not move the chain', () => {
    const state = makeState({ welcome: 2, activeTier: 0, until: 0, nextTier: 2, nextAt: T0 + 2 * DAY, declined: 2 + 2 * 2 + 0, declinedAt: T0 });
    const before = state.snapshot();
    expect(onOfferPurchased(cfg, state, 'offer_t3_b', T0 + HOUR)).toBe(false); // t3 B ≠ declined t3 A
    expect(onOfferPurchased(cfg, state, 'offer_t2_a', T0 + HOUR)).toBe(false);
    expect(onOfferPurchased(cfg, state, 'starter_pack', T0 + HOUR)).toBe(false);
    expect(state.snapshot()).toEqual(before);
    expect(onOfferPurchased(cfg, state, 'offer_t3_a', T0 + HOUR)).toBe(true);
  });

  test('[27] pickAvailableOffer: the preferred variant has no price → the other variant of the same tier', () => {
    const state = makeState({ seenMask: 0, variantMask: 0 });
    expect(pickAvailableOffer(cfg, state, 4, pricedExcept('offer_t4_a'))?.productId).toBe('offer_t4_b');
    // on a revisit the preferred variant is B; without a price on B, A is taken
    const revisit = makeState({ seenMask: 0b1000, variantMask: 0 });
    expect(pickAvailableOffer(cfg, revisit, 4, allPriced)?.productId).toBe('offer_t4_b');
    expect(pickAvailableOffer(cfg, revisit, 4, pricedExcept('offer_t4_b'))?.productId).toBe('offer_t4_a');
  });

  test('[28] pickAvailableOffer: the whole tier is unpriced → the tier below first, then the tier above', () => {
    const state = makeState();
    expect(pickAvailableOffer(cfg, state, 4, pricedExcept('offer_t4_a', 'offer_t4_b'))?.productId).toBe('offer_t3_a');
    expect(pickAvailableOffer(cfg, state, 4, pricedExcept('offer_t4_a', 'offer_t4_b', 'offer_t3_a', 'offer_t3_b'))?.productId).toBe('offer_t5_a');
    expect(pickAvailableOffer(cfg, state, 4, pricedOnly('offer_t2_b', 'offer_t6_a'))?.productId).toBe('offer_t2_b');
    expect(pickAvailableOffer(cfg, state, 4, pricedOnly('offer_t6_a', 'offer_t1_a'))?.productId).toBe('offer_t6_a');
    expect(pickAvailableOffer(cfg, state, 4, pricedOnly('offer_t1_b'))?.productId).toBe('offer_t1_b');
  });

  test('[29] pickAvailableOffer: nothing in the ladder is priced → null, and isChainBlocked=true when a tier is due', () => {
    const none = () => false;
    const state = cooldownState(3, T0);
    expect(pickAvailableOffer(cfg, state, 3, none)).toBeNull();
    expect(tickOffers(cfg, state, T0, L8, none, false)).toBe(false);
    expect(isChainBlocked(cfg, state, T0, L8, none, false)).toBe(true);
    // not blocked while the cooldown is still running, below the start level, or with an active offer
    expect(isChainBlocked(cfg, cooldownState(3, T0 + 1), T0, L8, none, false)).toBe(false);
    expect(isChainBlocked(cfg, state, T0, 7, none, false)).toBe(false);
    expect(isChainBlocked(cfg, makeState({ welcome: 2, activeTier: 2, until: T0 + DAY }), T0, L8, none, false)).toBe(false);
  });

  test('[30] partial catalog: the actually chosen tier/variant is recorded and nextTier is not rewritten', () => {
    const state = cooldownState(4, T0);
    const gate = pricedExcept('offer_t4_a', 'offer_t4_b');
    expect(tickOffers(cfg, state, T0, L8, gate, false)).toBe(true);
    expect(state.snapshot()).toMatchObject({ activeTier: 3, activeVariant: 0, seenMask: 0b100, variantMask: 0, nextTier: 4, until: T0 + DAY });
    expect(activeOffer(cfg, state, T0)?.productId).toBe('offer_t3_a');
    // the next finish counts from the tier that was actually shown: bought t3 → t4
    expect(onOfferPurchased(cfg, state, 'offer_t3_a', T0 + 1)).toBe(true);
    expect(state.get('nextTier')).toBe(4);
  });

  test('[31] clampOfferTimes: until from the future → now + 24h', () => {
    const state = makeState({ welcome: 1, until: T0 + 400 * DAY });
    expect(clampOfferTimes(cfg, state, T0)).toBe(true);
    expect(state.get('until')).toBe(T0 + DAY);
    expect(activeOffer(cfg, state, T0)).toBe(cfg.welcome);
  });

  test('[32] clampOfferTimes: nextAt from the future → now + 48h', () => {
    const state = cooldownState(2, T0 + 400 * DAY);
    expect(clampOfferTimes(cfg, state, T0)).toBe(true);
    expect(state.get('nextAt')).toBe(T0 + 2 * DAY);
    expect(tickOffers(cfg, state, T0 + 2 * DAY, L8, allPriced, false)).toBe(true);
  });

  test('[33] clampOfferTimes: declinedAt from the future → now', () => {
    const state = cooldownState(2, T0 + DAY, { declined: 4, declinedAt: T0 + 30 * DAY });
    expect(clampOfferTimes(cfg, state, T0)).toBe(true);
    expect(state.get('declinedAt')).toBe(T0);
    // a late purchase of the declined offer is measured from the repaired time
    expect(onOfferPurchased(cfg, state, 'offer_t2_a', T0 + DAY - 1)).toBe(true);
  });

  test('[34] clampOfferTimes returns false with nothing to repair and is idempotent', () => {
    const fine = makeState({ welcome: 1, until: T0 + 12 * HOUR, nextAt: T0 + 2 * DAY, declinedAt: T0 });
    const before = fine.snapshot();
    expect(clampOfferTimes(cfg, fine, T0)).toBe(false);
    expect(fine.snapshot()).toEqual(before);
    const future = makeState({ welcome: 1, until: T0 + 10 * DAY, nextAt: T0 + 10 * DAY, declinedAt: T0 + 10 * DAY });
    expect(clampOfferTimes(cfg, future, T0)).toBe(true);
    const repaired = future.snapshot();
    expect(clampOfferTimes(cfg, future, T0)).toBe(false);
    expect(future.snapshot()).toEqual(repaired);
  });

  test('[35] the late-purchase window is strict: exactly 24h after the expiry is too late', () => {
    const state = makeState({ welcome: 2, activeTier: 2, activeVariant: 0, seenMask: 0b11, until: T0 });
    tickOffers(cfg, state, T0, L8, allPriced, false);
    const copy = makeState(state.snapshot());
    expect(onOfferPurchased(cfg, copy, 'offer_t2_a', T0 + DAY)).toBe(false);
    expect(onOfferPurchased(cfg, state, 'offer_t2_a', T0 + DAY - 1)).toBe(true);
  });

  test('[36] declined codes: welcome=1, t1A=2, t1B=3, t6B=13; a purchase clears them', () => {
    const codes: Array<[Partial<Record<'welcome' | 'activeTier' | 'activeVariant', number>>, number]> = [
      [{ welcome: 1 }, 1],
      [{ welcome: 2, activeTier: 1, activeVariant: 0 }, 2],
      [{ welcome: 2, activeTier: 1, activeVariant: 1 }, 3],
      [{ welcome: 2, activeTier: 6, activeVariant: 1 }, 13]
    ];
    for (const [init, code] of codes) {
      const state = makeState({ ...init, until: T0 });
      tickOffers(cfg, state, T0, L8, allPriced, false);
      expect(state.get('declined')).toBe(code);
    }
    const bought = makeState({ welcome: 2, activeTier: 0, nextTier: 1, nextAt: T0 + 2 * DAY, declined: 3, declinedAt: T0 });
    expect(onOfferPurchased(cfg, bought, 'offer_t1_b', T0 + 1)).toBe(true);
    expect(bought.get('declined')).toBe(0);
    expect(bought.get('declinedAt')).toBe(0);
  });

  test('[37] the catalog is live: a price that appears later activates the offer on the next tick', () => {
    const catalog = new Set<string>();
    const gate = (id: string) => catalog.has(id);
    const state = makeState();
    expect(tickOffers(cfg, state, T0, L8, gate, false)).toBe(false);
    expect(tickOffers(cfg, state, T0 + 5, L8, gate, false)).toBe(false);
    catalog.add('starter_pack');
    expect(tickOffers(cfg, state, T0 + 10, L8, gate, false)).toBe(true);
    expect(state.get('until')).toBe(T0 + 10 + 12 * HOUR);
    // same for a due tier
    const due = cooldownState(2, T0);
    expect(tickOffers(cfg, due, T0, L8, gate, false)).toBe(false);
    catalog.add('offer_t2_b');
    expect(tickOffers(cfg, due, T0 + 1, L8, gate, false)).toBe(true);
    expect(activeOffer(cfg, due, T0 + 1)?.productId).toBe('offer_t2_b');
  });

  test('[38] neighbour order across the ladder is [w, w−1, w+1, w−2, w+2, …] clipped to 1..6', () => {
    const order = (wanted: number): number[] => {
      const seen: number[] = [];
      pickAvailableOffer(cfg, makeState(), wanted, (id) => {
        const t = Number(id.charAt(7));
        if (id.endsWith('_a')) seen.push(t);
        return false;
      });
      return seen;
    };
    expect(order(3)).toEqual([3, 2, 4, 1, 5, 6]);
    expect(order(1)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(order(6)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(order(4)).toEqual([4, 3, 5, 2, 6, 1]);
  });

  test('[39] expiries are processed below startLevel (T1/T2 come before the level gate), activations are not', () => {
    const welcome = makeState({ welcome: 1, until: T0 });
    expect(tickOffers(cfg, welcome, T0, 3, allPriced, false)).toBe(true);
    expect(welcome.get('welcome')).toBe(OFFER_WELCOME.DONE);
    const tier = makeState({ welcome: 2, activeTier: 2, activeVariant: 0, until: T0 });
    expect(tickOffers(cfg, tier, T0, 3, allPriced, false)).toBe(true);
    expect(tier.get('activeTier')).toBe(0);
    expect(tier.get('nextTier')).toBe(1);
    // …but the next tier waits for the level, even when nextAt has passed
    expect(tickOffers(cfg, tier, T0 + 3 * DAY, 3, allPriced, false)).toBe(false);
    expect(tickOffers(cfg, tier, T0 + 3 * DAY, L8, allPriced, false)).toBe(true);
  });

  test('a saved nextTier of 0 (or out of range) is clamped to 1..6 when the tier is due', () => {
    const zero = cooldownState(0, T0);
    expect(tickOffers(cfg, zero, T0, L8, allPriced, false)).toBe(true);
    expect(activeOffer(cfg, zero, T0)?.tier).toBe(1);
    const high = cooldownState(9, T0);
    expect(tickOffers(cfg, high, T0, L8, allPriced, false)).toBe(true);
    expect(activeOffer(cfg, high, T0)?.tier).toBe(6);
  });
});
