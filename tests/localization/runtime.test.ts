import { describe, expect, it } from 'vitest';
import { LocalizationRuntime } from '../../src/localization';
import type { LocalizationDiagnostic } from '../../src/localization';

const catalogs = {
  en: {
    'core.greeting': 'Hello, {name}!',
    'core.level': 'LEVEL {level}',
    'core.fallback_only': 'Fallback text'
  },
  ru: {
    'core.greeting': 'Привет, {name}!',
    'core.level': 'УРОВЕНЬ {level}'
  }
} as const;

describe('LocalizationRuntime', () => {
  it('selects a locale once at construction and interpolates string/number params', () => {
    const i18n = new LocalizationRuntime({
      rawLocale: 'ru_RU',
      supportedLocales: ['en', 'ru'],
      defaultLocale: 'en',
      catalogs
    });

    expect(i18n.locale).toBe('ru');
    expect(i18n.t('core.greeting', { name: 'Мира' })).toBe('Привет, Мира!');
    expect(i18n.t('core.level', { level: 7 })).toBe('УРОВЕНЬ 7');
    expect(Object.isFrozen(i18n)).toBe(true);
  });

  it('uses fallbackLocale for a missing selected-locale key, then returns the key when both catalogs miss', () => {
    const diagnostics: LocalizationDiagnostic[] = [];
    const i18n = new LocalizationRuntime({
      rawLocale: 'ru',
      supportedLocales: ['en', 'ru'],
      defaultLocale: 'ru',
      fallbackLocale: 'en',
      catalogs,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });

    expect(i18n.t('core.fallback_only')).toBe('Fallback text');
    expect(i18n.t('game.unknown')).toBe('game.unknown');
    expect(diagnostics).toEqual([
      { code: 'fallback_key', key: 'core.fallback_only', locale: 'ru', fallbackLocale: 'en' },
      { code: 'missing_key', key: 'game.unknown', locale: 'ru', fallbackLocale: 'en' }
    ]);
  });

  it('defaults fallbackLocale to defaultLocale, independently of the selected locale', () => {
    const diagnostics: LocalizationDiagnostic[] = [];
    const i18n = new LocalizationRuntime({
      rawLocale: 'ru',
      supportedLocales: ['en', 'ru'],
      defaultLocale: 'en',
      catalogs,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });
    expect(i18n.t('core.fallback_only')).toBe('Fallback text');
    expect(diagnostics[0]).toEqual({ code: 'fallback_key', key: 'core.fallback_only', locale: 'ru', fallbackLocale: 'en' });
  });

  it('leaves a missing placeholder visible, never writes undefined, and diagnoses each problem once', () => {
    const diagnostics: LocalizationDiagnostic[] = [];
    const i18n = new LocalizationRuntime({
      rawLocale: 'ru',
      supportedLocales: ['en', 'ru'],
      defaultLocale: 'en',
      catalogs,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });

    expect(i18n.t('core.greeting')).toBe('Привет, {name}!');
    expect(i18n.t('core.greeting', {})).toBe('Привет, {name}!');
    expect(i18n.t('core.fallback_only')).toBe('Fallback text');
    expect(i18n.t('core.fallback_only')).toBe('Fallback text');
    expect(i18n.t('missing')).toBe('missing');
    expect(i18n.t('missing')).toBe('missing');

    expect(diagnostics).toEqual([
      { code: 'missing_param', key: 'core.greeting', locale: 'ru', param: 'name' },
      { code: 'fallback_key', key: 'core.fallback_only', locale: 'ru', fallbackLocale: 'en' },
      { code: 'missing_key', key: 'missing', locale: 'ru', fallbackLocale: 'en' }
    ]);
  });

  it('copies catalogs and contains a throwing diagnostic observer', () => {
    const mutable = { en: { 'core.value': 'before' } };
    const i18n = new LocalizationRuntime({
      rawLocale: 'en',
      supportedLocales: ['en'],
      defaultLocale: 'en',
      catalogs: mutable,
      onDiagnostic: () => { throw new Error('observer bug'); }
    });
    mutable.en['core.value'] = 'after';
    expect(i18n.t('core.value')).toBe('before');
    expect(() => i18n.t('missing')).not.toThrow();
    expect(i18n.t('missing')).toBe('missing');
  });

  it('matches catalog locale spellings through the same normalization as supported locales', () => {
    const i18n = new LocalizationRuntime({
      rawLocale: 'PT_br',
      supportedLocales: ['pt-BR'],
      defaultLocale: 'pt-BR',
      catalogs: { pt_br: { 'game.play': 'JOGAR' } }
    });

    expect(i18n.locale).toBe('pt-BR');
    expect(i18n.t('game.play')).toBe('JOGAR');
  });

  it('fails fast on structural configuration errors but not ordinary missing content', () => {
    expect(() => new LocalizationRuntime({
      supportedLocales: ['en', 'ru'], defaultLocale: 'de', catalogs
    })).toThrow(/defaultLocale/);
    expect(() => new LocalizationRuntime({
      supportedLocales: ['en', 'ru'], defaultLocale: 'en', fallbackLocale: 'de', catalogs
    })).toThrow(/fallbackLocale/);
    expect(() => new LocalizationRuntime({
      supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: { en: catalogs.en }
    })).toThrow(/catalog.*ru/i);
    expect(() => new LocalizationRuntime({
      supportedLocales: ['en'], defaultLocale: 'en', catalogs: { en: { bad: 1 } } as never
    })).toThrow(/string/i);
  });
});
