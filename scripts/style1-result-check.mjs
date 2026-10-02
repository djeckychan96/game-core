// Style 1 Result WIN / FAIL proof (Figma sJ0BV1ARqMpcj5dZbjFppz: `screen/result-win` 1:3854, `screen/result-fail`
// 1:4029), with Playwright on the installed Google Chrome.
//
//   npm run showcase:style1-result                                      (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style1-result  (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/result1.html. Source of truth: docs/figma/style1-result (figma.json + Figma's screen
// renders, 0.5x). Writes showcase-shots/style1-result/ (git-ignored):
//   1. parity — a 1080 × 2344 @1x viewport is the Figma frame (contain-fit scale 1): the page (?figma=1 sample copy /
//      values) is compared with Figma's render per region (mean |Δ| RGB at 0.5x). The Result centres its composition
//      (the Core rule; Figma puts game hero art above it), so the page is sampled with the measured vertical offset.
//      Art regions are enforced; text, the glow over the host background and the hero area are reported only;
//   2. shots — 390 × 844 @3 next to Figma's render (WIN / FAIL), RU, 1 star, no EXIT, confetti; 320 × 568 @2;
//      1280 × 800 @1; the donor FAIL for comparison;
//   3. behaviour — real taps: CONTINUE / RETRY / EXIT run the host continuations, × and the backdrop dismiss;
//   4. assets — the donor pages never request a Result file; every Style 1 page loads them (the whole chosen style).
// SECTIONS=parity,shots,behaviour,assets (default: all) runs a subset.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/style1-result');
mkdirSync(outDir, { recursive: true });
const webp = (path) => 'data:image/webp;base64,' + readFileSync(resolve(rootDir, path)).toString('base64');
const REFERENCES = {
  win: webp('docs/figma/style1-result/reference/screen-win-1-3854@0.5x.webp'),
  fail: webp('docs/figma/style1-result/reference/screen-fail-1-4029@0.5x.webp')
};
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 120000;
const RESULT_FILES = ['style1_ribbon_win@2x', 'style1_ribbon_fail@2x', 'style1_glow_win@0.5x', 'style1_glow_fail@0.5x', 'style1_close_win@2x', 'style1_close_fail@2x', 'style1_reward_coin@2x'];
const save = (name, buffer) => writeFileSync(resolve(outDir, name), buffer);
const SECTIONS = new Set((process.env.SECTIONS ?? 'parity,shots,behaviour,assets').split(','));

// Parity regions in Figma frame units (1080 × 2344). `max` = enforced mean |Δ|; null = reported only. The reference is
// a lossy 0.5x WebP, so a region across a hard edge gets a looser bound.
const RIBBON_REGIONS = {
  tailLeft: { x: 36, y: 770, w: 90, h: 180, max: 6 },
  tailRight: { x: 960, y: 840, w: 80, h: 110, max: 6 },
  close: { x: 950, y: 768, w: 64, h: 64, max: 8 },
  bandLeft: { x: 150, y: 752, w: 140, h: 190, max: 6 }
};
const WIN_REGIONS = {
  ...RIBBON_REGIONS,
  coin: { x: 442, y: 1051, w: 196, h: 190, max: 8 },
  nextLeft: { x: 92, y: 1380, w: 60, h: 200, max: 6 },
  // the orange face right of Figma's '900 + coin', above the corner arc; the outline edge itself (x 982 in both) is left out:
  // the lossy 0.5x reference bleeds its chroma across that hard edge (brown instead of #261a30)
  retryRight: { x: 958, y: 1450, w: 20, h: 50, max: 6 },
  hero: { x: 165, y: 325, w: 750, h: 400, max: null }, // Figma: the game's trophy; Core: the star crown
  glowLeft: { x: 80, y: 1060, w: 300, h: 240, max: null }, // the glow over the host background (Figma: a gameplay screen)
  title: { x: 133, y: 743, w: 816, h: 174, max: null },
  rewards: { x: 319, y: 973, w: 442, h: 60, max: null },
  amount: { x: 440, y: 1223, w: 200, h: 96, max: null },
  nextLabel: { x: 112, y: 1388, w: 398, h: 159, max: null },
  retry: { x: 551, y: 1333, w: 380, h: 250, max: null } // Figma: a rewarded x2 offer; Core: RETRY
};
const FAIL_REGIONS = {
  ...RIBBON_REGIONS,
  heart: { x: 377, y: 1017, w: 190, h: 298, max: 8 },
  retryLeft: { x: 242, y: 1466, w: 60, h: 196, max: 6 },
  retryRight: { x: 778, y: 1466, w: 60, h: 196, max: 6 },
  glowLeft: { x: 80, y: 1060, w: 280, h: 240, max: null },
  hero: { x: 165, y: 325, w: 750, h: 400, max: null }, // Figma: the game's bear; Core: nothing (game content)
  title: { x: 133, y: 785, w: 816, h: 104, max: null },
  lifeDelta: { x: 578, y: 1134, w: 146, h: 180, max: null },
  status: { x: 123, y: 1348, w: 834, h: 113, max: null },
  retryLabel: { x: 265, y: 1488, w: 550, h: 128, max: null }
};

