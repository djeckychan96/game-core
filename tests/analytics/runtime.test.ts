import { expect, test, vi } from 'vitest';
import { AnalyticsRuntime, AnalyticsTransportError } from '../../src/analytics';
import type { AnalyticsContext, AnalyticsEnvelope, AnalyticsErrorContext } from '../../src/analytics';
import { CoreRuntime } from '../../src/core/CoreRuntime';
import { FakeTransport, MemoryQueueStore, makeContext, settleMicrotasks } from './fixtures';

function make(options: Partial<ConstructorParameters<typeof AnalyticsRuntime>[0]> = {}) {
  const transport = new FakeTransport();
  const errors: Array<{ error: unknown; context: AnalyticsErrorContext }> = [];
  const analytics = new AnalyticsRuntime({
    transport,
    context: makeContext(),
    onError: (error, context) => errors.push({ error, context }),
    ...options
  });
  return { analytics, transport: (options.transport as FakeTransport | undefined) ?? transport, errors };
}

// ---- envelope --------------------------------------------------------------------------------

test('an event goes out as the Hazar envelope: app, p, event{name, app_ver, build_ver, data}', async () => {
  const { analytics, transport } = make();
  analytics.track('custom_event', { foo: 'bar', n: 3 });
  await analytics.flush();
  expect(transport.batches).toEqual([
    [
      {
        app: 'trail_arrow',
        p: 'YA',
        event: {
          name: 'custom_event',
          app_ver: '0.1.23',
          build_ver: 123,
          data: { foo: 'bar', n: 3, profile_id: 'profile-1', installed_at: 1_757_000_000, device: 'mobile', platform_os: 'android' }
        }
      }
    ]
  ]);
});

test('optional context fields are omitted, not sent as undefined/null', async () => {
  const { analytics, transport } = make({ context: { app: 'a', platform: 'DEV', appVersion: '1.0.0', profileId: 'p', device: 'desktop' } });
  analytics.track('e', { keep: 0, skip: undefined });
  await analytics.flush();
  const envelope = transport.batches[0]![0]!;
  expect(envelope).toEqual({ app: 'a', p: 'DEV', event: { name: 'e', app_ver: '1.0.0', data: { keep: 0, profile_id: 'p', device: 'desktop' } } });
  expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
});

test('profile_id is on every event — helpers and custom alike', async () => {
  const { analytics, transport } = make({ batchSize: 50 });
  analytics.install({ source: 'catalog' });
  analytics.trackSessionStart({ sessionNumber: 2 });
  analytics.trackLoadingStart();
  analytics.trackLoadingDone(1234.6);
  analytics.tutorial({ name: 'intro', step: 1, status: 'start' });
  analytics.level({ level: 1, status: 'start' });
  analytics.uiClick({ button: 'play' });
  analytics.interaction('first_move');
  analytics.advertisement({ type: 'rewarded', placement: 'lives', status: 'show' });
  analytics.economy({ currency: 'coins', action: 'get', delta: 10, balance: 110 });
  analytics.purchase({ offerName: 'starter_pack' });
  analytics.livesRefill({ source: 'ad' });
  analytics.track('custom');
  await analytics.flush();
  const all = transport.batches.flat();
  expect(all.map((e) => e.event.name)).toEqual([
    'install', 'sessions', 'loading', 'loading', 'tutorial', 'level', 'ui_click', 'interaction',
    'advertisement', 'economy', 'purchase', 'lives_refill', 'custom'
  ]);
  for (const envelope of all) {
    expect(envelope.event.data.profile_id).toBe('profile-1');
    expect(envelope.event.data.device).toBe('mobile');
    expect(envelope.event.app_ver).toBe('0.1.23');
  }
});

