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

type GrantOutcome = 'granted' | 'duplicate' | PurchaseErrorReason;

/**
 * The real-money purchase pipeline as a Game Core module: Trail Arrow's `DataUpdateSystem`
 * purchase hook + the `shop.purchase` / `check.consummations` handlers of its platforms, with the
 * platform, the granted registry and the rewards injected.
 *
 * Two rules hold on every path:
 * 1. Nothing is granted before the platform confirmed the payment (`status: 'ok'` from
 *    `purchase()`, or a purchase listed by `restore()`).
 * 2. One payment is granted once. "Was this token granted?" → `grant` → "mark it" is a single
 *    synchronous block, so a reload, a retry, a concurrent `restore()` or a repeated platform
 *    answer can never pass the check twice; the token is marked BEFORE the consume is attempted
 *    (donor: a failed consume must not pay the receipt out again on the next launch).
 *
 * Direct purchase: platform ok → dedupe → grant → mark → `granted` event (the host saves) →
 * consume (a failure is only reported — the next `restore()` finishes it without a grant).
 * Restore: the same block per purchase; `PaymentsAdapter.restoreGrant` decides whether the
 * consume has to succeed first (Yandex) or follows the grant (CleverApps).
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
      const outcome = this.grantOnce(context);
      if (outcome === 'granted' || outcome === 'duplicate') {
        await this.consume(answer, context);
        return this.result(outcome === 'granted' ? 'ok' : 'duplicate', paidProductId, token);
      }
      // not granted → not marked, not consumed: the purchase comes back with restore(). A missing
      // reward mapping fails the same way every time, so no in-session restore is advised for it.
      return this.result('error', productId, token, outcome, outcome !== 'no_grant');
    } finally {
      this.pending = null;
    }
  }

  /**
   * One pass over the purchases the platform still holds: every one goes through the same
   * grant-once block as a direct purchase, a known token is only consumed. A second call while
   * one runs returns `busy` (donor: two parallel restores saw the same receipt and paid it
   * twice). Never rejects. When to call it — at boot, after a failed purchase — is the host's.
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
      const consumeFirst = this.payments.restoreGrant !== 'before-consume' && typeof this.payments.consume === 'function';
      const grantedNow: RestoredPurchase[] = [];

      for (const purchase of purchases) {
        if (this.disposed) break;
        this.payer = true;
        const token = tokenOf(purchase);
        const productId = typeof purchase.productId === 'string' && purchase.productId !== '' ? purchase.productId : undefined;
        if (productId === undefined) {
          // nothing to grant and nothing proves what was paid: left on the platform, reported loudly
          this.report('no_product_id', undefined, token, undefined, true, undefined);
          continue;
        }
        const context: PurchaseGrantContext = { productId, token, restored: true, source: undefined, requestedProductId: undefined };

        if (consumeFirst && !(token !== undefined && this.isGranted(token))) {
          // Yandex: grant only what was consumed; a failed consume keeps the purchase for the next pass.
          // Once the consume went through, the grant below runs even if dispose() arrived meanwhile —
          // a consumed purchase never comes back, dropping it would lose the payment.
          if (!(await this.consume(purchase, context))) continue;
          if (this.grantOnce(context) === 'granted') grantedNow.push({ productId, token });
          continue;
        }
        // a known token is only consumed; CleverApps: grant + mark first, then a best-effort consume
        const outcome = this.grantOnce(context);
        if (outcome === 'granted') grantedNow.push({ productId, token });
        if (outcome === 'granted' || outcome === 'duplicate') await this.consume(purchase, context);
      }
      return { status: this.disposed ? 'disposed' : 'ok', found: purchases.length, granted: grantedNow };
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
   * not acted on (no grant, no mark, no consume — the purchase stays on the platform).
   */
  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  /** The grant-once block. Synchronous on purpose: nothing can interleave between the check and the mark. */
  private grantOnce(context: PurchaseGrantContext): GrantOutcome {
    const { productId, token, restored, source, requestedProductId } = context;
    if (token !== undefined && this.isGranted(token)) {
      this.duplicates++;
      this.emit({ type: 'duplicate', productId, token, restored, source });
      return 'duplicate';
    }
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
    if (token !== undefined) this.markGranted(token);
    this.granted++;
    if (restored) this.restored++;
    this.emit({ type: 'granted', productId, token, rewards, restored, source, requestedProductId });
    return 'granted';
  }

  /** True when the purchase is closed on the platform (or the platform has nothing to close). */
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