async function open(browser, url, viewport, deviceScaleFactor, log = []) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) log.push(msg.text()); });
  page.on('pageerror', (error) => log.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => window.__result1?.ready === true, null, { timeout: WAIT_MS });
  await settle(page);
  return page;
}

/** The host clock advanced deterministically past the entrance and the star run, then two presented frames. */
async function settle(page, ms = 3000) {
  await page.evaluate((ms) => window.__result1.fastForward(ms), ms);
  await page.evaluate(() => new Promise((done) => { window.__result1.app.render(); requestAnimationFrame(() => requestAnimationFrame(() => done())); }));
}

/** A capture with the window up: the dim darkens the frame gradient's top-left corner; retried, never silently blank. */
async function capture(page, ms = 3000) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const png = await page.screenshot({ timeout: WAIT_MS });
    const corner = await page.evaluate(async (shot) => {
      const i = new Image(); i.src = 'data:image/png;base64,' + shot; await i.decode();
      const c = document.createElement('canvas'); c.width = 4; c.height = 4; const x = c.getContext('2d'); x.drawImage(i, 0, 0, 4, 4, 0, 0, 4, 4);
      return Array.from(x.getImageData(2, 2, 1, 1).data);
    }, png.toString('base64'));
    if (corner[2] < 90) return png;
    await page.waitForTimeout(500);
    await settle(page, ms);
  }
  throw new Error('capture: the window never showed (blank canvas)');
}

/** Real pointer tap at a view node's centre (global coordinates). */
async function tapNode(page, name) {
  const point = await page.evaluate((name) => {
    const b = window.__result1.view[name].getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, name);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => window.__result1.fastForward(600));
}

async function reopen(page) {
  await page.evaluate(() => { window.__result1.open(); window.__result1.fastForward(3000); });
}

