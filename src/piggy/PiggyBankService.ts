// PiggyBankService V1 — the piggy bank of a game (GDD «Свинья копилка»): a share of every level's EARNED reward
// accumulates in the bank up to its capacity; from the purchase threshold the player can buy the bank and gets its
// coins into the wallet, the bank empties and moves to its next level. Its state is the SaveGate Core record
// `piggyBank`, never a game key. It only COUNTS and PAYS OUT: what a level earned comes from the host (the wallet's
// level reward), the moment of the lobby too, prices are the host's (a platform SKU from the catalog or a coins price
// in the config), the UI and its animations stay outside. No timer, no clock, no global, no platform SDK.
import type { SaveReadStatus, SaveWriteResult } from '../save/SaveGate';
import { piggyBankAccrual, piggyBankThreshold, validatePiggyBankConfig } from './config';
import type {
  PiggyBankApplyResult,
  PiggyBankBuyResult,
  PiggyBankChange,
  PiggyBankCollectResult,
  PiggyBankConfig,
  PiggyBankListener,
  PiggyBankPrice,
  PiggyBankProblem,
  PiggyBankPurchaseEntry,
  PiggyBankRefusal,
  PiggyBankSaveGate,
  PiggyBankServiceOptions,
  PiggyBankSnapshot,
  PiggyBankStageEntry,
  PiggyBankStageResult,
  PiggyBankState,
  PiggyBankStatus,
  PiggyBankWallet
} from './types';

/** The bank's record in the SaveGate Core namespace: `<profile.id>.core` → `{ piggyBank: { v, level, balance, staged, keys, tokens } }`. */
const RECORD = 'piggyBank';
/** Any change of the record's shape bumps it; another version is unknown data (unavailable, never overwritten). */
const FORMAT = 1;
/** Stage keys remembered for the duplicate check (a repeated level-result event, a reload). */
const MAX_KEYS = 100;
/** Purchase tokens remembered (a platform receipt restored again). */
const MAX_TOKENS = 50;
const MAX_ID = 200;
/** The `source` of the wallet changes a purchase makes (the analytics / quests word; a host may filter it). */
export const PIGGY_BANK_SOURCE = 'piggy_bank';

interface StagedAmount {
  key: string;
  amount: number;
}

interface PiggyRecord {
  v: number;
  /** Purchases made: the level index (the last configured level repeats past the end). */
  level: number;
  balance: number;
  /** Level results staged and not yet collected (the lobby moves them in). */
  staged: StagedAmount[];
  /** Recent stage keys (staged or collected): the same level result never counts twice. */
  keys: string[];
  /** Recent applied platform purchase tokens: the same receipt never pays twice. */
  tokens: string[];
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= MAX_ID;

function readRecord(value: unknown): PiggyRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Partial<PiggyRecord>;
  if (r.v !== FORMAT || !isCount(r.level) || !isCount(r.balance)) return null;
  if (!Array.isArray(r.staged) || !r.staged.every((s) => typeof s === 'object' && s !== null && isId(s.key) && isCount(s.amount))) return null;
  if (!Array.isArray(r.keys) || !r.keys.every(isId) || !Array.isArray(r.tokens) || !r.tokens.every(isId)) return null;
  return { v: FORMAT, level: r.level, balance: r.balance, staged: r.staged.map((s) => ({ key: s.key, amount: s.amount })), keys: [...r.keys], tokens: [...r.tokens] };
}

const freshRecord = (): PiggyRecord => ({ v: FORMAT, level: 0, balance: 0, staged: [], keys: [], tokens: [] });
const copyRecord = (r: PiggyRecord): PiggyRecord => ({ ...r, staged: r.staged.map((s) => ({ ...s })), keys: [...r.keys], tokens: [...r.tokens] });
const remember = (list: string[], id: string, max: number): void => {
  list.push(id);
  if (list.length > max) list.splice(0, list.length - max);
};

