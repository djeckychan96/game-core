// Yandex storage honest ACK: `storage.set(patch)` answers `true` only once a `player.setData` that CARRIED
// this call's patch succeeded; `false` = this call got no such confirmation. A call that finds a write in
// flight joins the chain and waits for the turn that writes its patch — it is never answered "queued" as
// `true` (that made SaveGate `{ ok: true }` a lie about persistence). Same for `clear`: it resolves after
// the turn that writes its `{ key: null }` patch and rejects when that turn fails.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SaveGate } from '../../../src/index';
import { YANDEX_TIMEOUTS } from '../../../src/platform/adapters/yandex';
import { flush, makeYandex } from './fixtures';

beforeEach(() => void vi.useFakeTimers({ now: Date.UTC(2026, 8, 24, 10) }));
afterEach(() => void vi.useRealTimers());

type Tracked<T> = { state: 'pending' | 'ok' | 'rejected'; value?: T; error?: unknown };
function track<T>(promise: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = { state: 'pending' };
  promise.then(
    (value) => Object.assign(tracked, { state: 'ok', value }),
    (error) => Object.assign(tracked, { state: 'rejected', error })
  );
  return tracked;
}

/** A player with a cloud; every setData stays in flight until the test settles it (`turn(i)`). */
async function held(cloud: Record<string, unknown> = { keep: 'k' }) {
  const h = makeYandex((fake) => {
    fake.cloud = cloud;
    fake.setDataMode = 'hold';
  });
  await h.platform.identity.ready();
  await flush();
  const turn = (index: number) => h.fake.heldWrites[index]!;
  /** Lets the chain reach its next setData: the ≥ 3 s rate window, then the call. */
  const nextTurn = async () => {
    await flush(20);
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    await flush(20);
  };
  return { ...h, storage: h.platform.storage, turn, nextTurn };
}

test('CASE A — a call that joins a write in flight is NOT answered at once; its own turn fails → false', async () => {
  const h = await held();
  const a = track(h.storage.set({ a: 1 }));
  await flush(50);
  expect(h.fake.heldWrites).toHaveLength(1); // write A in flight, B is not in it

  const b = track(h.storage.set({ b: 2 }));
  await flush(20);
  expect(b.state).toBe('pending'); // was: true at once

  h.turn(0).succeed();
  await h.nextTurn();
  expect([a.value, b.state]).toEqual([true, 'pending']); // A confirmed, B waits for ITS write
  expect(h.fake.writes[1]!.data).toEqual({ keep: 'k', a: 1, b: 2 });
  h.turn(1).fail();
  await flush(20);
  expect(b.value).toBe(false);
  expect(h.fake.cloud).toEqual({ keep: 'k', a: 1 });
});

test('CASE B — joined, then the write that carries it succeeds → true, and only then', async () => {
  const h = await held();
  track(h.storage.set({ a: 1 }));
  await flush(50);
  const b = track(h.storage.set({ b: 2 }));
  h.turn(0).succeed();
  await h.nextTurn();
  expect(b.state).toBe('pending');
  h.turn(1).succeed();
  await flush(20);
  expect(b.value).toBe(true);
  expect(h.fake.cloud).toEqual({ keep: 'k', a: 1, b: 2 });
});

test('CASE C — several callers collapse into one write: each waits for it and gets ITS result, not earlier', async () => {
  const h = await held();
  const a = track(h.storage.set({ a: 1 }));
  await flush(50);
  const joined = [track(h.storage.set({ b: 2 })), track(h.storage.set({ c: 3 })), track(h.storage.set({ d: 4 }))];
  h.turn(0).succeed();
  await h.nextTurn();
  expect(a.value).toBe(true);
  expect(h.fake.heldWrites).toHaveLength(2); // ONE write for the three
  expect(h.fake.writes[1]!.data).toEqual({ keep: 'k', a: 1, b: 2, c: 3, d: 4 });
  expect(joined.map((it) => it.state)).toEqual(['pending', 'pending', 'pending']);
  h.turn(1).succeed();
  await flush(20);
  expect(joined.map((it) => it.value)).toEqual([true, true, true]);
});

test('CASE D — failure isolation: the failed write answers false to its callers, never retroactively true; a later call retries the carried state; the first caller keeps its own true', async () => {
  const h = await held();
  const a = track(h.storage.set({ a: 1 }));
  await flush(50);
  const b = track(h.storage.set({ b: 2 }));
  const c = track(h.storage.set({ c: 3 }));
  h.turn(0).succeed();
  await h.nextTurn();
  h.turn(1).fail(); // write #2 = { b, c }
  await flush(20);
  expect([a.value, b.value, c.value]).toEqual([true, false, false]); // A was written by its own turn (was: false)
  expect(h.diagnostics).toEqual(['cloud_save_failed']);
  expect(h.fake.cloud).toEqual({ keep: 'k', a: 1 }); // the failed write confirmed nothing

  const d = track(h.storage.set({ d: 4 }));
  await h.nextTurn();
  expect(h.fake.writes.at(-1)!.data).toEqual({ keep: 'k', a: 1, b: 2, c: 3, d: 4 }); // carried + new, one write
  h.turn(2).succeed();
  await flush(20);
  expect(d.value).toBe(true);
  expect([b.value, c.value]).toEqual([false, false]); // answered once, by their own write
  expect(h.fake.cloud).toEqual({ keep: 'k', a: 1, b: 2, c: 3, d: 4 });
});

