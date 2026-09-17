// DEV-only proof of Platform Layer v0.8-A on the BUILT public entry (dist/game-core.es.js): one
// fake player goes through every capability of `createDevPlatform()` wired into the real
// OfferRuntime / PurchaseRuntime / AdsRuntime / AnalyticsRuntime. No browser, no WebGL, no SDK,
// no network, no real money. Run after `npm run build`: `npm run smoke:platform`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = resolve(rootDir, 'dist/game-core.es.js');
if (!existsSync(bundle)) {
  console.error('platform-dev-smoke: dist/game-core.es.js is missing — run `npm run build` first');
  process.exit(1);
}
const core = await import(pathToFileURL(bundle).href);
const {
  PlatformRuntime, createDevPlatform, validateGamePlatformConfig, createPlatformAnalyticsContext,
  OfferRuntime, MemoryOfferStateStore, DEFAULT_OFFER_CHAIN_TIMING,
  PurchaseRuntime, createGrantedPurchaseStore,
  AdsRuntime, MemoryAdsStateStore, parseAdsTsv, AnalyticsRuntime
} = core;

const lines = [];
const step = (name, detail) => lines.push(`${String(lines.length + 1).padStart(2, '0')}  ${name.padEnd(28)} ${detail}`);

// the explicit target of this "build"
const config = { app: 'demo_game', platforms: { DEV: { provider: 'dev', platformCode: 'DEV' } } };
validateGamePlatformConfig(config);
assert.throws(() => validateGamePlatformConfig({ ...config, appSecret: 'x' }), /server-secret/);
step('config', 'client-safe config accepted; a smuggled appSecret refused');

let purchaseOutcome = 'ok';
let adOutcome = null;
const dev = createDevPlatform({
  playerId: 'dev-player',
  products: [{ id: 'starter_pack', priceText: '149 ₽', currency: 'RUB' }, { id: 'gold_1', priceText: '99 ₽', currency: 'RUB' }],
  purchaseOutcome: () => purchaseOutcome,
  adOutcome: (type) => adOutcome ?? (type === 'rewarded' ? 'rewarded' : 'shown')
});
const platform = new PlatformRuntime(dev);
await platform.ready();
platform.gameplay.reportLoadingProgress(100);
await platform.gameplay.ready();
platform.gameplay.start();
assert.deepEqual(platform.capabilities(), { ads: true, banner: true, payments: true, lifecycle: false, cloudStorage: false });
assert.equal(dev.dev.getState().appReady && dev.dev.getState().gameplayActive, true);
step('init', `code=${platform.environment.platformCode()} player=${platform.identity.playerId()} lang=${platform.environment.language()} caps=${JSON.stringify(platform.capabilities())}`);

// storage: a profile round trip, reset, and a failed read that stays a failure
assert.equal(await platform.storage.set({ profile: { level: 20, coins: 0 } }), true);
assert.deepEqual(await platform.storage.get(['profile', 'an']), { profile: { level: 20, coins: 0 } });
await platform.storage.clear(['profile']);
assert.deepEqual(await platform.storage.get(['profile']), {});
const brokenRead = new PlatformRuntime(createDevPlatform({ store: { getItem: () => { throw new Error('storage down'); }, setItem() {}, removeItem() {} } }));
await assert.rejects(brokenRead.storage.get(['profile']), /storage down/);
step('storage', 'set / get / clear ok; a read failure REJECTS (never an empty profile)');

// catalog → OfferRuntime.hasPrice
const offer = (productId, tier, variant) => ({ productId, tier, variant, titleKey: productId, timerSec: 3600, rewards: [{ id: 'coins', amount: 500 }] });
const offers = new OfferRuntime({
  config: { ...DEFAULT_OFFER_CHAIN_TIMING, welcome: offer('starter_pack', 0, 0), tiers: [1, 2, 3, 4, 5, 6].map((t) => [offer(`t${t}a`, t, 0), offer(`t${t}b`, t, 1)]) },
  state: new MemoryOfferStateStore(),
  input: { now: () => 1_760_000_000, level: () => 20, hasPrice: (id) => platform.catalog.hasPrice(id), welcomeOwned: () => false }
});
offers.update(16);
assert.equal(offers.getActive(), null);
const refreshed = await platform.catalog.refresh();
offers.tick();
assert.equal(offers.getActive()?.productId, 'starter_pack');
step('catalog', `refresh=${refreshed.status} products=${refreshed.products} currency=${platform.catalog.currency()} → offer "${offers.getActive().productId}" active at ${platform.catalog.priceText('starter_pack')}`);

