import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import * as root from '../../../src/index';
import * as yandex from '../../../src/platform/adapters/yandex';
import { createYandexPlatform, initYandexSdk, waitForYandexScript } from '../../../src/platform/adapters/yandex';
import type { GamePlatform, PaymentsAdapter } from '../../../src/index';
import { FakeYandex } from './fixtures';

const platformDir = fileURLToPath(new URL('../../../src/platform/', import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (dir: string): Array<[string, string]> =>
  readdirSync(resolve(platformDir, dir))
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => [`${dir}/${name}`, stripComments(readFileSync(resolve(platformDir, dir, name), 'utf-8'))]);

test('the Yandex entry: root modules only as TYPES, runtime only from itself and adapter support; the SDK global is named in ONE file', () => {
  const files = [...read('adapters/yandex'), ...read('support')];
  expect(files.map(([name]) => name)).toEqual([
    'adapters/yandex/YandexPlatform.ts', 'adapters/yandex/index.ts', 'adapters/yandex/sdk.ts', 'support/adWatchdog.ts', 'support/withTimeout.ts'
  ]);
  for (const [file, source] of files) {
    expect(/pixi|gsap|localStorage|sessionStorage|\bfetch\b|XMLHttpRequest|Math\.random|import\.meta/i.test(source), `${file} touches a renderer / storage / network`).toBe(false);
    expect(/\bwindow\b/.test(source), `${file} references window`).toBe(false);
    expect(/YaGames/.test(source), `${file} names the SDK global`).toBe(file === 'adapters/yandex/sdk.ts');
    // the game's ECS / sound / analytics never leak in: they are hooks
    expect(/AdsShowingComponent|pauseForAds|__anSendRaw|app\.model|registerShown|markGranted/.test(source), `${file} carries donor game code`).toBe(false);
    for (const match of source.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
      const [, typeOnly, specifier] = match;
      const own = specifier!.startsWith('./') || /^(\.\.\/)+support\//.test(specifier!);
      expect(own || Boolean(typeOnly), `${file} has a runtime import of ${specifier}`).toBe(true);
    }
  }
  // `document` only in the watchdog's default visibility seam
  expect(files.filter(([, source]) => /\bdocument\b/.test(source)).map(([name]) => name)).toEqual(['support/adWatchdog.ts']);
});

test('public surface: the adapter is NOT in the root entry; a YandexPlatform is a GamePlatform whose payments are a PaymentsAdapter', () => {
  expect(Object.keys(root).filter((name) => /yandex/i.test(name))).toEqual([]);
  expect(Object.keys(yandex).sort()).toEqual([
    'AD_WATCHDOG_HARD_MS', 'AD_WATCHDOG_QUIET_MS', 'YANDEX_LAUNCH_PAYLOAD_MAX', 'YANDEX_NO_PLAYER', 'YANDEX_PLAYER_RETRY_ATTEMPTS', 'YANDEX_READ_ATTEMPTS',
    'YANDEX_TIMEOUTS', 'YandexPlatform', 'createYandexPlatform', 'documentVisibility', 'initYandexSdk', 'waitForYandexScript'
  ]);
  const platform = createYandexPlatform({ init: new FakeYandex().init });
  const asPlatform: GamePlatform = platform;
  const asAdapter: PaymentsAdapter = platform.payments;
  expect([asPlatform.lifecycle, asPlatform.ads?.showBanner, asAdapter.restoreGrant]).toEqual([undefined, undefined, 'after-consume']);
  expect(yandex.documentVisibility()).toBeNull(); // Node: no document → the watchdog keeps its hard timeout only
});

const globals = globalThis as { YaGames?: unknown; __SDK_READY__?: unknown };
afterEach(() => {
  delete globals.YaGames;
  delete globals.__SDK_READY__;
});

test('the production default boots through the page-loader contract: the global, or the __SDK_READY__ promise, or sdk_script_missing', async () => {
  await expect(waitForYandexScript()).rejects.toThrow('sdk_script_missing');
  await expect(initYandexSdk()).rejects.toThrow('sdk_script_missing');
  await expect(createYandexPlatform({ now: () => 0 }).identity.ready()).rejects.toThrow('sdk_script_missing');

  const fake = new FakeYandex();
  globals.__SDK_READY__ = Promise.resolve().then(() => void (globals.YaGames = { init: fake.init })); // the <script onload> of the page
  const platform = createYandexPlatform();
  await platform.identity.ready();
  expect([fake.count('init'), platform.environment.language()]).toEqual([1, 'ru']);

  globals.__SDK_READY__ = Promise.reject(new Error('sdk_script_failed'));
  delete globals.YaGames;
  await expect(waitForYandexScript()).rejects.toThrow('sdk_script_failed');
});
