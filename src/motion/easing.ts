import type { EaseFn, EaseName } from './types';

// Independently re-declared from src/fx/easing.ts's own clamp01 (same shape, not imported —
// src/motion/** must never import from src/fx/**, and vice versa).
export function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

export function linear(t: number): number {
  return clamp01(t);
}

export function easeIn(t: number): number {
  const p = clamp01(t);
  return p * p * p;
}

export function easeOut(t: number): number {
  const p = clamp01(t);
  return 1 - Math.pow(1 - p, 3);
}

export function easeInOut(t: number): number {
  const p = clamp01(t);
  return p < 0.5
    ? 4 * p * p * p
    : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

// Same 1.35 overshoot constant already used by src/fx/easing.ts's easeOutBackLite — independently
// re-derived here, not imported, to keep one game-core-wide back-ease "feel" without a dependency
// between the two runtimes.
export function backOut(t: number): number {
  const p = clamp01(t);
  const c1 = 1.35;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

const builtIns: Record<EaseName, EaseFn> = {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  backOut
};

export function resolveEase(ease: EaseName | EaseFn | undefined): EaseFn {
  if (typeof ease === 'function') return ease;
  if (ease === undefined) return linear;
  return builtIns[ease];
}
