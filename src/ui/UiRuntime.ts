import type { CoreRuntimeModule } from '../core/CoreRuntime';
import { ButtonControllerImpl } from './ButtonController';
import type {
  ButtonController,
  ButtonControllerOptions,
  UiControllerKind,
  UiErrorContext,
  UiErrorHandler,
  UiErrorPhase,
  UiMotionDriver,
  UiRuntimeOptions,
  UiRuntimeStats,
  UiScope
} from './types';

/** The counters of UiRuntimeStats, mutated in place by the controllers. Internal. */
export interface UiMutableStats {
  presses: number;
  taps: number;
  cancelledPresses: number;
  shows: number;
  rejectedShows: number;
  closes: number;
  vetoedCloses: number;
  rejectedCloses: number;
  forcedHides: number;
  callbackErrors: number;
}

/** What the runtime needs from a window controller. Internal; WindowControllerImpl satisfies it structurally. */
export interface UiWindowRecord {
  readonly id: string;
  readonly blocksGameplay: boolean;
  cancel(): boolean;
  dispose(): void;
}

/**
 * The seam the two controller classes use to talk to the runtime. Internal: never exported from
 * src/index.ts. The controllers import it as a type only, so there is no runtime cycle.
 */
export interface UiHost {
  readonly motion: UiMotionDriver;
  readonly stats: UiMutableStats;
  activeWindowImpl: UiWindowRecord | null;
  reportError(kind: UiControllerKind, id: string, phase: UiErrorPhase, error: unknown): void;
  recomputeBlocking(): void;
  unregisterButton(id: string): void;
  unregisterWindow(id: string): void;
}

// Same shape as MotionRuntime's defaultOnMotionError — independently re-declared (module boundary rule).
function defaultOnUiError(error: unknown, context: UiErrorContext): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[UiRuntime] host callback threw', context, error);
  }
}

const BUTTON_SCOPE_PREFIX = 'ui:button:';
const WINDOW_SCOPE_PREFIX = 'ui:window:';

export class UiRuntime implements CoreRuntimeModule, UiHost {
  readonly motion: UiMotionDriver;
  readonly stats: UiMutableStats = {
    presses: 0,
    taps: 0,
    cancelledPresses: 0,
    shows: 0,
    rejectedShows: 0,
    closes: 0,
    vetoedCloses: 0,
    rejectedCloses: 0,
    forcedHides: 0,
    callbackErrors: 0
  };
  activeWindowImpl: UiWindowRecord | null = null;

  private readonly onUiError: UiErrorHandler;
  private readonly onBlockingChangedHandler: ((blocking: boolean) => void) | null;
  private readonly buttons = new Map<string, ButtonControllerImpl>();
  private readonly windows = new Map<string, UiWindowRecord>();
  private blocking = false;
  private disposed = false;

  constructor(options: UiRuntimeOptions) {
    this.motion = options.motion;
    this.onUiError = options.onUiError ?? defaultOnUiError;
    this.onBlockingChangedHandler = options.onBlockingChanged ?? null;
  }

  createButton(options: ButtonControllerOptions): ButtonController {
    this.assertNotDisposed('createButton');
    if (this.buttons.has(options.id)) {
      throw new Error(`UiRuntime: a button with id "${options.id}" is already registered`);
    }
    const button = new ButtonControllerImpl(this, options);
    this.buttons.set(options.id, button);
    return button;
  }

  /** The stored, last-published blocking value. Never re-derived on read. */
  isBlocking(): boolean {
    return this.blocking;
  }

  /** CoreRuntimeModule: no per-frame work — UI motion is advanced by MotionRuntime through the driver. */
  update(_frameMs: number): boolean {
    return false;
  }

  getStats(): UiRuntimeStats {
    const s = this.stats;
    return {
      buttons: this.buttons.size,
      windows: this.windows.size,
      activeWindowId: this.activeWindowImpl ? this.activeWindowImpl.id : null,
      blocking: this.blocking,
      presses: s.presses,
      taps: s.taps,
      cancelledPresses: s.cancelledPresses,
      shows: s.shows,
      rejectedShows: s.rejectedShows,
      closes: s.closes,
      vetoedCloses: s.vetoedCloses,
      rejectedCloses: s.rejectedCloses,
      forcedHides: s.forcedHides,
      callbackErrors: s.callbackErrors
    };
  }

  // --- UiHost ---

  reportError(kind: UiControllerKind, id: string, phase: UiErrorPhase, error: unknown): void {
    this.stats.callbackErrors += 1;
    try {
      this.onUiError(error, { kind, id, phase });
    } catch {
      // the error handler itself must never be able to reach the host's frame loop
    }
  }

  /**
   * The only code that changes `blocking`. Reads the runtime's actual state, stores the new value
   * BEFORE the callback runs, and never publishes the same value twice in a row (spec §6.2).
   */
  recomputeBlocking(): void {
    const next = this.activeWindowImpl !== null && this.activeWindowImpl.blocksGameplay;
    if (next === this.blocking) return;
    this.blocking = next;
    if (!this.onBlockingChangedHandler) return;
    try {
      this.onBlockingChangedHandler(next);
    } catch (error) {
      this.reportError('runtime', 'ui', 'onBlockingChanged', error);
    }
  }

  unregisterButton(id: string): void {
    this.buttons.delete(id);
  }

  unregisterWindow(id: string): void {
    this.windows.delete(id);
  }

  // --- internal helpers ---

  private assertNotDisposed(operation: string): void {
    if (this.disposed) {
      throw new Error(`UiRuntime: ${operation} called after dispose()`);
    }
  }

  protected buttonForScope(scope: UiScope): ButtonControllerImpl | undefined {
    return scope.startsWith(BUTTON_SCOPE_PREFIX) ? this.buttons.get(scope.slice(BUTTON_SCOPE_PREFIX.length)) : undefined;
  }

  protected windowForScope(scope: UiScope): UiWindowRecord | undefined {
    return scope.startsWith(WINDOW_SCOPE_PREFIX) ? this.windows.get(scope.slice(WINDOW_SCOPE_PREFIX.length)) : undefined;
  }
}
