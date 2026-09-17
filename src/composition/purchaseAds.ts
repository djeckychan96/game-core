// Composition-level wiring: PurchaseRuntime → AdsRuntime. Types only on both sides; a host chains
// it into the purchase runtime's `onEvent`:
//
//   onEvent: createPurchaseAnalyticsHandler(analytics, priceOf, createPurchaseAdsHandler(ads, saveProfile))
//
// Payment sums (`pay_count` / `pay_sum_cents` / `pay_max_cents`, which pick the pay_* segment)
// stay with the host's profile — AdsRuntime reads them through its input.
import type { PurchaseEvent, PurchaseEventHandler } from '../purchases/types';

/** What the bridge needs from the ads side — `AdsRuntime` satisfies it. */
export interface PurchaseAdsSink {
  markPayer(): void;
}

/**
 * Any payment the platform confirmed marks the player a payer (donor: `AdsGate.markPayer()` on
 * every `shop.purchase` answer with status ok — also when the product had no id or no reward
 * mapping). In PurchaseRuntime terms: `granted` (direct or restored) and the errors that can only
 * happen after a confirmed payment.
 */
export function isConfirmedPayment(event: PurchaseEvent): boolean {
  if (event.type === 'granted') return true;
  return event.type === 'error' && (event.reason === 'no_grant' || event.reason === 'grant_threw' || event.reason === 'no_product_id');
}

/** A `PurchaseRuntime` `onEvent` that marks the payer; `next` keeps the host's own handler in the chain. */
export function createPurchaseAdsHandler<TGrant = unknown>(ads: PurchaseAdsSink, next?: PurchaseEventHandler<TGrant>): PurchaseEventHandler<TGrant> {
  return (event) => {
    if (isConfirmedPayment(event)) ads.markPayer();
    next?.(event);
  };
}
