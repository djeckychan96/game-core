// Browser proof of OrientationGuard on the ReadyUiOverlay demo (DOM gameplay + Ready UI, declared portrait-only):
//   phone 390×844 (touch)       → no cover, the DOM game and the Ready UI take real taps;
//   rotate the phone → 844×390  → the cover is up: every point hits it, real taps reach neither the DOM game nor Pixi;
//   rotate back                 → no cover, taps work again; the host heard [true, false];
//   phone opened in landscape   → covered from the first frame (no change event needed);
//   desktop 1280×800, 1920×1080, 800×1280 (mouse) → never covered, clicks work.
//   npm run showcase:orientation                               (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:orientation
// Screenshots (SHOTS_DIR, default showcase-shots/): orientation-portrait-390x844.png, orientation-guard-844x390.png,
// orientation-desktop-1280x800.png. Installed Google Chrome (PW_CHANNEL); touch = Playwright `hasTouch` + `isMobile`.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots');
mkdirSync(outDir, { recursive: true });

const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 40000; // SwiftShader runs at ~2 fps: waits synchronize on state, never on a sleep
const fail = (message) => {
  throw new Error(message);
};
const expectEqual = (actual, expected, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

async function openDemo(browser, baseUrl, contextOptions, errors) {
  for (let attempt = 1; ; attempt++) {
    const opened = await openDemoOnce(browser, baseUrl, contextOptions, errors);
    // harness precondition, not a guard check: now and then Playwright + Chrome open a `hasTouch` context with NO touch
    // emulation at all (maxTouchPoints 0, fine pointer) — that page is honestly a desktop, so reopen it before asserting
    const touch = await opened.page.evaluate(() => navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);
    if (!contextOptions.hasTouch || touch) return opened;
    await opened.context.close();
    if (attempt === 3) fail('touch emulation was not applied in 3 attempts');
    console.log(`orientation-guard-check: touch emulation missing in a new context (attempt ${attempt}), reopening`);
  }
}

async function openDemoOnce(browser, baseUrl, contextOptions, errors) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!IGNORED_CONSOLE.some((re) => re.test(text))) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));
  await page.goto(new URL('overlay.html', baseUrl).href);
  await page.waitForFunction('window.__overlayDemo && window.__overlayDemo.frames > 2', null, { timeout: WAIT_MS });
  return { context, page };
}

// What the page says about the guard, the pointer media features and the counters; `points` = what the browser hit-tests there.
const read = (page, points = []) =>
  page.evaluate((pts) => {
    const d = window.__overlayDemo;
    const el = d.guard.element;
    const style = el ? getComputedStyle(el) : null;
    const rect = el ? el.getBoundingClientRect() : null;
    const name = (node) => (el && el.contains(node) ? 'guard' : node?.closest('[data-game-core]') ? 'overlay' : node?.id || node?.tagName || null);
    return {
      viewport: [innerWidth, innerHeight],
      coarse: matchMedia('(pointer: coarse)').matches,
      touch: [matchMedia('(any-pointer: coarse)').matches, matchMedia('(hover: none)').matches, navigator.maxTouchPoints],
      fine: matchMedia('(pointer: fine)').matches,
      landscape: matchMedia('(orientation: landscape)').matches,
      blocked: d.guard.blocked,
      changes: [...d.guardChanges],
      display: style?.display ?? null,
      box: rect ? [rect.left, rect.top, rect.width, rect.height] : null,
      position: style?.position ?? null,
      zIndex: style?.zIndex ?? null,
      text: el?.textContent ?? null,
      hits: pts.map(([x, y]) => name(document.elementFromPoint(x, y))),
      counters: { domClicks: d.counters.domClicks, pixiTaps: d.counters.pixiTaps, gameSaw: d.counters.gameSaw.length }
    };
  }, points);

const centerOf = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};
// the demo's PIXI button sits at (width − 80, height / 2)
const pixiButton = (width, height) => [width - 80, height / 2];

