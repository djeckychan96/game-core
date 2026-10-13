// QuestService V1 — the daily quests of a game: the day's set, its progress and its claims live in the
// SaveGate Core record `quests`, never in a game key. It only COUNTS and HANDS OUT: game actions come in as
// typed events from the host, rewards go out through the host's reward sink (the Core wallet via
// `createWalletQuestRewards`), texts are localization keys, windows / navigation / timers text stay outside.
// No timer, no global: the day comes from the injected clock, the picks from the injected random source.
import type { SaveReadStatus, SaveWriteResult } from '../save/SaveGate';
import { pickDailyQuests, questDayStart, questLocalDay, validateQuestConfig } from './config';
import { QUEST_AMOUNT_EVENTS, QUEST_CATEGORIES, QUEST_EVENT_TYPES } from './types';
import type {
  QuestCategory,
  QuestChange,
  QuestClaimResult,
  QuestClock,
  QuestConfig,
  QuestDef,
  QuestEvent,
  QuestEventType,
  QuestGrantAnswer,
  QuestGroupFacts,
  QuestGroupResolver,
  QuestListener,
  QuestProblem,
  QuestRefusal,
  QuestReward,
  QuestRewardContext,
  QuestRewardSink,
  QuestSaveGate,
  QuestSaveResult,
  QuestServiceOptions,
  QuestSnapshot,
  QuestStatus,
  QuestTrackResult,
  QuestView
} from './types';

/** The service's record in the SaveGate Core namespace: `<profile.id>.core` → `{ quests: { v, day, group, quests, events, carry } }`. */
const RECORD = 'quests';
/** Any change of the record's shape bumps it; another version is unknown data (unavailable, never overwritten). */
const FORMAT = 1;
/** Event ids remembered per day for the duplicate check (only ids of events that moved a quest are kept). */
const MAX_EVENT_IDS = 100;

interface StoredQuest {
  id: string;
  category: QuestCategory;
  event: QuestEventType;
  target: number;
  reward: QuestReward;
  progress: number;
  claimed: boolean;
}

/** A completed quest of an earlier day that the day change pays, kept until the sink accepted it. */
interface CarriedReward {
  questId: string;
  day: number;
  reward: QuestReward;
}

interface QuestRecord {
  v: number;
  /** The set's local day. */
  day: number;
  group: string | null;
  /** The set, in display order; the objective and the reward are copied at assignment (a config change waits for the next day). */
  quests: StoredQuest[];
  /** Ids of today's counted events. */
  events: string[];
  carry: CarriedReward[];
}

