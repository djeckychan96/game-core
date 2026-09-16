import type { EaseFn, EaseName } from '../../index';

// The kit imports the foundation as types only, so the built-in ease curves are re-declared here
// with the same formulas as src/motion/easing.ts: an `EaseName` given to a Pixi FX means exactly
// what it means in a MotionRuntime tween.
function clamp01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

const builtIns: Record<EaseName, EaseFn> = {
  linear: (t) => clamp01(t),
  easeIn: (t) => {
    const p = clamp01(t);
    return p * p * p;
  },
  easeOut: (t) => 1 - Math.pow(1 - clamp01(t), 3),
  easeInOut: (t) => {
    const p = clamp01(t);
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  },
  backOut: (t) => {
    const p = clamp01(t);
    const c1 = 1.35;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  }
};

/** Resolves an ease name or function; unknown names fail fast instead of silently going linear. */
export function resolveFxEase(ease: EaseName | EaseFn | undefined): EaseFn {
  if (typeof ease === 'function') return ease;
  if (ease === undefined) return builtIns.linear;
  const fn = builtIns[ease];
  if (!fn) throw new RangeError(`ClickRippleEffect: unknown ease "${String(ease)}"`);
  return fn;
}
