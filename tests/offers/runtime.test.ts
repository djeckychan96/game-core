// OfferRuntime as a Game Core module: update cadence, one transition per update, events,
// blocked_no_price once per lifetime, purchase semantics, clamp, stats, error isolation, and the
// CoreRuntime contract. Scenarios reconstructed from Trail Arrow's OfferChainSystem /
// DataUpdateSystem (see fixtures.ts).
import { describe, expect, test, vi } from 'vitest';
import { CoreRuntime } from '../../src/core/CoreRuntime';
import { OfferRuntime } from '../../src/offers/OfferRuntime';
import type { OfferChainInput, OfferEvent, OfferRuntimeOptions } from '../../src/offers/types';
import { DAY, HOUR, T0, makeConfig, makeState } from './fixtures';

interface Harness {
  runtime: OfferRuntime;
  state: ReturnType<typeof makeState>;
  events: OfferEvent[];
  clock: { now: number };
  level: { value: number };
  catalog: Set<string>;
  owned: { value: boolean };
  hasPrice: ReturnType<typeof vi.fn>;
}

function harness(options: Partial<OfferRuntimeOptions> & { initial?: Parameters<typeof makeState>[0]; priced?: boolean } = {}): Harness {
  const clock = { now: T0 };
  const level = { value: 19 };
  const owned = { value: false };
  const catalog = new Set<string>(options.priced === false ? [] : ['starter_pack', 'offer_t1_a', 'offer_t1_b', 'offer_t2_a', 'offer_t2_b', 'offer_t3_a', 'offer_t3_b', 'offer_t4_a', 'offer_t4_b', 'offer_t5_a', 'offer_t5_b', 'offer_t6_a', 'offer_t6_b']);
  const hasPrice = vi.fn((id: string) => catalog.has(id));
  const events: OfferEvent[] = [];
  const state = makeState(options.initial ?? {});
  const input: OfferChainInput = { now: () => clock.now, level: () => level.value, hasPrice, welcomeOwned: () => owned.value };
  const runtime = new OfferRuntime({
    config: makeConfig(),
    state,
    input,
    onEvent: (event) => events.push(event),
    ...(options.tickIntervalMs !== undefined ? { tickIntervalMs: options.tickIntervalMs } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.onOfferError ? { onOfferError: options.onOfferError } : {})
  });
  return { runtime, state, events, clock, level, catalog, owned, hasPrice };
}

const types = (events: OfferEvent[]) => events.map((e) => e.type);

