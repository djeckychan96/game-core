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
import type { UiCardStyle, UiCloseStyle, UiFill, UiPanelStyle, UiSurfaceStyle } from './theme';

/** `rounded`: a rounded rect (`radius` from the style). `capsule`: half-height corners. `ribbon`: notched ends (a title ribbon). */
export type UiSurfaceShape = 'rounded' | 'capsule' | 'ribbon';

const gradients = new Map<string, FillGradient>();

/**
 * The Pixi fill for a theme fill. Gradients are `FillGradient`s in the shape's own (local) space, so one gradient
 * serves every surface of that colour pair; they are cached for the lifetime of the module (a handful per theme).
 */
export function toFillInput(fill: UiFill): FillInput {
  if (fill.type === 'solid') return { color: fill.color, alpha: fill.alpha ?? 1 };
  const key = `${fill.direction}:${fill.from}:${fill.to}`;
  let gradient = gradients.get(key);
  if (!gradient) {
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: fill.direction === 'vertical' ? { x: 0, y: 1 } : { x: 1, y: 0 },
      colorStops: [
        { offset: 0, color: fill.from },
        { offset: 1, color: fill.to }
      ],
      textureSpace: 'local'
    });
    gradients.set(key, gradient);
  }
  return { fill: gradient, alpha: fill.alpha ?? 1 };
}

function cornerRadius(radius: number, width: number, height: number): number {
  const max = Math.max(0, Math.min(width, height) / 2);
  return radius < 0 ? max : Math.min(Math.max(0, radius), max);
}

function shapePath(g: Graphics, shape: UiSurfaceShape, x: number, y: number, width: number, height: number, radius: number): Graphics {
  if (shape === 'ribbon') {
    const notch = Math.min(height * 0.35, width * 0.08);
    return g.moveTo(x, y).lineTo(x + width, y).lineTo(x + width - notch, y + height / 2).lineTo(x + width, y + height).lineTo(x, y + height).lineTo(x + notch, y + height / 2).closePath();
  }
  return g.roundRect(x, y, width, height, cornerRadius(shape === 'capsule' ? -1 : radius, width, height));
}

/** A rect with rounded top corners and a flat bottom edge (the header band of a panel). */
function topRoundedPath(g: Graphics, x: number, y: number, width: number, height: number, radius: number): Graphics {
  const r = cornerRadius(radius, width, height * 2);
  return g.moveTo(x, y + height).lineTo(x, y + r).arcTo(x, y, x + r, y, r).lineTo(x + width - r, y).arcTo(x + width, y, x + width, y + r, r).lineTo(x + width, y + height).closePath();
}

/**
 * Draws one surface into `g` inside the box (x, y, width, height): shadow → depth lip → body → inside border.
 * The body is `height − shadow.offsetY` tall so the shadow stays inside the box.
 */
export function drawSurface(g: Graphics, x: number, y: number, width: number, height: number, style: UiSurfaceStyle, shape: UiSurfaceShape = 'rounded'): void {
  const shadow = style.shadow;
  const bodyHeight = Math.max(1, height - (shadow ? Math.max(0, shadow.offsetY) : 0));
  if (shadow && shadow.alpha > 0) {
    shapePath(g, shape, x, y + shadow.offsetY, width, bodyHeight, style.radius).fill({ color: shadow.color, alpha: shadow.alpha });
  }
  const depth = style.depth;
  if (depth && depth.height > 0 && depth.height < bodyHeight) {
    shapePath(g, shape, x, y, width, bodyHeight, style.radius).fill({ color: depth.color });
    const top = depth.edge === 'top';
    shapePath(g, shape, x, top ? y + depth.height : y, width, bodyHeight - depth.height, style.radius).fill(toFillInput(style.fill));
  } else {
    shapePath(g, shape, x, y, width, bodyHeight, style.radius).fill(toFillInput(style.fill));
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
