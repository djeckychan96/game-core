import { describe, expect, it } from 'vitest';
import { resolveSupportedLocale } from '../../src/localization';

describe('resolveSupportedLocale', () => {
  it.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['ru_RU', 'ru'],
    ['en-US', 'en'],
    ['en_GB', 'en'],
    ['de-DE', 'en'],
    ['', 'en'],
    [null, 'en']
  ])('resolves raw locale %j to %s', (rawLocale, expected) => {
    expect(resolveSupportedLocale(rawLocale, ['ru', 'en'], 'en')).toBe(expected);
  });

  it('prefers an exact regional locale before its supported base locale', () => {
    expect(resolveSupportedLocale('pt_BR', ['pt', 'pt-BR'], 'pt')).toBe('pt-BR');
    expect(resolveSupportedLocale('pt-PT', ['pt', 'pt-BR'], 'pt-BR')).toBe('pt');
  });

  it('returns the configured locale spelling and rejects ambiguous or unsupported defaults', () => {
    expect(resolveSupportedLocale('EN_us', ['en', 'en-US'], 'en')).toBe('en-US');
    expect(() => resolveSupportedLocale('en', ['en-US'], 'en')).toThrow(/defaultLocale/);
    expect(() => resolveSupportedLocale('en', ['pt-BR', 'pt_BR'], 'pt-BR')).toThrow(/duplicate normalized locale/);
  });
});
