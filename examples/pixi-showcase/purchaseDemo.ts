// PurchaseRuntime demo for the showcase: a FAKE payments adapter — no SDK, no request, no money.
// It behaves like a real platform where it matters: a paid purchase is a receipt that is HELD
// until it is consumed, and `restore()` lists the held ones. The "payment sheet" has no timer of
// its own: `purchase()` stays pending until the page closes the sheet (a MotionRuntime delay on
// the host ticker). A game passes its Yandex / CleverApps / Samsung adapter instead.
import type { PaymentsAdapter, PlatformPurchase, PlatformPurchaseResult, PurchasePriceResolver } from 'game-core';
import { DEMO_SHOP_ITEMS } from './demoData';
import { DEMO_OFFER_CATALOG } from './offerDemo';

/** How the open sheet ends: paid, cancelled by the player, or paid with the SDK answer lost (donor: the 11.08 Yandex case). */
export type DemoSheetOutcome = 'ok' | 'cancel' | 'lost';

export class DemoPaymentsAdapter implements PaymentsAdapter {
  /** Receipts the fake platform holds (paid, not consumed yet). */
  held: PlatformPurchase[] = [];
  /** What the NEXT closed sheet does; falls back to `ok` after one use. */
  nextOutcome: DemoSheetOutcome = 'ok';
  orders = 0;
  consumed = 0;
  private sheet: { productId: string; resolve: (answer: PlatformPurchaseResult | null) => void } | null = null;

  get sheetOpen(): boolean {
    return this.sheet !== null;
  }

  purchase(productId: string): Promise<PlatformPurchaseResult | null> {
    return new Promise((resolve) => {
      this.sheet = { productId, resolve };
    });
  }

  /** The page closes the payment sheet. `cancel` overrides the planned outcome (RESET while paying). */
  closeSheet(force?: 'cancel'): void {
    const sheet = this.sheet;
    if (!sheet) return;
    this.sheet = null;
    const outcome = force ?? this.nextOutcome;
    this.nextOutcome = 'ok';
    if (outcome === 'cancel') return sheet.resolve({ status: 'cancelled', productId: sheet.productId });
    const receipt: PlatformPurchase = { productId: sheet.productId, token: `demo-order-${++this.orders}` };
    this.held.push(receipt);
    console.info(`[purchase demo] paid ${receipt.productId} · ${receipt.token}${outcome === 'lost' ? ' · the SDK answer is lost' : ''}`);
    sheet.resolve(outcome === 'lost' ? null : { status: 'ok', ...receipt });
  }

  restore(): Promise<PlatformPurchase[]> {
    return Promise.resolve([...this.held]);
  }

  consume(purchase: PlatformPurchase): Promise<void> {
    this.held = this.held.filter((it) => it.token !== purchase.token);
    this.consumed++;
    return Promise.resolve();
  }
}

/** The demo's "real catalog": the price strings the windows show, as money for the purchase event. */
export const demoPrice: PurchasePriceResolver = (productId) => {
  const text = DEMO_OFFER_CATALOG[productId] ?? DEMO_SHOP_ITEMS.find((item) => item.id === productId)?.price;
  return text === undefined ? undefined : { revenue: Number(text.replace('$', '')), currency: 'USD' };
};
