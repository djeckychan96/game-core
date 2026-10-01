import { LocalizationRuntime } from 'game-core';
import { READY_UI_CATALOGS } from 'game-core/pixi';

/**
 * Showcase/manual-QA locale selection only. Production hosts must source rawLocale from
 * `await platform.ready()` followed by `platform.environment.language()`.
 */
export function createShowcaseLocalization(search = window.location.search): LocalizationRuntime {
  const requestedLocale = new URLSearchParams(search).get('locale');

  return new LocalizationRuntime({
    rawLocale: requestedLocale === 'ru' ? 'ru' : 'en',
    supportedLocales: ['en', 'ru'],
    defaultLocale: 'en',
    catalogs: READY_UI_CATALOGS
  });
}
