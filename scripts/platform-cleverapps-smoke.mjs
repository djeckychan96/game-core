import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(resolve(rootDir, 'dist/game-core.es.js')).href);
const clever = await import(pathToFileURL(resolve(rootDir, 'dist/platform/cleverapps/game-core-platform-cleverapps.es.js')).href);

const calls = [];
const listeners = new Map();
const cloud = { profile: { gcStorageVersion: 1, deleted: false, value: { level: 8 } } };
const ads = {
  isRewardedSupported: true,
  isRewardedAvailable: true,
  isInterstitialSupported: true,
  isInterstitialAvailable: true,
  on(event, listener) {
    calls.push(`on:${event}`);
    listeners.set(event, listener);
  },
  off(event) {
    listeners.delete(event);
  },
  async showRewardedVideo() {
    calls.push('showRewardedVideo');
    queueMicrotask(() => {
      listeners.get('rewarded:reward')?.();
      listeners.get('rewarded:close')?.(true);
    });
    return true;
  },
  async showInterstitial() {
    calls.push('showInterstitial');
    queueMicrotask(() => listeners.get('interstitial:close')?.(true));
    return true;
  }
};
const connector = {
  info: { source: 'instant', language: 'en_US', isMobile: true, os: 'iOS' },
  player: { ready: Promise.resolve(), id: 'fb-42', name: 'Facebook Player' },
  social: { isLoggedIn: () => true },
  platform: {
    hasNativeLoadingScreen: true,
    getUserID: () => 'fb-42',
    reportLoadingProgress: (progress) => calls.push(`loading:${progress}`),
    startGame: async () => void calls.push('startGame')
  },
  storage: {
    ready: Promise.resolve(),
    isSupported: true,
    load: async () => (calls.push('storage.load'), true),
    get: (key) => cloud[key],
    getKeys: () => Object.keys(cloud),
    set: async (key, value) => ((cloud[key] = value), calls.push(`storage.set:${key}`), true)
  },
  ads
};

const adapter = clever.createCleverAppsPlatform({ init: async () => connector, visibility: null });
const platform = new core.PlatformRuntime(adapter);
await platform.ready();
platform.gameplay.reportLoadingProgress(50);
await Promise.all([platform.gameplay.ready(), platform.gameplay.ready()]);
assert.equal(calls.filter((call) => call === 'startGame').length, 1);
assert.deepEqual(platform.capabilities(), { ads: true, banner: false, payments: false, lifecycle: false, cloudStorage: true });
assert.deepEqual(
  [platform.environment.platformCode(), platform.environment.language(), platform.environment.deviceType(), platform.environment.platformOs(), platform.identity.playerId()],
  ['FB', 'en_US', 'mobile', 'iOS', 'fb-42']
);
assert.deepEqual(await platform.storage.get(['profile', 'missing']), { profile: { level: 8 } });
assert.equal(await platform.storage.set({ 'game.core': { wallet: { v: 1, balance: 20, rewardedLevels: [] } } }), true);
assert.deepEqual(cloud['game.core'], {
  gcStorageVersion: 1,
  deleted: false,
  value: { wallet: { v: 1, balance: 20, rewardedLevels: [] } }
});
assert.deepEqual(await platform.ads.showRewarded('continue_rewarded'), {
  status: 'rewarded',
  rewarded: true,
  placement: 'continue_rewarded'
});
assert.deepEqual(await platform.ads.showInterstitial('level_complete'), {
  status: 'shown',
  rewarded: false,
  placement: 'level_complete',
  raw: true
});
assert.equal(calls.filter((call) => call.startsWith('on:')).length, 3);
adapter.dispose();

console.log(`platform-cleverapps-smoke (${core.BUILD_INFO.version} ${core.BUILD_INFO.commit}): OK (FB, bootstrap, identity, environment, gameplay, storage envelope, rewarded, interstitial; fake Connector, no network)`);
