// Ready UI gallery screenshots: examples/pixi-showcase/ui-gallery.html for every style × screen × viewport, on the
// installed Google Chrome (the in-app browser has no WebGL). Needs the showcase dev server:
//
//   npm run showcase -- --host 0.0.0.0 --port 5180
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:gallery
//
// Env: STYLES=1,2  SCREENS=lives-full,restart-offer  VIEWPORTS=390x844,320x568,1280x800  LOCALE=ru  MOVES=38,10,1,0
// Writes showcase-shots/ui-gallery/<style>-<screen>-<w>x<h>.png (the gameplay screen once per MOVES value:
// <style>-gameplay-<moves>-<w>x<h>.png) and fails on a console error or a window that does not open. Every shot waits
// for the window's entrance to finish (state 'shown') and two more frames.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const STYLES = (process.env.STYLES ?? '1,2').split(',');
const SCREENS = (process.env.SCREENS ?? 'map,map-disabled,settings-map,settings-map-lang,settings-level,settings-level-lang,restart,restart-offer,exit,lives-minimal,lives,lives-full,win,win-2,win-1,win-0,fail,gameplay,noads,shop-screen,shop').split(',');
const MOVES = (process.env.MOVES ?? '38,10,1,0').split(',');
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
    const shotsOf = SCREENS.flatMap((screen) => (screen === 'gameplay' ? MOVES.map((moves) => ({ screen, moves, name: `gameplay-${moves}` })) : [{ screen, moves: null, name: screen }]));
    for (const { screen, moves, name } of shotsOf) {
      errors.length = 0;
      const url = `${BASE}ui-gallery.html?style=${style}&screen=${screen}&ui=0${moves !== null ? `&moves=${moves}` : ''}${LOCALE ? `&locale=${LOCALE}` : ''}`;
      await page.goto(url);
      try {
        await page.waitForFunction(() => window.__gallery?.ready === true, null, { timeout: 60000 });
        await page.waitForFunction(() => !window.__gallery.view || window.__gallery.view.state === 'shown', null, { timeout: 60000 });
        // a WIN: the earned stars come in after the entrance (1.7 s) — step the Core clock past them, then shoot
        if (screen.startsWith('win')) await page.evaluate(() => window.__gallery.step(3000));
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      } catch (error) {
        failures.push(`${style}/${name}/${width}x${height}: ${error.message.split('\n')[0]}`);
        continue;
      }
      const file = `${out}/${style}-${name}-${width}x${height}.png`;
      await page.screenshot({ path: file });
      shots += 1;
      if (errors.length) failures.push(`${style}/${name}/${width}x${height}: ${errors.join(' | ')}`);
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
