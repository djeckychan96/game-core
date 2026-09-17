// PurchaseRuntime v0.6 — types. The purchase pipeline of Trail Arrow 0.1.22 (`DataUpdateSystem`
// + the `shop.purchase` / `check.consummations` handlers of its Yandex and CleverApps platforms)
// without any platform SDK: payments, the granted-token registry and the grants are injected.

/**
 * One paid purchase as the platform reports it. The adapter maps its SDK object to this:
 * - `productId` — the product the PLATFORM says was paid (Yandex `productID`, CleverApps
 *   `product.productId ?? purchase.productId`). The grant follows it, not the requested id.
 * - `token` — the unique key of this payment for the granted registry (Yandex `purchaseToken`,
 *   CleverApps `paymentId ?? purchaseToken ?? productId:purchaseTime`). A purchase without one is
 *   still granted, but cannot be deduplicated (donor: "a rare double grant in the player's favour
 *   beats an unpaid purchase").
 * - `raw` — the SDK object, handed back to `consume()` untouched (CleverApps consumes the object,
 *   Yandex the token).
 */
export interface PlatformPurchase {
  productId?: string;
  token?: string;
  raw?: unknown;
}

export type PlatformPurchaseStatus = 'ok' | 'cancelled' | 'error';

export interface PlatformPurchaseResult extends PlatformPurchase {
  status: PlatformPurchaseStatus;
  /** What went wrong, for `status: 'error'`. */
  error?: unknown;
}

/**
 * What `restore()` does with a purchase it has not granted yet:
 * - `after-consume` (Yandex, the default) — consume first, grant only what was consumed; a failed
 *   consume leaves the purchase for the next `restore()`. Never over-grants, even when the registry
 *   cannot persist (private mode) and the payment service is down.
 * - `before-consume` (CleverApps) — grant and mark first, then consume and ignore its failure; the
 *   next `restore()` finishes the consume without a second grant.
 * An adapter without `consume` has nothing to wait for — both read as `before-consume`.
 */
export type RestoreGrantPolicy = 'after-consume' | 'before-consume';

/**
 * The platform side, injected. The adapter owns everything SDK-specific: readiness, availability
 * ("payments are off" → `cancelled`), SDK timeouts (the runtime has no timers — a promise that
 * never settles keeps `purchase()` pending), and the mapping to `PlatformPurchase`.
 */
export interface PaymentsAdapter {
  /** Opens the platform's payment flow. `null` / `undefined` reads as `cancelled` (CleverApps resolves empty on cancel). */
  purchase(productId: string): Promise<PlatformPurchaseResult | null | undefined>;
  /** Paid purchases the platform still holds (unconsumed receipts). */
  restore(): Promise<readonly PlatformPurchase[] | null | undefined>;
  /** Closes a purchase on the platform so it stops coming back from `restore()`. */
  consume?(purchase: PlatformPurchase): Promise<unknown>;
  readonly restoreGrant?: RestoreGrantPolicy;
}

/**
 * The registry of purchases that were already granted, by `PlatformPurchase.token`. The host
 * persists it (the donor: localStorage, last 50 tokens); `createGrantedPurchaseStore` is the
 * in-memory one. Both methods may throw (private mode) — the runtime then lives without the
 * registry, like the donor.
 */
export interface GrantedPurchaseStore {
  has(token: string): boolean;
  add(token: string): void;
}

export interface PurchaseGrantContext {
  /** The product being granted (the platform's word). */
  productId: string;
  /** The payment's registry key; undefined when the platform gave none. */
  token: string | undefined;
  /** True when the purchase came from `restore()`, false for a direct `purchase()`. */
  restored: boolean;
  /** Where the purchase started (`shop`, `offer_window` …); direct purchases only. */
  source: string | undefined;
  /** The product `purchase()` was called with; differs from `productId` when the platform answered with another one. */
  requestedProductId: string | undefined;
}

export type PurchaseErrorReason =
  /** The adapter answered `status: 'error'`. */
  | 'platform_error'
  /** `adapter.purchase()` rejected or threw. */
  | 'adapter_threw'
  /** The platform confirmed a payment without saying for which product. */
  | 'no_product_id'
  /** `resolveGrant` has no rewards for a paid product (config out of sync with the platform console). */
  | 'no_grant'
  /** `resolveGrant` / `grant` threw. */
  | 'grant_threw'
  /** `adapter.restore()` rejected or threw. */
  | 'restore_failed';

