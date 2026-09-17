import type { PlatformProduct } from './types';

/** Where the catalog is read from — `PlatformPayments` satisfies it. */
export interface PlatformCatalogSource {
  getCatalog(): Promise<readonly PlatformProduct[] | null | undefined>;
}

export type PlatformCatalogErrorPhase = 'refresh' | 'onChange';
export type PlatformCatalogErrorHandler = (error: unknown, context: { phase: PlatformCatalogErrorPhase }) => void;

export interface PlatformCatalogOptions {
  /** Called after a refresh / merge that changed a price, a currency or added a product (the shop redraws). */
  onChange?: (products: readonly PlatformProduct[]) => void;
  /** A failed refresh (expected offline — silent by default) or a throwing `onChange` (console.error by default). */
  onError?: PlatformCatalogErrorHandler;
}

/**
 * - `ok` — the platform answered with at least one priced product;
 * - `empty` — it answered with none (the donor's "products not applied yet" — ask again later);
 * - `error` — the read failed; `unavailable` — this platform has no payments.
 * Known prices survive all three.
 */
export type PlatformCatalogRefreshStatus = 'ok' | 'empty' | 'error' | 'unavailable';

export interface PlatformCatalogRefresh {
  status: PlatformCatalogRefreshStatus;
  /** Priced products known after this refresh. */
  products: number;
  changed: boolean;
}

/**
 * Keeps what counts as a product in the donor: an id AND a ready price string (`if (product.id &&
 * product.price)`). Anything else is dropped; a repeated id — the later entry wins.
 */
export function normalizePlatformProducts(raw: unknown): PlatformProduct[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, PlatformProduct>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, priceText, currency } = entry as Partial<Record<keyof PlatformProduct, unknown>>;
    if (typeof id !== 'string' || id === '' || typeof priceText !== 'string' || priceText === '') continue;
    byId.set(id, { id, priceText, currency: typeof currency === 'string' ? currency : '' });
  }
  return [...byId.values()];
}

function defaultOnCatalogError(error: unknown, context: { phase: PlatformCatalogErrorPhase }): void {
  if (context.phase === 'refresh') return;
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[PlatformCatalog] onChange threw', error);
  }
}

/**
 * The live catalog state for the three consumers the donor has: `OfferRuntime`'s `hasPrice` gate
 * (an offer without a platform price never activates), the shop's price labels and the currency
 * behind `AdsInput.currencyScale`. It holds state only: WHEN to refresh (Yandex 15 / 45 / 120 s
 * retries, the CleverApps products polling) is the host's / adapter's schedule — no timers here.
 * A late catalog MERGES into the known prices, like the donor's `{ ...productPrices, ...late }`:
 * an empty or failed refresh never takes a price away from an offer that is already running.
 */
export class PlatformCatalog {
  private readonly byId = new Map<string, PlatformProduct>();
  private currencyCode = '';
  private inFlight: Promise<PlatformCatalogRefresh> | null = null;
  private readonly onChange: PlatformCatalogOptions['onChange'];
  private readonly onError: PlatformCatalogErrorHandler;

  constructor(private readonly source?: PlatformCatalogSource | null, options: PlatformCatalogOptions = {}) {
    this.onChange = options.onChange;
    this.onError = options.onError ?? defaultOnCatalogError;
  }

  /** Reads the platform catalog once. Calls made while one is in flight share its answer. */
  refresh(): Promise<PlatformCatalogRefresh> {
    if (!this.source) return Promise.resolve(this.result('unavailable', false));
    if (!this.inFlight) {
      this.inFlight = this.read(this.source).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /** The push path (an adapter that polls `payments.products` itself). Returns whether anything changed. */
  merge(products: unknown): boolean {
    return this.apply(normalizePlatformProducts(products));
  }

  private apply(list: PlatformProduct[]): boolean {
    let changed = false;
    for (const product of list) {
      const known = this.byId.get(product.id);
      if (known && known.priceText === product.priceText && known.currency === product.currency) continue;
      this.byId.set(product.id, product);
      changed = true;
    }
    // the donor's `catalog[0]?.priceCurrencyCode`, taken from the latest NON-EMPTY catalog
    const currency = list[0]?.currency ?? '';
    if (currency !== '' && currency !== this.currencyCode) {
      this.currencyCode = currency;
      changed = true;
    }
    if (changed && this.onChange) {
      try {
        this.onChange(this.products());
      } catch (error) {
        this.onError(error, { phase: 'onChange' });
      }
    }
    return changed;
  }

  /** `OfferChainInput.hasPrice` — live, never a snapshot. */
  hasPrice(productId: string): boolean {
    return this.byId.has(productId);
  }

  priceText(productId: string): string | undefined {
    return this.byId.get(productId)?.priceText;
  }

  product(productId: string): PlatformProduct | undefined {
    return this.byId.get(productId);
  }

  products(): PlatformProduct[] {
    return [...this.byId.values()];
  }

  /** The catalog's currency code, `""` until a priced catalog arrived — the host then falls back to its build target's pricing. */
  currency(): string {
    return this.currencyCode;
  }

  get size(): number {
    return this.byId.size;
  }

  private async read(source: PlatformCatalogSource): Promise<PlatformCatalogRefresh> {
    let raw: unknown;
    try {
      raw = await source.getCatalog();
    } catch (error) {
      this.onError(error, { phase: 'refresh' });
      return this.result('error', false);
    }
    const list = normalizePlatformProducts(raw);
    const changed = this.apply(list);
    return this.result(list.length > 0 ? 'ok' : 'empty', changed);
  }

  private result(status: PlatformCatalogRefreshStatus, changed: boolean): PlatformCatalogRefresh {
    return { status, products: this.byId.size, changed };
  }
}
