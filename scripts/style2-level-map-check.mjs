// Style 2 LevelMap screen proof (Figma theme_light_3 screen_gameplay_pc 8:23174), with Playwright on the installed
// Google Chrome (the sandboxed in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase:style2                                    (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style2   (against a running `npm run showcase`)
//
// Page: examples/pixi-showcase/style2.html. Source of truth: docs/figma/style2-level-map-screen (figma.json + Figma's
// render of 8:23174, 0.5x). Writes showcase-shots/style2/ (git-ignored):
//   1. parity — 1422 × 800 @1x is the 4168 × 2344 frame at its own aspect: the capture is compared with Figma's render
//      scaled to it, per region (mean |Δ| of RGB). Static art regions are enforced; the regions with Figma sample
//      content (node stars / numbers) or a documented layout difference (nav slots) are reported only;
//   2. shots — 1280 × 800 @1x next to the Figma render cropped to the same width (HUD left-anchored), 390 × 844 @2 and
//      320 × 568 @2 (runtime demo data);
//   3. behaviour — drag (slow: snaps back), fling (fast: projects past the release point), culling (off-screen nodes
//      hidden), real clicks on a completed / a locked level, PLAY, HOME and the locked nav item;
//   4. assets — the donor and Style 1 pages never request a Style 2 file or its font; no unexpected console error.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const figmaDir = resolve(rootDir, 'docs/figma/style2-level-map-screen');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots/style2');
mkdirSync(outDir, { recursive: true });
const figma = JSON.parse(readFileSync(resolve(figmaDir, 'figma.json'), 'utf8'));
const reference = 'data:image/webp;base64,' + readFileSync(resolve(figmaDir, figma.source.reference.file)).toString('base64');
const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 90000; // SwiftShader: waits synchronize on state, never on a sleep
const FRAME = { width: 4168, height: 2344 };
const fail = (message) => { throw new Error(message); };
const save = (name, dataUrl) => writeFileSync(resolve(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

// Parity regions in Figma frame units. `max` = enforced mean |Δ| (0..255); null = reported only.
const REGIONS = {
  skyLeft: { x: 100, y: 420, w: 1500, h: 1500, max: 4 }, // bg_2 under nothing (clouds, translucent stars)
  skyRight: { x: 2600, y: 420, w: 1450, h: 1500, max: 4 },
  hud: { x: 60, y: 60, w: 1802, h: 236, max: 12 }, // three bars, figma=1 values; runtime text + Core's thin-space format
  rail: { x: 2046, y: 610, w: 80, h: 70, max: 16 }, // the light ray between two locked nodes
  play: { x: 1809, y: 1622, w: 550, h: 280, max: 10 }, // PLAY / Level 38 (figma=1: current = 38)
  navPanel: { x: 120, y: 2070, w: 1000, h: 270, max: 4 }, // the panel away from the items
  navItems: { x: 1270, y: 1948, w: 1620, h: 396, max: null }, // slots centred on the frame (Figma: on the group's box)
  currentNode: { x: 1892, y: 1068, w: 384, h: 384, max: null }, // Figma sample: 2 earned stars and "3"
  lockedNodes: { x: 1937, y: 312, w: 288, h: 666, max: null } // Figma sample: a gold star and "25"
};

async function waitReady(page) {
  await page.waitForFunction(() => window.__style2?.ready === true, null, { timeout: WAIT_MS });
  // two settled frames: the first render of every texture happened
  await page.evaluate(() => new Promise((done) => { const t = window.__style2.app.ticker; let n = 0; const f = () => { if (++n >= 3) { t.remove(f); done(); } }; t.add(f); }));
}

async function capture(page) {
  return page.evaluate(() => {
    const { app } = window.__style2;
    app.renderer.render(app.stage);
    return app.canvas.toDataURL('image/png');
  });
}

async function parity(page) {
  return page.evaluate(async ({ reference, regions, frame }) => {
    const { app } = window.__style2;
    app.renderer.render(app.stage);
    const w = app.screen.width;
    const h = app.screen.height;
    const shot = document.createElement('canvas');
    shot.width = w;
    shot.height = h;
    const sctx = shot.getContext('2d', { willReadFrequently: true });
    sctx.fillStyle = '#1b85e8';
    sctx.fillRect(0, 0, w, h);
    sctx.drawImage(app.canvas, 0, 0, w, h);
    const ref = document.createElement('canvas');
    ref.width = w;
    ref.height = h;
    const rctx = ref.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    img.src = reference;
    await img.decode();
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(img, 0, 0, w, h);
    const a = sctx.getImageData(0, 0, w, h).data;
    const b = rctx.getImageData(0, 0, w, h).data;
    const k = h / frame.height;
    const out = {};
    for (const [name, r] of Object.entries(regions)) {
      const x0 = Math.round(r.x * k), y0 = Math.round(r.y * k), x1 = Math.round((r.x + r.w) * k), y1 = Math.round((r.y + r.h) * k);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) { sum += Math.abs(a[i + c] - b[i + c]); n++; }
      }
      out[name] = { box: [x0, y0, x1 - x0, y1 - y0], mean: +(sum / Math.max(1, n)).toFixed(2), max: r.max };
    }
    let total = 0;
    for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) total += Math.abs(a[i + c] - b[i + c]);
    // side by side: ours | Figma
    const side = document.createElement('canvas');
    side.width = w * 2;
    side.height = h;
    const x = side.getContext('2d');
    x.drawImage(shot, 0, 0);
    x.drawImage(ref, w, 0);
    return { regions: out, overallMean: +(total / (w * h * 3)).toFixed(2), side: side.toDataURL('image/png') };
  }, { reference, regions: REGIONS, frame: FRAME });
}

