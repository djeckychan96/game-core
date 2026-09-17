import { createYandexPlatform } from '../../../src/platform/adapters/yandex';
import type {
  PlatformVisibility,
  YandexCatalogProduct,
  YandexFullscreenAdCallbacks,
  YandexPaymentsApi,
  YandexPlatform,
  YandexPlatformOptions,
  YandexPlayer,
  YandexPurchase,
  YandexRewardedAdCallbacks,
  YandexSdk
} from '../../../src/platform/adapters/yandex';

export type FakeMode = 'ok' | 'fail' | 'hang';

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/**
 * A scriptable Yandex Games SDK with the production shapes: callbacks for ads, held receipts for
 * payments, a key-value cloud. Never the real SDK, never a request. `calls` logs every SDK call.
 */
export class FakeYandex {
  readonly calls: string[] = [];
  /** The options object of every `getPlayer` call, boot and retries alike. */
  readonly playerRequests: unknown[] = [];
  /** How many of the next `YaGames.init()` calls reject. */
  initFailures = 0;
  initMode: FakeMode = 'ok';
  playerMode: FakeMode = 'ok';
  playerId = 'ya-player-1';
  playerName = 'Константин Константинопольский';
  paymentsMode: FakeMode = 'ok';
  lang = 'ru';
  deviceType = 'mobile';
  payload: unknown = 'promo';
  serverTimeMs = 1_758_103_200_123;

  cloud: Record<string, unknown> = {};
  /** How many of the next `getData` calls reject. */
  getDataFailures = 0;
  getDataMode: FakeMode = 'ok';
  getDataAnswer: unknown = undefined;
  setDataMode: FakeMode = 'ok';
  readonly writes: Array<{ data: Record<string, unknown>; flush: boolean | undefined }> = [];

  catalog: YandexCatalogProduct[] = [];
  catalogMode: FakeMode = 'ok';
  held: YandexPurchase[] = [];
  /** `paid-hang` = the money is taken, the receipt is held, the promise never answers (the Yandex check of 11.08). */
  purchaseMode: 'ok' | 'cancel' | 'fail' | 'hang' | 'paid-hang' | 'no-token' = 'ok';
  getPurchasesMode: FakeMode = 'ok';
  consumeFailures = 0;
  private seq = 0;

  adThrows = false;
  inter: YandexFullscreenAdCallbacks | null = null;
  rewarded: YandexRewardedAdCallbacks | null = null;

  readonly player: YandexPlayer = {
    getUniqueID: () => this.playerId,
    getName: () => this.playerName,
    getData: (keys) => {
      this.calls.push(`getData:${(keys ?? []).join(',')}`);
      if (this.getDataMode === 'hang') return never();
      if (this.getDataFailures > 0) {
        this.getDataFailures--;
        return Promise.reject(new Error('network'));
      }
      if (this.getDataAnswer !== undefined) return Promise.resolve(this.getDataAnswer as Record<string, unknown>);
      const data: Record<string, unknown> = {};
      for (const key of keys ?? Object.keys(this.cloud)) if (key in this.cloud) data[key] = this.cloud[key];
      return Promise.resolve(data);
    },
    setData: (data, flush) => {
      this.calls.push(`setData:${Object.keys(data).join(',')}`);
      this.writes.push({ data: JSON.parse(JSON.stringify(data)), flush });
      if (this.setDataMode === 'hang') return never();
      if (this.setDataMode === 'fail') return Promise.reject(new Error('rate_limit'));
      for (const [key, value] of Object.entries(data)) {
        if (value === null) delete this.cloud[key];
        else this.cloud[key] = JSON.parse(JSON.stringify(value));
      }
      return Promise.resolve();
    }
  };