test('an event without profile_id (or app / platform / app_ver / device) is rejected, never sent anonymous', async () => {
  const broken: Array<Partial<AnalyticsContext>> = [
    { profileId: '' },
    { app: '' },
    { platform: '' },
    { appVersion: '' },
    { device: 'console' as AnalyticsContext['device'] }
  ];
  for (const patch of broken) {
    const { analytics, transport, errors } = make({ context: makeContext(patch) });
    expect(analytics.track('level', { status: 'start' })).toBe(false);
    await analytics.flush();
    expect(transport.batches).toEqual([]);
    expect(analytics.getStats()).toMatchObject({ tracked: 0, rejected: 1, queued: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.context).toEqual({ phase: 'context', eventName: 'level' });
  }
});

test('the context provider is read on every track: a profile id that changes mid-session is picked up, app_ver is the host build', async () => {
  const context = makeContext({ profileId: 'local-uuid', appVersion: '2.5.0', buildVersion: 77 });
  const provider = vi.fn(() => context);
  const { analytics, transport } = make({ context: provider });
  analytics.track('a');
  context.profileId = 'ya-777';
  analytics.track('b');
  await analytics.flush();
  expect(provider).toHaveBeenCalledTimes(2);
  const [a, b] = transport.batches[0]!;
  expect([a!.event.data.profile_id, b!.event.data.profile_id]).toEqual(['local-uuid', 'ya-777']);
  expect([a!.event.app_ver, a!.event.build_ver]).toEqual(['2.5.0', 77]);
});

test('merge order: baseData < event data < identity block', async () => {
  const { analytics, transport } = make({
    context: makeContext({ baseData: { level: 5, lives: 3, env: 'test', profile_id: 'from-base' } })
  });
  analytics.track('e', { level: 9, profile_id: 'from-event', device: 'tablet', custom: true });
  await analytics.flush();
  expect(transport.batches[0]![0]!.event.data).toEqual({
    level: 9, lives: 3, env: 'test', custom: true,
    profile_id: 'profile-1', device: 'mobile', installed_at: 1_757_000_000, platform_os: 'android'
  });
});

test('a throwing context provider or an empty name rejects the event without throwing into gameplay', () => {
  const { analytics, errors } = make({
    context: () => {
      throw new Error('sdk not ready');
    }
  });
  expect(analytics.track('e')).toBe(false);
  expect(errors[0]!.context).toEqual({ phase: 'context', eventName: 'e' });
  const ok = make();
  expect(ok.analytics.track('')).toBe(false);
  expect(ok.errors[0]!.context.phase).toBe('track');
  expect(ok.analytics.getStats().rejected).toBe(1);
});

test('config_name / config_group ride on every event when the context has them, and only then', async () => {
  const context = makeContext();
  const { analytics, transport } = make({ context: () => context });
  analytics.track('before');
  context.configName = 'offers_v2';
  context.configGroup = 'control';
  analytics.track('after');
  analytics.level({ level: 3, status: 'start', data: { config_group: 'spoofed' } });
  await analytics.flush();
  const [before, after, level] = transport.batches[0]!;
  expect('config_name' in before!.event.data || 'config_group' in before!.event.data).toBe(false);
  expect(after!.event.data).toMatchObject({ config_name: 'offers_v2', config_group: 'control' });
  expect(level!.event.data).toMatchObject({ config_name: 'offers_v2', config_group: 'control' });
});

test('created_at is stamped from the injected clock only — no clock, no stamp', async () => {
  const clock = { now: 1_758_100_000.9 };
  const { analytics, transport } = make({ now: () => clock.now });
  analytics.track('a');
  clock.now += 60;
  analytics.track('b');
  await analytics.flush();
  expect(transport.batches[0]!.map((e) => e.event.created_at)).toEqual([1_758_100_000, 1_758_100_060]);
  const bare = make();
  bare.analytics.track('a');
  await bare.analytics.flush();
  expect('created_at' in bare.transport.batches[0]![0]!.event).toBe(false);
});

// ---- batching / cadence ------------------------------------------------------------------------

test('events accumulate and leave as one batch on the update cadence, not one by one', async () => {
  const { analytics, transport } = make();
  analytics.track('a');
  analytics.track('b');
  analytics.track('c');
  expect(transport.batches).toEqual([]);
  for (let i = 0; i < 599; i++) analytics.update(16.6); // 9 943 ms
  expect(transport.batches).toEqual([]);
  analytics.update(60); // crosses 10 000 ms
  await analytics.flush();
  expect(transport.names()).toEqual([['a', 'b', 'c']]);
  expect(analytics.getStats()).toMatchObject({ queued: 0, sent: 3, batchesSent: 1, flushes: 1 });
});

test('the cadence is configurable, a long frame yields one flush, garbage frame times are ignored, update returns false', async () => {
  const { analytics, transport } = make({ flushIntervalMs: 1000 });
  analytics.track('a');
  expect(analytics.update(Number.NaN)).toBe(false);
  expect(analytics.update(-50)).toBe(false);
  expect(analytics.update(Number.POSITIVE_INFINITY)).toBe(false);
  expect(transport.batches).toHaveLength(0);
  expect(analytics.update(60_000)).toBe(false); // the tab was hidden for a minute
  await analytics.flush();
  expect(transport.batches).toHaveLength(1);
  analytics.update(999);
  analytics.track('b');
  analytics.update(0.5);
  expect(transport.batches).toHaveLength(1);
  analytics.update(1);
  await analytics.flush();
  expect(transport.names()).toEqual([['a'], ['b']]);
});

test('an empty queue never produces a request', async () => {
  const { analytics, transport } = make({ flushIntervalMs: 100 });
  analytics.update(1000);
  await analytics.flush();
  expect(transport.batches).toEqual([]);
  expect(analytics.getStats().flushes).toBe(0);
});

test('a flush splits the queue into batches of batchSize, in order', async () => {
  const { analytics, transport } = make({ batchSize: 3 });
  transport.mode = 'fail'; // keep the batch-size trigger quiet while the queue fills
  analytics.track('e0');
  analytics.track('e1');
  analytics.track('e2');
  await analytics.flush();
  transport.mode = 'ok';
  transport.batches.length = 0;
  for (let i = 3; i < 8; i++) analytics.track(`e${i}`);
  await analytics.flush();
  expect(transport.names()).toEqual([['e0', 'e1', 'e2'], ['e3', 'e4', 'e5'], ['e6', 'e7']]);
  expect(analytics.getStats()).toMatchObject({ queued: 0, sent: 8, batchesSent: 3 });
});

test('a full batch leaves at once without waiting for the cadence; default batch size is 20', async () => {
  const { analytics, transport } = make();
  for (let i = 0; i < 19; i++) analytics.track(`e${i}`);
  expect(transport.batches).toHaveLength(0);
  analytics.track('e19');
  expect(transport.batches).toHaveLength(1); // the send starts synchronously
  await analytics.flush();
  expect(transport.batches[0]).toHaveLength(20);
  expect(analytics.getStats().queued).toBe(0);
});

test('install / session / loading flush at once (a short first session must not wait for the cadence)', async () => {
  const { analytics, transport } = make();
  analytics.trackSessionStart({ sessionNumber: 1 });
  expect(transport.batches).toHaveLength(1);
  await analytics.flush();
  expect(transport.batches[0]![0]!.event).toMatchObject({ name: 'sessions', data: { session_number: 1 } });
  analytics.trackLoadingDone(812.4);
  await analytics.flush();
  expect(transport.batches[1]![0]!.event).toMatchObject({ name: 'loading', data: { status: 'done', load_ms: 812 } });
});

// ---- delivery ---------------------------------------------------------------------------------

test('a delivered batch is removed from the queue', async () => {
  const { analytics, transport } = make();
  analytics.track('a');
  analytics.track('b');
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 0, inFlight: 0, sent: 2, batchesSent: 1, batchesFailed: 0, lastFlushFailed: false });
  await analytics.flush();
  expect(transport.batches).toHaveLength(1);
});