describe('OfferRuntime — update cadence (the donor ticks once per second of frame time)', () => {
  test('the very first update ticks at once (donor: lastCheckMs = 0) and activates the welcome', () => {
    const h = harness();
    expect(h.runtime.update(16)).toBe(true);
    expect(h.runtime.getActive()?.productId).toBe('starter_pack');
    expect(types(h.events)).toEqual(['activated']);
    expect(h.runtime.getStats().ticks).toBe(1);
  });

  test('after a tick, frames accumulate: 999 ms → no tick, 1000 ms → tick', () => {
    const h = harness();
    h.runtime.update(16); // first tick
    for (let i = 0; i < 999; i++) h.runtime.update(1);
    expect(h.runtime.getStats().ticks).toBe(1);
    h.runtime.update(1);
    expect(h.runtime.getStats().ticks).toBe(2);
    for (let i = 0; i < 62; i++) h.runtime.update(16); // 992 ms
    expect(h.runtime.getStats().ticks).toBe(2);
    h.runtime.update(16);
    expect(h.runtime.getStats().ticks).toBe(3);
  });

  test('a huge frame (tab was hidden) yields exactly one tick → one transition, never a collapsed catch-up', () => {
    const h = harness();
    h.runtime.update(16); // welcome active
    h.clock.now = T0 + 12 * HOUR + 3 * DAY; // the welcome expired long ago AND the decline cooldown would be over
    expect(h.runtime.update(60 * 60 * 1000)).toBe(true);
    expect(h.runtime.getStats().ticks).toBe(2);
    expect(h.state.get('welcome')).toBe(2);
    expect(h.runtime.getActive()).toBeNull(); // only the expiry happened
    expect(types(h.events)).toEqual(['activated', 'expired']);
    // the next tick (a second of frame time later) does the activation, at the observed clock
    expect(h.runtime.update(500)).toBe(false);
    h.clock.now += 2 * DAY;
    expect(h.runtime.update(500)).toBe(true);
    expect(h.runtime.getActive()?.productId).toBe('offer_t1_a');
  });

  test('update returns true only when the chain state changed; non-finite or negative frames count as 0', () => {
    const h = harness();
    expect(h.runtime.update(Number.NaN)).toBe(true); // the initial accumulator already reached the interval
    expect(h.runtime.update(Number.NaN)).toBe(false);
    expect(h.runtime.update(-5000)).toBe(false);
    expect(h.runtime.update(Number.POSITIVE_INFINITY)).toBe(false);
    expect(h.runtime.getStats().ticks).toBe(1);
    expect(h.runtime.update(1000)).toBe(false); // ticked, nothing to do while the welcome runs
    expect(h.runtime.getStats().ticks).toBe(2);
  });

  test('tickIntervalMs is configurable; 0 ticks on every update; invalid values throw', () => {
    const fast = harness({ tickIntervalMs: 0 });
    fast.runtime.update(1);
    fast.runtime.update(1);
    fast.runtime.update(1);
    expect(fast.runtime.getStats().ticks).toBe(3);
    const slow = harness({ tickIntervalMs: 5000 });
    slow.runtime.update(16);
    slow.runtime.update(4900);
    expect(slow.runtime.getStats().ticks).toBe(1);
    slow.runtime.update(100);
    expect(slow.runtime.getStats().ticks).toBe(2);
    expect(() => harness({ tickIntervalMs: -1 })).toThrow(RangeError);
    expect(() => harness({ tickIntervalMs: Number.NaN })).toThrow(RangeError);
  });

  test('frame time never feeds a deadline: with the injected clock frozen, hours of frames change nothing', () => {
    const h = harness();
    h.runtime.update(16);
    const until = h.state.get('until');
    for (let i = 0; i < 3 * 3600; i++) h.runtime.update(1000); // 3 h of frames, clock frozen
    expect(h.state.get('until')).toBe(until);
    expect(h.runtime.secondsLeft()).toBe(12 * HOUR);
    expect(h.runtime.getActive()?.productId).toBe('starter_pack');
  });
});

