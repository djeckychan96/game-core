import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';
import { AnalyticsRuntime } from '../../src/analytics';
import { FakeTransport, MemoryQueueStore, makeContext } from './fixtures';

const analyticsDir = fileURLToPath(new URL('../../src/analytics/', import.meta.url));
const compositionDir = fileURLToPath(new URL('../../src/composition/', import.meta.url));

const forbidden: Array<[string, RegExp]> = [
  ['Date', /\bDate\b/],
  ['performance.now', /\bperformance\b/],
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
  ['global fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['AbortController', /\bAbortController\b/],
  ['pixi', /pixi/i],
  ['gsap', /gsap/i],
  ['platform SDK', /\b(YaGames|ysdk|vkBridge|FBInstant)\b/],
  ['ClickHouse', /clickhouse/i],
  ['Math.random', /Math\.random/],
  ['a JWT', /eyJ[A-Za-z0-9_-]{10,}\./]
];

function sources(dir: string): Array<[string, string]> {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    // strip comments so the prose about "a browser host passes `fetch`" does not trip the check
    .map((name) => [name, readFileSync(resolve(dir, name), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')]);
}

test('src/analytics never touches a renderer, the DOM, storage, the network, Date or timers — every external is injected', () => {
  const files = sources(analyticsDir);
  expect(files.map(([name]) => name)).toEqual(['AnalyticsRuntime.ts', 'AnalyticsTransportError.ts', 'hazarTransport.ts', 'index.ts', 'types.ts']);
  for (const [file, source] of files) {
    for (const [name, pattern] of forbidden) expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
      expect(specifier === '../core/CoreRuntime' || specifier!.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
    }
  }
});

test('runtimes stay independent: offers never imports analytics, and the composition wiring imports both as types only', () => {
  const offersDir = fileURLToPath(new URL('../../src/offers/', import.meta.url));
  for (const [file, source] of sources(offersDir)) expect(/analytics/i.test(source), `${file} mentions analytics`).toBe(false);
  for (const [file, source] of sources(analyticsDir)) expect(/offers\//.test(source), `${file} imports offers`).toBe(false);
  const files = sources(compositionDir);
  expect(files.map(([name]) => name)).toEqual(['offerAnalytics.ts', 'purchaseAnalytics.ts']);
  for (const [file, source] of files) {
    for (const [name, pattern] of forbidden) expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    const imports = [...source.matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, typeOnly, specifier] of imports) expect(Boolean(typeOnly), `${file} has a runtime import of ${specifier}`).toBe(true);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a whole pipeline life runs with Date.now / performance.now broken and schedules no timers', async () => {
  vi.useFakeTimers();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('Date.now must not be used');
  });
  vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
    throw new Error('performance.now must not be used');
  });
  const transport = new FakeTransport();
  const store = new MemoryQueueStore();
  const analytics = new AnalyticsRuntime({ transport, store, context: makeContext(), now: () => 1_758_000_000, flushIntervalMs: 1000, batchSize: 2, onError: () => {} });
  analytics.trackSessionStart({ sessionNumber: 1 });
  analytics.level({ level: 1, status: 'start' });
  analytics.level({ level: 1, status: 'win', durationMs: 1000 });
  analytics.update(1000);
  await analytics.flush();
  transport.mode = 'fail';
  analytics.track('offline');
  analytics.update(1000);
  await analytics.flush();
  analytics.dispose();
  expect(analytics.getStats()).toMatchObject({ sent: 3, queued: 1, batchesFailed: 1 });
  expect(store.saved).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('a package consumer sees exactly the AnalyticsRuntime public API and none of its internals', () => {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  options.noEmit = true;

  const consumerPath = fileURLToPath(new URL('./public-api-consumer.ts', import.meta.url));
  const consumer = `
    import {
      AnalyticsRuntime, AnalyticsTransportError, createHazarAnalyticsTransport, HAZAR_INGEST_ENDPOINTS, ANALYTICS_EVENTS,
      createOfferAnalyticsHandler, offerEventToAnalytics, OfferRuntime, MemoryOfferStateStore, DEFAULT_OFFER_CHAIN_TIMING,
      type AnalyticsDevice, type AnalyticsPlatform, type AnalyticsValue, type AnalyticsEventData, type AnalyticsEnvelopeData,
      type AnalyticsEnvelope, type AnalyticsContext, type AnalyticsContextProvider, type AnalyticsTransport, type AnalyticsQueueStore,
      type AnalyticsErrorPhase, type AnalyticsErrorContext, type AnalyticsErrorHandler, type AnalyticsRuntimeOptions,
      type AnalyticsTrackOptions, type AnalyticsRuntimeStats, type AnalyticsEventName, type AnalyticsInstallEvent,
      type AnalyticsSessionEvent, type AnalyticsLoadingStatus, type AnalyticsLoadingEvent, type AnalyticsTutorialEvent,
      type AnalyticsLevelStatus, type AnalyticsLevelEvent, type AnalyticsUiClickEvent, type AnalyticsAdType, type AnalyticsAdStatus,
      type AnalyticsAdvertisementEvent, type AnalyticsEconomyAction, type AnalyticsEconomyEvent, type AnalyticsPurchaseStatus,
      type AnalyticsPurchaseEvent, type AnalyticsLivesRefillEvent, type HazarAnalyticsTransportOptions, type HazarFetchFn,
      type HazarFetchInit, type HazarFetchResponse, type OfferAnalyticsSink, type OfferAnalyticsRecord,
      type OfferDef, type OfferEvent, type OfferEventHandler, type CoreRuntimeModule
    } from '../../src/index';

    // the host side: endpoint / JWT / app / platform / profile come from the project
    const platforms: AnalyticsPlatform[] = ['YA', 'VK', 'OK', 'FB', 'AN', 'MSS', 'SAM', 'DEV', 'TS', 'YA_DEV'];
    const device: AnalyticsDevice = 'tablet';
    const base: AnalyticsEventData = { level: 3, nested: { a: [1, 'x', null] }, skipped: undefined };
    const context: AnalyticsContext = {
      app: 'trail_arrow', platform: platforms[0]!, appVersion: '0.1.23', buildVersion: 5, profileId: 'p', installedAt: 1,
      device, platformOs: 'ios', configName: 'cfg', configGroup: 'control', baseData: base
    };
    const provider: AnalyticsContextProvider = () => context;
    const fetchFn: HazarFetchFn = async (_url: string, init: HazarFetchInit): Promise<HazarFetchResponse> => ({ ok: init.method === 'POST', status: 200 });
    const hazarOptions: HazarAnalyticsTransportOptions = { endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: () => 'fake', fetchFn, headers: {}, keepalive: true };
    const transport: AnalyticsTransport = createHazarAnalyticsTransport(hazarOptions);
    const browserTransport: AnalyticsTransport = createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.EU, token: 'fake', fetchFn: fetch });
    const custom: AnalyticsTransport = { send: async (events: AnalyticsEnvelope[]) => { if (events.length > 99) throw new AnalyticsTransportError('no', { retryable: false, status: 413 }); } };
    const store: AnalyticsQueueStore = { load: () => [], save: (_events: AnalyticsEnvelope[]) => {} };
    const onError: AnalyticsErrorHandler = (_e, c: AnalyticsErrorContext) => { const p: AnalyticsErrorPhase = c.phase; void p; };
    const options: AnalyticsRuntimeOptions = { transport, context: provider, store, now: () => 0, flushIntervalMs: 10000, batchSize: 20, maxQueueSize: 500, sendTimeoutMs: 30000, onError };
    const analytics = new AnalyticsRuntime(options);
    const fixed = new AnalyticsRuntime({ transport: custom, context });
    const module: CoreRuntimeModule = analytics;

    const publicMethods: Record<keyof AnalyticsRuntime, true> = {
      track: true, install: true, trackSessionStart: true, loading: true, trackLoadingStart: true, trackLoadingDone: true,
      tutorial: true, level: true, uiClick: true, interaction: true, advertisement: true, economy: true, purchase: true,
      livesRefill: true, update: true, flush: true, getStats: true, dispose: true
    };

    // gameplay side
    const trackOptions: AnalyticsTrackOptions = { flush: true };
    const accepted: boolean[] = [
      analytics.track('custom_event', { a: 1 }, trackOptions),
      analytics.install({ source: 's', referrer: 'r' } satisfies AnalyticsInstallEvent),
      analytics.trackSessionStart({ sessionNumber: 1 } satisfies AnalyticsSessionEvent),
      analytics.loading({ status: 'user_ok' satisfies AnalyticsLoadingStatus, loadMs: 5 } satisfies AnalyticsLoadingEvent),
      analytics.trackLoadingStart(), analytics.trackLoadingDone(1200),
      analytics.tutorial({ name: 'intro', step: 1, status: 'start' } satisfies AnalyticsTutorialEvent),
      analytics.level({ level: 1, levelId: 'l1', status: 'start' }),
      analytics.level({ level: 1, levelId: 'l1', status: 'win' satisfies AnalyticsLevelStatus, durationMs: 9 } satisfies AnalyticsLevelEvent),
      analytics.uiClick({ button: 'play' } satisfies AnalyticsUiClickEvent),
      analytics.interaction('first_move', { level: 1 }),
      analytics.advertisement({ type: 'rewarded' satisfies AnalyticsAdType, placement: 'lives', status: 'complete' satisfies AnalyticsAdStatus } satisfies AnalyticsAdvertisementEvent),
      analytics.economy({ currency: 'coins', action: 'get' satisfies AnalyticsEconomyAction, delta: 5, balance: 10 } satisfies AnalyticsEconomyEvent),
      analytics.purchase({ offerName: 'starter_pack', revenue: 0.99, currency: 'USD', orderId: 'o1', status: 'success' satisfies AnalyticsPurchaseStatus, source: 'shop' } satisfies AnalyticsPurchaseEvent),
      analytics.livesRefill({ source: 'ad', amount: 5 } satisfies AnalyticsLivesRefillEvent)
    ];
    const name: AnalyticsEventName = ANALYTICS_EVENTS.LIVES_REFILL;
    const flushed: Promise<void> = analytics.flush();
    const changed: boolean = analytics.update(16);
    const stats: AnalyticsRuntimeStats = analytics.getStats();
    analytics.dispose();

    // composition: OfferRuntime → AnalyticsRuntime without either importing the other
    const sink: OfferAnalyticsSink = analytics;
    const handler: OfferEventHandler = createOfferAnalyticsHandler(sink, (_event: OfferEvent) => {});
    const offer: OfferDef = { productId: 'w', tier: 0, variant: 0, titleKey: 'k', timerSec: 60, rewards: [] };
    const record: OfferAnalyticsRecord = offerEventToAnalytics({ type: 'activated', offer, level: 8, now: 0 });
    const tiers = [1, 2, 3, 4, 5, 6].map((t) => [{ ...offer, productId: 'a' + t, tier: t }, { ...offer, productId: 'b' + t, tier: t, variant: 1 as const }]);
    const offers = new OfferRuntime({
      config: { ...DEFAULT_OFFER_CHAIN_TIMING, welcome: offer, tiers }, state: new MemoryOfferStateStore(),
      input: { now: () => 0, level: () => 8, hasPrice: () => true, welcomeOwned: () => false }, onEvent: handler
    });
    const value: AnalyticsValue = record.data['level'] ?? null;
    const data: AnalyticsEnvelopeData = { profile_id: 'p', device: 'mobile' };
    void [browserTransport, fixed, module, publicMethods, accepted, name, flushed, changed, stats, offers, value, data];

    // @ts-expect-error an event needs its required fields
    analytics.level({ level: 1 });
    // @ts-expect-error a status outside the Hazar set
    analytics.level({ level: 1, status: 'won' });
    // @ts-expect-error device is a closed union
    const badDevice: AnalyticsDevice = 'console';
    // @ts-expect-error profileId is required
    const badContext: AnalyticsContext = { app: 'a', platform: 'YA', appVersion: '1', device: 'mobile' };
    // @ts-expect-error fetchFn is required — no hidden global
    createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: 'fake' });
    // @ts-expect-error the queue is internal
    analytics.queue;
    // @ts-expect-error envelope building is internal
    analytics.buildEnvelope;
    // @ts-expect-error the drain loop is internal
    analytics.drain;
    void [badDevice, badContext];
  `;
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === consumerPath
      ? ts.createSourceFile(path, consumer, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram([consumerPath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  );
  expect(diagnostics).toEqual([]);
}, 20000);
