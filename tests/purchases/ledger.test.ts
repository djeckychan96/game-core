// Purchase Ledger V1 (ledger mode): a consumable is delivered by the value OWNER's `apply` — the effect and
// the token in ONE durable write of ONE record — and consumed only after `applied` / `already_applied`.
// The crash windows that stay open for the legacy pipeline (crash-windows.test.ts, `LEGACY OPEN`) are
// closed here, over the same kind of device: durable = the owner's record + the platform; volatile = the
// process (runtime, the live record, writes in flight).
import { expect, test } from 'vitest';
import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import type { PlatformPurchase, PurchaseLedger, PurchaseLedgerEntry, RestoreGrantPolicy } from '../../src/purchases';
import { CATALOG, FakePayments } from './fixtures';

type Rewards = { coins: number } | { noAds: true };
/** The owner's ONE record: the effect AND the applied tokens (a SoliPix-style game save, or a Core record). */
type SaveRecord = { coins: number; noAds: boolean; applied: string[] };
/** ok = confirmed; fail = not written; ambiguous = written, the answer lost (false); queued = in flight until `land()`. */
type WriteMode = 'ok' | 'fail' | 'ambiguous' | 'queued';

const resolveGrant = (productId: string): Rewards | undefined => (productId === 'no_ads' ? { noAds: true } : CATALOG[productId]);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class Device {
  readonly disk: { record: SaveRecord; registry: string[] } = { record: { coins: 0, noAds: false, applied: [] }, registry: [] };
  readonly payments = new FakePayments();
  /** A GUEST without any durable storage answers every write `fail`. */
  writeMode: WriteMode = 'ok';
  process!: ReturnType<Device['boot']>;

  constructor() {
    this.process = this.boot();
  }

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
      /** The live record — may hold tokens whose write has not confirmed yet. */
      state: structuredClone(disk.record),
      /** Tokens in a CONFIRMED write — the only ones the owner may call applied. */
      confirmed: new Set(disk.record.applied),
      queued: [] as Array<() => void>,
      applies: [] as string[],
      events: [] as string[],
      runtime: null as unknown as PurchaseRuntime<Rewards>,
      land(): void {
        if (proc.alive) for (const write of proc.queued.splice(0)) write();
      },
      /** The ONE durable write of the whole record (effect + tokens together). */
      save: (): Promise<boolean> => {
        if (!proc.alive) return Promise.resolve(false);
        const snapshot = structuredClone(proc.state);
        const confirm = () => snapshot.applied.forEach((token) => proc.confirmed.add(token));
        switch (this.writeMode) {
          case 'ok':
            disk.record = snapshot;
            confirm();
            return Promise.resolve(true);
          case 'fail':
            return Promise.resolve(false);
          case 'ambiguous':
            disk.record = snapshot; // it DID land…
            return Promise.resolve(false); // …but nobody knows
          case 'queued':
            return new Promise<boolean>((resolve) =>
              proc.queued.push(() => {
                disk.record = snapshot;
                confirm();
                resolve(true);
              })
            );
        }
      }
    };
    // the owner's side of the contract: one operation, idempotent by token, honest, the whole record per write
    const ledger: PurchaseLedger<Rewards> = {
      apply: async ({ token, rewards }: PurchaseLedgerEntry<Rewards>) => {
        proc.applies.push(token);
        if (proc.confirmed.has(token)) return 'already_applied';
        if (!proc.state.applied.includes(token) && 'coins' in rewards) {
          proc.state = { ...proc.state, coins: proc.state.coins + rewards.coins, applied: [...proc.state.applied, token] };
        }
        return (await proc.save()) ? 'applied' : 'not_durable';
      }
    };
    proc.runtime = new PurchaseRuntime<Rewards>({
      payments: this.payments,
      granted: createGrantedPurchaseStore({ initial: disk.registry, onChange: (tokens) => proc.alive && (disk.registry = tokens) }),
      productKinds: { no_ads: 'entitlement' },
      resolveGrant,
      ledger,
      // entitlements stay on the legacy path: an idempotent flag, re-asserted from `owned`
      grant: (_productId, rewards) => {
        if ('noAds' in rewards) proc.state = { ...proc.state, noAds: true };
      },
      onEvent: (event) => {
        proc.events.push(event.type === 'error' ? `error:${event.reason}` : event.type);
        if (event.type === 'granted' && event.kind === 'entitlement') void proc.save();
      }
    });
    return proc;
  }
}

function consumeLandsAckLost(payments: FakePayments, how: 'rejects' | 'hangs'): void {
  payments.consume = (purchase: PlatformPurchase) => {
    payments.consumeCalls.push(purchase);
    payments.held = payments.held.filter((it) => it.token !== purchase.token);
    return how === 'rejects' ? Promise.reject(new Error('sdk_timeout:consume')) : new Promise<void>(() => undefined);
  };
}