interface ParsedEvent {
  type: QuestEventType;
  amount: number;
  id?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isCount = (value: unknown, min: number): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const isReward = (value: unknown): value is QuestReward => isObject(value) && isName(value.id) && isCount(value.amount, 0);
const copyReward = (reward: QuestReward): QuestReward => ({ id: reward.id, amount: reward.amount });

/** A stored V1 record as a fresh copy, or null for anything else (never repaired, never overwritten). */
function readRecord(value: unknown): QuestRecord | null {
  if (!isObject(value) || value.v !== FORMAT || !Number.isSafeInteger(value.day) || !(value.group === null || isName(value.group))) return null;
  if (!Array.isArray(value.quests) || !Array.isArray(value.events) || !Array.isArray(value.carry)) return null;
  const quests: StoredQuest[] = [];
  for (const quest of value.quests as unknown[]) {
    if (!isObject(quest) || !isName(quest.id) || !(QUEST_CATEGORIES as readonly unknown[]).includes(quest.category)) return null;
    if (!(QUEST_EVENT_TYPES as readonly unknown[]).includes(quest.event) || !isCount(quest.target, 1) || !isReward(quest.reward)) return null;
    if (!isCount(quest.progress, 0) || quest.progress > quest.target || typeof quest.claimed !== 'boolean') return null;
    if (quest.claimed && quest.progress < quest.target) return null;
    quests.push({
      id: quest.id,
      category: quest.category as QuestCategory,
      event: quest.event as QuestEventType,
      target: quest.target,
      reward: copyReward(quest.reward),
      progress: quest.progress,
      claimed: quest.claimed
    });
  }
  if (!(value.events as unknown[]).every(isName)) return null;
  const carry: CarriedReward[] = [];
  for (const item of value.carry as unknown[]) {
    if (!isObject(item) || !isName(item.questId) || !Number.isSafeInteger(item.day) || !isReward(item.reward)) return null;
    carry.push({ questId: item.questId, day: item.day as number, reward: copyReward(item.reward) });
  }
  return { v: FORMAT, day: value.day as number, group: value.group as string | null, quests, events: [...(value.events as string[])], carry };
}

function copyRecord(record: QuestRecord): QuestRecord {
  return {
    v: FORMAT,
    day: record.day,
    group: record.group,
    quests: record.quests.map((quest) => ({ ...quest, reward: copyReward(quest.reward) })),
    events: [...record.events],
    carry: record.carry.map((item) => ({ questId: item.questId, day: item.day, reward: copyReward(item.reward) }))
  };
}

/** The event as counted, or null when it is malformed (the service answers `invalid_event`, never throws at gameplay). */
function parseEvent(event: QuestEvent): ParsedEvent | null {
  if (!isObject(event) || !(QUEST_EVENT_TYPES as readonly unknown[]).includes(event.type)) return null;
  const type = event.type as QuestEventType;
  let amount = 1;
  if (event.amount !== undefined) {
    if (!isCount(event.amount, 1)) return null;
    amount = event.amount;
  } else if (QUEST_AMOUNT_EVENTS.includes(type)) return null;
  if (type === 'login' && amount !== 1) return null;
  if (event.id !== undefined && !isName(event.id)) return null;
  return event.id === undefined ? { type, amount } : { type, amount, id: event.id };
}

/**
 * One service per game session, over the game's SaveGate:
 *
 *   const quests = new QuestService({
 *     gate, config, random: Math.random,
 *     clock: { now: () => Date.now(), timezoneOffsetMinutes: (at) => new Date(at).getTimezoneOffset() },
 *     rewards: createWalletQuestRewards(wallet),           // pays through SoftCurrencyWallet.grant
 *     resolveGroup: createQuestGroupResolver(rules), isPayer: () => …,
 *   });
 *   await Promise.all([wallet.load(), quests.load()]);    // with gate.load(); never rejects
 *   gate.open();
 *   trackWalletForQuests(wallet, quests);                // coins earned / spent, any source
 *   quests.track({ type: 'login' });                     // once per session, after open
 *   quests.track({ type: 'level_complete' });            // from the game's hooks
 *   quests.claim('daily_login');                         // the «claim» button
 *   const s = quests.tick();                             // the host's second: crosses local midnight, s.msUntilReset
 *
 * The day is the player's local day of the injected clock. A new day (on load, on any call, on tick()) pays the
 * stored set's completed unclaimed rewards once through the sink, drops the old set, forms a new one and saves it —
 * after any absence, ONE new set and no reward for the missed days. A clock behind the stored day keeps the stored
 * set (no new set, no new rewards) until the clock passes it. A change is synchronous in memory, then ONE
 * `gate.writeCore('quests', record)` of the whole record; a failed write is carried by the next one (or `save()`).
 * Exactly-once reward: the claim is written BEFORE the sink pays, and the sink's own Core write (the wallet's)
 * carries that claim too — so a reload can lose a reward whose wallet write never landed, never pay it twice.
 */
export class QuestService {
  private readonly gate: QuestSaveGate;
  private readonly config: QuestConfig;
  private readonly defs: Map<string, QuestDef>;
  private readonly rewards: QuestRewardSink;
  private readonly clock: QuestClock;
  private readonly random: () => number;
  private readonly resolveGroup: QuestGroupResolver | undefined;
  private readonly isPayer: (() => boolean) | undefined;
  private readonly available: ((quest: QuestDef) => boolean) | undefined;
  private readonly onListenerError: (error: unknown, change: QuestChange) => void;
  private readonly onError: (error: unknown, hook: string) => void;
  private readonly listeners = new Set<QuestListener>();
  private status: QuestStatus = 'idle';
  private problem: QuestProblem | null = null;
  private record: QuestRecord | null = null;
  /** The record changed (a new day formed in memory) since the last write. */
  private unsaved = false;
  /** This session reported its `login`: a set formed later in the session (local midnight) gets it too. */
  private sessionLogin = false;
  /** A sink delivery is running: `carry` refuses events (an earlier day's coins), both refuse claims and day changes. */
  private delivering: 'claim' | 'carry' | null = null;
  private disposed = false;
  private loading: Promise<QuestSnapshot> | null = null;