describe('OfferRuntime — events', () => {
  test('a full life: activated → expired → activated (T1 A) → purchased(moved) → activated (T2 A), each with level and now', () => {
    const h = harness();
    h.runtime.update(16);
    h.clock.now = T0 + 12 * HOUR;
    h.runtime.tick();
    h.clock.now += 2 * DAY;
    h.runtime.tick();
    expect(h.runtime.onPurchased('offer_t1_a')).toBe(true);
    h.clock.now += DAY;
    h.runtime.tick();
    expect(h.events).toEqual([
      { type: 'activated', offer: h.runtime.offerByProduct('starter_pack'), level: 19, now: T0 },
      { type: 'expired', offer: h.runtime.offerByProduct('starter_pack'), level: 19, now: T0 + 12 * HOUR },
      { type: 'activated', offer: h.runtime.offerByProduct('offer_t1_a'), level: 19, now: T0 + 12 * HOUR + 2 * DAY },
      { type: 'purchased', offer: h.runtime.offerByProduct('offer_t1_a'), moved: true, level: 19, now: T0 + 12 * HOUR + 2 * DAY },
      { type: 'activated', offer: h.runtime.offerByProduct('offer_t2_a'), level: 19, now: T0 + 12 * HOUR + 3 * DAY }
    ]);
  });

  test('expired names the offer that was on screen (the donor diffed activeOffer(), which is already null at the expiry moment)', () => {
    const h = harness({ initial: { welcome: 2, activeTier: 4, activeVariant: 1, seenMask: 0b1111, until: T0 + 10 } });
    h.clock.now = T0 + 10;
    expect(h.runtime.tick()).toBe(true);
    expect(h.events).toEqual([{ type: 'expired', offer: h.runtime.offerByProduct('offer_t4_b'), level: 19, now: T0 + 10 }]);
  });

  test('skipping an owned welcome changes state without an activated/expired event (nothing was on screen)', () => {
    const h = harness();
    h.owned.value = true;
    expect(h.runtime.update(16)).toBe(true);
    expect(h.events).toEqual([]);
    expect(h.state.get('nextTier')).toBe(2);
  });

  test('purchased carries moved=false for a foreign chain product; a non-chain product returns false without an event', () => {
    const h = harness();
    h.runtime.update(16); // welcome active
    expect(h.runtime.onPurchased('offer_t3_a')).toBe(false);
    expect(h.runtime.onPurchased('gold_purchase_1')).toBe(false);
    expect(h.events.slice(1)).toEqual([{ type: 'purchased', offer: h.runtime.offerByProduct('offer_t3_a'), moved: false, level: 19, now: T0 }]);
    expect(h.runtime.getStats().purchases).toBe(1);
    expect(h.runtime.getActive()?.productId).toBe('starter_pack');
  });

  test('blocked_no_price fires once per runtime lifetime, even across many blocked ticks and later state changes', () => {
    const h = harness({ priced: false });
    for (let i = 0; i < 5; i++) {
      h.runtime.update(1000);
    }
    expect(h.events).toEqual([{ type: 'blocked_no_price', level: 19, now: T0 }]);
    // the catalog appears: the welcome activates, expires, and the ladder is blocked again — no second event
    h.catalog.add('starter_pack');
    h.runtime.update(1000);
    expect(types(h.events)).toEqual(['blocked_no_price', 'activated']);
    h.clock.now = T0 + 12 * HOUR;
    h.runtime.update(1000);
    h.clock.now += 2 * DAY;
    for (let i = 0; i < 3; i++) h.runtime.update(1000);
    expect(types(h.events)).toEqual(['blocked_no_price', 'activated', 'expired']);
    expect(h.runtime.getStats().blockedReported).toBe(true);
    // a new runtime over the same state reports it again
    const again: OfferEvent[] = [];
    const fresh = new OfferRuntime({ config: makeConfig(), state: h.state, input: { now: () => h.clock.now, level: () => 19, hasPrice: () => false, welcomeOwned: () => false }, onEvent: (e) => again.push(e) });
    fresh.update(16);
    expect(types(again)).toEqual(['blocked_no_price']);
  });

  test('blocked_no_price is not reported while the chain is merely waiting (cooldown, level gate, active offer)', () => {
    const h = harness({ priced: false });
    h.level.value = 3;
    h.runtime.update(1000);
    expect(h.events).toEqual([]);
    h.level.value = 19;
    h.owned.value = true;
    h.runtime.update(1000); // owned welcome → cooldown 24 h
    h.runtime.update(1000);
    expect(h.events).toEqual([]);
    h.clock.now += DAY;
    h.runtime.update(1000);
    expect(types(h.events)).toEqual(['blocked_no_price']);
  });

  test('a throwing onEvent is isolated: reported to onOfferError, counted, the state and the return value unaffected', () => {
    const reported: unknown[] = [];
    const h = harness({
      onEvent: () => {
        throw new Error('analytics down');
      },
      onOfferError: (error, context) => reported.push({ error, context })
    });
    expect(h.runtime.update(16)).toBe(true);
    expect(h.runtime.getActive()?.productId).toBe('starter_pack');
    expect(reported).toHaveLength(1);
    expect((reported[0] as { context: { phase: string; event: OfferEvent } }).context).toMatchObject({ phase: 'onEvent', event: { type: 'activated' } });
    expect(h.runtime.getStats().callbackErrors).toBe(1);
    expect(h.runtime.onPurchased('starter_pack')).toBe(true);
    expect(h.runtime.getStats().callbackErrors).toBe(2);
  });

  test('a throwing onOfferError is swallowed too', () => {
    const h = harness({
      onEvent: () => {
        throw new Error('boom');
      },
      onOfferError: () => {
        throw new Error('handler boom');
      }
    });
    expect(() => h.runtime.update(16)).not.toThrow();
    expect(h.runtime.getStats().events).toBe(1);
  });
});

