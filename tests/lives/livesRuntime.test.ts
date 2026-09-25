import { afterEach, describe, expect, test, vi } from 'vitest';
import { LivesRuntime, SaveGate, SoftCurrencyWallet } from '../../src/index';
import type { GameProductionProfile, LivesChange, LivesConfig, LivesSnapshot, PlatformStorage } from '../../src/index';
import { HudView } from '../../src/pixi/HudView';
import { formatTimer } from '../../src/pixi/text';
import { createKit } from '../pixi/setup';

type GateProfile = Pick<GameProductionProfile, 'id' | 'save' | 'economy'>;

const PROFILE: GateProfile = {
  id: 'trail',
  save: { keys: ['trail_state'] },
  economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 100 } }
};
const CORE_KEY = 'trail.core';

/** Trail Arrow 0.1.31's numbers as TEST values (5 lives, 1800 s, a win returns the life) — never Core defaults. */
const CONFIG: LivesConfig = { maxLives: 5, regenSeconds: 1800, refundOnWin: true };
const PERIOD = 1800 * 1000;
const T0 = 1_727_000_000_000;

/** A PlatformStorage over a plain object with scripted failures; every call is journaled. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const fake = {
    data: JSON.parse(JSON.stringify(initial)) as Record<string, unknown>,
    calls: [] as string[],
    failRead: false,
    setMode: 'ok' as 'ok' | 'false' | 'reject',
    storage: null as unknown as PlatformStorage
  };
  fake.storage = {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => {
      fake.calls.push(`get:${keys.join(',')}`);
      if (fake.failRead) throw new Error('read_failed');
      const answer: Record<string, unknown> = {};
      for (const key of keys) if (key in fake.data) answer[key] = JSON.parse(JSON.stringify(fake.data[key]));
      return answer;
    },
    set: (patch) => {
      fake.calls.push(`set:${Object.keys(patch).join(',')}`);
      if (fake.setMode === 'reject') return Promise.reject(new Error('quota'));
      if (fake.setMode === 'false') return Promise.resolve(false);
      Object.assign(fake.data, JSON.parse(JSON.stringify(patch)));
      return Promise.resolve(true);
    },
    clear: async (keys) => {
      for (const key of keys) delete fake.data[key];
    }
  };
  return fake;
}

type Fake = ReturnType<typeof fakeStorage>;
const writes = (fake: Fake) => fake.calls.filter((call) => call.startsWith('set:'));
const livesRecord = (fake: Fake) => (fake.data[CORE_KEY] as Record<string, unknown> | undefined)?.lives;
const stored = (lives: number, regenStart: number | null) => ({ [CORE_KEY]: { lives: { v: 1, lives, regenStart } } });

/** A controllable epoch-ms clock. */
function clock(start = T0) {
  const c = { t: start, now: () => c.t, advance: (ms: number) => (c.t += ms) };
  return c;
}

/** One session: gate + lives loaded, the gate opened (the host applied the game's values). */
async function session(fake: Fake, options: { config?: Partial<LivesConfig>; c?: ReturnType<typeof clock>; open?: boolean } = {}) {
  const c = options.c ?? clock();
  const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
  const lives = new LivesRuntime({ gate, config: { ...CONFIG, ...options.config }, now: c.now });
  const [, loaded] = await Promise.all([gate.load(), lives.load()]);
  if (options.open !== false) gate.open();
  return { gate, lives, loaded, c };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LivesRuntime — config', () => {
  test('the gate and every config number are validated; an unknown config key is refused (a typo in a product rule)', () => {
    const gate = new SaveGate({ storage: fakeStorage().storage, profile: PROFILE });
    const make = (config: unknown) => () => new LivesRuntime({ gate, config: config as LivesConfig });
    expect(() => new LivesRuntime({ gate: {} as never, config: CONFIG })).toThrow(TypeError);
    expect(make(undefined)).toThrow(RangeError);
    for (const bad of [0, -1, 2.5, Number.NaN, '5']) expect(make({ ...CONFIG, maxLives: bad })).toThrow(/maxLives/);
    for (const bad of [0, -60, 1.5, Number.POSITIVE_INFINITY]) expect(make({ ...CONFIG, regenSeconds: bad })).toThrow(/regenSeconds/);
    for (const bad of [-1, 6, 1.5]) expect(make({ ...CONFIG, startLives: bad })).toThrow(/startLives/);
    expect(make({ maxLives: 5, regenSeconds: 1800 })).toThrow(/refundOnWin/);
    expect(make({ ...CONFIG, regenSecond: 60 })).toThrow(/regenSecond/);
    expect(make({ ...CONFIG, startLives: 0 })).not.toThrow();
  });
});

