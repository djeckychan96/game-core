import type { LocalizationCatalogs } from '../../index';
import { READY_UI_EN } from './en';
import { READY_UI_RU } from './ru';

export { READY_UI_EN } from './en';
export { READY_UI_RU } from './ru';

export const READY_UI_CATALOGS = Object.freeze({
  en: READY_UI_EN,
  ru: READY_UI_RU
}) satisfies LocalizationCatalogs;
