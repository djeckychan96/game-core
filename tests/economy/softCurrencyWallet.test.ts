import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformRuntime, PurchaseRuntime, SaveGate, SoftCurrencyWallet, createDevPlatform, createGrantedPurchaseStore } from '../../src/index';
import type { CoreSoftCurrencyProfile, GameProductionProfile, GameplayLevelResult, PlatformStorage, SoftCurrencyChange } from '../../src/index';

type WalletProfile = Pick<GameProductionProfile, 'id' | 'save' | 'economy'>;

/** Gorodki-shaped: two read groups, the Core record rides with the progress. The reward numbers are test values. */
function profile(currency: Partial<CoreSoftCurrencyProfile> = {}): WalletProfile {
  return {
    id: 'gorodki',
    save: {
      keys: ['gorodki-progress-v2', 'gorodki-background-v2'],
      groups: [['gorodki-progress-v2'], ['gorodki-background-v2']]
    },
    economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 50, ...currency } }
  };
}

const CORE_KEY = 'gorodki.core';

/** A PlatformStorage over a plain object with scripted failures; every call is journaled. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const fake = {
    data: JSON.parse(JSON.stringify(initial)) as Record<string, unknown>,
    calls: [] as string[],
    failingKeys: new Set<string>(),
    setMode: 'ok' as 'ok' | 'false' | 'reject',
    storage: null as unknown as PlatformStorage
  };
  fake.storage = {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => {
      fake.calls.push(`get:${keys.join(',')}`);
      if (keys.some((key) => fake.failingKeys.has(key))) throw new Error('read_failed');
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

const writes = (fake: ReturnType<typeof fakeStorage>) => fake.calls.filter((call) => call.startsWith('set:'));
const walletRecord = (fake: ReturnType<typeof fakeStorage>) => (fake.data[CORE_KEY] as Record<string, unknown> | undefined)?.wallet;

/** One session: gate + wallet loaded, the gate opened (the host applied the game's values). */
async function session(fake: ReturnType<typeof fakeStorage>, p: WalletProfile = profile(), open = true) {
  const gate = new SaveGate({ storage: fake.storage, profile: p });
  const wallet = new SoftCurrencyWallet({ gate, profile: p });
  const [, loaded] = await Promise.all([gate.load(), wallet.load()]);
  if (open) gate.open();
  return { gate, wallet, loaded };
}

