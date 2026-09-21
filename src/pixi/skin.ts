// Programmatic skins of the Ready UI kit — Theme System V1.
//
// Everything a theme can recolour is drawn here with Pixi 8 Graphics (vector geometry: it scales under a contain-fit
// without pixelation, unlike a stretched bitmap): rounded surfaces with a fill (solid or linear gradient through
// FillGradient), a border, a depth lip and a hard shadow; the standard window panel with its header band; the shop
// card; the × of the close control. Nothing here is redrawn per frame: a surface draws itself once when created and
// again only when its size, style or state actually changes (`redrawCount` tells).
//
// Every skin is drawn INSIDE its declared box (the border is inside-aligned, the shadow takes its offset from the body
// height, the box is the container's `boundsArea`), so a theme never moves a layout, never changes a hit area, never
// changes the bounds a window is fitted from.
import { Container, FillGradient, Graphics, Rectangle, type FillInput } from 'pixi.js';
import type { UiAwningStyle, UiBand, UiCardStyle, UiCloseStyle, UiColorStop, UiFill, UiPanelStyle, UiSurfaceStyle } from './theme';

/**
 * `rounded`: a rounded rect (`radius` from the style). `capsule`: half-height corners. `ribbon`: notched ends (a title
 * ribbon). `tab`: rounded top corners over a flat bottom edge (a tab rising from its bar).
 */
export type UiSurfaceShape = 'rounded' | 'capsule' | 'ribbon' | 'tab';

const gradients = new Map<string, FillGradient>();

/** A colour stop for Pixi: the hex colour, or RGBA components in 0..1 when the stop has an alpha of its own. */
function stopColor(stop: UiColorStop): number | [number, number, number, number] {
  if (stop.alpha === undefined) return stop.color;
  return [((stop.color >> 16) & 0xff) / 255, ((stop.color >> 8) & 0xff) / 255, (stop.color & 0xff) / 255, stop.alpha];
}

/**
 * The Pixi fill for a theme fill. Gradients are `FillGradient`s in the shape's own (local) space — Pixi maps the
 * gradient onto each filled path's bounds (`generateTextureMatrix`) — so one gradient serves every surface with the
 * same stops; they are cached for the lifetime of the module (a handful per theme). The gradient is a 256-texel
 * texture sampled with linear filtering: a smooth ramp, never a stepped one.
 */
export function toFillInput(fill: UiFill): FillInput {
  if (fill.type === 'solid') return { color: fill.color, alpha: fill.alpha ?? 1 };
  const stops = fill.type === 'linear-gradient' ? fill.stops ?? [{ offset: 0, color: fill.from }, { offset: 1, color: fill.to }] : fill.stops;
  const key = fill.type === 'linear-gradient' ? `l:${fill.direction}:${JSON.stringify(stops)}` : `r:${JSON.stringify([fill.center, stops])}`;
  let gradient = gradients.get(key);
  if (!gradient) {
    const colorStops = stops.map((stop) => ({ offset: stop.offset, color: stopColor(stop) }));
    // Radial: the outer circle is ALWAYS the box's inscribed circle (centre 0.5 / 0.5, radius 0.5). Pixi 8.14 maps a
    // local-space radial gradient through `outerCenter − outerRadius` in unscaled units, so any other outer circle
    // lands the whole shape outside the gradient texture (a flat last-stop colour). The light point (`center`, the
    // inner circle) may sit anywhere inside — that is what gives a sphere its upper highlight.
    gradient =
      fill.type === 'linear-gradient'
        ? new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: fill.direction === 'vertical' ? { x: 0, y: 1 } : { x: 1, y: 0 }, colorStops, textureSpace: 'local' })
        : new FillGradient({ type: 'radial', center: fill.center ?? { x: 0.5, y: 0.4 }, innerRadius: 0, outerCenter: { x: 0.5, y: 0.5 }, outerRadius: 0.5, colorStops, textureSpace: 'local' });
    gradients.set(key, gradient);
  }
  return { fill: gradient, alpha: fill.alpha ?? 1 };
}