describe('LivesRuntime — load', () => {
  test('1. a fresh player starts at startLives (default maxLives); nothing is written until a change or save() after open()', async () => {
    const fake = fakeStorage();
    const { gate, lives, loaded } = await session(fake, { open: false });
    expect(loaded).toEqual({
      status: 'ready',
      problem: null,
      lives: 5,
      maxLives: 5,
      full: true,
      writable: false,
      canStart: false,
      attemptOpen: false,
      nextLifeAt: null,
      nextLifeInMs: null
    } satisfies LivesSnapshot);
    expect(lives.startAttempt()).toEqual({ ok: false, reason: 'not_open', lives: 5, delta: 0, saved: null });
    expect(lives.save()).toMatchObject({ ok: false, reason: 'not_open' });
    expect(writes(fake)).toEqual([]);
    gate.open();
    expect(lives.snapshot()).toMatchObject({ writable: true, canStart: true });
    const saved = lives.save();
    expect(await saved.saved).toEqual({ ok: true, reason: null });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null });

    // startLives below the cap: the first period starts at the load
    const low = await session(fakeStorage(), { config: { startLives: 2 } });
    expect(low.loaded).toMatchObject({ lives: 2, full: false, nextLifeAt: T0 + PERIOD, nextLifeInMs: PERIOD });
  });

  test('2. saved lives and the running period are restored; a Core record without `lives` is a fresh player', async () => {
    const fake = fakeStorage(stored(2, T0 - 600_000));
    const { lives, loaded } = await session(fake);
    expect(loaded).toMatchObject({ status: 'ready', lives: 2, full: false, canStart: false, nextLifeInMs: PERIOD - 600_000 }); // taken before open()
    expect(lives.snapshot()).toMatchObject({ lives: 2, canStart: true });
    expect(fake.calls).toEqual([`get:trail_state,${CORE_KEY}`]);
    expect(writes(fake)).toEqual([]); // loading never writes

    const other = fakeStorage({ [CORE_KEY]: { wallet: { v: 1, balance: 7, rewardedLevels: [] } } });
    expect((await session(other)).loaded).toMatchObject({ status: 'ready', lives: 5, full: true });
  });

  test('a stored count above the cap (the product lowered maxLives) is clamped to the cap', async () => {
    const { loaded } = await session(fakeStorage(stored(5, null)), { config: { maxLives: 3 } });
    expect(loaded).toMatchObject({ lives: 3, maxLives: 3, full: true, nextLifeInMs: null });
    // the cap raised: the stored full count now regenerates from the load on
    const raised = await session(fakeStorage(stored(5, null)), { config: { maxLives: 7 } });
    expect(raised.loaded).toMatchObject({ lives: 5, maxLives: 7, full: false, nextLifeInMs: PERIOD });
  });

  test('12. a failed Core read or an unknown record → unavailable: lives unknown (null), every change refused, nothing ever written', async () => {
    const failed = fakeStorage(stored(1, T0));
    failed.failRead = true;
    const { lives, loaded } = await session(failed);
    expect(loaded).toMatchObject({ status: 'unavailable', problem: 'read_failed', lives: null, full: false, writable: false, canStart: false, nextLifeInMs: null });
    const refused = { ok: false, reason: 'unavailable', lives: null, delta: 0, saved: null };
    expect(lives.startAttempt()).toEqual(refused);
    expect(lives.grant(1, 'rewarded')).toEqual(refused);
    expect(lives.refill('coins')).toEqual(refused); // no free refill because the cloud read failed
    expect(lives.save()).toEqual(refused);
    expect(lives.endAttempt('win')).toEqual(refused);
    expect(lives.tick()).toMatchObject({ status: 'unavailable', lives: null });
    expect(writes(failed)).toEqual([]);

    for (const bad of [{ v: 2, lives: 3, regenStart: null }, { v: 1, lives: -1, regenStart: null }, { v: 1, lives: 2.5, regenStart: null }, { v: 1, lives: 3, regenStart: 'x' }, { v: 1, lives: 3 }, 'five']) {
      const fake = fakeStorage({ [CORE_KEY]: { lives: bad } });
      const s = await session(fake);
      expect(s.loaded).toMatchObject({ status: 'unavailable', problem: 'invalid_record', lives: null });
      expect(s.lives.refill().reason).toBe('unavailable');
      expect(s.lives.save().reason).toBe('unavailable');
      expect(writes(fake)).toEqual([]);
      expect(livesRecord(fake)).toEqual(bad); // kept as is
    }
  });

  test('11. a reload restores exactly what the last session wrote', async () => {
    const fake = fakeStorage();
    const c = clock();
    const first = await session(fake, { c });
    first.lives.startAttempt();
    first.lives.endAttempt('fail');
    c.advance(60_000);
    first.lives.startAttempt();
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 3, regenStart: T0, attempt: true });
    c.advance(600_000);
    const second = await session(fake, { c });
    expect(second.loaded).toMatchObject({ lives: 3, attemptOpen: false, nextLifeAt: T0 + PERIOD, nextLifeInMs: PERIOD - 660_000 });
  });
});

