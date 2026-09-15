import { describe, expect, test, vi } from 'vitest';
import { UiRuntime } from '../../src/ui/UiRuntime';
import type { ButtonCancelReason, ButtonControllerOptions, UiErrorContext } from '../../src/ui/types';
import { FakeMotionDriver } from './fakeMotionDriver';

function harness(options: Partial<ButtonControllerOptions> = {}) {
  const driver = new FakeMotionDriver();
  const errors: UiErrorContext[] = [];
  const log: string[] = [];
  const ui = new UiRuntime({ motion: driver, onUiError: (_error, context) => errors.push(context) });
  const button = ui.createButton({
    id: 'btn',
    onProgress: (progress) => log.push(`progress:${progress}`),
    onPress: () => log.push('press'),
    onTap: () => log.push('tap'),
    onCancel: (reason) => log.push(`cancel:${reason}`),
    ...options
  });
  const cancels = () => log.filter((entry) => entry.startsWith('cancel:')).map((entry) => entry.slice(7) as ButtonCancelReason);
  const count = (entry: string) => log.filter((item) => item === entry).length;
  return { driver, errors, log, ui, button, cancels, count };
}

describe('ButtonController basic lifecycle', () => {
  test('normal press then release reaches 1 then 0 and fires onPress and onTap once', () => {
    const { driver, button, log, count } = harness();

    expect(button.pointerDown(1, 0, 0)).toBe(true);
    expect(button.state).toBe('pressed');
    expect(count('press')).toBe(1);
    driver.advance(80);
    expect(button.progress).toBe(1);

    expect(button.pointerUp(1, 0, 0, true)).toBe(true);
    expect(button.state).toBe('idle');
    driver.advance(80);
    expect(button.progress).toBe(0);
    expect(count('tap')).toBe(1);
    expect(log.some((entry) => entry.startsWith('cancel:'))).toBe(false);
  });

  test('a tap within the threshold fires onTap and never onCancel', () => {
    const { button, cancels, count } = harness();
    button.pointerDown(1, 10, 10);
    button.pointerUp(1, 12, 12, true);
    expect(count('tap')).toBe(1);
    expect(cancels()).toEqual([]);
  });

  test("pointerUp outside within the threshold cancels with 'outside'", () => {
    const { button, cancels, count } = harness();
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 5, 5, false);
    expect(cancels()).toEqual(['outside']);
    expect(count('tap')).toBe(0);
  });

  test('pointerCancel reports its reason', () => {
    const { button, cancels } = harness();
    button.pointerDown(1, 0, 0);
    expect(button.pointerCancel(1)).toBe(true);
    button.pointerDown(1, 0, 0);
    expect(button.pointerCancel(1, 'leave')).toBe(true);
    expect(cancels()).toEqual(['pointerCancel', 'leave']);
  });

  test('a second pointer never steals a press; only the owner can release', () => {
    const { button, count } = harness();
    button.pointerDown(1, 0, 0);
    expect(button.pointerDown(2, 0, 0)).toBe(false);
    expect(button.pointerMove(2, 100, 100)).toBe(false);
    expect(button.pointerUp(2, 0, 0, true)).toBe(false);
    expect(button.state).toBe('pressed');
    expect(button.pointerUp(1, 0, 0, true)).toBe(true);
    expect(count('tap')).toBe(1);
  });

  test('disabled buttons ignore presses; disabling during a press cancels it', () => {
    const disabled = harness({ enabled: false });
    expect(disabled.button.state).toBe('disabled');
    expect(disabled.button.enabled).toBe(false);
    expect(disabled.button.pointerDown(1, 0, 0)).toBe(false);

    const { driver, button, cancels } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.setEnabled(false);
    expect(cancels()).toEqual(['disabled']);
    expect(button.state).toBe('disabled');
    driver.advance(80);
    expect(button.progress).toBe(0);
    button.setEnabled(true);
    expect(button.state).toBe('idle');
    expect(button.pointerDown(1, 0, 0)).toBe(true);
  });

  test('instant durations never call the driver and still report terminal progress', () => {
    const { driver, button, log } = harness({ pressDurationMs: 0, releaseDurationMs: 0 });
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 0, 0, true);
    expect(driver.requests.length).toBe(0);
    expect(log.filter((entry) => entry.startsWith('progress:'))).toEqual(['progress:1', 'progress:0']);
  });

  test('pointer methods on a disposed controller return false', () => {
    const { button } = harness();
    button.dispose();
    expect(button.disposed).toBe(true);
    expect(button.pointerDown(1, 0, 0)).toBe(false);
    expect(button.pointerMove(1, 0, 0)).toBe(false);
    expect(button.pointerUp(1, 0, 0, true)).toBe(false);
    expect(button.pointerCancel(1)).toBe(false);
    expect(button.cancel()).toBe(false);
  });

  test('duplicate ids and invalid thresholds throw at creation', () => {
    const { ui } = harness();
    expect(() => ui.createButton({ id: 'btn' })).toThrow(/already/i);
    expect(() => ui.createButton({ id: 'other', tapThreshold: Number.NaN })).toThrow(RangeError);
    expect(() => ui.createButton({ id: 'other', tapThreshold: -1 })).toThrow(RangeError);
  });

  test('scope and defaults are exposed', () => {
    const { button } = harness();
    expect(button.scope).toBe('ui:button:btn');
    expect(button.tapThreshold).toBe(24);
    expect(button.progress).toBe(0);
    expect(button.enabled).toBe(true);
  });

  test('the default error handler is a console.error fallback', () => {
    const driver = new FakeMotionDriver();
    const ui = new UiRuntime({ motion: driver });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const button = ui.createButton({ id: 'b', onPress: () => { throw new Error('boom'); } });
    button.pointerDown(1, 0, 0);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('ButtonController swipe, final-distance rule and threshold', () => {
  test('movement beyond the threshold swipes; a later pointerUp returns false', () => {
    const { button, cancels } = harness();
    button.pointerDown(1, 0, 0);
    expect(button.pointerMove(1, 30, 0)).toBe(true);
    expect(cancels()).toEqual(['swipe']);
    expect(button.state).toBe('idle');
    expect(button.pointerUp(1, 30, 0, true)).toBe(false);
  });

  test('movement within the threshold keeps the press', () => {
    const { button } = harness();
    button.pointerDown(1, 0, 0);
    button.pointerMove(1, 10, 10);
    expect(button.state).toBe('pressed');
  });

  test('a fast flick without any pointerMove is still a swipe on release', () => {
    const { button, cancels, count } = harness();
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 100, 0, true);
    expect(cancels()).toEqual(['swipe']);
    expect(count('tap')).toBe(0);
  });

  test('a release within the threshold is a tap; swipe takes precedence over outside', () => {
    const { button, cancels, count } = harness();
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 10, 0, true);
    expect(count('tap')).toBe(1);
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 100, 0, false);
    expect(cancels()).toEqual(['swipe']);
  });

  test('setTapThreshold takes effect for the next check, including a press in progress', () => {
    const { button } = harness();
    button.pointerDown(1, 0, 0);
    button.setTapThreshold(60);
    expect(button.tapThreshold).toBe(60);
    button.pointerMove(1, 40, 0);
    expect(button.state).toBe('pressed');
    button.pointerMove(1, 70, 0);
    expect(button.state).toBe('idle');
  });

  test('an invalid threshold throws RangeError and keeps the old value; 0 is valid', () => {
    const { button, cancels } = harness();
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => button.setTapThreshold(bad)).toThrow(RangeError);
      expect(button.tapThreshold).toBe(24);
    }
    button.setTapThreshold(0);
    button.pointerDown(1, 0, 0);
    button.pointerMove(1, 1, 0);
    expect(cancels()).toEqual(['swipe']);
  });

  test('the gorodki resize formula changes the outcome of an identical gesture', () => {
    const { button, cancels, count } = harness();
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 30, 0, true);
    expect(cancels()).toEqual(['swipe']);
    button.setTapThreshold(Math.max(24, Math.min(1280, 800) * 0.06)); // 48 on a desktop viewport
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 30, 0, true);
    expect(count('tap')).toBe(1);
  });
});

