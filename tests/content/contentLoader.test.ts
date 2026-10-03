import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as root from '../../src/index';
import { ContentLoadError, createContentLoader } from '../../src/index';
import type { ContentLoadContext, ContentLoaderOnline, ContentLoaderOptions, ContentLoaderTimers, ContentRetryEvent } from '../../src/index';

/** Drains every pending promise reaction (the loader's chains are a few microtasks deep); no timer involved. */
const flush = (): Promise<void> => new Promise((done) => setImmediate(done));

/** Captures how a promise settles, attached at once — an expected rejection is never unhandled. */
function watch<V>(promise: Promise<V>) {
  const result = { settled: false, value: undefined as V | undefined, error: undefined as unknown, done: Promise.resolve() };
  result.done = promise.then(
    (value) => {
      result.settled = true;
      result.value = value;
    },
    (error: unknown) => {
      result.settled = true;
      result.error = error;
    }
  );
  return result;
}

interface Attempt {
  item: string;
  attempt: number;
  signal: AbortSignal;
  resolve: (value?: string) => void;
  reject: (error: unknown) => void;
}

/** The host's `load`: every attempt stays open until the test settles it — no network, no clock. */
function source() {
  const attempts: Attempt[] = [];
  const load = (item: string, context: ContentLoadContext): Promise<string> =>
    new Promise<string>((resolveValue, reject) => {
      attempts.push({ item, attempt: context.attempt, signal: context.signal, resolve: (value = `v:${item}`) => resolveValue(value), reject });
    });
  const last = (item: string): Attempt => {
    const found = attempts.filter((attempt) => attempt.item === item).pop();
    if (!found) throw new Error(`no attempt for ${item}`);
    return found;
  };
  return { attempts, load, last, log: () => attempts.map((attempt) => `${attempt.item}#${attempt.attempt}`) };
}

/** Injected timers: nothing fires until the test says so. */
function fakeTimers() {
  let next = 0;
  const queue = new Map<number, { ms: number; callback: () => void }>();
  const timers: ContentLoaderTimers = {
    setTimeout: (callback, ms) => {
      next += 1;
      queue.set(next, { ms, callback });
      return next;
    },
    clearTimeout: (handle) => void queue.delete(handle as number)
  };
  return {
    timers,
    pending: () => [...queue.values()].map((timer) => timer.ms),
    fireAll: () => {
      const due = [...queue.values()];
      queue.clear();
      for (const timer of due) timer.callback();
    }
  };
}

/** An injected network seam the test switches off and on. */
function fakeOnline(initial = true) {
  let online = initial;
  const listeners = new Set<() => void>();
  const seam: ContentLoaderOnline = {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }
  };
  return {
    seam,
    listeners,
    goOffline: () => void (online = false),
    /** The state only, without the event (the connection came back before anybody listened). */
    setOnline: () => void (online = true),
    comeBack: () => {
      online = true;
      for (const listener of [...listeners]) listener();
    }
  };
}