/** The fill of a gloss band: a flat colour, or — with `soft` — the colour fading to transparent towards the inner edge. */
export function bandFill(band: UiBand): FillInput {
  const alpha = band.alpha ?? 1;
  const soft = Math.min(1, Math.max(0, band.soft ?? 0));
  if (soft <= 0) return { color: band.color, alpha };
  return toFillInput({
    type: 'linear-gradient',
    from: band.color,
    to: band.color,
    direction: 'vertical',
    stops: [
      { offset: 0, color: band.color, alpha },
      { offset: 1 - soft, color: band.color, alpha },
      { offset: 1, color: band.color, alpha: 0 }
    ]
  });
}

function cornerRadius(radius: number, width: number, height: number): number {
  const max = Math.max(0, Math.min(width, height) / 2);
  return radius < 0 ? max : Math.min(Math.max(0, radius), max);
}

function ribbonNotch(width: number, height: number): number {
  return Math.min(height * 0.35, width * 0.08);
}

function shapePath(g: Graphics, shape: UiSurfaceShape, x: number, y: number, width: number, height: number, radius: number): Graphics {
  if (shape === 'ribbon') {
    const notch = ribbonNotch(width, height);
    return g.moveTo(x, y).lineTo(x + width, y).lineTo(x + width - notch, y + height / 2).lineTo(x + width, y + height).lineTo(x, y + height).lineTo(x + notch, y + height / 2).closePath();
  }
  if (shape === 'tab') return topRoundedPath(g, x, y, width, height, radius);
  return g.roundRect(x, y, width, height, cornerRadius(shape === 'capsule' ? -1 : radius, width, height));
}

/** A rect with rounded top corners and a flat bottom edge (the header band of a panel, a tab). */
function topRoundedPath(g: Graphics, x: number, y: number, width: number, height: number, radius: number): Graphics {
  const r = cornerRadius(radius, width, height * 2);
  return g.moveTo(x, y + height).lineTo(x, y + r).arcTo(x, y, x + r, y, r).lineTo(x + width - r, y).arcTo(x + width, y, x + width, y + r, r).lineTo(x + width, y + height).closePath();
}

const HALF_PI = Math.PI / 2;

/**
 * The strip of a shape along its top or bottom edge, `strip` tall, cut exactly by the shape's own corners (a straight
 * inner boundary): the gloss band and the flat lip of the Bubble skin. A strip as tall as the shape is the shape.
 */
function stripPath(g: Graphics, shape: UiSurfaceShape, x: number, y: number, width: number, height: number, radius: number, strip: number, edge: 'top' | 'bottom'): Graphics {
  const h = Math.min(strip, height);
  if (h >= height) return shapePath(g, shape, x, y, width, height, radius);
  if (shape === 'ribbon') {
    // the notch edges run from the corners to the middle of the ends: the strip's inner corners follow them
    const inset = ribbonNotch(width, height) * Math.min(1, (2 * h) / height);
    if (edge === 'top') return g.moveTo(x, y).lineTo(x + width, y).lineTo(x + width - inset, y + h).lineTo(x + inset, y + h).closePath();
    return g.moveTo(x + inset, y + height - h).lineTo(x + width - inset, y + height - h).lineTo(x + width, y + height).lineTo(x, y + height).closePath();
  }
  const r = shape === 'tab' ? cornerRadius(radius, width, height * 2) : cornerRadius(shape === 'capsule' ? -1 : radius, width, height);
  if (edge === 'bottom' && shape === 'tab') return g.rect(x, y + height - h, width, h);
  if (edge === 'top') {
    if (h >= r) return g.moveTo(x, y + h).lineTo(x, y + r).arcTo(x, y, x + r, y, r).lineTo(x + width - r, y).arcTo(x + width, y, x + width, y + r, r).lineTo(x + width, y + h).closePath();
    // the strip ends inside the corner arcs: from the left arc's point at y + h, over the top, down the right arc
    const a = Math.acos((r - h) / r);
    const dx = r - r * Math.sin(a);
    return g.moveTo(x + dx, y + h).arc(x + r, y + r, r, 3 * HALF_PI - a, 3 * HALF_PI).lineTo(x + width - r, y).arc(x + width - r, y + r, r, 3 * HALF_PI, 3 * HALF_PI + a).lineTo(x + width - dx, y + h).closePath();
  }
  const bottom = y + height;
  if (h >= r) return g.moveTo(x + width, bottom - h).lineTo(x + width, bottom - r).arcTo(x + width, bottom, x + width - r, bottom, r).lineTo(x + r, bottom).arcTo(x, bottom, x, bottom - r, r).lineTo(x, bottom - h).closePath();
  const a = Math.acos((r - h) / r);
  const dx = r - r * Math.sin(a);
  return g.moveTo(x + width - dx, bottom - h).arc(x + width - r, bottom - r, r, HALF_PI - a, HALF_PI).lineTo(x + r, bottom).arc(x + r, bottom - r, r, HALF_PI, HALF_PI + a).lineTo(x + dx, bottom - h).closePath();
}

