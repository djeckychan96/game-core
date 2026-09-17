import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';
import { HOUR, makeAds } from './fixtures';

const adsDir = fileURLToPath(new URL('../../src/ads/', import.meta.url));
const compositionDir = fileURLToPath(new URL('../../src/composition/', import.meta.url));

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('src/ads never imports a renderer, the DOM, storage, Date, timers or an ad SDK — every external is injected', () => {
  const files = readdirSync(adsDir).filter((name) => name.endsWith('.ts'));
  expect(files.sort()).toEqual(['AdsRuntime.ts', 'config.ts', 'index.ts', 'state.ts', 'types.ts']);
  const forbidden: Array<[string, RegExp]> = [
    ['Date', /\bDate\b/],
    ['performance.now', /\bperformance\b/],
    ['setTimeout', /\bsetTimeout\b/],
    ['setInterval', /\bsetInterval\b/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['navigator', /\bnavigator\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['indexedDB', /\bindexedDB\b/],
    ['fetch', /\bfetch\b/],
    ['pixi', /pixi/i],
    ['gsap', /gsap/i],
    ['three', /\bthree\b/i],
    ['Math.random', /Math\.random/],
    // advertising / platform SDK globals of the donor's platforms
    ['YaGames / ysdk', /\bYaGames\b|\bysdk\b/i],
    ['Yandex adv API', /showFullscreenAdv|showRewardedVideo/],
    ['Facebook Instant', /\bFBInstant\b/],
    ['CleverApps connector', /\bconnector\b/],
    ['show* SDK calls', /\bshowInterstitial\b|\bshowBanner\b/]
  ];
  for (const file of files) {
    const source = stripComments(readFileSync(resolve(adsDir, file), 'utf-8'));
    for (const [name, pattern] of forbidden) expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    // the module stands alone: no other runtime (purchases, analytics, offers), not even as a type
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
      expect(specifier === '../core/CoreRuntime' || specifier!.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
    }
  }
});

test('the ads composition files know the runtimes as types only', () => {
  const expected: Record<string, string[]> = {
    'adsAnalytics.ts': ['../analytics/types', '../ads/types'],
    'purchaseAds.ts': ['../purchases/types']
  };
  for (const [file, specifiers] of Object.entries(expected)) {
    const source = stripComments(readFileSync(resolve(compositionDir, file), 'utf-8'));
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)];
    expect(imports.map((m) => m[2]), file).toEqual(specifiers);
    for (const match of imports) expect(match[1], `${file}: ${match[2]} must be a type-only import`).toBe('type ');
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a whole ad life runs with Date.now / performance.now broken and schedules no timers', () => {
  const host = makeAds({ level: 15 }); // built before the clock breaks: the fixture's T0 is the host's business
  vi.useFakeTimers();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('Date.now must not be used');
  });
  vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
    throw new Error('performance.now must not be used');
  });
  host.ads.canShowInter('level_win_inter');
  host.ads.registerShown('level_win_inter');
  host.ads.canShowRewarded('ad_hint_booster_rewarded');
  host.ads.registerShown('ad_hint_booster_rewarded');
  host.player.now += 25 * HOUR;
  host.ads.canShowBanner();
  host.ads.markPayer();
  host.ads.update(16);
  expect(host.ads.getStats()).toMatchObject({ shown: 2, segmentId: 'pay_1', counts: { level_win_inter: { day: 0, hour: 0 } } });
  expect(vi.getTimerCount()).toBe(0);
});