test('a call that joins a chain which then stops on an EARLIER failure gets false — its patch stays queued for the next write', async () => {
  const h = await held();
  const a = track(h.storage.set({ a: 1 }));
  await flush(50);
  const b = track(h.storage.set({ b: 2 })); // not in write A
  h.turn(0).fail();
  await flush(20);
  expect([a.value, b.value]).toEqual([false, false]); // was: b true at once
  const c = track(h.storage.set({ c: 3 }));
  await h.nextTurn();
  expect(h.fake.writes.at(-1)!.data).toEqual({ keep: 'k', a: 1, b: 2, c: 3 });
  h.turn(1).succeed();
  await flush(20);
  expect(c.value).toBe(true);
});

test('CASE E — sequential: `await set(A) === true` means A is in the confirmed object the next write builds on', async () => {
  const h = makeYandex((fake) => (fake.cloud = { keep: 'k' }));
  expect(await h.platform.storage.set({ a: 1 })).toBe(true);
  expect(h.fake.cloud).toEqual({ keep: 'k', a: 1 });
  const b = track(h.platform.storage.set({ b: 2 })); // built on the confirmed object (no re-read), which holds A
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
  expect(b.value).toBe(true);
  expect(h.fake.writes.at(-1)!.data).toEqual({ keep: 'k', a: 1, b: 2 });
});

test('same-key overwrite: set({coins:10}) + set({coins:20}) collapsed → one write of 20; both true = "the confirmed state is not older than this call"', async () => {
  const h = await held();
  track(h.storage.set({ other: 1 }));
  await flush(50);
  const ten = track(h.storage.set({ coins: 10 }));
  const twenty = track(h.storage.set({ coins: 20 }));
  h.turn(0).succeed();
  await h.nextTurn();
  expect(h.fake.writes[1]!.data).toEqual({ keep: 'k', other: 1, coins: 20 }); // 10 was never sent literally
  expect([ten.state, twenty.state]).toEqual(['pending', 'pending']);
  h.turn(1).succeed();
  await flush(20);
  expect([ten.value, twenty.value]).toEqual([true, true]);

  // the other order: 10 is written by its own turn, 20 (queued after that turn took the patch) fails
  const h2 = await held();
  track(h2.storage.set({ other: 1 }));
  await flush(50);
  const ten2 = track(h2.storage.set({ coins: 10 }));
  h2.turn(0).succeed();
  await h2.nextTurn();
  const twenty2 = track(h2.storage.set({ coins: 20 })); // write #2 = { coins: 10 } is in flight
  h2.turn(1).succeed();
  await h2.nextTurn();
  h2.turn(2).fail();
  await flush(20);
  expect([ten2.value, twenty2.value]).toEqual([true, false]);
  expect(h2.fake.cloud).toEqual({ keep: 'k', other: 1, coins: 10 }); // never rolled forward by a lie, never rolled back
});

test('CASE F — clear: resolves only after the write carrying its { key: null }, rejects when THAT write fails, and a later failure does not fail it', async () => {
  const h = await held({ keep: 'k', profile: { level: 3 }, junk: 1 });
  const a = track(h.storage.set({ a: 1 }));
  await flush(50);
  const cleared = track(h.storage.clear(['profile']));
  h.turn(0).succeed();
  await h.nextTurn();
  expect([a.value, cleared.state]).toEqual([true, 'pending']);
  const late = track(h.storage.set({ b: 2 })); // joins while the clear's write is in flight
  h.turn(1).succeed();
  await flush(20);
  expect(cleared.state).toBe('ok');
  await h.nextTurn();
  h.turn(2).fail(); // a LATER write fails — the clear was already confirmed by its own (was: the clear rejected)
  await flush(20);
  expect([cleared.state, late.value]).toEqual(['ok', false]);
  expect(h.fake.cloud).toEqual({ keep: 'k', profile: null, junk: 1, a: 1 });

  const failed = track(h.storage.clear(['junk']));
  await h.nextTurn();
  h.turn(3).fail();
  await flush(20);
  expect([failed.state, String(failed.error)]).toEqual(['rejected', 'Error: rate_limit']);
});

test('SaveGate: { ok: true } only once the storage confirmed the write; a joined write that fails is { ok: false }; game key + <id>.core coexist', async () => {
  const h = await held({ solipics_state: { level: 7 }, unrelated: 'keep' });
  const gate = new SaveGate({ storage: h.storage, profile: { id: 'solipix', save: { keys: ['solipics_state'] } } });
  await gate.load();
  gate.open();
  const game = track(gate.write({ solipics_state: { level: 8 } }));
  await flush(50);
  const core = track(gate.writeCore('wallet', { coins: 20 })); // joins the game write in flight
  await flush(20);
  expect(core.state).toBe('pending'); // was: { ok: true } at once
  h.turn(0).succeed();
  await h.nextTurn();
  expect([game.value, core.state]).toEqual([{ ok: true, reason: null }, 'pending']);
  h.turn(1).fail();
  await flush(20);
  expect(core.value).toEqual({ ok: false, reason: 'storage_refused' });

  const retry = track(gate.writeCore('wallet', { coins: 25 }));
  await h.nextTurn();
  h.turn(2).succeed();
  await flush(20);
  expect(retry.value).toEqual({ ok: true, reason: null });
  expect(h.fake.cloud).toEqual({ solipics_state: { level: 8 }, unrelated: 'keep', 'solipix.core': { wallet: { coins: 25 } } });
});
