import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as root from '../../../src/index';
import * as cleverapps from '../../../src/platform/adapters/cleverapps';
import { createCleverAppsPlatform } from '../../../src/platform/adapters/cleverapps';
import type { GamePlatform } from '../../../src/index';
import { FakeConnector } from './fixtures';

const adapterDir = fileURLToPath(new URL('../../../src/platform/adapters/cleverapps/', import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('the CleverApps entry imports root contracts as types only and names Connector globals in sdk.ts only', () => {
  const files = readdirSync(adapterDir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => [name, stripComments(readFileSync(resolve(adapterDir, name), 'utf-8'))] as const);
  expect(files.map(([name]) => name)).toEqual(['CleverAppsPlatform.ts', 'index.ts', 'sdk.ts']);
  for (const [file, source] of files) {
    expect(/pixi|gsap|localStorage|sessionStorage|\bfetch\b|XMLHttpRequest|Math\.random|import\.meta/i.test(source), file).toBe(false);
    expect(/\bwindow\b/.test(source), `${file} references window`).toBe(false);
    expect(/onConnectorInit|globalThis/.test(source), `${file} names the Connector global seam`).toBe(file === 'sdk.ts');
    expect(/appSecret|privateKey|serviceKey|secretKey|eyJ[A-Za-z0-9_-]{10,}\./i.test(source), `${file} contains secret-shaped code`).toBe(false);
    for (const match of source.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
      const [, typeOnly, specifier] = match;
      const own = specifier!.startsWith('./') || /^(\.\.\/)+support\//.test(specifier!);
      expect(own || Boolean(typeOnly), `${file} has a runtime import of ${specifier}`).toBe(true);
    }
  }
});

test('public surface is separate from root and the Facebook adapter exposes no payments, lifecycle or banner stub', () => {
  expect(Object.keys(root).filter((name) => /cleverapps/i.test(name))).toEqual([]);
  expect(Object.keys(cleverapps).sort()).toEqual([
    'AD_WATCHDOG_HARD_MS',
    'AD_WATCHDOG_QUIET_MS',
    'CLEVERAPPS_STORAGE_VERSION',
    'CLEVERAPPS_TIMEOUTS',
    'CleverAppsPlatform',
    'createCleverAppsPlatform',
    'documentVisibility',
    'initCleverAppsConnector',
    'waitForCleverAppsConnector'
  ]);
  const fake = new FakeConnector();
  const platform: GamePlatform = createCleverAppsPlatform({ init: fake.init });
  expect([platform.environment.platformCode(), platform.payments, platform.lifecycle, platform.ads?.showBanner]).toEqual([
    'FB',
    undefined,
    undefined,
    undefined
  ]);
});