const win = (extra: Partial<GameplayLevelResult> = {}): GameplayLevelResult => ({
  level: 6,
  levelId: 'classic-6',
  win: true,
  firstCompletion: true,
  stars: 3,
  metrics: { throws: 2 },
  ...extra
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SoftCurrencyWallet — load', () => {
  test('1. missing Core state → startBalance; nothing is written until the gate is open, then it can be saved', async () => {
    const fake = fakeStorage({ 'gorodki-progress-v2': { 'classic-6': 3 } });
    const { gate, wallet, loaded } = await session(fake, profile(), false);
    expect(loaded).toEqual({ currency: 'coins', status: 'ready', balance: 50, writable: false, problem: null, rewardedLevels: [] });
    expect(wallet.balance).toBe(50);
    expect(wallet.grant(10)).toEqual({ ok: false, reason: 'not_open', balance: 50, saved: null });
    expect(wallet.save()).toMatchObject({ ok: false, reason: 'not_open' });
    expect(writes(fake)).toEqual([]);
    gate.open();
    expect(wallet.snapshot().writable).toBe(true);
    const saved = wallet.save();
    expect(saved).toMatchObject({ ok: true, reason: null, balance: 50 });
    expect(await saved.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(walletRecord(fake)).toEqual({ v: 1, balance: 50, rewardedLevels: [] });

    // a Core record that holds other Core state but no wallet is still "never saved": startBalance
    const other = fakeStorage({ [CORE_KEY]: { granted: ['t1'] } });
    expect((await session(other)).loaded).toMatchObject({ status: 'ready', balance: 50 });
  });

  test('2. an existing persisted balance (and its paid first completions) is restored', async () => {
    const fake = fakeStorage({ [CORE_KEY]: { wallet: { v: 1, balance: 340, rewardedLevels: ['classic-6'] }, granted: ['t1'] } });
    const { wallet, loaded } = await session(fake, profile({ startBalance: 0, levelReward: () => 30 }));
    expect(loaded).toMatchObject({ status: 'ready', balance: 340, rewardedLevels: ['classic-6'] });
    expect(wallet.applyLevelResult(win())).toMatchObject({ ok: true, kind: 'replay', amount: 0, balance: 340 });
    expect(fake.calls).toEqual(['get:gorodki-progress-v2,gorodki.core', 'get:gorodki-background-v2']);
  });
});

describe('SoftCurrencyWallet — grant / trySpend', () => {
  test('3. grant adds synchronously and writes the whole record once', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake);
    const result = wallet.grant(100, { source: 'purchase', item: 'gorodki_coins_small' });
    expect(result).toMatchObject({ ok: true, reason: null, balance: 150 });
    expect(wallet.balance).toBe(150);
    expect(await result.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(walletRecord(fake)).toEqual({ v: 1, balance: 150, rewardedLevels: [] });
  });

  test('4. trySpend takes the amount when the balance covers it (all of it included)', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake);
    const spent = wallet.trySpend(20, { source: 'shop', item: 'hint' });
    expect(spent).toMatchObject({ ok: true, reason: null, balance: 30 });
    expect(await spent.saved).toEqual({ ok: true, reason: null });
    expect(wallet.trySpend(30).balance).toBe(0);
    expect(walletRecord(fake)).toEqual({ v: 1, balance: 0, rewardedLevels: [] });
  });

  test('5. trySpend with insufficient funds changes nothing and writes nothing', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake);
    expect(wallet.trySpend(51)).toEqual({ ok: false, reason: 'insufficient_funds', balance: 50, saved: null });
    expect(wallet.balance).toBe(50);
    expect(writes(fake)).toEqual([]);
  });

  test('6. grants and spends persist: the next session (DEV platform, real storage) restores them; other Core records and game keys are untouched', async () => {
    const store = new Map<string, string>([['gorodki-progress-v2', JSON.stringify({ 'classic-6': 3 })]]);
    const webStore = {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key)
    };
    const boot = async () => {
      const platform = new PlatformRuntime(createDevPlatform({ store: webStore, storagePrefix: '', ads: false, payments: false, banner: false }));
      await platform.ready();
      const gate = new SaveGate({ storage: platform.storage, profile: profile() });
      const wallet = new SoftCurrencyWallet({ gate, profile: profile() });
      await wallet.load();
      gate.open();
      return { gate, wallet };
    };
    const first = await boot();
    expect((await first.gate.writeCore('granted', ['t1'])).ok).toBe(true); // another Core record (PurchaseRuntime registry)
    await first.wallet.grant(200).saved;
    await first.wallet.trySpend(75).saved;
    expect(JSON.parse(store.get(CORE_KEY) as string)).toEqual({ granted: ['t1'], wallet: { v: 1, balance: 175, rewardedLevels: [] } });

    const second = await boot();
    expect(second.wallet.snapshot()).toMatchObject({ status: 'ready', balance: 175 });
    expect(second.gate.readCore('granted')).toEqual(['t1']);
    expect(JSON.parse(store.get('gorodki-progress-v2') as string)).toEqual({ 'classic-6': 3 });
  });

  test('a failed write keeps the in-memory balance; the next write (or save()) carries it', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake);
    fake.setMode = 'reject';
    const granted = wallet.grant(10);
    expect(granted).toMatchObject({ ok: true, balance: 60 });
    expect(await granted.saved).toMatchObject({ ok: false, reason: 'storage_rejected' });
    fake.setMode = 'ok';
    expect(await wallet.save().saved).toEqual({ ok: true, reason: null });
    expect(walletRecord(fake)).toEqual({ v: 1, balance: 60, rewardedLevels: [] });
  });
});

