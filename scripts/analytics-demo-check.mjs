// AnalyticsRuntime demo proof in the showcase, with Playwright on the installed Google Chrome
// (the sandboxed in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase -- --host 0.0.0.0     (in another terminal)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:analytics
//
// One bounded smoke: the session/loading events leave at boot; the welcome offer's `offer_activated`
// arrives through the composition wiring; a real BUY tap goes through PurchaseRuntime (fake payments
// adapter): `purchase_started` / `purchase_ok`, the Hazar `purchase` event and the chain's
// `offer_purchased`; the AD pill queues an `advertisement`; FLUSH delivers one batch to the
// FAKE transport (nothing leaves the page — the script fails on any request outside the dev server).
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
        stats: s.analytics.getStats(),
        batches: s.analyticsTransport.batches.map((batch) => batch.map(label)),
        events: s.analyticsTransport.batches.flat(),
        status: s.analyticsDemo.status.text,
        coreStats: Object.keys(s.stats())
      };
    });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__showcase?.analytics), null, { timeout: 30000 });

  // 1. boot: sessions + loading were flushed at once (before any 10 s cadence)
  await page.waitForFunction(() => window.__showcase.analyticsTransport.batches.length >= 1, null, { timeout: WAIT_MS });
  let info = await read();
  if (JSON.stringify(info.batches[0]) !== JSON.stringify(['sessions', 'loading'])) fail(`boot batch: ${JSON.stringify(info.batches)}`);
  if (!info.coreStats.includes('analytics')) fail('analytics is not registered with CoreRuntime');

  // 2. the welcome offer activates → offer_activated is queued by the composition handler (not sent yet: batching)
  await page.waitForFunction(() => window.__showcase.offers.getStats().active === 'starter_pack', null, { timeout: WAIT_MS });
  await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
  info = await read();
  if (info.stats.queued < 1) fail(`offer_activated was not queued: ${JSON.stringify(info.stats)}`);

  // 3. a real BUY tap → PurchaseRuntime on the fake adapter → purchase funnel + purchase event + the chain's offer_purchased
  const buyAt = await page.evaluate(() => {
    const p = window.__showcase.starterWindow.buyButton.getGlobalPosition();
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(buyAt.x, buyAt.y);
  await page.waitForFunction(() => window.__showcase.offers.getStats().purchases === 1, null, { timeout: WAIT_MS });
  await page.evaluate(() => window.__showcase.ui.activeWindow?.close('programmatic'));
  await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });

  // 4. a fake rewarded ad through the AD pill's action, then one explicit flush (a host: visibilitychange)
  await page.evaluate(() => window.__showcase.analyticsDemo.ad());
  const sentBefore = (await read()).stats.sent;
  await page.evaluate(() => window.__showcase.analytics.flush());
  await page.waitForFunction(() => window.__showcase.analytics.getStats().queued === 0, null, { timeout: WAIT_MS });
  info = await read();

  const all = info.batches.flat();
  const expected = ['sessions', 'loading', 'offer_activated', 'purchase_started', 'purchase_ok', 'purchase', 'offer_purchased', 'advertisement'];
  if (JSON.stringify(all) !== JSON.stringify(expected)) fail(`event order differs:\n got ${JSON.stringify(all)}\n want ${JSON.stringify(expected)}`);
  if (info.stats.sent !== expected.length || info.stats.sent <= sentBefore) fail(`sent counter: ${JSON.stringify(info.stats)}`);
  const lastBatch = info.batches[info.batches.length - 1];
  if (lastBatch.length < 2) fail(`the flush should deliver a batch, not single events: ${JSON.stringify(info.batches)}`);

  for (const envelope of info.events) {
    const { app, p, event } = envelope;
    if (app !== 'game_core_showcase' || p !== 'DEV') fail(`envelope app/p: ${JSON.stringify(envelope)}`);
    if (event.app_ver !== 'showcase') fail(`app_ver is not the build's: ${event.app_ver}`);
    if (event.data.profile_id !== 'showcase-local-profile') fail(`profile_id missing on ${event.name}`);
    if (event.data.config_name !== 'showcase_default' || event.data.config_group !== 'control') fail(`A/B fields missing on ${event.name}`);
    if (typeof event.created_at !== 'number') fail(`created_at missing on ${event.name}`);
  }
  const purchase = info.events.find((e) => e.event.name === 'purchase').event.data;
  if (purchase.offer_name !== 'starter_pack' || purchase.revenue !== 0.99 || purchase.currency !== 'USD' || purchase.order_id !== 'demo-order-1' || purchase.status !== 'success' || purchase.source !== 'offer_window') {
    fail(`purchase event: ${JSON.stringify(purchase)}`);
  }
  const ad = info.events.find((e) => e.event.name === 'advertisement').event.data;
  if (ad.type !== 'rewarded' || ad.placement !== 'showcase_strip' || ad.status !== 'complete') fail(`advertisement event: ${JSON.stringify(ad)}`);
  const moved = info.events.find((e) => e.event.data.action === 'offer_purchased').event.data;
  if (moved.product !== 'starter_pack' || moved.moved !== 1) fail(`offer_purchased: ${JSON.stringify(moved)}`);

  // 5. the debug line shows the last batch and the counters
  await page.waitForFunction(() => /sent 8 · batches 2/.test(window.__showcase.analyticsDemo.status.text), null, { timeout: WAIT_MS });
  info = await read();
  if (!/last \[offer_activated, purchase_started, purchase_ok, purchase, offer_purchased, advertisement\]/.test(info.status)) fail(`status line: ${info.status}`);
  await page.waitForTimeout(350);
  const file = resolve(outDir, 'analytics-01-debug-line.png');
  await page.screenshot({ path: file });
  console.log(`shot ${file}`);
  console.log(`status: ${info.status}`);
  console.log(`batches: ${JSON.stringify(info.batches)}`);

  await page.close();
  await context.close();
  await browser.close();
  if (foreign.length) fail(`requests left the dev server:\n${foreign.join('\n')}`);
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('analytics demo check: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
