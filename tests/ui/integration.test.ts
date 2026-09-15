import { describe, expect, test } from 'vitest';
import { CoreRuntime, type CoreRuntimeModule } from '../../src/core/CoreRuntime';
import { MotionRuntime } from '../../src/motion/MotionRuntime';
import { UiRuntime } from '../../src/ui/UiRuntime';
import type { UiErrorContext } from '../../src/ui/types';

type Order = 'ui-first' | 'motion-first';

function setup(order: Order) {
  const core = new CoreRuntime();
  const motion = new MotionRuntime();
  const log: string[] = [];
  const errors: UiErrorContext[] = [];
  const flags = { onShown: false, continuation: false };
  const ui = new UiRuntime({
    motion,
    onUiError: (_error, context) => errors.push(context),
    onBlockingChanged: (value) => log.push(`blocking:${value}`)
  });
  if (order === 'ui-first') {
    core.registerRuntime('ui', ui);
    core.registerRuntime('motion', motion);
  } else {
    core.registerRuntime('motion', motion);
    core.registerRuntime('ui', ui);
  }
  const button = ui.createButton({
    id: 'btn',
    onProgress: (progress) => log.push(`progress:${progress}`),
    onPress: () => log.push('press'),
    onTap: () => log.push('tap'),
    onCancel: (reason) => log.push(`cancel:${reason}`)
  });
  const window = ui.createWindow({
    id: 'win',
    enterDurationMs: 440,
    leaveDurationMs: 200,
    blocksGameplay: true,
    onShow: () => log.push('onShow'),
    onTransition: (progress, phase) => log.push(`onTransition:${phase}:${progress.toFixed(3)}`),
    onShown: () => { flags.onShown = true; log.push('onShown'); },
    onHidden: (reason) => log.push(`onHidden:${reason}`)
  });
  const continuation = () => { flags.continuation = true; log.push('onClosed'); };
  const tail = (from: number) => log.slice(from);
  return { core, motion, ui, button, window, log, errors, flags, continuation, tail };
}

/**
 * Global cancellation fires the same callbacks exactly once in every route and order; the order
 * WITHIN a controller is fixed (a button reports onProgress(0) before onCancel, a window reports
 * onHidden before blocking), while the interleaving BETWEEN controllers follows whichever module
 * reached them first (MotionRuntime iterates operations in creation order, UiRuntime settles windows
 * first). Assert the multiset plus the per-controller order.
 */
function expectSettleCallbacks(entries: string[]): void {
  expect([...entries].sort()).toEqual(['blocking:false', 'cancel:programmatic', 'onHidden:cancelled', 'progress:0']);
  expect(entries.indexOf('progress:0')).toBeLessThan(entries.indexOf('cancel:programmatic'));
  expect(entries.indexOf('onHidden:cancelled')).toBeLessThan(entries.indexOf('blocking:false'));
}

const orders: Order[] = ['ui-first', 'motion-first'];

