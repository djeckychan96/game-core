import type { FxEasingName, FxScalarKeyframe } from './types';

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function easeLinear(t: number): number {
  return clamp01(t);
}

export function easeInOutCubic01(t: number): number {
  const p = clamp01(t);
  return p < 0.5
    ? 4 * p * p * p
    : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

export function easeOutCubic01(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

export function easeOutBackLite(t: number): number {
  const p = clamp01(t);
  const c1 = 1.35;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

export function resolveEasing(name: FxEasingName | undefined): (t: number) => number {
  if (name === 'inOutCubic') return easeInOutCubic01;
  if (name === 'outCubic') return easeOutCubic01;
  if (name === 'outBackLite') return easeOutBackLite;
  return easeLinear;
}

export function interpolateKeyframes(
  t: number,
  keyframes: readonly FxScalarKeyframe[],
  fallback: number
): number {
  if (keyframes.length === 0) return fallback;

  const p = clamp01(t);
  let previous = keyframes[0];
  if (!previous) return fallback;
  if (p <= previous.t) return previous.value;

  for (let i = 1; i < keyframes.length; i++) {
    const next = keyframes[i];
    if (!next) continue;
    if (p <= next.t) {
      const span = Math.max(0.000001, next.t - previous.t);
      const localT = clamp01((p - previous.t) / span);
      return lerp(previous.value, next.value, resolveEasing(next.easing)(localT));
    }
    previous = next;
  }

  return previous.value;
}
