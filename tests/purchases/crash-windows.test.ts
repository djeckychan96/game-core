// Purchase durability: what survives a process death at each point of the pipeline, with the CURRENT
// contract (a sync `grant`, a separate `GrantedPurchaseStore`, the host saving its profile on `granted`).
//
// `test` = a window the current contract closes. `test.fails` = an OPEN window, reproduced: the body states
// the invariant and fails today. They cannot be closed inside PurchaseRuntime alone — the registry and the
// product state are two independent durable writes owned by the host, so a crash between them loses the
// item (token first) or grants it twice (product first), whatever order Core picks. Flip them to `test`
// with the durable-delivery slice (see the design report of 2026-09-24).
import { expect, test } from 'vitest';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import type { PlatformPurchase, RestoreGrantPolicy } from '../../src/purchases';
import { CATALOG, FakePayments } from './fixtures';

type Rewards = { coins: number } | { noAds: true };
type Profile = { coins: number; noAds: boolean };
const resolveGrant = (productId: string): Rewards | undefined => (productId === 'no_ads' ? { noAds: true } : CATALOG[productId]);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * One device. DURABLE: `disk` (writes that FINISHED) and `payments` (the platform — receipts survive the
 * client). VOLATILE: the process — the runtime, the in-memory profile, writes still in flight. The host
 * has the donors' shape (Trail Arrow, SoliPix): the granted registry is persisted on its own, the profile
 * by a save started on `granted`.
 */
class Device {
  readonly disk: { registry: string[]; profile: Profile } = { registry: [], profile: { coins: 0, noAds: false } };
  readonly payments = new FakePayments();
  process!: ReturnType<Device['boot']>;

  constructor(private readonly registryWrite: 'sync' | 'queued' = 'sync') {
    this.process = this.boot();
  }

  /** The process dies: the in-memory state and every write still in flight are gone; nothing it had pending runs. */
  crash(): void {
    this.process.alive = false;
    this.process.runtime.dispose();
  }

  restart() {
    this.crash();
    this.process = this.boot();
    return this.process;
  }

  private boot() {
    const disk = this.disk;
    const proc = {
      alive: true,
      profile: { ...disk.profile },
      /** Writes started but not finished, by target — `land()` finishes them. */
      queued: { registry: [] as Array<() => void>, profile: [] as Array<() => void> },
      events: [] as string[],
      runtime: null as unknown as PurchaseRuntime<Rewards>,
      land(target: 'registry' | 'profile'): void {
        if (!proc.alive) return;
        for (const write of proc.queued[target].splice(0)) write();
      }
    };
    const store = createGrantedPurchaseStore({
      initial: disk.registry,
      onChange: (tokens) => {
        if (!proc.alive) return;
        if (this.registryWrite === 'sync') disk.registry = tokens; // the donors: localStorage, written at once
        else proc.queued.registry.push(() => (disk.registry = tokens));
      }
    });
    proc.runtime = new PurchaseRuntime<Rewards>({
      payments: this.payments,
      granted: store,
      productKinds: { no_ads: 'entitlement' },
      resolveGrant,
      grant: (_productId, rewards) => {
        if ('noAds' in rewards) proc.profile.noAds = true;
        else proc.profile.coins += rewards.coins;
      },
      onEvent: (event) => {
        proc.events.push(event.type);
        // the host saves its profile on `granted` — asynchronously (cloud / a debounced save)
        if (event.type === 'granted') {
          const snapshot = { ...proc.profile };
          proc.queued.profile.push(() => (disk.profile = snapshot));
        }
      }
    });
    return proc;
  }
}

/** consume() reaches the platform (the receipt is gone), but the answer never arrives / times out. */
function consumeLandsAckLost(payments: FakePayments, how: 'rejects' | 'hangs'): void {
  payments.consume = (purchase: PlatformPurchase) => {
    payments.consumeCalls.push(purchase);
    payments.held = payments.held.filter((it) => it.token !== purchase.token);
    return how === 'rejects' ? Promise.reject(new Error('sdk_timeout:consume')) : new Promise<void>(() => undefined);
  };
}

/** consume() never reaches the platform and never answers (the tab closes mid-request). */
function consumeNeverLands(payments: FakePayments): () => void {
  const consume = payments.consume.bind(payments);
  payments.consume = () => new Promise<void>(() => undefined);
  return () => (payments.consume = consume);
}

// ---------------------------------------------------------------- windows the current contract closes

test('crash before the grant (paid, the answer never reached the game): the next launch restores it once', async () => {
  for (const policy of ['after-consume', 'before-consume'] as RestoreGrantPolicy[]) {
    const device = new Device();
    device.payments.restoreGrant = policy;
    device.payments.mode = 'manual';
    void device.process.runtime.purchase('gold_1', 'shop');
    device.payments.settlePurchase('ok'); // the money is taken…
    device.crash(); // …and the process dies before the answer is handled

    const next = device.restart();
    await next.runtime.restore();
    next.land('profile');
    await next.runtime.restore();
    expect(device.disk.profile.coins, policy).toBe(1000);
    expect(device.payments.held, policy).toEqual([]);
  }
});

test('crash after the product save landed, before the consume: the receipt is closed later, never granted twice', async () => {
  const device = new Device();
  const release = consumeNeverLands(device.payments);
  await device.process.runtime.purchase('gold_1', 'shop');
  device.process.land('profile');
  device.crash();
  release();

  const next = device.restart();
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect([device.disk.profile.coins, next.profile.coins, device.payments.held.length]).toEqual([1000, 1000, 0]);
});

