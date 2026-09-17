import { expect, test } from 'vitest';
import { PlatformRuntime, createDevPlatform } from '../../src/platform';
import type { DevPurchaseOutcome, PlatformAdResult, PlatformAdStatus } from '../../src/platform';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import type { PurchaseEvent } from '../../src/purchases';
import { makeAds } from '../ads/fixtures';

// ---------------------------------------------------------------- ads

test('DEV ads: an interstitial is shown, a rewarded is rewarded — and `rewarded` is true for that status only', async () => {
  const dev = createDevPlatform();
  const ads = new PlatformRuntime(dev).ads!;
  expect(await ads.showInterstitial('level_win_inter')).toEqual({ status: 'shown', rewarded: false, placement: 'level_win_inter' });
  expect(await ads.showRewarded('ad_refill_hearts_rewarded')).toEqual({ status: 'rewarded', rewarded: true, placement: 'ad_refill_hearts_rewarded' });
  expect(ads.isRewardedAvailable()).toBe(true);
  expect(await ads.showBanner!()).toBe(true);
  expect(dev.dev.getState()).toMatchObject({ adsShown: 2, bannerVisible: true });
  await ads.hideBanner!();
  expect(dev.dev.getState().bannerVisible).toBe(false);
});

test('DEV ads: every normalized outcome can be scripted; a failure is a status, never a rejection', async () => {
  let next: PlatformAdStatus = 'shown';
  const ads = createDevPlatform({ adOutcome: () => next }).ads!;
  const seen: PlatformAdResult[] = [];
  for (const status of ['rewarded', 'dismissed', 'timeout', 'error', 'no_fill'] as const) {
    next = status;
    seen.push(await ads.showRewarded('x_rewarded'));
  }
  expect(seen.map((r) => `${r.status}:${r.rewarded}`)).toEqual(['rewarded:true', 'dismissed:false', 'timeout:false', 'error:false', 'no_fill:false']);
  // the donor's Yandex latch: a rewarded that could not be served hides the button
  expect(ads.isRewardedAvailable()).toBe(false);

  // statuses stay honest per ad type: no reward from an interstitial, no bare "shown" from a rewarded
  next = 'rewarded';
  expect(await ads.showInterstitial('x_inter')).toMatchObject({ status: 'shown', rewarded: false });
  next = 'shown';
  expect(await ads.showRewarded('x_rewarded')).toMatchObject({ status: 'dismissed', rewarded: false });

  const throwing = createDevPlatform({
    adOutcome: () => {
      throw new Error('script bug');
    }
  }).ads!;
  expect(await throwing.showInterstitial('x_inter')).toMatchObject({ status: 'error', rewarded: false, placement: 'x_inter' });
});

test('AdsRuntime seam: AdsRuntime decides, the platform shows, only `shown` / `rewarded === true` is registered and rewarded', async () => {
  let next: PlatformAdStatus = 'shown';
  const platform = new PlatformRuntime(createDevPlatform({ adOutcome: (type) => (type === 'interstitial' ? next : next === 'shown' ? 'rewarded' : next) }));
  const host = makeAds({ level: 20 });
  let rewards = 0;

  const showInter = async (placement: string) => {
    if (!host.ads.decide(placement, 'inter').allowed) return 'denied';
    const result = await platform.ads!.showInterstitial(placement);
    if (result.status === 'shown') host.ads.registerShown(placement);
    return result.status;
  };
  const showRewarded = async (placement: string) => {
    if (!host.ads.decide(placement, 'rewarded').allowed || !platform.ads!.isRewardedAvailable()) return 'denied';
    const result = await platform.ads!.showRewarded(placement);
    if (result.rewarded) {
      rewards += 1;
      host.ads.registerShown(placement);
    }
    return result.status;
  };

  next = 'no_fill';
  expect(await showInter('level_win_inter')).toBe('no_fill');
  expect(host.ads.getStats().shown).toBe(0); // nothing played → no cooldown armed, no counter spent
  next = 'shown';
  expect(await showInter('level_win_inter')).toBe('shown');
  expect(host.ads.getStats()).toMatchObject({ shown: 1 });
  expect(await showInter('level_win_inter')).toBe('denied'); // AdsRuntime's own inter cooldown, from the registered show
  expect(host.ads.decide('level_win_inter').reason).toBe('inter_cooldown');

  next = 'dismissed';
  expect(await showRewarded('ad_refill_hearts_rewarded')).toBe('dismissed');
  expect(rewards).toBe(0);
  next = 'shown';
  expect(await showRewarded('ad_refill_hearts_rewarded')).toBe('rewarded');
  expect(rewards).toBe(1);
  expect(host.ads.getStats().counts['ad_refill_hearts_rewarded']).toMatchObject({ day: 1 });

  // a platform without ads: the capability is absent and the host simply has nothing to call
  expect(new PlatformRuntime(createDevPlatform({ ads: false })).ads).toBeUndefined();
});

// ---------------------------------------------------------------- payments