describe('LivesRuntime — attempts', () => {
  test('3. startAttempt spends one life synchronously, starts the period from full and writes the whole record once', async () => {
    const fake = fakeStorage();
    const { lives } = await session(fake);
    const events: LivesChange[] = [];
    lives.onChange((change) => events.push(change));
    const result = lives.startAttempt();
    expect(result).toMatchObject({ ok: true, reason: null, lives: 4, delta: -1 });
    expect(await result.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0, attempt: true });
    expect(events).toEqual([{ kind: 'spend', delta: -1, lives: 4, maxLives: 5 }]);
    expect(lives.snapshot()).toMatchObject({ lives: 4, attemptOpen: true, nextLifeInMs: PERIOD });
  });

  test('a spend below the cap keeps the running period (the timer is not restarted)', async () => {
    const fake = fakeStorage(stored(3, T0 - 1_000_000));
    const { lives } = await session(fake);
    lives.startAttempt();
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 2, regenStart: T0 - 1_000_000, attempt: true });
    expect(lives.snapshot().nextLifeInMs).toBe(PERIOD - 1_000_000);
  });

  test('4. zero lives: canStart is false and a new attempt is refused (no_lives) without a write', async () => {
    const fake = fakeStorage(stored(1, T0));
    const { lives } = await session(fake);
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 0 });
    expect(lives.endAttempt('fail')).toMatchObject({ ok: true, lives: 0, delta: 0 });
    const before = writes(fake).length;
    expect(lives.snapshot()).toMatchObject({ lives: 0, canStart: false, full: false, nextLifeInMs: PERIOD });
    expect(lives.startAttempt()).toEqual({ ok: false, reason: 'no_lives', lives: 0, delta: 0, saved: null });
    expect(writes(fake).length).toBe(before);
  });

  test('win returns the life under refundOnWin (capped); fail and exit return nothing; refundOnWin false never refunds', async () => {
    const fake = fakeStorage();
    const { lives } = await session(fake);
    lives.startAttempt();
    const win = lives.endAttempt('win');
    expect(win).toMatchObject({ ok: true, lives: 5, delta: 1 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null }); // back at the cap: no period runs
    lives.startAttempt();
    expect(lives.endAttempt('fail')).toMatchObject({ ok: true, lives: 4, delta: 0 }); // V1.1: the close is written (see R3)
    lives.startAttempt();
    expect(lives.endAttempt('exit')).toMatchObject({ ok: true, lives: 3, delta: 0 });

    const noRefund = await session(fakeStorage(), { config: { refundOnWin: false } });
    noRefund.lives.startAttempt();
    expect(noRefund.lives.endAttempt('win')).toMatchObject({ ok: true, lives: 4, delta: 0 });
    expect(() => lives.endAttempt('lose' as never)).toThrow(TypeError);
  });

  test('a win refund that finds the lives at the cap (regenerated or granted meanwhile) adds nothing', async () => {
    const { lives } = await session(fakeStorage());
    lives.startAttempt();
    lives.grant(1, 'rewarded');
    expect(lives.endAttempt('win')).toMatchObject({ ok: true, lives: 5, delta: 0 });
  });

  test('15. a repeated start is one spend, a repeated end is one refund; a restart is end + start = a new spend', async () => {
    const fake = fakeStorage();
    const { lives } = await session(fake);
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 4, delta: -1 });
    expect(lives.startAttempt()).toEqual({ ok: true, reason: null, lives: 4, delta: 0, saved: null });
    expect(writes(fake).length).toBe(1);
    // restart: the running attempt ends (no refund for a fail / exit), the new one pays
    expect(lives.endAttempt('exit')).toMatchObject({ ok: true, delta: 0 });
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 3, delta: -1 });
    expect(lives.endAttempt('win')).toMatchObject({ ok: true, lives: 4, delta: 1 });
    expect(lives.endAttempt('win')).toEqual({ ok: false, reason: 'no_attempt', lives: 4, delta: 0, saved: null });
    expect(lives.endAttempt('fail').reason).toBe('no_attempt');
  });

  test('after a reload a NEW attempt (startAttempt, not resumeAttempt) pays again — no free re-entry', async () => {
    const fake = fakeStorage();
    const c = clock();
    const first = await session(fake, { c });
    first.lives.startAttempt();
    const second = await session(fake, { c });
    expect(second.loaded).toMatchObject({ lives: 4, attemptOpen: false });
    expect(second.lives.endAttempt('win').reason).toBe('no_attempt');
    expect(second.lives.startAttempt()).toMatchObject({ ok: true, lives: 3, delta: -1 });
  });
});

