// Daily quests V1 (root entry `game-core`): QuestService over the SaveGate Core record, the config check and
// the set selection, the group rules, the local calendar and the GDD V1 preset.
export { QuestService } from './QuestService';
export { validateQuestConfig, pickDailyQuests, createQuestGroupResolver, questLocalDay, questDayStart } from './config';
export type { QuestPickInput } from './config';
export { QUEST_CATEGORIES, QUEST_EVENT_TYPES, QUEST_AMOUNT_EVENTS } from './types';
export type {
  QuestCategory,
  QuestEventType,
  QuestReward,
  QuestObjective,
  QuestDef,
  QuestGroupDef,
  QuestSetRules,
  QuestConfig,
  QuestGroupFacts,
  QuestGroupResolver,
  QuestGroupRule,
  QuestClock,
  QuestRewardContext,
  QuestGrantAnswer,
  QuestRewardSink,
  QuestEvent,
  QuestStatus,
  QuestProblem,
  QuestRefusal,
  QuestState,
  QuestView,
  QuestSnapshot,
  QuestTrackResult,
  QuestClaimResult,
  QuestSaveResult,
  QuestChangeKind,
  QuestChange,
  QuestListener,
  QuestSaveGate,
  QuestServiceOptions
} from './types';
export {
  DAILY_QUESTS_GDD_V1_VERSION,
  DAILY_QUEST_GROUPS_GDD_V1,
  DAILY_QUESTS_GDD_V1_ROWS,
  DAILY_QUESTS_GDD_V1_CATALOGS,
  dailyQuestsGddV1
} from './presets';
export type { DailyQuestBalanceRow } from './presets';