test('a network error loses nothing: the batch returns to the head and the next flush retries it, in order', async () => {
  const { analytics, transport, errors } = make({ batchSize: 2 });
  transport.mode = 'fail';
  analytics.track('a');
  analytics.track('b'); // full batch → send → fails
  await analytics.flush();
  analytics.track('c');
  expect(analytics.getStats()).toMatchObject({ queued: 3, sent: 0, batchesFailed: 1, lastFlushFailed: true, lastError: 'network down' });
  expect(errors.map((e) => e.context)).toEqual([{ phase: 'send', events: 2, dropped: false }]);
  transport.mode = 'ok';
  await analytics.flush();
  expect(transport.names()).toEqual([['a', 'b'], ['a', 'b'], ['c']]);
  expect(analytics.getStats()).toMatchObject({ queued: 0, sent: 3, lastFlushFailed: false });
});

test('a failed flush stops at the failed batch and pauses the batch-size trigger until a flush succeeds', async () => {
  const { analytics, transport } = make({ batchSize: 2, flushIntervalMs: 1000 });
  transport.mode = 'fail';
  analytics.track('a');
  analytics.track('b');
  await analytics.flush();
  expect(transport.batches).toHaveLength(1);
  for (let i = 0; i < 6; i++) analytics.track(`offline${i}`); // no request per event while offline
  await settleMicrotasks();
  expect(transport.batches).toHaveLength(1);
  analytics.update(1000); // the cadence retries: one attempt, stops at the first failure
  await analytics.flush();
  expect(transport.batches).toHaveLength(2);
  transport.mode = 'ok';
  analytics.update(1000);
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 0, sent: 8 });
  analytics.track('x');
  analytics.track('y'); // the trigger is armed again
  expect(transport.batches.at(-1)!.map((e) => e.event.name)).toEqual(['x', 'y']);
});

