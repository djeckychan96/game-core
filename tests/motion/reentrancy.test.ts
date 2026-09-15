import { describe, expect, test } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';
import type { MotionSequenceStep } from '../../src/motion/types';

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

describe('MotionRuntime update() lifecycle reentrancy-safety', () => {
  test('A. tween: a completed operation cannot be re-cancelled by a later callback in the same update()', () => {
    const motion = new MotionRuntime();
    let aCompletions = 0;
    let aCancellations = 0;

    const handleA = motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 10,
      onComplete: () => { aCompletions += 1; },
      onCancel: () => { aCancellations += 1; }
    });

    // Registered AFTER A, so it is visited later in the same update() call.
    motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 10,
      onComplete: () => {
        // reentrant: try to cancel A, which already completed earlier in this same update()
        const cancelled = handleA.cancel();
        expect(cancelled).toBe(false);
      }
    });

    motion.update(10);

    expect(aCompletions).toBe(1);
    expect(aCancellations).toBe(0);
    expect(handleA.active).toBe(false);
  });

  test('B. tween: onComplete reentrantly calling cancelScope on its own scope does not re-count/re-cancel itself', () => {
    const motion = new MotionRuntime();
    let selfCancelled = false;
    let siblingCancelled = false;
    let reportedCount = -1;

    motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 10,
      scope: 'a',
      onComplete: () => {
        reportedCount = motion.cancelScope('a');
      },
      onCancel: () => { selfCancelled = true; }
    });
    motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 1000,
      scope: 'a',
      onCancel: () => { siblingCancelled = true; }
    });

    motion.update(10);

    expect(selfCancelled).toBe(false); // already completed, never also cancelled
    expect(siblingCancelled).toBe(true);
    expect(reportedCount).toBe(1); // only the sibling, not the already-completed self
  });

  test('C. delay: same reentrant-cancel-after-complete protection as tween', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    let cancellations = 0;

    const handleA = motion.delay({
      durationMs: 10,
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; }
    });

    motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 10,
      onComplete: () => {
        expect(handleA.cancel()).toBe(false);
      }
    });

    motion.update(10);

    expect(completions).toBe(1);
    expect(cancellations).toBe(0);
    expect(handleA.active).toBe(false);
  });

  test('D. sequence: top-level reentrant-cancel-after-complete protection', () => {
    const motion = new MotionRuntime();
    let completions = 0;
    let cancellations = 0;

    const handleSeq = motion.sequence({
      steps: [{ type: 'delay', durationMs: 10 }],
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; }
    });

    motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 10,
      onComplete: () => {
        expect(handleSeq.cancel()).toBe(false);
      }
    });

    motion.update(10);

    expect(completions).toBe(1);
    expect(cancellations).toBe(0);
    expect(handleSeq.active).toBe(false);
  });

  test('E. binding error -> cancel: a repeated cancel()/cancelScope() from inside onCancel does not double-fire and the operation is already inactive', () => {
    const motion = new MotionRuntime();
    let cancellations = 0;
    let handle: ReturnType<MotionRuntime['tween']>;

    handle = motion.tween({
      bindings: [{
        get: () => { throw new Error('boom'); },
        set: () => {},
        to: 100
      }],
      durationMs: 10,
      scope: 'z',
      onCancel: () => {
        cancellations += 1;
        expect(handle.cancel()).toBe(false); // already gone, from inside its own onCancel
        expect(motion.cancelScope('z')).toBe(0); // nothing left in scope 'z' either
      }
    });

    motion.update(10);

    expect(cancellations).toBe(1);
    expect(handle.active).toBe(false);
  });
});

