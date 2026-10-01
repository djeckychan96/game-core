import type { LocalizationTextProvider } from '../index';

/** Ready UI copy precedence: explicit instance/show copy, then provider, then the exact legacy default. */
export function localizedText(
  explicit: string | undefined,
  i18n: LocalizationTextProvider | undefined,
  key: string,
  legacy: string
): string {
  return explicit ?? i18n?.t(key) ?? legacy;
}