describe('SoftCurrencyWallet — failed read', () => {
  test('7. a failed Core read never becomes startBalance and never overwrites the stored balance', async () => {
    const stored = { wallet: { v: 1, balance: 9000, rewardedLevels: ['classic-6'] } };
    const fake = fakeStorage({ 'gorodki-progress-v2': { 'classic-6': 3 }, [CORE_KEY]: stored });
    fake.failingKeys.add('gorodki-progress-v2'); // the first group — the Core record rides with it
    const { gate, wallet, loaded } = await session(fake, profile({ levelReward: () => 30 }));
    expect(loaded).toEqual({ currency: 'coins', status: 'unavailable', balance: null, writable: false, problem: 'read_failed', rewardedLevels: [] });
    fake.failingKeys.clear(); // the platform recovers — the wallet still never writes what it could not read
    for (let i = 0; i < 2; i++) {
      expect(wallet.grant(10)).toEqual({ ok: false, reason: 'unavailable', balance: null, saved: null });
      expect(wallet.trySpend(1)).toEqual({ ok: false, reason: 'unavailable', balance: null, saved: null });
      expect(wallet.applyLevelResult(win())).toEqual({ ok: false, reason: 'unavailable', balance: null, saved: null, kind: null, amount: 0 });
      expect(wallet.save()).toMatchObject({ ok: false, reason: 'unavailable' });
    }
    expect(writes(fake)).toEqual([]);
    expect(fake.data[CORE_KEY]).toEqual(stored);
    // the other group is its own failure domain: the game can still write the background
    expect(await gate.write({ 'gorodki-background-v2': 'forest' })).toEqual({ ok: true, reason: null });
  });

  test('a stored wallet record that is not a V1 wallet is unknown data: unavailable, kept as is', async () => {
    for (const bad of [{ v: 2, balance: 10, rewardedLevels: [] }, { v: 1, balance: -5, rewardedLevels: [] }, { v: 1, balance: 1.5, rewardedLevels: [] }, { v: 1, balance: 10 }, { v: 1, balance: 10, rewardedLevels: [7] }, 'garbage', 42]) {
      const fake = fakeStorage({ [CORE_KEY]: { wallet: bad } });
      const { wallet, loaded } = await session(fake);
      expect(loaded).toMatchObject({ status: 'unavailable', balance: null, problem: 'invalid_record' });
      expect(wallet.grant(1).reason).toBe('unavailable');
      expect(writes(fake)).toEqual([]);
      expect(fake.data[CORE_KEY]).toEqual({ wallet: bad });
    }
  });

  test('before load() settles every change is refused (not_loaded)', () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: profile() });
    const wallet = new SoftCurrencyWallet({ gate, profile: profile() });
    expect(wallet.snapshot()).toMatchObject({ status: 'idle', balance: null, writable: false });
    expect(wallet.grant(1)).toEqual({ ok: false, reason: 'not_loaded', balance: null, saved: null });
    void wallet.load();
    expect(wallet.snapshot().status).toBe('loading');
    expect(wallet.trySpend(1).reason).toBe('not_loaded');
    expect(wallet.load()).toBe(wallet.load()); // once
  });
});

describe('SoftCurrencyWallet — level reward', () => {
  test('8. a first completion pays levelReward(result) once and records the level as paid', async () => {
    const fake = fakeStorage();
    const levelReward = vi.fn((result: GameplayLevelResult) => 10 * (result.stars ?? 1));
    const { wallet } = await session(fake, profile({ levelReward }));
    const result = win();
    const reward = wallet.applyLevelResult(result);
    expect(reward).toMatchObject({ ok: true, reason: null, kind: 'first', amount: 30, balance: 80 });
    expect(levelReward).toHaveBeenCalledTimes(1);
    expect(levelReward.mock.calls[0]?.[0]).toBe(result); // the gameplay's result as is
    expect(await reward.saved).toEqual({ ok: true, reason: null });
    expect(walletRecord(fake)).toEqual({ v: 1, balance: 80, rewardedLevels: ['classic-6'] });
    // without a levelId the level number is the identity; a first completion paying 0 is still recorded
    const zero = await session(fakeStorage(), profile({ levelReward: () => 0 }));
    expect(zero.wallet.applyLevelResult({ level: 4, win: true, firstCompletion: true, metrics: {} })).toMatchObject({ ok: true, kind: 'first', amount: 0, balance: 50 });
    expect(zero.wallet.snapshot().rewardedLevels).toEqual(['4']);
  });

  test('9. replays do not pay under the default policy; replayReward is an explicit opt-in; fails never pay', async () => {
    const fake = fakeStorage();
    const levelReward = vi.fn(() => 30);
    const { wallet } = await session(fake, profile({ levelReward }));
    expect(wallet.applyLevelResult(win({ firstCompletion: false }))).toEqual({ ok: true, reason: null, balance: 50, saved: null, kind: 'replay', amount: 0 });
    expect(wallet.applyLevelResult(win({ win: false, firstCompletion: false }))).toEqual({ ok: true, reason: null, balance: 50, saved: null, kind: 'fail', amount: 0 });
    expect(levelReward).not.toHaveBeenCalled();
    expect(writes(fake)).toEqual([]);

    const replayReward = vi.fn(() => 5);
    const opted = await session(fakeStorage(), profile({ levelReward, replayReward }));
    expect(opted.wallet.applyLevelResult(win())).toMatchObject({ kind: 'first', amount: 30, balance: 80 });
    expect(opted.wallet.applyLevelResult(win({ firstCompletion: false }))).toMatchObject({ kind: 'replay', amount: 5, balance: 85 });
    expect(opted.wallet.applyLevelResult(win({ win: false, firstCompletion: false }))).toMatchObject({ kind: 'fail', amount: 0, balance: 85 });
    expect([levelReward.mock.calls.length, replayReward.mock.calls.length]).toEqual([1, 1]);
  });

  test('10. a repeated identical levelEnd cannot pay the first completion twice — in the session and after a reload', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake, profile({ levelReward: () => 30 }));
    expect(wallet.applyLevelResult(win()).amount).toBe(30);
    expect(wallet.applyLevelResult(win())).toMatchObject({ ok: true, kind: 'replay', amount: 0, balance: 80, saved: null });
    const reloaded = await session(fake, profile({ levelReward: () => 30 }));
    expect(reloaded.wallet.applyLevelResult(win())).toMatchObject({ kind: 'replay', amount: 0, balance: 80 });

    // Contract V1 has no run identity: with replayReward opted in, a duplicated event is paid as ONE more
    // replay (never as a second first completion) — the host must deliver one levelEnd per run
    const opted = await session(fakeStorage(), profile({ levelReward: () => 30, replayReward: () => 5 }));
    opted.wallet.applyLevelResult(win());
    expect(opted.wallet.applyLevelResult(win())).toMatchObject({ kind: 'replay', amount: 5, balance: 85 });
  });

  test('a reward policy that throws or answers a non-integer is refused: nothing paid, the level stays unpaid', async () => {
    for (const answer of [-5, 2.5, Number.NaN, Infinity, '10', undefined]) {
      const { wallet } = await session(fakeStorage(), profile({ levelReward: () => answer as number }));
      const reward = wallet.applyLevelResult(win());
      expect(reward).toMatchObject({ ok: false, reason: 'invalid_reward', kind: 'first', amount: 0, balance: 50, saved: null });
      expect((reward.error as Error).message).toMatch(/levelReward policy answered/);
      expect(wallet.snapshot().rewardedLevels).toEqual([]);
    }
    const boom = new Error('policy bug');
    const { wallet } = await session(fakeStorage(), profile({ levelReward: () => { throw boom; } }));
    expect(wallet.applyLevelResult(win())).toMatchObject({ ok: false, reason: 'invalid_reward', error: boom, balance: 50 });
  });

  test('a result that is not Contract V1 throws a TypeError', async () => {
    const { wallet } = await session(fakeStorage());
    for (const bad of [null, { level: 1, win: 'yes', firstCompletion: false, metrics: {} }, { level: 0, win: true, firstCompletion: true, metrics: {} }, { level: 1.5, win: true, firstCompletion: true, metrics: {} }, { level: 1, levelId: '', win: true, firstCompletion: true, metrics: {} }]) {
      expect(() => wallet.applyLevelResult(bad as unknown as GameplayLevelResult)).toThrow(TypeError);
    }
  });
});

