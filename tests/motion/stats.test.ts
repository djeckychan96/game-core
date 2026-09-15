import { describe, expect, test, vi } from 'vitest';
import { MotionRuntime } from '../../src/motion/MotionRuntime';

describe('MotionRuntime.getStats()', () => {
  test('activeTweens/activeDelays/activeSequences/activeMotions move correctly as operations are created', () => {
    const motion = new MotionRuntime();

    expect(motion.getStats()).toMatchObject({
      activeMotions: 0,
      activeTweens: 0,
      activeDelays: 0,
      activeSequences: 0
    });

    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 });
    motion.delay({ durationMs: 100 });
    motion.sequence({ steps: [{ type: 'delay', durationMs: 100 }] });

    expect(motion.getStats()).toMatchObject({
      activeMotions: 3,
      activeTweens: 1,
      activeDelays: 1,
      activeSequences: 1
    });
  });

  test('a running sequence step never registers as a top-level activeTween/activeDelay', () => {
    const motion = new MotionRuntime();
    motion.sequence({
      steps: [
        { type: 'tween', bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 },
        { type: 'delay', durationMs: 100 }
      ]
    });

    motion.update(50); // the tween step is now actively running

    expect(motion.getStats()).toMatchObject({
      activeMotions: 1,
      activeTweens: 0,
      activeDelays: 0,
      activeSequences: 1
    });
  });

  test('active counts decrease as operations complete or are cancelled', () => {
    const motion = new MotionRuntime();
    const tweenHandle = motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 });
    motion.delay({ durationMs: 100 });

    expect(motion.getStats().activeMotions).toBe(2);

    tweenHandle.cancel();
    expect(motion.getStats()).toMatchObject({ activeMotions: 1, activeTweens: 0, activeDelays: 1 });

    motion.update(100); // delay completes
    expect(motion.getStats()).toMatchObject({ activeMotions: 0, activeDelays: 0 });
  });

  test('pausedMotions increments on pause() and decrements on resume(), across tween/delay/sequence', () => {
    const motion = new MotionRuntime();
    const tweenHandle = motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 });
    const delayHandle = motion.delay({ durationMs: 100 });
    const seqHandle = motion.sequence({ steps: [{ type: 'delay', durationMs: 100 }] });

    expect(motion.getStats().pausedMotions).toBe(0);

    tweenHandle.pause();
    delayHandle.pause();
    seqHandle.pause();
    expect(motion.getStats().pausedMotions).toBe(3);

    tweenHandle.resume();
    expect(motion.getStats().pausedMotions).toBe(2);

    delayHandle.resume();
    seqHandle.resume();
    expect(motion.getStats().pausedMotions).toBe(0);
  });

  test('completedMotions increments by exactly 1 per top-level tween/delay/sequence completion', () => {
    const motion = new MotionRuntime();
    expect(motion.getStats().completedMotions).toBe(0);

    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 });
    motion.update(100);
    expect(motion.getStats().completedMotions).toBe(1);

    motion.delay({ durationMs: 100 });
    motion.update(100);
    expect(motion.getStats().completedMotions).toBe(2);

    // A sequence with 2 steps completes the whole sequence as ONE top-level completion, not 2.
    motion.sequence({ steps: [{ type: 'delay', durationMs: 50 }, { type: 'delay', durationMs: 50 }] });
    motion.update(50);
    motion.update(50);
    expect(motion.getStats().completedMotions).toBe(3);
  });

  test('cancelledMotions increments by exactly 1 per cancel()/cancelScope()/cancelAll()-cancelled operation, including a sequence cancelled mid-step', () => {
    const motion = new MotionRuntime();
    expect(motion.getStats().cancelledMotions).toBe(0);

    const tweenHandle = motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100 });
    tweenHandle.cancel();
    expect(motion.getStats().cancelledMotions).toBe(1);

    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, scope: 'a' });
    motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 100, scope: 'a' });
    expect(motion.cancelScope('a')).toBe(2);
    expect(motion.getStats().cancelledMotions).toBe(3);

    motion.delay({ durationMs: 100 });
    motion.delay({ durationMs: 100 });
    expect(motion.cancelAll()).toBe(2);
    expect(motion.getStats().cancelledMotions).toBe(5);

    // A 2-step sequence cancelled mid-step counts as ONE cancelled operation, not one per step.
    const seqHandle = motion.sequence({
      steps: [
        { type: 'delay', durationMs: 100 },
        { type: 'delay', durationMs: 100 }
      ]
    });
    seqHandle.cancel();
    expect(motion.getStats().cancelledMotions).toBe(6);
  });

  test('an empty sequence completing immediately still counts as exactly 1 completedMotions', () => {
    const motion = new MotionRuntime();
    motion.sequence({ steps: [] });
    motion.update(0);
    expect(motion.getStats().completedMotions).toBe(1);
    expect(motion.getStats().cancelledMotions).toBe(0);
  });

  test('callbackErrors increments once per caught onUpdate/onComplete/onCancel exception', () => {
    // Each phase uses its own runtime so one still-active throwing operation from an earlier
    // assertion can't also fire (and be counted) during a later assertion's update() call.
    const onUpdateMotion = new MotionRuntime({ onMotionError: () => {} });
    onUpdateMotion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 100,
      onUpdate: () => { throw new Error('onUpdate boom'); }
    });
    onUpdateMotion.update(50);
    expect(onUpdateMotion.getStats().callbackErrors).toBe(1);

    const onCompleteMotion = new MotionRuntime({ onMotionError: () => {} });
    onCompleteMotion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 100,
      onComplete: () => { throw new Error('onComplete boom'); }
    });
    onCompleteMotion.update(100);
    expect(onCompleteMotion.getStats().callbackErrors).toBe(1);

    const onCancelMotion = new MotionRuntime({ onMotionError: () => {} });
    const handle = onCancelMotion.tween({
      bindings: [{ get: () => 0, set: () => {}, to: 100 }],
      durationMs: 100,
      onCancel: () => { throw new Error('onCancel boom'); }
    });
    handle.cancel();
    expect(onCancelMotion.getStats().callbackErrors).toBe(1);
  });

  test('bindingErrors increments once per caught binding.get()/set() exception', () => {
    const motion = new MotionRuntime({ onMotionError: () => {} });
    expect(motion.getStats().bindingErrors).toBe(0);

    motion.tween({
      bindings: [{ get: () => { throw new Error('get boom'); }, set: () => {}, to: 100 }],
      durationMs: 100
    });
    motion.update(10);
    expect(motion.getStats().bindingErrors).toBe(1);

    motion.tween({
      bindings: [{
        get: () => 0,
        set: () => { throw new Error('set boom'); },
        to: 100
      }],
      durationMs: 100
    });
    motion.update(10);
    expect(motion.getStats().bindingErrors).toBe(2);
  });

  test('lastUpdateMs/maxUpdateMs are recorded, and the timing source is read at most twice per update() call regardless of active operation count', () => {
    const motion = new MotionRuntime();
    for (let i = 0; i < 5; i++) {
      motion.tween({ bindings: [{ get: () => 0, set: () => {}, to: 100 }], durationMs: 1000 });
    }
    motion.delay({ durationMs: 1000 });
    motion.sequence({ steps: [{ type: 'delay', durationMs: 1000 }] });

    const spy = vi.spyOn(performance, 'now');
    spy.mockClear();

    motion.update(10);

    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    spy.mockRestore();

    const stats = motion.getStats();
    expect(stats.lastUpdateMs).toBeGreaterThanOrEqual(0);
    expect(stats.maxUpdateMs).toBeGreaterThanOrEqual(stats.lastUpdateMs === stats.maxUpdateMs ? 0 : 0);
    expect(stats.maxUpdateMs).toBeGreaterThanOrEqual(stats.lastUpdateMs);
  });

  test('getStats() returns a plain object shape matching MotionRuntimeStats exactly', () => {
    const motion = new MotionRuntime();
    const keys = Object.keys(motion.getStats()).sort();
    expect(keys).toEqual([
      'activeDelays',
      'activeMotions',
      'activeSequences',
      'activeTweens',
      'bindingErrors',
      'callbackErrors',
      'cancelledMotions',
      'completedMotions',
      'lastUpdateMs',
      'maxUpdateMs',
      'pausedMotions'
    ]);
  });
});
