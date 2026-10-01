// Figma confirm-exit proof for ConfirmWindowView, with Playwright on the installed Google Chrome (the sandboxed
// in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase:confirm                                    (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:confirm   (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/confirm.html. Source of truth: docs/figma/confirm-exit (figma.json + Figma's own
// render of modal/confirm-exit). Writes showcase-shots/figma-confirm-exit/ (git-ignored):
//   1. parity — 1080 × 2344 @1x is the Figma frame at scale 1: the capture of the modal's render box is diffed
//      against the Figma render composited over the same flat colour; per element the mean difference and the best
//      integer shift (0,0 = in place), plus a heat map and a side-by-side;
//   2. geometry — the live scene against the Figma boxes (design units) and every part's on-screen box per viewport;
//   3. shots — 390 × 844 @3 (EN copy + RU copy: runtime text over the same art) and 1280 × 800 @2;
//   4. 9-slice — the shell and the button at other sizes; header / bottom-cap heights and corner widths measured in
//      the pixels stay the Figma ones while the middle stretches;
//   5. input — the × dismisses, the button confirms (real mouse clicks);
//   6. the default donor variant renders as before; the default path (donor page, main showcase) never requests the
//      five Figma files; the Figma confirm path requests exactly them and fails clearly when one is missing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const figmaDir = resolve(rootDir, 'docs/figma/confirm-exit');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/figma-confirm-exit');
mkdirSync(outDir, { recursive: true });
const figma = JSON.parse(readFileSync(resolve(figmaDir, 'figma.json'), 'utf8'));
const reference = readFileSync(resolve(figmaDir, figma.source.reference.file)).toString('base64');
const [REF_X, REF_Y] = figma.source.reference.origin; // the modal's render box in the screen: 56, 671
const PARITY_BG = [0x20, 0x24, 0x2c]; // body.parity in confirm.html

