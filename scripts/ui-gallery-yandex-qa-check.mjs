#!/usr/bin/env node
// Proof of the Yandex QA gallery zip (node scripts/build-ui-gallery-static.mjs --yandex): the UNZIPPED package under a
// sub-path (like the Yandex archive hosting), served by a plain static server with /sdk.js at the origin root either
// missing (local QA mode) or a fake YaGames that records the call order and every SDK property the page reads.
// Installed Google Chrome + SwiftShader (the in-app browser has no WebGL).
//
//   node scripts/ui-gallery-yandex-qa-check.mjs [release/game-core-UI-GALLERY-YANDEX-QA-<sha>.zip]
//   env SHOTS=<dir> keeps a screenshot per style × screen × locale
//
// Fails on: ready() before the gallery finished or more/less than once, init after the gallery started, an SDK use other
// than init / environment.i18n.lang / LoadingAPI.ready, a console error or warning (except the expected /sdk.js 404 of
// local mode and the expected init failure), a request outside the package folder (other than /sdk.js), a window that
// does not open.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = path.resolve(process.argv[2] ?? (() => {
  const found = fs.readdirSync(path.join(ROOT, 'release')).filter((f) => /^game-core-UI-GALLERY-YANDEX-QA-.*\.zip$/.test(f));
  if (found.length !== 1) throw new Error(`pass the zip: release/ has ${found.length} Yandex QA zips`);
  return path.join(ROOT, 'release', found[0]);
})());
const SCREENS = ['map', 'map-disabled', 'settings-map', 'settings-map-lang', 'settings-level', 'settings-level-lang', 'restart', 'restart-offer', 'exit', 'lives-minimal', 'lives', 'lives-full', 'win', 'fail', 'shop'];
const FOLDER = '/games/app-qa/draft-1/'; // the package lives below the origin root, /sdk.js at the root
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
// headless SwiftShader noise, not the page
const NOISE = /GPU stall due to ReadPixels|GL Driver Message|favicon/;

// --- the package, unzipped, and the host ---
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'yandex-qa-'));
const dir = path.join(site, FOLDER);
fs.mkdirSync(dir, { recursive: true });
execFileSync('unzip', ['-q', zip, '-d', dir]);
if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('no index.html at the zip root');