async function phone(browser, baseUrl, errors) {
  const { context, page } = await openDemo(browser, baseUrl, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, errors);
  try {
    // 1. portrait: no cover, real taps reach the DOM game and the Ready UI
    let state = await read(page, [await centerOf(page, '#dom-tap'), await centerOf(page, '#card')]);
    expectEqual([state.coarse, state.touch, state.landscape, state.blocked, state.display, state.hits], [true, [true, true, 1], false, false, 'none', ['dom-tap', 'card']], 'phone portrait');
    await page.touchscreen.tap(...(await centerOf(page, '#dom-tap')));
    await page.waitForFunction('window.__overlayDemo.counters.domClicks === 1', null, { timeout: WAIT_MS });
    await page.touchscreen.tap(...pixiButton(390, 844));
    await page.waitForFunction('window.__overlayDemo.counters.pixiTaps === 1', null, { timeout: WAIT_MS });
    const portraitFrames = await page.evaluate(() => window.__overlayDemo.frames);
    await page.waitForFunction(`window.__overlayDemo.frames > ${portraitFrames + 2}`, null, { timeout: WAIT_MS });
    await page.screenshot({ path: resolve(outDir, 'orientation-portrait-390x844.png') });

    // 2. rotate to landscape: the cover is up over the whole viewport, above the overlay canvas and the DOM game
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction('window.__overlayDemo.guard.blocked === true', null, { timeout: WAIT_MS });
    const grid = [[1, 1], [422, 195], [842, 388], [1, 388], [842, 1], [422, 20]];
    const targets = [await centerOf(page, '#dom-tap'), await centerOf(page, '#card'), pixiButton(844, 390)];
    const before = await read(page, [...grid, ...targets]);
    expectEqual(
      [before.coarse, before.landscape, before.blocked, before.changes, before.display, before.position, before.box, before.zIndex, before.text],
      [true, true, true, [true], 'flex', 'fixed', [0, 0, 844, 390], '2147483647', 'Поверните устройство'], 'phone rotated to landscape');
    expectEqual(before.hits, Array(grid.length + targets.length).fill('guard'), 'every point hits the cover');
    for (const point of targets) await page.touchscreen.tap(...point);
    await page.mouse.click(...targets[0]); // a synthesized mouse click as well
    const frames = await page.evaluate(() => window.__overlayDemo.frames);
    await page.waitForFunction(`window.__overlayDemo.frames > ${frames + 2}`, null, { timeout: WAIT_MS }); // Pixi had frames to react
    const after = await read(page);
    expectEqual(after.counters, before.counters, 'taps on the cover reach neither the DOM game, its delegated listener, nor the Ready UI');
    await page.screenshot({ path: resolve(outDir, 'orientation-guard-844x390.png') });

    // 3. rotate back: the cover hides, the game takes taps again
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction('window.__overlayDemo.guard.blocked === false', null, { timeout: WAIT_MS });
    state = await read(page, [await centerOf(page, '#dom-tap')]);
    expectEqual([state.changes, state.display, state.hits], [[true, false], 'none', ['dom-tap']], 'phone back in portrait');
    await page.touchscreen.tap(...(await centerOf(page, '#dom-tap')));
    await page.waitForFunction('window.__overlayDemo.counters.domClicks === 2', null, { timeout: WAIT_MS });

    // 4. a few more rotations: still one cover element
    for (const [w, h] of [[844, 390], [390, 844], [844, 390], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(`window.__overlayDemo.guard.blocked === ${w > h}`, null, { timeout: WAIT_MS });
    }
    expectEqual(await page.evaluate(() => [document.querySelectorAll('[data-game-core="orientation-guard"]').length, window.__overlayDemo.guardChanges]), [1, [true, false, true, false, true, false]], 'repeated rotations');
  } finally {
    await context.close();
  }
}

async function phoneOpenedInLandscape(browser, baseUrl, errors) {
  const { context, page } = await openDemo(browser, baseUrl, { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, errors);
  try {
    const state = await read(page, [[422, 195]]);
    expectEqual([state.blocked, state.changes, state.display, state.hits], [true, [], 'flex', ['guard']], 'phone opened in landscape');
  } finally {
    await context.close();
  }
}

async function desktop(browser, baseUrl, errors) {
  const { context, page } = await openDemo(browser, baseUrl, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, errors);
  try {
    const results = [];
    for (const [w, h] of [[1280, 800], [1920, 1080], [800, 1280], [1280, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(`innerWidth === ${w} && window.__overlayDemo.overlay.layout.width === ${w}`, null, { timeout: WAIT_MS });
      const state = await read(page, [await centerOf(page, '#dom-tap')]);
      results.push([state.viewport, state.fine, state.coarse, state.landscape, state.blocked, state.display, state.hits[0]]);
    }
    expectEqual(results, [
      [[1280, 800], true, false, true, false, 'none', 'dom-tap'],
      [[1920, 1080], true, false, true, false, 'none', 'dom-tap'],
      [[800, 1280], true, false, false, false, 'none', 'dom-tap'],
      [[1280, 800], true, false, true, false, 'none', 'dom-tap']
    ], 'desktop sizes (mouse)');
    await page.mouse.click(...(await centerOf(page, '#dom-tap')));
    await page.waitForFunction('window.__overlayDemo.counters.domClicks === 1', null, { timeout: WAIT_MS });
    expectEqual(await page.evaluate(() => window.__overlayDemo.guardChanges), [], 'desktop never reported a change');
    const frames = await page.evaluate(() => window.__overlayDemo.frames);
    await page.waitForFunction(`window.__overlayDemo.frames > ${frames + 2}`, null, { timeout: WAIT_MS });
    await page.screenshot({ path: resolve(outDir, 'orientation-desktop-1280x800.png') });
  } finally {
    await context.close();
  }
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  try {
    await phone(browser, baseUrl, errors);
    await phoneOpenedInLandscape(browser, baseUrl, errors);
    await desktop(browser, baseUrl, errors);
  } finally {
    await browser.close();
  }
  if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
  console.log(`orientation-guard-check: OK — phone portrait / rotated / back / opened in landscape, desktop 1280×800 / 1920×1080 / 800×1280 never covered; shots in ${outDir}`);
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
  await run(url);
} catch (error) {
  console.error(`orientation-guard-check: FAILED — ${error.message}`);
  process.exitCode = 1;
} finally {
  await server?.close();
}
