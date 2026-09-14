import { describe, expect, test, vi } from 'vitest';
import { CoreRuntime, type CoreRuntimeModule } from '../../src/core/CoreRuntime';

function makeModule(overrides: Partial<CoreRuntimeModule> = {}): CoreRuntimeModule {
  return {
    update: () => false,
    ...overrides
  };
}

describe('CoreRuntime', () => {
  test('registerRuntime throws a clear error on a duplicate name instead of silently replacing it', () => {
    const core = new CoreRuntime();
    core.registerRuntime('fx', makeModule());

    expect(() => core.registerRuntime('fx', makeModule())).toThrowError(/already/i);
  });

  test('update fans out to every registered module', () => {
    const core = new CoreRuntime();
    const a = vi.fn(() => false);
    const b = vi.fn(() => false);
    core.registerRuntime('a', makeModule({ update: a }));
    core.registerRuntime('b', makeModule({ update: b }));

    core.update(16);

    expect(a).toHaveBeenCalledWith(16);
    expect(b).toHaveBeenCalledWith(16);
  });

  test('update returns true if ANY module reports a visual change, false if none do', () => {
    const core = new CoreRuntime();
    core.registerRuntime('quiet', makeModule({ update: () => false }));
    expect(core.update(16)).toBe(false);

    core.registerRuntime('busy', makeModule({ update: () => true }));
    expect(core.update(16)).toBe(true);
  });

  test('a module that throws in update() is isolated: others still run, and update() never throws', () => {
    const core = new CoreRuntime();
    const afterThrow = vi.fn(() => true);
    core.registerRuntime('broken', makeModule({
      update: () => {
        throw new Error('boom');
      }
    }));
    core.registerRuntime('healthy', makeModule({ update: afterThrow }));

    let changed: boolean | undefined;
    expect(() => {
      changed = core.update(16);
    }).not.toThrow();

    expect(afterThrow).toHaveBeenCalled();
    expect(changed).toBe(true); // the healthy module's `true` still counts
  });

  test('errors from update/cancelScope/cancelAll/dispose are reported to the registered handler with moduleName + phase', () => {
    const core = new CoreRuntime();
    const reports: Array<{ error: unknown; moduleName: string; phase: string }> = [];
    core.onError((error, context) => reports.push({ error, ...context }));

    core.registerRuntime('broken', makeModule({
      update: () => {
        throw new Error('update-boom');
      },
      cancelScope: () => {
        throw new Error('cancelScope-boom');
      },
      cancelAll: () => {
        throw new Error('cancelAll-boom');
      },
      dispose: () => {
        throw new Error('dispose-boom');
      }
    }));

    core.update(16);
    core.cancelScope('s');
    core.cancelAll();
    core.dispose();

    expect(reports.map((r) => r.phase)).toEqual(['update', 'cancelScope', 'cancelAll', 'dispose']);
    expect(reports.every((r) => r.moduleName === 'broken')).toBe(true);
    expect(reports.map((r) => (r.error as Error).message)).toEqual([
      'update-boom',
      'cancelScope-boom',
      'cancelAll-boom',
      'dispose-boom'
    ]);
  });

  test('a throwing error handler never escapes reportError/update and does not stop other modules', () => {
    const core = new CoreRuntime();
    core.onError(() => {
      throw new Error('handler itself is broken');
    });
    const healthy = vi.fn(() => true);
    core.registerRuntime('broken', makeModule({
      update: () => {
        throw new Error('module boom');
      }
    }));
    core.registerRuntime('healthy', makeModule({ update: healthy }));

    expect(() => core.update(16)).not.toThrow();
    expect(healthy).toHaveBeenCalled();
  });

  test('cancelScope fans out and sums counts across modules, skipping modules without one', () => {
    const core = new CoreRuntime();
    core.registerRuntime('fx', makeModule({ cancelScope: () => 2 }));
    core.registerRuntime('noScope', makeModule({})); // no cancelScope at all
    core.registerRuntime('motion', makeModule({ cancelScope: () => 3 }));

    expect(core.cancelScope('level-complete')).toBe(5);
  });

  test('cancelAll fans out and sums counts across modules', () => {
    const core = new CoreRuntime();
    core.registerRuntime('fx', makeModule({ cancelAll: () => 4 }));
    core.registerRuntime('motion', makeModule({ cancelAll: () => 1 }));

    expect(core.cancelAll()).toBe(5);
  });

  test('getStats aggregates each module\'s own stats object keyed by its registered name', () => {
    const core = new CoreRuntime();
    core.registerRuntime('fx', makeModule({ getStats: () => ({ activeEffects: 3 }) }));
    core.registerRuntime('noStats', makeModule({})); // no getStats at all

    expect(core.getStats()).toEqual({ fx: { activeEffects: 3 } });
  });

  test('dispose fans out to every module and forgets all registrations (a fresh name can re-register)', () => {
    const core = new CoreRuntime();
    const disposeFx = vi.fn();
    core.registerRuntime('fx', makeModule({ dispose: disposeFx }));

    core.dispose();

    expect(disposeFx).toHaveBeenCalledTimes(1);
    // module map was cleared: registering "fx" again does not throw as a duplicate
    expect(() => core.registerRuntime('fx', makeModule())).not.toThrow();
  });
});
