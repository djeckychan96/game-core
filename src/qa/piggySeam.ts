// QA-only piggy bank seam — fills and buys a game's Core piggy bank in a QA BUILD without a payment. It lives only in
// `game-core/qa` and drives the bank through its PUBLIC API alone:
//   fill: stage({ key: 'qa-piggy-bank:fill:…', amount }) + collect()  (capped by the capacity like any accrual; also
//         collects what real level results staged) — it only ADDS: the QA buy empties the bank;
//   buy:  applyPurchase({ token: 'qa-piggy-bank:buy:…' }) — the bank's own paid-purchase path (payout + empty bank +
//         token in one write), refused below the purchase threshold like the real offer.
// No price, no platform payment, no wallet call of its own: every record it leaves is one the bank wrote itself.
import type { PiggyBankApplyResult, PiggyBankCollectResult, PiggyBankPurchaseEntry, PiggyBankSnapshot, PiggyBankStageEntry, PiggyBankStageResult } from '../piggy/types';
import type { QaActionCapability, QaNumberCapability } from './types';

/** The prefix of the seam's stage keys / purchase tokens (and its marker: a release scan proves this string is absent). */
export const QA_PIGGY_BANK_SOURCE = 'qa-piggy-bank';

/** The public methods of a Core piggy bank the seam uses. */
export interface QaPiggyBankTarget {
  snapshot(): PiggyBankSnapshot;
  stage(entry: PiggyBankStageEntry): PiggyBankStageResult;
  collect(): PiggyBankCollectResult;
  applyPurchase(entry: PiggyBankPurchaseEntry): Promise<PiggyBankApplyResult>;
}

/** Fills the bank up to a `target` balance (capped by its capacity). Throws on a lower target or a refusal. */
export function fillQaPiggyBank(piggy: QaPiggyBankTarget, target: number): { from: number; balance: number; capacity: number } {
  const snap = piggy.snapshot();
  if (snap.balance === null || snap.capacity === null || snap.level === null) throw new Error(`qa piggy bank: unknown (${snap.status}${snap.problem ? ` / ${snap.problem}` : ''})`);
  if (!Number.isSafeInteger(target) || target < 0) throw new RangeError('qa piggy bank: the value must be an integer ≥ 0');
  if (target < snap.balance) throw new RangeError(`qa piggy bank: can only add (now ${snap.balance}); "Buy (QA)" empties the bank`);
  if (target > snap.balance) {
    const staged = piggy.stage({ key: `${QA_PIGGY_BANK_SOURCE}:fill:${snap.level}:${snap.balance}:${target}`, amount: target - snap.balance });
    if (!staged.ok) throw new Error(`qa piggy bank: stage refused (${staged.reason})`);
  }
  const collected = piggy.collect();
  if (!collected.ok) throw new Error(`qa piggy bank: collect refused (${collected.reason})`);
  return { from: snap.balance, balance: collected.balance ?? snap.balance, capacity: snap.capacity };
}

/** Buys the bank without a payment (QA), through its paid-purchase path. Throws below the threshold or when it did not land. */
export async function buyQaPiggyBank(piggy: QaPiggyBankTarget): Promise<{ received: number; level: number | null; result: PiggyBankApplyResult }> {
  const snap = piggy.snapshot();
  if (!snap.canBuy) throw new Error(`qa piggy bank: not for sale below the threshold (${snap.balance ?? '?'} / ${snap.threshold ?? '?'})`);
  const received = snap.balance as number;
  const result = await piggy.applyPurchase({ token: `${QA_PIGGY_BANK_SOURCE}:buy:${snap.level}:${received}`, productId: QA_PIGGY_BANK_SOURCE });
  if (result === 'not_durable') throw new Error('qa piggy bank: the purchase was not stored (the save did not confirm) — try again');
  return { received, level: piggy.snapshot().level, result };
}

/** The QA panel's piggy bank controls: the bank's balance (fill) and a buy without a payment. */
export function createPiggyBankQaCapabilities(piggy: QaPiggyBankTarget): [QaNumberCapability, QaActionCapability] {
  return [
    {
      id: 'piggy.balance', kind: 'number', label: 'Piggy bank balance', min: 0, step: 500,
      hint: 'QA fill: adds up to the value (capped by the capacity; also collects staged level results); Buy empties it',
      get: () => piggy.snapshot().balance,
      set: (value: number) => fillQaPiggyBank(piggy, value)
    },
    {
      id: 'piggy.buy', kind: 'action', label: 'Piggy bank: buy (QA, no payment)',
      hint: 'from the purchase threshold: the balance goes to the wallet, the bank empties and goes up a level',
      run: () => buyQaPiggyBank(piggy)
    }
  ];
}