test('DEV payments: a fake token, the receipt held until consume, restore lists what is held, reset forgets it', async () => {
  const dev = createDevPlatform();
  const payments = new PlatformRuntime(dev).payments!;
  const paid = await payments.purchase('gold_1');
  expect(paid).toEqual({ status: 'ok', productId: 'gold_1', token: 'dev:1', raw: 'dev:1' });
  expect(await payments.restore()).toEqual([{ productId: 'gold_1', token: 'dev:1', raw: 'dev:1' }]);
  await payments.consume!({ productId: 'gold_1', token: 'dev:1' });
  expect(await payments.restore()).toEqual([]);

  dev.dev.addReceipt('starter_pack');
  expect(dev.dev.receipts().map((r) => `${r.productId}:${r.token}`)).toEqual(['starter_pack:dev:2']);
  dev.dev.reset();
  expect(await payments.restore()).toEqual([]);
  expect(dev.dev.getState()).toMatchObject({ purchases: 0 });
});

test('DEV payments: tokens never restart over a persistent store — a reload cannot collide with a persisted granted registry', async () => {
  const items = new Map<string, string>();
  const store = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
  const first = await createDevPlatform({ store }).payments!.purchase('gold_1');
  const afterReload = createDevPlatform({ store }).payments!;
  const second = await afterReload.purchase('gold_1');
  expect([first?.token, second?.token]).toEqual(['dev:1', 'dev:2']);
  expect((await afterReload.restore())!.map((r) => r.token)).toEqual(['dev:1', 'dev:2']); // held across the reload
  const custom = await createDevPlatform({ createToken: (id, n) => `${id}#${n}` }).payments!.purchase('gold_2');
  expect(custom?.token).toBe('gold_2#1');
});

function makePurchaseHost(outcome: { next: DevPurchaseOutcome }, restoreGrant?: 'after-consume' | 'before-consume') {
  const dev = createDevPlatform({ purchaseOutcome: () => outcome.next, ...(restoreGrant ? { restoreGrant } : {}) });
  const platform = new PlatformRuntime(dev);
  const wallet = { coins: 0 };
  const events: PurchaseEvent<{ coins: number }>[] = [];
  const rewards: Record<string, { coins: number }> = { gold_1: { coins: 1000 }, starter_pack: { coins: 500 } };
  const purchases = new PurchaseRuntime<{ coins: number }>({
    payments: platform.payments!, // the capability IS a PaymentsAdapter — no glue in between
    granted: createGrantedPurchaseStore(),
    resolveGrant: (productId) => rewards[productId],
    grant: (_productId, reward) => void (wallet.coins += reward.coins),
    onEvent: (event) => events.push(event)
  });
  return { dev, platform, purchases, wallet, types: () => events.map((e) => e.type) };
}

test('PurchaseRuntime compatibility: platform.payments drives the real pipeline — purchase → mark → consume → grant', async () => {
  const outcome = { next: 'ok' as DevPurchaseOutcome };
  const host = makePurchaseHost(outcome);
  expect(await host.purchases.purchase('gold_1', 'shop')).toMatchObject({ status: 'ok', productId: 'gold_1', token: 'dev:1', restoreAdvised: false });
  expect(host.wallet.coins).toBe(1000);
  expect(host.dev.dev.receipts()).toEqual([]); // consumed
  expect((await host.purchases.restore()).granted).toEqual([]); // nothing left to grant twice

  outcome.next = 'cancelled';
  expect(await host.purchases.purchase('gold_1', 'shop')).toMatchObject({ status: 'cancelled', restoreAdvised: true });
  outcome.next = 'error';
  expect(await host.purchases.purchase('gold_1', 'shop')).toMatchObject({ status: 'error', reason: 'platform_error' });
  expect(host.wallet.coins).toBe(1000);
  expect(host.types()).toEqual(['started', 'granted', 'started', 'cancelled', 'started', 'error']);
});

test('PurchaseRuntime compatibility: a paid purchase the game never heard of is restored once — under both restore policies', async () => {
  for (const policy of ['after-consume', 'before-consume'] as const) {
    const outcome = { next: 'lost' as DevPurchaseOutcome };
    const host = makePurchaseHost(outcome, policy);
    expect(host.platform.payments!.restoreGrant).toBe(policy);
    // the money is taken, the answer is lost: the game sees a cancel and is told to restore
    expect(await host.purchases.purchase('gold_1', 'offer_window')).toMatchObject({ status: 'cancelled', restoreAdvised: true });
    expect(host.wallet.coins).toBe(0);
    host.dev.dev.addReceipt('starter_pack'); // and one from a previous session

    const restored = await host.purchases.restore();
    expect(restored).toMatchObject({ status: 'ok', found: 2 });
    expect(restored.granted.map((g) => g.productId)).toEqual(['gold_1', 'starter_pack']);
    expect(host.wallet.coins).toBe(1500);
    expect(host.dev.dev.receipts()).toEqual([]);
    expect(await host.purchases.restore()).toMatchObject({ found: 0, granted: [] });
    expect(host.wallet.coins).toBe(1500);
  }
});
