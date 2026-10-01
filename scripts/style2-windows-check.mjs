// Style 2 Confirm + Refill Hearts proof (Figma theme_light_3: `попап рестарт` 8:22049, `попап выйти` 8:22069,
// `screen_refill_hearts` 8:22838), with Playwright on the installed Google Chrome.
//
//   npm run showcase:style2-windows                                      (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style2-windows  (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/windows2.html. Source of truth: docs/figma/style2-confirm, docs/figma/style2-refill-hearts
// (figma.json + Figma's screen renders, 0.5x). Writes showcase-shots/style2-windows/ (git-ignored):
//   1. parity — a 1080 × 2344 @1x viewport is the Figma frame (contain-fit scale 1): the page (host gradient + dim +
//      window, ?figma=1 sample copy / values) is compared with Figma's render per region (mean |Δ| RGB at 0.5x). Art
//      regions are enforced; text regions and the host context under the dim (gameplay screen / HUD in Figma) are
//      reported only;
//   2. shots — 390 × 844 @3 next to Figma's render (Restart / Exit / Refill), EN / RU, Refill full / no-ad; 320 × 568 @2;
//      1280 × 800 @1;
//   3. behaviour — real taps: RESTART / EXIT run the host's action, × and the backdrop dismiss; REFILL / GET report the
//      runtime params; the countdown ticks;
//   4. assets — the donor and Style 1 pages never request a Style 2 file; Style 2 requests its Confirm / Lives files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/style2-windows');
mkdirSync(outDir, { recursive: true });
const webp = (path) => 'data:image/webp;base64,' + readFileSync(resolve(rootDir, path)).toString('base64');
const REFERENCES = {
  restart: webp('docs/figma/style2-confirm/reference/screen-8-22049@0.5x.webp'),
  exit: webp('docs/figma/style2-confirm/reference/screen-8-22069@0.5x.webp'),
  refill: webp('docs/figma/style2-refill-hearts/reference/screen-8-22838@0.5x.webp')
};
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 120000;
const save = (name, buffer) => writeFileSync(resolve(outDir, name), buffer);

// Parity regions in frame units (1080 × 2344). `max` = enforced mean |Δ|; null = reported only. The reference is a
// lossy 0.5x WebP, so a region across a hard edge gets a looser bound.
const CONFIRM_REGIONS = {
  dim: { x: 0, y: 200, w: 1080, h: 300, max: null }, // Figma: the dim over a gameplay screen (host context)
  header: { x: 70, y: 690, w: 120, h: 140, max: 4 }, // violet header, left of the title
  close: { x: 900, y: 715, w: 90, h: 90, max: 6 },
  bodyLeft: { x: 70, y: 860, w: 200, h: 380, max: 4 }, // lavender body + the glow's edge
  heart: { x: 377, y: 939, w: 220, h: 298, max: 6 }, // the broken heart left of the "-1"
  buttonEnds: { x: 240, y: 1400, w: 80, h: 206, max: 5 },
  bottom: { x: 70, y: 1600, w: 940, h: 60, max: 4 },
  title: { x: 195, y: 709, w: 690, h: 104, max: null },
  lifeDelta: { x: 603, y: 1020, w: 146, h: 180, max: null },
  body: { x: 123, y: 1261, w: 834, h: 113, max: null },
  buttonLabel: { x: 265, y: 1427, w: 550, h: 128, max: null }
};
const REFILL_REGIONS = {
  dim: { x: 100, y: 380, w: 880, h: 190, max: 3 }, // the dim over the frame gradient, between the HUD and the popup
  hud: { x: 380, y: 199, w: 640, h: 118, max: null }, // Figma: the host HUD (context)
  headerEnd: { x: 182, y: 598, w: 140, h: 166, max: 4 }, // header left end, no title
  close: { x: 907, y: 610, w: 153, h: 158, max: 6 },
  popupLeft: { x: 62, y: 1250, w: 60, h: 300, max: 5 }, // the blue frame + the white body
  glow: { x: 500, y: 1180, w: 420, h: 150, max: 3 }, // the blurred section background under the timer
  heartTop: { x: 150, y: 904, w: 338, h: 85, max: 6 },
  heartBottom: { x: 150, y: 1160, w: 338, h: 82, max: 6 },
  refillEnds: { x: 120, y: 1403, w: 24, h: 214, max: 5 },
  refillRight: { x: 450, y: 1403, w: 24, h: 214, max: 5 },
  tv: { x: 522, y: 1435, w: 130, h: 150, max: 6 },
  adRight: { x: 938, y: 1403, w: 22, h: 214, max: 5 },
  title: { x: 226, y: 645, w: 628, h: 79, max: null },
  count: { x: 219, y: 993, w: 200, h: 160, max: null },
  next: { x: 488, y: 992, w: 442, h: 85, max: null },
  timer: { x: 488, y: 1077, w: 442, h: 85, max: null },
  refillLabel: { x: 144, y: 1431, w: 306, h: 105, max: null },
  price: { x: 177, y: 1510, w: 224, h: 80, max: null },
  get: { x: 652, y: 1437, w: 162, h: 146, max: null },
  reward: { x: 810, y: 1446, w: 128, h: 128, max: null }
};