describe('ButtonController re-press and baseline', () => {
  test('re-press during release continues from the current progress with no jump', () => {
    const { driver, button, log } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    driver.advance(40);
    expect(button.progress).toBe(0.5);

    button.pointerDown(1, 0, 0);
    const before = log.length;
    driver.advance(1);
    const first = Number(log[before]?.slice('progress:'.length));
    expect(first).toBeGreaterThan(0.5);
    expect(first).toBeLessThan(0.51);
    driver.advance(79);
    expect(button.progress).toBe(1);
  });

  test('the baseline never compounds over ten press/release cycles', () => {
    const { driver, button } = harness();
    for (let i = 0; i < 10; i++) {
      button.pointerDown(1, 0, 0);
      driver.advance(80);
      expect(button.progress).toBe(1);
      button.pointerUp(1, 0, 0, true);
      driver.advance(80);
      expect(button.progress).toBe(0);
    }
  });

  test('a release interrupted by cancel() snaps to 0 with onProgress(0) and no onCancel', () => {
    const { driver, button, log, cancels } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    driver.advance(20);
    expect(button.cancel()).toBe(true);
    expect(button.progress).toBe(0);
    expect(log[log.length - 1]).toBe('progress:0');
    expect(cancels()).toEqual([]);
    expect(driver.activeCount).toBe(0);
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    expect(button.progress).toBe(1);
  });

  test('bindings are preallocated and reused; one tween per animated phase', () => {
    const { driver, button } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    driver.advance(80);
    expect(driver.requests.length).toBe(2);
    expect(driver.bindingArrays[0]).toBe(driver.bindingArrays[1]);
    expect(driver.bindingArrays[0]?.length).toBe(1);
  });
});

