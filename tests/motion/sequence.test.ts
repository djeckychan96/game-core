import { describe, expect, test, vi } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';

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

describe('MotionRuntime sequence', () => {
  test('steps run in declared order', () => {
    const motion = new MotionRuntime();
    const order: number[] = [];
    const { binding: b1 } = makeNumberBinding(0);
    const { binding: b3 } = makeNumberBinding(0);

    motion.sequence({
      steps: [
        { type: 'tween', bindings: [{ ...b1, to: 100 }], durationMs: 50, onComplete: () => order.push(0) },
        { type: 'delay', durationMs: 50, onComplete: () => order.push(1) },
        { type: 'tween', bindings: [{ ...b3, to: 100 }], durationMs: 50, onComplete: () => order.push(2) }
      ]
    });

    motion.update(50); // step 0 (tween) completes
    motion.update(50); // step 1 (delay) completes
    motion.update(50); // step 2 (tween) completes

    expect(order).toEqual([0, 1, 2]);
  });

  test('a delay step blocks the following tween step from starting', () => {
    const motion = new MotionRuntime();
    const set = vi.fn();

    motion.sequence({
      steps: [
        { type: 'delay', durationMs: 100 },
        { type: 'tween', bindings: [{ get: () => 0, set, to: 100 }], durationMs: 50 }
      ]
    });

    motion.update(50); // half the delay
    expect(set).not.toHaveBeenCalled();

    motion.update(49); // still not done with the delay
    expect(set).not.toHaveBeenCalled();

    motion.update(1); // delay now fully consumed; tween step starts next update()
    motion.update(1);
    expect(set).toHaveBeenCalled();
  });

  test('cancelling mid-step stops the current step and fires the sequence onCancel once', () => {
    const motion = new MotionRuntime();
    let stepCancellations = 0;
    let sequenceCompletions = 0;
    let sequenceCancellations = 0;

    const handle = motion.sequence({
      steps: [
        { type: 'tween', bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 },
        { type: 'delay', durationMs: 100, onCancel: () => { stepCancellations += 1; } },
        { type: 'tween', bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 }
      ],
      onComplete: () => { sequenceCompletions += 1; },
      onCancel: () => { sequenceCancellations += 1; }
    });

    motion.update(100); // first tween step completes, moves into the delay step
    handle.cancel();

    expect(stepCancellations).toBe(1);
    expect(sequenceCancellations).toBe(1);
    expect(sequenceCompletions).toBe(0);
  });

  test('no later step ever starts after cancel', () => {
    const motion = new MotionRuntime();
    const thirdStepSet = vi.fn();

    const handle = motion.sequence({
      steps: [
        { type: 'tween', bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 },
        { type: 'delay', durationMs: 100 },
        { type: 'tween', bindings: [{ get: () => 0, set: thirdStepSet, to: 100 }], durationMs: 100 }
      ]
    });

    motion.update(100); // into the delay step
    handle.cancel();

    motion.update(1000); // sequence is gone; nothing left to advance
    expect(thirdStepSet).not.toHaveBeenCalled();
  });

  test('sequence onComplete fires exactly once, only after every step finishes', () => {
    const motion = new MotionRuntime();
    let completions = 0;

    motion.sequence({
      steps: [
        { type: 'delay', durationMs: 50 },
        { type: 'delay', durationMs: 50 }
      ],
      onComplete: () => { completions += 1; }
    });

    motion.update(50);
    expect(completions).toBe(0);
    motion.update(50);
    expect(completions).toBe(1);

    motion.update(50); // nothing left
    expect(completions).toBe(1);
  });

  test('sequence onCancel fires exactly once; double cancel returns false', () => {
    const motion = new MotionRuntime();
    let cancellations = 0;
    const handle = motion.sequence({
      steps: [{ type: 'delay', durationMs: 100 }],
      onCancel: () => { cancellations += 1; }
    });

    expect(handle.cancel()).toBe(true);
    expect(handle.cancel()).toBe(false);
    expect(cancellations).toBe(1);
  });

  // Stats isolation ("a running step never registers as a top-level activeTweens/activeDelays")
  // is asserted in tests/motion/stats.test.ts (Task 8), where getStats() actually exists.
  // Writing `motion.getStats()` here would fail `tsc --noEmit`, not just the test, since the
  // method doesn't exist on the class yet.

  test('pause()/resume() on a sequence freezes/continues whichever step is current', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);

    const handle = motion.sequence({
      steps: [{ type: 'tween', bindings: [{ ...binding, to: 100 }], durationMs: 100 }]
    });

    motion.update(50);
    expect(read()).toBe(50);

    handle.pause();
    motion.update(1000);
    expect(read()).toBe(50);

    handle.resume();
    motion.update(50);
    expect(read()).toBe(100);
  });
});
