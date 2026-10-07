// Ready UI motion proof on the UI gallery's map screen (examples/pixi-showcase/ui-gallery.html?screen=map): PLAY idle
// breathing (with a press on top of it), HUD coins gain / spend and a life spend (`resourceFeedback`), and the LOCK
// slot's shake — for every style × viewport, on the installed Google Chrome. Needs the showcase dev server:
//
//   npm run showcase -- --host 0.0.0.0 --port 5180
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:motion
//
// The page's clock is held (`__gallery.hold()`) and stepped in 16 ms frames, so every sample is exact whatever the
// SwiftShader frame rate. Env: STYLES=1,2  VIEWPORTS=390x844,320x568,1280x800. Writes showcase-shots/ui-motion/*.png
// and fails on a console error or a broken check.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const STYLES = (process.env.STYLES ?? '1,2').split(',');
const VIEWPORTS = (process.env.VIEWPORTS ?? '390x844,320x568,1280x800').split(',').map((v) => v.split('x').map(Number));
const out = resolve('showcase-shots/ui-motion');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const report = [];
const check = (ok, label, detail) => {
  if (!ok) failures.push(`${label}: ${JSON.stringify(detail)}`);
};

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

    // --- PLAY breathing: one tween, idle → ×1.04 → idle over 1.3 s, never below the layout scale ---
    const breathing = await page.evaluate(() => {
      const g = window.__gallery;
      const play = g.screen.play;
      const base = play.idleScale.x; // the layout scale (the page breathed before the clock was held)
      const scales = [];
      for (let t = 0; t < 1300; t += 16) { g.step(16); scales.push(play.scale.x / base); }
      return { peak: Math.max(...scales), low: Math.min(...scales), tweens: g.motion.getStats().activeTweens };
    });
    // one whole period from wherever the breath was: both ends reached, never below the layout scale, never past ×1.04
    check(Math.abs(breathing.peak - 1.04) < 0.002 && breathing.peak <= 1.04 + 1e-9 && breathing.low >= 1 - 1e-9 && breathing.low < 1.002, `${label} breathing`, breathing);
    await page.evaluate(() => window.__gallery.step(650)); // hold the shot at the peak of the breath
    await frame();
    await page.screenshot({ path: `${out}/style${style}-${width}x${height}-breath-peak.png` });

    // --- a real press on PLAY during the breath: idle × breath × 0.92, one tap, back to idle × breath ---
    const playAt = await page.evaluate(() => { const p = window.__gallery.screen.play.getGlobalPosition(); return { x: p.x, y: p.y }; });
    await page.mouse.move(playAt.x, playAt.y);
    await page.mouse.down();
    const pressed = await page.evaluate(() => {
      const g = window.__gallery;
      g.step(96);
      const play = g.screen.play;
      return { scale: play.scale.x, idle: play.idleScale.x, breath: play.breathFactor };
    });
    await page.mouse.up();
    const released = await page.evaluate(() => {
      const g = window.__gallery;
      g.step(240);
      const play = g.screen.play;
      return { scale: play.scale.x, idle: play.idleScale.x, breath: play.breathFactor, plays: g.events.filter((e) => e.startsWith('play:')).length };
    });
    check(Math.abs(pressed.scale - pressed.idle * pressed.breath * 0.92) < 1e-6 && pressed.breath > 1, `${label} press × breath`, pressed);
    check(Math.abs(released.scale - released.idle * released.breath) < 1e-6 && released.plays === 1, `${label} release`, released);
    // rapid taps: every one a tap, one breathing tween
    const before = await page.evaluate(() => window.__gallery.motion.getStats().activeTweens);
    for (let i = 0; i < 6; i++) {
      await page.mouse.down();
      await page.evaluate(() => window.__gallery.step(32));
      await page.mouse.up();
      await page.evaluate(() => window.__gallery.step(16));
    }
    const rapid = await page.evaluate(() => { const g = window.__gallery; g.step(300); return { plays: g.events.filter((e) => e.startsWith('play:')).length, tweens: g.motion.getStats().activeTweens }; });
    check(rapid.plays === 7 && rapid.tweens === before, `${label} rapid taps`, { ...rapid, before });

    // --- HUD coins gain / spend, life spend ---
    const coins = await page.evaluate(() => {
      const g = window.__gallery;
      const hud = g.screen.hud;
      const text = () => hud.coins.countText.text;
      const run = (delta, ms) => {
        const start = hud.coinsAmount;
        g.changeCoins(delta);
        const immediate = hud.coinsAmount === start + delta;
        const seen = [text()];
        let peak = 0;
        let dip = Infinity;
        for (let t = 0; t < ms; t += 16) {
          g.step(16);
          if (seen[seen.length - 1] !== text()) seen.push(text());
          const k = hud.coins.icon.scale.x / hud.coins.iconScale;
          peak = Math.max(peak, k);
          dip = Math.min(dip, k);
        }
        return { immediate, redraws: seen.length - 1, first: seen[0], last: seen[seen.length - 1], peak, dip, settled: hud.coins.icon.scale.x / hud.coins.iconScale };
      };
      return { gain: run(250, 700), spend: run(-120, 320) };
    });
    check(coins.gain.immediate && coins.gain.redraws >= 2 && coins.gain.redraws <= 12 && coins.gain.peak > 1.15 && Math.abs(coins.gain.settled - 1) < 1e-6, `${label} coins gain`, coins.gain);
    check(coins.spend.immediate && coins.spend.redraws >= 1 && coins.spend.redraws <= 12 && coins.spend.dip < 0.95 && coins.spend.peak <= 1 + 1e-9, `${label} coins spend`, coins.spend);
    const life = await page.evaluate(() => {
      const g = window.__gallery;
      const hud = g.screen.hud;
      const rest = hud.lives.icon.x;
      const restCount = hud.lives.countText.x;
      const start = hud.livesAmount;
      g.changeLives(-1);
      const immediate = hud.livesAmount === start - 1;
      g.step(16);
      const text = hud.lives.countText.text;
      const xs = [];
      for (let t = 0; t < 320; t += 16) { g.step(16); xs.push(hud.lives.icon.x - rest); }
      return { immediate, text, expected: String(start - 1), min: Math.min(...xs), max: Math.max(...xs), back: hud.lives.icon.x === rest && hud.lives.countText.x === restCount };
    });
    check(life.immediate && life.text === life.expected && life.min < -2 && life.max > 2 && life.back, `${label} life spend`, life);

    // --- LOCK: a real tap shakes the slot and reports nav:lock ---
    const lockAt = await page.evaluate(() => {
      const item = window.__gallery.screen.nav.getItemContainer('lock');
      const b = item.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.click(lockAt.x, lockAt.y);
    const lock = await page.evaluate(() => {
      const g = window.__gallery;
      const inner = g.screen.nav.getItemContainer('lock').children[0];
      const xs = [];
      for (let t = 0; t < 320; t += 16) { g.step(16); xs.push(inner.x); }
      return { min: Math.min(...xs), max: Math.max(...xs), end: inner.x, taps: g.events.filter((e) => e === 'nav:lock').length };
    });
    check(lock.min < -10 && lock.max > 10 && lock.end === 0 && lock.taps === 1, `${label} LOCK shake`, lock);
    await page.mouse.click(lockAt.x, lockAt.y);
    await page.evaluate(() => window.__gallery.step(64)); // mid-shake shot
    await frame();
    await page.screenshot({ path: `${out}/style${style}-${width}x${height}-lock-shake.png` });

    // --- repeated hide / show, a host-wide cancel, destroy ---
    const lifecycle = await page.evaluate(() => {
      const g = window.__gallery;
      const breathTweens = () => g.motion.getStats().activeTweens;
      g.step(400);
      const idle = breathTweens();
      for (let i = 0; i < 5; i++) {
        g.screen.visible = false;
        g.step(200);
        g.screen.visible = true;
        g.layout(); // a show re-lays the screen out
        g.step(100);
      }
      const afterShows = breathTweens();
      g.core.cancelAll();
      g.layout();
      g.step(100);
      const afterCancel = breathTweens();
      const play = g.screen.play;
      const breathing = Math.abs(play.scale.x / play.idleScale.x - 1) > 1e-4 || (g.step(300), Math.abs(play.scale.x / play.idleScale.x - 1) > 1e-4);
      g.screen.destroy();
      g.step(500);
      return { idle, afterShows, afterCancel, breathing, activeAfterDestroy: g.motion.getStats().activeMotions, motionErrors: g.motion.getStats().bindingErrors + g.motion.getStats().callbackErrors };
    });
    check(lifecycle.afterShows === lifecycle.idle && lifecycle.breathing && lifecycle.activeAfterDestroy === 0 && lifecycle.motionErrors === 0, `${label} lifecycle`, lifecycle);
    await frame();
    check(errors.length === 0, `${label} console`, errors);
    report.push({ label, breathPeak: +breathing.peak.toFixed(4), gainRedraws: coins.gain.redraws, spendRedraws: coins.spend.redraws, spendDip: +coins.spend.dip.toFixed(3), lifeShake: [+life.min.toFixed(2), +life.max.toFixed(2)], lockShake: [+lock.min.toFixed(2), +lock.max.toFixed(2)], lifecycle });
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
console.log(`ui-motion: ${report.length} runs, shots in ${out}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
