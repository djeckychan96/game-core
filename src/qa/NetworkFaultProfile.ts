// NetworkFaultProfile V1 — QA network simulation for the calls that go through it, and ONLY those:
// `profile.run(label, call)` or a platform wrapped with `withNetworkFaults`. It never patches `fetch`,
// `XMLHttpRequest`, timers or any other global — a request the game makes past the wrapper is real.
import type { GamePlatform, PlatformAdResult, PlatformAds, PlatformPayments, PlatformStorage } from '../platform/types';
import type { NetworkFaultMode, QaNetworkState } from './types';

export type NetworkFaultKind = 'offline' | 'fail_next';

export const NETWORK_FAULT_MODES: readonly NetworkFaultMode[] = ['normal', 'offline', 'latency'];
export const DEFAULT_QA_LATENCY_MS = 1000;
const MAX_LATENCY_MS = 60000;

/** What a simulated fault rejects with (a real network failure rejects too). */
export class NetworkFaultError extends Error {
  readonly fault: NetworkFaultKind;
  readonly call: string;
  constructor(fault: NetworkFaultKind, call: string) {
    super(`QA network ${fault === 'offline' ? 'OFFLINE' : 'FAIL_NEXT'}: ${call}`);
    this.name = 'NetworkFaultError';
    this.fault = fault;
    this.call = call;
  }
}

export const isNetworkFault = (error: unknown): error is NetworkFaultError => error instanceof NetworkFaultError;

export interface NetworkFaultProfileOptions {
  /** Waits `ms` (LATENCY). Default: a `setTimeout` promise — the only timer of the QA entry. */
  delay?: (ms: number) => Promise<void>;
  latencyMs?: number;
}

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    (globalThis as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout(resolve, ms);
  });

export const isLatencyMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LATENCY_MS;

export class NetworkFaultProfile {
  private modeValue: NetworkFaultMode = 'normal';
  private latency: number;
  private armed = false;
  private calls = 0;
  private faulted = 0;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(options: NetworkFaultProfileOptions = {}) {
    this.delay = options.delay ?? defaultDelay;
    const latency = options.latencyMs ?? DEFAULT_QA_LATENCY_MS;
    if (!isLatencyMs(latency)) throw new TypeError(`NetworkFaultProfile: latencyMs must be an integer 0…${MAX_LATENCY_MS}`);
    this.latency = latency;
  }

  get mode(): NetworkFaultMode {
    return this.modeValue;
  }

  /** NORMAL / OFFLINE / LATENCY (+ its delay). Throws on an unknown mode or a bad latency — the QA command validates first. */
  set(mode: NetworkFaultMode, latencyMs?: number): void {
    if (!NETWORK_FAULT_MODES.includes(mode)) throw new TypeError(`NetworkFaultProfile: unknown mode ${String(mode)}`);
    if (latencyMs !== undefined && !isLatencyMs(latencyMs)) throw new TypeError(`NetworkFaultProfile: latencyMs must be an integer 0…${MAX_LATENCY_MS}`);
    this.modeValue = mode;
    if (latencyMs !== undefined) this.latency = latencyMs;
  }

  /** The next call that reaches the network (not refused as OFFLINE) fails once. */
  failNext(armed = true): void {
    this.armed = armed;
  }

  snapshot(): QaNetworkState {
    return { mode: this.modeValue, latencyMs: this.latency, failNextArmed: this.armed, calls: this.calls, faulted: this.faulted, scope: 'core-platform' };
  }

  /** OFFLINE rejects at once; LATENCY waits first; an armed FAIL_NEXT rejects (after the wait) and disarms. */
  async gate(call: string): Promise<void> {
    this.calls += 1;
    if (this.modeValue === 'offline') {
      this.faulted += 1;
      throw new NetworkFaultError('offline', call);
    }
    if (this.modeValue === 'latency' && this.latency > 0) await this.delay(this.latency);
    if (this.armed) {
      this.armed = false;
      this.faulted += 1;
      throw new NetworkFaultError('fail_next', call);
    }
  }