describe.each(orders)('UiRuntime with the real CoreRuntime and MotionRuntime (%s)', (order) => {
  test('an active press settles under core.cancelAll()', () => {
    const { core, motion, button, log, tail, errors } = setup(order);
    button.pointerDown(1, 0, 0);
    core.update(40);
    const mark = log.length;
    core.cancelAll();
    expect(tail(mark)).toEqual(['progress:0', 'cancel:programmatic']);
    expect(button.state).toBe('idle');
    expect(button.progress).toBe(0);
    expect(motion.getStats().activeMotions).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a release tween settles under core.cancelAll() with onProgress(0) only', () => {
    const { core, motion, button, log, tail } = setup(order);
    button.pointerDown(1, 0, 0);
    core.update(80);
    button.pointerUp(1, 0, 0, true);
    core.update(40);
    const mark = log.length;
    core.cancelAll();
    expect(tail(mark)).toEqual(['progress:0']);
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('an entering window is force-hidden under core.cancelAll()', () => {
    const { core, motion, ui, window, log, tail, flags } = setup(order);
    window.show();
    core.update(100);
    const mark = log.length;
    core.cancelAll();
    expect(tail(mark)).toEqual(['onHidden:cancelled', 'blocking:false']);
    expect(window.state).toBe('hidden');
    expect(flags.onShown).toBe(false);
    expect(flags.continuation).toBe(false);
    expect(ui.activeWindow).toBeNull();
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('a shown blocking window is force-hidden under core.cancelAll() and blocking ends once', () => {
    const { core, motion, ui, window, log, tail } = setup(order);
    window.show();
    core.update(440);
    expect(ui.isBlocking()).toBe(true);
    const mark = log.length;
    core.cancelAll();
    expect(tail(mark)).toEqual(['onHidden:cancelled', 'blocking:false']);
    expect(ui.activeWindow).toBeNull();
    expect(ui.isBlocking()).toBe(false);
    expect(log.filter((entry) => entry.startsWith('blocking:'))).toEqual(['blocking:true', 'blocking:false']);
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('a leaving window with a continuation is force-hidden and the continuation never runs', () => {
    const { core, motion, window, log, tail, flags, continuation } = setup(order);
    window.show();
    core.update(440);
    window.close('button', continuation);
    core.update(50);
    const mark = log.length;
    core.cancelAll();
    expect(tail(mark)).toEqual(['onHidden:cancelled', 'blocking:false']);
    expect(window.state).toBe('hidden');
    expect(flags.continuation).toBe(false);
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('no business callback runs under any global cancellation route', () => {
    const routes: Array<[string, (s: ReturnType<typeof setup>) => void]> = [
      ['core.cancelAll', (s) => { s.core.cancelAll(); }],
      ['core.cancelScope', (s) => { s.core.cancelScope(s.window.scope); }],
      ['motion.cancelAll', (s) => { s.motion.cancelAll(); }],
      ['ui.cancelAll', (s) => { s.ui.cancelAll(); }],
      ['core.dispose', (s) => { s.core.dispose(); }]
    ];
    for (const [, route] of routes) {
      const s = setup(order);
      s.window.show();
      s.core.update(440);
      s.window.close('programmatic', s.continuation);
      s.core.update(20);
      route(s);
      expect(s.flags.continuation).toBe(false);
      expect(s.window.state).toBe('hidden');
      expect(s.ui.activeWindow).toBeNull();
      expect(s.ui.isBlocking()).toBe(false);
      expect(s.motion.getStats().activeMotions).toBe(0);
    }
  });

  test('repeated core.cancelAll() is idempotent; core.dispose() afterwards is safe', () => {
    const { core, ui, button, window, log } = setup(order);
    button.pointerDown(1, 0, 0);
    window.show();
    core.update(30);
    core.cancelAll();
    const mark = log.length;
    expect(core.cancelAll()).toBe(0);
    expect(log.length).toBe(mark);
    core.dispose();
    expect(log.length).toBe(mark);
    expect(() => ui.createButton({ id: 'later' })).toThrow(/dispose/);
    ui.dispose();
    expect(log.length).toBe(mark);
  });

  test('core.cancelScope() reaches exactly one controller with the same return value in both orders', () => {
    const { core, motion, button, window, log } = setup(order);
    button.pointerDown(1, 0, 0);
    window.show();
    core.update(30);

    expect(core.cancelScope(window.scope)).toBe(1);
    expect(window.state).toBe('hidden');
    expect(button.state).toBe('pressed');
    expect(log).toContain('onHidden:cancelled');

    expect(core.cancelScope(button.scope)).toBe(1);
    expect(button.state).toBe('idle');
    expect(button.progress).toBe(0);
    expect(motion.getStats().activeMotions).toBe(0);

    expect(core.cancelScope('other')).toBe(0);
  });

  test('a direct motion.cancelAll() or motion.dispose() while UiRuntime is alive settles like core.cancelAll()', () => {
    for (const direct of ['cancelAll', 'dispose'] as const) {
      const { motion, ui, button, window, log, flags, tail } = setup(order);
      button.pointerDown(1, 0, 0);
      window.show();
      motion.update(30);
      const mark = log.length;
      if (direct === 'cancelAll') motion.cancelAll();
      else motion.dispose();
      expectSettleCallbacks(tail(mark));
      expect(flags.onShown).toBe(false);
      expect(ui.activeWindow).toBeNull();
      expect(ui.isBlocking()).toBe(false);
      expect(motion.getStats().activeMotions).toBe(0);
      expect(ui.cancelAll()).toBe(0);
    }
  });

  test('core.cancelAll() with a pressed button and an entering window fires each settle callback once', () => {
    const { core, ui, button, window, log, tail, flags, motion } = setup(order);
    button.pointerDown(1, 0, 0);
    window.show();
    core.update(30);
    const mark = log.length;
    expect(core.cancelAll()).toBe(2);
    expectSettleCallbacks(tail(mark));
    expect(flags.onShown).toBe(false);
    expect(ui.activeWindow).toBeNull();
    expect(ui.isBlocking()).toBe(false);
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('core.cancelAll() returns N settled controllers plus M non-UI motions', () => {
    const { core, motion, button, window } = setup(order);
    button.pointerDown(1, 0, 0);
    window.show();
    let value = 0;
    motion.tween({ bindings: [{ get: () => value, set: (v) => { value = v; }, to: 1 }], durationMs: 1000, scope: 'game' });
    core.update(30);
    expect(core.cancelAll()).toBe(3);
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('core.dispose() with a pressed button and a shown window is the cancelAll outcome plus unregistration', () => {
    const reference = setup(order);
    reference.button.pointerDown(1, 0, 0);
    reference.window.show();
    reference.core.update(440);
    const referenceMark = reference.log.length;
    reference.core.cancelAll();
    const expected = reference.tail(referenceMark);

    const { core, ui, button, window, log, tail } = setup(order);
    button.pointerDown(1, 0, 0);
    window.show();
    core.update(440);
    const mark = log.length;
    core.dispose();
    expect([...tail(mark)].sort()).toEqual([...expected].sort());
    expectSettleCallbacks(tail(mark));
    expect(ui.isBlocking()).toBe(false);
    expect(() => ui.createButton({ id: 'later' })).toThrow(/dispose/);
  });

  test('a close() issued from inside onTransition during core.update() starts the leave tween reentrantly', () => {
    const core = new CoreRuntime();
    const motion = new MotionRuntime();
    const ui = new UiRuntime({ motion });
    core.registerRuntime(order === 'ui-first' ? 'ui' : 'motion', order === 'ui-first' ? ui : motion);
    core.registerRuntime(order === 'ui-first' ? 'motion' : 'ui', order === 'ui-first' ? motion : ui);
    const log: string[] = [];
    const window = ui.createWindow({
      id: 'w',
      enterDurationMs: 100,
      leaveDurationMs: 100,
      onTransition: (progress, phase) => {
        if (phase === 'entering' && progress > 0 && progress < 1) window.close('programmatic', () => log.push('onClosed'));
      },
      onShown: () => log.push('onShown'),
      onHidden: (reason) => log.push(`onHidden:${reason}`)
    });
    window.show();
    core.update(50);
    expect(window.state).toBe('leaving');
    core.update(50);
    core.update(50);
    expect(window.state).toBe('hidden');
    expect(log).toEqual(['onHidden:programmatic', 'onClosed']);
    expect(motion.getStats().activeMotions).toBe(0);
  });

  test('UiRuntime is a CoreRuntimeModule and stats aggregate under "ui"', () => {
    const { core, ui } = setup(order);
    const module: CoreRuntimeModule = ui;
    expect(module.update(16)).toBe(false);
    expect(Object.keys(core.getStats()).sort()).toEqual(['motion', 'ui']);
  });
});
