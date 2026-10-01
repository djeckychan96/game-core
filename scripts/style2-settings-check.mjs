// Style 2 Settings proof (Figma theme_light_3 `настройки` 8:17493), with Playwright on the installed Google Chrome.
//
//   npm run showcase:style2-settings                                      (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style2-settings  (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/settings2.html. Source of truth: docs/figma/style2-settings (figma.json + Figma's
// render of 8:17493, 0.5x). Writes showcase-shots/style2-settings/ (git-ignored):
//   1. parity — a 1080 × 2344 @1x viewport is the Figma frame (contain-fit scale 1): the page (host gradient + dim +
//      window, ?figma=1 sample copy) is compared with Figma's render per region (mean |Δ| RGB at 0.5x). Art regions are
//      enforced; text regions (Calibri in Figma, Carlito here) are reported;
//   2. shots — 390 × 844 @3 next to Figma's render, EN / RU / map variant / all OFF; 320 × 568 @2; 1280 × 800 @1;
//   3. behaviour — real taps: Sound toggles the OFF art + slash and reports, Restart / Return home / × close and run
//      their continuation;
//   4. assets — the donor and Style 1 pages never request a Style 2 Settings file; Carlito is requested once.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const figmaDir = resolve(rootDir, 'docs/figma/style2-settings');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/style2-settings');
mkdirSync(outDir, { recursive: true });
const figma = JSON.parse(readFileSync(resolve(figmaDir, 'figma.json'), 'utf8'));
const reference = 'data:image/webp;base64,' + readFileSync(resolve(figmaDir, figma.source.reference.file)).toString('base64');
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 90000;
const save = (name, buffer) => writeFileSync(resolve(outDir, name), buffer);

// Parity regions in frame units (1080 × 2344). `max` = enforced mean |Δ|; null = reported only. The reference is a
// lossy 0.5x WebP: regions across a hard edge (the frame's outer edge, the ×) get a looser bound — against Figma's 1x
// PNG (not committed) those edge columns differ by ≤ 0.7.
const REGIONS = {
  dim: { x: 60, y: 120, w: 960, h: 400, max: 3 }, // the dim over the host gradient
  popupBody: { x: 100, y: 1000, w: 120, h: 560, max: 3 }, // white body + blue frame, left of the buttons
  frameRight: { x: 1000, y: 800, w: 40, h: 850, max: 8 },
  headerEnds: { x: 162, y: 598, w: 120, h: 166, max: 4 }, // header left end (no title)
  title: { x: 300, y: 625, w: 480, h: 90, max: null },
  close: { x: 927, y: 610, w: 153, h: 158, max: 6 },
  soundButton: { x: 277, y: 867, w: 228, h: 228, max: 4 },
  musicButtonOff: { x: 574, y: 867, w: 228, h: 228, max: 4 },
  labels: { x: 277, y: 794, w: 526, h: 73, max: null },
  restart: { x: 129, y: 1129, w: 822, h: 200, max: null },
  restartEnds: { x: 129, y: 1129, w: 140, h: 200, max: 4 },
  home: { x: 129, y: 1363, w: 822, h: 200, max: null },
  homeEnds: { x: 820, y: 1363, w: 131, h: 200, max: 4 },
  version: { x: 129, y: 1586, w: 822, h: 61, max: null }
};

async function open(browser, url, viewport, deviceScaleFactor, log = []) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) log.push(msg.text()); });
  page.on('pageerror', (error) => log.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => window.__settings2?.ready === true, null, { timeout: WAIT_MS });
  await page.waitForFunction(() => window.__settings2.view.state === 'shown', null, { timeout: WAIT_MS });
  await page.evaluate(() => new Promise((done) => { const t = window.__settings2.app.ticker; let n = 0; const f = () => { if (++n >= 3) { t.remove(f); done(); } }; t.add(f); }));
  return page;
}

