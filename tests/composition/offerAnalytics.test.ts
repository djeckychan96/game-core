import { expect, test } from 'vitest';
import { AnalyticsRuntime } from '../../src/analytics';
import { createOfferAnalyticsHandler, offerEventToAnalytics } from '../../src/composition/offerAnalytics';
import { OfferRuntime } from '../../src/offers/OfferRuntime';
import type { OfferEvent } from '../../src/offers/types';
import { FakeTransport, makeContext } from '../analytics/fixtures';
import { DAY, T0, makeConfig, makeState } from '../offers/fixtures';

test('OfferRuntime events map to Hazar interaction events with the donor actions and fields', () => {
  const config = makeConfig();
  const offer = config.tiers[1]![1]!;
  expect(offerEventToAnalytics({ type: 'activated', offer, level: 12, now: T0 })).toEqual({
    action: 'offer_activated', data: { level: 12, product: offer.productId, tier: 2, variant: 'b' }
  });
  expect(offerEventToAnalytics({ type: 'expired', offer: config.welcome, level: 9, now: T0 })).toEqual({
    action: 'offer_expired', data: { level: 9, product: config.welcome.productId, tier: 0, variant: 'a' }
  });
  expect(offerEventToAnalytics({ type: 'purchased', offer, moved: true, level: 12, now: T0 }).data).toMatchObject({ moved: 1 });
  expect(offerEventToAnalytics({ type: 'purchased', offer, moved: false, level: 12, now: T0 })).toMatchObject({ action: 'offer_purchased', data: { moved: 0 } });
  expect(offerEventToAnalytics({ type: 'blocked_no_price', level: 30, now: T0 })).toEqual({ action: 'offer_blocked_no_price', data: { level: 30 } });
});

test('composition: a real OfferRuntime wired through onEvent logs activated / purchased / expired / blocked_no_price', async () => {
  const transport = new FakeTransport();
  const analytics = new AnalyticsRuntime({ transport, context: makeContext({ configName: 'offers_v1', configGroup: 'control' }), batchSize: 50 });
  const clock = { now: T0 };
  const catalog = { open: true };
  const seen: OfferEvent['type'][] = [];
  const offers = new OfferRuntime({
    config: makeConfig(),
    state: makeState(),
    input: { now: () => clock.now, level: () => 12, hasPrice: () => catalog.open, welcomeOwned: () => false },
    onEvent: createOfferAnalyticsHandler(analytics, (event) => seen.push(event.type))
  });
  offers.update(16); // welcome activated
  offers.onPurchased('starter_pack'); // purchased, chain → cooldown
  clock.now += DAY;
  offers.update(1000); // tier activated
  clock.now += DAY;
  offers.update(1000); // expired
  catalog.open = false;
  clock.now += 2 * DAY;
  offers.update(1000); // a tier is due, nothing has a price
  await analytics.flush();

  expect(seen).toEqual(['activated', 'purchased', 'activated', 'expired', 'blocked_no_price']);
  const events = transport.batches.flat().map((e) => e.event);
  expect(events.map((e) => [e.name, e.data.action])).toEqual([
    ['interaction', 'offer_activated'],
    ['interaction', 'offer_purchased'],
    ['interaction', 'offer_activated'],
    ['interaction', 'offer_expired'],
    ['interaction', 'offer_blocked_no_price']
  ]);
  expect(events[0]!.data).toMatchObject({ product: 'starter_pack', tier: 0, level: 12, profile_id: 'profile-1', config_name: 'offers_v1', config_group: 'control' });
  expect(events[1]!.data).toMatchObject({ product: 'starter_pack', moved: 1 });
  // the offers module is untouched by analytics being there: same stats as without it
  expect(offers.getStats()).toMatchObject({ events: 5, callbackErrors: 0 });
});

test('a rejected analytics event never disturbs the chain', () => {
  const analytics = new AnalyticsRuntime({ transport: new FakeTransport(), context: makeContext({ profileId: '' }), onError: () => {} });
  const offers = new OfferRuntime({
    config: makeConfig(),
    state: makeState(),
    input: { now: () => T0, level: () => 12, hasPrice: () => true, welcomeOwned: () => false },
    onEvent: createOfferAnalyticsHandler(analytics)
  });
  expect(offers.update(16)).toBe(true);
  expect(offers.getStats()).toMatchObject({ active: 'starter_pack', callbackErrors: 0 });
  expect(analytics.getStats()).toMatchObject({ rejected: 1, queued: 0 });
});
