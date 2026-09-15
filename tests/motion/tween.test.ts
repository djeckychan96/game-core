import { describe, expect, test, vi } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';
import { backOut, easeIn, easeInOut, easeOut, linear } from '../../src/motion/easing';
import type { EaseName, MotionErrorContext } from '../../src/motion/types';

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

  test('repeat: 0 behaves exactly like a single pass (regression guard)', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: 0,
      onComplete: () => {
        completions += 1;
      }
    });

    motion.update(100);
    expect(read()).toBe(100);
    expect(completions).toBe(1);

    motion.update(100);
    expect(completions).toBe(1); // still exactly once
  });

  test('repeat: 2 runs 3 total passes; onComplete fires exactly once, after the 3rd', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: 2,
      onComplete: () => {
        completions += 1;
      }
    });

    motion.update(100); // pass 0 done
    expect(read()).toBe(100);
    expect(completions).toBe(0);

    motion.update(100); // pass 1 done
    expect(read()).toBe(100);
    expect(completions).toBe(0);

    motion.update(100); // pass 2 done -> exhausted -> real completion
    expect(read()).toBe(100);
    expect(completions).toBe(1);

    motion.update(100); // nothing left
    expect(completions).toBe(1);
  });

  test('repeat: Infinity never completes naturally, but cancel() still works', () => {
    const motion = new MotionRuntime();
    const { binding } = makeNumberBinding(0);
    let completions = 0;
    let cancellations = 0;
    const handle = motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: Infinity,
      onComplete: () => {
        completions += 1;
      },
      onCancel: () => {
        cancellations += 1;
      }
    });

    for (let i = 0; i < 20; i++) motion.update(100);

    expect(completions).toBe(0);
    expect(handle.active).toBe(true);

    expect(handle.cancel()).toBe(true);
    expect(cancellations).toBe(1);
  });

  test('yoyo: true with repeat: 1 alternates direction; pass 1 ends at `from`, not `to`', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: 1,
      yoyo: true
    });

    motion.update(50); // pass 0 midpoint
    const pass0Midpoint = read();
    expect(pass0Midpoint).toBe(50);

    motion.update(50); // pass 0 complete (from -> to), flips into pass 1 (to -> from)
    expect(read()).toBe(100);

    motion.update(50); // pass 1 midpoint
    expect(read()).toBe(pass0Midpoint); // same arithmetic midpoint, opposite direction

    motion.update(50); // pass 1 complete: ends at `from`, not `to`
    expect(read()).toBe(0);
  });

  test('yoyo endpoints are fixed across passes: get() is never called again after the first real start', () => {
    const motion = new MotionRuntime();
    let outer = 0;
    const get = vi.fn(() => outer);
    motion.tween({
      bindings: [{ get, set: (v) => { outer = v; }, to: 100 }],
      durationMs: 100,
      repeat: 1,
      yoyo: true
    });

    motion.update(50); // resolves from=0 via get() (called once)
    expect(get).toHaveBeenCalledTimes(1);

    outer = 999; // if get() were ever called again, this decoy would corrupt the math
    motion.update(50); // finishes pass 0

    // pass 1 (yoyo) must still use the ORIGINAL resolved from (0), not the decoy 999
    motion.update(50); // pass 1 midpoint
    expect(outer).toBe(50); // midpoint between the ORIGINAL to=100 and from=0
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("onUpdate's raw progress resets fresh at the start of each new pass", () => {
    const motion = new MotionRuntime();
    const { binding } = makeNumberBinding(0);
    const seen: number[] = [];
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: 1,
      onUpdate: (progress) => seen.push(progress)
    });

    motion.update(100); // pass 0 complete: progress hits 1
    motion.update(50); // into pass 1: progress must be back down at 0.5, not 1.5

    expect(seen[seen.length - 1]).toBe(0.5);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
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

describe('MotionRuntime error isolation', () => {
  function makeThrowingMotion(errors: Array<{ error: unknown; context: MotionErrorContext }>) {
    return new MotionRuntime({
      onMotionError: (error, context) => {
        errors.push({ error, context });
      }
    });
  }

  test('binding.get() throws during implicit-from resolution -> operation cancelled, onCancel once, onComplete never', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    let completions = 0;
    let cancellations = 0;
    motion.tween({
      bindings: [{
        get: () => {
          throw new Error('get boom');
        },
        set: () => {},
        to: 100
      }],
      durationMs: 100,
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; }
    });

    expect(() => motion.update(10)).not.toThrow();

    expect(cancellations).toBe(1);
    expect(completions).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context.phase).toBe('binding-get');
    expect(errors[0]?.context.kind).toBe('tween');
  });

  test('binding.set() throws during a normal per-frame write -> same cancellation/report shape', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    let completions = 0;
    let cancellations = 0;
    motion.tween({
      bindings: [{
        get: () => 0,
        set: () => {
          throw new Error('set boom');
        },
        to: 100
      }],
      durationMs: 100,
      onComplete: () => { completions += 1; },
      onCancel: () => { cancellations += 1; }
    });

    expect(() => motion.update(10)).not.toThrow();

    expect(cancellations).toBe(1);
    expect(completions).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context.phase).toBe('binding-set');
  });

  test('a failing motion does not affect a second, healthy motion in the same update() call', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{
        get: () => {
          throw new Error('boom');
        },
        set: () => {},
        to: 100
      }],
      durationMs: 100
    });
    motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    expect(() => motion.update(50)).not.toThrow();

    expect(read()).toBe(50); // the healthy motion still advanced in the same call
    expect(errors).toHaveLength(1);
  });

  test('the runtime keeps updating healthy motions on later frames after an isolated failure', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{
        get: () => {
          throw new Error('boom');
        },
        set: () => {},
        to: 100
      }],
      durationMs: 100
    });
    motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    motion.update(50);
    motion.update(25);

    expect(read()).toBe(75);
  });

  test('onUpdate throws -> reported, operation is NOT cancelled and keeps advancing', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onUpdate: () => {
        throw new Error('onUpdate boom');
      }
    });

    motion.update(50);
    expect(read()).toBe(50);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context.phase).toBe('onUpdate');

    motion.update(50); // must keep advancing despite the earlier throw
    expect(read()).toBe(100);
  });

  test('onComplete throws -> cleanup still happens (operation removed, not completed twice)', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    const { binding } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onComplete: () => {
        completions += 1;
        throw new Error('onComplete boom');
      }
    });

    expect(() => motion.update(100)).not.toThrow();
    expect(completions).toBe(1);
    expect(errors[0]?.context.phase).toBe('onComplete');

    motion.update(50); // nothing left; must not fire onComplete again
    expect(completions).toBe(1);
  });

  test('onCancel throws -> cleanup still happens (handle is gone, second cancel returns false)', () => {
    const errors: Array<{ error: unknown; context: MotionErrorContext }> = [];
    const motion = makeThrowingMotion(errors);
    const { binding } = makeNumberBinding(0);
    const handle = motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      onCancel: () => {
        throw new Error('onCancel boom');
      }
    });

    expect(() => {
      expect(handle.cancel()).toBe(true);
    }).not.toThrow();
    expect(errors[0]?.context.phase).toBe('onCancel');
    expect(handle.cancel()).toBe(false); // already gone
  });

  test('a throwing error handler never escapes update()/cancel() and does not stop the rest of the runtime', () => {
    const motion = new MotionRuntime({
      onMotionError: () => {
        throw new Error('handler itself is broken');
      }
    });
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{
        get: () => {
          throw new Error('boom');
        },
        set: () => {},
        to: 100
      }],
      durationMs: 100
    });
    motion.tween({ bindings: [{ ...binding, to: 100 }], durationMs: 100 });

    expect(() => motion.update(50)).not.toThrow();
    expect(read()).toBe(50);
  });

  test('default handler (no onMotionError given) falls back to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const motion = new MotionRuntime();
      motion.tween({
        bindings: [{
          get: () => {
            throw new Error('boom');
          },
          set: () => {},
          to: 100
        }],
        durationMs: 100
      });

      motion.update(10);

      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('MotionRuntime large frame deltas across repeat/yoyo passes', () => {
  test('finite repeat: a single huge update() fully consumes all passes in one call', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: 2, // 3 passes total
      onComplete: () => { completions += 1; }
    });

    motion.update(350); // spans all 3 passes' worth of time in one call

    expect(completions).toBe(1); // exactly once, in THIS update() call
    expect(read()).toBe(100); // exact final endpoint (no yoyo: ends at `to`)

    motion.update(0); // nothing left; must not fire again
    expect(completions).toBe(1);
  });

  test('infinite repeat without yoyo: lands at the correct position inside the current pass immediately', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: Infinity
    });

    motion.update(350); // 3 full passes + 50ms into the 4th, in one call

    // No yoyo: every pass goes from -> to, so 50ms into any pass is the same arithmetic midpoint.
    expect(read()).toBe(50);
  });

  test('infinite repeat + yoyo: direction/parity and position reflect the real elapsed time immediately', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: Infinity,
      yoyo: true
    });

    motion.update(350); // 3 full passes (0,1,2) + 50ms into pass 3, in one call
    // pass 0: from->to (dir +1). pass 1: to->from (dir -1). pass 2: from->to (dir +1).
    // pass 3 (the one we land inside, 50ms in): direction flipped 3 times from +1 -> -1 -> +1 -> -1.
    // So pass 3 goes to->from; at its 50% mark the value is still the arithmetic midpoint (50).
    expect(read()).toBe(50);

    // Prove direction really is -1 (to->from) for pass 3, not +1: finish pass 3 and check the endpoint.
    motion.update(50); // completes pass 3 (50ms remaining of its 100ms)
    expect(read()).toBe(0); // pass 3 ends at `from` (0), not `to` (100)
  });

  test('exact pass boundary: a single update() landing exactly on a boundary does not double-complete or skip a pass', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: Infinity,
      yoyo: true,
      onComplete: () => { completions += 1; }
    });

    motion.update(100); // lands exactly on the pass-0/pass-1 boundary

    expect(completions).toBe(0); // infinite repeat never completes naturally
    expect(read()).toBe(100); // sitting exactly at the boundary value (`to`, end of pass 0 / start of pass 1)

    motion.update(50); // 50ms into pass 1 (direction now -1: to -> from)
    expect(read()).toBe(50); // arithmetic midpoint again

    motion.update(50); // completes pass 1 exactly
    expect(read()).toBe(0); // pass 1 ends at `from`
  });

  test('exact boundary with finite repeat does not overshoot into an extra pass', () => {
    const motion = new MotionRuntime();
    const { binding, read } = makeNumberBinding(0);
    let completions = 0;
    motion.tween({
      bindings: [{ ...binding, to: 100 }],
      durationMs: 100,
      repeat: 1, // 2 passes total (index 0 and 1)
      onComplete: () => { completions += 1; }
    });

    motion.update(100); // exactly finishes pass 0, lands exactly at the start of pass 1

    expect(completions).toBe(0); // pass 1 still remains
    expect(read()).toBe(100);

    motion.update(100); // exactly finishes pass 1 -> exhausted, completes
    expect(completions).toBe(1);
    expect(read()).toBe(100);
  });
});
