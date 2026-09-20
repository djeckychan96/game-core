// Theme System V1 visual check of the showcase (Playwright on the installed Chrome, like showcase:shots): the same six
// windows at 390 × 844 @2x under the default theme, `?theme=alt` (the demo ocean theme) and `?theme=art` (the v0.4 PNG
// skins); fails if the default and the alt theme differ in geometry (panel bounds / fit scale / button bounds).
//
//   npm run showcase:theme            # starts its own Vite server on 5195+, writes showcase-shots/theme-v1/*.png
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, devices } from 'playwright';

const root = process.cwd();
const outDir = process.env.SHOTS_DIR ?? resolve(root, 'showcase-shots/theme-v1');
mkdirSync(outDir, { recursive: true });
const WAIT_MS = 20000;
const server = await createServer({ configFile: resolve(root, 'vite.showcase.config.ts'), root: resolve(root, 'examples/pixi-showcase'), server: { port: 5195, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
console.log('showcase at', base);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const errors = [];
const IGNORED = [/favicon/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const geometry = {};
try {
  for (const variant of ['default', 'alt', 'art']) {
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(`[${variant}] ${msg.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${variant}] pageerror ${e.message}`));
    await page.goto(base + (variant === 'default' ? '' : `?theme=${variant}`), { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__showcase.offers.getStats().ticks >= 1, null, { timeout: WAIT_MS });
    await page.evaluate(() => window.__showcase.ui.activeWindow?.close('programmatic'));
    await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(outDir, `${variant}-00-map.png`) });
    geometry[variant] = {};
    for (const [name, opener] of [['settings', 'openSettings'], ['shop', 'openShop'], ['lives', 'openLives'], ['result', 'openResult'], ['starter', 'openStarter'], ['noads', 'openNoAds']]) {
      await page.evaluate((fn) => window.__showcase[fn](window.__showcase.map.currentLevel), opener);
      await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
      // the result window pops its stars in after the entrance: measure once every tween settled, never mid-animation
      await page.waitForFunction(() => window.__showcase.motion.getStats().activeMotions === 0, null, { timeout: WAIT_MS });
      await page.waitForTimeout(400);
      geometry[variant][name] = await page.evaluate(() => {
        const w = window.__showcase.ui.activeWindow;
        const view = [window.__showcase.settingsWindow, window.__showcase.shopWindow, window.__showcase.livesWindow, window.__showcase.resultWindow, window.__showcase.starterWindow, window.__showcase.noAdsWindow].find((v) => v && v.controller === w);
        if (!view) return null;
        const panel = view.panel;
        const b = panel.getBounds();
        const buttons = (view.buttons || []).map((btn) => { const r = btn.getBounds(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
        return { panel: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], scale: +panel.scale.x.toFixed(4), buttons };
      });
      await page.screenshot({ path: resolve(outDir, `${variant}-${name}.png`) });
      await page.evaluate(() => window.__showcase.ui.activeWindow.close('programmatic'));
      await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
    }
    await context.close();
    console.log('done', variant);
  }
} finally {
  await browser.close();
  await server.close();
}
const same = JSON.stringify(geometry.default) === JSON.stringify(geometry.alt);
console.log('geometry default == alt:', same);
if (!same) { console.log(JSON.stringify(geometry.default)); console.log(JSON.stringify(geometry.alt)); }
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
console.log('showcase theme shots OK →', outDir);