// analytics context from the platform
const sent = [];
const analytics = new AnalyticsRuntime({
  transport: { send: async (events) => void sent.push(...events) },
  context: createPlatformAnalyticsContext(platform, ({ playerId, language }) => ({
    app: config.app, appVersion: '0.0.0-smoke', profileId: playerId ?? 'local-uuid', device: 'desktop', baseData: { lang: language }
  }))
});

// purchases: platform.payments IS the PaymentsAdapter
const wallet = { coins: 0 };
const purchaseEvents = [];
const purchases = new PurchaseRuntime({
  payments: platform.payments,
  granted: createGrantedPurchaseStore(),
  resolveGrant: (productId) => ({ starter_pack: { coins: 500 }, gold_1: { coins: 1000 } })[productId],
  grant: (_id, rewards) => void (wallet.coins += rewards.coins),
  onEvent: (event) => purchaseEvents.push(event.type)
});
const direct = await purchases.purchase('starter_pack', 'offer_window');
assert.deepEqual([direct.status, wallet.coins, dev.dev.receipts().length], ['ok', 500, 0]);
step('purchase', `starter_pack → ${direct.status} token=${direct.token} coins=${wallet.coins} receipts=${dev.dev.receipts().length} (consumed)`);

purchaseOutcome = 'lost'; // paid, but the answer never reached the game
const lost = await purchases.purchase('gold_1', 'shop');
assert.deepEqual([lost.status, lost.restoreAdvised, wallet.coins, dev.dev.receipts().length], ['cancelled', true, 500, 1]);
const restored = await purchases.restore();
assert.deepEqual([restored.status, restored.granted.length, wallet.coins, dev.dev.receipts().length], ['ok', 1, 1500, 0]);
assert.equal((await purchases.restore()).granted.length, 0);
step('restore', `lost gold_1 → ${lost.status} restoreAdvised=${lost.restoreAdvised}; restore granted=${restored.granted.length} coins=${wallet.coins}; 2nd restore grants 0`);

// ads: AdsRuntime decides, the platform shows, only a real show is registered
const fixtures = resolve(rootDir, 'tests/ads/fixtures');
const ads = new AdsRuntime({
  config: parseAdsTsv(readFileSync(resolve(fixtures, 'segments.tsv'), 'utf-8'), readFileSync(resolve(fixtures, 'placements.tsv'), 'utf-8')),
  state: new MemoryAdsStateStore(),
  input: {
    now: () => Date.UTC(2026, 8, 17, 10), level: () => 20, hasNoAds: () => false, payCount: () => 0, paySumCents: () => 0, payMaxCents: () => 0,
    currencyScale: () => (platform.catalog.currency() === 'USD' ? 1 / 85 : 1)
  }
});
const showInter = async (placement) => {
  if (!ads.decide(placement, 'inter').allowed) return `denied:${ads.decide(placement, 'inter').reason}`;
  const result = await platform.ads.showInterstitial(placement);
  if (result.status === 'shown') {
    ads.registerShown(placement);
    analytics.advertisement({ type: 'interstitial', placement, status: 'complete' });
  }
  return result.status;
};
adOutcome = 'no_fill';
const inter = [await showInter('level_win_inter')];
adOutcome = null;
inter.push(await showInter('level_win_inter'), await showInter('level_win_inter'));
assert.deepEqual(inter, ['no_fill', 'shown', 'denied:inter_cooldown']);
adOutcome = 'dismissed';
const dismissed = await platform.ads.showRewarded('ad_refill_hearts_rewarded');
adOutcome = null;
const rewarded = await platform.ads.showRewarded('ad_refill_hearts_rewarded');
assert.deepEqual([dismissed.rewarded, rewarded.rewarded, rewarded.status], [false, true, 'rewarded']);
step('ads', `inter: ${inter.join(' → ')}; rewarded: dismissed.rewarded=${dismissed.rewarded} → ${rewarded.status}.rewarded=${rewarded.rewarded}`);

await analytics.flush();
assert.deepEqual([...new Set(sent.map((e) => `${e.app}/${e.p}/${e.event.data.profile_id}/${e.event.data.device}/${e.event.data.lang}`))], ['demo_game/DEV/dev-player/desktop/ru']);
step('analytics', `${sent.length} event(s) as ${sent[0].app}/${sent[0].p}/${sent[0].event.data.profile_id} — p and player id from the platform`);

platform.gameplay.stop();
dev.dev.reset();
assert.deepEqual([dev.dev.getState().gameplayActive, dev.dev.receipts().length], [false, 0]);
step('stop + reset', 'gameplay stopped, DEV receipts / counters forgotten');

console.log(`platform-dev-smoke (${core.BUILD_INFO.version} ${core.BUILD_INFO.commit})\n${lines.join('\n')}\nplatform-dev-smoke: OK (${lines.length} steps, purchase events: ${purchaseEvents.join(', ')})`);
