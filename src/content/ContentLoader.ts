// ContentLoader V1 — progressive loading of a game's content in GROUPS (what the current screen needs, what
// the next one will need …). The host's `load` brings ONE item; the loader runs one real load per item however
// many groups and calls want it, retries a bounded number of times and calls the host's `unload` only when no
// held group needs the item any more. It never knows what an item is (a URL, a manifest entry, a sound id …)
// and never draws: no spinner, no offline window, no retry button — the progress, the retry events and the
// errors are what the host shows them from. No cache of its own, no renderer, no browser global: the online
// seam is injected (none by default); timers default to the standard setTimeout and are injectable too.

/** What the host's `load` gets with each attempt. */
export interface ContentLoadContext {
  /**
   * Aborted when nobody waits for the item any more (every call that wanted it was aborted, or the groups
   * holding it were released). Pass it on — `fetch(url, { signal })`. A load that ignores it still settles
   * normally: its value is kept for the groups still holding the item, or handed to `unload`.
   */
  readonly signal: AbortSignal;
  /** 1 for the first attempt, then 2, 3 … up to `retry.attempts`. */
  readonly attempt: number;
}

/**
 * Why the host's `unload` runs: `released` — the last group holding the item was released; `cancelled` — a
 * load finished after nobody held the item any more (it was released while loading).
 */
export type ContentUnloadReason = 'released' | 'cancelled';

export interface ContentUnloadContext {
  readonly reason: ContentUnloadReason;
}

/** Bounded retries of ONE item — never an endless loop. */
export interface ContentRetryPolicy {
  /** Attempts per item, the first one included: a safe integer ≥ 1 (1 = no retry). */
  attempts: number;
  /**
   * The wait before the next attempt, in ms: a number, or a function of the failed attempt (1-based) and its
   * error — `(failed) => 500 * 2 ** (failed - 1)`. Default 0. A value that is not a finite number ≥ 0 fails the item.
   */
  backoffMs?: number | ((failedAttempt: number, error: unknown) => number);
}

