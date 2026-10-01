import { describe, expect, it } from 'vitest';
import { mergeLocalizationCatalogs, validateLocalizationCatalogs } from '../../src/localization';
import type { LocalizationCatalogs } from '../../src/localization';

describe('localization catalogs', () => {
  it('merges disjoint core.* and game.* keys for every locale without mutating either input', () => {
    const core = {
      en: { 'core.confirm.exit': 'EXIT' },
      ru: { 'core.confirm.exit': 'ВЫХОД' }
    } as const;
    const game = {
      en: { 'game.play': 'PLAY' },
      ru: { 'game.play': 'ИГРАТЬ' }
    } as const;

    const merged = mergeLocalizationCatalogs(core, game);

    expect(merged).toEqual({
      en: { 'core.confirm.exit': 'EXIT', 'game.play': 'PLAY' },
      ru: { 'core.confirm.exit': 'ВЫХОД', 'game.play': 'ИГРАТЬ' }
    });
    expect(core.en).toEqual({ 'core.confirm.exit': 'EXIT' });
    expect(game.en).toEqual({ 'game.play': 'PLAY' });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.en)).toBe(true);
  });

  it('fails fast on a duplicate translation key or two spellings of the same normalized locale', () => {
    expect(() => mergeLocalizationCatalogs(
      { en: { 'core.action': 'GO' } },
      { en: { 'core.action': 'CONTINUE' } }
    )).toThrow(/duplicate key.*core\.action.*en/i);
    expect(() => mergeLocalizationCatalogs(
      { 'pt-BR': { 'core.action': 'IR' } },
      { pt_BR: { 'game.action': 'JOGAR' } }
    )).toThrow(/duplicate normalized locale/i);
  });

  it('reports missing/unknown catalogs, key parity, placeholder parity and non-string values', () => {
    const catalogs = {
      en: {
        'core.level': 'LEVEL {level}',
        'core.only_en': 'ONLY EN',
        'core.invalid': 7
      },
      ru: {
        'core.level': 'УРОВЕНЬ {number}'
      },
      de: {
        'core.level': 'LEVEL {level}'
      },
      'pt-BR': {},
      pt_BR: {}
    } as unknown as LocalizationCatalogs;

    const issues = validateLocalizationCatalogs(catalogs, {
      supportedLocales: ['en', 'ru', 'fr', 'pt-BR'],
      referenceLocale: 'en'
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_catalog', locale: 'fr' }),
      expect.objectContaining({ code: 'unknown_catalog', locale: 'de' }),
      expect.objectContaining({ code: 'duplicate_locale', locale: 'pt_BR' }),
      expect.objectContaining({ code: 'invalid_value', locale: 'en', key: 'core.invalid' }),
      expect.objectContaining({ code: 'missing_key', locale: 'ru', key: 'core.only_en' }),
      expect.objectContaining({ code: 'placeholder_mismatch', locale: 'ru', key: 'core.level' })
    ]));
  });

  it('accepts complete N-locale catalogs with identical keys and placeholders', () => {
    const catalogs = {
      en: { 'core.level': 'LEVEL {level}', 'game.moves': 'MOVES {count}' },
      ru: { 'core.level': 'УРОВЕНЬ {level}', 'game.moves': 'ХОДЫ {count}' },
      'pt-BR': { 'core.level': 'NÍVEL {level}', 'game.moves': 'JOGADAS {count}' }
    };
    expect(validateLocalizationCatalogs(catalogs, {
      supportedLocales: ['en', 'ru', 'pt-BR'],
      referenceLocale: 'en'
    })).toEqual([]);
  });
});
