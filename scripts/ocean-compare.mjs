// Deterministic frame-by-frame comparison of the production ocean ripple:
//   Trail Arrow (ArrowRenderer.spawnOceanRipple, READ ONLY donor)  vs  the Game Core showcase.
//
//   DONOR_URL=http://127.0.0.1:8091/ SHOWCASE_URL=http://127.0.0.1:5180/ node scripts/ocean-compare.mjs
//
// Both apps run at 390 × 844 @2x in the installed Chrome under a virtual clock installed before
// they boot (performance.now / Date.now / requestAnimationFrame), so GSAP's ticker, Pixi's ticker
// and every animation advance only when this script steps them, 1/60 s at a time; every frame is
// exact: first frame, the birth of the second ring, the middle, the end. Each frame is diffed against a no-ripple baseline of the same scene, the ring
// radius / stroke width / alpha are measured from the pixels, and donor vs Core must agree.
// Quick repeated taps, the maxActive = 8 cap and pool reuse are compared through the two apps'
// counters (`__ocean()` vs `ripple.getStats()`). Crops and a montage land in showcase-shots/ocean.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium, devices } from 'playwright';

const donorUrl = process.env.DONOR_URL ?? 'http://127.0.0.1:8091/';
const showcaseUrl = process.env.SHOWCASE_URL ?? 'http://127.0.0.1:5180/';
const outDir = resolve(process.cwd(), 'showcase-shots/ocean');
mkdirSync(outDir, { recursive: true });

const STEP_MS = 1000 / 60;
const DPR = 2;
const CROP = 80; // css px around the tap point
/** Frames to capture, in 1/60 s steps after the tap. */
const FRAMES = [
  { name: 'first', steps: 1 },       // 16.7 ms
  { name: 'second-ring', steps: 8 }, // 133 ms: the 0.18-phase ring has just been born (111.6 ms)
  { name: 'mid', steps: 19 },        // 317 ms
  { name: 'late', steps: 33 },       // 550 ms
  { name: 'end', steps: 38 }         // 633 ms > 620 ms: both rings gone
];

/** Production formula (ArrowRenderer.updateOceanRipples) for the expected numbers. */
function expectedRings(elapsedMs) {
  const t = Math.min(1, elapsedMs / 620);
  if (t >= 1) return [];
  const out = [];
  for (const phase of [0, 0.18]) {
    const k = Math.min(1, Math.max(0, (t - phase) / (1 - phase)));
    if (k <= 0 && phase > 0) continue;
    out.push({ radius: 10 + 46 * k, width: 3 - 1.8 * k, alpha: 0.6 * (1 - k) });
  }
  return out;
}

// ---------- minimal PNG codec (8-bit RGB/RGBA, non-interlaced) ----------
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, channels = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error('unsupported PNG layout');
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = line[x * channels];
      out[(y * width + x) * 4 + 1] = line[x * channels + 1];
      out[(y * width + x) * 4 + 2] = line[x * channels + 2];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}
