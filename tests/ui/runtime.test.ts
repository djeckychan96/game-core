import { describe, expect, test } from 'vitest';
import { UiRuntime } from '../../src/ui/UiRuntime';
import { FakeMotionDriver } from './fakeMotionDriver';

function harness() {
  const driver = new FakeMotionDriver();
  const log: string[] = [];
  // a silent error sink: one test throws from onShow on purpose to move the callbackErrors counter
  const ui = new UiRuntime({ motion: driver, onUiError: () => {}, onBlockingChanged: (value) => log.push(`blocking:${value}`) });
  const button = ui.createButton({
    id: 'btn',
    onProgress: (progress) => log.push(`progress:${progress}`),
    onTap: () => log.push('tap'),
    onCancel: (reason) => log.push(`cancel:${reason}`)
  });
  const window = ui.createWindow({
    id: 'win',
    enterDurationMs: 100,
    leaveDurationMs: 100,
    onShown: () => log.push('onShown'),
    onHidden: (reason) => log.push(`onHidden:${reason}`)
  });
  return { driver, log, ui, button, window };
}

describe('UiRuntime registry and stats', () => {
  test('update() returns false and calls nothing on the driver', () => {
    const { driver, ui } = harness();
    expect(ui.update(16)).toBe(false);
    expect(driver.requests).toEqual([]);
  });

  test('counters move through each lifecycle', () => {
    const { driver, ui, button, window } = harness();
    expect(ui.getStats()).toEqual({
      buttons: 1, windows: 1, activeWindowId: null, blocking: false,
      presses: 0, taps: 0, cancelledPresses: 0, shows: 0, rejectedShows: 0,
      closes: 0, vetoedCloses: 0, rejectedCloses: 0, forcedHides: 0, callbackErrors: 0
    });

    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 0, 0, true);
    button.pointerDown(1, 0, 0);
    button.pointerUp(1, 100, 0, true);
    expect(ui.getStats()).toMatchObject({ presses: 2, taps: 1, cancelledPresses: 1 });

    window.show();
    expect(ui.getStats()).toMatchObject({ shows: 1, activeWindowId: 'win', blocking: true });
    expect(window.show()).toBe(false);
    expect(window.close('button')).toBe(true);
    expect(window.close('button')).toBe(false);
    driver.advance(100);
    expect(ui.getStats()).toMatchObject({ rejectedShows: 1, closes: 1, rejectedCloses: 1, activeWindowId: null, blocking: false });

    window.show();
    window.cancel();
    expect(ui.getStats()).toMatchObject({ forcedHides: 1 });

    const vetoed = ui.createWindow({ id: 'veto', onBeforeClose: () => false, onShow: () => { throw new Error('boom'); } });
    vetoed.show();
    vetoed.close('escape');
    expect(ui.getStats()).toMatchObject({ vetoedCloses: 1, callbackErrors: 1, windows: 2 });
  });

  test('duplicate ids throw; create after dispose throws', () => {
    const { ui } = harness();
    expect(() => ui.createButton({ id: 'btn' })).toThrow(/already/);
    expect(() => ui.createWindow({ id: 'win' })).toThrow(/already/);
    ui.dispose();
    expect(() => ui.createButton({ id: 'x' })).toThrow(/dispose/);
    expect(() => ui.createWindow({ id: 'x' })).toThrow(/dispose/);
  });

  test('cancelScope settles only the controller owning that scope', () => {
    const { driver, log, ui, button, window } = harness();
    button.pointerDown(1, 0, 0);
    window.show();
    driver.advance(50);

    expect(ui.cancelScope('something-else')).toBe(0);
    expect(button.state).toBe('pressed');
    expect(window.state).toBe('entering');

    expect(ui.cancelScope(window.scope)).toBe(1);
    expect(window.state).toBe('hidden');
    expect(button.state).toBe('pressed');
    expect(log).toContain('onHidden:cancelled');
    expect(ui.cancelScope(window.scope)).toBe(0);

    expect(ui.cancelScope(button.scope)).toBe(1);
    expect(button.state).toBe('idle');
    expect(button.progress).toBe(0);
    expect(ui.cancelScope(button.scope)).toBe(0);
    expect(driver.activeCount).toBe(0);
  });

  test('cancelAll settles every controller once and is idempotent', () => {
    const { driver, log, ui, button, window } = harness();
    button.pointerDown(1, 0, 0);
    driver.advance(40);
    window.show();
    driver.advance(100);
    const before = log.length;

    expect(ui.cancelAll()).toBe(2);
    expect(log.slice(before)).toEqual(['onHidden:cancelled', 'blocking:false', 'progress:0', 'cancel:programmatic']);
    expect(ui.activeWindow).toBeNull();
    expect(ui.isBlocking()).toBe(false);
    expect(driver.activeCount).toBe(0);

    const after = log.length;
    expect(ui.cancelAll()).toBe(0);
    expect(log.length).toBe(after);
  });

  test('dispose after cancelAll fires nothing further and is idempotent', () => {
    const { log, ui, button, window } = harness();
    button.pointerDown(1, 0, 0);
    window.show();
    ui.cancelAll();
    const before = log.length;
    ui.dispose();
    expect(log.length).toBe(before);
    expect(button.disposed).toBe(true);
    expect(window.disposed).toBe(true);
    expect(ui.getStats()).toMatchObject({ buttons: 0, windows: 0 });
    ui.dispose();
    expect(log.length).toBe(before);
  });

  test('dispose with an active blocking window hides it and clears blocking once', () => {
    const { log, ui, window } = harness();
    window.show();
    ui.dispose();
    expect(log.filter((entry) => entry === 'onHidden:cancelled').length).toBe(1);
    expect(log.filter((entry) => entry === 'blocking:false').length).toBe(1);
    expect(ui.activeWindow).toBeNull();
    expect(ui.isBlocking()).toBe(false);
  });
});
