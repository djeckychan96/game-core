import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  DAILY_QUESTS_GDD_V1_CATALOGS,
  DAILY_QUESTS_GDD_V1_ROWS,
  LocalizationRuntime,
  QuestService,
  SaveGate,
  SoftCurrencyWallet,
  createQuestGroupResolver,
  createWalletQuestRewards,
  dailyQuestsGddV1,
  pickDailyQuests,
  purchaseEventToQuestEvent,
  questDayStart,
  questLocalDay,
  trackWalletForQuests,
  validateLocalizationCatalogs,
  validateQuestConfig
} from '../../src/index';
import type {
  GameProductionProfile,
  PlatformStorage,
  QuestChange,
  QuestClock,
  QuestConfig,
  QuestDef,
  QuestGroupFacts,
  QuestGroupResolver,
  QuestRewardSink
} from '../../src/index';

type GateProfile = Pick<GameProductionProfile, 'id' | 'save' | 'economy'>;

const PROFILE: GateProfile = {
  id: 'game',
  save: { keys: ['game_state'] },
  economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0 } }
};
const CORE_KEY = 'game.core';
const CONFIG = dailyQuestsGddV1('coins');
/** Local 10:00 on 2026-10-13 for a player at UTC+7 (getTimezoneOffset −420). */
const T0 = Date.UTC(2026, 9, 13, 3, 0, 0);
const OFFSET = -420;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A deterministic [0, 1) source (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A controllable player clock in a fixed time zone. */
function clock(start = T0, offset = OFFSET) {
  const c = {
    t: start,
    now: () => c.t,
    timezoneOffsetMinutes: (_at: number) => offset,
    advance: (ms: number) => (c.t += ms)
  };
  return c;
}

/** A PlatformStorage over a plain object with scripted failures; every call is journaled. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const fake = {
    data: JSON.parse(JSON.stringify(initial)) as Record<string, unknown>,
    calls: [] as string[],
    /** Every written patch, as it reached the storage. */
    patches: [] as Record<string, any>[],
    failRead: false,
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
const questsRecord = (fake: Fake) => (fake.data[CORE_KEY] as Record<string, any> | undefined)?.quests;
const storedBalance = (fake: Fake) => (fake.data[CORE_KEY] as Record<string, any> | undefined)?.wallet?.balance;

/** A fixed day set: both mandatory, level_03 + gold_100 as the common picks, payer spend_gold_01 + purchase. */
const FIXED = new Set(['daily_login', 'daily_ad_02', 'daily_level_03', 'daily_gold_100', 'group_payer_spend_gold_01', 'group_payer_purchase']);
const fixedSet = (quest: QuestDef) => FIXED.has(quest.id);

interface SessionOptions {
  c?: ReturnType<typeof clock>;
  seed?: number;
  config?: QuestConfig;
  resolveGroup?: QuestGroupResolver;
  isPayer?: () => boolean;
  available?: ((quest: QuestDef) => boolean) | null;
  rewards?: QuestRewardSink;
  open?: boolean;
  trackWallet?: boolean;
  changes?: QuestChange[];
}

/** One game session: gate + wallet + quests loaded, the gate opened, wallet changes tracked as quest events. */
async function session(fake: Fake, options: SessionOptions = {}) {
  const c = options.c ?? clock();
  const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
  const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
  const available = options.available === undefined ? fixedSet : options.available;
  const quests = new QuestService({
    gate,
    config: options.config ?? CONFIG,
    rewards: options.rewards ?? createWalletQuestRewards(wallet),
    clock: c,
    random: rng(options.seed ?? 1),
    resolveGroup: options.resolveGroup ?? (() => 'payer'),
    ...(options.isPayer ? { isPayer: options.isPayer } : {}),
    ...(available ? { available } : {})
  });
  if (options.changes) quests.onChange((change) => options.changes!.push(change));
  await Promise.all([gate.load(), wallet.load(), quests.load()]);
  if (options.open !== false) gate.open();
  if (options.trackWallet !== false) trackWalletForQuests(wallet, quests);
  return { gate, wallet, quests, c };
}

const view = (quests: QuestService, id: string) => quests.snapshot().quests.find((quest) => quest.id === id);
const goals = (defs: readonly { objective: { event: string } }[]) => defs.map((quest) => quest.objective.event);

describe('Daily quests — config and the day set (GDD «Типы квестов» + Balance.xlsx)', () => {
  test('the GDD V1 preset is Balance.xlsx verbatim: ids, groups, conditions, rewards — and a valid config', () => {
    const balance: Array<[string, string, string | null, string, number, number]> = [
      ['daily_login', 'mandatory', null, 'login', 1, 10],
      ['daily_ad_02', 'mandatory', null, 'rewarded_ad', 2, 15],
      ['daily_level_03', 'common', null, 'level_complete', 3, 10],
      ['daily_level_05', 'common', null, 'level_complete', 5, 20],
      ['daily_level_08', 'common', null, 'level_complete', 8, 30],
      ['daily_gold_100', 'common', null, 'currency_earned', 100, 5],
      ['daily_gold_200', 'common', null, 'currency_earned', 200, 15],
      ['daily_gold_400', 'common', null, 'currency_earned', 400, 25],
      ['daily_booster_01', 'common', null, 'booster_used', 1, 5],
      ['daily_booster_03', 'common', null, 'booster_used', 3, 10],
      ['group_payer_spend_gold_01', 'group', 'payer', 'currency_spent', 100, 10],
      ['group_payer_spend_gold_02', 'group', 'payer', 'currency_spent', 250, 20],
      ['group_payer_purchase', 'group', 'payer', 'purchase', 1, 50],
      ['group_nonpayer_playtime_01', 'group', 'active_nonpayer', 'play_time', 600, 15],
      ['group_payer_playtime_01', 'group', 'payer', 'play_time', 600, 15],
      ['group_return_playtime_01', 'group', 'returning', 'play_time', 600, 15]
    ];
    expect(DAILY_QUESTS_GDD_V1_ROWS.map((row) => [row.id, row.category, row.group, row.event, row.target, row.reward])).toEqual(balance);
    expect(validateQuestConfig(CONFIG)).toEqual([]);
    expect(CONFIG.set).toEqual({ mandatory: ['daily_login', 'daily_ad_02'], common: 2, group: 2 });
    expect(CONFIG.groups.map((group) => group.id)).toEqual(['returning', 'payer', 'active_nonpayer']);
    expect(CONFIG.groups.find((group) => group.id === 'payer')!.pool).toEqual(['group_payer_spend_gold_01', 'group_payer_spend_gold_02', 'group_payer_purchase', 'group_payer_playtime_01']);
    // no Figma demo number anywhere: every reward is Balance's, in the wallet's currency
    expect(CONFIG.quests.every((quest) => quest.reward.id === 'coins' && quest.reward.amount !== 900)).toBe(true);
  });

  test('validateQuestConfig names duplicates, repeated mandatory goals, unknown events and misspelled fields', () => {
    const base = (): any => JSON.parse(JSON.stringify(CONFIG));
    const dup = base();
    dup.quests.push({ ...dup.quests[0] });
    expect(validateQuestConfig(dup).join('\n')).toMatch(/"daily_login" is used twice/);
    const sameGoal = base();
    sameGoal.quests.push({ id: 'daily_login_2', category: 'mandatory', objective: { event: 'login', target: 1 }, reward: { id: 'coins', amount: 1 } });
    sameGoal.set.mandatory.push('daily_login_2');
    expect(validateQuestConfig(sameGoal).join('\n')).toMatch(/repeats the goal login/);
    const badEvent = base();
    badEvent.quests[2].objective.event = 'level_won';
    expect(validateQuestConfig(badEvent).join('\n')).toMatch(/objective\.event must be one of/);
    const typo = base();
    typo.quests[0].titlekey = 'x';
    expect(validateQuestConfig(typo).join('\n')).toMatch(/titlekey is not a quest field/);
    const wrongPool = base();
    wrongPool.groups[0].pool.push('daily_level_03');
    expect(validateQuestConfig(wrongPool).join('\n')).toMatch(/"daily_level_03" is a common quest/);
    expect(() => new QuestService({ gate: new SaveGate({ storage: fakeStorage().storage, profile: PROFILE }), config: dup, rewards: { canGrant: () => true, grant: () => ({ ok: true }) }, clock: clock(), random: rng(1) })).toThrow(/config — /);
  });

  test('every day set: 2 mandatory first, then the group picks, then 2 common — never a repeated goal (500 seeds × 4 groups)', () => {
    const pools = new Map(CONFIG.groups.map((group) => [group.id, new Set(group.pool)]));
    const expectedGroupCount: Record<string, number> = { none: 0, returning: 1, payer: 2, active_nonpayer: 1 };
    const seenCommon = new Set<string>();
    const seenPayer = new Set<string>();
    for (const group of [null, 'returning', 'payer', 'active_nonpayer']) {
      for (let seed = 1; seed <= 500; seed++) {
        const set = pickDailyQuests(CONFIG, { group, random: rng(seed) });
        expect(set.slice(0, 2).map((quest) => quest.id)).toEqual(['daily_login', 'daily_ad_02']);
        const categories = set.map((quest) => quest.category);
        expect(categories).toEqual([...categories].sort((a, b) => ['mandatory', 'group', 'common'].indexOf(a) - ['mandatory', 'group', 'common'].indexOf(b)));
        expect(new Set(goals(set)).size).toBe(set.length);
        const grouped = set.filter((quest) => quest.category === 'group');
        expect(grouped.length).toBe(expectedGroupCount[group ?? 'none']);
        for (const quest of grouped) expect(pools.get(group!)!.has(quest.id)).toBe(true);
        const common = set.filter((quest) => quest.category === 'common');
        expect(common.length).toBe(2);
        common.forEach((quest) => seenCommon.add(quest.id));
        if (group === 'payer') grouped.forEach((quest) => seenPayer.add(quest.id));
      }
    }
    // random over the whole pools: every common and every payer quest shows up
    expect([...seenCommon].sort()).toEqual(CONFIG.quests.filter((quest) => quest.category === 'common').map((quest) => quest.id).sort());
    expect([...seenPayer].sort()).toEqual([...pools.get('payer')!].sort());
  });

  test('an unavailable quest is never picked, and a short pool gives fewer quests instead of a duplicate goal', () => {
    const noPurchase = (quest: QuestDef) => quest.objective.event !== 'purchase';
    const onlySpend = (quest: QuestDef) => quest.category !== 'group' || quest.objective.event === 'currency_spent';
    for (let seed = 1; seed <= 200; seed++) {
      const set = pickDailyQuests(CONFIG, { group: 'payer', random: rng(seed), available: noPurchase });
      expect(set.some((quest) => quest.objective.event === 'purchase')).toBe(false);
      expect(set.filter((quest) => quest.category === 'group')).toHaveLength(2);
      const spendOnly = pickDailyQuests(CONFIG, { group: 'payer', random: rng(seed), available: onlySpend });
      // spend_gold_01 and _02 share one goal: one of them, never both
      expect(spendOnly.filter((quest) => quest.category === 'group')).toHaveLength(1);
    }
    const levelsOnly = pickDailyQuests(CONFIG, { group: null, random: rng(3), available: (quest) => quest.category !== 'common' || quest.objective.event === 'level_complete' });
    expect(levelsOnly.map((quest) => quest.category)).toEqual(['mandatory', 'mandatory', 'common']);
  });

  test('group rules: returning > payer > active_nonpayer, thresholds only from the host, an explicit QA group', () => {
    const resolve = createQuestGroupResolver([
      { group: 'returning', minMissedDays: 3 }, // 3 is a TEST threshold — the GDD has none yet
      { group: 'payer', payer: true },
      { group: 'active_nonpayer', payer: false }
    ]);
    const facts = (missedDays: number | null, payer: boolean | null): QuestGroupFacts => ({ day: 100, previousDay: missedDays === null ? null : 99 - missedDays, missedDays, payer });
    expect(resolve(facts(5, true))).toBe('returning');
    expect(resolve(facts(3, false))).toBe('returning');
    expect(resolve(facts(2, true))).toBe('payer');
    expect(resolve(facts(0, false))).toBe('active_nonpayer');
    expect(resolve(facts(null, false))).toBe('active_nonpayer'); // a new player is never "returning"
    expect(resolve(facts(1, null))).toBeNull(); // payer unknown: no guess
    expect(createQuestGroupResolver([{ group: 'payer' }])(facts(null, null))).toBe('payer');
    expect(() => createQuestGroupResolver([{ group: 'returning', minMissedDays: 0 }])).toThrow(/minMissedDays/);
    expect(() => createQuestGroupResolver([{ group: 'payer', threshold: 1 } as never])).toThrow(/threshold is not a rule field/);
  });
});

describe('QuestService — progress, claims, durability', () => {
  test('the first set is formed at load and written only after open; nothing counts before it exists or before open', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    const quests = new QuestService({ gate, config: CONFIG, rewards: createWalletQuestRewards(wallet), clock: clock(), random: rng(1), resolveGroup: () => 'payer', available: fixedSet });
    expect(quests.track({ type: 'login' }).reason).toBe('not_loaded');
    await Promise.all([gate.load(), wallet.load(), quests.load()]);
    const before = quests.snapshot();
    expect(before.status).toBe('ready');
    expect(before.writable).toBe(false);
    expect(before.day).toBe(questLocalDay(T0, clock()));
    expect(before.group).toBe('payer');
    expect(before.quests.map((quest) => quest.category)).toEqual(['mandatory', 'mandatory', 'group', 'group', 'common', 'common']);
    expect(new Set(before.quests.map((quest) => quest.id))).toEqual(FIXED);
    expect(quests.track({ type: 'login' }).reason).toBe('not_open');
    expect(writes(fake)).toBe(0);
    gate.open();
    const login = quests.track({ type: 'login' });
    expect(login).toMatchObject({ ok: true, advanced: ['daily_login'], completed: ['daily_login'] });
    expect(view(quests, 'daily_login')).toMatchObject({ progress: 1, target: 1, state: 'completed' });
    expect(questsRecord(fake).quests.find((quest: any) => quest.id === 'daily_login')).toMatchObject({ progress: 1, claimed: false });
  });

  test('an event moves only the quests with its goal, capped at the target; states active → completed → claimed', async () => {
    const { quests } = await session(fakeStorage());
    expect(view(quests, 'daily_level_03')!.state).toBe('active');
    for (let i = 0; i < 4; i++) quests.track({ type: 'level_complete' });
    expect(view(quests, 'daily_level_03')).toMatchObject({ progress: 3, state: 'completed' });
    quests.track({ type: 'booster_used' }); // no booster quest today: nothing moves
    expect(quests.snapshot().quests.filter((quest) => quest.progress > 0).map((quest) => quest.id)).toEqual(['daily_level_03']);
    expect(quests.track({ type: 'play_time', amount: 30 })).toMatchObject({ ok: true, advanced: [] });
    expect(quests.snapshot().claimable).toBe(1);
    expect(quests.claim('daily_level_03')).toMatchObject({ ok: true, reward: { id: 'coins', amount: 10 } });
    expect(view(quests, 'daily_level_03')!.state).toBe('claimed');
    expect(quests.track({ type: 'level_complete' }).advanced).toEqual([]);
  });

  test('a reward is paid exactly once: repeated claims, a reload and a repeated login never pay again', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    expect(first.quests.claim('daily_login').reason).toBe('not_completed');
    first.quests.track({ type: 'login' });
    expect(first.quests.claim('daily_login')).toMatchObject({ ok: true, reward: { amount: 10 } });
    expect(first.quests.claim('daily_login').reason).toBe('already_claimed');
    expect(first.quests.claim('daily_login').reason).toBe('already_claimed');
    expect(first.wallet.balance).toBe(10);
    expect(storedBalance(fake)).toBe(10);
    expect(first.quests.claim('no_such_quest').reason).toBe('unknown_quest');

    const second = await session(fake);
    expect(second.wallet.balance).toBe(10);
    expect(view(second.quests, 'daily_login')!.state).toBe('claimed');
    expect(second.quests.track({ type: 'login' }).advanced).toEqual([]);
    expect(second.quests.claim('daily_login').reason).toBe('already_claimed');
    expect(second.wallet.balance).toBe(10);
  });

  test('the claim is written before the coins, and every later write carries both — a lost write can lose, never double, a reward', async () => {
    const fake = fakeStorage();
    const { quests } = await session(fake);
    quests.track({ type: 'login' });
    const from = fake.patches.length;
    quests.claim('daily_login');
    const states = fake.patches.slice(from).map((patch) => ({
      claimed: patch[CORE_KEY].quests.quests.find((quest: any) => quest.id === 'daily_login').claimed,
      balance: patch[CORE_KEY].wallet?.balance ?? 0
    }));
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[0]).toEqual({ claimed: true, balance: 0 }); // the claim lands first
    expect(states.some((state) => state.balance === 10 && !state.claimed)).toBe(false); // never coins without the claim
    expect(states.at(-1)).toEqual({ claimed: true, balance: 10 });
    expect(storedBalance(fake)).toBe(10);
  });

  test('coins of a claimed reward count toward the earn-coins quest (any source counts)', async () => {
    const { quests } = await session(fakeStorage());
    quests.track({ type: 'login' });
    quests.claim('daily_login');
    expect(view(quests, 'daily_gold_100')!.progress).toBe(10);
  });

  test('the same event id counts once a day, also after a reload', async () => {
    const fake = fakeStorage();
    const first = await session(fake);
    expect(first.quests.track({ type: 'rewarded_ad', id: 'ad-1' }).advanced).toEqual(['daily_ad_02']);
    expect(first.quests.track({ type: 'rewarded_ad', id: 'ad-1' })).toMatchObject({ ok: true, duplicate: true, advanced: [] });
    const second = await session(fake);
    expect(second.quests.track({ type: 'rewarded_ad', id: 'ad-1' }).duplicate).toBe(true);
    expect(view(second.quests, 'daily_ad_02')!.progress).toBe(1);
    expect(second.quests.track({ type: 'rewarded_ad', id: 'ad-2' }).completed).toEqual(['daily_ad_02']);
  });

  test('a sink that cannot pay leaves the quest completed and claimable — no claim is kept without its reward', async () => {
    const fake = fakeStorage();
    let canPay = false;
    let pays = true;
    const paid: number[] = [];
    const rewards: QuestRewardSink = {
      canGrant: () => canPay,
      grant: (reward) => {
        if (!pays) return { ok: false, reason: 'storage' };
        paid.push(reward.amount);
        return { ok: true };
      }
    };
    const { quests } = await session(fake, { rewards });
    quests.track({ type: 'login' });
    const before = writes(fake);
    expect(quests.claim('daily_login').reason).toBe('reward_refused');
    expect(writes(fake)).toBe(before); // canGrant false: nothing touched
    canPay = true;
    pays = false;
    expect(quests.claim('daily_login')).toMatchObject({ ok: false, reason: 'reward_refused', grant: { ok: false, reason: 'storage' } });
    expect(view(quests, 'daily_login')!.state).toBe('completed');
    expect(questsRecord(fake).quests.find((quest: any) => quest.id === 'daily_login').claimed).toBe(false);
    pays = true;
    expect(quests.claim('daily_login').ok).toBe(true);
    expect(paid).toEqual([10]);
  });

  test('malformed events are answered, never thrown', async () => {
    const { quests } = await session(fakeStorage());
    for (const event of [{ type: 'level_won' }, { type: 'currency_earned' }, { type: 'play_time', amount: 0 }, { type: 'login', amount: 2 }, { type: 'purchase', id: '' }, null]) {
      expect(quests.track(event as never).reason).toBe('invalid_event');
    }
  });

  test('a failed Core read or a foreign record: unavailable, nothing counted, nothing written', async () => {
    const failed = fakeStorage();
    failed.failRead = true;
    const a = await session(failed);
    expect(a.quests.snapshot()).toMatchObject({ status: 'unavailable', problem: 'read_failed', quests: [], msUntilReset: null });
    expect(a.quests.track({ type: 'login' }).reason).toBe('unavailable');
    const foreign = fakeStorage({ [CORE_KEY]: { quests: { v: 2, day: 1 } } });
    const b = await session(foreign);
    expect(b.quests.snapshot()).toMatchObject({ status: 'unavailable', problem: 'invalid_record' });
    expect(b.quests.claim('daily_login').reason).toBe('unavailable');
    expect(b.quests.tick().status).toBe('unavailable');
    expect(writes(foreign)).toBe(0);
    expect(questsRecord(foreign)).toEqual({ v: 2, day: 1 });
  });

  test('re-initialisation over the same gate reads the same state and pays nothing again', async () => {
    const fake = fakeStorage();
    const { gate, wallet, quests, c } = await session(fake);
    quests.track({ type: 'login' });
    quests.claim('daily_login');
    const again = new QuestService({ gate, config: CONFIG, rewards: createWalletQuestRewards(wallet), clock: c, random: rng(99), resolveGroup: () => 'payer', available: fixedSet });
    await again.load();
    expect(again.snapshot().quests.map((quest) => quest.id)).toEqual(quests.snapshot().quests.map((quest) => quest.id));
    expect(again.claim('daily_login').reason).toBe('already_claimed');
    expect(wallet.balance).toBe(10);
  });
});