function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([head, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crop(img, cx, cy, half) {
  const x0 = Math.round(cx - half), y0 = Math.round(cy - half);
  const size = half * 2;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x0 + x, sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      img.data.copy(data, (y * size + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return { width: size, height: size, data };
}

/**
 * Measures the rings in a frame: the absolute diff against the baseline (same scene, no ripple)
 * is averaged around 72 angles into a radial profile; every peak is a ring. Alpha is estimated
 * from the composite of white over the baseline pixel (diff = alpha × (255 − background)).
 */
function measureRings(frame, base, cx, cy) {
  const maxR = Math.round(CROP * DPR) - 2;
  const profile = new Float64Array(maxR + 1);
  const alphaProfile = new Float64Array(maxR + 1);
  const angles = 72;
  for (let r = 0; r <= maxR; r++) {
    let diffSum = 0, alphaSum = 0;
    for (let a = 0; a < angles; a++) {
      const th = (a / angles) * Math.PI * 2;
      const x = Math.round(cx + r * Math.cos(th)), y = Math.round(cy + r * Math.sin(th));
      const i = (y * frame.width + x) * 4;
      let diff = 0, alpha = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(frame.data[i + c] - base.data[i + c]);
        diff += d;
        const headroom = 255 - base.data[i + c];
        if (headroom > 40) alpha += d / headroom;
      }
      diffSum += diff / 3;
      alphaSum += alpha / 3;
    }
    profile[r] = diffSum / angles;
    alphaProfile[r] = alphaSum / angles;
  }
  const rings = [];
  const threshold = 6;
  let r = 1;
  while (r < maxR) {
    if (profile[r] > threshold && profile[r] >= profile[r - 1] && profile[r] >= profile[r + 1]) {
      // walk the bump: half-maximum width
      const peak = profile[r];
      let lo = r, hi = r;
      while (lo > 0 && profile[lo - 1] >= peak / 2) lo--;
      while (hi < maxR && profile[hi + 1] >= peak / 2) hi++;
      // sub-pixel radius: intensity-weighted centre of the bump
      let wsum = 0, rsum = 0;
      for (let q = lo; q <= hi; q++) { wsum += profile[q]; rsum += profile[q] * q; }
      rings.push({ radius: rsum / wsum / DPR, width: (hi - lo + 1) / DPR, alpha: alphaProfile[r], peak });
      r = hi + 2;
    } else r++;
  }
  return rings;
}

/**
 * Virtual clock, installed before any page script: while "live" it follows real time and pumps
 * requestAnimationFrame from the real one (so both apps boot normally); after `__clock.freeze()`
 * time only moves through `__clock.step(ms)`, which advances the clock and runs the queued
 * animation-frame callbacks once with that timestamp. GSAP captures `Date.now` at module init and
 * Pixi's Ticker reads `performance.now()`, so both tickers become exact and deterministic.
 */
const VIRTUAL_CLOCK = `(() => {
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realRaf = window.requestAnimationFrame.bind(window);
  let frozen = false;
  let vnow = realPerfNow();
  let lastReal = vnow;
  const dateBase = realDateNow() - vnow;
  let queue = new Map();
  let nextId = 1;
  let pumpScheduled = false;
  const now = () => {
    if (!frozen) { const r = realPerfNow(); vnow += r - lastReal; lastReal = r; }
    return vnow;
  };
  const drain = (ts) => {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const cb of callbacks) { try { cb(ts); } catch (e) { console.error(e); } }
  };
  performance.now = now;
  Date.now = () => dateBase + now();
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    if (!frozen && !pumpScheduled) {
      pumpScheduled = true;
      realRaf(() => { pumpScheduled = false; if (!frozen) drain(now()); });
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => { queue.delete(id); };
  window.__clock = {
    freeze() { now(); frozen = true; },
    step(ms) { if (!frozen) throw new Error('freeze first'); vnow += ms; drain(vnow); },
    get frozen() { return frozen; },
    now
  };
})();`;

async function launchPage(browser, url, ready) {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR });
  await context.addInitScript(VIRTUAL_CLOCK);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(ready, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__clock.freeze());
  return { context, page, errors };
}

const stepper = (page) => (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__clock.step(1000 / 60); }, n);

async function shoot(page) {
  return decodePng(await page.screenshot({ type: 'png' }));
}

