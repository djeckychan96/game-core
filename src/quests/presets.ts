// The first daily-quests configuration of the GDD (Artem, 2026-10-12): «Типы квестов» — 2 mandatory, 2 common,
// up to 2 group quests, no repeated goal; «Balance.xlsx» — the ids, conditions and rewards, verbatim. Like the
// ads presets this is product DATA, versioned and never a default: the host passes it explicitly, and a number
// change here is a product change (bump the version).
import type { LocalizationCatalogs } from '../localization/types';
import type { QuestCategory, QuestConfig, QuestEventType } from './types';

/** One row of Balance.xlsx: «ID Квеста» / «Группа» / «Условия» (as event + target) / «Награда». */
export interface DailyQuestBalanceRow {
  readonly id: string;
  readonly category: QuestCategory;
  /** The group of a `group` row («Групповой(Плат / Актив / Возврат)»), else null. */
  readonly group: string | null;
  readonly event: QuestEventType;
  /** `play_time` targets are seconds («Провести в игре N(10) минут» = 600). */
  readonly target: number;
  /** «Награда» — an amount of the game's soft currency (the GDD example: «N(100) монет»). */
  readonly reward: number;
}

export const DAILY_QUESTS_GDD_V1_VERSION = 'gdd-2026-10-12-v1';

/** The group ids of «Типы квестов», highest priority first: returning > payer > active_nonpayer. */
export const DAILY_QUEST_GROUPS_GDD_V1 = ['returning', 'payer', 'active_nonpayer'] as const;

export const DAILY_QUESTS_GDD_V1_ROWS: readonly DailyQuestBalanceRow[] = Object.freeze([
  { id: 'daily_login', category: 'mandatory', group: null, event: 'login', target: 1, reward: 10 },
  { id: 'daily_ad_02', category: 'mandatory', group: null, event: 'rewarded_ad', target: 2, reward: 15 },
  { id: 'daily_level_03', category: 'common', group: null, event: 'level_complete', target: 3, reward: 10 },
  { id: 'daily_level_05', category: 'common', group: null, event: 'level_complete', target: 5, reward: 20 },
  { id: 'daily_level_08', category: 'common', group: null, event: 'level_complete', target: 8, reward: 30 },
  { id: 'daily_gold_100', category: 'common', group: null, event: 'currency_earned', target: 100, reward: 5 },
  { id: 'daily_gold_200', category: 'common', group: null, event: 'currency_earned', target: 200, reward: 15 },
  { id: 'daily_gold_400', category: 'common', group: null, event: 'currency_earned', target: 400, reward: 25 },
  { id: 'daily_booster_01', category: 'common', group: null, event: 'booster_used', target: 1, reward: 5 },
  { id: 'daily_booster_03', category: 'common', group: null, event: 'booster_used', target: 3, reward: 10 },
  { id: 'group_payer_spend_gold_01', category: 'group', group: 'payer', event: 'currency_spent', target: 100, reward: 10 },
  { id: 'group_payer_spend_gold_02', category: 'group', group: 'payer', event: 'currency_spent', target: 250, reward: 20 },
  { id: 'group_payer_purchase', category: 'group', group: 'payer', event: 'purchase', target: 1, reward: 50 },
  { id: 'group_nonpayer_playtime_01', category: 'group', group: 'active_nonpayer', event: 'play_time', target: 600, reward: 15 },
  { id: 'group_payer_playtime_01', category: 'group', group: 'payer', event: 'play_time', target: 600, reward: 15 },
  { id: 'group_return_playtime_01', category: 'group', group: 'returning', event: 'play_time', target: 600, reward: 15 }
].map((row) => Object.freeze(row)) as DailyQuestBalanceRow[]);

/**
 * The GDD V1 config, every reward paid in `rewardId` — the game's soft-currency id (`wallet.currency`), which
 * Balance.xlsx does not name. Set: both mandatory quests, 2 common, 2 from the player group's pool.
 */
export function dailyQuestsGddV1(rewardId: string): QuestConfig {
  if (typeof rewardId !== 'string' || rewardId === '') throw new TypeError('dailyQuestsGddV1(): the soft-currency id of the rewards is required');
  return {
    quests: DAILY_QUESTS_GDD_V1_ROWS.map((row) => ({
      id: row.id,
      category: row.category,
      objective: { event: row.event, target: row.target },
      reward: { id: rewardId, amount: row.reward }
    })),
    set: { mandatory: DAILY_QUESTS_GDD_V1_ROWS.filter((row) => row.category === 'mandatory').map((row) => row.id), common: 2, group: 2 },
    groups: DAILY_QUEST_GROUPS_GDD_V1.map((group) => ({ id: group, pool: DAILY_QUESTS_GDD_V1_ROWS.filter((row) => row.group === group).map((row) => row.id) }))
  };
}

