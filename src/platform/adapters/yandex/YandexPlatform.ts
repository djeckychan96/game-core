// Platform Layer v0.8-B1 — the production Yandex Games platform, a 1:1 port of Trail Arrow 0.1.22
// `platform/yandex/systems/HttpRequestSystem.ts` onto the capability contract of v0.8-A. Lives in
// its own public entry (`game-core/platform/yandex`): the root bundle never names the SDK.
//
// Ported as is: SDK boot (20 s, one retry, 30 s "SDK is dead" memory), the non-blocking player with
// guest mode and the background retry (5 × 15 s), the cloud read (8 s × 3 attempts, a total failure
// REJECTS), the serialized + throttled `setData` (one in flight, ≥ 3 s apart; each call is the whole
// confirmed object with the patch on top — the SDK replaces the object, `storage.set` stays a PATCH),
// the ad lifecycle (audio pause before the show, gameplay restored only if it was running, watchdog,
// the local rewarded-availability latch), payments with every timeout. Left to the host on purpose: the local
// mirror, the rollback guard, `save_seq`, cloud identity adoption, the guest-conflict write guard,
// the granted-token registry (PurchaseRuntime), restore / catalog retry schedules, `registerShown`.
import type { PlatformPurchase, PlatformPurchaseResult } from '../../../purchases/types';
import { createAdWatchdog } from '../../support/adWatchdog';
import type { PlatformVisibility } from '../../support/adWatchdog';
import { defaultPlatformTimers, settleWithin, sleep, withTimeout } from '../../support/withTimeout';
import type { PlatformTimers } from '../../support/withTimeout';
import type {
  GamePlatform,
  PlatformAdResult,
  PlatformAdStatus,
  PlatformAds,
  PlatformDeviceType,
  PlatformEnvironment,
  PlatformGameplay,
  PlatformIdentity,
  PlatformPayments,
  PlatformProduct,
  PlatformStorage
} from '../../types';
import { initYandexSdk, waitForYandexScript } from './sdk';
import type { YandexPaymentsApi, YandexPlayer, YandexPurchase, YandexSdk } from './sdk';

/** Production timeouts, ms — every one of them is the donor's number. */
export const YANDEX_TIMEOUTS = {
  init: 20000,
  sdkDeadCooldown: 30000,
  player: 10000,
  playerRetryEvery: 15000,
  /** How long a cloud read waits for a player that is still on its way before it counts as a guest. */
  playerWaitOnRead: 3000,
  payments: 8000,
  catalog: 10000,
  purchase: 120000,
  consume: 8000,
  getPurchases: 8000,
  getData: 8000,
  setData: 10000,
  /** The platform's write-rate limit: at most one `setData` in flight, real writes this far apart. */
  saveMinInterval: 3000
} as const;

export const YANDEX_PLAYER_RETRY_ATTEMPTS = 5;
export const YANDEX_READ_ATTEMPTS = 3;
export const YANDEX_LAUNCH_PAYLOAD_MAX = 200;

/** `storage.get()` / `clear()` reject with this message while there is no player object — a GUEST, not a new player. */
export const YANDEX_NO_PLAYER = 'yandex_no_player';

/** The donor's ECS components and sound calls around an ad, as plain hooks. A throwing hook never breaks the show. */
export interface YandexAdHooks {
  /** Before the SDK call AND again on the SDK's `onOpen` (the donor: `onOpen` comes late or never). */
  pauseAudio?(): void;
  /** In `finally` — also after a synchronous SDK throw (the donor: a missed resume = a game without sound). */
  resumeAudio?(): void;
  /** true before the show, false in `finally` (the donor's `AdsShowingComponent` + the `resize` dispatch after the ad). */
  setAdShowing?(showing: boolean): void;
}