function setup(options: Partial<ContentLoaderOptions<string, string>> = {}) {
  const src = source();
  const unloads: string[] = [];
  const errors: Array<[string, unknown]> = [];
  const retries: Array<ContentRetryEvent<string>> = [];
  const clock = fakeTimers();
  const loader = createContentLoader<string, string>({
    load: src.load,
    unload: (item, value, { reason }) => void unloads.push(`${item}=${value}:${reason}`),
    timers: clock.timers,
    onRetry: (event) => void retries.push(event),
    onError: (error, context) => void errors.push([context.phase, error]),
    ...options
  });
  return { loader, src, unloads, errors, retries, clock };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

afterEach(() => {
  vi.useRealTimers();
});

describe('ContentLoader V1 — groups, dedupe, ownership', () => {
  test('1. load: the group resolves with its values in the order of the items; a loaded group is not loaded again', async () => {
    const { loader, src } = setup();
    const call = watch(loader.load('current', ['a', 'b']));
    expect(src.log()).toEqual(['a#1', 'b#1']);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'current', status: 'loading', loaded: 0, total: 2 }], items: 2, loading: 2 });
    src.last('b').resolve();
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a', 'v:b']);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'current', status: 'ready', loaded: 2, total: 2 }], items: 2, loading: 0 });

    await expect(loader.load('current', ['b', 'a'])).resolves.toEqual(['v:b', 'v:a']);
    expect(src.attempts).toHaveLength(2);
  });

  test('2. progress: loaded / total of the call — once at the start, then per arrived item; a ready group reports total / total', async () => {
    const { loader, src } = setup();
    const progress: string[] = [];
    const call = watch(loader.load('g', ['a', 'b', 'c'], { onProgress: (loaded, total) => progress.push(`${loaded}/${total}`) }));
    expect(progress).toEqual(['0/3']);
    src.last('b').resolve();
    await flush();
    expect(progress).toEqual(['0/3', '1/3']);
    src.last('a').resolve();
    src.last('c').resolve();
    await call.done;
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3']);

    const again: string[] = [];
    await loader.load('g', ['a', 'b', 'c'], { onProgress: (loaded, total) => again.push(`${loaded}/${total}`) });
    expect(again).toEqual(['3/3']);

    // a call that finds part of its items loaded starts from them
    const partial: string[] = [];
    const next = watch(loader.load('next', ['c', 'd'], { onProgress: (loaded, total) => partial.push(`${loaded}/${total}`) }));
    src.last('d').resolve();
    await next.done;
    expect(partial).toEqual(['1/2', '2/2']);
  });

  test('3. the same item twice in one call is ONE load; both places get its value', async () => {
    const { loader, src } = setup();
    const progress: string[] = [];
    const call = watch(loader.load('g', ['a', 'a', 'b', 'a'], { onProgress: (loaded, total) => progress.push(`${loaded}/${total}`) }));
    expect(src.log()).toEqual(['a#1', 'b#1']);
    src.last('a').resolve();
    src.last('b').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a', 'v:a', 'v:b', 'v:a']);
    expect(progress).toEqual(['0/2', '1/2', '2/2']);
    expect(loader.snapshot().items).toBe(2);
  });

  test('4. two groups share an item: one load serves both', async () => {
    const { loader, src } = setup();
    const current = watch(loader.load('current', ['a', 'shared']));
    const next = watch(loader.load('next', ['shared', 'c']));
    expect(src.log()).toEqual(['a#1', 'shared#1', 'c#1']);
    for (const item of ['a', 'shared', 'c']) src.last(item).resolve();
    await Promise.all([current.done, next.done]);
    expect([current.value, next.value]).toEqual([['v:a', 'v:shared'], ['v:shared', 'v:c']]);
    expect(loader.snapshot().items).toBe(3);
  });

  test('5. releasing the first group does not unload the item the other group still holds', async () => {
    const { loader, src, unloads } = setup();
    const current = watch(loader.load('current', ['a', 'shared']));
    const next = watch(loader.load('next', ['shared', 'c']));
    for (const item of ['a', 'shared', 'c']) src.last(item).resolve();
    await Promise.all([current.done, next.done]);

    expect(loader.release('current')).toBe(true);
    expect(unloads).toEqual(['a=v:a:released']);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'next', status: 'ready', loaded: 2, total: 2 }], items: 2, loading: 0 });
    await expect(loader.load('next', ['shared'])).resolves.toEqual(['v:shared']);
    expect(src.attempts).toHaveLength(3);
  });

  test('6. releasing the last holder unloads the item; a later load is a fresh load', async () => {
    const { loader, src, unloads } = setup();
    const current = watch(loader.load('current', ['a', 'shared']));
    const next = watch(loader.load('next', ['shared', 'c']));
    for (const item of ['a', 'shared', 'c']) src.last(item).resolve();
    await Promise.all([current.done, next.done]);
    loader.release('current');

    expect(loader.release('next')).toBe(true);
    expect(unloads).toEqual(['a=v:a:released', 'shared=v:shared:released', 'c=v:c:released']);
    expect(loader.snapshot()).toEqual({ groups: [], items: 0, loading: 0 });

    const again = watch(loader.load('again', ['shared']));
    expect(src.log()).toEqual(['a#1', 'shared#1', 'c#1', 'shared#1']);
    src.last('shared').resolve('v:shared-2');
    await again.done;
    expect(again.value).toEqual(['v:shared-2']);
  });

  test('a group loaded twice is held once: one release unloads it', async () => {
    const { loader, src, unloads } = setup();
    const first = watch(loader.load('g', ['a']));
    const second = watch(loader.load('g', ['a', 'b']));
    src.last('a').resolve();
    src.last('b').resolve();
    await Promise.all([first.done, second.done]);
    expect(loader.snapshot().groups).toEqual([{ id: 'g', status: 'ready', loaded: 2, total: 2 }]);
    loader.release('g');
    expect(unloads).toEqual(['a=v:a:released', 'b=v:b:released']);
  });

  test('items are deduplicated by `key` (default: the item itself — a string by value, an object by reference)', async () => {
    interface Asset {
      id: string;
      url: string;
    }
    const loads: string[] = [];
    const loader = createContentLoader<string, Asset>({
      load: async (asset) => {
        loads.push(asset.id);
        return `v:${asset.url}`;
      },
      key: (asset) => asset.id
    });
    const values = await loader.load('g', [{ id: 'hero', url: 'hero.png' }, { id: 'hero', url: 'hero.png' }, { id: 'tile', url: 'tile.png' }]);
    expect(values).toEqual(['v:hero.png', 'v:hero.png', 'v:tile.png']);
    expect(loads).toEqual(['hero', 'tile']);
  });
});

