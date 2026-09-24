// P0 (Trail Arrow review 20.09 №10, fixed in production 0.1.31): a PAID purchase must never be lost
// because consume() stands between the payment and the grant. Invariant: once the platform confirmed a
// payment, no consume — hanging, failing or cut off by a closed tab — may leave a state where the
// payment can no longer be restored while the item was not granted; one receipt is still granted once.
//   - direct purchase (both restore policies): claim → grant → consume, the answer never waits for consume;
//   - restore `before-consume` (CleverApps): claim → grant → consume, per receipt;
//   - restore `after-consume` (Yandex): consume → claim → grant, per receipt, receipts independent —
//     the grant still waits for ITS consume: that is what keeps a listed receipt from being granted on
//     every pass when the registry cannot persist.
import { expect, test } from 'vitest';
import { createGrantedPurchaseStore } from '../../src/purchases';
import type { PlatformPurchase } from '../../src/purchases';
import { FakePayments, makeHost } from './fixtures';

/** Lets every pending microtask / promise continuation run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A persisted registry: what `createGrantedPurchaseStore` + the host's onChange left on disk. */
function persistedRegistry() {
  let saved: string[] = [];
  return { open: () => createGrantedPurchaseStore({ initial: saved, onChange: (tokens) => (saved = tokens) }), saved: () => saved };
}

/** consume() of the listed tokens never settles (a hung SDK call, or the tab closed mid-request). */
function hangConsume(payments: FakePayments, tokens: readonly string[]) {
  const consume = payments.consume.bind(payments);
  const hung: PlatformPurchase[] = [];
  payments.consume = (purchase) => {
    if (purchase.token !== undefined && tokens.includes(purchase.token)) {
      payments.consumeCalls.push(purchase);
      payments.log.push(`consume:${purchase.token}:hangs`);
      hung.push(purchase);
      return new Promise<void>(() => undefined);
    }
    return consume(purchase);
  };
  return {
    hung,
    /** The request that was cut off DID reach the platform: the receipt is gone. */
    landOnPlatform: () => (payments.held = payments.held.filter((it) => !hung.some((h) => h.token === it.token))),
    restore: () => (payments.consume = consume)
  };
}

// ---------------------------------------------------------------- CASE A: consume hangs

test('CASE A: a direct purchase whose consume never settles is granted and answered ok; the runtime is free for the next purchase', async () => {
  for (const policy of ['after-consume', 'before-consume'] as const) {
    const host = makeHost();
    host.payments.restoreGrant = policy;
    hangConsume(host.payments, ['tok-1']);

    let answered: unknown;
    void host.runtime.purchase('gold_1', 'shop').then((result) => (answered = result));
    await flush();

    expect(answered, policy).toEqual({ status: 'ok', productId: 'gold_1', token: 'tok-1', reason: undefined, restoreAdvised: false });
    expect(host.wallet.coins, policy).toBe(1000);
    expect(host.types(), policy).toEqual(['started', 'granted']);
    expect(host.runtime.getPending(), policy).toBeNull();
    expect((await host.runtime.purchase('gold_2')).status, policy).toBe('ok'); // not `busy` behind the hung consume
    expect(host.wallet.coins, policy).toBe(4500);
  }
});

test('CASE A: the grant is given BEFORE consume is called — a tab closed while consume runs has nothing left to lose', async () => {
  for (const policy of ['after-consume', 'before-consume'] as const) {
    const host = makeHost();
    host.payments.restoreGrant = policy;
    const atConsume: string[] = [];
    const consume = host.payments.consume.bind(host.payments);
    host.payments.consume = (purchase) => {
      atConsume.push(`coins=${host.wallet.coins} marked=${host.store.has(purchase.token!)}`);
      return consume(purchase);
    };
    await host.runtime.purchase('gold_1', 'shop');
    expect(atConsume, policy).toEqual(['coins=1000 marked=true']);
    expect(host.order.slice(0, 3), policy).toEqual(['event:started', 'grant:gold_1', 'marked-during-grant:true']);
  }
});

test('CASE A: the tab closes while the consume hangs — whether or not the consume landed, the player owns the item exactly once', async () => {
  for (const landed of [false, true]) {
    const disk = persistedRegistry();
    const host = makeHost({ granted: disk.open() });
    const hang = hangConsume(host.payments, ['tok-1']);
    void host.runtime.purchase('gold_1', 'shop');
    await flush();
    expect(host.wallet.coins).toBe(1000); // granted in the session that paid

    // the tab is closed now; the cut-off consume request did (not) reach the platform
    if (landed) hang.landOnPlatform();
    hang.restore();
    const next = makeHost({ payments: host.payments, granted: disk.open() });
    expect(await next.runtime.restore(), `landed=${landed}`).toEqual({ status: 'ok', found: landed ? 0 : 1, granted: [] });
    expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 0, granted: [] });
    expect(host.wallet.coins + next.wallet.coins, `landed=${landed}`).toBe(1000); // once, never twice
    expect(host.payments.held).toEqual([]); // the receipt is closed in the end
  }
});

