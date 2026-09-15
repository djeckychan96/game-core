import { describe, expect, test } from 'vitest';
import { UiRuntime } from '../../src/ui/UiRuntime';
import type { UiErrorContext, WindowCloseReason, WindowControllerOptions } from '../../src/ui/types';
import { FakeMotionDriver } from './fakeMotionDriver';

interface Params {
  title: string;
}

function harness(options: Partial<WindowControllerOptions<Params>> = {}, id = 'win') {
  const driver = new FakeMotionDriver();
  const errors: UiErrorContext[] = [];
  const log: string[] = [];
  const blocking: boolean[] = [];
  const ui = new UiRuntime({
    motion: driver,
    onUiError: (_error, context) => errors.push(context),
    onBlockingChanged: (value) => blocking.push(value)
  });
  const window = ui.createWindow<Params>({
    id,
    onShow: (params) => log.push(`onShow:${params.title}`),
    onTransition: (progress, phase) => log.push(`onTransition:${progress}:${phase}`),
    onShown: () => log.push('onShown'),
    onBeforeClose: (intent) => { log.push(`onBeforeClose:${intent.reason}:${intent.state}`); return undefined; },
    onHidden: (reason) => log.push(`onHidden:${reason}`),
    ...options
  });
  const closed = () => log.push('onClosed');
  return { driver, errors, log, blocking, ui, window, closed };
}

const params: Params = { title: 'result' };

describe('WindowController lifecycle', () => {
  test('instant show and close run the full callback sequence synchronously without the driver', () => {
    const { driver, window, log, closed } = harness();

    expect(window.show(params)).toBe(true);
    expect(window.state).toBe('shown');
    expect(log).toEqual(['onShow:result', 'onTransition:0:entering', 'onTransition:1:entering', 'onShown']);

    expect(window.close('button', closed)).toBe(true);
    expect(window.state).toBe('hidden');
    expect(log.slice(4)).toEqual([
      'onBeforeClose:button:shown',
      'onTransition:1:leaving',
      'onTransition:0:leaving',
      'onHidden:button',
      'onClosed'
    ]);
    expect(driver.requests.length).toBe(0);
  });

  test('a tweened show reaches shown only when the tween completes; a tweened close reaches hidden then runs the continuation', () => {
    const { driver, window, log, closed } = harness({ enterDurationMs: 440, leaveDurationMs: 200 });

    window.show(params);
    expect(window.state).toBe('entering');
    expect(log).toEqual(['onShow:result', 'onTransition:0:entering']);
    driver.advance(220);
    expect(window.state).toBe('entering');
    expect(window.progress).toBe(0.5);
    driver.advance(220);
    expect(window.progress).toBe(1);
    expect(window.state).toBe('shown');
    expect(log[log.length - 1]).toBe('onShown');

    window.close('escape', closed);
    expect(window.state).toBe('leaving');
    expect(log.slice(-2)).toEqual(['onBeforeClose:escape:shown', 'onTransition:1:leaving']);
    driver.advance(200);
    expect(window.state).toBe('hidden');
    expect(window.progress).toBe(0);
    expect(log.slice(-3)).toEqual(['onTransition:0:leaving', 'onHidden:escape', 'onClosed']);
    expect(driver.activeCount).toBe(0);
  });

  test('show(params) passes the exact params object to onShow', () => {
    let received: Params | null = null;
    const { window } = harness({ onShow: (value) => { received = value; } });
    window.show(params);
    expect(received).toBe(params);
  });

  test('every close reason reaches the intent and onHidden', () => {
    const reasons: WindowCloseReason[] = ['button', 'background', 'escape', 'back', 'programmatic'];
    for (const reason of reasons) {
      const { window, log } = harness();
      window.show(params);
      window.close(reason);
      expect(log).toContain(`onBeforeClose:${reason}:shown`);
      expect(log).toContain(`onHidden:${reason}`);
    }
  });

  test('close without a continuation completes; a duplicate close keeps the first continuation', () => {
    const { driver, window, log, closed, ui } = harness({ leaveDurationMs: 100 });
    window.show(params);
    expect(window.close('button')).toBe(true);
    driver.advance(100);
    expect(window.state).toBe('hidden');
    expect(log).not.toContain('onClosed');

    window.show(params);
    expect(window.close('button', closed)).toBe(true);
    expect(window.close('background', () => log.push('second'))).toBe(false);
    expect(ui.getStats().rejectedCloses).toBe(1);
    driver.advance(100);
    expect(log.filter((entry) => entry === 'onClosed').length).toBe(1);
    expect(log).not.toContain('second');
  });

  test('duplicate close when hidden returns false', () => {
    const { window, ui } = harness();
    expect(window.close('button')).toBe(false);
    expect(ui.getStats().rejectedCloses).toBe(1);
  });

  test('show() during entering, shown, or leaving returns false and does not re-apply params', () => {
    const { driver, window, log, ui } = harness({ enterDurationMs: 100, leaveDurationMs: 100 });
    window.show(params);
    expect(window.show({ title: 'again' })).toBe(false);
    driver.advance(100);
    expect(window.show({ title: 'again' })).toBe(false);
    window.close('button');
    expect(window.show({ title: 'again' })).toBe(false);
    expect(log.filter((entry) => entry.startsWith('onShow:'))).toEqual(['onShow:result']);
    expect(ui.getStats().rejectedShows).toBe(3);
  });

  test('close during entering starts leaving from the current progress and onShown never fires', () => {
    const { driver, window, log } = harness({ enterDurationMs: 440, leaveDurationMs: 100 });
    window.show(params);
    driver.advance(100);
    const progress = window.progress;
    expect(window.close('button')).toBe(true);
    expect(log).toContain('onBeforeClose:button:entering');
    expect(log).toContain(`onTransition:${progress}:leaving`);
    driver.advance(100);
    expect(window.state).toBe('hidden');
    expect(log).not.toContain('onShown');
  });
});