test('a synchronously throwing transport is a failed send, not an exception in gameplay', async () => {
  const { analytics, errors } = make({
    transport: { send: () => { throw new Error('boom'); } }
  });
  analytics.track('a');
  await expect(analytics.flush()).resolves.toBeUndefined();
  expect(analytics.getStats()).toMatchObject({ queued: 1, batchesFailed: 1, lastError: 'boom' });
  expect(errors[0]!.context.phase).toBe('send');
});

test('a non-retryable transport error drops the poisoned batch instead of blocking the queue', async () => {
  const { analytics, transport, errors } = make({ batchSize: 2 });
  transport.mode = 'fail';
  transport.error = new AnalyticsTransportError('Hazar ingest: HTTP 400', { retryable: false, status: 400 });
  analytics.track('bad1');
  analytics.track('bad2');
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 0, dropped: 2, batchesFailed: 1 });
  expect(errors[0]!.context).toEqual({ phase: 'send', events: 2, dropped: true });
  transport.mode = 'ok';
  analytics.track('good');
  await analytics.flush();
  expect(transport.names().at(-1)).toEqual(['good']);
});

test('flush is async-safe: concurrent calls share one run and sends never overlap', async () => {
  const { analytics, transport } = make({ batchSize: 2, flushIntervalMs: 1000 });
  transport.mode = 'manual';
  analytics.track('a');
  analytics.track('b'); // starts the flush
  const first = analytics.flush();
  const second = analytics.flush();
  expect(second).toBe(first);
  analytics.track('c');
  analytics.track('d'); // full batch again while a send is in flight
  analytics.update(1000); // the cadence too
  expect(transport.batches).toHaveLength(1);
  expect(analytics.getStats()).toMatchObject({ inFlight: 2, queued: 2, flushes: 1 });
  transport.settle();
  await settleMicrotasks();
  expect(transport.batches).toHaveLength(2); // the same run picked the next batch up
  transport.settle();
  await first;
  expect(transport.maxActive).toBe(1);
  expect(transport.names()).toEqual([['a', 'b'], ['c', 'd']]);
  expect(analytics.getStats()).toMatchObject({ inFlight: 0, queued: 0, sent: 4, flushes: 1 });
});

test('a transport that tracks re-entrantly from send() joins the running flush', async () => {
  const batches: string[][] = [];
  let analytics!: AnalyticsRuntime;
  let reentered = false;
  analytics = new AnalyticsRuntime({
    context: makeContext(),
    transport: {
      send: (events) => {
        batches.push(events.map((e) => e.event.name));
        if (!reentered) {
          reentered = true;
          analytics.track('from_send', {}, { flush: true });
        }
        return Promise.resolve();
      }
    }
  });
  analytics.track('a', {}, { flush: true });
  await analytics.flush();
  expect(batches).toEqual([['a'], ['from_send']]);
  expect(analytics.getStats().flushes).toBe(1);
});