describe('SoftCurrencyWallet — amounts and events', () => {
  test('11. negative, fractional, NaN, infinite and non-number amounts are refused; 0 is a no-op; the safe-integer range holds', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake);
    const events: SoftCurrencyChange[] = [];
    wallet.onChange((change) => events.push(change));
    for (const amount of [-1, 1.5, Number.NaN, Infinity, -Infinity, '10', null, undefined]) {
      expect(wallet.grant(amount as number)).toEqual({ ok: false, reason: 'invalid_amount', balance: 50, saved: null });
      expect(wallet.trySpend(amount as number)).toEqual({ ok: false, reason: 'invalid_amount', balance: 50, saved: null });
    }
    expect(wallet.grant(0)).toEqual({ ok: true, reason: null, balance: 50, saved: null });
    expect(wallet.trySpend(0)).toEqual({ ok: true, reason: null, balance: 50, saved: null });
    expect(wallet.grant(Number.MAX_SAFE_INTEGER)).toMatchObject({ ok: false, reason: 'invalid_amount' });
    expect(wallet.balance).toBe(50);
    expect(writes(fake)).toEqual([]);
    expect(events).toEqual([]);
  });

  test('12. onChange: one event per balance change (grant / spend / level_reward), none for refusals, 0, fails or the load; unsubscribe; a throwing listener is isolated', async () => {
    const fake = fakeStorage();
    const p = profile({ levelReward: () => 30 });
    const gate = new SaveGate({ storage: fake.storage, profile: p });
    const listenerErrors: unknown[] = [];
    const wallet = new SoftCurrencyWallet({ gate, profile: p, onListenerError: (error) => listenerErrors.push(error) });
    const events: SoftCurrencyChange[] = [];
    const unsubscribe = wallet.onChange((change) => events.push(change));
    await wallet.load();
    gate.open();
    expect(events).toEqual([]); // the load is not a change: read the balance from load() / snapshot()
    wallet.grant(100, { source: 'offer', item: 'starter' });
    wallet.trySpend(40, { source: 'shop' });
    wallet.trySpend(1000); // refused
    wallet.grant(0);
    wallet.applyLevelResult(win());
    wallet.applyLevelResult(win()); // a replay: 0
    wallet.applyLevelResult(win({ win: false, firstCompletion: false }));
    expect(events).toEqual([
      { currency: 'coins', kind: 'grant', delta: 100, balance: 150, context: { source: 'offer', item: 'starter' } },
      { currency: 'coins', kind: 'spend', delta: -40, balance: 110, context: { source: 'shop' } },
      { currency: 'coins', kind: 'level_reward', delta: 30, balance: 140 }
    ]);

    wallet.onChange(() => {
      throw new Error('listener bug');
    });
    const late: number[] = [];
    wallet.onChange((change) => late.push(change.balance));
    const result = wallet.grant(5);
    expect(result).toMatchObject({ ok: true, balance: 145 });
    expect(late).toEqual([145]);
    expect((listenerErrors[0] as Error).message).toBe('listener bug');

    unsubscribe();
    wallet.grant(1);
    expect(events).toHaveLength(4);
    expect(() => wallet.onChange(null as unknown as () => void)).toThrow(TypeError);
  });
});