  constructor(options: QuestServiceOptions) {
    const { gate, config, rewards, clock, random, resolveGroup, isPayer, available, onListenerError, onError } = options ?? ({} as QuestServiceOptions);
    if (!gate || typeof gate.load !== 'function' || typeof gate.readCore !== 'function' || typeof gate.writeCore !== 'function' || typeof gate.snapshot !== 'function') {
      throw new TypeError('QuestService: the game SaveGate is required');
    }
    const issues = validateQuestConfig(config);
    if (issues.length > 0) throw new RangeError(`QuestService: config — ${issues.join('; ')}`);
    if (!rewards || typeof rewards.canGrant !== 'function' || typeof rewards.grant !== 'function') throw new TypeError('QuestService: a reward sink { canGrant, grant } is required');
    if (!clock || typeof clock.now !== 'function' || typeof clock.timezoneOffsetMinutes !== 'function') {
      throw new TypeError('QuestService: a clock { now, timezoneOffsetMinutes } is required (the local day decides the set)');
    }
    if (typeof random !== 'function') throw new TypeError('QuestService: a random source () => [0, 1) is required (the host platform one, or a seeded one)');
    for (const [name, hook] of [['resolveGroup', resolveGroup], ['isPayer', isPayer], ['available', available]] as const) {
      if (hook !== undefined && typeof hook !== 'function') throw new TypeError(`QuestService: ${name} must be a function`);
    }
    this.gate = gate;
    this.config = JSON.parse(JSON.stringify(config)) as QuestConfig;
    this.defs = new Map(this.config.quests.map((quest) => [quest.id, quest]));
    this.rewards = rewards;
    this.onError = onError ?? ((error, hook) => console.error(`QuestService: ${hook} threw`, error));
    this.clock = {
      now: () => this.hook('clock.now', () => Number(clock.now()), Number.NaN),
      timezoneOffsetMinutes: (at) => this.hook('clock.timezoneOffsetMinutes', () => Number(clock.timezoneOffsetMinutes(at)), Number.NaN)
    };
    this.random = () => this.hook('random', () => Number(random()), 0);
    this.resolveGroup = resolveGroup;
    this.isPayer = isPayer;
    this.available = available;
    this.onListenerError = onListenerError ?? ((error) => console.error('QuestService: a change listener threw', error));
  }

  /** Reads the Core record once, with `gate.load()` (the same promise the host awaits); a new day is formed in memory. Never rejects. */
  load(): Promise<QuestSnapshot> {
    if (!this.loading) {
      this.status = 'loading';
      this.loading = Promise.resolve()
        .then(() => this.gate.load())
        .then(
          (loaded) => this.restore(loaded?.core),
          () => this.restore('failed')
        );
    }
    return this.loading;
  }

  /** The state at the clock's now (a new day is formed in memory, written by the next accepted call or tick()). */
  snapshot(): QuestSnapshot {
    if (this.status === 'ready' && !this.delivering) this.settle();
    const record = this.status === 'ready' ? this.record : null;
    const quests = record ? record.quests.map((quest) => this.view(quest, record.group)) : [];
    const now = this.clock.now();
    let nextResetAt: number | null = null;
    let msUntilReset: number | null = null;
    if (record) {
      const finite = Number.isFinite(now);
      nextResetAt = questDayStart(Math.max(record.day, finite ? questLocalDay(now, this.clock) : record.day) + 1, this.clock);
      msUntilReset = finite ? Math.max(0, nextResetAt - now) : null;
    }
    return {
      status: this.status,
      problem: this.problem,
      writable: this.refusal() === null,
      day: record ? record.day : null,
      group: record ? record.group : null,
      quests,
      claimable: quests.filter((quest) => quest.state === 'completed').length,
      allClaimed: quests.length > 0 && quests.every((quest) => quest.state === 'claimed'),
      pendingRewards: record ? record.carry.length : 0,
      nextResetAt,
      msUntilReset
    };
  }

