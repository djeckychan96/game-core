import { describe, expect, test } from 'vitest';
import { ContinueOfferRuntime, LivesRuntime, SaveGate, SoftCurrencyWallet } from '../../src/index';
import type { ContinueOfferConfig, GameProductionProfile, PlatformStorage, SaveWriteResult } from '../../src/index';

type GateProfile = Pick<GameProductionProfile, 'id' | 'save' | 'economy'>;

const PROFILE: GateProfile = {
  id: 'trail',
  save: { keys: ['trail_state'] },
  economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 100 } }
};
const CORE_KEY = 'trail.core';

/** Trail Arrow 0.1.31's continue rules as TEST values (ContinuePrice.ts: 900 / 1900 / 2900, the first continue free) — never Core defaults. */
const DONOR: ContinueOfferConfig = { priceSteps: [900, 1900, 2900], firstFree: true };
/** The same ladder without the free continue: the priced tests start at 900. */
const PRICED: ContinueOfferConfig = { priceSteps: [900, 1900, 2900] };

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
const continueRecord = (fake: Fake) => (fake.data[CORE_KEY] as Record<string, unknown> | undefined)?.continueOffer;
const stored = (freeUsed: boolean, levelKey: string | null, offerCount: number) => ({
  [CORE_KEY]: { continueOffer: { v: 1, freeUsed, levelKey, offerCount } }
});

/** One session: gate + runtime loaded, the gate opened (the host applied the game's values). */
async function session(fake: Fake, options: { config?: ContinueOfferConfig; open?: boolean } = {}) {
  const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
  const offers = new ContinueOfferRuntime({ gate, config: options.config ?? DONOR });
  const [, loaded] = await Promise.all([gate.load(), offers.load()]);
  if (options.open !== false) gate.open();
  return { gate, offers, loaded };
}

/** Opens a new offer on `level` and closes it with `resolution`; answers the quoted price. */
function offerAndResolve(offers: ContinueOfferRuntime, level: string | number, resolution: 'continued' | 'declined'): number {
  const begun = offers.beginOffer(level);
  expect(begun.ok).toBe(true);
  expect(begun.reopened).toBe(false);
  expect(offers.resolveOffer(resolution).ok).toBe(true);
  return begun.quote!.price;
}

describe('ContinueOfferRuntime — config', () => {
  test('17. an unknown config key, an empty ladder, a non-integer / zero price or a non-boolean firstFree is refused', () => {
    const gate = new SaveGate({ storage: fakeStorage().storage, profile: PROFILE });
    const make = (config: unknown) => () => new ContinueOfferRuntime({ gate, config: config as ContinueOfferConfig });
    expect(make({ priceSteps: [900], adAmount: 1 })).toThrow(/adAmount is not a continue rule/);
    expect(make({ priceSteps: [900], moves: 10 })).toThrow(RangeError);
    expect(make({ priceSteps: [] })).toThrow(/non-empty/);
    expect(make({})).toThrow(/non-empty/);
    expect(make({ priceSteps: [900, 0] })).toThrow(/integers ≥ 1/);
    expect(make({ priceSteps: [900, 1.5] })).toThrow(/integers ≥ 1/);
    expect(make({ priceSteps: [900], firstFree: 1 })).toThrow(/firstFree/);
    expect(make(null)).toThrow(RangeError);
    expect(() => new ContinueOfferRuntime({ gate: {} as SaveGate, config: PRICED })).toThrow(TypeError);
    expect(make({ priceSteps: [900, 1900, 2900], firstFree: true })).not.toThrow();
    expect(make({ priceSteps: [100] })).not.toThrow();
  });

  test('the config ladder is copied: a later change of the host array changes nothing', async () => {
    const steps = [900, 1900];
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const offers = new ContinueOfferRuntime({ gate, config: { priceSteps: steps } });
    await Promise.all([gate.load(), offers.load()]);
    gate.open();
    steps[0] = 1;
    expect(offers.beginOffer(1).quote!.price).toBe(900);
  });
});

