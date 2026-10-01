export type TranslationParams = Readonly<Record<string, string | number>>;

export type TranslationCatalog = Readonly<Record<string, string>>;

export type LocalizationCatalogs = Readonly<Record<string, TranslationCatalog>>;

export interface LocalizationTextProvider {
  readonly locale: string;
  t(key: string, params?: TranslationParams): string;
}

export type LocalizationDiagnosticCode = 'fallback_key' | 'missing_key' | 'missing_param';

export interface LocalizationDiagnostic {
  readonly code: LocalizationDiagnosticCode;
  readonly key: string;
  readonly locale: string;
  readonly fallbackLocale?: string;
  readonly param?: string;
}

export interface LocalizationRuntimeOptions {
  rawLocale?: string | null;
  supportedLocales: readonly string[];
  defaultLocale: string;
  fallbackLocale?: string;
  catalogs: LocalizationCatalogs;
  onDiagnostic?: (diagnostic: LocalizationDiagnostic) => void;
}

export type LocalizationCatalogIssueCode =
  | 'missing_catalog'
  | 'unknown_catalog'
  | 'duplicate_locale'
  | 'invalid_catalog'
  | 'invalid_value'
  | 'missing_key'
  | 'extra_key'
  | 'placeholder_mismatch';

export interface LocalizationCatalogIssue {
  readonly code: LocalizationCatalogIssueCode;
  readonly locale: string;
  readonly key?: string;
  readonly detail?: string;
}

export interface LocalizationCatalogValidationOptions {
  supportedLocales: readonly string[];
  referenceLocale?: string;
  allowUnknownLocales?: boolean;
}
