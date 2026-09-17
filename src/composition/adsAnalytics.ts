// Composition-level wiring: AdsRuntime → AnalyticsRuntime. Like `offerAnalytics.ts` and
// `purchaseAnalytics.ts`, this file knows both runtimes only as types; a host plugs it in where it
// builds its core:
//
//   const ads = new AdsRuntime({ …, onEvent: createAdsAnalyticsHandler(analytics) });
//
// AdsRuntime never imports AnalyticsRuntime — the handler above is the link.
import type { AnalyticsAdvertisementEvent, AnalyticsEventData } from '../analytics/types';
import type { AdPlacementType, AdsEvent, AdsEventHandler } from '../ads/types';

/** What the handler needs from the analytics side — `AnalyticsRuntime` satisfies it. */
export interface AdsAnalyticsSink {
  advertisement(event: AnalyticsAdvertisementEvent): boolean;
  interaction(action: string, data?: AnalyticsEventData): boolean;
}

export type AdsAnalyticsRecord =
  | { kind: 'advertisement'; event: AnalyticsAdvertisementEvent }
  | { kind: 'interaction'; action: 'ad_offered' | 'ad_denied'; data: AnalyticsEventData };

// Hazar / the donor name an interstitial in full; an unknown placement has no type to report
const analyticsAdType = (adType: AdPlacementType | null): string => (adType === 'inter' ? 'interstitial' : adType ?? 'unknown');

/**
 * The analytics of an AdsRuntime event.
 *
 * `shown` → the Hazar `advertisement` event `{ type, placement, status: 'complete' }`. The donor
 * sends `advertisement {type, placement}` WITHOUT a status, and only after the platform confirmed
 * the ad (`registerShown` and `trackAdvertisement` sit together behind `status === "ok"`);
 * `AnalyticsRuntime` requires a status, and `'complete'` is the one that states the same fact —
 * this event corresponds to a confirmed platform success. No revenue: the donor has none.
 *
 * `offered` / `denied` → `interaction('ad_offered' | 'ad_denied')` with the placement, type,
 * segment, level and the deny reason. The donor never sent them (its gate returned a bare
 * boolean); they are telemetry only and change nothing about eligibility.
 */
export function adsEventToAnalytics(event: AdsEvent): AdsAnalyticsRecord {
  if (event.type === 'shown') {
    return { kind: 'advertisement', event: { type: analyticsAdType(event.adType), placement: event.placement, status: 'complete' } };
  }
  const data: AnalyticsEventData = {
    placement: event.placement,
    type: analyticsAdType(event.adType),
    segment: event.segmentId ?? undefined,
    level: event.level
  };
  if (event.type === 'denied') return { kind: 'interaction', action: 'ad_denied', data: { ...data, reason: event.reason } };
  return { kind: 'interaction', action: 'ad_offered', data };
}

/** An `AdsRuntime` `onEvent` that logs every ad event; `next` keeps the host's own handler in the chain. */
export function createAdsAnalyticsHandler(analytics: AdsAnalyticsSink, next?: AdsEventHandler): AdsEventHandler {
  return (event) => {
    const record = adsEventToAnalytics(event);
    if (record.kind === 'advertisement') analytics.advertisement(record.event);
    else analytics.interaction(record.action, record.data);
    next?.(event);
  };
}
