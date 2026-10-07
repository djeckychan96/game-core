import { describe, expect, test } from 'vitest';
import { MoveRuntime, starsForMovesLeft } from '../../src/index';
import type { LevelBalance, LimitedLevelBalance, MoveSnapshot, UnlimitedLevelBalance } from '../../src/index';

/** TEST values only — never Core defaults. */
const LIMITED: LimitedLevelBalance = { progressionKey: '12', sourceLevelId: 12, moveLimit: 10, star3MinMovesLeft: 6, star2MinMovesLeft: 3 };
const UNLIMITED: UnlimitedLevelBalance = { progressionKey: '1', moveLimit: null };

/** The counters a host reads. */
const counters = (moves: MoveRuntime) => ({
  active: moves.active,
  unlimited: moves.unlimited,
  limit: moves.limit,
  used: moves.used,
  added: moves.added,
  remaining: moves.remaining,
  exhausted: moves.exhausted
});
const started = (balance: LevelBalance = LIMITED) => {
  const moves = new MoveRuntime();
  moves.start(balance);
  return moves;
};
const IDLE = { active: false, unlimited: false, limit: 0, used: 0, added: 0, remaining: 0, exhausted: false };

describe('MoveRuntime — no attempt', () => {
  test('a new runtime has no attempt: counters read 0 / false, snapshot null', () => {
    const moves = new MoveRuntime();
    expect(counters(moves)).toEqual(IDLE);
    expect(moves.balance).toBeNull();
    expect(moves.snapshot()).toBeNull();
  });

  test('consume() and add() are refused without an attempt', () => {
    const moves = new MoveRuntime();
    expect(moves.consume()).toEqual({ ok: false, reason: 'no_attempt', delta: 0, remaining: 0, exhausted: false });
    expect(moves.add(5)).toEqual({ ok: false, reason: 'no_attempt', delta: 0, remaining: 0, exhausted: false });
    expect(counters(moves)).toEqual(IDLE);
  });
});