describe('ButtonController settle, reentrancy and error isolation', () => {
  test("cancel() while pressed reports onProgress(0) before onCancel('programmatic')", () => {
    const { driver, button, log } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(40);
    const before = log.length;
    expect(button.cancel()).toBe(true);
    expect(log.slice(before)).toEqual(['progress:0', 'cancel:programmatic']);
    expect(button.state).toBe('idle');
    expect(driver.activeCount).toBe(0);
  });

  test('cancel() on an idle, settled button returns false and records nothing', () => {
    const { button, log } = harness();
    expect(button.cancel()).toBe(false);
    expect(log).toEqual([]);
  });

  test('callbacks that throw are reported with the right phase and the lifecycle completes', () => {
    const throwing = () => { throw new Error('boom'); };
    const { driver, button, errors, ui } = harness({ onProgress: throwing, onPress: throwing, onTap: throwing, onCancel: throwing });
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    expect(button.progress).toBe(1);
    button.pointerUp(1, 0, 0, true);
    driver.advance(80);
    expect(button.progress).toBe(0);
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 100, 0, true);
    driver.advance(80);
    const phases = errors.map((context) => context.phase);
    expect(phases).toContain('onProgress');
    expect(phases).toContain('onPress');
    expect(phases).toContain('onTap');
    expect(phases).toContain('onCancel');
    expect(errors.every((context) => context.kind === 'button' && context.id === 'btn')).toBe(true);
    expect(ui.getStats().callbackErrors).toBe(errors.length);
    expect(driver.activeCount).toBe(0);
  });

  test('dispose() from inside onPress settles the press once and fires nothing further', () => {
    const { button, log } = harness({ onPress: () => { log.push('press'); button.dispose(); } });
    expect(button.pointerDown(1, 0, 0)).toBe(true);
    expect(button.disposed).toBe(true);
    expect(button.pointerUp(1, 0, 0, true)).toBe(false);
    // the settle of the press in progress is the only thing that follows; no tap, no second cancel
    expect(log).toEqual(['press', 'cancel:programmatic']);
  });

  test('dispose() from inside onTap and from inside onCancel fires nothing further', () => {
    const tapCase = harness({ onTap: () => { tapCase.log.push('tap'); tapCase.button.dispose(); } });
    tapCase.button.pointerDown(1, 0, 0);
    tapCase.button.pointerUp(1, 0, 0, true);
    expect(tapCase.button.disposed).toBe(true);
    expect(tapCase.count('tap')).toBe(1);
    expect(tapCase.driver.activeCount).toBe(0);

    const cancelCase = harness({ onCancel: (reason) => { cancelCase.log.push(`cancel:${reason}`); cancelCase.button.dispose(); } });
    cancelCase.button.pointerDown(1, 0, 0);
    cancelCase.button.pointerUp(1, 100, 0, true);
    expect(cancelCase.button.disposed).toBe(true);
    expect(cancelCase.cancels()).toEqual(['swipe']);
    expect(cancelCase.driver.activeCount).toBe(0);
  });

  test('with an instant release, dispose() from inside onProgress(0) prevents onTap', () => {
    const { driver, button, count } = harness({
      releaseDurationMs: 0,
      onProgress: (progress) => { if (progress === 0) button.dispose(); }
    });
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    expect(button.disposed).toBe(true);
    expect(count('tap')).toBe(0);
  });

  test('cancel() from inside onTap settles to 0 and a subsequent press works', () => {
    const { driver, button } = harness({ onTap: () => { button.cancel(); } });
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    expect(button.progress).toBe(0);
    expect(driver.activeCount).toBe(0);
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    expect(button.progress).toBe(1);
  });

  test('pointerDown from inside onCancel re-presses the button', () => {
    const { button } = harness({ onCancel: () => { button.pointerDown(2, 0, 0); } });
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 100, 0, true);
    expect(button.state).toBe('pressed');
    expect(button.pointerUp(1, 0, 0, true)).toBe(false);
    expect(button.pointerUp(2, 0, 0, true)).toBe(true);
  });

  test('a cancellation delivered through the driver settles like cancel()', () => {
    const { driver, button, log, errors } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(40);
    const before = log.length;
    expect(driver.cancelAll()).toBe(1);
    expect(log.slice(before)).toEqual(['progress:0', 'cancel:programmatic']);
    expect(button.state).toBe('idle');
    expect(button.progress).toBe(0);
    expect(errors).toEqual([]);
    expect(driver.activeCount).toBe(0);

    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    driver.advance(40);
    const beforeRelease = log.length;
    driver.cancelAll();
    expect(log.slice(beforeRelease)).toEqual(['progress:0']);
  });

  test('a stale completion replayed after a re-press is ignored', () => {
    const { driver, button, log } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    driver.advance(40);
    button.pointerDown(1, 0, 0);
    const state = button.state;
    const progress = button.progress;
    const before = log.length;
    driver.replayComplete(0);
    driver.replayComplete(1);
    expect(button.state).toBe(state);
    expect(button.progress).toBe(progress);
    expect(log.length).toBe(before);
  });

  test('dispose() during a press settles once and frees the id', () => {
    const { driver, button, log, ui } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(40);
    const before = log.length;
    button.dispose();
    expect(log.slice(before)).toEqual(['progress:0', 'cancel:programmatic']);
    expect(driver.activeCount).toBe(0);
    expect(button.pointerDown(1, 0, 0)).toBe(false);
    expect(ui.getStats().buttons).toBe(0);
    button.dispose();
    expect(log.length).toBe(before + 2);
    expect(() => ui.createButton({ id: 'btn' })).not.toThrow();
  });
});