  async run<T>(call: string, fn: () => Promise<T> | T): Promise<T> {
    await this.gate(call);
    return fn();
  }
}

function wrapStorage(storage: PlatformStorage, faults: NetworkFaultProfile): PlatformStorage {
  return {
    isCloud: () => storage.isCloud(),
    ready: () => storage.ready(),
    // a failed read REJECTS (the contract) — a fault too
    get: (keys) => faults.run('storage.get', () => storage.get(keys)),
    // `set` answers false for a write that was not confirmed
    set: (patch) => faults.gate('storage.set').then(() => storage.set(patch), (error: unknown) => {
      if (isNetworkFault(error)) return false;
      throw error;
    }),
    clear: (keys) => faults.run('storage.clear', () => storage.clear(keys))
  };
}

function wrapAds(ads: PlatformAds, faults: NetworkFaultProfile): PlatformAds {
  // both show methods always RESOLVE: OFFLINE = nothing to show (`no_fill`), FAIL_NEXT = the SDK failed (`error`)
  const show = (kind: 'showInterstitial' | 'showRewarded', placement: string): Promise<PlatformAdResult> =>
    faults.gate(`ads.${kind}`).then(() => ads[kind](placement), (error: unknown): PlatformAdResult => {
      if (!isNetworkFault(error)) throw error;
      return { status: error.fault === 'offline' ? 'no_fill' : 'error', rewarded: false, placement, raw: error.message };
    });
  const wrapped: PlatformAds = {
    showInterstitial: (placement) => show('showInterstitial', placement),
    showRewarded: (placement) => show('showRewarded', placement),
    isRewardedAvailable: () => ads.isRewardedAvailable()
  };
  if (ads.showBanner) {
    const showBanner = ads.showBanner.bind(ads);
    wrapped.showBanner = () => faults.gate('ads.showBanner').then(showBanner, (error: unknown) => {
      if (isNetworkFault(error)) return false;
      throw error;
    });
  }
  if (ads.hideBanner) wrapped.hideBanner = ads.hideBanner.bind(ads);
  return wrapped;
}

function wrapPayments(payments: PlatformPayments, faults: NetworkFaultProfile): PlatformPayments {
  // every payments call rejects on a fault — PurchaseRuntime reads a rejected purchase / restore as a platform failure
  const wrapped: PlatformPayments = {
    purchase: (productId) => faults.run('payments.purchase', () => payments.purchase(productId)),
    restore: () => faults.run('payments.restore', () => payments.restore()),
    getCatalog: () => faults.run('payments.getCatalog', () => payments.getCatalog())
  };
  if (payments.consume) {
    const consume = payments.consume.bind(payments);
    wrapped.consume = (purchase) => faults.run('payments.consume', () => consume(purchase));
  }
  if (payments.restoreGrant !== undefined) (wrapped as { restoreGrant?: PlatformPayments['restoreGrant'] }).restoreGrant = payments.restoreGrant;
  return wrapped;
}

/**
 * The QA-aware platform layer: the same platform, with its network capabilities (storage get / set / clear,
 * ad shows, payments) behind `faults`. Identity, environment, gameplay markers and lifecycle pass through
 * untouched. Build it only in a QA build — a production build hands the raw platform to the game.
 */
export function withNetworkFaults(platform: GamePlatform, faults: NetworkFaultProfile): GamePlatform {
  const wrapped: GamePlatform = {
    identity: platform.identity,
    environment: platform.environment,
    storage: wrapStorage(platform.storage, faults),
    gameplay: platform.gameplay
  };
  if (platform.ads) wrapped.ads = wrapAds(platform.ads, faults);
  if (platform.payments) wrapped.payments = wrapPayments(platform.payments, faults);
  if (platform.lifecycle) wrapped.lifecycle = platform.lifecycle;
  return wrapped;
}