  readonly paymentsApi: YandexPaymentsApi = {
    getCatalog: () => {
      this.calls.push('getCatalog');
      if (this.catalogMode === 'hang') return never();
      if (this.catalogMode === 'fail') return Promise.reject(new Error('catalog_down'));
      return Promise.resolve(this.catalog);
    },
    purchase: ({ id }) => {
      this.calls.push(`purchase:${id}`);
      const pay = (): YandexPurchase => {
        const purchase: YandexPurchase = { productID: id, purchaseToken: `ya-token-${++this.seq}`, developerPayload: '', signature: '' };
        this.held.push(purchase);
        return purchase;
      };
      switch (this.purchaseMode) {
        case 'ok':
          return Promise.resolve(pay());
        case 'no-token':
          return Promise.resolve({ productID: id });
        case 'cancel':
          return Promise.resolve(null);
        case 'fail':
          return Promise.reject(new Error('payment_window_closed'));
        case 'paid-hang':
          pay();
          return never();
        case 'hang':
          return never();
      }
    },
    getPurchases: () => {
      this.calls.push('getPurchases');
      if (this.getPurchasesMode === 'hang') return never();
      if (this.getPurchasesMode === 'fail') return Promise.reject(new Error('purchases_down'));
      return Promise.resolve([...this.held]);
    },
    consumePurchase: (token) => {
      this.calls.push(`consume:${token}`);
      if (this.consumeFailures > 0) {
        this.consumeFailures--;
        return Promise.reject(new Error('consume_down'));
      }
      this.held = this.held.filter((purchase) => purchase.purchaseToken !== token);
      return Promise.resolve();
    }
  };

  readonly sdk: YandexSdk = {
    environment: { i18n: { lang: 'ru' }, payload: 'promo' },
    deviceInfo: { type: 'mobile' },
    features: {
      LoadingAPI: { ready: () => void this.calls.push('LoadingAPI.ready') },
      GameplayAPI: { start: () => void this.calls.push('GameplayAPI.start'), stop: () => void this.calls.push('GameplayAPI.stop') }
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => {
        this.calls.push('showFullscreenAdv');
        if (this.adThrows) throw new Error('adv is busy');
        this.inter = callbacks;
      },
      showRewardedVideo: ({ callbacks }) => {
        this.calls.push('showRewardedVideo');
        if (this.adThrows) throw new Error('adv is busy');
        this.rewarded = callbacks;
      }
    },
    getPlayer: (options) => {
      this.calls.push('getPlayer');
      this.playerRequests.push(options);
      if (this.playerMode === 'hang') return never();
      if (this.playerMode === 'fail') return Promise.reject(new Error('player_down'));
      return Promise.resolve(this.player);
    },
    getPayments: (options) => {
      this.calls.push(`getPayments:signed=${String(options?.signed)}`);
      if (this.paymentsMode === 'hang') return never();
      if (this.paymentsMode === 'fail') return Promise.reject(new Error('iap_not_configured'));
      return Promise.resolve(this.paymentsApi);
    },
    serverTime: () => this.serverTimeMs
  };

  /** The injected boot — what `YaGames.init()` is in production. */
  readonly init = (): Promise<YandexSdk> => {
    this.calls.push('init');
    if (this.initMode === 'hang') return never();
    if (this.initMode === 'fail' || this.initFailures > 0) {
      if (this.initFailures > 0) this.initFailures--;
      return Promise.reject(new Error('init_down'));
    }
    this.sdk.environment = { i18n: { lang: this.lang }, payload: this.payload };
    this.sdk.deviceInfo = { type: this.deviceType };
    return Promise.resolve(this.sdk);
  };

  count(prefix: string): number {
    return this.calls.filter((call) => call.startsWith(prefix)).length;
  }
}

export class FakeVisibility implements PlatformVisibility {
  visible = true;
  private listeners = new Set<() => void>();
  isVisible(): boolean {
    return this.visible;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  set(visible: boolean): void {
    this.visible = visible;
    for (const listener of [...this.listeners]) listener();
  }
  get size(): number {
    return this.listeners.size;
  }
}

export interface YandexHarness {
  fake: FakeYandex;
  platform: YandexPlatform;
  visibility: FakeVisibility;
  diagnostics: string[];
  players: Array<string | null>;
  /** `pauseAudio`, `resumeAudio`, `adShowing:true|false` in call order. */
  hooks: string[];
}

export function makeYandex(setup: (fake: FakeYandex) => void = () => {}, options: Partial<YandexPlatformOptions> = {}): YandexHarness {
  const fake = new FakeYandex();
  setup(fake);
  const visibility = new FakeVisibility();
  const diagnostics: string[] = [];
  const players: Array<string | null> = [];
  const hooks: string[] = [];
  const platform = createYandexPlatform({
    init: fake.init,
    visibility,
    onDiagnostic: (code) => diagnostics.push(code),
    onPlayer: (id) => players.push(id),
    hooks: {
      pauseAudio: () => hooks.push('pauseAudio'),
      resumeAudio: () => hooks.push('resumeAudio'),
      setAdShowing: (showing) => hooks.push(`adShowing:${showing}`)
    },
    ...options
  });
  return { fake, platform, visibility, diagnostics, players, hooks };
}

/** Lets already-resolved promise chains run (no timers involved). */
export async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}