describe('MoveRuntime — a limited attempt', () => {
  test('start() → moveLimit moves; the snapshot answers the attempt', () => {
    const moves = new MoveRuntime();
    expect(moves.start(LIMITED)).toEqual({ v: 1, balance: LIMITED, used: 0, added: 0 });
    expect(counters(moves)).toEqual({ active: true, unlimited: false, limit: 10, used: 0, added: 0, remaining: 10, exhausted: false });
    expect(moves.balance).toEqual(LIMITED);
    expect(Object.isFrozen(moves.balance)).toBe(true);
    expect(moves.balance).not.toBe(LIMITED); // a copy: the host's object stays its own
  });

  test('consume() takes one move by default, consume(n) takes n', () => {
    const moves = started();
    expect(moves.consume()).toEqual({ ok: true, reason: null, delta: 1, remaining: 9, exhausted: false });
    expect(moves.consume(3)).toEqual({ ok: true, reason: null, delta: 3, remaining: 6, exhausted: false });
    expect(counters(moves)).toMatchObject({ used: 4, remaining: 6, limit: 10 });
  });

  test('the move that takes the last one exhausts the attempt', () => {
    const moves = started();
    moves.consume(9);
    expect(moves.consume()).toEqual({ ok: true, reason: null, delta: 1, remaining: 0, exhausted: true });
    expect(counters(moves)).toEqual({ active: true, unlimited: false, limit: 10, used: 10, added: 0, remaining: 0, exhausted: true });
  });

  test('consume never goes below 0: it takes what is left, and at 0 it is refused (nothing changes)', () => {
    const moves = started();
    moves.consume(8);
    expect(moves.consume(5)).toEqual({ ok: true, reason: null, delta: 2, remaining: 0, exhausted: true });
    for (let i = 0; i < 5; i++) expect(moves.consume()).toEqual({ ok: false, reason: 'exhausted', delta: 0, remaining: 0, exhausted: true });
    expect(moves.consume(100)).toMatchObject({ ok: false, reason: 'exhausted', delta: 0 });
    expect(counters(moves)).toMatchObject({ used: 10, remaining: 0, exhausted: true });
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1'])('a count of %s is a RangeError and changes nothing', (count) => {
    const moves = started();
    expect(() => moves.consume(count as number)).toThrow('MoveRuntime.consume(): count must be an integer ≥ 1');
    expect(() => moves.add(count as number)).toThrow('MoveRuntime.add(): count must be an integer ≥ 1');
    expect(counters(moves)).toMatchObject({ used: 0, added: 0, remaining: 10 });
  });

  test('add() before the attempt runs out extends its limit', () => {
    const moves = started();
    moves.consume(4);
    expect(moves.add(5)).toEqual({ ok: true, reason: null, delta: 5, remaining: 11, exhausted: false });
    expect(counters(moves)).toMatchObject({ limit: 15, used: 4, added: 5, remaining: 11 });
  });

  test('add() after the attempt ran out brings it back (a continue): no longer exhausted, moves can be consumed again', () => {
    const moves = started();
    moves.consume(10);
    expect(moves.exhausted).toBe(true);
    expect(moves.add(5)).toEqual({ ok: true, reason: null, delta: 5, remaining: 5, exhausted: false });
    expect(moves.consume(2)).toMatchObject({ ok: true, delta: 2, remaining: 3 });
    moves.consume(3);
    expect(moves.exhausted).toBe(true);
    expect(moves.add(5).remaining).toBe(5); // a second continue on the same attempt
    expect(counters(moves)).toMatchObject({ limit: 20, used: 15, added: 10, remaining: 5 });
  });

  test('start() replaces the running attempt (a restart): fresh counters, the new balance', () => {
    const moves = started();
    moves.consume(10);
    moves.add(3);
    const next: LimitedLevelBalance = { progressionKey: '13', moveLimit: 15, star3MinMovesLeft: 5, star2MinMovesLeft: 2 };
    moves.start(next);
    expect(counters(moves)).toEqual({ active: true, unlimited: false, limit: 15, used: 0, added: 0, remaining: 15, exhausted: false });
    expect(moves.balance?.progressionKey).toBe('13');
  });

  test('start() with an invalid balance throws and keeps the running attempt', () => {
    const moves = started();
    moves.consume(2);
    expect(() => moves.start({ ...LIMITED, star2MinMovesLeft: 7 })).toThrow('MoveRuntime.start(): balance star2MinMovesLeft must be ≤ star3MinMovesLeft');
    expect(() => moves.start(null as unknown as LevelBalance)).toThrow(RangeError);
    expect(counters(moves)).toMatchObject({ active: true, used: 2, remaining: 8 });
    expect(moves.balance?.progressionKey).toBe('12');
  });

  test('end() → no attempt; repeat-safe; the runtime can start again', () => {
    const moves = started();
    moves.consume(3);
    moves.end();
    moves.end();
    expect(counters(moves)).toEqual(IDLE);
    expect(moves.snapshot()).toBeNull();
    moves.start(LIMITED);
    expect(moves.remaining).toBe(10);
  });
});

describe('MoveRuntime — an unlimited attempt', () => {
  test('never runs out: remaining / limit null, consume always succeeds and still counts used', () => {
    const moves = started(UNLIMITED);
    expect(counters(moves)).toEqual({ active: true, unlimited: true, limit: null, used: 0, added: 0, remaining: null, exhausted: false });
    expect(moves.consume()).toEqual({ ok: true, reason: null, delta: 1, remaining: null, exhausted: false });
    for (let i = 0; i < 10_000; i++) moves.consume();
    expect(moves.consume(50)).toEqual({ ok: true, reason: null, delta: 50, remaining: null, exhausted: false });
    expect(counters(moves)).toMatchObject({ used: 10_051, remaining: null, exhausted: false });
  });

  test('add() is refused: an unlimited attempt has no count to extend', () => {
    const moves = started(UNLIMITED);
    moves.consume(4);
    expect(moves.add(5)).toEqual({ ok: false, reason: 'unlimited', delta: 0, remaining: null, exhausted: false });
    expect(counters(moves)).toMatchObject({ used: 4, added: 0, limit: null });
  });
});