describe('OfferRuntime — purchase semantics', () => {
  test('the active offer bought: moved=true, chain in the buy cooldown; the rewards are host-owned data', () => {
    const h = harness();
    h.runtime.update(16);
    h.clock.now += HOUR;
    const def = h.runtime.offerByProduct('starter_pack')!;
    expect(def.rewards).toEqual([{ id: 'coins', amount: 3500 }, { id: 'lives_unlimited_sec', amount: HOUR }, { id: 'bulbs', amount: 3 }]);
    expect(h.runtime.onPurchased('starter_pack')).toBe(true);
    expect(h.runtime.getActive()).toBeNull();
    expect(h.runtime.secondsLeft()).toBe(0);
    expect(h.runtime.getStats()).toMatchObject({ active: null, welcome: 2, tier: 0, nextTier: 2, nextAt: T0 + HOUR + DAY, purchases: 1, changes: 2 });
  });

  test('a late purchase inside 24 h after the expiry moves the chain; after 24 h or with the next offer active it does not', () => {
    const h = harness();
    h.runtime.update(16);
    h.clock.now = T0 + 12 * HOUR;
    h.runtime.tick(); // welcome expired
    h.clock.now += 23 * HOUR;
    expect(h.runtime.onPurchased('starter_pack')).toBe(true);
    expect(h.state.get('nextTier')).toBe(2);

    const late = harness();
    late.runtime.update(16);
    late.clock.now = T0 + 12 * HOUR;
    late.runtime.tick();
    late.clock.now += DAY;
    expect(late.runtime.onPurchased('starter_pack')).toBe(false);
    expect(late.state.get('nextTier')).toBe(1);

    const busy = harness();
    busy.runtime.update(16);
    busy.clock.now = T0 + 12 * HOUR;
    busy.runtime.tick();
    busy.clock.now += 2 * DAY;
    busy.runtime.tick(); // t1 A active
    expect(busy.runtime.onPurchased('starter_pack')).toBe(false);
    expect(busy.runtime.getActive()?.productId).toBe('offer_t1_a');
  });
});