describe('ContentLoader V1 — prefetch', () => {
  test('7. prefetch → load: the later load uses what the prefetch loaded, no second load', async () => {
    const { loader, src } = setup();
    const prefetched = watch(loader.prefetch('next', ['x', 'y']));
    src.last('x').resolve();
    src.last('y').resolve();
    await prefetched.done;
    expect(prefetched.value).toBe(true);
    await expect(loader.load('next', ['x', 'y'])).resolves.toEqual(['v:x', 'v:y']);
    await expect(loader.load('other', ['y'])).resolves.toEqual(['v:y']);
    expect(src.log()).toEqual(['x#1', 'y#1']);
  });

  test('8. concurrent load and prefetch of the same item: one real load; a load joining a running prefetch adds none', async () => {
    const { loader, src } = setup();
    const current = watch(loader.load('current', ['shared', 'a']));
    const next = watch(loader.prefetch('next', ['shared', 'b']));
    expect(src.log()).toEqual(['shared#1', 'a#1', 'b#1']);
    const nextLoad = watch(loader.load('next', ['shared', 'b']));
    expect(src.attempts).toHaveLength(3);

    for (const item of ['shared', 'a', 'b']) src.last(item).resolve();
    await Promise.all([current.done, next.done, nextLoad.done]);
    expect([current.value, next.value, nextLoad.value]).toEqual([['v:shared', 'v:a'], true, ['v:shared', 'v:b']]);
  });

  test('prefetch never rejects: a failure answers false and is reported; a release answers false silently; a later load retries', async () => {
    const { loader, src, errors } = setup();
    const failed = watch(loader.prefetch('next', ['x']));
    src.last('x').reject(new Error('offline'));
    await failed.done;
    expect([failed.value, failed.error]).toEqual([false, undefined]);
    expect(errors.map(([phase, error]) => [phase, (error as ContentLoadError).reason])).toEqual([['prefetch', 'failed']]);

    const released = watch(loader.prefetch('later', ['y']));
    loader.release('later');
    await released.done;
    expect(released.value).toBe(false);
    expect(errors).toHaveLength(1);

    const load = watch(loader.load('next', ['x']));
    expect(src.log()).toEqual(['x#1', 'y#1', 'x#1']);
    src.last('x').resolve();
    await load.done;
    expect(load.value).toEqual(['v:x']);
  });

  test('prefetch and load throw a TypeError at once for a programming error (never a silent false)', () => {
    const { loader } = setup();
    expect(() => loader.prefetch('', ['a'])).toThrow(TypeError);
    expect(() => loader.load('', ['a'])).toThrow(TypeError);
    expect(() => loader.load('g', 'a' as never)).toThrow(TypeError);
    expect(() => loader.load('g', ['a'], { singal: null } as never)).toThrow(/unknown load option singal/);
    expect(() => loader.load('g', ['a'], { onProgress: 1 } as never)).toThrow(TypeError);
    expect(() => loader.load('g', ['a'], { signal: {} } as never)).toThrow(/AbortSignal/);
    expect(loader.snapshot()).toEqual({ groups: [], items: 0, loading: 0 });
  });
});

