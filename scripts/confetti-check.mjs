// WIN confetti proof for ResultWindowView, with Playwright on the installed Google Chrome (the sandboxed in-app
// browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase:confetti                                    (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:confetti   (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/confetti.html. Writes showcase-shots/win-confetti/ (git-ignored):
//   1. per viewport (390 × 844 touch → tier mobile, 1280 × 800 mouse → tier desktop): a capture near the peak of the
//      effect (the host clock held on that frame), stats after warm-up (the first run, played to its end);
//   2. 10 replay / open-close cycles through real input: the DOM "Replay WIN" button opens, CONTINUE / × / the
//      backdrop close mid-run (input goes through the confetti); stats + scene node count after each cycle;
//      created must not grow, and after every close active = 0 and pooled = created;
//   3. the default path (?confetti=0, the main showcase) never requests the fx textures; the confetti page requests
//      exactly the two.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/win-confetti');
mkdirSync(outDir, { recursive: true });
const FX_FILES = ['fx/spark_star.webp', 'fx/glow_soft.webp'];
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 90000; // SwiftShader: waits synchronize on state, never on a sleep
const fail = (message) => { throw new Error(message); };

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844, dpr: 2, touch: true, tier: 'mobile' },
  { name: 'desktop-1280x800', width: 1280, height: 800, dpr: 1, touch: false, tier: 'desktop' }
];

async function openPage(browser, base, vp, query, video) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, hasTouch: vp.touch, isMobile: vp.touch,
    ...(video ? { recordVideo: { dir: outDir, size: { width: vp.width, height: vp.height } } } : {})
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED_CONSOLE.some((r) => r.test(msg.text()))) errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (req) => requests.push(req.url()));
  await page.goto(new URL(query, base).href);
  return { context, page, errors, requests };
}

const stats = (page) => page.evaluate(() => window.__confetti.stats());
const waitState = (page, state) => page.waitForFunction((s) => window.__confetti.state() === s, state, { timeout: WAIT_MS });