/**
 * Everything the host instruments. `granted` is the ONLY success event — for direct and restored
 * purchases alike (donor: one purchase-analytics point, restored receipts count as revenue too);
 * the host saves the profile on it. `duplicate` = the token was already granted, nothing was given.
 */
export type PurchaseEvent<TGrant = unknown> =
  | { type: 'started'; productId: string; source: string | undefined }
  | {
      type: 'granted';
      productId: string;
      token: string | undefined;
      rewards: TGrant;
      restored: boolean;
      source: string | undefined;
      requestedProductId: string | undefined;
    }
  | { type: 'cancelled'; productId: string; source: string | undefined }
  | { type: 'duplicate'; productId: string; token: string; restored: boolean; source: string | undefined }
  | { type: 'consume_failed'; productId: string; token: string | undefined; restored: boolean; error: unknown }
  | {
      type: 'error';
      reason: PurchaseErrorReason;
      productId: string | undefined;
      token: string | undefined;
      restored: boolean;
      source: string | undefined;
      error: unknown;
    };

export type PurchaseEventType = PurchaseEvent['type'];
export type PurchaseEventHandler<TGrant = unknown> = (event: PurchaseEvent<TGrant>) => void;

export type PurchaseErrorPhase = 'onEvent';

export interface PurchaseErrorContext {
  phase: PurchaseErrorPhase;
  event: PurchaseEvent;
}

export type PurchaseCallbackErrorHandler = (error: unknown, context: PurchaseErrorContext) => void;

export interface PurchaseRuntimeOptions<TGrant = unknown> {
  payments: PaymentsAdapter;
  granted: GrantedPurchaseStore;
  /** The rewards of a product, from the host's catalog (shop table, `offers.offerByProduct(id)?.rewards` …). Nothing → `no_grant`. */
  resolveGrant(productId: string, context: PurchaseGrantContext): TGrant | null | undefined;
  /**
   * Gives the rewards — synchronously, in memory; the host persists the profile on the `granted`
   * event. Called at most once per token. A throw reads as "not granted": the purchase is neither
   * marked nor consumed and comes back with the next `restore()`.
   */
  grant(productId: string, rewards: TGrant, context: PurchaseGrantContext): void;
  onEvent?: PurchaseEventHandler<TGrant>;
  /** Where a throwing `onEvent` lands; defaults to console.error. The pipeline is never affected. */
  onPurchaseError?: PurchaseCallbackErrorHandler;
  /** The host's own payer knowledge (profile payment count, a saved flag); OR-ed with this session's payments. */
  isPayer?(): boolean;
}

export type PurchaseStatus = 'ok' | 'cancelled' | 'error' | 'duplicate' | 'busy' | 'disposed';

export interface PurchaseResult {
  status: PurchaseStatus;
  /** The granted product for `ok`, otherwise the requested one. */
  productId: string;
  token: string | undefined;
  reason: PurchaseErrorReason | undefined;
  /**
   * The payment may have gone through although no grant happened here (donor: a cancelled or hung
   * `purchase()` with the money taken) — the host should run `restore()`, the donor does it in
   * three waves 3 s / 15 s / 45 s later. False for `ok`, `duplicate`, `busy`, `disposed`.
   */
  restoreAdvised: boolean;
}

export interface RestoredPurchase {
  productId: string;
  token: string | undefined;
}

export interface RestoreResult {
  /** `error` = the platform list could not be read (the host may retry; donor: 2 retries, 7 s / 14 s). */
  status: 'ok' | 'error' | 'busy' | 'disposed';
  /** Purchases the platform returned. */
  found: number;
  /** Purchases granted by THIS call. */
  granted: RestoredPurchase[];
}

export interface PurchasePending {
  productId: string;
  source: string | undefined;
}

export interface PurchaseRuntimeStats {
  /** Product of the purchase in flight, or null. */
  pending: string | null;
  restoring: boolean;
  payer: boolean;
  /** `purchase()` calls that reached the adapter. */
  started: number;
  /** Grants given (direct + restored). */
  granted: number;
  /** Of `granted`: the ones that came through `restore()`. */
  restored: number;
  cancelled: number;
  errors: number;
  /** Purchases whose token was already granted — nothing was given. */
  duplicates: number;
  consumeFailures: number;
  /** `has` / `add` of the granted store threw. */
  storeErrors: number;
  /** Events delivered to `onEvent`. */
  events: number;
  /** Caught `onEvent` exceptions. */
  callbackErrors: number;
  disposed: boolean;
}
