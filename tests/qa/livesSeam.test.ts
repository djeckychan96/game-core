import { describe, expect, test } from 'vitest';
import { LivesRuntime, SaveGate } from '../../src/index';
import type { GameProductionProfile, LivesChange, LivesConfig, PlatformStorage } from '../../src/index';
import { QA_LIVES_SOURCE, QaRuntime, createLivesQaCapability, setQaLives } from '../../src/qa';

type GateProfile = Pick<GameProductionProfile, 'id' | 'save' | 'economy'>;
const PROFILE: GateProfile = { id: 'game', save: { keys: ['game_state'] }, economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0 } } };
const CORE_KEY = 'game.core';
const CONFIG: LivesConfig = { maxLives: 5, regenSeconds: 1800, refundOnWin: true };
const PERIOD = 1800 * 1000;
const T0 = 1_727_000_000_000;

function fakeStorage(initial: Record<string, unknown> = {}) {
  const fake = { data: JSON.parse(JSON.stringify(initial)) as Record<string, unknown>, sets: 0, failRead: false, refuse: false, storage: null as unknown as PlatformStorage };
  fake.storage = {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => {
      if (fake.failRead) throw new Error('read_failed');
      const answer: Record<string, unknown> = {};
      for (const key of keys) if (key in fake.data) answer[key] = JSON.parse(JSON.stringify(fake.data[key]));
      return answer;
    },
    set: (patch) => {
      fake.sets += 1;
      if (fake.refuse) return Promise.resolve(false);
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
const record = (fake: Fake) => (fake.data[CORE_KEY] as Record<string, unknown> | undefined)?.lives as Record<string, unknown> | undefined;
const stored = (lives: number, regenStart: number | null, attempt?: boolean) => ({ [CORE_KEY]: { lives: { v: 1, lives, regenStart, ...(attempt ? { attempt } : {}) } } });

async function session(fake: Fake, open = true) {
  const c = { t: T0, now: () => c.t };
  const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
  const lives = new LivesRuntime({ gate, config: CONFIG, now: c.now });
  await Promise.all([gate.load(), lives.load()]);
  if (open) gate.open();
  const changes: LivesChange[] = [];
  lives.onChange((change) => changes.push(change));
  return { gate, lives, c, changes };
}

describe('QA lives seam — set through the public API only', () => {
  test('raise = one capped grant with the seam source; the record is the runtime own shape', async () => {
    const fake = fakeStorage(stored(2, T0));
    const { lives, changes } = await session(fake);
    const result = await setQaLives(lives, 5);
    expect(result).toEqual({ from: 2, lives: 5, maxLives: 5, attempt: 'closed', writes: 1, saved: true });
    expect(changes).toEqual([{ kind: 'grant', delta: 3, lives: 5, maxLives: 5, source: QA_LIVES_SOURCE }]);
    expect(record(fake)).toEqual({ v: 1, lives: 5, regenStart: null });
  });

  test('lower with nothing open: paid-and-closed attempts, no attempt left open, the period starts at the first spend', async () => {
    const fake = fakeStorage();
    const { lives, c } = await session(fake);
    c.t = T0 + 1234;
    const result = await setQaLives(lives, 1);
    expect(result).toMatchObject({ from: 5, lives: 1, attempt: 'closed', writes: 8, saved: true });
    expect(record(fake)).toEqual({ v: 1, lives: 1, regenStart: T0 + 1234 });
    expect(lives.snapshot()).toMatchObject({ lives: 1, attemptOpen: false, nextLifeAt: T0 + 1234 + PERIOD });
    expect((await setQaLives(lives, 0)).lives).toBe(0);
    expect(lives.snapshot().canStart).toBe(false);
    expect((await setQaLives(lives, 5)).lives).toBe(5);
    expect(record(fake)).toEqual({ v: 1, lives: 5, regenStart: null });
  });

  test('a running regeneration period is kept when the count moves below the cap', async () => {
    const fake = fakeStorage(stored(3, T0 - 60_000));
    const { lives } = await session(fake);
    await setQaLives(lives, 2);
    expect(record(fake)).toEqual({ v: 1, lives: 2, regenStart: T0 - 60_000 });
    await setQaLives(lives, 4);
    expect(record(fake)).toEqual({ v: 1, lives: 4, regenStart: T0 - 60_000 });
  });

  test('this session open attempt stays open (win still refunds, fail still ends it) and the target is exact', async () => {
    const fake = fakeStorage();
    const { lives } = await session(fake);
    lives.startAttempt(); // 4, open
    const result = await setQaLives(lives, 1);
    expect(result).toMatchObject({ from: 4, lives: 1, attempt: 'open' });
    expect(lives.snapshot().attemptOpen).toBe(true);
    expect(record(fake)).toMatchObject({ lives: 1, attempt: true });
    expect(lives.endAttempt('win')).toMatchObject({ ok: true, lives: 2, delta: 1 });
    lives.startAttempt(); // 1, open
    expect((await setQaLives(lives, 0)).attempt).toBe('open');
    expect(lives.snapshot()).toMatchObject({ lives: 0, attemptOpen: true });
    expect(lives.endAttempt('fail')).toMatchObject({ ok: true, lives: 0 });
    expect(record(fake)).toEqual({ v: 1, lives: 0, regenStart: expect.any(Number) });
  });

  test('a raise keeps the open attempt without closing it', async () => {
    const fake = fakeStorage();
    const { lives } = await session(fake);
    lives.startAttempt();
    await setQaLives(lives, 1);
    const result = await setQaLives(lives, 5);
    expect(result).toMatchObject({ from: 1, lives: 5, attempt: 'open', writes: 1 });
    expect(record(fake)).toEqual({ v: 1, lives: 5, regenStart: null, attempt: true });
  });

  test('a stored attempt not resumed: a raise keeps it pending, a lower adopts it (never abandoned, never paid twice)', async () => {
    const fake = fakeStorage(stored(3, T0, true));
    const first = await session(fake);
    await setQaLives(first.lives, 4);
    expect(first.lives.snapshot().attemptOpen).toBe(false);
    expect(record(fake)).toMatchObject({ lives: 4, attempt: true });
    const result = await setQaLives(first.lives, 1);
    expect(result).toMatchObject({ lives: 1, attempt: 'adopted' });
    expect(record(fake)).toMatchObject({ lives: 1, attempt: true });
    expect(first.lives.resumeAttempt()).toMatchObject({ ok: true, lives: 1, delta: 0 }); // the restored run: no spend
    // a reload reads the same open attempt
    const second = await session(fake);
    expect(second.lives.resumeAttempt()).toMatchObject({ ok: true, lives: 1, delta: 0 });
  });

  test('refusals change and write nothing', async () => {
    const fake = fakeStorage(stored(3, T0));
    const { lives } = await session(fake);
    const sets = fake.sets;
    for (const bad of [-1, 6, 1.5, Number.NaN]) await expect(setQaLives(lives, bad)).rejects.toThrow(/0…5/);
    expect(fake.sets).toBe(sets);
    const closed = await session(fakeStorage(stored(3, T0)), false);
    await expect(setQaLives(closed.lives, 1)).rejects.toThrow(/not writable \(ready\)/);
    const failed = fakeStorage(stored(3, T0));
    failed.failRead = true;
    const unavailable = await session(failed);
    await expect(setQaLives(unavailable.lives, 1)).rejects.toThrow(/not writable \(unavailable \/ read_failed\)/);
    lives.dispose();
    await expect(setQaLives(lives, 1)).rejects.toThrow(/not writable/);
  });

  test('an unconfirmed save (QA OFFLINE) keeps the memory and answers saved:false', async () => {
    const fake = fakeStorage(stored(3, T0));
    const { lives } = await session(fake);
    fake.refuse = true;
    expect(await setQaLives(lives, 1)).toMatchObject({ lives: 1, saved: false });
    expect(lives.snapshot().lives).toBe(1);
  });

  test('the standard capability goes through the ONE command registry', async () => {
    const fake = fakeStorage();
    const { lives } = await session(fake);
    const qa = new QaRuntime({ capabilities: [createLivesQaCapability(lives)], globalName: false });
    expect(qa.listCapabilities()[0]).toMatchObject({ id: 'lives', kind: 'number', min: 0, max: 5, commands: ['lives.set'] });
    expect(await qa.run('lives.set', { value: 1 })).toEqual({ ok: true, command: 'lives.set', value: 1 });
    expect(qa.getState().values.lives).toBe(1);
    expect(await qa.run('lives.set', { value: 7 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    lives.dispose();
    expect(await qa.run('lives.set', { value: 2 })).toMatchObject({ ok: false, error: { code: 'failed' } });
  });
});