const OPTIONAL_FILES = ['window/window_base@2x.webp', 'window/window_close@2x.webp', 'window/message_glow@0.5x.webp', 'icons/broken_heart@2x.webp', 'button/button_green@2x.webp'];
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 60000; // SwiftShader: waits synchronize on state, never on a sleep
const fail = (message) => { throw new Error(message); };
const save = (name, dataUrl) => writeFileSync(resolve(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

// Parity regions in capture coordinates (screen − 56, 671), from figma.json. `shift` = the allowed best integer shift.
const R = (x, y, w, h) => ({ x: x - REF_X, y: y - REF_Y, w, h });
const REGIONS = {
  window: { ...R(56, 671, 968, 1006), shift: 0 },
  headerBand: { ...R(56, 820, 968, 80), shift: 0 }, // the header's bottom, its inner shadow and the first body rows: the 9-slice seam
  title: { ...R(195, 709, 690, 104), shift: 1 },
  close: { ...R(923, 736, 51, 51), shift: 0 },
  heart: { ...R(377, 939, 326, 298), shift: 0 },
  lifeDelta: { ...R(603, 1020, 146, 180), shift: 1 },
  body: { ...R(123, 1261, 834, 113), shift: 1 },
  // the body split around its "1" (a different glyph in the kit font): a centred run with a narrower glyph moves its
  // two halves apart symmetrically, a misplaced run moves both the same way
  bodyLeft: { ...R(250, 1261, 360, 113), shift: null }, // YOU WILL LOSE — reported, not enforced
  bodyRight: { ...R(648, 1261, 180, 113), shift: null }, // HEART — reported, not enforced
  button: { ...R(236, 1396, 608, 214), shift: 0 },
  buttonLabel: { ...R(265, 1427, 550, 128), shift: 1 }
};

/** In the page: composite the Figma render over the parity colour, diff it against the capture, per region. */
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

/** In the page: measure the 9-slice sheet from its own screenshot (header band, bottom cap, corners). */
async function sheetInPage({ shot, items, dpr }) {
  const img = new Image();
  img.src = shot;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const rgb = (px, py) => { const i = (Math.round(py) * c.width + Math.round(px)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const near = (p, q, tol = 18) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  const HEADER = [0x74, 0x53, 0xd5];
  const BODY = [0xc3, 0xc1, 0xff];
  const GREEN = [0x3c, 0xc3, 0x1f];
  const out = [];
  for (const item of items) {
    const r = item.rect; // CSS px, incl. the art's bleed
    const s = (item.kind === 'window' ? r.width / (item.width + 8) : r.width / item.width) * dpr; // device px per unit
    const cx = (r.x + r.width / 2) * dpr;
    if (item.kind === 'window') {
      const top = (r.y + 4 * (s / dpr)) * dpr; // the window box top
      // header band: rows of header colour down the centre column, until the body colour starts
      let y = top + 2;
      while (y < c.height && !near(rgb(cx, y), BODY)) y++;
      const headerUnits = (y - top) / s;
      // body flat colour ends where the −23 inner-shadow band begins
      let yb = y;
      while (yb < c.height && near(rgb(cx, yb), BODY)) yb++;
      const bottomBox = top + item.height * s;
      const bottomBandUnits = (bottomBox - yb) / s;
      // left corner: at the header's mid-row the stroke is straight; 40 units above the box bottom the corner curves
      out.push({ label: item.label, size: [item.width, item.height], headerUnits: +headerUnits.toFixed(2), bottomBandUnits: +bottomBandUnits.toFixed(2), pxPerUnit: +s.toFixed(4) });
    } else {
      const top = r.y * dpr;
      let y = top + 6 * s;
      while (y < c.height && !near(rgb(cx, y), GREEN, 30)) y++;
      let yf = y;
      while (yf < c.height && near(rgb(cx, yf), GREEN, 30)) yf++;
      const faceUnits = (yf - y) / s;
      // the face's left edge on the middle row: where the green starts
      const midY = y + (yf - y) / 2;
      let xl = r.x * dpr;
      while (xl < cx && !near(rgb(xl, midY), GREEN, 30)) xl++;
      out.push({ label: item.label, size: [item.width, item.height], faceTopUnits: +((y - top) / s).toFixed(2), faceHeightUnits: +faceUnits.toFixed(2), faceLeftUnits: +((xl - r.x * dpr) / s).toFixed(2), pxPerUnit: +s.toFixed(4) });
    }
  }
  return out;
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
  await page.waitForFunction(() => window.__confirm && window.__confirm.state() === 'shown', null, { timeout: WAIT_MS });
  // two more rendered frames after the entrance so the capture is the idle pose
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  const problems = []; // acceptance misses: collected, the report is written first
  const report = { figma: { fileKey: figma.source.fileKey, screen: figma.source.screen.id, reference: figma.source.reference }, viewports: {} };
  try {
    // 1 + 2. parity at the Figma frame size
    {
      step('parity 1080 × 2344 @1x');
      const net = [];
      const { context, page } = await openPage(browser, `${baseUrl}confirm.html?parity=1`, { width: 1080, height: 2344, dpr: 1 }, errors, 'parity', null, net);
      await settle(page);
      // the Figma confirm path asked for its own five textures (include), each served
      const figmaRequests = net.filter((r) => OPTIONAL_FILES.some((file) => r.url.endsWith(file)));
      report.figmaPathRequests = figmaRequests.map((r) => `${r.status} ${r.url.slice(r.url.indexOf('pixi-ui/'))}`);
      if (figmaRequests.length !== OPTIONAL_FILES.length || figmaRequests.some((r) => r.status !== 200)) problems.push(`figma path requests: ${JSON.stringify(report.figmaPathRequests)}`);
      const scene = await page.evaluate(() => window.__confirm.scene());
      const textures = await page.evaluate(() => window.__confirm.textures());
      const shot = await page.screenshot({ clip: { x: REF_X, y: REF_Y, width: figma.source.reference.size[0], height: figma.source.reference.size[1] } });
      const parity = await page.evaluate(parityInPage, { core: 'data:image/png;base64,' + shot.toString('base64'), ref: 'data:image/png;base64,' + reference, bg: PARITY_BG, regions: REGIONS });
      save('parity-figma.png', parity.figma);
      save('parity-core.png', parity.core);
      save('parity-diff-x4.png', parity.heat);
      save('parity-side-by-side.png', parity.side);
      report.parity = parity.regions;
      report.parityScene = scene;
      report.textures = textures;
      for (const [name, r] of Object.entries(parity.regions)) {
        const allowed = REGIONS[name].shift;
        if (allowed === null) continue; // diagnostic region
        if (Math.abs(r.bestShift[0]) > allowed || Math.abs(r.bestShift[1]) > allowed) problems.push(`parity ${name}: best shift ${r.bestShift} (allowed ±${allowed})`);
      }
      if (Math.abs(scene.fitScale - 1) > 1e-6) problems.push(`parity fit scale ${scene.fitScale}, expected 1 at 1080 × 2344`);
      await context.close();
    }

    // 3. shots + on-screen geometry per viewport
    for (const vp of [{ name: 'iphone-390x844', width: 390, height: 844, dpr: 3 }, { name: 'desktop-1280x800', width: 1280, height: 800, dpr: 2 }]) {
      for (const lang of ['en', 'ru']) {
        step(`${vp.name} ${lang}`);
        const { context, page } = await openPage(browser, `${baseUrl}confirm.html?locale=${lang}`, vp, errors, `${vp.name}-${lang}`);
        await settle(page);
        const file = `${vp.name}-${lang}.png`;
        await page.screenshot({ path: resolve(outDir, file) });
        const scene = await page.evaluate(() => window.__confirm.scene());
        report.viewports[`${vp.name}-${lang}`] = { viewport: [vp.width, vp.height], dpr: vp.dpr, rendererResolution: await page.evaluate(() => window.__confirm.resolution()), shot: file, ...scene };
        if (lang === 'en') {
          // 5. input: real clicks on the × and on the button
          const close = await page.evaluate(() => window.__confirm.tap('close'));
          step(`${vp.name} click × at ${Math.round(close.x)}, ${Math.round(close.y)}`);
          await page.mouse.click(close.x, close.y);
          await page.waitForFunction(() => window.__confirm.state() === 'hidden', null, { timeout: WAIT_MS });
          await page.evaluate(() => window.__confirm.show());
          await settle(page);
          const confirm = await page.evaluate(() => window.__confirm.tap('confirm'));
          step(`${vp.name} click button at ${Math.round(confirm.x)}, ${Math.round(confirm.y)}`);
          await page.mouse.click(confirm.x, confirm.y);
          await page.waitForFunction(() => window.__confirm.state() === 'hidden', null, { timeout: WAIT_MS });
          const events = await page.evaluate(() => window.__confirm.events.slice());
          if (JSON.stringify(events) !== JSON.stringify(['dismiss:button', 'confirm'])) problems.push(`${vp.name} input: ${JSON.stringify(events)}`);
          report.viewports[`${vp.name}-${lang}`].input = events;
        }
        await context.close();
      }
    }

    // 4. the 9-slice sheet
    {
      step('9-slice sheet');
      const vp = { width: 1280, height: 800, dpr: 2 };
      const { context, page } = await openPage(browser, `${baseUrl}confirm.html?sheet=1`, vp, errors, 'sheet');
      await page.waitForFunction(() => window.__confirm && window.__confirm.state() === 'sheet', null, { timeout: WAIT_MS });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const shot = await page.screenshot({ path: resolve(outDir, 'nine-slice-sheet-1280x800.png') });
      const { sheet } = await page.evaluate(() => window.__confirm.scene());
      report.nineSlice = await page.evaluate(sheetInPage, { shot: 'data:image/png;base64,' + shot.toString('base64'), items: sheet, dpr: vp.dpr });
      await context.close();
    }

    // 6. the default donor variant at 390 × 844 (required pack only): renders as before, never asks for the Figma art
    {
      step('donor default variant 390 × 844');
      const net = [];
      const { context, page } = await openPage(browser, `${baseUrl}confirm.html?donor=1&locale=ru`, { width: 390, height: 844, dpr: 3 }, errors, 'donor', null, net);
      await settle(page);
      await page.screenshot({ path: resolve(outDir, 'iphone-390x844-donor-default.png') });
      const scene = await page.evaluate(() => window.__confirm.scene());
      const figmaRequests = net.filter((r) => OPTIONAL_FILES.some((file) => r.url.endsWith(file)));
      const failed = net.filter((r) => r.status >= 400);
      report.donor = { variant: scene.variant, parts: Object.keys(scene.parts), figmaRequests: figmaRequests.length, httpErrors: failed.length, shot: 'iphone-390x844-donor-default.png' };
      if (scene.variant !== 'donor' || figmaRequests.length || failed.length) problems.push(`donor: ${JSON.stringify(report.donor)}`);
      await context.close();
    }

    // 6a. an existing game on the default path (the main showcase: loadReadyUiAssets() without include): not one
    //     request for the Figma art, no 4xx, boots as before
    {
      step('compat: default path requests');
      const net = [];
      const { context, page } = await openPage(browser, baseUrl, { width: 390, height: 844, dpr: 2 }, errors, 'compat', null, net);
      await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: WAIT_MS });
      const kit = net.filter((r) => r.url.includes('/pixi-ui/'));
      const figmaRequests = net.filter((r) => OPTIONAL_FILES.some((file) => r.url.endsWith(file)));
      const failed = net.filter((r) => r.status >= 400);
      report.compat = { kitRequests: kit.length, figmaRequests: figmaRequests.length, httpErrors: failed.map((r) => `${r.status} ${r.url}`), showcaseBooted: true };
      if (figmaRequests.length || failed.length) problems.push(`compat: ${JSON.stringify(report.compat)}`);
      await context.close();
    }
    // 6b. the Figma confirm path with its art missing from the pack: a clear failure naming the file
    {
      step('figma path: art missing → clear failure');
      const pageErrors = [];
      const { context, page } = await openPage(browser, `${baseUrl}confirm.html`, { width: 390, height: 844, dpr: 2 }, pageErrors, 'figma-missing', async (p) => {
        await p.route('**/pixi-ui/window/window_base@2x.webp', (route) => route.fulfill({ status: 404, body: 'not in this pack' }));
      });
      const isClear = (e) => e.includes('"windowBase" (window/window_base@2x.webp) was requested but did not load');
      for (const deadline = Date.now() + WAIT_MS; !pageErrors.some(isClear) && Date.now() < deadline;) await page.waitForTimeout(100);
      const clear = pageErrors.find(isClear);
      report.figmaMissing = { clearError: clear ?? null, confirmMounted: await page.evaluate(() => Boolean(window.__confirm)) };
      if (!clear || report.figmaMissing.confirmMounted) problems.push(`figma missing art: ${JSON.stringify(report.figmaMissing)} / ${pageErrors.join(' | ')}`);
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
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5191, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  const report = await run(url);
  const p = report.parity;
  console.log(`confirm-exit-check: OK — parity mean Δ window ${p.window.mean} / title ${p.title.mean} / body ${p.body.mean} / button ${p.button.mean}; best shifts ${Object.entries(p).map(([k, v]) => `${k} ${v.bestShift}`).join(', ')}; shots in ${outDir}`);
} catch (error) {
  console.error(`confirm-exit-check: FAILED — ${error.message}`);
  process.exitCode = 1;
} finally {
  await server?.close();
}