async function tapAt(page, vp, point) {
  if (vp.touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function runViewport(browser, base, vp) {
  // RECORD_VIDEO=1: a mobile video too (needs Playwright's ffmpeg, not installed here by default)
  const { context, page, errors, requests } = await openPage(browser, base, vp, `confetti.html?seed=7`, vp.touch && process.env.RECORD_VIDEO === '1');
  await page.waitForFunction(() => Boolean(window.__confetti), null, { timeout: WAIT_MS });
  const tier = await page.evaluate(() => window.__confetti.tier);
  if (tier !== vp.tier) fail(`${vp.name}: tier ${tier}, expected ${vp.tier}`);
  const fxRequested = FX_FILES.filter((f) => requests.some((u) => u.endsWith(`/pixi-ui/${f}`)));
  if (fxRequested.length !== 2) fail(`${vp.name}: confetti page requested ${fxRequested.join(', ') || 'no'} fx files`);

  // 1. peak capture: hold the host clock once the run is past its densest point
  await page.waitForFunction(() => window.__confetti.stats().elapsedMs >= 1250, null, { timeout: WAIT_MS });
  await page.evaluate(() => window.__confetti.hold(true));
  const atPeak = await stats(page);
  await page.screenshot({ path: resolve(outDir, `${vp.name}-peak.png`) });
  await page.evaluate(() => window.__confetti.hold(false));

  // warm-up: the first run plays to its end on its own
  await page.waitForFunction(() => { const s = window.__confetti.stats(); return s.completed === 1 && !s.running; }, null, { timeout: WAIT_MS });
  const warm = await stats(page);
  if (warm.active !== 0 || warm.pooled !== warm.created) fail(`${vp.name}: after the first run active ${warm.active}, pooled ${warm.pooled}/${warm.created}`);
  const warmNodes = await page.evaluate(() => window.__confetti.nodes());
  await page.screenshot({ path: resolve(outDir, `${vp.name}-after-run.png`) });

  // 2. ten replay / open-close cycles through real input
  const cycles = [];
  const closers = ['nextButton', 'closeButton', 'backdrop'];
  for (let cycle = 1; cycle <= 10; cycle++) {
    const closer = closers[(cycle - 1) % closers.length];
    const eventsBefore = await page.evaluate(() => window.__confetti.events.length);
    await page.click('#replay'); // shows now, or closes the open Result and shows it right after
    await page.waitForFunction(() => { const s = window.__confetti.stats(); return window.__confetti.state() === 'shown' && s.running && s.active > 0; }, null, { timeout: WAIT_MS });
    const during = await stats(page);
    const point = closer === 'backdrop' ? { x: 4, y: vp.height / 2 } : await page.evaluate((n) => window.__confetti.tapPoint(n), closer);
    await tapAt(page, vp, point);
    await waitState(page, 'hidden');
    const after = await stats(page);
    const events = await page.evaluate((n) => window.__confetti.events.slice(n), eventsBefore);
    const nodes = await page.evaluate(() => window.__confetti.nodes());
    const motion = await page.evaluate(() => window.__confetti.motion());
    const expected = closer === 'nextButton' ? 'next' : closer === 'closeButton' ? 'dismiss:button' : 'dismiss:background';
    if (!events.includes(expected)) fail(`${vp.name} cycle ${cycle}: ${closer} gave events ${JSON.stringify(events)}, expected ${expected}`);
    if (after.active !== 0 || after.pooled !== after.created || after.running) fail(`${vp.name} cycle ${cycle}: after close ${JSON.stringify(after)}`);
    if (after.created !== warm.created) fail(`${vp.name} cycle ${cycle}: created grew ${warm.created} → ${after.created}`);
    if (nodes !== warmNodes) fail(`${vp.name} cycle ${cycle}: scene nodes ${warmNodes} → ${nodes}`);
    cycles.push({ cycle, closer, events, activeDuring: during.active, elapsedAtClose: Math.round(during.elapsedMs), after, nodes, activeMotions: motion.activeMotions });
  }
  const final = cycles[cycles.length - 1].after;
  if (final.plays !== 11) fail(`${vp.name}: plays ${final.plays}, expected 11 (warm-up + 10 cycles)`);
  await page.screenshot({ path: resolve(outDir, `${vp.name}-after-cycle-10.png`) });

  // 3. FAIL draws nothing
  await page.click('#fail');
  await waitState(page, 'shown'); // the 440 ms entrance is over: a run would have drawn its first burst at 280 ms
  const failStats = await stats(page);
  if (failStats.active !== 0 || failStats.running || failStats.plays !== 11) fail(`${vp.name}: FAIL started confetti ${JSON.stringify(failStats)}`);
  await page.screenshot({ path: resolve(outDir, `${vp.name}-fail.png`) });

  if (errors.length) fail(`${vp.name}: console errors ${JSON.stringify(errors)}`);
  const video = page.video();
  await context.close();
  return { viewport: vp.name, tier, atPeak, warmUp: warm, warmNodes, cycles, final, fail: failStats, video: video ? await video.path() : null };
}

async function defaultPath(browser, base) {
  const vp = VIEWPORTS[0];
  const out = {};
  for (const [name, query, ready] of [
    ['confetti=0', 'confetti.html?confetti=0', () => window.__confetti && window.__confetti.state() === 'shown'],
    ['main showcase', 'index.html', () => Boolean(window.__showcase)]
  ]) {
    const { context, page, errors, requests } = await openPage(browser, base, vp, query, false);
    await page.waitForFunction(ready, null, { timeout: WAIT_MS });
    await page.waitForLoadState('networkidle');
    const fx = requests.filter((u) => FX_FILES.some((f) => u.endsWith(f)));
    if (fx.length) fail(`${name}: requested ${fx.join(', ')}`);
    if (name === 'confetti=0') {
      const s = await page.evaluate(() => window.__confetti.stats());
      if (s.created !== 0) fail(`confetti=0: an effect exists ${JSON.stringify(s)}`);
      await page.screenshot({ path: resolve(outDir, 'mobile-390x844-confetti-off.png') });
    }
    if (errors.length) fail(`${name}: console errors ${JSON.stringify(errors)}`);
    out[name] = { fxRequests: fx.length, pixiUiRequests: requests.filter((u) => u.includes('/pixi-ui/')).length };
    await context.close();
  }
  return out;
}

async function run(base) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  try {
    const viewports = [];
    for (const vp of VIEWPORTS) viewports.push(await runViewport(browser, base, vp));
    const defaults = await defaultPath(browser, base);
    const report = { base, viewports, defaultPath: defaults };
    writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
    for (const v of viewports) {
      const pick = (s) => ({ created: s.created, active: s.active, pooled: s.pooled, peakActive: s.peakActive });
      console.log(`${v.viewport} tier ${v.tier}: peak-shot ${JSON.stringify(pick(v.atPeak))} warm-up ${JSON.stringify(pick(v.warmUp))} cycle 10 ${JSON.stringify(pick(v.final))} plays ${v.final.plays} nodes ${v.warmNodes}→${v.cycles[9].nodes}`);
    }
    console.log(`default path: ${JSON.stringify(defaults)}`);
    console.log(`confetti-check: OK → ${outDir}`);
  } finally {
    await browser.close();
  }
}

let server = null;
let url = process.env.SHOWCASE_URL;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5193, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  await run(url);
} finally {
  await server?.close();
}
