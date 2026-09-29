// Figma SVG exports → Ready UI textures, 9-slice aware. Rasterised in the installed Google Chrome (Playwright
// channel 'chrome'; the kit's other checks use it too), encoded lossless with `cwebp`.
//
//   node scripts/figma-assets.mjs docs/figma/confirm-exit            writes assets/pixi-ui/<asset.file>, prints a report
//   node scripts/figma-assets.mjs docs/figma/confirm-exit --check    re-renders and fails if a committed texture differs
//
// Input: <dir>/figma.json `assets[]` — each asset is one or more Figma SVG exports composed at Figma offsets
// (`layers[].at`, units) on a `size` canvas (units), rasterised at `scale` px per unit. The file name carries the
// scale (`@2x` / `@0.5x`), which Pixi reads as the texture resolution, so `texture.width` stays in design units.
//
// 9-slice assets (`nineSlice`): the Figma @stretch insets (box units) plus the art's `pad` (stroke / shadow bleed
// outside the box) give the texture caps. The raster is then MEASURED: the columns / rows identical to the centre
// ones form the region that may stretch. If a Figma cap is too small (an effect or a corner reaches into the
// stretch area), the cap grows to the measured one plus a uniform `gutter` (so filtering at the seam samples the
// same colour on both sides) and the report says so — the texture never stretches art.
// The texture keeps the caps plus `strip` units of the uniform centre; the report proves the crop is lossless by
// rebuilding the full size from it and diffing against the full raster.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const check = args.includes('--check');
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? 'docs/figma/confirm-exit');
const spec = JSON.parse(readFileSync(join(dir, 'figma.json'), 'utf8'));
const outRoot = resolve('assets/pixi-ui');
const TOLERANCE = 0; // "identical" rows / columns = byte-identical, so the crop + rebuild is exactly lossless
// --check decodes the committed webp through a canvas and compares visible (premultiplied) values: ±1 rounding on each side
const COMMITTED_TOLERANCE = 2;

