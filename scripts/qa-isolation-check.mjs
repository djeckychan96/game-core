// Proof of absence: the QA tooling is physically NOT in a production build.
// examples/qa-isolation/main.ts is built twice with Vite — the QA build (__QA_BUILD__ = true) and the production
// build (false) — and each artifact is checked statically and in the installed Chrome:
//   QA build   → a QA chunk carrying the QA markers; window.GameCoreQA exists, ready() settles, commands work, the panel opens;
//   production → no file carries any QA marker, only the entry chunk exists, window.GameCoreQA === undefined, no panel,
//                no QA request. The QA build's markers are the positive control that the grep really finds them.
//   npm run qa:isolation          (artifacts in dist-qa-isolation/{qa,production})
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostDir = resolve(rootDir, 'examples/qa-isolation');
const outRoot = resolve(rootDir, 'dist-qa-isolation');
const MARKERS = ['GameCoreQA', 'data-game-core-qa', 'Game Core QA', 'installGameCoreQA', 'NetworkFault', 'withNetworkFaults', 'game-core/qa'];
const fail = (message) => {
  throw new Error(`qa-isolation-check: ${message}`);
};

const config = (qa) => ({
  configFile: false,
  root: hostDir,
  base: './',
  logLevel: 'error',
  resolve: { alias: [{ find: 'game-core/qa', replacement: resolve(rootDir, 'src/qa/index.ts') }] },
  define: { __QA_BUILD__: JSON.stringify(qa) },
  build: { outDir: resolve(outRoot, qa ? 'qa' : 'production'), emptyOutDir: true }
});

const files = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => resolve(e.parentPath ?? e.path, e.name));

async function inChrome(browser, qa) {
  const server = await preview({ ...config(qa), preview: { port: qa ? 5195 : 5196, strictPort: false, host: '127.0.0.1' } });
  const url = server.resolvedUrls.local[0];
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('app')?.textContent === 'game running');
    if (qa) {
      await page.waitForFunction(() => window.GameCoreQA !== undefined);
      const out = await page.evaluate(async () => {
        const booted = await window.GameCoreQA.ready();
        const set = await window.GameCoreQA.run('score.set', { value: 5 });
        window.GameCoreQA.open();
        return { ready: booted.ready, set, values: window.GameCoreQA.getState().values, panel: document.querySelector('[data-game-core-qa]') !== null };
      });
      if (!out.ready || !out.set.ok || out.values.score !== 5 || !out.panel) fail(`QA build: ${JSON.stringify(out)}`);
    } else {
      // the page is fully booted (the check above); nothing QA can appear later — the branch was compiled out
      const out = await page.evaluate(() => ({
        global: typeof window.GameCoreQA,
        panel: document.querySelector('[data-game-core-qa]') !== null,
        qaKeys: Object.keys(window).filter((key) => /qa/i.test(key))
      }));
      if (out.global !== 'undefined' || out.panel || out.qaKeys.length > 0) fail(`production build exposes QA: ${JSON.stringify(out)}`);
    }
    if (errors.length > 0) fail(`${qa ? 'QA' : 'production'} page errors: ${errors.join(' | ')}`);
    return requests.filter((path) => path.endsWith('.js'));
  } finally {
    await page.close();
    await new Promise((done) => server.httpServer.close(done));
  }
}

await build(config(true));
await build(config(false));

const report = {};
for (const qa of [true, false]) {
  const dir = resolve(outRoot, qa ? 'qa' : 'production');
  const js = files(dir).filter((file) => file.endsWith('.js'));
  const hits = js.flatMap((file) => MARKERS.filter((marker) => readFileSync(file, 'utf-8').includes(marker)).map((marker) => `${file.slice(dir.length + 1)}:${marker}`));
  if (qa && (js.length < 2 || !hits.some((hit) => hit.endsWith(':GameCoreQA')))) fail(`positive control failed: the QA build has ${js.length} chunks, markers ${hits.join(', ') || 'none'}`);
  if (!qa && (js.length !== 1 || hits.length > 0)) fail(`production build is not QA-free: ${js.length} chunks, markers ${hits.join(', ') || 'none'}`);
  report[qa ? 'qa' : 'production'] = { chunks: js.length, markers: hits.length, bytes: js.reduce((sum, file) => sum + readFileSync(file).length, 0) };
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
try {
  report.qa.loaded = await inChrome(browser, true);
  report.production.loaded = await inChrome(browser, false);
} finally {
  await browser.close();
}
if (report.production.loaded.length !== 1) fail(`production page loaded more than its entry: ${report.production.loaded.join(', ')}`);
console.log(`qa-isolation-check: QA build ${report.qa.chunks} chunks / ${report.qa.bytes} B, ${report.qa.markers} marker hits, GameCoreQA works, loaded ${report.qa.loaded.join(', ')}`);
console.log(`qa-isolation-check: production build ${report.production.chunks} chunk / ${report.production.bytes} B, 0 marker hits, GameCoreQA undefined, no panel, loaded ${report.production.loaded.join(', ')}`);
console.log('qa-isolation-check: OK');