/**
 * One bank per game session, over the game's SaveGate and the Core wallet on it:
 *
 *   const piggy = new PiggyBankService({ gate, wallet, config: { ...piggyBankGddExample(), …the game's numbers } });
 *   await Promise.all([wallet.load(), piggy.load()]);          // with gate.load(); never rejects
 *   gate.open();
 *   const reward = wallet.applyLevelResult(result);            // the level's EARNED coins
 *   piggy.stage({ key: attemptId, earned: reward.amount });    // its share is staged (stored), not in the bank yet
 *   piggy.collect();                                           // back in the lobby: staged coins move in (capped)
 *   piggy.snapshot();                                          // level, balance, capacity, threshold, progress, state, canBuy
 *   piggy.buyFromWallet();                                     // a level priced in the wallet's currency
 *   new PurchaseRuntime({ …, ledger: createPiggyBankLedger(piggy) }); // a level sold as a platform product
 *
 * Every change is synchronous in memory, then ONE `gate.writeCore('piggyBank', record)` of the whole record; a failed
 * write keeps the memory and is carried by the next one (or `save()`). Exactly-once:
 *   - a level result counts once per `key` (staged and collected keys are stored), across repeated events and reloads;
 *     staged coins are stored, so a reload between the result and the lobby loses nothing;
 *   - a purchase pays the bank's coins into the wallet and empties / levels the bank in ONE `gate.batchCore()` — the
 *     payout and the empty bank are stored together or not at all: a failed or lost write leaves the bank full and the
 *     wallet unpaid after a restart (buy again), never both paid and full;
 *   - a platform purchase (`applyPurchase`, the PurchaseRuntime ledger) is idempotent by its token, stored with the
 *     payout, and answers `applied` only after that write CONFIRMED (`not_durable` keeps the receipt for a restore).
 * Holds for a wallet that writes through the same SaveGate (the Core `SoftCurrencyWallet`).
 */
export class PiggyBankService {
  private readonly gate: PiggyBankSaveGate;
  private readonly wallet: PiggyBankWallet;
  private readonly config: PiggyBankConfig;
  private readonly onListenerError: (error: unknown, change: PiggyBankChange) => void;
  private readonly listeners = new Set<PiggyBankListener>();
  private status: PiggyBankStatus = 'idle';
  private problem: PiggyBankProblem | null = null;
  private record: PiggyRecord | null = null;
  /** Tokens applied in memory whose write has not confirmed yet: the next apply of the token writes again. */
  private readonly unconfirmed = new Set<string>();
  private loading: Promise<PiggyBankSnapshot> | null = null;
  private disposed = false;

  constructor(options: PiggyBankServiceOptions) {
    const { gate, wallet, config, onListenerError } = options ?? ({} as PiggyBankServiceOptions);
    if (!gate || typeof gate.load !== 'function' || typeof gate.readCore !== 'function' || typeof gate.writeCore !== 'function' || typeof gate.snapshot !== 'function' || typeof gate.batchCore !== 'function') {
      throw new TypeError('PiggyBankService: the game SaveGate is required');
    }
    if (!wallet || typeof wallet.grant !== 'function' || typeof wallet.trySpend !== 'function' || typeof wallet.snapshot !== 'function') {
      throw new TypeError('PiggyBankService: a wallet { grant, trySpend, snapshot } is required (the Core SoftCurrencyWallet on the same gate)');
    }
    const issues = validatePiggyBankConfig(config);
    if (issues.length > 0) throw new RangeError(`PiggyBankService: config — ${issues.join('; ')}`);
    this.gate = gate;
    this.wallet = wallet;
    this.config = JSON.parse(JSON.stringify(config)) as PiggyBankConfig;
    this.onListenerError = onListenerError ?? ((error) => console.error('PiggyBankService: a change listener threw', error));
  }

  /** Reads the Core record once, with `gate.load()` (the same promise the host awaits). Never rejects. */
  load(): Promise<PiggyBankSnapshot> {
    if (!this.loading) {
      this.status = 'loading';
      this.loading = Promise.resolve()
        .then(() => this.gate.load())
        .then(
          (loaded) => this.restore(loaded?.core),
          () => this.restore('failed')
        );
    }
    return this.loading;
  }

  snapshot(): PiggyBankSnapshot {
    const record = this.status === 'ready' ? this.record : null;
    if (!record) {
      return {
        status: this.status, problem: this.problem, writable: false, level: null, balance: null, capacity: null, threshold: null,
        progress: null, state: null, canBuy: false, price: null, staged: 0
      };
    }
    const { capacity, price } = this.levelOf(record);
    const threshold = piggyBankThreshold(capacity, this.config.purchaseThresholdPercent);
    const balance = record.balance;
    const state: PiggyBankState = balance <= 0 ? 'empty' : balance >= capacity ? 'full' : balance >= threshold ? 'purchasable' : 'partial';
    return {
      status: this.status,
      problem: null,
      writable: this.refusal() === null,
      level: record.level + 1,
      balance,
      capacity,
      threshold,
      progress: Math.min(1, balance / capacity),
      state,
      canBuy: balance > 0 && balance >= threshold,
      price: price ? { ...price } : null,
      staged: record.staged.reduce((sum, s) => sum + s.amount, 0)
    };
  }

