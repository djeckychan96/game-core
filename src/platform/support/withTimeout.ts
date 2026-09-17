// Adapter support — NOT part of the root entry. Platform adapters are the only place in Game Core
// where timers live; they are injected so tests drive them and nothing here reads a global clock.

export interface PlatformTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const defaultPlatformTimers: PlatformTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * The donor's iron rule (Yandex audit 16.08): every `await` of an external SDK goes through a
 * timeout — a webview can HOLD a request without ever rejecting, and `.catch` does not save from a
 * promise that never settles. Rejects with `Error("sdk_timeout:<tag>")`, the donor's message.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, tag: string, timers: PlatformTimers = defaultPlatformTimers): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = timers.setTimeout(() => reject(new Error(`sdk_timeout:${tag}`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        timers.clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        timers.clearTimeout(handle);
        reject(error);
      }
    );
  });
}

export function sleep(ms: number, timers: PlatformTimers = defaultPlatformTimers): Promise<void> {
  return new Promise((resolve) => void timers.setTimeout(resolve, ms));
}

/** Waits for `promise` (its failure included) at most `ms` — never rejects, never outlives its timer. */
export function settleWithin(promise: PromiseLike<unknown>, ms: number, timers: PlatformTimers = defaultPlatformTimers): Promise<void> {
  return new Promise((resolve) => {
    const handle = timers.setTimeout(resolve, ms);
    const finish = (): void => {
      timers.clearTimeout(handle);
      resolve();
    };
    Promise.resolve(promise).then(finish, finish);
  });
}
