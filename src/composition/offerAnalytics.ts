// Composition-level wiring: OfferRuntime → AnalyticsRuntime. The two runtimes never import each
// other — this file knows both only as types, and a host plugs it in where it builds its core:
//
//   const offers = new OfferRuntime({ …, onEvent: createOfferAnalyticsHandler(analytics) });
//
// Core-owned behavior is instrumented here, at composition level; gameplay adds its own events.
import type { AnalyticsEventData } from '../analytics/types';
import type { OfferEvent, OfferEventHandler } from '../offers/types';

/** What the handler needs from the analytics side — `AnalyticsRuntime` satisfies it. */
export interface OfferAnalyticsSink {
  interaction(action: string, data?: AnalyticsEventData): boolean;
}

export interface OfferAnalyticsRecord {
  action: 'offer_activated' | 'offer_expired' | 'offer_purchased' | 'offer_blocked_no_price';
  data: AnalyticsEventData;
}

/**
 * The Hazar `interaction` event of an OfferRuntime event. Actions and the `level` / `product`
 * fields are the ones Trail Arrow 0.1.22 already sends (`offer_activated`, `offer_expired`,
 * `offer_blocked_no_price`); `tier` / `variant` are added. `offer_purchased` reports the chain
 * move (`moved`) only — revenue belongs to the `purchase` event of the purchase flow, which stays
 * the single source of money.
 */
export function offerEventToAnalytics(event: OfferEvent): OfferAnalyticsRecord {
  if (event.type === 'blocked_no_price') return { action: 'offer_blocked_no_price', data: { level: event.level } };
  const data: AnalyticsEventData = {
    level: event.level,
    product: event.offer.productId,
    tier: event.offer.tier,
    variant: event.offer.variant === 1 ? 'b' : 'a'
  };
  if (event.type === 'purchased') return { action: 'offer_purchased', data: { ...data, moved: event.moved ? 1 : 0 } };
  return { action: event.type === 'activated' ? 'offer_activated' : 'offer_expired', data };
}

/** An `OfferRuntime` `onEvent` that logs every chain event; `next` keeps the host's own handler in the chain. */
export function createOfferAnalyticsHandler(analytics: OfferAnalyticsSink, next?: OfferEventHandler): OfferEventHandler {
  return (event) => {
    const record = offerEventToAnalytics(event);
    analytics.interaction(record.action, record.data);
    next?.(event);
  };
}
