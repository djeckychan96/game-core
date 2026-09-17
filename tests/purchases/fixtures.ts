import { PurchaseRuntime, createGrantedPurchaseStore } from '../../src/purchases';
import type {
  GrantedPurchaseStore,
  PaymentsAdapter,
  PlatformPurchase,
  PlatformPurchaseResult,
  PurchaseEvent,
  PurchaseGrantContext,
  PurchaseRuntimeOptions,
  RestoreGrantPolicy
} from '../../src/purchases';

export type FakePurchaseMode =
  | 'ok'
  | 'cancel'
  | 'error'
  | 'throw'
  /** The money is taken and the receipt is held, but the SDK promise answers empty (donor: Yandex check of 11.08). */
  | 'paid-but-null'
  /** Waits for `settlePurchase()`. */
  | 'manual';

/**
 * A fake platform with real receipt semantics: a paid purchase is HELD until it is consumed, and
 * `restore()` lists what is held — so a test can reload, retry and restore against it. Never a
 * real SDK, never a request.
 */
export class FakePayments implements PaymentsAdapter {
  restoreGrant?: RestoreGrantPolicy;
  mode: FakePurchaseMode = 'ok';
  /** Overrides the product the platform reports for the next ok purchase. */
  answerProductId: string | undefined;
  /** The next ok purchase carries no token. */
  tokenless = false;
  /** How many of the next consume calls reject. */
  consumeFailures = 0;
  restoreThrows = false;
  held: PlatformPurchase[] = [];
  readonly purchaseCalls: string[] = [];
  readonly consumeCalls: PlatformPurchase[] = [];
  restoreCalls = 0;
  /** Every call in order — `purchase:<id>`, `restore`, `consume:<token>`. */
  readonly log: string[] = [];
  private seq = 0;
  private manual: { productId: string; resolve: (answer: PlatformPurchaseResult | null) => void; reject: (error: unknown) => void } | null = null;

  /** Puts a paid, unconsumed receipt on the platform (a purchase of an earlier session). */
  hold(productId: string | undefined, token?: string): PlatformPurchase {
    const purchase: PlatformPurchase = { raw: { sdk: true } };
    if (productId !== undefined) purchase.productId = productId;
    if (token !== undefined) purchase.token = token;
    this.held.push(purchase);
    return purchase;
  }

  private pay(productId: string): PlatformPurchaseResult {
    const purchase = this.hold(this.answerProductId ?? productId, this.tokenless ? undefined : `tok-${++this.seq}`);
    return { status: 'ok', ...purchase };
  }

  purchase(productId: string): Promise<PlatformPurchaseResult | null> {
    this.purchaseCalls.push(productId);
    this.log.push(`purchase:${productId}`);
    switch (this.mode) {
      case 'ok':
        return Promise.resolve(this.pay(productId));
      case 'cancel':
        return Promise.resolve({ status: 'cancelled', productId });
      case 'error':
        return Promise.resolve({ status: 'error', productId, error: new Error('payment service down') });
      case 'throw':
        return Promise.reject(new Error('sdk_timeout:purchase'));
      case 'paid-but-null':
        this.pay(productId);
        return Promise.resolve(null);
      case 'manual':
        return new Promise((resolve, reject) => {
          this.manual = { productId, resolve, reject };
        });
    }
  }

  /** Settles the `manual` purchase: paid (default), cancelled, or rejected. */
  settlePurchase(how: 'ok' | 'cancel' | 'throw' = 'ok'): void {
    const manual = this.manual;
    if (!manual) throw new Error('FakePayments: no manual purchase to settle');
    this.manual = null;
    if (how === 'ok') manual.resolve(this.pay(manual.productId));
    else if (how === 'cancel') manual.resolve(null);
    else manual.reject(new Error('sdk_timeout:purchase'));
  }

  restore(): Promise<PlatformPurchase[]> {
    this.restoreCalls++;
    this.log.push('restore');
    if (this.restoreThrows) return Promise.reject(new Error('sdk_timeout:getPurchases'));
    return Promise.resolve([...this.held]);
  }

  consume(purchase: PlatformPurchase): Promise<void> {
    this.consumeCalls.push(purchase);
    this.log.push(`consume:${purchase.token ?? '-'}`);
    if (this.consumeFailures > 0) {
      this.consumeFailures--;
      return Promise.reject(new Error('sdk_timeout:consume'));
    }
    this.held = this.held.filter((it) => it !== purchase && (purchase.token === undefined || it.token !== purchase.token));
    return Promise.resolve();
  }
}

export type DemoRewards = { coins: number };

export const CATALOG: Record<string, DemoRewards> = {
  gold_1: { coins: 1000 },
  gold_2: { coins: 3500 },
  starter_pack: { coins: 500 }
};

export interface Host {
  payments: FakePayments;
  store: GrantedPurchaseStore & { tokens(): string[] };
  wallet: { coins: number };
  /** One line per grant: `productId:token`. */
  grants: string[];
  contexts: PurchaseGrantContext[];
  events: PurchaseEvent<DemoRewards>[];
  /** Grant call and event order, for the ordering tests. */
  order: string[];
  types(): string[];
  runtime: PurchaseRuntime<DemoRewards>;
  /** A fresh runtime over the same platform, store and wallet — "the page was reloaded". */
  reload(): PurchaseRuntime<DemoRewards>;
}

export function makeHost(overrides: Partial<PurchaseRuntimeOptions<DemoRewards>> & { payments?: FakePayments } = {}): Host {
  const payments = overrides.payments ?? new FakePayments();
  const store = (overrides.granted as Host['store'] | undefined) ?? createGrantedPurchaseStore();
  const wallet = { coins: 0 };
  const grants: string[] = [];
  const contexts: PurchaseGrantContext[] = [];
  const events: PurchaseEvent<DemoRewards>[] = [];
  const order: string[] = [];
  const marked = (token: string | undefined): boolean => {
    try {
      return token !== undefined && store.has(token);
    } catch {
      return false; // the throwing-registry test
    }
  };
  const build = () =>
    new PurchaseRuntime<DemoRewards>({
      payments,
      granted: store,
      resolveGrant: (productId) => CATALOG[productId],
      grant: (productId, rewards, context) => {
        wallet.coins += rewards.coins;
        grants.push(`${productId}:${context.token ?? '-'}`);
        contexts.push(context);
        order.push(`grant:${productId}`);
        // the registry must not know the token yet while the grant runs
        order.push(`marked-during-grant:${marked(context.token)}`);
      },
      onEvent: (event) => {
        events.push(event);
        order.push(`event:${event.type}`);
        if (event.type === 'granted') order.push(`marked-at-event:${marked(event.token)}`);
      },
      ...overrides
    });
  const host: Host = {
    payments, store, wallet, grants, contexts, events, order,
    types: () => events.map((event) => event.type),
    runtime: build(),
    reload: () => {
      host.runtime = build();
      return host.runtime;
    }
  };
  return host;
}