/** The markers production sends to analytics as raw `error` events, plus the failures the adapter swallows like the donor. */
export type YandexDiagnosticCode =
  | 'sdk_init_retry'
  | 'guest_mode'
  | 'guest_recovered'
  | 'payments_unavailable'
  | 'cloud_save_failed'
  | 'catalog_empty'
  | 'get_purchases_failed'
  | 'gameplay_failed'
  | 'hook_threw';

export interface YandexPlatformOptions {
  /** Boots the SDK; default `YaGames.init()`. Tests and stands inject a fake — nothing else reads the global. */
  init?: () => PromiseLike<YandexSdk>;
  /** Default (only when `init` is not injected): the donor's page-loader contract, see `waitForYandexScript`. */
  waitForScript?: () => Promise<void>;
  hooks?: YandexAdHooks;
  /**
   * The player object arrived — at boot or by the background retry. The id is null for an
   * unauthorized one. The profile-id policy (the donor's `onSdkIdArrived` → `identity_link`) is the host's.
   */
  onPlayer?: (playerId: string | null) => void;
  /**
   * `scopes` of every `getPlayer` call — the boot one and the guest-mode retries alike. Default false =
   * production (SoliPix: `getPlayer({ scopes: false })`): the player object and the cloud without the
   * personal-data permission dialog. True only for a game that shows the player's name / avatar.
   */
  playerScopes?: boolean;
  onDiagnostic?: (code: YandexDiagnosticCode, detail?: unknown) => void;
  /**
   * Default true = production: `gameplay.ready()` also calls `GameplayAPI.start()` — until the first
   * start the Yandex webview keeps a low-fps mode, and a menu is interactive gameplay.
   */
  startGameplayOnReady?: boolean;
  timers?: PlatformTimers;
  /** Epoch ms for the "SDK is dead" memory and the write throttle; default `Date.now`. */
  now?: () => number;
  /** The ad watchdog's page-visibility seam; default `document`, null = hard timeout only. */
  visibility?: PlatformVisibility | null;
}

type AdType = 'interstitial' | 'rewarded';

export class YandexPlatform implements GamePlatform {
  readonly identity: PlatformIdentity;
  readonly environment: PlatformEnvironment;
  readonly storage: PlatformStorage;
  readonly gameplay: PlatformGameplay;
  /** No banner: Yandex production has none. */
  readonly ads: PlatformAds;
  /** Always present — "payments are off" (`getPayments` failed) answers `cancelled` / an empty catalog, like production. */
  readonly payments: PlatformPayments;
  // no `lifecycle`: Yandex production has no shortcut

  private readonly options: YandexPlatformOptions;
  /** One object for the boot call and the retries, so they can never drift apart. */
  private readonly playerRequest: { scopes: boolean };
  private readonly timers: PlatformTimers;
  private readonly now: () => number;

  private sdk: YandexSdk | null = null;
  private player: YandexPlayer | null = null;
  /** null = payments are unavailable (IAP not configured / `getPayments` rejected or hung). */
  private paymentsApi: YandexPaymentsApi | null = null;
  private sdkInitPromise: Promise<void> | null = null;
  private sdkDeadUntil = 0;
  private playerReady: Promise<void> | null = null;
  private playerRetryActive = false;
  private playerRetryTimer: unknown = null;
  private appReadySent = false;
  /** The state the GAME asked for last — ad-time stop / start is temporary and restores exactly this (donor bug of 08.09). */
  private gameplayActive = false;
  /** The SDK has no `isAvailable`: true until an `onError` / `onClose(false)` of a rewarded, then false for the session. */
  private rewardedAvailable = true;
  private saveInFlight = false;
  /** The write chain in flight — what a `clear` that joins it waits for. Meaningful only while `saveInFlight`. */
  private saveChain: Promise<void> | null = null;
  private pendingPatch: Record<string, unknown> | null = null;
  /**
   * The player's WHOLE cloud object as last confirmed: the one full `getData()` before the first write,
   * then every successful `setData`. null = not read yet — no write is safe before it is.
   */
  private confirmedCloud: Record<string, unknown> | null = null;
  private lastSetDataAt = 0;
  private disposed = false;

