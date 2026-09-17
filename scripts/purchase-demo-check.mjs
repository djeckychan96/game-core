// PurchaseRuntime demo proof in the showcase, with Playwright on the installed Google Chrome
// (the sandboxed in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase -- --host 0.0.0.0     (in another terminal)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:purchase
//
// One bounded smoke of the composition UI → PurchaseRuntime (FAKE payments adapter) → grant →
// AnalyticsRuntime → OfferRuntime:
//   1. a real BUY tap on the welcome offer: nothing is granted while the payment sheet is open, a
//      second buy is `busy`; then ok → coins granted once → token in the registry → receipt
//      consumed → purchase_started / purchase_ok / purchase / offer_purchased → the chain moved;
//   2. a shop pack whose SDK answer is lost (paid, `purchase()` answers empty): cancelled, no coins;
//      restore() grants it exactly once, a second restore grants nothing.
// Nothing leaves the page — the script fails on any request outside the dev server.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const url = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const outDir = process.env.SHOTS_DIR ?? resolve(process.cwd(), 'showcase-shots');
mkdirSync(outDir, { recursive: true });

const IGNORED_CONSOLE = [/favicon\.ico/i, /SwiftShader/i, /GPU stall/i, /WebGL/i];
const WAIT_MS = 40000; // SwiftShader runs at ~2 fps: waits synchronize on state, never on a sleep

const fail = (message) => {
  throw new Error(message);
};

