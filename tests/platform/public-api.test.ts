import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as root from '../../src/index';
import { AnalyticsRuntime, PlatformRuntime, createDevPlatform, createPlatformAnalyticsContext, readPlatformAnalyticsFields } from '../../src/index';
import type { AnalyticsEnvelope, GamePlatform, PaymentsAdapter, PlatformCode, PlatformPayments, AnalyticsPlatform } from '../../src/index';

const platformDir = fileURLToPath(new URL('../../src/platform/', import.meta.url));
const seamFile = fileURLToPath(new URL('../../src/composition/platformAnalytics.ts', import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function platformSources(): Array<[string, string]> {
  const files: string[] = [];
  for (const entry of readdirSync(platformDir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(resolve(entry.parentPath ?? entry.path, entry.name));
  }
  return files.sort().map((file) => [file.slice(platformDir.length), stripComments(readFileSync(file, 'utf-8'))]);
}

test('src/platform is a root module: no renderer, no DOM, no storage global, no clock, no timer, no network and no platform SDK — DEV included', () => {
  const files = platformSources();
  expect(files.map(([name]) => name)).toEqual(['PlatformRuntime.ts', 'adapters/dev.ts', 'catalog.ts', 'config.ts', 'index.ts', 'types.ts']);
  const forbidden: Array<[string, RegExp]> = [
    ['Date', /\bDate\b/],
    ['performance', /\bperformance\b/],
    ['setTimeout', /\bsetTimeout\b/],
    ['setInterval', /\bsetInterval\b/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['window', /\bwindow\b/],
    ['globalThis', /\bglobalThis\b/],
    ['document', /\bdocument\b/],
    ['navigator', /\bnavigator\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['indexedDB', /\bindexedDB\b/],
    ['fetch', /\bfetch\b/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['pixi', /pixi/i],
    ['gsap', /gsap/i],
    ['Math.random', /Math\.random/],
    ['import.meta', /import\.meta/],
    ['Yandex SDK', /\bYaGames\b|\bysdk\b/i],
    ['Facebook / Samsung Instant', /\bFBInstant\b|\bGSInstant/],
    ['VK bridge', /vkBridge/i],
    ['the connector global', /onConnectorInit|CONNECTOR_CONFIG/],
    ['a JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9]/]
  ];
  for (const [file, source] of files) {
    for (const [name, pattern] of forbidden) expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
      const [, typeOnly, specifier] = match;
      const inside = specifier!.startsWith('./') || specifier === '../types';
      // the one way out of the module: PurchaseRuntime's PaymentsAdapter contract, as a TYPE
      const contract = Boolean(typeOnly) && /^(\.\.\/)+purchases\/types$/.test(specifier!);
      expect(inside || contract, `${file} imports ${specifier}`).toBe(true);
    }
  }
});

test('the root entry exports the platform layer; the payments capability IS a PaymentsAdapter and the codes ARE analytics platforms', () => {
  for (const name of ['PlatformRuntime', 'PlatformCatalog', 'normalizePlatformProducts', 'validateGamePlatformConfig', 'createDevPlatform', 'PLATFORM_CODES', 'PLATFORM_PROVIDERS', 'createPlatformAnalyticsContext', 'readPlatformAnalyticsFields']) {
    expect(root, name).toHaveProperty(name);
  }
  expect(root.PLATFORM_CODES).toEqual(['YA', 'FB', 'SAM', 'MSS', 'VK', 'OK', 'AN', 'DEV']);
  // compile-time seams (tsc --noEmit checks this file)
  const asAdapter = (payments: PlatformPayments): PaymentsAdapter => payments;
  const asAnalyticsPlatform = (code: PlatformCode): AnalyticsPlatform => code;
  const minimal: GamePlatform = (({ identity, environment, storage, gameplay }) => ({ identity, environment, storage, gameplay }))(createDevPlatform());
  expect(new PlatformRuntime(minimal).capabilities()).toEqual({ ads: false, banner: false, payments: false, lifecycle: false, cloudStorage: false });
  void [asAdapter, asAnalyticsPlatform];
});

test('the analytics seam knows both sides as types only', () => {
  const imports = [...stripComments(readFileSync(seamFile, 'utf-8')).matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)];
  expect(imports.map((m) => m[2])).toEqual(['../analytics/types', '../platform/types']);
  for (const match of imports) expect(match[1], `${match[2]} must be a type-only import`).toBe('type ');
});

test('analytics seam: the platform gives p / playerId / device / language — the host keeps app, versions, install, os, baseData and the profile-id policy', async () => {
  const guest = { id: null as string | null };
  const dev = createDevPlatform({ language: 'en_US', deviceType: 'tablet' });
  const platform = new PlatformRuntime({ ...dev, identity: { ...dev.identity, playerId: () => guest.id } });
  expect(readPlatformAnalyticsFields(platform)).toEqual({ platform: 'DEV', playerId: null, device: 'tablet', language: 'en_US' });

  const sent: AnalyticsEnvelope[] = [];
  const analytics = new AnalyticsRuntime({
    transport: { send: async (events) => void sent.push(...events) },
    context: createPlatformAnalyticsContext(platform, ({ playerId, language }) => ({
      app: 'demo_game', appVersion: '1.2.3', buildVersion: 7, installedAt: 1_700_000_000, platformOs: 'android',
      profileId: playerId ?? 'local-uuid', // the host's policy
      device: 'mobile', // the host's UA fallback — the platform's word wins
      baseData: { level: 3, lang: language }
    }))
  });
  analytics.track('first');
  guest.id = ''; // an SDK's empty id is still a guest
  analytics.track('second');
  guest.id = 'ya-777'; // the late platform answer is picked up by the next event, no re-init
  analytics.track('third');
  await analytics.flush();

  expect(sent.map((e) => [e.app, e.p, e.event.app_ver, e.event.data.profile_id, e.event.data.device, e.event.data.platform_os, e.event.data['lang']])).toEqual([
    ['demo_game', 'DEV', '1.2.3', 'local-uuid', 'tablet', 'android', 'en_US'],
    ['demo_game', 'DEV', '1.2.3', 'local-uuid', 'tablet', 'android', 'en_US'],
    ['demo_game', 'DEV', '1.2.3', 'ya-777', 'tablet', 'android', 'en_US']
  ]);

  // a platform without device knowledge leaves the host's detection standing
  const plain = createPlatformAnalyticsContext(createDevPlatform(), () => ({ app: 'a', appVersion: '1', profileId: 'p', device: 'mobile' }));
  expect(plain()).toMatchObject({ platform: 'DEV', device: 'mobile' });
});