describe('ContinueOfferRuntime — free continue (firstFree)', () => {
  test('1. a fresh profile: the first quote is free — price 0, step 0, nothing written', async () => {
    const fake = fakeStorage();
    const { offers, loaded } = await session(fake);
    expect(loaded).toMatchObject({ status: 'ready', freeAvailable: true, levelKey: null, offerCount: 0, offer: null });
    const begun = offers.beginOffer(4);
    expect(begun).toMatchObject({ ok: true, reason: null, reopened: false, saved: null });
    expect(begun.quote).toEqual({ levelKey: '4', free: true, price: 0, step: 0 });
    expect(offers.currentQuote()).toEqual(begun.quote);
    expect(writes(fake)).toEqual([]);
  });

  test('2. a continued free offer uses the free continue up (one write); the next offer is the first priced step', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake);
    offers.beginOffer(4);
    const resolved = offers.resolveOffer('continued');
    expect(resolved.quote).toEqual({ levelKey: '4', free: true, price: 0, step: 0 });
    expect(await resolved.saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: true, levelKey: null, offerCount: 0 });
    expect(offers.snapshot()).toMatchObject({ freeAvailable: false, offer: null });
    // the free continue took no step: the same level starts its ladder at 900
    expect(offers.beginOffer(4).quote).toEqual({ levelKey: '4', free: false, price: 900, step: 1 });
  });

  test('3. a declined free offer stays free: nothing written, the next offer is free again (also after a reload)', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    expect(offerAndResolve(first.offers, 4, 'declined')).toBe(0);
    expect(offerAndResolve(first.offers, 4, 'declined')).toBe(0);
    expect(offerAndResolve(first.offers, 5, 'declined')).toBe(0);
    expect(writes(fake)).toEqual([]);
    const second = await session(fake);
    expect(second.offers.snapshot().freeAvailable).toBe(true);
    expect(second.offers.beginOffer(4).quote!.free).toBe(true);
  });

  test('the free offer does not move the paid ladder: a stored ladder of the level goes on after it', async () => {
    const fake = fakeStorage(stored(false, '7', 1));
    const { offers } = await session(fake);
    expect(offerAndResolve(offers, 7, 'continued')).toBe(0);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: true, levelKey: '7', offerCount: 1 });
    expect(offerAndResolve(offers, 7, 'continued')).toBe(1900);
  });

  test('a free continue survives a reload once used: freeUsed is durable', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    first.offers.beginOffer(1);
    await first.offers.resolveOffer('continued').saved;
    const second = await session(fake);
    expect(second.offers.snapshot().freeAvailable).toBe(false);
    expect(second.offers.beginOffer(1).quote!.price).toBe(900);
  });

  test('without firstFree the very first offer is priced; a stored freeUsed false never makes one free', async () => {
    const fake = fakeStorage(stored(false, null, 0));
    const { offers, loaded } = await session(fake, { config: PRICED });
    expect(loaded.freeAvailable).toBe(false);
    expect(offers.beginOffer(1).quote).toEqual({ levelKey: '1', free: false, price: 900, step: 1 });
  });
});