  /**
   * A level result's share for the bank, STAGED (stored in the record, not in the bank yet): `earned` = the coins the
   * level actually paid (the wallet's level reward; a replay that paid 0 stages 0), its share is
   * floor(earned × accrualPercent / 100); `amount` = an exact amount the host decided on. The same `key` twice — in this
   * session or after a reload — changes nothing (`duplicate`). Staged coins move in at `collect()` (the lobby).
   */
  stage(entry: PiggyBankStageEntry): PiggyBankStageResult {
    const refuse = (reason: PiggyBankRefusal): PiggyBankStageResult => ({ ok: false, reason, staged: 0, duplicate: false, saved: null });
    if (typeof entry !== 'object' || entry === null || !isId(entry.key)) return refuse('invalid_entry');
    const hasEarned = 'earned' in entry && entry.earned !== undefined;
    const hasAmount = 'amount' in entry && entry.amount !== undefined;
    if (hasEarned === hasAmount) return refuse('invalid_entry');
    const value = hasEarned ? (entry as { earned: number }).earned : (entry as { amount: number }).amount;
    if (!isCount(value)) return refuse('invalid_entry');
    const refusal = this.refusal();
    if (refusal) return refuse(refusal);
    const record = this.record as PiggyRecord;
    if (record.keys.includes(entry.key)) return { ok: true, reason: null, staged: 0, duplicate: true, saved: null };
    const amount = hasEarned ? piggyBankAccrual(value, this.config.accrualPercent) : value;
    if (amount === 0) return { ok: true, reason: null, staged: 0, duplicate: false, saved: null };
    record.staged.push({ key: entry.key, amount });
    remember(record.keys, entry.key, MAX_KEYS);
    const saved = this.write();
    this.emit({ kind: 'staged', key: entry.key, amount });
    return { ok: true, reason: null, staged: amount, duplicate: false, saved };
  }

  /**
   * The lobby: every staged amount moves into the bank, up to its capacity — what does not fit is dropped (GDD: a full
   * bank stops accruing). One write; nothing staged → nothing written.
   */
  collect(): PiggyBankCollectResult {
    const refusal = this.refusal();
    if (refusal) return { ok: false, reason: refusal, added: 0, dropped: 0, balance: this.record?.balance ?? null, full: false, saved: null };
    const record = this.record as PiggyRecord;
    const { capacity } = this.levelOf(record);
    if (record.staged.length === 0) return { ok: true, reason: null, added: 0, dropped: 0, balance: record.balance, full: record.balance >= capacity, saved: null };
    const total = record.staged.reduce((sum, s) => sum + s.amount, 0);
    const added = Math.min(total, Math.max(0, capacity - record.balance));
    const dropped = total - added;
    record.balance += added;
    record.staged = [];
    const saved = this.write();
    const full = record.balance >= capacity;
    this.emit({ kind: 'collected', added, dropped, balance: record.balance, full });
    return { ok: true, reason: null, added, dropped, balance: record.balance, full, saved };
  }

  /**
   * Buys the bank of a level priced in the wallet's currency: from the threshold, the price is spent and the bank's
   * balance is paid into the wallet, the bank empties and moves to its next level — ONE Core write of the wallet and the
   * bank together.
   */
  buyFromWallet(): PiggyBankBuyResult {
    const refuse = (reason: PiggyBankRefusal): PiggyBankBuyResult => ({ ok: false, reason, received: 0, level: this.snapshot().level, saved: null });
    const refusal = this.refusal();
    if (refusal) return refuse(refusal);
    const record = this.record as PiggyRecord;
    const { price } = this.levelOf(record);
    if (!price || price.kind !== 'wallet') return refuse('not_for_wallet');
    if (!this.snapshot().canBuy) return refuse('below_threshold');
    const wallet = this.wallet.snapshot();
    if (wallet.writable !== true || wallet.balance === null) return refuse('payout_refused');
    if (wallet.balance < price.amount) return refuse('insufficient_funds');
    if (!Number.isSafeInteger(wallet.balance - price.amount + record.balance)) return refuse('payout_refused');
    const received = record.balance;
    let paid = false;
    const saved = this.gate.batchCore(() => {
      const spend = this.wallet.trySpend(price.amount, { source: PIGGY_BANK_SOURCE, item: 'price' });
      if (!spend.ok) return;
      const payout = this.wallet.grant(received, { source: PIGGY_BANK_SOURCE });
      if (!payout.ok) {
        this.wallet.grant(price.amount, { source: PIGGY_BANK_SOURCE, item: 'refund' }); // never a price without the payout
        return;
      }
      this.empty(record);
      paid = true;
    });
    if (!paid) return refuse('payout_refused');
    this.emit({ kind: 'purchased', level: record.level + 1, received, via: 'wallet', token: null });
    return { ok: true, reason: null, received, level: record.level + 1, saved };
  }