describe('ContentLoader V1 — retry', () => {
  test('9. a temporary error is retried after the backoff and then succeeds', async () => {
    const { loader, src, clock, retries } = setup({ retry: { attempts: 3, backoffMs: 250 } });
    const call = watch(loader.load('g', ['a']));
    const failure = new Error('net');
    src.last('a').reject(failure);
    await flush();
    expect(retries).toEqual([{ item: 'a', attempt: 1, attempts: 3, error: failure, delayMs: 250, offline: false }]);
    expect(clock.pending()).toEqual([250]);
    expect(src.log()).toEqual(['a#1']);
    expect(loader.snapshot().loading).toBe(1);

    clock.fireAll();
    await flush();
    expect(src.log()).toEqual(['a#1', 'a#2']);
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'g', status: 'ready', loaded: 1, total: 1 }], items: 1, loading: 0 });
  });

  test('backoffMs as a function of the failed attempt and its error', async () => {
    const seen: Array<[number, string]> = [];
    const { loader, src, clock } = setup({
      retry: {
        attempts: 3,
        backoffMs: (failed, error) => {
          seen.push([failed, message(error)]);
          return 100 * 2 ** (failed - 1);
        }
      }
    });
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('first'));
    await flush();
    expect(clock.pending()).toEqual([100]);
    clock.fireAll();
    await flush();
    src.last('a').reject(new Error('second'));
    await flush();
    expect(clock.pending()).toEqual([200]);
    clock.fireAll();
    await flush();
    src.last('a').resolve();
    await call.done;
    expect(seen).toEqual([[1, 'first'], [2, 'second']]);
    expect(call.value).toEqual(['v:a']);
  });

  test('10. exhausted attempts reject with ContentLoadError `failed` — exactly `attempts` loads, never more', async () => {
    const { loader, src, retries } = setup({ retry: { attempts: 2 } });
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('one'));
    await flush();
    expect(src.log()).toEqual(['a#1', 'a#2']);
    const last = new Error('two');
    src.last('a').reject(last);
    await call.done;
    expect(call.error).toBeInstanceOf(ContentLoadError);
    expect(call.error).toMatchObject({ name: 'ContentLoadError', reason: 'failed', cancelled: false, groupId: 'g', cause: last });
    expect((call.error as ContentLoadError).failures).toEqual([{ item: 'a', error: last, attempts: 2 }]);
    await flush();
    expect(src.attempts).toHaveLength(2);
    expect(retries).toHaveLength(1);
    expect(loader.snapshot().loading).toBe(0);
  });

  test('no retry policy = one attempt: the first failure rejects, nothing is retried', async () => {
    const { loader, src, retries } = setup({});
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('404'));
    await call.done;
    expect((call.error as ContentLoadError).failures).toEqual([{ item: 'a', error: new Error('404'), attempts: 1 }]);
    expect([src.attempts.length, retries.length]).toEqual([1, 0]);
  });

  test('11. after a failed load a NEW call loads again (fresh attempts)', async () => {
    const { loader, src } = setup({ retry: { attempts: 2 } });
    const first = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('one'));
    await flush();
    src.last('a').reject(new Error('two'));
    await first.done;
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'g', status: 'incomplete', loaded: 0, total: 1 }], items: 1, loading: 0 });

    const second = watch(loader.load('g', ['a']));
    expect(src.log()).toEqual(['a#1', 'a#2', 'a#1']);
    src.last('a').resolve();
    await second.done;
    expect(second.value).toEqual(['v:a']);
    expect(loader.snapshot().groups).toEqual([{ id: 'g', status: 'ready', loaded: 1, total: 1 }]);
  });

  test('a backoff that is not a finite number ≥ 0 fails the item (no hang, no endless wait)', async () => {
    const { loader, src, clock } = setup({ retry: { attempts: 3, backoffMs: () => Number.POSITIVE_INFINITY } });
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('net'));
    await call.done;
    const failure = (call.error as ContentLoadError).failures[0];
    expect(failure?.error).toBeInstanceOf(RangeError);
    expect(failure?.attempts).toBe(1);
    expect(clock.pending()).toEqual([]);
    expect(loader.snapshot().loading).toBe(0);
  });

  test('a joining call shares the item\'s running load and its remaining attempts', async () => {
    const { loader, src } = setup({ retry: { attempts: 2 } });
    const first = watch(loader.load('current', ['a']));
    src.last('a').reject(new Error('one'));
    await flush();
    const second = watch(loader.load('next', ['a']));
    expect(src.log()).toEqual(['a#1', 'a#2']);
    src.last('a').reject(new Error('two'));
    await Promise.all([first.done, second.done]);
    expect((first.error as ContentLoadError).failures).toEqual([{ item: 'a', error: new Error('two'), attempts: 2 }]);
    expect((second.error as ContentLoadError).failures).toEqual([{ item: 'a', error: new Error('two'), attempts: 2 }]);
  });

  test('the default timers are the standard setTimeout / clearTimeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const src = source();
    const loader = createContentLoader<string, string>({ load: src.load, retry: { attempts: 2, backoffMs: 500 } });
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('net'));
    await flush();
    await vi.advanceTimersByTimeAsync(499);
    expect(src.log()).toEqual(['a#1']);
    await vi.advanceTimersByTimeAsync(1);
    expect(src.log()).toEqual(['a#1', 'a#2']);
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ContentLoader V1 — cancellation', () => {
  test('12. abort during the backoff: no new attempt, the call rejects as a cancellation, the loader is not left in flight', async () => {
    const { loader, src, clock } = setup({ retry: { attempts: 5, backoffMs: 1000 } });
    const controller = new AbortController();
    const call = watch(loader.load('g', ['a'], { signal: controller.signal }));
    src.last('a').reject(new Error('net'));
    await flush();
    expect(clock.pending()).toEqual([1000]);

    controller.abort();
    await call.done;
    expect(call.error).toBeInstanceOf(ContentLoadError);
    expect(call.error).toMatchObject({ reason: 'aborted', cancelled: true, groupId: 'g', failures: [] });
    expect((call.error as ContentLoadError).cause).toBe(controller.signal.reason);
    expect(clock.pending()).toEqual([]);
    clock.fireAll();
    await flush();
    expect(src.log()).toEqual(['a#1']);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'g', status: 'incomplete', loaded: 0, total: 1 }], items: 1, loading: 0 });

    const again = watch(loader.load('g', ['a']));
    expect(src.log()).toEqual(['a#1', 'a#1']);
    src.last('a').resolve();
    await again.done;
    expect(again.value).toEqual(['v:a']);
  });

  test('abort during an attempt aborts the host\'s signal; the aborted attempt is not retried', async () => {
    const { loader, src, retries } = setup({ retry: { attempts: 3 } });
    const controller = new AbortController();
    const call = watch(loader.load('g', ['a'], { signal: controller.signal }));
    const attempt = src.last('a');
    controller.abort();
    expect(attempt.signal.aborted).toBe(true);
    await call.done;
    expect(call.error).toMatchObject({ reason: 'aborted' });
    attempt.reject(new Error('AbortError')); // the host honours the signal
    await flush();
    expect([src.log(), retries.length, loader.snapshot().loading]).toEqual([['a#1'], 0, 0]);
  });

  test('an already aborted signal rejects at once: no load, nothing held', async () => {
    const { loader, src } = setup();
    const call = watch(loader.load('g', ['a'], { signal: AbortSignal.abort() }));
    await call.done;
    expect(call.error).toMatchObject({ reason: 'aborted', cancelled: true });
    expect([src.attempts.length, loader.snapshot()]).toEqual([0, { groups: [], items: 0, loading: 0 }]);
  });

  test('one caller aborting does not cancel a shared load another call still waits for', async () => {
    const { loader, src } = setup();
    const controller = new AbortController();
    const mine = watch(loader.load('current', ['shared'], { signal: controller.signal }));
    const other = watch(loader.load('next', ['shared']));
    controller.abort();
    await mine.done;
    expect(mine.error).toMatchObject({ reason: 'aborted' });
    expect(src.last('shared').signal.aborted).toBe(false);
    src.last('shared').resolve();
    await other.done;
    expect(other.value).toEqual(['v:shared']);
  });

  test('an aborted call leaves its group holding the item: a value the host still delivers is kept, not leaked', async () => {
    const { loader, src, unloads } = setup();
    const controller = new AbortController();
    const call = watch(loader.load('g', ['a'], { signal: controller.signal }));
    controller.abort();
    await call.done;
    src.last('a').resolve(); // a host load that ignores the signal
    await flush();
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'g', status: 'ready', loaded: 1, total: 1 }], items: 1, loading: 0 });
    await expect(loader.load('g', ['a'])).resolves.toEqual(['v:a']);
    loader.release('g');
    expect(unloads).toEqual(['a=v:a:released']);
  });
});

