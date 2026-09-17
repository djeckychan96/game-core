import type { CoreRuntimeModule } from '../core/CoreRuntime';
import { AnalyticsTransportError } from './AnalyticsTransportError';
import { ANALYTICS_EVENTS } from './types';
import type {
  AnalyticsAdvertisementEvent,
  AnalyticsContext,
  AnalyticsContextProvider,
  AnalyticsEconomyEvent,
  AnalyticsEnvelope,
  AnalyticsEnvelopeData,
  AnalyticsErrorContext,
  AnalyticsErrorHandler,
  AnalyticsEventData,
  AnalyticsInstallEvent,
  AnalyticsLevelEvent,
  AnalyticsLivesRefillEvent,
  AnalyticsLoadingEvent,
  AnalyticsPurchaseEvent,
  AnalyticsQueueStore,
  AnalyticsRuntimeOptions,
  AnalyticsRuntimeStats,
  AnalyticsSessionEvent,
  AnalyticsTrackOptions,
  AnalyticsTransport,
  AnalyticsTutorialEvent,
  AnalyticsUiClickEvent
} from './types';

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_QUEUE_SIZE = 500;
const DEFAULT_SEND_TIMEOUT_MS = 30_000;
const DEVICES: readonly string[] = ['mobile', 'desktop', 'tablet'];
const FLUSH_NOW: AnalyticsTrackOptions = { flush: true };

// Same shape as the other modules' default handlers — independently re-declared (module boundary
// rule). A failed `send` is expected in production (offline, ad blockers) and stays silent; it is
// still counted in the stats.
function defaultOnError(error: unknown, context: AnalyticsErrorContext): void {
  if (context.phase === 'send') return;
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[AnalyticsRuntime]', context, error);
  }
}

function positive(name: string, value: number, allowInfinity = false): number {
  if (!((Number.isFinite(value) || (allowInfinity && value === Infinity)) && value > 0)) {
    throw new RangeError(`AnalyticsRuntime: ${name} must be a number > 0`);
  }
  return value;
}

function isEnvelope(value: unknown): value is AnalyticsEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as Partial<AnalyticsEnvelope>;
  const event = envelope.event;
  return (
    typeof envelope.app === 'string' &&
    typeof envelope.p === 'string' &&
    typeof event === 'object' &&
    event !== null &&
    typeof event.name === 'string' &&
    typeof event.data === 'object' &&
    event.data !== null &&
    typeof event.data.profile_id === 'string' &&
    event.data.profile_id !== ''
  );
}

/** Copies the defined entries of `source` into `target` (an `undefined` never reaches the wire). */
function assignDefined(target: AnalyticsEnvelopeData, source: AnalyticsEventData | undefined): void {
  if (!source) return;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) target[key] = value;
  }
}

/**
 * Game Core's analytics pipeline: one API for the events Core itself produces (wired at
 * composition level, see `createOfferAnalyticsHandler`), for the base events every game sends
 * (typed helpers below) and for anything game-specific (`track`).
 *
 * - `track` builds the Hazar envelope from the injected context at that moment and queues it.
 *   `profile_id` is on every event; an event without one is rejected, never sent anonymous.
 * - Events leave in batches: on the `update(frameMs)` cadence (`flushIntervalMs` of frame time),
 *   when a full batch is waiting, or on an explicit `flush()` (host: `visibilitychange`, unload).
 *   There is no timer in here — `update` is the only clock, like every other CoreRuntime module.
 * - One `send` at a time. A failed batch goes back to the head of the queue and the next flush
 *   retries it; after a failure the batch-size trigger pauses (no request per event while offline)
 *   until a flush succeeds. A `send` that never settles is failed by frame time (`sendTimeoutMs`).
 * - The queue is capped (oldest dropped) and mirrored into the optional store after every change.
 * - Nothing here throws into gameplay: bad input and failures go to `onError` and the stats.
 */
export class AnalyticsRuntime implements CoreRuntimeModule {
  private readonly transport: AnalyticsTransport;
  private readonly context: AnalyticsContext | AnalyticsContextProvider;
  private readonly store: AnalyticsQueueStore | null;
  private readonly now: (() => number) | null;
  private readonly onError: AnalyticsErrorHandler;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly sendTimeoutMs: number;

