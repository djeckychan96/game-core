// ReadyUiOverlay production proof, with Playwright on the installed Google Chrome (the sandboxed in-app browser has no
// WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase:overlay                                   (starts its own Vite server on a free port)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:overlay   (against a running `npm run showcase`)
//
// One bounded smoke of examples/pixi-showcase/overlay.html — the Ready UI over plain DOM gameplay, real input only:
//   1. one frame source: every requestAnimationFrame on the page is the host's loop, none comes from PixiJS; Pixi's
//      app / system / shared tickers are stopped while the UI still animates;
//   2. 'ui' mode: a DOM button click and a DOM card drag pass through the overlay; the HUD region and a Pixi button
//      take their taps and the gameplay DOM sees nothing of them;
//   3. a Ready UI window opened by a real gear tap makes the overlay modal: the DOM button is dead until it closes;
//   4. 'passthrough': the gear no longer reacts, the gameplay gets the tap;
//   5. host-called resize (orientation flip) and a repeat-safe dispose that leaves the gameplay DOM working.
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

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  try {
    await check(browser, baseUrl);
  } finally {
    await browser.close();
  }
}

async function check(browser, baseUrl) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // who asks for animation frames: the host loop (overlayDemo.ts), PixiJS, or anything else served by the page
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__raf = { host: 0, pixi: 0, other: 0 };
    window.requestAnimationFrame = (callback) => {
      const stack = String(new Error().stack);
      if (/overlayDemo/.test(stack)) window.__raf.host++;
      else if (/pixi/i.test(stack)) window.__raf.pixi++;
      else if (/https?:\/\//.test(stack)) window.__raf.other++; // (Playwright's own polling has no page URL in its stack)
      return raf(callback);
    };
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!IGNORED_CONSOLE.some((re) => re.test(text))) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));

  const read = () =>
    page.evaluate(() => {
      const d = window.__overlayDemo;
      const hit = d.overlay.hitLayer.style;
      return {
        frames: d.frames, raf: { ...window.__raf }, tickers: d.tickers(), counters: JSON.parse(JSON.stringify(d.counters)),
        mode: d.overlay.inputMode, blocking: d.overlay.isBlocking, settings: d.settings.state, layout: d.overlay.layout,
        hit: { pointerEvents: hit.pointerEvents, clipPath: hit.clipPath },
        canvas: { width: d.overlay.canvas.width, height: d.overlay.canvas.height, pointerEvents: getComputedStyle(d.overlay.canvas).pointerEvents },
        lastChild: document.getElementById('game').lastElementChild === d.overlay.layer,
        card: { left: document.getElementById('card').offsetLeft, top: document.getElementById('card').offsetTop }
      };
    });
  const at = (expr) => page.evaluate(`(() => { const p = (${expr}).getGlobalPosition(); return { x: p.x, y: p.y }; })()`);
  const waitFor = (expr, what) => page.waitForFunction(expr, null, { timeout: WAIT_MS }).catch(() => fail(`timed out: ${what}`));
  // what the GAMEPLAY elements received between two reads (events the Ready UI took are recorded as ':overlay')
  const sawSince = (before, after) => after.counters.gameSaw.slice(before.counters.gameSaw.length).filter((entry) => !entry.endsWith(':overlay'));
  const tookSince = (before, after) => after.counters.gameSaw.slice(before.counters.gameSaw.length).filter((entry) => entry.endsWith(':overlay')).length;

  await page.goto(new URL('overlay.html', baseUrl).href, { waitUntil: 'load' });
  await waitFor('window.__overlayDemo && window.__overlayDemo.frames >= 3', 'overlay demo boot');

  // 1. mount + one frame source
  const boot = await read();
  expectEqual(boot.lastChild, true, 'overlay layer is the last child of the host container');
  expectEqual(boot.canvas, { width: 780, height: 1688, pointerEvents: 'none' }, 'render canvas: DPR 2 backing size, no input');
  expectEqual(boot.layout, { width: 390, height: 844, resolution: 2, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, 'layout');
  expectEqual(boot.tickers, { app: false, system: false, shared: false, systemAutoStart: false }, 'Pixi tickers stopped');
  expectEqual([boot.mode, boot.blocking, boot.hit.pointerEvents], ['ui', false, 'auto'], "'ui' mode");
  if (!/^path\("M ?0 0 ?h ?390 ?v/.test(boot.hit.clipPath)) fail(`'ui' clip-path lacks the HUD region: ${boot.hit.clipPath}`);

  // 2. 'ui' mode: gameplay input passes through the overlay — a real click on the DOM button, a real drag of the DOM card
  const domTap = await page.locator('#dom-tap').boundingBox();
  const domTapAt = { x: domTap.x + domTap.width / 2, y: domTap.y + domTap.height / 2 };
  await page.mouse.click(domTapAt.x, domTapAt.y);
  await page.mouse.move(100, 360);
  await page.mouse.down();
  await page.mouse.move(160, 420, { steps: 4 });
  await page.mouse.up();
  const passed = await read();
  expectEqual([passed.counters.domClicks, passed.counters.drags], [1, 1], 'DOM click + DOM drag went through the overlay');
  expectEqual(passed.card, { left: 120, top: 360 }, 'the card followed the drag');

  //    … while the Ready UI takes its own taps: the gameplay DOM sees nothing of a tap on a Pixi button or the HUD bar
  const bonusAt = await at('window.__overlayDemo.bonus');
  await page.mouse.click(bonusAt.x, bonusAt.y);
  await waitFor('window.__overlayDemo.counters.pixiTaps === 1', 'the Pixi button tap (a Container region)');
  await page.mouse.click(195, 10); // HUD bar, between the buttons
  const claimed = await read();
  expectEqual([sawSince(passed, claimed), tookSince(passed, claimed)], [[], 4], 'the Ready UI took both taps (pointerdown + click each), the gameplay elements saw nothing');

  // 3. a real gear tap opens the Ready UI settings window → modal: the gameplay below is dead until it closes
  const gearAt = await at('window.__overlayDemo.hud.gear');
  await page.mouse.click(gearAt.x, gearAt.y);
  await waitFor("window.__overlayDemo.settings.state === 'shown' && window.__overlayDemo.overlay.isBlocking", 'settings window open + overlay modal');
  await page.mouse.click(domTapAt.x, domTapAt.y);
  await page.mouse.click(100, 400);
  const modal = await read();
  expectEqual([modal.hit.pointerEvents, modal.hit.clipPath, modal.mode], ['auto', 'none', 'ui'], 'modal hit layer covers everything (host mode untouched)');
  expectEqual([modal.counters.domClicks, sawSince(claimed, modal)], [1, []], 'modal blocks the gameplay DOM');
  if (modal.raf.pixi !== 0 || modal.raf.other !== 0 || modal.raf.host < 3) fail(`frame sources: ${JSON.stringify(modal.raf)}`);
  expectEqual(modal.tickers, boot.tickers, 'Pixi tickers still stopped after animations');
  await page.screenshot({ path: resolve(outDir, 'overlay-demo-modal.png') });

  const closeAt = await at('window.__overlayDemo.settings.closeButton');
  await page.mouse.click(closeAt.x, closeAt.y);
  await waitFor("window.__overlayDemo.settings.state === 'hidden' && !window.__overlayDemo.overlay.isBlocking", 'settings closed + gameplay released');
  await page.mouse.click(domTapAt.x, domTapAt.y);
  expectEqual((await read()).counters.domClicks, 2, 'gameplay works again after the modal');

  // 4. 'passthrough': the Ready UI is display-only, the gameplay gets even the taps over the gear
  await page.evaluate(() => window.__overlayDemo.overlay.setInputMode('passthrough'));
  const beforePass = await read();
  await page.mouse.click(gearAt.x, gearAt.y);
  await page.waitForFunction('window.__overlayDemo.frames > ' + beforePass.frames + ' + 2', null, { timeout: WAIT_MS });
  const pass = await read();
  expectEqual([pass.settings, pass.hit.pointerEvents, sawSince(beforePass, pass)], ['hidden', 'none', ['pointerdown:board', 'click:board']], 'passthrough');
  await page.evaluate(() => window.__overlayDemo.overlay.setInputMode('ui'));

  // 5. host-called resize (the demo's own window listener → layout() → overlay.resize()), then dispose twice
  await page.setViewportSize({ width: 844, height: 390 });
  await waitFor('window.__overlayDemo.overlay.layout.width === 844', 'orientation flip');
  const flipped = await read();
  expectEqual([flipped.layout.height, flipped.canvas.width, flipped.canvas.height], [390, 1688, 780], 'landscape layout + backing size');
  if (!/^path\("M ?0 0 ?h ?844 ?v/.test(flipped.hit.clipPath)) fail(`regions not re-read on resize: ${flipped.hit.clipPath}`);

  const disposed = await page.evaluate(() => {
    const d = window.__overlayDemo;
    d.overlay.dispose();
    d.overlay.dispose();
    d.overlay.update(16);
    d.overlay.resize();
    const game = document.getElementById('game');
    return { children: [...game.children].map((el) => el.id || el.tagName), canvases: document.querySelectorAll('canvas').length, tickers: d.tickers(), disposed: d.overlay.disposed };
  });
  expectEqual(disposed, { children: ['board', 'card', 'dom-tap', 'status'], canvases: 0, tickers: { app: false, system: false, shared: false, systemAutoStart: true }, disposed: true }, 'dispose');
  await page.setViewportSize({ width: 390, height: 844 });
  const domTapAfter = await page.locator('#dom-tap').boundingBox();
  await page.mouse.click(domTapAfter.x + domTapAfter.width / 2, domTapAfter.y + domTapAfter.height / 2);
  expectEqual(await page.evaluate(() => window.__overlayDemo.counters.domClicks), 3, 'gameplay DOM is intact after dispose');

  if (errors.length) fail(`console errors:\n${errors.join('\n')}`);
  console.log(`overlay-demo-check: OK — host rAF ${modal.raf.host}, pixi rAF ${modal.raf.pixi}, other rAF ${modal.raf.other}; ui pass-through, claimed regions, modal, passthrough, resize, dispose`);
}

let server = null;
let url = process.env.SHOWCASE_URL;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5190, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}
try {
  await run(url);
} catch (error) {
  console.error(`overlay-demo-check: FAILED — ${error.message}`);
  process.exitCode = 1;
} finally {
  await server?.close();
}
