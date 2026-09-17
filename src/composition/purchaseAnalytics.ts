// Composition-level wiring: PurchaseRuntime → AnalyticsRuntime. Like `offerAnalytics.ts`, this file
// knows both runtimes only as types; a host plugs it in where it builds its core and chains its
// own handler behind it (save the profile, move the offer chain):
//
//   const purchases = new PurchaseRuntime({
//     …,
//     resolveGrant: (productId) => offers.offerByProduct(productId)?.rewards ?? shopRewards[productId],
//     onEvent: createPurchaseAnalyticsHandler(analytics, priceOf, (event) => {
//       if (event.type !== 'granted') return;
//       offers.onPurchased(event.productId);
//       profile.save();
//     })
//   });
//
// PurchaseRuntime never imports OfferRuntime or AnalyticsRuntime — the handler above is the link.
import type { AnalyticsEventData, AnalyticsPurchaseEvent } from '../analytics/types';
import type { PurchaseEvent, PurchaseEventHandler } from '../purchases/types';

/** What the handler needs from the analytics side — `AnalyticsRuntime` satisfies it. */
export interface PurchaseAnalyticsSink {
  interaction(action: string, data?: AnalyticsEventData): boolean;
  purchase(event: AnalyticsPurchaseEvent): boolean;
}

/** The money of a product from the host's REAL catalog, in the platform's currency (donor: `Balance.productPriceAmount`). */
export interface PurchasePrice {
  revenue: number;
  currency: string;
  /** Hazar `offer_name` when the game names the product differently; defaults to the product id. */
  offerName?: string;
}

/** Nothing → the purchase event goes out without `revenue` / `currency`; a price is never made up here. */
export type PurchasePriceResolver = (productId: string) => PurchasePrice | null | undefined;

export interface PurchaseAnalyticsRecord {
  action:
    | 'purchase_started'
    | 'purchase_ok'
    | 'purchase_restored'
    | 'purchase_cancelled'
    | 'purchase_error'
    | 'purchase_duplicate'
    | 'purchase_consume_failed';
  data: AnalyticsEventData;
  /** The Hazar `purchase` (revenue) event — only for a grant, direct or restored. */
  purchase?: AnalyticsPurchaseEvent;
}

/**
 * The analytics of a PurchaseRuntime event: one `interaction` per event (the funnel — started / ok /
 * cancelled / error / restored, plus the duplicate and consume diagnostics) and, for `granted`
 * only, the Hazar `purchase` event with `offer_name` / `revenue` / `currency` / `order_id` /
 * `source`. `granted` is the single money point for direct AND restored purchases (donor: restored
 * receipts used to miss the revenue). `no_token: 1` marks a grant that could not be deduplicated
 * (donor: `restore_no_payment_id`).
 */
export function purchaseEventToAnalytics(event: PurchaseEvent, price?: PurchasePriceResolver): PurchaseAnalyticsRecord {
  switch (event.type) {
    case 'started':
      return { action: 'purchase_started', data: { product: event.productId, source: event.source } };
    case 'cancelled':
      return { action: 'purchase_cancelled', data: { product: event.productId, source: event.source } };
    case 'duplicate':
      return { action: 'purchase_duplicate', data: { product: event.productId, order_id: event.token, source: event.source, restored: event.restored ? 1 : 0 } };
    case 'consume_failed':
      return { action: 'purchase_consume_failed', data: { product: event.productId, order_id: event.token, restored: event.restored ? 1 : 0 } };
    case 'error':
      return {
        action: 'purchase_error',
        data: { product: event.productId, order_id: event.token, source: event.source, reason: event.reason, restored: event.restored ? 1 : 0 }
      };
    case 'granted': {
      const money = price?.(event.productId) ?? undefined;
      const source = event.source ?? (event.restored ? 'restore' : undefined);
      // `exactOptionalPropertyTypes`: an unknown field is left out, never sent as undefined
      const purchase: AnalyticsPurchaseEvent = { offerName: money?.offerName ?? event.productId, status: event.restored ? 'restore' : 'success' };
      if (purchase.offerName !== event.productId) purchase.productId = event.productId;
      if (money) {
        purchase.revenue = money.revenue;
        purchase.currency = money.currency;
      }
      if (event.token !== undefined) purchase.orderId = event.token;
      if (source !== undefined) purchase.source = source;
      return {
        action: event.restored ? 'purchase_restored' : 'purchase_ok',
        data: {
          product: event.productId,
          order_id: event.token,
          source,
          requested: event.requestedProductId !== undefined && event.requestedProductId !== event.productId ? event.requestedProductId : undefined,
          no_token: event.token === undefined ? 1 : undefined
        },
        purchase
      };
    }
  }
}

/**
 * A `PurchaseRuntime` `onEvent` that logs the whole purchase funnel. `next` keeps the host's own
 * handler in the chain and runs even when the analytics side throws (it is the one that saves the
 * profile); the throw then lands in the runtime's `onPurchaseError`.
 */
export function createPurchaseAnalyticsHandler<TGrant = unknown>(
  analytics: PurchaseAnalyticsSink,
  price?: PurchasePriceResolver,
  next?: PurchaseEventHandler<TGrant>
): PurchaseEventHandler<TGrant> {
  return (event) => {
    try {
      const record = purchaseEventToAnalytics(event, price);
      analytics.interaction(record.action, record.data);
      if (record.purchase) analytics.purchase(record.purchase);
    } finally {
      // the host's handler saves the profile — it must run even when the analytics side threw
      next?.(event);
    }
  };
}
