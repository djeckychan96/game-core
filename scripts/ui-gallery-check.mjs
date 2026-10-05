// Ready UI gallery screenshots: examples/pixi-showcase/ui-gallery.html for every style × screen × viewport, on the
// installed Google Chrome (the in-app browser has no WebGL). Needs the showcase dev server:
//
//   npm run showcase -- --host 0.0.0.0 --port 5180
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:gallery
//
// Env: STYLES=1,2  SCREENS=lives-full,restart-offer  VIEWPORTS=390x844,320x568,1280x800  LOCALE=ru
// Writes showcase-shots/ui-gallery/<style>-<screen>-<w>x<h>.png and fails on a console error or a window that does not
// open. Every shot waits for the window's entrance to finish (state 'shown') and two more frames.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const STYLES = (process.env.STYLES ?? '1,2').split(',');
const SCREENS = (process.env.SCREENS ?? 'map,settings-map,settings-level,restart,restart-offer,exit,lives-minimal,lives,lives-full,win,fail').split(',');
const VIEWPORTS = (process.env.VIEWPORTS ?? '390x844,320x568,1280x800').split(',').map((v) => v.split('x').map(Number));
const LOCALE = process.env.LOCALE ?? '';
const out = resolve('showcase-shots/ui-gallery');
mkdirSync(out, { recursive: true });

// SwiftShader keeps WebGL available where the GPU process is sandboxed away
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
let shots = 0;
for (const [width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width <= 400 ? 2 : 1 });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  for (const style of STYLES) {
    for (const screen of SCREENS) {
      errors.length = 0;
      const url = `${BASE}ui-gallery.html?style=${style}&screen=${screen}&ui=0${LOCALE ? `&locale=${LOCALE}` : ''}`;
      await page.goto(url);
      try {
        await page.waitForFunction(() => window.__gallery?.ready === true, null, { timeout: 60000 });
        await page.waitForFunction(() => !window.__gallery.view || window.__gallery.view.state === 'shown', null, { timeout: 60000 });
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      } catch (error) {
        failures.push(`${style}/${screen}/${width}x${height}: ${error.message.split('\n')[0]}`);
        continue;
      }
      const file = `${out}/${style}-${screen}-${width}x${height}.png`;
      await page.screenshot({ path: file });
      shots += 1;
      if (errors.length) failures.push(`${style}/${screen}/${width}x${height}: ${errors.join(' | ')}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(`ui-gallery: ${shots} shots in ${out}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
