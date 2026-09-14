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

export function quadraticBezierPoint(from: FxPoint, control: FxPoint, to: FxPoint, t: number): FxPoint {
  const p = clamp01(t);
  const inv = 1 - p;
  return {
    x: inv * inv * from.x + 2 * inv * p * control.x + p * p * to.x,
    y: inv * inv * from.y + 2 * inv * p * control.y + p * p * to.y
  };
}

export function quadraticBezierDerivative(from: FxPoint, control: FxPoint, to: FxPoint, t: number): FxPoint {
  const p = clamp01(t);
  return {
    x: 2 * (1 - p) * (control.x - from.x) + 2 * p * (to.x - control.x),
    y: 2 * (1 - p) * (control.y - from.y) + 2 * p * (to.y - control.y)
  };
}

export function quadraticBezierTangentAngle(from: FxPoint, control: FxPoint, to: FxPoint, t: number): number {
  const derivative = quadraticBezierDerivative(from, control, to, t);
  return Math.atan2(derivative.y, derivative.x);
}
