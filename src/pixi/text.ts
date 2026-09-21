import { Container, Text, type TextStyleOptions } from 'pixi.js';
import { toFillInput } from './skin';
import type { ReadyUiTheme, UiFill } from './theme';

export interface LabelOptions {
  /** Font size in the container's local units. */
  fontSize: number;
  /** A colour, or a theme fill (a gradient runs across the label's own box). */
  fill?: number | UiFill;
  /** false = no stroke; a number overrides the theme's stroke ratio in local units. */
  stroke?: boolean | number;
  align?: 'left' | 'center' | 'right';
  anchorX?: number;
  anchorY?: number;
  wordWrap?: number;
}

/** A themed outlined label: white Fira Sans Black with the donor's dark rounded stroke. */
export function createLabel(theme: ReadyUiTheme, text: string, options: LabelOptions): Text {
  const fill = options.fill ?? theme.text.fill;
  const style: TextStyleOptions = {
    fontFamily: theme.text.fontFamily,
    fontSize: options.fontSize,
    fill: typeof fill === 'number' ? fill : toFillInput(fill),
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