test('a send that never settles is failed by frame time, the batch is re-queued and the pipeline unblocks', async () => {
  const { analytics, transport, errors } = make({ sendTimeoutMs: 5000, flushIntervalMs: 60_000 });
  transport.mode = 'manual';
  analytics.track('a', {}, { flush: true });
  analytics.update(4999);
  await settleMicrotasks();
  expect(analytics.getStats()).toMatchObject({ inFlight: 1, batchesFailed: 0 });
  analytics.update(1);
  await settleMicrotasks();
  expect(analytics.getStats()).toMatchObject({ inFlight: 0, queued: 1, batchesFailed: 1 });
  expect(String((errors[0]!.error as Error).message)).toContain('5000 ms');
  transport.settle(); // the late answer of the abandoned send changes nothing
  await settleMicrotasks();
  expect(analytics.getStats()).toMatchObject({ queued: 1, sent: 0 });
  transport.mode = 'ok';
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 0, sent: 1 });
});

test('the queue is capped: the oldest events are dropped, the newest kept', async () => {
  const { analytics, transport } = make({ maxQueueSize: 5, batchSize: 5 });
  transport.mode = 'fail';
  for (let i = 0; i < 5; i++) analytics.track(`e${i}`);
  await analytics.flush(); // fails → trigger paused, queue keeps growing
  for (let i = 5; i < 8; i++) analytics.track(`e${i}`);
  expect(analytics.getStats()).toMatchObject({ queued: 5, dropped: 3, tracked: 8 });
  transport.mode = 'ok';
  transport.batches.length = 0;
  await analytics.flush();
  expect(transport.names()).toEqual([['e3', 'e4', 'e5', 'e6', 'e7']]);
});

test('default cap is 500', () => {
  const { analytics, transport } = make();
  transport.mode = 'manual'; // the first full batch stays in flight, the rest piles up
  for (let i = 0; i < 20 + 510; i++) analytics.track('e');
  expect(analytics.getStats()).toMatchObject({ inFlight: 20, queued: 500, dropped: 10 });
});

// ---- store ------------------------------------------------------------------------------------

test('without a store the runtime is memory-only', async () => {
  const { analytics } = make();
  analytics.track('a');
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ sent: 1, storeErrors: 0, restored: 0 });
});

test('the store is restored at construction and the restored events are sent first', async () => {
  const leftover = (name: string): AnalyticsEnvelope => ({
    app: 'trail_arrow', p: 'YA', event: { name, app_ver: '0.1.22', data: { profile_id: 'profile-1', device: 'mobile' } }
  });
  const store = new MemoryQueueStore([leftover('old1'), leftover('old2'), { junk: true } as unknown as AnalyticsEnvelope]);
  const { analytics, transport } = make({ store });
  expect(analytics.getStats()).toMatchObject({ restored: 2, queued: 2 });
  analytics.track('new');
  await analytics.flush();
  expect(transport.names()).toEqual([['old1', 'old2', 'new']]);
  expect(transport.batches[0]![0]!.event.app_ver).toBe('0.1.22'); // sent as it was tracked, not re-stamped
  expect(store.saved).toEqual([]);
});

test('the store mirrors the pending events: after a track, while in flight, after success and after failure', async () => {
  const store = new MemoryQueueStore();
  const { analytics, transport } = make({ store });
  transport.mode = 'manual';
  analytics.track('a');
  analytics.track('b');
  expect(store.saved.map((e) => e.event.name)).toEqual(['a', 'b']);
  const run = analytics.flush();
  analytics.track('c'); // a tab killed right now must not lose the in-flight batch either
  expect(store.saved.map((e) => e.event.name)).toEqual(['a', 'b', 'c']);
  transport.error = new Error('offline');
  transport.settle(false);
  await run;
  expect(store.saved.map((e) => e.event.name)).toEqual(['a', 'b', 'c']);
  transport.mode = 'ok';
  await analytics.flush();
  expect(store.saved).toEqual([]);
});