test('direct purchase: a consume that lands while its answer is lost costs nothing — the grant came first', async () => {
  const device = new Device();
  consumeLandsAckLost(device.payments, 'rejects');
  await device.process.runtime.purchase('gold_1', 'shop');
  await flush();
  device.process.land('profile');
  expect(device.process.events).toEqual(['started', 'granted', 'consume_failed']);
  const next = device.restart();
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 0, granted: [] });
  expect(device.disk.profile.coins).toBe(1000);
});

test('the same receipt again — a replayed answer, restores, a restart — is granted once (saves landed)', async () => {
  const device = new Device();
  const release = consumeNeverLands(device.payments);
  await device.process.runtime.purchase('gold_1', 'shop');
  device.process.land('profile');
  device.payments.purchase = () => Promise.resolve({ status: 'ok', productId: 'gold_1', token: 'tok-1' });
  expect((await device.process.runtime.purchase('gold_1')).status).toBe('duplicate');
  device.crash();
  release();
  const next = device.restart();
  await next.runtime.restore();
  await next.runtime.restore();
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000);
});

test('independent receipts with one hung consume, a crash, a restart: each paid receipt ends up granted once (saves landed)', async () => {
  const device = new Device(); // after-consume: the Yandex order
  device.payments.hold('gold_1', 'a');
  device.payments.hold('gold_2', 'b');
  const consume = device.payments.consume.bind(device.payments);
  device.payments.consume = (purchase) => (purchase.token === 'a' ? new Promise<void>(() => undefined) : consume(purchase));
  void device.process.runtime.restore();
  await flush();
  device.process.land('profile');
  device.crash();
  device.payments.consume = consume;

  const next = device.restart();
  await next.runtime.restore();
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000 + 3500);
  expect(device.payments.held).toEqual([]);
});

test('no_ads entitlement: a crash before the profile save loses nothing (restore answers `owned`), repeated restores have no side effects', async () => {
  const device = new Device();
  await device.process.runtime.purchase('no_ads', 'settings');
  device.crash(); // the profile save of the flag never landed; the registry did (sync)
  expect(device.disk.profile.noAds).toBe(false);

  const next = device.restart();
  const first = await next.runtime.restore();
  for (const it of first.owned ?? []) if (it.productId === 'no_ads') next.profile.noAds = true; // host: re-assert
  expect(first).toEqual({ status: 'ok', found: 1, granted: [], owned: [{ productId: 'no_ads', token: 'tok-1' }] });
  expect(next.profile.noAds).toBe(true);
  for (let i = 0; i < 3; i++) expect((await next.runtime.restore()).owned).toHaveLength(1);
  expect(next.events).toEqual([]); // no grant, no duplicate, no revenue — every pass
  expect(device.payments.consumeCalls).toEqual([]); // never consumed

  // the registry lost too (a new device): granted again — an idempotent flag, `restored` (no revenue)
  const fresh = new Device();
  fresh.payments.hold('no_ads', 'tok-1');
  await fresh.process.runtime.restore();
  expect([fresh.process.profile.noAds, fresh.process.events]).toEqual([true, ['granted']]);
});

// ---------------------------------------------------------------- OPEN windows (reproduced)

test.fails('OPEN — CASE 1, token before product: registry durable, the product save still in flight, crash → the paid item is LOST', async () => {
  const device = new Device(); // registry written at once (localStorage), profile saved on `granted`
  expect((await device.process.runtime.purchase('gold_1', 'shop')).status).toBe('ok');
  expect(device.disk.registry).toEqual(['tok-1']); // durable
  expect(device.disk.profile.coins).toBe(0); // the save has not landed
  device.crash();

  const next = device.restart();
  await next.runtime.restore(); // the token is known → nothing is granted; the receipt is consumed / gone
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000); // today: 0
});

test.fails('OPEN — CASE 1 on restore (before-consume): marked, the product save in flight, crash → LOST', async () => {
  const device = new Device();
  device.payments.restoreGrant = 'before-consume';
  device.payments.hold('gold_1', 'r-1');
  await device.process.runtime.restore();
  device.crash();
  const next = device.restart();
  await next.runtime.restore();
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000); // today: 0
});

test.fails('OPEN — CASE 2, product before token: the product save landed, the registry write did not, crash → granted TWICE', async () => {
  // the order "grant → await the save → mark" (or any host whose registry write lands after the profile's)
  const device = new Device('queued');
  const release = consumeNeverLands(device.payments); // the receipt is still on the platform at the crash
  await device.process.runtime.purchase('gold_1', 'shop');
  device.process.land('profile'); // product durable
  expect(device.disk.registry).toEqual([]); // token not durable
  device.crash();
  release();

  const next = device.restart();
  await next.runtime.restore(); // unknown token + listed receipt → granted again
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000); // today: 2000
});

test.fails('OPEN — CASE 3, Yandex after-consume lost ack: the consume reached the platform, its answer timed out → LOST (no crash needed)', async () => {
  const device = new Device(); // after-consume
  device.payments.hold('gold_1', 'r-1'); // Core has productId + token BEFORE the consume
  consumeLandsAckLost(device.payments, 'rejects');
  await device.process.runtime.restore(); // consume "failed" → not marked, not granted; the receipt is gone
  const next = device.restart();
  await next.runtime.restore();
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000); // today: 0
});

test.fails('OPEN — CASE 3 with a process death while the landed consume is unanswered → LOST', async () => {
  const device = new Device();
  device.payments.hold('gold_1', 'r-1');
  consumeLandsAckLost(device.payments, 'hangs');
  void device.process.runtime.restore();
  await flush();
  device.crash();
  const next = device.restart();
  await next.runtime.restore();
  next.land('profile');
  expect(device.disk.profile.coins).toBe(1000); // today: 0
});
