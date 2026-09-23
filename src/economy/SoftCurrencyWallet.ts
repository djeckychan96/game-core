// SoftCurrencyWallet V1 — the one soft currency of a game whose profile says `economy.softCurrency.owner
// = 'core'` (a gameplay without its own coins: Gorodki). The balance and the paid first completions live in
// the SaveGate Core record `wallet`, never in a game key. It only COUNTS: prices, shops, purchase / offer
// orchestration, the reward numbers (the profile's policies) and the UI stay outside. A gameplay-owned
// currency keeps its own balance — no wallet for it. No timer, no clock, no global.
import type { GameplayLevelResult } from '../production/contract';
import type { GameProductionProfile, LevelRewardPolicy } from '../production/profile';
import type { SaveGate, SaveReadStatus, SaveWriteResult } from '../save/SaveGate';

/** The wallet's record in the SaveGate Core namespace: `<profile.id>.core` → `{ wallet: { v, balance, rewardedLevels } }`. */
const RECORD = 'wallet';
/** Any change of the record's shape bumps it; V1 treats another version as unknown data (unavailable, never overwritten). */
const FORMAT = 1;

/**
 * idle → load() → loading → ready (the balance is known: the stored one, or `startBalance` when the read
 * succeeded and nothing is stored) or unavailable (the Core read failed, or the stored record is not a V1
 * wallet: the balance is UNKNOWN and the wallet is read-only for the gate's lifetime — never a default over it).
 */
export type SoftCurrencyWalletStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Why a wallet is unavailable. */
export type SoftCurrencyWalletProblem = 'read_failed' | 'invalid_record';

export type SoftCurrencyRefusal =
  /** load() has not settled. */
  | 'not_loaded'
  /** The balance is unknown (a failed Core read, an invalid record): read-only. */
  | 'unavailable'
  /** The SaveGate is not open yet — a change could not be saved. */
  | 'not_open'
  /** Not an integer ≥ 0, or the balance would leave the safe-integer range. */
  | 'invalid_amount'
  | 'insufficient_funds'
  /** The profile's reward policy threw or answered something other than an integer ≥ 0. */
  | 'invalid_reward';

/** Where a change came from, handed on to the change event as is (the analytics economy `source` / `item` words). */
export interface SoftCurrencyChangeContext {
  /** `purchase`, `offer`, `shop` … — a host string. */
  source?: string;
  /** What was bought or granted (a product id, a booster …). */
  item?: string;
}

export interface SoftCurrencyResult {
  ok: boolean;
  /** null when ok. A refusal changes nothing and writes nothing. */
  reason: SoftCurrencyRefusal | null;
  /** The balance after the call; null while it is unknown (not loaded, unavailable). */
  balance: number | null;
  /** The SaveGate write of the whole record (never rejects); null when nothing was written. */
  saved: Promise<SaveWriteResult> | null;
  /** `invalid_reward` only: what the policy threw, or a RangeError naming its answer. */
  error?: unknown;
}

/** first: the first completion of a level (paid once per level); replay: any other win; fail: a lost run (never paid). */
export type LevelRewardKind = 'first' | 'replay' | 'fail';

export interface LevelRewardResult extends SoftCurrencyResult {
  /** null when the wallet refused before it could tell (not loaded / unavailable / not open). */
  kind: LevelRewardKind | null;
  /** Coins this level end added — what the result window shows; 0 when none. */
  amount: number;
}

export type SoftCurrencyChangeKind = 'grant' | 'spend' | 'level_reward';

/** One balance change (never sent for a refusal, a 0 amount, a fail or the load). */
export interface SoftCurrencyChange {
  currency: string;
  kind: SoftCurrencyChangeKind;
  /** Signed: > 0 for grant / level_reward, < 0 for spend. */
  delta: number;
  /** After the change. */
  balance: number;
  /** grant / trySpend: the caller's context. */
  context?: SoftCurrencyChangeContext;
}

export type SoftCurrencyListener = (change: SoftCurrencyChange) => void;

