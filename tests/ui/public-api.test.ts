import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

test('a package consumer sees exactly the UiRuntime public API and none of its internals', () => {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  options.noEmit = true;

  // Compile a real consumer in memory; no probe file or prior build is needed by npm test.
  const consumerPath = fileURLToPath(new URL('./public-api-consumer.ts', import.meta.url));
  const consumer = `
    import {
      UiRuntime, computeLayout, MotionRuntime,
      type UiRuntimeOptions, type UiRuntimeStats, type UiMotionDriver, type UiMotionTweenRequest,
      type UiMotionHandle, type UiScope, type ButtonController, type ButtonControllerOptions,
      type ButtonState, type ButtonCancelReason, type ButtonPointerCancelReason, type WindowController,
      type WindowControllerOptions, type WindowState, type WindowTransitionPhase, type WindowCloseReason,
      type WindowHiddenReason, type WindowCloseIntent, type LayoutInput, type LayoutResult, type LayoutRect,
      type LayoutInsets, type LayoutOrientation, type UiErrorContext, type UiErrorHandler, type UiErrorPhase,
      type UiControllerKind, type CoreRuntimeModule
    } from '../../src/index';

    const driver: UiMotionDriver = new MotionRuntime();
    const options: UiRuntimeOptions = { motion: driver };
    const ui = new UiRuntime(options);
    const module: CoreRuntimeModule = ui;

    const publicMethods: Record<keyof UiRuntime, true> = {
      createButton: true, createWindow: true, activeWindow: true, isBlocking: true,
      update: true, cancelScope: true, cancelAll: true, getStats: true, dispose: true
    };

    const button: ButtonController = ui.createButton({ id: 'b' } satisfies ButtonControllerOptions);
    const window: WindowController<{ level: number }> = ui.createWindow<{ level: number }>({ id: 'w' } satisfies WindowControllerOptions<{ level: number }>);
    const plain: WindowController = ui.createWindow({ id: 'p' });
    plain.show();
    window.show({ level: 1 });
    window.close('button', () => {});
    const state: ButtonState = button.state;
    const wstate: WindowState = window.state;
    const stats: UiRuntimeStats = ui.getStats();
    const layout: LayoutResult = computeLayout({ viewportWidth: 1, viewportHeight: 1, designWidth: 1, designHeight: 1 } satisfies LayoutInput);
    const rect: LayoutRect = layout.safeRect;
    const insets: Partial<LayoutInsets> = {};
    const orientation: LayoutOrientation = layout.orientation;
    const scope: UiScope = button.scope;
    const handle: UiMotionHandle = driver.tween({ scope, durationMs: 1, bindings: [] } satisfies UiMotionTweenRequest);
    const reason: ButtonCancelReason = 'swipe';
    const pointerReason: ButtonPointerCancelReason = 'leave';
    const phase: WindowTransitionPhase = 'entering';
    const closeReason: WindowCloseReason = 'escape';
    const hiddenReason: WindowHiddenReason = 'cancelled';
    const intent: WindowCloseIntent = { reason: closeReason, state: 'shown' };
    const context: UiErrorContext = { kind: 'runtime' satisfies UiControllerKind, id: 'ui', phase: 'onClosed' satisfies UiErrorPhase };
    const handler: UiErrorHandler = () => {};
    void [module, publicMethods, state, wstate, stats, rect, insets, orientation, handle, reason, pointerReason, phase, intent, context, handler, module];

    // @ts-expect-error controller implementation classes are internal
    import('../../src/index').then((m) => m.ButtonControllerImpl);
    // @ts-expect-error controller implementation classes are internal
    import('../../src/index').then((m) => m.WindowControllerImpl);
    // @ts-expect-error the host seam is internal
    import('../../src/index').then((m) => m.UiHost);
  `;
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === consumerPath
      ? ts.createSourceFile(path, consumer, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram([consumerPath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  );
  expect(diagnostics).toEqual([]);
}, 20000);
