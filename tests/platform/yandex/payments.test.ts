import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlatformRuntime } from '../../../src/platform';
import { YANDEX_TIMEOUTS } from '../../../src/platform/adapters/yandex';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../../src/purchases';
import type { PurchaseEvent } from '../../../src/purchases';
import { flush, makeYandex } from './fixtures';
import type { FakeYandex } from './fixtures';

beforeEach(() => void vi.useFakeTimers({ now: Date.UTC(2026, 8, 17, 10) }));
afterEach(() => void vi.useRealTimers());

const CATALOG = [
  { id: 'starter_pack', title: 'Starter', price: '149 ₽', priceValue: '149', priceCurrencyCode: 'RUB' },
  { id: 'gold_1', price: '99 ₽', priceCurrencyCode: 'RUB' }
];

test('payments unavailable (getPayments rejected or hung 8 s): the capability stays, purchase → cancelled, restore → [], the catalog is empty', async () => {
  for (const mode of ['fail', 'hang'] as const) {
    const h = makeYandex((fake) => (fake.paymentsMode = mode));
    const ready = h.platform.identity.ready();
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.payments);
    await ready; // a dead payment service never blocks the entry
    const platform = new PlatformRuntime(h.platform);
    expect(platform.has('payments')).toBe(true);
    expect(await platform.payments!.purchase('gold_1')).toEqual({ status: 'cancelled', productId: 'gold_1' });
    expect(await platform.payments!.restore()).toEqual([]);
    expect(await platform.catalog.refresh()).toEqual({ status: 'empty', products: 0, changed: false });
    await expect(platform.payments!.consume!({ productId: 'gold_1', token: 't' })).rejects.toThrow('yandex_payments_unavailable');
    expect(h.diagnostics).toContain('payments_unavailable');
    expect(h.fake.count('purchase') + h.fake.count('getPurchases') + h.fake.count('getCatalog')).toBe(0);
  }
});

test('catalog: Yandex products → PlatformProduct { id, priceText = the READY price string, currency }; feeds PlatformCatalog; nothing is made up', async () => {
  const h = makeYandex((fake) => (fake.catalog = [...CATALOG, { id: 'no_price' }, { price: '10 ₽' }, { id: 'no_code', price: '5 YAN' }]));
  const platform = new PlatformRuntime(h.platform);
  expect(await platform.payments!.getCatalog()).toEqual([
    { id: 'starter_pack', priceText: '149 ₽', currency: 'RUB' },
    { id: 'gold_1', priceText: '99 ₽', currency: 'RUB' },
    { id: 'no_code', priceText: '5 YAN', currency: '' }
  ]);
  expect(await platform.catalog.refresh()).toEqual({ status: 'ok', products: 3, changed: true });
  expect([platform.catalog.hasPrice('starter_pack'), platform.catalog.priceText('starter_pack'), platform.catalog.currency(), platform.catalog.hasPrice('no_price')]).toEqual([
    true, '149 ₽', 'RUB', false
  ]);

  // an empty catalog (products not applied in the console yet) is a marker; a hung one is cut at 10 s — known prices survive both
  h.fake.catalog = [];
  expect(await platform.catalog.refresh()).toMatchObject({ status: 'empty', products: 3 });
  expect(h.diagnostics).toContain('catalog_empty');
  h.fake.catalogMode = 'hang';
  const hung = platform.catalog.refresh();
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.catalog);
  expect(await hung).toMatchObject({ status: 'error', products: 3 });
  expect(platform.catalog.priceText('gold_1')).toBe('99 ₽');
});

test('purchase: productID → productId, purchaseToken → token, the SDK object in raw; cancel / reject / no token / a 120 s hang → cancelled', async () => {
  const h = makeYandex();
  const { payments } = h.platform;
  const paid = await payments.purchase('gold_1');
  expect(paid).toEqual({ status: 'ok', productId: 'gold_1', token: 'ya-token-1', raw: h.fake.held[0] });
  expect(h.fake.calls).toContain('purchase:gold_1');
  expect(h.fake.count('consume')).toBe(0); // consuming and the granted registry are PurchaseRuntime's

  for (const mode of ['cancel', 'fail', 'no-token'] as const) {
    h.fake.purchaseMode = mode;
    expect(await payments.purchase('gold_1'), mode).toEqual({ status: 'cancelled', productId: 'gold_1' });
  }
  h.fake.purchaseMode = 'hang';
  let answer: unknown;
  void payments.purchase('gold_1').then((result) => (answer = result));
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.purchase - 1);
  expect(answer).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(answer).toEqual({ status: 'cancelled', productId: 'gold_1' });
});

