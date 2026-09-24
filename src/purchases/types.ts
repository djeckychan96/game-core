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
 * What `restore()` does with a purchase it has not granted yet — the donor's two platforms differ.
 * It is a RESTORE policy only: a direct `purchase()` is claim → grant → consume (not awaited) under
 * both, because the platform's ok answer comes once, while a held receipt is listed on every pass.
 * - `after-consume` (Yandex, the default) — consume → mark → grant: only what was consumed is marked
 *   and granted; a failed consume leaves the purchase for the next `restore()`. Never over-grants,
 *   even when the registry cannot persist (private mode) and the payment service is down. The price:
 *   a consume that lands on the platform while its answer is lost (tab closed, SDK timeout) loses
 *   that one receipt.
 * - `before-consume` (CleverApps) — mark → grant → consume: the consume failure is ignored; the
 *   next `restore()` finishes the consume without a second grant.
 * Under both, each receipt of a pass is granted as soon as its own order allows — never after
 * another receipt's consume. An adapter without `consume` has nothing to wait for — both read as
 * `before-consume`. Ledger mode (`PurchaseRuntimeOptions.ledger`) ignores it for consumables: apply
 * durably, then consume — that closes the lost-consume-answer window of `after-consume`.
 */
export type RestoreGrantPolicy = 'after-consume' | 'before-consume';

/**
 * What a paid product IS, from the host's catalog / config (`PurchaseRuntimeOptions.productKinds`):
 * - `consumable` (the default for every product not listed) — coins, packs: the v0.6 pipeline, the
 *   receipt is consumed so the product can be bought again;
 * - `entitlement` — a permanent right bought once (SoliPix production: `no_ads`). Its receipt is
 *   NEVER consumed, neither after a direct purchase nor by `restore()`: the unconsumed receipt is
 *   what lets the platform give the right back on another device. The consequence shapes the rest:
 *   the platform lists that receipt on EVERY `restore()`, forever.
 * Nothing else exists here on purpose — no subscriptions, no expiry, no server receipts.
 */
export type PurchaseProductKind = 'consumable' | 'entitlement';

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
  /**
   * Closes a purchase on the platform so it stops coming back from `restore()`. Never awaited before
   * a grant except by `after-consume` restore (the receipt's own consume); a hang holds only the
   * `RestoreResult` of that pass, so the adapter should time it out (Yandex: 8 s).
   */
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
  /**
   * `resolveGrant` has no rewards for a paid product (config out of sync with the platform console).
   * Like in the donor, the purchase is already marked (and consumed, or being consumed) — it is
   * reported, not retried.
   */
  | 'no_grant'
  /** `resolveGrant` / `grant` threw — same consequence as `no_grant`. */
  | 'grant_threw'
  /** `adapter.restore()` rejected or threw. */
  | 'restore_failed'
  /**
   * Ledger mode: `PurchaseLedger.apply` answered `not_durable`, threw, or answered something else — the
   * effect is not confirmed durable. Nothing was consumed: the receipt stays on the platform, and the
   * next `restore()` applies it again (the ledger is idempotent by token).
   */
  | 'not_durable'
  /** Ledger mode: a consumable receipt without a token cannot be applied idempotently — left on the platform, not consumed. */
  | 'no_token';

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
      /**
       * Present only for an entitlement — a consumable's event is exactly the v0.6 object. A RESTORED
       * entitlement is not new money: its receipt is listed forever, so a new device or a lost
       * registry grants it again (`createPurchaseAnalyticsHandler` sends no revenue for it).
       */
      kind?: 'entitlement';
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

/**
 * What `PurchaseLedger.apply` answers for one token:
 * - `applied` — THIS call made the effect and the token durable together (one confirmed write);
 * - `already_applied` — the token is in the owner's CONFIRMED durable record already: nothing was applied;
 * - `not_durable` — no durable confirmation (the write failed, timed out, is ambiguous, or there is no
 *   durable storage at all — a guest): Core does not consume, does not report a grant, and may call
 *   `apply` again with the same token later.
 */
export type PurchaseLedgerApplyResult = 'applied' | 'already_applied' | 'not_durable';

