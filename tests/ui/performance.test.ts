import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { UiRuntime } from '../../src/ui/UiRuntime';
import { FakeMotionDriver } from './fakeMotionDriver';

function fullCycle(ui: UiRuntime, driver: FakeMotionDriver): void {
  const button = ui.createButton({ id: 'b', onProgress: () => {} });
  const window = ui.createWindow({ id: 'w', enterDurationMs: 100, leaveDurationMs: 100, onTransition: () => {} });
  button.pointerDown(1, 0, 0);
  driver.advance(80);
  button.pointerUp(1, 0, 0, true);
  driver.advance(80);
  window.show();
  driver.advance(100);
  window.close('button', () => {});
  driver.advance(100);
  ui.cancelAll();
  ui.dispose();
}

describe('UiRuntime performance constraints', () => {
  test('a full lifecycle never touches requestAnimationFrame, setTimeout or setInterval', () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = {
      requestAnimationFrame: globals['requestAnimationFrame'],
      setTimeout: globals['setTimeout'],
      setInterval: globals['setInterval']
    };
    const forbid = (name: string) => () => { throw new Error(`${name} must not be used by UiRuntime`); };
    globals['requestAnimationFrame'] = forbid('requestAnimationFrame');
    globals['setTimeout'] = forbid('setTimeout');
    globals['setInterval'] = forbid('setInterval');
    try {
      const driver = new FakeMotionDriver();
      const ui = new UiRuntime({ motion: driver });
      expect(() => fullCycle(ui, driver)).not.toThrow();
    } finally {
      globals['requestAnimationFrame'] = saved.requestAnimationFrame;
      globals['setTimeout'] = saved.setTimeout;
      globals['setInterval'] = saved.setInterval;
    }
  });

  test('update() does no work and calls nothing on the driver', () => {
    const driver = new FakeMotionDriver();
    const ui = new UiRuntime({ motion: driver });
    ui.createButton({ id: 'b' });
    ui.createWindow({ id: 'w' });
    for (let i = 0; i < 100; i++) expect(ui.update(16)).toBe(false);
    expect(driver.requests).toEqual([]);
    expect(driver.pauseScope).not.toHaveBeenCalled();
    expect(driver.resumeScope).not.toHaveBeenCalled();
  });

  test('exactly one tween per animated phase, with the same preallocated bindings array per controller', () => {
    const driver = new FakeMotionDriver();
    const ui = new UiRuntime({ motion: driver });
    const button = ui.createButton({ id: 'b' });
    const window = ui.createWindow({ id: 'w', enterDurationMs: 100, leaveDurationMs: 100 });

    button.pointerDown(1, 0, 0);
    driver.advance(80);
    button.pointerUp(1, 0, 0, true);
    driver.advance(80);
    expect(driver.requests.length).toBe(2);
    expect(driver.bindingArrays[0]).toBe(driver.bindingArrays[1]);

    window.show();
    driver.advance(100);
    window.close('button');
    driver.advance(100);
    expect(driver.requests.length).toBe(4);
    expect(driver.bindingArrays[2]).toBe(driver.bindingArrays[3]);
    expect(driver.bindingArrays[0]).not.toBe(driver.bindingArrays[2]);
  });

  test('src/ui contains no renderer, DOM, timer or clock references and only type-level imports of other modules', () => {
    const uiDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/ui');
    const files = readdirSync(uiDir).filter((name) => name.endsWith('.ts'));
    expect(files.sort()).toEqual(['ButtonController.ts', 'UiRuntime.ts', 'WindowController.ts', 'layout.ts', 'types.ts']);

    const forbidden = [
      'requestAnimationFrame', 'setTimeout', 'setInterval', 'performance.', 'Date.', 'window.', 'document.', 'navigator.',
      "'pixi", "'three", "'gsap", '"pixi', '"three', '"gsap'
    ];
    for (const file of files) {
      const source = readFileSync(join(uiDir, file), 'utf-8');
      for (const token of forbidden) {
        expect(source.includes(token), `${file} must not reference ${token}`).toBe(false);
      }
      for (const line of source.split('\n')) {
        if (!line.startsWith('import ')) continue;
        const crossesModule = line.includes('../motion') || line.includes('../core') || line.includes('../fx');
        if (crossesModule) expect(line.startsWith('import type '), `${file}: ${line}`).toBe(true);
        expect(line.includes('../fx'), `${file} must not import from src/fx: ${line}`).toBe(false);
      }
    }
  });
});