describe('ContentLoader V1 — release', () => {
  test('13. a partial group failure: the group is not ready, what loaded stays held, a retry loads only what is missing', async () => {
    const { loader, src, unloads } = setup();
    const progress: string[] = [];
    const call = watch(loader.load('level', ['a', 'b', 'c'], { onProgress: (loaded, total) => progress.push(`${loaded}/${total}`) }));
    src.last('a').resolve();
    src.last('b').reject(new Error('404'));
    await flush();
    expect(call.settled).toBe(false); // waits for every item before answering
    src.last('c').resolve();
    await call.done;
    expect((call.error as ContentLoadError).failures.map((failure) => failure.item)).toEqual(['b']);
    expect(progress).toEqual(['0/3', '1/3', '2/3']);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'level', status: 'incomplete', loaded: 2, total: 3 }], items: 3, loading: 0 });
    expect(unloads).toEqual([]);

    const again = watch(loader.load('level', ['a', 'b', 'c']));
    expect(src.log()).toEqual(['a#1', 'b#1', 'c#1', 'b#1']);
    src.last('b').resolve();
    await again.done;
    expect(again.value).toEqual(['v:a', 'v:b', 'v:c']);
    expect(loader.snapshot().groups).toEqual([{ id: 'level', status: 'ready', loaded: 3, total: 3 }]);
  });

  test('14. release is safe to repeat: the second call and an unknown group answer false and unload nothing', async () => {
    const { loader, src, unloads } = setup();
    const call = watch(loader.load('g', ['a']));
    src.last('a').resolve();
    await call.done;
    expect(loader.release('g')).toBe(true);
    expect(loader.release('g')).toBe(false);
    expect(loader.release('never')).toBe(false);
    expect(unloads).toEqual(['a=v:a:released']);
    expect(loader.snapshot()).toEqual({ groups: [], items: 0, loading: 0 });
  });

  test('15. an unload that throws or rejects is reported and never breaks the loader', async () => {
    const { loader, src, errors } = setup({
      unload: (item) => {
        if (item === 'a') throw new Error('sync boom');
        return Promise.reject(new Error('async boom'));
      }
    });
    const first = watch(loader.load('g1', ['a', 'b']));
    const second = watch(loader.load('g2', ['c']));
    for (const item of ['a', 'b', 'c']) src.last(item).resolve();
    await Promise.all([first.done, second.done]);

    expect(loader.release('g1')).toBe(true);
    await flush();
    expect(errors.map(([phase, error]) => [phase, message(error)])).toEqual([
      ['unload', 'sync boom'],
      ['unload', 'async boom']
    ]);
    expect(loader.snapshot()).toEqual({ groups: [{ id: 'g2', status: 'ready', loaded: 1, total: 1 }], items: 1, loading: 0 });

    const again = watch(loader.load('g1', ['a', 'b']));
    expect(src.log()).toEqual(['a#1', 'b#1', 'c#1', 'a#1', 'b#1']);
    src.last('a').resolve();
    src.last('b').resolve();
    await again.done;
    expect(again.value).toEqual(['v:a', 'v:b']);
    await expect(loader.load('g2', ['c'])).resolves.toEqual(['v:c']);
  });

  test('release while loading: the call rejects `released`, the host signal is aborted, a late value is unloaded as `cancelled`', async () => {
    const { loader, src, unloads } = setup();
    const call = watch(loader.load('g', ['a']));
    const attempt = src.last('a');
    expect(loader.release('g')).toBe(true);
    expect(attempt.signal.aborted).toBe(true);
    await call.done;
    expect(call.error).toMatchObject({ reason: 'released', cancelled: true, groupId: 'g' });
    expect(loader.snapshot()).toEqual({ groups: [], items: 1, loading: 1 });

    attempt.resolve(); // a host load that ignores the signal
    await flush();
    expect(unloads).toEqual(['a=v:a:cancelled']);
    expect(loader.snapshot()).toEqual({ groups: [], items: 0, loading: 0 });
  });

  test('release then an immediate reload while the cancelled attempt still runs: never two loads of one item at a time', async () => {
    const { loader, src, unloads } = setup();
    const first = watch(loader.load('g', ['a']));
    const attempt = src.last('a');
    loader.release('g');
    await first.done;
    const second = watch(loader.load('g', ['a']));
    expect(src.attempts).toHaveLength(1);
    attempt.resolve(); // the host ignored the abort: its value serves the new call
    await second.done;
    expect(second.value).toEqual(['v:a']);
    expect(unloads).toEqual([]);

    // a host that honours the abort: the next attempt starts once the cancelled one has settled
    loader.release('g');
    const third = watch(loader.load('h', ['b']));
    const cancelled = src.last('b');
    loader.release('h');
    const fourth = watch(loader.load('h', ['b']));
    expect(src.log()).toEqual(['a#1', 'b#1']);
    cancelled.reject(new Error('AbortError'));
    await flush();
    expect(src.log()).toEqual(['a#1', 'b#1', 'b#1']);
    src.last('b').resolve();
    await Promise.all([third.done, fourth.done]);
    expect([third.error instanceof ContentLoadError, fourth.value]).toEqual([true, ['v:b']]);
  });

  test('an async unload still running: a new load of the item waits for it (a host cache never hands out what is being freed)', async () => {
    let finishUnload: () => void = () => {};
    const { loader, src } = setup({ unload: () => new Promise<void>((done) => void (finishUnload = done)) });
    const first = watch(loader.load('g', ['a']));
    src.last('a').resolve();
    await first.done;
    loader.release('g');
    expect(loader.snapshot()).toEqual({ groups: [], items: 1, loading: 0 });

    const again = watch(loader.load('g', ['a']));
    await flush();
    expect(src.attempts).toHaveLength(1);
    finishUnload();
    await flush();
    expect(src.log()).toEqual(['a#1', 'a#1']);
    src.last('a').resolve();
    await again.done;
    expect(again.value).toEqual(['v:a']);
  });
});