describe('LivesRuntime — grants and refill', () => {
  test('5 / 6. grant adds up to the cap and reports what it really added; amounts are integers ≥ 0', async () => {
    const fake = fakeStorage(stored(3, T0));
    const { lives } = await session(fake);
    const events: LivesChange[] = [];
    lives.onChange((change) => events.push(change));
    expect(lives.grant(1, 'rewarded')).toMatchObject({ ok: true, lives: 4, delta: 1 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0 });
    expect(lives.grant(3, 'purchase')).toMatchObject({ ok: true, lives: 5, delta: 1 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null });
    const before = writes(fake).length;
    expect(lives.grant(1, 'rewarded')).toEqual({ ok: true, reason: null, lives: 5, delta: 0, saved: null });
    expect(lives.grant(0)).toMatchObject({ ok: true, delta: 0, saved: null });
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      expect(lives.grant(bad as number)).toEqual({ ok: false, reason: 'invalid_amount', lives: 5, delta: 0, saved: null });
    }
    expect(writes(fake).length).toBe(before);
    expect(events).toEqual([
      { kind: 'grant', delta: 1, lives: 4, maxLives: 5, source: 'rewarded' },
      { kind: 'grant', delta: 1, lives: 5, maxLives: 5, source: 'purchase' }
    ]);
  });

  test('7. refill sets the cap and stops the period; at the cap it is refused (full) so the host charges nothing', async () => {
    const fake = fakeStorage(stored(1, T0 - 5_000));
    const { lives } = await session(fake);
    const events: LivesChange[] = [];
    lives.onChange((change) => events.push(change));
    expect(lives.refill('coins')).toMatchObject({ ok: true, lives: 5, delta: 4 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null });
    expect(lives.snapshot()).toMatchObject({ full: true, nextLifeInMs: null });
    const before = writes(fake).length;
    expect(lives.refill('coins')).toEqual({ ok: false, reason: 'full', lives: 5, delta: 0, saved: null });
    expect(writes(fake).length).toBe(before);
    expect(events).toEqual([{ kind: 'refill', delta: 4, lives: 5, maxLives: 5, source: 'coins' }]);
  });
});

