import { describe, expect, test } from 'vitest';
import { computeLayout } from '../../src/ui/layout';
import { MotionRuntime } from '../../src/motion/MotionRuntime';
import type { UiMotionDriver } from '../../src/ui/types';

describe('computeLayout — contain fit', () => {
  test('portrait viewport with a 9:16 design fits by width and letterboxes vertically', () => {
    const result = computeLayout({ viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920 });
    const scale = 390 / 1080;

    expect(result.orientation).toBe('portrait');
    expect(result.scale).toBe(scale);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe((844 - 1920 * scale) / 2);
    expect(result.visibleRect).toEqual({ x: -0 / scale, y: -result.offsetY / scale, width: 390 / scale, height: 844 / scale });
    expect(result.scale * 1080).toBe(Math.min(390, (844 * 9) / 16));
  });

  test('landscape viewport pillarboxes horizontally', () => {
    const result = computeLayout({ viewportWidth: 1280, viewportHeight: 800, designWidth: 1080, designHeight: 1920 });

    expect(result.orientation).toBe('landscape');
    expect(result.offsetX).toBeGreaterThan(0);
    expect(result.offsetY).toBe(0);
    expect(result.visibleRect.x).toBe(-result.offsetX / result.scale);
  });

  test('a square viewport counts as portrait', () => {
    expect(computeLayout({ viewportWidth: 500, viewportHeight: 500, designWidth: 100, designHeight: 100 }).orientation).toBe('portrait');
  });

  test('safe insets shrink safeRect only, never the design box or visibleRect', () => {
    const plain = computeLayout({ viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920 });
    const withInsets = computeLayout({
      viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920,
      safeInsets: { top: 47, bottom: 34 }
    });

    expect(withInsets.scale).toBe(plain.scale);
    expect(withInsets.visibleRect).toEqual(plain.visibleRect);
    expect(withInsets.safeRect.y).toBe((47 - plain.offsetY) / plain.scale);
    expect(withInsets.safeRect.height).toBe((844 - 47 - 34) / plain.scale);
    expect(withInsets.safeRect.x).toBe((0 - plain.offsetX) / plain.scale);
    expect(withInsets.safeRect.width).toBe(390 / plain.scale);
  });

  test('opposite insets that exceed the viewport give a zero-size safeRect at the inset', () => {
    const result = computeLayout({
      viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920,
      safeInsets: { left: 300, right: 300 }
    });

    expect(result.safeRect.width).toBe(0);
    expect(result.safeRect.x).toBe((300 - result.offsetX) / result.scale);
  });

  test('reproduces trail_arrow scaleFactor exactly for its real design sizes', () => {
    for (const [vw, vh, dw, dh] of [[320, 568, 1080, 2344], [1440, 900, 4088, 2344], [390, 844, 1080, 2344]] as const) {
      const result = computeLayout({ viewportWidth: vw, viewportHeight: vh, designWidth: dw, designHeight: dh });
      expect(result.scale).toBe(Math.min(vw / dw, vh / dh));
    }
  });
});

describe('computeLayout — invalid input policy', () => {
  test('an invalid design size fails fast with RangeError', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(() => computeLayout({ viewportWidth: 390, viewportHeight: 844, designWidth: bad, designHeight: 1920 })).toThrow(RangeError);
      expect(() => computeLayout({ viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: bad })).toThrow(RangeError);
    }
  });

  test('a transiently invalid viewport is coerced and never throws', () => {
    for (const bad of [0, -5, Number.NaN]) {
      const result = computeLayout({ viewportWidth: bad, viewportHeight: bad, designWidth: 1080, designHeight: 1920 });
      for (const value of [result.scale, result.offsetX, result.offsetY,
        result.visibleRect.x, result.visibleRect.y, result.visibleRect.width, result.visibleRect.height,
        result.safeRect.x, result.safeRect.y, result.safeRect.width, result.safeRect.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  test('invalid insets are treated as zero', () => {
    const plain = computeLayout({ viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920 });
    const noisy = computeLayout({
      viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920,
      safeInsets: { top: Number.NaN, left: -10 }
    });

    expect(noisy.safeRect).toEqual(plain.safeRect);
  });

  test('is deterministic', () => {
    const input = { viewportWidth: 390, viewportHeight: 844, designWidth: 1080, designHeight: 1920, safeInsets: { top: 47 } };
    expect(computeLayout(input)).toEqual(computeLayout({ ...input }));
  });
});

describe('UiMotionDriver contract', () => {
  test('MotionRuntime satisfies UiMotionDriver structurally, with no adapter', () => {
    const driver: UiMotionDriver = new MotionRuntime();
    expect(driver).toBeDefined();
  });
});