  /**
   * A PAID platform purchase of the bank (the PurchaseRuntime ledger: `createPiggyBankLedger`). The bank's balance (all
   * of it — the threshold gates the offer, not a paid receipt) goes to the wallet, the bank empties and levels up, the
   * token is stored with them in ONE write; `applied` only after that write confirmed. The same token again →
   * `already_applied` (a token whose write did not confirm is written again and answered by that write). A bank that
   * cannot take it now (not loaded, read-only, the wallet refused) → `not_durable`: the receipt stays for a restore.
   */
  async applyPurchase(entry: PiggyBankPurchaseEntry): Promise<PiggyBankApplyResult> {
    if (typeof entry !== 'object' || entry === null || !isId(entry.token) || !isId(entry.productId)) return 'not_durable';
    if (this.refusal()) return 'not_durable';
    const record = this.record as PiggyRecord;
    if (record.tokens.includes(entry.token)) {
      if (!this.unconfirmed.has(entry.token)) return 'already_applied';
      const again = await this.write();
      if (!again.ok) return 'not_durable';
      this.unconfirmed.delete(entry.token);
      return 'applied';
    }
    const received = record.balance;
    const wallet = this.wallet.snapshot();
    if (wallet.writable !== true || wallet.balance === null || !Number.isSafeInteger(wallet.balance + received)) return 'not_durable';
    let paid = false;
    const saved = this.gate.batchCore(() => {
      if (!this.wallet.grant(received, { source: PIGGY_BANK_SOURCE, item: entry.productId }).ok) return;
      this.empty(record, entry.token);
      paid = true;
    });
    if (!paid) return 'not_durable';
    this.unconfirmed.add(entry.token);
    this.emit({ kind: 'purchased', level: record.level + 1, received, via: 'product', token: entry.token });
    const result: SaveWriteResult = await saved;
    if (!result.ok) return 'not_durable';
    this.unconfirmed.delete(entry.token);
    return 'applied';
  }

  /** The platform SKUs of the configured levels (`price.kind === 'product'`): the products a ledger routes to the bank. */
  productIds(): string[] {
    const ids = this.config.levels.flatMap((level) => (level.price?.kind === 'product' ? [level.price.productId] : []));
    return [...new Set(ids)];
  }

  /** Writes the current record (a retry after a failed write). */
  save(): { ok: boolean; reason: PiggyBankRefusal | null; saved: Promise<SaveWriteResult> | null } {
    const refusal = this.refusal();
    if (refusal) return { ok: false, reason: refusal, saved: null };
    return { ok: true, reason: null, saved: this.write() };
  }

  /** Called after every change (staged, collected, purchased). Returns the unsubscribe. */
  onChange(listener: PiggyBankListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('PiggyBankService.onChange(): a listener function is required');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drops every listener; changes are refused (`disposed`) from now on. The stored record stays. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private restore(core: SaveReadStatus | undefined): PiggyBankSnapshot {
    const read = core === 'loaded' || core === 'missing';
    const value = read ? this.gate.readCore(RECORD) : undefined;
    if (read && (value === undefined || value === null)) {
      this.record = freshRecord(); // a new player: an empty level-1 bank, written with the first change
      this.status = 'ready';
    } else if (read && readRecord(value)) {
      this.record = readRecord(value);
      this.status = 'ready';
    } else {
      // failed (or never settled), or not a V1 record: unknown — no fresh bank over it, no write
      this.problem = read ? 'invalid_record' : 'read_failed';
      this.status = 'unavailable';
    }
    return this.snapshot();
  }

  /** The configured level of the record (the last one repeats). */
  private levelOf(record: PiggyRecord): { capacity: number; price: PiggyBankPrice | null } {
    const levels = this.config.levels;
    return levels[Math.min(record.level, levels.length - 1)] as { capacity: number; price: PiggyBankPrice | null };
  }

  /** The purchase's effect on the bank (inside the payout's batch): empty, next level, the token remembered. */
  private empty(record: PiggyRecord, token?: string): void {
    record.balance = 0;
    record.level += 1;
    if (token !== undefined) remember(record.tokens, token, MAX_TOKENS);
    void this.write();
  }

  private refusal(): PiggyBankRefusal | null {
    if (this.disposed) return 'disposed';
    if (this.status === 'idle' || this.status === 'loading') return 'not_loaded';
    if (this.status === 'unavailable' || !this.record) return 'unavailable';
    if (this.gate.snapshot().phase !== 'open') return 'not_open';
    return null;
  }

  private write(): Promise<SaveWriteResult> {
    return this.gate.writeCore(RECORD, copyRecord(this.record as PiggyRecord));
  }

  private emit(change: PiggyBankChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        this.onListenerError(error, change);
      }
    }
  }
}