describe('QuestService — the day change at local 00:00', () => {
  test('midnight in a running session: unclaimed rewards paid once, old set dropped, a new set formed and saved', async () => {
    const fake = fakeStorage();
    const changes: QuestChange[] = [];
    const s = await session(fake, { changes });
    const day0 = s.quests.snapshot().day!;
    s.quests.track({ type: 'login' });
    s.quests.claim('daily_login'); // +10, claimed
    s.quests.track({ type: 'rewarded_ad' });
    s.quests.track({ type: 'rewarded_ad' }); // completed, NOT claimed (15)
    s.quests.track({ type: 'level_complete' }); // active 1/3 — dropped without pay
    expect(s.wallet.balance).toBe(10);
    expect(view(s.quests, 'daily_gold_100')!.progress).toBe(10);

    s.c.t = questDayStart(day0 + 1, s.c) + 1000; // 00:00:01 local
    const snap = s.quests.tick();
    expect(snap.day).toBe(day0 + 1);
    expect(s.wallet.balance).toBe(25); // the unclaimed 15, once
    expect(snap.pendingRewards).toBe(0);
    // a fresh set: nothing of yesterday's progress; the coins of yesterday's reward are not today's progress
    expect(view(s.quests, 'daily_level_03')!.progress).toBe(0);
    expect(view(s.quests, 'daily_ad_02')!.progress).toBe(0);
    expect(view(s.quests, 'daily_gold_100')!.progress).toBe(0);
    // the session is in the game at 00:00: its login counts for the new day
    expect(view(s.quests, 'daily_login')!.state).toBe('completed');
    expect(questsRecord(fake)).toMatchObject({ day: day0 + 1, carry: [] });
    expect(changes.filter((change) => change.kind === 'auto_claimed')).toEqual([{ kind: 'auto_claimed', day: day0, questId: 'daily_ad_02', reward: { id: 'coins', amount: 15 } }]);
    expect(changes.filter((change) => change.kind === 'new_day').map((change) => change.day)).toEqual([day0, day0 + 1]);

    // ticks, snapshots and a reload on the same day pay nothing more
    s.quests.tick();
    s.quests.snapshot();
    const reload = await session(fake, { c: clock(s.c.t) });
    expect(reload.wallet.balance).toBe(25);
    expect(reload.quests.snapshot().day).toBe(day0 + 1);
    expect(view(reload.quests, 'daily_login')!.state).toBe('completed');
    expect(reload.quests.claim('daily_login').ok).toBe(true);
    expect(reload.wallet.balance).toBe(35);
  });

  test('back after several days: one payout, one new set, nothing for the missed days, missed days told to the group rules', async () => {
    const fake = fakeStorage();
    const s = await session(fake);
    const day0 = s.quests.snapshot().day!;
    s.quests.track({ type: 'rewarded_ad' });
    s.quests.track({ type: 'rewarded_ad' }); // 15 unclaimed
    s.quests.track({ type: 'level_complete' });
    s.quests.track({ type: 'level_complete' });
    s.quests.track({ type: 'level_complete' }); // 10 unclaimed

    const told: QuestGroupFacts[] = [];
    const resolveGroup: QuestGroupResolver = (facts) => {
      told.push(facts);
      return createQuestGroupResolver([{ group: 'returning', minMissedDays: 3 }, { group: 'payer' }])(facts);
    };
    const changes: QuestChange[] = [];
    const back = await session(fake, { c: clock(T0 + 5 * DAY), resolveGroup, available: null, changes });
    expect(told).toEqual([{ day: day0 + 5, previousDay: day0, missedDays: 4, payer: null }]);
    const snap = back.quests.snapshot();
    expect(snap).toMatchObject({ day: day0 + 5, group: 'returning', pendingRewards: 2 }); // carried until the gate is open
    back.quests.tick();
    expect(back.wallet.balance).toBe(25); // 15 + 10, once — not × 5 days
    expect(back.quests.snapshot().quests.map((quest) => quest.id)).toContain('group_return_playtime_01');
    expect(back.quests.snapshot().quests.filter((quest) => quest.category === 'group')).toHaveLength(1);
    expect(changes.filter((change) => change.kind === 'new_day')).toHaveLength(1);

    const later = await session(fake, { c: clock(T0 + 5 * DAY + HOUR), resolveGroup, available: null });
    later.quests.tick();
    expect(later.wallet.balance).toBe(25);
    expect(told).toHaveLength(1); // the same day: the stored set, no new group decision
  });

  test('rewards the sink cannot pay at the day change wait in the record and are paid once later', async () => {
    const fake = fakeStorage();
    const s = await session(fake);
    const day0 = s.quests.snapshot().day!;
    s.quests.track({ type: 'login' }); // 10 unclaimed

    let canPay = false;
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    const real = createWalletQuestRewards(wallet);
    const rewards: QuestRewardSink = { canGrant: (reward) => canPay && real.canGrant(reward), grant: (reward, context) => real.grant(reward, context) };
    const quests = new QuestService({ gate, config: CONFIG, rewards, clock: clock(T0 + DAY), random: rng(2), resolveGroup: () => 'payer', available: fixedSet });
    await Promise.all([gate.load(), wallet.load(), quests.load()]);
    gate.open();
    expect(quests.tick()).toMatchObject({ day: day0 + 1, pendingRewards: 1 });
    expect(questsRecord(fake)).toMatchObject({ day: day0 + 1, carry: [{ questId: 'daily_login', day: day0, reward: { id: 'coins', amount: 10 } }] });
    expect(wallet.balance).toBe(0);
    canPay = true;
    expect(quests.tick().pendingRewards).toBe(0);
    expect(wallet.balance).toBe(10);
    const reload = await session(fake, { c: clock(T0 + DAY) });
    reload.quests.tick();
    expect(reload.wallet.balance).toBe(10);
    expect(questsRecord(fake).carry).toEqual([]);
  });

  test('a clock moved back keeps the stored set: no new set, no reward, the timer runs to the end of the stored day', async () => {
    const fake = fakeStorage();
    const s = await session(fake);
    const day0 = s.quests.snapshot().day!;
    s.quests.track({ type: 'login' });
    const changes: QuestChange[] = [];
    s.quests.onChange((change) => changes.push(change));
    s.c.t = T0 - DAY;
    const snap = s.quests.tick();
    expect(snap.day).toBe(day0);
    expect(view(s.quests, 'daily_login')!.state).toBe('completed');
    expect(s.wallet.balance).toBe(0);
    expect(changes).toEqual([]);
    expect(snap.nextResetAt).toBe(questDayStart(day0 + 1, s.c));
    expect(snap.msUntilReset).toBe(questDayStart(day0 + 1, s.c) - (T0 - DAY));
  });

  test('the time until the next set is counted to the next local 00:00 of the player', async () => {
    const { quests } = await session(fakeStorage());
    const snap = quests.snapshot();
    // local 10:00 at UTC+7 → 14 h to the local midnight = 17:00 UTC
    expect(snap.nextResetAt).toBe(Date.UTC(2026, 9, 13, 17, 0, 0));
    expect(snap.msUntilReset).toBe(14 * HOUR);
    // the calendar helpers on their own, a zone west of UTC and a DST-like change of the offset
    const west: QuestClock = { now: () => 0, timezoneOffsetMinutes: () => 300 }; // UTC−5
    expect(questLocalDay(Date.UTC(2026, 9, 14, 3, 0, 0), west)).toBe(questLocalDay(Date.UTC(2026, 9, 13, 12, 0, 0), west));
    expect(questDayStart(questLocalDay(Date.UTC(2026, 9, 14, 3, 0, 0), west), west)).toBe(Date.UTC(2026, 9, 13, 5, 0, 0));
    const shift = Date.UTC(2026, 2, 29, 1, 0, 0); // the offset changes from −60 to −120 at this instant
    const dst: QuestClock = { now: () => 0, timezoneOffsetMinutes: (at) => (at < shift ? -60 : -120) };
    const day = questLocalDay(Date.UTC(2026, 2, 29, 12, 0, 0), dst);
    expect(questDayStart(day + 1, dst)).toBe(Date.UTC(2026, 2, 29, 22, 0, 0)); // local 00:00 at UTC+2
  });
});

