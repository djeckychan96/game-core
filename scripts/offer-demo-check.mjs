// OfferRuntime demo proof in the showcase, with Playwright on the installed Google Chrome
// (the sandboxed in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase -- --host 0.0.0.0     (in another terminal)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:offers
//
// Drives the chain through the page's fake clock (no real hours, no real IAP): the welcome offer
// activates and its window shows title / price / rewards / timer; the timer follows the clock; a
// real BUY tap runs the demo purchase and moves the chain into cooldown; NEXT / EXPIRE advance it
// (tier and variant change on screen). Writes 390 × 844 PNGs into ./showcase-shots and fails on
// any unexpected console error.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const url = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const outDir = process.env.SHOTS_DIR ?? resolve(process.cwd(), 'showcase-shots');
mkdirSync(outDir, { recursive: true });

const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
// SwiftShader renders at ~2 fps and Pixi clamps a ticker step to 100 ms: a second of frame time
// is ~5 s of wall-clock. Waits synchronize on state, never on a fixed sleep.
const WAIT_MS = 40000;

const fail = (message) => {
  throw new Error(message);
};

async function run() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));
  const shot = async (name) => {
    await page.waitForTimeout(350);
    const file = resolve(outDir, `offer-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`shot ${file}`);
  };
  const windowShown = () => page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
  const windowGone = () => page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
  const closeWindow = async () => {
    await page.evaluate(() => window.__showcase.ui.activeWindow?.close('programmatic'));
    await windowGone();
  };
  const readWindow = () =>
    page.evaluate(() => {
      const s = window.__showcase;
      const w = s.starterWindow;
      const active = s.offers.getActive();
      return {
        state: w.state,
        title: w.title.text,
        price: w.buyButton.labelText?.text ?? null,
        coins: w.coinsText.text,
        lives: w.livesText.visible ? w.livesText.text : null,
        boosters: w.boosterBar.visible ? w.boosterText.text : null,
        timer: w.timerText.visible ? w.timerText.text : null,
        buyEnabled: w.buyEnabled,
        active: active ? { productId: active.productId, tier: active.tier, variant: active.variant } : null,
        secondsLeft: s.offers.secondsLeft(),
        iconVisible: s.starterIcon?.visible ?? null,
        iconTimer: s.offerDemo.iconTimer.visible ? s.offerDemo.iconTimer.text : null,
        status: s.offerDemo.status.text,
        stats: s.offers.getStats(),
        events: s.offerEvents.map((e) => (e.type === 'blocked_no_price' ? e.type : `${e.type}:${e.offer.productId}${e.type === 'purchased' ? `:${e.moved}` : ''}`))
      };
    });
  const expectWindow = (info, expected, label) => {
    for (const [key, value] of Object.entries(expected)) {
      // the kit formats thousands with a thin space: compare with plain spaces
      const actual = typeof info[key] === 'string' ? info[key].replace(/\s/g, ' ') : info[key];
      const wanted = typeof value === 'string' ? value.replace(/\s/g, ' ') : value;
      const ok = wanted instanceof RegExp ? wanted.test(String(actual)) : JSON.stringify(actual) === JSON.stringify(wanted);
      if (!ok) fail(`${label}: expected ${key} = ${wanted instanceof RegExp ? wanted : JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    }
  };

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: 30000 });

  // 1. the welcome offer activates on the first tick and pops its window once per session
  await page.waitForFunction(() => window.__showcase.offers.getStats().ticks >= 1, null, { timeout: WAIT_MS });
  await windowShown();
  let info = await readWindow();
  console.log('welcome', JSON.stringify({ ...info, stats: undefined }));
  expectWindow(info, {
    title: 'STARTER\nPACK', price: '$0.99', coins: '3 500', lives: '1h', boosters: 'x3',
    timer: /^(12:00:00|11:59:[45]\d)$/, buyEnabled: true, active: { productId: 'starter_pack', tier: 0, variant: 0 }, iconVisible: true
  }, 'welcome window');
  if (info.events[0] !== 'activated:starter_pack') fail(`expected the first event to be activated:starter_pack, got ${info.events}`);
  await shot('01-welcome-window-390x844');

  // 2. the timer follows the fake clock: a jump of 1 h shows up at once; the host ticker also moves it
  const before = info.timer;
  await page.evaluate(() => window.__showcase.offerClock.jump(3600));
  info = await readWindow();
  expectWindow(info, { timer: /^(11:00:00|10:59:[45]\d)$/, active: { productId: 'starter_pack', tier: 0, variant: 0 } }, 'after +1h');
  if (info.secondsLeft > 11 * 3600) fail(`clock jump did not reach the runtime: ${info.secondsLeft}s left`);
  const jumped = info.timer;
  await page.waitForFunction((t) => window.__showcase.starterWindow.timerText.text !== t, jumped, { timeout: WAIT_MS });
  info = await readWindow();
  console.log('timer', JSON.stringify({ before, jumped, ticking: info.timer, iconTimer: info.iconTimer }));
  if (info.iconTimer !== info.timer) fail(`icon timer ${info.iconTimer} ≠ window timer ${info.timer}`);
  await shot('02-welcome-timer-after-1h');

  // 3. a real BUY tap (Pixi events → ButtonController → close continuation → demo purchase): the
  //    chain moves into the 24 h buy cooldown; the icon hides; rewards are granted by the host (coins)
  const coinsBefore = await page.evaluate(() => window.__showcase.state.coins);
  const buyAt = await page.evaluate(() => {
    const p = window.__showcase.starterWindow.buyButton.getGlobalPosition();
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(buyAt.x, buyAt.y);
  await windowGone();
  await page.waitForFunction(() => window.__showcase.offerDemo.purchasing() === true, null, { timeout: WAIT_MS });
  // while the demo payment sheet is open, re-opening the offer shows BUY disabled (setBuyEnabled(false))
  await page.evaluate(() => window.__showcase.openOffer());
  await windowShown();
  info = await readWindow();
  expectWindow(info, { buyEnabled: false, active: { productId: 'starter_pack', tier: 0, variant: 0 } }, 'window during payment');
  await shot('03-welcome-buy-pending');
  await closeWindow();
  await page.waitForFunction(() => window.__showcase.offers.getStats().purchases === 1, null, { timeout: WAIT_MS });
  info = await readWindow();
  console.log('after BUY', JSON.stringify({ events: info.events, stats: info.stats, status: info.status }));
  expectWindow(info, { active: null, iconVisible: false }, 'after purchase');
  if (info.stats.welcome !== 2 || info.stats.nextTier !== 2 || info.stats.tier !== 0) fail(`purchase did not move the chain: ${JSON.stringify(info.stats)}`);
  // the fake clock keeps ticking with the host ticker, so the cooldown read a moment later is a few seconds short of 24 h
  const cooldownLeft = info.stats.nextAt - (await page.evaluate(() => window.__showcase.offerClock.now()));
  if (cooldownLeft > 24 * 3600 || cooldownLeft < 24 * 3600 - 60) fail(`buy cooldown is not 24 h: ${cooldownLeft}s left`);
  if (!info.events.includes('purchased:starter_pack:true')) fail(`no moved purchase event: ${info.events}`);
  const coinsAfter = await page.evaluate(() => window.__showcase.state.coins);
  if (coinsAfter !== coinsBefore + 3500) fail(`host did not grant the coins: ${coinsBefore} → ${coinsAfter}`);
  if (!/COOLDOWN|next T2/i.test(info.status)) fail(`status strip does not show the cooldown: ${info.status}`);
  await shot('04-map-cooldown-after-purchase');

  // 4. NEXT jumps the clock to nextAt: tier 2 variant A (VALUE PACK) activates
  await page.evaluate(() => window.__showcase.offerClock.next());
  await page.evaluate(() => window.__showcase.openOffer());
  await windowShown();
  info = await readWindow();
  expectWindow(info, {
    title: 'VALUE\nPACK', price: '$2.99', coins: '5 000', lives: '3h', boosters: 'x3', timer: /^(24:00:00|23:59:[45]\d)$/,
    active: { productId: 'offer_t2_a', tier: 2, variant: 0 }, iconVisible: true
  }, 'tier 2 A window');
  await shot('05-t2a-window-390x844');
  await closeWindow();

  // 5. EXPIRE: tier 2 A expires (→ tier 1 after 48 h); NEXT: tier 1 A on its first visit
  await page.evaluate(() => window.__showcase.offerClock.expire());
  info = await readWindow();
  expectWindow(info, { active: null }, 'after expiry');
  if (info.stats.nextTier !== 1 || !info.events.includes('expired:offer_t2_a')) fail(`expiry did not step down: ${JSON.stringify(info.stats)} ${info.events}`);
  await page.evaluate(() => window.__showcase.offerClock.next());
  info = await readWindow();
  expectWindow(info, { active: { productId: 'offer_t1_a', tier: 1, variant: 0 } }, 'tier 1 first visit');

  // 6. EXPIRE again (tier 1 stays tier 1) and NEXT: the revisit flips to variant B (MINI PACK B, no bulbs)
  await page.evaluate(() => window.__showcase.offerClock.expire());
  await page.evaluate(() => window.__showcase.offerClock.next());
  await page.evaluate(() => window.__showcase.openOffer());
  await windowShown();
  info = await readWindow();
  expectWindow(info, {
    title: 'MINI\nPACK', price: '$0.99', coins: '1 500', lives: '1h', boosters: null, timer: /^(24:00:00|23:59:[45]\d)$/,
    active: { productId: 'offer_t1_b', tier: 1, variant: 1 }
  }, 'tier 1 B window');
  await shot('06-t1b-window-390x844');

  // 7. the window closes by itself when its offer expires while open (no purchase in flight)
  await page.evaluate(() => window.__showcase.offerClock.expire());
  await windowGone();
  info = await readWindow();
  expectWindow(info, { active: null, iconVisible: false }, 'after in-window expiry');
  console.log('events', JSON.stringify(info.events));
  const expectedEvents = [
    'activated:starter_pack', 'purchased:starter_pack:true', 'activated:offer_t2_a', 'expired:offer_t2_a',
    'activated:offer_t1_a', 'expired:offer_t1_a', 'activated:offer_t1_b', 'expired:offer_t1_b'
  ];
  if (JSON.stringify(info.events) !== JSON.stringify(expectedEvents)) fail(`event log differs:\n got ${JSON.stringify(info.events)}\n want ${JSON.stringify(expectedEvents)}`);
  await shot('07-map-after-chain');

  await page.close();
  await context.close();
  await browser.close();
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('offer demo check: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