describe('ContentLoader V1 — online', () => {
  test('offline: a failed attempt waits for the connection, then the backoff — the wait spends no attempt', async () => {
    const net = fakeOnline();
    const { loader, src, clock, retries } = setup({ retry: { attempts: 2, backoffMs: 100 }, online: net.seam });
    const call = watch(loader.load('g', ['a']));
    net.goOffline();
    src.last('a').reject(new TypeError('Failed to fetch'));
    await flush();
    expect(retries).toMatchObject([{ item: 'a', attempt: 1, attempts: 2, delayMs: 100, offline: true }]);
    expect([net.listeners.size, clock.pending()]).toEqual([1, []]);
    await flush();
    expect(src.log()).toEqual(['a#1']);

    net.comeBack();
    await flush();
    expect([net.listeners.size, clock.pending()]).toEqual([0, [100]]);
    clock.fireAll();
    await flush();
    expect(src.log()).toEqual(['a#1', 'a#2']);
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
  });

  test('online: no wait for the network — straight to the backoff', async () => {
    const net = fakeOnline();
    const { loader, src, clock, retries } = setup({ retry: { attempts: 2, backoffMs: 100 }, online: net.seam });
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('500'));
    await flush();
    expect([retries[0]?.offline, net.listeners.size, clock.pending()]).toEqual([false, 0, [100]]);
    clock.fireAll();
    await flush();
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
  });

  test('the connection back before the loader listens: no hang', async () => {
    const net = fakeOnline();
    const { loader, src } = setup({ retry: { attempts: 2 }, online: net.seam, onRetry: () => net.setOnline() });
    const call = watch(loader.load('g', ['a']));
    net.goOffline();
    src.last('a').reject(new Error('net'));
    await flush();
    expect([src.log(), net.listeners.size]).toEqual([['a#1', 'a#2'], 0]);
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
  });

  test('abort while waiting for the network: the listener is removed, nothing more is attempted', async () => {
    const net = fakeOnline();
    const { loader, src } = setup({ retry: { attempts: 3 }, online: net.seam });
    const controller = new AbortController();
    const call = watch(loader.load('g', ['a'], { signal: controller.signal }));
    net.goOffline();
    src.last('a').reject(new Error('net'));
    await flush();
    expect(net.listeners.size).toBe(1);
    controller.abort();
    await call.done;
    expect(call.error).toMatchObject({ reason: 'aborted' });
    expect(net.listeners.size).toBe(0);
    net.comeBack();
    await flush();
    expect([src.log(), loader.snapshot().loading]).toEqual([['a#1'], 0]);
  });

  test('a throwing online seam is reported and treated as online', async () => {
    const { loader, src, errors, clock } = setup({
      retry: { attempts: 2, backoffMs: 10 },
      online: {
        isOnline: () => {
          throw new Error('seam');
        },
        subscribe: () => () => {}
      }
    });
    const call = watch(loader.load('g', ['a']));
    src.last('a').reject(new Error('net'));
    await flush();
    clock.fireAll();
    await flush();
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
    expect(errors.map(([phase, error]) => [phase, message(error)])).toEqual([['online', 'seam']]);
  });
});

