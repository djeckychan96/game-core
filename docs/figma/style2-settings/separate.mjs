// Style 2 Settings (8:17493): separates the static surfaces from Figma's own transparent renders (get_screenshot
// contentsOnly of the screen's top-level instances, render/): the surfaces sit inside resized instances, which the MCP
// cannot render alone. A surface keeps Figma's pixels wherever nothing covers it; under a known cover (the icon / slash
// components' own renders, png/) it is unmixed — straight-alpha source-over inverted; under an opaque cover (or text)
// it takes its row's value from uncovered columns (the surfaces are vertical gradients / flat fills: a row is constant
// away from the rounded edges). The popup corner under the close is its mirror (the popup is symmetric); the close is
// what lies over that panel (mirror of its own uncovered half, else red · t + black shadow solved per pixel).
// Prints the validation: separated ⊕ covers against the render. Writes png/ (the figma-assets inputs).
//
//   node docs/figma/style2-settings/separate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = { 'r-popup-8-17495.png': 'render/popup-8-17495.png', 'r-sound-on-8-17497.png': 'render/sound-on-8-17497.png',
  'r-music-off-8-17498.png': 'render/music-off-8-17498.png', 'r-restart-8-17501.png': 'render/restart-8-17501.png',
  'r-home-8-17502.png': 'render/home-8-17502.png', 'c-icon-sound-8-17512.png': 'png/icon-sound.png',
  'c-icon-music-8-17519.png': 'png/icon-music.png', 'c-red-line-8-17554.png': 'png/red-line.png' };
const OUT = join(DIR, 'png');
const b64 = (f) => readFileSync(join(DIR, SRC[f])).toString('base64');
const files = ['r-popup-8-17495.png', 'r-sound-on-8-17497.png', 'r-music-off-8-17498.png', 'r-restart-8-17501.png', 'r-home-8-17502.png',
  'c-icon-sound-8-17512.png', 'c-icon-music-8-17519.png', 'c-red-line-8-17554.png'];
