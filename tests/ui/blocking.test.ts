import { describe, expect, test } from 'vitest';
import { UiRuntime } from '../../src/ui/UiRuntime';
import type { UiErrorContext, WindowController, WindowControllerOptions } from '../../src/ui/types';
import { FakeMotionDriver } from './fakeMotionDriver';

function harness(onBlockingChanged?: (blocking: boolean) => void) {
  const driver = new FakeMotionDriver();
  const errors: UiErrorContext[] = [];
  const recording: boolean[] = [];
  const ui = new UiRuntime({
    motion: driver,
    onUiError: (_error, context) => errors.push(context),
    onBlockingChanged: (value) => {
      recording.push(value);
      onBlockingChanged?.(value);
    }
  });
  const makeWindow = (id: string, options: Partial<WindowControllerOptions> = {}) => ui.createWindow({ id, ...options });
  return { driver, errors, recording, ui, makeWindow };
}

describe('blocking state', () => {
  test('false with no window, true from show(), false after the close completes', () => {
    const { ui, recording, makeWindow } = harness();
    const a = makeWindow('a');
    expect(ui.isBlocking()).toBe(false);
    a.show();
    expect(ui.isBlocking()).toBe(true);
    a.close('button');
    expect(ui.isBlocking()).toBe(false);
    expect(recording).toEqual([true, false]);
  });

  test('is published after onShow and withdrawn after onHidden and onClosed', () => {
    const { ui, makeWindow } = harness();
    const seen: string[] = [];
    const a = makeWindow('a', {
      onShow: () => seen.push(`onShow:${ui.isBlocking()}`),
      onShown: () => seen.push(`onShown:${ui.isBlocking()}`),
      onHidden: () => seen.push(`onHidden:${ui.isBlocking()}`)
    });
    a.show();
    a.close('button', () => seen.push(`onClosed:${ui.isBlocking()}`));
    seen.push(`after:${ui.isBlocking()}`);
    expect(seen).toEqual(['onShow:false', 'onShown:true', 'onHidden:true', 'onClosed:true', 'after:false']);
  });

  test('hand-over blocking → blocking through onClosed publishes no false/true flicker', () => {
    const { ui, recording, makeWindow } = harness();
    const a = makeWindow('a');
    const b = makeWindow('b');
    a.show();
    a.close('button', () => { expect(b.show()).toBe(true); });
    expect(recording).toEqual([true]);
    expect(ui.isBlocking()).toBe(true);
    b.close('button');
    expect(recording).toEqual([true, false]);
  });

  test('hand-over blocking → blocking through onHidden publishes no false/true flicker', () => {
    const { ui, recording, makeWindow } = harness();
    const b = makeWindow('b');
    const a = makeWindow('a', { onHidden: () => { expect(b.show()).toBe(true); } });
    a.show();
    a.close('button');
    expect(recording).toEqual([true]);
    expect(ui.isBlocking()).toBe(true);
    b.close('button');
    expect(recording).toEqual([true, false]);
  });

  test('hand-over blocking → non-blocking publishes false exactly once, inside B.show() after B.onShow', () => {
    const { ui, recording, makeWindow } = harness();
    const seen: string[] = [];
    const b = makeWindow('b', {
      blocksGameplay: false,
      onShow: () => seen.push(`b.onShow:${ui.isBlocking()}`),
      onShown: () => seen.push(`b.onShown:${ui.isBlocking()}`)
    });
    const a = makeWindow('a');
    a.show();
    a.close('button', () => { b.show(); });
    expect(recording).toEqual([true, false]);
    expect(seen).toEqual(['b.onShow:true', 'b.onShown:false']);
    b.close('button');
    expect(recording).toEqual([true, false]);
  });

  test('re-showing A from inside A.onHidden publishes nothing', () => {
    const { recording, makeWindow } = harness();
    let reshown = false;
    const a = makeWindow('a', { onHidden: () => { if (!reshown) { reshown = true; a.show(); } } });
    a.show();
    a.close('button');
    expect(a.state).toBe('shown');
    expect(recording).toEqual([true]);
  });

  test('a non-blocking window never changes blocking', () => {
    const { ui, recording, makeWindow } = harness();
    const a = makeWindow('a', { blocksGameplay: false });
    a.show();
    expect(ui.isBlocking()).toBe(false);
    a.close('button');
    expect(recording).toEqual([]);
  });

  test('cancel(), dispose(), ui.cancelAll() and ui.dispose() each end blocking exactly once', () => {
    for (const teardown of ['cancel', 'dispose', 'cancelAll', 'uiDispose'] as const) {
      const { ui, recording, makeWindow } = harness();
      const a = makeWindow('a');
      a.show();
      if (teardown === 'cancel') a.cancel();
      else if (teardown === 'dispose') a.dispose();
      else if (teardown === 'cancelAll') ui.cancelAll();
      else ui.dispose();
      expect(ui.isBlocking()).toBe(false);
      expect(recording).toEqual([true, false]);
    }
  });

  test('a throwing onBlockingChanged is reported as runtime and cannot corrupt the value', () => {
    const { ui, errors, makeWindow } = harness(() => { throw new Error('boom'); });
    const a = makeWindow('a');
    a.show();
    expect(a.state).toBe('shown');
    expect(ui.isBlocking()).toBe(true);
    expect(errors).toEqual([{ kind: 'runtime', id: 'ui', phase: 'onBlockingChanged' }]);
    a.close('button');
    expect(ui.isBlocking()).toBe(false);
    expect(errors.length).toBe(2);
  });

  test('an onBlockingChanged(true) that closes the window still ends with a single false', () => {
    let a: WindowController;
    const { ui, recording, makeWindow } = harness((blocking) => { if (blocking) a.close('programmatic'); });
    a = makeWindow('a');
    expect(a.show()).toBe(true);
    expect(a.state).toBe('hidden');
    expect(ui.isBlocking()).toBe(false);
    expect(recording).toEqual([true, false]);
  });

  test('never receives the same value twice in a row and never touches pause/resume', () => {
    const { ui, driver, recording, makeWindow } = harness();
    const a = makeWindow('a', { enterDurationMs: 100, leaveDurationMs: 100 });
    const b = makeWindow('b');
    a.show();
    driver.advance(100);
    a.close('button', () => b.show());
    driver.advance(100);
    b.close('button');
    a.show();
    a.cancel();
    ui.dispose();
    for (let i = 1; i < recording.length; i++) expect(recording[i]).not.toBe(recording[i - 1]);
    expect(driver.pauseScope).not.toHaveBeenCalled();
    expect(driver.resumeScope).not.toHaveBeenCalled();
  });
});
