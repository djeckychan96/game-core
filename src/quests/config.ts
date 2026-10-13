// Daily quests V1 — the config check, the day's set selection, the group rules and the local calendar.
// Pure functions: the random source and the clock come in from the caller.
import { QUEST_CATEGORIES, QUEST_EVENT_TYPES } from './types';
import type { QuestClock, QuestConfig, QuestDef, QuestGroupFacts, QuestGroupResolver, QuestGroupRule } from './types';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const QUEST_KEYS = ['id', 'category', 'objective', 'reward', 'titleKey', 'descriptionKey', 'icon', 'go'];
const CONFIG_KEYS = ['quests', 'set', 'groups'];
const SET_KEYS = ['mandatory', 'common', 'group'];
const RULE_KEYS = ['group', 'payer', 'minMissedDays', 'when'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isCount = (value: unknown, min: number): value is number => Number.isSafeInteger(value) && (value as number) >= min;

/**
 * Every problem of a quest config, in order (empty = valid): unique non-empty ids, known categories and event
 * types, targets integers ≥ 1, rewards `{ id, amount ≥ 0 }`, mandatory ids that are `mandatory` quests with
 * distinct goals, counts integers ≥ 0, unique groups whose pools hold `group` quests. Unknown keys are refused
 * (a misspelled field never passes silently).
 */
export function validateQuestConfig(config: QuestConfig): string[] {
  const issues: string[] = [];
  if (!isObject(config)) return ['the config must be an object { quests, set, groups }'];
  for (const key of Object.keys(config)) if (!CONFIG_KEYS.includes(key)) issues.push(`${key} is not a config field (allowed: ${CONFIG_KEYS.join(', ')})`);
  const byId = new Map<string, QuestDef>();
  if (!Array.isArray(config.quests)) issues.push('quests must be an array');
  else {
    config.quests.forEach((quest, index) => {
      const at = `quests[${index}]`;
      if (!isObject(quest)) return void issues.push(`${at} must be an object`);
      for (const key of Object.keys(quest)) if (!QUEST_KEYS.includes(key)) issues.push(`${at}.${key} is not a quest field (allowed: ${QUEST_KEYS.join(', ')})`);
      if (!isName(quest.id)) issues.push(`${at}.id must be a non-empty string`);
      else if (byId.has(quest.id)) issues.push(`${at}.id "${quest.id}" is used twice`);
      else byId.set(quest.id, quest as unknown as QuestDef);
      if (!(QUEST_CATEGORIES as readonly unknown[]).includes(quest.category)) issues.push(`${at}.category must be one of ${QUEST_CATEGORIES.join(' / ')}`);
      const objective = quest.objective as unknown;
      if (!isObject(objective)) issues.push(`${at}.objective must be { event, target }`);
      else {
        if (!(QUEST_EVENT_TYPES as readonly unknown[]).includes(objective.event)) issues.push(`${at}.objective.event must be one of ${QUEST_EVENT_TYPES.join(' / ')}`);
        if (!isCount(objective.target, 1)) issues.push(`${at}.objective.target must be an integer ≥ 1`);
        for (const key of Object.keys(objective)) if (key !== 'event' && key !== 'target') issues.push(`${at}.objective.${key} is not an objective field`);
      }
      const reward = quest.reward as unknown;
      if (!isObject(reward) || !isName(reward.id) || !isCount(reward.amount, 0)) issues.push(`${at}.reward must be { id: a non-empty string, amount: an integer ≥ 0 }`);
      for (const key of ['titleKey', 'descriptionKey', 'icon', 'go'] as const) {
        if (quest[key] !== undefined && !isName(quest[key])) issues.push(`${at}.${key} must be a non-empty string when given`);
      }
    });
  }
  const set = config.set as unknown;
  if (!isObject(set)) issues.push('set must be { mandatory, common, group }');
  else {
    for (const key of Object.keys(set)) if (!SET_KEYS.includes(key)) issues.push(`set.${key} is not a set rule (allowed: ${SET_KEYS.join(', ')})`);
    if (!Array.isArray(set.mandatory)) issues.push('set.mandatory must be an array of quest ids');
    else {
      const goals = new Map<string, string>();
      const seen = new Set<string>();
      for (const id of set.mandatory as unknown[]) {
        const quest = typeof id === 'string' ? byId.get(id) : undefined;
        if (!quest) issues.push(`set.mandatory: "${String(id)}" is not a quest id`);
        else if (seen.has(quest.id)) issues.push(`set.mandatory: "${quest.id}" is listed twice`);
        else if (quest.category !== 'mandatory') issues.push(`set.mandatory: "${quest.id}" is a ${String(quest.category)} quest`);
        else {
          seen.add(quest.id);
          const goal = quest.objective?.event;
          const other = goals.get(goal);
          if (other !== undefined) issues.push(`set.mandatory: "${quest.id}" repeats the goal ${goal} of "${other}"`);
          else goals.set(goal, quest.id);
        }
      }
    }
    if (!isCount(set.common, 0)) issues.push('set.common must be an integer ≥ 0');
    if (!isCount(set.group, 0)) issues.push('set.group must be an integer ≥ 0');
  }
  if (!Array.isArray(config.groups)) issues.push('groups must be an array');
  else {
    const groups = new Set<string>();
    config.groups.forEach((group, index) => {
      const at = `groups[${index}]`;
      if (!isObject(group)) return void issues.push(`${at} must be { id, pool }`);
      for (const key of Object.keys(group)) if (key !== 'id' && key !== 'pool') issues.push(`${at}.${key} is not a group field`);
      if (!isName(group.id)) issues.push(`${at}.id must be a non-empty string`);
      else if (groups.has(group.id)) issues.push(`${at}.id "${group.id}" is used twice`);
      else groups.add(group.id);
      if (!Array.isArray(group.pool)) return void issues.push(`${at}.pool must be an array of quest ids`);
      const pool = new Set<string>();
      for (const id of group.pool as unknown[]) {
        const quest = typeof id === 'string' ? byId.get(id) : undefined;
        if (!quest) issues.push(`${at}.pool: "${String(id)}" is not a quest id`);
        else if (pool.has(quest.id)) issues.push(`${at}.pool: "${quest.id}" is listed twice`);
        else if (quest.category !== 'group') issues.push(`${at}.pool: "${quest.id}" is a ${String(quest.category)} quest`);
        else pool.add(quest.id);
      }
    });
  }
  return issues;
}

/** Fisher–Yates over a copy; a random answer outside [0, 1) is clamped. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const r = Number(random());
    const j = Math.min(i, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * (i + 1))));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface QuestPickInput {
  /** The player's group (one of `config.groups`), or null for no group quests. */
  group: string | null;
  random: () => number;
  /** false = never picked (default: every quest is available). */
  available?: (quest: QuestDef) => boolean;
}

