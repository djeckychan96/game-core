import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';
import { OfferRuntime } from '../../src/offers/OfferRuntime';
import { DAY, HOUR, T0, makeConfig, makeState } from './fixtures';

const offersDir = fileURLToPath(new URL('../../src/offers/', import.meta.url));

test('src/offers never imports a renderer, the DOM, storage, Date or timers — every external is injected', () => {
  const files = readdirSync(offersDir).filter((name) => name.endsWith('.ts'));
  expect(files.sort()).toEqual(['OfferRuntime.ts', 'chain.ts', 'config.ts', 'index.ts', 'state.ts', 'types.ts']);
  const forbidden: Array<[string, RegExp]> = [
    ['Date', /\bDate\b/],
    ['performance.now', /\bperformance\b/],
    ['setTimeout', /\bsetTimeout\b/],
    ['setInterval', /\bsetInterval\b/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['indexedDB', /\bindexedDB\b/],
    ['fetch', /\bfetch\b/],
    ['pixi', /pixi/i],
    ['gsap', /gsap/i],
    ['three', /\bthree\b/i],
    ['Math.random', /Math\.random/]
  ];
  for (const file of files) {
    // strip comments so the prose about "never Date.now()" does not trip the check
    const source = readFileSync(resolve(offersDir, file), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [name, pattern] of forbidden) {
      expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    }
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      expect(specifier === '../core/CoreRuntime' || specifier.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a whole chain life runs with Date.now / performance.now broken and schedules no timers', () => {
  vi.useFakeTimers();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('Date.now must not be used');
  });
  vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
    throw new Error('performance.now must not be used');
  });
  const clock = { now: T0 };
  const events: string[] = [];
  const runtime = new OfferRuntime({
    config: makeConfig(),
    state: makeState(),
    input: { now: () => clock.now, level: () => 12, hasPrice: () => true, welcomeOwned: () => false },
    onEvent: (event) => events.push(event.type)
  });
  runtime.update(16);
  runtime.onPurchased('starter_pack');
  clock.now += DAY;
  runtime.update(1000);
  clock.now += DAY;
  runtime.update(1000); // t2 expired
  clock.now += 2 * DAY;
  runtime.update(1000); // t1 activated
  clock.now += HOUR;
  runtime.clampTimes();
  expect(events).toEqual(['activated', 'purchased', 'activated', 'expired', 'activated']);
  expect(runtime.getActive()?.productId).toBe('offer_t1_a');
  expect(vi.getTimerCount()).toBe(0);
});

test('a package consumer sees exactly the OfferRuntime public API and none of its internals', () => {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  options.noEmit = true;

  const consumerPath = fileURLToPath(new URL('./public-api-consumer.ts', import.meta.url));
  const consumer = `
    import {
      OfferRuntime, offerByProduct, activeOffer, secondsLeft, pickAvailableOffer, isChainBlocked,
      clampOfferTimes, tickOffers, onOfferPurchased, DEFAULT_OFFER_CHAIN_TIMING, DEFAULT_WELCOME_TIMER_SEC,
      DEFAULT_TIER_TIMER_SEC, OFFER_HOUR_SEC, OFFER_DAY_SEC, validateOfferChainConfig, MemoryOfferStateStore,
      OFFER_STATE_KEYS, OFFER_WELCOME,
      type OfferVariant, type OfferReward, type OfferDef, type OfferChainConfig, type OfferStateKey,
      type OfferWelcomeState, type OfferStateStore, type OfferChainInput, type OfferPriceGate, type OfferEventType,
      type OfferEvent, type OfferEventHandler, type OfferErrorPhase, type OfferErrorContext, type OfferErrorHandler,
      type OfferRuntimeOptions, type OfferRuntimeStats, type CoreRuntimeModule
    } from '../../src/index';

    const reward: OfferReward = { id: 'coins', amount: 100 };
    const welcome: OfferDef = { productId: 'w', tier: 0, variant: 0 satisfies OfferVariant, titleKey: 'k', timerSec: DEFAULT_WELCOME_TIMER_SEC, rewards: [reward] };
    const tier = (t: number, v: OfferVariant): OfferDef => ({ productId: 't' + t + v, tier: t, variant: v, titleKey: 'k', timerSec: DEFAULT_TIER_TIMER_SEC, rewards: [] });
    const config: OfferChainConfig = { ...DEFAULT_OFFER_CHAIN_TIMING, welcome, tiers: [1, 2, 3, 4, 5, 6].map((t) => [tier(t, 0), tier(t, 1)]) };
    validateOfferChainConfig(config);
    const state: OfferStateStore = new MemoryOfferStateStore({ welcome: OFFER_WELCOME.NEW });
    const key: OfferStateKey = OFFER_STATE_KEYS[0]!;
    const welcomeState: OfferWelcomeState = OFFER_WELCOME.DONE;
    const gate: OfferPriceGate = () => true;
    const input: OfferChainInput = { now: () => 0, level: () => 8, hasPrice: gate, welcomeOwned: () => false };
    const onEvent: OfferEventHandler = (event: OfferEvent) => { const t: OfferEventType = event.type; void t; };
    const onOfferError: OfferErrorHandler = (_e, context: OfferErrorContext) => { const p: OfferErrorPhase = context.phase; void p; };
    const options: OfferRuntimeOptions = { config, state, input, onEvent, onOfferError, tickIntervalMs: 1000 };
    const offers = new OfferRuntime(options);
    const module: CoreRuntimeModule = offers;

    const publicMethods: Record<keyof OfferRuntime, true> = {
      update: true, tick: true, getActive: true, secondsLeft: true, offerByProduct: true,
      onPurchased: true, clampTimes: true, getStats: true
    };
    const stats: OfferRuntimeStats = offers.getStats();
    const active: OfferDef | null = offers.getActive();
    const moved: boolean = offers.onPurchased('w');
    const seconds: number = offers.secondsLeft() + OFFER_HOUR_SEC + OFFER_DAY_SEC;
    const pure: [OfferDef | null, OfferDef | null, number, OfferDef | null, boolean, boolean, boolean, boolean] = [
      offerByProduct(config, 'w'), activeOffer(config, state, 0), secondsLeft(config, state, 0),
      pickAvailableOffer(config, state, 1, gate), isChainBlocked(config, state, 0, 8, gate, false),
      clampOfferTimes(config, state, 0), tickOffers(config, state, 0, 8, gate, false), onOfferPurchased(config, state, 'w', 0)
    ];
    void [module, publicMethods, stats, active, moved, seconds, pure, key, welcomeState];

    // @ts-expect-error the on-screen-offer helper is internal
    import('../../src/index').then((m) => m.shownOffer);
    // @ts-expect-error the accumulator is internal
    offers.accumulatorMs;
    // @ts-expect-error event dispatch is internal
    offers.emit;
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