async function run() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const report = {};

  // ---------- donor ----------
  const donor = await launchPage(browser, donorUrl, () => Boolean(window.__ocean && window.__arrowAt));
  const donorStep = stepper(donor.page);
  await donorStep(3);
  // an empty tap point: no arrow under it (the same search the touch uses), verified by the
  // counter; the lower part of the tray first, away from the arrows and the tutorial hand
  const donorSpot = await donor.page.evaluate(() => {
    const spots = [];
    for (const y of [600, 560, 640, 520]) for (const x of [195, 100, 290, 60, 330]) if (window.__arrowAt(x, y) === null) spots.push({ x, y });
    return spots;
  });
  let donorTap = null;
  const donorBase = await shoot(donor.page);
  for (const spot of donorSpot) {
    const before = await donor.page.evaluate(() => window.__ocean().active);
    await donor.page.mouse.click(spot.x, spot.y);
    const after = await donor.page.evaluate(() => window.__ocean().active);
    if (after === before + 1) { donorTap = spot; break; }
    await donorStep(90); // an arrow moved instead: let it settle, try the next spot
  }
  if (!donorTap) throw new Error('donor: no empty tap point found');
  console.log('donor tap', JSON.stringify(donorTap));
  report.donor = { tap: donorTap, frames: {} };
  let donorSteps = 0;
  for (const frame of FRAMES) {
    await donorStep(frame.steps - donorSteps);
    donorSteps = frame.steps;
    const img = await shoot(donor.page);
    const cx = donorTap.x * DPR, cy = donorTap.y * DPR;
    writeFileSync(resolve(outDir, `donor-${frame.name}.png`), encodePng(crop(img, cx, cy, CROP * DPR)));
    report.donor.frames[frame.name] = { elapsedMs: frame.steps * STEP_MS, rings: measureRings(img, donorBase, cx, cy), counters: await donor.page.evaluate(() => window.__ocean()) };
  }
  // quick repeated taps: 9 taps within 9 frames → the cap of 8, oldest recycled, pool never grows past 8
  await donorStep(60);
  for (let i = 0; i < 9; i++) { await donor.page.mouse.click(donorTap.x, donorTap.y); await donorStep(1); }
  report.donor.burst = await donor.page.evaluate(() => window.__ocean());
  await donorStep(40);
  report.donor.afterBurst = await donor.page.evaluate(() => window.__ocean());
  // pool reuse: a second single tap after everything faded creates nothing new
  await donor.page.mouse.click(donorTap.x, donorTap.y);
  report.donor.reuse = await donor.page.evaluate(() => window.__ocean());
  await donor.context.close();

  // ---------- Game Core showcase ----------
  const core = await launchPage(browser, showcaseUrl, () => Boolean(window.__showcase));
  const coreStep = stepper(core.page);
  await coreStep(3);
  const coreTap = await core.page.evaluate(() => {
    const s = window.__showcase;
    const boundary = s.app.renderer.events.rootBoundary;
    boundary.rootTarget = s.app.stage;
    const free = new Set([s.app.stage, s.map]);
    for (const y of [300, 340, 380, 420, 460, 500]) for (const x of [60, 100, 330, 300, 195]) { const hit = boundary.hitTest(x, y); if (hit && free.has(hit)) return { x, y }; }
    return null;
  });
  if (!coreTap) throw new Error('showcase: no free tap point found');
  console.log('core tap', JSON.stringify(coreTap));
  const coreBase = await shoot(core.page);
  await core.page.mouse.click(coreTap.x, coreTap.y);
  const spawned = await core.page.evaluate(() => window.__showcase.ripple.getStats().spawned);
  if (spawned !== 1) throw new Error(`showcase tap did not spawn exactly one ripple (${spawned})`);
  report.core = { tap: coreTap, frames: {} };
  let coreSteps = 0;
  for (const frame of FRAMES) {
    await coreStep(frame.steps - coreSteps);
    coreSteps = frame.steps;
    const img = await shoot(core.page);
    const cx = coreTap.x * DPR, cy = coreTap.y * DPR;
    writeFileSync(resolve(outDir, `core-${frame.name}.png`), encodePng(crop(img, cx, cy, CROP * DPR)));
    report.core.frames[frame.name] = { elapsedMs: frame.steps * STEP_MS, rings: measureRings(img, coreBase, cx, cy), counters: await core.page.evaluate(() => window.__showcase.ripple.getStats()) };
  }
  await coreStep(60);
  for (let i = 0; i < 9; i++) { await core.page.mouse.click(coreTap.x, coreTap.y); await coreStep(1); }
  report.core.burst = await core.page.evaluate(() => window.__showcase.ripple.getStats());
  await coreStep(40);
  report.core.afterBurst = await core.page.evaluate(() => window.__showcase.ripple.getStats());
  await core.page.mouse.click(coreTap.x, coreTap.y);
  report.core.reuse = await core.page.evaluate(() => window.__showcase.ripple.getStats());
  await core.context.close();

  // ---------- montage ----------
  const cells = FRAMES.map((f) => `<div><h3>${f.name} · ${Math.round(f.steps * STEP_MS)} ms</h3><img src="donor-${f.name}.png"><img src="core-${f.name}.png"></div>`).join('');
  writeFileSync(resolve(outDir, 'montage.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#ddd;font:13px/1.3 -apple-system,sans-serif;padding:12px}h1{font-size:15px;margin:0 0 8px}h3{font-size:12px;margin:8px 0 4px;font-weight:600}.row{display:flex;gap:10px}div img{display:block;width:160px;height:160px;image-rendering:auto;margin-bottom:2px;border:1px solid #333}.leg{display:flex;gap:10px;margin-top:6px}</style><h1>Ocean ripple · top = Trail Arrow production (ArrowRenderer.spawnOceanRipple), bottom = Game Core ClickRippleEffect</h1><div class="row">${cells}</div>`);
  const montagePage = await browser.newPage({ viewport: { width: 12 + FRAMES.length * 170 + 12, height: 420 } });
  await montagePage.goto('file://' + resolve(outDir, 'montage.html'));
  await montagePage.screenshot({ path: resolve(outDir, 'ocean-compare.png') });
  await montagePage.close();
  await browser.close();

  // ---------- verdict ----------
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const problems = [];
  const fmt = (r) => r.map((x) => `r=${x.radius.toFixed(1)} w=${x.width.toFixed(1)} a=${x.alpha.toFixed(2)}`).join(' | ') || '(none)';
  // two rings closer than ~2.5 px merge into one bump in the pixels; merge them in the formula too
  const mergeClose = (list) => {
    const sorted = [...list].sort((a, b) => a.radius - b.radius);
    const out = [];
    for (const ring of sorted) {
      const last = out[out.length - 1];
      if (last && ring.radius - last.radius < 2.5) { last.radius = (last.radius + ring.radius) / 2; last.width += ring.width; last.alpha = Math.max(last.alpha, ring.alpha); }
      else out.push({ ...ring });
    }
    return out;
  };
  for (const frame of FRAMES) {
    const d = report.donor.frames[frame.name], c = report.core.frames[frame.name];
    const expected = mergeClose(expectedRings(frame.steps * STEP_MS));
    console.log(`${frame.name.padEnd(12)} ${String(Math.round(frame.steps * STEP_MS)).padStart(4)} ms  expected ${fmt(expected)}\n${''.padEnd(21)}donor    ${fmt(d.rings)}\n${''.padEnd(21)}core     ${fmt(c.rings)}`);
    if (d.rings.length !== expected.length) problems.push(`${frame.name}: donor shows ${d.rings.length} rings, formula says ${expected.length}`);
    if (c.rings.length !== expected.length) problems.push(`${frame.name}: core shows ${c.rings.length} rings, formula says ${expected.length}`);
    for (let i = 0; i < Math.min(d.rings.length, c.rings.length); i++) {
      const dr = d.rings[i], cr = c.rings[i];
      if (Math.abs(dr.radius - cr.radius) > 1) problems.push(`${frame.name} ring ${i}: radius donor ${dr.radius.toFixed(2)} vs core ${cr.radius.toFixed(2)}`);
      if (Math.abs(dr.width - cr.width) > 1) problems.push(`${frame.name} ring ${i}: width donor ${dr.width.toFixed(2)} vs core ${cr.width.toFixed(2)}`);
      if (Math.abs(dr.alpha - cr.alpha) > 0.1) problems.push(`${frame.name} ring ${i}: alpha donor ${dr.alpha.toFixed(2)} vs core ${cr.alpha.toFixed(2)}`);
    }
  }
  console.log('burst      donor', JSON.stringify(report.donor.burst), ' core', JSON.stringify({ active: report.core.burst.activeRipples, created: report.core.burst.createdRings / 2, recycled: report.core.burst.recycled }));
  console.log('after burst donor', JSON.stringify(report.donor.afterBurst), ' core', JSON.stringify({ active: report.core.afterBurst.activeRipples, created: report.core.afterBurst.createdRings / 2 }));
  console.log('reuse      donor', JSON.stringify(report.donor.reuse), ' core', JSON.stringify({ active: report.core.reuse.activeRipples, created: report.core.reuse.createdRings / 2 }));
  if (report.donor.burst.active !== 8 || report.donor.burst.pool !== 8) problems.push(`donor burst: ${JSON.stringify(report.donor.burst)}`);
  if (report.core.burst.activeRipples !== 8 || report.core.burst.createdRings !== 16 || report.core.burst.recycled !== 1) problems.push(`core burst: ${JSON.stringify(report.core.burst)}`);
  if (report.donor.afterBurst.active !== 0 || report.core.afterBurst.activeRipples !== 0) problems.push('burst did not fade out');
  if (report.donor.reuse.pool !== 8 || report.core.reuse.createdRings !== 16) problems.push('pool grew on reuse');
  console.log(`crops + montage: ${outDir}`);
  if (problems.length) {
    console.error('ocean-compare: MISMATCH\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('ocean-compare: OK (donor and Core agree frame by frame)');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