/**
 * One day's set of a VALID config, in display order (mandatory, group, common) — GDD «Типы квестов»: the listed
 * mandatory quests, then `set.common` random picks from the common pool, then `set.group` random picks from the
 * group's pool. A goal (the objective's event type) appears once: a pick that repeats a goal already in the set
 * is skipped for the next candidate, and when the pool runs out the set is smaller — never a duplicate.
 */
export function pickDailyQuests(config: QuestConfig, input: QuestPickInput): QuestDef[] {
  const byId = new Map(config.quests.map((quest) => [quest.id, quest]));
  const usable = (quest: QuestDef | undefined): quest is QuestDef => quest !== undefined && (input.available ? input.available(quest) : true);
  const goals = new Set<string>();
  const take = (candidates: readonly QuestDef[], count: number): QuestDef[] => {
    const picked: QuestDef[] = [];
    for (const quest of candidates) {
      if (picked.length >= count) break;
      if (goals.has(quest.objective.event)) continue;
      goals.add(quest.objective.event);
      picked.push(quest);
    }
    return picked;
  };
  const mandatory = take(config.set.mandatory.map((id) => byId.get(id)).filter(usable), Infinity);
  const common = take(shuffled(config.quests.filter((quest) => quest.category === 'common' && usable(quest)), input.random), config.set.common);
  const pool = input.group === null ? undefined : config.groups.find((group) => group.id === input.group)?.pool;
  const grouped = pool ? take(shuffled(pool.map((id) => byId.get(id)).filter(usable), input.random), config.set.group) : [];
  return [...mandatory, ...grouped, ...common];
}

/**
 * The group resolver of a rules table: the first rule (highest priority first) whose conditions all hold
 * names the group; none → null (no group quests). GDD order: returning > payer > active_nonpayer, e.g.
 * `[{ group: 'returning', minMissedDays: N }, { group: 'payer', payer: true }, { group: 'active_nonpayer', payer: false, when }]`
 * — N and the activity condition are product decisions, so they come in here, never from Core.
 * `[{ group: 'payer' }]` is an explicit QA group.
 */
export function createQuestGroupResolver(rules: readonly QuestGroupRule[]): QuestGroupResolver {
  if (!Array.isArray(rules)) throw new TypeError('createQuestGroupResolver(): an array of rules is required');
  rules.forEach((rule, index) => {
    const fail = (message: string): never => {
      throw new RangeError(`createQuestGroupResolver(): rules[${index}]${message}`);
    };
    if (!isObject(rule)) fail(' must be an object');
    for (const key of Object.keys(rule)) if (!RULE_KEYS.includes(key)) fail(`.${key} is not a rule field (allowed: ${RULE_KEYS.join(', ')})`);
    if (!isName(rule.group)) fail('.group must be a non-empty string');
    if (rule.payer !== undefined && typeof rule.payer !== 'boolean') fail('.payer must be a boolean');
    if (rule.minMissedDays !== undefined && !isCount(rule.minMissedDays, 1)) fail('.minMissedDays must be an integer ≥ 1');
    if (rule.when !== undefined && typeof rule.when !== 'function') fail('.when must be a function');
  });
  const table = rules.map((rule) => ({ ...rule }));
  return (facts: QuestGroupFacts) => {
    for (const rule of table) {
      if (rule.payer !== undefined && facts.payer !== rule.payer) continue;
      if (rule.minMissedDays !== undefined && (facts.missedDays === null || facts.missedDays < rule.minMissedDays)) continue;
      if (rule.when && rule.when(facts) !== true) continue;
      return rule.group;
    }
    return null;
  };
}

const offsetAt = (clock: QuestClock, at: number): number => {
  const offset = Number(clock.timezoneOffsetMinutes(at));
  return Number.isFinite(offset) ? offset : 0;
};

/** The player's local day of an instant: whole days since 1970-01-01 00:00 local time. */
export function questLocalDay(at: number, clock: QuestClock): number {
  return Math.floor((at - offsetAt(clock, at) * MINUTE_MS) / DAY_MS);
}

/** Epoch ms of local 00:00 that starts `day` (the offset re-read at the result, so a DST change that day is followed). */
export function questDayStart(day: number, clock: QuestClock): number {
  const local = day * DAY_MS;
  const guess = local + offsetAt(clock, local) * MINUTE_MS;
  return local + offsetAt(clock, guess) * MINUTE_MS;
}
