// Composition-level wiring: PiggyBankService ⇄ PurchaseRuntime (ledger mode). Both runtimes are known only as types:
//
//   new PurchaseRuntime({ …, ledger: createPiggyBankLedger(piggy, gameLedger) });
//
// PurchaseRuntime has ONE ledger for every consumable: the bank's products (its levels' `price.productId`) go to the
// bank, any other product to `next` (the game's own ledger) — without one, `not_durable` (the receipt stays unconsumed).
import type { PiggyBankApplyResult, PiggyBankPurchaseEntry } from '../piggy/types';
import type { PurchaseLedger } from '../purchases/types';

/** What the ledger needs from the bank — `PiggyBankService` satisfies it. */
export interface PiggyBankLedgerTarget {
  productIds(): string[];
  applyPurchase(entry: PiggyBankPurchaseEntry): Promise<PiggyBankApplyResult>;
}

/** A PurchaseRuntime ledger delivering the bank's paid products through `piggy.applyPurchase` (effect + token, one durable write). */
export function createPiggyBankLedger<TGrant = unknown>(piggy: PiggyBankLedgerTarget, next?: PurchaseLedger<TGrant>): PurchaseLedger<TGrant> {
  return {
    apply(entry) {
      if (piggy.productIds().includes(entry.productId)) return piggy.applyPurchase({ token: entry.token, productId: entry.productId });
      return next ? next.apply(entry) : 'not_durable';
    }
  };
}
