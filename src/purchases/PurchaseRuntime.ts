import type {
  GrantedPurchaseStore,
  PaymentsAdapter,
  PlatformPurchase,
  PurchaseCallbackErrorHandler,
  PurchaseErrorReason,
  PurchaseEvent,
  PurchaseEventHandler,
  PurchaseGrantContext,
  PurchasePending,
  PurchaseResult,
  PurchaseRuntimeOptions,
  PurchaseRuntimeStats,
  PurchaseStatus,
  RestoredPurchase,
  RestoreResult
} from './types';

// Same shape as the other modules' default handlers — independently re-declared (module boundary rule).
function defaultOnPurchaseError(error: unknown, context: { phase: string; event: PurchaseEvent }): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[PurchaseRuntime] onEvent threw', context, error);
  }
}

function tokenOf(purchase: PlatformPurchase): string | undefined {
  return typeof purchase.token === 'string' && purchase.token !== '' ? purchase.token : undefined;
}

type DeliverOutcome = 'granted' | 'no_grant' | 'grant_threw';

/**
 * The real-money purchase pipeline as a Game Core module: Trail Arrow's `DataUpdateSystem`
 * purchase hook + the `shop.purchase` / `check.consummations` handlers of its platforms, with the
 * platform, the granted registry and the rewards injected.
 *
 * Three rules hold on every path:
 * 1. Nothing is granted before the platform confirmed the payment (`status: 'ok'` from
 *    `purchase()`, or a purchase listed by `restore()`).
 * 2. One payment is granted once. "Was this token granted?" + "mark it" is a single synchronous
 *    block (`claim`), so a reload, a retry, a concurrent `restore()` or a repeated platform answer
 *    can never pass the check twice.
 * 3. A paid purchase is never lost to its consume: no consume stands between a mark and its grant,
 *    and none waits for another receipt's consume. A consume that hangs or fails only leaves the
 *    receipt on the platform; the next `restore()` closes it without a grant.
 *
 * The orders (production Trail Arrow 0.1.31 — review 20.09 №10 — for the direct path):
 * - direct purchase (Yandex and CleverApps alike, whatever `restoreGrant` says): platform ok →
 *   claim → grant → `granted` event → consume, NOT awaited (a failure is reported as
 *   `consume_failed`) → the answer;
 * - restore, `before-consume` (CleverApps): known? → claim → grant → consume (failure ignored);
 * - restore, `after-consume` (Yandex): known? → consume (a failure keeps the receipt: no mark, no
 *   grant) → claim → grant. The one order where the grant waits for a consume — its OWN: a receipt
 *   the platform lists on every pass is granted only once it is gone from the platform, which never
 *   over-grants even without a working registry. The price: a consume that lands on the platform
 *   while its answer is lost (tab closed, SDK timeout) loses that receipt;
 * - a restore pass treats every receipt independently — each is granted as soon as its own order
 *   allows, not after the pass; the answer (`RestoreResult`) waits for all consumes;
 * - an `entitlement` (`options.productKinds`, SoliPix production `no_ads`) is the same pipeline
 *   minus the consume, on both paths: direct = claim → grant; restore = known? → `owned`, else
 *   claim → grant. Rule 2 holds unchanged — one token, one grant.
 *
 * No timers live here: SDK timeouts belong to the adapter, the donor's restore waves (3 s / 15 s /
 * 45 s after a failed purchase, a restore at boot) to the host — `PurchaseResult.restoreAdvised`
 * says when.
 */
export class PurchaseRuntime<TGrant = unknown> {
  private readonly payments: PaymentsAdapter;
  private readonly grantedStore: GrantedPurchaseStore;
  private readonly resolveGrant: PurchaseRuntimeOptions<TGrant>['resolveGrant'];
  private readonly grant: PurchaseRuntimeOptions<TGrant>['grant'];
  private readonly onEvent: PurchaseEventHandler<TGrant> | null;
  private readonly onPurchaseError: PurchaseCallbackErrorHandler;
  private readonly hostIsPayer: (() => boolean) | null;
  private readonly entitlements: ReadonlySet<string>;
  private pending: PurchasePending | null = null;
  private restoring = false;
  private payer = false;
  private disposed = false;
  private started = 0;
  private granted = 0;
  private restored = 0;
  private cancelled = 0;
  private errors = 0;
  private duplicates = 0;
  private consumeFailures = 0;
  private storeErrors = 0;
  private events = 0;
  private callbackErrors = 0;

