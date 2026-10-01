import { expect, test } from 'vitest';
import * as root from '../../src/index';

test('the renderer-independent root entry exposes the Localization V1 runtime', () => {
  for (const name of [
    'LocalizationRuntime',
    'resolveSupportedLocale',
    'mergeLocalizationCatalogs',
    'validateLocalizationCatalogs'
  ]) {
    expect(root, name).toHaveProperty(name);
  }
});
