// Browser proof of the QA Panel + machine API on the showcase QA demo (examples/pixi-showcase/qa.html):
//   automation: wait for GameCoreQA.ready() (no sleep) → run commands → assert on getState() (JSON, no UI text);
//   network LATENCY / OFFLINE act on a real SaveGate write through the QA platform wrapper;
//   the panel: opened by the API, real clicks on its buttons go through the SAME run() (state changes), destructive
//   reset needs the second tap; fits 390×844 (touch) and 1280×800 with no horizontal overflow.
//   npm run showcase:qa                                (starts its own Vite server on a free port)
// Screenshots (SHOTS_DIR, default showcase-shots/): qa-panel-390x844.png, qa-panel-1280x800.png. Installed Chrome (PW_CHANNEL).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SHOTS_DIR ?? resolve(rootDir, 'showcase-shots');
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = [/favicon\.ico/i];
const fail = (message) => {
  throw new Error(message);
};
const expectEqual = (actual, expected, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

async function scenario(browser, baseUrl, contextOptions, shot) {
  const errors = [];
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));
  await page.goto(new URL('qa.html', baseUrl).href);

  // 1. wait for the QA API to be settled — a real state, never a sleep
  await page.waitForFunction(() => window.GameCoreQA !== undefined);
  const booted = await page.evaluate(() => window.GameCoreQA.ready());
  expectEqual([booted.ready, booted.open, booted.meta.platform, booted.meta.language], [true, false, 'DEV', 'ru'], 'booted state');
  expectEqual(await page.evaluate(() => document.querySelector('[data-game-core-qa]')), null, 'panel closed by default');

  // 2–5. commands through the machine API, assertions on the JSON snapshot
  const results = await page.evaluate(async () => {
    const qa = window.GameCoreQA;
    return [
      await qa.run('lives.set', { value: 1 }),
      await qa.run('level.set', { value: 10 }),
      await qa.run('timeScale.set', { value: 2 }),
      await qa.run('lives.set', { value: 9 }),
      await qa.run('reset.gameplay'),
      await qa.run('network.set', { mode: 'latency', latencyMs: 300 })
    ];
  });
  expectEqual(results.map((r) => (r.ok ? r.value : r.error.code)), [1, '10', 2, 'invalid_params', 'confirm_required', { mode: 'latency', latencyMs: 300, failNextArmed: false, calls: 1, faulted: 0, scope: 'core-platform' }], 'command results');
  // a LATENCY write really waits, then succeeds; OFFLINE refuses the same write (the SaveGate answers storage_refused)
  const saved = await page.evaluate(async () => {
    const t0 = performance.now();
    const latency = await window.GameCoreQA.run('save');
    const waited = performance.now() - t0;
    await window.GameCoreQA.run('network.set', { mode: 'offline' });
    const offline = await window.GameCoreQA.run('save');
    await window.GameCoreQA.run('network.set', { mode: 'normal' });
    return { latency: latency.value, waited, offline: offline.value };
  });
  if (!(saved.waited >= 290)) fail(`LATENCY did not delay the write (${saved.waited} ms)`);
  expectEqual([saved.latency, saved.offline], [{ ok: true, reason: null }, { ok: false, reason: 'storage_refused' }], 'save through the QA platform');
  const state = await page.evaluate(() => window.GameCoreQA.getState());
  expectEqual([state.values, state.timeScale, state.network.mode, state.network.faulted], [{ coins: 120, lives: 1, level: '10', unlockAll: false }, 2, 'normal', 1], 'snapshot after commands');
  if (JSON.stringify(state).includes('demo-token')) fail('a purchase token leaked into the state');
  await page.waitForFunction(() => window.GameCoreQA.getState().metrics.fps !== null);

  // the panel: opened by the API, driven by real clicks that go through the same run()
  await page.evaluate(() => window.GameCoreQA.open());
  const panel = page.locator('[data-game-core-qa]');
  await panel.waitFor();
  await panel.locator('[data-qa="inc-coins"]').click();
  await page.waitForFunction(() => window.GameCoreQA.getState().values.coins === 130);
  await panel.locator('[data-qa="timeScale-0.5"]').click();
  await page.waitForFunction(() => window.GameCoreQA.getState().timeScale === 0.5);
  await panel.locator('[data-qa="run-reset.gameplay"]').click();
  if ((await page.evaluate(() => window.GameCoreQA.getState().values.lives)) !== 1) fail('a destructive reset ran without the second tap');
  await panel.locator('[data-qa="confirm-reset.gameplay"]').click();
  await page.waitForFunction(() => window.GameCoreQA.getState().values.lives === 5 && window.GameCoreQA.getState().values.level === '1');
  await panel.locator('[data-qa="input-level"]').selectOption('7');
  await panel.locator('[data-qa="set-level"]').click();
  await page.waitForFunction(() => window.GameCoreQA.getState().values.level === '7');
  await panel.locator('[data-qa="network-latency"]').click();
  await page.waitForFunction(() => window.GameCoreQA.getState().network.mode === 'latency');
  await page.waitForFunction(() => /FPS\s+\d/.test(document.querySelector('[data-qa="metrics"]').textContent));

  const layout = await page.evaluate(() => {
    const el = document.querySelector('[data-game-core-qa]');
    const r = el.getBoundingClientRect();
    return { viewport: [innerWidth, innerHeight], box: [r.left, r.top, r.width, r.height], scrollW: document.documentElement.scrollWidth, overflowX: el.scrollWidth - el.clientWidth };
  });
  if (layout.box[0] < 0 || layout.box[0] + layout.box[2] > layout.viewport[0] + 0.5) fail(`panel outside the viewport: ${JSON.stringify(layout)}`);
  if (layout.scrollW > layout.viewport[0] || layout.overflowX > 0) fail(`horizontal overflow: ${JSON.stringify(layout)}`);
  await page.screenshot({ path: resolve(outDir, shot) });
  const metrics = await page.evaluate(() => window.GameCoreQA.getState().metrics);
  await page.evaluate(() => window.GameCoreQA.close());
  expectEqual(await page.evaluate(() => document.querySelector('[data-game-core-qa]')), null, 'panel removed on close');
  if (errors.length > 0) fail(`console errors: ${errors.join(' | ')}`);
  await context.close();
  console.log(`qa-panel-check: ${contextOptions.viewport.width}×${contextOptions.viewport.height} OK — panel ${layout.box.map(Math.round).join(',')}, fps ${metrics.fps}, frame ${metrics.frameMs} ms, heap ${metrics.memory ? metrics.memory.usedMB + ' MB' : 'N/A'} → ${shot}`);
}

let server;
try {
  let baseUrl = process.env.SHOWCASE_URL;
  if (!baseUrl) {
    const { createServer } = await import('vite');
    server = await createServer({ configFile: resolve(rootDir, 'vite.showcase.config.ts'), server: { port: 5193, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
    await server.listen();
    baseUrl = server.resolvedUrls.local[0];
  }
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  try {
    await scenario(browser, baseUrl, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, 'qa-panel-390x844.png');
    await scenario(browser, baseUrl, { viewport: { width: 1280, height: 800 } }, 'qa-panel-1280x800.png');
  } finally {
    await browser.close();
  }
  console.log('qa-panel-check: OK');
} finally {
  await server?.close();
}
