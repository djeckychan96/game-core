import { expect, test } from 'vitest';
import { PlatformRuntime, createDevPlatform } from '../../src/platform';
import type { DevKeyValueStore, GamePlatform, PlatformLifecycle, PlatformStorage } from '../../src/platform';

function memoryStore(): DevKeyValueStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key)
  };
}

// ---------------------------------------------------------------- facade + capability optionality

test('the facade exposes the capabilities of the platform it was given — and nothing it lacks', () => {
  const full = new PlatformRuntime(createDevPlatform({ lifecycle: true }));
  expect(full.capabilities()).toEqual({ ads: true, banner: true, payments: true, lifecycle: true, cloudStorage: false });
  expect(full.has('ads') && full.has('payments') && full.has('lifecycle')).toBe(true);

  // a Yandex-like target: ads without a banner, no shortcut; an MSN-like one: no payments at all
  const yandexLike = new PlatformRuntime(createDevPlatform({ banner: false }));
  expect(yandexLike.capabilities()).toMatchObject({ ads: true, banner: false, lifecycle: false });
  expect(yandexLike.ads?.showBanner).toBeUndefined();
  expect(yandexLike.lifecycle).toBeUndefined();

  const bare = new PlatformRuntime(createDevPlatform({ ads: false, payments: false }));
  expect(bare.ads).toBeUndefined();
  expect(bare.payments).toBeUndefined();
  expect(bare.has('ads') || bare.has('payments') || bare.has('lifecycle')).toBe(false);
  expect(bare.has('identity') && bare.has('environment') && bare.has('storage') && bare.has('gameplay')).toBe(true);
});

test('an optional capability is the host-made object itself — the facade adds no stub and no wrapper', async () => {
  const lifecycle: PlatformLifecycle = { canCreateShortcut: async () => true, createShortcut: async () => true };
  const dev = createDevPlatform();
  const platform = new PlatformRuntime({ ...dev, lifecycle });
  expect(platform.lifecycle).toBe(lifecycle);
  expect(platform.ads).toBe(dev.ads);
  expect(platform.payments).toBe(dev.payments);
  expect(await platform.lifecycle!.canCreateShortcut()).toBe(true);
});

test('a platform without a required capability, with a half-made one or with an unknown code is refused at construction', () => {
  const dev = createDevPlatform();
  const { storage: _storage, ...noStorage } = dev;
  expect(() => new PlatformRuntime(noStorage as unknown as GamePlatform)).toThrow(/capability "storage" is required/);
  expect(() => new PlatformRuntime({ ...dev, gameplay: { ...dev.gameplay, stop: undefined } } as unknown as GamePlatform)).toThrow(/gameplay\.stop\(\) is missing/);
  expect(() => new PlatformRuntime({ ...dev, ads: { showInterstitial: dev.ads!.showInterstitial } } as unknown as GamePlatform)).toThrow(/ads\.showRewarded\(\) is missing/);
  expect(() => new PlatformRuntime({ ...dev, payments: { purchase: async () => null, restore: async () => [] } } as unknown as GamePlatform)).toThrow(/payments\.getCatalog\(\) is missing/);
  expect(() => new PlatformRuntime({ ...dev, environment: { ...dev.environment, platformCode: () => 'STEAM' } } as unknown as GamePlatform)).toThrow(/unknown platform code "STEAM"/);
  expect(() => new PlatformRuntime(undefined as unknown as GamePlatform)).toThrow(TypeError);
});

// ---------------------------------------------------------------- DEV init / identity / gameplay

test('DEV: ready, a guest by default, the explicit DEV code, and the gameplay markers the donor localhost never answered', async () => {
  const dev = createDevPlatform();
  const platform = new PlatformRuntime(dev);
  await platform.ready();
  expect(platform.identity.playerId()).toBeNull();
  expect(platform.identity.displayName()).toBe('');
  expect(platform.environment.platformCode()).toBe('DEV');
  expect(platform.environment.language()).toBe('ru');
  expect(platform.environment.deviceType()).toBeNull();
  expect(platform.environment.platformOs()).toBeNull();
  expect(platform.environment.launchPayload()).toBe('');
  expect(platform.environment.serverTime()).toBeNull();

  platform.gameplay.reportLoadingProgress(50);
  expect(dev.dev.getState()).toMatchObject({ appReady: false, gameplayActive: false, loadingProgress: 50 });
  await platform.gameplay.ready();
  platform.gameplay.start();
  expect(dev.dev.getState()).toMatchObject({ appReady: true, gameplayActive: true });
  platform.gameplay.stop();
  expect(dev.dev.getState().gameplayActive).toBe(false);

  const named = new PlatformRuntime(
    createDevPlatform({ playerId: 'dev-42', displayName: 'Tester', language: 'en_US', deviceType: 'tablet', platformOs: 'ios', launchPayload: 'promo', serverTime: () => 1_758_000_000 })
  );
  expect(named.identity.playerId()).toBe('dev-42');
  expect(named.identity.displayName()).toBe('Tester');
  expect([named.environment.language(), named.environment.deviceType(), named.environment.platformOs(), named.environment.launchPayload(), named.environment.serverTime()]).toEqual([
    'en_US', 'tablet', 'ios', 'promo', 1_758_000_000
  ]);
});

