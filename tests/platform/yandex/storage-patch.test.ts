// Yandex Platform Storage safe PATCH semantics V1: `storage.set(patch)` is a PATCH whatever the SDK does
// underneath. Production `player.setData` REPLACES the player's whole object (the SDK docs: `getData`
// answers the data set by the LAST `setData` call), so a bare patch would drop every other key — the
// SaveGate Core record `<id>.core` next to the game's own save key. Every case runs over both a
// replacing (production) and a per-key merging fake SDK.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SaveGate } from '../../../src/index';
import { YANDEX_NO_PLAYER, YANDEX_TIMEOUTS } from '../../../src/platform/adapters/yandex';
import type { FakeYandex } from './fixtures';
import { flush, makeYandex } from './fixtures';

beforeEach(() => void vi.useFakeTimers({ now: Date.UTC(2026, 8, 23, 10) }));
afterEach(() => void vi.useRealTimers());

const SAVE = { level: 7, stars: [3, 2, 3] };

/** A promise's outcome without awaiting it — for promises that only settle when timers move. */
function track<T>(promise: Promise<T>): { state: 'pending' | 'ok' | 'rejected'; value?: T; error?: unknown } {
  const tracked: { state: 'pending' | 'ok' | 'rejected'; value?: T; error?: unknown } = { state: 'pending' };
  promise.then(
    (value) => Object.assign(tracked, { state: 'ok', value }),
    (error) => Object.assign(tracked, { state: 'rejected', error })
  );
  return tracked;
}

const reads = (fake: FakeYandex): string[] => fake.calls.filter((call) => call.startsWith('getData'));