describe('MoveRuntime — 0 is a state, not an outcome: the host decides WIN / FAIL after the gameplay settled', () => {
  test('the runtime has no outcome, listener or window API to call', () => {
    const api = Object.getOwnPropertyNames(MoveRuntime.prototype);
    expect(api).toEqual(expect.arrayContaining(['start', 'consume', 'add', 'end', 'snapshot', 'restore']));
    expect(api.filter((name) => /win|won|lose|lost|fail|outcome|result|offer|show|^on[A-Z]|listen|subscribe|emit/i.test(name))).toEqual([]);
  });

  test('the last move exhausts the attempt; it stays at 0 — consumes refused, nothing changes — until the host decides', () => {
    const moves = started();
    moves.consume(9);
    const last = moves.consume();
    expect(last).toMatchObject({ ok: true, remaining: 0, exhausted: true });
    // the gameplay is still settling the last move (an animation, a cascade asking for moves): nothing moves
    const before = moves.snapshot();
    for (let i = 0; i < 3; i++) expect(moves.consume().reason).toBe('exhausted');
    expect(moves.snapshot()).toEqual(before);
    expect(counters(moves)).toMatchObject({ active: true, remaining: 0, exhausted: true });
  });

  test('settled → WON on the last move: the host completes the level with stars for 0 moves left', () => {
    const moves = started();
    moves.consume(10);
    const won = true; // the gameplay's answer after it settled
    expect(won && moves.exhausted).toBe(true);
    const balance = moves.balance as LimitedLevelBalance;
    expect(starsForMovesLeft(moves.remaining as number, balance)).toBe(1);
    expect(starsForMovesLeft(0, { ...balance, star2MinMovesLeft: 0 })).toBe(2);
    moves.end();
    expect(moves.active).toBe(false);
  });

  test('settled → not won: the host shows its continue offer, delivers it with add(n), the attempt goes on', () => {
    const moves = started();
    moves.consume(10);
    const continued = moves.add(5);
    expect(continued).toMatchObject({ ok: true, remaining: 5, exhausted: false });
    moves.consume(4);
    expect(starsForMovesLeft(moves.remaining as number, moves.balance as LimitedLevelBalance)).toBe(1); // won with 1 left
  });

  test('settled → not won, offer declined: the host ends the attempt (its fail flow), the runtime only goes idle', () => {
    const moves = started();
    moves.consume(10);
    moves.end();
    expect(counters(moves)).toEqual(IDLE);
  });

  test('the exhausted attempt survives a reload at 0 (the decision can wait for the restored run)', () => {
    const moves = started();
    moves.consume(10);
    const restored = new MoveRuntime();
    expect(restored.restore(JSON.parse(JSON.stringify(moves.snapshot())) as MoveSnapshot)).toEqual({ ok: true, reason: null });
    expect(counters(restored)).toMatchObject({ remaining: 0, exhausted: true });
    expect(restored.add(3).remaining).toBe(3);
  });
});

