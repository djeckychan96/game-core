import { expect, test, vi } from 'vitest';
import { AnalyticsRuntime } from '../../src/analytics';
import { createOfferAnalyticsHandler } from '../../src/composition/offerAnalytics';
import { createPurchaseAnalyticsHandler, purchaseEventToAnalytics, type PurchasePriceResolver } from '../../src/composition/purchaseAnalytics';
import { OfferRuntime } from '../../src/offers/OfferRuntime';
import type { OfferReward } from '../../src/offers/types';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import { FakeTransport, makeContext } from '../analytics/fixtures';
import { DAY, T0, makeConfig, makeState } from '../offers/fixtures';
import { FakePayments, makeHost } from '../purchases/fixtures';

// the host's REAL catalog is the only source of money — the runtime never knows a price
const price: PurchasePriceResolver = (productId) =>
  ({ gold_1: { revenue: 29, currency: 'RUB' }, starter_pack: { revenue: 99, currency: 'RUB' } })[productId];

test('PurchaseRuntime events map to the purchase funnel; only a grant carries the Hazar purchase event', () => {
  expect(purchaseEventToAnalytics({ type: 'started', productId: 'gold_1', source: 'shop' }, price)).toEqual({
    action: 'purchase_started', data: { product: 'gold_1', source: 'shop' }
  });
  expect(purchaseEventToAnalytics({ type: 'cancelled', productId: 'gold_1', source: 'shop' }, price)).toEqual({
    action: 'purchase_cancelled', data: { product: 'gold_1', source: 'shop' }
  });
  expect(
    purchaseEventToAnalytics({ type: 'error', reason: 'adapter_threw', productId: 'gold_1', token: undefined, restored: false, source: 'shop', error: new Error('x') }, price)
  ).toEqual({ action: 'purchase_error', data: { product: 'gold_1', order_id: undefined, source: 'shop', reason: 'adapter_threw', restored: 0 } });
  expect(purchaseEventToAnalytics({ type: 'duplicate', productId: 'gold_1', token: 't', restored: true, source: undefined }).action).toBe('purchase_duplicate');
  expect(purchaseEventToAnalytics({ type: 'consume_failed', productId: 'gold_1', token: 't', restored: false, error: 0 }).action).toBe('purchase_consume_failed');

  const ok = purchaseEventToAnalytics(
    { type: 'granted', productId: 'gold_1', token: 'tok-1', rewards: {}, restored: false, source: 'shop', requestedProductId: 'gold_1' }, price);
  expect(ok).toEqual({
    action: 'purchase_ok',
    data: { product: 'gold_1', order_id: 'tok-1', source: 'shop', requested: undefined, no_token: undefined },
    purchase: { offerName: 'gold_1', revenue: 29, currency: 'RUB', orderId: 'tok-1', status: 'success', source: 'shop' }
  });

  const restored = purchaseEventToAnalytics(
    { type: 'granted', productId: 'gold_1', token: undefined, rewards: {}, restored: true, source: undefined, requestedProductId: undefined }, price);
  expect(restored.action).toBe('purchase_restored');
  expect(restored.data).toMatchObject({ source: 'restore', no_token: 1 });
  expect(restored.purchase).toEqual({ offerName: 'gold_1', revenue: 29, currency: 'RUB', status: 'restore', source: 'restore' });

  // no price in the catalog → no revenue is invented; a game-side offer name keeps the platform id next to it
  const unknown = purchaseEventToAnalytics(
    { type: 'granted', productId: 'gold_9', token: 't9', rewards: {}, restored: false, source: undefined, requestedProductId: 'gold_1' }, price);
  expect(unknown.purchase).toEqual({ offerName: 'gold_9', orderId: 't9', status: 'success' });
  expect(unknown.data).toMatchObject({ requested: 'gold_1' });
  const named = purchaseEventToAnalytics(
    { type: 'granted', productId: 'gold_1', token: 't', rewards: {}, restored: false, source: 'shop', requestedProductId: 'gold_1' },
    () => ({ revenue: 0.99, currency: 'USD', offerName: 'Handful of coins' }));
  expect(named.purchase).toMatchObject({ offerName: 'Handful of coins', productId: 'gold_1', revenue: 0.99, currency: 'USD' });
});

