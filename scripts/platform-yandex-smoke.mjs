// Fake-Yandex integration proof of Platform Layer v0.8-B1 on the BUILT public entries:
//   PlatformRuntime (game-core) → YandexPlatform (game-core/platform/yandex, fake SDK)
//   → AdsRuntime → PurchaseRuntime → PlatformCatalog
// No real Yandex SDK, no browser, no network, no money. The adapter's timers are injected with
// compressed time, so its production timeouts (120 s purchase, 8 s reads) fire within milliseconds.
// Run after `npm run build`: `npm run smoke:platform-yandex`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreBundle = resolve(rootDir, 'dist/game-core.es.js');
const yandexBundle = resolve(rootDir, 'dist/platform/yandex/game-core-platform-yandex.es.js');
for (const file of [coreBundle, yandexBundle]) {
  if (!existsSync(file)) {
    console.error(`platform-yandex-smoke: ${file} is missing — run \`npm run build\` first`);
    process.exit(1);
  }
}
const core = await import(pathToFileURL(coreBundle).href);
const { createYandexPlatform, YANDEX_NO_PLAYER } = await import(pathToFileURL(yandexBundle).href);
const { PlatformRuntime, AdsRuntime, MemoryAdsStateStore, parseAdsTsv, PurchaseRuntime, createGrantedPurchaseStore } = core;

const lines = [];
const step = (name, detail) => lines.push(`${String(lines.length + 1).padStart(2, '0')}  ${name.padEnd(22)} ${detail}`);

// ---- a fake Yandex Games SDK with the production shapes (callback ads, held receipts, a key-value cloud
// whose setData REPLACES the whole object — the SDK: getData answers the data of the LAST setData call)
const fake = {
  calls: [],
  cloud: { profile: { level: 20, coins: 0 } },
  getDataFailures: 0,
  setDataFailures: 0,
  held: [],
  seq: 0,
  purchaseHangs: false,
  nextAd: 'ok',
};
const never = () => new Promise(() => {});
const player = {
  getUniqueID: () => 'ya-player-42',
  getName: () => 'Fake Player',
  getData: (keys) => {
    fake.calls.push('getData');
    if (fake.getDataFailures > 0) return (fake.getDataFailures--, Promise.reject(new Error('network')));
    return Promise.resolve(Object.fromEntries((keys ?? Object.keys(fake.cloud)).filter((k) => k in fake.cloud).map((k) => [k, fake.cloud[k]])));
  },
  setData: (data, flush) => {
    fake.calls.push(`setData:flush=${flush}`);
    if (fake.setDataFailures > 0) return (fake.setDataFailures--, Promise.reject(new Error('rate_limit')));
    fake.cloud = JSON.parse(JSON.stringify(data));
    return Promise.resolve();
  }
};
const paymentsApi = {
  getCatalog: async () => [
    { id: 'starter_pack', price: '149 ₽', priceCurrencyCode: 'RUB' },
    { id: 'gold_1', price: '99 ₽', priceCurrencyCode: 'RUB' },
    { id: 'draft_without_price' }
  ],
  purchase: ({ id }) => {
    const purchase = { productID: id, purchaseToken: `ya-token-${++fake.seq}` };
    fake.held.push(purchase); // the money is taken, the receipt is held until consumed
    return fake.purchaseHangs ? never() : Promise.resolve(purchase);
  },
  getPurchases: async () => [...fake.held],
  consumePurchase: async (token) => void (fake.held = fake.held.filter((p) => p.purchaseToken !== token))
};
const sdk = {
  environment: { i18n: { lang: 'ru' }, payload: '' },
  deviceInfo: { type: 'mobile' },
  features: {
    LoadingAPI: { ready: () => fake.calls.push('LoadingAPI.ready') },
    GameplayAPI: { start: () => fake.calls.push('GameplayAPI.start'), stop: () => fake.calls.push('GameplayAPI.stop') }
  },
  adv: {
    showFullscreenAdv: ({ callbacks }) => queueMicrotask(() => (callbacks.onOpen(), fake.nextAd === 'ok' ? callbacks.onClose(true) : callbacks.onClose(false))),
    showRewardedVideo: ({ callbacks }) =>
      queueMicrotask(() => {
        callbacks.onOpen();
        if (fake.nextAd === 'error') return callbacks.onError(new Error('no_ads'));
        if (fake.nextAd === 'ok') callbacks.onRewarded();
        callbacks.onClose(true);
      })
  },
  getPlayer: async () => player,
  getPayments: async () => paymentsApi,
  serverTime: () => Date.UTC(2026, 8, 17, 10)
};

