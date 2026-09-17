// The DEV platform: every capability of the contract without an SDK, a network or real money — so
// PurchaseRuntime / AdsRuntime / OfferRuntime hosts run end to end on a stand. It closes the holes
// of the donor's `platform/localhost` (the production audit): `app.ready`, `gameplay.on/off`,
// `user.reset` and `check.consummations` never answered there, so purchase restore could not be
// tried locally at all.
import type { PlatformPurchase, PlatformPurchaseResult, RestoreGrantPolicy } from '../../purchases/types';
import type {
  GamePlatform,
  PlatformAdResult,
  PlatformAdStatus,
  PlatformAds,
  PlatformDeviceType,
  PlatformLifecycle,
  PlatformPayments,
  PlatformProduct
} from '../types';

/** Web Storage-shaped on purpose: a browser host passes `localStorage`; nothing = in memory. */
export interface DevKeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DevAdType = 'interstitial' | 'rewarded';

/**
 * - `ok` — paid, the receipt is held until `consume()`;
 * - `lost` — PAID, but the game is told `cancelled` (the donor's hung / dropped `purchase()` with
 *   the money taken): only `restore()` finds the receipt;
 * - `cancelled` / `error` — no payment.
 */
export type DevPurchaseOutcome = 'ok' | 'lost' | 'cancelled' | 'error';

export interface DevPlatformOptions {
  /** Default null — a guest, like the donor's localhost (the host falls back to its local uuid). */
  playerId?: string | null;
  displayName?: string;
  /** Default `'ru'` (the donor's localhost). */
  language?: string;
  deviceType?: PlatformDeviceType | null;
  platformOs?: string | null;
  launchPayload?: string;
  /** Unix seconds; default: the platform has no clock (null). */
  serverTime?: () => number | null;
  /** Backs the storage, the held receipts and the token counter. */
  store?: DevKeyValueStore;
  /** Default `'game-core.dev.'`. */
  storagePrefix?: string;
  products?: readonly PlatformProduct[];
  restoreGrant?: RestoreGrantPolicy;
  /** Default: every interstitial is `shown`, every rewarded is `rewarded`. */
  adOutcome?: (type: DevAdType, placement: string) => PlatformAdStatus;
  purchaseOutcome?: (productId: string) => DevPurchaseOutcome;
  /**
   * Default `dev:<n>`, the counter living in `store`. With a PERSISTENT granted-token registry pass
   * a persistent `store` too (or a clock-based factory): tokens that restart from 1 after a reload
   * would read as already granted.
   */
  createToken?: (productId: string, sequence: number) => string;
  /** `false` builds the platform WITHOUT the capability (a Yandex-like target has no banner, MSN no payments). */
  ads?: boolean;
  banner?: boolean;
  payments?: boolean;
  /** Default false: the donor's localhost has no shortcut. */
  lifecycle?: boolean;
}

export interface DevPlatformState {
  appReady: boolean;
  gameplayActive: boolean;
  loadingProgress: number;
  bannerVisible: boolean;
  shortcutCreated: boolean;
  adsShown: number;
  purchases: number;
}

export interface DevPlatformControl {
  getState(): DevPlatformState;
  /** Unconsumed receipts, as `restore()` would list them. */
  receipts(): PlatformPurchase[];
  /** A paid purchase the game never heard of (a previous session) — `restore()` finds it. */
  addReceipt(productId: string): PlatformPurchase;
  /** Forgets the receipts, the token counter and the markers. The player's storage goes through `storage.clear(keys)`. */
  reset(): void;
}

export interface DevPlatform extends GamePlatform {
  readonly dev: DevPlatformControl;
}

function createMemoryStore(): DevKeyValueStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key)
  };
}

function adResult(placement: string, status: PlatformAdStatus): PlatformAdResult {
  return { status, rewarded: status === 'rewarded', placement };
}

