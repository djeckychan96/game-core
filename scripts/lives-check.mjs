// Figma Lives proof for LivesWindowView, with Playwright on the installed Google Chrome (the sandboxed in-app browser
// has no WebGL; Playwright's own Chromium is not downloaded). Same scheme as scripts/confirm-exit-check.mjs.
//
//   npm run showcase:lives                                    (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:lives   (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/lives.html. Source of truth: docs/figma/lives (figma.json + Figma's render of
// modal/lives). Writes showcase-shots/figma-lives/ (git-ignored):
//   1. parity — 1080 × 2344 @1x is the Figma frame at scale 1: the capture of the modal's render box is diffed against
//      the Figma render composited over the same flat colour; per region the mean difference and the best integer shift;
//      the page asked for exactly the ten LIVES_FIGMA_TEXTURES files and no other optional one;
//   2. shots — 390 × 844 @3 and 1280 × 800 @2 (EN + RU runtime copy), the full-lives and no-ad states, the donor default;
//   3. input — real clicks: REFILL → onRefill, the ad button → onWatchAd, the × → onDismiss('button');
//   4. assets — the donor page and the main showcase never request a Figma file; a missing one fails clearly.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const figmaDir = resolve(rootDir, 'docs/figma/lives');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/figma-lives');
mkdirSync(outDir, { recursive: true });
const figma = JSON.parse(readFileSync(resolve(figmaDir, 'figma.json'), 'utf8'));
const reference = readFileSync(resolve(figmaDir, figma.source.reference.file)).toString('base64');
const [REF_X, REF_Y] = figma.source.reference.origin; // the modal's render box in the screen: 56, 638
const PARITY_BG = [0x20, 0x24, 0x2c]; // body.parity in lives.html
// LIVES_FIGMA_TEXTURES → files (the three shared with confirm-exit + the seven Lives ones)
const LIVES_FILES = ['window/window_base@2x.webp', 'window/window_close@2x.webp', 'button/button_green@2x.webp', 'button/button_orange@2x.webp',
  'button/button_highlight@2x.webp', 'window/panel_inset@2x.webp', 'icons/lives_heart@2x.webp', 'icons/icon_coin@2x.webp', 'icons/icon_heart@2x.webp', 'icons/icon_ad@2x.webp'];