export interface PurchaseLedgerEntry<TGrant = unknown> {
  /** The payment's key — what the owner records as applied, next to the effect. */
  token: string;
  /** The product the platform says was paid. */
  productId: string;
  /** `resolveGrant(productId)` — the effect to apply. */
  rewards: TGrant;
  context: PurchaseGrantContext;
}

/**
 * Durable, idempotent delivery of a CONSUMABLE, provided by whoever OWNS the value (the host for a
 * gameplay-owned balance, a Core module for a Core-owned one). Core cannot make a token and an effect
 * that live in two records atomic, so the owner does it — in ONE operation, never check-then-apply:
 * 1. Atomic: the effect and the token are written by ONE durable write of ONE record (e.g. the game
 *    save holding `coins` AND `appliedPurchaseTokens`). Any durable state that holds the effect holds
 *    the token, and the other way round.
 * 2. Idempotent by token: the effect is never applied twice for a token — whether it is confirmed or
 *    only pending in memory after a write that did not confirm.
 * 3. Honest: `applied` / `already_applied` only when the token is in a CONFIRMED write (a storage `set`
 *    that answered true); a pending token is written again and answered by that write.
 * 4. Deterministic: the write carries the whole record state (never a blind `balance += n` over an
 *    unknown server state), so repeating it after an ambiguous answer cannot apply the effect twice.
 * 5. The record is loaded before `restore()` runs, and every later write of it keeps the tokens.
 * Core calls `apply` at most once at a time per token, consumes only after `applied` /
 * `already_applied`, and never consumes after `not_durable`. The guarantee is per save lineage:
 * two devices writing the same record concurrently over a storage without versioning can still
 * overwrite each other (a storage concern, not the ledger's).
 */
export interface PurchaseLedger<TGrant = unknown> {
  apply(entry: PurchaseLedgerEntry<TGrant>): PurchaseLedgerApplyResult | PromiseLike<PurchaseLedgerApplyResult>;
}

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
   * event. Called at most once per token, right after the token is marked (after-consume restore:
   * after the receipt was consumed) and never after a consume of it is awaited, so a throw here
   * loses the purchase — it is reported as `grant_threw`, never retried. Do not throw for a product
   * `resolveGrant` knows.
   */
  grant(productId: string, rewards: TGrant, context: PurchaseGrantContext): void;
  onEvent?: PurchaseEventHandler<TGrant>;
  /** Where a throwing `onEvent` lands; defaults to console.error. The pipeline is never affected. */
  onPurchaseError?: PurchaseCallbackErrorHandler;
  /** The host's own payer knowledge (profile payment count, a saved flag); OR-ed with this session's payments. */
  isPayer?(): boolean;
  /**
   * Ledger mode (opt-in, the production-safe path for consumables): every CONSUMABLE is delivered by
   * `ledger.apply` — effect + token in one durable write of the value owner — and consumed only after
   * it answered `applied` / `already_applied`, on the direct path and on restore alike (`restoreGrant`
   * no longer orders consumables). `grant` and the `granted` registry then serve entitlements only;
   * the registry is still READ for consumables, so a token granted before the switch is never applied
   * again. Without it: the legacy pipeline — best-effort crash durability, see `tests/purchases/crash-windows.test.ts`.
   */
  ledger?: PurchaseLedger<TGrant>;
  /**
   * The consume policy, by product id — game config, read once at construction. A product that is
   * not listed is a `consumable`, so a host without this option runs the v0.6 pipeline unchanged.
   * An unknown kind throws at construction: a typo would otherwise CONSUME a permanent purchase,
   * which cannot be undone. The kind follows the product the PLATFORM reports, like the grant.
   */
  productKinds?: Readonly<Record<string, PurchaseProductKind>>;
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
   * three waves 3 s / 15 s / 45 s later. False for `ok`, `duplicate`, `busy`, `disposed` and for a
   * failed grant (`no_grant` / `grant_threw`: the token is already marked, a restore would not grant it).
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
  /**
   * Entitlements the platform still lists whose token was granted before: nothing was consumed,
   * granted or reported as a `duplicate` (it is the steady state of a permanent purchase, not an
   * anomaly). The host re-asserts the right from this list — production sets the flag on every
   * start, so a profile that lost it (cloud reset, conflict) heals. Present only when not empty:
   * a pass without entitlements answers the v0.6 object.
   */
  owned?: RestoredPurchase[];
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