describe('WindowController one active modal', () => {
  test('a second window cannot show while the first is active; it can from the continuation', () => {
    const driver = new FakeMotionDriver();
    const ui = new UiRuntime({ motion: driver });
    const a = ui.createWindow({ id: 'a' });
    const b = ui.createWindow({ id: 'b' });

    expect(ui.activeWindow).toBeNull();
    expect(a.show()).toBe(true);
    expect(ui.activeWindow).toBe(a);
    expect(b.show()).toBe(false);
    expect(ui.getStats().rejectedShows).toBe(1);

    let shownFromContinuation = false;
    a.close('button', () => { shownFromContinuation = b.show(); });
    expect(shownFromContinuation).toBe(true);
    expect(b.state).toBe('shown');
    expect(ui.activeWindow).toBe(b);
    b.close('programmatic');
    expect(ui.activeWindow).toBeNull();
  });

  test('show(B) and show(A) again from inside A.onHidden succeed', () => {
    const driver = new FakeMotionDriver();
    const ui = new UiRuntime({ motion: driver });
    const b = ui.createWindow({ id: 'b' });
    const a = ui.createWindow({ id: 'a', onHidden: () => { expect(b.show()).toBe(true); } });
    a.show();
    a.close('button');
    expect(b.state).toBe('shown');
    expect(ui.activeWindow).toBe(b);
    b.close('button');

    let reshown = false;
    const c = ui.createWindow({ id: 'c', onHidden: () => { if (!reshown) { reshown = true; expect(c.show()).toBe(true); } } });
    c.show();
    c.close('button');
    expect(c.state).toBe('shown');
    expect(ui.activeWindow).toBe(c);
  });

  test('duplicate window ids throw', () => {
    const { ui } = harness();
    expect(() => ui.createWindow({ id: 'win' })).toThrow(/already/i);
  });
});

describe('WindowController veto and close-intent reentrancy', () => {
  test('a veto keeps the state, counts, returns false and never stores the continuation', () => {
    const { window, log, closed, ui } = harness({ onBeforeClose: () => false });
    window.show(params);
    expect(window.close('escape', closed)).toBe(false);
    expect(window.state).toBe('shown');
    expect(ui.getStats().vetoedCloses).toBe(1);
    expect(log).not.toContain('onClosed');
    expect(log).not.toContain('onHidden:escape');
  });

  test('a veto during entering lets the entrance reach shown', () => {
    const { driver, window, log } = harness({ enterDurationMs: 100, onBeforeClose: () => false });
    window.show(params);
    driver.advance(50);
    expect(window.close('button')).toBe(false);
    driver.advance(50);
    expect(window.state).toBe('shown');
    expect(log).toContain('onShown');
  });

  test('a throwing onBeforeClose is reported and does not veto', () => {
    const { window, errors, log } = harness({ onBeforeClose: () => { throw new Error('boom'); } });
    window.show(params);
    expect(window.close('button')).toBe(true);
    expect(window.state).toBe('hidden');
    expect(errors.map((context) => context.phase)).toEqual(['onBeforeClose']);
    expect(log).toContain('onHidden:button');
  });

  test('a nested close() inside onBeforeClose returns false, does not recurse, and the outer decides', () => {
    let nestedResult: boolean | null = null;
    let calls = 0;
    const proceed = harness({
      onBeforeClose: () => { calls += 1; nestedResult = proceed.window.close('background'); return undefined; }
    });
    proceed.window.show(params);
    expect(proceed.window.close('button')).toBe(true);
    expect(nestedResult).toBe(false);
    expect(calls).toBe(1);
    expect(proceed.ui.getStats().rejectedCloses).toBe(1);
    expect(proceed.window.state).toBe('hidden');

    const veto = harness({
      onBeforeClose: () => { veto.window.close('background'); return false; }
    });
    veto.window.show(params);
    expect(veto.window.close('button')).toBe(false);
    expect(veto.window.state).toBe('shown');
  });

  test('dispose() or cancel() inside onBeforeClose makes the outer close return false with no leaving callbacks', () => {
    const disposeCase = harness({ onBeforeClose: () => { disposeCase.window.dispose(); return undefined; } });
    disposeCase.window.show(params);
    const before = disposeCase.log.length;
    expect(disposeCase.window.close('button', disposeCase.closed)).toBe(false);
    expect(disposeCase.log.slice(before)).toEqual(['onHidden:cancelled']);
    expect(disposeCase.window.disposed).toBe(true);

    const cancelCase = harness({ onBeforeClose: () => { cancelCase.window.cancel(); return undefined; } });
    cancelCase.window.show(params);
    const beforeCancel = cancelCase.log.length;
    expect(cancelCase.window.close('button', cancelCase.closed)).toBe(false);
    expect(cancelCase.log.slice(beforeCancel)).toEqual(['onHidden:cancelled']);
    expect(cancelCase.window.state).toBe('hidden');
    cancelCase.window.show(params);
    cancelCase.window.close('button');
    expect(cancelCase.log).not.toContain('onClosed');
  });
});

