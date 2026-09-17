import { PlatformCatalog } from './catalog';
import type { PlatformCatalogOptions } from './catalog';
import { PLATFORM_CODES } from './types';
import type {
  GamePlatform,
  PlatformAds,
  PlatformCapabilities,
  PlatformCapability,
  PlatformEnvironment,
  PlatformGameplay,
  PlatformIdentity,
  PlatformLifecycle,
  PlatformPayments,
  PlatformStorage
} from './types';

export interface PlatformRuntimeOptions {
  catalog?: PlatformCatalogOptions;
}

const REQUIRED_METHODS: Record<PlatformCapability, readonly string[]> = {
  identity: ['ready', 'playerId', 'displayName'],
  environment: ['platformCode', 'language', 'deviceType', 'platformOs', 'launchPayload', 'serverTime'],
  storage: ['isCloud', 'ready', 'get', 'set', 'clear'],
  gameplay: ['reportLoadingProgress', 'ready', 'start', 'stop'],
  ads: ['showInterstitial', 'showRewarded', 'isRewardedAvailable'],
  payments: ['purchase', 'restore', 'getCatalog'],
  lifecycle: ['canCreateShortcut', 'createShortcut']
};

const REQUIRED_CAPABILITIES: readonly PlatformCapability[] = ['identity', 'environment', 'storage', 'gameplay'];
const OPTIONAL_CAPABILITIES: readonly PlatformCapability[] = ['ads', 'payments', 'lifecycle'];

function checkCapability(platform: GamePlatform, name: PlatformCapability): void {
  const capability = platform[name] as unknown as Record<string, unknown> | null | undefined;
  if (!capability || typeof capability !== 'object') throw new TypeError(`PlatformRuntime: capability "${name}" is required`);
  for (const method of REQUIRED_METHODS[name]) {
    if (typeof capability[method] !== 'function') throw new TypeError(`PlatformRuntime: ${name}.${method}() is missing`);
  }
}

/**
 * The storage invariant, enforced for ANY adapter: a read answers an object or rejects. An adapter
 * that maps its failure to null / undefined would otherwise read as "new player" in the host.
 */
function guardStorage(storage: PlatformStorage): PlatformStorage {
  return {
    isCloud: () => storage.isCloud(),
    ready: () => storage.ready(),
    get: async (keys) => {
      const data: unknown = await storage.get(keys);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('PlatformRuntime: storage.get() must answer an object or reject — a failed read is never an empty profile');
      }
      return data as Record<string, unknown>;
    },
    set: (patch) => storage.set(patch),
    clear: (keys) => storage.clear(keys)
  };
}

/**
 * A small facade over the capabilities of ONE platform. The host builds the platform for its
 * explicit build target (`createDevPlatform()`, later the Yandex / CleverApps adapters) and hands
 * it in — there is no SDK detection here, and no stub for a capability the platform lacks:
 * `platform.ads` / `payments` / `lifecycle` are undefined when it cannot.
 *
 *   const platform = new PlatformRuntime(createDevPlatform());
 *   await platform.ready();
 *   const purchases = platform.payments && new PurchaseRuntime({ payments: platform.payments, … });
 *   const offers = new OfferRuntime({ …, input: { …, hasPrice: (id) => platform.catalog.hasPrice(id) } });
 */
export class PlatformRuntime {
  readonly identity: PlatformIdentity;
  readonly environment: PlatformEnvironment;
  readonly storage: PlatformStorage;
  readonly gameplay: PlatformGameplay;
  readonly ads: PlatformAds | undefined;
  readonly payments: PlatformPayments | undefined;
  readonly lifecycle: PlatformLifecycle | undefined;
  /** The live catalog over `payments.getCatalog()`; permanently empty (`unavailable`) without payments. */
  readonly catalog: PlatformCatalog;

  private readyPromise: Promise<void> | null = null;

  constructor(platform: GamePlatform, options: PlatformRuntimeOptions = {}) {
    if (!platform || typeof platform !== 'object') throw new TypeError('PlatformRuntime: a platform is required');
    for (const name of REQUIRED_CAPABILITIES) checkCapability(platform, name);
    for (const name of OPTIONAL_CAPABILITIES) if (platform[name] != null) checkCapability(platform, name);
    const code = platform.environment.platformCode();
    if (!PLATFORM_CODES.includes(code)) throw new RangeError(`PlatformRuntime: unknown platform code "${String(code)}"`);

    this.identity = platform.identity;
    this.environment = platform.environment;
    this.storage = guardStorage(platform.storage);
    this.gameplay = platform.gameplay;
    this.ads = platform.ads ?? undefined;
    this.payments = platform.payments ?? undefined;
    this.lifecycle = platform.lifecycle ?? undefined;
    this.catalog = new PlatformCatalog(this.payments, options.catalog);
  }

  /**
   * Identity, then storage (on Yandex the storage hangs off the player). A failure rejects and is
   * not remembered — the host may call again; success is remembered.
   */
  ready(): Promise<void> {
    if (!this.readyPromise) {
      const attempt = (async () => {
        await this.identity.ready();
        await this.storage.ready();
      })();
      this.readyPromise = attempt;
      attempt.catch(() => {
        if (this.readyPromise === attempt) this.readyPromise = null;
      });
    }
    return this.readyPromise;
  }

  has(capability: PlatformCapability): boolean {
    return this[capability] !== undefined;
  }

  capabilities(): PlatformCapabilities {
    return {
      ads: this.ads !== undefined,
      banner: typeof this.ads?.showBanner === 'function' && typeof this.ads.hideBanner === 'function',
      payments: this.payments !== undefined,
      lifecycle: this.lifecycle !== undefined,
      cloudStorage: this.storage.isCloud()
    };
  }
}