  private queue: AnalyticsEnvelope[] = [];
  private inFlight: AnalyticsEnvelope[] = [];
  private flushPromise: Promise<void> | null = null;
  private failInFlight: ((error: Error) => void) | null = null;
  private accumulatorMs = 0;
  private inFlightMs = 0;
  private disposed = false;

  private tracked = 0;
  private rejected = 0;
  private sent = 0;
  private dropped = 0;
  private restored = 0;
  private flushes = 0;
  private batchesSent = 0;
  private batchesFailed = 0;
  private lastFlushFailed = false;
  private storeErrors = 0;
  private lastError: string | null = null;

  constructor(options: AnalyticsRuntimeOptions) {
    if (!options.transport || typeof options.transport.send !== 'function') {
      throw new RangeError('AnalyticsRuntime: options.transport is required');
    }
    if (!options.context) throw new RangeError('AnalyticsRuntime: options.context is required');
    this.transport = options.transport;
    this.context = options.context;
    this.store = options.store ?? null;
    this.now = options.now ?? null;
    this.onError = options.onError ?? defaultOnError;
    this.flushIntervalMs = positive('flushIntervalMs', options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.batchSize = Math.floor(positive('batchSize', options.batchSize ?? DEFAULT_BATCH_SIZE));
    this.maxQueueSize = Math.floor(positive('maxQueueSize', options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE));
    this.sendTimeoutMs = positive('sendTimeoutMs', options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS, true);
    if (this.batchSize < 1 || this.maxQueueSize < this.batchSize) {
      throw new RangeError('AnalyticsRuntime: need 1 ≤ batchSize ≤ maxQueueSize');
    }
    this.restore();
  }

  // ---- generic -------------------------------------------------------------------------------

  /**
   * Queues one event. Returns true when it was accepted. Never throws: an empty name, a context
   * without `app` / `platform` / `appVersion` / `profileId` / a valid `device`, or a disposed
   * runtime reject the event (`stats.rejected`, `onError`).
   */
  track(name: string, data?: AnalyticsEventData, options?: AnalyticsTrackOptions): boolean {
    if (this.disposed) {
      this.rejected++;
      return false;
    }
    const envelope = this.buildEnvelope(name, data);
    if (!envelope) {
      this.rejected++;
      return false;
    }
    this.tracked++;
    this.queue.push(envelope);
    this.enforceCap();
    this.persist();
    if (options?.flush === true || (this.queue.length >= this.batchSize && !this.lastFlushFailed)) void this.flush();
    return true;
  }

  // ---- base events (Hazar names) -------------------------------------------------------------

  /** `install` — once per device/profile lifetime; the "once" is the host's (it owns the storage). Flushes at once. */
  install(event: AnalyticsInstallEvent = {}): boolean {
    return this.track(ANALYTICS_EVENTS.INSTALL, { ...event.data, source: event.source, referrer: event.referrer }, FLUSH_NOW);
  }

  /** `sessions` — the session began. Flushes at once: a session shorter than the cadence must still be seen. */
  trackSessionStart(event: AnalyticsSessionEvent): boolean {
    return this.track(ANALYTICS_EVENTS.SESSIONS, { ...event.data, session_number: event.sessionNumber }, FLUSH_NOW);
  }

  /** `loading` with any status (`start`, `done`, or a host stage such as `user_ok`). Flushes at once. */
  loading(event: AnalyticsLoadingEvent): boolean {
    const loadMs = event.loadMs === undefined ? undefined : Math.max(0, Math.round(event.loadMs));
    return this.track(ANALYTICS_EVENTS.LOADING, { ...event.data, status: event.status, load_ms: loadMs }, FLUSH_NOW);
  }

  trackLoadingStart(data?: AnalyticsEventData): boolean {
    return this.loading(data ? { status: 'start', data } : { status: 'start' });
  }

  /** The game became interactive after `loadMs` (measured by the host — Core has no clock). */
  trackLoadingDone(loadMs: number, data?: AnalyticsEventData): boolean {
    return this.loading(data ? { status: 'done', loadMs, data } : { status: 'done', loadMs });
  }

  tutorial(event: AnalyticsTutorialEvent): boolean {
    return this.track(ANALYTICS_EVENTS.TUTORIAL, { ...event.data, name: event.name, step: event.step, status: event.status });
  }

  level(event: AnalyticsLevelEvent): boolean {
    return this.track(ANALYTICS_EVENTS.LEVEL, {
      ...event.data,
      level: event.level,
      level_id: event.levelId,
      status: event.status,
      duration_ms: event.durationMs === undefined ? undefined : Math.max(0, Math.round(event.durationMs)),
      difficulty: event.difficulty,
      level_type: event.levelType,
      loss_reason: event.lossReason
    });
  }

  uiClick(event: AnalyticsUiClickEvent): boolean {
    return this.track(ANALYTICS_EVENTS.UI_CLICK, { ...event.data, button: event.button, screen: event.screen });
  }

  /** `interaction` — named moments that are not a base event (`first_move`, `offer_activated` …). */
  interaction(action: string, data?: AnalyticsEventData): boolean {
    return this.track(ANALYTICS_EVENTS.INTERACTION, { ...data, action });
  }

  advertisement(event: AnalyticsAdvertisementEvent): boolean {
    return this.track(ANALYTICS_EVENTS.ADVERTISEMENT, {
      ...event.data,
      type: event.type,
      placement: event.placement,
      status: event.status,
      revenue: event.revenue,
      currency: event.currency
    });
  }

  economy(event: AnalyticsEconomyEvent): boolean {
    return this.track(ANALYTICS_EVENTS.ECONOMY, {
      ...event.data,
      currency: event.currency,
      action: event.action,
      delta: event.delta,
      balance: event.balance,
      source: event.source,
      item: event.item
    });
  }

  purchase(event: AnalyticsPurchaseEvent): boolean {
    return this.track(ANALYTICS_EVENTS.PURCHASE, {
      ...event.data,
      offer_name: event.offerName,
      product_id: event.productId,
      revenue: event.revenue,
      currency: event.currency,
      order_id: event.orderId,
      status: event.status,
      source: event.source
    });
  }

  livesRefill(event: AnalyticsLivesRefillEvent): boolean {
    return this.track(ANALYTICS_EVENTS.LIVES_REFILL, {
      ...event.data,
      source: event.source,
      amount: event.amount,
      lives: event.lives,
      cost: event.cost
    });
  }

  // ---- pipeline ------------------------------------------------------------------------------

  /**
   * Host frame: paces the flush cadence and the send watchdog by frame time. A long frame (the
   * tab was hidden) yields one flush, never a burst. Always returns false — analytics changes
   * nothing the host renders or saves.
   */
  update(frameMs: number): boolean {
    if (this.disposed) return false;
    const dt = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
    if (this.failInFlight) {
      this.inFlightMs += dt;
      if (this.inFlightMs >= this.sendTimeoutMs) {
        this.failInFlight(new Error(`AnalyticsRuntime: send did not settle within ${this.sendTimeoutMs} ms of frame time`));
      }
    }
    this.accumulatorMs += dt;
    if (this.accumulatorMs < this.flushIntervalMs) return false;
    this.accumulatorMs = 0;
    if (this.queue.length > 0) void this.flush();
    return false;
  }

  /**
   * Sends everything queued, batch by batch, one request at a time. Async-safe: while a flush is
   * running every call returns that same promise — sends never overlap. The promise never rejects;
   * it resolves when the queue is drained or a batch failed (that batch is back in the queue). The
   * first `send` is invoked synchronously, so a flush from `visibilitychange` starts its request
   * before the page goes away.
   */
  flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (this.disposed || this.queue.length === 0) return Promise.resolve();
    this.flushes++;
    let release!: () => void;
    // set before the first send so a transport that tracks/flushes re-entrantly joins this run
    this.flushPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = () => {
      this.flushPromise = null;
      release();
    };
    void this.drain().then(done, done);
    return this.flushPromise;
  }