function consumeNeverLands(payments: FakePayments): () => void {
  const consume = payments.consume.bind(payments);
  payments.consume = (purchase) => (payments.consumeCalls.push(purchase), new Promise<void>(() => undefined));
  return () => (payments.consume = consume);
}

// ---------------------------------------------------------------- delivery

test('1. first apply: the effect once, durable with its token in one write; `granted` once; consumed after', async () => {
  const device = new Device();
  const result = await device.process.runtime.purchase('gold_1', 'shop');
  await flush();
  expect(result).toEqual({ status: 'ok', productId: 'gold_1', token: 'tok-1', reason: undefined, restoreAdvised: false });
  expect(device.disk.record).toEqual({ coins: 1000, noAds: false, applied: ['tok-1'] });
  expect([device.process.events, device.process.applies, device.payments.held]).toEqual([['started', 'granted'], ['tok-1'], []]);
  expect(device.disk.registry).toEqual([]); // the legacy registry is not written for a consumable
});

test('2. a duplicate token never applies twice — a replayed answer, restores, a restart; a legacy-registry token is never applied at all', async () => {
  const device = new Device();
  const release = consumeNeverLands(device.payments);
  await device.process.runtime.purchase('gold_1', 'shop');
  device.payments.purchase = () => Promise.resolve({ status: 'ok', productId: 'gold_1', token: 'tok-1' });
  expect((await device.process.runtime.purchase('gold_1')).status).toBe('duplicate');
  void device.process.runtime.restore(); // already applied → consume only (hangs here)
  await flush();
  expect(device.process.applies).toEqual(['tok-1', 'tok-1', 'tok-1']);
  expect(device.process.events).toEqual(['started', 'granted', 'started', 'duplicate', 'duplicate']);
  release();
  await device.restart().runtime.restore();
  expect(device.disk.record.coins).toBe(1000);
  expect(device.payments.held).toEqual([]);

  // migration: a token the legacy pipeline granted before the switch — never applied, only consumed
  const migrated = new Device();
  migrated.disk.registry = ['old-1'];
  migrated.payments.hold('gold_2', 'old-1');
  const next = migrated.restart();
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect([next.applies, migrated.disk.record.coins, migrated.payments.held, next.events]).toEqual([[], 0, [], ['duplicate']]);
});

// ---------------------------------------------------------------- crash points

test('3. crash before the durable apply (paid, the answer never handled): the next launch applies it once', async () => {
  for (const policy of ['after-consume', 'before-consume'] as RestoreGrantPolicy[]) {
    const device = new Device();
    device.payments.restoreGrant = policy;
    device.payments.mode = 'manual';
    void device.process.runtime.purchase('gold_1', 'shop');
    device.payments.settlePurchase('ok');
    device.crash();
    const next = device.restart();
    await next.runtime.restore();
    await next.runtime.restore();
    expect([device.disk.record.coins, device.payments.held.length], policy).toEqual([1000, 0]);
  }
});

test('4. CASE 1 (ledger): crash DURING the write — no token/effect split exists; nothing consumed; the restart applies once', async () => {
  const device = new Device();
  device.writeMode = 'queued';
  void device.process.runtime.purchase('gold_1', 'shop');
  await flush();
  expect([device.payments.consumeCalls.length, device.disk.record.applied]).toEqual([0, []]); // not consumed before durable
  device.crash(); // the write never lands
  device.writeMode = 'ok';
  const next = device.restart();
  await next.runtime.restore();
  expect(device.disk.record).toEqual({ coins: 1000, noAds: false, applied: ['tok-1'] });
  expect(device.payments.held).toEqual([]);
});