const sdk = { mode: 'missing', lang: 'ru', init: 'resolve' };
const fakeSdk = () => `(() => {
  const qa = (window.__fakeYa = { events: [], accessed: [] });
  const event = (name) => qa.events.push({
    name, at: performance.now(),
    galleryStarted: (document.getElementById('screen')?.options.length ?? 0) > 0,
    galleryReady: window.__gallery?.ready === true,
    viewState: window.__gallery ? (window.__gallery.view ? window.__gallery.view.state : 'none') : null,
    locale: document.documentElement.lang
  });
  const track = (target, prefix) => new Proxy(target, { get(object, key) { if (typeof key === 'string' && key !== 'then') qa.accessed.push(prefix + key); return object[key]; } });
  const ysdk = track({
    environment: track({ i18n: track({ lang: ${JSON.stringify(sdk.lang)}, tld: 'ru' }, 'environment.i18n.') }, 'environment.'),
    features: track({ LoadingAPI: track({ ready() { event('ready'); } }, 'features.LoadingAPI.') }, 'features.')
  }, 'ysdk.');
  event('sdk-script');
  window.YaGames = { init() {
    event('init-called');
    return new Promise((resolve, reject) => setTimeout(() => {
      event('init-settled');
      ${sdk.init === 'reject' ? "reject(new Error('fake init failure'));" : 'resolve(ysdk);'}
    }, 150));
  } };
})();`;
const TYPES = { html: 'text/html', js: 'text/javascript', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', txt: 'text/plain' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/sdk.js') {
    if (sdk.mode === 'missing') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(fakeSdk());
    return;
  }
  let file = path.join(site, decodeURIComponent(url.pathname));
  if (file.endsWith('/')) file += 'index.html';
  if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}${FOLDER}`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const log = { console: [], errors: [], requests: [] };
page.on('console', (msg) => {
  if (NOISE.test(msg.text())) return;
  log.console.push({ type: msg.type(), text: msg.text(), url: msg.location()?.url ?? '' });
});
page.on('pageerror', (error) => log.errors.push(String(error)));
page.on('request', (req) => log.requests.push(req.url()));
const failures = [];
const check = (ok, label) => { if (!ok) failures.push(label); return ok; };
let runs = 0;

const reset = () => { log.console.length = 0; log.errors.length = 0; log.requests.length = 0; };
/** One page load of the package; returns what the page and the fake SDK recorded. */
async function open(query, label) {
  reset();
  await page.goto(`${base}${query}`);
  return settle(label);
}
async function settle(label) {
  runs += 1;
  try {
    await page.waitForFunction(() => window.__gallery?.ready === true && ['local', 'yandex', 'failed'].includes(window.__yandexQa?.mode)
      && (window.__yandexQa.mode !== 'yandex' || window.__yandexQa.steps.includes('ready')), null, { timeout: 90000 });
    await page.waitForFunction(() => !window.__gallery.view || window.__gallery.view.state === 'shown', null, { timeout: 60000 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  } catch (error) {
    failures.push(`${label}: did not start — ${error.message.split('\n')[0]}`);
    return null;
  }
  const state = await page.evaluate(() => ({
    qa: window.__yandexQa, fake: window.__fakeYa ?? null, url: location.href, locale: document.documentElement.lang,
    style: document.body.dataset.style, screen: window.__gallery.screenId, note: document.getElementById('note').textContent
  }));
  const outside = log.requests.filter((u) => !u.startsWith(base) && u !== `${origin}/sdk.js` && !/^(data|blob):/.test(u));
  check(outside.length === 0, `${label}: requests outside the package: ${outside.join(', ')}`);
  check(log.errors.length === 0, `${label}: page errors: ${log.errors.join(' | ')}`);
  return state;
}
// at ~1 fps under SwiftShader one shot can take 10–20 s: a slow shot is not a failed page, a missing one is reported
const shot = (file) => page.screenshot({ path: path.join(SHOTS, file), timeout: 120000 }).catch((error) => failures.push(`shot ${file}: ${error.message.split('\n')[0]}`));
const problems = (allowed) => log.console.filter((m) => (m.type === 'error' || m.type === 'warning') && !allowed(m));
const info = () => log.console.filter((m) => m.text.startsWith('[YandexQA]')).map((m) => `${m.type}:${m.text.split(' — ')[0]}`);
const sdk404 = (m) => m.type === 'error' && m.url === `${origin}/sdk.js` && /404/.test(m.text);

/** The fake-Yandex invariants of one load: init → gallery → ready, ready once, nothing else of the SDK touched. */
function yandexOrder(state, label, locale) {
  if (!state) return;
  const names = state.fake.events.map((e) => e.name);
  const at = (name) => state.fake.events.find((e) => e.name === name);
  check(JSON.stringify(names) === JSON.stringify(['sdk-script', 'init-called', 'init-settled', 'ready']), `${label}: SDK events ${names.join(' → ')}`);
  check(at('init-called') && !at('init-called').galleryStarted && !at('init-settled').galleryStarted, `${label}: the gallery started before YaGames.init() settled`);
  check(at('ready')?.galleryReady === true && at('ready')?.viewState !== null, `${label}: LoadingAPI.ready() before the gallery was ready`);
  check(JSON.stringify(state.qa.steps) === JSON.stringify(['init', 'lang', 'gallery', 'ready']) && state.qa.mode === 'yandex', `${label}: bootstrap steps ${state.qa.steps.join(' → ')} (${state.qa.mode})`);
  const allowed = ['ysdk.environment', 'environment.i18n', 'environment.i18n.lang', 'ysdk.features', 'features.LoadingAPI', 'features.LoadingAPI.ready'];
  const other = [...new Set(state.fake.accessed)].filter((key) => !allowed.includes(key));
  check(other.length === 0, `${label}: SDK use beyond init/lang/ready: ${other.join(', ')}`);
  check(state.fake.accessed.includes('environment.i18n.lang'), `${label}: environment.i18n.lang not read`);
  check(state.locale === locale && new URL(state.url).searchParams.get('locale') === locale, `${label}: locale ${state.locale} / url ${state.url}, expected ${locale}`);
  const lines = info();
  check(JSON.stringify(lines) === JSON.stringify(['info:[YandexQA] SDK initialized', 'info:[YandexQA] LoadingAPI.ready sent']), `${label}: console lines ${lines.join(' | ')}`);
  const bad = problems(() => false);
  check(bad.length === 0, `${label}: console ${bad.map((m) => `${m.type}: ${m.text}`).join(' | ')}`);
}

// 1. local fallback: no /sdk.js → the gallery as is, a console info line, no ready() to send
sdk.mode = 'missing';
for (const [query, locale] of [['', 'en'], ['?locale=ru&style=2&screen=lives-full', 'ru']]) {
  const label = `local ${query || '(no query)'}`;
  const state = await open(query, label);
  if (!state) continue;
  check(state.qa.mode === 'local' && JSON.stringify(state.qa.steps) === JSON.stringify(['gallery']), `${label}: bootstrap ${state.qa.mode} ${state.qa.steps.join(',')}`);
  check(state.fake === null, `${label}: a YaGames exists`);
  check(state.locale === locale, `${label}: locale ${state.locale}`);
  check(JSON.stringify(info()) === JSON.stringify(['info:[YandexQA] Yandex SDK not available (/sdk.js)']), `${label}: console lines ${info().join(' | ')}`);
  const bad = problems(sdk404);
  check(bad.length === 0, `${label}: console ${bad.map((m) => `${m.type}: ${m.text}`).join(' | ')}`);
  console.log(`${label}: mode=${state.qa.mode} locale=${state.locale} — expected console: ${log.console.filter(sdk404).length} × /sdk.js 404`);
}

// 2. Yandex: the platform language when the URL has none; the gallery's own ?locale= wins
sdk.mode = 'fake';
for (const [lang, query, locale] of [['ru', '', 'ru'], ['en', '', 'en'], ['tr', '', 'en'], ['ru', '?locale=en', 'en'], ['en', '?locale=ru', 'ru']]) {
  sdk.lang = lang;
  const label = `yandex lang=${lang} ${query || '(no query)'}`;
  const state = await open(query, label);
  yandexOrder(state, label, locale);
  if (state) {
    const events = Object.fromEntries(state.fake.events.map((e) => [e.name, Math.round(e.at)]));
    console.log(`${label}: locale=${state.locale} ${Object.entries(events).map(([k, v]) => `${k}@${v}ms`).join(' → ')}`);
  }
}

// 3. init failure: the gallery still runs (local QA mode), the bootstrap reports it, no ready()
sdk.lang = 'ru'; sdk.init = 'reject';
{
  const label = 'yandex init rejects';
  const state = await open('', label);
  if (state) {
    check(state.qa.mode === 'local' && JSON.stringify(state.qa.steps) === JSON.stringify(['gallery']), `${label}: bootstrap ${state.qa.mode} ${state.qa.steps.join(',')}`);
    check(!state.fake.events.some((e) => e.name === 'ready'), `${label}: ready() sent`);
    const bad = problems((m) => m.type === 'error' && m.text.startsWith('[YandexQA] YaGames.init() failed'));
    check(bad.length === 0 && info().length === 1, `${label}: console ${log.console.map((m) => `${m.type}: ${m.text}`).join(' | ')}`);
    console.log(`${label}: mode=${state.qa.mode}, gallery up, expected console.error = the init failure`);
  }
}
sdk.init = 'resolve';

// 4. every gallery screen, Style 1 and Style 2, RU (platform language) and EN (the gallery's control), on fake Yandex
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let screens = 0;
for (const [lang, query, locale] of [['ru', '', 'ru'], ['ru', 'locale=en&', 'en']]) {
  sdk.lang = lang;
  for (const style of ['1', '2']) {
    for (const screen of SCREENS) {
      const label = `yandex style=${style} screen=${screen} ${locale}`;
      const state = await open(`?${query}style=${style}&screen=${screen}`, label);
      yandexOrder(state, label, locale);
      if (!state) continue;
      check(state.style === style && state.screen === screen, `${label}: shows style ${state.style} screen ${state.screen}`);
      screens += 1;
      if (SHOTS) await shot(`${style}-${screen}-${locale}.png`);
    }
  }
}

// 5. the gallery's own controls under Yandex: each reload initialises the SDK again and keeps the language
sdk.lang = 'ru';
{
  let state = await open('', 'controls start');
  yandexOrder(state, 'controls start', 'ru');
  reset();
  await Promise.all([page.waitForNavigation(), page.click('button[data-style="2"]')]);
  state = await settle('controls → Style 2');
  yandexOrder(state, 'controls → Style 2', 'ru');
  check(state?.style === '2', `controls → Style 2: style ${state?.style}`);
  reset();
  await Promise.all([page.waitForNavigation(), page.selectOption('#screen', 'settings-map-lang')]);
  state = await settle('controls → Settings');
  yandexOrder(state, 'controls → Settings', 'ru');
  check(state?.screen === 'settings-map-lang' && state?.style === '2', `controls → Settings: ${state?.style}/${state?.screen}`);
  reset();
  await Promise.all([page.waitForNavigation(), page.selectOption('#locale', 'en')]);
  state = await settle('controls → EN');
  yandexOrder(state, 'controls → EN', 'en');
  console.log(`controls: Style 2 → Settings → EN, each reload: init → gallery → ready (${state?.url.replace(origin, '')})`);
}

// 6. desktop size, both styles
await page.setViewportSize({ width: 1280, height: 800 });
for (const style of ['1', '2']) {
  const label = `yandex desktop style=${style}`;
  const state = await open(`?style=${style}`, label);
  yandexOrder(state, label, 'ru');
  if (SHOTS && state) await shot(`${style}-map-ru-1280x800.png`);
}

// browser.close() can hang here after shots: never let it hold the verdict
await Promise.race([browser.close().catch(() => {}), new Promise((done) => setTimeout(done, 15000))]);
server.close();
fs.rmSync(site, { recursive: true, force: true });
console.log(`ui-gallery-yandex-qa: ${runs} loads, ${screens}/${SCREENS.length * 4} gallery screens on fake Yandex — ${path.relative(ROOT, zip)}`);
if (failures.length) {
  console.error(`FAIL (${failures.length})\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('OK');
process.exit(0);
