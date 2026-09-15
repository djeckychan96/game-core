import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

test('a package consumer can access only the supported MotionRuntime methods', () => {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  options.noEmit = true;

  // Compile a real consumer in memory; no probe file or prior build is needed by npm test.
  const consumerPath = fileURLToPath(new URL('./public-api-consumer.ts', import.meta.url));
  const consumer = `
    import { MotionRuntime } from '../../src/index';

    const publicMethods: Record<keyof MotionRuntime, true> = {
      tween: true, delay: true, sequence: true, update: true,
      cancelScope: true, cancelAll: true, pauseScope: true, resumeScope: true,
      dispose: true, getStats: true
    };
    const motion = new MotionRuntime();
    // @ts-expect-error sequence construction is internal
    motion.buildStepOperation;
    // @ts-expect-error lifecycle removal is internal
    motion.removeOperation;
    // @ts-expect-error registry access is internal
    motion.isOperationActive;
    // @ts-expect-error tween stepping is internal
    motion.advanceTweenFrame;
    // @ts-expect-error delay stepping is internal
    motion.advanceDelayFrame;
    // @ts-expect-error callback dispatch is internal
    motion.invokeCallback;
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
}, 15000);
