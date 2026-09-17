import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlatformRuntime } from '../../../src/platform';
import { YANDEX_NO_PLAYER, YANDEX_TIMEOUTS } from '../../../src/platform/adapters/yandex';
import { flush, makeYandex } from './fixtures';

beforeEach(() => void vi.useFakeTimers({ now: Date.UTC(2026, 8, 17, 10) }));
afterEach(() => void vi.useRealTimers());

/** A promise's outcome without awaiting it — for promises that only settle when timers move. */
function track<T>(promise: Promise<T>): { state: 'pending' | 'ok' | 'rejected'; value?: T; error?: unknown } {
  const tracked: { state: 'pending' | 'ok' | 'rejected'; value?: T; error?: unknown } = { state: 'pending' };
  promise.then(
    (value) => Object.assign(tracked, { state: 'ok', value }),
    (error) => Object.assign(tracked, { state: 'rejected', error })
  );
  return tracked;
}

// ---------------------------------------------------------------- boot + environment + identity

test('SDK init: ready resolves, payments are asked unsigned, the environment is read live and normalized; capabilities = production Yandex', async () => {
  const h = makeYandex((fake) => {
    fake.lang = 'tr';
    fake.deviceType = 'tablet';
    fake.payload = 'x'.repeat(500);
  });
  const env = h.platform.environment;
  expect([env.platformCode(), env.language(), env.deviceType(), env.launchPayload(), env.serverTime(), env.platformOs()]).toEqual(['YA', '', null, '', null, null]);

  const platform = new PlatformRuntime(h.platform);
  await platform.ready();
  expect(h.fake.calls).toEqual(['init', 'getPlayer', 'getPayments:signed=false']);
  expect(platform.capabilities()).toEqual({ ads: true, banner: false, payments: true, lifecycle: false, cloudStorage: true });
  expect([env.platformCode(), env.language(), env.deviceType(), env.platformOs()]).toEqual(['YA', 'tr', 'tablet', null]);
  expect(env.launchPayload()).toHaveLength(200);
  expect(env.serverTime()).toBe(1_758_103_200); // ms → unix seconds
  h.fake.sdk.deviceInfo = { type: 'tv' };
  h.fake.sdk.environment = {};
  delete h.fake.sdk.serverTime;
  expect([env.deviceType(), env.language(), env.launchPayload(), env.serverTime()]).toEqual([null, '', '', null]);

  await platform.ready();
  expect(h.fake.count('init')).toBe(1);
});

test('SDK init failure: one retry; a total failure rejects, is remembered for 30 s ("SDK is dead"), then one honest attempt again', async () => {
  const retried = makeYandex((fake) => (fake.initFailures = 1));
  await retried.platform.identity.ready();
  expect([retried.fake.count('init'), retried.diagnostics]).toEqual([2, ['sdk_init_retry']]);

  const dead = makeYandex((fake) => (fake.initMode = 'fail'));
  await expect(dead.platform.identity.ready()).rejects.toThrow('init_down');
  expect(dead.fake.count('init')).toBe(2);
  await expect(dead.platform.storage.get(['profile'])).rejects.toThrow('sdk_dead_cooldown');
  expect(await dead.platform.ads.showInterstitial('level_win_inter')).toMatchObject({ status: 'error', rewarded: false });
  expect(await dead.platform.payments.purchase('gold_1')).toMatchObject({ status: 'error', productId: 'gold_1' });
  expect(await dead.platform.storage.set({ profile: {} })).toBe(false);
  expect(dead.fake.count('init')).toBe(2); // no SDK call during the cooldown
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.sdkDeadCooldown);
  dead.fake.initMode = 'ok';
  await dead.platform.identity.ready();
  expect(dead.fake.count('init')).toBe(3);

  // a HUNG init (the webview holds the request, never rejects) is cut at 20 s, twice
  const hung = makeYandex((fake) => (fake.initMode = 'hang'));
  const ready = track(hung.platform.identity.ready());
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.init * 2 - 1);
  expect(ready.state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect([ready.state, String(ready.error)]).toEqual(['rejected', 'Error: sdk_timeout:init']);
});