/**
 * Texts of the GDD V1 quests under the default keys: `.title` = Balance «Квест», `.description` = Balance
 * «Условия» (the N(x) notation resolved to x). RU is verbatim; EN is a provisional translation awaiting the
 * product's copy. Merge with the game's catalogs (`mergeLocalizationCatalogs`).
 */
export const DAILY_QUESTS_GDD_V1_CATALOGS = Object.freeze({
  ru: Object.freeze({
    'quests.daily_login.title': 'Зайди в игру',
    'quests.daily_login.description': 'Войти в игру',
    'quests.daily_ad_02.title': 'Посмотри рекламу',
    'quests.daily_ad_02.description': 'Посмотреть 2 рекламных ролика',
    'quests.daily_level_03.title': 'Пройди 3 уровня',
    'quests.daily_level_03.description': 'Пройти 3 уровня',
    'quests.daily_level_05.title': 'Пройди 5 уровней',
    'quests.daily_level_05.description': 'Пройти 5 уровней',
    'quests.daily_level_08.title': 'Пройди 8 уровней',
    'quests.daily_level_08.description': 'Пройти 8 уровней',
    'quests.daily_gold_100.title': 'Заработай 100 монет',
    'quests.daily_gold_100.description': 'Заработать 100 монет',
    'quests.daily_gold_200.title': 'Заработай 200 монет',
    'quests.daily_gold_200.description': 'Заработать 200 монет',
    'quests.daily_gold_400.title': 'Заработай 400 монет',
    'quests.daily_gold_400.description': 'Заработать 400 монет',
    'quests.daily_booster_01.title': 'Используй бустер',
    'quests.daily_booster_01.description': 'Использовать 1 бустер',
    'quests.daily_booster_03.title': 'Используй 3 бустера',
    'quests.daily_booster_03.description': 'Использовать 3 бустера',
    'quests.group_payer_spend_gold_01.title': 'Потрать монеты',
    'quests.group_payer_spend_gold_01.description': 'Потратить 100 монет',
    'quests.group_payer_spend_gold_02.title': 'Сделай крупную покупку',
    'quests.group_payer_spend_gold_02.description': 'Потратить 250 монет',
    'quests.group_payer_purchase.title': 'Воспользуйся предложением',
    'quests.group_payer_purchase.description': 'Совершить 1 покупку за реальные деньги',
    'quests.group_nonpayer_playtime_01.title': 'Проведи время в игре',
    'quests.group_nonpayer_playtime_01.description': 'Провести в игре 10 минут',
    'quests.group_payer_playtime_01.title': 'Не спеши уходить',
    'quests.group_payer_playtime_01.description': 'Провести в игре 10 минут',
    'quests.group_return_playtime_01.title': 'Проведи время в игре',
    'quests.group_return_playtime_01.description': 'Провести в игре 10 минут'
  }),
  en: Object.freeze({
    'quests.daily_login.title': 'Log in',
    'quests.daily_login.description': 'Log in to the game',
    'quests.daily_ad_02.title': 'Watch ads',
    'quests.daily_ad_02.description': 'Watch 2 ads',
    'quests.daily_level_03.title': 'Complete 3 levels',
    'quests.daily_level_03.description': 'Complete 3 levels',
    'quests.daily_level_05.title': 'Complete 5 levels',
    'quests.daily_level_05.description': 'Complete 5 levels',
    'quests.daily_level_08.title': 'Complete 8 levels',
    'quests.daily_level_08.description': 'Complete 8 levels',
    'quests.daily_gold_100.title': 'Earn 100 coins',
    'quests.daily_gold_100.description': 'Earn 100 coins',
    'quests.daily_gold_200.title': 'Earn 200 coins',
    'quests.daily_gold_200.description': 'Earn 200 coins',
    'quests.daily_gold_400.title': 'Earn 400 coins',
    'quests.daily_gold_400.description': 'Earn 400 coins',
    'quests.daily_booster_01.title': 'Use a booster',
    'quests.daily_booster_01.description': 'Use 1 booster',
    'quests.daily_booster_03.title': 'Use 3 boosters',
    'quests.daily_booster_03.description': 'Use 3 boosters',
    'quests.group_payer_spend_gold_01.title': 'Spend coins',
    'quests.group_payer_spend_gold_01.description': 'Spend 100 coins',
    'quests.group_payer_spend_gold_02.title': 'Make a big purchase',
    'quests.group_payer_spend_gold_02.description': 'Spend 250 coins',
    'quests.group_payer_purchase.title': 'Grab an offer',
    'quests.group_payer_purchase.description': 'Make 1 real-money purchase',
    'quests.group_nonpayer_playtime_01.title': 'Spend time in the game',
    'quests.group_nonpayer_playtime_01.description': 'Play for 10 minutes',
    'quests.group_payer_playtime_01.title': "Don't rush off",
    'quests.group_payer_playtime_01.description': 'Play for 10 minutes',
    'quests.group_return_playtime_01.title': 'Spend time in the game',
    'quests.group_return_playtime_01.description': 'Play for 10 minutes'
  })
}) satisfies LocalizationCatalogs;