/**
 * Draws one surface into `g` inside the box (x, y, width, height): shadow → depth lip → body → gloss band → inside
 * border. The body is `height − shadow.offsetY` tall so the shadow stays inside the box. A `'plate'` lip is drawn
 * under a smaller body (the donor's stacked look); a `'strip'` lip and the gloss band are strips of the body's own
 * outline over it.
 */
export function drawSurface(g: Graphics, x: number, y: number, width: number, height: number, style: UiSurfaceStyle, shape: UiSurfaceShape = 'rounded'): void {
  const shadow = style.shadow;
  const bodyHeight = Math.max(1, height - (shadow ? Math.max(0, shadow.offsetY) : 0));
  if (shadow && shadow.alpha > 0) {
    const layers = Math.max(1, Math.floor(shadow.layers ?? 1));
    for (let i = 1; i <= layers; i++) {
      shapePath(g, shape, x, y + (shadow.offsetY * i) / layers, width, bodyHeight, style.radius).fill({ color: shadow.color, alpha: shadow.alpha / layers });
    }
  }
  const depth = style.depth;
  const lip = depth && depth.height > 0 && depth.height < bodyHeight ? depth : null;
  if (lip && (lip.style ?? 'plate') === 'plate') {
    shapePath(g, shape, x, y, width, bodyHeight, style.radius).fill({ color: lip.color });
    const top = lip.edge === 'top';
    shapePath(g, shape, x, top ? y + lip.height : y, width, bodyHeight - lip.height, style.radius).fill(toFillInput(style.fill));
  } else {
    shapePath(g, shape, x, y, width, bodyHeight, style.radius).fill(toFillInput(style.fill));
    if (lip) stripPath(g, shape, x, y, width, bodyHeight, style.radius, lip.height, lip.edge ?? 'bottom').fill(lip.fill ? toFillInput(lip.fill) : { color: lip.color });
  }
  const highlight = style.highlight;
  if (highlight && highlight.height > 0 && (highlight.alpha ?? 1) > 0) {
    stripPath(g, shape, x, y, width, bodyHeight, style.radius, highlight.height, 'top').fill(bandFill(highlight));
  }
  const border = style.border;
  if (border && border.width > 0) {
    shapePath(g, shape, x, y, width, bodyHeight, style.radius).stroke({ color: border.color, alpha: border.alpha ?? 1, width: border.width, alignment: 1, join: 'round' });
  }
}

/** The standard window surface: the body surface, then the header band (`headerHeight` incl. its divider), then the border. */
export function drawPanel(g: Graphics, x: number, y: number, width: number, height: number, style: UiPanelStyle, headerHeight: number = style.headerHeight): void {
  const border = style.border;
  drawSurface(g, x, y, width, height, { ...style, border: null });
  const band = Math.min(Math.max(0, headerHeight), height);
  if (style.headerFill && band > 0) {
    topRoundedPath(g, x, y, width, band, style.radius).fill(toFillInput(style.headerFill));
    const divider = style.headerDivider;
    if (divider && divider.width > 0) {
      g.rect(x, y + Math.max(0, band - divider.width), width, Math.min(divider.width, band)).fill({ color: divider.color, alpha: divider.alpha ?? 1 });
    }
  }
  if (border && border.width > 0) {
    const bodyHeight = Math.max(1, height - (style.shadow ? Math.max(0, style.shadow.offsetY) : 0));
    g.roundRect(x, y, width, bodyHeight, cornerRadius(style.radius, width, bodyHeight)).stroke({ color: border.color, alpha: border.alpha ?? 1, width: border.width, alignment: 1, join: 'round' });
  }
}