test('a broken store never breaks analytics: load/save errors are reported and counted', async () => {
  const errors: string[] = [];
  const analytics = new AnalyticsRuntime({
    transport: new FakeTransport(),
    context: makeContext(),
    store: {
      load: () => { throw new Error('private mode'); },
      save: () => { throw new Error('quota'); }
    },
    onError: (_error, context) => errors.push(context.phase)
  });
  expect(analytics.track('a')).toBe(true);
  await analytics.flush();
  expect(errors).toEqual(['store_load', 'store_save', 'store_save']);
  expect(analytics.getStats()).toMatchObject({ sent: 1, storeErrors: 3 });
});

// ---- typed helpers ----------------------------------------------------------------------------

test('level helper: start / win with duration, extras under the typed fields', async () => {
  const { analytics, transport } = make();
  analytics.level({ level: 12, levelId: 'lvl_012', status: 'start' });
  analytics.level({ level: 12, levelId: 'lvl_012', status: 'win', durationMs: 45_678.4, difficulty: 'hard', levelType: 'common', data: { moves: 31, status: 'spoofed' } });
  analytics.level({ level: 12, status: 'lose', lossReason: 'no_space' });
  await analytics.flush();
  const [start, win, lose] = transport.batches[0]!.map((e) => e.event);
  expect(start).toMatchObject({ name: 'level', data: { level: 12, level_id: 'lvl_012', status: 'start' } });
  expect('duration_ms' in start!.data).toBe(false);
  expect(win!.data).toMatchObject({ status: 'win', duration_ms: 45_678, difficulty: 'hard', level_type: 'common', moves: 31 });
  expect(lose!.data).toMatchObject({ status: 'lose', loss_reason: 'no_space' });
});

test('purchase helper carries what PurchaseRuntime will report: offer_name, revenue, currency, order_id, status, source', async () => {
  const { analytics, transport } = make();
  analytics.purchase({ offerName: 'starter_pack', productId: 'starter_pack_ya', revenue: 0.99, currency: 'USD', orderId: 'ord-1', status: 'success', source: 'offer_window' });
  analytics.purchase({ offerName: 'coins_1' });
  await analytics.flush();
  const [full, minimal] = transport.batches[0]!.map((e) => e.event);
  expect(full).toMatchObject({
    name: 'purchase',
    data: { offer_name: 'starter_pack', product_id: 'starter_pack_ya', revenue: 0.99, currency: 'USD', order_id: 'ord-1', status: 'success', source: 'offer_window' }
  });
  expect(Object.keys(minimal!.data).sort()).toEqual(['device', 'installed_at', 'offer_name', 'platform_os', 'profile_id']);
});

test('advertisement helper: type, placement, status (+ revenue when the platform reports it)', async () => {
  const { analytics, transport } = make();
  analytics.advertisement({ type: 'rewarded', placement: 'refill_lives', status: 'complete' });
  analytics.advertisement({ type: 'interstitial', placement: 'level_end', status: 'show', revenue: 0.002, currency: 'USD' });
  await analytics.flush();
  const [rewarded, inter] = transport.batches[0]!.map((e) => e.event);
  expect(rewarded).toMatchObject({ name: 'advertisement', data: { type: 'rewarded', placement: 'refill_lives', status: 'complete' } });
  expect(inter!.data).toMatchObject({ type: 'interstitial', placement: 'level_end', status: 'show', revenue: 0.002, currency: 'USD' });
});

test('economy / tutorial / ui_click / lives_refill / install / interaction helpers keep the Hazar names and fields', async () => {
  const { analytics, transport } = make({ batchSize: 50 });
  analytics.economy({ currency: 'coins', action: 'spent', delta: -900, balance: 100, source: 'refill_lives', item: 'lives' });
  analytics.tutorial({ name: 'intro', step: 2, status: 'complete' });
  analytics.uiClick({ button: 'play', screen: 'map' });
  analytics.livesRefill({ source: 'coins', amount: 5, lives: 5, cost: 900 });
  analytics.interaction('first_move', { level: 1 });
  analytics.install({ source: 'catalog', referrer: 'https://yandex.ru/games' });
  await analytics.flush();
  expect(transport.batches.flat().map((e) => [e.event.name, e.event.data])).toMatchObject([
    ['economy', { currency: 'coins', action: 'spent', delta: -900, balance: 100, source: 'refill_lives', item: 'lives' }],
    ['tutorial', { name: 'intro', step: 2, status: 'complete' }],
    ['ui_click', { button: 'play', screen: 'map' }],
    ['lives_refill', { source: 'coins', amount: 5, lives: 5, cost: 900 }],
    ['interaction', { action: 'first_move', level: 1 }],
    ['install', { source: 'catalog', referrer: 'https://yandex.ru/games' }]
  ]);
});

