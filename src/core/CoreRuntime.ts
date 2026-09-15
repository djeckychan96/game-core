/**
 * Contract a runtime must satisfy to be registered with CoreRuntime. Deliberately minimal:
 * CoreRuntime only knows this shape, never a specific runtime's internals (e.g. FxRuntime).
 */
export interface CoreRuntimeModule {
  update(frameMs: number): boolean;
  cancelScope?(scope: string): number;
  cancelAll?(): number;
  pauseScope?(scope: string): number;
  resumeScope?(scope: string): number;
  getStats?(): object;
  dispose?(): void;
}

export type CoreRuntimeErrorPhase =
  | 'update'
  | 'cancelScope'
  | 'cancelAll'
  | 'pauseScope'
  | 'resumeScope'
  | 'getStats'
  | 'dispose';

export interface CoreRuntimeErrorContext {
  moduleName: string;
  phase: CoreRuntimeErrorPhase;
}

export type CoreRuntimeErrorHandler = (error: unknown, context: CoreRuntimeErrorContext) => void;

/**
 * Minimal top-level fan-out kernel for runtime modules (FxRuntime today, MotionRuntime later).
 * NOT a DI container, framework, or event bus: it only registers modules, fans update/cancel
 * calls out to all of them, aggregates their stats, and gives every module's failures one place
 * to land. It never imports a renderer, never creates a ticker/RAF, and never knows a module's
 * internal structure.
 */
export class CoreRuntime {
  private readonly modules = new Map<string, CoreRuntimeModule>();
  private errorHandler: CoreRuntimeErrorHandler | null = null;

  /** Throws if `name` is already registered — a duplicate name is never silently replaced. */
  registerRuntime(name: string, runtime: CoreRuntimeModule): void {
    if (this.modules.has(name)) {
      throw new Error(`CoreRuntime: a runtime module named "${name}" is already registered`);
    }
    this.modules.set(name, runtime);
  }

  /**
   * Calls update(frameMs) on every registered module. A module that throws is reported and
   * skipped for this frame; it never prevents the other modules from updating and never lets
   * the exception reach the caller (the host's own ticker).
   */
  update(frameMs: number): boolean {
    let changed = false;
    for (const [name, runtime] of this.modules) {
      const result = this.safeInvoke(name, 'update', () => runtime.update(frameMs));
      if (result === true) changed = true;
    }
    return changed;
  }

  /** Fans out to every module's cancelScope (modules without one are skipped) and sums the counts. */
  cancelScope(scope: string): number {
    let total = 0;
    for (const [name, runtime] of this.modules) {
      if (!runtime.cancelScope) continue;
      const result = this.safeInvoke(name, 'cancelScope', () => runtime.cancelScope!(scope));
      if (typeof result === 'number') total += result;
    }
    return total;
  }

  /** Fans out to every module's cancelAll (modules without one are skipped) and sums the counts. */
  cancelAll(): number {
    let total = 0;
    for (const [name, runtime] of this.modules) {
      if (!runtime.cancelAll) continue;
      const result = this.safeInvoke(name, 'cancelAll', () => runtime.cancelAll!());
      if (typeof result === 'number') total += result;
    }
    return total;
  }

  /** Fans out to every module's pauseScope (modules without one are skipped) and sums the counts. */
  pauseScope(scope: string): number {
    let total = 0;
    for (const [name, runtime] of this.modules) {
      if (!runtime.pauseScope) continue;
      const result = this.safeInvoke(name, 'pauseScope', () => runtime.pauseScope!(scope));
      if (typeof result === 'number') total += result;
    }
    return total;
  }

  /** Fans out to every module's resumeScope (modules without one are skipped) and sums the counts. */
  resumeScope(scope: string): number {
    let total = 0;
    for (const [name, runtime] of this.modules) {
      if (!runtime.resumeScope) continue;
      const result = this.safeInvoke(name, 'resumeScope', () => runtime.resumeScope!(scope));
      if (typeof result === 'number') total += result;
    }
    return total;
  }

  /** Aggregates getStats() from every module that has one, keyed by the name it was registered under. */
  getStats(): Record<string, object> {
    const stats: Record<string, object> = {};
    for (const [name, runtime] of this.modules) {
      if (!runtime.getStats) continue;
      const result = this.safeInvoke(name, 'getStats', () => runtime.getStats!());
      if (result !== undefined) stats[name] = result;
    }
    return stats;
  }

  /** Sets the single sink every module's reported errors are delivered to. Pass null to clear it. */
  onError(handler: CoreRuntimeErrorHandler | null): void {
    this.errorHandler = handler;
  }

  /**
   * Reports an error through the registered handler. Exposed so a module (e.g. FxRuntime, via
   * its own pluggable error hook) can forward failures it already caught internally into this
   * same boundary, without CoreRuntime needing to know that module's internals. If the handler
   * itself throws, that is swallowed too — an error handler can never take down the host ticker.
   */
  reportError(moduleName: string, error: unknown, phase: CoreRuntimeErrorPhase = 'update'): void {
    if (!this.errorHandler) return;
    try {
      this.errorHandler(error, { moduleName, phase });
    } catch {
      // the error handler itself must never be able to propagate
    }
  }

  /** Fans out dispose() to every module that has one, then forgets all registrations. */
  dispose(): void {
    for (const [name, runtime] of this.modules) {
      if (!runtime.dispose) continue;
      this.safeInvoke(name, 'dispose', () => runtime.dispose!());
    }
    this.modules.clear();
    this.errorHandler = null;
  }

  private safeInvoke<T>(moduleName: string, phase: CoreRuntimeErrorPhase, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (error) {
      this.reportError(moduleName, error, phase);
      return undefined;
    }
  }
}