describe('OfferRuntime — host hooks', () => {
  test('hasPrice is a live provider: asked on every decision, never cached at construction', () => {
    const h = harness({ priced: false });
    h.runtime.update(16);
    const asked = h.hasPrice.mock.calls.length;
    expect(asked).toBeGreaterThan(0);
    h.runtime.update(1000);
    expect(h.hasPrice.mock.calls.length).toBeGreaterThan(asked);
    h.catalog.add('starter_pack');
    expect(h.runtime.update(1000)).toBe(true);
  });

  test('clampTimes repairs a save from a future clock against input.now() and reports it', () => {
    const h = harness({ initial: { welcome: 1, until: T0 + 500 * DAY, nextAt: T0 + 500 * DAY, declinedAt: T0 + 500 * DAY } });
    expect(h.runtime.clampTimes()).toBe(true);
    expect(h.state.snapshot()).toMatchObject({ until: T0 + DAY, nextAt: T0 + 2 * DAY, declinedAt: T0 });
    expect(h.runtime.clampTimes()).toBe(false);
    expect(h.runtime.getActive()?.productId).toBe('starter_pack');
  });

  test('explicit tick() after a resume: one transition per call at the injected clock', () => {
    const h = harness();
    h.runtime.tick();
    h.clock.now = T0 + 12 * HOUR + 2 * DAY;
    expect(h.runtime.tick()).toBe(true);
    expect(h.runtime.getActive()).toBeNull();
    expect(h.runtime.tick()).toBe(false); // cooldown from the observed now
    h.clock.now += 2 * DAY;
    expect(h.runtime.tick()).toBe(true);
    expect(h.runtime.getActive()?.productId).toBe('offer_t1_a');
  });

  test('getActive / secondsLeft / getStats read the injected clock', () => {
    const h = harness();
    h.runtime.update(16);
    h.clock.now = T0 + 11 * HOUR;
    expect(h.runtime.secondsLeft()).toBe(HOUR);
    expect(h.runtime.getStats()).toMatchObject({ active: 'starter_pack', welcome: 1, tier: 0, variant: 0, until: T0 + 12 * HOUR, secondsLeft: HOUR, ticks: 1, changes: 1, purchases: 0, events: 1, blockedReported: false, callbackErrors: 0 });
    h.clock.now = T0 + 12 * HOUR;
    expect(h.runtime.getActive()).toBeNull();
    expect(h.runtime.secondsLeft()).toBe(0);
    expect(h.runtime.getStats().active).toBeNull();
  });

  test('constructor validates the config (RangeError) and requires state + input', () => {
    const base = harness();
    const input = { now: () => T0, level: () => 19, hasPrice: () => true, welcomeOwned: () => false };
    expect(() => new OfferRuntime({ config: makeConfig({ tiers: makeConfig().tiers.slice(0, 5) }), state: base.state, input })).toThrow(RangeError);
    expect(() => new OfferRuntime({ config: makeConfig({ welcome: { ...makeConfig().welcome, tier: 1 } }), state: base.state, input })).toThrow(RangeError);
    expect(() => new OfferRuntime({ config: makeConfig({ nextAfterBuySec: -1 }), state: base.state, input })).toThrow(RangeError);
    expect(() => new OfferRuntime({ config: makeConfig({ tiers: makeConfig().tiers.map((pair, i) => (i === 2 ? [pair[0]!, { ...pair[1]!, productId: 'offer_t1_a' }] : pair)) }), state: base.state, input })).toThrow(/duplicate/);
    expect(() => new OfferRuntime({ config: makeConfig(), state: base.state, input: undefined as never })).toThrow(RangeError);
  });
});

describe('OfferRuntime — CoreRuntime contract', () => {
  test('registers as a module; core.update fans out and reports the change flag', () => {
    const h = harness();
    const core = new CoreRuntime();
    core.registerRuntime('offers', h.runtime);
    expect(core.update(16)).toBe(true);
    expect(core.update(16)).toBe(false);
    expect(core.getStats()).toHaveProperty('offers');
    expect((core.getStats().offers as { active: string | null }).active).toBe('starter_pack');
    // cancel/pause fan-outs skip it (a LiveOps chain has no scopes)
    expect(core.cancelAll()).toBe(0);
    expect(core.pauseScope('x')).toBe(0);
  });

  test('an input that throws is reported through CoreRuntime.onError and does not kill other modules', () => {
    const errors: unknown[] = [];
    const core = new CoreRuntime();
    core.onError((error, context) => errors.push({ error, context }));
    const runtime = new OfferRuntime({
      config: makeConfig(),
      state: makeState(),
      input: {
        now: () => {
          throw new Error('no server time yet');
        },
        level: () => 19,
        hasPrice: () => true,
        welcomeOwned: () => false
      }
    });
    core.registerRuntime('offers', runtime);
    const other = vi.fn(() => true);
    core.registerRuntime('other', { update: other });
    expect(core.update(16)).toBe(true);
    expect(other).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect((errors[0] as { context: { moduleName: string } }).context.moduleName).toBe('offers');
  });
});