describe('ContinueOfferRuntime — price ladder', () => {
  test('4–7. priced offers on one level: 900 → 1900 → 2900 → 2900 → 2900 (the last step repeats)', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    const prices = [1, 2, 3, 4, 5].map(() => offerAndResolve(offers, 12, 'continued'));
    expect(prices).toEqual([900, 1900, 2900, 2900, 2900]);
    expect(offers.snapshot()).toMatchObject({ levelKey: '12', offerCount: 5 });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '12', offerCount: 5 });
  });

  test('4. each new priced offer is one write of the whole record, taken when the offer OPENS (before any purchase)', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    const begun = offers.beginOffer(12);
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(await begun.saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '12', offerCount: 1 });
  });

  test('8. rewarded and paid continues share one ladder: the runtime never learns the payment, only the opening', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    // paid (coins) → rewarded (ad) → paid: the resolution is 'continued' for both
    expect(offerAndResolve(offers, 3, 'continued')).toBe(900);
    expect(offerAndResolve(offers, 3, 'continued')).toBe(1900);
    expect(offerAndResolve(offers, 3, 'continued')).toBe(2900);
  });

  test('9. a declined priced offer still used its step; resolving a priced offer writes nothing', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    offers.beginOffer(3);
    const before = writes(fake).length;
    const declined = offers.resolveOffer('declined');
    expect(declined).toMatchObject({ ok: true, reason: null, saved: null });
    expect(declined.quote).toEqual({ levelKey: '3', free: false, price: 900, step: 1 });
    expect(writes(fake).length).toBe(before);
    expect(offers.beginOffer(3).quote!.price).toBe(1900);
  });

  test('13. an offer on another level starts that level’s ladder; one level is remembered (no per-level history)', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    expect(offerAndResolve(offers, 3, 'continued')).toBe(900);
    expect(offerAndResolve(offers, 3, 'continued')).toBe(1900);
    expect(offerAndResolve(offers, 4, 'continued')).toBe(900);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '4', offerCount: 1 });
    // back on level 3: its count was forgotten when level 4 took the one slot
    expect(offerAndResolve(offers, 3, 'declined')).toBe(900);
  });

  test('nothing but another level resets the ladder: a replay of the same level later goes on climbing (donor rule)', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    expect(offerAndResolve(first.offers, 8, 'continued')).toBe(900);
    expect(offerAndResolve(first.offers, 8, 'declined')).toBe(1900);
    // the level ended (win / fail / restart are the host's, the runtime is not told), the game relaunched
    const second = await session(fake, { config: PRICED });
    expect(offerAndResolve(second.offers, 8, 'continued')).toBe(2900);
  });

  test('level keys: a number level and its decimal string are one level; string ids are kept as is', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    expect(offerAndResolve(offers, 7, 'continued')).toBe(900);
    expect(offerAndResolve(offers, '7', 'continued')).toBe(1900);
    expect(offerAndResolve(offers, 'classic-6', 'continued')).toBe(900);
    expect(offers.snapshot().levelKey).toBe('classic-6');
  });

  test('an invalid level is refused (invalid_level) and changes nothing', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    for (const level of [0, -1, 1.5, '', NaN, null, undefined, {}]) {
      expect(offers.beginOffer(level as unknown as number)).toEqual({ ok: false, reason: 'invalid_level', quote: null, reopened: false, saved: null });
    }
    expect(writes(fake)).toEqual([]);
    expect(offers.snapshot()).toMatchObject({ levelKey: null, offerCount: 0, offer: null });
  });
});

