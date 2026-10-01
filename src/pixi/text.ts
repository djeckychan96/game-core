import { CanvasTextMetrics, Container, DOMAdapter, Text, fontStringFromTextStyle, type TextStyleOptions } from 'pixi.js';
import type { ReadyUiTheme } from './theme';

export interface LabelOptions {
  /** Font size in the container's local units. */
  fontSize: number;
  /** Font family; default the theme's (a style with its own font passes it). */
  fontFamily?: string;
  fill?: number;
  /** false = no stroke; a number overrides the theme's stroke ratio in local units. */
  stroke?: boolean | number;
  align?: 'left' | 'center' | 'right';
  anchorX?: number;
  anchorY?: number;
  wordWrap?: number;
}

/** A themed outlined label: white Fira Sans Black with the donor's dark rounded stroke. */
export function createLabel(theme: ReadyUiTheme, text: string, options: LabelOptions): Text {
  const style: TextStyleOptions = {
    fontFamily: options.fontFamily ?? theme.text.fontFamily,
    fontSize: options.fontSize,
    fill: options.fill ?? theme.text.fill,
    align: options.align ?? 'center'
  };
  if (options.stroke !== false) {
    const width = typeof options.stroke === 'number' ? options.stroke : Math.max(1, Math.round(options.fontSize * theme.text.strokeRatio));
    style.stroke = { color: theme.text.strokeColor, width, join: 'round' };
  }
  if (options.wordWrap !== undefined) {
    style.wordWrap = true;
    style.wordWrapWidth = options.wordWrap;
  }
  const label = new Text({ text, style });
  label.anchor.set(options.anchorX ?? 0.5, options.anchorY ?? 0.5);
  return label;
}

/** A one-line Figma text box in the parent's units, with the text's horizontal alignment (vertical is CENTER). */
export interface FigmaTextSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  align: 'left' | 'center';
}

/** Figma's kit text: 4 units of OUTSIDE round stroke and a hard drop shadow 4 units down, both in the stroke color. */
export const FIGMA_TEXT_STROKE_OUTSIDE = 4;
export const FIGMA_TEXT_SHADOW_Y = 4;

/** A style's text look: OUTSIDE stroke and shadow offset (0 = none), and optionally its own font, fill and stroke colour. */
export interface FigmaTextLook {
  strokeOutside: number;
  shadowY: number;
  fontFamily?: string;
  fill?: number;
  /** Stroke and shadow colour; default the theme's. */
  strokeColor?: number;
}

/**
 * The Figma text look (theme font / fill / stroke color unless the look brings its own font / fill; the OUTSIDE
 * stroke and shadow offset of the style, Figma's 4 / 4 by default). Pixi strokes centred on the outline and fills over
 * it, so a stroke of 2 × `strokeOutside` leaves exactly the Figma OUTSIDE width; the shadow pass draws stroke + fill
 * like Figma's drop shadow of a stroked text. A look without stroke / shadow (0) gets neither.
 */
export function createFigmaLabel(
  theme: ReadyUiTheme,
  text: string,
  fontSize: number,
  look: FigmaTextLook = { strokeOutside: FIGMA_TEXT_STROKE_OUTSIDE, shadowY: FIGMA_TEXT_SHADOW_Y }
): Text {
  const style: TextStyleOptions = { fontFamily: look.fontFamily ?? theme.text.fontFamily, fontSize, fill: look.fill ?? theme.text.fill };
  const color = look.strokeColor ?? theme.text.strokeColor;
  if (look.strokeOutside > 0) style.stroke = { color, width: look.strokeOutside * 2, join: 'round' };
  if (look.shadowY > 0) style.dropShadow = { color, alpha: 1, blur: 0, angle: Math.PI / 2, distance: look.shadowY };
  return new Text({ text, style });
}

/**
 * The font's own line box (Figma AUTO line height = ascent + descent), from the canvas font metrics. Measured at
 * 1000 px and scaled: engines round font metrics to whole pixels at the size they are asked for.
 */
