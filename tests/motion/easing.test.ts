import { describe, expect, test } from 'vitest';
import { backOut, easeIn, easeInOut, easeOut, linear, resolveEase } from '../../src/motion/easing';

describe('motion easing', () => {
  test('linear clamps to [0,1] and is identity within range', () => {
    expect(linear(0)).toBe(0);
    expect(linear(1)).toBe(1);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(-1)).toBe(0);
    expect(linear(2)).toBe(1);
  });

  test('easeIn is cubic ease-in', () => {
    expect(easeIn(0)).toBe(0);
    expect(easeIn(1)).toBe(1);
    expect(easeIn(0.5)).toBe(0.125);
  });

  test('easeOut is cubic ease-out', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBe(0.875);
  });

  test('easeInOut is symmetric cubic in-out', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
  });

  test('backOut hits exact endpoints despite overshoot mid-curve', () => {
    expect(backOut(0)).toBeCloseTo(0);
    expect(backOut(1)).toBeCloseTo(1);
  });

  test('resolveEase(undefined) defaults to linear by reference', () => {
    expect(resolveEase(undefined)).toBe(linear);
  });

  test('resolveEase returns a supplied function as-is, not wrapped', () => {
    const custom = (t: number) => t * 2;
    expect(resolveEase(custom)).toBe(custom);
  });

  test('resolveEase resolves each built-in name to the matching function', () => {
    expect(resolveEase('easeIn')(0.5)).toBe(easeIn(0.5));
    expect(resolveEase('easeOut')(0.5)).toBe(easeOut(0.5));
    expect(resolveEase('easeInOut')(0.5)).toBe(easeInOut(0.5));
    expect(resolveEase('backOut')(0.5)).toBe(backOut(0.5));
    expect(resolveEase('linear')(0.5)).toBe(linear(0.5));
  });
});
