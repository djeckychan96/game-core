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
/** V1.1: the open offer stored next to the ladder. */
const paidQuote = (levelKey: string, price: number, step: number) => ({ levelKey, free: false, price, step });
const freeQuote = (levelKey: string) => ({ levelKey, free: true, price: 0, step: 0 });

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
  test('1. a fresh profile: the first quote is free — price 0, step 0, no step taken (V1.1: the open offer is written)', async () => {
    const fake = fakeStorage();
    const { offers, loaded } = await session(fake);
    expect(loaded).toMatchObject({ status: 'ready', freeAvailable: true, levelKey: null, offerCount: 0, offer: null });
    const begun = offers.beginOffer(4);
    expect(begun).toMatchObject({ ok: true, reason: null, reopened: false });
    expect(begun.quote).toEqual({ levelKey: '4', free: true, price: 0, step: 0 });
    expect(offers.currentQuote()).toEqual(begun.quote);
    expect(await begun.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: null, offerCount: 0, open: freeQuote('4') });
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

  test('3. a declined free offer stays free: freeUsed never set, the next offer is free again (also after a reload)', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    expect(offerAndResolve(first.offers, 4, 'declined')).toBe(0);
    expect(offerAndResolve(first.offers, 4, 'declined')).toBe(0);
    expect(offerAndResolve(first.offers, 5, 'declined')).toBe(0);
    // V1.1: each open and each close is written; the ladder and the free continue are untouched
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: null, offerCount: 0 });
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
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '12', offerCount: 1, open: paidQuote('12', 900, 1) });
  });

  test('8. rewarded and paid continues share one ladder: the runtime never learns the payment, only the opening', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    // paid (coins) → rewarded (ad) → paid: the resolution is 'continued' for both
    expect(offerAndResolve(offers, 3, 'continued')).toBe(900);
    expect(offerAndResolve(offers, 3, 'continued')).toBe(1900);
    expect(offerAndResolve(offers, 3, 'continued')).toBe(2900);
  });

  test('9. a declined priced offer still used its step; resolving it only closes the offer (V1.1: one write)', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    offers.beginOffer(3);
    const before = writes(fake).length;
    const declined = offers.resolveOffer('declined');
    expect(declined).toMatchObject({ ok: true, reason: null });
    expect(declined.quote).toEqual({ levelKey: '3', free: false, price: 900, step: 1 });
    expect(await declined.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake).length).toBe(before + 1);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '3', offerCount: 1 });
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

  test('10. reopening the open FREE offer stays free and writes nothing more (V1.1: only its opening was written)', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake);
    const first = offers.beginOffer(5);
    const again = offers.beginOffer(5);
    expect(again).toMatchObject({ ok: true, reopened: true, quote: { free: true, price: 0 } });
    expect(again.saved).toBe(first.saved);
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
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
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: null, offerCount: 0, open: freeQuote('6') });
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
  test('14. a reload keeps the ladder; a NEW offer after it takes the next step (the stored open one is abandoned)', async () => {
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
    expect(fake.data[CORE_KEY]).toEqual({ other: { keep: true }, continueOffer: { v: 1, freeUsed: false, levelKey: '9', offerCount: 1, open: paidQuote('9', 900, 1) } });
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
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 1, open: paidQuote('9', 900, 1) });
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
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 2, open: paidQuote('9', 1900, 2) });
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