  constructor(options: PurchaseRuntimeOptions<TGrant>) {
    if (!options.payments || typeof options.payments.purchase !== 'function' || typeof options.payments.restore !== 'function') {
      throw new RangeError('PurchaseRuntime: options.payments with purchase() and restore() is required');
    }
    if (!options.granted || typeof options.granted.has !== 'function' || typeof options.granted.add !== 'function') {
      throw new RangeError('PurchaseRuntime: options.granted with has() and add() is required');
    }
    if (typeof options.resolveGrant !== 'function') throw new RangeError('PurchaseRuntime: options.resolveGrant is required');
    if (typeof options.grant !== 'function') throw new RangeError('PurchaseRuntime: options.grant is required');
    this.payments = options.payments;
    this.grantedStore = options.granted;
    this.resolveGrant = options.resolveGrant;
    this.grant = options.grant;
    this.onEvent = options.onEvent ?? null;
    this.onPurchaseError = options.onPurchaseError ?? defaultOnPurchaseError;
    this.hostIsPayer = options.isPayer ?? null;
    const entitlements = new Set<string>();
    for (const [productId, kind] of Object.entries(options.productKinds ?? {})) {
      // a typo must never read as "consumable": consuming a permanent purchase cannot be undone
      if (kind !== 'consumable' && kind !== 'entitlement') {
        throw new RangeError(`PurchaseRuntime: options.productKinds["${productId}"] must be 'consumable' or 'entitlement'`);
      }
      if (kind === 'entitlement') entitlements.add(productId);
    }
    this.entitlements = entitlements;
  }

  /**
   * Buys `productId` through the platform. Never rejects: the outcome is the result's `status`.
   * While a purchase is in flight a second call returns `busy` without reaching the platform.
   * The grant follows the product the PLATFORM reports (the donor does the same); the requested
   * id travels along as `requestedProductId`.
   */
  async purchase(productId: string, source?: string): Promise<PurchaseResult> {
    if (this.disposed) return this.result('disposed', productId);
    if (this.pending) return this.result('busy', productId);
    this.pending = { productId, source };
    this.started++;
    this.emit({ type: 'started', productId, source });
    try {
      let answer: Awaited<ReturnType<PaymentsAdapter['purchase']>>;
      try {
        answer = await this.payments.purchase(productId);
      } catch (error) {
        if (this.disposed) return this.result('disposed', productId);
        this.report('adapter_threw', productId, undefined, source, false, error);
        return this.result('error', productId, undefined, 'adapter_threw', true);
      }
      // disposed while the payment sheet was open: nothing is granted, marked or consumed —
      // a paid purchase stays on the platform for the next runtime's restore()
      if (this.disposed) return this.result('disposed', productId);

      if (!answer || answer.status === 'cancelled') {
        this.cancelled++;
        this.emit({ type: 'cancelled', productId, source });
        return this.result('cancelled', productId, undefined, undefined, true);
      }
      if (answer.status !== 'ok') {
        this.report('platform_error', productId, tokenOf(answer), source, false, answer.error);
        return this.result('error', productId, tokenOf(answer), 'platform_error', true);
      }

      this.payer = true; // donor: any confirmed payment → the payer segment
      const token = tokenOf(answer);
      const paidProductId = typeof answer.productId === 'string' && answer.productId !== '' ? answer.productId : undefined;
      if (paidProductId === undefined) {
        this.report('no_product_id', undefined, token, source, false, undefined);
        return this.result('error', productId, token, 'no_product_id', true);
      }

      const context: PurchaseGrantContext = { productId: paidProductId, token, restored: false, source, requestedProductId: productId };
      // claim → grant in one synchronous block, THEN consume, never awaited (production 0.1.31, review
      // 20.09 №10: the old claim → await consume → grant lost a paid purchase when the tab closed or the
      // consume hung — marked, maybe consumed, never granted). The claim already keeps any later
      // restore from granting this token, so the consume is only closing the receipt: a hang or a
      // failure is reported (`consume_failed`), the next restore() finishes it without a grant.
      const outcome = this.claim(context) ? this.deliver(context) : 'duplicate';
      // an entitlement keeps its receipt (SoliPix production: `no_ads` is bought and never consumed)
      if (!this.entitlements.has(paidProductId)) void this.consume(answer, context);
      if (outcome === 'duplicate') return this.result('duplicate', paidProductId, token);
      if (outcome === 'granted') return this.result('ok', paidProductId, token);
      // like the donor ("paid product has no reward mapping"): the token is marked and the receipt is
      // being consumed, so a restore would not bring this purchase back
      return this.result('error', productId, token, outcome, false);
    } finally {
      this.pending = null;
    }
  }