/** Ours at 1280 × 800 next to Figma's render at the same height, cropped to the centre 1280 px (its HUD shifts with the left edge). */
async function sideBySide1280(page) {
  return page.evaluate(async ({ reference, frame }) => {
    const { app } = window.__style2;
    const w = app.screen.width;
    const h = app.screen.height;
    const k = h / frame.height;
    const side = document.createElement('canvas');
    side.width = w * 2;
    side.height = h;
    const x = side.getContext('2d');
    x.fillStyle = '#1b85e8';
    x.fillRect(0, 0, w, h);
    // copy the frame right after rendering it: the WebGL drawing buffer is not preserved across a task
    app.renderer.render(app.stage);
    x.drawImage(app.canvas, 0, 0, w, h);
    const img = new Image();
    img.src = reference;
    await img.decode();
    const refW = frame.width * k;
    x.drawImage(img, w + (w - refW) / 2, 0, refW, h);
    x.clearRect(w * 2, 0, 1, h);
    return side.toDataURL('image/png');
  }, { reference, frame: FRAME });
}

/** Synthetic pointer drag on the canvas with real time between moves (the host ticker paused so SwiftShader frames cannot coalesce them). */
async function drag(page, { dy, steps, gapMs, holdMs }) {
  return page.evaluate(async ({ dy, steps, gapMs, holdMs }) => {
    const { app, screen } = window.__style2;
    const canvas = app.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + 260; // the empty ribbon beside the nodes, inside the map
    const y0 = rect.top + screen.map.focusPoint.y - 40;
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const fire = (type, y) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    const before = screen.map.focusLevel;
    app.ticker.stop();
    fire('pointerdown', y0);
    for (let i = 1; i <= steps; i++) {
      await sleep(gapMs);
      fire('pointermove', y0 + (dy * i) / steps);
    }
    await sleep(holdMs);
    fire('pointerup', y0 + dy);
    const released = screen.map.focusLevel;
    app.ticker.start();
    return { before, released };
  }, { dy, steps, gapMs, holdMs });
}