  constructor(options: YandexPlatformOptions = {}) {
    this.options = options;
    this.playerRequest = { scopes: options.playerScopes === true };
    this.timers = options.timers ?? defaultPlatformTimers;
    this.now = options.now ?? (() => Date.now());

    this.identity = {
      // the SDK is up — NOT "the player is known": the player loads beside the critical path
      ready: () => this.ensureSdkReady(),
      playerId: () => {
        try {
          const id = this.player?.getUniqueID();
          return typeof id === 'string' && id !== '' ? id : null;
        } catch {
          return null;
        }
      },
      displayName: () => {
        try {
          return this.player?.getName?.() ?? '';
        } catch {
          return '';
        }
      }
    };

    this.environment = {
      platformCode: () => 'YA',
      language: () => this.sdk?.environment?.i18n?.lang ?? '',
      deviceType: () => {
        const type = this.sdk?.deviceInfo?.type;
        return type === 'mobile' || type === 'tablet' || type === 'desktop' ? (type satisfies PlatformDeviceType) : null;
      },
      platformOs: () => null,
      launchPayload: () => {
        const payload = this.sdk?.environment?.payload;
        return payload ? String(payload).slice(0, YANDEX_LAUNCH_PAYLOAD_MAX) : '';
      },
      serverTime: () => {
        const sdk = this.sdk;
        if (!sdk || typeof sdk.serverTime !== 'function') return null;
        const ms = Number(sdk.serverTime());
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
      }
    };

    this.storage = {
      isCloud: () => true,
      ready: () => this.ensureSdkReady(),
      get: (keys) => this.readCloud(keys),
      set: (patch) => this.writeCloud(patch),
      clear: (keys) => this.clearCloud(keys)
    };

    this.gameplay = {
      reportLoadingProgress: () => {}, // Yandex has no native loading screen
      ready: async () => {
        if (this.appReadySent) return;
        await this.ensureSdkReady();
        this.sdk?.features?.LoadingAPI?.ready?.();
        if (options.startGameplayOnReady !== false) {
          this.sdk?.features?.GameplayAPI?.start?.();
          this.gameplayActive = true;
        }
        this.appReadySent = true;
      },
      start: () => this.setGameplay(true),
      stop: () => this.setGameplay(false)
    };

    this.ads = {
      showInterstitial: (placement) => this.showAd('interstitial', placement),
      showRewarded: (placement) => this.showAd('rewarded', placement),
      isRewardedAvailable: () => this.rewardedAvailable
    };

    this.payments = {
      restoreGrant: 'after-consume',
      purchase: (productId) => this.purchase(productId),
      restore: () => this.restore(),
      consume: (purchase) => this.consume(purchase),
      getCatalog: () => this.getCatalog()
    };
  }

  /** Stops the background player retry. SDK calls already in flight still settle. */
  dispose(): void {
    this.disposed = true;
    if (this.playerRetryTimer !== null) this.timers.clearTimeout(this.playerRetryTimer);
    this.playerRetryTimer = null;
    this.playerRetryActive = false;
  }

  // ---------------------------------------------------------------- boot

  private diagnostic(code: YandexDiagnosticCode, detail?: unknown): void {
    try {
      this.options.onDiagnostic?.(code, detail);
    } catch {
      // diagnostics never break the platform
    }
  }

  /** The player is optional (guest mode): ready = the SDK came up. */
  private ensureSdkReady(): Promise<void> {
    if (this.sdk) return Promise.resolve();
    // without this memory EVERY request re-ran 2 × (20 s init) with the buttons dead; after a total
    // failure answer at once for 30 s, then one honest attempt again
    if (this.now() < this.sdkDeadUntil) return Promise.reject(new Error('sdk_dead_cooldown'));
    if (!this.sdkInitPromise) {
      // one retry after a failed / timed-out INIT: a slow Android network often comes alive on the 2nd try
      this.sdkInitPromise = this.initSdk()
        .catch((error) => {
          this.diagnostic('sdk_init_retry', error);
          return this.initSdk();
        })
        .catch((error) => {
          this.sdkDeadUntil = this.now() + YANDEX_TIMEOUTS.sdkDeadCooldown;
          throw error;
        })
        .finally(() => {
          this.sdkInitPromise = null;
        });
    }
    return this.sdkInitPromise;
  }