export interface SoftCurrencyWalletSnapshot {
  currency: string;
  status: SoftCurrencyWalletStatus;
  /** null while unknown — the wallet never reports 0 or `startBalance` for a balance it could not read. */
  balance: number | null;
  /** ready AND the SaveGate is open: grant / trySpend / applyLevelResult / save are accepted. */
  writable: boolean;
  /** The reason of `unavailable`, else null. */
  problem: SoftCurrencyWalletProblem | null;
  /** The level identities whose first completion is paid (`levelId`, else the level number). */
  rewardedLevels: string[];
}

/** The SaveGate methods the wallet uses — pass the game's SaveGate. */
export type SoftCurrencySaveGate = Pick<SaveGate, 'load' | 'snapshot' | 'readCore' | 'writeCore'>;

export interface SoftCurrencyWalletOptions {
  /** The game's SaveGate: the wallet reads and writes only its own Core record. */
  gate: SoftCurrencySaveGate;
  /** `economy.softCurrency` must be a core-owned currency. */
  profile: Pick<GameProductionProfile, 'economy'>;
  /** Where a throwing change listener lands; defaults to console.error. The change itself stands. */
  onListenerError?: (error: unknown, change: SoftCurrencyChange) => void;
}

interface WalletRecord {
  v: number;
  balance: number;
  rewardedLevels: string[];
}

const isAmount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const isWalletRecord = (value: unknown): value is WalletRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === FORMAT &&
    isAmount(record.balance) &&
    Array.isArray(record.rewardedLevels) &&
    record.rewardedLevels.every((key) => typeof key === 'string' && key !== '')
  );
};

/** The level's identity in the paid first completions: `levelId` when the gameplay gives one, else the level number. */
function levelKey(result: GameplayLevelResult): string {
  const fail = (message: string): never => {
    throw new TypeError(`SoftCurrencyWallet.applyLevelResult(): ${message}`);
  };
  if (typeof result !== 'object' || result === null) fail('a GameplayLevelResult is required');
  if (typeof result.win !== 'boolean' || typeof result.firstCompletion !== 'boolean') fail('win and firstCompletion must be booleans');
  if (result.levelId !== undefined) {
    if (typeof result.levelId !== 'string' || result.levelId === '') fail('levelId must be a non-empty string when given');
    return result.levelId as string;
  }
  if (!Number.isSafeInteger(result.level) || result.level < 1) fail('level must be an integer ≥ 1 (or give a levelId)');
  return String(result.level);
}

/**
 * One wallet per game session, over the game's SaveGate:
 *
 *   const wallet = new SoftCurrencyWallet({ gate, profile });
 *   await wallet.load();                        // with gate.load(); never rejects
 *   gate.open();                                // the host applied the game's values — changes are accepted from here
 *   wallet.onChange((c) => hud.setCoins(c.balance));
 *   const reward = wallet.applyLevelResult(result);          // levelEnd → reward.amount for the result window
 *   wallet.grant(pack.amount, { source: 'purchase', item: productId });
 *   if (wallet.trySpend(price, { source: 'shop' }).ok) giveItem();
 *
 * Changes are synchronous in memory, then ONE `gate.writeCore('wallet', record)` of the whole record; a
 * failed write keeps the in-memory balance and is carried by the next write (or `save()`).
 */
export class SoftCurrencyWallet {
  /** The profile's currency id (`coins`) — match `OfferReward.id` against it. */
  readonly currency: string;
  private readonly gate: SoftCurrencySaveGate;
  private readonly startBalance: number;
  private readonly firstReward: LevelRewardPolicy | undefined;
  private readonly replayReward: LevelRewardPolicy | undefined;
  private readonly onListenerError: (error: unknown, change: SoftCurrencyChange) => void;
  private readonly listeners = new Set<SoftCurrencyListener>();
  private readonly rewarded = new Set<string>();
  private status: SoftCurrencyWalletStatus = 'idle';
  private problem: SoftCurrencyWalletProblem | null = null;
  private value: number | null = null;
  private loading: Promise<SoftCurrencyWalletSnapshot> | null = null;