test('player: id and name as the SDK gives them (no game-side trimming); an empty id is a guest; the host hears about the player once', async () => {
  const h = makeYandex();
  expect(h.platform.identity.playerId()).toBeNull();
  await h.platform.identity.ready();
  await flush();
  expect(h.platform.identity.playerId()).toBe('ya-player-1');
  expect(h.platform.identity.displayName()).toBe('Константин Константинопольский');
  expect(h.players).toEqual(['ya-player-1']);
  h.fake.playerId = '';
  expect(h.platform.identity.playerId()).toBeNull();
});

test('guest mode: a failed or hung getPlayer never blocks the entry; the player is retried 5 × 15 s in the background and picked up', async () => {
  const h = makeYandex((fake) => (fake.playerMode = 'fail'));
  await new PlatformRuntime(h.platform).ready(); // the game goes on as a guest
  await flush();
  expect([h.platform.identity.playerId(), h.platform.identity.displayName(), h.diagnostics]).toEqual([null, '', ['guest_mode']]);
  // a guest has no cloud: a read REJECTS (never an empty profile), a write answers false
  await expect(h.platform.storage.get(['profile'])).rejects.toThrow(YANDEX_NO_PLAYER);
  await expect(h.platform.storage.clear(['profile'])).rejects.toThrow(YANDEX_NO_PLAYER);
  expect(await h.platform.storage.set({ profile: { level: 2 } })).toBe(false);

  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery * 2);
  expect(h.fake.count('getPlayer')).toBe(3);
  h.fake.playerMode = 'ok';
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery);
  expect([h.platform.identity.playerId(), h.players, h.diagnostics]).toEqual(['ya-player-1', ['ya-player-1'], ['guest_mode', 'guest_recovered']]);
  h.fake.cloud = { profile: { level: 40 } };
  expect(await h.platform.storage.get(['profile'])).toEqual({ profile: { level: 40 } });
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery * 3);
  expect(h.fake.count('getPlayer')).toBe(4); // no retry once the player is there

  const never = makeYandex((fake) => (fake.playerMode = 'fail'));
  await never.platform.identity.ready();
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery * 10);
  expect(never.fake.count('getPlayer')).toBe(6); // 1 + 5 attempts, then it stays a guest

  const disposed = makeYandex((fake) => (fake.playerMode = 'fail'));
  await disposed.platform.identity.ready();
  await flush();
  disposed.platform.dispose();
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerRetryEvery * 3);
  expect([disposed.fake.count('getPlayer'), vi.getTimerCount()]).toEqual([1, 0]);
});

// ---------------------------------------------------------------- storage

test('cloud read: getData by keys, a key never written is absent; a player still on its way is waited for 3 s at most', async () => {
  const h = makeYandex((fake) => (fake.cloud = { profile: { level: 12 }, an: { uuid: 'u' }, other: 1 }));
  expect(h.platform.storage.isCloud()).toBe(true);
  expect(await h.platform.storage.get(['profile', 'an', 'missing'])).toEqual({ profile: { level: 12 }, an: { uuid: 'u' } });
  expect(h.fake.calls).toContain('getData:profile,an,missing');

  const slow = makeYandex((fake) => (fake.playerMode = 'hang'));
  const read = track(slow.platform.storage.get(['profile']));
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.playerWaitOnRead - 1);
  expect(read.state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect([read.state, String(read.error)]).toEqual(['rejected', `Error: ${YANDEX_NO_PLAYER}`]);
});

test('cloud read failure REJECTS: 3 attempts (8 s timeout each, pauses 1 s / 3 s), then the error — through PlatformRuntime too, never an empty profile', async () => {
  const flaky = makeYandex((fake) => {
    fake.cloud = { profile: { level: 9 } };
    fake.getDataFailures = 2;
  });
  const recovered = track(flaky.platform.storage.get(['profile']));
  await vi.advanceTimersByTimeAsync(1000 + 3000);
  expect([recovered.state, recovered.value, flaky.fake.count('getData')]).toEqual(['ok', { profile: { level: 9 } }, 3]);

  const down = makeYandex((fake) => (fake.getDataFailures = 3));
  const failed = track(new PlatformRuntime(down.platform).storage.get(['profile']));
  await vi.advanceTimersByTimeAsync(1000 + 3000);
  expect([failed.state, String(failed.error), down.fake.count('getData')]).toEqual(['rejected', 'Error: network', 3]);

  const hung = makeYandex((fake) => (fake.getDataMode = 'hang'));
  const timedOut = track(hung.platform.storage.get(['profile']));
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.getData * 3 + 1000 + 3000 - 1);
  expect(timedOut.state).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect([timedOut.state, String(timedOut.error)]).toEqual(['rejected', 'Error: sdk_timeout:getData']);

  const garbage = makeYandex((fake) => (fake.getDataAnswer = null));
  await expect(garbage.platform.storage.get(['profile'])).rejects.toThrow(/non-object/);
});