test('5. ambiguous ACK (written, answered false): not_durable, nothing consumed, no grant; a retry — same session or after a restart — never applies twice', async () => {
  // same session: the retry writes the SAME record (the token was pending, the effect is not re-applied)
  const device = new Device();
  device.writeMode = 'ambiguous';
  const result = await device.process.runtime.purchase('gold_1', 'shop');
  expect(result).toMatchObject({ status: 'error', reason: 'not_durable', token: 'tok-1', restoreAdvised: true });
  expect([device.process.events, device.payments.consumeCalls.length]).toEqual([['started', 'error:not_durable'], 0]);
  expect(device.disk.record.coins).toBe(1000); // it did land
  device.writeMode = 'ok';
  expect((await device.process.runtime.restore()).granted).toEqual([{ productId: 'gold_1', token: 'tok-1' }]);
  expect([device.disk.record, device.payments.held]).toEqual([{ coins: 1000, noAds: false, applied: ['tok-1'] }, []]);
  expect(device.process.events.filter((it) => it === 'granted')).toHaveLength(1);

  // after a restart: the loaded record has the token → already applied → only consumed
  const landed = new Device();
  landed.writeMode = 'ambiguous';
  await landed.process.runtime.purchase('gold_1', 'shop');
  landed.writeMode = 'ok';
  const next = landed.restart();
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect([landed.disk.record.coins, landed.payments.held, next.events]).toEqual([1000, [], ['duplicate']]);

  // not written at all + restart → applied once
  const lost = new Device();
  lost.writeMode = 'fail';
  await lost.process.runtime.purchase('gold_1', 'shop');
  lost.writeMode = 'ok';
  await lost.restart().runtime.restore();
  expect([lost.disk.record.coins, lost.payments.held]).toEqual([1000, []]);

  // an ordinary later save of the record confirms the pending effect → the restore only consumes
  const saved = new Device();
  saved.writeMode = 'fail';
  await saved.process.runtime.purchase('gold_1', 'shop');
  saved.writeMode = 'ok';
  await saved.process.save(); // e.g. the game saving after a level
  expect((await saved.process.runtime.restore()).granted).toEqual([]);
  expect([saved.disk.record.coins, saved.payments.held]).toEqual([1000, []]);
});

test('6. CASE 2 (ledger): crash after the durable apply, before the consume → the restart answers already_applied, consumes, applies nothing', async () => {
  const device = new Device();
  const release = consumeNeverLands(device.payments);
  expect((await device.process.runtime.purchase('gold_1', 'shop')).status).toBe('ok');
  device.crash();
  release();
  const next = device.restart();
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect([device.disk.record.coins, device.payments.held, next.events]).toEqual([1000, [], ['duplicate']]);
});

