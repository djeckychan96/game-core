// Post-build boundary check for the platform adapter entries (`game-core/platform/yandex`):
//  - the adapter bundle exists, carries the Yandex integration and exposes the documented API;
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
const yandexBundle = resolve(rootDir, entry.import);
if (yandexBundle !== resolve(rootDir, 'dist/platform/yandex/game-core-platform-yandex.es.js')) fail('"./platform/yandex" import path drifted');
const yandexTypes = resolve(rootDir, entry.types);
const coreBundle = resolve(rootDir, 'dist/game-core.es.js');
const coreIife = resolve(rootDir, 'dist/game-core.iife.js');
const pixiBundle = resolve(rootDir, 'dist/pixi/game-core-pixi.es.js');
for (const file of [yandexBundle, yandexTypes, coreBundle, coreIife, pixiBundle]) if (!existsSync(file)) fail(`missing ${file}`);

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

// the root boundary, for BOTH root formats and the kit: no adapter, no SDK name
const sdkNames = /YaGames|ysdk|__SDK_READY__|showFullscreenAdv|showRewardedVideo|getPayments|consumePurchase|getPurchases|YandexPlatform|createYandexPlatform|sdk_timeout|createAdWatchdog|documentVisibility/;
for (const [label, file] of [['root es', coreBundle], ['root iife', coreIife], ['pixi', pixiBundle]]) {
  const match = readFileSync(file, 'utf-8').match(sdkNames);
  if (match) fail(`${label} bundle references the Yandex adapter / SDK: "${match[0]}"`);
}

const mod = await import(pathToFileURL(yandexBundle).href);
const expected = [
  'YandexPlatform', 'createYandexPlatform', 'YANDEX_TIMEOUTS', 'YANDEX_NO_PLAYER', 'YANDEX_PLAYER_RETRY_ATTEMPTS', 'YANDEX_READ_ATTEMPTS',
  'YANDEX_LAUNCH_PAYLOAD_MAX', 'initYandexSdk', 'waitForYandexScript', 'documentVisibility', 'AD_WATCHDOG_QUIET_MS', 'AD_WATCHDOG_HARD_MS'
];
for (const name of expected) if (!(name in mod)) fail(`the Yandex entry lacks export ${name}`);
const surplus = Object.keys(mod).filter((name) => !expected.includes(name));
if (surplus.length > 0) fail(`the Yandex entry exports more than documented: ${surplus.join(', ')}`);

const types = readFileSync(yandexTypes, 'utf-8');
for (const name of ['YandexPlatform', 'createYandexPlatform', 'YandexPlatformOptions', 'YandexAdHooks', 'YandexSdk', 'PlatformTimers', 'PlatformVisibility']) {
  if (!types.includes(name)) fail(`${entry.types} lacks ${name}`);
}
// the entry's declarations import the contract relatively; it must ship next to them
for (const rel of ['platform/adapters/yandex/YandexPlatform.d.ts', 'platform/adapters/yandex/sdk.d.ts', 'platform/types.d.ts', 'platform/support/adWatchdog.d.ts', 'platform/support/withTimeout.d.ts', 'purchases/types.d.ts']) {
  if (!existsSync(resolve(rootDir, 'dist/platform/yandex', rel))) fail(`missing declaration dist/platform/yandex/${rel}`);
}

console.log(`check-platform-build: OK (yandex: ${expected.length} exports, ${(yandexSource.length / 1024).toFixed(1)} kB, self-contained; root + kit free of the SDK)`);