  private async initSdk(): Promise<void> {
    const { init, waitForScript } = this.options;
    if (waitForScript) await waitForScript();
    else if (!init) await waitForYandexScript();
    const sdk = await withTimeout(Promise.resolve().then(init ?? initYandexSdk), YANDEX_TIMEOUTS.init, 'init', this.timers);
    this.sdk = sdk;
    // by the Yandex docs the game does NOT wait for the login: getPlayer starts in PARALLEL and
    // never blocks the critical path; a hung one leaves a guest, the player arrives in the background
    this.playerReady = this.fetchPlayer(sdk);
    // a hung getPayments held the whole init (27 players a day) — timeout → null is a normal path
    this.paymentsApi = await withTimeout(
      Promise.resolve().then(() => sdk.getPayments({ signed: false })),
      YANDEX_TIMEOUTS.payments,
      'payments',
      this.timers
    ).catch((error) => {
      this.diagnostic('payments_unavailable', error);
      return null;
    });
  }

  private announcePlayer(): void {
    try {
      this.options.onPlayer?.(this.identity.playerId());
    } catch {
      // the host's identity policy never breaks the platform
    }
  }

  private async fetchPlayer(sdk: YandexSdk): Promise<void> {
    try {
      this.player = await withTimeout(Promise.resolve().then(() => sdk.getPlayer(this.playerRequest)), YANDEX_TIMEOUTS.player, 'player', this.timers);
      this.announcePlayer();
    } catch (error) {
      this.diagnostic('guest_mode', error);
      this.player = null;
      this.startPlayerRetry(sdk);
    }
  }

  /** Guest mode: up to 5 more attempts, 15 s apart; on success the cloud starts working (the host guards its first write). */
  private startPlayerRetry(sdk: YandexSdk, attempt = 0): void {
    if (this.disposed || this.playerRetryActive || this.player || attempt >= YANDEX_PLAYER_RETRY_ATTEMPTS) return;
    this.playerRetryActive = true;
    this.playerRetryTimer = this.timers.setTimeout(() => {
      this.playerRetryActive = false;
      this.playerRetryTimer = null;
      if (this.disposed || this.player) return;
      withTimeout(Promise.resolve().then(() => sdk.getPlayer(this.playerRequest)), YANDEX_TIMEOUTS.player, 'player_bg', this.timers).then(
        (player) => {
          if (this.disposed) return;
          this.player = player;
          this.announcePlayer();
          this.diagnostic('guest_recovered');
        },
        () => this.startPlayerRetry(sdk, attempt + 1)
      );
    }, YANDEX_TIMEOUTS.playerRetryEvery);
  }

  // ---------------------------------------------------------------- storage

  private async readCloud(keys: readonly string[]): Promise<Record<string, unknown>> {
    await this.ensureSdkReady();
    // the player usually is there (< 1 s); a hung one is waited for 3 s at most
    if (!this.player && this.playerReady) await settleWithin(this.playerReady, YANDEX_TIMEOUTS.playerWaitOnRead, this.timers);
    const player = this.player;
    // a GUEST has no cloud to read. Never `{}`: the host would take it for a new player and its
    // default profile would overwrite the cloud save once the player arrives.
    if (!player) throw new Error(YANDEX_NO_PLAYER);
    const data = await this.fetchCloud(player, keys);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const value = data[key];
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  /** `getData` (no keys = the player's whole object): 3 attempts with pauses, a total failure or a non-object THROWS. */
  private async fetchCloud(player: YandexPlayer, keys?: readonly string[]): Promise<Record<string, unknown>> {
    let data: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        data = await withTimeout(
          Promise.resolve().then(() => (keys ? player.getData([...keys]) : player.getData())),
          YANDEX_TIMEOUTS.getData,
          'getData',
          this.timers
        );
        break;
      } catch (error) {
        // the profile is critical: 3 attempts with pauses; a total failure is THROWN
        if (attempt >= YANDEX_READ_ATTEMPTS - 1) throw error;
        await sleep(1000 + attempt * 2000, this.timers);
      }
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('yandex: getData answered a non-object');
    return data as Record<string, unknown>;
  }