test('a package consumer sees exactly the AdsRuntime public API and none of its internals', () => {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  options.noEmit = true;

  const consumerPath = fileURLToPath(new URL('./public-api-consumer.ts', import.meta.url));
  const consumer = `
    import {
      AdsRuntime, parseAdsTsv, validateAdsConfig, MemoryAdsStateStore, ADS_STATE_KEYS, ADS_DEFAULT_SEGMENT_ID, ADS_BANNER_PLACEMENT,
      createAdsAnalyticsHandler, adsEventToAnalytics, createPurchaseAdsHandler, isConfirmedPayment, AnalyticsRuntime, PurchaseRuntime, CoreRuntime,
      type AdsStateSnapshot, type AdPlacementType, type AdPayerClass, type AdSegment, type AdPlacementRule, type AdPlacement,
      type AdsConfig, type AdsDenyReason, type AdsDecision, type AdsStateKey, type AdsCount, type AdsStateStore, type AdsInput,
      type AdsEvent, type AdsEventType, type AdsEventHandler, type AdsErrorPhase, type AdsErrorContext, type AdsErrorHandler,
      type AdsRuntimeOptions, type AdsRuntimeStats, type AdsAnalyticsSink, type AdsAnalyticsRecord, type PurchaseAdsSink,
      type PurchaseEventHandler, type CoreRuntimeModule
    } from '../../src/index';

    const payerClass: AdPayerClass = 'NON_PAYER';
    const segment: AdSegment = { payer: payerClass, levelFrom: 1, levelTo: Infinity, avgFrom: 0, avgTo: Infinity, maxFrom: 0, maxTo: Infinity, delayAfterReward: 60, delayBetweenInters: 240, disableInter: false };
    const rule: AdPlacementRule = { startFromLevel: 15, dayLimit: 10000, hourLimit: 500 };
    const type: AdPlacementType = 'inter';
    const placement: AdPlacement = { type, bySegment: { all: rule } };
    const config: AdsConfig = { segments: { all: segment, [ADS_DEFAULT_SEGMENT_ID]: segment }, placements: { level_win_inter: placement, [ADS_BANNER_PLACEMENT]: { type: 'banner', bySegment: {} } } };
    validateAdsConfig(config);
    const parsed: AdsConfig = parseAdsTsv('segment_id\\tpayer', 'segment_id\\tplacement_name');
    const memory = new MemoryAdsStateStore();
    const snapshot: AdsStateSnapshot = memory.snapshot();
    memory.load(snapshot);
    const state: AdsStateStore = memory;
    const key: AdsStateKey = ADS_STATE_KEYS[0]!;
    const count: AdsCount = state.getCount('level_win_inter');
    // the seven inputs of the brief; isPayer / timezoneOffsetMinutes are optional
    const input: AdsInput = { now: () => 0, level: () => 1, hasNoAds: () => false, payCount: () => 0, paySumCents: () => 0, payMaxCents: () => 0, currencyScale: () => 1 };
    const full: AdsInput = { ...input, isPayer: () => false, timezoneOffsetMinutes: () => -180 };
    const onEvent: AdsEventHandler = (event: AdsEvent) => { const t: AdsEventType = event.type; void t; };
    const onAdsError: AdsErrorHandler = (_e, context: AdsErrorContext) => { const p: AdsErrorPhase = context.phase; void p; };
    const options: AdsRuntimeOptions = { config, state, input: full, onEvent, onAdsError };
    const ads = new AdsRuntime(options);
    const module: CoreRuntimeModule = ads;
    new CoreRuntime().registerRuntime('ads', ads);

    const publicMethods: Record<keyof AdsRuntime, true> = {
      update: true, segmentId: true, decide: true, canShowInter: true, canShowRewarded: true, canShowBanner: true,
      registerShown: true, markPayer: true, getStats: true
    };
    const decision: AdsDecision = ads.decide('level_win_inter');
    const typed: AdsDecision = ads.decide('level_win_inter', 'rewarded');
    const reason: AdsDenyReason | null = decision.reason;
    const segmentId: string | null = ads.segmentId();
    const answers: boolean[] = [ads.canShowInter('level_win_inter'), ads.canShowRewarded('x'), ads.canShowBanner(), ads.update(16)];
    ads.registerShown('level_win_inter');
    ads.markPayer();
    const stats: AdsRuntimeStats = ads.getStats();
    const denied: number = stats.denyByReason.inter_cooldown;

    // composition: AnalyticsRuntime satisfies the sink; the purchase bridge is a PurchaseRuntime onEvent
    const sink: AdsAnalyticsSink = null as unknown as AnalyticsRuntime;
    const handler: AdsEventHandler = createAdsAnalyticsHandler(sink, onEvent);
    const record: AdsAnalyticsRecord = adsEventToAnalytics({ type: 'offered', placement: 'x', adType: 'inter', segmentId: null, level: 1 });
    const payerSink: PurchaseAdsSink = ads;
    const bridge: PurchaseEventHandler<number> = createPurchaseAdsHandler<number>(payerSink);
    const confirmed: boolean = isConfirmedPayment({ type: 'cancelled', productId: 'x', source: undefined });
    void (null as unknown as PurchaseRuntime);
    void [parsed, key, count, module, publicMethods, typed, reason, segmentId, answers, denied, handler, record, bridge, confirmed];

    // @ts-expect-error the payer check is internal
    ads.isPayer;
    // @ts-expect-error the calendar buckets are internal
    ads.buckets;
    // @ts-expect-error event dispatch is internal
    ads.emit;
    // @ts-expect-error the runtime shows nothing — there is no SDK call on it
    ads.showInterstitial;
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