describe('WindowController reentrancy from lifecycle callbacks', () => {
  test('close() inside onShow: no enter tween, full close sequence, show() still returns true', () => {
    const { driver, window, log, closed } = harness({
      enterDurationMs: 440,
      onShow: () => { log.push('onShow'); window.close('button', closed); }
    });
    expect(window.show(params)).toBe(true);
    expect(driver.requests.length).toBe(0);
    expect(log).toEqual(['onShow', 'onBeforeClose:button:entering', 'onTransition:0:leaving', 'onHidden:button', 'onClosed']);
    expect(window.state).toBe('hidden');
  });

  test('dispose() inside onShow: show() returns true, only onHidden(cancelled) follows', () => {
    const { driver, window, log, ui } = harness({
      enterDurationMs: 440,
      onShow: () => { log.push('onShow'); window.dispose(); }
    });
    expect(window.show(params)).toBe(true);
    expect(driver.requests.length).toBe(0);
    expect(log).toEqual(['onShow', 'onHidden:cancelled']);
    expect(ui.activeWindow).toBeNull();
    expect(window.disposed).toBe(true);
  });

  test('close() inside an entering onTransition cancels the enter tween; onShown never fires', () => {
    const { driver, window, log } = harness({
      enterDurationMs: 100,
      leaveDurationMs: 100,
      onTransition: (progress, phase) => {
        log.push(`onTransition:${progress}:${phase}`);
        if (phase === 'entering' && progress > 0 && progress < 1) window.close('programmatic');
      }
    });
    window.show(params);
    driver.advance(50);
    expect(window.state).toBe('leaving');
    driver.advance(100);
    expect(window.state).toBe('hidden');
    expect(log).not.toContain('onShown');
    expect(driver.activeCount).toBe(0);
  });

  test('dispose() inside onTransition fires onHidden(cancelled) and nothing further', () => {
    const { driver, window, log } = harness({
      enterDurationMs: 100,
      onTransition: (progress, phase) => {
        log.push(`onTransition:${progress}:${phase}`);
        if (progress > 0 && progress < 1) window.dispose();
      }
    });
    window.show(params);
    driver.advance(50);
    expect(log.slice(-2)).toEqual(['onTransition:0.5:entering', 'onHidden:cancelled']);
    driver.advance(50);
    expect(log[log.length - 1]).toBe('onHidden:cancelled');
    expect(window.disposed).toBe(true);
  });

  test('close() and dispose() inside onShown proceed normally', () => {
    const closeCase = harness({ onShown: () => { closeCase.log.push('onShown'); closeCase.window.close('button', closeCase.closed); } });
    closeCase.window.show(params);
    expect(closeCase.window.state).toBe('hidden');
    expect(closeCase.log.slice(-2)).toEqual(['onHidden:button', 'onClosed']);

    const disposeCase = harness({ onShown: () => { disposeCase.window.dispose(); } });
    disposeCase.window.show(params);
    expect(disposeCase.window.disposed).toBe(true);
    expect(disposeCase.log[disposeCase.log.length - 1]).toBe('onHidden:cancelled');
  });

  test('a stale enter completion replayed after a reentrant close never restores shown', () => {
    const { driver, window, log } = harness({ enterDurationMs: 440 });
    window.show(params);
    driver.advance(100);
    window.close('button');
    expect(window.state).toBe('hidden');
    const before = log.length;
    driver.replayComplete(0);
    expect(window.state).toBe('hidden');
    expect(log.length).toBe(before);
    expect(log).not.toContain('onShown');
  });

  test('dispose() inside onHidden of a completing close drops the continuation', () => {
    const { window, log, closed } = harness({ onHidden: (reason) => { log.push(`onHidden:${reason}`); window.dispose(); } });
    window.show(params);
    window.close('button', closed);
    expect(window.disposed).toBe(true);
    expect(log).not.toContain('onClosed');
  });
});