test('restore: getPurchases → PlatformPurchase[]; consume = consumePurchase(token) under 8 s; a failed list reads as nothing held (donor)', async () => {
  const h = makeYandex((fake) => {
    fake.held = [{ productID: 'gold_1', purchaseToken: 'tok-a' }, { productID: 'starter_pack', purchaseToken: 'tok-b' }];
  });
  const { payments } = h.platform;
  expect(payments.restoreGrant).toBe('after-consume');
  expect(await payments.restore()).toEqual([
    { productId: 'gold_1', token: 'tok-a', raw: { productID: 'gold_1', purchaseToken: 'tok-a' } },
    { productId: 'starter_pack', token: 'tok-b', raw: { productID: 'starter_pack', purchaseToken: 'tok-b' } }
  ]);

  await payments.consume!({ productId: 'gold_1', token: 'tok-a' });
  expect(h.fake.calls).toContain('consume:tok-a');
  expect((await payments.restore())!.map((p) => p.token)).toEqual(['tok-b']);
  h.fake.consumeFailures = 1;
  await expect(payments.consume!({ token: 'tok-b' })).rejects.toThrow('consume_down');
  await expect(payments.consume!({ productId: 'starter_pack' })).rejects.toThrow('yandex_consume_without_token');

  h.fake.getPurchasesMode = 'fail';
  expect(await payments.restore()).toEqual([]);
  h.fake.getPurchasesMode = 'hang';
  const hung = payments.restore();
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.getPurchases);
  expect(await hung).toEqual([]);
  expect(h.diagnostics.filter((code) => code === 'get_purchases_failed')).toHaveLength(2);
});

function makePurchaseHost(setup?: (fake: FakeYandex) => void) {
  const h = makeYandex(setup);
  const platform = new PlatformRuntime(h.platform);
  const wallet = { coins: 0 };
  const events: PurchaseEvent<{ coins: number }>[] = [];
  const rewards: Record<string, { coins: number }> = { gold_1: { coins: 1000 }, starter_pack: { coins: 500 } };
  const purchases = new PurchaseRuntime<{ coins: number }>({
    payments: platform.payments!, // the Yandex capability IS a PaymentsAdapter
    granted: createGrantedPurchaseStore(),
    resolveGrant: (productId) => rewards[productId],
    grant: (_productId, reward) => void (wallet.coins += reward.coins),
    onEvent: (event) => events.push(event)
  });
  return { ...h, purchases, wallet, types: () => events.map((event) => event.type) };
}

test('PurchaseRuntime compatibility: purchase → mark → grant → consumePurchase on the real pipeline; a failed consume is finished by restore without a 2nd grant', async () => {
  const host = makePurchaseHost();
  expect(await host.purchases.purchase('gold_1', 'shop')).toMatchObject({ status: 'ok', productId: 'gold_1', token: 'ya-token-1', restoreAdvised: false });
  expect(host.wallet.coins).toBe(1000); // granted with the answer — the consume is not awaited (0.1.31)
  await flush();
  expect(host.fake.held.length).toBe(0);
  expect(host.fake.calls.filter((call) => /^(purchase|consume)/.test(call))).toEqual(['purchase:gold_1', 'consume:ya-token-1']);

  host.fake.consumeFailures = 1; // the network dropped between the payment and the consume
  expect(await host.purchases.purchase('starter_pack', 'offer_window')).toMatchObject({ status: 'ok' });
  await flush();
  expect([host.wallet.coins, host.fake.held.length]).toEqual([1500, 1]); // granted now, the receipt still hangs
  expect(await host.purchases.restore()).toMatchObject({ status: 'ok', found: 1, granted: [] }); // consumed, NOT granted again
  expect([host.wallet.coins, host.fake.held.length]).toEqual([1500, 0]);
  expect(host.types()).toEqual(['started', 'granted', 'started', 'granted', 'consume_failed', 'duplicate']);
});

test('PurchaseRuntime compatibility: a payment that outlived the 120 s answer is restored once — after-consume: a failed consume keeps the receipt ungranted', async () => {
  const host = makePurchaseHost((fake) => (fake.purchaseMode = 'paid-hang'));
  const pending = host.purchases.purchase('gold_1', 'shop');
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.purchase);
  expect(await pending).toMatchObject({ status: 'cancelled', restoreAdvised: true }); // the host schedules its restore waves
  expect([host.wallet.coins, host.fake.held.length]).toEqual([0, 1]);

  host.fake.consumeFailures = 1;
  expect(await host.purchases.restore()).toMatchObject({ status: 'ok', found: 1, granted: [] }); // Yandex order: consume first — it failed, nothing is granted
  expect(host.wallet.coins).toBe(0);
  const restored = await host.purchases.restore();
  expect(restored.granted).toEqual([{ productId: 'gold_1', token: 'ya-token-1' }]);
  expect([host.wallet.coins, host.fake.held.length]).toEqual([1000, 0]);
  expect((await host.purchases.restore()).granted).toEqual([]);

  // a dead SDK is a failed restore (the host retries), not "nothing to restore"
  const dead = makePurchaseHost((fake) => (fake.initMode = 'fail'));
  expect(await dead.purchases.restore()).toMatchObject({ status: 'error' });
  await flush();
});
