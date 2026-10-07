// MoveRuntime V1 — the moves of ONE attempt, in memory: started from a level balance, consumed by the gameplay's
// moves, extended by the host's extra moves (a continue, a rewarded ad, an offer — after it delivered them). It only
// COUNTS: it knows no gameplay, no balance source, no outcome and no window, writes no save (the host keeps its
// snapshot) and has no listener, timer or clock.
import { readLevelBalance } from './balance';
import type { LevelBalance } from './balance';

/** Any change of the snapshot's shape bumps it; another version is refused by `restore()`. */
const FORMAT = 1;

export type MoveRefusal =
  /** No attempt runs: start() / restore() first (or end() was called). */
  | 'no_attempt'
  /** consume(): no move is left — nothing changed. The attempt stays at 0 until the host decides. */
  | 'exhausted'
  /** add(): the attempt is unlimited — it has no count to extend. */
  | 'unlimited';

export interface MoveResult {
  ok: boolean;
  /** null when ok. A refusal changes nothing. */
  reason: MoveRefusal | null;
  /** consume: the moves really taken (fewer than asked only when the attempt ran out); add: the moves added; 0 for a refusal. */
  delta: number;
  /** Moves left after the call; null = unlimited (0 when no attempt runs). */
  remaining: number | null;
  /** No move is left (never for an unlimited attempt). Not an outcome — see `MoveRuntime`. */
  exhausted: boolean;
}

/** What the host stores to continue the attempt after a reload: JSON-safe, self-contained (its own balance). */
export interface MoveSnapshot {
  /** The snapshot format, 1. */
  v: number;
  /** The balance the attempt was started with — a restored attempt keeps its rules even if the source changed since. */
  balance: LevelBalance;
  /** Moves consumed so far. */
  used: number;
  /** Moves added so far (always 0 for an unlimited attempt). */
  added: number;
}

export interface MoveRestoreResult {
  ok: boolean;
  /** null when ok. `invalid_snapshot`: not a V1 snapshot of a valid balance with consistent counts — nothing changed. */
  reason: 'invalid_snapshot' | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function checkCount(method: string, count: unknown): number {
  if (!Number.isSafeInteger(count) || (count as number) < 1) throw new RangeError(`MoveRuntime.${method}(): count must be an integer ≥ 1`);
  return count as number;
}

function sum(method: string, a: number, b: number): number {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new RangeError(`MoveRuntime.${method}(): the move count would leave the safe integer range`);
  return total;
}

/**
 * One runtime per game session; one attempt at a time:
 *
 *   const moves = new MoveRuntime();
 *   moves.start(balances.get(progressionKey)!);  // a new attempt: moveLimit moves (or unlimited)
 *   moves.consume();                             // the gameplay made a move (consume(n) for a move worth n)
 *   moves.add(5);                                // the host delivered 5 extra moves (a continue, a rewarded ad …)
 *   save.moves = moves.snapshot();               // the host persists the attempt with its own save …
 *   moves.restore(save.moves);                   // … and continues it after a reload
 *   moves.end();                                 // the attempt is over (whatever its outcome)
 *
 * Counts: `remaining = limit − used`, where `limit` is the balance's moveLimit plus every add(). consume() never
 * goes below 0: it takes what is left (`delta` says how many) and, at 0, is refused (`exhausted`, nothing changes).
 * An unlimited attempt never runs out: `remaining` / `limit` are null, consume() always succeeds and still counts
 * `used`, add() is refused.
 *
 * Running out is a STATE, never an outcome: the consume() that takes the last move answers `exhausted: true` and
 * nothing else happens — no event, no FAIL. The last move may be the winning one, so the host lets the gameplay
 * settle, then checks the win: won → completion (stars: `starsForMovesLeft(remaining, balance, policy)`); not
 * won → its fail flow, or a continue offer whose delivery is `add(n)` (the attempt goes on). The runtime stays at 0
 * for as long as the host needs.
 *
 * Invalid input throws (a RangeError: a count that is not an integer ≥ 1, an invalid balance); a state refusal is
 * answered (`ok: false`). Without an attempt the counters read 0 / false and `snapshot()` is null.
 */
export class MoveRuntime {
  private current: LevelBalance | null = null;
  private usedCount = 0;
  private addedCount = 0;