  /**
   * One pass over the purchases the platform still holds: a known token is only consumed, an
   * unknown one is claimed, granted and consumed in the order of `PaymentsAdapter.restoreGrant`,
   * each receipt on its own — a hung or failed consume never delays another receipt's grant. The
   * answer comes when every consume of the pass answered. A second call while one runs returns
   * `busy` (donor: two parallel restores saw the same receipt and paid it twice). Never rejects.
   * When to call it — at boot, after a failed purchase — is the host's.
   */
  async restore(): Promise<RestoreResult> {
    if (this.disposed) return { status: 'disposed', found: 0, granted: [] };
    if (this.restoring) return { status: 'busy', found: 0, granted: [] };
    this.restoring = true;
    try {
      let listed: Awaited<ReturnType<PaymentsAdapter['restore']>>;
      try {
        listed = await this.payments.restore();
      } catch (error) {
        if (this.disposed) return { status: 'disposed', found: 0, granted: [] };
        this.report('restore_failed', undefined, undefined, undefined, true, error);
        return { status: 'error', found: 0, granted: [] };
      }
      const purchases = Array.isArray(listed) ? (listed as readonly PlatformPurchase[]).filter((it) => !!it) : [];
      // disposed while the platform was listing: nothing is marked, consumed or granted
      if (this.disposed) return { status: 'disposed', found: purchases.length, granted: [] };
      const consumeFirst = this.payments.restoreGrant !== 'before-consume' && typeof this.payments.consume === 'function';
      const grantedAt: { index: number; purchase: RestoredPurchase }[] = [];
      const owned: RestoredPurchase[] = [];
      const consumes: Promise<unknown>[] = [];
      const grantNow = (index: number, context: PurchaseGrantContext): void => {
        if (this.deliver(context) === 'granted') grantedAt.push({ index, purchase: { productId: context.productId, token: context.token } });
      };

      // Every receipt is its own chain and no await sits between receipts: one consume that hangs or
      // fails never holds back the grant of another (a pass used to grant only after ALL its consumes —
      // what was marked or consumed before a hang, or before the tab closed, was lost).
      purchases.forEach((purchase, index) => {
        this.payer = true;
        const token = tokenOf(purchase);
        const productId = typeof purchase.productId === 'string' && purchase.productId !== '' ? purchase.productId : undefined;
        if (productId === undefined) {
          // nothing to grant and nothing proves what was paid: left on the platform, reported loudly
          this.report('no_product_id', undefined, token, undefined, true, undefined);
          return;
        }
        const context: PurchaseGrantContext = { productId, token, restored: true, source: undefined, requestedProductId: undefined };

        if (this.entitlements.has(productId)) {
          // a permanent right is never consumed, so the platform lists it on every pass: a known token is
          // the steady state (reported as `owned`, not as a `duplicate`), an unknown one is claimed and
          // granted once — the check and the mark stay one synchronous block
          if (token !== undefined && this.isGranted(token)) owned.push({ productId, token });
          else if (this.claim(context)) grantNow(index, context);
          return;
        }
        if (consumeFirst && !(token !== undefined && this.isGranted(token))) {
          // after-consume (Yandex): consume → claim → grant as soon as THIS consume answered. A failed
          // consume keeps the receipt for the next pass — not marked, not granted; so a receipt that is
          // listed again and again is granted once even when the registry cannot persist. The claim
          // re-checks the registry after the await.
          consumes.push(
            this.consume(purchase, context).then((consumed) => {
              if (consumed && this.claim(context)) grantNow(index, context);
            })
          );
          return;
        }
        // before-consume (CleverApps), or a token granted before: claim → grant → consume (a failure is
        // only reported, the next pass finishes it without a grant); a known token is only consumed
        if (this.claim(context)) grantNow(index, context);
        consumes.push(this.consume(purchase, context));
      });
      // the answer waits for every consume of the pass (a hung one keeps it — and a 2nd pass, `busy` —
      // waiting; the adapter owns the SDK timeout), the grants above did not
      await Promise.all(consumes);
      const grantedNow = grantedAt.sort((a, b) => a.index - b.index).map((it) => it.purchase);
      const status = this.disposed ? 'disposed' : 'ok';
      return owned.length > 0
        ? { status, found: purchases.length, granted: grantedNow, owned }
        : { status, found: purchases.length, granted: grantedNow };
    } finally {
      this.restoring = false;
    }
  }

  /** The purchase in flight, or null. */
  getPending(): PurchasePending | null {
    return this.pending ? { ...this.pending } : null;
  }

