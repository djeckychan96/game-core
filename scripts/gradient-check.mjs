// Gradient primitive proof (Theme System V1.2) — Playwright on the installed Chrome against examples/pixi-showcase/
// gradient.html: reads the rendered pixels back and measures the luminance profile down the middle of every surface.
// A smooth ramp has no per-pixel jump above a couple of levels; a flat stripe shows as one jump. Fails if the pure
// body gradients, the soft gloss, the V1.2 button body (above its lip), the node sphere or the awning are not smooth.
//
//   npm run showcase:gradient            # starts its own Vite server on 5196+, writes showcase-shots/gradient/gradient.png
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, devices } from 'playwright';

const root = process.cwd();
const outDir = process.env.SHOTS_DIR ?? resolve(root, 'showcase-shots/gradient');
mkdirSync(outDir, { recursive: true });
const server = await createServer({ configFile: resolve(root, 'vite.showcase.config.ts'), root: resolve(root, 'examples/pixi-showcase'), server: { port: 5196, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const failures = [];
const rows = [];
function stats(profile, from, to) {
  const slice = profile.slice(from, to);
  let maxDelta = 0;
  let at = -1;
  for (let i = 1; i < slice.length; i++) {
    const d = Math.abs(slice[i] - slice[i - 1]);
    if (d > maxDelta) { maxDelta = d; at = from + i; }
  }
  return { maxDelta, at, range: Math.max(...slice) - Math.min(...slice), length: slice.length };
}
function check(name, ok, detail) {
  rows.push(`${ok ? '  ok  ' : ' FAIL '} ${name}  ${detail}`);
  if (!ok) failures.push(name);
}
try {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/favicon|SwiftShader|GPU stall|WebGL/i.test(msg.text())) errors.push(msg.text()); });
  await page.goto(new URL('gradient.html', base).href, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__gradient?.ready), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, 'gradient.png') });
  const profile = (name, xOffset) => page.evaluate(([n, dx]) => window.__gradient.profile(n, dx), [name, xOffset ?? 0]);
  const S = 0.4, RES = 2;
  const bodyPx = Math.round(207 * S * RES); // 166
  const edge = 6; // the outline / anti-aliased edge rows
  const a = stats(await profile('A ·'), 2, bodyPx - 2);
  const a2 = stats(await profile('A2 ·'), 2, bodyPx - 2);
  check('A: the pure two-stop body is a smooth ramp (no jump > 2 levels/px)', a.maxDelta <= 2 && a.range >= 12, JSON.stringify(a));
  check('A2: the pure three-stop body is a smooth ramp', a2.maxDelta <= 2 && a2.range >= 12, JSON.stringify(a2));
  const b = stats(await profile('B ·'), 2, bodyPx - 2);
  const b2 = stats(await profile('B2 ·'), 2, bodyPx - 2);
  rows.push(`  info  B: the V1.1 flat gloss stripe has a hard edge — ${JSON.stringify(b)} (the root cause, kept for comparison)`);
  check('B2: the soft gloss fades into the body without an edge', b2.maxDelta <= 3, JSON.stringify(b2));
  const lipPx = Math.round(24 * S * RES), shadowPx = Math.round(8 * S * RES);
  const d2 = await profile('D2 ·');
  const d2body = stats(d2, edge, bodyPx - shadowPx - lipPx - 3);
  const d2lip = stats(d2, bodyPx - shadowPx - lipPx - 3, bodyPx - shadowPx - edge);
  check('D2: the V1.2 button has no hard boundary inside its body (gloss + body, above the lip)', d2body.maxDelta <= 4, JSON.stringify(d2body));
  check('D2: the lip is still a mechanical edge under the body', d2lip.maxDelta >= 6, JSON.stringify(d2lip));
  const d = await profile('D ·');
  rows.push(`  info  D: the V1.1 button body — ${JSON.stringify(stats(d, edge, bodyPx - shadowPx - Math.round(26 * S * RES) - 3))}`);
  // the cap covers the node inside its ring (ringRatio 0.06 × 300 = 18 units): the profile runs down the cap
  const ringN = Math.round(18 * 0.5 * RES), nodePx = 300 * 0.5 * RES;
  const n = stats(await profile('N ·'), ringN + 3, nodePx - ringN - 3);
  check('N: the node cap is one smooth sphere inside its ring', n.maxDelta <= 3, JSON.stringify(n));
  const ringN2 = Math.round(18 * 0.4 * RES);
  const n2 = stats(await profile('N2 ·'), ringN2 + 3, 300 * 0.4 * RES - ringN2 - 3);
  check('N2: the locked node cap is one smooth sphere inside its ring', n2.maxDelta <= 3, JSON.stringify(n2));
  const stripe = 390 / 7;
  const aw = stats(await profile('awning', -195 + stripe / 2), 2, Math.round((60 - 12 - stripe / 2) * RES) - 2);
  check('awning: a stripe is smooth from its top through its gloss into its body', aw.maxDelta <= 4, JSON.stringify(aw));
  const c2 = await profile('C2 ·');
  const band = stats(c2, bodyPx - Math.round(98 * S * RES) + 2, bodyPx - 2);
  rows.push(`  info  C2: the card's green zone — ${JSON.stringify(band)} (one jump = the lip edge at 86 %)`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
console.log(rows.join('\n'));
console.log(failures.length ? `\n${failures.length} FAILED` : `\ngradient proof OK → ${outDir}/gradient.png`);
process.exit(failures.length ? 1 : 0);
