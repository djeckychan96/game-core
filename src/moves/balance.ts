// Level balance V1 — the move budget of one level and its star thresholds, as game DATA. Today the host passes it
// from a local table, later the same records come from a server (see source.ts); nothing here knows where they came
// from, which game they belong to or how a level is played. `starsForMovesLeft` is the 3 / 2 / 1 rule over it.

interface LevelBalanceBase {
  /** The level's identity on the game's progression — the key a `LevelBalanceSource` is asked with. A non-empty string. */
  progressionKey: string;
  /** Reference only: the game's own id of the level content this balance was made for. Core never reads it. */
  sourceLevelId?: string | number;
}

/** A level with a move limit: the attempt has `moveLimit` moves; the thresholds are moves LEFT at the win. */
export interface LimitedLevelBalance extends LevelBalanceBase {
  /** Moves of one attempt, an integer ≥ 1. */
  moveLimit: number;
  /** A win with at least this many moves left earns 3 stars. 0 ≤ star2MinMovesLeft ≤ this ≤ moveLimit. */
  star3MinMovesLeft: number;
  /** A win with at least this many moves left earns 2 stars (else 1). */
  star2MinMovesLeft: number;
}

/**
 * A level without a move limit: an attempt never runs out. Thresholds may be absent; when present they are checked
 * (integers ≥ 0, star2 ≤ star3) and carried, but `starsForMovesLeft` does not use them — moves left are not counted.
 */
export interface UnlimitedLevelBalance extends LevelBalanceBase {
  moveLimit: null;
  star3MinMovesLeft?: number;
  star2MinMovesLeft?: number;
}

export type LevelBalance = LimitedLevelBalance | UnlimitedLevelBalance;

/** Stars of a won attempt. */
export type LevelStars = 1 | 2 | 3;

/**
 * The product's answers that the balance cannot give. An unlimited level counts no moves left, so its stars are a
 * product decision passed in explicitly — Core has no default for it.
 */
export interface StarPolicy {
  /** The stars of every won attempt of an unlimited level. */
  unlimitedStars: LevelStars;
}

const STARS: readonly LevelStars[] = [1, 2, 3];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Checks one balance record and answers a frozen copy of its known fields (unknown fields are ignored and dropped: a
 * newer data producer may add some). `reject` throws with the record's path.
 */
export function readLevelBalance(value: unknown, reject: (message: string) => never): LevelBalance {
  if (!isObject(value)) reject('must be an object');
  const record = value as Record<string, unknown>;
  const { progressionKey, sourceLevelId, moveLimit, star3MinMovesLeft: star3, star2MinMovesLeft: star2 } = record;
  if (typeof progressionKey !== 'string' || progressionKey === '') reject('progressionKey must be a non-empty string');
  if (sourceLevelId !== undefined && !((typeof sourceLevelId === 'string' && sourceLevelId !== '') || Number.isSafeInteger(sourceLevelId))) {
    reject('sourceLevelId must be a non-empty string or an integer when given');
  }
  const reference = sourceLevelId === undefined ? {} : { sourceLevelId: sourceLevelId as string | number };
  if (moveLimit === null) {
    for (const [name, threshold] of [['star3MinMovesLeft', star3], ['star2MinMovesLeft', star2]] as const) {
      if (threshold !== undefined && !isCount(threshold)) reject(`${name} must be an integer ≥ 0 when given (moveLimit null = unlimited)`);
    }
    if (star3 !== undefined && star2 !== undefined && (star2 as number) > (star3 as number)) reject('star2MinMovesLeft must be ≤ star3MinMovesLeft');
    return Object.freeze({
      progressionKey: progressionKey as string,
      ...reference,
      moveLimit: null,
      ...(star3 === undefined ? {} : { star3MinMovesLeft: star3 as number }),
      ...(star2 === undefined ? {} : { star2MinMovesLeft: star2 as number })
    });
  }
  if (!Number.isSafeInteger(moveLimit) || (moveLimit as number) < 1) reject('moveLimit must be an integer ≥ 1, or null for an unlimited level');
  if (!isCount(star3)) reject('star3MinMovesLeft must be an integer ≥ 0 for a level with a move limit');
  if (!isCount(star2)) reject('star2MinMovesLeft must be an integer ≥ 0 for a level with a move limit');
  if ((star2 as number) > (star3 as number)) reject('star2MinMovesLeft must be ≤ star3MinMovesLeft');
  if ((star3 as number) > (moveLimit as number)) reject('star3MinMovesLeft must be ≤ moveLimit');
  return Object.freeze({
    progressionKey: progressionKey as string,
    ...reference,
    moveLimit: moveLimit as number,
    star3MinMovesLeft: star3 as number,
    star2MinMovesLeft: star2 as number
  });
}

/**
 * Throws a RangeError naming the first problem: `progressionKey` a non-empty string; `moveLimit` an integer ≥ 1 or
 * null (unlimited); with a limit, 0 ≤ star2MinMovesLeft ≤ star3MinMovesLeft ≤ moveLimit (integers); unlimited, the
 * thresholds may be absent. Unknown fields are ignored.
 */
export function validateLevelBalance(balance: LevelBalance): void {
  readLevelBalance(balance, (message) => {
    throw new RangeError(`validateLevelBalance: ${message}`);
  });
}

/**
 * The stars of a WON attempt from the moves left at the win: ≥ star3MinMovesLeft → 3, ≥ star2MinMovesLeft → 2,
 * else 1. Moves added during the attempt count like any other move left. It knows no outcome — never call it for a
 * lost attempt (a loss has no stars here).
 *
 * An unlimited level counts no moves left: its stars are `policy.unlimitedStars`, and without a policy it throws —
 * the types already refuse a `LevelBalance` that may be unlimited unless a policy is passed. A given policy is
 * checked for every level. Throws a RangeError for an invalid balance, policy or `movesLeft` (an integer ≥ 0; it
 * may be null — `MoveRuntime.remaining` — only for an unlimited level).
 */
export function starsForMovesLeft(movesLeft: number, balance: LimitedLevelBalance, policy?: StarPolicy): LevelStars;
export function starsForMovesLeft(movesLeft: number | null, balance: LevelBalance, policy: StarPolicy): LevelStars;
export function starsForMovesLeft(movesLeft: number | null, balance: LevelBalance, policy?: StarPolicy): LevelStars {
  const reject = (message: string): never => {
    throw new RangeError(`starsForMovesLeft: ${message}`);
  };
  if (policy !== undefined && (!isObject(policy) || !STARS.includes(policy.unlimitedStars))) reject('policy.unlimitedStars must be 1, 2 or 3');
  const level = readLevelBalance(balance, (message) => reject(`balance ${message}`));
  if (movesLeft !== null && !isCount(movesLeft)) reject('movesLeft must be an integer ≥ 0');
  if (level.moveLimit === null) {
    if (policy === undefined) reject(`level "${level.progressionKey}" is unlimited — its stars are a product decision: pass policy.unlimitedStars`);
    return (policy as StarPolicy).unlimitedStars;
  }
  if (movesLeft === null) reject(`movesLeft is null but level "${level.progressionKey}" has a move limit`);
  if ((movesLeft as number) >= level.star3MinMovesLeft) return 3;
  if ((movesLeft as number) >= level.star2MinMovesLeft) return 2;
  return 1;
}
