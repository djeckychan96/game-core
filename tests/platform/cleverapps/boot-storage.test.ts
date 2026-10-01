import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlatformRuntime } from '../../../src/platform';
import {
  CLEVERAPPS_STORAGE_VERSION,
  CLEVERAPPS_TIMEOUTS,
  createCleverAppsPlatform
} from '../../../src/platform/adapters/cleverapps';
import { FakeConnector, flush, makeCleverApps } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('bootstrap accepts an already available injected Connector and shares one init across capabilities', async () => {
  const h = makeCleverApps();
  await Promise.all([h.platform.identity.ready(), h.platform.storage.ready(), h.platform.identity.ready()]);
  expect(h.fake.count('init')).toBe(1);
  expect(h.fake.count('storage.ready')).toBe(1);
  expect(h.fake.count('storage.load')).toBe(1);
});

test('default bootstrap waits for late onConnectorInit without loading the vendor script', async () => {
  const fake = new FakeConnector();
  const globals = globalThis as unknown as { connector?: unknown; onConnectorInit?: () => void };
  const platform = createCleverAppsPlatform();
  let ready = false;
  const pending = platform.identity.ready().then(() => (ready = true));
  await flush();
  expect(ready).toBe(false);
  globals.connector = fake.connector;
  globals.onConnectorInit?.();
  await pending;
  expect(platform.environment.platformCode()).toBe('FB');
  delete globals.connector;
  delete globals.onConnectorInit;
});

test('default bootstrap uses a Connector global that was ready before adapter creation', async () => {
  const fake = new FakeConnector();
  const globals = globalThis as unknown as { connector?: unknown; onConnectorInit?: () => void };
  globals.connector = fake.connector;
  const platform = createCleverAppsPlatform();
  await platform.identity.ready();
  expect([platform.identity.playerId(), platform.environment.platformCode()]).toEqual(['fb-player-1', 'FB']);
  expect(globals.onConnectorInit).toBeUndefined();
  delete globals.connector;
});

test('bootstrap rejects an SDK rejection and times out a Connector that never initializes', async () => {
  const rejected = makeCleverApps((fake) => (fake.initMode = 'fail'));
  await expect(rejected.platform.identity.ready()).rejects.toThrow('init_down');

  const hung = makeCleverApps((fake) => (fake.initMode = 'hang'));
  const pending = expect(hung.platform.identity.ready()).rejects.toThrow('sdk_timeout:cleverapps_init');
  await vi.advanceTimersByTimeAsync(CLEVERAPPS_TIMEOUTS.init);
  await pending;
});

test('identity never exposes the documented temporary guest id; authenticated Facebook id and player name are read live', async () => {
  const h = makeCleverApps((fake) => {
    fake.loggedIn = false;
    fake.userId = 'temporary-guest-123';
  });
  await h.platform.identity.ready();
  expect([h.platform.identity.playerId(), h.platform.identity.displayName()]).toEqual([null, 'Ada Player']);
  h.fake.loggedIn = true;
  h.fake.userId = 'facebook-42';
  expect(h.platform.identity.playerId()).toBe('facebook-42');

  const noAuthSignal = makeCleverApps();
  delete noAuthSignal.fake.connector.social;
  await noAuthSignal.platform.identity.ready();
  expect(noAuthSignal.platform.identity.playerId()).toBeNull();
});

test('environment reports raw Connector language, confirmed mobile, os and the explicit Facebook target only', async () => {
  const h = makeCleverApps((fake) => {
    fake.language = 'pt_BR';
    fake.isMobile = true;
    fake.os = 'Android';
  });
  await h.platform.identity.ready();
  expect([
    h.platform.environment.platformCode(),
    h.platform.environment.language(),
    h.platform.environment.deviceType(),
    h.platform.environment.platformOs(),
    h.platform.environment.launchPayload(),
    h.platform.environment.serverTime()
  ]).toEqual(['FB', 'pt_BR', 'mobile', 'Android', '', null]);
  h.fake.isMobile = false;
  h.fake.os = undefined;
  expect([h.platform.environment.deviceType(), h.platform.environment.platformOs()]).toEqual([null, null]);
});

test('gameplay reports loading only for a native loading screen and startGame succeeds exactly once', async () => {
  const h = makeCleverApps();
  await h.platform.identity.ready();
  h.platform.gameplay.reportLoadingProgress(42);
  h.fake.nativeLoading = false;
  h.platform.gameplay.reportLoadingProgress(84);
  await Promise.all([h.platform.gameplay.ready(), h.platform.gameplay.ready()]);
  await h.platform.gameplay.ready();
  h.platform.gameplay.start();
  h.platform.gameplay.stop();
  expect(h.fake.calls.filter((call) => call === 'loading:42' || call === 'platform.startGame')).toEqual([
    'loading:42',
    'platform.startGame'
  ]);
});

