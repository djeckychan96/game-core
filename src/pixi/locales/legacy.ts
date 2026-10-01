import { READY_UI_EN } from './en';
import { READY_UI_RU } from './ru';

/** Exact pre-localization defaults, kept separately from the locale catalog where old variants differed. */
export const READY_UI_LEGACY_TEXT = Object.freeze({
  confirm: Object.freeze({
    title: READY_UI_EN['core.confirm.title'],
    donorBody: READY_UI_EN['core.confirm.lose_life'],
    styledBody: 'YOU WILL LOSE 1 HEART',
    exit: READY_UI_EN['core.confirm.exit']
  }),
  lives: Object.freeze({
    title: READY_UI_EN['core.lives.title'],
    donorNext: READY_UI_EN['core.lives.next'],
    styledNext: 'NEXT HEART IN',
    donorRefill: READY_UI_EN['core.lives.refill'],
    styledRefill: 'REFILL NOW!',
    adAction: READY_UI_EN['core.lives.ad_action'],
    full: READY_UI_EN['core.common.max']
  }),
  settings: Object.freeze({
    title: READY_UI_EN['core.settings.title'],
    sound: READY_UI_EN['core.settings.sound'],
    music: READY_UI_EN['core.settings.music'],
    haptic: READY_UI_EN['core.settings.haptic'],
    exit: READY_UI_EN['core.settings.exit'],
    restart: READY_UI_EN['core.settings.restart']
  }),
  result: Object.freeze({
    level: (level: number): string => READY_UI_EN['core.result.level'].replace('{level}', String(level)),
    completed: READY_UI_EN['core.result.completed'],
    failed: READY_UI_EN['core.result.failed'],
    rewards: READY_UI_EN['core.result.rewards'],
    continue: READY_UI_EN['core.result.continue'],
    retry: READY_UI_EN['core.result.retry'],
    exit: READY_UI_EN['core.result.exit']
  }),
  hard: READY_UI_EN['core.level_map.hard'],
  max: READY_UI_EN['core.common.max'],
  shopTitle: READY_UI_EN['core.shop.special_offer'],
  noAds: Object.freeze({
    no: READY_UI_EN['core.no_ads.word_no'],
    ads: READY_UI_EN['core.no_ads.word_ads'],
    description: READY_UI_EN['core.no_ads.description']
  }),
  starterPackTitle: READY_UI_EN['core.starter_pack.title'],
  // OrientationGuard shipped with Russian copy before LocalizationRuntime existed.
  orientation: READY_UI_RU['core.orientation.rotate_device']
});
