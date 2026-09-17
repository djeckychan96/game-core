// ADS_RUNTIME_EXTRACTION_MAP §7 F43–F44 + the PurchaseRuntime → markPayer bridge.
import { expect, test } from 'vitest';
import { AnalyticsRuntime } from '../../src/analytics';
import { adsEventToAnalytics, createAdsAnalyticsHandler } from '../../src/composition/adsAnalytics';
import { createPurchaseAdsHandler, isConfirmedPayment } from '../../src/composition/purchaseAds';
import { makeAds } from '../ads/fixtures';
import { FakeTransport, makeContext } from '../analytics/fixtures';
import { makeHost } from '../purchases/fixtures';

test('F43: shown → advertisement{status: complete}; offered → ad_offered; denied → ad_denied with its reason', () => {
  expect(adsEventToAnalytics({ type: 'shown', placement: 'level_win_inter', adType: 'inter', segmentId: 'np_1', level: 15, day: 1, hour: 1 })).toEqual({
    kind: 'advertisement', event: { type: 'interstitial', placement: 'level_win_inter', status: 'complete' } // the donor's names: "interstitial" / "rewarded"
  });
  expect(adsEventToAnalytics({ type: 'shown', placement: 'ad_level_win_x2_rewarded', adType: 'rewarded', segmentId: 'pay_4', level: 30, day: 2, hour: 1 })).toEqual({
    kind: 'advertisement', event: { type: 'rewarded', placement: 'ad_level_win_x2_rewarded', status: 'complete' }
  });
  expect(adsEventToAnalytics({ type: 'shown', placement: 'typo', adType: null, segmentId: null, level: 1, day: 1, hour: 1 })).toMatchObject({ event: { type: 'unknown' } });
  expect(adsEventToAnalytics({ type: 'offered', placement: 'ad_extra_moves_rewarded', adType: 'rewarded', segmentId: 'np_2', level: 22 })).toEqual({
    kind: 'interaction', action: 'ad_offered', data: { placement: 'ad_extra_moves_rewarded', type: 'rewarded', segment: 'np_2', level: 22 }
  });
  expect(adsEventToAnalytics({ type: 'denied', placement: 'level_fail_inter', adType: 'inter', reason: 'inter_cooldown', segmentId: 'np_2', level: 22 })).toEqual({
    kind: 'interaction', action: 'ad_denied', data: { placement: 'level_fail_inter', type: 'interstitial', segment: 'np_2', level: 22, reason: 'inter_cooldown' }
  });
});

test('F43–F44: a real AdsRuntime wired through onEvent logs the funnel, and the host\'s `next` handler still runs', async () => {
  const transport = new FakeTransport();
  const analytics = new AnalyticsRuntime({ transport, context: makeContext(), batchSize: 50 });
  const seen: string[] = [];
  const host = makeAds({ level: 15 }, { onEvent: createAdsAnalyticsHandler(analytics, (event) => seen.push(event.type)) });

  host.ads.canShowInter('level_win_inter');   // offered
  host.ads.registerShown('level_win_inter');  // the platform answered ok
  host.ads.canShowInter('level_fail_inter');  // denied: inter_cooldown
  host.ads.canShowRewarded('ad_level_win_x2_rewarded');
  host.ads.registerShown('ad_level_win_x2_rewarded');
  await analytics.flush();

  expect(seen).toEqual(['offered', 'shown', 'denied', 'offered', 'shown']);
  const events = transport.batches.flat().map((e) => e.event);
  expect(events.map((e) => (e.name === 'interaction' ? e.data.action : e.name))).toEqual(['ad_offered', 'advertisement', 'ad_denied', 'ad_offered', 'advertisement']);
  expect(events[1]!.data).toMatchObject({ type: 'interstitial', placement: 'level_win_inter', status: 'complete', profile_id: 'profile-1' });
  expect(events[1]!.data.revenue).toBeUndefined(); // the donor reports no ad revenue
  expect(events[2]!.data).toMatchObject({ action: 'ad_denied', reason: 'inter_cooldown', segment: 'np_1', level: 15, type: 'interstitial' });
  expect(events[4]!.data).toMatchObject({ type: 'rewarded', placement: 'ad_level_win_x2_rewarded', status: 'complete' });
  expect(host.ads.getStats().callbackErrors).toBe(0);
});

test('a rejected analytics event never disturbs the ad decisions', () => {
  const analytics = new AnalyticsRuntime({ transport: new FakeTransport(), context: makeContext({ profileId: '' }), onError: () => {} });
  const host = makeAds({ level: 15 }, { onEvent: createAdsAnalyticsHandler(analytics) });
  expect(host.ads.canShowInter('level_win_inter')).toBe(true);
  host.ads.registerShown('level_win_inter');
  expect(host.ads.getStats()).toMatchObject({ shown: 1, callbackErrors: 0 });
  expect(analytics.getStats()).toMatchObject({ rejected: 2, queued: 0 });
});

test('purchase → ads.markPayer: any payment the platform confirmed moves the player into the payer branch (no runtime imports the other)', async () => {
  const adsHost = makeAds({ level: 50 });
  const saves: string[] = [];
  const shop = makeHost({ onEvent: createPurchaseAdsHandler(adsHost.ads, (event) => saves.push(event.type)) });
  expect(adsHost.ads.segmentId()).toBe('np_3');

  shop.payments.mode = 'cancel';
  await shop.runtime.purchase('gold_1', 'shop');
  shop.payments.mode = 'throw';
  await shop.runtime.purchase('gold_1', 'shop');
  expect(adsHost.ads.segmentId()).toBe('np_3'); // no payment, no payer

  shop.payments.mode = 'ok';
  await shop.runtime.purchase('gold_1', 'shop');
  expect(adsHost.state.get('payer')).toBe(1);
  expect(adsHost.ads.segmentId()).toBe('pay_1'); // the sums are the host's: nothing recorded yet → avg 0 / max 0
  adsHost.pay(99);
  expect(adsHost.ads.segmentId()).toBe('pay_3');
  expect(adsHost.ads.canShowBanner()).toBe(false); // payers never see the banner
  expect(saves).toEqual(['started', 'cancelled', 'started', 'error', 'started', 'granted']);

  // donor: markPayer() runs on every status-ok answer, also when the product cannot be granted
  expect(isConfirmedPayment({ type: 'granted', productId: 'a', token: 't', rewards: 0, restored: true, source: undefined, requestedProductId: undefined })).toBe(true);
  for (const reason of ['no_grant', 'grant_threw', 'no_product_id'] as const) {
    expect(isConfirmedPayment({ type: 'error', reason, productId: 'a', token: 't', restored: false, source: undefined, error: undefined }), reason).toBe(true);
  }
  for (const reason of ['platform_error', 'adapter_threw', 'restore_failed'] as const) {
    expect(isConfirmedPayment({ type: 'error', reason, productId: 'a', token: undefined, restored: false, source: undefined, error: undefined }), reason).toBe(false);
  }
  expect(isConfirmedPayment({ type: 'cancelled', productId: 'a', source: undefined })).toBe(false);
  expect(isConfirmedPayment({ type: 'duplicate', productId: 'a', token: 't', restored: true, source: undefined })).toBe(false);
});
