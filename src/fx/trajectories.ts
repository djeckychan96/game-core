import { clamp01 } from './easing';
import type { FxPoint } from './types';

export function createQuadraticControlPoint(
  from: FxPoint,
  to: FxPoint,
  offsetX = 0,
  offsetY = 0
): FxPoint {
  return {
    x: from.x + (to.x - from.x) * 0.5 + offsetX,
    y: from.y + (to.y - from.y) * 0.5 + offsetY
  };
}

/**
 * Allocation-free variant of the quadratic Bezier point: writes into `out` and returns it.
 * `out` is caller-owned scratch storage, reused across frames/effects.
 */
export function quadraticBezierPointInto(
  out: FxPoint,
  from: FxPoint,
  control: FxPoint,
  to: FxPoint,
  t: number
): FxPoint {
  const p = clamp01(t);
  const inv = 1 - p;
  out.x = inv * inv * from.x + 2 * inv * p * control.x + p * p * to.x;
  out.y = inv * inv * from.y + 2 * inv * p * control.y + p * p * to.y;
  return out;
}

/** Allocation-free variant of the quadratic Bezier derivative: writes into `out` and returns it. */
export function quadraticBezierDerivativeInto(
  out: FxPoint,
  from: FxPoint,
  control: FxPoint,
  to: FxPoint,
  t: number
): FxPoint {
  const p = clamp01(t);
  out.x = 2 * (1 - p) * (control.x - from.x) + 2 * p * (to.x - control.x);
  out.y = 2 * (1 - p) * (control.y - from.y) + 2 * p * (to.y - control.y);
  return out;
}

/** Allocation-free variant of the tangent angle: uses `scratch` for the intermediate derivative point. */
export function quadraticBezierTangentAngleInto(
  from: FxPoint,
  control: FxPoint,
  to: FxPoint,
  t: number,
  scratch: FxPoint
): number {
  quadraticBezierDerivativeInto(scratch, from, control, to, t);
  return Math.atan2(scratch.y, scratch.x);
}
