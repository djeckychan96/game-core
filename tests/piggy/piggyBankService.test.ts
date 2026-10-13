import { describe, expect, test } from 'vitest';
import {
  PIGGY_BANK_SOURCE,
  PiggyBankService,
  SaveGate,
  SoftCurrencyWallet,
  createPiggyBankLedger,
  piggyBankAccrual,
  piggyBankGddExample,
  piggyBankThreshold,
  validatePiggyBankConfig
} from '../../src/index';
import type { GameProductionProfile, PiggyBankChange, PiggyBankConfig, PlatformStorage } from '../../src/index';
import { QA_PIGGY_BANK_SOURCE, buyQaPiggyBank, createPiggyBankQaCapabilities, fillQaPiggyBank } from '../../src/qa/index';

type GateProfile = Pick<GameProductionProfile, 'id' | 'save' | 'economy'>;
const PROFILE: GateProfile = { id: 'game', save: { keys: ['game_state'] }, economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0 } } };
const CORE_KEY = 'game.core';

/** A PlatformStorage over a plain object with scripted failures; every call is journaled (the quests test's fake). */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const fake = {
    data: JSON.parse(JSON.stringify(initial)) as Record<string, unknown>,
    calls: [] as string[],
    patches: [] as Record<string, any>[],
    failRead: false,
    /** ok; false = refused; reject; lost = never applied, never answered (the tab died mid-write). */
    setMode: 'ok' as 'ok' | 'false' | 'reject' | 'lost',
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
      if (fake.setMode === 'false') return Promise.resolve(false);
      if (fake.setMode === 'reject') return Promise.reject(new Error('quota'));
      if (fake.setMode === 'lost') return new Promise<boolean>(() => {});
      fake.patches.push(JSON.parse(JSON.stringify(patch)));
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
const writes = (fake: Fake) => fake.calls.filter((call) => call.startsWith('set:')).length;
const stored = (fake: Fake) => (fake.data[CORE_KEY] as Record<string, any> | undefined) ?? {};
const storedBank = (fake: Fake) => stored(fake).piggyBank;
const storedBalance = (fake: Fake) => stored(fake).wallet?.balance ?? 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** GDD example numbers; level 1 sold for 900 from the wallet, level 2 as a platform product, the rest not for sale. */
function config(overrides: Partial<PiggyBankConfig> = {}): PiggyBankConfig {
  const base = piggyBankGddExample();
  return {
    ...base,
    levels: base.levels.map((level, i) => ({ ...level, price: i === 0 ? { kind: 'wallet' as const, amount: 900 } : i === 1 ? { kind: 'product' as const, productId: 'piggy_2' } : null })),
    ...overrides
  };
}

/** One game session: gate + wallet + bank loaded, the gate opened. */
async function session(fake: Fake, options: { config?: PiggyBankConfig; open?: boolean; startCoins?: number; changes?: PiggyBankChange[] } = {}) {
  const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
  const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
  const piggy = new PiggyBankService({ gate, wallet, config: options.config ?? config() });
  if (options.changes) piggy.onChange((change) => options.changes!.push(change));
  await Promise.all([gate.load(), wallet.load(), piggy.load()]);
  if (options.open !== false) gate.open();
  if (options.startCoins) wallet.grant(options.startCoins, { source: 'test' });
  return { gate, wallet, piggy };
}
/** Fills the bank with a level result per call: earned coins → 150 % staged → collected (the lobby). */
function earn(piggy: PiggyBankService, key: string, earned: number) {
  const staged = piggy.stage({ key, earned });
  return { staged, collected: piggy.collect() };
}

describe('Piggy Bank — config, the GDD example, the threshold and accrual rules', () => {
  test('the GDD example: 50 % threshold, 3000 → 5000 → 7500 → 10000, bonus 150 %, nothing for sale yet; valid', () => {
    const gdd = piggyBankGddExample();
    expect(gdd).toEqual({ accrualPercent: 150, purchaseThresholdPercent: 50, levels: [3000, 5000, 7500, 10000].map((capacity) => ({ capacity, price: null })) });
    expect(validatePiggyBankConfig(gdd)).toEqual([]);
    expect(piggyBankGddExample()).not.toBe(gdd); // a fresh object each time: a game edits its own copy
  });

  test('GDD examples: 150 earned × 150 % = 225; thresholds 1500 / 2500 / 3750', () => {
    expect(piggyBankAccrual(150, 150)).toBe(225);
    expect(piggyBankAccrual(5, 150)).toBe(7); // floor
    expect(piggyBankAccrual(0, 150)).toBe(0);
    expect([3000, 5000, 7500, 10000].map((capacity) => piggyBankThreshold(capacity, 50))).toEqual([1500, 2500, 3750, 5000]);
    expect(piggyBankThreshold(3, 50)).toBe(2); // ceil
  });

  test('a bad config is refused at construction, with every problem named', () => {
    const bad = { accrualPercent: -1, purchaseThresholdPercent: 0, levels: [{ capacity: 0, price: { kind: 'wallet', amount: 0 } }, { capacity: 5, price: { kind: 'gems' } }] } as unknown as PiggyBankConfig;
    const issues = validatePiggyBankConfig(bad);
    expect(issues).toEqual([
      'accrualPercent must be a finite number ≥ 0',
      'purchaseThresholdPercent must be in (0, 100]',
      'levels[0].capacity must be an integer ≥ 1',
      'levels[0].price.amount must be an integer ≥ 1',
      "levels[1].price.kind must be 'product' or 'wallet'"
    ]);
    expect(validatePiggyBankConfig({ ...piggyBankGddExample(), levels: [] })).toEqual(['levels must be a non-empty array']);
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    expect(() => new PiggyBankService({ gate, wallet, config: bad })).toThrow(/config — accrualPercent/);
  });
});

describe('Piggy Bank — accrual: staged at the level result, collected at the lobby, capped by the capacity', () => {
  test('a new player: an empty level-1 bank, nothing written until a change', async () => {
    const fake = fakeStorage();
    const { piggy } = await session(fake);
    expect(piggy.snapshot()).toEqual({
      status: 'ready', problem: null, writable: true, level: 1, balance: 0, capacity: 3000, threshold: 1500, progress: 0,
      state: 'empty', canBuy: false, price: { kind: 'wallet', amount: 900 }, staged: 0
    });
    expect(writes(fake)).toBe(0);
  });

  test('a level result stages its share (stored), the bank gets it only at collect(); the snapshot follows', async () => {
    const fake = fakeStorage();
    const changes: PiggyBankChange[] = [];
    const { piggy, wallet } = await session(fake, { changes });
    const staged = piggy.stage({ key: 'L1#1', earned: 150 });
    expect(staged).toMatchObject({ ok: true, reason: null, staged: 225, duplicate: false });
    expect(piggy.snapshot()).toMatchObject({ balance: 0, staged: 225, state: 'empty' });
    expect(storedBank(fake)).toMatchObject({ v: 1, level: 0, balance: 0, staged: [{ key: 'L1#1', amount: 225 }] }); // survives a reload
    const collected = piggy.collect();
    expect(collected).toMatchObject({ ok: true, added: 225, dropped: 0, balance: 225, full: false });
    expect(piggy.snapshot()).toMatchObject({ balance: 225, staged: 0, state: 'partial', progress: 0.075, canBuy: false });
    expect(storedBank(fake)).toMatchObject({ balance: 225, staged: [] });
    expect(wallet.balance).toBe(0); // the bank never pays the wallet before a purchase
    expect(changes).toEqual([{ kind: 'staged', key: 'L1#1', amount: 225 }, { kind: 'collected', added: 225, dropped: 0, balance: 225, full: false }]);
    // nothing staged → collect writes nothing; a 0 reward (a replay that paid 0) stages nothing
    const before = writes(fake);
    expect(piggy.collect()).toMatchObject({ ok: true, added: 0, saved: null });
    expect(piggy.stage({ key: 'L1#2', earned: 0 })).toMatchObject({ ok: true, staged: 0, saved: null });
    expect(writes(fake)).toBe(before);
  });

  test('a repeated level-result event counts once: before the lobby, after it, and after a reload', async () => {
    const fake = fakeStorage();
    const a = await session(fake);
    expect(a.piggy.stage({ key: 'L3#7', earned: 100 }).staged).toBe(150);
    expect(a.piggy.stage({ key: 'L3#7', earned: 100 })).toMatchObject({ ok: true, staged: 0, duplicate: true, saved: null });
    a.piggy.collect();
    expect(a.piggy.stage({ key: 'L3#7', earned: 100 }).duplicate).toBe(true);
    await flush();
    const b = await session(fake);
    expect(b.piggy.stage({ key: 'L3#7', earned: 100 }).duplicate).toBe(true);
    b.piggy.collect();
    expect(b.piggy.snapshot().balance).toBe(150);
  });

  test('a reload between the level result and the lobby loses nothing and counts once', async () => {
    const fake = fakeStorage();
    const a = await session(fake);
    a.piggy.stage({ key: 'L5#1', earned: 200 });
    await flush(); // the tab is closed on the result screen
    const b = await session(fake);
    expect(b.piggy.snapshot()).toMatchObject({ balance: 0, staged: 300 });
    expect(b.piggy.collect().added).toBe(300);
    await flush();
    const c = await session(fake);
    expect(c.piggy.snapshot()).toMatchObject({ balance: 300, staged: 0 });
    expect(c.piggy.collect().added).toBe(0);
  });

  test('the capacity: a full bank stops accruing — the surplus is dropped, never stored above the capacity', async () => {
    const fake = fakeStorage();
    const { piggy } = await session(fake);
    expect(earn(piggy, 'a', 1900).collected).toMatchObject({ added: 2850, dropped: 0, balance: 2850, full: false });
    expect(piggy.snapshot().state).toBe('purchasable');
    expect(earn(piggy, 'b', 200).collected).toMatchObject({ added: 150, dropped: 150, balance: 3000, full: true });
    expect(piggy.snapshot()).toMatchObject({ balance: 3000, capacity: 3000, progress: 1, state: 'full', canBuy: true });
    expect(earn(piggy, 'c', 1000).collected).toMatchObject({ added: 0, dropped: 1500, balance: 3000, full: true });
    expect(storedBank(fake).balance).toBe(3000);
  });

  test('the four states: empty → partial → purchasable (from 50 %) → full', async () => {
    const { piggy } = await session(fakeStorage());
    const states: string[] = [piggy.snapshot().state as string];
    earn(piggy, '1', 666); // 999
    states.push(piggy.snapshot().state as string);
    piggy.stage({ key: '2', amount: 500 });
    piggy.collect(); // 1499
    states.push(piggy.snapshot().state as string);
    piggy.stage({ key: '3', amount: 1 });
    piggy.collect(); // 1500 = 50 %
    states.push(piggy.snapshot().state as string);
    expect(piggy.snapshot().canBuy).toBe(true);
    piggy.stage({ key: '4', amount: 1500 });
    piggy.collect(); // 3000
    states.push(piggy.snapshot().state as string);
    expect(states).toEqual(['empty', 'partial', 'partial', 'purchasable', 'full']);
  });

  test('wallet income that is not a level result never fills the bank: QA grants, refunds, quest rewards, purchases', async () => {
    const { piggy, wallet } = await session(fakeStorage());
    for (const source of ['qa_panel', 'lives_refill_refund', 'quest', 'purchase', 'shop']) wallet.grant(1000, { source });
    expect(piggy.snapshot()).toMatchObject({ balance: 0, staged: 0 }); // the bank listens to nothing: only stage() fills it
  });

  test('refusals: a bad entry, not loaded, not open — nothing changes, nothing written', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    const piggy = new PiggyBankService({ gate, wallet, config: config() });
    expect(piggy.stage({ key: 'x', earned: 10 }).reason).toBe('not_loaded');
    await Promise.all([wallet.load(), piggy.load()]);
    expect(piggy.stage({ key: 'x', earned: 10 }).reason).toBe('not_open');
    expect(piggy.collect().reason).toBe('not_open');
    gate.open();
    for (const entry of [{ key: '', earned: 1 }, { key: 'k', earned: -1 }, { key: 'k', earned: 1.5 }, { key: 'k' }, { key: 'k', earned: 1, amount: 1 }]) {
      expect(piggy.stage(entry as never).reason, JSON.stringify(entry)).toBe('invalid_entry');
    }
    expect(writes(fake)).toBe(0);
  });
});