  private async writeCloud(patch: Record<string, unknown>): Promise<boolean> {
    try {
      await this.ensureSdkReady();
    } catch {
      return false;
    }
    const player = this.player;
    if (!player) return false; // a guest: no cloud — the host keeps its mirror
    this.queuePatch(patch);
    // already writing: never a parallel setData (the platform's rate limit hangs the calls) — the
    // chain in flight writes this patch with its final turn; answered ok at once, like the donor
    if (this.saveInFlight) return true;
    return this.startSaveChain(player).then(
      () => true,
      () => false
    );
  }

  /** The donor's `user.reset` = `{ key: null }` — a patch like any other, so it never drops the other keys either. */
  private async clearCloud(keys: readonly string[]): Promise<void> {
    await this.ensureSdkReady();
    const player = this.player;
    if (!player) throw new Error(YANDEX_NO_PLAYER);
    const patch: Record<string, unknown> = {};
    for (const key of keys) patch[key] = null; // also replaces a carried value of the key
    this.queuePatch(patch);
    // not answered at once like a joining set(): a reset waits for the write that carries it, and REJECTS
    // with that write's error (the key stays queued for the next write, like any unwritten patch)
    await (this.saveInFlight && this.saveChain ? this.saveChain : this.startSaveChain(player));
  }

