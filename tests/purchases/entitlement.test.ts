// Product kinds (consume policy). The donor of the `entitlement` kind is SoliPix production:
//   - coin packs: purchase → consumePurchase → grant; a pending pack is consumed by the boot restore;
//   - `no_ads`: purchase → grant, NEVER consumed; the boot `getPurchases()` lists it on every start and
//     re-asserts the flag ("Эту покупку НЕ сжигаем (consume), она вечная").
import { expect, test } from 'vitest';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import { createPurchaseAnalyticsHandler } from '../../src/composition/purchaseAnalytics';
import { CATALOG, FakePayments, makeHost } from './fixtures';

type Rewards = { coins: number } | { noAds: true };
const SOLIPIX_KINDS = { no_ads: 'entitlement', gold_1: 'consumable' } as const;
const resolveGrant = (productId: string): Rewards | undefined => (productId === 'no_ads' ? { noAds: true } : CATALOG[productId]);

/** A SoliPix-shaped host: coins are consumables, `no_ads` is a permanent right (an idempotent flag). */
function makeGame(payments = new FakePayments(), store = createGrantedPurchaseStore()) {
  const profile = { coins: 0, noAds: false, noAdsGrants: 0 };
  const events: string[] = [];
  const build = () =>
    new PurchaseRuntime<Rewards>({
      payments,
      granted: store,
      productKinds: SOLIPIX_KINDS,
      resolveGrant,
      grant: (_productId, rewards) => {
        if ('noAds' in rewards) {
          profile.noAds = true;
          profile.noAdsGrants++;
        } else profile.coins += rewards.coins;
      },
      onEvent: (event) => events.push(event.type === 'granted' ? `granted:${event.productId}:${event.kind ?? 'consumable'}` : event.type)
    });
  return { payments, store, profile, events, runtime: build(), reload: build };
}

test('consumable, direct and restored: the v0.6 pipeline is untouched by the option (purchase → consume → grant)', async () => {
  const game = makeGame();
  expect((await game.runtime.purchase('gold_1', 'shop')).status).toBe('ok');
  expect(game.payments.log).toEqual(['purchase:gold_1', 'consume:tok-1']);
  expect([game.profile.coins, game.payments.held.length]).toEqual([1000, 0]);

  game.payments.hold('gold_1', 'pending-1'); // paid in an earlier session, never granted
  expect(await game.reload().restore()).toEqual({ status: 'ok', found: 1, granted: [{ productId: 'gold_1', token: 'pending-1' }] });
  expect(game.payments.log.slice(2)).toEqual(['restore', 'consume:pending-1']); // after-consume: the existing Yandex policy
  expect([game.profile.coins, game.payments.held.length]).toEqual([2000, 0]);
  expect(game.events).toEqual(['started', 'granted:gold_1:consumable', 'granted:gold_1:consumable']);

  // and a product that is not listed at all is a consumable: a host without productKinds runs v0.6
  const plain = makeHost();
  await plain.runtime.purchase('gold_2');
  expect(plain.payments.log).toEqual(['purchase:gold_2', 'consume:tok-1']);
  expect(plain.events.at(-1)).not.toHaveProperty('kind');
});

test('entitlement, direct purchase: marked and granted, the receipt is NOT consumed', async () => {
  const game = makeGame();
  const result = await game.runtime.purchase('no_ads', 'settings');
  expect(result).toEqual({ status: 'ok', productId: 'no_ads', token: 'tok-1', reason: undefined, restoreAdvised: false });
  expect(game.payments.log).toEqual(['purchase:no_ads']); // no consume call at all
  expect(game.payments.held.map((it) => it.token)).toEqual(['tok-1']); // the platform keeps the permanent receipt
  expect(game.store.has('tok-1')).toBe(true);
  expect([game.profile.noAds, game.profile.noAdsGrants]).toEqual([true, 1]);
  expect(game.events).toEqual(['started', 'granted:no_ads:entitlement']);
});