describe('ContinueOfferRuntime — the open offer', () => {
  test('10. beginOffer for the same open offer is idempotent: same quote, reopened, no step, no write', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    const first = offers.beginOffer(5);
    const again = offers.beginOffer(5);
    const third = offers.beginOffer('5');
    expect(again).toMatchObject({ ok: true, reopened: true, quote: first.quote });
    expect(third).toMatchObject({ ok: true, reopened: true, quote: first.quote });
    expect(again.saved).toBe(first.saved); // the step's own write, handed again
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(offers.snapshot().offerCount).toBe(1);
  });

  test('10. reopening the open FREE offer stays free and writes nothing', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake);
    offers.beginOffer(5);
    expect(offers.beginOffer(5)).toMatchObject({ ok: true, reopened: true, saved: null, quote: { free: true, price: 0 } });
    expect(writes(fake)).toEqual([]);
  });

  test('11. back from the shop (not enough coins): the offer shows again at the same price', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    expect(offerAndResolve(offers, 5, 'continued')).toBe(900);
    const opened = offers.beginOffer(5); // 1900; the player lacks coins → the host opens the shop
    expect(opened.quote!.price).toBe(1900);
    // the shop closes, the run is still lost: the host shows the offer again
    expect(offers.beginOffer(5).quote!.price).toBe(1900);
    expect(offers.currentQuote()!.price).toBe(1900);
    expect(offers.resolveOffer('continued').quote!.price).toBe(1900);
    expect(offers.beginOffer(5).quote!.price).toBe(2900);
  });

  test('12. a failed purchase / cancelled ad: the offer stays open, a retry is quoted the same', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    const opened = offers.beginOffer(5);
    // the platform purchase failed / the ad was not watched: the host does NOT resolve
    expect(offers.currentQuote()).toEqual(opened.quote);
    expect(offers.beginOffer(5).quote).toEqual(opened.quote);
    expect(offers.snapshot().offerCount).toBe(1);
  });

  test('resolveOffer without an open offer (a repeated resolve) → no_offer; an unknown resolution throws', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    expect(offers.resolveOffer('continued')).toEqual({ ok: false, reason: 'no_offer', quote: null, reopened: false, saved: null });
    offers.beginOffer(5);
    expect(offers.resolveOffer('declined').ok).toBe(true);
    expect(offers.resolveOffer('declined').reason).toBe('no_offer');
    expect(() => offers.resolveOffer('bought' as 'continued')).toThrow(TypeError);
  });

  test('an open offer of another level is dropped by a new offer (its step stays taken)', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    offers.beginOffer(5); // left open: the player went to the map
    expect(offers.beginOffer(6).quote).toEqual({ levelKey: '6', free: false, price: 900, step: 1 });
    expect(offers.currentQuote()!.levelKey).toBe('6');
    expect(offers.beginOffer(5).quote!.price).toBe(900); // level 6 took the one slot
  });

  test('an open free offer of another level is dropped for the free offer of the new level; nothing is used', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake);
    offers.beginOffer(5);
    expect(offers.beginOffer(6).quote).toEqual({ levelKey: '6', free: true, price: 0, step: 0 });
    expect(offers.snapshot().freeAvailable).toBe(true);
    expect(writes(fake)).toEqual([]);
  });

  test('the quotes handed out are copies: changing one changes nothing', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    const quote = offers.beginOffer(5).quote!;
    quote.price = 1;
    offers.currentQuote()!.price = 2;
    expect(offers.beginOffer(5).quote!.price).toBe(900);
    expect(offers.snapshot().offer!.price).toBe(900);
  });
});