async function open(browser, url, viewport, deviceScaleFactor, log = []) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) log.push(msg.text()); });
  page.on('pageerror', (error) => log.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => window.__windows2?.ready === true, null, { timeout: WAIT_MS });
  await page.waitForFunction(() => window.__windows2.view.state === 'shown', null, { timeout: WAIT_MS });
  await settle(page);
  return page;
}

/** A few host frames, an explicit render and two presented animation frames (headless Chrome's first frame at a new size can come up empty). */
async function settle(page) {
  await page.evaluate(() => new Promise((done) => { const t = window.__windows2.app.ticker; let n = 0; const f = () => { if (++n >= 3) { t.remove(f); done(); } }; t.add(f); }));
  await page.evaluate(() => new Promise((done) => { window.__windows2.app.render(); requestAnimationFrame(() => requestAnimationFrame(() => done())); }));
}

/** A capture with the window up: the dim darkens the frame gradient's top-left corner (#483191 → ~#15102a); retried, never silently blank. */
async function capture(page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const png = await page.screenshot();
    const corner = await page.evaluate(async (shot) => {
      const i = new Image(); i.src = 'data:image/png;base64,' + shot; await i.decode();
      const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 4, 4, 0, 0, 4, 4);
      return Array.from(x.getImageData(2, 2, 1, 1).data);
    }, png.toString('base64'));
    if (corner[2] < 90) return png;
    await page.waitForTimeout(500);
    await settle(page);
  }
  throw new Error('capture: the window never showed (blank canvas)');
}