describe.each(['replace', 'merge'] as const)('storage.set is a PATCH over a %s setData', (semantics) => {
  const make = (cloud: Record<string, unknown>, setup: (fake: FakeYandex) => void = () => {}) =>
    makeYandex((fake) => {
      fake.setDataSemantics = semantics;
      fake.cloud = cloud;
      setup(fake);
    });

  test('1. an existing unrelated remote key survives a patch write (the reproduce case)', async () => {
    const h = make({ 'game.save': SAVE, 'game.core': { wallet: 10 } });
    expect(await h.platform.storage.set({ 'game.core': { wallet: 20 } })).toBe(true);
    expect(h.fake.cloud).toEqual({ 'game.save': SAVE, 'game.core': { wallet: 20 } });
  });

  test('2 + 3. sequential patches keep both keys, a patch overwrites only its own key, unknown keys survive; ONE full read per session', async () => {
    const h = make({ foreign: { v: 1 } });
    const { storage } = h.platform;
    expect(await storage.set({ a: 1 })).toBe(true);
    const second = track(storage.set({ b: 2 }));
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    expect(second.value).toBe(true);
    expect(h.fake.cloud).toEqual({ foreign: { v: 1 }, a: 1, b: 2 });

    const third = track(storage.set({ a: 3 }));
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    expect(third.value).toBe(true);
    expect(h.fake.cloud).toEqual({ foreign: { v: 1 }, a: 3, b: 2 });
    // the authoritative full object is read once, before the first write — never a getData per write
    expect(reads(h.fake)).toEqual(['getData:']);
    expect(h.fake.calls.indexOf('getData:')).toBeLessThan(h.fake.calls.findIndex((call) => call.startsWith('setData')));
  });

  test('4. SaveGate: the game key and the Core record <id>.core coexist in the cloud, written in any order', async () => {
    const h = make({ solipics_state: SAVE, unrelated: 'keep' });
    const gate = new SaveGate({ storage: h.platform.storage, profile: { id: 'solipix', save: { keys: ['solipics_state'] } } });
    const load = await gate.load();
    expect(load.values).toEqual({ solipics_state: SAVE });
    gate.open();

    expect(await gate.writeCore('wallet', { coins: 20 })).toEqual({ ok: true, reason: null });
    expect(h.fake.cloud).toEqual({ solipics_state: SAVE, 'solipix.core': { wallet: { coins: 20 } }, unrelated: 'keep' });

    const game = track(gate.write({ solipics_state: { ...SAVE, level: 8 } }));
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    expect(game.value).toEqual({ ok: true, reason: null });
    expect(h.fake.cloud).toEqual({ solipics_state: { ...SAVE, level: 8 }, 'solipix.core': { wallet: { coins: 20 } }, unrelated: 'keep' });
    // what a new session's gate loads back
    const next = new SaveGate({ storage: h.platform.storage, profile: { id: 'solipix', save: { keys: ['solipics_state'] } } });
    const reloaded = await next.load();
    expect([reloaded.values, next.readCore('wallet')]).toEqual([{ solipics_state: { ...SAVE, level: 8 } }, { coins: 20 }]);
  });

  test('5 + 6 + 7. overlapping writes lose nothing; a failed setData answers false and never becomes the confirmed state; the next write is deterministic', async () => {
    const h = make({ keep: 'k' }, (fake) => (fake.setDataMode = 'hold'));
    const { storage } = h.platform;
    await h.platform.identity.ready();
    await flush();

    const first = track(storage.set({ a: 1 }));
    await flush(50);
    expect(h.fake.heldWrites).toHaveLength(1); // one setData in flight
    // collapsed into the chain in flight: answered at once, like the donor
    expect(await storage.set({ b: 2 })).toBe(true);
    expect(await storage.set({ a: 5 })).toBe(true);
    h.fake.heldWrites[0]!.succeed();
    await flush(20);
    expect(h.fake.cloud).toEqual({ keep: 'k', a: 1 });

    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    expect(h.fake.heldWrites).toHaveLength(2); // the second turn: confirmed object + every collapsed patch
    expect(h.fake.writes[1]!.data).toEqual({ keep: 'k', a: 5, b: 2 });
    expect(await storage.set({ c: 3 })).toBe(true); // lands while the 2nd turn is in flight
    h.fake.heldWrites[1]!.fail();
    await flush(20);
    expect([first.state, first.value, h.diagnostics]).toEqual(['ok', false, ['cloud_save_failed']]);
    expect(h.fake.cloud).toEqual({ keep: 'k', a: 1 }); // the failed turn changed nothing

    const retry = track(storage.set({ d: 4 }));
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    // built on the CONFIRMED object, with the unwritten patches carried — nothing lost, one call
    expect(h.fake.writes.at(-1)!.data).toEqual({ keep: 'k', a: 5, b: 2, c: 3, d: 4 });
    h.fake.heldWrites[2]!.succeed();
    await flush(20);
    expect(retry.value).toBe(true);
    expect(h.fake.cloud).toEqual({ keep: 'k', a: 5, b: 2, c: 3, d: 4 });
    expect(reads(h.fake)).toEqual(['getData:']);
  });

  test('6. the error semantics stay: set answers false (never throws); clear REJECTS with the SDK error; a failed first full read writes nothing', async () => {
    const h = make({ keep: 'k' }, (fake) => (fake.setDataMode = 'fail'));
    const { storage } = h.platform;
    expect(await storage.set({ a: 1 })).toBe(false);
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    await expect(storage.clear(['keep'])).rejects.toThrow('rate_limit');
    expect(h.fake.cloud).toEqual({ keep: 'k' });

    // without the authoritative full object there is no safe write: 3 read attempts, then false — no setData
    const unread = make({ keep: 'k' }, (fake) => (fake.getDataFailures = 3));
    const write = track(unread.platform.storage.set({ a: 1 }));
    await vi.advanceTimersByTimeAsync(1000 + 3000);
    expect([write.value, reads(unread.fake).length, unread.fake.writes.length, unread.diagnostics]).toEqual([false, 3, 0, ['cloud_save_failed']]);
    // the patch is carried: the next write reads once more and writes everything
    const next = track(unread.platform.storage.set({ b: 2 }));
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    expect(next.value).toBe(true);
    expect(unread.fake.cloud).toEqual({ keep: 'k', a: 1, b: 2 });
  });

  test('clear is a patch too: only its keys are cleared, it waits for the write in flight and carries the rest', async () => {
    const h = make({ keep: 'k', profile: { level: 3 } }, (fake) => (fake.setDataMode = 'hold'));
    const { storage } = h.platform;
    await h.platform.identity.ready();
    await flush();
    const write = track(storage.set({ a: 1 }));
    await flush(50);
    expect(h.fake.heldWrites).toHaveLength(1);
    const cleared = track(storage.clear(['profile']));
    await flush(50);
    expect(cleared.state).toBe('pending'); // rides the chain in flight, never a parallel setData
    h.fake.heldWrites[0]!.succeed();
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
    h.fake.heldWrites[1]!.succeed();
    await flush(20);
    expect([write.value, cleared.state]).toEqual([true, 'ok']);
    expect(h.fake.writes.at(-1)!.data).toEqual({ keep: 'k', profile: null, a: 1 });
    expect(await storage.get(['keep', 'a'])).toEqual({ keep: 'k', a: 1 });
  });

  test('8. get(keys) still answers only the requested keys with a key-by-key getData, whatever else the cloud holds', async () => {
    const h = make({ 'game.save': SAVE, 'game.core': { wallet: 10 }, other: 1 });
    expect(await h.platform.storage.set({ extra: true })).toBe(true);
    expect(await h.platform.storage.get(['game.core', 'missing'])).toEqual({ 'game.core': { wallet: 10 } });
    expect(reads(h.fake)).toEqual(['getData:', 'getData:game.core,missing']);
  });

  test('9. a guest still has no cloud: set answers false and get / clear reject — no SDK storage call; the recovered player gets the full read first', async () => {
    const h = make({ keep: 'k' }, (fake) => (fake.playerMode = 'fail'));
    await h.platform.identity.ready();
    await flush();
    expect(await h.platform.storage.set({ a: 1 })).toBe(false);
    await expect(h.platform.storage.get(['keep'])).rejects.toThrow(YANDEX_NO_PLAYER);
    await expect(h.platform.storage.clear(['keep'])).rejects.toThrow(YANDEX_NO_PLAYER);
    expect([reads(h.fake), h.fake.writes]).toEqual([[], []]);

    h.fake.playerMode = 'ok';
    await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery);
    expect(await h.platform.storage.set({ a: 1 })).toBe(true);
    expect(h.fake.cloud).toEqual({ keep: 'k', a: 1 });
  });
});