test('custom track stays available for anything game-specific', async () => {
  const { analytics, transport } = make();
  expect(analytics.track('booster_used', { booster: 'bulb', left: 2, board: { cols: 6, filled: [1, 2, 3] } })).toBe(true);
  await analytics.flush();
  expect(transport.batches[0]![0]!.event).toMatchObject({ name: 'booster_used', data: { booster: 'bulb', left: 2, board: { cols: 6, filled: [1, 2, 3] } } });
});

// ---- lifecycle --------------------------------------------------------------------------------

test('dispose: pending events are saved for the next session, nothing is tracked, flushed or paced afterwards', async () => {
  const store = new MemoryQueueStore();
  const { analytics, transport } = make({ store, flushIntervalMs: 100 });
  analytics.track('a');
  const saves = store.saves;
  analytics.dispose();
  analytics.dispose();
  expect(store.saves).toBe(saves + 1);
  expect(store.saved.map((e) => e.event.name)).toEqual(['a']);
  expect(analytics.track('late')).toBe(false);
  expect(analytics.update(10_000)).toBe(false);
  await analytics.flush();
  expect(transport.batches).toEqual([]);
  expect(analytics.getStats()).toMatchObject({ disposed: true, queued: 1, rejected: 1 });
  // the next session picks the saved events up
  const next = make({ store });
  await next.analytics.flush();
  expect(next.transport.names()).toEqual([['a']]);
});

test('dispose during a send: the delivered batch leaves the store, the rest stays for the next session', async () => {
  const store = new MemoryQueueStore();
  const { analytics, transport } = make({ store, batchSize: 2 });
  transport.mode = 'manual';
  analytics.track('a');
  analytics.track('b');
  analytics.track('c');
  analytics.dispose();
  expect(store.saved.map((e) => e.event.name)).toEqual(['a', 'b', 'c']);
  transport.settle();
  await settleMicrotasks();
  expect(store.saved.map((e) => e.event.name)).toEqual(['c']);
  expect(transport.batches).toHaveLength(1); // no further batch after dispose
});

test('registers as a CoreRuntime module: core.update paces the flush, core.getStats and core.dispose reach it', async () => {
  const { analytics, transport } = make({ flushIntervalMs: 500 });
  const core = new CoreRuntime();
  core.registerRuntime('analytics', analytics);
  analytics.track('a');
  core.update(499);
  expect(transport.batches).toHaveLength(0);
  core.update(1);
  await analytics.flush();
  expect(transport.batches).toHaveLength(1);
  expect(core.getStats().analytics).toMatchObject({ sent: 1 });
  core.dispose();
  expect(analytics.getStats().disposed).toBe(true);
});

test('constructor validates its options', () => {
  const transport = new FakeTransport();
  const context = makeContext();
  expect(() => new AnalyticsRuntime({ transport: undefined as never, context })).toThrow(RangeError);
  expect(() => new AnalyticsRuntime({ transport, context: undefined as never })).toThrow(RangeError);
  expect(() => new AnalyticsRuntime({ transport, context, flushIntervalMs: 0 })).toThrow(RangeError);
  expect(() => new AnalyticsRuntime({ transport, context, batchSize: 0 })).toThrow(RangeError);
  expect(() => new AnalyticsRuntime({ transport, context, batchSize: 50, maxQueueSize: 10 })).toThrow(RangeError);
  expect(() => new AnalyticsRuntime({ transport, context, sendTimeoutMs: -1 })).toThrow(RangeError);
  expect(() => new AnalyticsRuntime({ transport, context, sendTimeoutMs: Infinity })).not.toThrow();
});