describe('Piggy Bank — buying a level priced in the wallet\'s currency (from 50 %), the payout and the next level', () => {
  test('below the threshold → refused; at 50 % → the price is spent, the coins paid, the bank empty, level 2', async () => {
    const fake = fakeStorage();
    const changes: PiggyBankChange[] = [];
    const { piggy, wallet } = await session(fake, { startCoins: 1000, changes });
    earn(piggy, 'a', 999); // 1498
    expect(piggy.buyFromWallet()).toMatchObject({ ok: false, reason: 'below_threshold', received: 0 });
    piggy.stage({ key: 'b', amount: 2 });
    piggy.collect(); // 1500
    const writesBefore = writes(fake);
    const buy = piggy.buyFromWallet();
    expect(buy).toMatchObject({ ok: true, reason: null, received: 1500, level: 2 });
    expect(await buy.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake) - writesBefore).toBe(1); // the payout and the empty bank: ONE storage write
    expect(wallet.balance).toBe(1000 - 900 + 1500);
    expect(storedBalance(fake)).toBe(1600);
    expect(piggy.snapshot()).toMatchObject({ level: 2, balance: 0, capacity: 5000, threshold: 2500, state: 'empty', canBuy: false, price: { kind: 'product', productId: 'piggy_2' } });
    expect(storedBank(fake)).toMatchObject({ level: 1, balance: 0 });
    expect(changes.at(-1)).toEqual({ kind: 'purchased', level: 2, received: 1500, via: 'wallet', token: null });
    // level 2 is a platform product: not sold from the wallet
    expect(piggy.buyFromWallet().reason).toBe('not_for_wallet');
  });

  test('the wallet cannot pay the price → refused, nothing changes; a level without a price is not for sale', async () => {
    const { piggy, wallet } = await session(fakeStorage(), { startCoins: 100 });
    earn(piggy, 'a', 2000);
    expect(piggy.buyFromWallet()).toMatchObject({ ok: false, reason: 'insufficient_funds' });
    expect([wallet.balance, piggy.snapshot().balance, piggy.snapshot().level]).toEqual([100, 3000, 1]);
    const free = await session(fakeStorage(), { config: piggyBankGddExample(), startCoins: 5000 });
    earn(free.piggy, 'a', 2000);
    expect(free.piggy.snapshot().price).toBeNull();
    expect(free.piggy.buyFromWallet().reason).toBe('not_for_wallet');
  });

  test('progression: every purchase moves to the next capacity; past the last level the last one repeats', async () => {
    const walletEveryLevel: PiggyBankConfig = { ...piggyBankGddExample(), levels: piggyBankGddExample().levels.map((level) => ({ ...level, price: { kind: 'wallet', amount: 1 } })) };
    const { piggy } = await session(fakeStorage(), { config: walletEveryLevel, startCoins: 10 });
    const seen: Array<[number | null, number | null, number | null]> = [];
    for (let i = 0; i < 6; i++) {
      const s = piggy.snapshot();
      seen.push([s.level, s.capacity, s.threshold]);
      piggy.stage({ key: `fill-${i}`, amount: s.capacity as number });
      piggy.collect();
      expect(piggy.buyFromWallet().ok).toBe(true);
    }
    expect(seen).toEqual([[1, 3000, 1500], [2, 5000, 2500], [3, 7500, 3750], [4, 10000, 5000], [5, 10000, 5000], [6, 10000, 5000]]);
  });

  for (const mode of ['false', 'reject', 'lost'] as const) {
    test(`the purchase write fails (${mode}): after a restart the bank is still full and unpaid — buying again pays once`, async () => {
      const fake = fakeStorage();
      const a = await session(fake, { startCoins: 1000 });
      earn(a.piggy, 'a', 2000);
      await flush();
      fake.setMode = mode;
      expect(a.piggy.buyFromWallet().ok).toBe(true); // in memory: paid
      expect([storedBalance(fake), storedBank(fake).balance]).toEqual([1000, 3000]); // stored: neither
      fake.setMode = 'ok'; // restart
      const b = await session(fake);
      expect([b.wallet.balance, b.piggy.snapshot().balance, b.piggy.snapshot().level]).toEqual([1000, 3000, 1]);
      expect(b.piggy.buyFromWallet().ok).toBe(true);
      await flush();
      const c = await session(fake);
      expect([c.wallet.balance, c.piggy.snapshot().balance, c.piggy.snapshot().level]).toEqual([1000 - 900 + 3000, 0, 2]);
    });
  }

  test('a crash after any number of landed writes around accrual and a purchase: payout ⇔ empty bank, always', async () => {
    for (let landed = 0; landed <= 6; landed++) {
      const fake = fakeStorage();
      const a = await session(fake, { startCoins: 1000 });
      let budget = landed;
      const set = fake.storage.set;
      fake.storage.set = (patch) => (budget-- > 0 ? set(patch) : new Promise<boolean>(() => {})); // then the tab dies
      a.piggy.stage({ key: 'a', earned: 1000 });
      a.piggy.collect();
      a.piggy.stage({ key: 'b', earned: 400 });
      a.piggy.collect();
      a.piggy.buyFromWallet();
      a.piggy.stage({ key: 'c', earned: 10 });
      await flush();
      const bank = storedBank(fake);
      const paid = storedBalance(fake) !== 1000 && storedBalance(fake) !== 0;
      const emptied = (bank?.level ?? 0) === 1;
      expect(paid, `landed ${landed}`).toBe(emptied);
      if (paid) expect(storedBalance(fake)).toBe(1000 - 900 + 2100);
      fake.storage.set = set; // restart: a consistent save, and the same bank can never be bought twice
      const b = await session(fake);
      const s = b.piggy.snapshot();
      if (emptied) {
        expect([s.level, s.balance], `landed ${landed}`).toEqual([2, 0]);
        expect(b.piggy.buyFromWallet().ok).toBe(false);
      } else {
        expect([0, 1500, 2100], `landed ${landed}`).toContain(s.balance);
        expect(b.wallet.balance).toBe(1000);
      }
    }
  });
});

