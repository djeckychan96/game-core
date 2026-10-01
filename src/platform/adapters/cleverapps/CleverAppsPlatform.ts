import { createAdWatchdog } from '../../support/adWatchdog';
import type { PlatformVisibility } from '../../support/adWatchdog';
import { defaultPlatformTimers, withTimeout } from '../../support/withTimeout';
import type { PlatformTimers } from '../../support/withTimeout';
import type {
  GamePlatform,
  PlatformAdResult,
  PlatformAds,
  PlatformEnvironment,
  PlatformGameplay,
  PlatformIdentity,
  PlatformStorage
} from '../../types';
import { initCleverAppsConnector } from './sdk';
import type { CleverAppsAdsApi, CleverAppsConnector } from './sdk';

export const CLEVERAPPS_TIMEOUTS = {
  init: 20000,
  playerReady: 10000,
  storageReady: 10000,
  storageLoad: 10000,
  storageSet: 10000,
  startGame: 20000,
  adShow: 120000
} as const;

export const CLEVERAPPS_STORAGE_VERSION = 1 as const;

export type CleverAppsDiagnosticCode =
  | 'player_unavailable'
  | 'storage_load_failed'
  | 'storage_write_failed'
  | 'gameplay_failed'
  | 'ad_listener_failed';

export interface CleverAppsPlatformOptions {
  /** Structural boot seam. Production defaults to the host-owned global connector.latest.js. */
  init?: () => PromiseLike<CleverAppsConnector>;
  onDiagnostic?: (code: CleverAppsDiagnosticCode, detail?: unknown) => void;
  timers?: PlatformTimers;
  /** Default document visibility; tests and non-DOM hosts may inject null. */
  visibility?: PlatformVisibility | null;
}

interface StorageEnvelope {
  gcStorageVersion: typeof CLEVERAPPS_STORAGE_VERSION;
  deleted: boolean;
  value?: unknown;
}

interface PendingAd {
  readonly placement: string;
  readonly promise: Promise<PlatformAdResult>;
  finish(result: PlatformAdResult): void;
}

interface PendingRewarded extends PendingAd {
  rewarded: boolean;
}

const envelope = (value: unknown): StorageEnvelope => ({ gcStorageVersion: CLEVERAPPS_STORAGE_VERSION, deleted: false, value });
const tombstone = (): StorageEnvelope => ({ gcStorageVersion: CLEVERAPPS_STORAGE_VERSION, deleted: true });

function unwrap(value: unknown): { present: boolean; value?: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { present: true, value };
  const candidate = value as Partial<StorageEnvelope>;
  if (candidate.gcStorageVersion !== CLEVERAPPS_STORAGE_VERSION || typeof candidate.deleted !== 'boolean') {
    return { present: true, value };
  }
  return candidate.deleted ? { present: false } : { present: true, value: candidate.value };
}

const timeoutResult = (placement: string): PlatformAdResult => ({ status: 'timeout', rewarded: false, placement });
const noFillResult = (placement: string, raw?: unknown): PlatformAdResult => ({
  status: 'no_fill',
  rewarded: false,
  placement,
  ...(raw === undefined ? {} : { raw })
});
const errorResult = (placement: string, raw: unknown): PlatformAdResult => ({ status: 'error', rewarded: false, placement, raw });

export class CleverAppsPlatform implements GamePlatform {
  readonly identity: PlatformIdentity;
  readonly environment: PlatformEnvironment;
  readonly storage: PlatformStorage;
  readonly gameplay: PlatformGameplay;
  readonly ads: PlatformAds;

  private readonly options: CleverAppsPlatformOptions;
  private readonly timers: PlatformTimers;
  private connector: CleverAppsConnector | null = null;
  private connectorPromise: Promise<CleverAppsConnector> | null = null;
  private identityPromise: Promise<void> | null = null;
  private storagePromise: Promise<void> | null = null;
  private gameplayPromise: Promise<void> | null = null;
  private adListenersInstalled = false;
  private readonly adListeners: Array<[string, (...args: unknown[]) => void]> = [];
  private pendingRewarded: PendingRewarded | null = null;
  private pendingInterstitial: PendingAd | null = null;
  private disposed = false;