  /** snapshot() that also WRITES a day change and pays what it carried. Call it from the host's second (or when the quests window opens). */
  tick(): QuestSnapshot {
    this.prepare();
    return this.snapshot();
  }

  /**
   * Counts one game action toward the quests of TODAY's set with its goal (never toward a set formed later,
   * never toward a claimed or completed quest). A repeated event id counts once per day. Never throws:
   * a malformed event → `invalid_event`.
   */
  track(event: QuestEvent): QuestTrackResult {
    const parsed = parseEvent(event);
    if (!parsed) return this.trackRefused('invalid_event');
    if (this.delivering === 'carry') return this.trackRefused('carryover');
    const refusal = this.prepare();
    if (refusal) return this.trackRefused(refusal);
    if (parsed.type === 'login') this.sessionLogin = true;
    const record = this.record;
    if (!record) return { ok: true, reason: null, advanced: [], completed: [], duplicate: false, saved: null };
    if (parsed.id !== undefined && record.events.includes(parsed.id)) return { ok: true, reason: null, advanced: [], completed: [], duplicate: true, saved: null };
    const moved = this.advance(parsed.type, parsed.amount);
    if (moved.advanced.length === 0) return { ok: true, reason: null, advanced: [], completed: [], duplicate: false, saved: null };
    if (parsed.id !== undefined) {
      record.events.push(parsed.id);
      if (record.events.length > MAX_EVENT_IDS) record.events.splice(0, record.events.length - MAX_EVENT_IDS);
    }
    const saved = this.write();
    this.emitMoves(moved, record.day);
    return { ok: true, reason: null, advanced: moved.advanced, completed: moved.completed, duplicate: false, saved };
  }

  /**
   * Pays a completed quest of today's set once. The claim is written first, then the sink pays; a sink that
   * refuses (or cannot pay now — `canGrant`) leaves the quest completed and claimable. A repeated claim →
   * `already_claimed`, nothing paid.
   */
  claim(questId: string): QuestClaimResult {
    const refuse = (reason: QuestRefusal, grant?: QuestGrantAnswer): QuestClaimResult => ({ ok: false, reason, questId, reward: null, saved: null, ...(grant ? { grant } : {}) });
    if (this.delivering) return refuse('busy');
    const refusal = this.prepare();
    if (refusal) return refuse(refusal);
    const record = this.record;
    const quest = record?.quests.find((candidate) => candidate.id === questId);
    if (!record || !quest) return refuse('unknown_quest');
    if (quest.claimed) return refuse('already_claimed');
    if (quest.progress < quest.target) return refuse('not_completed');
    if (!this.canGrant(quest.reward)) return refuse('reward_refused');
    quest.claimed = true;
    const saved = this.write();
    const grant = this.deliver('claim', quest.reward, { questId: quest.id, day: record.day, auto: false });
    if (!grant.ok) {
      quest.claimed = false;
      void this.write();
      return refuse('reward_refused', grant);
    }
    this.emit({ kind: 'claimed', day: record.day, questId: quest.id, reward: copyReward(quest.reward) });
    return { ok: true, reason: null, questId: quest.id, reward: copyReward(quest.reward), saved, grant };
  }

  /** Writes the current record (a retry after a failed write); pays carried rewards the sink accepts now. */
  save(): QuestSaveResult {
    const refusal = this.prepare();
    if (refusal) return { ok: false, reason: refusal, saved: null };
    return { ok: true, reason: null, saved: this.record ? this.write() : null };
  }