async function settle(page) {
  await page.waitForFunction(() => {
    const map = window.__style2.screen.map;
    return map.scrollHandle === null && Math.abs(map.levelScreenY(map.focusLevel) - map.focusPoint.y) < 0.5;
  }, null, { timeout: WAIT_MS });
  return page.evaluate(() => window.__style2.screen.map.focusLevel);
}

async function click(page, globalPoint) {
  await page.mouse.click(globalPoint.x, globalPoint.y);
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const report = { parity: null, shots: [], behaviour: {}, assets: {}, consoleErrors: [] };
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const watch = (page, label) => {
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) report.consoleErrors.push(`${label}: ${m.text()}`); });
    page.on('pageerror', (e) => report.consoleErrors.push(`${label}: pageerror ${e.message}`));
  };
  try {
    // 1. parity at the frame's own aspect
    {
      const page = await browser.newPage({ viewport: { width: 1422, height: 800 }, deviceScaleFactor: 1 });
      watch(page, 'parity');
      await page.goto(new URL('style2.html?figma=1', baseUrl).href);
      await waitReady(page);
      const result = await parity(page);
      save('style2-parity-1422x800-vs-figma.png', result.side);
      report.parity = { overallMean: result.overallMean, regions: result.regions };
      for (const [name, r] of Object.entries(result.regions)) if (r.max !== null) check(r.mean <= r.max, `parity ${name}: mean |Δ| ${r.mean} > ${r.max}`);
      await page.close();
    }
    // 2. shots
    for (const [w, h, dpr, query, name] of [[1280, 800, 1, '?figma=1', 'style2-1280x800.png'], [390, 844, 2, '', 'style2-390x844@2.png'], [320, 568, 2, '', 'style2-320x568@2.png'], [390, 844, 2, '?locale=ru', 'style2-390x844@2-ru.png']]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      watch(page, name);
      await page.goto(new URL('style2.html' + query, baseUrl).href);
      await waitReady(page);
      save(name, await capture(page));
      if (w === 1280) save('style2-1280x800-vs-figma.png', await sideBySide1280(page));
      const geometry = await page.evaluate(() => {
        const { screen, app } = window.__style2;
        const play = screen.play.getBounds();
        return { width: app.screen.width, height: app.screen.height, hudBottom: screen.hud.barHeight, navTop: screen.nav.top, playTop: play.y, playBottom: play.y + play.height, playLeft: play.x, playRight: play.x + play.width, focusY: screen.map.focusPoint.y };
      });
      report.shots.push({ name, geometry });
      check(geometry.playBottom <= geometry.navTop, `${name}: PLAY overlaps the nav panel`);
      check(geometry.playLeft >= 0 && geometry.playRight <= geometry.width, `${name}: PLAY outside the width`);
      check(geometry.hudBottom < geometry.focusY && geometry.focusY < geometry.playTop, `${name}: the focus is not between the HUD and PLAY`);
      await page.close();
    }
    // 3. behaviour (390 × 844, runtime data)
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      watch(page, 'behaviour');
      await page.goto(new URL('style2.html', baseUrl).href);
      await waitReady(page);
      const s = await page.evaluate(() => window.__style2.screen.map.contentScale);
      const gapPx = 402 * s;
      // slow drag 0.3 level, held still before release: no fling, snaps back
      const slow = await drag(page, { dy: 0.3 * gapPx, steps: 6, gapMs: 40, holdMs: 200 });
      const slowEnd = await settle(page);
      // fast flick 0.4 level: released short of the next level, the fling projection carries it on
      const flick = await drag(page, { dy: 0.4 * gapPx, steps: 4, gapMs: 12, holdMs: 0 });
      const flickEnd = await settle(page);
      // a longer drag to 1.3 levels and a hold: lands on the nearest level
      const far = await drag(page, { dy: 1.3 * gapPx, steps: 10, gapMs: 30, holdMs: 200 });
      const farEnd = await settle(page);
      report.behaviour.drag = { slow: { ...slow, end: slowEnd }, flick: { ...flick, end: flickEnd }, far: { ...far, end: farEnd } };
      check(slowEnd === slow.before, `drag: a slow 0.3-level drag did not snap back (${slow.before} → ${slowEnd})`);
      check(flickEnd > flick.released, `fling: a fast flick did not project past its release level (${flick.released} → ${flickEnd})`);
      check(farEnd === far.before + 1, `snap: a held 1.3-level drag did not snap to the nearest level (${far.before} → ${farEnd})`);
      // culling: built nodes off the map region are hidden
      const culling = await page.evaluate(() => {
        const map = window.__style2.screen.map;
        const nodes = [...map.nodes.values()];
        return { built: nodes.length, visible: nodes.filter((n) => n.root.visible).length };
      });
      report.behaviour.culling = culling;
      check(culling.visible > 0 && culling.visible < culling.built, `culling: ${culling.visible} of ${culling.built} built nodes visible`);
      // back to the current level, then real clicks
      await page.evaluate(() => window.__style2.screen.map.scrollToLevel(38, false));
      await settle(page);
      const points = await page.evaluate(() => {
        const { screen } = window.__style2;
        const node = (level) => screen.map.getNodeContainer(level).getGlobalPosition();
        const navItem = (id) => { const item = screen.nav.getItemContainer(id); const p = item.getGlobalPosition(); return { x: p.x, y: p.y + 120 * item.worldTransform.d }; };
        return { current: node(38), locked: node(39), play: screen.play.getGlobalPosition(), home: navItem('home'), events: navItem('events') };
      });
      const events = () => page.evaluate(() => window.__style2.events.filter((e) => !e.startsWith('focus:')));
      await click(page, points.current);
      await page.waitForFunction(() => window.__style2.events.includes('level:38:current'), null, { timeout: WAIT_MS });
      await click(page, points.locked);
      await page.waitForFunction(() => window.__style2.events.includes('locked-level:39'), null, { timeout: WAIT_MS });
      await click(page, points.play);
      await page.waitForFunction(() => window.__style2.events.includes('play:38'), null, { timeout: WAIT_MS });
      await click(page, points.home);
      await page.waitForFunction(() => window.__style2.events.includes('nav:home'), null, { timeout: WAIT_MS });
      await click(page, points.events);
      await page.waitForFunction(() => window.__style2.events.includes('nav-locked:events'), null, { timeout: WAIT_MS });
      const log = await events();
      const selected = await page.evaluate(() => window.__style2.screen.nav.selectedId);
      report.behaviour.clicks = { log, selected };
      check(!log.includes('nav:events'), 'the locked nav item activated');
      check(selected === 'home', `the host's routing did not select HOME (${selected})`);
      save('style2-behaviour-after-home.png', await capture(page));
      await page.close();
    }
    // 4. assets: the donor and Style 1 showcase pages never request a Style 2 file or the Carlito font
    for (const [query, label] of [['', 'donor'], ['?skin=style1', 'style-1']]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      watch(page, label);
      const requested = [];
      page.on('request', (request) => requested.push(request.url()));
      await page.goto(new URL('index.html' + query, baseUrl).href);
      await page.waitForFunction(() => Boolean(window.__showcase?.map), null, { timeout: WAIT_MS });
      const style2 = requested.filter((url) => url.includes('/pixi-ui/style2/') || url.includes('Carlito'));
      report.assets[label] = { requests: requested.filter((url) => url.includes('/pixi-ui/')).length, style2 };
      check(style2.length === 0, `${label} page requested Style 2 files: ${style2.join(', ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  check(report.consoleErrors.length === 0, `console errors: ${report.consoleErrors.join(' | ')}`);
  report.failures = failures;
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error('style2-level-map-check: FAILED\n  ' + failures.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log(`style2-level-map-check: OK (${outDir})`);
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