// ---------------------------------------------------------------- CASE B: consume fails

test('CASE B: a failing consume never costs the grant; the failure is reported after it and the next restore closes the receipt without a 2nd grant', async () => {
  const disk = persistedRegistry();
  const host = makeHost({ granted: disk.open() });
  host.payments.consumeFailures = 1;
  const result = await host.runtime.purchase('gold_1', 'shop');
  await flush();
  expect(result).toMatchObject({ status: 'ok', token: 'tok-1' });
  expect(host.types()).toEqual(['started', 'granted', 'consume_failed']);
  expect(host.runtime.getStats()).toMatchObject({ granted: 1, consumeFailures: 1, pending: null });
  expect(host.payments.held).toHaveLength(1);

  const next = makeHost({ payments: host.payments, granted: disk.open() }); // restart
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect(host.wallet.coins + next.wallet.coins).toBe(1000);
  expect(host.payments.held).toEqual([]);
});

test('CASE B: restore before-consume — a failing consume of one receipt does not stop the grant of any', async () => {
  const host = makeHost();
  host.payments.restoreGrant = 'before-consume';
  host.payments.hold('gold_1', 'a');
  host.payments.hold('gold_2', 'b');
  host.payments.consumeFailures = 1; // "a" fails
  const result = await host.runtime.restore();
  expect(result.granted.map((it) => it.token)).toEqual(['a', 'b']);
  expect(host.wallet.coins).toBe(4500);
  expect(host.types()).toEqual(['granted', 'granted', 'consume_failed']);
  expect(await host.reload().restore()).toEqual({ status: 'ok', found: 1, granted: [] }); // closes "a", no 2nd grant
  expect(host.wallet.coins).toBe(4500);
});

// ---------------------------------------------------------------- CASE C: the same receipt again

test('CASE C: the same receipt arriving again — a repeated direct answer, a restore while its consume still hangs, a restart — is granted once', async () => {
  const disk = persistedRegistry();
  const host = makeHost({ granted: disk.open() });
  const hang = hangConsume(host.payments, ['tok-1']);
  void host.runtime.purchase('gold_1', 'shop');
  await flush();

  // the restore wave lists the receipt whose consume is still in flight: known → only consumed
  void host.runtime.restore();
  await flush();
  // the platform replays the direct answer
  host.payments.purchase = () => Promise.resolve({ status: 'ok', productId: 'gold_1', token: 'tok-1' });
  expect((await host.runtime.purchase('gold_1')).status).toBe('duplicate');
  // restart: a new runtime over the persisted registry, the platform answers again
  hang.restore();
  const next = makeHost({ payments: host.payments, granted: disk.open() });
  await next.runtime.restore();
  await next.runtime.restore();

  expect(host.grants).toEqual(['gold_1:tok-1']);
  expect(next.grants).toEqual([]);
  expect(host.wallet.coins + next.wallet.coins).toBe(1000);
  expect(host.payments.held).toEqual([]);
});

// ---------------------------------------------------------------- CASE D: several receipts, one consume hangs

test('CASE D: after-consume (Yandex) — a hung consume does not hold back the other receipts; each is granted as soon as ITS consume answered', async () => {
  const host = makeHost(); // FakePayments default = after-consume
  host.payments.hold('gold_1', 'a');
  host.payments.hold('gold_2', 'b');
  host.payments.hold('starter_pack', 'c');
  hangConsume(host.payments, ['a']);

  let result: unknown;
  void host.runtime.restore().then((it) => (result = it));
  await flush();

  expect(host.grants).toEqual(['gold_2:b', 'starter_pack:c']); // not waiting for "a"
  expect(host.wallet.coins).toBe(3500 + 500);
  expect(host.store.tokens()).toEqual(['b', 'c']); // "a" is neither marked nor granted: its consume has not answered
  expect(result).toBeUndefined(); // the pass itself ends when every consume answered (the adapter owns the timeout)
  expect(await host.runtime.restore()).toEqual({ status: 'busy', found: 0, granted: [] }); // a 2nd pass cannot double-pay "a"
});

