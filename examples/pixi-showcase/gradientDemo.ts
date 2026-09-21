// Gradient primitive proof (Theme System V1.2): one 390 × 844 @2x canvas with the Bubble surfaces taken apart —
// the pure body gradient, the gloss alone, the lip alone, everything together — next to their V1.1 counterparts, plus a
// level-node sphere, a shop card and a display number. `scripts/gradient-check.mjs` reads the pixels back and measures
// the luminance profile down the middle of every surface: a smooth ramp has no per-pixel jump, a stripe has one.
import { Application, Container, FillGradient, Graphics, Rectangle, Text } from 'pixi.js';
import { BUBBLE_READY_UI_THEME, createLabel, drawAwning, drawCard, drawLevelNodeBase, drawLevelNodeWall, drawSurface, type UiFill, type UiSurfaceStyle } from 'game-core/pixi';

declare global {
  interface Window {
    __gradient?: { ready: boolean; surfaces: SurfaceInfo[]; profile: (name: string, xOffset?: number) => number[]; column: (x: number, top: number, bottom: number) => number[]; lab: { app: Application; Graphics: typeof Graphics; FillGradient: typeof FillGradient } };
  }
}

interface SurfaceInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const theme = BUBBLE_READY_UI_THEME;
const W = 439;
const H = 207;
const S = 0.4;
const surfaces: SurfaceInfo[] = [];

const app = new Application();
await app.init({ width: 390, height: 844, resolution: 2, autoDensity: true, background: 0x22304f, antialias: true, preference: 'webgl' });
document.body.appendChild(app.canvas);

function place(name: string, x: number, y: number, draw: (g: Graphics) => void, w = W, h = H, scale = S): void {
  const root = new Container();
  root.position.set(x, y);
  root.scale.set(scale);
  const g = new Graphics();
  draw(g);
  root.addChild(g);
  app.stage.addChild(root);
  const label = new Text({ text: name, style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0xd8e2ff } });
  label.anchor.set(0.5, 0);
  label.position.set(x, y + (h * scale) / 2 + 4);
  app.stage.addChild(label);
  surfaces.push({ name, x, y, width: w * scale, height: h * scale });
}

const plain = (fill: UiFill): UiSurfaceStyle => ({ fill, radius: 34, border: null, depth: null, shadow: null });
const solid = (color: number): UiFill => ({ type: 'solid', color });
// the V1.1 positive button: a two-stop body, an opaque flat gloss stripe, a flat lip
const v11: UiSurfaceStyle = {
  fill: { type: 'linear-gradient', from: 0x4fd02c, to: 0x31ad1d, direction: 'vertical' },
  radius: 34,
  border: { color: 0x196e10, width: 5, alpha: 0.85 },
  depth: { color: 0x229417, height: 26, style: 'strip' },
  shadow: { color: 0x000000, alpha: 0.22, offsetY: 8, layers: 2 },
  highlight: { color: 0x84f846, height: 48, alpha: 0.9 }
};
const v12 = theme.button.positive;
const box = (g: Graphics, style: UiSurfaceStyle): void => drawSurface(g, -W / 2, -H / 2, W, H, style);

// the awning across the top
{
  const g = new Graphics();
  if (theme.awning) drawAwning(g, -195, 0, 390, 60, theme.awning);
  g.position.set(195, 0);
  app.stage.addChild(g);
  surfaces.push({ name: 'awning', x: 195, y: 30, width: 390, height: 60 });
}

place('A · pure 2-stop body (V1.1)', 100, 130, (g) => box(g, plain(v11.fill)));
place('A2 · pure 3-stop body (V1.2)', 290, 130, (g) => box(g, plain(v12.fill)));
place('B · hard gloss stripe (V1.1)', 100, 260, (g) => box(g, { ...plain(solid(0x3fc424)), highlight: v11.highlight ?? null }));
place('B2 · soft gloss (V1.2)', 290, 260, (g) => box(g, { ...plain(solid(0x3fc424)), highlight: v12.highlight ?? null }));
place('C · lip strip only', 100, 390, (g) => box(g, { ...plain(solid(0x3fc424)), depth: v12.depth }));
place('C2 · lip with its own gradient (card)', 290, 390, (g) => box(g, { ...plain(theme.card.fill), depth: theme.card.depth }));
place('D · V1.1 positive, all layers', 100, 520, (g) => box(g, v11));
place('D2 · V1.2 positive, all layers', 290, 520, (g) => box(g, v12));
// a level node at rest: the still base (ring + floor), the wall up to the cap's rest elevation, the sphere-shaded cap
const nodeSkin = theme.levelNode as NonNullable<typeof theme.levelNode>;
const drawNode = (g: Graphics, state: 'current' | 'locked', selected: boolean): void => {
  const style = nodeSkin[state];
  drawLevelNodeBase(g, 300, selected ? nodeSkin.selectedRing : style.ring, style.base, nodeSkin.ringRatio, nodeSkin.shadow);
  const inner = 150 - 300 * nodeSkin.ringRatio;
  const capRadius = inner - 300 * nodeSkin.capInset;
  const rest = nodeSkin.restElevation * capRadius * 2;
  drawLevelNodeWall(g, capRadius, inner, rest, style.side);
  drawSurface(g, -capRadius, -capRadius - rest, capRadius * 2, capRadius * 2, { ...style.cap, shadow: null }, 'capsule');
};
place('N · node (selected)', 80, 690, (g) => drawNode(g, 'current', true), 300, 300, 0.5);
place('N2 · node (locked)', 200, 690, (g) => drawNode(g, 'locked', false), 300, 300, 0.4);
place('K · shop card', 320, 690, (g) => drawCard(g, -159, -209, 318, 418, theme.card), 318, 418, 0.36);
{
  const number = createLabel(theme, '1 000', { fontSize: 68, stroke: 8, fill: theme.text.numberFill ?? theme.text.fill });
  number.position.set(320, 660);
  number.scale.set(0.6);
  app.stage.addChild(number);
}

let extracted: { pixels: Uint8ClampedArray; width: number; height: number } | null = null;
/** Luminance down one canvas column (px at 2×), re-reading the pixels after any change to the stage. */
function column(cx: number, top: number, bottom: number): number[] {
  app.render();
  extracted = app.renderer.extract.pixels({ target: app.stage, frame: new Rectangle(0, 0, 390, 844), resolution: 2 });
  const out: number[] = [];
  for (let y = top; y < bottom; y++) {
    const i = (y * extracted.width + cx) * 4;
    const r = extracted.pixels[i] ?? 0;
    const g = extracted.pixels[i + 1] ?? 0;
    const b = extracted.pixels[i + 2] ?? 0;
    out.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
  }
  return out;
}
function profile(name: string, xOffset = 0): number[] {
  const info = surfaces.find((s) => s.name.startsWith(name));
  if (!info) throw new Error(`no surface ${name}`);
  const res = 2;
  return column(Math.round((info.x + xOffset) * res), Math.round((info.y - info.height / 2) * res), Math.round((info.y + info.height / 2) * res));
}

app.render();
window.__gradient = { ready: true, surfaces, profile, column, lab: { app, Graphics, FillGradient } };