  constructor(options: SoftCurrencyWalletOptions) {
    const { gate, profile, onListenerError } = options ?? ({} as SoftCurrencyWalletOptions);
    if (!gate || typeof gate.load !== 'function' || typeof gate.readCore !== 'function' || typeof gate.writeCore !== 'function' || typeof gate.snapshot !== 'function') {
      throw new TypeError('SoftCurrencyWallet: the game SaveGate is required');
    }
    const soft = profile?.economy?.softCurrency;
    if (!soft || typeof soft !== 'object') throw new RangeError('SoftCurrencyWallet: economy.softCurrency is false — the game has no soft currency');
    if (soft.owner !== 'core') {
      throw new RangeError(`SoftCurrencyWallet: economy.softCurrency.owner is "${String(soft.owner)}" — a wallet keeps a core-owned currency only; a gameplay-owned one keeps its own balance`);
    }
    if (typeof soft.id !== 'string' || soft.id === '') throw new RangeError('SoftCurrencyWallet: economy.softCurrency.id is required');
    if (!isAmount(soft.startBalance)) throw new RangeError('SoftCurrencyWallet: economy.softCurrency.startBalance must be an integer ≥ 0');
    for (const field of ['levelReward', 'replayReward'] as const) {
      if (soft[field] !== undefined && typeof soft[field] !== 'function') throw new RangeError(`SoftCurrencyWallet: economy.softCurrency.${field} must be a function`);
    }
    this.gate = gate;
    this.currency = soft.id;
    this.startBalance = soft.startBalance;
    this.firstReward = soft.levelReward;
    this.replayReward = soft.replayReward;
    this.onListenerError = onListenerError ?? ((error) => console.error('SoftCurrencyWallet: a change listener threw', error));
  }

  /** The balance; null while unknown (not loaded, unavailable) — the host decides what the HUD shows then. */
  get balance(): number | null {
    return this.value;
  }

