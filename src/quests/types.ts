// Daily quests V1 — the public shapes. The quest set, its progress and its claims live in the SaveGate Core
// record `quests`; the reward is paid by the host's reward sink (the Core wallet through
// `createWalletQuestRewards`), never by the quest service itself. Texts are localization keys, never copy.
import type { SaveGate, SaveWriteResult } from '../save/SaveGate';

/** Where a quest comes from in the day's set: listed in the config (`mandatory`), the shared pool (`common`), the player group's pool (`group`). */
export const QUEST_CATEGORIES = ['mandatory', 'common', 'group'] as const;
export type QuestCategory = (typeof QUEST_CATEGORIES)[number];

/**
 * The game actions a quest can count — reported by the host through `QuestService.track()`.
 * `login` a game entry (one per session); `rewarded_ad` a CONFIRMED rewarded ad; `level_complete` a won level;
 * `currency_earned` / `currency_spent` soft-currency amounts (any source — `trackWalletForQuests` wires the Core
 * wallet); `booster_used` a booster use that really applied; `play_time` seconds of ACTIVE play;
 * `purchase` a confirmed real-money purchase (`purchaseEventToQuestEvent`).
 * The event type is also the quest's GOAL: a day's set never holds two quests with the same one.
 */
export const QUEST_EVENT_TYPES = [
  'login',
  'rewarded_ad',
  'level_complete',
  'currency_earned',
  'currency_spent',
  'booster_used',
  'play_time',
  'purchase'
] as const;
export type QuestEventType = (typeof QUEST_EVENT_TYPES)[number];

/** Event types whose `amount` is a quantity the host must give (coins, seconds); the others count 1 by default. */
export const QUEST_AMOUNT_EVENTS: readonly QuestEventType[] = ['currency_earned', 'currency_spent', 'play_time'];

/** A host-owned resource id (the wallet's currency, `lives` …) and an amount — the service never interprets it. */
export interface QuestReward {
  id: string;
  /** An integer ≥ 0. */
  amount: number;
}

export interface QuestObjective {
  event: QuestEventType;
  /** An integer ≥ 1 — events (or coins, or seconds of play) to reach. */
  target: number;
}

/** One quest of the config (GDD «Конфиг»): id, category, the task (type + its setting), the reward, texts by key. */
export interface QuestDef {
  /** Unique, e.g. `daily_level_03`. */
  id: string;
  category: QuestCategory;
  objective: QuestObjective;
  reward: QuestReward;
  /** Localization key of the name; default `quests.<id>.title`. */
  titleKey?: string;
  /** Localization key of the task text; default `quests.<id>.description`. */
  descriptionKey?: string;
  /** Host art id, handed on as is. */
  icon?: string;
  /** Host destination of the «Go» button (`shop`, `map` …), handed on as is. */
  go?: string;
}

/** A player group and the ids of its pool (category `group` quests). */
export interface QuestGroupDef {
  id: string;
  pool: readonly string[];
}

/** How a day's set is formed: the listed mandatory quests, then `common` picks, then `group` picks. */
export interface QuestSetRules {
  /** Ids of `mandatory` quests, given to every player every day (no two with the same goal). */
  mandatory: readonly string[];
  /** How many `common` quests to pick (an integer ≥ 0). */
  common: number;
  /** How many quests to pick from the player group's pool (an integer ≥ 0). */
  group: number;
}

export interface QuestConfig {
  quests: readonly QuestDef[];
  set: QuestSetRules;
  /** The player groups, highest priority first (the resolver decides which one a player is in). */
  groups: readonly QuestGroupDef[];
}

/** What the group resolver is told when a new day's set is formed. */
export interface QuestGroupFacts {
  /** The new set's local day (days since 1970-01-01 in the player's local time). */
  day: number;
  /** The local day of the stored set before this one — the last day the game ran with quests; null when none is stored. */
  previousDay: number | null;
  /** Whole local days without a game between them (played yesterday → 0); null when no previous day is stored. */
  missedDays: number | null;
  /** The host's `isPayer()` answer; null when the host gives none. */
  payer: boolean | null;
}

/** The player's group for a new set (one of `config.groups`), or null for no group quests. */
export type QuestGroupResolver = (facts: QuestGroupFacts) => string | null;

/**
 * One rule of `createQuestGroupResolver`: every condition given must hold; a rule without conditions always
 * matches (an explicit QA group). The thresholds are product data — no Core default.
 */
export interface QuestGroupRule {
  group: string;
  /** Only a player whose `payer` fact is exactly this (an unknown fact never matches). */
  payer?: boolean;
  /** Only a player with at least this many missed days (an integer ≥ 1); a player without a stored day never matches. */
  minMissedDays?: number;
  /** Any further host condition. */
  when?: (facts: QuestGroupFacts) => boolean;
}

/** The player's local calendar. */
export interface QuestClock {
  /** Epoch ms — the device clock, or a server-anchored one when the host has it. */
  now(): number;
  /** `Date#getTimezoneOffset()` at that instant (UTC minus local, minutes): `(at) => new Date(at).getTimezoneOffset()`. */
  timezoneOffsetMinutes(at: number): number;
}

export interface QuestRewardContext {
  questId: string;
  /** The local day of the set the quest belonged to. */
  day: number;
  /** true for a completed quest paid by the day change (never claimed by the player). */
  auto: boolean;
}

/** The sink's answer — a `SoftCurrencyResult` fits. */
export interface QuestGrantAnswer {
  ok: boolean;
  reason?: string | null;
  /** The sink's own durable write, when it has one. */
  saved?: Promise<SaveWriteResult> | null;
}