/** The timer seam (the shape of the platform adapters' timers). Default: the standard setTimeout / clearTimeout. */
export interface ContentLoaderTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * The network seam: the state, plus "the connection is back" (the `subscribe` contract of the platform
 * adapters' online seam). A browser host passes `navigator.onLine` and the `online` event (docs/CONTENT_LOADER.md).
 */
export interface ContentLoaderOnline {
  /** false = the device reports no connection right now. */
  isOnline(): boolean;
  /** Calls `listener` when the connection is back; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** A failed attempt that WILL be retried (the last failure rejects the call instead) — for a "retrying…" line. */
export interface ContentRetryEvent<I> {
  item: I;
  /** The attempt that failed, 1-based. */
  attempt: number;
  /** `retry.attempts`. */
  attempts: number;
  error: unknown;
  /** The backoff before the next attempt. */
  delayMs: number;
  /** The device reports no connection: the next attempt first waits for the connection, then for the backoff. */
  offline: boolean;
}

export type ContentLoaderErrorPhase =
  /** The host's `unload` threw or rejected — the item is gone from the loader all the same. */
  | 'unload'
  /** An `onProgress` callback threw. */
  | 'progress'
  /** The `onRetry` callback threw. */
  | 'retry'
  /** The online seam threw — the loader treats the device as online. */
  | 'online'
  /** A prefetch failed (its promise answers false; a later load of the group loads the failed items again). */
  | 'prefetch';

export interface ContentLoaderErrorContext<I> {
  phase: ContentLoaderErrorPhase;
  /** unload / retry / online. */
  item?: I;
  /** progress / prefetch. */
  groupId?: string;
}

export interface ContentLoaderOptions<T, I = string> {
  /** Loads ONE item. Called once per item at a time, whatever the number of groups and calls that want it. */
  load: (item: I, context: ContentLoadContext) => PromiseLike<T>;
  /** Frees a loaded item no held group needs any more. A throw or a rejection is reported (`onError`), never retried. */
  unload?: (item: I, value: T, context: ContentUnloadContext) => void | PromiseLike<void>;
  /** Default: one attempt, no retry. */
  retry?: ContentRetryPolicy;
  /** The identity of an item: two items with the same key are ONE item. Default: the item itself (a string by value, an object by reference). */
  key?: (item: I) => unknown;
  timers?: ContentLoaderTimers;
  /** Default null: a failed attempt never waits for the network, only for its backoff. */
  online?: ContentLoaderOnline | null;
  onRetry?: (event: ContentRetryEvent<I>) => void;
  /** Where unload errors, throwing callbacks and failed prefetches land; defaults to console.error. */
  onError?: (error: unknown, context: ContentLoaderErrorContext<I>) => void;
}

export interface ContentLoadOptions {
  /** Aborting it rejects THIS call with a cancellation; the group keeps what it holds until `release`. */
  signal?: AbortSignal;
  /**
   * `loaded` of `total` distinct items of this call: once at the start (what is already loaded) and after each
   * item that arrives. Failed items are not counted.
   */
  onProgress?: (loaded: number, total: number) => void;
}

/** ready: every item the group holds is loaded; loading: a call of the group is running; incomplete: neither (a failure, an abort). */
export type ContentGroupStatus = 'ready' | 'loading' | 'incomplete';

export interface ContentGroupSnapshot {
  id: string;
  status: ContentGroupStatus;
  /** Distinct items the group holds that are loaded. */
  loaded: number;
  /** Distinct items the group holds. */
  total: number;
}

export interface ContentLoaderSnapshot {
  /** The held groups (not released), in the order they were first used. */
  groups: ContentGroupSnapshot[];
  /** Distinct items the loader still tracks: held by a group, or loading / unloading. */
  items: number;
  /** Items with a load running (an attempt, a backoff or a wait for the network). */
  loading: number;
}

export interface ContentLoader<T, I = string> {
  /**
   * Holds `items` for `groupId` and resolves with their values, in the order of `items` (a repeated item repeats
   * its value). Loaded items are not loaded again; an item loading for another call is awaited, not loaded twice.
   * Rejects with a ContentLoadError: `failed` (after the item's attempts), `aborted` (the signal), `released`.
   * A failed or aborted call leaves the group holding its items (the loaded ones stay loaded): call `load` again
   * to retry the rest, or `release` the group. An empty groupId or a non-array `items` throws a TypeError.
   */
  load(groupId: string, items: readonly I[], options?: ContentLoadOptions): Promise<T[]>;
  /**
   * `load` in the background: never rejects — true once the group's items are loaded, false on a failure (also
   * reported to `onError`), an abort or a release. A later `load` of the same items uses what it loaded or is
   * loading. No network priority is implied: the host's `load` decides how an item is fetched.
   */
  prefetch(groupId: string, items: readonly I[], options?: ContentLoadOptions): Promise<boolean>;
  /**
   * Drops the group: its running calls reject (`released`) and each item no other held group holds is unloaded
   * (a running load of it is aborted). Answers false for an unknown or already released group.
   */
  release(groupId: string): boolean;
  snapshot(): ContentLoaderSnapshot;
}

export type ContentLoadErrorReason = 'failed' | 'aborted' | 'released';

export interface ContentLoadFailure {
  /** The host's item. */
  item: unknown;
  /** The error of its last attempt. */
  error: unknown;
  /** The attempts the item's load made (a call that joined a load already running shares its remaining attempts). */
  attempts: number;
}

/** How a `load` call rejects. `cancelled` (aborted / released) is the caller's own doing, not a failure to show. */
export class ContentLoadError extends Error {
  readonly reason: ContentLoadErrorReason;
  readonly groupId: string;
  /** `failed`: every item of the call that could not be loaded; empty for a cancellation. */
  readonly failures: readonly ContentLoadFailure[];
  readonly cancelled: boolean;
  /** `failed`: the first failure's error; `aborted`: the signal's reason. */
  readonly cause: unknown;

  constructor(reason: ContentLoadErrorReason, groupId: string, failures: readonly ContentLoadFailure[] = [], cause?: unknown) {
    super(
      reason === 'failed'
        ? `ContentLoader: ${failures.length} item(s) of group "${groupId}" could not be loaded`
        : reason === 'aborted'
          ? `ContentLoader: loading group "${groupId}" was aborted`
          : `ContentLoader: group "${groupId}" was released while loading`
    );
    this.name = 'ContentLoadError';
    this.reason = reason;
    this.groupId = groupId;
    this.failures = failures;
    this.cancelled = reason !== 'failed';
    this.cause = reason === 'failed' ? failures[0]?.error : cause;
  }
}

export function createContentLoader<T, I = string>(options: ContentLoaderOptions<T, I>): ContentLoader<T, I> {
  return new ContentLoaderImpl(options);
}

/** idle: not loaded and nothing running · loading · ready: `value` holds it · unloading: the host's async unload runs. */
type EntryState = 'idle' | 'loading' | 'ready' | 'unloading';

interface Entry<T, I> {
  readonly key: unknown;
  readonly item: I;
  /** The groups holding the item. */
  readonly owners: Set<Group<T, I>>;
  /** The calls waiting for the item: a load runs only while there is one. */
  readonly waiters: Set<Call<T, I>>;
  state: EntryState;
  value: T | undefined;
  /** The running attempt's controller. */
  controller: AbortController | null;
  /** Ends the running pause (a backoff, a wait for the network) at once. */
  wake: (() => void) | null;
}

interface Group<T, I> {
  readonly id: string;
  readonly entries: Set<Entry<T, I>>;
  readonly calls: Set<Call<T, I>>;
}

interface Call<T, I> {
  readonly group: Group<T, I>;
  /** One entry per requested item, in order. */
  readonly order: readonly Entry<T, I>[];
  readonly pending: Set<Entry<T, I>>;
  readonly failures: ContentLoadFailure[];
  readonly total: number;
  loaded: number;
  done: boolean;
  readonly onProgress: ((loaded: number, total: number) => void) | undefined;
  readonly resolve: (values: T[]) => void;
  readonly reject: (error: ContentLoadError) => void;
  unlisten: () => void;
}

const OPTION_KEYS = ['load', 'unload', 'retry', 'key', 'timers', 'online', 'onRetry', 'onError'];
const RETRY_KEYS = ['attempts', 'backoffMs'];
const LOAD_OPTION_KEYS = ['signal', 'onProgress'];

const defaultTimers: ContentLoaderTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDelay = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';

function refuseUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(value).filter((name) => !allowed.includes(name));
  if (unknown.length > 0) throw new TypeError(`ContentLoader: unknown ${where} ${unknown.join(', ')}`);
}

class ContentLoaderImpl<T, I> implements ContentLoader<T, I> {
  private readonly entries = new Map<unknown, Entry<T, I>>();
  private readonly groups = new Map<string, Group<T, I>>();
  private readonly loadItem: ContentLoaderOptions<T, I>['load'];
  private readonly unloadItem: ContentLoaderOptions<T, I>['unload'];
  private readonly keyOf: (item: I) => unknown;
  private readonly attempts: number;
  private readonly backoff: number | ((failedAttempt: number, error: unknown) => number);
  private readonly timers: ContentLoaderTimers;
  private readonly online: ContentLoaderOnline | null;
  private readonly onRetry: ((event: ContentRetryEvent<I>) => void) | undefined;
  private readonly onError: (error: unknown, context: ContentLoaderErrorContext<I>) => void;

  constructor(options: ContentLoaderOptions<T, I>) {
    if (!isObject(options)) throw new TypeError('ContentLoader: options must be an object');
    refuseUnknownKeys(options, OPTION_KEYS, 'option');
    const { load, unload, retry, key, timers, online, onRetry, onError } = options;
    if (typeof load !== 'function') throw new TypeError('ContentLoader: load must be a function');
    for (const [name, value] of [['unload', unload], ['key', key], ['onRetry', onRetry], ['onError', onError]] as const) {
      if (value !== undefined && typeof value !== 'function') throw new TypeError(`ContentLoader: ${name} must be a function`);
    }
    if (retry !== undefined) {
      if (!isObject(retry)) throw new TypeError('ContentLoader: retry must be an object');
      refuseUnknownKeys(retry, RETRY_KEYS, 'retry option');
      if (!Number.isSafeInteger(retry.attempts) || retry.attempts < 1) throw new TypeError('ContentLoader: retry.attempts must be a safe integer ≥ 1');
      if (retry.backoffMs !== undefined && typeof retry.backoffMs !== 'function' && !isDelay(retry.backoffMs)) {
        throw new TypeError('ContentLoader: retry.backoffMs must be a finite number ≥ 0 or a function');
      }
    }
    if (timers !== undefined && !(isObject(timers) && typeof timers.setTimeout === 'function' && typeof timers.clearTimeout === 'function')) {
      throw new TypeError('ContentLoader: timers must have setTimeout and clearTimeout');
    }
    if (online !== undefined && online !== null && !(isObject(online) && typeof online.isOnline === 'function' && typeof online.subscribe === 'function')) {
      throw new TypeError('ContentLoader: online must have isOnline and subscribe');
    }
    this.loadItem = load;
    this.unloadItem = unload;
    this.keyOf = key ?? ((item) => item);
    this.attempts = retry?.attempts ?? 1;
    this.backoff = retry?.backoffMs ?? 0;
    this.timers = timers ?? defaultTimers;
    this.online = online ?? null;
    this.onRetry = onRetry;
    this.onError = onError ?? ((error, context) => console.error(`ContentLoader: ${context.phase} error`, error));
  }

  load(groupId: string, items: readonly I[], options?: ContentLoadOptions): Promise<T[]> {
    return this.start(groupId, items, options);
  }

  prefetch(groupId: string, items: readonly I[], options?: ContentLoadOptions): Promise<boolean> {
    return this.start(groupId, items, options).then(
      () => true,
      (error: unknown) => {
        if (!(error instanceof ContentLoadError && error.cancelled)) this.report(error, { phase: 'prefetch', groupId });
        return false;
      }
    );
  }

  release(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    this.groups.delete(groupId);
    for (const call of [...group.calls]) this.drop(call, 'released');
    for (const entry of group.entries) {
      entry.owners.delete(group);
      if (entry.owners.size === 0) this.retire(entry);
    }
    return true;
  }

  snapshot(): ContentLoaderSnapshot {
    let loading = 0;
    for (const entry of this.entries.values()) if (entry.state === 'loading') loading += 1;
    const groups = [...this.groups.values()].map((group): ContentGroupSnapshot => {
      let loaded = 0;
      for (const entry of group.entries) if (entry.state === 'ready') loaded += 1;
      const total = group.entries.size;
      const status: ContentGroupStatus = loaded === total ? 'ready' : group.calls.size > 0 ? 'loading' : 'incomplete';
      return { id: group.id, status, loaded, total };
    });
    return { groups, items: this.entries.size, loading };
  }

  private start(groupId: string, items: readonly I[], options: ContentLoadOptions = {}): Promise<T[]> {
    if (typeof groupId !== 'string' || groupId === '') throw new TypeError('ContentLoader: groupId must be a non-empty string');
    if (!Array.isArray(items)) throw new TypeError('ContentLoader: items must be an array');
    const raw: unknown = options;
    if (!isObject(raw)) throw new TypeError('ContentLoader: load options must be an object');
    refuseUnknownKeys(raw, LOAD_OPTION_KEYS, 'load option');
    if (raw.onProgress !== undefined && typeof raw.onProgress !== 'function') throw new TypeError('ContentLoader: onProgress must be a function');
    if (raw.signal !== undefined && !(isObject(raw.signal) && typeof raw.signal.addEventListener === 'function')) {
      throw new TypeError('ContentLoader: signal must be an AbortSignal');
    }
    const { signal, onProgress } = options;
    // a throwing key function throws here, before the group holds anything
    const keys = items.map((item) => this.keyOf(item));
    if (signal?.aborted) return Promise.reject(new ContentLoadError('aborted', groupId, [], signal.reason));

    const group = this.groupOf(groupId);
    const order = items.map((item, index) => this.hold(group, keys[index], item));
    const unique = [...new Set(order)];
    const pending = unique.filter((entry) => entry.state !== 'ready');
    if (pending.length === 0) {
      const values = order.map((entry) => entry.value as T);
      if (onProgress) this.progress(onProgress, unique.length, unique.length, groupId);
      return Promise.resolve(values);
    }
    return new Promise<T[]>((resolve, reject) => {
      const call: Call<T, I> = {
        group,
        order,
        pending: new Set(pending),
        failures: [],
        total: unique.length,
        loaded: unique.length - pending.length,
        done: false,
        onProgress,
        resolve,
        reject,
        unlisten: () => {}
      };
      group.calls.add(call);
      for (const entry of pending) entry.waiters.add(call);
      if (signal) {
        const onAbort = (): void => this.drop(call, 'aborted', signal.reason);
        signal.addEventListener('abort', onAbort);
        call.unlisten = () => signal.removeEventListener('abort', onAbort);
      }
      if (onProgress) this.progress(onProgress, call.loaded, call.total, groupId);
      // an item still unloading starts once its unload settles (see settle); a running one is joined
      for (const entry of pending) if (entry.state === 'idle' && entry.waiters.size > 0) void this.run(entry);
    });
  }

  private groupOf(groupId: string): Group<T, I> {
    let group = this.groups.get(groupId);
    if (!group) {
      group = { id: groupId, entries: new Set(), calls: new Set() };
      this.groups.set(groupId, group);
    }
    return group;
  }

  private hold(group: Group<T, I>, key: unknown, item: I): Entry<T, I> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, item, owners: new Set(), waiters: new Set(), state: 'idle', value: undefined, controller: null, wake: null };
      this.entries.set(key, entry);
    }
    entry.owners.add(group);
    group.entries.add(entry);
    return entry;
  }

  /** One item's load: attempts while a call waits for it, at most `attempts` failures. */
  private async run(entry: Entry<T, I>): Promise<void> {
    entry.state = 'loading';
    let failed = 0;
    try {
      while (entry.waiters.size > 0) {
        const controller = new AbortController();
        entry.controller = controller;
        let value: T;
        try {
          value = await new Promise<T>((resolve) => resolve(this.loadItem(entry.item, { signal: controller.signal, attempt: failed + 1 })));
        } catch (error) {
          entry.controller = null;
          // an attempt the loader cancelled is not a failure; when a call wants the item again a fresh one starts
          if (controller.signal.aborted) continue;
          failed += 1;
          if (failed >= this.attempts) return this.fail(entry, error, failed);
          let delayMs: number;
          try {
            delayMs = this.backoffAfter(failed, error);
          } catch (backoffError) {
            return this.fail(entry, backoffError, failed);
          }
          const offline = this.isOffline(entry.item);
          this.retrying({ item: entry.item, attempt: failed, attempts: this.attempts, error, delayMs, offline });
          if (offline && entry.waiters.size > 0) await this.untilOnline(entry);
          if (delayMs > 0 && entry.waiters.size > 0) await this.pause(entry, delayMs);
          continue;
        }
        entry.controller = null;
        return this.arrived(entry, value);
      }
    } catch (error) {
      // a broken seam (the host's timers, its online seam): the item fails instead of hanging in `loading`
      entry.controller = null;
      if (entry.state === 'loading') this.fail(entry, error, failed);
      return;
    }
    // nobody waits any more: no new attempt
    entry.state = 'idle';
    this.settle(entry);
  }

  private arrived(entry: Entry<T, I>, value: T): void {
    // released while loading: nobody holds it — hand the late value back
    if (entry.owners.size === 0) return this.unloadValue(entry, value, 'cancelled');
    entry.state = 'ready';
    entry.value = value;
    const calls = [...entry.waiters];
    entry.waiters.clear();
    for (const call of calls) {
      if (call.done) continue;
      call.pending.delete(entry);
      call.loaded += 1;
      if (call.onProgress) this.progress(call.onProgress, call.loaded, call.total, call.group.id);
      this.finish(call);
    }
  }

  private fail(entry: Entry<T, I>, error: unknown, attempts: number): void {
    entry.state = 'idle';
    const calls = [...entry.waiters];
    entry.waiters.clear();
    for (const call of calls) {
      if (call.done) continue;
      call.pending.delete(entry);
      call.failures.push({ item: entry.item, error, attempts });
      this.finish(call);
    }
    this.settle(entry);
  }

  private finish(call: Call<T, I>): void {
    if (call.done || call.pending.size > 0) return;
    this.close(call);
    if (call.failures.length > 0) call.reject(new ContentLoadError('failed', call.group.id, call.failures));
    else call.resolve(call.order.map((entry) => entry.value as T));
  }

  /** A call stops waiting (abort, release): an item nobody else waits for stops loading. */
  private drop(call: Call<T, I>, reason: 'aborted' | 'released', cause?: unknown): void {
    if (call.done) return;
    this.close(call);
    for (const entry of call.pending) {
      entry.waiters.delete(call);
      if (entry.waiters.size === 0 && entry.state === 'loading') {
        entry.controller?.abort();
        entry.wake?.();
      }
    }
    call.pending.clear();
    call.reject(new ContentLoadError(reason, call.group.id, [], cause));
  }

  private close(call: Call<T, I>): void {
    call.done = true;
    call.group.calls.delete(call);
    call.unlisten();
  }

  /** The last holder let go of the item. */
  private retire(entry: Entry<T, I>): void {
    if (entry.state === 'ready') {
      const value = entry.value as T;
      entry.value = undefined;
      this.unloadValue(entry, value, 'released');
    } else if (entry.state === 'idle') {
      this.settle(entry);
    }
    // loading: its waiters were dropped, so the attempt is cancelled and its end decides (a late value is unloaded)
    // unloading: already on its way out
  }

  private unloadValue(entry: Entry<T, I>, value: T, reason: ContentUnloadReason): void {
    entry.state = 'unloading';
    let result: void | PromiseLike<void> = undefined;
    if (this.unloadItem) {
      try {
        result = this.unloadItem(entry.item, value, { reason });
      } catch (error) {
        this.report(error, { phase: 'unload', item: entry.item });
      }
    }
    const unloaded = (): void => {
      entry.state = 'idle';
      this.settle(entry);
    };
    if (!isThenable(result)) return unloaded();
    // a load of the same item waits for this unload (a host cache could otherwise hand out what is being freed)
    Promise.resolve(result).then(unloaded, (error: unknown) => {
      this.report(error, { phase: 'unload', item: entry.item });
      unloaded();
    });
  }

  /** An idle entry: loads again for the calls that came while it was unloading, or leaves once nobody holds it. */
  private settle(entry: Entry<T, I>): void {
    if (entry.state !== 'idle') return;
    if (entry.waiters.size > 0) {
      void this.run(entry);
      return;
    }
    if (entry.owners.size === 0 && this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  }

  private backoffAfter(failed: number, error: unknown): number {
    const delay = typeof this.backoff === 'function' ? this.backoff(failed, error) : this.backoff;
    if (!isDelay(delay)) throw new RangeError(`ContentLoader: retry.backoffMs gave ${String(delay)} — it must be a finite number of ms ≥ 0`);
    return delay;
  }

  private isOffline(item: I): boolean {
    if (!this.online) return false;
    try {
      return this.online.isOnline() === false;
    } catch (error) {
      this.report(error, { phase: 'online', item });
      return false;
    }
  }

  /** Waits for the connection; ends early when nobody waits for the item any more. */
  private untilOnline(entry: Entry<T, I>): Promise<void> {
    const online = this.online as ContentLoaderOnline;
    return new Promise<void>((resolve) => {
      let finished = false;
      let unsubscribe: (() => void) | null = null;
      const done = (): void => {
        if (finished) return;
        finished = true;
        if (entry.wake === done) entry.wake = null;
        if (unsubscribe) this.unsubscribe(unsubscribe, entry.item);
        resolve();
      };
      entry.wake = done;
      try {
        const off = online.subscribe(done);
        if (finished) this.unsubscribe(off, entry.item);
        else unsubscribe = off;
      } catch (error) {
        this.report(error, { phase: 'online', item: entry.item });
        done();
        return;
      }
      // the connection may have come back between the failed attempt and the subscription
      if (!this.isOffline(entry.item)) done();
    });
  }

  private unsubscribe(off: () => void, item: I): void {
    try {
      off();
    } catch (error) {
      this.report(error, { phase: 'online', item });
    }
  }

  /** The backoff; ends early when nobody waits for the item any more. */
  private pause(entry: Entry<T, I>, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      let handle: unknown = null;
      const done = (): void => {
        if (finished) return;
        finished = true;
        if (entry.wake === done) entry.wake = null;
        this.timers.clearTimeout(handle);
        resolve();
      };
      entry.wake = done;
      handle = this.timers.setTimeout(done, ms);
    });
  }

  private retrying(event: ContentRetryEvent<I>): void {
    if (!this.onRetry) return;
    try {
      this.onRetry(event);
    } catch (error) {
      this.report(error, { phase: 'retry', item: event.item });
    }
  }

  private progress(onProgress: (loaded: number, total: number) => void, loaded: number, total: number, groupId: string): void {
    try {
      onProgress(loaded, total);
    } catch (error) {
      this.report(error, { phase: 'progress', groupId });
    }
  }

  private report(error: unknown, context: ContentLoaderErrorContext<I>): void {
    try {
      this.onError(error, context);
    } catch {
      // the error handler itself threw: there is nobody else to tell
    }
  }
}