  /** True once the platform confirmed any payment in this session, or when the host's `isPayer()` says so. */
  isPayer(): boolean {
    if (this.payer) return true;
    if (!this.hostIsPayer) return false;
    try {
      return this.hostIsPayer() === true;
    } catch {
      return false;
    }
  }

  getStats(): PurchaseRuntimeStats {
    return {
      pending: this.pending ? this.pending.productId : null,
      restoring: this.restoring,
      payer: this.isPayer(),
      started: this.started,
      granted: this.granted,
      restored: this.restored,
      cancelled: this.cancelled,
      errors: this.errors,
      duplicates: this.duplicates,
      consumeFailures: this.consumeFailures,
      storeErrors: this.storeErrors,
      events: this.events,
      callbackErrors: this.callbackErrors,
      disposed: this.disposed
    };
  }

  /**
   * Stops the runtime: new calls return `disposed`, and a platform answer that arrives later is
   * not acted on (no mark, no consume, no grant — the purchase stays on the platform). A receipt
   * whose consume was already started when dispose() arrived is still carried through to its
   * grant (after-consume) — nothing would ever grant it again.
   */
  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  /**
   * The idempotency claim — the donor's `markGranted`, with the "already granted?" check in the
   * same synchronous block so nothing can interleave between the check and the mark. False = the
   * token was granted before (`duplicate`). A purchase without a token cannot be claimed or
   * deduplicated: it always passes (donor: granted without marking).
   */
  private claim(context: PurchaseGrantContext): boolean {
    const { productId, token, restored, source } = context;
    if (token === undefined) return true;
    if (this.isGranted(token)) {
      this.duplicates++;
      this.emit({ type: 'duplicate', productId, token, restored, source });
      return false;
    }
    this.markGranted(token);
    return true;
  }

  /** The grant itself — right after the claim, in the same synchronous block (after-consume restore: after its own consume). */
  private deliver(context: PurchaseGrantContext): DeliverOutcome {
    const { productId, token, restored, source, requestedProductId } = context;
    let rewards: TGrant | null | undefined;
    try {
      rewards = this.resolveGrant(productId, context);
    } catch (error) {
      this.report('grant_threw', productId, token, source, restored, error);
      return 'grant_threw';
    }
    if (rewards === null || rewards === undefined) {
      // donor: "paid product has no reward mapping" — the config is out of sync with the platform console
      this.report('no_grant', productId, token, source, restored, undefined);
      return 'no_grant';
    }
    try {
      this.grant(productId, rewards, context);
    } catch (error) {
      this.report('grant_threw', productId, token, source, restored, error);
      return 'grant_threw';
    }
    this.granted++;
    if (restored) this.restored++;
    const event: PurchaseEvent<TGrant> = { type: 'granted', productId, token, rewards, restored, source, requestedProductId };
    if (this.entitlements.has(productId)) event.kind = 'entitlement';
    this.emit(event);
    return 'granted';
  }

  /** True when the purchase is closed on the platform (or the platform has nothing to close). Never rejects. */
  private async consume(purchase: PlatformPurchase, context: PurchaseGrantContext): Promise<boolean> {
    if (typeof this.payments.consume !== 'function') return true;
    try {
      await this.payments.consume(purchase);
      return true;
    } catch (error) {
      this.consumeFailures++;
      this.emit({ type: 'consume_failed', productId: context.productId, token: context.token, restored: context.restored, error });
      return false;
    }
  }

  // donor: a registry that cannot be read or written (private mode) degrades to "no registry"
  private isGranted(token: string): boolean {
    try {
      return this.grantedStore.has(token) === true;
    } catch {
      this.storeErrors++;
      return false;
    }
  }

  private markGranted(token: string): void {
    try {
      this.grantedStore.add(token);
    } catch {
      this.storeErrors++;
    }
  }

  private report(
    reason: PurchaseErrorReason,
    productId: string | undefined,
    token: string | undefined,
    source: string | undefined,
    restored: boolean,
    error: unknown
  ): void {
    this.errors++;
    this.emit({ type: 'error', reason, productId, token, restored, source, error });
  }

  private result(
    status: PurchaseStatus,
    productId: string,
    token?: string,
    reason?: PurchaseErrorReason,
    restoreAdvised = false
  ): PurchaseResult {
    return { status, productId, token, reason, restoreAdvised };
  }

  private emit(event: PurchaseEvent<TGrant>): void {
    this.events++;
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch (error) {
      this.callbackErrors++;
      try {
        this.onPurchaseError(error, { phase: 'onEvent', event });
      } catch {
        // an error handler can never take the pipeline down
      }
    }
  }
}
