import { describe, expect, test } from 'vitest';
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

describe('MotionRuntime scopes', () => {
  test('cancelScope cancels only operations in that scope, returns the count cancelled', () => {
    const motion = new MotionRuntime();
    let aCancellations = 0;
    let bCancellations = 0;
    const { binding: bindingB, read: readB } = makeNumberBinding(0);

    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, scope: 'a', onCancel: () => { aCancellations += 1; } });
    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, scope: 'a', onCancel: () => { aCancellations += 1; } });
    motion.tween({ bindings: [{ ...bindingB, to: 100 }], durationMs: 100, scope: 'b', onCancel: () => { bCancellations += 1; } });

    const count = motion.cancelScope('a');

    expect(count).toBe(2);
    expect(aCancellations).toBe(2);
    expect(bCancellations).toBe(0);

    motion.update(50);
    expect(readB()).toBe(50); // the 'b' tween is unaffected and keeps advancing
  });

  test('cancelAll cancels every operation regardless of scope', () => {
    const motion = new MotionRuntime();
    let cancellations = 0;
    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, scope: 'a', onCancel: () => { cancellations += 1; } });
    motion.delay({ durationMs: 100, scope: 'b', onCancel: () => { cancellations += 1; } });
    motion.sequence({ steps: [{ type: 'delay', durationMs: 100 }], onCancel: () => { cancellations += 1; } });

    const count = motion.cancelAll();

    expect(count).toBe(3);
    expect(cancellations).toBe(3);
  });

  test('pauseScope freezes only operations in that scope; resumeScope continues from the paused state', () => {
    const motion = new MotionRuntime();
    const { binding: bindingA, read: readA } = makeNumberBinding(0);
    const { binding: bindingB, read: readB } = makeNumberBinding(0);

    motion.tween({ bindings: [{ ...bindingA, to: 100 }], durationMs: 100, scope: 'a' });
    motion.delay({ durationMs: 100, scope: 'a' });
    motion.tween({ bindings: [{ ...bindingB, to: 100 }], durationMs: 100, scope: 'b' });

    motion.update(50);
    expect(readA()).toBe(50);
    expect(readB()).toBe(50);

    const pausedCount = motion.pauseScope('a');
    expect(pausedCount).toBe(2);

    motion.update(1000);
    expect(readA()).toBe(50); // frozen
    expect(readB()).toBe(100); // unaffected, keeps advancing (already capped at `to`)

    const resumedCount = motion.resumeScope('a');
    expect(resumedCount).toBe(2);

    motion.update(50); // 50 (before pause) + 50 (after resume) = 100 total elapsed while active
    expect(readA()).toBe(100);
  });

  test('pauseScope/resumeScope are idempotent (return 0 when nothing newly transitions)', () => {
    const motion = new MotionRuntime();
    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, scope: 'a' });

    expect(motion.pauseScope('a')).toBe(1);
    expect(motion.pauseScope('a')).toBe(0); // already paused

    expect(motion.resumeScope('a')).toBe(1);
    expect(motion.resumeScope('a')).toBe(0); // already active
  });

  test('unrelated scopes are unaffected by cancelScope/pauseScope/resumeScope', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100, scope: 'unrelated' });

    expect(motion.cancelScope('nonexistent-scope')).toBe(0);
    expect(motion.pauseScope('nonexistent-scope')).toBe(0);
    expect(motion.resumeScope('nonexistent-scope')).toBe(0);

    motion.update(50);
    expect(read()).toBe(50); // never touched by any of the calls above
  });

  test('(deferred from Task 5) delay with a scope is cancelled by cancelScope', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    let cancellations = 0;
    motion.delay({
      durationMs: 100,
      scope: 'x',
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; }
    });

    const count = motion.cancelScope('x');

    expect(count).toBe(1);
    expect(cancellations).toBe(1);
    expect(completions).toBe(0);
  });

  test('dispose cancels every active operation (tween, delay, sequence) exactly once and is a safe no-op afterward', () => {
    const motion = new MotionRuntime();
    let cancellations = 0;
    let completions = 0;

    const tweenHandle = motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, onCancel: () => { cancellations += 1; }, onComplete: () => { completions += 1; } });
    const delayHandle = motion.delay({ durationMs: 100, onCancel: () => { cancellations += 1; }, onComplete: () => { completions += 1; } });
    const sequenceHandle = motion.sequence({ steps: [{ type: 'delay', durationMs: 100 }], onCancel: () => { cancellations += 1; }, onComplete: () => { completions += 1; } });

    expect(() => motion.dispose()).not.toThrow();

    expect(cancellations).toBe(3);
    expect(completions).toBe(0);
    expect(tweenHandle.active).toBe(false);
    expect(delayHandle.active).toBe(false);
    expect(sequenceHandle.active).toBe(false);

    expect(() => motion.dispose()).not.toThrow(); // safe no-op when nothing is active
    expect(cancellations).toBe(3); // not fired again
  });

  test('dispose on an empty runtime does not throw', () => {
    const motion = new MotionRuntime();
    expect(() => motion.dispose()).not.toThrow();
  });
});
