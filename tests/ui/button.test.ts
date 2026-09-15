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
