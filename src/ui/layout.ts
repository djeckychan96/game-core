import type { LayoutInput, LayoutResult } from './types';

function assertDesignSize(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`computeLayout: ${name} must be a finite number > 0, got ${String(value)}`);
  }
  return value;
}

// Measured runtime values: a hidden tab or the first event of a resize storm can report 0 × 0.
function coerceViewport(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function coerceInset(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Pure contain-fit layout arithmetic (spec §10). Declared configuration (design size) fails fast with
 * RangeError; measured values (viewport, insets) are coerced so a resize handler never throws.
 * Every rect is in design units with the design box's top-left corner at (0, 0).
 */
export function computeLayout(input: LayoutInput): LayoutResult {
  const dw = assertDesignSize('designWidth', input.designWidth);
  const dh = assertDesignSize('designHeight', input.designHeight);
  const vw = coerceViewport(input.viewportWidth);
  const vh = coerceViewport(input.viewportHeight);
  const insets = input.safeInsets;
  const t = coerceInset(insets?.top);
  const r = coerceInset(insets?.right);
  const b = coerceInset(insets?.bottom);
  const l = coerceInset(insets?.left);

  const scale = Math.min(vw / dw, vh / dh);
  const offsetX = (vw - dw * scale) / 2;
  const offsetY = (vh - dh * scale) / 2;

  return {
    orientation: vw > vh ? 'landscape' : 'portrait',
    scale,
    offsetX,
    offsetY,
    visibleRect: {
      x: -offsetX / scale,
      y: -offsetY / scale,
      width: vw / scale,
      height: vh / scale
    },
    safeRect: {
      x: (l - offsetX) / scale,
      y: (t - offsetY) / scale,
      width: Math.max(0, vw - l - r) / scale,
      height: Math.max(0, vh - t - b) / scale
    }
  };
}