/** Real pointer tap at a view node's centre (global coordinates). */
async function tapNode(page, path) {
  const point = await page.evaluate((path) => {
    const node = path.reduce((o, k) => o[k], window.__settings2.view);
    const b = node.getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, path);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(600);
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const report = { parity: {}, shots: [], behaviour: {}, assets: {}, consoleErrors: [] };
  const failures = [];
  try {
    // 1. parity
    const page = await open(browser, `${baseUrl}settings2.html?figma=1`, { width: 1080, height: 2344 }, 1, report.consoleErrors);
    const shot = await page.screenshot();
    save('parity-1080x2344.png', shot);
    report.parity = await page.evaluate(async ({ shot, reference, regions }) => {
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
    }, { shot: shot.toString('base64'), reference, regions: REGIONS });
    for (const [name, r] of Object.entries(report.parity)) if (r.max !== null && r.mean > r.max) failures.push(`parity ${name}: mean ${r.mean} > ${r.max}`);
    await page.close();

    // 2. shots
    const shots = [
      ['iphone-390-figma', '?figma=1', { width: 390, height: 844 }, 3],
      ['iphone-390-en', '?locale=en', { width: 390, height: 844 }, 3],
      ['iphone-390-ru', '?locale=ru', { width: 390, height: 844 }, 3],
      ['iphone-390-ru-off', '?locale=ru&sound=0&music=0', { width: 390, height: 844 }, 3],
      ['iphone-390-map', '?locale=en&map=1', { width: 390, height: 844 }, 3],
      ['narrow-320', '?locale=en', { width: 320, height: 568 }, 2],
      ['desktop-1280', '?figma=1', { width: 1280, height: 800 }, 1]
    ];
    for (const [name, query, viewport, dpr] of shots) {
      const shotPage = await open(browser, `${baseUrl}settings2.html${query}`, viewport, dpr, report.consoleErrors);
      const png = await shotPage.screenshot();
      save(`${name}.png`, png);
      if (name === 'iphone-390-figma') {
        // side by side: the capture | Figma's render of 8:17493 scaled to the same pixels
        const pair = await shotPage.evaluate(async ({ shot, reference }) => {
          const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
          const [a, b] = await Promise.all([load('data:image/png;base64,' + shot), load(reference)]);
          const c = document.createElement('canvas'); c.width = a.naturalWidth * 2 + 30; c.height = a.naturalHeight; const x = c.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
          x.drawImage(a, 0, 0);
          const k = Math.max(a.naturalWidth / b.naturalWidth, a.naturalHeight / b.naturalHeight); // cover, centred (1080 × 2344 vs 390 × 844)
          const w = b.naturalWidth * k, h = b.naturalHeight * k;
          x.save(); x.beginPath(); x.rect(a.naturalWidth + 30, 0, a.naturalWidth, a.naturalHeight); x.clip();
          x.drawImage(b, a.naturalWidth + 30 + (a.naturalWidth - w) / 2, (a.naturalHeight - h) / 2, w, h); x.restore();
          return c.toDataURL('image/png').split(',')[1];
        }, { shot: png.toString('base64'), reference });
        save('iphone-390-vs-figma.png', Buffer.from(pair, 'base64'));
      }
      report.shots.push(name);
      await shotPage.close();
    }

    // 3. behaviour (real taps)
    const b = await open(browser, `${baseUrl}settings2.html?locale=en`, { width: 390, height: 844 }, 2, report.consoleErrors);
    await tapNode(b, ['toggles', 'sound', 'button']);
    report.behaviour.soundTap = await b.evaluate(() => {
      const { view, events } = window.__settings2; const t = view.toggles.sound;
      return { events: [...events], off: t.off.visible, art: t.button.background.texture === t.offArt };
    });
    if (report.behaviour.soundTap.events.join() !== 'sound:false' || !report.behaviour.soundTap.off || !report.behaviour.soundTap.art) failures.push('sound tap');
    await tapNode(b, ['restartButton']);
    await b.waitForFunction(() => window.__settings2.view.state === 'hidden', null, { timeout: WAIT_MS });
    await b.evaluate(() => window.__settings2.open());
    await b.waitForFunction(() => window.__settings2.view.state === 'shown', null, { timeout: WAIT_MS });
    await tapNode(b, ['homeButton']);
    await b.waitForFunction(() => window.__settings2.view.state === 'hidden', null, { timeout: WAIT_MS });
    await b.evaluate(() => window.__settings2.open());
    await b.waitForFunction(() => window.__settings2.view.state === 'shown', null, { timeout: WAIT_MS });
    await tapNode(b, ['closeButton']);
    await b.waitForFunction(() => window.__settings2.view.state === 'hidden', null, { timeout: WAIT_MS });
    report.behaviour.events = await b.evaluate(() => [...window.__settings2.events]);
    if (report.behaviour.events.join() !== 'sound:false,restart,home,dismiss:button') failures.push(`events ${report.behaviour.events.join()}`);
    await b.close();

    // 4. assets
    const requests = async (path) => {
      const p = await browser.newPage();
      const urls = [];
      p.on('request', (r) => urls.push(r.url()));
      await p.goto(`${baseUrl}${path}`);
      // the showcase pages expose their state once every texture loaded
      await p.waitForFunction(() => window.__settings2?.ready === true || window.__showcase !== undefined, null, { timeout: WAIT_MS });
      await p.waitForTimeout(1000);
      await p.close();
      return urls;
    };
    for (const [name, path] of [['donor', 'index.html'], ['style1', 'index.html?skin=style1&settings=gameplay']]) {
      const urls = await requests(path);
      report.assets[name] = { style2Settings: urls.filter((u) => /style2\/settings_/.test(u)).length, carlito: urls.filter((u) => /Carlito/.test(u)).length };
      if (report.assets[name].style2Settings || report.assets[name].carlito) failures.push(`${name} requested Style 2 files`);
    }
    const urls = await requests('settings2.html');
    report.assets.style2 = { style2Settings: urls.filter((u) => /style2\/settings_/.test(u)).length, carlito: urls.filter((u) => /Carlito/.test(u)).length };
    if (report.assets.style2.style2Settings !== 11 || report.assets.style2.carlito !== 1) failures.push(`style2 requests ${JSON.stringify(report.assets.style2)}`);
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
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5194, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  await run(url.endsWith('/') ? url : `${url}/`);
} finally {
  await server?.close();
}
