import { expect, test, vi } from 'vitest';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import type { PurchaseEvent } from '../../src/purchases';
import { CATALOG, FakePayments, makeHost, type DemoRewards } from './fixtures';

/** Lets the consume that runs after the answer settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const errorsOf = (events: PurchaseEvent<DemoRewards>[]) =>
  events.flatMap((event) => (event.type === 'error' ? [event.reason] : []));

// ---------------------------------------------------------------- direct purchase

test('a successful purchase grants exactly once, in the production 0.1.31 order: platform ok → mark → grant → granted event → consume → ok', async () => {
  const host = makeHost();
  const consume = host.payments.consume.bind(host.payments);
  host.payments.consume = (purchase) => {
    host.order.push(`consume:${purchase.token}:marked=${host.store.has(purchase.token!)}`);
    return consume(purchase);
  };

  const result = await host.runtime.purchase('gold_1', 'shop');

  expect(result).toEqual({ status: 'ok', productId: 'gold_1', token: 'tok-1', reason: undefined, restoreAdvised: false });
  expect(host.wallet.coins).toBe(1000);
  expect(host.grants).toEqual(['gold_1:tok-1']);
  expect(host.contexts[0]).toEqual({ productId: 'gold_1', token: 'tok-1', restored: false, source: 'shop', requestedProductId: 'gold_1' });
  // production 0.1.31 (review 20.09 №10; Yandex :618-629, CleverApps :966-974): markGranted, then the
  // consume is NOT awaited — the grant never waits for it (see consume-order.test.ts)
  expect(host.order).toEqual([
    'event:started',
    'grant:gold_1', 'marked-during-grant:true',
    'event:granted', 'marked-at-event:true',
    'consume:tok-1:marked=true'
  ]);
  expect(host.events[1]).toEqual({
    type: 'granted', productId: 'gold_1', token: 'tok-1', rewards: CATALOG['gold_1'], restored: false, source: 'shop', requestedProductId: 'gold_1'
  });
  expect(host.payments.held).toEqual([]); // consumed
  expect(host.store.tokens()).toEqual(['tok-1']);
  expect(host.runtime.getStats()).toMatchObject({ started: 1, granted: 1, restored: 0, errors: 0, pending: null, payer: true });
});

test('nothing is granted before the platform answers', async () => {
  const host = makeHost();
  host.payments.mode = 'manual';
  const running = host.runtime.purchase('gold_1', 'shop');
  await Promise.resolve();
  expect(host.types()).toEqual(['started']);
  expect(host.wallet.coins).toBe(0);
  expect(host.store.tokens()).toEqual([]);
  expect(host.runtime.getPending()).toEqual({ productId: 'gold_1', source: 'shop' });

  host.payments.settlePurchase('ok');
  expect((await running).status).toBe('ok');
  expect(host.wallet.coins).toBe(1000);
  expect(host.runtime.getPending()).toBeNull();
});

test('a cancelled purchase grants nothing and advises a restore (the payment may still have gone through)', async () => {
  const host = makeHost();
  host.payments.mode = 'cancel';
  const result = await host.runtime.purchase('gold_1', 'shop');
  expect(result).toEqual({ status: 'cancelled', productId: 'gold_1', token: undefined, reason: undefined, restoreAdvised: true });
  expect(host.types()).toEqual(['started', 'cancelled']);
  expect(host.wallet.coins).toBe(0);
  expect(host.payments.consumeCalls).toEqual([]);
  expect(host.runtime.isPayer()).toBe(false);
  expect(host.runtime.getStats()).toMatchObject({ cancelled: 1, granted: 0 });
});

test('an empty platform answer reads as cancelled (CleverApps resolves undefined on cancel)', async () => {
  const host = makeHost();
  host.payments.mode = 'manual';
  const running = host.runtime.purchase('gold_1');
  host.payments.settlePurchase('cancel');
  expect((await running).status).toBe('cancelled');
  expect(host.wallet.coins).toBe(0);
});

test('a platform error grants nothing', async () => {
  const host = makeHost();
  host.payments.mode = 'error';
  const result = await host.runtime.purchase('gold_1', 'shop');
  expect(result).toMatchObject({ status: 'error', reason: 'platform_error', productId: 'gold_1', restoreAdvised: true });
  expect(errorsOf(host.events)).toEqual(['platform_error']);
  expect(host.wallet.coins).toBe(0);
  expect(host.store.tokens()).toEqual([]);
  expect(host.runtime.getStats()).toMatchObject({ errors: 1, granted: 0, payer: false });
});

test('a throwing adapter never rejects purchase(): error, no grant, the runtime stays usable', async () => {
  const host = makeHost();
  host.payments.mode = 'throw';
  const result = await host.runtime.purchase('gold_1');
  expect(result).toMatchObject({ status: 'error', reason: 'adapter_threw', restoreAdvised: true });
  expect(host.wallet.coins).toBe(0);
  expect(host.runtime.getPending()).toBeNull();

  // a synchronous throw inside the adapter is the same thing
  host.payments.purchase = () => {
    throw new Error('sdk is not ready');
  };
  expect(await host.runtime.purchase('gold_1')).toMatchObject({ status: 'error', reason: 'adapter_threw' });

  const healthy = makeHost();
  expect((await healthy.runtime.purchase('gold_1')).status).toBe('ok');
});

test('a token that was already granted is never granted again — the receipt is only consumed', async () => {
  const host = makeHost();
  await host.runtime.purchase('gold_1');
  // the platform answers the next purchase with the SAME receipt (an owned product, a replayed answer)
  host.payments.purchase = () => Promise.resolve({ status: 'ok', productId: 'gold_1', token: 'tok-1' });

  const again = await host.runtime.purchase('gold_1', 'shop');

  expect(again).toMatchObject({ status: 'duplicate', productId: 'gold_1', token: 'tok-1', restoreAdvised: false });
  expect(host.wallet.coins).toBe(1000);
  expect(host.grants).toEqual(['gold_1:tok-1']);
  expect(host.events.at(-1)).toEqual({ type: 'duplicate', productId: 'gold_1', token: 'tok-1', restored: false, source: 'shop' });
  expect(host.payments.consumeCalls).toHaveLength(2);
  expect(host.runtime.getStats()).toMatchObject({ granted: 1, duplicates: 1 });
});

test('a failed consume does not stop the grant (the payment went through), and no restore / reload ever grants it again', async () => {
  const host = makeHost();
  host.payments.consumeFailures = 2;
  const result = await host.runtime.purchase('gold_1');
  await flush();
  expect(result.status).toBe('ok');
  expect(host.types()).toEqual(['started', 'granted', 'consume_failed']);
  expect(host.wallet.coins).toBe(1000);
  expect(host.payments.held).toHaveLength(1); // the receipt hangs on the platform

  // same session: the restore only tries to consume (fails again)
  expect(await host.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  // next launch: a fresh runtime over the persisted registry finishes the consume
  const next = host.reload();
  expect(await next.restore()).toEqual({ status: 'ok', found: 1, granted: [] });

  expect(host.wallet.coins).toBe(1000);
  expect(host.grants).toEqual(['gold_1:tok-1']);
  expect(host.payments.held).toEqual([]);
  expect(await next.restore()).toEqual({ status: 'ok', found: 0, granted: [] });
});

test('a purchase in flight blocks an accidental second request without reaching the platform', async () => {
  const host = makeHost();
  host.payments.mode = 'manual';
  const first = host.runtime.purchase('gold_1', 'shop');
  const second = await host.runtime.purchase('gold_1', 'shop');
  const other = await host.runtime.purchase('gold_2', 'shop');

  expect(second).toEqual({ status: 'busy', productId: 'gold_1', token: undefined, reason: undefined, restoreAdvised: false });
  expect(other.status).toBe('busy');
  expect(host.payments.purchaseCalls).toEqual(['gold_1']);
  expect(host.runtime.getStats()).toMatchObject({ started: 1, pending: 'gold_1' });

  host.payments.settlePurchase('ok');
  await first;
  expect(host.wallet.coins).toBe(1000);
  // free again once the first purchase answered (its consume does not hold it)
  host.payments.mode = 'ok';
  expect((await host.runtime.purchase('gold_2')).status).toBe('ok');
  expect(host.wallet.coins).toBe(4500);
});

test('the grant follows the product the PLATFORM reports, not the requested one', async () => {
  const host = makeHost();
  host.payments.answerProductId = 'gold_2';
  const result = await host.runtime.purchase('gold_1', 'shop');
  expect(result).toMatchObject({ status: 'ok', productId: 'gold_2' });
  expect(host.wallet.coins).toBe(3500);
  expect(host.contexts[0]).toMatchObject({ productId: 'gold_2', requestedProductId: 'gold_1' });
  expect(host.events.at(-1)).toMatchObject({ type: 'granted', productId: 'gold_2', requestedProductId: 'gold_1' });
});

test('a foreign product nobody can grant: error no_grant — like the donor it is already marked and consumed, only reported', async () => {
  const host = makeHost();
  host.payments.answerProductId = 'someone_elses_product';
  const result = await host.runtime.purchase('gold_1');
  expect(result).toMatchObject({ status: 'error', reason: 'no_grant', productId: 'gold_1', token: 'tok-1', restoreAdvised: false });
  expect(host.wallet.coins).toBe(0);
  // donor: the platform handler marks + consumes before the game sees the product ("[IAP] paid product has no reward mapping")
  expect(host.store.tokens()).toEqual(['tok-1']);
  expect(host.payments.consumeCalls).toHaveLength(1);
  expect(host.payments.held).toEqual([]);
  expect(errorsOf(host.events)).toEqual(['no_grant']);
  expect(host.runtime.isPayer()).toBe(true); // the money WAS taken
});

test('an ok answer without a product id grants nothing', async () => {
  const host = makeHost();
  host.payments.purchase = () => Promise.resolve({ status: 'ok', token: 'tok-x' });
  const result = await host.runtime.purchase('gold_1');
  expect(result).toMatchObject({ status: 'error', reason: 'no_product_id', restoreAdvised: true });
  expect(host.wallet.coins).toBe(0);
  expect(host.store.tokens()).toEqual([]);
});

test('a throwing grant: reported as grant_threw; the token is already marked and consumed (donor order), so it is never granted later either', async () => {
  let broken = true;
  const wallet = { coins: 0 };
  const payments = new FakePayments();
  const store = createGrantedPurchaseStore();
  const events: string[] = [];
  const runtime = new PurchaseRuntime<DemoRewards>({
    payments,
    granted: store,
    resolveGrant: (productId) => CATALOG[productId],
    grant: (_productId, rewards) => {
      if (broken) throw new Error('profile is not loaded yet');
      wallet.coins += rewards.coins;
    },
    onEvent: (event) => events.push(event.type === 'error' ? `error:${event.reason}` : event.type)
  });

  const result = await runtime.purchase('gold_1');
  expect(result).toMatchObject({ status: 'error', reason: 'grant_threw', token: 'tok-1', restoreAdvised: false });
  expect(store.tokens()).toEqual(['tok-1']);
  expect(payments.consumeCalls).toHaveLength(1);
  expect(payments.held).toEqual([]);

  // the runtime keeps working, and the lost purchase can never turn into a double grant
  broken = false;
  expect(await runtime.restore()).toEqual({ status: 'ok', found: 0, granted: [] });
  expect((await runtime.purchase('gold_2')).status).toBe('ok');
  expect(wallet.coins).toBe(3500);
  expect(events).toEqual(['started', 'error:grant_threw', 'started', 'granted']);
});

test('a throwing resolveGrant is a grant failure too', async () => {
  const host = makeHost({
    resolveGrant: () => {
      throw new Error('catalog exploded');
    }
  });
  expect(await host.runtime.purchase('gold_1')).toMatchObject({ status: 'error', reason: 'grant_threw', restoreAdvised: false });
  expect(host.wallet.coins).toBe(0);
  expect(host.store.tokens()).toEqual(['tok-1']);
  expect(host.payments.consumeCalls).toHaveLength(1);
});

test('a purchase without a token is granted but cannot be marked (donor: better a rare double grant than an unpaid purchase)', async () => {
  const host = makeHost();
  host.payments.tokenless = true;
  const result = await host.runtime.purchase('gold_1');
  expect(result).toMatchObject({ status: 'ok', token: undefined });
  expect(host.wallet.coins).toBe(1000);
  expect(host.store.tokens()).toEqual([]);
  expect(host.events.at(-1)).toMatchObject({ type: 'granted', token: undefined });
  expect(host.payments.consumeCalls).toHaveLength(1); // the SDK object still goes to consume()
  expect(host.payments.consumeCalls[0]!.raw).toEqual({ sdk: true });
});

// ---------------------------------------------------------------- restore

test('restore grants a purchase it has not seen — through the same pipeline, as restored', async () => {
  const host = makeHost();
  host.payments.hold('gold_2', 'old-1');
  const result = await host.runtime.restore();
  expect(result).toEqual({ status: 'ok', found: 1, granted: [{ productId: 'gold_2', token: 'old-1' }] });
  expect(host.wallet.coins).toBe(3500);
  expect(host.contexts[0]).toEqual({ productId: 'gold_2', token: 'old-1', restored: true, source: undefined, requestedProductId: undefined });
  expect(host.events).toEqual([
    { type: 'granted', productId: 'gold_2', token: 'old-1', rewards: CATALOG['gold_2'], restored: true, source: undefined, requestedProductId: undefined }
  ]);
  expect(host.store.tokens()).toEqual(['old-1']);
  expect(host.payments.held).toEqual([]);
  expect(host.runtime.getStats()).toMatchObject({ granted: 1, restored: 1, payer: true });
});

test('restore ignores a token it has seen: consumed, not granted', async () => {
  const host = makeHost({ granted: createGrantedPurchaseStore({ initial: ['old-1'] }) });
  host.payments.hold('gold_2', 'old-1');
  expect(await host.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect(host.wallet.coins).toBe(0);
  expect(host.events).toEqual([{ type: 'duplicate', productId: 'gold_2', token: 'old-1', restored: true, source: undefined }]);
  expect(host.payments.held).toEqual([]);
});

test('restore with several purchases: each unseen one once, the seen one and the repeated one never', async () => {
  const host = makeHost({ granted: createGrantedPurchaseStore({ initial: ['seen'] }) });
  host.payments.hold('gold_1', 'a');
  host.payments.hold('gold_2', 'seen');
  host.payments.hold('gold_2', 'b');
  host.payments.hold('gold_1', 'a'); // the platform lists the same receipt twice
  host.payments.hold('starter_pack', 'c');

  const result = await host.runtime.restore();

  expect(result.found).toBe(5);
  expect(result.granted).toEqual([
    { productId: 'gold_1', token: 'a' }, { productId: 'gold_2', token: 'b' }, { productId: 'starter_pack', token: 'c' }
  ]);
  expect(host.grants).toEqual(['gold_1:a', 'gold_2:b', 'starter_pack:c']);
  expect(host.wallet.coins).toBe(1000 + 3500 + 500);
  expect(host.runtime.getStats()).toMatchObject({ granted: 3, restored: 3, duplicates: 2 });
  expect(await host.runtime.restore()).toEqual({ status: 'ok', found: 0, granted: [] });
});

test('the payment went through but purchase() answered empty: cancelled now, granted once by the restore wave', async () => {
  const host = makeHost();
  host.payments.mode = 'paid-but-null';
  const result = await host.runtime.purchase('gold_1', 'shop');
  expect(result).toMatchObject({ status: 'cancelled', restoreAdvised: true });
  expect(host.wallet.coins).toBe(0);

  // the host's waves (donor: 3 s / 15 s / 45 s) — three restores, one grant
  for (let wave = 0; wave < 3; wave++) await host.runtime.restore();
  expect(host.wallet.coins).toBe(1000);
  expect(host.grants).toEqual(['gold_1:tok-1']);
});

test('restore order per receipt: Yandex known? → consume → mark → grant, CleverApps known? → mark → grant → consume; no receipt waits for another', async () => {
  const run = async (policy: 'after-consume' | 'before-consume') => {
    const order: string[] = [];
    const inner = createGrantedPurchaseStore();
    const payments = new FakePayments();
    payments.restoreGrant = policy;
    const consume = payments.consume.bind(payments);
    payments.consume = (purchase) => {
      order.push(`consume:${purchase.token}`);
      return consume(purchase);
    };
    const runtime = new PurchaseRuntime<DemoRewards>({
      payments,
      granted: { has: (token) => (order.push(`has:${token}`), inner.has(token)), add: (token) => (order.push(`mark:${token}`), inner.add(token)) },
      resolveGrant: (productId) => CATALOG[productId],
      grant: (_productId, _rewards, context) => order.push(`grant:${context.token}`),
      onEvent: (event) => event.type === 'granted' && order.push(`event:granted:${event.token}`)
    });
    payments.hold('gold_1', 'a');
    payments.hold('gold_2', 'b');
    expect((await runtime.restore()).granted.map((it) => it.token)).toEqual(['a', 'b']);
    return order;
  };
  // Yandex check.consummations (0.1.31 :684-698): alreadyGranted? → consumePurchase → markGranted → grant. The
  // consumes are started together and every receipt is granted as soon as ITS consume answered — the donor
  // granted the whole pass from its answer, so a consumed receipt waited for (and was lost with) the others
  expect(await run('after-consume')).toEqual([
    'has:a', 'consume:a', 'has:b', 'consume:b',
    'has:a', 'mark:a', 'grant:a', 'event:granted:a',
    'has:b', 'mark:b', 'grant:b', 'event:granted:b'
  ]);
  // CleverApps checkConsummations (0.1.31 :649-655): already? → markGranted → consume (failure ignored). A
  // marked receipt is granted at once — the donor granted it after the consume and the pass
  expect(await run('before-consume')).toEqual([
    'has:a', 'mark:a', 'grant:a', 'event:granted:a', 'consume:a',
    'has:b', 'mark:b', 'grant:b', 'event:granted:b', 'consume:b'
  ]);
});

test('after-consume (Yandex, default): a purchase whose consume fails is NOT granted and waits for the next restore', async () => {
  const host = makeHost();
  host.payments.hold('gold_1', 'old-1');
  host.payments.consumeFailures = 1;

  expect(await host.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect(host.wallet.coins).toBe(0);
  expect(host.store.tokens()).toEqual([]); // not marked either — the receipt is still fully pending
  expect(host.types()).toEqual(['consume_failed']);

  expect((await host.runtime.restore()).granted).toEqual([{ productId: 'gold_1', token: 'old-1' }]);
  expect(host.wallet.coins).toBe(1000);
  expect(host.payments.log).toEqual(['restore', 'consume:old-1', 'restore', 'consume:old-1']);
});

test('after-consume never over-grants even when the registry cannot persist and the payment service is down', async () => {
  const amnesiac = { has: () => false, add: () => undefined };
  const host = makeHost({ granted: amnesiac });
  host.payments.hold('gold_1', 'old-1');
  host.payments.consumeFailures = 3;
  for (let launch = 0; launch < 3; launch++) await host.reload().restore();
  expect(host.wallet.coins).toBe(0);
  await host.reload().restore(); // the service is back
  await host.reload().restore();
  expect(host.wallet.coins).toBe(1000);
});

test('before-consume (CleverApps): marked and granted first, the consume failure is ignored; the consume is finished later without a grant', async () => {
  const host = makeHost();
  host.payments.restoreGrant = 'before-consume';
  host.payments.hold('gold_1', 'pay-1');
  host.payments.consumeFailures = 1;

  expect((await host.runtime.restore()).granted).toEqual([{ productId: 'gold_1', token: 'pay-1' }]);
  expect(host.wallet.coins).toBe(1000);
  expect(host.store.tokens()).toEqual(['pay-1']);
  expect(host.types()).toEqual(['granted', 'consume_failed']);

  expect(await host.reload().restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect(host.wallet.coins).toBe(1000);
  expect(host.payments.held).toEqual([]);
});

test('a platform without consume(): the registry alone keeps a listed purchase from being granted twice', async () => {
  const payments = new FakePayments();
  (payments as { consume?: unknown }).consume = undefined;
  const host = makeHost({ payments });
  payments.hold('gold_1', 'entitlement-1');
  for (let i = 0; i < 3; i++) await host.reload().restore();
  expect(host.wallet.coins).toBe(1000);
  expect((await host.runtime.purchase('gold_2')).status).toBe('ok');
  expect(host.wallet.coins).toBe(4500);
});

test('a restored purchase without a token is granted without marking; without a product id it is left alone', async () => {
  const host = makeHost();
  host.payments.hold('gold_1');
  host.payments.hold(undefined, 'orphan');
  const result = await host.runtime.restore();
  expect(result.granted).toEqual([{ productId: 'gold_1', token: undefined }]);
  expect(host.wallet.coins).toBe(1000);
  expect(errorsOf(host.events)).toEqual(['no_product_id']);
  expect(host.payments.held).toEqual([{ token: 'orphan', raw: { sdk: true } }]); // never consumed blindly
  expect(host.store.tokens()).toEqual([]);
});

test('a restored product without a reward mapping is reported loudly; like the donor it is already marked and consumed', async () => {
  for (const policy of ['after-consume', 'before-consume'] as const) {
    const host = makeHost({ resolveGrant: () => undefined });
    host.payments.restoreGrant = policy;
    host.payments.hold('new_pack', 'np-1');
    expect(await host.runtime.restore(), policy).toEqual({ status: 'ok', found: 1, granted: [] });
    expect(errorsOf(host.events), policy).toEqual(['no_grant']);
    expect(host.store.tokens(), policy).toEqual(['np-1']);
    expect(host.payments.held, policy).toEqual([]);
    expect(host.wallet.coins).toBe(0);
  }
});

test('two parallel restores never pay one receipt twice: the second is busy (donor review 15.09 №11)', async () => {
  const host = makeHost();
  host.payments.hold('gold_1', 'old-1');
  const [first, second] = await Promise.all([host.runtime.restore(), host.runtime.restore()]);
  expect(first.granted).toHaveLength(1);
  expect(second).toEqual({ status: 'busy', found: 0, granted: [] });
  expect(host.payments.restoreCalls).toBe(1);
  expect(host.wallet.coins).toBe(1000);
  expect(host.runtime.getStats().restoring).toBe(false);
});

test('a restore racing a direct purchase of the same receipt grants it once, whichever continuation runs first', async () => {
  for (const policy of ['after-consume', 'before-consume'] as const) {
    for (const restoreFirst of [true, false]) {
      const host = makeHost();
      host.payments.restoreGrant = policy;
      host.payments.mode = 'manual';
      const purchase = host.runtime.purchase('gold_1', 'shop');
      if (restoreFirst) {
        // the receipt is already on the platform when the restore lists it, the purchase answers later
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const restore = host.payments.restore.bind(host.payments);
        host.payments.restore = async () => {
          await gate;
          return restore();
        };
        const restoring = host.runtime.restore();
        host.payments.settlePurchase('ok');
        release();
        await Promise.all([purchase, restoring]);
      } else {
        host.payments.settlePurchase('ok');
        await Promise.all([purchase, host.runtime.restore()]);
      }
      expect(host.wallet.coins, `${policy} restoreFirst=${restoreFirst}`).toBe(1000);
      expect(host.grants).toEqual(['gold_1:tok-1']);
    }
  }
});

test('restore never rejects: a throwing adapter is status error, and the next call works', async () => {
  const host = makeHost();
  host.payments.hold('gold_1', 'old-1');
  host.payments.restoreThrows = true;
  expect(await host.runtime.restore()).toEqual({ status: 'error', found: 0, granted: [] });
  expect(errorsOf(host.events)).toEqual(['restore_failed']);
  host.payments.restoreThrows = false;
  expect((await host.runtime.restore()).granted).toHaveLength(1);
});

test('restore tolerates an empty platform answer', async () => {
  const host = makeHost();
  host.payments.restore = () => Promise.resolve(null) as never;
  expect(await host.runtime.restore()).toEqual({ status: 'ok', found: 0, granted: [] });
});

// ---------------------------------------------------------------- registry, payer, events, dispose

test('store persistence: the registry survives a reload through onChange + initial, capped at the last 50 like the donor', async () => {
  let saved: string[] = [];
  const persist = () => createGrantedPurchaseStore({ initial: saved, onChange: (tokens) => (saved = tokens) });
  const host = makeHost({ granted: persist() });
  host.payments.consumeFailures = 1;
  await host.runtime.purchase('gold_1');
  expect(saved).toEqual(['tok-1']);

  // "reload": a new store from what the host saved, a new runtime — the hanging receipt is not paid out again
  const next = makeHost({ payments: host.payments, granted: persist() });
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect(next.wallet.coins).toBe(0);

  const store = createGrantedPurchaseStore({ initial: ['x', 'x', '', 42, null, 'y'] });
  expect(store.tokens()).toEqual(['x', 'y']);
  for (let i = 0; i < 60; i++) store.add(`t${i}`);
  expect(store.tokens()).toHaveLength(50);
  expect(store.has('x')).toBe(false); // the oldest went first
  expect(store.has('t59')).toBe(true);
  store.add('t59');
  expect(store.tokens()).toHaveLength(50);
  expect(createGrantedPurchaseStore({ cap: 2, initial: ['a', 'b', 'c'] }).tokens()).toEqual(['b', 'c']);
  expect(() => createGrantedPurchaseStore({ cap: 0 })).toThrow(RangeError);
});

test('a registry that throws (private mode) degrades to "no registry" — the purchase is still granted', async () => {
  const host = makeHost({
    granted: {
      has: () => {
        throw new Error('SecurityError');
      },
      add: () => {
        throw new Error('QuotaExceededError');
      }
    }
  });
  expect((await host.runtime.purchase('gold_1')).status).toBe('ok');
  expect(host.wallet.coins).toBe(1000);
  expect(host.runtime.getStats().storeErrors).toBe(2);
});

test('isPayer: the host knowledge OR a payment confirmed in this session', async () => {
  let profilePayments = 0;
  const host = makeHost({ isPayer: () => profilePayments > 0 });
  expect(host.runtime.isPayer()).toBe(false);
  profilePayments = 1; // the profile arrived later
  expect(host.runtime.isPayer()).toBe(true);
  profilePayments = 0;
  host.payments.mode = 'cancel';
  await host.runtime.purchase('gold_1');
  expect(host.runtime.isPayer()).toBe(false);
  host.payments.mode = 'ok';
  await host.runtime.purchase('gold_1');
  expect(host.runtime.isPayer()).toBe(true);

  const throwing = makeHost({
    isPayer: () => {
      throw new Error('model is gone');
    }
  });
  expect(throwing.runtime.isPayer()).toBe(false);
});

test('a throwing onEvent never breaks the pipeline: the grant, the mark and the consume still happen', async () => {
  const onPurchaseError = vi.fn();
  const host = makeHost({
    onEvent: () => {
      throw new Error('host handler bug');
    },
    onPurchaseError
  });
  expect((await host.runtime.purchase('gold_1')).status).toBe('ok');
  expect(host.wallet.coins).toBe(1000);
  expect(host.store.tokens()).toEqual(['tok-1']);
  expect(host.payments.held).toEqual([]);
  expect(onPurchaseError).toHaveBeenCalledTimes(2); // started + granted
  expect(onPurchaseError.mock.calls[1]![1]).toMatchObject({ phase: 'onEvent', event: { type: 'granted' } });
  expect(host.runtime.getStats().callbackErrors).toBe(2);
});

test('dispose: new calls are refused, and a payment answered after it is left on the platform for the next runtime', async () => {
  const host = makeHost();
  host.payments.mode = 'manual';
  const running = host.runtime.purchase('gold_1', 'shop');
  host.runtime.dispose();
  expect(host.runtime.getPending()).toBeNull();
  host.payments.settlePurchase('ok'); // the player paid while the game was tearing down

  expect(await running).toMatchObject({ status: 'disposed', restoreAdvised: false });
  expect(host.wallet.coins).toBe(0);
  expect(host.store.tokens()).toEqual([]);
  expect(host.payments.consumeCalls).toEqual([]);
  expect(host.types()).toEqual(['started']);
  expect((await host.runtime.purchase('gold_1')).status).toBe('disposed');
  expect((await host.runtime.restore()).status).toBe('disposed');
  expect(host.runtime.getStats().disposed).toBe(true);

  // nothing was lost: the next runtime restores the paid purchase, once
  host.payments.mode = 'ok';
  expect((await host.reload().restore()).granted).toEqual([{ productId: 'gold_1', token: 'tok-1' }]);
  expect(host.wallet.coins).toBe(1000);
});

test('dispose during a restore never drops a receipt whose consume was already started; dispose during the listing touches nothing', async () => {
  const host = makeHost();
  host.payments.hold('gold_1', 'a');
  host.payments.hold('gold_2', 'b');
  const consume = host.payments.consume.bind(host.payments);
  host.payments.consume = async (purchase) => {
    await consume(purchase);
    host.runtime.dispose(); // arrives while the consumes are in flight — both were started together
  };
  const result = await host.runtime.restore();
  expect(result).toEqual({ status: 'disposed', found: 2, granted: [{ productId: 'gold_1', token: 'a' }, { productId: 'gold_2', token: 'b' }] });
  expect(host.wallet.coins).toBe(4500); // consumed → granted, whatever dispose says
  expect(host.payments.held).toEqual([]);

  const late = makeHost();
  late.payments.hold('gold_1', 'c');
  const list = late.payments.restore.bind(late.payments);
  late.payments.restore = async () => {
    const listed = await list();
    late.runtime.dispose(); // arrives while the platform is listing
    return listed;
  };
  expect(await late.runtime.restore()).toEqual({ status: 'disposed', found: 1, granted: [] });
  expect([late.wallet.coins, late.store.tokens(), late.payments.consumeCalls.length, late.payments.held.length]).toEqual([0, [], 0, 1]);
});

test('the constructor refuses a half-wired host', () => {
  const payments = new FakePayments();
  const granted = createGrantedPurchaseStore();
  const ok = { payments, granted, resolveGrant: () => null, grant: () => undefined };
  expect(() => new PurchaseRuntime({ ...ok, payments: undefined as never })).toThrow(RangeError);
  expect(() => new PurchaseRuntime({ ...ok, payments: { purchase: payments.purchase } as never })).toThrow(RangeError);
  expect(() => new PurchaseRuntime({ ...ok, granted: {} as never })).toThrow(RangeError);
  expect(() => new PurchaseRuntime({ ...ok, resolveGrant: undefined as never })).toThrow(RangeError);
  expect(() => new PurchaseRuntime({ ...ok, grant: undefined as never })).toThrow(RangeError);
  expect(new PurchaseRuntime(ok).getStats()).toMatchObject({ started: 0, granted: 0, payer: false, disposed: false });
});
