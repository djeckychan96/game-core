// Level balance V1 — the move budget of one level, its star thresholds and its base coin reward, as game DATA. Today
// the host passes it from a local table, later the same records come from a server (see source.ts); nothing here
// knows where they came from, which game they belong to or how a level is played. `starsForMovesLeft` is the
// 3 / 2 / 1 / 0 rule over it; the coins of a star result are `coinRewardForStars` (src/economy).

interface LevelBalanceBase {
  /** The level's identity on the game's progression — the key a `LevelBalanceSource` is asked with. A non-empty string. */
  progressionKey: string;
  /** Reference only: the game's own id of the level content this balance was made for. Core never reads it. */
  sourceLevelId?: string | number;
  /** The coins of a 3-star win (`coinRewardForStars` pays fewer stars a share of it), an integer ≥ 0. Absent: the level states none. */
  baseCoinReward?: number;
}

/**
 * A level with a move limit: the attempt has `moveLimit` moves. The thresholds are ABSOLUTE moves left at the win,
 * 0 ≤ star1MinMovesLeft ≤ star2MinMovesLeft ≤ star3MinMovesLeft ≤ moveLimit; moves added during the attempt never
 * move them.
 */
export interface LimitedLevelBalance extends LevelBalanceBase {
  /** Moves of one attempt, an integer ≥ 1. */
  moveLimit: number;
  /** A win with at least this many moves left earns 3 stars. */
  star3MinMovesLeft: number;
  /** A win with at least this many moves left earns 2 stars. */
  star2MinMovesLeft: number;
  /** A win with at least this many moves left earns 1 star; fewer left → 0 stars. */
  star1MinMovesLeft: number;
}

/**
 * A level without a move limit: an attempt never runs out. Thresholds may be absent; when present they are checked
 * (integers ≥ 0, star1 ≤ star2 ≤ star3) and carried, but `starsForMovesLeft` does not use them — moves left are not counted.
 */
export interface UnlimitedLevelBalance extends LevelBalanceBase {
  moveLimit: null;
  star3MinMovesLeft?: number;
  star2MinMovesLeft?: number;
  star1MinMovesLeft?: number;
}

export type LevelBalance = LimitedLevelBalance | UnlimitedLevelBalance;

/** Stars of a won attempt: 0 to 3 (a win with too few moves left earns 0). */
export type LevelStars = 0 | 1 | 2 | 3;

/**
 * The product's answers that the balance cannot give. An unlimited level counts no moves left, so its stars are a
 * product decision passed in explicitly — Core has no default for it.
 */
export interface StarPolicy {
  /** The stars of every won attempt of an unlimited level. */
  unlimitedStars: LevelStars;
}

const STARS: readonly LevelStars[] = [0, 1, 2, 3];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Checks one balance record and answers a frozen copy of its known fields (unknown fields are ignored and dropped: a
 * newer data producer may add some). `reject` throws with the record's path.
 */
export function readLevelBalance(value: unknown, reject: (message: string) => never): LevelBalance {
  if (!isObject(value)) reject('must be an object');
  const record = value as Record<string, unknown>;
  const { progressionKey, sourceLevelId, baseCoinReward, moveLimit } = record;
  const { star3MinMovesLeft: star3, star2MinMovesLeft: star2, star1MinMovesLeft: star1 } = record;
  if (typeof progressionKey !== 'string' || progressionKey === '') reject('progressionKey must be a non-empty string');
  if (sourceLevelId !== undefined && !((typeof sourceLevelId === 'string' && sourceLevelId !== '') || Number.isSafeInteger(sourceLevelId))) {
    reject('sourceLevelId must be a non-empty string or an integer when given');
  }
  if (baseCoinReward !== undefined && !isCount(baseCoinReward)) reject('baseCoinReward must be an integer ≥ 0 when given');
  const thresholds = [['star3MinMovesLeft', star3], ['star2MinMovesLeft', star2], ['star1MinMovesLeft', star1]] as const;
  if (moveLimit === null) {
    for (const [name, threshold] of thresholds) {
      if (threshold !== undefined && !isCount(threshold)) reject(`${name} must be an integer ≥ 0 when given (moveLimit null = unlimited)`);
    }
  } else {
    if (!Number.isSafeInteger(moveLimit) || (moveLimit as number) < 1) reject('moveLimit must be an integer ≥ 1, or null for an unlimited level');
    for (const [name, threshold] of thresholds) if (!isCount(threshold)) reject(`${name} must be an integer ≥ 0 for a level with a move limit`);
  }
  // the order of the thresholds given (all three with a limit): star1 ≤ star2 ≤ star3
  const ordered = (lower: string, low: unknown, upper: string, high: unknown) => {
    if (low !== undefined && high !== undefined && (low as number) > (high as number)) reject(`${lower} must be ≤ ${upper}`);
  };
  ordered('star2MinMovesLeft', star2, 'star3MinMovesLeft', star3);
  ordered('star1MinMovesLeft', star1, 'star2MinMovesLeft', star2);
  ordered('star1MinMovesLeft', star1, 'star3MinMovesLeft', star3);
  if (moveLimit !== null && (star3 as number) > (moveLimit as number)) reject('star3MinMovesLeft must be ≤ moveLimit');
  const balance: Record<string, unknown> = { progressionKey, moveLimit };
  if (sourceLevelId !== undefined) balance.sourceLevelId = sourceLevelId;
  for (const [name, threshold] of thresholds) if (threshold !== undefined) balance[name] = threshold;
  if (baseCoinReward !== undefined) balance.baseCoinReward = baseCoinReward;
  return Object.freeze(balance) as unknown as LevelBalance;
}

/**
 * Throws a RangeError naming the first problem: `progressionKey` a non-empty string; `moveLimit` an integer ≥ 1 or
 * null (unlimited); with a limit, 0 ≤ star1MinMovesLeft ≤ star2MinMovesLeft ≤ star3MinMovesLeft ≤ moveLimit
 * (integers); unlimited, the thresholds may be absent; `baseCoinReward` an integer ≥ 0 when given. Unknown fields are
 * ignored.
 */
export function validateLevelBalance(balance: LevelBalance): void {
  readLevelBalance(balance, (message) => {
    throw new RangeError(`validateLevelBalance: ${message}`);
  });
}

/**
 * The stars of a WON attempt from the moves left at the win: ≥ star3MinMovesLeft → 3, ≥ star2MinMovesLeft → 2,
 * ≥ star1MinMovesLeft → 1, else 0. Moves added during the attempt (`MoveRuntime.add`) count like any other move
 * left, against the balance's own thresholds — they never move. It knows no outcome — never call it for a lost
 * attempt (a loss has no stars here).
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
  if (policy !== undefined && (!isObject(policy) || !STARS.includes(policy.unlimitedStars))) reject('policy.unlimitedStars must be 0, 1, 2 or 3');
  const level = readLevelBalance(balance, (message) => reject(`balance ${message}`));
  if (movesLeft !== null && !isCount(movesLeft)) reject('movesLeft must be an integer ≥ 0');
  if (level.moveLimit === null) {
    if (policy === undefined) reject(`level "${level.progressionKey}" is unlimited — its stars are a product decision: pass policy.unlimitedStars`);
    return (policy as StarPolicy).unlimitedStars;
  }
  if (movesLeft === null) reject(`movesLeft is null but level "${level.progressionKey}" has a move limit`);
  const left = movesLeft as number;
  if (left >= level.star3MinMovesLeft) return 3;
  if (left >= level.star2MinMovesLeft) return 2;
  if (left >= level.star1MinMovesLeft) return 1;
  return 0;
}
