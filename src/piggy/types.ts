// Piggy Bank V1 — public types (root entry `game-core`). The service is src/piggy/PiggyBankService.ts.
import type { SoftCurrencyChangeContext, SoftCurrencyResult, SoftCurrencyWalletSnapshot } from '../economy/SoftCurrencyWallet';
import type { SaveGate, SaveWriteResult } from '../save/SaveGate';

/**
 * How a bank level is bought. Core never holds a real-money price: a `product` is a platform SKU whose price the host
 * reads from the platform catalog and whose payment goes through PurchaseRuntime (ledger mode: `createPiggyBankLedger`);
 * `wallet` is a price in the wallet's own currency, paid from it (`buyFromWallet()`). `null` = not for sale (no
 * approved price yet).
 */
export type PiggyBankPrice = { kind: 'product'; productId: string } | { kind: 'wallet'; amount: number };

/** One bank level: its capacity (in the wallet's currency) and how it is bought. */
export interface PiggyBankLevel {
  capacity: number;
  price: PiggyBankPrice | null;
}

/**
 * The game's piggy bank rules — game DATA, never a Core default:
 *   accrualPercent           — the share of a level's EARNED reward the bank gets on top (GDD example: 150 → 150 coins
 *                              earned add 225 to the bank; the player still gets the 150);
 *   purchaseThresholdPercent — the fill (of the current capacity) from which the bank can be bought (GDD: 50);
 *   levels                   — the bank levels in order; every purchase moves to the next one, the last one repeats.
 */
export interface PiggyBankConfig {
  accrualPercent: number;
  purchaseThresholdPercent: number;
  levels: readonly PiggyBankLevel[];
}

/** idle → load() → loading → ready, or unavailable (a failed Core read / a record that is not V1: never a fresh bank over it). */
export type PiggyBankStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export type PiggyBankProblem = 'read_failed' | 'invalid_record';

/**
 * The bank's fill, for the UI:
 *   empty       — 0 coins;
 *   partial     — below the purchase threshold (cannot be bought yet);
 *   purchasable — from the threshold, not full (can be bought);
 *   full        — at capacity: accrual stops (GDD: the icon glows, the counter says FULL / МАКС), can be bought.
 */
export type PiggyBankState = 'empty' | 'partial' | 'purchasable' | 'full';

export interface PiggyBankSnapshot {
  status: PiggyBankStatus;
  problem: PiggyBankProblem | null;
  /** ready AND the SaveGate is open: stage / collect / buy are accepted. */
  writable: boolean;
  /** The bank level, 1-based (GDD «Уровень 1…»); null while unknown. Past the last configured level the last one repeats. */
  level: number | null;
  /** What the bank holds (collected — what a purchase pays out), in the wallet's currency. */
  balance: number | null;
  capacity: number | null;
  /** The balance from which the bank can be bought: ceil(capacity × purchaseThresholdPercent / 100). */
  threshold: number | null;
  /** balance / capacity, 0…1. */
  progress: number | null;
  state: PiggyBankState | null;
  /** balance ≥ threshold (and > 0): the rule of the GDD; whether it is FOR SALE is `price`. */
  canBuy: boolean;
  /** How this level is bought; null = not for sale (no approved price / payment yet). */
  price: PiggyBankPrice | null;
  /** Staged by level results and not yet collected (it moves in at the lobby: `collect()`). */
  staged: number;
}

/** A level result's share for the bank — or (`amount`) an exact amount the host decided on (a QA seam, a bonus event). */
export type PiggyBankStageEntry =
  /** `key`: one stable id of this level result (an attempt id) — the same key twice counts once, across reloads. */
  | { key: string; earned: number }
  | { key: string; amount: number };

export type PiggyBankRefusal =
  | 'not_loaded'
  | 'unavailable'
  | 'not_open'
  | 'invalid_entry'
  /** buy: the bank is below the purchase threshold. */
  | 'below_threshold'
  /** buyFromWallet: this level is not sold for the wallet's currency. */
  | 'not_for_wallet'
  /** buyFromWallet: the wallet cannot pay the price. */
  | 'insufficient_funds'
  /** buy: the wallet refused the payout (not writable / out of range) — nothing changed. */
  | 'payout_refused'
  | 'disposed';

export interface PiggyBankStageResult {
  ok: boolean;
  reason: PiggyBankRefusal | null;
  /** Staged by this call (0 for a 0 reward or a duplicate — then nothing is written). */
  staged: number;
  /** This key was staged (or collected) before — in this session or a stored one: nothing changed. */
  duplicate: boolean;
  saved: Promise<SaveWriteResult> | null;
}

export interface PiggyBankCollectResult {
  ok: boolean;
  reason: PiggyBankRefusal | null;
  /** What moved into the bank now — what the «coins fly into the pig» animation shows. */
  added: number;
  /** Staged amounts that did not fit (the bank was or became full: GDD — accrual stops). */
  dropped: number;
  balance: number | null;
  full: boolean;
  saved: Promise<SaveWriteResult> | null;
}

export interface PiggyBankBuyResult {
  ok: boolean;
  reason: PiggyBankRefusal | null;
  /** Paid out to the wallet. */
  received: number;
  /** The bank level after the purchase (1-based). */
  level: number | null;
  /** ONE Core write of the bank and the wallet together. */
  saved: Promise<SaveWriteResult> | null;
}

/**
 * A paid platform purchase of the bank — the PurchaseRuntime ledger answer (`PurchaseLedgerApplyResult`): `applied` /
 * `already_applied` only after a CONFIRMED write holding the payout and the token together; `not_durable` = not stored
 * (the bank cannot take it now, or the write did not confirm): the receipt stays unconsumed and a later restore
 * applies it again — never twice.
 */
export type PiggyBankApplyResult = 'applied' | 'already_applied' | 'not_durable';

/** A paid platform purchase handed to the bank: the payment's token (its idempotency key) and the product paid. */
export interface PiggyBankPurchaseEntry {
  token: string;
  productId: string;
}

export type PiggyBankChange =
  | { kind: 'staged'; key: string; amount: number }
  | { kind: 'collected'; added: number; dropped: number; balance: number; full: boolean }
  | { kind: 'purchased'; level: number; received: number; via: 'wallet' | 'product'; token: string | null };

export type PiggyBankListener = (change: PiggyBankChange) => void;

/** What the bank needs from the wallet — `SoftCurrencyWallet` satisfies it (it must write through the same SaveGate). */
export interface PiggyBankWallet {
  readonly currency: string;
  snapshot(): Pick<SoftCurrencyWalletSnapshot, 'writable' | 'balance'>;
  grant(amount: number, context?: SoftCurrencyChangeContext): SoftCurrencyResult;
  trySpend(amount: number, context?: SoftCurrencyChangeContext): SoftCurrencyResult;
}

/** The SaveGate methods the bank uses — pass the game's SaveGate. */
export type PiggyBankSaveGate = Pick<SaveGate, 'load' | 'snapshot' | 'readCore' | 'writeCore' | 'batchCore'>;

export interface PiggyBankServiceOptions {
  gate: PiggyBankSaveGate;
  /** The payout target of a purchase (and the payer of a wallet price): the Core wallet over the same gate. */
  wallet: PiggyBankWallet;
  config: PiggyBankConfig;
  onListenerError?: (error: unknown, change: PiggyBankChange) => void;
}
