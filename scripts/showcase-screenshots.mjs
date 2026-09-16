// Visual check of the standalone showcase with Playwright on the installed Google Chrome
// (the sandboxed in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase -- --host 0.0.0.0     (in another terminal)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:shots
//
// Writes PNGs into ./showcase-shots (git-ignored) and fails on any unexpected console error.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const url = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const outDir = process.env.SHOTS_DIR ?? resolve(process.cwd(), 'showcase-shots');
mkdirSync(outDir, { recursive: true });

const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];

async function run() {
  // plain launch: the installed Chrome falls back to SwiftShader WebGL by itself; forcing GL
  // flags made it hang on this machine
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  const shoot = async (label, context, actions) => {
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`[${label}] ${text}`);
    });
    page.on('pageerror', (error) => errors.push(`[${label}] pageerror ${error.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: 30000 });
    // SwiftShader frames are slow: settle on rendered frames, not wall-clock
    await page.waitForTimeout(600);
    await actions(page, async (name) => {
      await page.waitForTimeout(350);
      const file = resolve(outDir, `${label}-${name}.png`);
      await page.screenshot({ path: file });
      console.log(`shot ${file}`);
    });
    await page.close();
  };

  // iPhone 12/13/14 logical size
  const phone = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await shoot('iphone-390', phone, async (page, shot) => {
    await shot('01-map-top');
    const info = await page.evaluate(() => {
      const s = window.__showcase;
      return { focus: s.map.focusLevel, selected: s.map.selectedLevel, current: s.map.currentLevel, count: s.map.levelCount, stats: s.stats() };
    });
    console.log('map state', JSON.stringify(info));
    if (info.focus !== info.current) throw new Error(`expected focus on current level ${info.current}, got ${info.focus}`);

    // drag UP: the content follows the finger, so the lower (completed) levels rise into view
    await page.mouse.move(195, 560);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(195, 560 - i * 25, { steps: 2 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForFunction(() => window.__showcase.motion.getStats().activeTweens <= 2, null, { timeout: 5000 });
    await shot('02-map-scrolled-completed');
    const after = await page.evaluate(() => ({ focus: window.__showcase.map.focusLevel, selected: window.__showcase.map.selectedLevel }));
    console.log('after drag', JSON.stringify(after));
    if (after.focus >= info.current) throw new Error(`drag did not scroll to completed levels: focus ${after.focus}`);

    await page.evaluate(() => window.__showcase.map.scrollToLevel(window.__showcase.map.levelCount, false));
    await shot('03-map-locked-top');
    await page.evaluate(() => window.__showcase.map.scrollToLevel(14, false));
    await shot('03b-map-hard-pill');
    await page.evaluate(() => window.__showcase.map.scrollToLevel(window.__showcase.map.currentLevel, false));

    await page.evaluate(() => window.__showcase.openResult(window.__showcase.map.currentLevel));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: 5000 });
    await page.waitForTimeout(900);
    await shot('04-result-window');
    // real tap on NEXT (through Pixi events → ButtonController → close continuation): the
    // current level completes, the next one unlocks and the map scrolls to it
    const nextAt = await page.evaluate(() => {
      const p = window.__showcase.resultWindow.nextButton.getGlobalPosition();
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(nextAt.x, nextAt.y);
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: 5000 });
    await page.waitForFunction(() => window.__showcase.motion.getStats().activeTweens <= 2, null, { timeout: 5000 });
    const progressed = await page.evaluate(() => ({ current: window.__showcase.map.currentLevel, focus: window.__showcase.map.focusLevel, coins: window.__showcase.hud.coinsAmount }));
    console.log('after NEXT', JSON.stringify(progressed));
    if (progressed.current !== info.current + 1 || progressed.focus !== progressed.current) throw new Error(`NEXT did not advance progress: ${JSON.stringify(progressed)}`);
    await shot('04b-map-after-next');

    await page.evaluate(() => window.__showcase.openShop());
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: 5000 });
    await shot('05-shop-window');
    await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: 5000 });

    await page.evaluate(() => window.__showcase.openLives());
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: 5000 });
    await shot('06-lives-window');
    await page.evaluate(() => window.__showcase.core.cancelAll());
    const settled = await page.evaluate(() => ({ active: window.__showcase.ui.activeWindow, blocking: window.__showcase.ui.isBlocking(), motions: window.__showcase.motion.getStats().activeMotions }));
    console.log('after cancelAll', JSON.stringify(settled));
    if (settled.active !== null || settled.blocking) throw new Error('cancelAll left a window active');
    await shot('07-after-cancel-all');
  });
  await phone.close();

  const narrow = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, deviceScaleFactor: 2 });
  await shoot('narrow-320', narrow, async (page, shot) => {
    await shot('01-map');
    await page.evaluate(() => window.__showcase.openResult(window.__showcase.map.currentLevel));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: 5000 });
    await page.waitForTimeout(900);
    await shot('02-result');
    await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
  });
  await narrow.close();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await shoot('desktop-1280', desktop, async (page, shot) => {
    await shot('01-map');
  });
  await desktop.close();

  await browser.close();
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('showcase screenshots: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