test('CASE D: after-consume — a receipt consumed before another one hangs is granted at once, not at the end of the pass', async () => {
  const host = makeHost();
  host.payments.hold('gold_1', 'b');
  host.payments.hold('gold_2', 'a');
  hangConsume(host.payments, ['a']);
  void host.runtime.restore();
  await flush();
  expect(host.grants).toEqual(['gold_1:b']); // consumed → granted now: a closed tab cannot lose it
});

test('CASE D: after-consume — the hung receipt is recovered by the next launch exactly once, whether or not its consume landed', async () => {
  for (const landed of [false, true]) {
    const disk = persistedRegistry();
    const host = makeHost({ granted: disk.open() });
    host.payments.hold('gold_1', 'a');
    host.payments.hold('gold_2', 'b');
    const hang = hangConsume(host.payments, ['a']);
    void host.runtime.restore();
    await flush();
    expect(host.wallet.coins).toBe(3500);

    if (landed) hang.landOnPlatform();
    hang.restore();
    const next = makeHost({ payments: host.payments, granted: disk.open() });
    await next.runtime.restore();
    await next.runtime.restore();
    // not landed: "a" is still listed and unmarked → granted once now. Landed: the receipt is gone before
    // its grant — the known price of consume-first (see the after-consume note in types.ts)
    expect(next.grants, `landed=${landed}`).toEqual(landed ? [] : ['gold_1:a']);
    expect(host.grants).toEqual(['gold_2:b']);
  }
});

test('CASE D: before-consume (CleverApps) — every listed receipt is granted before any consume, a hung one included; the restart does not grant it again', async () => {
  const disk = persistedRegistry();
  const host = makeHost({ granted: disk.open() });
  host.payments.restoreGrant = 'before-consume';
  host.payments.hold('gold_1', 'a');
  host.payments.hold('gold_2', 'b');
  const hang = hangConsume(host.payments, ['a']);

  let result: unknown;
  void host.runtime.restore().then((it) => (result = it));
  await flush();
  expect(host.grants).toEqual(['gold_1:a', 'gold_2:b']); // "a" is marked, so it had to be granted now
  expect(host.payments.held.map((it) => it.token)).toEqual(['a']);
  expect(result).toBeUndefined();

  hang.restore();
  const next = makeHost({ payments: host.payments, granted: disk.open() });
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] }); // consumed, not granted again
  expect(host.wallet.coins + next.wallet.coins).toBe(4500);
  expect(host.payments.held).toEqual([]);
});

// ---------------------------------------------------------------- the explicit asymmetry

test('the order is explicit: the direct path is grant → consume under BOTH policies, restore follows `restoreGrant`', async () => {
  const run = async (policy: 'after-consume' | 'before-consume', path: 'purchase' | 'restore') => {
    const payments = new FakePayments();
    payments.restoreGrant = policy;
    const host = makeHost({ payments });
    const consume = payments.consume.bind(payments);
    payments.consume = (purchase) => {
      host.order.push(`consume:${purchase.token}`);
      return consume(purchase);
    };
    if (path === 'purchase') await host.runtime.purchase('gold_1');
    else {
      payments.hold('gold_1', 'r-1');
      await host.runtime.restore();
    }
    return host.order.filter((step) => /^(grant|consume):/.test(step));
  };
  expect(await run('after-consume', 'purchase')).toEqual(['grant:gold_1', 'consume:tok-1']);
  expect(await run('before-consume', 'purchase')).toEqual(['grant:gold_1', 'consume:tok-1']);
  expect(await run('before-consume', 'restore')).toEqual(['grant:gold_1', 'consume:r-1']);
  expect(await run('after-consume', 'restore')).toEqual(['consume:r-1', 'grant:gold_1']);
});

test('an adapter without restoreGrant (the default after-consume) and one without consume() keep working', async () => {
  const plain = makeHost();
  delete plain.payments.restoreGrant;
  expect((await plain.runtime.purchase('gold_1')).status).toBe('ok');
  plain.payments.hold('gold_2', 'r-1');
  expect((await plain.runtime.restore()).granted).toEqual([{ productId: 'gold_2', token: 'r-1' }]);
  expect(plain.payments.log).toEqual(['purchase:gold_1', 'consume:tok-1', 'restore', 'consume:r-1']);

  const payments = new FakePayments();
  (payments as { consume?: unknown }).consume = undefined;
  const bare = makeHost({ payments });
  expect((await bare.runtime.purchase('gold_1')).status).toBe('ok');
  payments.hold('gold_2', 'r-2');
  // the unconsumed "tok-1" is listed too: known → nothing; "r-2" is new → granted once
  expect((await bare.runtime.restore()).granted.map((it) => it.token)).toEqual(['r-2']);
  expect(bare.wallet.coins).toBe(4500);
});
