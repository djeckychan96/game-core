// Post-build boundary check for the platform adapter entries (`game-core/platform/yandex`,
// `game-core/platform/cleverapps`):
//  - each adapter bundle exists, carries only its integration and exposes the documented API;
//  - it duplicates NO root runtime (it knows the root as types only) and no renderer;
//  - the ROOT bundle and the kit stay free of the adapter and of every SDK name — the root guard of
//    check-pixi-build.mjs is not relaxed, this only adds to it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  console.error(`check-platform-build: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
const entry = pkg.exports?.['./platform/yandex'];
if (!entry?.types || !entry?.import) fail('package.json lacks the "./platform/yandex" export');
const cleverEntry = pkg.exports?.['./platform/cleverapps'];
if (!cleverEntry?.types || !cleverEntry?.import) fail('package.json lacks the "./platform/cleverapps" export');
const yandexBundle = resolve(rootDir, entry.import);
if (yandexBundle !== resolve(rootDir, 'dist/platform/yandex/game-core-platform-yandex.es.js')) fail('"./platform/yandex" import path drifted');
const yandexTypes = resolve(rootDir, entry.types);
const cleverBundle = resolve(rootDir, cleverEntry.import);
if (cleverBundle !== resolve(rootDir, 'dist/platform/cleverapps/game-core-platform-cleverapps.es.js')) fail('"./platform/cleverapps" import path drifted');
const cleverTypes = resolve(rootDir, cleverEntry.types);
const coreBundle = resolve(rootDir, 'dist/game-core.es.js');
const coreIife = resolve(rootDir, 'dist/game-core.iife.js');
const pixiBundle = resolve(rootDir, 'dist/pixi/game-core-pixi.es.js');
for (const file of [yandexBundle, yandexTypes, cleverBundle, cleverTypes, coreBundle, coreIife, pixiBundle]) if (!existsSync(file)) fail(`missing ${file}`);

const yandexSource = readFileSync(yandexBundle, 'utf-8');
// the adapter is allowed — and expected — to name its SDK
for (const name of ['YaGames', 'showFullscreenAdv', 'showRewardedVideo', 'getPayments', 'consumePurchase', 'getPurchases', 'sdk_timeout:']) {
  if (!yandexSource.includes(name)) fail(`the Yandex bundle lacks ${name}`);
}
if (/^\s*import\s/m.test(yandexSource)) fail('the Yandex bundle has a runtime import — it must be self-contained and know the root as types only');
if (/pixi|PlatformRuntime|PlatformCatalog|PurchaseRuntime|AdsRuntime|AnalyticsRuntime|OfferRuntime|createDevPlatform|registerShown/.test(yandexSource)) {
  fail('the Yandex bundle contains root runtime / renderer code');
}
if (/FBInstant|GSInstant|vkBridge|onConnectorInit|CONNECTOR_CONFIG|localStorage/.test(yandexSource)) fail('the Yandex bundle references another platform or localStorage');
if (/eyJ[A-Za-z0-9_-]{10,}\./.test(yandexSource)) fail('the Yandex bundle contains something that looks like a JWT');

const cleverSource = readFileSync(cleverBundle, 'utf-8');
for (const name of ['onConnectorInit', 'showRewardedVideo', 'rewarded:reward', 'gcStorageVersion', 'startGame', 'cleverapps_init']) {
  if (!cleverSource.includes(name)) fail(`the CleverApps bundle lacks ${name}`);
}
if (/^\s*import\s/m.test(cleverSource)) fail('the CleverApps bundle has a runtime import — it must be self-contained and know the root as types only');
if (/pixi|PlatformRuntime|PlatformCatalog|PurchaseRuntime|AdsRuntime|AnalyticsRuntime|OfferRuntime|createDevPlatform|registerShown/.test(cleverSource)) {
  fail('the CleverApps bundle contains root runtime / renderer code');
}
if (/YaGames|showFullscreenAdv|getPayments|consumePurchase|getPurchases|FBInstant|GSInstant|vkBridge|localStorage/.test(cleverSource)) {
  fail('the CleverApps bundle references another platform or localStorage');
}
if (/appSecret|privateKey|serviceKey|secretKey|eyJ[A-Za-z0-9_-]{10,}\./i.test(cleverSource)) {
  fail('the CleverApps bundle contains secret-shaped code');
}

