import { describe, expect, test } from 'vitest';
import { starsForMovesLeft, validateLevelBalance } from '../../src/index';
import type { LevelBalance, LimitedLevelBalance, StarPolicy, UnlimitedLevelBalance } from '../../src/index';

/** TEST values only — never Core defaults: the game designer's example, 40 moves, thresholds 30 / 20 / 10 moves left. */
const LIMITED: LimitedLevelBalance = { progressionKey: '12', moveLimit: 40, star3MinMovesLeft: 30, star2MinMovesLeft: 20, star1MinMovesLeft: 10 };
const UNLIMITED: UnlimitedLevelBalance = { progressionKey: '1', moveLimit: null };
const limited = (patch: Partial<LimitedLevelBalance>): LimitedLevelBalance => ({ ...LIMITED, ...patch });

/** Validates `base` with `patch` applied (an `undefined` value removes the field). */
function check(patch: Record<string, unknown>, base: object = LIMITED): () => void {
  const record: Record<string, unknown> = { ...base, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete record[key];
  return () => validateLevelBalance(record as unknown as LevelBalance);
}

describe('LevelBalance — validation', () => {
  test('accepts a limited level, an unlimited level without thresholds and an unlimited level with some or all of them', () => {
    expect(() => validateLevelBalance(LIMITED)).not.toThrow();
    expect(() => validateLevelBalance(UNLIMITED)).not.toThrow();
    expect(() => validateLevelBalance({ progressionKey: 'x', moveLimit: null, star3MinMovesLeft: 5, star2MinMovesLeft: 2, star1MinMovesLeft: 1 })).not.toThrow();
    expect(() => validateLevelBalance({ progressionKey: 'x', moveLimit: null, star3MinMovesLeft: 5 })).not.toThrow();
    expect(() => validateLevelBalance({ progressionKey: 'x', moveLimit: null, star1MinMovesLeft: 0 })).not.toThrow();
  });

  test('boundaries of 0 ≤ star1 ≤ star2 ≤ star3 ≤ moveLimit are inclusive; moveLimit 1 is the smallest limit', () => {
    expect(check({ star1MinMovesLeft: 0 })).not.toThrow();
    expect(check({ star1MinMovesLeft: 20 })).not.toThrow();
    expect(check({ star2MinMovesLeft: 30 })).not.toThrow();
    expect(check({ star3MinMovesLeft: 40 })).not.toThrow();
    expect(check({ star3MinMovesLeft: 25, star2MinMovesLeft: 25, star1MinMovesLeft: 25 })).not.toThrow();
    expect(check({ moveLimit: 1, star3MinMovesLeft: 1, star2MinMovesLeft: 1, star1MinMovesLeft: 1 })).not.toThrow();
    expect(check({ moveLimit: 1, star3MinMovesLeft: 0, star2MinMovesLeft: 0, star1MinMovesLeft: 0 })).not.toThrow();
  });

  test('baseCoinReward is optional: an integer ≥ 0 on a limited or an unlimited level', () => {
    expect(check({ baseCoinReward: 0 })).not.toThrow();
    expect(check({ baseCoinReward: 125 })).not.toThrow();
    expect(check({ baseCoinReward: 30 }, UNLIMITED)).not.toThrow();
  });

  test('sourceLevelId is reference only: absent, a non-empty string or an integer (a game content id)', () => {
    expect(check({ sourceLevelId: 37 })).not.toThrow();
    expect(check({ sourceLevelId: 'pictures/p0037' })).not.toThrow();
    expect(check({ sourceLevelId: 37 }, UNLIMITED)).not.toThrow();
  });

  test('unknown fields are ignored (a newer data producer may add some)', () => {
    expect(check({ difficulty: [1, 2], designerNote: 'hard' })).not.toThrow();
    expect(check({ timeLimit: 90 }, UNLIMITED)).not.toThrow();
  });

  const refusals: Array<[string, Record<string, unknown>, object, string]> = [
    ['a missing progressionKey', { progressionKey: undefined }, LIMITED, 'progressionKey must be a non-empty string'],
    ['an empty progressionKey', { progressionKey: '' }, LIMITED, 'progressionKey must be a non-empty string'],
    ['a number progressionKey', { progressionKey: 12 }, LIMITED, 'progressionKey must be a non-empty string'],
    ['an empty sourceLevelId', { sourceLevelId: '' }, LIMITED, 'sourceLevelId must be a non-empty string or an integer'],
    ['a fractional sourceLevelId', { sourceLevelId: 1.5 }, LIMITED, 'sourceLevelId must be a non-empty string or an integer'],
    ['a null sourceLevelId', { sourceLevelId: null }, LIMITED, 'sourceLevelId must be a non-empty string or an integer'],
    ['a negative baseCoinReward', { baseCoinReward: -1 }, LIMITED, 'baseCoinReward must be an integer ≥ 0 when given'],
    ['a fractional baseCoinReward', { baseCoinReward: 2.5 }, LIMITED, 'baseCoinReward must be an integer ≥ 0 when given'],
    ['a string baseCoinReward', { baseCoinReward: '100' }, UNLIMITED, 'baseCoinReward must be an integer ≥ 0 when given'],
    ['a null baseCoinReward (absent is not null)', { baseCoinReward: null }, LIMITED, 'baseCoinReward must be an integer ≥ 0 when given'],
    ['a missing moveLimit', { moveLimit: undefined }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['moveLimit 0', { moveLimit: 0, star3MinMovesLeft: 0, star2MinMovesLeft: 0, star1MinMovesLeft: 0 }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['a negative moveLimit', { moveLimit: -5 }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['a fractional moveLimit', { moveLimit: 40.5 }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['moveLimit NaN', { moveLimit: Number.NaN }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['moveLimit Infinity (unlimited is null)', { moveLimit: Number.POSITIVE_INFINITY }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['a string moveLimit', { moveLimit: '40' }, LIMITED, 'moveLimit must be an integer ≥ 1, or null'],
    ['a limited level without star3MinMovesLeft', { star3MinMovesLeft: undefined }, LIMITED, 'star3MinMovesLeft must be an integer ≥ 0 for a level with a move limit'],
    ['a limited level without star2MinMovesLeft', { star2MinMovesLeft: undefined }, LIMITED, 'star2MinMovesLeft must be an integer ≥ 0 for a level with a move limit'],
    ['a limited level without star1MinMovesLeft', { star1MinMovesLeft: undefined }, LIMITED, 'star1MinMovesLeft must be an integer ≥ 0 for a level with a move limit'],
    ['a null threshold on a limited level', { star3MinMovesLeft: null }, LIMITED, 'star3MinMovesLeft must be an integer ≥ 0'],
    ['a negative star1MinMovesLeft', { star1MinMovesLeft: -1 }, LIMITED, 'star1MinMovesLeft must be an integer ≥ 0'],
    ['a fractional star3MinMovesLeft', { star3MinMovesLeft: 29.5 }, LIMITED, 'star3MinMovesLeft must be an integer ≥ 0'],
    ['a string threshold', { star2MinMovesLeft: '20' }, LIMITED, 'star2MinMovesLeft must be an integer ≥ 0'],
    ['star2 > star3 (by one)', { star2MinMovesLeft: 31 }, LIMITED, 'star2MinMovesLeft must be ≤ star3MinMovesLeft'],
    ['star1 > star2 (by one)', { star1MinMovesLeft: 21 }, LIMITED, 'star1MinMovesLeft must be ≤ star2MinMovesLeft'],
    ['star3 > moveLimit (by one)', { star3MinMovesLeft: 41 }, LIMITED, 'star3MinMovesLeft must be ≤ moveLimit'],
    ['a negative threshold on an unlimited level', { star3MinMovesLeft: -1 }, UNLIMITED, 'star3MinMovesLeft must be an integer ≥ 0 when given'],
    ['a fractional threshold on an unlimited level', { star1MinMovesLeft: 1.5 }, UNLIMITED, 'star1MinMovesLeft must be an integer ≥ 0 when given'],
    ['a null threshold on an unlimited level (absent is not null)', { star3MinMovesLeft: null }, UNLIMITED, 'star3MinMovesLeft must be an integer ≥ 0 when given'],
    ['star2 > star3 on an unlimited level', { star3MinMovesLeft: 4, star2MinMovesLeft: 5 }, UNLIMITED, 'star2MinMovesLeft must be ≤ star3MinMovesLeft'],
    ['star1 > star2 on an unlimited level', { star2MinMovesLeft: 4, star1MinMovesLeft: 5 }, UNLIMITED, 'star1MinMovesLeft must be ≤ star2MinMovesLeft'],
    ['star1 > star3 on an unlimited level without star2', { star3MinMovesLeft: 4, star1MinMovesLeft: 5 }, UNLIMITED, 'star1MinMovesLeft must be ≤ star3MinMovesLeft']
  ];
  test.each(refusals)('refuses %s with a RangeError naming the field', (_name, patch, base, message) => {
    expect(check(patch, base)).toThrow(RangeError);
    expect(check(patch, base)).toThrow(`validateLevelBalance: ${message}`);
  });

  test.each([null, undefined, [], 'level', 20])('refuses a record that is not an object (%s)', (value) => {
    expect(() => validateLevelBalance(value as unknown as LevelBalance)).toThrow('validateLevelBalance: must be an object');
  });
});

describe('starsForMovesLeft — absolute thresholds: ≥ star3 → 3, ≥ star2 → 2, ≥ star1 → 1, else 0', () => {
  test.each([
    [40, 3],
    [31, 3],
    [30, 3], // star3 exactly
    [29, 2], // star3 − 1
    [21, 2],
    [20, 2], // star2 exactly
    [19, 1], // star2 − 1
    [11, 1],
    [10, 1], // star1 exactly
    [9, 0], // star1 − 1
    [1, 0],
    [0, 0] // won with the last move
  ])('%i moves left of 40 (thresholds 30 / 20 / 10) → %i stars', (movesLeft, stars) => {
    expect(starsForMovesLeft(movesLeft, LIMITED)).toBe(stars);
  });

  test('moves added during the attempt count against the same thresholds (more left than moveLimit → 3)', () => {
    expect(starsForMovesLeft(45, LIMITED)).toBe(3);
  });

  test('equal thresholds: no band between them', () => {
    const level = limited({ star3MinMovesLeft: 20, star2MinMovesLeft: 20, star1MinMovesLeft: 20 });
    expect(starsForMovesLeft(20, level)).toBe(3);
    expect(starsForMovesLeft(19, level)).toBe(0);
  });

  test('star1 = 0: every win earns at least 1; all thresholds 0: every win earns 3', () => {
    expect(starsForMovesLeft(0, limited({ star1MinMovesLeft: 0 }))).toBe(1);
    expect(starsForMovesLeft(0, limited({ star3MinMovesLeft: 0, star2MinMovesLeft: 0, star1MinMovesLeft: 0 }))).toBe(3);
  });

  test('star3 = moveLimit: 3 stars only without a single move used', () => {
    const level = limited({ star3MinMovesLeft: 40 });
    expect(starsForMovesLeft(40, level)).toBe(3);
    expect(starsForMovesLeft(39, level)).toBe(2);
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses movesLeft %s', (movesLeft) => {
    expect(() => starsForMovesLeft(movesLeft, LIMITED)).toThrow('starsForMovesLeft: movesLeft must be an integer ≥ 0');
  });

  test('a limited level needs a number of moves left: null (an unlimited attempt) is refused', () => {
    // @ts-expect-error — `null` is only for a balance that may be unlimited, with the product's policy
    expect(() => starsForMovesLeft(null, LIMITED)).toThrow('starsForMovesLeft: movesLeft is null but level "12" has a move limit');
  });

  test('an invalid balance is refused with the validator\'s reason', () => {
    expect(() => starsForMovesLeft(3, limited({ star3MinMovesLeft: 41 }))).toThrow('starsForMovesLeft: balance star3MinMovesLeft must be ≤ moveLimit');
    const withoutStar1 = { progressionKey: 'old', moveLimit: 10, star3MinMovesLeft: 6, star2MinMovesLeft: 3 } as unknown as LimitedLevelBalance;
    expect(() => starsForMovesLeft(3, withoutStar1)).toThrow('starsForMovesLeft: balance star1MinMovesLeft must be an integer ≥ 0 for a level with a move limit');
  });
});

describe('starsForMovesLeft — an unlimited level: the product decides, explicitly', () => {
  test('without a policy it throws — Core has no default for it', () => {
    expect(() => starsForMovesLeft(null, UNLIMITED as LevelBalance, undefined as unknown as StarPolicy)).toThrow(
      'starsForMovesLeft: level "1" is unlimited — its stars are a product decision: pass policy.unlimitedStars'
    );
  });

  test('the types refuse a balance that may be unlimited unless a policy is passed', () => {
    const someLevel = UNLIMITED as LevelBalance; // what LevelBalanceSource.get() answers
    // @ts-expect-error — no StarPolicy for a LevelBalance (limited OR unlimited)
    expect(() => starsForMovesLeft(5, someLevel)).toThrow(RangeError);
    const narrowed = LIMITED as LevelBalance;
    if (narrowed.moveLimit !== null) expect(starsForMovesLeft(25, narrowed)).toBe(2); // a narrowed limited balance needs none
  });

  test.each([0, 1, 2, 3] as const)('policy.unlimitedStars %i is the answer, whatever the moves', (stars) => {
    expect(starsForMovesLeft(null, UNLIMITED, { unlimitedStars: stars })).toBe(stars);
    expect(starsForMovesLeft(0, UNLIMITED, { unlimitedStars: stars })).toBe(stars);
  });

  test('thresholds carried by an unlimited level are not used', () => {
    const level: UnlimitedLevelBalance = { progressionKey: 'u', moveLimit: null, star3MinMovesLeft: 5, star2MinMovesLeft: 2, star1MinMovesLeft: 1 };
    expect(starsForMovesLeft(100, level, { unlimitedStars: 1 })).toBe(1);
  });

  test('a policy passed for a limited level changes nothing: the thresholds decide', () => {
    const policy: StarPolicy = { unlimitedStars: 1 };
    expect(starsForMovesLeft(30, LIMITED, policy)).toBe(3);
    expect(starsForMovesLeft(9, LIMITED as LevelBalance, policy)).toBe(0);
  });

  test.each([4, -1, 2.5, '3', null])('an invalid policy (unlimitedStars %s) is refused for every level', (value) => {
    const policy = { unlimitedStars: value } as unknown as StarPolicy;
    expect(() => starsForMovesLeft(null, UNLIMITED, policy)).toThrow('starsForMovesLeft: policy.unlimitedStars must be 0, 1, 2 or 3');
    expect(() => starsForMovesLeft(5, LIMITED, policy)).toThrow('starsForMovesLeft: policy.unlimitedStars must be 0, 1, 2 or 3');
  });
});