  constructor(options: CleverAppsPlatformOptions = {}) {
    this.options = options;
    this.timers = options.timers ?? defaultPlatformTimers;

    this.identity = {
      ready: () => this.ensureIdentityReady(),
      playerId: () => this.readPlayerId(),
      displayName: () => {
        const name = this.connector?.player?.name;
        return typeof name === 'string' ? name : '';
      }
    };

    this.environment = {
      platformCode: () => 'FB',
      language: () => {
        const language = this.connector?.info?.language;
        return typeof language === 'string' ? language : '';
      },
      deviceType: () => (this.connector?.info?.isMobile === true ? 'mobile' : null),
      platformOs: () => {
        const os = this.connector?.info?.os;
        return typeof os === 'string' && os !== '' ? os : null;
      },
      launchPayload: () => '',
      serverTime: () => null
    };

    this.storage = {
      isCloud: () => true,
      ready: () => this.ensureStorageLoaded(),
      get: (keys) => this.readStorage(keys),
      set: (patch) => this.writeStorage(patch),
      clear: (keys) => this.clearStorage(keys)
    };

    this.gameplay = {
      reportLoadingProgress: (progress) => {
        const platform = this.connector?.platform;
        if (!platform?.hasNativeLoadingScreen || typeof platform.reportLoadingProgress !== 'function') return;
        const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
        platform.reportLoadingProgress(normalized);
      },
      ready: () => this.gameplayReady(),
      // Connector documents gameplayStart/Stop for other targets, not Facebook. Keep the required
      // Core surface as safe no-ops instead of inventing unsupported Facebook lifecycle semantics.
      start: () => {},
      stop: () => {}
    };

    this.ads = {
      showRewarded: (placement) => this.showRewarded(placement),
      showInterstitial: (placement) => this.showInterstitial(placement),
      isRewardedAvailable: () => {
        const ads = this.connector?.ads;
        return Boolean(ads && ads.isRewardedSupported !== false && ads.isRewardedAvailable !== false && !this.pendingRewarded);
      }
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ads = this.connector?.ads;
    if (ads?.off) for (const [event, listener] of this.adListeners) ads.off(event, listener);
    this.adListeners.length = 0;
    this.pendingRewarded?.finish(errorResult(this.pendingRewarded.placement, new Error('cleverapps_disposed')));
    this.pendingInterstitial?.finish(errorResult(this.pendingInterstitial.placement, new Error('cleverapps_disposed')));
  }

  private ensureConnector(): Promise<CleverAppsConnector> {
    if (!this.connectorPromise) {
      const init = this.options.init ?? initCleverAppsConnector;
      this.connectorPromise = withTimeout(Promise.resolve().then(init), CLEVERAPPS_TIMEOUTS.init, 'cleverapps_init', this.timers).then((connector) => {
        if (!connector || typeof connector !== 'object') throw new TypeError('cleverapps_connector_invalid');
        this.connector = connector;
        this.installAdListeners(connector.ads);
        return connector;
      });
    }
    return this.connectorPromise;
  }

  private ensureIdentityReady(): Promise<void> {
    if (!this.identityPromise) {
      this.identityPromise = this.ensureConnector().then(async (connector) => {
        const ready = connector.player?.ready;
        if (!ready) return;
        try {
          await withTimeout(ready, CLEVERAPPS_TIMEOUTS.playerReady, 'cleverapps_player_ready', this.timers);
        } catch (error) {
          this.diagnostic('player_unavailable', error);
        }
      });
    }
    return this.identityPromise;
  }

  private readPlayerId(): string | null {
    const connector = this.connector;
    if (!connector || typeof connector.social?.isLoggedIn !== 'function') return null;
    try {
      if (connector.social.isLoggedIn() !== true) return null;
      const id = connector.platform.getUserID?.();
      return typeof id === 'string' && id !== '' ? id : null;
    } catch {
      return null;
    }
  }

  private ensureStorageLoaded(): Promise<void> {
    if (!this.storagePromise) {
      this.storagePromise = this.ensureConnector().then(async (connector) => {
        const storage = connector.storage;
        if (!storage || storage.isSupported === false) throw new Error('cleverapps_storage_unsupported');
        const ready = storage.ready;
        if (ready) {
          await withTimeout(ready, CLEVERAPPS_TIMEOUTS.storageReady, 'cleverapps_storage_ready', this.timers);
        }
        const loaded = await withTimeout(storage.load(), CLEVERAPPS_TIMEOUTS.storageLoad, 'cleverapps_storage_load', this.timers);
        if (loaded !== true) {
          const error = new Error('cleverapps_storage_load_failed');
          this.diagnostic('storage_load_failed', error);
          throw error;
        }
      });
    }
    return this.storagePromise;
  }

  private async readStorage(keys: readonly string[]): Promise<Record<string, unknown>> {
    await this.ensureStorageLoaded();
    const storage = this.connector!.storage;
    const keysAnswer = storage.getKeys();
    if (!Array.isArray(keysAnswer) || keysAnswer.some((key) => typeof key !== 'string')) {
      throw new TypeError('cleverapps_storage_keys_invalid');
    }
    const available = new Set(keysAnswer);
    const answer: Record<string, unknown> = {};
    for (const key of keys) {
      if (!available.has(key)) continue;
      const raw = storage.get(key);
      if (raw === undefined) throw new TypeError(`cleverapps_storage_value_invalid:${key}`);
      const decoded = unwrap(raw);
      if (decoded.present) answer[key] = decoded.value;
    }
    return answer;
  }

  private async setStorageValue(key: string, value: StorageEnvelope): Promise<boolean> {
    try {
      return (
        (await withTimeout(this.connector!.storage.set(key, value), CLEVERAPPS_TIMEOUTS.storageSet, 'cleverapps_storage_set', this.timers)) === true
      );
    } catch (error) {
      this.diagnostic('storage_write_failed', error);
      return false;
    }
  }

  private async writeStorage(patch: Record<string, unknown>): Promise<boolean> {
    try {
      await this.ensureStorageLoaded();
    } catch {
      return false;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (!(await this.setStorageValue(key, envelope(value)))) return false;
    }
    return true;
  }

  private async clearStorage(keys: readonly string[]): Promise<void> {
    await this.ensureStorageLoaded();
    for (const key of keys) {
      if (!(await this.setStorageValue(key, tombstone()))) throw new Error('cleverapps_storage_clear_failed');
    }
  }

  private gameplayReady(): Promise<void> {
    if (!this.gameplayPromise) {
      const attempt = this.ensureConnector().then(async (connector) => {
        const startGame = connector.platform.startGame;
        if (typeof startGame !== 'function') return;
        await withTimeout(Promise.resolve().then(() => startGame.call(connector.platform)), CLEVERAPPS_TIMEOUTS.startGame, 'cleverapps_start_game', this.timers);
      });
      let guarded!: Promise<void>;
      guarded = attempt.catch((error) => {
        this.diagnostic('gameplay_failed', error);
        if (this.gameplayPromise === guarded) this.gameplayPromise = null;
        throw error;
      });
      this.gameplayPromise = guarded;
    }
    return this.gameplayPromise;
  }

  private installAdListeners(ads: CleverAppsAdsApi): void {
    if (this.adListenersInstalled) return;
    this.adListenersInstalled = true;
    const listen = (event: string, listener: (...args: unknown[]) => void): void => {
      try {
        ads.on(event, listener);
        this.adListeners.push([event, listener]);
      } catch (error) {
        this.diagnostic('ad_listener_failed', error);
      }
    };
    listen('rewarded:reward', () => this.onReward());
    listen('rewarded:close', (success) => this.onRewardedClose(success));
    listen('interstitial:close', (success) => this.onInterstitialClose(success));
  }

  private makePending(placement: string, rewarded: boolean): PendingAd {
    let finish!: (result: PlatformAdResult) => void;
    let pending!: PendingAd;
    const promise = new Promise<PlatformAdResult>((resolve) => {
      finish = createAdWatchdog(
        (result) => {
          if (rewarded) {
            if (this.pendingRewarded === pending) this.pendingRewarded = null;
          } else if (this.pendingInterstitial === pending) {
            this.pendingInterstitial = null;
          }
          resolve(result);
        },
        () =>
          rewarded && (pending as PendingRewarded).rewarded
            ? { status: 'rewarded', rewarded: true, placement }
            : timeoutResult(placement),
        this.options.visibility === undefined
          ? { timers: this.timers }
          : { timers: this.timers, visibility: this.options.visibility }
      );
    });
    pending = { placement, promise, finish };
    return pending;
  }

  private async showRewarded(placement: string): Promise<PlatformAdResult> {
    let connector: CleverAppsConnector;
    try {
      connector = await this.ensureConnector();
    } catch (error) {
      return errorResult(placement, error);
    }
    if (this.pendingRewarded) return errorResult(placement, new Error('cleverapps_rewarded_busy'));
    if (connector.ads.isRewardedSupported === false || connector.ads.isRewardedAvailable === false) {
      return noFillResult(placement, 'unavailable');
    }
    const pending = this.makePending(placement, true) as PendingRewarded;
    pending.rewarded = false;
    this.pendingRewarded = pending;
    try {
      const opened = await withTimeout(
        Promise.resolve().then(() => connector.ads.showRewardedVideo()),
        CLEVERAPPS_TIMEOUTS.adShow,
        'cleverapps_rewarded_show',
        this.timers
      );
      if (opened !== true) pending.finish(noFillResult(placement, opened));
    } catch (error) {
      pending.finish(String(error).includes('sdk_timeout:') ? timeoutResult(placement) : errorResult(placement, error));
    }
    return pending.promise;
  }

  private async showInterstitial(placement: string): Promise<PlatformAdResult> {
    let connector: CleverAppsConnector;
    try {
      connector = await this.ensureConnector();
    } catch (error) {
      return errorResult(placement, error);
    }
    if (this.pendingInterstitial) return errorResult(placement, new Error('cleverapps_interstitial_busy'));
    if (connector.ads.isInterstitialSupported === false || connector.ads.isInterstitialAvailable === false) {
      return noFillResult(placement, 'unavailable');
    }
    const pending = this.makePending(placement, false);
    this.pendingInterstitial = pending;
    try {
      const opened = await withTimeout(
        Promise.resolve().then(() => connector.ads.showInterstitial()),
        CLEVERAPPS_TIMEOUTS.adShow,
        'cleverapps_interstitial_show',
        this.timers
      );
      if (opened !== true) pending.finish(noFillResult(placement, opened));
    } catch (error) {
      pending.finish(String(error).includes('sdk_timeout:') ? timeoutResult(placement) : errorResult(placement, error));
    }
    return pending.promise;
  }

  private onReward(): void {
    const pending = this.pendingRewarded;
    if (!pending) return;
    pending.rewarded = true;
  }

  private onRewardedClose(success: unknown): void {
    const pending = this.pendingRewarded;
    if (!pending) return;
    // Connector variants can emit close immediately before reward. The microtask lets a same-turn
    // rewarded:reward win, while a plain close deterministically becomes dismissed.
    Promise.resolve().then(() => {
      if (this.pendingRewarded !== pending) return;
      if (pending.rewarded) pending.finish({ status: 'rewarded', rewarded: true, placement: pending.placement });
      else pending.finish({ status: 'dismissed', rewarded: false, placement: pending.placement, raw: success });
    });
  }

  private onInterstitialClose(success: unknown): void {
    const pending = this.pendingInterstitial;
    if (!pending) return;
    pending.finish(
      success === true
        ? { status: 'shown', rewarded: false, placement: pending.placement, raw: success }
        : noFillResult(pending.placement, success)
    );
  }

  private diagnostic(code: CleverAppsDiagnosticCode, detail?: unknown): void {
    try {
      this.options.onDiagnostic?.(code, detail);
    } catch {
      // Diagnostics never change platform behavior.
    }
  }
}

export function createCleverAppsPlatform(options: CleverAppsPlatformOptions = {}): CleverAppsPlatform {
  return new CleverAppsPlatform(options);
}