async function parity(page, shot, reference, regions, dy) {
  return page.evaluate(async ({ shot, reference, regions, dy }) => {
    const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
    const [a, b] = await Promise.all([load('data:image/png;base64,' + shot), load(reference)]);
    // the page is moved back by the centring offset at full resolution, then both are reduced to the reference's 0.5x
    const pixels = (img, shift) => {
      const full = document.createElement('canvas'); full.width = 1080; full.height = 2344;
      full.getContext('2d').drawImage(img, 0, -shift, img.naturalWidth * (1080 / img.naturalWidth), img.naturalHeight * (1080 / img.naturalWidth));
      const c = document.createElement('canvas'); c.width = 540; c.height = 1172; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(full, 0, 0, 540, 1172); return x.getImageData(0, 0, 540, 1172).data;
    };
    const A = pixels(a, dy), B = pixels(b, 0), out = {};
    for (const [name, r] of Object.entries(regions)) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r.y / 2); y < Math.floor((r.y + r.h) / 2); y++) for (let x = Math.floor(r.x / 2); x < Math.floor((r.x + r.w) / 2); x++) {
        const i = (y * 540 + x) * 4, j = i;
        for (let c = 0; c < 3; c++) { sum += Math.abs(A[i + c] - B[j + c]); n++; }
      }
      out[name] = { mean: n ? +(sum / n).toFixed(2) : null, max: r.max };
    }
    return out;
  }, { shot: shot.toString('base64'), reference, regions, dy });
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const report = { parity: {}, offsets: {}, shots: [], behaviour: {}, assets: {}, consoleErrors: [] };
  const failures = [];
  try {
    // 1. parity
    for (const [outcome, regions] of SECTIONS.has('parity') ? [['win', WIN_REGIONS], ['fail', FAIL_REGIONS]] : []) {
      const page = await open(browser, `${baseUrl}result1.html?outcome=${outcome}&figma=1`, { width: 1080, height: 2344 }, 1, report.consoleErrors);
      const shot = await capture(page);
      save(`parity-${outcome}-1080x2344.png`, shot);
      const geometry = await page.evaluate(() => ({ scale: window.__result1.view.panel.scale.x, y: window.__result1.view.panel.y, x: window.__result1.view.panel.x }));
      if (Math.abs(geometry.scale - 1) > 1e-6 || Math.abs(geometry.x - 540) > 1e-6) failures.push(`parity ${outcome}: frame fit ${JSON.stringify(geometry)}`);
      report.offsets[outcome] = +(geometry.y - 1172).toFixed(2);
      report.parity[outcome] = await parity(page, shot, REFERENCES[outcome], regions, geometry.y - 1172);
      for (const [name, r] of Object.entries(report.parity[outcome])) if (r.max !== null && !(r.mean <= r.max)) failures.push(`parity ${outcome}.${name}: mean ${r.mean} > ${r.max}`);
      await page.close();
    }

    // 2. shots
    const shots = [
      ['iphone-390-win-figma', '?outcome=win&figma=1', { width: 390, height: 844 }, 3, 'win'],
      ['iphone-390-fail-figma', '?outcome=fail&figma=1', { width: 390, height: 844 }, 3, 'fail'],
      ['iphone-390-win-ru', '?outcome=win&locale=ru', { width: 390, height: 844 }, 3],
      ['iphone-390-fail-ru', '?outcome=fail&locale=ru', { width: 390, height: 844 }, 3],
      ['iphone-390-win-1star-en', '?outcome=win&locale=en&stars=1', { width: 390, height: 844 }, 3],
      ['iphone-390-fail-noexit-en', '?outcome=fail&locale=en&exit=0', { width: 390, height: 844 }, 3],
      ['iphone-390-win-confetti', '?outcome=win&locale=en&confetti=1', { width: 390, height: 844 }, 3, null, 1100],
      ['iphone-390-fail-donor', '?outcome=fail&locale=en&donor=1', { width: 390, height: 844 }, 3],
      ['narrow-320-win', '?outcome=win&locale=en', { width: 320, height: 568 }, 2],
      ['narrow-320-fail', '?outcome=fail&locale=ru', { width: 320, height: 568 }, 2],
      ['desktop-1280-win', '?outcome=win&figma=1', { width: 1280, height: 800 }, 1],
      ['desktop-1280-fail', '?outcome=fail&locale=ru', { width: 1280, height: 800 }, 1]
    ];
    for (const [name, query, viewport, dpr, pairWith, ms] of SECTIONS.has('shots') ? shots : []) {
      const shotPage = await browser.newPage({ viewport, deviceScaleFactor: dpr });
      shotPage.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) report.consoleErrors.push(msg.text()); });
      shotPage.on('pageerror', (error) => report.consoleErrors.push(String(error)));
      await shotPage.goto(`${baseUrl}result1.html${query}`);
      await shotPage.waitForFunction(() => window.__result1?.ready === true, null, { timeout: WAIT_MS });
      await settle(shotPage, ms ?? 3000);
      const png = await capture(shotPage, ms ?? 3000);
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
    if (SECTIONS.has('behaviour')) {
    const w = await open(browser, `${baseUrl}result1.html?outcome=win&locale=en`, { width: 390, height: 844 }, 2, report.consoleErrors);
    await tapNode(w, 'nextButton');
    await reopen(w);
    await tapNode(w, 'retryButton');
    await reopen(w);
    await tapNode(w, 'closeButton');
    await reopen(w);
    await w.mouse.click(12, 12); // the dim outside the composition
    await w.evaluate(() => window.__result1.fastForward(600));
    report.behaviour.win = await w.evaluate(() => [...window.__result1.events]);
    if (report.behaviour.win.join() !== 'next:12,retry:win:12,dismiss:button,dismiss:background') failures.push(`win events ${report.behaviour.win.join()}`);
    await w.close();
    const f = await open(browser, `${baseUrl}result1.html?outcome=fail&locale=en`, { width: 390, height: 844 }, 2, report.consoleErrors);
    await tapNode(f, 'failRetryButton');
    await reopen(f);
    await tapNode(f, 'exitButton');
    await reopen(f);
    await tapNode(f, 'closeButton');
    report.behaviour.fail = await f.evaluate(() => [...window.__result1.events]);
    if (report.behaviour.fail.join() !== 'retry:fail:12,exit:12,dismiss:button') failures.push(`fail events ${report.behaviour.fail.join()}`);
    await f.close();
    }

    // 4. assets
    const requests = async (path) => {
      const p = await browser.newPage();
      const urls = [];
      p.on('request', (req) => urls.push(req.url()));
      await p.goto(`${baseUrl}${path}`);
      await p.waitForFunction(() => window.__result1?.ready === true || window.__confirm !== undefined || window.__lives !== undefined || window.__showcase !== undefined, null, { timeout: WAIT_MS });
      await p.waitForTimeout(1000);
      await p.close();
      return urls;
    };
    const resultFiles = (urls) => RESULT_FILES.filter((f) => urls.some((u) => u.includes(`/result/${f}`))).length;
    for (const [name, path] of SECTIONS.has('assets') ? [['donor', 'index.html'], ['donorResult', 'result1.html?donor=1']] : []) {
      report.assets[name] = resultFiles(await requests(path));
      if (report.assets[name] !== 0) failures.push(`${name} requested ${report.assets[name]} Result files`);
    }
    for (const [name, path] of SECTIONS.has('assets') ? [['style1Result', 'result1.html'], ['style1Map', 'index.html?skin=style1'], ['style1Confirm', 'confirm.html?skin=1'], ['style1Lives', 'lives.html?skin=1']] : []) {
      report.assets[name] = resultFiles(await requests(path));
      if (report.assets[name] !== RESULT_FILES.length) failures.push(`${name} requested ${report.assets[name]}/${RESULT_FILES.length} Result files`);
    }
    if (report.consoleErrors.length) failures.push(`console: ${report.consoleErrors.join(' | ')}`);
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(outDir, SECTIONS.size === 4 ? 'report.json' : `report-${[...SECTIONS].join('-')}.json`), JSON.stringify({ ...report, failures }, null, 2));
  console.log(JSON.stringify({ ...report, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

let url = process.env.SHOWCASE_URL;
let server = null;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5196, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  await run(url.endsWith('/') ? url : `${url}/`);
} finally {
  await server?.close();
}