describe('SoftCurrencyWallet — ownership and seams', () => {
  test('only a core-owned currency gets a wallet; the gate is required', () => {
    const gate = new SaveGate({ storage: fakeStorage().storage, profile: profile() });
    const make = (economy: unknown) => () => new SoftCurrencyWallet({ gate, profile: { economy } as WalletProfile });
    expect(make({ softCurrency: false })).toThrow(/the game has no soft currency/);
    expect(make({ softCurrency: { id: 'coins', owner: 'gameplay' } })).toThrow(/core-owned currency only/);
    expect(make({ softCurrency: { id: 'coins', owner: 'core', startBalance: -1 } })).toThrow(/startBalance must be an integer ≥ 0/);
    expect(make({ softCurrency: { id: 'coins', owner: 'core', startBalance: 0, replayReward: 5 } })).toThrow(/replayReward must be a function/);
    expect(() => new SoftCurrencyWallet({ gate: undefined as unknown as SaveGate, profile: profile() })).toThrow(/SaveGate is required/);
  });

  test('purchase seam: PurchaseRuntime grants a coin pack through wallet.grant (DEV payments, no new orchestration)', async () => {
    const fake = fakeStorage();
    const { wallet } = await session(fake);
    const platform = new PlatformRuntime(createDevPlatform({ ads: false, banner: false }));
    await platform.ready();
    const packs: Record<string, number> = { gorodki_coins_small: 100 };
    const purchases = new PurchaseRuntime<number>({
      payments: platform.payments!,
      granted: createGrantedPurchaseStore(),
      resolveGrant: (productId) => packs[productId],
      grant: (productId, amount) => {
        const result = wallet.grant(amount, { source: 'purchase', item: productId });
        if (!result.ok) throw new Error(`wallet refused: ${result.reason}`); // reported as grant_threw, never silent
      }
    });
    expect((await purchases.purchase('gorodki_coins_small', 'shop')).status).toBe('ok');
    expect(wallet.balance).toBe(150);
    await Promise.resolve();
    expect(walletRecord(fake)).toEqual({ v: 1, balance: 150, rewardedLevels: [] });
  });

  test('no timers: a whole session leaves none; src/economy names no global, clock, timer or SDK and imports types only', async () => {
    vi.useFakeTimers();
    const fake = fakeStorage();
    const { wallet } = await session(fake, profile({ levelReward: () => 1 }));
    wallet.grant(3);
    wallet.trySpend(2);
    wallet.applyLevelResult(win());
    fake.setMode = 'reject';
    await wallet.grant(1).saved;
    expect(vi.getTimerCount()).toBe(0);

    const dir = fileURLToPath(new URL('../../src/economy/', import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
    expect(files).toEqual(['SoftCurrencyWallet.ts', 'index.ts']);
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden = /\b(Date|performance|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|window|globalThis|self|document|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|YaGames|process|structuredClone|Math\.random)\b/;
    const wallet_ = strip(readFileSync(resolve(dir, 'SoftCurrencyWallet.ts'), 'utf-8'));
    expect(wallet_.match(forbidden)?.[0] ?? null).toBeNull();
    for (const [, from] of wallet_.matchAll(/from '([^']+)'/g)) {
      expect(['../production/contract', '../production/profile', '../save/SaveGate']).toContain(from);
    }
    expect(wallet_.match(/^import (?!type )/m), 'SoftCurrencyWallet.ts imports types only').toBeNull();
  });
});