describe('MotionRuntime sequence step terminal reentrancy', () => {
  describe.each(['delay', 'tween'] as const)('%s step', (kind) => {
    describe.each(['cancel', 'cancelScope', 'cancelAll'] as const)('%s from onComplete', (method) => {
      test.each([true, false])('completes only once when cancelling its parent (last step: %s)', (lastStep) => {
        const motion = new MotionRuntime();
        const events: string[] = [];
        const { binding, read } = makeNumberBinding(0);
        let nextStepWrites = 0;
        let cancelResult: boolean | number | undefined;
        const step: MotionSequenceStep = {
          ...(kind === 'tween'
            ? { type: 'tween' as const, bindings: [{ ...binding, to: 100 }] }
            : { type: 'delay' as const }),
          durationMs: 50,
          onComplete: () => {
            events.push('step:complete');
            cancelResult = method === 'cancel' ? handle.cancel()
              : method === 'cancelScope' ? motion.cancelScope('sequence') : motion.cancelAll();
          },
          onCancel: () => { events.push('step:cancel'); }
        };
        const handle = motion.sequence({
          scope: 'sequence',
          steps: lastStep ? [step] : [step, {
            type: 'tween',
            bindings: [{ get: () => 0, set: () => { nextStepWrites += 1; }, to: 100 }],
            durationMs: 50,
            onComplete: () => { events.push('next:complete'); },
            onCancel: () => { events.push('next:cancel'); }
          }],
          onComplete: () => { events.push('sequence:complete'); },
          onCancel: () => { events.push('sequence:cancel'); }
        });

        motion.update(50);
        motion.update(1000);

        expect(events).toEqual(['step:complete', 'sequence:cancel']);
        expect(cancelResult).toBe(method === 'cancel' ? true : 1);
        expect(handle.active).toBe(false);
        expect(handle.cancel()).toBe(false);
        expect(nextStepWrites).toBe(0);
        if (kind === 'tween') expect(read()).toBe(100);
        expect(motion.getStats()).toMatchObject({
          activeMotions: 0, completedMotions: 0, cancelledMotions: 1
        });
      });
    });
  });

  test('a tween step is already terminal during its final onUpdate callback', () => {
    const motion = new MotionRuntime();
    const events: string[] = [];
    const handle = motion.sequence({
      steps: [{
        type: 'tween',
        bindings: [{ get: () => 0, set: () => {}, to: 100 }],
        durationMs: 50,
        onUpdate: () => { handle.cancel(); },
        onComplete: () => { events.push('step:complete'); },
        onCancel: () => { events.push('step:cancel'); }
      }],
      onComplete: () => { events.push('sequence:complete'); },
      onCancel: () => { events.push('sequence:cancel'); }
    });

    motion.update(50);
    motion.update(50);

    expect(events).toEqual(['sequence:cancel', 'step:complete']);
    expect(motion.getStats()).toMatchObject({ completedMotions: 0, cancelledMotions: 1 });
  });

  test('cancelling a tween step from its final binding write prevents completion', () => {
    const motion = new MotionRuntime();
    const events: string[] = [];
    const handle = motion.sequence({
      steps: [{
        type: 'tween',
        bindings: [{ get: () => 0, set: () => { handle.cancel(); }, to: 100 }],
        durationMs: 50,
        onComplete: () => { events.push('step:complete'); },
        onCancel: () => { events.push('step:cancel'); }
      }],
      onComplete: () => { events.push('sequence:complete'); },
      onCancel: () => { events.push('sequence:cancel'); }
    });

    motion.update(50);
    motion.update(50);

    expect(events).toEqual(['step:cancel', 'sequence:cancel']);
    expect(motion.getStats()).toMatchObject({ completedMotions: 0, cancelledMotions: 1 });
  });

  test.each(['onCancel', 'onMotionError'] as const)(
    'a failed tween step cannot be cancelled twice by its %s handler', (callback) => {
      const events: string[] = [];
      let reports = 0;
      const motion = new MotionRuntime({
        onMotionError: () => {
          reports += 1;
          if (callback === 'onMotionError') handle.cancel();
        }
      });
      const handle = motion.sequence({
        steps: [{
          type: 'tween',
          bindings: [{ get: () => { throw new Error('binding failed'); }, set: () => {}, to: 100 }],
          durationMs: 50,
          onComplete: () => { events.push('step:complete'); },
          onCancel: () => {
            events.push('step:cancel');
            if (callback === 'onCancel') handle.cancel();
          }
        }],
        onComplete: () => { events.push('sequence:complete'); },
        onCancel: () => { events.push('sequence:cancel'); }
      });

      expect(() => motion.update(50)).not.toThrow();
      motion.update(50);

      expect(events).toEqual(['step:cancel', 'sequence:cancel']);
      expect(reports).toBe(1);
      expect(handle.cancel()).toBe(false);
      expect(motion.getStats()).toMatchObject({
        activeMotions: 0, completedMotions: 0, cancelledMotions: 1, bindingErrors: 1
      });
    }
  );
});

describe('MotionRuntime operations created during update() do not tick until the next update()', () => {
  test('A completes in update(100) and creates B in onComplete; B stays untouched until the next update()', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let bCompletions = 0;
    let bHandle: ReturnType<MotionRuntime['tween']>;

    motion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 100,
      onComplete: () => {
        bHandle = motion.tween({
          bindings: [{ ...binding, to: 100 }],
          durationMs: 100,
          onComplete: () => { bCompletions += 1; }
        });
      }
    });

    motion.update(100);

    expect(bHandle!.active).toBe(true);
    expect(read()).toBe(0); // still at its initial value, never advanced this call
    expect(bCompletions).toBe(0);

    motion.update(50); // B's first real tick
    expect(read()).toBe(50);
  });

  test('regression: a chain of motions created one-from-another does not all run in a single update()', () => {
    const motion = new MotionRuntime();
    let chainLength = 0;
    const MAX_CHAIN = 5;

    function spawnNext() {
      chainLength += 1;
      if (chainLength >= MAX_CHAIN) return;
      motion.tween({
        bindings: [{ get: () => 0, set: () => {}, to: 100 }],
        durationMs: 10,
        onComplete: spawnNext
      });
    }
    spawnNext(); // creates the first link before any update() call

    motion.update(10); // only the first link should complete/spawn this call

    expect(chainLength).toBe(2); // first link completed and spawned exactly one more, not the whole chain
  });
});
