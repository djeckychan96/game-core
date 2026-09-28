// Post-build boundary check for the QA entry (`game-core/qa`):
//  - the QA bundle exists, is self-contained (root as types only) and exposes the documented API;
//  - it patches nothing global (no fetch / XHR / timer / clock / rAF override), makes no request, has no storage;
//  - the ROOT bundles, the kit and the Yandex adapter carry NO QA marker — a production build that does not
//    import `game-core/qa` cannot reach the panel or the global (npm run qa:isolation proves it for a host build).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  console.error(`check-qa-build: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
const entry = pkg.exports?.['./qa'];
if (!entry?.types || !entry?.import) fail('package.json lacks the "./qa" export');
const qaBundle = resolve(rootDir, entry.import);
if (qaBundle !== resolve(rootDir, 'dist/qa/game-core-qa.es.js')) fail('"./qa" import path drifted');
const qaTypes = resolve(rootDir, entry.types);
const others = {
  'root es': resolve(rootDir, 'dist/game-core.es.js'),
  'root iife': resolve(rootDir, 'dist/game-core.iife.js'),
  pixi: resolve(rootDir, 'dist/pixi/game-core-pixi.es.js'),
  yandex: resolve(rootDir, 'dist/platform/yandex/game-core-platform-yandex.es.js')
};
for (const file of [qaBundle, qaTypes, ...Object.values(others)]) if (!existsSync(file)) fail(`missing ${file}`);

const qa = readFileSync(qaBundle, 'utf-8');
// the markers the isolation check greps for must really be in the QA bundle (a positive control)
export const QA_MARKERS = ['GameCoreQA', 'data-game-core-qa', 'Game Core QA', 'qa-lives-seam'];
for (const marker of QA_MARKERS) if (!qa.includes(marker)) fail(`the QA bundle lacks its marker "${marker}"`);
if (/^\s*import\s/m.test(qa)) fail('the QA bundle has a runtime import — it must be self-contained');
if (/pixi\.js|PlatformRuntime|PurchaseRuntime|AdsRuntime|AnalyticsRuntime|OfferRuntime|SaveGate\b|LivesRuntime|ContinueOfferRuntime|SoftCurrencyWallet/.test(qa.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  fail('the QA bundle contains root runtime or renderer code');
}
if (/(globalThis|window|self)\s*\.\s*(fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame|Date|performance)\s*=[^=]/.test(qa)) fail('the QA bundle overrides a global');
if (/\bfetch\s*\(|XMLHttpRequest|requestAnimationFrame\s*\(|setInterval\s*\(|localStorage|sessionStorage|ResizeObserver/.test(qa)) fail('the QA bundle makes a request, runs a frame loop / interval or touches storage');
if (/eyJ[A-Za-z0-9_-]{10,}\./.test(qa)) fail('the QA bundle contains something that looks like a JWT');

for (const [label, file] of Object.entries(others)) {
  const source = readFileSync(file, 'utf-8');
  const hit = [...QA_MARKERS, 'installGameCoreQA', 'NetworkFaultProfile', 'withNetworkFaults'].find((marker) => source.includes(marker));
  if (hit) fail(`${label} bundle contains the QA marker "${hit}" — QA code must live only in game-core/qa`);
}

const mod = await import(pathToFileURL(qaBundle).href);
const expected = [
  'installGameCoreQA', 'QA_GLOBAL_NAME', 'QaRuntime', 'QaPanelView', 'QA_PANEL_ATTRIBUTE', 'QA_RESET_KINDS', 'QA_RESET_LABELS', 'QA_TIME_SCALES', 'QA_SAMPLE_WINDOW_MS',
  'NetworkFaultProfile', 'NetworkFaultError', 'withNetworkFaults', 'isNetworkFault', 'NETWORK_FAULT_MODES', 'DEFAULT_QA_LATENCY_MS', 'toQaJson',
  'setQaLives', 'createLivesQaCapability', 'QA_LIVES_SOURCE', 'QaMetricsOverlayView', 'QA_METRICS_ATTRIBUTE', 'formatMiniMetrics'
];
for (const name of expected) if (!(name in mod)) fail(`the QA entry lacks export ${name}`);
const surplus = Object.keys(mod).filter((name) => !expected.includes(name));
if (surplus.length > 0) fail(`the QA entry exports more than documented: ${surplus.join(', ')}`);
if ('GameCoreQA' in globalThis) fail('importing the QA entry installed a global by itself');

const types = readFileSync(qaTypes, 'utf-8');
for (const name of ['installGameCoreQA', 'GameCoreQA', 'QaState', 'QaResult', 'QaCapability']) if (!types.includes(name)) fail(`${entry.types} lacks ${name}`);

console.log(`check-qa-build: OK (qa: ${expected.length} exports, ${(qa.length / 1024).toFixed(1)} kB, self-contained, no global patch; root / kit / yandex carry no QA marker)`);