test('composition: a real PurchaseRuntime through onEvent logs started / ok / cancelled / error / restored + the Hazar purchase', async () => {
  const transport = new FakeTransport();
  const analytics = new AnalyticsRuntime({ transport, context: makeContext(), batchSize: 50 });
  const seen: string[] = [];
  const host = makeHost({ onEvent: createPurchaseAnalyticsHandler(analytics, price, (event) => seen.push(event.type)) });

  await host.runtime.purchase('gold_1', 'shop'); // ok
  host.payments.mode = 'cancel';
  await host.runtime.purchase('gold_1', 'shop');
  host.payments.mode = 'throw';
  await host.runtime.purchase('gold_1', 'out_of_lives');
  host.payments.hold('starter_pack', 'old-1');
  await host.runtime.restore(); // a receipt of an earlier session
  await analytics.flush();

  expect(seen).toEqual(['started', 'granted', 'started', 'cancelled', 'started', 'error', 'granted']);
  const events = transport.batches.flat().map((e) => e.event);
  expect(events.map((e) => (e.name === 'interaction' ? e.data.action : e.name))).toEqual([
    'purchase_started', 'purchase_ok', 'purchase',
    'purchase_started', 'purchase_cancelled',
    'purchase_started', 'purchase_error',
    'purchase_restored', 'purchase'
  ]);
  // the Hazar purchase event of the direct purchase: offer_name / revenue / currency / order_id / source
  expect(events[2]!.data).toMatchObject({
    offer_name: 'gold_1', revenue: 29, currency: 'RUB', order_id: 'tok-1', source: 'shop', status: 'success', profile_id: 'profile-1'
  });
  expect(events[6]!.data).toMatchObject({ action: 'purchase_error', reason: 'adapter_threw', source: 'out_of_lives' });
  // a restored receipt is revenue too (donor review 15.09 №8)
  expect(events[8]!.data).toMatchObject({ offer_name: 'starter_pack', revenue: 99, currency: 'RUB', order_id: 'old-1', source: 'restore', status: 'restore' });
  expect(events.filter((e) => e.name === 'purchase')).toHaveLength(2);
  expect(host.runtime.getStats().callbackErrors).toBe(0);
});

test('revenue is never double-counted: one Hazar purchase event per payment, whether it is granted directly or by a restore', async () => {
  // donor: trackPurchase has ONE call site (DataUpdateSystem.onShopPurchase), reached by a direct ok and by
  // every restored receipt — and the platform hands the game only receipts that were not granted yet
  const transport = new FakeTransport();
  const analytics = new AnalyticsRuntime({ transport, context: makeContext(), batchSize: 50 });
  const host = makeHost({ onEvent: createPurchaseAnalyticsHandler(analytics, price) });

  host.payments.consumeFailures = 2;
  await host.runtime.purchase('gold_1', 'shop'); // paid + granted, the receipt keeps hanging (consume failed)
  await host.runtime.restore();                   // the waves see the SAME receipt…
  await host.reload().restore();                  // …and so does the next launch
  host.payments.mode = 'paid-but-null';
  await host.runtime.purchase('starter_pack', 'offer_window'); // paid, the SDK answer is lost → no revenue yet
  await host.runtime.restore();                   // the restore is this payment's only revenue point
  await host.runtime.restore();
  await analytics.flush();

  const events = transport.batches.flat().map((e) => e.event);
  const money = events.filter((e) => e.name === 'purchase').map((e) => [e.data.offer_name, e.data.order_id, e.data.status]);
  expect(money).toEqual([['gold_1', 'tok-1', 'success'], ['starter_pack', 'tok-2', 'restore']]);
  expect(events.filter((e) => e.data.action === 'purchase_duplicate')).toHaveLength(2); // telemetry only, no revenue
  expect(host.wallet.coins).toBe(1000 + 500);
});