  /** Starts a new attempt from `balance` (checked, copied), replacing the running one — a restart is just start(). Throws a RangeError for an invalid balance (nothing changes). */
  start(balance: LevelBalance): MoveSnapshot {
    this.current = readLevelBalance(balance, (message) => {
      throw new RangeError(`MoveRuntime.start(): balance ${message}`);
    });
    this.usedCount = 0;
    this.addedCount = 0;
    return this.snapshot() as MoveSnapshot;
  }

  /** The gameplay made a move worth `count` (default 1). Takes at most what is left; at 0 it is refused. */
  consume(count = 1): MoveResult {
    checkCount('consume', count);
    if (!this.current) return this.answer(false, 'no_attempt', 0);
    if (this.current.moveLimit === null) {
      this.usedCount = sum('consume', this.usedCount, count);
      return this.answer(true, null, count);
    }
    const left = this.remaining as number;
    if (left === 0) return this.answer(false, 'exhausted', 0);
    const delta = Math.min(count, left);
    this.usedCount += delta;
    return this.answer(true, null, delta);
  }

  /** Adds `count` moves to the running attempt — also after it ran out (it is no longer exhausted). Call it only after the host delivered them. */
  add(count: number): MoveResult {
    checkCount('add', count);
    if (!this.current) return this.answer(false, 'no_attempt', 0);
    if (this.current.moveLimit === null) return this.answer(false, 'unlimited', 0);
    sum('add', this.current.moveLimit, sum('add', this.addedCount, count));
    this.addedCount += count;
    return this.answer(true, null, count);
  }

  /** The attempt is over (the host decided its outcome, or the player left): no attempt runs. Repeat-safe. */
  end(): void {
    this.current = null;
    this.usedCount = 0;
    this.addedCount = 0;
  }

  /** The running attempt as the host stores it (a copy; its balance is frozen); null when no attempt runs. */
  snapshot(): MoveSnapshot | null {
    if (!this.current) return null;
    return { v: FORMAT, balance: this.current, used: this.usedCount, added: this.addedCount };
  }

  /**
   * Continues an attempt the host stored (`snapshot()`, JSON round trip allowed), replacing the running one. The
   * snapshot's own balance is used, not today's source. Answered, never thrown: an invalid snapshot changes nothing.
   */
  restore(snapshot: MoveSnapshot): MoveRestoreResult {
    if (!isObject(snapshot) || snapshot.v !== FORMAT || !isCount(snapshot.used) || !isCount(snapshot.added)) return { ok: false, reason: 'invalid_snapshot' };
    let balance: LevelBalance;
    try {
      balance = readLevelBalance(snapshot.balance, (message) => {
        throw new RangeError(message);
      });
    } catch {
      return { ok: false, reason: 'invalid_snapshot' };
    }
    const { used, added } = snapshot;
    if (balance.moveLimit === null ? added !== 0 : !Number.isSafeInteger(balance.moveLimit + added) || used > balance.moveLimit + added) {
      return { ok: false, reason: 'invalid_snapshot' };
    }
    this.current = balance;
    this.usedCount = used;
    this.addedCount = added;
    return { ok: true, reason: null };
  }

  /** An attempt runs. */
  get active(): boolean {
    return this.current !== null;
  }

  /** The running attempt's balance (frozen), or null. */
  get balance(): LevelBalance | null {
    return this.current;
  }

  /** The running attempt has no move limit. */
  get unlimited(): boolean {
    return this.current !== null && this.current.moveLimit === null;
  }

  /** The attempt's moves in total: the balance's moveLimit plus every add(); null = unlimited. */
  get limit(): number | null {
    if (!this.current) return 0;
    return this.current.moveLimit === null ? null : this.current.moveLimit + this.addedCount;
  }

  /** Moves consumed in the running attempt. */
  get used(): number {
    return this.usedCount;
  }

  /** Moves added to the running attempt. */
  get added(): number {
    return this.addedCount;
  }

  /** Moves left (≥ 0); null = unlimited. */
  get remaining(): number | null {
    const limit = this.limit;
    return limit === null ? null : limit - this.usedCount;
  }

  /** No move is left in the running attempt (never for an unlimited one). */
  get exhausted(): boolean {
    return this.current !== null && this.remaining === 0;
  }

  private answer(ok: boolean, reason: MoveRefusal | null, delta: number): MoveResult {
    return { ok, reason, delta, remaining: this.remaining, exhausted: this.exhausted };
  }
}