test('7. a consume failure after the durable apply does not undo it; the next restore only consumes', async () => {
  const device = new Device();
  device.payments.consumeFailures = 1;
  await device.process.runtime.purchase('gold_1', 'shop');
  await flush();
  expect(device.process.events).toEqual(['started', 'granted', 'consume_failed']);
  expect(await device.process.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect([device.disk.record.coins, device.payments.held]).toEqual([1000, []]);
});

test('8. CASE 3 (ledger): the consume reached the platform, its answer was lost (timeout / process death) — the effect was durable before it', async () => {
  for (const how of ['rejects', 'hangs'] as const) {
    const device = new Device(); // after-consume adapter: ledger mode applies first anyway
    device.payments.restoreGrant = 'after-consume';
    device.payments.hold('gold_1', 'r-1');
    consumeLandsAckLost(device.payments, how);
    void device.process.runtime.restore();
    await flush();
    expect(device.disk.record, how).toEqual({ coins: 1000, noAds: false, applied: ['r-1'] });
    const next = device.restart();
    expect(await next.runtime.restore(), how).toEqual({ status: 'ok', found: 0, granted: [] });
    expect(device.disk.record.coins, how).toBe(1000);
  }
  // the direct path the same way
  const direct = new Device();
  consumeLandsAckLost(direct.payments, 'rejects');
  expect((await direct.process.runtime.purchase('gold_1')).status).toBe('ok');
  expect(direct.disk.record.coins).toBe(1000);
});

// ---------------------------------------------------------------- several receipts, concurrency

test('10 + 11. independent receipts are applied independently; a hung consume holds no other delivery; the restart finishes it without a 2nd effect', async () => {
  const device = new Device();
  device.payments.hold('gold_1', 'a');
  device.payments.hold('gold_2', 'b');
  device.payments.hold('starter_pack', 'c');
  const consume = device.payments.consume.bind(device.payments);
  device.payments.consume = (purchase) => (purchase.token === 'a' ? new Promise<void>(() => undefined) : consume(purchase));
  let answered = false;
  void device.process.runtime.restore().then(() => (answered = true));
  await flush();
  expect(device.disk.record.coins).toBe(1000 + 3500 + 500); // all three durable, "a" included
  expect([device.payments.held.map((it) => it.token), answered]).toEqual([['a'], false]);
  device.payments.consume = consume;
  const next = device.restart();
  expect(await next.runtime.restore()).toEqual({ status: 'ok', found: 1, granted: [] });
  expect([device.disk.record.coins, device.payments.held]).toEqual([5000, []]);
});

test('12. concurrent attempts on one token share ONE apply: a restore racing the direct answer, a list naming it twice', async () => {
  const device = new Device();
  device.writeMode = 'queued';
  const direct = device.process.runtime.purchase('gold_1', 'shop');
  await flush();
  const pass = device.process.runtime.restore(); // lists tok-1 while its apply is in flight
  await flush();
  device.process.land();
  expect((await direct).status).toBe('ok');
  expect((await pass).granted).toEqual([]);
  expect(device.process.applies).toEqual(['tok-1']); // one apply
  expect(device.process.events.filter((it) => it === 'granted' || it === 'duplicate')).toEqual(['granted', 'duplicate']);
  expect(device.disk.record.coins).toBe(1000);

  const twice = new Device();
  twice.writeMode = 'queued';
  twice.payments.hold('gold_1', 'a');
  twice.payments.hold('gold_1', 'a');
  const listed = twice.process.runtime.restore();
  await flush();
  twice.process.land();
  expect((await listed).granted).toEqual([{ productId: 'gold_1', token: 'a' }]);
  expect([twice.process.applies, twice.disk.record.coins]).toEqual([['a'], 1000]);
});

// ---------------------------------------------------------------- entitlement, guest, fail-closed edges

test('13. no_ads (entitlement) stays on the restore-owned path: never through the ledger, never consumed; a crash before its save is healed by `owned`; repeated restores have no side effects', async () => {
  const device = new Device();
  device.writeMode = 'queued'; // the flag's save never lands
  expect((await device.process.runtime.purchase('no_ads', 'settings')).status).toBe('ok');
  expect([device.process.applies, device.payments.consumeCalls.length, device.disk.registry]).toEqual([[], 0, ['tok-1']]);
  device.crash();
  device.writeMode = 'ok';
  const next = device.restart();
  expect(next.state.noAds).toBe(false);
  for (let pass = 0; pass < 3; pass++) {
    const { owned = [] } = await next.runtime.restore();
    if (owned.some((it) => it.productId === 'no_ads')) next.state = { ...next.state, noAds: true }; // host: re-assert
  }
  expect([next.state.noAds, next.events, next.applies, device.payments.consumeCalls.length, device.payments.held.length]).toEqual([true, [], [], 0, 1]);
});

test('15. a guest without a durable ledger fails closed — nothing consumed, no grant, the receipt kept; once durable storage exists the same receipt is applied once', async () => {
  const device = new Device();
  device.writeMode = 'fail'; // no durable storage at all (a Yandex guest: storage.set answers false)
  expect(await device.process.runtime.purchase('gold_1', 'shop')).toMatchObject({ status: 'error', reason: 'not_durable', restoreAdvised: true });
  await device.process.runtime.restore();
  expect([device.payments.consumeCalls.length, device.payments.held.length, device.disk.record.coins]).toEqual([0, 1, 0]);
  expect(device.process.events).toEqual(['started', 'error:not_durable', 'error:not_durable']);

  device.writeMode = 'ok'; // a local durable record / the player logged in
  const next = device.restart();
  expect((await next.runtime.restore()).granted).toEqual([{ productId: 'gold_1', token: 'tok-1' }]);
  expect([device.disk.record.coins, device.payments.held]).toEqual([1000, []]);
});

test('fail closed: a throwing / garbage ledger answer, a missing reward mapping, a tokenless consumable — none is consumed or granted', async () => {
  const payments = new FakePayments();
  const events: string[] = [];
  const answers: Array<() => unknown> = [() => Promise.reject(new Error('disk full')), () => 'maybe'];
  const runtime = new PurchaseRuntime<Rewards>({
    payments,
    granted: createGrantedPurchaseStore(),
    resolveGrant,
    grant: () => undefined,
    ledger: { apply: () => answers.shift()!() as never },
    onEvent: (event) => events.push(event.type === 'error' ? `error:${event.reason}` : event.type)
  });
  expect(await runtime.purchase('gold_1')).toMatchObject({ status: 'error', reason: 'not_durable', restoreAdvised: true });
  expect(await runtime.purchase('gold_2')).toMatchObject({ status: 'error', reason: 'not_durable' });
  payments.answerProductId = 'unmapped_pack';
  expect(await runtime.purchase('gold_1')).toMatchObject({ status: 'error', reason: 'no_grant', restoreAdvised: false });
  payments.answerProductId = undefined;
  payments.tokenless = true;
  expect(await runtime.purchase('gold_1')).toMatchObject({ status: 'error', reason: 'no_token', restoreAdvised: false });
  expect([payments.consumeCalls.length, payments.held.length, runtime.getStats().granted]).toEqual([0, 4, 0]);
  expect(events.filter((it) => it.startsWith('error'))).toEqual(['error:not_durable', 'error:not_durable', 'error:no_grant', 'error:no_token']);
  expect(() => new PurchaseRuntime({ payments, granted: createGrantedPurchaseStore(), resolveGrant, grant: () => undefined, ledger: {} as never })).toThrow(RangeError);
});
