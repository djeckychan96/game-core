// AnalyticsRuntime v0.5 — public types of Game Core's renderer-independent analytics pipeline.
// The wire format is the Hazar ingest contract (POST /ingest, a JSON array of envelopes); the
// queue semantics follow Trail Arrow 0.1.22 `AnalyticsManager` (batches, 10 s cadence, cap 500,
// a failed batch is never lost). Nothing in this module knows a renderer, the DOM, a platform SDK,
// a storage, a wall clock or the network: the host injects the transport, the context, the
// optional queue store and the optional clock.

export type AnalyticsDevice = 'mobile' | 'desktop' | 'tablet';

/**
 * Hazar platform code (`p` of the envelope). The known production codes are listed for
 * autocomplete; DEV/TS builds and future platforms pass their own string.
 */
export type AnalyticsPlatform = 'YA' | 'VK' | 'OK' | 'FB' | 'AN' | 'MSS' | 'SAM' | 'DEV' | 'TS' | (string & {});

/** A JSON value — everything an event carries must survive `JSON.stringify`. */
export type AnalyticsValue = string | number | boolean | null | AnalyticsValue[] | { [key: string]: AnalyticsValue };

/** Event-specific data. `undefined` values are dropped when the envelope is built. */
export type AnalyticsEventData = { [key: string]: AnalyticsValue | undefined };

/** `event.data` of the envelope: the identity block every event carries + the event's own fields. */
export interface AnalyticsEnvelopeData {
  profile_id: string;
  installed_at?: number;
  device: AnalyticsDevice;
  platform_os?: string;
  config_name?: string;
  config_group?: string;
  [key: string]: AnalyticsValue | undefined;
}

/** One Hazar event exactly as it goes on the wire (the request body is an array of these). */
export interface AnalyticsEnvelope {
  app: string;
  p: string;
  event: {
    name: string;
    app_ver: string;
    build_ver?: number;
    /** Unix seconds the event was tracked at; present only when the host injected `now`. */
    created_at?: number;
    data: AnalyticsEnvelopeData;
  };
}

/**
 * Who is sending: read on every `track`, so a profile id that changes after the platform SDK
 * answers (local uuid → platform id) is picked up by the next event without any re-init.
 */
export interface AnalyticsContext {
  /** Hazar app id (`app`). */
  app: string;
  /** Hazar platform code (`p`). */
  platform: AnalyticsPlatform;
  /** The real build's version (`app_ver`) — from the host's build config, never hardcoded in Core. */
  appVersion: string;
  buildVersion?: number;
  /** Required on every event; an event tracked without it is rejected, never sent anonymous. */
  profileId: string;
  /** Unix seconds of the first launch. */
  installedAt?: number;
  device: AnalyticsDevice;
  platformOs?: string;
  /** A/B: remote config name and group; added to every event when present. Core never interprets them. */
  configName?: string;
  configGroup?: string;
  /**
   * Host-owned fields merged into every event's data (level, lives, is_noads, env, an `eid` for
   * server-side dedupe …). The event's own data wins over these; the identity block wins over both.
   */
  baseData?: AnalyticsEventData;
}

export type AnalyticsContextProvider = () => AnalyticsContext;

/**
 * Where batches go. Resolve = the batch was delivered (it is removed from the queue); reject =
 * it was not (it goes back to the head of the queue and the next flush retries it). Reject with
 * an `AnalyticsTransportError` whose `retryable` is false when the sink refused the payload for
 * good — that batch is dropped instead of blocking the queue forever.
 */
export interface AnalyticsTransport {
  send(events: AnalyticsEnvelope[]): Promise<void>;
}

/**
 * Optional persistence of the pending events (queued + in flight), so a closed tab or a network
 * outage does not lose them. `load` is read once in the constructor; `save` receives the whole
 * pending snapshot after every change (an adapter may debounce). A concrete localStorage adapter
 * is the host's concern; without a store the queue is memory-only.
 */
export interface AnalyticsQueueStore {
  load(): AnalyticsEnvelope[];
  save(events: AnalyticsEnvelope[]): void;
}

export type AnalyticsErrorPhase = 'context' | 'track' | 'send' | 'store_load' | 'store_save';

export interface AnalyticsErrorContext {
  phase: AnalyticsErrorPhase;
  /** The event being tracked (`context` / `track`). */
  eventName?: string;
  /** Size of the batch that failed (`send`). */
  events?: number;
  /** `send`: true when the batch was dropped (non-retryable), false when it went back to the queue. */
  dropped?: boolean;
}

export type AnalyticsErrorHandler = (error: unknown, context: AnalyticsErrorContext) => void;

export interface AnalyticsRuntimeOptions {
  transport: AnalyticsTransport;
  /** A fixed context, or a provider read on every `track`. */
  context: AnalyticsContext | AnalyticsContextProvider;
  store?: AnalyticsQueueStore;
  /** Server-anchored unix seconds (the same clock the host gives OfferRuntime). Stamps `created_at`; omitted → no stamp. */
  now?: () => number;
  /** Frame-time cadence of `update` → `flush`; default 10 000 ms. */
  flushIntervalMs?: number;
  /** Events per request; default 20. Reaching it triggers a flush without waiting for the cadence. */
  batchSize?: number;
  /** Queue cap; the oldest events are dropped beyond it. Default 500. */
  maxQueueSize?: number;
  /**
   * Frame time after which a `send` that never settled counts as failed (the batch is re-queued
   * and the pipeline unblocks). Default 30 000 ms; `Infinity` disables the watchdog.
   */
  sendTimeoutMs?: number;
  /** Where failures land; by default everything except `send` (expected offline) is `console.warn`ed. Analytics never throws into gameplay. */
  onError?: AnalyticsErrorHandler;
}