test('a malformed post-load key list or listed undefined value rejects instead of looking like an empty save', async () => {
  const malformedKeys = makeCleverApps((fake) => (fake.invalidKeyList = true));
  await expect(malformedKeys.platform.storage.get(['profile'])).rejects.toThrow('cleverapps_storage_keys_invalid');

  const missingValue = makeCleverApps((fake) => void (fake.cloud.profile = undefined));
  await expect(missingValue.platform.storage.get(['profile'])).rejects.toThrow('cleverapps_storage_value_invalid:profile');
});

test('a failed startGame is not remembered as ready and a later ready retries it once', async () => {
  const h = makeCleverApps((fake) => (fake.startGameMode = 'fail'));
  await h.platform.identity.ready();
  await expect(h.platform.gameplay.ready()).rejects.toThrow('start_game_down');
  h.fake.startGameMode = 'ok';
  await h.platform.gameplay.ready();
  await h.platform.gameplay.ready();
  expect(h.fake.count('platform.startGame')).toBe(2);
});

test('storage load is one shared gate: a failed, false or timed-out initial load rejects reads and performs no writes', async () => {
  for (const mode of ['false', 'fail', 'hang'] as const) {
    const h = makeCleverApps((fake) => (fake.loadMode = mode));
    const read = h.platform.storage.get(['profile']);
    const write = h.platform.storage.set({ profile: { level: 1 } });
    const expected = expect(read).rejects.toThrow(mode === 'false' ? 'cleverapps_storage_load_failed' : mode === 'fail' ? 'storage_load_down' : 'sdk_timeout:cleverapps_storage_load');
    if (mode === 'hang') await vi.advanceTimersByTimeAsync(CLEVERAPPS_TIMEOUTS.storageLoad);
    await expected;
    await expect(write).resolves.toBe(false);
    expect(h.fake.count('storage.set:')).toBe(0);
  }
});

test('storage distinguishes missing only after successful load and reads envelope, tombstone and legacy raw objects', async () => {
  const h = makeCleverApps((fake) => {
    fake.cloud.enveloped = { gcStorageVersion: 1, deleted: false, value: { level: 7 } };
    fake.cloud.deleted = { gcStorageVersion: 1, deleted: true };
    fake.cloud.legacy = { level: 3 };
  });
  expect(await h.platform.storage.get(['enveloped', 'deleted', 'legacy', 'missing'])).toEqual({
    enveloped: { level: 7 },
    legacy: { level: 3 }
  });
  expect(h.fake.count('storage.load')).toBe(1);
});

test('storage writes versioned envelopes sequentially and returns false on partial multi-key failure without claiming atomicity', async () => {
  const h = makeCleverApps((fake) => (fake.setModes = ['ok', 'false', 'ok']));
  expect(await h.platform.storage.set({ first: { n: 1 }, second: { n: 2 }, third: { n: 3 } })).toBe(false);
  expect(h.fake.calls.filter((call) => call.startsWith('storage.set:'))).toEqual(['storage.set:first', 'storage.set:second']);
  expect(h.fake.cloud.first).toEqual({ gcStorageVersion: CLEVERAPPS_STORAGE_VERSION, deleted: false, value: { n: 1 } });
  expect(h.fake.cloud.second).toBeUndefined();
  expect(h.fake.cloud.third).toBeUndefined();
});

test('storage set maps Connector false, reject and timeout to false; all writes happen after the successful load', async () => {
  for (const mode of ['false', 'fail', 'hang'] as const) {
    const h = makeCleverApps((fake) => (fake.setModes = [mode]));
    const write = h.platform.storage.set({ profile: { level: 9 } });
    if (mode === 'hang') await vi.advanceTimersByTimeAsync(CLEVERAPPS_TIMEOUTS.storageSet);
    await expect(write).resolves.toBe(false);
    expect(h.fake.calls.indexOf('storage.load')).toBeLessThan(h.fake.calls.indexOf('storage.set:profile'));
  }
});

test('storage clear writes a tombstone instead of an empty object or an invented physical delete', async () => {
  const h = makeCleverApps((fake) => (fake.cloud.profile = { level: 4 }));
  await h.platform.storage.clear(['profile']);
  expect(h.fake.cloud.profile).toEqual({ gcStorageVersion: 1, deleted: true });
  expect(await h.platform.storage.get(['profile'])).toEqual({});
});

test('the adapter satisfies PlatformRuntime without adding payments or lifecycle capabilities', async () => {
  const h = makeCleverApps();
  const runtime = new PlatformRuntime(h.platform);
  await runtime.ready();
  expect(runtime.capabilities()).toEqual({ ads: true, banner: false, payments: false, lifecycle: false, cloudStorage: true });
});
