/** Canonical comparison form only; public APIs always return the host's configured spelling. */
export function normalizeLocale(locale: string): string {
  const parts = locale.trim().replace(/_/g, '-').split('-');
  if (parts.length === 0 || !parts[0] || parts.some((part) => part.length === 0)) return '';
  return parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (/^[a-z]{2}$/i.test(part) || /^\d{3}$/.test(part)) return part.toUpperCase();
    if (/^[a-z]{4}$/i.test(part)) return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  }).join('-');
}

export function supportedLocaleMap(supportedLocales: readonly string[]): ReadonlyMap<string, string> {
  if (supportedLocales.length === 0) throw new TypeError('Localization: supportedLocales must not be empty');
  const locales = new Map<string, string>();
  for (const locale of supportedLocales) {
    const normalized = normalizeLocale(locale);
    if (!normalized) throw new TypeError(`Localization: invalid supported locale "${locale}"`);
    const duplicate = locales.get(normalized);
    if (duplicate !== undefined) {
      throw new TypeError(`Localization: duplicate normalized locale "${locale}" conflicts with "${duplicate}"`);
    }
    locales.set(normalized, locale);
  }
  return locales;
}

export function configuredLocale(
  locale: string,
  supported: ReadonlyMap<string, string>,
  name: 'defaultLocale' | 'fallbackLocale'
): string {
  const configured = supported.get(normalizeLocale(locale));
  if (configured === undefined) throw new RangeError(`Localization: ${name} "${locale}" is not in supportedLocales`);
  return configured;
}

export function resolveSupportedLocale(
  rawLocale: string | null | undefined,
  supportedLocales: readonly string[],
  defaultLocale: string
): string {
  const supported = supportedLocaleMap(supportedLocales);
  const fallback = configuredLocale(defaultLocale, supported, 'defaultLocale');
  if (typeof rawLocale !== 'string') return fallback;
  const normalized = normalizeLocale(rawLocale);
  if (!normalized) return fallback;
  const exact = supported.get(normalized);
  if (exact !== undefined) return exact;
  const base = supported.get(normalized.split('-')[0]!);
  return base ?? fallback;
}