// ---- the platform: explicit Yandex target, fake boot, compressed timers, hooks instead of the game's ECS / sound
const audio = [];
const yandex = createYandexPlatform({
  init: async () => sdk,
  visibility: null,
  timers: { setTimeout: (cb, ms) => setTimeout(cb, Math.min(ms, 5)), clearTimeout: (handle) => clearTimeout(handle) },
  hooks: { pauseAudio: () => audio.push('pause'), resumeAudio: () => audio.push('resume') }
});
const platform = new PlatformRuntime(yandex);
await platform.ready();
await platform.gameplay.ready();
await new Promise((r) => setTimeout(r, 10)); // the player loads beside the critical path
assert.deepEqual(platform.capabilities(), { ads: true, banner: false, payments: true, lifecycle: false, cloudStorage: true });
assert.deepEqual(
  [platform.environment.platformCode(), platform.identity.playerId(), platform.environment.deviceType(), platform.environment.serverTime()],
  ['YA', 'ya-player-42', 'mobile', Math.floor(Date.UTC(2026, 8, 17, 10) / 1000)]
);
step('init', `code=YA player=${platform.identity.playerId()} device=${platform.environment.deviceType()} caps=${JSON.stringify(platform.capabilities())}`);

// ---- cloud storage: read, write, and a failed read that stays a failure
assert.deepEqual(await platform.storage.get(['profile', 'an']), { profile: { level: 20, coins: 0 } });
assert.equal(await platform.storage.set({ profile: { level: 21, coins: 50 }, an: { uuid: 'u-1' } }), true);
assert.deepEqual(fake.cloud, { profile: { level: 21, coins: 50 }, an: { uuid: 'u-1' } });
assert.ok(fake.calls.includes('setData:flush=true'));
// a lone key (the SaveGate Core record) is a PATCH: the replacing setData must not drop the game's save
assert.equal(await platform.storage.set({ 'game.core': { wallet: 20 } }), true);
assert.deepEqual(fake.cloud, { profile: { level: 21, coins: 50 }, an: { uuid: 'u-1' }, 'game.core': { wallet: 20 } });
// honest ACK: two calls collapsed into one setData that fails are BOTH false (the donor answered the joined one
// true at once); the next write carries their patches and only its own caller gets true
fake.setDataFailures = 1;
assert.deepEqual(await Promise.all([platform.storage.set({ 'game.core': { wallet: 21 } }), platform.storage.set({ an: { uuid: 'u-2' } })]), [false, false]);
assert.deepEqual(fake.cloud['game.core'], { wallet: 20 }); // the failed write confirmed nothing
assert.equal(await platform.storage.set({ profile: { level: 22, coins: 50 } }), true);
assert.deepEqual(fake.cloud, { profile: { level: 22, coins: 50 }, an: { uuid: 'u-2' }, 'game.core': { wallet: 21 } });
fake.getDataFailures = 3;
const readsBefore = fake.calls.filter((c) => c === 'getData').length;
await assert.rejects(platform.storage.get(['profile']), /network/);
assert.equal(fake.calls.filter((c) => c === 'getData').length - readsBefore, 3);
assert.equal(typeof YANDEX_NO_PLAYER, 'string');
step('cloud storage', 'getData ok; set(patch) = setData(whole object, flush=true), other keys kept; a failed collapsed write → false ×2, carried; 3 failed reads → REJECT');