/** A content card: the surface, then the inset well above the bottom band. */
export function drawCard(g: Graphics, x: number, y: number, width: number, height: number, style: UiCardStyle): void {
  drawSurface(g, x, y, width, height, style);
  const inset = style.inset;
  if (!inset) return;
  const w = width - inset.side * 2;
  const h = height - inset.top - inset.bottom;
  if (w <= 0 || h <= 0) return;
  g.roundRect(x + inset.side, y + inset.top, w, h, cornerRadius(inset.radius, w, h)).fill(toFillInput(inset.fill));
}

/** One awning stripe: a rect ending in a half-disc scallop, `index` stripes from the left. */
function awningPath(g: Graphics, x: number, y: number, height: number, stripe: number, index: number): Graphics {
  const r = stripe / 2;
  const sx = x + index * stripe;
  const top = Math.max(0, height - r);
  return g.moveTo(sx, y).lineTo(sx + stripe, y).lineTo(sx + stripe, y + top).arc(sx + r, y + top, r, 0, Math.PI).lineTo(sx, y).closePath();
}

/**
 * The shop's striped awning inside the box (x, y, width, height): a soft shadow of the whole silhouette, then
 * `segments` stripes across the width (alternating fills, each mapped onto its own stripe so a gradient runs down
 * every one of them), each ending in a half-disc scallop as wide as the stripe, then the soft gloss across the top.
 * Every scallop is whole and inside the box; the stripe width follows the viewport width.
 */
export function drawAwning(g: Graphics, x: number, y: number, width: number, height: number, style: UiAwningStyle): void {
  const count = Math.max(1, Math.round(style.segments));
  const stripe = width / count;
  const shadow = style.shadow;
  const bodyHeight = Math.max(1, height - (shadow ? Math.max(0, shadow.offsetY) : 0));
  if (shadow && shadow.alpha > 0) {
    const layers = Math.max(1, Math.floor(shadow.layers ?? 1));
    for (let i = 1; i <= layers; i++) {
      const dy = (shadow.offsetY * i) / layers;
      for (let s = 0; s < count; s++) awningPath(g, x, y + dy, bodyHeight, stripe, s);
      g.fill({ color: shadow.color, alpha: shadow.alpha / layers });
    }
  }
  for (let s = 0; s < count; s++) {
    awningPath(g, x, y, bodyHeight, stripe, s).fill(toFillInput(s % 2 === 0 ? style.fillA : style.fillB));
  }
  const gloss = style.gloss;
  if (gloss && gloss.height > 0 && (gloss.alpha ?? 1) > 0) {
    // the gloss lies on the straight part of the cloth, above the scallops
    const h = Math.min(gloss.height, Math.max(1, bodyHeight - stripe / 2));
    g.rect(x, y, width, h).fill(bandFill(gloss));
  }
}

