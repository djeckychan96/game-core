// Adapter support — NOT part of the root entry.

/** The network-recovery seam: "the connection is back". */
export interface PlatformOnline {
  /** Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

type GlobalEvents = {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

/**
 * The browser's `online` event — it fires on the global object (the page, a worker). null where the
 * global object is no event target (Node): there is nothing to recover from there.
 */
export function globalOnline(): PlatformOnline | null {
  const target = globalThis as GlobalEvents;
  const add = target.addEventListener;
  const remove = target.removeEventListener;
  if (typeof add !== 'function' || typeof remove !== 'function') return null;
  return {
    subscribe: (listener) => {
      add.call(target, 'online', listener);
      return () => remove.call(target, 'online', listener);
    }
  };
}