  /** Reads the Core record once, with `gate.load()` (the same promise the host awaits). Never rejects. */
  load(): Promise<SoftCurrencyWalletSnapshot> {
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

  /** Adds `amount` (an integer ≥ 0; 0 changes nothing) — the one path for coin packs, offer rewards and host bonuses. Never throws. */
  grant(amount: number, context?: SoftCurrencyChangeContext): SoftCurrencyResult {
    if (!isAmount(amount)) return this.refuse('invalid_amount');
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    if (!Number.isSafeInteger((this.value as number) + amount)) return this.refuse('invalid_amount');
    return amount === 0 ? this.unchanged() : this.change('grant', amount, context);
  }

  /** Takes `amount` when the balance covers it, else `insufficient_funds` and nothing changes. Never throws. */
  trySpend(amount: number, context?: SoftCurrencyChangeContext): SoftCurrencyResult {
    if (!isAmount(amount)) return this.refuse('invalid_amount');
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    if (amount > (this.value as number)) return this.refuse('insufficient_funds');
    return amount === 0 ? this.unchanged() : this.change('spend', -amount, context);
  }

  /**
   * The level reward of one levelEnd (Contract V1). A fail pays nothing. A win is `first` when the gameplay
   * says `firstCompletion` AND this level's first completion is not paid yet → `levelReward(result)`, and the
   * level is recorded as paid (persisted, so neither a repeated levelEnd nor a later session pays it again);
   * any other win is a `replay` → `replayReward(result)`, or 0 when the profile has none. Core never reads the
   * result beyond win / firstCompletion / the level identity. Throws a TypeError only for a result that is not
   * Contract V1; everything else is answered.
   */
  applyLevelResult(result: GameplayLevelResult): LevelRewardResult {
    const key = levelKey(result);
    if (!result.win) return { ...this.unchanged(), kind: 'fail', amount: 0 };
    const refusal = this.refusal();
    if (refusal) return { ...this.refuse(refusal), kind: null, amount: 0 };
    const kind: LevelRewardKind = result.firstCompletion && !this.rewarded.has(key) ? 'first' : 'replay';
    const policy = kind === 'first' ? this.firstReward : this.replayReward;
    let amount: unknown = 0;
    if (policy) {
      try {
        amount = policy(result);
      } catch (error) {
        return { ...this.refuse('invalid_reward'), error, kind, amount: 0 };
      }
    }
    if (!isAmount(amount) || !Number.isSafeInteger((this.value as number) + amount)) {
      const error = new RangeError(`SoftCurrencyWallet: the ${kind === 'first' ? 'levelReward' : 'replayReward'} policy answered ${String(amount)} — an integer ≥ 0 is required`);
      return { ...this.refuse('invalid_reward'), error, kind, amount: 0 };
    }
    if (kind === 'first') this.rewarded.add(key);
    else if (amount === 0) return { ...this.unchanged(), kind, amount: 0 };
    return { ...this.change('level_reward', amount), kind, amount };
  }

  /** Writes the current record (a new player's startBalance once the gate is open, or a retry after a failed write). */
  save(): SoftCurrencyResult {
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    return { ok: true, reason: null, balance: this.value, saved: this.write() };
  }

  /** Called after every balance change, in subscription order; a listener is registered once. Returns the unsubscribe. */
  onChange(listener: SoftCurrencyListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('SoftCurrencyWallet.onChange(): a listener function is required');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): SoftCurrencyWalletSnapshot {
    return {
      currency: this.currency,
      status: this.status,
      balance: this.value,
      writable: this.refusal() === null,
      problem: this.problem,
      rewardedLevels: [...this.rewarded]
    };
  }

  private restore(core: SaveReadStatus | undefined): SoftCurrencyWalletSnapshot {
    const record = core === 'loaded' ? this.gate.readCore(RECORD) : undefined;
    if (core === 'missing' || (core === 'loaded' && (record === undefined || record === null))) {
      // the read succeeded and no wallet was ever saved: a new player starts at startBalance
      this.value = this.startBalance;
      this.status = 'ready';
    } else if (core === 'loaded' && isWalletRecord(record)) {
      this.value = record.balance;
      for (const key of record.rewardedLevels) this.rewarded.add(key);
      this.status = 'ready';
    } else {
      // failed (or never settled): the stored balance is unknown — no default, no write
      this.problem = core === 'loaded' ? 'invalid_record' : 'read_failed';
      this.status = 'unavailable';
    }
    return this.snapshot();
  }

  private refusal(): SoftCurrencyRefusal | null {
    if (this.status === 'unavailable') return 'unavailable';
    if (this.status !== 'ready') return 'not_loaded';
    return this.gate.snapshot().phase === 'open' ? null : 'not_open';
  }

  private refuse(reason: SoftCurrencyRefusal): SoftCurrencyResult {
    return { ok: false, reason, balance: this.value, saved: null };
  }

  private unchanged(): SoftCurrencyResult {
    return { ok: true, reason: null, balance: this.value, saved: null };
  }

  private change(kind: SoftCurrencyChangeKind, delta: number, context?: SoftCurrencyChangeContext): SoftCurrencyResult {
    const balance = (this.value as number) + delta;
    this.value = balance;
    const saved = this.write();
    if (delta !== 0) {
      const change: SoftCurrencyChange = { currency: this.currency, kind, delta, balance, ...(context ? { context: { ...context } } : {}) };
      for (const listener of [...this.listeners]) {
        try {
          listener(change);
        } catch (error) {
          this.onListenerError(error, change);
        }
      }
    }
    return { ok: true, reason: null, balance, saved };
  }

  private write(): Promise<SaveWriteResult> {
    const record: WalletRecord = { v: FORMAT, balance: this.value as number, rewardedLevels: [...this.rewarded] };
    return this.gate.writeCore(RECORD, record);
  }
}