test('a broken analytics side never costs the player the purchase: the host handler still runs, the grant stands', async () => {
  const onPurchaseError = vi.fn();
  const saves: string[] = [];
  const sink = {
    interaction: () => {
      throw new Error('analytics exploded');
    },
    purchase: () => true
  };
  const host = makeHost({
    onEvent: createPurchaseAnalyticsHandler(sink, price, (event) => {
      if (event.type === 'granted') saves.push(event.productId);
    }),
    onPurchaseError
  });
  expect((await host.runtime.purchase('gold_1')).status).toBe('ok');
  expect(host.wallet.coins).toBe(1000);
  expect(saves).toEqual(['gold_1']); // the profile save hook ran
  expect(onPurchaseError).toHaveBeenCalled();
});

test('composition proof: UI buy → PurchaseRuntime → grant of the OfferRuntime rewards → analytics → OfferRuntime.onPurchased', async () => {
  const transport = new FakeTransport();
  const analytics = new AnalyticsRuntime({ transport, context: makeContext(), batchSize: 50 });
  const clock = { now: T0 };
  const offers = new OfferRuntime({
    config: makeConfig(),
    state: makeState(),
    input: { now: () => clock.now, level: () => 12, hasPrice: () => true, welcomeOwned: () => false },
    onEvent: createOfferAnalyticsHandler(analytics)
  });
  offers.update(16); // the welcome offer is on screen
  expect(offers.getActive()?.productId).toBe('starter_pack');

  const wallet: Record<string, number> = {};
  const saves: string[] = [];
  const payments = new FakePayments();
  // the composition layer is the only place that knows both runtimes; PurchaseRuntime imports neither
  const purchases = new PurchaseRuntime<OfferReward[]>({
    payments,
    granted: createGrantedPurchaseStore(),
    resolveGrant: (productId) => offers.offerByProduct(productId)?.rewards,
    grant: (_productId, rewards) => {
      for (const reward of rewards) wallet[reward.id] = (wallet[reward.id] ?? 0) + reward.amount;
    },
    onEvent: createPurchaseAnalyticsHandler(analytics, price, (event) => {
      if (event.type !== 'granted') return;
      offers.onPurchased(event.productId);
      saves.push(event.productId);
    })
  });

  const result = await purchases.purchase('starter_pack', 'offer_window');

  expect(result.status).toBe('ok');
  const welcomeRewards = makeConfig().welcome.rewards;
  expect(wallet).toEqual(Object.fromEntries(welcomeRewards.map((reward) => [reward.id, reward.amount])));
  expect(saves).toEqual(['starter_pack']);
  expect(offers.getActive()).toBeNull(); // the chain moved: bought → cooldown
  expect(offers.getStats()).toMatchObject({ purchases: 1, nextTier: 2 });

  // a replayed receipt: no second grant, the chain is not touched again
  payments.purchase = () => Promise.resolve({ status: 'ok', productId: 'starter_pack', token: 'tok-1' });
  expect((await purchases.purchase('starter_pack', 'offer_window')).status).toBe('duplicate');
  expect(offers.getStats().purchases).toBe(1);
  expect(saves).toEqual(['starter_pack']);

  // a tier offer paid in an earlier session arrives through restore(): rewards + chain move, once
  clock.now += DAY;
  offers.update(1000);
  const tierOffer = offers.getActive()!;
  expect(tierOffer.tier).toBe(2);
  payments.hold(tierOffer.productId, 'old-tier');
  const before = { ...wallet };
  expect((await purchases.restore()).granted).toEqual([{ productId: tierOffer.productId, token: 'old-tier' }]);
  await purchases.restore();
  for (const reward of tierOffer.rewards) expect(wallet[reward.id]).toBe((before[reward.id] ?? 0) + reward.amount);
  expect(offers.getStats().purchases).toBe(2);
  expect(offers.getActive()).toBeNull();

  await analytics.flush();
  const actions = transport.batches.flat().map((e) => (e.event.name === 'interaction' ? e.event.data.action : e.event.name));
  expect(actions).toEqual([
    'offer_activated',
    'purchase_started', 'purchase_ok', 'purchase', 'offer_purchased',
    'purchase_started', 'purchase_duplicate',
    'offer_activated',
    'purchase_restored', 'purchase', 'offer_purchased'
  ]);
  const money = transport.batches.flat().map((e) => e.event).filter((e) => e.name === 'purchase');
  expect(money[0]!.data).toMatchObject({ offer_name: 'starter_pack', revenue: 99, currency: 'RUB', order_id: 'tok-1', source: 'offer_window' });
});