describe('Piggy Bank — a paid platform purchase (the PurchaseRuntime ledger): exactly once, honest answers', () => {
  async function level2(fake: Fake) {
    const s = await session(fake, { startCoins: 1000 });
    earn(s.piggy, 'a', 1000); // 1500
    expect(s.piggy.buyFromWallet().ok).toBe(true); // → level 2 (sold as piggy_2)
    earn(s.piggy, 'b', 2000); // 3000 of 5000 (≥ 2500)
    await flush();
    return s;
  }

  test('applied only after the confirmed write; the same token again → already_applied, paid once (also after a reload)', async () => {
    const fake = fakeStorage();
    const { piggy, wallet } = await level2(fake);
    const before = wallet.balance as number;
    expect(await piggy.applyPurchase({ token: 'ya-1', productId: 'piggy_2' })).toBe('applied');
    expect(wallet.balance).toBe(before + 3000);
    expect(piggy.snapshot()).toMatchObject({ level: 3, balance: 0, capacity: 7500 });
    expect(storedBank(fake).tokens).toEqual(['ya-1']);
    expect(storedBalance(fake)).toBe(before + 3000);
    expect(await piggy.applyPurchase({ token: 'ya-1', productId: 'piggy_2' })).toBe('already_applied');
    expect(wallet.balance).toBe(before + 3000);
    const b = await session(fake);
    expect(await b.piggy.applyPurchase({ token: 'ya-1', productId: 'piggy_2' })).toBe('already_applied');
    expect(b.wallet.balance).toBe(before + 3000);
  });

  for (const mode of ['false', 'reject'] as const) {
    test(`the write does not confirm (${mode}): not_durable (the receipt stays); a restart applies it once`, async () => {
      const fake = fakeStorage();
      const a = await level2(fake);
      const before = a.wallet.balance as number;
      fake.setMode = mode;
      expect(await a.piggy.applyPurchase({ token: 'ya-2', productId: 'piggy_2' })).toBe('not_durable');
      fake.setMode = 'ok';
      const b = await session(fake); // restart: nothing of it stored
      expect([b.wallet.balance, b.piggy.snapshot().balance, b.piggy.snapshot().level]).toEqual([before, 3000, 2]);
      expect(await b.piggy.applyPurchase({ token: 'ya-2', productId: 'piggy_2' })).toBe('applied');
      expect(await b.piggy.applyPurchase({ token: 'ya-2', productId: 'piggy_2' })).toBe('already_applied');
      expect(b.wallet.balance).toBe(before + 3000);
    });
  }

  test('the session goes on after a not_durable: the same token is WRITTEN again and answered by that write — never paid twice', async () => {
    const fake = fakeStorage();
    const { piggy, wallet } = await level2(fake);
    const before = wallet.balance as number;
    fake.setMode = 'false';
    expect(await piggy.applyPurchase({ token: 'ya-3', productId: 'piggy_2' })).toBe('not_durable');
    expect(await piggy.applyPurchase({ token: 'ya-3', productId: 'piggy_2' })).toBe('not_durable'); // still not stored
    fake.setMode = 'ok';
    expect(await piggy.applyPurchase({ token: 'ya-3', productId: 'piggy_2' })).toBe('applied');
    expect(await piggy.applyPurchase({ token: 'ya-3', productId: 'piggy_2' })).toBe('already_applied');
    expect([wallet.balance, storedBalance(fake), storedBank(fake).balance]).toEqual([before + 3000, before + 3000, 0]);
  });

  test('a paid receipt is delivered even below the threshold (the threshold gates the offer); an unreadable bank keeps it', async () => {
    const fake = fakeStorage();
    const { piggy, wallet } = await session(fake);
    earn(piggy, 'a', 100); // 150 < 1500
    expect(await piggy.applyPurchase({ token: 'late-restore', productId: 'piggy_2' })).toBe('applied');
    expect([wallet.balance, piggy.snapshot().level]).toEqual([150, 2]);
    const broken = fakeStorage({ [CORE_KEY]: { piggyBank: { v: 9 } } });
    const b = await session(broken);
    expect(b.piggy.snapshot()).toMatchObject({ status: 'unavailable', problem: 'invalid_record', writable: false, balance: null });
    expect(await b.piggy.applyPurchase({ token: 't', productId: 'piggy_2' })).toBe('not_durable');
  });

  test('createPiggyBankLedger: the bank\'s products go to the bank, any other to the game\'s ledger (none → not_durable)', async () => {
    const { piggy } = await level2(fakeStorage());
    const other: string[] = [];
    const ledger = createPiggyBankLedger(piggy, { apply: (entry) => { other.push(entry.productId); return 'applied'; } });
    const context = {} as never;
    expect(await ledger.apply({ token: 'p1', productId: 'piggy_2', rewards: null, context })).toBe('applied');
    expect(await ledger.apply({ token: 'c1', productId: 'coins_100', rewards: null, context })).toBe('applied');
    expect(other).toEqual(['coins_100']);
    expect(await createPiggyBankLedger(piggy).apply({ token: 'c2', productId: 'coins_100', rewards: null, context })).toBe('not_durable');
    expect(piggy.productIds()).toEqual(['piggy_2']);
  });
});

