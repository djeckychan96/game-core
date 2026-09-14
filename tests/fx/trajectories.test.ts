import { describe, expect, test } from 'vitest';
import {
  createQuadraticControlPoint,
  quadraticBezierDerivativeInto,
  quadraticBezierPointInto,
  quadraticBezierTangentAngleInto
} from '../../src/fx/trajectories';

describe('trajectories (allocation-free hot path)', () => {
  test('quadraticBezierPointInto writes into and returns the exact same `out` reference', () => {
    const out = { x: -1, y: -1 };
    const from = { x: 0, y: 0 };
    const control = createQuadraticControlPoint(from, { x: 100, y: 0 }, 0, -50);
    const to = { x: 100, y: 0 };

    const result = quadraticBezierPointInto(out, from, control, to, 0.5);

    expect(result).toBe(out); // no new object allocated; caller's scratch object is mutated
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(-25);
  });

  test('quadraticBezierPointInto matches the endpoints at t=0 and t=1', () => {
    const out = { x: 0, y: 0 };
    const from = { x: 5, y: 10 };
    const control = { x: 20, y: -30 };
    const to = { x: 40, y: 15 };

    quadraticBezierPointInto(out, from, control, to, 0);
    expect(out).toEqual({ x: 5, y: 10 });

    quadraticBezierPointInto(out, from, control, to, 1);
    expect(out).toEqual({ x: 40, y: 15 });
  });

  test('quadraticBezierDerivativeInto writes into and returns the exact same `out` reference', () => {
    const out = { x: 0, y: 0 };
    const from = { x: 0, y: 0 };
    const control = { x: 50, y: 0 };
    const to = { x: 100, y: 0 };

    const result = quadraticBezierDerivativeInto(out, from, control, to, 0.5);

    expect(result).toBe(out);
    expect(result.x).toBeGreaterThan(0); // moving rightwards along a flat horizontal curve
    expect(result.y).toBeCloseTo(0);
  });

  test('quadraticBezierTangentAngleInto reuses the provided scratch point and returns a plain number', () => {
    const scratch = { x: 123, y: 456 }; // pre-existing garbage values, must be overwritten
    const from = { x: 0, y: 0 };
    const control = { x: 50, y: 0 };
    const to = { x: 100, y: 0 };

    const angle = quadraticBezierTangentAngleInto(from, control, to, 0.5, scratch);

    expect(typeof angle).toBe('number');
    expect(angle).toBeCloseTo(0); // tangent of a flat horizontal curve points along +x (angle 0)
    expect(scratch.x).not.toBe(123); // scratch was actually overwritten, not ignored
  });
});
