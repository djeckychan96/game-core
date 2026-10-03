# Content loader

`createContentLoader` (root entry `game-core`, V1) loads a game's content progressively, group by group:
what the current screen needs now, what the next one will need in the background. The game keeps its own
manifest — which items a screen, a chapter or a level needs — and its own way of loading ONE item; the
loader adds what every game writes again by hand:

- **one real load per item** — an item two groups (or two calls) want at the same time is loaded once;
- **group ownership** — `release(group)` unloads an item only when no other held group still needs it;
- **bounded retry** with a backoff, an optional wait for the network, and cancellation (`AbortSignal`);
- **progress and errors** the host shows its own UI from — the loader draws nothing.

It never knows what an item is (a URL, a manifest entry, a sound id …), has no cache of its own and no
renderer, platform or browser dependency: the online seam is injected, the timers default to the standard
`setTimeout`. Browser/CDN caching stays the host's.

## Example: the current group, the next one in the background, release the previous one

```ts
import { createContentLoader, ContentLoadError } from 'game-core';

const loader = createContentLoader<Asset, string>({
  load: (id, { signal }) => host.loadAsset(id, signal),     // ONE item; pass the signal on when you can
  unload: (id, asset) => host.freeAsset(id, asset),          // only when no held group needs it any more
  retry: { attempts: 3, backoffMs: (failed) => 500 * 2 ** (failed - 1) },
  online: browserOnline,                                     // optional, see below
  onRetry: ({ offline }) => host.showConnectionHint(offline)
});

// the current group: the screen waits for it
const assets = await loader.load('current', currentAssets, {
  onProgress: (loaded, total) => host.showProgress(loaded / total)
});

// the next group: in the background — never rejects, never blocks the current screen
void loader.prefetch('next', nextAssets);

// … the player moves on: an item the prefetch loaded (or is still loading) is not loaded again
const nextLoaded = await loader.load('next', nextAssets);
loader.release('current');   // items 'next' holds too stay loaded; the rest is unloaded
```

The group ids are the game's own (`'screen:menu'`, `'chapter:3'`, `'level:12'` …). A group that is loaded
twice is held once; the next transition is the same three steps with the ids shifted.

## Errors and UI

`load` rejects with a `ContentLoadError`:

| `reason` | `cancelled` | When |
|---|---|---|
| `failed` | false | some items could not be loaded after their attempts — `failures: [{ item, error, attempts }]` |
| `aborted` | true | the call's `signal` was aborted (`cause` = the signal's reason) |
| `released` | true | the group was released while the call was running |

The call waits for every item before it answers, so `failures` lists them all. What did load stays held
by the group: the group is not `ready` (`snapshot()` says `incomplete`), a new `load` of the same group
loads only what is missing, and `release` gives everything back.

```ts
try {
  await loader.load('current', currentAssets);
} catch (error) {
  if (error instanceof ContentLoadError && error.cancelled) return;    // the player left: nothing to show
  host.showRetryButton(() => loader.load('current', currentAssets));   // only the missing items load again
}
```

`prefetch` never rejects: it answers `true` once the group is loaded, `false` after a failure (also
reported to `onError`, phase `prefetch`), an abort or a release.

## Retry, network, cancellation

- `retry: { attempts, backoffMs? }` — `attempts` counts the first one (default 1 = no retry); `backoffMs` is
  a number or `(failedAttempt, error) => ms`. Every failure counts; after the last one the call rejects —
  there is no endless retry. A call that joins an item already loading shares its remaining attempts.
- `online: { isOnline(), subscribe(listener) → unsubscribe }` — after a failed attempt on a device that
  reports no connection, the next attempt first waits for the connection, then for the backoff; the wait
  spends no attempt and ends at once on abort or release. Default `null` (no wait). A browser host passes:

```ts
const browserOnline = {
  isOnline: () => navigator.onLine,
  subscribe: (listener: () => void) => {
    addEventListener('online', listener);
    return () => removeEventListener('online', listener);
  }
};
```

- `onRetry({ item, attempt, attempts, error, delayMs, offline })` — each failed attempt that will be
  retried, for a "connection lost, retrying…" line (`offline`: it is waiting for the network).
- Cancellation: `load(group, items, { signal })`. Aborting rejects that call; an item no other call waits for
  stops — its running attempt's `context.signal` is aborted and no new attempt starts. `release` does the
  same for its group. A host `load` that ignores the signal may still deliver: the value is kept for a group
  that still holds the item, or handed to `unload` (`reason: 'cancelled'`).
- A load of an item whose async `unload` is still running starts after that unload settles (a host cache can
  never hand out what is being freed); a cancelled attempt still running is joined, never doubled.
- `load` must settle: give a request that can hang its own timeout (e.g. combine `context.signal` with
  `AbortSignal.timeout(ms)`).

## API

| | |
|---|---|
| `createContentLoader<T, I = string>(options)` | `load(item, { signal, attempt })`, `unload?(item, value, { reason })`, `retry?`, `key?(item)` (identity; default the item itself), `timers?`, `online?`, `onRetry?`, `onError?(error, { phase, item?, groupId? })` — an unknown option is a TypeError |
| `loader.load(groupId, items, { signal?, onProgress? })` | `Promise<T[]>` in the order of `items` |
| `loader.prefetch(groupId, items, options?)` | `Promise<boolean>`, never rejects |
| `loader.release(groupId)` | `true`, or `false` for an unknown / already released group (safe to repeat) |
| `loader.snapshot()` | `{ groups: [{ id, status: 'ready' \| 'loading' \| 'incomplete', loaded, total }], items, loading }` |

Out of scope (V1): service workers, IndexedDB or any disk cache, CDN and URL versioning, chunked manifests,
asset compression, network priority, a concurrency limit, renderer (Pixi, Spine) or platform integration.