const OTHER_OPTIONAL = ['window/message_glow@0.5x.webp', 'icons/broken_heart@2x.webp', 'fx/spark_star.webp', 'fx/glow_soft.webp'];
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 60000; // SwiftShader: waits synchronize on state, never on a sleep
const fail = (message) => { throw new Error(message); };
const save = (name, dataUrl) => writeFileSync(resolve(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
const isOptional = (url, files) => files.some((file) => url.endsWith('/pixi-ui/' + file));

// Parity regions in capture coordinates (screen − 56, 638), from figma.json. `shift` = the allowed best integer shift:
// art and surfaces in place (0), runtime text within 1 px. `null` = reported, not enforced: Figma draws Fira Sans digits
// tabular (every digit 0.5625 em — "900" @64 = 108, "1" @150 = 84.4, the footed "1"), the kit font proportional ("900"
// = 114.3, "1" = 72.3), so a digit run differs in glyphs and width while its slot is right (tests/pixi/windows.test.ts).
const R = (x, y, w, h) => ({ x: x - REF_X, y: y - REF_Y, w, h });
const REGIONS = {
  window: { ...R(56, 638, 968, 1071), shift: 0 },
  headerBand: { ...R(56, 787, 968, 80), shift: 0 }, // the 9-slice seam under the header
  close: { ...R(923, 703, 51, 51), shift: 0 },
  insetCorner: { ...R(920, 1246, 70, 70), shift: 0 }, // the inner panel's 9-slice corner, no text
  heartLeft: { ...R(152, 981, 110, 298), shift: 0 }, // the heart beside its count
  count: { ...R(272, 1036, 84, 180), shift: null },
  nextLabel: { ...R(531, 1052, 442, 60), shift: 1 },
  timer: { ...R(531, 1115, 442, 84), shift: null },
  refillLip: { ...R(90, 1612, 371, 27), shift: 0 }, // the green surface below its content
  refillLabel: { ...R(112, 1438, 331, 84), shift: 1 },
  priceRow: { ...R(171, 1508, 209, 100), shift: null },
  adLip: { ...R(483, 1612, 507, 27), shift: 0 }, // the orange surface below its content
  highlight: { ...R(491, 1585, 300, 20), shift: 0 },
  adIcon: { ...R(511, 1448, 128, 134), shift: 0 },
  adLabel: { ...R(620, 1445, 233, 159), shift: 1 },
  rewardIconLeft: { ...R(819, 1448, 40, 154), shift: 0 }, // the heart icon beside its "+1"
  rewardLabel: { ...R(859, 1483, 68, 72), shift: null }
};

/** In the page: composite the Figma render over the parity colour, diff it against the capture, per region (same as confirm-exit-check). */
async function parityInPage({ core, ref, bg, regions }) {
  const load = async (src) => { const img = new Image(); img.src = src; await img.decode(); return img; };
  const [coreImg, refImg] = await Promise.all([load(core), load(ref)]);
  const w = refImg.naturalWidth;
  const h = refImg.naturalHeight;
  const canvas = (fill) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); if (fill) { x.fillStyle = fill; x.fillRect(0, 0, w, h); } return [c, x]; };
  const bgCss = `rgb(${bg.join(',')})`;
  const [refC, refX] = canvas(bgCss);
  refX.drawImage(refImg, 0, 0);
  const [coreC, coreX] = canvas(bgCss);
  coreX.drawImage(coreImg, 0, 0);
  const a = refX.getImageData(0, 0, w, h).data;
  const b = coreX.getImageData(0, 0, w, h).data;
  const px = (d, x, y) => (y * w + x) * 4;
  const meanDiff = (r, dx, dy) => {
    let sum = 0;
    let n = 0;
    let over32 = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const i = px(a, x, y);
        const j = px(b, sx, sy);
        const d = (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2])) / 3;
        sum += d;
        if (d > 32) over32++;
        n++;
      }
    }
    return { mean: sum / Math.max(1, n), over32: over32 / Math.max(1, n) };
  };
  // fractional offset of the Core content against Figma: bilinear samples of the capture, ¼-px steps within ±1.5 px
  const sample = (x, y, c) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const v = (xx, yy) => b[px(b, Math.min(w - 1, Math.max(0, xx)), Math.min(h - 1, Math.max(0, yy))) + c];
    return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy;
  };
  const subPixel = (r) => {
    let best = { dx: 0, dy: 0, mean: Infinity };
    for (let dy = -1.5; dy <= 1.5; dy += 0.25) for (let dx = -1.5; dx <= 1.5; dx += 0.25) {
      let sum = 0;
      let n = 0;
      for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) {
        const i = px(a, x, y);
        sum += (Math.abs(a[i] - sample(x + dx, y + dy, 0)) + Math.abs(a[i + 1] - sample(x + dx, y + dy, 1)) + Math.abs(a[i + 2] - sample(x + dx, y + dy, 2))) / 3;
        n++;
      }
      if (sum / n < best.mean) best = { dx, dy, mean: sum / n };
    }
    return { offset: [best.dx, best.dy], mean: +best.mean.toFixed(3) }; // Core content sits this far from Figma (core(x + dx) = figma(x))
  };
  const out = {};
  for (const [name, r] of Object.entries(regions)) {
    const at0 = meanDiff(r, 0, 0);
    let best = { dx: 0, dy: 0, mean: at0.mean };
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const m = meanDiff(r, dx, dy).mean;
      if (m < best.mean - 1e-9) best = { dx, dy, mean: m };
    }
    out[name] = { mean: +at0.mean.toFixed(3), over32: +(at0.over32 * 100).toFixed(3), bestShift: [best.dx, best.dy], bestMean: +best.mean.toFixed(3) };
    if (r.shift !== 0) out[name].subPixel = subPixel(r);
  }
  // heat map (difference ×4 on a dark field) and side-by-side (Figma | Core)
  const [heatC, heatX] = canvas('#000');
  const heat = heatX.getImageData(0, 0, w, h);
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.min(255, 4 * (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3);
    heat.data[i] = d; heat.data[i + 1] = d * 0.35; heat.data[i + 2] = 0; heat.data[i + 3] = 255;
  }
  heatX.putImageData(heat, 0, 0);
  const side = document.createElement('canvas');
  side.width = w * 2 + 24;
  side.height = h;
  const sx = side.getContext('2d');
  sx.fillStyle = '#fff';
  sx.fillRect(0, 0, side.width, h);
  sx.drawImage(refC, 0, 0);
  sx.drawImage(coreC, w + 24, 0);
  return { regions: out, figma: refC.toDataURL('image/png'), core: coreC.toDataURL('image/png'), heat: heatC.toDataURL('image/png'), side: side.toDataURL('image/png') };
}

