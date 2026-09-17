// Adapter support — NOT part of the root entry.
import { defaultPlatformTimers } from './withTimeout';
import type { PlatformTimers } from './withTimeout';

/** The page-visibility seam of the watchdog; `documentVisibility()` is the browser one. */
export interface PlatformVisibility {
  isVisible(): boolean;
  /** Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const AD_WATCHDOG_QUIET_MS = 2000;
export const AD_WATCHDOG_HARD_MS = 120000;

/** `document.visibilitychange`; null where there is no document (Node, workers). */
export function documentVisibility(): PlatformVisibility | null {
  if (typeof document === 'undefined') return null;
  const doc = document;
  return {
    isVisible: () => doc.visibilityState === 'visible',
    subscribe: (listener) => {
      doc.addEventListener('visibilitychange', listener);
      return () => doc.removeEventListener('visibilitychange', listener);
    }
  };
}

export interface AdWatchdogEnv {
  timers?: PlatformTimers;
  visibility?: PlatformVisibility | null;
}

/**
 * The donor's `makeAdWatchdog` (Android bug): a click on the ad takes the player out of the tab, and
 * after the return the SDK may never send `onClose` — the show promise hangs forever. When the page
 * becomes visible again, wait 2 s of SDK silence and close the show ourselves; plus a hard 120 s
 * timeout. Returns `done`: the first call settles, every later one is a no-op.
 */
export function createAdWatchdog<T>(resolve: (value: T) => void, fallback: () => T, env: AdWatchdogEnv = {}): (value: T) => void {
  const timers = env.timers ?? defaultPlatformTimers;
  const visibility = env.visibility === undefined ? documentVisibility() : env.visibility;
  let settled = false;
  let quietTimer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  const done = (value: T): void => {
    if (settled) return;
    settled = true;
    unsubscribe?.();
    if (quietTimer !== null) timers.clearTimeout(quietTimer);
    timers.clearTimeout(hardTimer);
    resolve(value);
  };
  const hardTimer = timers.setTimeout(() => done(fallback()), AD_WATCHDOG_HARD_MS);
  if (visibility) {
    const watched = visibility;
    unsubscribe = watched.subscribe(() => {
      if (settled || !watched.isVisible()) return;
      if (quietTimer !== null) timers.clearTimeout(quietTimer);
      quietTimer = timers.setTimeout(() => done(fallback()), AD_WATCHDOG_QUIET_MS);
    });
  }
  return done;
}
