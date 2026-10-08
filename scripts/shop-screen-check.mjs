// ShopScreen proof on the UI gallery (examples/pixi-showcase/ui-gallery.html?screen=map): the SHOP tab of both styles
// with real clicks on the installed Google Chrome — map → SHOP (nav) → a pack tap (onBuy, cards held while the demo
// "payment" runs) → HOME (nav) → the same map; map → coin "+" (HUD) → × → the same map. Needs the showcase dev server:
//
//   npm run showcase -- --host 0.0.0.0 --port 5180
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:shop
//
// The page's clock is held (`__gallery.hold()`) and stepped in 16 ms frames. Env: STYLES=1,2  VIEWPORTS=390x844.
// Writes showcase-shots/shop-screen/*.png and fails on a console error or a broken check.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const STYLES = (process.env.STYLES ?? '1,2').split(',');
const VIEWPORTS = (process.env.VIEWPORTS ?? '390x844').split(',').map((v) => v.split('x').map(Number));
const out = resolve('showcase-shots/shop-screen');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const report = [];
const check = (ok, label, detail) => {
  if (!ok) failures.push(`${label}: ${JSON.stringify(detail)}`);
};

try {
  for (const [width, height] of VIEWPORTS) {
    for (const style of STYLES) {
      const label = `style ${style} ${width}x${height}`;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width <= 400 ? 2 : 1 });
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) errors.push(msg.text()); });
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${BASE}ui-gallery.html?style=${style}&screen=map&ui=0`);
      await page.waitForFunction(() => window.__gallery?.ready === true, null, { timeout: 120000 });
      await page.evaluate(() => window.__gallery.hold());
      const frame = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const step = (ms) => page.evaluate((t) => window.__gallery.step(t), ms);
      /** A real mouse click at a Pixi object's centre (its global bounds), the held clock stepped through the press. */
      const click = async (find) => {
        const at = await page.evaluate(find);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await step(96);
        await page.mouse.up();
        await step(240);
        return at;
      };
      const centre = (pick) => `(() => { const b = (${pick})(window.__gallery).getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`;
      const state = () => page.evaluate(() => {
        const g = window.__gallery;
        return {
          map: g.screen.visible, shop: g.shopTab.shown, blocking: g.ui.isBlocking(), focus: g.screen.map.focusLevel,
          play: g.screen.playLevel, buy: g.shopTab.buyEnabled, last: g.events.at(-1) ?? null
        };
      });

      // the player moved the map away from the current level: that state must survive the tab switches
      await page.evaluate(() => window.__gallery.screen.map.scrollToLevel(7, false));
      await step(32);
      const before = await state();
      await frame();
      await page.screenshot({ path: `${out}/style${style}-${width}x${height}-1-map.png` });

      await click(centre('(g) => g.screen.nav.getItemContainer("shop")'));
      const inShop = await state();
      check(!inShop.map && inShop.shop && !inShop.blocking && inShop.last === 'nav:shop → tab:shop', `${label} SHOP → shop tab`, inShop);
      await frame();
      await page.screenshot({ path: `${out}/style${style}-${width}x${height}-2-shop.png` });

      await click(centre('(g) => g.shopTab.getCardContainer("coins_2")'));
      const bought = await state();
      check(bought.last === 'buy:coins_2' && bought.buy === false, `${label} pack tap → onBuy, cards held`, bought);
      await step(800);
      const released = await state();
      check(released.buy === true && released.shop, `${label} cards released`, released);

      await click(centre('(g) => g.shopTab.nav.getItemContainer("home")'));
      const home = await state();
      check(home.map && !home.shop && home.last === 'nav:home → tab:home' && home.focus === before.focus && home.play === before.play, `${label} HOME → the same map`, { before, home });
      await frame();
      await page.screenshot({ path: `${out}/style${style}-${width}x${height}-3-back-home.png` });

      // the HUD coin "+" opens the same tab, its × closes it
      await click('(() => { const p = window.__gallery.screen.hud.coinAnchor; return { x: p.x, y: p.y }; })()');
      const viaHud = await state();
      check(viaHud.shop && !viaHud.map && viaHud.last === 'hud:coins → tab:shop', `${label} coin + → shop tab`, viaHud);
      await click(centre('(g) => g.shopTab.closeButton'));
      const closed = await state();
      check(closed.map && !closed.shop && closed.last === 'shop:close → tab:home' && closed.focus === before.focus, `${label} × → the same map`, closed);

      const events = await page.evaluate(() => window.__gallery.events.filter((e) => /tab:|buy:/.test(e)));
      check(errors.length === 0, `${label} console`, errors);
      report.push({ label, events, focus: before.focus, errors: errors.length });
      await page.close();
    }
  }
} finally {
  await Promise.race([browser.close(), new Promise((done) => setTimeout(done, 5000))]);
}
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`shop-screen: ${report.length}/${report.length} OK, shots in ${out}`);
process.exit(0);
