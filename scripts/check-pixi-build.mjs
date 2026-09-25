// Post-build smoke check for the `game-core/pixi` public entry:
//  - the built ESM bundle exists, imports pixi.js as an external (never bundled), and exposes
//    the documented kit classes;
//  - the root bundle stays renderer-agnostic (no pixi.js import, no kit classes);
//  - the rolled-up type declarations exist.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  console.error(`check-pixi-build: ${message}`);
  process.exit(1);
};

const pixiBundle = resolve(rootDir, 'dist/pixi/game-core-pixi.es.js');
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
const pixiExport = pkg.exports?.['./pixi'];
if (!pixiExport?.types || !pixiExport?.import) fail('package.json lacks the "./pixi" export');
const pixiTypes = resolve(rootDir, pixiExport.types);
if (resolve(rootDir, pixiExport.import) !== resolve(rootDir, 'dist/pixi/game-core-pixi.es.js')) fail('"./pixi" import path drifted');
const coreBundle = resolve(rootDir, 'dist/game-core.es.js');
for (const file of [pixiBundle, pixiTypes, coreBundle]) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

const pixiSource = readFileSync(pixiBundle, 'utf-8');
if (!/from\s*["']pixi\.js["']/.test(pixiSource)) fail('dist/pixi bundle does not import pixi.js as an external');
if (/class\s+Application\b/.test(pixiSource) || /WebGLRenderer/.test(pixiSource)) fail('dist/pixi bundle appears to inline PixiJS');

const coreSource = readFileSync(coreBundle, 'utf-8');
if (/pixi\.js/.test(coreSource)) fail('root bundle references pixi.js');
if (/LevelMapView|HudView|ResultWindowView|ClickRippleEffect|ReadyUiOverlay|OrientationGuard/.test(coreSource)) fail('root bundle contains Pixi kit classes');
// the orientation guard decides from a media query (landscape + coarse primary pointer) — never from the user agent
if (/userAgent/.test(pixiSource)) fail('dist/pixi bundle sniffs the user agent');
// the overlay host is the one kit module that creates a Pixi Application — host-driven only: no frame loop, timer or observer of its own
if (/requestAnimationFrame\s*\(|setInterval\s*\(|setTimeout\s*\(|ResizeObserver/.test(pixiSource)) fail('dist/pixi bundle creates a frame loop, a timer or an observer');
// the offer chain lives in the root entry and stays out of the kit (the window is data-only)
if (!/OfferRuntime/.test(coreSource)) fail('root bundle lacks OfferRuntime');
if (/OfferRuntime|tickOffers|onOfferPurchased/.test(pixiSource)) fail('dist/pixi bundle references the offers module');
// the analytics pipeline lives in the root entry too; the kit never logs anything itself
if (!/AnalyticsRuntime/.test(coreSource) || !/createHazarAnalyticsTransport/.test(coreSource)) fail('root bundle lacks AnalyticsRuntime');
if (/AnalyticsRuntime|createHazarAnalyticsTransport|createOfferAnalyticsHandler/.test(pixiSource)) fail('dist/pixi bundle references the analytics module');
// the purchase pipeline lives in the root entry; the kit's BUY buttons only call the host, and the
// root bundle never names a platform SDK (payments adapters are injected)
if (!/PurchaseRuntime/.test(coreSource) || !/createPurchaseAnalyticsHandler/.test(coreSource)) fail('root bundle lacks PurchaseRuntime');
if (/PurchaseRuntime|createGrantedPurchaseStore|createPurchaseAnalyticsHandler/.test(pixiSource)) fail('dist/pixi bundle references the purchases module');
if (/YaGames|getPayments|consumePurchase|FBInstant/.test(coreSource)) fail('root bundle references a platform payments SDK');
// the ad decision layer lives in the root entry; it decides and never shows — no ad SDK call may appear in the root bundle
if (!/AdsRuntime/.test(coreSource) || !/parseAdsTsv/.test(coreSource) || !/createAdsAnalyticsHandler/.test(coreSource)) fail('root bundle lacks AdsRuntime');
if (/AdsRuntime|parseAdsTsv|createAdsAnalyticsHandler|createPurchaseAdsHandler/.test(pixiSource)) fail('dist/pixi bundle references the ads module');
// (`showInterstitial` is ALSO the normalized PlatformAds contract name since v0.8 — the root bundle may define it
// (the contract check, the DEV platform) but must never CALL it: showing an ad stays the host's line)
if (/showFullscreenAdv|showRewardedVideo|loadBannerAdAsync|hideBannerAdAsync/.test(coreSource)) fail('root bundle references an advertising SDK');
if (/\.(showInterstitial|showRewarded|showBanner)\s*\(/.test(coreSource)) fail('root bundle calls an ad show method');
// the platform layer lives in the root entry: the contract, the facade, the catalog and the DEV platform — never an SDK
// global, never a storage global (the DEV platform's store is injected); the kit never touches a platform
if (!/PlatformRuntime/.test(coreSource) || !/createDevPlatform/.test(coreSource) || !/validateGamePlatformConfig/.test(coreSource)) fail('root bundle lacks the platform layer');
if (/PlatformRuntime|PlatformCatalog|createDevPlatform|createPlatformAnalyticsContext/.test(pixiSource)) fail('dist/pixi bundle references the platform module');
if (/GSInstant|vkBridge|onConnectorInit|CONNECTOR_CONFIG|\blocalStorage\b/.test(coreSource)) fail('root bundle references a platform SDK global or localStorage');
if (/eyJ[A-Za-z0-9_-]{10,}\./.test(coreSource)) fail('root bundle contains something that looks like a JWT');
const coreTypes = readFileSync(resolve(rootDir, pkg.types), 'utf-8');
for (const name of ['OfferRuntime', 'OfferChainConfig', 'OfferStateStore', 'OfferChainInput', 'OfferEvent', 'AnalyticsRuntime', 'AnalyticsTransport', 'AnalyticsContext', 'AnalyticsQueueStore', 'AnalyticsEnvelope', 'createOfferAnalyticsHandler', 'PurchaseRuntime', 'PaymentsAdapter', 'GrantedPurchaseStore', 'PurchaseEvent', 'createPurchaseAnalyticsHandler', 'AdsRuntime', 'AdsConfig', 'AdsStateStore', 'AdsInput', 'AdsDenyReason', 'createAdsAnalyticsHandler', 'createPurchaseAdsHandler', 'PlatformRuntime', 'GamePlatform', 'PlatformAds', 'PlatformAdResult', 'PlatformPayments', 'PlatformProduct', 'PlatformCatalog', 'PlatformStorage', 'GamePlatformConfig', 'createDevPlatform', 'createPlatformAnalyticsContext']) {
  if (!coreTypes.includes(name)) fail(`${pkg.types} lacks ${name}`);
}

const mod = await import(pathToFileURL(pixiBundle).href);
const expected = [
  'LevelMapView', 'HudView', 'UiButton', 'ModalWindow', 'ResultWindowView', 'LivesWindowView', 'ShopWindowView',
  'loadReadyUiAssets', 'createReadyUiTextures', 'READY_UI_ASSET_FILES', 'DEFAULT_READY_UI_THEME', 'resolveTheme',
  'createLabel', 'formatAmount', 'formatTimer', 'backOut', 'ClickRippleEffect', 'DEFAULT_CLICK_RIPPLE',
  'createReadyUiOverlay', 'ReadyUiOverlay', 'createOrientationGuard', 'OrientationGuard', 'ORIENTATION_GUARD_QUERY'
];
for (const name of expected) {
  if (!(name in mod)) fail(`dist/pixi entry lacks export ${name}`);
}

const types = readFileSync(pixiTypes, 'utf-8');
for (const name of ['LevelMapView', 'HudView', 'ResultWindowView', 'ReadyUiTextures', 'ClickRippleEffect', 'createReadyUiOverlay', 'ReadyUiOverlayOptions', 'createOrientationGuard', 'OrientationGuardOptions']) {
  if (!types.includes(name)) fail(`${pixiExport.types} lacks ${name}`);
}
// the kit's declarations import the foundation types relatively; they must ship next to them
for (const rel of ['dist/pixi/index.d.ts', 'dist/pixi/ui/types.d.ts', 'dist/pixi/motion/types.d.ts', 'dist/pixi/pixi/LevelMapView.d.ts', 'dist/pixi/pixi/fx/ClickRippleEffect.d.ts', 'dist/pixi/pixi/ReadyUiOverlay.d.ts', 'dist/pixi/pixi/OrientationGuard.d.ts']) {
  if (!existsSync(resolve(rootDir, rel))) fail(`missing declaration ${rel}`);
}

const assetsDir = resolve(rootDir, 'assets/pixi-ui');
for (const rel of Object.values(mod.READY_UI_ASSET_FILES)) {
  if (!existsSync(resolve(assetsDir, rel))) fail(`asset missing on disk: assets/pixi-ui/${rel}`);
}
if (!existsSync(resolve(assetsDir, mod.READY_UI_FONT_FILE))) fail('font missing on disk');

console.log(`check-pixi-build: OK (${expected.length} exports, ${Object.keys(mod.READY_UI_ASSET_FILES).length} assets, pixi.js external)`);