function fontLineBox(label: Text): { ascent: number; descent: number } {
  const size = label.style.fontSize;
  const probe = label.style.clone();
  probe.fontSize = 1000;
  const font = fontStringFromTextStyle(probe);
  const context = DOMAdapter.get().createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D | null;
  if (context) {
    context.font = font;
    const m = context.measureText('M');
    if (m.fontBoundingBoxAscent > 0) return { ascent: (m.fontBoundingBoxAscent / 1000) * size, descent: (m.fontBoundingBoxDescent / 1000) * size };
  }
  const glyphs = CanvasTextMetrics.measureFont(font); // engines without fontBoundingBox*: the glyph extents
  return { ascent: (glyphs.ascent / 1000) * size, descent: (glyphs.descent / 1000) * size };
}

/**
 * Places a one-line label the way Figma lays out a fixed text box with AUTO line height and vertical CENTER: the
 * font's line box is centred in the slot (baseline = its ascent below the line top) and the glyph run is aligned
 * by its advance — not by Pixi's measured bounds, which also hold the stroke and the drop-shadow distance. A text
 * wider than the slot shrinks uniformly around that point to the slot width. Call again after changing the text.
 */
export function placeFigmaLabel(label: Text, slot: FigmaTextSlot): void {
  const metrics = CanvasTextMetrics.measureText(label.text, label.style);
  const stroke = label.style.stroke;
  const strokeWidth = typeof stroke === 'object' && stroke !== null && 'width' in stroke ? (stroke.width ?? 0) : 0;
  const advance = metrics.lineWidths[0] ?? metrics.maxLineWidth;
  const line = fontLineBox(label);
  const baseline = slot.y + (slot.height - (line.ascent + line.descent)) / 2 + line.ascent;
  const k = advance > slot.width && advance > 0 ? slot.width / advance : 1;
  // Pixi draws the run from x = stroke / 2 with the baseline at stroke / 2 + the font's glyph ascent. Anchor 0: a
  // non-zero anchor is applied to the ceil-rounded texture size and would move the run by up to a unit.
  const originX = strokeWidth / 2 + (slot.align === 'center' ? advance / 2 : 0);
  const originY = strokeWidth / 2 + metrics.fontProperties.ascent;
  label.anchor.set(0, 0);
  label.scale.set(k);
  label.position.set((slot.align === 'center' ? slot.x + slot.width / 2 : slot.x) - k * originX, baseline - k * originY);
}

/** The one-line run's advance width in the label's units (what `placeFigmaLabel` aligns by), stroke and shadow excluded. */
export function figmaLabelAdvance(label: Text): number {
  const metrics = CanvasTextMetrics.measureText(label.text, label.style);
  return metrics.lineWidths[0] ?? metrics.maxLineWidth;
}

/** Shrinks the label's scale so its width fits `maxWidth` (never grows). */
export function fitLabelWidth(label: Text, maxWidth: number): void {
  label.scale.set(1);
  const width = label.width;
  if (width > maxWidth && width > 0) label.scale.set(maxWidth / width);
}

/**
 * Canvas text is rasterised once at `fontSize × resolution` and then drawn under the view's
 * scale. Rendering it at exactly the on-screen density gives soft edges on Retina; the donor
 * (Trail Arrow) rasterises at the renderer resolution and lets the GPU minify by ~2-3×, which
 * reads crisper. We do the same deliberately: 2× the final density (supersampling, a 2×2 box
 * filter on minification), clamped so a single label never allocates an absurd canvas.
 * Views call this after resize with `containerScale × devicePixelRatio`.
 */
export const TEXT_SUPERSAMPLE = 2;

export function applyTextResolution(root: Container, resolution: number): void {
  const res = Math.min(4, Math.max(1, resolution * TEXT_SUPERSAMPLE));
  const visit = (node: Container): void => {
    if (node instanceof Text) {
      if (Math.abs((node.resolution ?? 0) - res) > res * 0.12) node.resolution = res;
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
}

/** Formats a counter the way the donor's `pretty()` did: thousands separated by a thin space. */
export function formatAmount(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ' ';
  }
  return sign + out;
}

/** mm:ss or hh:mm:ss, as the donor HUD showed lives timers. */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}
