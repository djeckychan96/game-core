import { describe, expect, test } from 'vitest';
import { MoveRuntime, createStaticLevelBalanceSource, validateLevelBalanceTable } from '../../src/index';
import type { LevelBalanceSource, LevelBalanceTable } from '../../src/index';

/** TEST data — a local table as a host would bundle it (keys are the host's progression keys, ids its content ids). */
const TABLE: LevelBalanceTable = {
  version: 'local-1',
  levels: [
    { progressionKey: '1', sourceLevelId: 1, moveLimit: null },
    { progressionKey: '2', sourceLevelId: 2, moveLimit: 20, star3MinMovesLeft: 8, star2MinMovesLeft: 4, star1MinMovesLeft: 2, baseCoinReward: 40 },
    { progressionKey: 'bonus-a', moveLimit: 12, star3MinMovesLeft: 6, star2MinMovesLeft: 3, star1MinMovesLeft: 1 }
  ]
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const asTable = (value: unknown) => value as LevelBalanceTable;

describe('createStaticLevelBalanceSource — over data the host already loaded', () => {
  test('before a successful load: version null and get() throws — an unloaded source is not "no balance"', () => {
    const source = createStaticLevelBalanceSource(clone(TABLE));
    expect(source.version).toBeNull();
    expect(() => source.get('2')).toThrow('LevelBalanceSource.get(): the balance is not loaded — await load() first');
  });

  test('load() → version and balances by progression key; a key without a balance answers null', async () => {
    const source = createStaticLevelBalanceSource(clone(TABLE));
    await expect(source.load()).resolves.toBeUndefined();
    expect(source.version).toBe('local-1');
    expect(source.get('2')).toEqual({ progressionKey: '2', sourceLevelId: 2, moveLimit: 20, star3MinMovesLeft: 8, star2MinMovesLeft: 4, star1MinMovesLeft: 2, baseCoinReward: 40 });
    expect(source.get('1')).toEqual({ progressionKey: '1', sourceLevelId: 1, moveLimit: null });
    expect(source.get('bonus-a')?.moveLimit).toBe(12);
    expect(source.get('99')).toBeNull();
  });

  test('answers are frozen copies of the known fields; unknown fields are dropped', async () => {
    const source = createStaticLevelBalanceSource(
      asTable({ version: 'v', generatedBy: 'sheet-export', levels: [{ progressionKey: 'a', moveLimit: 5, star3MinMovesLeft: 2, star2MinMovesLeft: 1, star1MinMovesLeft: 0, designerNote: 'x' }] })
    );
    await source.load();
    const balance = source.get('a');
    expect(balance).toEqual({ progressionKey: 'a', moveLimit: 5, star3MinMovesLeft: 2, star2MinMovesLeft: 1, star1MinMovesLeft: 0 });
    expect(Object.isFrozen(balance)).toBe(true);
    expect(() => {
      (balance as { moveLimit: number }).moveLimit = 99;
    }).toThrow(TypeError);
  });

  test('the table is copied at load: later changes of the host object do not reach get()', async () => {
    const data = clone(TABLE) as unknown as { version: string; levels: Array<Record<string, unknown>> };
    const source = createStaticLevelBalanceSource(asTable(data));
    await source.load();
    data.version = 'mutated';
    data.levels[1]!.moveLimit = 3;
    data.levels.push({ progressionKey: 'late', moveLimit: 5, star3MinMovesLeft: 2, star2MinMovesLeft: 1, star1MinMovesLeft: 0 });
    expect(source.version).toBe('local-1');
    expect(source.get('2')?.moveLimit).toBe(20);
    expect(source.get('late')).toBeNull();
  });

  test('load() is answered once: repeated calls get the same promise', () => {
    const source = createStaticLevelBalanceSource(clone(TABLE));
    expect(source.load()).toBe(source.load());
  });

  test('an empty table is valid: no level has a balance', async () => {
    const source = createStaticLevelBalanceSource({ version: 'empty', levels: [] });
    await source.load();
    expect(source.get('1')).toBeNull();
  });

  test('get() refuses a key that is not a non-empty string (a number level is not a progression key)', async () => {
    const source = createStaticLevelBalanceSource(clone(TABLE));
    await source.load();
    expect(() => source.get(2 as unknown as string)).toThrow(TypeError);
    expect(() => source.get('')).toThrow('LevelBalanceSource.get(): progressionKey must be a non-empty string');
  });

  const invalidTables: Array<[string, unknown, string]> = [
    ['no table', null, 'the table must be an object { version, levels }'],
    ['an array', [], 'the table must be an object { version, levels }'],
    ['a missing version', { levels: [] }, 'version must be a non-empty string'],
    ['an empty version', { version: '', levels: [] }, 'version must be a non-empty string'],
    ['a number version', { version: 3, levels: [] }, 'version must be a non-empty string'],
    ['levels not an array', { version: 'v', levels: {} }, 'levels must be an array'],
    ['a record that is not an object', { version: 'v', levels: [null] }, 'levels[0] must be an object'],
    [
      'an invalid record (named by index and key)',
      { version: 'v', levels: [TABLE.levels[0], { progressionKey: '2', moveLimit: 20, star3MinMovesLeft: 21, star2MinMovesLeft: 4, star1MinMovesLeft: 2 }] },
      'levels[1] ("2") star3MinMovesLeft must be ≤ moveLimit'
    ],
    ['a repeated progressionKey', { version: 'v', levels: [...TABLE.levels, { progressionKey: '2', moveLimit: null }] }, 'levels[3] ("2") repeats a progressionKey — one balance per level']
  ];

  test.each(invalidTables)('invalid data (%s): load() rejects with a RangeError, nothing is loaded', async (_name, data, message) => {
    const source = createStaticLevelBalanceSource(asTable(data));
    await expect(source.load()).rejects.toThrow(RangeError);
    await expect(source.load()).rejects.toThrow(`LevelBalanceSource: ${message}`);
    expect(source.version).toBeNull();
    expect(() => source.get('2')).toThrow('the balance is not loaded');
  });

  test.each(invalidTables)('validateLevelBalanceTable refuses %s', (_name, data, message) => {
    expect(() => validateLevelBalanceTable(asTable(data))).toThrow(`validateLevelBalanceTable: ${message}`);
  });

  test('validateLevelBalanceTable accepts a valid table', () => {
    expect(() => validateLevelBalanceTable(TABLE)).not.toThrow();
  });
});

describe('LevelBalanceSource — the seam a server source plugs into', () => {
  /**
   * A stand-in for a future server implementation (no network here: the answer is an injected async function).
   * It reuses the static source for the checks; the runtime never knows which source the balance came from.
   */
  function serverLikeSource(fetchTable: () => Promise<unknown>): LevelBalanceSource {
    let current: LevelBalanceSource | null = null;
    return {
      get version() {
        return current?.version ?? null;
      },
      async load() {
        const next = createStaticLevelBalanceSource(asTable(await fetchTable()));
        await next.load();
        current = next;
      },
      get(progressionKey) {
        if (!current) throw new Error('not loaded');
        return current.get(progressionKey);
      }
    };
  }

  test('a balance from another implementation drives MoveRuntime exactly like a local one', async () => {
    const local = createStaticLevelBalanceSource(clone(TABLE));
    const remote = serverLikeSource(async () => clone(TABLE));
    await Promise.all([local.load(), remote.load()]);
    const fromLocal = new MoveRuntime();
    const fromRemote = new MoveRuntime();
    fromLocal.start(local.get('2')!);
    fromRemote.start(remote.get('2')!);
    fromLocal.consume(3);
    fromRemote.consume(3);
    expect(fromRemote.snapshot()).toEqual(fromLocal.snapshot());
    expect(fromRemote.remaining).toBe(17);
  });

  test('a new revision replaces the data; a failed reload keeps the last good one (the interface contract)', async () => {
    const answers: Array<() => Promise<unknown>> = [
      async () => clone(TABLE),
      async () => ({ version: 'server-2', levels: [{ progressionKey: '2', moveLimit: 25, star3MinMovesLeft: 10, star2MinMovesLeft: 5, star1MinMovesLeft: 2 }] }),
      async () => {
        throw new Error('offline');
      },
      async () => ({ version: 'server-3', levels: [{ progressionKey: '2', moveLimit: 0 }] })
    ];
    const source = serverLikeSource(() => answers.shift()!());
    await source.load();
    expect(source.version).toBe('local-1');
    await source.load();
    expect(source.version).toBe('server-2');
    expect(source.get('2')?.moveLimit).toBe(25);
    expect(source.get('1')).toBeNull();
    await expect(source.load()).rejects.toThrow('offline');
    await expect(source.load()).rejects.toThrow(RangeError);
    expect(source.version).toBe('server-2');
    expect(source.get('2')?.moveLimit).toBe(25);
  });
});