// ---- catalog: the platform's READY price strings
const refreshed = await platform.catalog.refresh();
assert.deepEqual([refreshed.status, refreshed.products, platform.catalog.priceText('starter_pack'), platform.catalog.currency(), platform.catalog.hasPrice('draft_without_price')], ['ok', 2, '149 ₽', 'RUB', false]);
step('catalog', `refresh=${refreshed.status} products=${refreshed.products} starter_pack="${platform.catalog.priceText('starter_pack')}" currency=${platform.catalog.currency()}`);

// ---- ads: AdsRuntime decides, the Yandex platform shows, the host registers a confirmed show
const fixtures = resolve(rootDir, 'tests/ads/fixtures');
const ads = new AdsRuntime({
  config: parseAdsTsv(readFileSync(resolve(fixtures, 'segments.tsv'), 'utf-8'), readFileSync(resolve(fixtures, 'placements.tsv'), 'utf-8')),
  state: new MemoryAdsStateStore(),
  input: { now: () => Date.UTC(2026, 8, 17, 10), level: () => 20, hasNoAds: () => false, payCount: () => 0, paySumCents: () => 0, payMaxCents: () => 0, currencyScale: () => 1 }
});
let hearts = 0;
const showInter = async (placement) => {
  const decision = ads.decide(placement, 'inter');
  if (!decision.allowed) return `denied:${decision.reason}`;
  const result = await platform.ads.showInterstitial(placement);
  if (result.status === 'shown') ads.registerShown(placement);
  return result.status;
};
const showRewarded = async (placement) => {
  if (!ads.decide(placement, 'rewarded').allowed || !platform.ads.isRewardedAvailable()) return 'hidden';
  const result = await platform.ads.showRewarded(placement);
  if (result.rewarded) (hearts += 5), ads.registerShown(placement);
  return `${result.status}/rewarded=${result.rewarded}`;
};
fake.calls.length = 0;
fake.nextAd = 'none';
const inter = [await showInter('level_win_inter')];
fake.nextAd = 'ok';
inter.push(await showInter('level_win_inter'), await showInter('level_win_inter'));
assert.deepEqual(inter, ['no_fill', 'shown', 'denied:inter_cooldown']);
fake.nextAd = 'none';
const rewarded = [await showRewarded('ad_refill_hearts_rewarded')];
fake.nextAd = 'ok';
rewarded.push(await showRewarded('ad_refill_hearts_rewarded'));
assert.deepEqual([rewarded, hearts, ads.getStats().shown], [['dismissed/rewarded=false', 'rewarded/rewarded=true'], 5, 2]);
assert.deepEqual(fake.calls.filter((c) => c.startsWith('GameplayAPI')).slice(0, 2), ['GameplayAPI.stop', 'GameplayAPI.start']); // gameplay ran → restored
assert.equal(audio.filter((a) => a === 'resume').length, 4);
step('ads', `inter: ${inter.join(' → ')}; rewarded: ${rewarded.join(' → ')}; hearts=${hearts}; audio resumed ${audio.filter((a) => a === 'resume').length}×`);