describe('ContinueOfferRuntime — persistence', () => {
  test('14. a reload keeps the ladder and forgets the open offer: the next opening takes the next step', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    expect(offerAndResolve(first.offers, 9, 'continued')).toBe(900);
    await first.offers.beginOffer(9).saved; // 1900 opened, the process dies before any resolve
    const second = await session(fake, { config: PRICED });
    expect(second.loaded).toMatchObject({ status: 'ready', levelKey: '9', offerCount: 2, offer: null });
    expect(second.offers.beginOffer(9).quote).toEqual({ levelKey: '9', free: false, price: 2900, step: 3 });
  });

  test('the record lives in the Core namespace next to the other Core records, never in a game key', async () => {
    const fake = fakeStorage({ trail_state: { level: 9 }, [CORE_KEY]: { other: { keep: true } } });
    const { offers } = await session(fake, { config: PRICED });
    await offers.beginOffer(9).saved;
    expect(fake.data.trail_state).toEqual({ level: 9 });
    expect(fake.data[CORE_KEY]).toEqual({ other: { keep: true }, continueOffer: { v: 1, freeUsed: false, levelKey: '9', offerCount: 1 } });
  });

  test('15. a failed read → unavailable: nothing is quoted (no free, no first price), nothing is written', async () => {
    const fake = fakeStorage(stored(true, '9', 2));
    fake.failRead = true;
    const { offers, loaded } = await session(fake);
    expect(loaded).toMatchObject({ status: 'unavailable', problem: 'read_failed', writable: false, freeAvailable: null, levelKey: null, offerCount: null });
    expect(offers.beginOffer(9)).toEqual({ ok: false, reason: 'unavailable', quote: null, reopened: false, saved: null });
    expect(offers.resolveOffer('continued').reason).toBe('unavailable');
    expect(offers.save().reason).toBe('unavailable');
    expect(writes(fake)).toEqual([]);
  });

  test('15. a stored record that is not a V1 continue record → unavailable (invalid_record) and never overwritten', async () => {
    for (const bad of [
      { v: 2, freeUsed: true, levelKey: '9', offerCount: 2 },
      { v: 1, freeUsed: 'yes', levelKey: '9', offerCount: 2 },
      { v: 1, freeUsed: true, levelKey: 9, offerCount: 2 },
      { v: 1, freeUsed: true, levelKey: '', offerCount: 2 },
      { v: 1, freeUsed: true, levelKey: '9', offerCount: -1 },
      { v: 1, freeUsed: true, levelKey: '9' },
      [1, 2],
      'free'
    ]) {
      const fake = fakeStorage({ [CORE_KEY]: { continueOffer: bad } });
      const { offers, loaded } = await session(fake);
      expect(loaded).toMatchObject({ status: 'unavailable', problem: 'invalid_record' });
      expect(offers.beginOffer(9).reason).toBe('unavailable');
      expect(writes(fake)).toEqual([]);
      expect(continueRecord(fake)).toEqual(bad);
    }
  });

  test('before load / before gate.open() / after dispose: refused, nothing written', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const offers = new ContinueOfferRuntime({ gate, config: PRICED });
    expect(offers.beginOffer(1).reason).toBe('not_loaded');
    expect(offers.snapshot()).toMatchObject({ status: 'idle', writable: false, freeAvailable: null });
    await Promise.all([gate.load(), offers.load()]);
    expect(offers.beginOffer(1).reason).toBe('not_open');
    expect(offers.snapshot().offerCount).toBe(0);
    gate.open();
    expect(offers.beginOffer(1).quote!.price).toBe(900);
    offers.dispose();
    expect(offers.beginOffer(2).reason).toBe('disposed');
    expect(offers.resolveOffer('continued').reason).toBe('disposed');
    expect(offers.snapshot().writable).toBe(false);
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
  });

  test('16. a failed write: the quote stands in memory, saved says so, a reopen hands the same result, save() retries', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    fake.setMode = 'false';
    const begun = offers.beginOffer(9);
    expect(begun).toMatchObject({ ok: true, quote: { price: 900, step: 1 } });
    expect(await begun.saved).toEqual({ ok: false, reason: 'storage_refused' });
    expect(await offers.beginOffer(9).saved).toEqual({ ok: false, reason: 'storage_refused' });
    expect(continueRecord(fake)).toBeUndefined(); // not durable: a reload now would not know the step
    fake.setMode = 'reject';
    const retried = offers.save();
    expect(retried.ok).toBe(true);
    expect(retried.quote).toMatchObject({ price: 900 });
    expect(await retried.saved).toMatchObject({ ok: false, reason: 'storage_rejected' });
    fake.setMode = 'ok';
    expect(await offers.save().saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 1 });
  });

  test('16. a step whose write failed is carried by the next write; a reload before any write re-quotes the same step', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    fake.setMode = 'false';
    expect(offerAndResolve(first.offers, 9, 'continued')).toBe(900);
    fake.setMode = 'ok';
    // had the process died now, the step never landed: a new session knows nothing (honest — nothing was durable)
    const reloaded = await session(fake, { config: PRICED, open: false });
    expect(reloaded.loaded).toMatchObject({ status: 'ready', levelKey: null, offerCount: 0 });
    // the first session's memory kept the step: its next write carries both
    expect(first.offers.beginOffer(9).quote!.price).toBe(1900);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 2 });
  });

  test('16. a failed write of the free use: the memory says used (no second free this session); a reload may offer it again', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    first.offers.beginOffer(1);
    fake.setMode = 'false';
    expect(await first.offers.resolveOffer('continued').saved).toEqual({ ok: false, reason: 'storage_refused' });
    expect(first.offers.beginOffer(1).quote!.free).toBe(false);
    fake.setMode = 'ok';
    const second = await session(fake);
    expect(second.offers.snapshot().freeAvailable).toBe(true);
  });

  test('18. one Core record shared with LivesRuntime and SoftCurrencyWallet: each keeps its own record', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    const lives = new LivesRuntime({ gate, config: { maxLives: 5, regenSeconds: 1800, refundOnWin: true }, now: () => 1_727_000_000_000 });
    const offers = new ContinueOfferRuntime({ gate, config: PRICED });
    await Promise.all([gate.load(), wallet.load(), lives.load(), offers.load()]);
    gate.open();
    await lives.startAttempt().saved;
    const quote = offers.beginOffer(2);
    await quote.saved;
    await wallet.grant(900).saved;
    await wallet.trySpend(quote.quote!.price).saved; // the host charges; Core only quoted
    await offers.resolveOffer('continued').saved;
    const core = fake.data[CORE_KEY] as Record<string, unknown>;
    expect(core.wallet).toEqual({ v: 1, balance: 100, rewardedLevels: [] });
    expect(core.lives).toEqual({ v: 1, lives: 4, regenStart: 1_727_000_000_000, attempt: true });
    expect(core.continueOffer).toEqual({ v: 1, freeUsed: false, levelKey: '2', offerCount: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------
// Differential against the donor: Trail Arrow 0.1.31 `src/app/ContinuePrice.ts` (logic verbatim, over a plain
// resource map in place of app.model.resources, app.helpers.continuePrice session-only) + the price side of
// `ClientLogicSystem.buyOutOfSpaceSlots` (price 0 → markFreeContinueUsed + continuePrice = null). Rewarded and
// decline touch nothing in the donor. A reload keeps the resources and drops the helpers.
// ---------------------------------------------------------------------------------------------------------
interface DonorResources {
  out_of_space_free_used: number;
  continue_level: number;
  continue_count: number;
}

function donorContinue(resources: DonorResources) {
  const CONTINUE_PRICES = [900, 1900, 2900];
  const helpers = { continuePrice: null as number | null };
  const isFreeContinue = () => resources.out_of_space_free_used === 0;
  const markFreeContinueUsed = () => {
    resources.out_of_space_free_used = 1;
  };
  const beginContinueOffer = (level: number): number => {
    if (isFreeContinue()) {
      helpers.continuePrice = 0;
      return 0;
    }
    const sameLevel = resources.continue_level === level;
    const count = sameLevel ? resources.continue_count : 0;
    const price = CONTINUE_PRICES[Math.min(count, CONTINUE_PRICES.length - 1)] as number;
    resources.continue_level = level;
    resources.continue_count = count + 1;
    helpers.continuePrice = price;
    return price;
  };
  const currentContinuePrice = () => helpers.continuePrice ?? CONTINUE_PRICES[0];
  const buyOutOfSpaceSlots = () => {
    const price = currentContinuePrice();
    if (price === 0) {
      markFreeContinueUsed();
      helpers.continuePrice = null;
    }
  };
  return { resources, isFreeContinue, beginContinueOffer, currentContinuePrice, buyOutOfSpaceSlots };
}

/** A deterministic 32-bit LCG (no Math.random in the pinned sequences). */
function lcg(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

describe('ContinueOfferRuntime — differential against Trail Arrow 0.1.31 ContinuePrice.ts', () => {
  test('scripted: free → 900 → 1900 → 2900 → 2900, another level, back — the same prices as the donor', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: DONOR });
    const donor = donorContinue({ out_of_space_free_used: 0, continue_level: 0, continue_count: 0 });
    const script: Array<[number, 'buy' | 'ad' | 'decline']> = [
      [1, 'decline'], [1, 'buy'], [1, 'buy'], [1, 'ad'], [1, 'decline'], [1, 'buy'], [2, 'buy'], [2, 'decline'], [1, 'ad']
    ];
    const core: number[] = [];
    const donorPrices: number[] = [];
    for (const [level, action] of script) {
      donorPrices.push(donor.beginContinueOffer(level));
      if (action === 'buy') donor.buyOutOfSpaceSlots();
      core.push(offerAndResolve(offers, level, action === 'decline' ? 'declined' : 'continued'));
    }
    expect(donorPrices).toEqual([0, 0, 900, 1900, 2900, 2900, 900, 1900, 900]);
    expect(core).toEqual(donorPrices);
  });

  test.each([1, 7, 42, 2026, 90210])('seeded sequence %i: every opening, re-show and reload quotes what the donor quotes', async (seed) => {
    const fake = fakeStorage();
    const pick = lcg(seed);
    const resources: DonorResources = { out_of_space_free_used: 0, continue_level: 0, continue_count: 0 };
    let donor = donorContinue(resources);
    let { offers } = await session(fake, { config: DONOR });
    let pending: Array<Promise<SaveWriteResult> | null> = [];
    let open: number | null = null; // the donor's lost level with its window up
    const seen = { prices: new Set<number>(), reshows: 0, reloads: 0 };
    for (let i = 0; i < 400; i += 1) {
      if (open === null) {
        const roll = pick(10);
        if (roll === 0) {
          // reload: the donor keeps its profile resources, drops helpers; Core rereads its record
          seen.reloads += 1;
          await Promise.all(pending);
          pending = [];
          donor = donorContinue(resources);
          ({ offers } = await session(fake, { config: DONOR }));
          continue;
        }
        const level = 1 + pick(3);
        const price = donor.beginContinueOffer(level);
        const begun = offers.beginOffer(level);
        pending.push(begun.saved);
        expect(begun.reopened).toBe(false);
        expect(begun.quote!.price).toBe(price);
        expect(begun.quote!.free).toBe(price === 0);
        seen.prices.add(price);
        open = level;
      } else {
        const roll = pick(6);
        if (roll === 0) {
          // re-show (back from the shop, a failed purchase): the donor reads currentContinuePrice()
          const again = offers.beginOffer(open);
          expect(again.reopened).toBe(true);
          expect(again.quote!.price).toBe(donor.currentContinuePrice());
          seen.reshows += 1;
          continue;
        }
        if (roll === 1) {
          // the process dies with the window up: the donor keeps resources, Core rereads its record
          seen.reloads += 1;
          await Promise.all(pending);
          pending = [];
          donor = donorContinue(resources);
          ({ offers } = await session(fake, { config: DONOR }));
          open = null;
          continue;
        }
        const quote = offers.currentQuote()!;
        const action = roll === 2 ? 'decline' : roll === 3 && !quote.free ? 'ad' : 'buy'; // the donor has no ad button on the free offer
        if (action === 'buy') donor.buyOutOfSpaceSlots();
        const resolved = offers.resolveOffer(action === 'decline' ? 'declined' : 'continued');
        pending.push(resolved.saved);
        open = null;
      }
      const s = offers.snapshot();
      expect(s.freeAvailable).toBe(donor.isFreeContinue());
      expect(s.levelKey).toBe(resources.continue_level === 0 ? null : String(resources.continue_level));
      expect(s.offerCount).toBe(resources.continue_count);
    }
    await Promise.all(pending);
    // the sequence really went through the free offer, the whole ladder, re-shows and reloads
    expect([...seen.prices].sort((a, b) => a - b)).toEqual([0, 900, 1900, 2900]);
    expect(seen.reshows).toBeGreaterThan(0);
    expect(seen.reloads).toBeGreaterThan(0);
    // what is stored is what the donor profile holds (nothing stored = the donor's default resources)
    const final: unknown = continueRecord(fake) ?? { v: 1, freeUsed: false, levelKey: null, offerCount: 0 };
    expect(final).toEqual({
      v: 1,
      freeUsed: resources.out_of_space_free_used === 1,
      levelKey: resources.continue_level === 0 ? null : String(resources.continue_level),
      offerCount: resources.continue_count
    });
  });
});