test('ready() runs identity then storage once; a failure rejects, is not remembered, and the next call tries again', async () => {
  const calls: string[] = [];
  let storageDown = true;
  const dev = createDevPlatform();
  const platform = new PlatformRuntime({
    ...dev,
    identity: { ...dev.identity, ready: async () => void calls.push('identity') },
    storage: {
      ...dev.storage,
      ready: async () => {
        calls.push('storage');
        if (storageDown) throw new Error('sdk_timeout:storage.ready');
      }
    }
  });
  await expect(platform.ready()).rejects.toThrow('sdk_timeout:storage.ready');
  storageDown = false;
  await platform.ready();
  await platform.ready();
  expect(calls).toEqual(['identity', 'storage', 'identity', 'storage']);
});

// ---------------------------------------------------------------- storage

test('DEV storage: get / set / clear by keys over the injected store; a key never written is absent, not null', async () => {
  const store = memoryStore();
  const { storage } = new PlatformRuntime(createDevPlatform({ store, storagePrefix: 'game.' }));
  expect(storage.isCloud()).toBe(false);
  await storage.ready();
  expect(await storage.get(['profile', 'an'])).toEqual({});
  expect(await storage.set({ profile: { level: 7, coins: 120 }, an: { installed_at: 1 }, skipped: undefined })).toBe(true);
  expect([...store.items.keys()].sort()).toEqual(['game.an', 'game.profile']);
  expect(await storage.get(['profile', 'an', 'missing'])).toEqual({ profile: { level: 7, coins: 120 }, an: { installed_at: 1 } });
  expect(await storage.get(['an'])).toEqual({ an: { installed_at: 1 } });
  await storage.clear(['profile']);
  expect(await storage.get(['profile', 'an'])).toEqual({ an: { installed_at: 1 } });

  // a second platform over the same store = a reload
  const reloaded = new PlatformRuntime(createDevPlatform({ store, storagePrefix: 'game.' }));
  expect(await reloaded.storage.get(['an'])).toEqual({ an: { installed_at: 1 } });
});

test('a storage READ failure stays a failure — a throwing store or a corrupted value rejects, never an empty profile', async () => {
  const store = memoryStore();
  const { storage } = new PlatformRuntime(createDevPlatform({ store }));
  await storage.set({ profile: { level: 30 } });

  store.items.set('game-core.dev.profile', '{"level":3'); // truncated write
  await expect(storage.get(['profile'])).rejects.toThrow(SyntaxError);

  const broken = new PlatformRuntime(
    createDevPlatform({
      store: {
        ...store,
        getItem: () => {
          throw new Error('SecurityError: storage is not available');
        }
      }
    })
  );
  await expect(broken.storage.get(['profile'])).rejects.toThrow('SecurityError');
  // a write failure is an answer, not a crash: the host keeps its mirror and retries
  const readOnly = new PlatformRuntime(
    createDevPlatform({
      store: {
        ...store,
        setItem: () => {
          throw new Error('QuotaExceededError');
        }
      }
    })
  );
  expect(await readOnly.storage.set({ profile: {} })).toBe(false);
});

test('the facade enforces the read invariant for ANY adapter: a storage that answers null / a non-object for a failed read is turned into a rejection', async () => {
  const dev = createDevPlatform();
  for (const answer of [null, undefined, 'error', []]) {
    const sloppy = { ...dev.storage, get: async () => answer } as unknown as PlatformStorage;
    const platform = new PlatformRuntime({ ...dev, storage: sloppy });
    await expect(platform.storage.get(['profile'])).rejects.toThrow(/never an empty profile/);
  }
  const failing = new PlatformRuntime({ ...dev, storage: { ...dev.storage, get: () => Promise.reject(new Error('sdk_timeout:getData')) } });
  await expect(failing.storage.get(['profile'])).rejects.toThrow('sdk_timeout:getData');
});
