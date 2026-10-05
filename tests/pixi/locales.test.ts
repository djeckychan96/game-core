import { describe, expect, it } from 'vitest';
import { LocalizationRuntime, validateLocalizationCatalogs } from '../../src/localization';
import { READY_UI_CATALOGS } from '../../src/pixi';
import './setup';

const CORE_KEYS = [
  'core.common.max',
  'core.confirm.exit',
  'core.confirm.lose_life',
  'core.confirm.restart',
  'core.confirm.title',
  'core.level_map.hard',
  'core.level_map.level',
  'core.level_map.play',
  'core.lives.ad_action',
  'core.lives.next',
  'core.lives.refill',
  'core.lives.title',
  'core.no_ads.description',
  'core.no_ads.word_ads',
  'core.no_ads.word_no',
  'core.offer.title',
  'core.orientation.rotate_device',
  'core.result.completed',
  'core.result.continue',
  'core.result.exit',
  'core.result.failed',
  'core.result.level',
  'core.result.retry',
  'core.result.rewards',
  'core.settings.exit',
  'core.settings.haptic',
  'core.settings.music',
  'core.settings.restart',
  'core.settings.sound',
  'core.settings.title',
  'core.shop.special_offer',
  'core.starter_pack.title'
] as const;

describe('Ready UI RU/EN catalogs', () => {
  it('ships exactly the production Core key set in both locales with structural parity', () => {
    expect(Object.keys(READY_UI_CATALOGS.en).sort()).toEqual(CORE_KEYS);
    expect(Object.keys(READY_UI_CATALOGS.ru).sort()).toEqual(CORE_KEYS);
    expect(Object.keys(READY_UI_CATALOGS.en).every((key) => key.startsWith('core.'))).toBe(true);
    expect(Object.keys(READY_UI_CATALOGS.ru).every((key) => key.startsWith('core.'))).toBe(true);
    expect(validateLocalizationCatalogs(READY_UI_CATALOGS, {
      supportedLocales: ['en', 'ru'],
      referenceLocale: 'en'
    })).toEqual([]);
  });

  it('uses the approved donor/SoliPix copy and interpolates the result level through the shared runtime', () => {
    const en = new LocalizationRuntime({ rawLocale: 'en-US', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
    const ru = new LocalizationRuntime({ rawLocale: 'ru_RU', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });

    expect(en.t('core.confirm.lose_life')).toBe('You will lose 1 heart');
    expect(en.t('core.lives.next')).toBe('Next heart in');
    expect(en.t('core.result.level', { level: 7 })).toBe('LEVEL 7');
    expect(ru.t('core.confirm.lose_life')).toBe('Вы потеряете 1 жизнь');
    expect(ru.t('core.lives.next')).toBe('Новая жизнь через');
    expect(ru.t('core.result.level', { level: 7 })).toBe('УРОВЕНЬ 7');
  });
});
