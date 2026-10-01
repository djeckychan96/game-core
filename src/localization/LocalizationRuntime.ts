import type { LocalizationRuntimeOptions, LocalizationTextProvider, TranslationParams } from './types';
import type { LocalizationCatalogs, LocalizationDiagnostic } from './types';
import { mergeLocalizationCatalogs, validateLocalizationCatalogs } from './catalogs';
import { configuredLocale, normalizeLocale, resolveSupportedLocale, supportedLocaleMap } from './locale';

const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

export class LocalizationRuntime implements LocalizationTextProvider {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly fallbackLocale: string;
  readonly supportedLocales: readonly string[];
  private readonly catalogs: LocalizationCatalogs;
  private readonly onDiagnostic: ((diagnostic: LocalizationDiagnostic) => void) | null;
  private readonly emittedDiagnostics = new Set<string>();

  constructor(options: LocalizationRuntimeOptions) {
    const supported = supportedLocaleMap(options.supportedLocales);
    this.supportedLocales = Object.freeze([...options.supportedLocales]);
    this.defaultLocale = configuredLocale(options.defaultLocale, supported, 'defaultLocale');
    this.fallbackLocale = options.fallbackLocale === undefined
      ? this.defaultLocale
      : configuredLocale(options.fallbackLocale, supported, 'fallbackLocale');
    this.locale = resolveSupportedLocale(options.rawLocale, this.supportedLocales, this.defaultLocale);
    const snapshot = mergeLocalizationCatalogs(options.catalogs);
    const structural = validateLocalizationCatalogs(snapshot, {
      supportedLocales: this.supportedLocales,
      referenceLocale: this.defaultLocale
    }).filter((issue) => ['missing_catalog', 'unknown_catalog', 'duplicate_locale', 'invalid_catalog', 'invalid_value'].includes(issue.code));
    if (structural.length > 0) {
      const issue = structural[0]!;
      const at = issue.key === undefined ? issue.locale : `${issue.locale}.${issue.key}`;
      throw new TypeError(`LocalizationRuntime: invalid catalog at "${at}": ${issue.detail ?? issue.code}`);
    }
    const sourceLocales = new Map(Object.keys(snapshot).map((locale) => [normalizeLocale(locale), locale]));
    this.catalogs = Object.freeze(Object.fromEntries(this.supportedLocales.map((locale) => [
      locale,
      snapshot[sourceLocales.get(normalizeLocale(locale))!]!
    ])));
    this.onDiagnostic = options.onDiagnostic ?? null;
    Object.freeze(this);
  }

  t(key: string, params?: TranslationParams): string {
    const selected = this.catalogs[this.locale]!;
    let text: string;
    if (own(selected, key)) {
      text = selected[key]!;
    } else {
      const fallback = this.catalogs[this.fallbackLocale]!;
      if (this.fallbackLocale !== this.locale && own(fallback, key)) {
        text = fallback[key]!;
        this.diagnostic({ code: 'fallback_key', key, locale: this.locale, fallbackLocale: this.fallbackLocale });
      } else {
        this.diagnostic({ code: 'missing_key', key, locale: this.locale, fallbackLocale: this.fallbackLocale });
        return key;
      }
    }
    return text.replace(/\{([^{}]+)\}/g, (placeholder, param: string) => {
      const value = params && own(params, param) ? (params as Record<string, unknown>)[param] : undefined;
      if (value === undefined || value === null) {
        this.diagnostic({ code: 'missing_param', key, locale: this.locale, param });
        return placeholder;
      }
      return String(value);
    });
  }

  private diagnostic(diagnostic: LocalizationDiagnostic): void {
    const identity = [diagnostic.code, diagnostic.locale, diagnostic.fallbackLocale ?? '', diagnostic.key, diagnostic.param ?? ''].join('\u0000');
    if (this.emittedDiagnostics.has(identity)) return;
    this.emittedDiagnostics.add(identity);
    try {
      this.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics are observational and never turn ordinary missing content into a runtime failure.
    }
  }
}