describe('ContinueOfferRuntime V1.1 — durable open offer, resume after a reload', () => {
  const NO_OFFER = { ok: false, reason: 'no_offer', quote: null, reopened: false, saved: null };

  test('R1. paid 900 → reload → resumeOffer: the same quote, 900 at step 1', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    const begun = first.offers.beginOffer(9);
    expect(await begun.saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 1, open: paidQuote('9', 900, 1) });
    const second = await session(fake, { config: PRICED });
    expect(second.loaded).toMatchObject({ status: 'ready', levelKey: '9', offerCount: 1, offer: null }); // stored, not resumed yet
    expect(second.offers.resumeOffer(9)).toEqual({ ok: true, reason: null, quote: paidQuote('9', 900, 1), reopened: true, saved: null });
    expect(second.offers.currentQuote()).toEqual(paidQuote('9', 900, 1));
  });

  test('R2. resumeOffer takes no step and writes nothing: offerCount and the stored record stay as they were', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    expect(offerAndResolve(first.offers, 9, 'continued')).toBe(900);
    await first.offers.beginOffer(9).saved; // 1900 open, the process dies
    const second = await session(fake, { config: PRICED });
    const before = { writes: writes(fake).length, record: continueRecord(fake) };
    expect(second.offers.resumeOffer('9').quote).toEqual(paidQuote('9', 1900, 2));
    expect(second.offers.snapshot()).toMatchObject({ levelKey: '9', offerCount: 2, offer: paidQuote('9', 1900, 2) });
    expect(writes(fake).length).toBe(before.writes);
    expect(continueRecord(fake)).toEqual(before.record);
  });

  test('R3. a repeated resume answers the same quote; a re-show by beginOffer after it is a reopen (no step, no write)', async () => {
    const fake = fakeStorage();
    await (await session(fake, { config: PRICED })).offers.beginOffer(9).saved;
    const { offers } = await session(fake, { config: PRICED });
    const writesBefore = writes(fake).length;
    const results = [offers.resumeOffer(9), offers.resumeOffer(9), offers.resumeOffer('9')];
    for (const result of results) expect(result).toEqual({ ok: true, reason: null, quote: paidQuote('9', 900, 1), reopened: true, saved: null });
    // back from the shop in the resumed run: the host re-shows with beginOffer — the same offer
    expect(offers.beginOffer(9)).toEqual({ ok: true, reason: null, quote: paidQuote('9', 900, 1), reopened: true, saved: null });
    expect(offers.snapshot().offerCount).toBe(1);
    expect(writes(fake).length).toBe(writesBefore);
  });

  test('R4. resolveOffer(continued) closes the open offer durably: one write, the record loses `open`', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    await offers.beginOffer(9).saved;
    const before = writes(fake).length;
    const resolved = offers.resolveOffer('continued');
    expect(resolved).toMatchObject({ ok: true, reason: null, quote: paidQuote('9', 900, 1), reopened: false });
    expect(await resolved.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake).length).toBe(before + 1);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 1 });
  });

  test('R5. resolveOffer(declined) of a RESUMED offer closes it durably too', async () => {
    const fake = fakeStorage();
    await (await session(fake, { config: PRICED })).offers.beginOffer(9).saved;
    const { offers } = await session(fake, { config: PRICED });
    offers.resumeOffer(9);
    const declined = offers.resolveOffer('declined');
    expect(declined.quote).toEqual(paidQuote('9', 900, 1));
    expect(await declined.saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 1 });
    expect(offers.resolveOffer('declined')).toEqual(NO_OFFER);
  });

  test('R6. a resolved offer is gone after a reload: resumeOffer → no_offer (continued and declined), nothing written', async () => {
    for (const resolution of ['continued', 'declined'] as const) {
      const fake = fakeStorage();
      const first = await session(fake, { config: PRICED });
      first.offers.beginOffer(9);
      await first.offers.resolveOffer(resolution).saved;
      const second = await session(fake, { config: PRICED });
      const before = writes(fake).length;
      expect(second.offers.resumeOffer(9)).toEqual(NO_OFFER);
      expect(second.offers.currentQuote()).toBeNull();
      expect(writes(fake).length).toBe(before);
    }
  });

  test('R7. after a resolved 900 (and a reload) the next NEW offer is 1900', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    first.offers.beginOffer(9);
    await first.offers.resolveOffer('continued').saved;
    const { offers } = await session(fake, { config: PRICED });
    expect(offers.resumeOffer(9).reason).toBe('no_offer');
    expect(offers.beginOffer(9)).toMatchObject({ ok: true, reopened: false, quote: paidQuote('9', 1900, 2) });
  });

  test('R8. open 900 → reload → the host says NEW attempt → beginOffer: the stored offer is abandoned, 1900 is the new one', async () => {
    const fake = fakeStorage();
    await (await session(fake, { config: PRICED })).offers.beginOffer(9).saved;
    const second = await session(fake, { config: PRICED });
    const begun = second.offers.beginOffer(9);
    expect(begun).toMatchObject({ ok: true, reopened: false, quote: paidQuote('9', 1900, 2) });
    expect(await begun.saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 2, open: paidQuote('9', 1900, 2) });
    // the abandoned 900 is not resumable any more: in this session and after the next reload the open offer is 1900
    expect(second.offers.resumeOffer(9).quote).toEqual(paidQuote('9', 1900, 2));
    expect((await session(fake, { config: PRICED })).offers.resumeOffer(9).quote).toEqual(paidQuote('9', 1900, 2));
  });

  test('R9. a free open offer survives a reload: resumeOffer → the same free quote, nothing written, free still available', async () => {
    const fake = fakeStorage();
    await (await session(fake)).offers.beginOffer(4).saved;
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: null, offerCount: 0, open: freeQuote('4') });
    const { offers, loaded } = await session(fake);
    expect(loaded.freeAvailable).toBe(true);
    const before = writes(fake).length;
    expect(offers.resumeOffer(4)).toEqual({ ok: true, reason: null, quote: freeQuote('4'), reopened: true, saved: null });
    expect(writes(fake).length).toBe(before);
    expect(offers.snapshot()).toMatchObject({ freeAvailable: true, offerCount: 0, levelKey: null });
  });

  test('R10. a declined free offer, or an abandoned free one: after a reload the next new offer is free again', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    first.offers.beginOffer(4);
    await first.offers.resolveOffer('declined').saved;
    const second = await session(fake);
    expect(second.offers.resumeOffer(4)).toEqual(NO_OFFER);
    const begun = second.offers.beginOffer(4); // left open, the process dies
    expect(begun.quote).toEqual(freeQuote('4'));
    await begun.saved;
    const third = await session(fake); // the host says NEW attempt: the stored free offer is abandoned, still free
    expect(third.offers.beginOffer(4)).toMatchObject({ ok: true, reopened: false, quote: freeQuote('4') });
    expect(third.offers.snapshot().freeAvailable).toBe(true);
  });

  test('R11. a RESUMED free offer continued: freeUsed is durable true and the offer closed, in one write', async () => {
    const fake = fakeStorage();
    await (await session(fake)).offers.beginOffer(4).saved;
    const { offers } = await session(fake);
    offers.resumeOffer(4);
    const before = writes(fake).length;
    const resolved = offers.resolveOffer('continued');
    expect(resolved.quote).toEqual(freeQuote('4'));
    expect(await resolved.saved).toEqual({ ok: true, reason: null });
    expect(writes(fake).length).toBe(before + 1);
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: true, levelKey: null, offerCount: 0 });
    expect((await session(fake)).loaded.freeAvailable).toBe(false);
  });

  test('R12. after the free continue the next real offer is the first paid step, 900 (also after a reload)', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    first.offers.beginOffer(4);
    await first.offers.resolveOffer('continued').saved;
    expect(first.offers.beginOffer(4).quote).toEqual(paidQuote('4', 900, 1));
    const other = fakeStorage(fake.data);
    const second = await session(other);
    expect(second.offers.resumeOffer(4).quote).toEqual(paidQuote('4', 900, 1));
    const fresh = fakeStorage({ [CORE_KEY]: { continueOffer: { v: 1, freeUsed: true, levelKey: null, offerCount: 0 } } });
    expect((await session(fresh)).offers.beginOffer(4).quote).toEqual(paidQuote('4', 900, 1));
  });

  test('R13. same session: beginOffer again for the open offer → the same quote, no step, no second write', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    const first = offers.beginOffer(9);
    for (const again of [offers.beginOffer(9), offers.beginOffer('9'), offers.beginOffer(9)]) {
      expect(again).toMatchObject({ ok: true, reopened: true, quote: first.quote });
      expect(again.saved).toBe(first.saved);
    }
    expect(offers.snapshot().offerCount).toBe(1);
    expect(writes(fake)).toEqual([`set:${CORE_KEY}`]);
  });

  test('R14. resumeOffer for another level → other_level: nothing changes, the right level still resumes', async () => {
    const fake = fakeStorage();
    await (await session(fake, { config: PRICED })).offers.beginOffer(9).saved;
    const { offers } = await session(fake, { config: PRICED });
    const record = continueRecord(fake);
    const before = writes(fake).length;
    expect(offers.resumeOffer(10)).toEqual({ ok: false, reason: 'other_level', quote: null, reopened: false, saved: null });
    expect(offers.resumeOffer(0).reason).toBe('invalid_level');
    expect(offers.snapshot()).toMatchObject({ offer: null, levelKey: '9', offerCount: 1 });
    expect(writes(fake).length).toBe(before);
    expect(continueRecord(fake)).toEqual(record);
    expect(offers.resumeOffer(9).quote).toEqual(paidQuote('9', 900, 1));
    // the offer this session holds: another level is refused the same way, the open one stays
    expect(offers.resumeOffer(10).reason).toBe('other_level');
    expect(offers.currentQuote()).toEqual(paidQuote('9', 900, 1));
  });

  test('R15. a stored open offer of another level + beginOffer on a new level: that level’s ladder from its first step', async () => {
    const fake = fakeStorage();
    const first = await session(fake, { config: PRICED });
    expect(offerAndResolve(first.offers, 9, 'continued')).toBe(900);
    await first.offers.beginOffer(9).saved; // 1900 open on level 9, the process dies
    const { offers } = await session(fake, { config: PRICED });
    const begun = offers.beginOffer(10);
    expect(begun).toMatchObject({ ok: true, reopened: false, quote: paidQuote('10', 900, 1) });
    await begun.saved;
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '10', offerCount: 1, open: paidQuote('10', 900, 1) });
    expect(offers.resumeOffer(9).reason).toBe('other_level');
    // the free variant: a stored free offer of level 9, a new offer on level 10 is free and uses nothing
    const freeFake = fakeStorage();
    await (await session(freeFake)).offers.beginOffer(9).saved;
    const free = await session(freeFake);
    expect(free.offers.beginOffer(10).quote).toEqual(freeQuote('10'));
    expect(free.offers.snapshot().freeAvailable).toBe(true);
  });

  test('R16. a failed OPEN write: the quote stands, saved says so, nothing durable (a reload re-quotes the same step); save() carries it', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    fake.setMode = 'false';
    const begun = offers.beginOffer(9);
    expect(begun).toMatchObject({ ok: true, quote: paidQuote('9', 900, 1) });
    expect(await begun.saved).toEqual({ ok: false, reason: 'storage_refused' });
    expect(continueRecord(fake)).toBeUndefined();
    fake.setMode = 'ok';
    // a reload now knows nothing: the restored run is not resumable, the host begins — the same step 1, 900
    const probe = await session(fakeStorage(fake.data), { config: PRICED });
    expect(probe.offers.resumeOffer(9)).toEqual(NO_OFFER);
    expect(probe.offers.beginOffer(9).quote).toEqual(paidQuote('9', 900, 1));
    // the session that failed keeps the offer in memory; its next write makes it durable
    expect(await offers.save().saved).toEqual({ ok: true, reason: null });
    expect((await session(fake, { config: PRICED })).offers.resumeOffer(9).quote).toEqual(paidQuote('9', 900, 1));
  });

  test('R16. a failed open write over an older stored offer: a reload may resume the OLDER (cheaper) quote — never a higher one', async () => {
    const fake = fakeStorage();
    await (await session(fake, { config: PRICED })).offers.beginOffer(9).saved; // 900 stored open
    const second = await session(fake, { config: PRICED });
    fake.setMode = 'false';
    const begun = second.offers.beginOffer(9); // the host says NEW attempt: 1900, not durable
    expect(begun.quote).toEqual(paidQuote('9', 1900, 2));
    expect(await begun.saved).toEqual({ ok: false, reason: 'storage_refused' });
    fake.setMode = 'ok';
    expect((await session(fake, { config: PRICED })).offers.resumeOffer(9).quote).toEqual(paidQuote('9', 900, 1));
  });

  test('R17. a failed CLOSE write after the continue was delivered: the closed offer may come back after a reload (the player’s window), save() carries the close', async () => {
    const fake = fakeStorage();
    const { offers } = await session(fake, { config: PRICED });
    await offers.beginOffer(9).saved;
    fake.setMode = 'false';
    const resolved = offers.resolveOffer('continued'); // the host already gave the moves back
    expect(resolved.quote).toEqual(paidQuote('9', 900, 1));
    expect(await resolved.saved).toEqual({ ok: false, reason: 'storage_refused' });
    expect(offers.currentQuote()).toBeNull(); // this session knows it is closed
    expect(offers.resolveOffer('continued')).toEqual(NO_OFFER);
    fake.setMode = 'ok';
    // a reload before any other write: the stored offer is still open — the SAME step, no new one, Core charged nothing
    const reloaded = await session(fakeStorage(fake.data), { config: PRICED });
    expect(reloaded.offers.resumeOffer(9).quote).toEqual(paidQuote('9', 900, 1));
    expect(reloaded.offers.snapshot().offerCount).toBe(1);
    // the session's next write carries the close
    expect(await offers.save().saved).toEqual({ ok: true, reason: null });
    expect(continueRecord(fake)).toEqual({ v: 1, freeUsed: false, levelKey: '9', offerCount: 1 });
    // the free variant: a lost close of a continued free offer — after a reload the free offer is open again
    const freeFake = fakeStorage();
    const free = await session(freeFake);
    await free.offers.beginOffer(4).saved;
    freeFake.setMode = 'false';
    await free.offers.resolveOffer('continued').saved;
    freeFake.setMode = 'ok';
    const freeReloaded = await session(freeFake);
    expect(freeReloaded.loaded.freeAvailable).toBe(true);
    expect(freeReloaded.offers.resumeOffer(4).quote).toEqual(freeQuote('4'));
  });

  test('R18. a V1 record (no `open`) loads unchanged: no open offer, ladder and free kept; the next write adds `open`, v stays 1', async () => {
    const fake = fakeStorage(stored(false, '9', 2));
    const { offers, loaded } = await session(fake);
    expect(loaded).toMatchObject({ status: 'ready', freeAvailable: true, levelKey: '9', offerCount: 2, offer: null });
    expect(offers.resumeOffer(9)).toEqual(NO_OFFER);
    const priced = fakeStorage(stored(true, '9', 2));
    const second = await session(priced);
    expect(second.loaded).toMatchObject({ status: 'ready', freeAvailable: false, levelKey: '9', offerCount: 2 });
    expect(second.offers.resumeOffer(9).reason).toBe('no_offer');
    await second.offers.beginOffer(9).saved;
    expect(continueRecord(priced)).toEqual({ v: 1, freeUsed: true, levelKey: '9', offerCount: 3, open: paidQuote('9', 2900, 3) });
  });

  test('R18. a stored `open` that is not an offer → unavailable (invalid_record), never overwritten', async () => {
    for (const open of [
      null,
      'open',
      { levelKey: '9', free: true, price: 900, step: 1 },
      { levelKey: '9', free: false, price: 0, step: 1 },
      { levelKey: '9', free: false, price: 900, step: 0 },
      { levelKey: 9, free: false, price: 900, step: 1 },
      { levelKey: '', free: true, price: 0, step: 0 },
      { levelKey: '9', free: 'no', price: 900, step: 1 },
      { levelKey: '9', free: false, price: 900.5, step: 1 },
      { levelKey: '9', free: false, step: 1 }
    ]) {
      const bad = { v: 1, freeUsed: false, levelKey: '9', offerCount: 1, open };
      const fake = fakeStorage({ [CORE_KEY]: { continueOffer: bad } });
      const { offers, loaded } = await session(fake);
      expect(loaded).toMatchObject({ status: 'unavailable', problem: 'invalid_record' });
      expect(offers.resumeOffer(9).reason).toBe('unavailable');
      expect(offers.beginOffer(9).reason).toBe('unavailable');
      expect(writes(fake)).toEqual([]);
      expect(continueRecord(fake)).toEqual(bad);
    }
  });

  test('R19. a failed read → unavailable: resumeOffer refused too, the stored open offer untouched; refusals before load / open / after dispose', async () => {
    const fake = fakeStorage({ [CORE_KEY]: { continueOffer: { v: 1, freeUsed: false, levelKey: '9', offerCount: 1, open: paidQuote('9', 900, 1) } } });
    fake.failRead = true;
    const { offers, loaded } = await session(fake);
    expect(loaded).toMatchObject({ status: 'unavailable', problem: 'read_failed', offer: null });
    expect(offers.resumeOffer(9)).toEqual({ ok: false, reason: 'unavailable', quote: null, reopened: false, saved: null });
    expect(writes(fake)).toEqual([]);
    expect(continueRecord(fake)).toMatchObject({ open: paidQuote('9', 900, 1) });
    fake.failRead = false;
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const later = new ContinueOfferRuntime({ gate, config: PRICED });
    expect(later.resumeOffer(9).reason).toBe('not_loaded');
    await Promise.all([gate.load(), later.load()]);
    expect(later.resumeOffer(9).reason).toBe('not_open');
    gate.open();
    later.dispose();
    expect(later.resumeOffer(9).reason).toBe('disposed');
  });

  test('R20. Lives + Wallet + Continue in one Core record: the open attempt and the open offer both resume after a reload', async () => {
    const fake = fakeStorage();
    const livesConfig = { maxLives: 5, regenSeconds: 1800, refundOnWin: true };
    const now = () => 1_727_000_000_000;
    const boot = async () => {
      const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
      const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
      const lives = new LivesRuntime({ gate, config: livesConfig, now });
      const offers = new ContinueOfferRuntime({ gate, config: PRICED });
      await Promise.all([gate.load(), wallet.load(), lives.load(), offers.load()]);
      gate.open();
      return { wallet, lives, offers };
    };
    const first = await boot();
    await first.lives.startAttempt().saved;
    await first.wallet.grant(900).saved;
    await first.offers.beginOffer(2).saved; // the run is lost, 900 shown; the process dies
    const second = await boot(); // the gameplay restored the lost run
    expect(second.lives.resumeAttempt().ok).toBe(true);
    const { quote } = second.offers.resumeOffer(2);
    expect(quote).toEqual(paidQuote('2', 900, 1));
    await second.wallet.trySpend(quote!.price).saved; // the host charges; Core only quoted
    await second.offers.resolveOffer('continued').saved;
    const core = fake.data[CORE_KEY] as Record<string, unknown>;
    expect(core.wallet).toEqual({ v: 1, balance: 100, rewardedLevels: [] });
    expect(core.lives).toEqual({ v: 1, lives: 4, regenStart: 1_727_000_000_000, attempt: true }); // one life for the one attempt
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
    let durable: ReturnType<ContinueOfferRuntime['currentQuote']> = null; // V1.1: the open offer the record holds (a reload keeps it)
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
        durable = begun.quote;
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
        durable = null;
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
      offerCount: resources.continue_count,
      ...(durable ? { open: durable } : {}) // V1.1: an offer left open (also across a reload) is stored with its quote
    });
  });
});