describe('LivesRuntime — regeneration by timestamps', () => {
  test('8. one period gives one life; the unused remainder of a period is carried, never lost', async () => {
    const fake = fakeStorage(stored(3, T0));
    const c = clock();
    const { lives } = await session(fake, { c });
    c.advance(PERIOD - 1000);
    expect(lives.snapshot()).toMatchObject({ lives: 3, nextLifeInMs: 1000 });
    c.advance(1000);
    expect(lives.snapshot()).toMatchObject({ lives: 4, nextLifeAt: T0 + 2 * PERIOD, nextLifeInMs: PERIOD });
    c.advance(200_000);
    expect(lives.snapshot()).toMatchObject({ lives: 4, nextLifeInMs: PERIOD - 200_000 });
    lives.startAttempt(); // a spend below the cap keeps the carried period
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 3, regenStart: T0 + PERIOD, attempt: true });
  });

  test('9. several periods offline are counted on load, deterministically, with the remainder carried', async () => {
    const c = clock(T0 + 2.5 * PERIOD);
    const { loaded } = await session(fakeStorage(stored(1, T0)), { c });
    expect(loaded).toMatchObject({ lives: 3, nextLifeAt: T0 + 3 * PERIOD, nextLifeInMs: 0.5 * PERIOD });
    // the same stored state and the same time give the same answer, however often it is read
    const again = await session(fakeStorage(stored(1, T0)), { c: clock(T0 + 2.5 * PERIOD) });
    expect(again.loaded).toEqual(loaded);
  });

  test('10. at the cap nothing accumulates: a long wait gives no extra life and the next spend starts a full period', async () => {
    const fake = fakeStorage(stored(4, T0));
    const c = clock();
    const { lives } = await session(fake, { c });
    c.advance(PERIOD);
    expect(lives.snapshot()).toMatchObject({ lives: 5, full: true, nextLifeAt: null, nextLifeInMs: null });
    c.advance(10 * PERIOD);
    expect(lives.snapshot()).toMatchObject({ lives: 5, full: true });
    lives.startAttempt();
    expect(lives.snapshot()).toMatchObject({ lives: 4, nextLifeAt: c.t + PERIOD, nextLifeInMs: PERIOD });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: c.t, attempt: true });

    // a very long offline from zero: capped, no overflow
    const year = await session(fakeStorage(stored(0, T0)), { c: clock(T0 + 365 * 24 * 3600 * 1000) });
    expect(year.loaded).toMatchObject({ lives: 5, full: true, nextLifeInMs: null });
  });

  test('14. clock edges: the same timestamp changes nothing; a clock moved back never takes a life and never freezes the timer', async () => {
    const fake = fakeStorage(stored(2, T0));
    const c = clock();
    const { lives } = await session(fake, { c });
    expect(lives.snapshot()).toMatchObject({ lives: 2, nextLifeInMs: PERIOD });
    expect(lives.snapshot()).toMatchObject({ lives: 2, nextLifeInMs: PERIOD });

    c.advance(-3 * PERIOD); // the device clock jumps back 1.5 h
    expect(lives.snapshot()).toMatchObject({ lives: 2, nextLifeAt: c.t + PERIOD, nextLifeInMs: PERIOD });
    const tick = lives.tick(); // tick persists the re-anchored period
    expect(tick).toMatchObject({ lives: 2 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 2, regenStart: c.t });
    c.advance(PERIOD);
    expect(lives.snapshot()).toMatchObject({ lives: 3 });

    // a stamp from the future in the save (written by a clock that ran ahead) is re-anchored at load
    const future = await session(fakeStorage(stored(2, T0 + 30 * 24 * 3600 * 1000)), { c: clock() });
    expect(future.loaded).toMatchObject({ lives: 2, nextLifeInMs: PERIOD });

    // a broken clock (NaN) regenerates nothing and throws nothing
    const broken = { t: Number.NaN, now: () => Number.NaN, advance: () => 0 };
    const nan = await session(fakeStorage(stored(2, T0)), { c: broken as never });
    expect(nan.loaded).toMatchObject({ lives: 2, status: 'ready' });
    expect(nan.lives.startAttempt()).toMatchObject({ ok: true, lives: 1 });
  });

  test('tick() reports each regenerated life once (listeners) and writes it; snapshot() applies time without writing', async () => {
    const fake = fakeStorage(stored(2, T0));
    const c = clock();
    const { lives } = await session(fake, { c });
    const events: LivesChange[] = [];
    lives.onChange((change) => events.push(change));
    c.advance(2 * PERIOD + 10);
    expect(lives.snapshot().lives).toBe(4);
    expect(writes(fake)).toEqual([]);
    lives.tick();
    lives.tick();
    expect(events).toEqual([{ kind: 'regen', delta: 2, lives: 4, maxLives: 5 }]);
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0 + 2 * PERIOD });
    lives.tick();
    expect(writes(fake).length).toBe(1); // nothing new → no write
  });

  test('the runtime owns no timer: time is read from the injected clock only', async () => {
    vi.useFakeTimers();
    const { lives, c } = await session(fakeStorage(stored(1, T0)));
    lives.startAttempt();
    c.advance(PERIOD);
    lives.tick();
    lives.grant(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('LivesRuntime — writes, listeners, dispose', () => {
  test('13. a failed write keeps the change in memory and is carried by the next write; a reload sees the last successful one', async () => {
    const fake = fakeStorage();
    const c = clock();
    const { lives } = await session(fake, { c });
    fake.setMode = 'false';
    const spend = lives.startAttempt();
    expect(spend).toMatchObject({ ok: true, lives: 4 });
    expect(await spend.saved).toEqual({ ok: false, reason: 'storage_refused' });
    expect(livesRecord(fake)).toBeUndefined();
    fake.setMode = 'reject';
    const second = lives.grant(0);
    expect(second.saved).toBeNull();
    const refused = lives.save();
    expect(await refused.saved).toMatchObject({ ok: false, reason: 'storage_rejected' });

    // the reload before any successful write sees the stored state (the lost spend favours the player)
    expect((await session(fake, { c })).loaded).toMatchObject({ lives: 5 });

    fake.setMode = 'ok';
    const retry = lives.save();
    expect(await retry.saved).toEqual({ ok: true, reason: null });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0, attempt: true });
  });

  test('16. listeners: subscription order, unsubscribe, a throwing listener lands in onListenerError; dispose drops them and refuses changes', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const errors: unknown[] = [];
    const c = clock();
    const lives = new LivesRuntime({ gate, config: CONFIG, now: c.now, onListenerError: (error) => errors.push(error) });
    await Promise.all([gate.load(), lives.load()]);
    gate.open();
    const order: string[] = [];
    const off = lives.onChange((change) => order.push(`a:${change.kind}`));
    lives.onChange(() => {
      throw new Error('boom');
    });
    lives.onChange((change) => order.push(`c:${change.kind}`));
    lives.startAttempt();
    expect(order).toEqual(['a:spend', 'c:spend']);
    expect(errors).toHaveLength(1);
    expect(lives.snapshot().lives).toBe(4); // the change stands
    off();
    lives.endAttempt('win');
    expect(order).toEqual(['a:spend', 'c:spend', 'c:refund']);
    expect(() => lives.onChange(null as never)).toThrow(TypeError);

    lives.dispose();
    const disposed = { ok: false, reason: 'disposed', lives: 5, delta: 0, saved: null };
    expect(lives.startAttempt()).toEqual(disposed);
    expect(lives.grant(1)).toEqual(disposed);
    expect(lives.save()).toEqual(disposed);
    expect(lives.snapshot()).toMatchObject({ writable: false, canStart: false, lives: 5 });
    const writesBefore = writes(fake).length;
    lives.tick();
    expect(writes(fake).length).toBe(writesBefore);
    expect(order).toEqual(['a:spend', 'c:spend', 'c:refund']);
    lives.dispose(); // idempotent
  });

  test('before load: idle, nothing known, every change refused as not_loaded', () => {
    const gate = new SaveGate({ storage: fakeStorage().storage, profile: PROFILE });
    const lives = new LivesRuntime({ gate, config: CONFIG });
    expect(lives.snapshot()).toMatchObject({ status: 'idle', lives: null, maxLives: 5, canStart: false, writable: false });
    expect(lives.startAttempt()).toEqual({ ok: false, reason: 'not_loaded', lives: null, delta: 0, saved: null });
    expect(lives.load()).toBe(lives.load());
  });
});