export interface AnalyticsTrackOptions {
  /** Flush right after queueing (install / session / loading: a short first session must not wait 10 s). */
  flush?: boolean;
}

export interface AnalyticsRuntimeStats {
  /** Events waiting in the queue (not counting the batch in flight). */
  queued: number;
  /** Events of the batch currently being sent. */
  inFlight: number;
  /** Events accepted by `track`. */
  tracked: number;
  /** Events refused: invalid name/context, or tracked after `dispose`. */
  rejected: number;
  /** Events delivered. */
  sent: number;
  /** Events lost to the queue cap or to a non-retryable batch. */
  dropped: number;
  /** Events restored from the store at construction. */
  restored: number;
  /** `flush` runs that actually started sending. */
  flushes: number;
  batchesSent: number;
  batchesFailed: number;
  /** The last flush failed; batch-size auto-flush is paused until a cadence/explicit flush succeeds. */
  lastFlushFailed: boolean;
  storeErrors: number;
  lastError: string | null;
  disposed: boolean;
}

// ---- typed events (Hazar names; camelCase in, snake_case on the wire) -------------------------

/** Hazar `event.name` of the base events every game sends. */
export const ANALYTICS_EVENTS = {
  INSTALL: 'install',
  SESSIONS: 'sessions',
  LOADING: 'loading',
  TUTORIAL: 'tutorial',
  LEVEL: 'level',
  UI_CLICK: 'ui_click',
  ADVERTISEMENT: 'advertisement',
  ECONOMY: 'economy',
  PURCHASE: 'purchase',
  LIVES_REFILL: 'lives_refill',
  INTERACTION: 'interaction'
} as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Every typed event takes game-specific extras in `data`; the typed fields win over them. */
interface AnalyticsEventExtras {
  data?: AnalyticsEventData;
}

export interface AnalyticsInstallEvent extends AnalyticsEventExtras {
  /** Launch payload / traffic source. */
  source?: string;
  referrer?: string;
}

export interface AnalyticsSessionEvent extends AnalyticsEventExtras {
  /** 1-based session counter, kept by the host. */
  sessionNumber: number;
}

export type AnalyticsLoadingStatus = 'start' | 'done' | 'fail' | (string & {});
export interface AnalyticsLoadingEvent extends AnalyticsEventExtras {
  /** `start`, `done`, or a host stage (`user_ok`, `data_ok` …). */
  status: AnalyticsLoadingStatus;
  loadMs?: number;
}

export interface AnalyticsTutorialEvent extends AnalyticsEventExtras {
  name: string;
  step: number;
  status: 'start' | 'complete' | 'skip';
}

export type AnalyticsLevelStatus = 'start' | 'win' | 'lose' | 'leave' | 'restart';
export interface AnalyticsLevelEvent extends AnalyticsEventExtras {
  level: number;
  levelId?: string;
  status: AnalyticsLevelStatus;
  durationMs?: number;
  difficulty?: string;
  levelType?: string;
  lossReason?: string;
}

export interface AnalyticsUiClickEvent extends AnalyticsEventExtras {
  button: string;
  screen?: string;
}

export type AnalyticsAdType = 'rewarded' | 'interstitial' | 'banner' | (string & {});
export type AnalyticsAdStatus = 'request' | 'show' | 'complete' | 'skip' | 'fail' | (string & {});
export interface AnalyticsAdvertisementEvent extends AnalyticsEventExtras {
  type: AnalyticsAdType;
  placement: string;
  status: AnalyticsAdStatus;
  revenue?: number;
  currency?: string;
}

export type AnalyticsEconomyAction = 'get' | 'spent' | (string & {});
export interface AnalyticsEconomyEvent extends AnalyticsEventExtras {
  /** Host-owned currency/resource id (`coins`, `hard`, `bulbs` …). */
  currency: string;
  action: AnalyticsEconomyAction;
  delta: number;
  /** Balance after the change. */
  balance: number;
  /** Where it came from / went to (`level_reward`, `shop`, `offer` …). */
  source?: string;
  /** What was bought or granted, when there is a specific object. */
  item?: string;
}

export type AnalyticsPurchaseStatus = 'success' | 'fail' | 'cancel' | 'restore' | (string & {});
export interface AnalyticsPurchaseEvent extends AnalyticsEventExtras {
  /** Hazar `offer_name`: what the player bought, in the game's naming. */
  offerName: string;
  /** Platform product id, when it differs from `offerName`. */
  productId?: string;
  revenue?: number;
  currency?: string;
  orderId?: string;
  status?: AnalyticsPurchaseStatus;
  /** Where the purchase started (`shop`, `offer_window`, `out_of_lives` …). */
  source?: string;
}

export interface AnalyticsLivesRefillEvent extends AnalyticsEventExtras {
  /** How the lives came back (`ad`, `coins`, `timer`, `purchase` …). */
  source: string;
  /** Lives added. */
  amount?: number;
  /** Lives after the refill. */
  lives?: number;
  /** Soft-currency price, when the refill was paid. */
  cost?: number;
}