async function run() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  const foreign = [];
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const origin = new URL(url).origin;
  page.on('request', (request) => {
    const target = request.url();
    if (!target.startsWith(origin) && !target.startsWith('data:') && !target.startsWith('blob:')) foreign.push(target);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));

  const read = () =>
    page.evaluate(() => {
      const s = window.__showcase;
      const label = (e) => (e.event.name === 'interaction' ? e.event.data.action : e.event.name);
      return {
        coins: s.state.coins,
        stats: s.purchases.getStats(),
        pending: s.purchases.getPending(),
        events: s.purchaseEvents.map((e) => (e.type === 'error' ? `error:${e.reason}` : `${e.type}:${e.productId}`)),
        registry: s.grantedPurchases.tokens(),
        held: s.payments.held.map((it) => it.token),
        consumed: s.payments.consumed,
        offers: s.offers.getStats(),
        last: s.purchaseDemo.last(),
        status: s.purchaseDemo.status.text,
        analytics: [...s.analyticsTransport.batches.flat()].map(label),
        envelopes: s.analyticsTransport.batches.flat()
      };
    });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: 30000 });
  // the welcome offer pops once per session
  await page.waitForFunction(() => window.__showcase.offers.getStats().active === 'starter_pack', null, { timeout: WAIT_MS });
  await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });

  // 1. a real BUY tap (Pixi events → ButtonController → close continuation → PurchaseRuntime.purchase)
  const before = await read();
  const buyAt = await page.evaluate(() => {
    const p = window.__showcase.starterWindow.buyButton.getGlobalPosition();
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(buyAt.x, buyAt.y);
  await page.waitForFunction(() => window.__showcase.purchases.getPending() !== null, null, { timeout: WAIT_MS });
  let info = await read();
  if (info.pending.productId !== 'starter_pack' || info.pending.source !== 'offer_window') fail(`pending: ${JSON.stringify(info.pending)}`);
  if (info.coins !== before.coins || info.registry.length !== 0) fail(`granted before the platform answered: ${JSON.stringify(info)}`);
  if (!/PAYING starter_pack/.test(info.status)) fail(`status while paying: ${info.status}`);
  // a second buy while the sheet is open never reaches the platform
  const second = await page.evaluate(() => window.__showcase.purchaseDemo.buy('coins_1', 'shop'));
  if (second.status !== 'busy') fail(`second purchase was not refused: ${JSON.stringify(second)}`);

  await page.waitForFunction(() => window.__showcase.purchaseDemo.last().purchase?.status === 'ok', null, { timeout: WAIT_MS });
  info = await read();
  if (info.coins !== before.coins + 3500) fail(`coins: ${before.coins} → ${info.coins}, want +3500 exactly once`);
  if (JSON.stringify(info.events) !== JSON.stringify(['started:starter_pack', 'granted:starter_pack'])) fail(`purchase events: ${info.events}`);
  if (JSON.stringify(info.registry) !== JSON.stringify(['demo-order-1'])) fail(`registry: ${info.registry}`);
  if (info.held.length !== 0 || info.consumed !== 1) fail(`the receipt was not consumed: ${JSON.stringify({ held: info.held, consumed: info.consumed })}`);
  if (info.offers.purchases !== 1 || info.offers.active !== null || info.offers.nextTier !== 2) fail(`the chain did not move: ${JSON.stringify(info.offers)}`);
  if (info.last.saves !== 1 || !info.stats.payer) fail(`save hook / payer: ${JSON.stringify(info.last)} ${JSON.stringify(info.stats)}`);

  // 2. a shop pack whose SDK answer is lost: cancelled and nothing granted, then restore() pays it out once
  await page.evaluate(() => window.__showcase.ui.activeWindow?.close('programmatic'));
  await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
  const lost = await page.evaluate(() => {
    window.__showcase.purchaseDemo.setOutcome('lost');
    return window.__showcase.purchaseDemo.buy('coins_2', 'shop');
  });
  if (lost.status !== 'cancelled' || lost.restoreAdvised !== true) fail(`lost answer: ${JSON.stringify(lost)}`);
  info = await read();
  if (info.coins !== before.coins + 3500) fail(`a purchase without a platform ok was granted: ${info.coins}`);
  if (JSON.stringify(info.held) !== JSON.stringify(['demo-order-2'])) fail(`the paid receipt is not held: ${info.held}`);
  const restored = await page.evaluate(() => window.__showcase.purchaseDemo.restore());
  const again = await page.evaluate(() => window.__showcase.purchaseDemo.restore());
  if (JSON.stringify(restored.granted) !== JSON.stringify([{ productId: 'coins_2', token: 'demo-order-2' }])) fail(`restore: ${JSON.stringify(restored)}`);
  if (again.granted.length !== 0 || again.found !== 0) fail(`second restore: ${JSON.stringify(again)}`);
  info = await read();
  if (info.coins !== before.coins + 3500 + 3500) fail(`restored coins: ${info.coins}`);
  if (info.stats.granted !== 2 || info.stats.restored !== 1 || info.stats.cancelled !== 1 || info.stats.errors !== 0) fail(`stats: ${JSON.stringify(info.stats)}`);
  if (info.offers.purchases !== 1) fail('a shop pack must not touch the offer chain');

  // 3. analytics: the funnel + the Hazar purchase events, in order, with money from the demo catalog
  await page.evaluate(() => window.__showcase.analytics.flush());
  await page.waitForFunction(() => window.__showcase.analytics.getStats().queued === 0, null, { timeout: WAIT_MS });
  info = await read();
  const wanted = [
    'purchase_started', 'purchase_ok', 'purchase', 'offer_purchased',
    'purchase_started', 'purchase_cancelled', 'purchase_restored', 'purchase'
  ];
  const got = info.analytics.filter((name) => name.startsWith('purchase') || name === 'offer_purchased');
  if (JSON.stringify(got) !== JSON.stringify(wanted)) fail(`analytics order:\n got ${JSON.stringify(got)}\n want ${JSON.stringify(wanted)}`);
  const money = info.envelopes.filter((e) => e.event.name === 'purchase').map((e) => e.event.data);
  const [direct, viaRestore] = money;
  if (direct.offer_name !== 'starter_pack' || direct.revenue !== 0.99 || direct.currency !== 'USD' || direct.order_id !== 'demo-order-1' || direct.source !== 'offer_window' || direct.status !== 'success') {
    fail(`purchase event: ${JSON.stringify(direct)}`);
  }
  if (viaRestore.offer_name !== 'coins_2' || viaRestore.revenue !== 2.99 || viaRestore.order_id !== 'demo-order-2' || viaRestore.source !== 'restore' || viaRestore.status !== 'restore') {
    fail(`restored purchase event: ${JSON.stringify(viaRestore)}`);
  }

  // 4. the debug line
  await page.waitForFunction(() => /granted 2 \(restored 1\)/.test(window.__showcase.purchaseDemo.status.text), null, { timeout: WAIT_MS });
  info = await read();
  if (!/granted coins_2 · granted 2 \(restored 1\) · dup 0 · held 0 · saves 2 · PAYER/.test(info.status)) fail(`status line: ${info.status}`);
  await page.waitForTimeout(350);
  const file = resolve(outDir, 'purchase-01-debug-line.png');
  await page.screenshot({ path: file });
  console.log(`shot ${file}`);
  console.log(`status: ${info.status}`);
  console.log(`purchase events: ${JSON.stringify(info.events)}`);
  console.log(`analytics: ${JSON.stringify(got)}`);

  await page.close();
  await context.close();
  await browser.close();
  if (foreign.length) fail(`requests left the dev server:\n${foreign.join('\n')}`);
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('purchase demo check: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