// the root boundary, for BOTH root formats and the kit: no adapter, no SDK name
const sdkNames = /YaGames|ysdk|__SDK_READY__|showFullscreenAdv|showRewardedVideo|getPayments|consumePurchase|getPurchases|YandexPlatform|createYandexPlatform|onConnectorInit|rewarded:reward|CleverAppsPlatform|createCleverAppsPlatform|cleverapps_init|gcStorageVersion|sdk_timeout|createAdWatchdog|documentVisibility/;
for (const [label, file] of [['root es', coreBundle], ['root iife', coreIife], ['pixi', pixiBundle]]) {
  const match = readFileSync(file, 'utf-8').match(sdkNames);
  if (match) fail(`${label} bundle references a platform adapter / SDK: "${match[0]}"`);
}

const mod = await import(pathToFileURL(yandexBundle).href);
const expected = [
  'YandexPlatform', 'createYandexPlatform', 'YANDEX_TIMEOUTS', 'YANDEX_NO_PLAYER', 'YANDEX_PLAYER_RETRY_ATTEMPTS', 'YANDEX_READ_ATTEMPTS',
  'YANDEX_LAUNCH_PAYLOAD_MAX', 'initYandexSdk', 'waitForYandexScript', 'documentVisibility', 'AD_WATCHDOG_QUIET_MS', 'AD_WATCHDOG_HARD_MS'
];
for (const name of expected) if (!(name in mod)) fail(`the Yandex entry lacks export ${name}`);
const surplus = Object.keys(mod).filter((name) => !expected.includes(name));
if (surplus.length > 0) fail(`the Yandex entry exports more than documented: ${surplus.join(', ')}`);

const cleverMod = await import(pathToFileURL(cleverBundle).href);
const cleverExpected = [
  'AD_WATCHDOG_HARD_MS', 'AD_WATCHDOG_QUIET_MS', 'CLEVERAPPS_STORAGE_VERSION', 'CLEVERAPPS_TIMEOUTS',
  'CleverAppsPlatform', 'createCleverAppsPlatform', 'documentVisibility', 'initCleverAppsConnector', 'waitForCleverAppsConnector'
];
for (const name of cleverExpected) if (!(name in cleverMod)) fail(`the CleverApps entry lacks export ${name}`);
const cleverSurplus = Object.keys(cleverMod).filter((name) => !cleverExpected.includes(name));
if (cleverSurplus.length > 0) fail(`the CleverApps entry exports more than documented: ${cleverSurplus.join(', ')}`);

const types = readFileSync(yandexTypes, 'utf-8');
for (const name of ['YandexPlatform', 'createYandexPlatform', 'YandexPlatformOptions', 'YandexAdHooks', 'YandexSdk', 'PlatformTimers', 'PlatformVisibility']) {
  if (!types.includes(name)) fail(`${entry.types} lacks ${name}`);
}
// the entry's declarations import the contract relatively; it must ship next to them
for (const rel of ['platform/adapters/yandex/YandexPlatform.d.ts', 'platform/adapters/yandex/sdk.d.ts', 'platform/types.d.ts', 'platform/support/adWatchdog.d.ts', 'platform/support/withTimeout.d.ts', 'purchases/types.d.ts']) {
  if (!existsSync(resolve(rootDir, 'dist/platform/yandex', rel))) fail(`missing declaration dist/platform/yandex/${rel}`);
}
if (existsSync(resolve(rootDir, 'dist/platform/yandex/platform/adapters/cleverapps'))) fail('the Yandex declarations contain the CleverApps adapter');

const cleverTypesSource = readFileSync(cleverTypes, 'utf-8');
for (const name of ['CleverAppsPlatform', 'createCleverAppsPlatform', 'CleverAppsPlatformOptions', 'CleverAppsConnector', 'PlatformTimers', 'PlatformVisibility']) {
  if (!cleverTypesSource.includes(name)) fail(`${cleverEntry.types} lacks ${name}`);
}
for (const rel of ['platform/adapters/cleverapps/CleverAppsPlatform.d.ts', 'platform/adapters/cleverapps/sdk.d.ts', 'platform/types.d.ts', 'platform/support/adWatchdog.d.ts', 'platform/support/withTimeout.d.ts', 'purchases/types.d.ts']) {
  if (!existsSync(resolve(rootDir, 'dist/platform/cleverapps', rel))) fail(`missing declaration dist/platform/cleverapps/${rel}`);
}
if (existsSync(resolve(rootDir, 'dist/platform/cleverapps/platform/adapters/yandex'))) fail('the CleverApps declarations contain the Yandex adapter');

console.log(`check-platform-build: OK (yandex: ${expected.length} exports, ${(yandexSource.length / 1024).toFixed(1)} kB; cleverapps: ${cleverExpected.length} exports, ${(cleverSource.length / 1024).toFixed(1)} kB; self-contained; root + kit mutually isolated)`);
