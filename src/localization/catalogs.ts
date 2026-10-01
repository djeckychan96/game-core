import type {
  LocalizationCatalogIssue,
  LocalizationCatalogs,
  LocalizationCatalogValidationOptions
} from './types';
import { normalizeLocale } from './locale';

const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

function catalogObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function placeholders(value: string): string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(/\{([^{}]+)\}/g)) names.add(match[1]!);
  return [...names].sort();
}

export function mergeLocalizationCatalogs(...catalogSets: readonly LocalizationCatalogs[]): LocalizationCatalogs {
  const merged: Record<string, Record<string, string>> = {};
  const spellings = new Map<string, string>();
  for (const catalogs of catalogSets) {
    if (!catalogObject(catalogs)) throw new TypeError('mergeLocalizationCatalogs: every catalog set must be an object');
    for (const [locale, source] of Object.entries(catalogs)) {
      const normalized = normalizeLocale(locale);
      if (!normalized) throw new TypeError(`mergeLocalizationCatalogs: invalid locale "${locale}"`);
      const spelling = spellings.get(normalized);
      if (spelling !== undefined && spelling !== locale) {
        throw new TypeError(`mergeLocalizationCatalogs: duplicate normalized locale "${locale}" conflicts with "${spelling}"`);
      }
      if (!catalogObject(source)) throw new TypeError(`mergeLocalizationCatalogs: catalog "${locale}" must be an object`);
      if (spelling === undefined) {
        spellings.set(normalized, locale);
        merged[locale] = {};
      }
      const target = merged[spelling ?? locale]!;
      for (const [key, value] of Object.entries(source)) {
        if (own(target, key)) throw new TypeError(`mergeLocalizationCatalogs: duplicate key "${key}" for locale "${locale}"`);
        target[key] = value as string;
      }
    }
  }
  for (const catalog of Object.values(merged)) Object.freeze(catalog);
  return Object.freeze(merged);
}

export function validateLocalizationCatalogs(
  catalogs: LocalizationCatalogs,
  options: LocalizationCatalogValidationOptions
): readonly LocalizationCatalogIssue[] {
  const issues: LocalizationCatalogIssue[] = [];
  const supported = new Map<string, string>();
  for (const locale of options.supportedLocales) {
    const normalized = normalizeLocale(locale);
    if (!normalized) {
      issues.push({ code: 'duplicate_locale', locale, detail: 'invalid supported locale' });
      continue;
    }
    const previous = supported.get(normalized);
    if (previous !== undefined) issues.push({ code: 'duplicate_locale', locale, detail: `conflicts with ${previous}` });
    else supported.set(normalized, locale);
  }

  const available = new Map<string, string>();
  if (!catalogObject(catalogs)) return [{ code: 'invalid_catalog', locale: '', detail: 'catalogs must be an object' }];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const normalized = normalizeLocale(locale);
    if (!normalized) {
      issues.push({ code: 'duplicate_locale', locale, detail: 'invalid catalog locale' });
      continue;
    }
    const previous = available.get(normalized);
    if (previous !== undefined) issues.push({ code: 'duplicate_locale', locale, detail: `conflicts with ${previous}` });
    else available.set(normalized, locale);
    if (!options.allowUnknownLocales && !supported.has(normalized)) issues.push({ code: 'unknown_catalog', locale });
    if (!catalogObject(catalog)) {
      issues.push({ code: 'invalid_catalog', locale });
      continue;
    }
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== 'string') issues.push({ code: 'invalid_value', locale, key, detail: 'translation must be a string' });
    }
  }

  for (const [normalized, locale] of supported) {
    if (!available.has(normalized)) issues.push({ code: 'missing_catalog', locale });
  }

  const referenceRequested = options.referenceLocale ?? options.supportedLocales[0];
  const referenceName = referenceRequested === undefined ? undefined : available.get(normalizeLocale(referenceRequested));
  const reference = referenceName === undefined ? undefined : catalogs[referenceName];
  if (!catalogObject(reference)) return issues;
  const referenceKeys = Object.keys(reference);

  for (const [normalized, configuredLocale] of supported) {
    const locale = available.get(normalized);
    if (locale === undefined || locale === referenceName) continue;
    const catalog = catalogs[locale];
    if (!catalogObject(catalog)) continue;
    for (const key of referenceKeys) {
      if (!own(catalog, key)) {
        issues.push({ code: 'missing_key', locale: configuredLocale, key });
        continue;
      }
      const referenceValue = reference[key];
      const value = catalog[key];
      if (typeof referenceValue === 'string' && typeof value === 'string') {
        const expected = placeholders(referenceValue);
        const actual = placeholders(value);
        if (expected.join('\u0000') !== actual.join('\u0000')) {
          issues.push({ code: 'placeholder_mismatch', locale: configuredLocale, key, detail: `${actual.join(',')} != ${expected.join(',')}` });
        }
      }
    }
    for (const key of Object.keys(catalog)) {
      if (!own(reference, key)) issues.push({ code: 'extra_key', locale: configuredLocale, key });
    }
  }
  return issues;
}
