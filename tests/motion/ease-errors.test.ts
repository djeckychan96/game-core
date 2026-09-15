import { describe, expect, test } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';
import type { MotionErrorContext } from '../../src/motion/types';

describe('MotionRuntime custom easing error isolation', () => {
  describe.each([false, true])('sequence step: %s', (inSequence) => {
    test.each([
      { frameMs: 50, repeat: 0, yoyo: false },
      { frameMs: 350, repeat: Infinity, yoyo: false },
      { frameMs: 350, repeat: Infinity, yoyo: true }
    ])('cancels only the failing motion at $frameMs ms (repeat: $repeat, yoyo: $yoyo)', ({ frameMs, repeat, yoyo }) => {
      const error = new Error('custom easing failed');
      const reports: Array<{ error: unknown; context: MotionErrorContext }> = [];
      const motion = new MotionRuntime({ onMotionError: (error, context) => reports.push({ error, context }) });
      const events: string[] = [];
      let failedValue = 20;
      let healthyValue = 0;
      let easeCalls = 0;
      let nextStepWrites = 0;
      const options = {
        bindings: [{ get: () => failedValue, set: (value: number) => { failedValue = value; }, to: 100 }],
        durationMs: 100,
        repeat,
        yoyo,
        ease: () => { easeCalls += 1; throw error; },
        onUpdate: () => { events.push('tween:update'); },
        onComplete: () => { events.push('tween:complete'); },
        onCancel: () => { events.push('tween:cancel'); }
      };
      const handle = inSequence ? motion.sequence({
        steps: [
          { type: 'tween', ...options },
          {
            type: 'tween', durationMs: 100,
            bindings: [{ get: () => 0, set: () => { nextStepWrites += 1; }, to: 100 }]
          }
        ],
        onComplete: () => { events.push('sequence:complete'); },
        onCancel: () => { events.push('sequence:cancel'); }
      }) : motion.tween(options);
      // Registered after the throwing operation: must advance during that same update call.
      const healthy = motion.tween({
        bindings: [{ get: () => healthyValue, set: (value) => { healthyValue = value; }, to: 1000 }],
        durationMs: 1000
      });

      expect(() => motion.update(frameMs)).not.toThrow();

      expect(healthyValue).toBe(frameMs);
      expect(handle.active).toBe(false);
      expect(handle.cancel()).toBe(false);
      expect(motion.getStats()).toMatchObject({
        activeMotions: 1, cancelledMotions: 1, completedMotions: 0,
        callbackErrors: 1, bindingErrors: 0
      });

      motion.update(50);
      expect(healthyValue).toBe(frameMs + 50);
      motion.update(1000);

      expect(healthyValue).toBe(1000);
      expect(healthy.active).toBe(false);
      expect(failedValue).toBe(20); // cancellation never snaps to an endpoint
      expect(easeCalls).toBe(1);
      expect(nextStepWrites).toBe(0);
      expect(events).toEqual(inSequence ? ['tween:cancel', 'sequence:cancel'] : ['tween:cancel']);
      expect(reports).toEqual([{ error, context: { kind: 'tween', phase: 'ease' } }]);
      expect(motion.getStats()).toMatchObject({
        activeMotions: 0, cancelledMotions: 1, completedMotions: 1,
        callbackErrors: 1, bindingErrors: 0
      });
    });
  });

  test('a throwing error handler and onCancel cannot escape an easing failure or stop later motions', () => {
    const reports: MotionErrorContext[] = [];
    const motion = new MotionRuntime({
      onMotionError: (_error, context) => {
        reports.push(context);
        throw new Error('error handler failed');
      }
    });
    let cancellations = 0;
    let completions = 0;
    let healthyValue = 0;
    const handle = motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 100,
      ease: () => { throw new Error('easing failed'); },
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; throw new Error('onCancel failed'); }
    });
    motion.tween({
      bindings: [{ get: () => healthyValue, set: (value) => { healthyValue = value; }, to: 100 }],
      durationMs: 100
    });

    expect(() => motion.update(50)).not.toThrow();
    expect(healthyValue).toBe(50);
    expect(() => motion.update(50)).not.toThrow();

    expect(healthyValue).toBe(100);
    expect(cancellations).toBe(1);
    expect(completions).toBe(0);
    expect(handle.cancel()).toBe(false);
    expect(reports).toEqual([{ kind: 'tween', phase: 'ease' }, { kind: 'tween', phase: 'onCancel' }]);
    expect(motion.getStats()).toMatchObject({ callbackErrors: 2, bindingErrors: 0, cancelledMotions: 1 });
  });
});