async function openPage(browser, url, { width, height, dpr }, errors, label, setup, net = null) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  if (net) page.on('response', (response) => net.push({ url: response.url(), status: response.status() }));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`[${label}] ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`[${label}] pageerror ${error.message}`));
  if (setup) await setup(page);
  await page.goto(url, { waitUntil: 'load' });
  return { context, page };
}

const step = (message) => console.error(`  · ${message}`);

async function settle(page) {
  await page.waitForFunction(() => window.__lives && window.__lives.state() === 'shown', null, { timeout: WAIT_MS });
  // two more rendered frames after the entrance so the capture is the idle pose
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function clickAndClose(page, name) {
  const at = await page.evaluate((n) => window.__lives.tap(n), name);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__lives.state() === 'hidden', null, { timeout: WAIT_MS });
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  const problems = []; // acceptance misses: collected, the report is written first
  const report = { figma: { fileKey: figma.source.fileKey, screen: figma.source.screen.id, reference: figma.source.reference }, shots: {} };
  try {
    // 1. parity at the Figma frame size + the Figma path's requests
    {
      step('parity 1080 × 2344 @1x');
      const net = [];
      const { context, page } = await openPage(browser, `${baseUrl}lives.html?parity=1`, { width: 1080, height: 2344, dpr: 1 }, errors, 'parity', null, net);
      await settle(page);
      const lives = net.filter((r) => isOptional(r.url, LIVES_FILES));
      const others = net.filter((r) => isOptional(r.url, OTHER_OPTIONAL));
      report.figmaPathRequests = lives.map((r) => `${r.status} ${r.url.slice(r.url.indexOf('pixi-ui/'))}`);
      if (lives.length !== LIVES_FILES.length || lives.some((r) => r.status !== 200) || others.length) problems.push(`figma path requests: ${JSON.stringify(report.figmaPathRequests)} + other optional ${others.length}`);
      const scene = await page.evaluate(() => window.__lives.scene());
      const shot = await page.screenshot({ clip: { x: REF_X, y: REF_Y, width: figma.source.reference.size[0], height: figma.source.reference.size[1] } });
      const parity = await page.evaluate(parityInPage, { core: 'data:image/png;base64,' + shot.toString('base64'), ref: 'data:image/png;base64,' + reference, bg: PARITY_BG, regions: REGIONS });
      save('parity-figma.png', parity.figma);
      save('parity-core.png', parity.core);
      save('parity-diff-x4.png', parity.heat);
      save('parity-side-by-side.png', parity.side);
      report.parity = parity.regions;
      report.parityScene = scene;
      for (const [name, r] of Object.entries(parity.regions)) {
        const allowed = REGIONS[name].shift;
        if (allowed === null) continue; // digits: diagnostic
        if (Math.abs(r.bestShift[0]) > allowed || Math.abs(r.bestShift[1]) > allowed) problems.push(`parity ${name}: best shift ${r.bestShift} (allowed ±${allowed})`);
      }
      if (Math.abs(scene.fitScale - 1) > 1e-6) problems.push(`parity fit scale ${scene.fitScale}, expected 1 at 1080 × 2344`);
      await context.close();
    }

    // 2 + 3. shots per viewport and copy, the two states, real clicks
    const shots = [
      ['iphone-390x844-en', 390, 844, 3, 'locale=en', true], ['iphone-390x844-ru', 390, 844, 3, 'locale=ru', false],
      ['desktop-1280x800-en', 1280, 800, 2, 'locale=en', true], ['desktop-1280x800-ru', 1280, 800, 2, 'locale=ru', false],
      ['iphone-390x844-full', 390, 844, 3, 'state=full', false], ['iphone-390x844-noad', 390, 844, 3, 'state=noad', false],
      ['iphone-390x844-donor-default', 390, 844, 3, 'donor=1', false]
    ];
    for (const [name, width, height, dpr, query, clicks] of shots) {
      step(name);
      const net = [];
      const { context, page } = await openPage(browser, `${baseUrl}lives.html?${query}`, { width, height, dpr }, errors, name, null, net);
      await settle(page);
      await page.screenshot({ path: resolve(outDir, `${name}.png`) });
      const scene = await page.evaluate(() => window.__lives.scene());
      const entry = { viewport: [width, height], dpr, rendererResolution: await page.evaluate(() => window.__lives.resolution()), variant: scene.variant, fitScale: scene.fitScale,
        texts: Object.fromEntries(Object.entries(scene.parts).filter(([, p]) => p.text !== undefined).map(([k, p]) => [k, p.text])),
        refill: scene.parts.refillButton, ad: scene.parts.adButton };
      if (query === 'donor=1') {
        const figmaRequests = net.filter((r) => isOptional(r.url, [...LIVES_FILES, ...OTHER_OPTIONAL]));
        entry.optionalRequests = figmaRequests.length;
        entry.httpErrors = net.filter((r) => r.status >= 400).length;
        if (scene.variant !== 'donor' || figmaRequests.length || entry.httpErrors) problems.push(`donor default: ${JSON.stringify(entry)}`);
      }
      if (clicks) {
        await clickAndClose(page, 'refill');
        await page.evaluate(() => window.__lives.show());
        await settle(page);
        await clickAndClose(page, 'ad');
        await page.evaluate(() => window.__lives.show());
        await settle(page);
        await clickAndClose(page, 'close');
        entry.input = await page.evaluate(() => window.__lives.events.slice());
        if (JSON.stringify(entry.input) !== JSON.stringify(['refill:1', 'ad:1', 'dismiss:button'])) problems.push(`${name} input: ${JSON.stringify(entry.input)}`);
      }
      report.shots[name] = entry;
      await context.close();
    }

    // 4a. an existing game on the default path (the main showcase: loadReadyUiAssets() without include)
    {
      step('main showcase: default path requests');
      const net = [];
      const { context, page } = await openPage(browser, baseUrl, { width: 390, height: 844, dpr: 2 }, errors, 'main', null, net);
      await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: WAIT_MS });
      const optional = net.filter((r) => isOptional(r.url, [...LIVES_FILES, ...OTHER_OPTIONAL]));
      const failed = net.filter((r) => r.status >= 400);
      report.mainShowcase = { kitRequests: net.filter((r) => r.url.includes('/pixi-ui/')).length, optionalRequests: optional.length, httpErrors: failed.map((r) => `${r.status} ${r.url}`) };
      if (optional.length || failed.length) problems.push(`main showcase: ${JSON.stringify(report.mainShowcase)}`);
      await context.close();
    }
    // 4b. the Figma Lives path with its orange surface missing from the pack: a clear failure naming the file
    {
      step('figma path: art missing → clear failure');
      const pageErrors = [];
      const { context, page } = await openPage(browser, `${baseUrl}lives.html`, { width: 390, height: 844, dpr: 2 }, pageErrors, 'figma-missing', async (p) => {
        await p.route('**/pixi-ui/button/button_orange@2x.webp', (route) => route.fulfill({ status: 404, body: 'not in this pack' }));
      });
      const isClear = (e) => e.includes('"buttonOrange" (button/button_orange@2x.webp) was requested but did not load');
      for (const deadline = Date.now() + WAIT_MS; !pageErrors.some(isClear) && Date.now() < deadline;) await page.waitForTimeout(100);
      report.figmaMissing = { clearError: pageErrors.find(isClear) ?? null, windowMounted: await page.evaluate(() => Boolean(window.__lives)) };
      if (!report.figmaMissing.clearError || report.figmaMissing.windowMounted) problems.push(`figma missing art: ${JSON.stringify(report.figmaMissing)}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  report.problems = problems;
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (errors.length) problems.push(`console errors:\n${errors.join('\n')}`);
  if (problems.length) fail(problems.join('\n'));
  return report;
}

let server = null;
let url = process.env.SHOWCASE_URL;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5192, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  const report = await run(url);
  const p = report.parity;
  console.log(`lives-check: OK — parity best shifts ${Object.entries(p).map(([k, v]) => `${k} ${v.bestShift}`).join(', ')}; shots in ${outDir}`);
} catch (error) {
  console.error(`lives-check: FAILED — ${error.message}`);
  process.exitCode = 1;
} finally {
  await server?.close();
}