  private queuePatch(patch: Record<string, unknown>): void {
    const merged: Record<string, unknown> = { ...(this.pendingPatch ?? {}) };
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) merged[key] = value;
    this.pendingPatch = merged;
  }

  private startSaveChain(player: YandexPlayer): Promise<void> {
    this.saveInFlight = true;
    this.saveChain = this.runSaveChain(player);
    return this.saveChain;
  }

  /**
   * One chain of `setData` turns: one call in flight, ≥ 3 s apart, until nothing is queued. `setData`
   * REPLACES the player's whole object (the SDK: `getData` answers the data of the LAST `setData` call), so a
   * turn never sends a bare patch: it sends the confirmed whole object with the queued patch on top, and
   * that object becomes the confirmed one only once the call succeeded.
   */
  private async runSaveChain(player: YandexPlayer): Promise<void> {
    try {
      const wait = this.lastSetDataAt + YANDEX_TIMEOUTS.saveMinInterval - this.now();
      if (wait > 0) await sleep(wait, this.timers);
      do {
        let base = this.confirmedCloud;
        if (!base) {
          // the first write of the session: ONE full read first — a write without the whole object would
          // erase every key it does not name. A failed read writes nothing; the patch stays queued.
          try {
            base = this.confirmedCloud = await this.fetchCloud(player);
          } catch (error) {
            this.diagnostic('cloud_save_failed', error);
            throw error;
          }
        }
        const patch: Record<string, unknown> = this.pendingPatch ?? {};
        this.pendingPatch = null;
        const data: Record<string, unknown> = { ...base, ...patch };
        this.lastSetDataAt = this.now();
        try {
          await withTimeout(Promise.resolve().then(() => player.setData(data, true)), YANDEX_TIMEOUTS.setData, 'setData', this.timers);
        } catch (error) {
          // a failure / timeout is NOT a success: the confirmed object stays, the unwritten patch is
          // carried into the next write (the donor re-read its whole model instead) — nothing is lost
          this.pendingPatch = { ...patch, ...(this.pendingPatch ?? {}) };
          this.diagnostic('cloud_save_failed', error);
          throw error;
        }
        this.confirmedCloud = data;
        if (this.pendingPatch) await sleep(YANDEX_TIMEOUTS.saveMinInterval, this.timers);
      } while (this.pendingPatch);
    } finally {
      this.saveInFlight = false;
    }
  }

  // ---------------------------------------------------------------- gameplay

  private setGameplay(active: boolean): void {
    const apply = (): void => {
      const api = this.sdk?.features?.GameplayAPI;
      if (active) api?.start?.();
      else api?.stop?.();
      this.gameplayActive = active;
    };
    if (this.sdk) {
      try {
        apply();
      } catch (error) {
        this.diagnostic('gameplay_failed', error);
      }
      return;
    }
    this.ensureSdkReady().then(apply).catch((error) => this.diagnostic('gameplay_failed', error));
  }

  // ---------------------------------------------------------------- ads

  private hook(name: keyof YandexAdHooks, showing?: boolean): void {
    try {
      if (name === 'setAdShowing') this.options.hooks?.setAdShowing?.(showing === true);
      else this.options.hooks?.[name]?.();
    } catch (error) {
      this.diagnostic('hook_threw', error);
    }
  }

  private async showAd(type: AdType, placement: string): Promise<PlatformAdResult> {
    try {
      await this.ensureSdkReady();
    } catch (error) {
      return { status: 'error', rewarded: false, placement, raw: error };
    }
    const sdk = this.sdk!;
    let raw: unknown;
    let status: PlatformAdStatus;
    // restore the state the game had BEFORE the show (an inter on level exit used to switch gameplay back on in the menu)
    const gameplayWasActive = this.gameplayActive;
    try {
      this.hook('setAdShowing', true);
      // mute BEFORE the call: the SDK's onOpen is late or never comes — music played under the ad
      this.hook('pauseAudio');
      // by the docs a fullscreen / rewarded show is a gameplay stop event, the return is a start
      sdk.features?.GameplayAPI?.stop?.();
      status = await new Promise<PlatformAdStatus>((resolve) => {
        const env = { timers: this.timers, ...(this.options.visibility !== undefined ? { visibility: this.options.visibility } : {}) };
        if (type === 'interstitial') {
          const done = createAdWatchdog<PlatformAdStatus>(resolve, () => 'timeout', env);
          try {
            sdk.adv.showFullscreenAdv({
              callbacks: {
                onOpen: () => this.hook('pauseAudio'),
                onClose: (wasShown) => done(wasShown ? 'shown' : 'no_fill'),
                onError: (error) => {
                  raw = error;
                  done('no_fill');
                },
                onOffline: () => done('no_fill')
              }
            });
          } catch (error) {
            raw = error;
            done('error');
          }
          return;
        }
        // the reward is RECORDED in onRewarded, but the game is answered only when the show ENDS:
        // onRewarded comes before the video closes, and the game used to move on under the ad
        let rewarded = false;
        const done = createAdWatchdog<PlatformAdStatus>(resolve, () => (rewarded ? 'rewarded' : 'timeout'), env);
        try {
          sdk.adv.showRewardedVideo({
            callbacks: {
              onOpen: () => this.hook('pauseAudio'),
              onRewarded: () => {
                rewarded = true;
              },
              onClose: (wasShown) => {
                // wasShown === false: the SDK could not really show it — "unavailable", like onError;
                // true / undefined: the player closed a working ad, the latch stays
                if (wasShown === false) this.rewardedAvailable = false;
                done(rewarded ? 'rewarded' : wasShown === false ? 'no_fill' : 'dismissed');
              },
              onError: (error) => {
                this.rewardedAvailable = false;
                raw = error;
                done('no_fill'); // the donor answers `no-reward` here even after an onRewarded
              }
            }
          });
        } catch (error) {
          raw = error;
          done('error');
        }
      });
    } catch (error) {
      raw = error;
      status = 'error';
    } finally {
      this.hook('setAdShowing', false);
      this.hook('resumeAudio');
      if (gameplayWasActive) {
        try {
          sdk.features?.GameplayAPI?.start?.(); // ONLY if gameplay ran before the ad
        } catch (error) {
          this.diagnostic('gameplay_failed', error);
        }
      }
    }
    return { status, rewarded: status === 'rewarded', placement, ...(raw !== undefined ? { raw } : {}) };
  }

  // ---------------------------------------------------------------- payments

  private static toPurchase(purchase: YandexPurchase): PlatformPurchase {
    const normalized: PlatformPurchase = { raw: purchase };
    if (typeof purchase.productID === 'string') normalized.productId = purchase.productID;
    if (typeof purchase.purchaseToken === 'string') normalized.token = purchase.purchaseToken;
    return normalized;
  }

  private async purchase(productId: string): Promise<PlatformPurchaseResult> {
    try {
      await this.ensureSdkReady();
    } catch (error) {
      return { status: 'error', productId, error };
    }
    const api = this.paymentsApi;
    if (!api) return { status: 'cancelled', productId };
    // 2 minutes (the Yandex check of 11.08): a hung purchase() left the game with no answer at all.
    // Enough to type a card in; a payment that lands LATER is caught by the host's restore.
    const purchase = await withTimeout(Promise.resolve().then(() => api.purchase({ id: productId })), YANDEX_TIMEOUTS.purchase, 'purchase', this.timers).catch(
      () => null
    );
    if (purchase && purchase.purchaseToken && purchase.productID) return { status: 'ok', ...YandexPlatform.toPurchase(purchase) };
    return { status: 'cancelled', productId };
  }

  private async restore(): Promise<PlatformPurchase[]> {
    await this.ensureSdkReady(); // a dead SDK rejects → PurchaseRuntime `restore_failed` → the host retries
    const api = this.paymentsApi;
    if (!api) return [];
    const purchases = await withTimeout(Promise.resolve().then(() => api.getPurchases()), YANDEX_TIMEOUTS.getPurchases, 'getPurchases', this.timers).catch(
      (error) => {
        this.diagnostic('get_purchases_failed', error); // the donor: a failed list reads as "nothing held"
        return [] as YandexPurchase[];
      }
    );
    return Array.isArray(purchases) ? purchases.filter((purchase) => purchase && typeof purchase === 'object').map(YandexPlatform.toPurchase) : [];
  }

  private async consume(purchase: PlatformPurchase): Promise<void> {
    await this.ensureSdkReady();
    const api = this.paymentsApi;
    if (!api) throw new Error('yandex_payments_unavailable');
    const token = purchase.token;
    if (typeof token !== 'string' || token === '') throw new Error('yandex_consume_without_token');
    await withTimeout(Promise.resolve().then(() => api.consumePurchase(token)), YANDEX_TIMEOUTS.consume, 'consume', this.timers);
  }

  private async getCatalog(): Promise<PlatformProduct[]> {
    await this.ensureSdkReady();
    const api = this.paymentsApi;
    if (!api) return [];
    const catalog = await withTimeout(Promise.resolve().then(() => api.getCatalog()), YANDEX_TIMEOUTS.catalog, 'getCatalog', this.timers);
    const list = Array.isArray(catalog) ? catalog : [];
    // an empty catalog = products not applied in the console yet: a marker, the host asks again later
    if (list.length === 0) this.diagnostic('catalog_empty');
    const products: PlatformProduct[] = [];
    for (const product of list) {
      // Yandex gives `price` READY ("149 ₽") with the right currency — never a number made up here
      if (!product || typeof product.id !== 'string' || product.id === '' || typeof product.price !== 'string' || product.price === '') continue;
      products.push({ id: product.id, priceText: product.price, currency: typeof product.priceCurrencyCode === 'string' ? product.priceCurrencyCode : '' });
    }
    return products;
  }
}

export function createYandexPlatform(options: YandexPlatformOptions = {}): YandexPlatform {
  return new YandexPlatform(options);
}