const input = Object.fromEntries(files.map((f) => [f, b64(f)]));
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage();
const result = await page.evaluate(async (input) => {
  const img = async (name) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + input[name]; await i.decode();
    const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0);
    // float straight RGBA
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const f = new Float64Array(d.length); for (let k = 0; k < d.length; k++) f[k] = d[k] / 255;
    return { w: c.width, h: c.height, d: f };
  };
  const blank = (w, h) => ({ w, h, d: new Float64Array(w * h * 4) });
  const get = (im, x, y) => { if (x < 0 || y < 0 || x >= im.w || y >= im.h) return [0, 0, 0, 0]; const i = (y * im.w + x) * 4; return [im.d[i], im.d[i + 1], im.d[i + 2], im.d[i + 3]]; };
  const set = (im, x, y, p) => { const i = (y * im.w + x) * 4; for (let c = 0; c < 4; c++) im.d[i + c] = p[c]; };
  const copy = (im) => ({ w: im.w, h: im.h, d: Float64Array.from(im.d) });
  // straight-alpha source-over: top over bottom
  const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); if (a <= 0) return [0, 0, 0, 0]; const r = [0, 0, 0, a]; for (let c = 0; c < 3; c++) r[c] = (t[c] * t[3] + b[c] * b[3] * (1 - t[3])) / a; return r; };
  // invert: C = T over S  →  S (null when T is too opaque to tell)
  const under = (C, T, maxA = 0.6) => {
    if (T[3] <= 0) return C;
    if (T[3] > maxA) return null;
    const sa = (C[3] - T[3]) / (1 - T[3]);
    if (sa <= 0.002) return [0, 0, 0, 0];
    const s = [0, 0, 0, Math.min(1, sa)];
    for (let c = 0; c < 3; c++) s[c] = Math.min(1, Math.max(0, (C[c] * C[3] - T[c] * T[3]) / ((1 - T[3]) * sa)));
    return s;
  };
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; };
  // the row value of a surface from the given columns (whose pixels are known clean)
  const rowValue = (im, y, cols) => {
    const ch = [[], [], [], []];
    for (const x of cols) { const p = get(im, x, y); for (let c = 0; c < 4; c++) ch[c].push(p[c]); }
    return ch[0].length ? ch.map(median) : null;
  };
  const layerAt = (layer, ox, oy) => (x, y) => get(layer, x - ox, y - oy);
  const toPng = (im) => {
    const c = document.createElement('canvas'); c.width = im.w; c.height = im.h; const x = c.getContext('2d');
    const id = x.createImageData(im.w, im.h); for (let k = 0; k < im.d.length; k++) id.data[k] = Math.round(Math.min(1, Math.max(0, im.d[k])) * 255);
    x.putImageData(id, 0, 0); return c.toDataURL('image/png').split(',')[1];
  };
  // re-encode through 8 bits like the PNG will be
  const q = (p) => p.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255);
  const diff = (A, B, region) => {
    let max = 0, sum = 0, n = 0;
    for (let y = region[1]; y < region[1] + region[3]; y++) for (let x = region[0]; x < region[0] + region[2]; x++) {
      const a = get(A, x, y), b = get(B, x, y);
      for (let c = 0; c < 4; c++) { const va = c === 3 ? a[3] : a[c] * a[3], vb = c === 3 ? b[3] : b[c] * b[3]; const d = Math.abs(va - vb) * 255; max = Math.max(max, d); sum += d; n++; }
    }
    return { max: +max.toFixed(2), mean: +(sum / n).toFixed(3) };
  };
  const out = {}, report = {};

  // ---- toggles: surface under icon (+ line) at 18,15 ----
  const iconSound = await img('c-icon-sound-8-17512.png'), iconMusic = await img('c-icon-music-8-17519.png'), line = await img('c-red-line-8-17554.png');
  const toggleSurface = (C, covers) => {
    const S = copy(C);
    const coverAt = (x, y) => covers.map((f) => f(x, y));
    const clean = (x, y) => coverAt(x, y).every((p) => p[3] === 0);
    const unresolved = [];
    for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) {
      if (clean(x, y)) continue;
      let p = get(C, x, y);
      for (const t of coverAt(x, y)) { if (!p) break; p = under(p, t); } // covers listed top-first
      if (p) set(S, x, y, p); else unresolved.push([x, y]);
    }
    // rows are constant inside the rect away from its edges (x 14..213): opaque covers take their row's clean value
    for (const [x, y] of unresolved) {
      const cols = []; for (let cx = 14; cx <= 213; cx++) if (clean(cx, y)) cols.push(cx);
      const v = rowValue(C, y, cols);
      set(S, x, y, v ?? [0, 0, 0, 0]);
      if (!v) report.noRow = (report.noRow ?? 0) + 1;
    }
    return { S, unresolved: unresolved.length };
  };
  const soundOn = await img('r-sound-on-8-17497.png');
  const blue = toggleSurface(soundOn, [layerAt(iconSound, 18, 15)]);
  const musicOffLine = await img('r-music-off-8-17498.png');
  const grey = toggleSurface(musicOffLine, [layerAt(line, 18, 15), layerAt(iconMusic, 18, 15)]);
  // validation: separated surface ⊕ the exact icon (⊕ line) against Figma's render
  const compose = (S, layers) => { const R = copy(S); for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) { let p = q(get(S, x, y)); for (const l of layers) p = over(l(x, y), p); set(R, x, y, p); } return R; };
  report.blueSoundVsFigma = diff(compose(blue.S, [layerAt(iconSound, 18, 15)]), soundOn, [0, 0, 228, 228]);
  report.greyMusicLineVsFigma = diff(compose(grey.S, [layerAt(iconMusic, 18, 15), layerAt(line, 18, 15)]), musicOffLine, [0, 0, 228, 228]);
  report.unresolved = { blue: blue.unresolved, grey: grey.unresolved };
  out['toggle-blue.png'] = toPng(blue.S); out['toggle-grey.png'] = toPng(grey.S);

  // ---- action buttons: icon + text are inside the straight section; their rows take the clean columns' value ----
  const action = async (name, x0, x1, left, right) => {
    const C = await img(name); const S = copy(C); let spread = 0;
    for (let y = 0; y < C.h; y++) {
      const cols = []; for (let x = left[0]; x <= left[1]; x++) cols.push(x); for (let x = right[0]; x <= right[1]; x++) cols.push(x);
      const v = rowValue(C, y, cols);
      const l = rowValue(C, y, cols.filter((x) => x <= left[1])), r = rowValue(C, y, cols.filter((x) => x >= right[0]));
      for (let c = 0; c < 4; c++) spread = Math.max(spread, Math.abs(l[c] - r[c]) * 255);
      for (let x = x0; x <= x1; x++) set(S, x, y, v);
    }
    return { S, spread: +spread.toFixed(2) };
  };
  // restart: icon render 146..304, text 318..671 (button-local) → fill 140..680 from 60..135 ∪ 685..760
  const green = await action('r-restart-8-17501.png', 140, 680, [60, 135], [685, 760]);
  // home: icon render 132.5..298.5, text 309..682 → fill 126..690 from 60..120 ∪ 696..760
  const red = await action('r-home-8-17502.png', 126, 690, [60, 120], [696, 760]);
  report.actionRowSpread = { green: green.spread, red: red.spread };
  out['btn-green.png'] = toPng(green.S); out['btn-red.png'] = toPng(red.S);

  // ---- popup: render origin = screen (40, 598); box 0..1000 × 49..1099 ----
  const popup = await img('r-popup-8-17495.png');
  const panel = blank(1000, 1099);
  for (let y = 0; y < 1099; y++) for (let x = 0; x < 1000; x++) set(panel, x, y, get(popup, x, y));
  // title (render 267..733 × 34..110) on the header: header rows are constant on its straight section (191..809)
  let titleSpread = 0;
  for (let y = 28; y <= 116; y++) {
    const l = []; for (let x = 196; x <= 258; x++) l.push(x); const r = []; for (let x = 742; x <= 804; x++) r.push(x);
    const v = rowValue(popup, y, [...l, ...r]); const vl = rowValue(popup, y, l), vr = rowValue(popup, y, r);
    for (let c = 0; c < 4; c++) titleSpread = Math.max(titleSpread, Math.abs(vl[c] - vr[c]) * 255);
    for (let x = 262; x <= 738; x++) set(panel, x, y, v);
  }
  // the close (render 887..1040 × 12..170) covers the popup's top-right corner: the popup is mirror-symmetric (x ↦ 999 − x)
  for (let y = 0; y <= 180; y++) for (let x = 860; x < 1000; x++) set(panel, x, y, get(popup, 999 - x, y));
  // symmetry proof on rows the close does not reach
  let mirrorMax = 0; for (let y = 181; y < 1099; y++) for (let x = 860; x < 1000; x++) { const a = get(popup, x, y), b = get(popup, 999 - x, y); for (let c = 0; c < 4; c++) mirrorMax = Math.max(mirrorMax, Math.abs((c === 3 ? a[3] : a[c] * a[3]) - (c === 3 ? b[3] : b[c] * b[3])) * 255); }
  report.popup = { titleRowSpread: +titleSpread.toFixed(2), mirrorMaxBelowClose: +mirrorMax.toFixed(2) };
  out['settings-panel.png'] = toPng(panel);

  // ---- close: F with C = F over P (P = the cleaned panel). Close btn box screen 938..1074 → mirror x ↦ 1931 − x (render) ----
  const close = blank(153, 158); // render 887..1039 × 12..169
  const P = (x, y) => get(panel, x, y);
  const inRed = (x, y) => { // rect 906..1025 × 31..150 (render), radius 41: opaque body
    const L = 906, T = 31, R = 1025, B = 150, r = 41; if (x < L || x > R || y < T || y > B) return false;
    const cx = Math.min(Math.max(x, L + r), R - r), cy = Math.min(Math.max(y, T + r), B - r); return (x - cx) ** 2 + (y - cy) ** 2 <= (r - 1) ** 2;
  };
  // the red body's colour per column (its lowest opaque row): an edge pixel of the close is red · t + black shadow
  const redOf = (x) => { for (let y = 150; y >= 31; y--) if (inRed(x, y)) return get(popup, x, y); return null; };
  const Fat = (x, y) => {
    const C = get(popup, x, y), Pb = P(x, y);
    if (Pb[3] === 0) return C;
    if (inRed(x, y)) return C;
    const xm = 1931 - x;
    if (xm >= 1000) return xm < 1040 ? get(popup, xm, y) : [0, 0, 0, 0]; // mirror from where nothing is under the close
    // C = F over P with F = (u · red, v) premultiplied: alpha gives v when P is not opaque, colour gives u (least squares)
    const Rc = redOf(x) ?? [0, 0, 0, 1];
    const Cp = [C[0] * C[3], C[1] * C[3], C[2] * C[3]], Pp = [Pb[0] * Pb[3], Pb[1] * Pb[3], Pb[2] * Pb[3]];
    let u, v;
    if (Pb[3] < 0.98) {
      v = Math.min(1, Math.max(0, (C[3] - Pb[3]) / (1 - Pb[3])));
      let num = 0, den = 0; for (let c = 0; c < 3; c++) { num += (Cp[c] - Pp[c] * (1 - v)) * Rc[c]; den += Rc[c] * Rc[c]; }
      u = den > 1e-6 ? num / den : 0;
    } else {
      // Cp − Pp = u·Rc − v·Pp
      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
      for (let c = 0; c < 3; c++) { const d = Cp[c] - Pp[c]; a11 += Rc[c] * Rc[c]; a12 += -Rc[c] * Pp[c]; a22 += Pp[c] * Pp[c]; b1 += Rc[c] * d; b2 += -Pp[c] * d; }
      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) > 1e-9) { u = (b1 * a22 - a12 * b2) / det; v = (a11 * b2 - a12 * b1) / det; }
      else { u = 0; v = 0; }
    }
    v = Math.min(1, Math.max(0, v)); u = Math.min(v, Math.max(0, u));
    report.closeUnmixed = (report.closeUnmixed ?? 0) + 1;
    if (v <= 0.002) return [0, 0, 0, 0];
    return [Rc[0] * u / v, Rc[1] * u / v, Rc[2] * u / v, v];
  };
  for (let y = 0; y < 158; y++) for (let x = 0; x < 153; x++) set(close, x, y, Fat(887 + x, 12 + y));
  // validation: close over the cleaned panel against Figma's popup render
  const re = copy(popup);
  for (let y = 0; y < 158; y++) for (let x = 0; x < 153; x++) { const px = 887 + x, py = 12 + y; set(re, px, py, over(q(get(close, x, y)), q(P(px, py)))); }
  report.closeOverPanelVsFigma = diff(re, popup, [887, 12, 153, 158]);
  out['settings-close.png'] = toPng(close);
  return { out, report };
}, input);
for (const [name, data] of Object.entries(result.out)) writeFileSync(`${OUT}/${name}`, Buffer.from(data, 'base64'));
console.log(JSON.stringify(result.report, null, 1));
await browser.close();