describe('Daily quests — event sources and texts', () => {
  test('wallet changes are quest events: earned, spent, and a host filter', async () => {
    const fake = fakeStorage();
    const { wallet, quests } = await session(fake, { trackWallet: false });
    const stop = trackWalletForQuests(wallet, quests, { filter: (change) => change.context?.source !== 'refund' });
    wallet.grant(60, { source: 'level' });
    wallet.grant(30, { source: 'refund' });
    expect(view(quests, 'daily_gold_100')!.progress).toBe(60);
    wallet.trySpend(40, { source: 'shop' });
    expect(view(quests, 'group_payer_spend_gold_01')!.progress).toBe(40);
    stop();
    wallet.grant(50);
    expect(view(quests, 'daily_gold_100')!.progress).toBe(60);
  });

  test('the wallet sink pays only its own currency, and only while the wallet is writable', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: PROFILE });
    const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
    const sink = createWalletQuestRewards(wallet);
    expect(sink.canGrant({ id: 'coins', amount: 10 })).toBe(false); // not loaded
    await Promise.all([gate.load(), wallet.load()]);
    expect(sink.canGrant({ id: 'coins', amount: 10 })).toBe(false); // gate not open
    gate.open();
    expect(sink.canGrant({ id: 'coins', amount: 10 })).toBe(true);
    expect(sink.canGrant({ id: 'gems', amount: 10 })).toBe(false);
    expect(sink.grant({ id: 'gems', amount: 10 }, { questId: 'q', day: 1, auto: false })).toEqual({ ok: false, reason: 'unknown_reward' });
    expect(sink.grant({ id: 'coins', amount: 10 }, { questId: 'q', day: 1, auto: false }).ok).toBe(true);
    expect(wallet.balance).toBe(10);
  });

  test('a confirmed direct purchase is a quest event keyed by its token; restores and other events are not', () => {
    const granted = { type: 'granted', productId: 'pack', token: 't1', rewards: {}, restored: false, source: 'shop', requestedProductId: 'pack' } as const;
    expect(purchaseEventToQuestEvent(granted)).toEqual({ type: 'purchase', id: 'purchase:t1' });
    expect(purchaseEventToQuestEvent({ ...granted, token: undefined })).toEqual({ type: 'purchase' });
    expect(purchaseEventToQuestEvent({ ...granted, restored: true })).toBeNull();
    expect(purchaseEventToQuestEvent({ type: 'started', productId: 'pack', source: 'shop' })).toBeNull();
  });

  test('quest texts are keys: the GDD V1 catalogs cover every preset quest in ru and en', async () => {
    expect(validateLocalizationCatalogs(DAILY_QUESTS_GDD_V1_CATALOGS, { supportedLocales: ['ru', 'en'], referenceLocale: 'ru' })).toEqual([]);
    for (const quest of CONFIG.quests) {
      for (const locale of ['ru', 'en'] as const) {
        expect(DAILY_QUESTS_GDD_V1_CATALOGS[locale], `${locale} ${quest.id}`).toHaveProperty(`quests.${quest.id}.title`);
        expect(DAILY_QUESTS_GDD_V1_CATALOGS[locale], `${locale} ${quest.id}`).toHaveProperty(`quests.${quest.id}.description`);
      }
    }
    const { quests } = await session(fakeStorage());
    const i18n = new LocalizationRuntime({ rawLocale: 'ru-RU', supportedLocales: ['ru', 'en'], defaultLocale: 'ru', catalogs: DAILY_QUESTS_GDD_V1_CATALOGS });
    expect(i18n.t(view(quests, 'daily_ad_02')!.descriptionKey)).toBe('Посмотреть 2 рекламных ролика');
  });

  test('src/quests is generic: no clock, random, timer or global of its own, no game name, no other runtime', () => {
    const dir = fileURLToPath(new URL('../../src/quests/', import.meta.url));
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
    expect(files).toEqual(['QuestService.ts', 'config.ts', 'index.ts', 'presets.ts', 'types.ts']);
    const forbidden: Array<[string, RegExp]> = [
      ['Date', /\bDate\b/],
      ['Math.random', /Math\.random/],
      ['performance', /\bperformance\b/],
      ['setTimeout', /\bsetTimeout\b/],
      ['setInterval', /\bsetInterval\b/],
      ['requestAnimationFrame', /\brequestAnimationFrame\b/],
      ['window', /\bwindow\b/],
      ['document', /\bdocument\b/],
      ['localStorage', /\blocalStorage\b/],
      ['fetch', /\bfetch\b/],
      ['pixi', /pixi/i],
      ['a game name', /puzzle|jigsaw|solipix|pixsol|gorodki|trail|arrow|bubble/i]
    ];
    for (const file of files) {
      const source = strip(readFileSync(`${dir}${file}`, 'utf-8'));
      for (const [name, pattern] of forbidden) expect(pattern.test(source), `${file} references ${name}`).toBe(false);
      for (const match of source.matchAll(/^import\s+(type\s+)?[^'"]*from\s*['"]([^'"]+)['"]/gm)) {
        const local = match[2]!.startsWith('./');
        expect(local || (match[1] !== undefined && ['../save/SaveGate', '../localization/types'].includes(match[2]!)), `${file} imports ${match[2]}`).toBe(true);
      }
    }
  });
});
