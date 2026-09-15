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