describe('WindowController force-hide and dispose', () => {
  test('cancel() during entering, shown, and leaving force-hides without onBeforeClose, onShown or onClosed', () => {
    const entering = harness({ enterDurationMs: 100 });
    entering.window.show(params);
    entering.driver.advance(50);
    expect(entering.window.cancel()).toBe(true);
    expect(entering.window.state).toBe('hidden');
    expect(entering.log.slice(-1)).toEqual(['onHidden:cancelled']);
    expect(entering.log.some((entry) => entry.startsWith('onBeforeClose'))).toBe(false);
    expect(entering.log).not.toContain('onShown');
    expect(entering.driver.activeCount).toBe(0);
    expect(entering.ui.getStats().forcedHides).toBe(1);

    const shown = harness();
    shown.window.show(params);
    expect(shown.window.cancel()).toBe(true);
    expect(shown.window.state).toBe('hidden');
    expect(shown.log.slice(-1)).toEqual(['onHidden:cancelled']);

    const leaving = harness({ leaveDurationMs: 100 });
    leaving.window.show(params);
    leaving.window.close('button', leaving.closed);
    leaving.driver.advance(50);
    expect(leaving.window.cancel()).toBe(true);
    leaving.driver.advance(100);
    expect(leaving.log).not.toContain('onClosed');
    expect(leaving.log.slice(-1)).toEqual(['onHidden:cancelled']);
    expect(leaving.driver.activeCount).toBe(0);
  });

  test('cancel() when hidden returns false and fires nothing', () => {
    const { window, log } = harness();
    expect(window.cancel()).toBe(false);
    expect(log).toEqual([]);
  });

  test('dispose() while active behaves as cancel() then unregisters', () => {
    const { window, log, ui, closed } = harness({ leaveDurationMs: 100 });
    window.show(params);
    window.close('button', closed);
    window.dispose();
    expect(log.filter((entry) => entry === 'onHidden:cancelled').length).toBe(1);
    expect(log).not.toContain('onClosed');
    expect(ui.activeWindow).toBeNull();
    expect(ui.getStats().windows).toBe(0);
    expect(window.show(params)).toBe(false);
    window.dispose();
    expect(() => ui.createWindow({ id: 'win' })).not.toThrow();
  });

  test('callbacks that throw are reported with the right phase and the lifecycle completes', () => {
    const throwing = () => { throw new Error('boom'); };
    const { window, errors, ui } = harness({
      onShow: throwing, onTransition: throwing, onShown: throwing, onHidden: throwing
    });
    window.show(params);
    expect(window.state).toBe('shown');
    window.close('button', throwing);
    expect(window.state).toBe('hidden');
    expect(ui.activeWindow).toBeNull();
    const phases = errors.map((context) => context.phase);
    for (const phase of ['onShow', 'onTransition', 'onShown', 'onHidden', 'onClosed']) expect(phases).toContain(phase);
    expect(errors.every((context) => context.kind === 'window' && context.id === 'win')).toBe(true);
    expect(ui.getStats().callbackErrors).toBe(errors.length);
  });

  test('a cancellation delivered through the driver force-hides and never runs the continuation', () => {
    const entering = harness({ enterDurationMs: 100 });
    entering.window.show(params);
    entering.driver.advance(50);
    expect(entering.driver.cancelAll()).toBe(1);
    expect(entering.window.state).toBe('hidden');
    expect(entering.log.slice(-1)).toEqual(['onHidden:cancelled']);
    expect(entering.log).not.toContain('onShown');
    expect(entering.errors).toEqual([]);
    expect(entering.ui.activeWindow).toBeNull();

    const leaving = harness({ leaveDurationMs: 100 });
    leaving.window.show(params);
    leaving.window.close('button', leaving.closed);
    leaving.driver.advance(50);
    leaving.driver.cancelAll();
    expect(leaving.window.state).toBe('hidden');
    expect(leaving.log).not.toContain('onClosed');
    expect(leaving.log.slice(-1)).toEqual(['onHidden:cancelled']);
  });
});
