import { describe, expect, test } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';

describe('MotionRuntime delay', () => {
  test('completion: onComplete fires exactly once, not again on a later empty update()', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    motion.delay({ durationMs: 100, onComplete: () => { completions += 1; } });

    motion.update(100);
    expect(completions).toBe(1);

    motion.update(100);
    expect(completions).toBe(1);
  });

  test('exact timing: does not complete one frame early', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    motion.delay({ durationMs: 100, onComplete: () => { completions += 1; } });

    motion.update(99);
    expect(completions).toBe(0);

    motion.update(1);
    expect(completions).toBe(1);
  });

  test('pause/resume: frozen while paused, continues from the paused elapsed state on resume', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    const handle = motion.delay({ durationMs: 100, onComplete: () => { completions += 1; } });

    motion.update(50);
    handle.pause();
    motion.update(1000); // no completion despite far exceeding durationMs while paused
    expect(completions).toBe(0);

    handle.resume();
    motion.update(50); // 50 (before pause) + 50 (after resume) = 100 total elapsed while active
    expect(completions).toBe(1);
  });

  test('cancel: onCancel fires exactly once, onComplete never fires; double cancel returns false', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    let cancellations = 0;
    const handle = motion.delay({
      durationMs: 100,
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; }
    });

    expect(handle.cancel()).toBe(true);
    expect(handle.cancel()).toBe(false);
    expect(cancellations).toBe(1);
    expect(completions).toBe(0);

    motion.update(1000);
    expect(completions).toBe(0);
    expect(cancellations).toBe(1);
  });

  test('handle.active / handle.paused reflect state through create -> pause -> resume -> cancel', () => {
    const motion = new MotionRuntime();
    const handle = motion.delay({ durationMs: 100 });

    expect(handle.active).toBe(true);
    expect(handle.paused).toBe(false);

    handle.pause();
    expect(handle.paused).toBe(true);

    handle.resume();
    expect(handle.paused).toBe(false);

    handle.cancel();
    expect(handle.active).toBe(false);
  });

  test('onComplete throwing does not prevent cleanup (not completed twice)', () => {
    const errors: unknown[] = [];
    const motion = new MotionRuntime({ onMotionError: (error) => errors.push(error) });
    let completions = 0;
    motion.delay({
      durationMs: 100,
      onComplete: () => {
        completions += 1;
        throw new Error('onComplete boom');
      }
    });

    expect(() => motion.update(100)).not.toThrow();
    expect(completions).toBe(1);
    expect(errors).toHaveLength(1);

    motion.update(100);
    expect(completions).toBe(1); // not fired again
  });

  test('onCancel throwing does not prevent cleanup (handle is gone)', () => {
    const errors: unknown[] = [];
    const motion = new MotionRuntime({ onMotionError: (error) => errors.push(error) });
    const handle = motion.delay({
      durationMs: 100,
      onCancel: () => {
        throw new Error('onCancel boom');
      }
    });

    expect(() => handle.cancel()).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(handle.cancel()).toBe(false);
  });
});
