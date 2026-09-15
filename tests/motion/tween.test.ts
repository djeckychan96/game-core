import { describe, expect, test, vi } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';
import { backOut, easeIn, easeInOut, easeOut, linear } from '../../src/motion/easing';
import type { EaseName } from '../../src/motion/types';

function makeNumberBinding(initial: number) {
  let value = initial;
  return {
    binding: {
      get: () => value,
      set: (v: number) => {
        value = v;
      }
    },
    read: () => value
  };
}

describe('MotionRuntime tween lifecycle', () => {
  test('interpolation correctness', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    motion.update(50);

    expect(read()).toBe(50);
  });

  test('exact final value on normal completion', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    motion.update(100);

    expect(read()).toBe(100);
  });

  test('explicit from is used as given, get() is ignored for it', () => {
    const motion = new MotionRuntime();
    const set = vi.fn();
    motion.tween({
      bindings: [{ get: () => 999, set, to: 100, from: 20 }],
      durationMs: 100
    });

    motion.update(50);

    expect(set).toHaveBeenLastCalledWith(60); // (20 + 100) / 2
  });

  test('implicit from is resolved via get() at the actual start, after delayMs elapses', () => {
    const motion = new MotionRuntime();
    let outer = 0;
    motion.tween({
      bindings: [{ get: () => outer, set: (v) => { outer = v; }, to: 100 }],
      delayMs: 50,
      durationMs: 100
    });

    outer = 40; // change the value the tween will read, before the delay elapses

    motion.update(50); // consumes exactly the delay (elapsedMs=50): resolution must read `outer` NOW (40), not at creation time (0)
    motion.update(100); // elapsedMs=150 -> localMs=100 -> full duration reached

    expect(outer).toBe(100);
  });

  test('implicit from resolved value is actually used mid-interpolation', () => {
    const motion = new MotionRuntime();
    let outer = 0;
    motion.tween({
      bindings: [{ get: () => outer, set: (v) => { outer = v; }, to: 100 }],
      delayMs: 50,
      durationMs: 100
    });

    outer = 40;
    motion.update(50); // consumes the delay (elapsedMs=50, localMs=0), resolves from=40
    motion.update(50); // elapsedMs=100 -> localMs=50 -> 50% of the 100ms duration

    expect(outer).toBe(70); // (40 + 100) / 2
  });

  test('custom EaseFn is honored', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      ease: (t: number) => t
    });

    motion.update(50);

    expect(read()).toBe(50);
  });

  test.each<EaseName>(['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut'])(
    'built-in ease %s matches the easing module at progress 0.5',
    (name) => {
      const motion = new MotionRuntime();
      const { binding, read } = makeNumberBinding(0);
      motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100, ease: name });

      motion.update(50);

      const fns = { linear, easeIn, easeOut, easeInOut, backOut };
      const expected = fns[name](0.5) * 100;
      expect(read()).toBeCloseTo(expected);
    }
  );

  test('onUpdate receives raw, un-eased progress', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let seenProgress: number | null = null;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      ease: 'easeIn',
      onUpdate: (progress) => {
        seenProgress = progress;
      }
    });

    motion.update(50);

    expect(seenProgress).toBe(0.5);
    expect(read()).toBeCloseTo(12.5); // easeIn(0.5) = 0.125 of the 0..100 span
  });

  test('onUpdate fires after this frame\'s binding value has already been applied', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let seenDuringCallback: number | null = null;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onUpdate: () => {
        seenDuringCallback = read();
      }
    });

    motion.update(50);

    expect(seenDuringCallback).toBe(50);
  });

  test('completes exactly once', () => {
    const motion = new MotionRuntime();
    const { binding } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onComplete: () => {
        completions += 1;
      }
    });

    motion.update(100);
    motion.update(50); // nothing left to complete

    expect(completions).toBe(1);
  });

  test('cancels exactly once and leaves the value where it was (no jump to `to`)', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let cancellations = 0;
    const handle = motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onCancel: () => {
        cancellations += 1;
      }
    });

    motion.update(50);
    const valueAtCancel = read();
    handle.cancel();

    expect(cancellations).toBe(1);
    expect(read()).toBe(valueAtCancel);
    expect(read()).not.toBe(100);
  });

  test('double cancel: second call returns false and does not fire onCancel again', () => {
    const motion = new MotionRuntime();
    const { binding } = makeNumberBinding(0);
    let cancellations = 0;
    const handle = motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onCancel: () => {
        cancellations += 1;
      }
    });

    expect(handle.cancel()).toBe(true);
    expect(handle.cancel()).toBe(false);
    expect(cancellations).toBe(1);
  });

  test('pause freezes the value; resume continues from the paused elapsed time', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    const handle = motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    motion.update(50);
    expect(read()).toBe(50);

    handle.pause();
    motion.update(1000);
    expect(read()).toBe(50); // unchanged while paused

    handle.resume();
    motion.update(50); // 50 (before pause) + 50 (after resume) = 100 total elapsed

    expect(read()).toBe(100);
  });

  test('pause()/resume() return values are idempotent', () => {
    const motion = new MotionRuntime();
    const { binding } = makeNumberBinding(0);
    const handle = motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    expect(handle.pause()).toBe(true);
    expect(handle.pause()).toBe(false);
    expect(handle.resume()).toBe(true);
    expect(handle.resume()).toBe(false);
  });

  test('handle.active / handle.paused reflect state through create -> pause -> resume -> cancel', () => {
    const motion = new MotionRuntime();
    const { binding } = makeNumberBinding(0);
    const handle = motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    expect(handle.active).toBe(true);
    expect(handle.paused).toBe(false);

    handle.pause();
    expect(handle.active).toBe(true);
    expect(handle.paused).toBe(true);

    handle.resume();
    expect(handle.active).toBe(true);
    expect(handle.paused).toBe(false);

    handle.cancel();
    expect(handle.active).toBe(false);
    expect(handle.paused).toBe(false);
  });
});
