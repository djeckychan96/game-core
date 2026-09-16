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
// SwiftShader renders the showcase at ~2 fps and Pixi clamps a ticker step to 100 ms, so a 440 ms
// window entrance takes ~3 s of wall-clock: state waits get a generous budget, never a fixed sleep.
const WAIT_MS = 15000;

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
    // The OfferRuntime demo activates the welcome offer on the first tick and pops its window once
    // per session (donor behaviour); these shots start from the bare map, so close it first.
    // scripts/offer-demo-check.mjs covers the chain itself.
    await page.waitForFunction(() => window.__showcase.offers.getStats().ticks >= 1, null, { timeout: WAIT_MS });
    await page.evaluate(() => window.__showcase.ui.activeWindow?.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
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

    // --- click ripple (game-core/pixi FX): a real tap on free map space spawns rings ---
    const freeSpot = await page.evaluate(() => {
      const s = window.__showcase;
      const boundary = s.app.renderer.events.rootBoundary;
      boundary.rootTarget = s.app.stage; // Pixi assigns it lazily inside its pointer mappers
      const free = new Set([s.app.stage, s.map]);
      for (const y of [300, 340, 380, 420, 460, 500]) {
        for (const x of [60, 100, 330, 300, 195]) {
          const hit = boundary.hitTest(x, y);
          if (hit && free.has(hit)) return { x, y };
        }
      }
      return null;
    });
    if (!freeSpot) throw new Error('no free map spot found for the ripple tap');
    await page.mouse.click(freeSpot.x, freeSpot.y);
    await page.waitForFunction(() => window.__showcase.ripple.getStats().spawned === 1, null, { timeout: WAIT_MS });
    // deterministic mid-animation frames: freeze the host clock, step it by hand, render, shoot
    const freezeAndSpawn = ({ x, y, preset }) => {
      const s = window.__showcase;
      s.app.ticker.stop();
      if (typeof preset === 'number') s.setRipplePreset(preset);
      s.ripple.cancelAll();
      s.ripple.spawn(x, y);
      for (let i = 0; i < 12; i++) s.core.update(16); // 192 ms in: both production rings are alive
      s.app.render();
      return s.ripple.getStats();
    };
    const rippleMid = await page.evaluate(freezeAndSpawn, freeSpot);
    console.log('ripple mid', JSON.stringify(rippleMid));
    if (rippleMid.activeRings !== 2 || rippleMid.activeRipples !== 1) throw new Error(`expected one production ripple with 2 live rings, got ${JSON.stringify(rippleMid)}`);
    await shot('01b-click-ripple');
    // light background with the demo HALO preset: the Core-only halo keeps the rings readable there
    await page.evaluate(({ x, y }) => {
      const s = window.__showcase;
      s.map.visible = false;
      s.app.renderer.background.color = 0xf1f3f8;
      s.setRipplePreset(1);
      s.ripple.cancelAll();
      s.ripple.spawn(x, y);
      for (let i = 0; i < 12; i++) s.core.update(16);
      s.app.render();
    }, freeSpot);
    await shot('01c-click-ripple-light-halo');
    await page.evaluate(() => {
      const s = window.__showcase;
      s.map.visible = true;
      s.app.renderer.background.color = 0x1d2231;
      s.setRipplePreset(0);
      s.ripple.cancelAll();
      s.app.ticker.start();
    });
    // taps the UI consumes never ripple: a toolbar pill (opens Settings) and the current level badge
    const spawnedBeforeUi = await page.evaluate(() => window.__showcase.ripple.getStats().spawned);
    const settingsPillAt = await page.evaluate(() => {
      const pill = window.__showcase.toolbar.children.find((child) => child.labelText?.text === 'SETTINGS');
      const p = pill.getGlobalPosition();
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(settingsPillAt.x, settingsPillAt.y);
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
    // a tap on the open window's panel is UI too (blocking): no ripple
    await page.mouse.click(195, 420);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    const badgeAt = await page.evaluate(() => {
      const p = window.__showcase.map.getNodeContainer(window.__showcase.map.currentLevel).getGlobalPosition();
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(badgeAt.x, badgeAt.y);
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
    await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    const spawnedAfterUi = await page.evaluate(() => window.__showcase.ripple.getStats().spawned);
    if (spawnedAfterUi !== spawnedBeforeUi) throw new Error(`UI taps spawned ripples: ${spawnedBeforeUi} -> ${spawnedAfterUi}`);

    // drag UP: the content follows the finger, so the lower (completed) levels rise into view
    await page.mouse.move(195, 560);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(195, 560 - i * 25, { steps: 2 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForFunction(() => window.__showcase.motion.getStats().activeTweens <= 2, null, { timeout: WAIT_MS });
    const spawnedAfterDrag = await page.evaluate(() => window.__showcase.ripple.getStats().spawned);
    if (spawnedAfterDrag !== spawnedAfterUi) throw new Error(`a map drag spawned a ripple: ${spawnedAfterUi} -> ${spawnedAfterDrag}`);
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
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
    await page.waitForTimeout(900);
    await shot('04-result-window');
    // real tap on NEXT (through Pixi events → ButtonController → close continuation): the
    // current level completes, the next one unlocks and the map scrolls to it
    const nextAt = await page.evaluate(() => {
      const p = window.__showcase.resultWindow.nextButton.getGlobalPosition();
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(nextAt.x, nextAt.y);
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    await page.waitForFunction(() => window.__showcase.motion.getStats().activeTweens <= 2, null, { timeout: WAIT_MS });
    const progressed = await page.evaluate(() => ({ current: window.__showcase.map.currentLevel, focus: window.__showcase.map.focusLevel, coins: window.__showcase.hud.coinsAmount }));
    console.log('after NEXT', JSON.stringify(progressed));
    if (progressed.current !== info.current + 1 || progressed.focus !== progressed.current) throw new Error(`NEXT did not advance progress: ${JSON.stringify(progressed)}`);
    await shot('04b-map-after-next');

    await page.evaluate(() => window.__showcase.openShop());
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
    await shot('05-shop-window');
    await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });

    await page.evaluate(() => window.__showcase.openLives());
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
    await shot('06-lives-window');
    await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });

    for (const [name, opener] of [['08-settings-window', 'openSettings'], ['09-noads-window', 'openNoAds'], ['10-starter-window', 'openStarter']]) {
      await page.evaluate((fn) => window.__showcase[fn](), opener);
      await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
      await shot(name);
      await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
      await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    }
    // a real tap on the SOUND toggle: the slash appears, the window stays open
    await page.evaluate(() => window.__showcase.openSettings());
    await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
    const soundAt = await page.evaluate(() => { const p = window.__showcase.settingsWindow.toggles.sound.button.getGlobalPosition(); return { x: p.x, y: p.y }; });
    await page.mouse.click(soundAt.x, soundAt.y);
    await page.waitForTimeout(250);
    const soundOff = await page.evaluate(() => window.__showcase.settingsWindow.toggles.sound.off.visible);
    if (!soundOff) throw new Error('sound toggle did not switch off');
    await shot('08b-settings-sound-off');
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
    for (const [name, opener] of [['02-result', 'openResult'], ['03-shop', 'openShop'], ['04-lives', 'openLives'], ['05-settings', 'openSettings'], ['06-starter', 'openStarter']]) {
      await page.evaluate((fn) => window.__showcase[fn](window.__showcase.map.currentLevel), opener);
      await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
      if (name === '02-result') await page.waitForTimeout(900);
      await shot(name);
      await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
      await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    }
  });
  await narrow.close();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await shoot('desktop-1280', desktop, async (page, shot) => {
    await shot('01-map');
    // the production ocean mid-flight on desktop, frozen like the phone shots
    const ocean = await page.evaluate(() => {
      const s = window.__showcase;
      s.app.ticker.stop();
      s.ripple.spawn(640, 300);
      for (let i = 0; i < 20; i++) s.core.update(16);
      s.app.render();
      return s.ripple.getStats();
    });
    if (ocean.activeRings !== 2) throw new Error(`the production ocean should show 2 rings, got ${JSON.stringify(ocean)}`);
    await shot('02-click-ripple-ocean');
    await page.evaluate(() => { window.__showcase.ripple.cancelAll(); window.__showcase.app.ticker.start(); });
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