/** Real pointer tap at a view node's centre (global coordinates). */
async function tapNode(page, name) {
  const point = await page.evaluate((name) => {
    const b = window.__windows2.view[name].getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, name);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(600);
}

async function parity(page, shot, reference, regions) {
  return page.evaluate(async ({ shot, reference, regions }) => {
    const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
    const [a, b] = await Promise.all([load('data:image/png;base64,' + shot), load(reference)]);
    const pixels = (img) => { const c = document.createElement('canvas'); c.width = 540; c.height = 1172; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 540, 1172); return x.getImageData(0, 0, 540, 1172).data; };
    const A = pixels(a), B = pixels(b), out = {};
    for (const [name, r] of Object.entries(regions)) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r.y / 2); y < Math.floor((r.y + r.h) / 2); y++) for (let x = Math.floor(r.x / 2); x < Math.floor((r.x + r.w) / 2); x++) {
        const i = (y * 540 + x) * 4; for (let c = 0; c < 3; c++) { sum += Math.abs(A[i + c] - B[i + c]); n++; }
      }
      out[name] = { mean: +(sum / n).toFixed(2), max: r.max };
    }
    return out;
  }, { shot: shot.toString('base64'), reference, regions });
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const report = { parity: {}, shots: [], behaviour: {}, assets: {}, consoleErrors: [] };
  const failures = [];
  try {
    // 1. parity
    for (const [which, regions] of [['restart', CONFIRM_REGIONS], ['exit', CONFIRM_REGIONS], ['refill', REFILL_REGIONS]]) {
      const page = await open(browser, `${baseUrl}windows2.html?window=${which}&figma=1`, { width: 1080, height: 2344 }, 1, report.consoleErrors);
      const shot = await capture(page);
      save(`parity-${which}-1080x2344.png`, shot);
      report.parity[which] = await parity(page, shot, REFERENCES[which], regions);
      for (const [name, r] of Object.entries(report.parity[which])) if (r.max !== null && r.mean > r.max) failures.push(`parity ${which}.${name}: mean ${r.mean} > ${r.max}`);
      await page.close();
    }

    // 2. shots
    const shots = [
      ['iphone-390-restart-figma', '?window=restart&figma=1', { width: 390, height: 844 }, 3, 'restart'],
      ['iphone-390-exit-figma', '?window=exit&figma=1', { width: 390, height: 844 }, 3, 'exit'],
      ['iphone-390-refill-figma', '?window=refill&figma=1', { width: 390, height: 844 }, 3, 'refill'],
      ['iphone-390-restart-ru', '?window=restart&locale=ru', { width: 390, height: 844 }, 3],
      ['iphone-390-exit-en', '?window=exit&locale=en', { width: 390, height: 844 }, 3],
      ['iphone-390-refill-ru', '?window=refill&locale=ru', { width: 390, height: 844 }, 3],
      ['iphone-390-refill-en-full', '?window=refill&locale=en&state=full', { width: 390, height: 844 }, 3],
      ['iphone-390-refill-en-noad', '?window=refill&locale=en&state=noad', { width: 390, height: 844 }, 3],
      ['narrow-320-restart', '?window=restart&locale=en', { width: 320, height: 568 }, 2],
      ['narrow-320-refill', '?window=refill&locale=en', { width: 320, height: 568 }, 2],
      ['desktop-1280-exit', '?window=exit&figma=1', { width: 1280, height: 800 }, 1],
      ['desktop-1280-refill', '?window=refill&figma=1', { width: 1280, height: 800 }, 1]
    ];
    for (const [name, query, viewport, dpr, pairWith] of shots) {
      const shotPage = await open(browser, `${baseUrl}windows2.html${query}`, viewport, dpr, report.consoleErrors);
      const png = await capture(shotPage);
      save(`${name}.png`, png);
      if (pairWith) {
        const pair = await shotPage.evaluate(async ({ shot, reference }) => {
          const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
          const [a, b] = await Promise.all([load('data:image/png;base64,' + shot), load(reference)]);
          const c = document.createElement('canvas'); c.width = a.naturalWidth * 2 + 30; c.height = a.naturalHeight; const x = c.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
          x.drawImage(a, 0, 0);
          const k = Math.max(a.naturalWidth / b.naturalWidth, a.naturalHeight / b.naturalHeight); // cover, centred
          const w = b.naturalWidth * k, h = b.naturalHeight * k;
          x.save(); x.beginPath(); x.rect(a.naturalWidth + 30, 0, a.naturalWidth, a.naturalHeight); x.clip();
          x.drawImage(b, a.naturalWidth + 30 + (a.naturalWidth - w) / 2, (a.naturalHeight - h) / 2, w, h); x.restore();
          return c.toDataURL('image/png').split(',')[1];
        }, { shot: png.toString('base64'), reference: REFERENCES[pairWith] });
        save(`${name.replace('-figma', '')}-vs-figma.png`, Buffer.from(pair, 'base64'));
      }
      report.shots.push(name);
      await shotPage.close();
    }

    // 3. behaviour (real taps)
    for (const which of ['restart', 'exit']) {
      const b = await open(browser, `${baseUrl}windows2.html?window=${which}&locale=en`, { width: 390, height: 844 }, 2, report.consoleErrors);
      await tapNode(b, 'confirmButton');
      await b.waitForFunction(() => window.__windows2.view.state === 'hidden', null, { timeout: WAIT_MS });
      await b.evaluate(() => window.__windows2.open());
      await b.waitForFunction(() => window.__windows2.view.state === 'shown', null, { timeout: WAIT_MS });
      await tapNode(b, 'closeButton');
      await b.waitForFunction(() => window.__windows2.view.state === 'hidden', null, { timeout: WAIT_MS });
      await b.evaluate(() => window.__windows2.open());
      await b.waitForFunction(() => window.__windows2.view.state === 'shown', null, { timeout: WAIT_MS });
      await b.mouse.click(20, 20); // the dim outside the window
      await b.waitForFunction(() => window.__windows2.view.state === 'hidden', null, { timeout: WAIT_MS });
      report.behaviour[which] = await b.evaluate(() => [...window.__windows2.events]);
      if (report.behaviour[which].join() !== `confirm:${which},dismiss:button,dismiss:background`) failures.push(`${which} events ${report.behaviour[which].join()}`);
      await b.close();
    }
    const r = await open(browser, `${baseUrl}windows2.html?window=refill&locale=en`, { width: 390, height: 844 }, 2, report.consoleErrors);
    const before = await r.evaluate(() => window.__windows2.view.timerText.text);
    await r.waitForTimeout(2300);
    const after = await r.evaluate(() => window.__windows2.view.timerText.text);
    report.behaviour.timer = [before, after];
    if (before === after) failures.push(`timer did not tick (${before})`);
    await tapNode(r, 'refillButton');
    await r.waitForFunction(() => window.__windows2.view.state === 'hidden', null, { timeout: WAIT_MS });
    await r.evaluate(() => window.__windows2.open());
    await r.waitForFunction(() => window.__windows2.view.state === 'shown', null, { timeout: WAIT_MS });
    await tapNode(r, 'adButton');
    await r.waitForFunction(() => window.__windows2.view.state === 'hidden', null, { timeout: WAIT_MS });
    await r.evaluate(() => window.__windows2.open());
    await r.waitForFunction(() => window.__windows2.view.state === 'shown', null, { timeout: WAIT_MS });
    await tapNode(r, 'closeButton');
    await r.waitForFunction(() => window.__windows2.view.state === 'hidden', null, { timeout: WAIT_MS });
    report.behaviour.refill = await r.evaluate(() => [...window.__windows2.events]);
    if (report.behaviour.refill.join() !== 'refill:2/900,ad:2,dismiss:button') failures.push(`refill events ${report.behaviour.refill.join()}`);
    await r.close();

    // 4. assets
    const requests = async (path) => {
      const p = await browser.newPage();
      const urls = [];
      p.on('request', (req) => urls.push(req.url()));
      await p.goto(`${baseUrl}${path}`);
      await p.waitForFunction(() => window.__windows2?.ready === true || window.__confirm !== undefined || window.__lives !== undefined || window.__showcase !== undefined, null, { timeout: WAIT_MS });
      await p.waitForTimeout(1000);
      await p.close();
      return urls;
    };
    const style2 = (urls) => ({ style2: urls.filter((u) => /\/style2\//.test(u)).length, carlito: urls.filter((u) => /Carlito/.test(u)).length });
    for (const [name, path] of [['donor', 'index.html'], ['donorConfirm', 'confirm.html?donor=1'], ['style1Confirm', 'confirm.html?skin=1'], ['style1Lives', 'lives.html?skin=1']]) {
      report.assets[name] = style2(await requests(path));
      if (report.assets[name].style2 || report.assets[name].carlito) failures.push(`${name} requested Style 2 files`);
    }
    const urls = await requests('windows2.html?window=refill');
    report.assets.style2 = {
      ...style2(urls),
      newRefillFiles: ['button_primary', 'button_rewarded', 'lives_glow', 'icon_tv', 'price_coin'].filter((f) => urls.some((u) => u.includes(`/style2/${f}`))).length,
      sharedConfirmFiles: ['window_base@2x', 'window_close@2x', 'button_green@2x', 'message_glow@0.5x', 'broken_heart@2x'].filter((f) => urls.some((u) => u.includes(f))).length
    };
    if (report.assets.style2.newRefillFiles !== 5 || report.assets.style2.sharedConfirmFiles !== 5 || report.assets.style2.carlito !== 1) failures.push(`style2 requests ${JSON.stringify(report.assets.style2)}`);
    if (report.consoleErrors.length) failures.push(`console: ${report.consoleErrors.join(' | ')}`);
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify({ ...report, failures }, null, 2));
  console.log(JSON.stringify({ ...report, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

let url = process.env.SHOWCASE_URL;
let server = null;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5195, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  await run(url.endsWith('/') ? url : `${url}/`);
} finally {
  await server?.close();
}