/** The close control's mark: an optional backing surface and the × (outline under the arms, then the arms), centred on (0, 0). */
export function drawCloseMark(g: Graphics, size: number, style: UiCloseStyle, pressed = false): void {
  const background = pressed && style.pressed && style.pressed.background !== undefined ? style.pressed.background : style.background;
  if (background) drawSurface(g, -size / 2, -size / 2, size, size, background);
  const arm = size * style.armRatio;
  const stroke = Math.max(1, size * style.strokeRatio);
  const foreground = pressed && style.pressed && style.pressed.foreground !== undefined ? style.pressed.foreground : style.foreground;
  const passes: Array<{ width: number; color: number; alpha: number }> = [];
  if (style.outline && style.outline.width > 0) passes.push({ width: stroke + style.outline.width * 2, color: style.outline.color, alpha: style.outline.alpha ?? 1 });
  passes.push({ width: stroke, color: foreground, alpha: 1 });
  for (const pass of passes) {
    g.moveTo(-arm, -arm).lineTo(arm, arm).moveTo(arm, -arm).lineTo(-arm, arm).stroke({ width: pass.width, color: pass.color, alpha: pass.alpha, cap: 'round', join: 'round' });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Scene objects
// ---------------------------------------------------------------------------------------------------------------------

/** A skinned surface centred on its origin (like a sprite with anchor 0.5). Redraws only when size or style change. */
export class UiSurface extends Container {
  readonly graphics = new Graphics();
  private style: UiSurfaceStyle | UiCardStyle;
  private shape: UiSurfaceShape;
  private w: number;
  private h: number;
  private redraws = 0;

  constructor(options: { style: UiSurfaceStyle | UiCardStyle; width: number; height: number; shape?: UiSurfaceShape }) {
    super();
    this.style = options.style;
    this.shape = options.shape ?? 'rounded';
    this.w = Math.max(1, options.width);
    this.h = Math.max(1, options.height);
    this.graphics.eventMode = 'none';
    this.addChild(this.graphics);
    this.redraw();
  }

  get surfaceWidth(): number {
    return this.w;
  }

  get surfaceHeight(): number {
    return this.h;
  }

  /** How many times the geometry was (re)built: 1 after construction, +1 per real change. */
  get redrawCount(): number {
    return this.redraws;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.redraw();
  }

  setStyle(style: UiSurfaceStyle | UiCardStyle, shape: UiSurfaceShape = this.shape): void {
    if (style === this.style && shape === this.shape) return;
    this.style = style;
    this.shape = shape;
    this.redraw();
  }

  private redraw(): void {
    this.redraws++;
    const g = this.graphics;
    g.clear();
    const x = -this.w / 2;
    const y = -this.h / 2;
    if ('inset' in this.style) drawCard(g, x, y, this.w, this.h, this.style);
    else drawSurface(g, x, y, this.w, this.h, this.style, this.shape);
    this.declareBounds(x, y);
  }

  private declareBounds(x: number, y: number): void {
    this.boundsArea = new Rectangle(x, y, this.w, this.h);
    this.graphics.boundsArea = this.boundsArea;
    // Pixi caches local bounds on this tick; a new boundsArea (and a redraw before the next render) must invalidate it
    this._didViewChangeTick++;
  }
}

export interface UiPanelOptions {
  style: UiPanelStyle;
  width: number;
  height: number;
  /** Header band height in the panel's units. Default: the style's `headerHeight`; 0 = no header. */
  headerHeight?: number;
}

/** The standard window surface centred on its origin: body, header band, border. Redraws only on a real change. */
export class UiPanel extends Container {
  readonly graphics = new Graphics();
  private style: UiPanelStyle;
  private w: number;
  private h: number;
  private headerH: number;
  private redraws = 0;

  constructor(options: UiPanelOptions) {
    super();
    this.style = options.style;
    this.w = Math.max(1, options.width);
    this.h = Math.max(1, options.height);
    this.headerH = options.headerHeight ?? options.style.headerHeight;
    this.graphics.eventMode = 'none';
    this.addChild(this.graphics);
    this.redraw();
  }

  get panelWidth(): number {
    return this.w;
  }

  get panelHeight(): number {
    return this.h;
  }

  get headerHeight(): number {
    return this.headerH;
  }

  get redrawCount(): number {
    return this.redraws;
  }

  resize(width: number, height: number, headerHeight: number = this.headerH): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.w && h === this.h && headerHeight === this.headerH) return;
    this.w = w;
    this.h = h;
    this.headerH = headerHeight;
    this.redraw();
  }

  setStyle(style: UiPanelStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.redraw();
  }

  private redraw(): void {
    this.redraws++;
    const g = this.graphics;
    g.clear();
    const x = -this.w / 2;
    const y = -this.h / 2;
    drawPanel(g, x, y, this.w, this.h, this.style, this.headerH);
    this.boundsArea = new Rectangle(x, y, this.w, this.h);
    g.boundsArea = this.boundsArea;
    this._didViewChangeTick++;
  }
}