  /** Called after every change (a new day, progress, a completion, a claim, an auto-paid reward); a listener is registered once. Returns the unsubscribe. */
  onChange(listener: QuestListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('QuestService.onChange(): a listener function is required');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drops every listener; changes are refused (`disposed`) from now on. The stored record stays. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private restore(core: SaveReadStatus | undefined): QuestSnapshot {
    // the read succeeded (`missing` included): the gate's Core record as loaded or written since — a service
    // created again in the same session continues the set an earlier one wrote
    const read = core === 'loaded' || core === 'missing';
    const value = read ? this.gate.readCore(RECORD) : undefined;
    const record = value !== undefined && value !== null ? readRecord(value) : null;
    if (read && (value === undefined || value === null)) {
      this.record = null; // no quests were ever saved: the first set is formed now
      this.status = 'ready';
    } else if (read && record) {
      this.record = record;
      this.status = 'ready';
    } else {
      // failed (or never settled), or not a V1 record: unknown — no fresh set over it, no write
      this.problem = read ? 'invalid_record' : 'read_failed';
      this.status = 'unavailable';
    }
    return this.snapshot();
  }

  /** A new local day (or the first set) in memory; a clock behind the stored day changes nothing. */
  private settle(): void {
    if (this.status !== 'ready') return;
    const now = this.clock.now();
    if (!Number.isFinite(now)) return;
    const today = questLocalDay(now, this.clock);
    if (this.record && this.record.day >= today) return;
    this.rollover(today);
  }

  /**
   * GDD «Обновление квестов»: the stored set's completed unclaimed rewards are carried to be paid (once — the
   * carry is part of the record), the old set is dropped, the group is resolved for the new set and the new set
   * is picked. Missed days form nothing. In a running session that already reported its login, the new day
   * counts it (the player is in the game at 00:00).
   */
  private rollover(today: number): void {
    const previous = this.record;
    const carry: CarriedReward[] = previous ? previous.carry.map((item) => ({ ...item, reward: copyReward(item.reward) })) : [];
    if (previous) {
      for (const quest of previous.quests) {
        if (!quest.claimed && quest.progress >= quest.target) carry.push({ questId: quest.id, day: previous.day, reward: copyReward(quest.reward) });
      }
    }
    const group = this.groupFor({
      day: today,
      previousDay: previous ? previous.day : null,
      missedDays: previous ? Math.max(0, today - previous.day - 1) : null,
      payer: this.isPayer ? this.hook('isPayer', () => { const answer: unknown = this.isPayer!(); return typeof answer === 'boolean' ? answer : null; }, null) : null
    });
    const available = this.available ? (quest: QuestDef) => this.hook('available', () => this.available!(quest) !== false, false) : undefined;
    const picked = pickDailyQuests(this.config, { group, random: this.random, ...(available ? { available } : {}) });
    const record: QuestRecord = {
      v: FORMAT,
      day: today,
      group,
      quests: picked.map((quest) => ({
        id: quest.id,
        category: quest.category,
        event: quest.objective.event,
        target: quest.objective.target,
        reward: copyReward(quest.reward),
        progress: 0,
        claimed: false
      })),
      events: [],
      carry
    };
    this.record = record;
    this.unsaved = true;
    this.emit({ kind: 'new_day', day: today });
    if (this.sessionLogin) this.emitMoves(this.advance('login', 1), today);
  }

  private groupFor(facts: QuestGroupFacts): string | null {
    if (!this.resolveGroup) return null;
    const group: unknown = this.hook('resolveGroup', () => this.resolveGroup!(facts), null);
    if (group === null) return null;
    if (typeof group === 'string' && this.config.groups.some((candidate) => candidate.id === group)) return group;
    this.onError(new RangeError(`QuestService: resolveGroup answered ${JSON.stringify(group)} — not a configured group; no group quests`), 'resolveGroup');
    return null;
  }

  /** Progress of today's quests with this goal (claimed and completed ones stay as they are). */
  private advance(type: QuestEventType, amount: number): { advanced: string[]; completed: string[] } {
    const advanced: string[] = [];
    const completed: string[] = [];
    for (const quest of this.record?.quests ?? []) {
      if (quest.event !== type || quest.claimed || quest.progress >= quest.target) continue;
      quest.progress = Math.min(quest.target, quest.progress + amount);
      advanced.push(quest.id);
      if (quest.progress >= quest.target) completed.push(quest.id);
    }
    return { advanced, completed };
  }

  private emitMoves(moved: { advanced: string[]; completed: string[] }, day: number): void {
    for (const questId of moved.advanced) this.emit({ kind: 'progress', day, questId });
    for (const questId of moved.completed) this.emit({ kind: 'completed', day, questId });
  }

  /** Pays carried rewards in order while the sink accepts them; each leaves the record (written) BEFORE it is paid. */
  private flush(): void {
    const record = this.record;
    if (this.delivering || !record) return;
    while (record.carry.length > 0) {
      const item = record.carry[0]!;
      if (!this.canGrant(item.reward)) break;
      record.carry.shift();
      void this.write();
      const grant = this.deliver('carry', item.reward, { questId: item.questId, day: item.day, auto: true });
      if (!grant.ok) {
        record.carry.unshift(item);
        void this.write();
        break;
      }
      this.emit({ kind: 'auto_claimed', day: item.day, questId: item.questId, reward: copyReward(item.reward) });
    }
    if (this.unsaved) void this.write();
  }

  private canGrant(reward: QuestReward): boolean {
    return this.hook('rewards.canGrant', () => this.rewards.canGrant(copyReward(reward)) === true, false);
  }

  private deliver(mode: 'claim' | 'carry', reward: QuestReward, context: QuestRewardContext): QuestGrantAnswer {
    this.delivering = mode;
    try {
      const answer: unknown = this.rewards.grant(copyReward(reward), context);
      if (!isObject(answer)) return { ok: false, reason: 'invalid_answer' };
      // only an explicit ok: true is a delivery
      return (answer.ok === true ? answer : { ...answer, ok: false }) as unknown as QuestGrantAnswer;
    } catch (error) {
      this.onError(error, 'rewards.grant');
      return { ok: false, reason: 'threw' };
    } finally {
      this.delivering = null;
    }
  }

  private refusal(): QuestRefusal | null {
    if (this.disposed) return 'disposed';
    if (this.status === 'unavailable') return 'unavailable';
    if (this.status !== 'ready') return 'not_loaded';
    return this.gate.snapshot().phase === 'open' ? null : 'not_open';
  }

  /** The refusal of a change, else the day settled and written, carried rewards paid. */
  private prepare(): QuestRefusal | null {
    const refusal = this.refusal();
    if (!refusal && !this.delivering) {
      this.settle();
      this.flush();
    }
    return refusal;
  }

  private trackRefused(reason: QuestRefusal): QuestTrackResult {
    return { ok: false, reason, advanced: [], completed: [], duplicate: false, saved: null };
  }

  private view(quest: StoredQuest, group: string | null): QuestView {
    const def = this.defs.get(quest.id);
    return {
      id: quest.id,
      category: quest.category,
      group: quest.category === 'group' ? group : null,
      event: quest.event,
      target: quest.target,
      progress: quest.progress,
      state: quest.claimed ? 'claimed' : quest.progress >= quest.target ? 'completed' : 'active',
      reward: copyReward(quest.reward),
      titleKey: def?.titleKey ?? `quests.${quest.id}.title`,
      descriptionKey: def?.descriptionKey ?? `quests.${quest.id}.description`,
      icon: def?.icon ?? null,
      go: def?.go ?? null
    };
  }

  private hook<T>(name: string, run: () => T, fallback: T): T {
    try {
      return run();
    } catch (error) {
      this.onError(error, name);
      return fallback;
    }
  }

  private emit(change: QuestChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        this.onListenerError(error, change);
      }
    }
  }

  /** One writeCore of the whole record (a fresh copy). A failed write is not retried here: the next change or save() carries it. */
  private write(): Promise<SaveWriteResult> {
    this.unsaved = false;
    return this.gate.writeCore(RECORD, copyRecord(this.record as QuestRecord));
  }
}