  getStats(): AnalyticsRuntimeStats {
    return {
      queued: this.queue.length,
      inFlight: this.inFlight.length,
      tracked: this.tracked,
      rejected: this.rejected,
      sent: this.sent,
      dropped: this.dropped,
      restored: this.restored,
      flushes: this.flushes,
      batchesSent: this.batchesSent,
      batchesFailed: this.batchesFailed,
      lastFlushFailed: this.lastFlushFailed,
      storeErrors: this.storeErrors,
      lastError: this.lastError,
      disposed: this.disposed
    };
  }

  /**
   * Stops the pipeline: later `track` / `update` / `flush` do nothing. The pending events are
   * saved to the store one last time (the next session restores them); nothing is sent from here —
   * a host that wants a last delivery calls `flush()` first. A send already in flight still
   * settles its own bookkeeping (and the store), so a delivered batch is not restored as a duplicate.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.persist();
  }

  // ---- internals -----------------------------------------------------------------------------

  private async drain(): Promise<void> {
    while (!this.disposed && this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      this.inFlight = batch;
      this.inFlightMs = 0;
      try {
        await this.sendGuarded(batch);
      } catch (error) {
        this.failInFlight = null;
        this.inFlight = [];
        this.batchesFailed++;
        this.lastFlushFailed = true;
        this.lastError = error instanceof Error ? error.message : String(error);
        const drop = error instanceof AnalyticsTransportError && !error.retryable;
        if (drop) {
          this.dropped += batch.length;
        } else {
          // back to the head, order kept; the cap still holds (oldest go first)
          this.queue = batch.concat(this.queue);
          this.enforceCap();
        }
        this.persist();
        this.report(error, { phase: 'send', events: batch.length, dropped: drop });
        return;
      }
      this.failInFlight = null;
      this.inFlight = [];
      this.sent += batch.length;
      this.batchesSent++;
      this.lastFlushFailed = false;
      this.persist();
    }
  }

  /** `transport.send`, raced against the frame-time watchdog. A late settle of a timed-out send is ignored. */
  private sendGuarded(batch: AnalyticsEnvelope[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.failInFlight = reject;
      let pending: Promise<void>;
      try {
        pending = Promise.resolve(this.transport.send(batch.slice()));
      } catch (error) {
        reject(error);
        return;
      }
      pending.then(() => resolve(), reject);
    });
  }

  private buildEnvelope(name: string, data: AnalyticsEventData | undefined): AnalyticsEnvelope | null {
    if (typeof name !== 'string' || name === '') {
      this.report(new RangeError('AnalyticsRuntime: event name must be a non-empty string'), { phase: 'track', eventName: String(name) });
      return null;
    }
    let context: AnalyticsContext;
    try {
      context = typeof this.context === 'function' ? this.context() : this.context;
    } catch (error) {
      this.report(error, { phase: 'context', eventName: name });
      return null;
    }
    const missing = !context
      ? 'context'
      : (['app', 'platform', 'appVersion', 'profileId'] as const).find((key) => typeof context[key] !== 'string' || context[key] === '') ??
        (DEVICES.includes(context.device) ? null : 'device');
    if (missing) {
      this.report(new RangeError(`AnalyticsRuntime: context.${missing} is missing or invalid — "${name}" was not queued`), { phase: 'context', eventName: name });
      return null;
    }

    // host base fields < the event's own data < the identity block (never overridable)
    const payload = {} as AnalyticsEnvelopeData;
    assignDefined(payload, context.baseData);
    assignDefined(payload, data);
    payload.profile_id = context.profileId;
    payload.device = context.device;
    assignDefined(payload, {
      installed_at: context.installedAt,
      platform_os: context.platformOs,
      config_name: context.configName,
      config_group: context.configGroup
    });

    const event: AnalyticsEnvelope['event'] = { name, app_ver: context.appVersion, data: payload };
    if (context.buildVersion !== undefined) event.build_ver = context.buildVersion;
    if (this.now) {
      try {
        const at = this.now();
        if (Number.isFinite(at)) event.created_at = Math.floor(at);
      } catch (error) {
        this.report(error, { phase: 'track', eventName: name });
      }
    }
    return { app: context.app, p: context.platform, event };
  }

  private enforceCap(): void {
    const overflow = this.queue.length - this.maxQueueSize;
    if (overflow <= 0) return;
    this.queue.splice(0, overflow);
    this.dropped += overflow;
  }

  private restore(): void {
    if (!this.store) return;
    try {
      const saved = this.store.load();
      if (!Array.isArray(saved)) return;
      this.queue = saved.filter(isEnvelope);
      this.restored = this.queue.length;
      this.enforceCap();
    } catch (error) {
      this.storeErrors++;
      this.report(error, { phase: 'store_load' });
    }
  }

  private persist(): void {
    if (!this.store) return;
    try {
      this.store.save(this.inFlight.concat(this.queue));
    } catch (error) {
      this.storeErrors++;
      this.report(error, { phase: 'store_save' });
    }
  }

  private report(error: unknown, context: AnalyticsErrorContext): void {
    if (context.phase !== 'send') this.lastError = error instanceof Error ? error.message : String(error);
    try {
      this.onError(error, context);
    } catch {
      // an error handler can never take the pipeline down
    }
  }
}