describe('ContentLoader V1 — host callbacks and options', () => {
  test('throwing onProgress / onRetry callbacks are reported; loading goes on', async () => {
    const { loader, src, errors, clock } = setup({
      retry: { attempts: 2, backoffMs: 5 },
      onRetry: () => {
        throw new Error('retry ui');
      }
    });
    const call = watch(
      loader.load('g', ['a'], {
        onProgress: () => {
          throw new Error('progress ui');
        }
      })
    );
    src.last('a').reject(new Error('net'));
    await flush();
    clock.fireAll();
    await flush();
    src.last('a').resolve();
    await call.done;
    expect(call.value).toEqual(['v:a']);
    expect(errors.map(([phase, error]) => [phase, message(error)])).toEqual([
      ['progress', 'progress ui'],
      ['retry', 'retry ui'],
      ['progress', 'progress ui']
    ]);
  });

  test('options are validated: a bad or unknown option is a TypeError at creation (never a silent default)', () => {
    const load = async (item: string) => item;
    const create = (options: unknown) => () => createContentLoader(options as ContentLoaderOptions<string, string>);
    expect(create(undefined)).toThrow(TypeError);
    expect(create({})).toThrow(/load must be a function/);
    expect(create({ load, unload: 1 })).toThrow(/unload must be a function/);
    expect(create({ load, retries: 3 })).toThrow(/unknown option retries/);
    for (const attempts of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, '3']) {
      expect(create({ load, retry: { attempts } }), String(attempts)).toThrow(/attempts/);
    }
    expect(create({ load, retry: { attempts: 2, backoff: 100 } })).toThrow(/unknown retry option backoff/);
    for (const backoffMs of [-1, Number.POSITIVE_INFINITY, Number.NaN, '100']) {
      expect(create({ load, retry: { attempts: 2, backoffMs } }), String(backoffMs)).toThrow(/backoffMs/);
    }
    expect(create({ load, timers: { setTimeout: () => 0 } })).toThrow(/timers/);
    expect(create({ load, online: { isOnline: () => true } })).toThrow(/online/);
    expect(create({ load, online: null, retry: { attempts: 1, backoffMs: 0 } })).not.toThrow();
  });
});

describe('ContentLoader V1 — boundary', () => {
  test('src/content is renderer-, platform-, storage- and network-agnostic: no browser global, imports nothing outside itself', () => {
    const dir = fileURLToPath(new URL('../../src/content/', import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
    expect(files).toEqual(['ContentLoader.ts', 'index.ts']);
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden = /\b(window|document|navigator|globalThis|self|localStorage|sessionStorage|indexedDB|caches|serviceWorker|fetch|XMLHttpRequest|Image|Date|performance|requestAnimationFrame|setInterval|YaGames|ysdk|FBInstant|GSInstant|vkBridge|Assets|Texture|Spine)\b|pixi|spine|import\.meta|Math\.random/i;
    for (const name of files) {
      const source = strip(readFileSync(resolve(dir, name), 'utf-8'));
      expect(source.match(forbidden)?.[0] ?? null, name).toBeNull();
      for (const [, from] of source.matchAll(/from '([^']+)'/g)) expect(from!.startsWith('./'), `${name} imports ${from}`).toBe(true);
    }
  });

  test('the root entry exports the loader', () => {
    expect(typeof root.createContentLoader).toBe('function');
    expect(new root.ContentLoadError('aborted', 'g')).toBeInstanceOf(Error);
  });
});