// ---- B17: rewarded availability recovers — the built adapter listens to the page's global `online` event.
// Node has no such event target: one is installed BEFORE the adapter is created, and removed after.
const net = new EventTarget();
let onlineListeners = 0;
globalThis.addEventListener = (type, listener) => void (type === 'online' && onlineListeners++, net.addEventListener(type, listener));
globalThis.removeEventListener = (type, listener) => void (type === 'online' && onlineListeners--, net.removeEventListener(type, listener));
const recovering = createYandexPlatform({ init: async () => sdk, visibility: null, timers: { setTimeout: (cb, ms) => setTimeout(cb, Math.min(ms, 5)), clearTimeout: (handle) => clearTimeout(handle) } });
await recovering.identity.ready();
const available = () => recovering.ads.isRewardedAvailable();
const rewardedBy = async (next) => ((fake.nextAd = next), (await recovering.ads.showRewarded('ad_refill_hearts_rewarded')).status);
const b17 = [onlineListeners, await rewardedBy('error'), available()];
net.dispatchEvent(new Event('online')); // the network is back: availability only, no show, no reward
b17.push(available(), await rewardedBy('error'), available(), await rewardedBy('ok'), available());
recovering.dispose();
await rewardedBy('error');
net.dispatchEvent(new Event('online')); // after dispose: no listener left, nothing changes
b17.push(onlineListeners, available());
delete globalThis.addEventListener;
delete globalThis.removeEventListener;
fake.nextAd = 'ok';
assert.deepEqual(b17, [1, 'no_fill', false, true, 'no_fill', false, 'rewarded', true, 0, false]);
step('rewarded recovery', `listener ${b17[0]}; error → ${b17[2]}; online → ${b17[3]}; error → ${b17[5]}; onRewarded → ${b17[7]}; dispose → listeners ${b17[8]}, online → ${b17[9]}`);

// ---- purchases: platform.payments IS PurchaseRuntime's PaymentsAdapter
const wallet = { coins: 0 };
const events = [];
const purchases = new PurchaseRuntime({
  payments: platform.payments,
  granted: createGrantedPurchaseStore(),
  resolveGrant: (productId) => ({ starter_pack: { coins: 500 }, gold_1: { coins: 1000 } })[productId],
  grant: (_id, rewards) => void (wallet.coins += rewards.coins),
  onEvent: (event) => events.push(event.type)
});
const direct = await purchases.purchase('starter_pack', 'offer_window');
assert.deepEqual([direct.status, direct.token, wallet.coins], ['ok', 'ya-token-1', 500]); // granted with the answer
await new Promise((r) => setTimeout(r, 10)); // the consume runs after the grant, never awaited by it (spec v0.6 §10)
assert.equal(fake.held.length, 0);
step('purchase', `starter_pack → ${direct.status} token=${direct.token} coins=${wallet.coins} held=${fake.held.length} (granted → consumePurchase)`);

fake.purchaseHangs = true; // paid, but purchase() never answers → the adapter's 120 s timeout → cancelled
const lost = await purchases.purchase('gold_1', 'shop');
assert.deepEqual([lost.status, lost.restoreAdvised, wallet.coins, fake.held.length], ['cancelled', true, 500, 1]);
const restored = await purchases.restore();
assert.deepEqual([restored.status, restored.granted.map((g) => g.productId), wallet.coins, fake.held.length], ['ok', ['gold_1'], 1500, 0]);
assert.equal((await purchases.restore()).granted.length, 0);
step('restore', `hung gold_1 → ${lost.status} restoreAdvised=${lost.restoreAdvised}; restore (after-consume) granted=${restored.granted.length} coins=${wallet.coins}; 2nd restore grants 0`);

// ---- the build boundary, on the very files this proof ran
const count = (file, needle) => readFileSync(file, 'utf-8').split(needle).length - 1;
const boundary = { root: count(coreBundle, 'YaGames'), rootIife: count(resolve(rootDir, 'dist/game-core.iife.js'), 'YaGames'), yandex: count(yandexBundle, 'YaGames') };
assert.deepEqual([boundary.root, boundary.rootIife, boundary.yandex > 0], [0, 0, true]);
step('boundary', `"YaGames" in dist/game-core.es.js: ${boundary.root}, .iife.js: ${boundary.rootIife}, platform/yandex bundle: ${boundary.yandex}`);

yandex.dispose();
console.log(`platform-yandex-smoke (${core.BUILD_INFO.version} ${core.BUILD_INFO.commit})\n${lines.join('\n')}\nplatform-yandex-smoke: OK (${lines.length} steps, purchase events: ${events.join(', ')})`);
