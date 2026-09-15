import type { CoreRuntimeModule } from '../core/CoreRuntime';
import { ButtonControllerImpl } from './ButtonController';
import { WindowControllerImpl } from './WindowController';
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
  UiScope,
  WindowController,
  WindowControllerOptions
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

/**
 * The seam the two controller classes use to talk to the runtime. Internal: never exported from
 * src/index.ts. The controllers import it as a type only, so there is no runtime cycle.
 */
export interface UiHost {
  readonly motion: UiMotionDriver;
  readonly stats: UiMutableStats;
  activeWindowImpl: WindowController<unknown> | null;
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
  activeWindowImpl: WindowController<unknown> | null = null;

  private readonly onUiError: UiErrorHandler;
  private readonly onBlockingChangedHandler: ((blocking: boolean) => void) | null;
  private readonly buttons = new Map<string, ButtonControllerImpl>();
  private readonly windows = new Map<string, WindowController<unknown>>();
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

  createWindow<TParams = void>(options: WindowControllerOptions<TParams>): WindowController<TParams> {
    this.assertNotDisposed('createWindow');
    if (this.windows.has(options.id)) {
      throw new Error(`UiRuntime: a window with id "${options.id}" is already registered`);
    }
    const window = new WindowControllerImpl<TParams>(this, options);
    this.windows.set(options.id, window);
    return window;
  }

  /** The single window whose state is not 'hidden', or null. */
  get activeWindow(): WindowController<unknown> | null {
    return this.activeWindowImpl;
  }

  /** The stored, last-published blocking value. Never re-derived on read. */
  isBlocking(): boolean {
    return this.blocking;
  }

  /** CoreRuntimeModule: no per-frame work — UI motion is advanced by MotionRuntime through the driver. */
  update(_frameMs: number): boolean {
    return false;
  }

  /**
   * CoreRuntimeModule: settles the one controller that owns `scope` — a button to idle, a window
   * force-hidden (spec §11). Returns 1 if it changed anything, else 0; any other scope returns 0.
   */
  cancelScope(scope: UiScope): number {
    const button = this.buttonForScope(scope);
    if (button !== undefined) return button.cancel() ? 1 : 0;
    const window = this.windowForScope(scope);
    if (window !== undefined) return window.cancel() ? 1 : 0;
    return 0;
  }

  /**
   * CoreRuntimeModule: settles every controller (windows first, then buttons). Returns the number
   * changed by this call; idempotent. Every route to a controller — this call, the motion module
   * reaching the tween first, a direct motion.cancelAll() — ends in the same settle (spec §11).
   */
  cancelAll(): number {
    let count = 0;
    for (const window of Array.from(this.windows.values())) {
      if (window.cancel()) count += 1;
    }
    for (const button of Array.from(this.buttons.values())) {
      if (button.cancel()) count += 1;
    }
    return count;
  }

  /** cancelAll(), then disposes every controller (already settled) and clears the registries. */
  dispose(): void {
    if (this.disposed) return;
    this.cancelAll();
    for (const window of Array.from(this.windows.values())) window.dispose();
    for (const button of Array.from(this.buttons.values())) button.dispose();
    this.windows.clear();
    this.buttons.clear();
    this.activeWindowImpl = null;
    this.recomputeBlocking();
    this.disposed = true;
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

  private buttonForScope(scope: UiScope): ButtonControllerImpl | undefined {
    return scope.startsWith(BUTTON_SCOPE_PREFIX) ? this.buttons.get(scope.slice(BUTTON_SCOPE_PREFIX.length)) : undefined;
  }

  private windowForScope(scope: UiScope): WindowController<unknown> | undefined {
    return scope.startsWith(WINDOW_SCOPE_PREFIX) ? this.windows.get(scope.slice(WINDOW_SCOPE_PREFIX.length)) : undefined;
  }
}