describe('MoveRuntime — snapshot / restore', () => {
  test('a JSON round trip into a new runtime continues the attempt with the same counters', () => {
    const moves = started();
    moves.consume(7);
    moves.add(4);
    moves.consume(2);
    const saved = JSON.stringify(moves.snapshot());
    expect(JSON.parse(saved)).toEqual({ v: 1, balance: LIMITED, used: 9, added: 4 });
    const restored = new MoveRuntime();
    expect(restored.restore(JSON.parse(saved) as MoveSnapshot)).toEqual({ ok: true, reason: null });
    expect(counters(restored)).toEqual(counters(moves));
    expect(counters(restored)).toMatchObject({ limit: 14, used: 9, added: 4, remaining: 5 });
    expect(Object.isFrozen(restored.balance)).toBe(true);
  });

  test('the snapshot carries its own balance: a restored attempt keeps its rules even if the source changed since', () => {
    const moves = started();
    moves.consume(3);
    const snapshot = JSON.parse(JSON.stringify(moves.snapshot())) as MoveSnapshot;
    const restored = new MoveRuntime();
    restored.start({ ...LIMITED, moveLimit: 25, star3MinMovesLeft: 9 }); // today's (re-balanced) source value
    restored.restore(snapshot);
    expect(restored.balance).toEqual(LIMITED);
    expect(restored.remaining).toBe(7);
  });

  test('an unlimited attempt round-trips', () => {
    const moves = started(UNLIMITED);
    moves.consume(12);
    const restored = new MoveRuntime();
    expect(restored.restore(JSON.parse(JSON.stringify(moves.snapshot())) as MoveSnapshot).ok).toBe(true);
    expect(counters(restored)).toEqual({ active: true, unlimited: true, limit: null, used: 12, added: 0, remaining: null, exhausted: false });
  });

  test('the snapshot is a copy: changing it does not change the runtime', () => {
    const moves = started();
    const snapshot = moves.snapshot() as MoveSnapshot;
    snapshot.used = 9;
    snapshot.added = 100;
    expect(counters(moves)).toMatchObject({ used: 0, added: 0, remaining: 10 });
    expect(Object.isFrozen(snapshot.balance)).toBe(true);
  });

  const valid = (): Record<string, unknown> => ({ v: 1, balance: { ...LIMITED }, used: 4, added: 2 });
  const invalidSnapshots: Array<[string, unknown]> = [
    ['null', null],
    ['an array', []],
    ['another format version', { ...valid(), v: 2 }],
    ['no version', { ...valid(), v: undefined }],
    ['no balance', { ...valid(), balance: undefined }],
    ['an invalid balance', { ...valid(), balance: { ...LIMITED, star3MinMovesLeft: 11 } }],
    ['negative used', { ...valid(), used: -1 }],
    ['fractional added', { ...valid(), added: 0.5 }],
    ['a string count', { ...valid(), used: '4' }],
    ['used beyond limit + added', { ...valid(), used: 13 }],
    ['added on an unlimited attempt', { v: 1, balance: UNLIMITED, used: 3, added: 1 }]
  ];
  test.each(invalidSnapshots)('restore() refuses %s and changes nothing', (_name, snapshot) => {
    const moves = started();
    moves.consume(2);
    expect(moves.restore(snapshot as MoveSnapshot)).toEqual({ ok: false, reason: 'invalid_snapshot' });
    expect(counters(moves)).toMatchObject({ active: true, used: 2, remaining: 8 });
    expect(moves.balance?.progressionKey).toBe('12');
  });

  test('used = limit + added is valid (an exhausted attempt after a continue)', () => {
    const moves = new MoveRuntime();
    expect(moves.restore({ v: 1, balance: LIMITED, used: 12, added: 2 }).ok).toBe(true);
    expect(counters(moves)).toMatchObject({ limit: 12, remaining: 0, exhausted: true });
  });

  test('restore() replaces the running attempt', () => {
    const moves = started(UNLIMITED);
    moves.restore({ v: 1, balance: LIMITED, used: 1, added: 0 });
    expect(counters(moves)).toMatchObject({ unlimited: false, limit: 10, remaining: 9 });
  });
});

describe('MoveRuntime — invariants over a seeded random session', () => {
  test.each([1, 7, 42, 2026])('seed %i: remaining = limit − used ≥ 0, matching a reference model, across consume / add / reload', (seed) => {
    let state = seed;
    const next = (n: number) => {
      state = (state * 48271) % 2147483647; // MINSTD: exact in doubles
      return state % n;
    };
    let moves = started();
    let model = { limit: 10, used: 0 };
    for (let step = 0; step < 2000; step++) {
      const op = next(10);
      if (op < 6) {
        const count = 1 + next(3);
        const left = model.limit - model.used;
        const result = moves.consume(count);
        const delta = Math.min(count, left);
        expect(result).toEqual({ ok: left > 0, reason: left > 0 ? null : 'exhausted', delta, remaining: left - delta, exhausted: left - delta === 0 });
        model.used += delta;
      } else if (op < 8) {
        const count = 1 + next(4);
        expect(moves.add(count).delta).toBe(count);
        model.limit += count;
      } else if (op < 9) {
        const reloaded = new MoveRuntime();
        expect(reloaded.restore(JSON.parse(JSON.stringify(moves.snapshot())) as MoveSnapshot).ok).toBe(true);
        moves = reloaded;
      } else {
        moves.start(LIMITED);
        model = { limit: 10, used: 0 };
      }
      expect(moves.remaining).toBe(model.limit - model.used);
      expect(moves.remaining).toBeGreaterThanOrEqual(0);
      expect(moves.limit).toBe(model.limit);
      expect(moves.exhausted).toBe(model.used === model.limit);
    }
  });
});
