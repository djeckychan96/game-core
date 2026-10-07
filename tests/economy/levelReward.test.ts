import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import * as root from '../../src/index';
import { MoveRuntime, SaveGate, SoftCurrencyWallet, coinRewardForStars, starsForMovesLeft } from '../../src/index';
import type { GameProductionProfile, GameplayLevelResult, LevelStars, LimitedLevelBalance, PlatformStorage } from '../../src/index';

describe('coinRewardForStars — 3 → N, 2 → ¾ N, 1 → ½ N, 0 → ¼ N, rounded up', () => {
  test.each([
    // N divisible by 4: exact quarters
    [40, 3, 40],
    [40, 2, 30],
    [40, 1, 20],
    [40, 0, 10],
    // N = 10: 7.5 → 8, 5, 2.5 → 3
    [10, 3, 10],
    [10, 2, 8],
    [10, 1, 5],
    [10, 0, 3],
    // N = 7: 5.25 → 6, 3.5 → 4, 1.75 → 2
    [7, 3, 7],
    [7, 2, 6],
    [7, 1, 4],
    [7, 0, 2],
    // N = 5: 3.75 → 4, 2.5 → 3, 1.25 → 2
    [5, 2, 4],
    [5, 1, 3],
    [5, 0, 2],
    // N = 1: every share rounds up to the whole coin
    [1, 3, 1],
    [1, 2, 1],
    [1, 1, 1],
    [1, 0, 1],
    // N = 0: nothing
    [0, 3, 0],
    [0, 0, 0]
  ] as const)('base %i, %i stars → %i coins', (base, stars, coins) => {
    expect(coinRewardForStars(base, stars)).toBe(coins);
  });

  test('equals ceil(N × (stars + 1) / 4) for every base 0–400 and never decreases with stars', () => {
    for (let base = 0; base <= 400; base++) {
      let previous = -1;
      for (const stars of [0, 1, 2, 3] as const) {
        const coins = coinRewardForStars(base, stars);
        expect(coins).toBe(Math.ceil((base * (stars + 1)) / 4));
        expect(coins).toBeGreaterThanOrEqual(previous);
        previous = coins;
      }
      expect(previous).toBe(base); // 3 stars pay the whole base
    }
  });

  test('stays exact at the top of the safe integers (no float overflow of N × 4)', () => {
    const base = Number.MAX_SAFE_INTEGER; // 2^53 − 1 = 4q + 3
    const q = (base - 3) / 4;
    expect(coinRewardForStars(base, 3)).toBe(base);
    expect(coinRewardForStars(base, 0)).toBe(q + 1);
    expect(coinRewardForStars(base, 1)).toBe(2 * q + 2);
    expect(coinRewardForStars(base, 2)).toBe(3 * q + 3);
  });

  test.each([-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '40', null])('refuses base %s', (base) => {
    expect(() => coinRewardForStars(base as number, 3)).toThrow('coinRewardForStars: baseCoinReward must be an integer ≥ 0');
  });

  test.each([-1, 4, 1.5, Number.NaN, '2', undefined])('refuses stars %s', (stars) => {
    expect(() => coinRewardForStars(40, stars as LevelStars)).toThrow('coinRewardForStars: stars must be 0, 1, 2 or 3');
  });
});

describe('coinRewardForStars inside the existing payer: SoftCurrencyWallet levelReward policy', () => {
  /** A PlatformStorage over a plain object. */
  function memoryStorage(): PlatformStorage {
    const data: Record<string, unknown> = {};
    return {
      isCloud: () => true,
      ready: async () => {},
      get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, JSON.parse(JSON.stringify(data[key]))])),
      set: async (patch) => {
        Object.assign(data, JSON.parse(JSON.stringify(patch)));
        return true;
      },
      clear: async (keys) => {
        for (const key of keys) delete data[key];
      }
    };
  }

  /** TEST data: the designer's 40-move level with a base reward of 10 coins. */
  const LEVEL: LimitedLevelBalance = { progressionKey: '5', moveLimit: 40, star3MinMovesLeft: 30, star2MinMovesLeft: 20, star1MinMovesLeft: 10, baseCoinReward: 10 };

  async function walletFor(levelReward: (result: GameplayLevelResult) => number) {
    const profile: Pick<GameProductionProfile, 'id' | 'save' | 'economy'> = {
      id: 'game',
      save: { keys: ['game_state'] },
      economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0, levelReward } }
    };
    const gate = new SaveGate({ storage: memoryStorage(), profile });
    const wallet = new SoftCurrencyWallet({ gate, profile });
    await Promise.all([gate.load(), wallet.load()]);
    gate.open();
    return wallet;
  }

  const result = (stars: number | undefined, extra: Partial<GameplayLevelResult> = {}): GameplayLevelResult => ({
    level: 5,
    win: true,
    firstCompletion: true,
    ...(stars === undefined ? {} : { stars }),
    metrics: {},
    ...extra
  });

  test('moves → stars → coins: the wallet pays the star tier of the level\'s base (a host policy, no new payer)', async () => {
    const wallet = await walletFor((r) => coinRewardForStars(LEVEL.baseCoinReward as number, r.stars as LevelStars));
    const moves = new MoveRuntime();
    moves.start(LEVEL);
    moves.consume(40);
    moves.add(20); // a continue: the extra moves count, the thresholds do not move
    moves.consume(5);
    const stars = starsForMovesLeft(moves.remaining as number, LEVEL);
    expect(stars).toBe(1); // 15 left
    const paid = wallet.applyLevelResult(result(stars));
    expect(paid).toMatchObject({ ok: true, kind: 'first', amount: 5, balance: 5 });
  });

  test('a 0-star win still pays a quarter, rounded up; a fail pays nothing (the wallet\'s rule)', async () => {
    const wallet = await walletFor((r) => coinRewardForStars(LEVEL.baseCoinReward as number, r.stars as LevelStars));
    expect(wallet.applyLevelResult(result(0)).amount).toBe(3);
    expect(wallet.applyLevelResult(result(3, { level: 6, win: false, firstCompletion: false })).amount).toBe(0);
  });

  test('a result without stars makes the policy throw: the wallet refuses (invalid_reward), nothing is paid', async () => {
    const wallet = await walletFor((r) => coinRewardForStars(LEVEL.baseCoinReward as number, r.stars as LevelStars));
    const paid = wallet.applyLevelResult(result(undefined));
    expect(paid).toMatchObject({ ok: false, reason: 'invalid_reward', amount: 0, balance: 0 });
    expect(String(paid.error)).toContain('coinRewardForStars: stars must be 0, 1, 2 or 3');
  });
});

test('the root entry exports coinRewardForStars; src/economy/levelReward.ts is pure (types-only import, no global or clock)', () => {
  expect(root).toHaveProperty('coinRewardForStars');
  const source = readFileSync(fileURLToPath(new URL('../../src/economy/levelReward.ts', import.meta.url)), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  expect(source.match(/\b(Date|performance|setTimeout|setInterval|window|globalThis|document|localStorage|fetch|Math\.random)\b/)?.[0] ?? null).toBeNull();
  expect([...source.matchAll(/^import .*$/gm)].map(([line]) => line)).toEqual(["import type { LevelStars } from '../moves/balance';"]);
});
