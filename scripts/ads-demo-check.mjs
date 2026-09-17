// AdsRuntime demo proof in the showcase, with Playwright on the installed Google Chrome
// (the sandboxed in-app browser has no WebGL; Playwright's own Chromium is not downloaded).
//
//   npm run showcase -- --host 0.0.0.0     (in another terminal)
//   SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:ads
//
// One bounded smoke: a real tap on the ADS pill runs the scripted fake player
// (L1 → L15 → L20 → rewarded → cooldown → payer → NO_ADS) through AdsRuntime on the REAL donor
// tables; the script checks the decision timeline (placement / segment / allowed / reason /
// counts), the runtime's stats and the analytics the composition handler queued. AdsRuntime never
// shows an ad — nothing leaves the page (the script fails on any request outside the dev server).
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

// step · level · segment · kind · placement · reason / counts
const EXPECTED = [
  ['L1', 1, 'np_1', 'denied', 'level_win_inter', 'below_start_level'],
  ['L15', 15, 'np_1', 'offered', 'level_win_inter', null],
  ['L15', 15, 'np_1', 'shown', 'level_win_inter', 'day 1 · hour 1'],
  ['L15', 15, 'np_1', 'denied', 'level_fail_inter', 'inter_cooldown'],
  ['L20', 20, 'np_2', 'offered', 'level_win_inter', null],
  ['L20', 20, 'np_2', 'offered', 'banner', null],
  ['rewarded', 20, 'np_2', 'offered', 'ad_hint_booster_rewarded', null],
  ['rewarded', 20, 'np_2', 'shown', 'ad_hint_booster_rewarded', 'day 1 · hour 1'],
  ['rewarded', 20, 'np_2', 'denied', 'ad_hint_booster_rewarded', 'day_limit'],
  ['cooldown', 20, 'np_2', 'denied', 'level_win_inter', 'reward_cooldown'],
  ['cooldown', 20, 'np_2', 'offered', 'level_win_inter', null],
  ['payer', 20, 'pay_8', 'profile', 'paid $2.99 → markPayer', null],
  ['payer', 20, 'pay_8', 'offered', 'level_win_inter', null],
  ['payer', 20, 'pay_8', 'denied', 'banner', 'no_rule'],
  ['payer', 20, 'pay_8', 'offered', 'ad_level_win_x2_rewarded', null],
  ['NO_ADS', 20, 'pay_8', 'profile', 'bought NO_ADS', null],
  ['NO_ADS', 20, 'pay_8', 'denied', 'level_win_inter', 'no_ads'],
  ['NO_ADS', 20, 'pay_8', 'denied', 'banner', 'no_ads'],
  ['NO_ADS', 20, 'pay_8', 'offered', 'ad_refill_hearts_rewarded', null] // rewarded survives NO_ADS
];

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

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: 30000 });
  // the welcome offer pops once per session — close it so the ADS pill is reachable
  await page.waitForFunction(() => window.__showcase.ui.activeWindow?.state === 'shown', null, { timeout: WAIT_MS });
  await page.evaluate(() => window.__showcase.ui.activeWindow?.close('programmatic'));
  await page.waitForFunction(() => window.__showcase.ui.activeWindow === null, null, { timeout: WAIT_MS });
  if (!(await page.evaluate(() => Object.keys(window.__showcase.stats()).includes('ads')))) fail('ads is not registered with CoreRuntime');

  // a real tap on the ADS pill (Pixi events → ButtonController → the scenario)
  const pillAt = await page.evaluate(() => {
    const pill = window.__showcase.toolbar.children.find((child) => child.labelText?.text === 'ADS');
    const p = pill.getGlobalPosition();
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(pillAt.x, pillAt.y);
  await page.waitForFunction(() => window.__showcase.adsDemo.panel.visible === true, null, { timeout: WAIT_MS });

  const info = await page.evaluate(() => {
    const s = window.__showcase;
    const label = (e) => (e.event.name === 'interaction' ? e.event.data.action : e.event.name);
    return {
      timeline: s.adsDemo.timeline.map((e) => [e.step, e.level, e.segment, e.kind, e.placement, e.reason ?? e.counts]),
      text: s.adsDemo.text.text,
      stats: s.ads.getStats(),
      // asked AFTER the stats were read: one more allowed decision → a 9th ad_offered in the analytics below
      snapshot: s.ads.canShowRewarded('ad_refill_hearts_rewarded'),
      queued: s.analytics.getStats().queued
    };
  });

  if (JSON.stringify(info.timeline) !== JSON.stringify(EXPECTED)) {
    fail(`timeline differs:\n got ${JSON.stringify(info.timeline, null, 1)}\n want ${JSON.stringify(EXPECTED, null, 1)}`);
  }
  const { stats } = info;
  if (stats.segmentId !== 'pay_8' || stats.payer !== true || stats.offered !== 8 || stats.denied !== 7 || stats.shown !== 2) fail(`stats: ${JSON.stringify(stats)}`);
  const wantDeny = { below_start_level: 1, inter_cooldown: 1, day_limit: 1, reward_cooldown: 1, no_rule: 1, no_ads: 2 };
  for (const [reason, count] of Object.entries(stats.denyByReason)) {
    if (count !== (wantDeny[reason] ?? 0)) fail(`denyByReason.${reason} = ${count}: ${JSON.stringify(stats.denyByReason)}`);
  }
  if (stats.counts.level_win_inter?.day !== 1 || stats.counts.ad_hint_booster_rewarded?.day !== 1) fail(`counts: ${JSON.stringify(stats.counts)}`);
  if (stats.callbackErrors !== 0 || stats.storeErrors !== 0) fail(`errors: ${JSON.stringify(stats)}`);
  if (info.snapshot !== true) fail('rewarded must stay available for a NO_ADS buyer');
  if (!/^ADS · segment pay_8 · PAYER · offered 8 · denied 7 · shown 2/.test(info.text)) fail(`panel header: ${info.text.split('\n')[0]}`);
  for (const needle of ['DENIED  level_win_inter · below_start_level', 'SHOWN   ad_hint_booster_rewarded · day 1 · hour 1', 'DENIED  banner · no_ads', 'ALLOWED ad_refill_hearts_rewarded']) {
    if (!info.text.includes(needle)) fail(`the panel lacks "${needle}":\n${info.text}`);
  }

  // analytics composition: every ad event went through createAdsAnalyticsHandler into the FAKE transport's queue
  await page.evaluate(() => window.__showcase.analytics.flush());
  await page.waitForFunction(() => window.__showcase.analytics.getStats().queued === 0, null, { timeout: WAIT_MS });
  const sent = await page.evaluate(() =>
    window.__showcase.analyticsTransport.batches.flat()
      .map((e) => ({ name: e.event.name === 'interaction' ? e.event.data.action : e.event.name, data: e.event.data }))
      .filter((e) => e.name.startsWith('ad_') || e.name === 'advertisement'));
  const names = sent.map((e) => e.name);
  const count = (name) => names.filter((n) => n === name).length;
  if (count('ad_offered') !== 9 || count('ad_denied') !== 7 || count('advertisement') !== 2) fail(`analytics: ${JSON.stringify(names)}`);
  const shown = sent.filter((e) => e.name === 'advertisement').map((e) => `${e.data.type}:${e.data.placement}:${e.data.status}`);
  if (JSON.stringify(shown) !== JSON.stringify(['interstitial:level_win_inter:complete', 'rewarded:ad_hint_booster_rewarded:complete'])) fail(`advertisement events: ${shown}`);
  const denied = sent.find((e) => e.name === 'ad_denied' && e.data.reason === 'reward_cooldown');
  if (!denied || denied.data.segment !== 'np_2' || denied.data.placement !== 'level_win_inter') fail(`ad_denied: ${JSON.stringify(denied)}`);

  await page.waitForTimeout(350);
  const file = resolve(outDir, 'ads-01-timeline.png');
  await page.screenshot({ path: file });
  console.log(`shot ${file}`);
  console.log(info.text);

  await page.close();
  await context.close();
  await browser.close();
  if (foreign.length) fail(`requests left the dev server:\n${foreign.join('\n')}`);
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('ads demo check: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