describe('Piggy Bank — unavailable states are never overwritten', () => {
  test('a failed Core read: unavailable, every change refused, nothing written', async () => {
    const fake = fakeStorage();
    fake.failRead = true;
    const { piggy } = await session(fake);
    expect(piggy.snapshot()).toMatchObject({ status: 'unavailable', problem: 'read_failed', balance: null, state: null, canBuy: false });
    expect(piggy.stage({ key: 'a', earned: 10 }).reason).toBe('unavailable');
    expect(piggy.collect().reason).toBe('unavailable');
    expect(piggy.buyFromWallet().reason).toBe('unavailable');
    expect(writes(fake)).toBe(0);
  });

  test('a record of another version stays as it is', async () => {
    const fake = fakeStorage({ [CORE_KEY]: { piggyBank: { v: 2, level: 1, coins: 5 }, wallet: { v: 1, balance: 10, rewardedLevels: [] } } });
    const { piggy, wallet } = await session(fake);
    expect(piggy.snapshot().status).toBe('unavailable');
    wallet.grant(5, { source: 'test' }); // another record's write carries the Core object
    await flush();
    expect(storedBank(fake)).toEqual({ v: 2, level: 1, coins: 5 });
  });
});

describe('Piggy Bank — the QA seam (game-core/qa only): fill and buy without a payment', () => {
  test('fill adds up to a value (capped), never lowers; buy follows the threshold and pays once through the paid path', async () => {
    const fake = fakeStorage();
    const { piggy, wallet } = await session(fake);
    expect(fillQaPiggyBank(piggy, 1499)).toEqual({ from: 0, balance: 1499, capacity: 3000 });
    await expect(buyQaPiggyBank(piggy)).rejects.toThrow(/below the threshold \(1499 \/ 1500\)/);
    expect(() => fillQaPiggyBank(piggy, 10)).toThrow(/can only add/);
    expect(fillQaPiggyBank(piggy, 99999).balance).toBe(3000);
    const bought = await buyQaPiggyBank(piggy);
    expect(bought).toEqual({ received: 3000, level: 2, result: 'applied' });
    expect([wallet.balance, storedBalance(fake), storedBank(fake).balance]).toEqual([3000, 3000, 0]);
    expect(storedBank(fake).tokens[0]).toBe(`${QA_PIGGY_BANK_SOURCE}:buy:1:3000`);
    expect(storedBank(fake).keys.every((key: string) => key.startsWith(`${QA_PIGGY_BANK_SOURCE}:fill:`))).toBe(true);
  });

  test('the panel capabilities: piggy.balance (number) and piggy.buy (action)', async () => {
    const { piggy } = await session(fakeStorage());
    const [fill, buy] = createPiggyBankQaCapabilities(piggy);
    expect([fill.id, fill.kind, buy.id, buy.kind]).toEqual(['piggy.balance', 'number', 'piggy.buy', 'action']);
    fill.set(2000);
    expect(fill.get()).toBe(2000);
    await expect(Promise.resolve(buy.run({}))).resolves.toMatchObject({ received: 2000, result: 'applied' });
  });

  test('the root entry carries no QA marker; the bank\'s own payout source is not a QA one', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/piggy/PiggyBankService.ts', 'src/piggy/config.ts', 'src/piggy/types.ts', 'src/composition/piggyPurchases.ts']) {
      expect(readFileSync(file, 'utf8')).not.toContain(QA_PIGGY_BANK_SOURCE);
    }
    expect(PIGGY_BANK_SOURCE).toBe('piggy_bank');
  });
});