describe('LivesRuntime — Ready UI and neighbours', () => {
  test('17. the snapshot feeds HudView and LivesWindowView params as is (formatTimer from game-core/pixi)', async () => {
    const { lives, c } = await session(fakeStorage(stored(3, T0)));
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onLivesTap: () => {} });
    const badge = (hud as unknown as { lives: { countText: { text: string }; capsuleText: { text: string } } }).lives;
    const bind = (s: LivesSnapshot) => {
      hud.setMaxLives(s.maxLives);
      hud.setLives(s.lives ?? 0, s.nextLifeInMs === null ? '' : formatTimer(Math.ceil(s.nextLifeInMs / 1000)));
    };
    c.advance(1000);
    bind(lives.snapshot());
    expect(hud.livesAmount).toBe(3);
    expect(badge.countText.text).toBe('3');
    expect(badge.capsuleText.text).toBe('29:59');
    lives.refill('coins');
    bind(lives.snapshot());
    expect(badge.capsuleText.text).toBe('MAX');
    const s = lives.snapshot();
    // LivesWindowParams: { lives, maxLives, timerText, refillPrice (host), adOffer (host) }
    expect({ lives: s.lives, maxLives: s.maxLives }).toEqual({ lives: 5, maxLives: 5 });
    hud.destroy();
  });

  test('18. lives and the wallet share the one Core record of the gate without overwriting each other', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    const lives = new LivesRuntime({ gate, config: CONFIG, now: () => T0 });
    await Promise.all([gate.load(), wallet.load(), lives.load()]);
    gate.open();
    await wallet.grant(20, { source: 'purchase' }).saved;
    await lives.startAttempt().saved;
    await wallet.trySpend(5).saved;
    expect(fake.data[CORE_KEY]).toEqual({
      wallet: { v: 1, balance: 115, rewardedLevels: [] },
      lives: { v: 1, lives: 4, regenStart: T0, attempt: true }
    });
    expect(Object.keys(fake.data)).toEqual([CORE_KEY]); // no second namespace, no game key touched
  });
});