/** Pays rewards through the game's existing economy (`createWalletQuestRewards(wallet)`). */
export interface QuestRewardSink {
  /** Would `grant` accept this reward right now? No side effect. */
  canGrant(reward: QuestReward): boolean;
  /** Delivers it — synchronously decided. Called once per claim; never for a refused `canGrant`. */
  grant(reward: QuestReward, context: QuestRewardContext): QuestGrantAnswer;
}

/** One game action. Every event counts only toward quests already in the day's set. */
export interface QuestEvent {
  type: QuestEventType;
  /** `currency_earned` / `currency_spent` / `play_time`: required, an integer ≥ 1. Others: an integer ≥ 1, default 1 (`login` only 1). */
  amount?: number;
  /** Identity of the action (a purchase token, a level-run id): the same id counts once per day. */
  id?: string;
}

/**
 * idle → load() → loading → ready (the set is known or a new player's set is formed) or unavailable (the Core read
 * failed or the stored record is not a V1 quests record: nothing is shown as progress, nothing is written).
 */
export type QuestStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export type QuestProblem = 'read_failed' | 'invalid_record';

export type QuestRefusal =
  /** load() has not settled. */
  | 'not_loaded'
  /** A failed Core read or an invalid record. */
  | 'unavailable'
  /** The SaveGate is not open yet — a change could not be saved. */
  | 'not_open'
  /** dispose() was called. */
  | 'disposed'
  /** Unknown type, an amount that is not an integer ≥ 1, an empty id. */
  | 'invalid_event'
  /** An event raised while an earlier day's reward is being paid — those coins are not today's progress. */
  | 'carryover'
  /** claim() from inside a reward delivery. */
  | 'busy'
  /** No quest with this id in today's set. */
  | 'unknown_quest'
  | 'not_completed'
  | 'already_claimed'
  /** The reward sink cannot pay it now (the wallet is not writable …): nothing changed. */
  | 'reward_refused';

/** active → completed (the reward is available) → claimed. */
export type QuestState = 'active' | 'completed' | 'claimed';

export interface QuestView {
  id: string;
  category: QuestCategory;
  /** The set's group for a `group` quest, else null. */
  group: string | null;
  event: QuestEventType;
  target: number;
  /** 0..target. */
  progress: number;
  state: QuestState;
  reward: QuestReward;
  titleKey: string;
  descriptionKey: string;
  icon: string | null;
  go: string | null;
}

export interface QuestSnapshot {
  status: QuestStatus;
  problem: QuestProblem | null;
  /** ready AND the SaveGate is open AND not disposed: events and claims are accepted. */
  writable: boolean;
  /** The set's local day; null while unknown. */
  day: number | null;
  group: string | null;
  /** Display order: mandatory, group, common. Claimed quests stay listed with state `claimed`. */
  quests: QuestView[];
  /** Completed, not claimed (a badge). */
  claimable: number;
  /** Every quest of a non-empty set is claimed («Все задания на сегодня выполнены»). */
  allClaimed: boolean;
  /** Earlier days' completed rewards still waiting for the sink. */
  pendingRewards: number;
  /** Epoch ms of the next set (the next local 00:00); null while unknown. */
  nextResetAt: number | null;
  /** ms until then (the «Новые задания через» timer); null while unknown. */
  msUntilReset: number | null;
}

export interface QuestTrackResult {
  ok: boolean;
  reason: QuestRefusal | null;
  /** Quests whose progress moved. */
  advanced: string[];
  /** Quests this event completed. */
  completed: string[];
  /** The event's id was already counted today: nothing changed. */
  duplicate: boolean;
  /** The SaveGate write of the record; null when nothing was written. */
  saved: Promise<SaveWriteResult> | null;
}

export interface QuestClaimResult {
  ok: boolean;
  reason: QuestRefusal | null;
  questId: string;
  /** What was paid; null when refused. */
  reward: QuestReward | null;
  /** The record write that marked the claim; null when refused. */
  saved: Promise<SaveWriteResult> | null;
  /** The sink's answer (also for a `reward_refused` grant). */
  grant?: QuestGrantAnswer;
}

export interface QuestSaveResult {
  ok: boolean;
  reason: QuestRefusal | null;
  saved: Promise<SaveWriteResult> | null;
}

export type QuestChangeKind = 'new_day' | 'progress' | 'completed' | 'claimed' | 'auto_claimed';

export interface QuestChange {
  kind: QuestChangeKind;
  /** The day of the set the change belongs to (`auto_claimed`: the earlier day). */
  day: number;
  questId?: string;
  reward?: QuestReward;
}

export type QuestListener = (change: QuestChange) => void;

/** The SaveGate methods the service uses — pass the game's SaveGate. */
export type QuestSaveGate = Pick<SaveGate, 'load' | 'snapshot' | 'readCore' | 'writeCore'>;

export interface QuestServiceOptions {
  gate: QuestSaveGate;
  config: QuestConfig;
  rewards: QuestRewardSink;
  clock: QuestClock;
  /** [0, 1) — `Math.random`, or a seeded generator. Used only when a new set is formed. */
  random: () => number;
  /** The player's group for a new set; omitted = no group quests. */
  resolveGroup?: QuestGroupResolver;
  /** The `payer` fact for the resolver (a real-money purchase is registered). */
  isPayer?: () => boolean;
  /** false = the quest cannot be given on this build / platform (no payments, no rewarded ads): never picked. */
  available?: (quest: QuestDef) => boolean;
  /** Where a throwing listener lands; defaults to console.error. The change itself stands. */
  onListenerError?: (error: unknown, change: QuestChange) => void;
  /** Where a throwing host hook (resolveGroup / isPayer / available / the sink) lands; defaults to console.error. */
  onError?: (error: unknown, hook: string) => void;
}
