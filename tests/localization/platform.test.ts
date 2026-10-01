import { describe, expect, it } from 'vitest';
import { LocalizationRuntime } from '../../src/localization';
import { PlatformRuntime, createDevPlatform } from '../../src/platform';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { makeYandex } from '../platform/yandex/fixtures';

async function bootDev(rawLocale: string, defaultLocale = 'en'): Promise<LocalizationRuntime> {
  const platform = new PlatformRuntime(createDevPlatform({ language: rawLocale }));
  await platform.ready();
  return new LocalizationRuntime({
    rawLocale: platform.environment.language(),
    supportedLocales: ['ru', 'en'],
    defaultLocale,
    catalogs: READY_UI_CATALOGS
  });
}

describe('boot-time platform language seam', () => {
  it('maps DEV ru_RU → ru, en-US → en, and an unsupported locale → configured default', async () => {
    await expect(bootDev('ru_RU')).resolves.toMatchObject({ locale: 'ru' });
    await expect(bootDev('en-US')).resolves.toMatchObject({ locale: 'en' });
    await expect(bootDev('de-DE', 'ru')).resolves.toMatchObject({ locale: 'ru' });
  });

  it('reads Yandex language only after PlatformRuntime.ready() has populated the environment', async () => {
    const harness = makeYandex((fake) => { fake.lang = 'ru_RU'; });
    const platform = new PlatformRuntime(harness.platform);
    expect(platform.environment.language()).toBe('');

    await platform.ready();
    const i18n = new LocalizationRuntime({
      rawLocale: platform.environment.language(),
      supportedLocales: ['ru', 'en'],
      defaultLocale: 'en',
      catalogs: READY_UI_CATALOGS
    });

    expect(i18n.locale).toBe('ru');
    expect(harness.fake.calls.slice(0, 3)).toEqual(['init', 'getPlayer', 'getPayments:signed=false']);
  });
});