// V1.1 — one logical attempt = one life: the open attempt is durable (`attempt: true` in the same record,
// written with the spend) and a gameplay that restored its unfinished run resumes it instead of paying again.
describe('LivesRuntime — durable attempt resume (V1.1)', () => {
  /** A process death: the runtime and its gate are gone, a new session loads the same storage. */
  const reload = (fake: Fake, c: ReturnType<typeof clock>) => session(fake, { c });

  test('R1. start → reload → resume: no second spend, the attempt is open again, resume writes nothing', async () => {
    const fake = fakeStorage();
    const c = clock();
    const first = await session(fake, { c });
    const start = first.lives.startAttempt();
    expect(start).toMatchObject({ ok: true, lives: 4, delta: -1 });
    expect(await start.saved).toEqual({ ok: true, reason: null }); // spend + open: ONE durable write
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0, attempt: true });

    const second = await reload(fake, c);
    expect(second.loaded).toMatchObject({ lives: 4, attemptOpen: false }); // durable, not yet claimed by this session
    expect(second.lives.resumeAttempt()).toEqual({ ok: true, reason: null, lives: 4, delta: 0, saved: null });
    expect(second.lives.snapshot()).toMatchObject({ lives: 4, attemptOpen: true });
    expect(writes(fake)).toHaveLength(1);
  });

  test('R2. resume → win refunds once and closes the attempt in the same durable write', async () => {
    const fake = fakeStorage();
    const c = clock();
    (await session(fake, { c })).lives.startAttempt();
    const { lives } = await reload(fake, c);
    lives.resumeAttempt();
    const win = lives.endAttempt('win');
    expect(win).toMatchObject({ ok: true, lives: 5, delta: 1 });
    expect(await win.saved).toEqual({ ok: true, reason: null });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null });
    expect(lives.endAttempt('win')).toMatchObject({ ok: false, reason: 'no_attempt', lives: 5 });
    expect((await reload(fake, c)).lives.resumeAttempt()).toMatchObject({ ok: false, reason: 'no_attempt', lives: 5 });
  });

  test('R3 / R4. resume → fail or exit: no refund, the close is durable', async () => {
    for (const outcome of ['fail', 'exit'] as const) {
      const fake = fakeStorage();
      const c = clock();
      (await session(fake, { c })).lives.startAttempt();
      const { lives } = await reload(fake, c);
      expect(lives.resumeAttempt().ok).toBe(true);
      const end = lives.endAttempt(outcome);
      expect(end).toMatchObject({ ok: true, lives: 4, delta: 0 });
      expect(await end.saved).toEqual({ ok: true, reason: null });
      expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0 });
      expect((await reload(fake, c)).lives.resumeAttempt().reason).toBe('no_attempt');
    }
  });

  test('R5. a restart costs exactly one new life — in the session (end + start) and after a reload (start instead of resume)', async () => {
    const fake = fakeStorage();
    const c = clock();
    const { lives } = await session(fake, { c });
    lives.startAttempt();
    expect(lives.endAttempt('exit')).toMatchObject({ ok: true, delta: 0 });
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 3, delta: -1 });

    // after a reload the gameplay did NOT restore the run (a fresh board): the durable attempt is abandoned,
    // startAttempt closes it (no refund) and pays the new one — one write, the record stays open for the new run
    const second = await reload(fake, c);
    const before = writes(fake).length;
    expect(second.lives.startAttempt()).toMatchObject({ ok: true, lives: 2, delta: -1 });
    expect(writes(fake).length).toBe(before + 1);
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 2, regenStart: T0, attempt: true });
    expect(second.lives.resumeAttempt()).toMatchObject({ ok: true, delta: 0 }); // the NEW attempt is the open one
    expect(second.lives.endAttempt('win')).toMatchObject({ ok: true, lives: 3, delta: 1 });
  });

  test('R6. repeated resume is idempotent; start after resume is the same attempt (no spend)', async () => {
    const fake = fakeStorage();
    const c = clock();
    (await session(fake, { c })).lives.startAttempt();
    const { lives } = await reload(fake, c);
    const events: LivesChange[] = [];
    lives.onChange((change) => events.push(change));
    for (let i = 0; i < 3; i++) expect(lives.resumeAttempt()).toEqual({ ok: true, reason: null, lives: 4, delta: 0, saved: null });
    expect(lives.startAttempt()).toEqual({ ok: true, reason: null, lives: 4, delta: 0, saved: null });
    expect(events).toEqual([]);
    expect(writes(fake)).toHaveLength(1); // only the first session's spend
  });

  test('R7. repeated end is idempotent: one refund, one close write', async () => {
    const fake = fakeStorage();
    const c = clock();
    (await session(fake, { c })).lives.startAttempt();
    const { lives } = await reload(fake, c);
    lives.resumeAttempt();
    expect(lives.endAttempt('win')).toMatchObject({ ok: true, delta: 1 });
    const after = writes(fake).length;
    for (const outcome of ['win', 'fail', 'exit'] as const) {
      expect(lives.endAttempt(outcome)).toEqual({ ok: false, reason: 'no_attempt', lives: 5, delta: 0, saved: null });
    }
    expect(writes(fake).length).toBe(after);
  });

  test('R8. crash after a durable start: every later session can resume it, none pays again, until it ends', async () => {
    const fake = fakeStorage();
    const c = clock();
    await (await session(fake, { c })).lives.startAttempt().saved;
    for (let i = 0; i < 3; i++) {
      c.advance(1000);
      const s = await reload(fake, c); // crash again before any end
      expect(s.lives.resumeAttempt()).toMatchObject({ ok: true, lives: 4, delta: 0 });
    }
    const last = await reload(fake, c);
    last.lives.resumeAttempt();
    expect(last.lives.endAttempt('fail')).toMatchObject({ ok: true, lives: 4 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0 });
  });

  test('R9. crash after a durable end: nothing to resume, the next attempt pays normally', async () => {
    const fake = fakeStorage();
    const c = clock();
    const first = await session(fake, { c });
    first.lives.startAttempt();
    await first.lives.endAttempt('fail').saved;
    const { lives } = await reload(fake, c);
    expect(lives.resumeAttempt()).toMatchObject({ ok: false, reason: 'no_attempt', lives: 4 });
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 3, delta: -1 });
  });

  test('R10. an old V1 record without attempt state loads as closed; a malformed attempt field is an invalid record', async () => {
    const old = fakeStorage(stored(3, T0));
    const { lives, loaded } = await session(old);
    expect(loaded).toMatchObject({ status: 'ready', lives: 3, attemptOpen: false });
    expect(lives.resumeAttempt()).toMatchObject({ ok: false, reason: 'no_attempt', lives: 3 });
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 2, delta: -1 });
    expect(livesRecord(old)).toEqual({ v: 1, lives: 2, regenStart: T0, attempt: true });

    for (const attempt of ['yes', 1, null, {}]) {
      const fake = fakeStorage({ [CORE_KEY]: { lives: { v: 1, lives: 3, regenStart: T0, attempt } } });
      const s = await session(fake);
      expect(s.loaded).toMatchObject({ status: 'unavailable', problem: 'invalid_record' });
      expect(s.lives.resumeAttempt().reason).toBe('unavailable');
      expect(writes(fake)).toEqual([]);
    }
    // refusals before load / before open
    const gate = new SaveGate({ storage: fakeStorage().storage, profile: PROFILE });
    expect(new LivesRuntime({ gate, config: CONFIG }).resumeAttempt().reason).toBe('not_loaded');
    const closed = await session(fakeStorage(), { open: false });
    expect(closed.lives.resumeAttempt().reason).toBe('not_open');
  });

  test('R11. zero lives: the last life\'s attempt resumes at 0 (resuming costs nothing); after its end a new one is refused', async () => {
    const fake = fakeStorage(stored(1, T0));
    const c = clock();
    (await session(fake, { c })).lives.startAttempt();
    const { lives } = await reload(fake, c);
    expect(lives.snapshot()).toMatchObject({ lives: 0, canStart: false });
    expect(lives.resumeAttempt()).toMatchObject({ ok: true, lives: 0, delta: 0 });
    lives.endAttempt('fail');
    expect(lives.startAttempt()).toMatchObject({ ok: false, reason: 'no_lives', lives: 0 });

    // a durable attempt left open at 0 lives is abandoned by a new start only when a life is there to pay it
    const open = fakeStorage({ [CORE_KEY]: { lives: { v: 1, lives: 0, regenStart: T0, attempt: true } } });
    const s = await session(open, { c: clock() });
    expect(s.lives.startAttempt()).toMatchObject({ ok: false, reason: 'no_lives' });
    expect(s.lives.resumeAttempt()).toMatchObject({ ok: true, lives: 0 });
  });

  test('R12. regeneration runs while an attempt is open, across a reload; the win refund is capped', async () => {
    const fake = fakeStorage();
    const c = clock();
    (await session(fake, { c })).lives.startAttempt(); // 5 → 4, the period starts at T0
    c.advance(PERIOD / 2);
    const mid = await reload(fake, c);
    mid.lives.resumeAttempt();
    c.advance(PERIOD / 2);
    mid.lives.tick(); // the regenerated life is written WITH the open attempt
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null, attempt: true });

    const { lives } = await reload(fake, c);
    expect(lives.resumeAttempt()).toMatchObject({ ok: true, lives: 5 });
    const win = lives.endAttempt('win');
    expect(win).toMatchObject({ ok: true, lives: 5, delta: 0 });
    expect(await win.saved).toEqual({ ok: true, reason: null }); // the close is written even without a refund
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null });
  });

  test('R13. a start whose write failed is not durable: after a reload there is nothing to resume and the new start pays once', async () => {
    const fake = fakeStorage();
    const c = clock();
    const first = await session(fake, { c });
    fake.setMode = 'false';
    const start = first.lives.startAttempt();
    expect(start).toMatchObject({ ok: true, lives: 4 }); // the session plays on…
    expect(await start.saved).toEqual({ ok: false, reason: 'storage_refused' }); // …but the attempt is NOT durable
    expect(livesRecord(fake)).toBeUndefined();

    fake.setMode = 'ok';
    const { lives } = await reload(fake, c);
    expect(lives.resumeAttempt()).toMatchObject({ ok: false, reason: 'no_attempt', lives: 5 });
    expect(lives.startAttempt()).toMatchObject({ ok: true, lives: 4, delta: -1 }); // one durable spend in total
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0, attempt: true });
  });

  test('R14. an end whose write failed: the reload sees the attempt still open (resume → end again); save() carries the close', async () => {
    const fake = fakeStorage();
    const c = clock();
    const first = await session(fake, { c });
    await first.lives.startAttempt().saved;
    fake.setMode = 'reject';
    const end = first.lives.endAttempt('win');
    expect(end).toMatchObject({ ok: true, lives: 5, delta: 1 });
    expect(await end.saved).toMatchObject({ ok: false, reason: 'storage_rejected' });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 4, regenStart: T0, attempt: true }); // the last durable state

    fake.setMode = 'ok';
    const crashed = await reload(fake, c); // crash before any retry: the run is still resumable, ends once
    expect(crashed.lives.resumeAttempt()).toMatchObject({ ok: true, lives: 4 });
    expect(crashed.lives.endAttempt('win')).toMatchObject({ ok: true, lives: 5, delta: 1 });
    expect(livesRecord(fake)).toEqual({ v: 1, lives: 5, regenStart: null });

    // or, without the crash: save() retries the whole closed record
    const other = fakeStorage();
    const s = await session(other, { c });
    s.lives.startAttempt();
    other.setMode = 'false';
    s.lives.endAttempt('fail');
    other.setMode = 'ok';
    expect(await s.lives.save().saved).toEqual({ ok: true, reason: null });
    expect(livesRecord(other)).toEqual({ v: 1, lives: 4, regenStart: T0 });
  });
});