test('cloud write: setData(patch, flush=true); one write in flight, later ones collapse into a final write ≥ 3 s apart', async () => {
  const h = makeYandex();
  const { storage } = h.platform;
  expect(await storage.set({ profile: { level: 1 }, an: { uuid: 'u' }, skipped: undefined })).toBe(true);
  expect(h.fake.writes).toEqual([{ data: { profile: { level: 1 }, an: { uuid: 'u' } }, flush: true }]);

  // a save after every move: the 2nd waits for the rate window, the 3rd and 4th ride along with it
  const second = track(storage.set({ profile: { level: 2 } }));
  await flush();
  expect(await storage.set({ profile: { level: 3 } })).toBe(true); // answered at once, like the donor
  expect(await storage.set({ an: { uuid: 'u', n: 2 } })).toBe(true);
  expect(h.fake.writes).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
  expect(second.state).toBe('ok');
  expect(h.fake.writes).toHaveLength(2);
  expect(h.fake.writes[1]!.data).toEqual({ profile: { level: 3 }, an: { uuid: 'u', n: 2 } }); // the freshest of each key, one call
  expect(h.fake.cloud).toEqual({ profile: { level: 3 }, an: { uuid: 'u', n: 2 } });
});

test('cloud write failure / timeout answers false, and the unwritten patch rides with the next write; clear = setData(null) outside the throttle', async () => {
  const h = makeYandex();
  const { storage } = h.platform;
  await h.platform.identity.ready();
  await flush();
  h.fake.setDataMode = 'fail';
  expect(await storage.set({ an: { uuid: 'u' } })).toBe(false);
  expect(h.diagnostics).toEqual(['cloud_save_failed']);
  h.fake.setDataMode = 'ok';
  const next = track(storage.set({ profile: { level: 5 } }));
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
  expect(next.value).toBe(true);
  expect(h.fake.cloud).toEqual({ an: { uuid: 'u' }, profile: { level: 5 } });

  h.fake.setDataMode = 'hang';
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
  const hung = track(storage.set({ profile: { level: 6 } }));
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.setData);
  expect(hung.value).toBe(false);

  h.fake.setDataMode = 'ok';
  await storage.clear(['profile']); // the donor's user.reset — and the carried `profile` patch must not come back
  expect(h.fake.writes.at(-1)).toEqual({ data: { profile: null }, flush: true });
  await vi.advanceTimersByTimeAsync(YANDEX_TIMEOUTS.saveMinInterval);
  expect(await storage.set({ an: { uuid: 'u2' } })).toBe(true);
  expect(h.fake.cloud).toEqual({ an: { uuid: 'u2' } });
});

// ---------------------------------------------------------------- gameplay

test('gameplay: ready = LoadingAPI.ready() once + the production GameplayAPI.start(); start / stop; loading progress is a no-op', async () => {
  const h = makeYandex();
  h.platform.gameplay.reportLoadingProgress(50);
  await h.platform.gameplay.ready();
  await h.platform.gameplay.ready();
  const sdkCalls = (): string[] => h.fake.calls.filter((call) => call.startsWith('LoadingAPI') || call.startsWith('GameplayAPI'));
  expect(sdkCalls()).toEqual(['LoadingAPI.ready', 'GameplayAPI.start']);
  h.platform.gameplay.stop();
  h.platform.gameplay.start();
  expect(sdkCalls()).toEqual(['LoadingAPI.ready', 'GameplayAPI.start', 'GameplayAPI.stop', 'GameplayAPI.start']);

  const manual = makeYandex(undefined, { startGameplayOnReady: false });
  await manual.platform.gameplay.ready();
  expect(manual.fake.calls.filter((call) => call.startsWith('GameplayAPI'))).toEqual([]);
  // a marker sent before the SDK is up is applied once it is
  const early = makeYandex();
  early.platform.gameplay.start();
  await flush(20);
  expect(early.fake.calls.filter((call) => call.startsWith('GameplayAPI'))).toEqual(['GameplayAPI.start']);
});