test('entitlement, restore: granted exactly once, never consumed; every later pass answers `owned`, not a duplicate', async () => {
  const game = makeGame();
  game.payments.restoreGrant = 'after-consume'; // even the consume-first policy must not consume it
  game.payments.hold('no_ads', 'ya-777'); // bought on another device: the platform lists it, this registry is empty

  expect(await game.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [{ productId: 'no_ads', token: 'ya-777' }] });
  expect([game.profile.noAds, game.profile.noAdsGrants]).toEqual([true, 1]);

  // the receipt is permanent, so the next start sees it again — and again after a reload
  const again = await game.runtime.restore();
  expect(again).toEqual({ status: 'ok', found: 1, granted: [], owned: [{ productId: 'no_ads', token: 'ya-777' }] });
  expect((await game.reload().restore()).owned).toEqual([{ productId: 'no_ads', token: 'ya-777' }]);

  expect(game.profile.noAdsGrants).toBe(1); // one token, one grant
  expect(game.payments.consumeCalls).toEqual([]);
  expect(game.payments.held.length).toBe(1);
  expect(game.events).toEqual(['granted:no_ads:entitlement']); // no `duplicate` noise on every start
  expect(game.runtime.getStats()).toMatchObject({ granted: 1, restored: 1, duplicates: 0, consumeFailures: 0 }); // two passes on it: one grant
});

test('`owned` lets the host heal a profile that lost the right, the way production re-asserts it on every start', async () => {
  const game = makeGame();
  await game.runtime.purchase('no_ads');
  game.profile.noAds = false; // a cloud reset / conflict rolled the profile back; the local registry still knows the token
  const { owned = [] } = await game.reload().restore();
  for (const purchase of owned) if (purchase.productId === 'no_ads') game.profile.noAds = true; // host code, idempotent
  expect([game.profile.noAds, game.profile.noAdsGrants]).toEqual([true, 1]);
});

test('a mixed pass, both restore policies: the pack is consumed, the entitlement is kept, a repeated direct answer stays a duplicate', async () => {
  for (const policy of ['after-consume', 'before-consume'] as const) {
    const game = makeGame();
    game.payments.restoreGrant = policy;
    game.payments.hold('gold_1', 'coin-1');
    game.payments.hold('no_ads', 'ads-1');
    const result = await game.runtime.restore();
    expect(result.granted.map((it) => it.productId), policy).toEqual(['gold_1', 'no_ads']);
    expect(game.payments.log, policy).toEqual(['restore', 'consume:coin-1']);
    expect(game.payments.held.map((it) => it.token), policy).toEqual(['ads-1']);
    expect([game.profile.coins, game.profile.noAdsGrants], policy).toEqual([1000, 1]);
  }
  // the platform repeating a DIRECT answer for a known token is still the v0.6 anomaly
  const game = makeGame();
  game.store.add('tok-1');
  expect((await game.runtime.purchase('no_ads')).status).toBe('duplicate');
  expect([game.profile.noAdsGrants, game.payments.consumeCalls.length, game.events]).toEqual([0, 0, ['started', 'duplicate']]);
});

test('the policy is config and is checked once: a typo can never read as "consumable" and burn a permanent purchase', () => {
  const options = { payments: new FakePayments(), granted: createGrantedPurchaseStore(), resolveGrant, grant: () => undefined };
  expect(() => new PurchaseRuntime({ ...options, productKinds: { no_ads: 'entitlment' as never } })).toThrow(/productKinds\["no_ads"\]/);
  expect(() => new PurchaseRuntime({ ...options, productKinds: {} })).not.toThrow();
});

test('analytics: the direct entitlement purchase is the one money point; a restored entitlement sends no revenue', async () => {
  const sent: string[] = [];
  const analytics = {
    interaction: (action: string, data?: Record<string, unknown>) => sent.push(`${action}:${String(data?.kind ?? '-')}`) > 0,
    purchase: (event: { offerName: string; status?: string; revenue?: number }) => sent.push(`PURCHASE:${event.offerName}:${event.status}:${event.revenue}`) > 0
  };
  const payments = new FakePayments();
  const build = (store = createGrantedPurchaseStore()) =>
    new PurchaseRuntime<Rewards>({
      payments, granted: store, productKinds: SOLIPIX_KINDS, resolveGrant, grant: () => undefined,
      onEvent: createPurchaseAnalyticsHandler(analytics, () => ({ revenue: 199, currency: 'RUB' }))
    });
  await build().purchase('no_ads', 'settings');
  expect(sent).toEqual(['purchase_started:-', 'purchase_ok:entitlement', 'PURCHASE:no_ads:success:199']);

  sent.length = 0;
  await build().restore(); // a new device: an empty registry, the same permanent receipt
  expect(sent).toEqual(['purchase_restored:entitlement']); // the right came back; the money was counted once

  sent.length = 0;
  payments.hold('gold_1', 'pending-1');
  await build().restore(); // a restored CONSUMABLE is still revenue (v0.6: it was never granted before)
  expect(sent).toEqual(['purchase_restored:entitlement', 'purchase_restored:-', 'PURCHASE:gold_1:restore:199']);
});