export function createDevPlatform(options: DevPlatformOptions = {}): DevPlatform {
  const store = options.store ?? createMemoryStore();
  const prefix = options.storagePrefix ?? 'game-core.dev.';
  const receiptsKey = `${prefix}__receipts`;
  const sequenceKey = `${prefix}__purchase_seq`;
  const restoreGrant = options.restoreGrant;
  const products = (options.products ?? []).map((product) => ({ ...product }));
  const state: DevPlatformState = {
    appReady: false,
    gameplayActive: false,
    loadingProgress: 0,
    bannerVisible: false,
    shortcutCreated: false,
    adsShown: 0,
    purchases: 0
  };

  // the receipts are DEV bookkeeping, not the player's save: an unreadable blob restarts empty
  const readReceipts = (): PlatformPurchase[] => {
    try {
      const parsed: unknown = JSON.parse(store.getItem(receiptsKey) ?? '[]');
      return Array.isArray(parsed) ? (parsed as PlatformPurchase[]) : [];
    } catch {
      return [];
    }
  };
  const writeReceipts = (receipts: PlatformPurchase[]): void => {
    try {
      store.setItem(receiptsKey, JSON.stringify(receipts));
    } catch {
      // private mode: the receipts live for this call only
    }
  };
  let memorySequence = 0;
  const nextSequence = (): number => {
    let stored = 0;
    try {
      stored = Number(store.getItem(sequenceKey)) || 0;
    } catch {
      // fall through to the in-memory counter
    }
    memorySequence = Math.max(memorySequence, stored) + 1;
    try {
      store.setItem(sequenceKey, String(memorySequence));
    } catch {
      // same
    }
    return memorySequence;
  };
  const issueReceipt = (productId: string): PlatformPurchase => {
    const sequence = nextSequence();
    const token = options.createToken ? options.createToken(productId, sequence) : `dev:${sequence}`;
    const receipt: PlatformPurchase = { productId, token, raw: token };
    writeReceipts([...readReceipts(), receipt]);
    state.purchases += 1;
    return receipt;
  };

  const showAd = async (type: DevAdType, placement: string): Promise<PlatformAdResult> => {
    let status: PlatformAdStatus;
    try {
      status = options.adOutcome ? options.adOutcome(type, placement) : type === 'rewarded' ? 'rewarded' : 'shown';
    } catch (error) {
      return { ...adResult(placement, 'error'), raw: error };
    }
    // an interstitial has no reward and a rewarded ad is never just "shown" — keep the statuses honest
    if (type === 'interstitial' && (status === 'rewarded' || status === 'dismissed')) status = 'shown';
    if (type === 'rewarded' && status === 'shown') status = 'dismissed';
    if (status === 'shown' || status === 'rewarded' || status === 'dismissed') state.adsShown += 1;
    return adResult(placement, status);
  };

  let rewardedAvailable = true;
  const ads: PlatformAds = {
    showInterstitial: (placement) => showAd('interstitial', placement),
    showRewarded: async (placement) => {
      const result = await showAd('rewarded', placement);
      // the donor's Yandex latch: a rewarded that could not be served hides the button
      if (result.status === 'no_fill') rewardedAvailable = false;
      return result;
    },
    isRewardedAvailable: () => rewardedAvailable
  };
  if (options.banner !== false) {
    ads.showBanner = async () => {
      state.bannerVisible = true;
      return true;
    };
    ads.hideBanner = async () => {
      state.bannerVisible = false;
    };
  }

  const payments: PlatformPayments = {
    purchase: async (productId): Promise<PlatformPurchaseResult> => {
      const outcome = options.purchaseOutcome ? options.purchaseOutcome(productId) : 'ok';
      if (outcome === 'error') return { status: 'error', productId, error: new Error('dev: purchase failed') };
      if (outcome === 'cancelled') return { status: 'cancelled', productId };
      const receipt = issueReceipt(productId);
      return outcome === 'lost' ? { status: 'cancelled', productId } : { status: 'ok', ...receipt };
    },
    restore: async () => readReceipts(),
    consume: async (purchase) => {
      writeReceipts(readReceipts().filter((receipt) => receipt.token !== purchase.token));
    },
    getCatalog: async () => products.map((product) => ({ ...product })),
    ...(restoreGrant ? { restoreGrant } : {})
  };

  const lifecycle: PlatformLifecycle = {
    canCreateShortcut: async () => !state.shortcutCreated,
    createShortcut: async () => {
      state.shortcutCreated = true;
      return true;
    }
  };

  const platform: DevPlatform = {
    identity: {
      ready: async () => {},
      playerId: () => options.playerId ?? null,
      displayName: () => options.displayName ?? ''
    },
    environment: {
      platformCode: () => 'DEV',
      language: () => options.language ?? 'ru',
      deviceType: () => options.deviceType ?? null,
      platformOs: () => options.platformOs ?? null,
      launchPayload: () => options.launchPayload ?? '',
      serverTime: () => (options.serverTime ? options.serverTime() : null)
    },
    storage: {
      isCloud: () => false,
      ready: async () => {},
      // no try / catch on purpose: a throwing store or a corrupted value REJECTS — never `{}`
      get: async (keys) => {
        const data: Record<string, unknown> = {};
        for (const key of keys) {
          const raw = store.getItem(prefix + key);
          if (raw !== null) data[key] = JSON.parse(raw);
        }
        return data;
      },
      set: async (patch) => {
        try {
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) continue;
            store.setItem(prefix + key, JSON.stringify(value));
          }
          return true;
        } catch {
          return false;
        }
      },
      clear: async (keys) => {
        for (const key of keys) store.removeItem(prefix + key);
      }
    },
    gameplay: {
      reportLoadingProgress: (progress) => {
        state.loadingProgress = progress;
      },
      ready: async () => {
        state.appReady = true;
      },
      start: () => {
        state.gameplayActive = true;
      },
      stop: () => {
        state.gameplayActive = false;
      }
    },
    dev: {
      getState: () => ({ ...state }),
      receipts: readReceipts,
      addReceipt: issueReceipt,
      reset: () => {
        try {
          store.removeItem(receiptsKey);
          store.removeItem(sequenceKey);
        } catch {
          // nothing to forget
        }
        memorySequence = 0;
        rewardedAvailable = true;
        Object.assign(state, {
          appReady: false,
          gameplayActive: false,
          loadingProgress: 0,
          bannerVisible: false,
          shortcutCreated: false,
          adsShown: 0,
          purchases: 0
        } satisfies DevPlatformState);
      }
    }
  };
  if (options.ads !== false) platform.ads = ads;
  if (options.payments !== false) platform.payments = payments;
  if (options.lifecycle === true) platform.lifecycle = lifecycle;
  return platform;
}
