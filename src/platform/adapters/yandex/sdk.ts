// The part of the Yandex Games SDK the adapter really calls, as structural types — production
// (Trail Arrow 0.1.22 `platform/yandex/systems/HttpRequestSystem.ts`) uses nothing else. A fake with
// this shape is all a test or a stand needs.

export interface YandexPlayer {
  getUniqueID(): string;
  getName?(): string;
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  /** `flush: true` sends right away — production always does. */
  setData(data: Record<string, unknown>, flush?: boolean): Promise<unknown>;
}

export interface YandexPurchase {
  purchaseToken?: string;
  productID?: string;
  [key: string]: unknown;
}

export interface YandexCatalogProduct {
  id?: string;
  /** The READY price string, currency included: `"149 ₽"`. */
  price?: string;
  priceCurrencyCode?: string;
  [key: string]: unknown;
}

/** What `ysdk.getPayments()` resolves to — the SDK object itself has NO `.payments`. */
export interface YandexPaymentsApi {
  getCatalog(): Promise<YandexCatalogProduct[]>;
  purchase(options: { id: string }): Promise<YandexPurchase | null | undefined>;
  getPurchases(): Promise<YandexPurchase[]>;
  consumePurchase(token: string): Promise<unknown>;
}

export interface YandexFullscreenAdCallbacks {
  onOpen?(): void;
  onClose?(wasShown: boolean): void;
  onError?(error: unknown): void;
  onOffline?(): void;
}

export interface YandexRewardedAdCallbacks {
  onOpen?(): void;
  onRewarded?(): void;
  onClose?(wasShown?: boolean): void;
  onError?(error: unknown): void;
}

export interface YandexSdk {
  environment?: { i18n?: { lang?: string }; payload?: unknown };
  deviceInfo?: { type?: string };
  features?: {
    LoadingAPI?: { ready?(): void };
    GameplayAPI?: { start?(): void; stop?(): void };
  };
  adv: {
    showFullscreenAdv(options: { callbacks: YandexFullscreenAdCallbacks }): void;
    showRewardedVideo(options: { callbacks: YandexRewardedAdCallbacks }): void;
  };
  getPlayer(options?: Record<string, unknown>): Promise<YandexPlayer>;
  getPayments(options?: { signed?: boolean }): Promise<YandexPaymentsApi>;
  /** Milliseconds. */
  serverTime?(): number;
}

interface YandexGlobals {
  YaGames?: { init(): Promise<YandexSdk> };
  /** The donor's index.html loader contract: the SDK `<script>` is async + onload (3 retries), this promise is its load event. */
  __SDK_READY__?: PromiseLike<unknown>;
}

/**
 * The donor's `waitSdkScript`: the global is there → go; else wait for the page's loader promise
 * (its rejection = the script never came); neither → `sdk_script_missing`. Script retries live in
 * the page's `<script>` loader, not here.
 */
export async function waitForYandexScript(): Promise<void> {
  const globals = globalThis as unknown as YandexGlobals;
  if (typeof globals.YaGames !== 'undefined') return;
  if (globals.__SDK_READY__) {
    await globals.__SDK_READY__;
    return;
  }
  throw new Error('sdk_script_missing');
}

/** The production boot: `YaGames.init()`. The ONLY place in Game Core that names the SDK global. */
export function initYandexSdk(): Promise<YandexSdk> {
  const globals = globalThis as unknown as YandexGlobals;
  if (!globals.YaGames) return Promise.reject(new Error('sdk_script_missing'));
  return globals.YaGames.init();
}