async function renderAsset({ asset, layers, tolerance, committed }) {
  const S = asset.scale;
  const [W, H] = asset.size;
  const pw = Math.round(W * S);
  const ph = Math.round(H * S);
  const full = document.createElement('canvas');
  full.width = pw;
  full.height = ph;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  for (const layer of layers) {
    // resize the SVG's own box so Chrome rasterises the vector at the target density (not a scaled bitmap)
    const m = /<svg width="([\d.]+)" height="([\d.]+)"/.exec(layer.svg);
    const lw = Number(m[1]) * S;
    const lh = Number(m[2]) * S;
    const svg = layer.svg.replace(m[0], `<svg width="${lw}" height="${lh}"`);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
    await img.decode();
    ctx.drawImage(img, layer.at[0] * S, layer.at[1] * S, lw, lh);
  }
  const data = ctx.getImageData(0, 0, pw, ph).data;
  const same = (a, b) => {
    for (let c = 0; c < 4; c++) if (Math.abs(data[a + c] - data[b + c]) > tolerance) return false;
    return true;
  };
  const at = (x, y) => (y * pw + x) * 4;
  const result = { px: [pw, ph] };
  let out = full;

  if (asset.nineSlice) {
    const pad = asset.pad;
    const figma = asset.nineSlice.figma;
    const cx = Math.floor(pw / 2);
    const cy = Math.floor(ph / 2);
    const colSame = (x) => { for (let y = 0; y < ph; y++) if (!same(at(x, y), at(cx, y))) return false; return true; };
    const rowSame = (y) => { for (let x = 0; x < pw; x++) if (!same(at(x, y), at(x, cy))) return false; return true; };
    let x0 = cx; while (x0 > 0 && colSame(x0 - 1)) x0--;
    let x1 = cx; while (x1 < pw - 1 && colSame(x1 + 1)) x1++;
    let y0 = cy; while (y0 > 0 && rowSame(y0 - 1)) y0--;
    let y1 = cy; while (y1 < ph - 1 && rowSame(y1 + 1)) y1++;
    // texture units; the measured caps round up to whole units
    const measured = { left: Math.ceil(x0 / S), top: Math.ceil(y0 / S), right: Math.ceil((pw - 1 - x1) / S), bottom: Math.ceil((ph - 1 - y1) / S) };
    const fromFigma = { left: pad.left + figma.left, top: pad.top + figma.top, right: pad.right + figma.right, bottom: pad.bottom + figma.bottom };
    // gutter: uniform texels kept on the cap side of every seam, so bilinear / mipmap sampling of the stretched
    // centre never blends in the art next to it (without it the header's inner shadow smears down the body)
    const gutter = asset.nineSlice.gutter ?? 0;
    const caps = {};
    for (const side of ['left', 'top', 'right', 'bottom']) caps[side] = Math.max(fromFigma[side], measured[side] + gutter);
    const strip = asset.nineSlice.strip;
    const L = caps.left * S, T = caps.top * S, R = caps.right * S, B = caps.bottom * S, C = strip * S;
    out = document.createElement('canvas');
    out.width = L + C + R;
    out.height = T + C + B;
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.imageSmoothingEnabled = false;
    const cols = [[0, 0, L], [L, L, C], [pw - R, L + C, R]];
    const rows = [[0, 0, T], [T, T, C], [ph - B, T + C, B]];
    for (const [sy, dy, h] of rows) for (const [sx, dx, w] of cols) octx.drawImage(full, sx, sy, w, h, dx, dy, w, h);

    // lossless proof: rebuild the full size from the cropped texture (centre strip stretched) and diff
    const rebuilt = document.createElement('canvas');
    rebuilt.width = pw;
    rebuilt.height = ph;
    const rctx = rebuilt.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingEnabled = false;
    const dcols = [[0, 0, L, L], [L, L, C, pw - L - R], [L + C, pw - R, R, R]];
    const drows = [[0, 0, T, T], [T, T, C, ph - T - B], [T + C, ph - B, B, B]];
    for (const [sy, dy, sh, dh] of drows) for (const [sx, dx, sw, dw] of dcols) rctx.drawImage(out, sx, sy, sw, sh, dx, dy, dw, dh);
    const back = rctx.getImageData(0, 0, pw, ph).data;
    let maxDelta = 0;
    for (let i = 0; i < back.length; i++) maxDelta = Math.max(maxDelta, Math.abs(back[i] - data[i]));
    Object.assign(result, { figmaCaps: fromFigma, measuredCaps: measured, gutter, caps, grown: Object.keys(caps).filter((s) => caps[s] > fromFigma[s]), strip, rebuildMaxDelta: maxDelta });
  }

  result.texturePx = [out.width, out.height];
  result.textureUnits = [out.width / S, out.height / S];
  if (committed) {
    const img = new Image();
    img.src = committed;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const cctx = c.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(img, 0, 0);
    const a = cctx.getImageData(0, 0, c.width, c.height).data;
    const b = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, out.width, out.height).data;
    // visible values: alpha and premultiplied colour (a canvas stores premultiplied pixels, so the RGB of a pixel
    // with alpha 3 / 255 comes back from getImageData up to ±40 off — invisible, and not a difference in the file)
    let maxDelta = a.length === b.length ? 0 : 255;
    if (a.length === b.length) {
      for (let i = 0; i < a.length; i += 4) {
        maxDelta = Math.max(maxDelta, Math.abs(a[i + 3] - b[i + 3]));
        for (let c = 0; c < 3; c++) maxDelta = Math.max(maxDelta, Math.abs((a[i + c] * a[i + 3] - b[i + c] * b[i + 3]) / 255));
      }
    }
    result.committedMaxDelta = maxDelta;
    return result;
  }
  result.png = out.toDataURL('image/png').slice('data:image/png;base64,'.length);
  return result;
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
const report = [];
let failed = false;
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>figma-assets</title>');
  const tmp = mkdtempSync(join(tmpdir(), 'figma-assets-'));
  for (const asset of spec.assets) {
    const layers = asset.layers.map((l) => ({ at: l.at, svg: readFileSync(join(dir, l.svg), 'utf8') }));
    const out = join(outRoot, asset.file);
    const committed = check ? 'data:image/webp;base64,' + readFileSync(out).toString('base64') : null;
    const result = await page.evaluate(renderAsset, { asset, layers, tolerance: TOLERANCE, committed });
    if (!check) {
      const png = join(tmp, `${asset.key}.png`);
      writeFileSync(png, Buffer.from(result.png, 'base64'));
      mkdirSync(dirname(out), { recursive: true });
      execFileSync('cwebp', ['-quiet', '-lossless', '-exact', '-z', '9', '-metadata', 'none', png, '-o', out]);
      delete result.png;
      result.bytes = readFileSync(out).length;
    } else if (result.committedMaxDelta > COMMITTED_TOLERANCE) {
      failed = true;
    }
    if (result.rebuildMaxDelta > 0) failed = true;
    report.push({ key: asset.key, file: asset.file, scale: asset.scale, ...result });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
if (failed) {
  console.error(check ? 'figma-assets: a committed texture differs from the Figma source render' : 'figma-assets: a 9-slice crop is not lossless');
  process.exit(1);
}
