import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';
import { makeHost } from './fixtures';

const purchasesDir = fileURLToPath(new URL('../../src/purchases/', import.meta.url));
const compositionFile = fileURLToPath(new URL('../../src/composition/purchaseAnalytics.ts', import.meta.url));

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('src/purchases never imports a renderer, the DOM, storage, Date, timers or a platform SDK — every external is injected', () => {
  const files = readdirSync(purchasesDir).filter((name) => name.endsWith('.ts'));
  expect(files.sort()).toEqual(['PurchaseRuntime.ts', 'grantedStore.ts', 'index.ts', 'types.ts']);
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
    // platform SDK globals of the donor's platforms
    ['YaGames / ysdk', /\bYaGames\b|\bysdk\b/i],
    ['Facebook Instant', /\bFBInstant\b/],
    ['CleverApps connector', /\bconnector\b/],
    ['Samsung', /samsung/i]
  ];
  for (const file of files) {
    const source = stripComments(readFileSync(resolve(purchasesDir, file), 'utf-8'));
    for (const [name, pattern] of forbidden) {
      expect(pattern.test(source), `${file} references ${name}`).toBe(false);
    }
    // the module stands alone: no other runtime (offers, analytics), not even as a type
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      expect(specifier.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
    }
  }
});

test('the composition handler knows the runtimes as types only', () => {
  const source = stripComments(readFileSync(compositionFile, 'utf-8'));
  const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)];
  expect(imports.map((m) => m[2])).toEqual(['../analytics/types', '../purchases/types']);
  for (const match of imports) expect(match[1], `${match[2]} must be a type-only import`).toBe('type ');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a whole purchase life runs with Date.now / performance.now broken and schedules no timers', async () => {
  vi.useFakeTimers();
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('Date.now must not be used');
  });
  vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
    throw new Error('performance.now must not be used');
  });
  const host = makeHost();
  await host.runtime.purchase('gold_1', 'shop');
  host.payments.mode = 'paid-but-null';
  await host.runtime.purchase('gold_2', 'shop');
  host.payments.consumeFailures = 1;
  await host.runtime.restore(); // consume fails → kept
  await host.runtime.restore(); // granted
  host.payments.mode = 'throw';
  await host.runtime.purchase('gold_1');
  host.runtime.dispose();
  expect(host.wallet.coins).toBe(4500);
  expect(vi.getTimerCount()).toBe(0);
});

test('a package consumer sees exactly the PurchaseRuntime public API and none of its internals', () => {
  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  options.noEmit = true;

  const consumerPath = fileURLToPath(new URL('./public-api-consumer.ts', import.meta.url));
  const consumer = `
    import {
      PurchaseRuntime, createGrantedPurchaseStore, DEFAULT_GRANTED_PURCHASE_CAP,
      createPurchaseAnalyticsHandler, purchaseEventToAnalytics, AnalyticsRuntime, OfferRuntime,
      type GrantedPurchaseStoreOptions, type MemoryGrantedPurchaseStore, type PlatformPurchase,
      type PlatformPurchaseStatus, type PlatformPurchaseResult, type RestoreGrantPolicy, type PaymentsAdapter,
      type GrantedPurchaseStore, type PurchaseGrantContext, type PurchaseErrorReason, type PurchaseEvent,
      type PurchaseEventType, type PurchaseEventHandler, type PurchaseErrorPhase, type PurchaseErrorContext,
      type PurchaseCallbackErrorHandler, type PurchaseRuntimeOptions, type PurchaseStatus, type PurchaseResult,
      type RestoredPurchase, type RestoreResult, type PurchasePending, type PurchaseRuntimeStats,
      type PurchaseLedger, type PurchaseLedgerEntry, type PurchaseLedgerApplyResult,
      type PurchaseAnalyticsSink, type PurchaseAnalyticsRecord, type PurchasePrice, type PurchasePriceResolver,
      type OfferReward
    } from '../../src/index';

    type Rewards = OfferReward[];
    const policy: RestoreGrantPolicy = 'before-consume';
    const held: PlatformPurchase = { productId: 'gold_1', token: 'tok', raw: {} };
    const answerStatus: PlatformPurchaseStatus = 'ok';
    const answer: PlatformPurchaseResult = { status: answerStatus, ...held };
    // a platform adapter is a plain object: purchase + restore, consume and the policy are optional
    const payments: PaymentsAdapter = {
      purchase: () => Promise.resolve(answer),
      restore: () => Promise.resolve([held]),
      consume: () => Promise.resolve(),
      restoreGrant: policy
    };
    const minimal: PaymentsAdapter = { purchase: () => Promise.resolve(null), restore: () => Promise.resolve(undefined) };
    const storeOptions: GrantedPurchaseStoreOptions = { initial: ['a'], cap: DEFAULT_GRANTED_PURCHASE_CAP, onChange: (tokens: string[]) => void tokens };
    const memory: MemoryGrantedPurchaseStore = createGrantedPurchaseStore(storeOptions);
    const granted: GrantedPurchaseStore = memory;
    const onEvent: PurchaseEventHandler<Rewards> = (event: PurchaseEvent<Rewards>) => {
      const type: PurchaseEventType = event.type;
      if (event.type === 'granted') { const rewards: Rewards = event.rewards; void rewards; }
      if (event.type === 'error') { const reason: PurchaseErrorReason = event.reason; void reason; }
      void type;
    };
    const onPurchaseError: PurchaseCallbackErrorHandler = (_e, context: PurchaseErrorContext) => { const p: PurchaseErrorPhase = context.phase; void p; };
    const options: PurchaseRuntimeOptions<Rewards> = {
      payments, granted,
      resolveGrant: (_productId: string, context: PurchaseGrantContext) => (context.restored ? null : [{ id: 'coins', amount: 1 }]),
      grant: (_productId: string, rewards: Rewards, context: PurchaseGrantContext) => void [rewards, context],
      onEvent, onPurchaseError, isPayer: () => false
    };
    const purchases = new PurchaseRuntime<Rewards>(options);
    // ledger mode: the value owner's one-operation apply (sync or async answer)
    const applyAnswer: PurchaseLedgerApplyResult = 'applied';
    const ledger: PurchaseLedger<Rewards> = { apply: (entry: PurchaseLedgerEntry<Rewards>) => (entry.token ? Promise.resolve(applyAnswer) : 'not_durable') };
    const durable = new PurchaseRuntime<Rewards>({ ...options, ledger });

    const publicMethods: Record<keyof PurchaseRuntime, true> = {
      purchase: true, restore: true, getPending: true, isPayer: true, getStats: true, dispose: true
    };
    const bought: Promise<PurchaseResult> = purchases.purchase('gold_1', 'shop');
    const restored: Promise<RestoreResult> = purchases.restore();
    const status: Promise<PurchaseStatus> = bought.then((r) => r.status);
    const list: Promise<RestoredPurchase[]> = restored.then((r) => r.granted);
    const pending: PurchasePending | null = purchases.getPending();
    const stats: PurchaseRuntimeStats = purchases.getStats();
    const payer: boolean = purchases.isPayer();

    // composition: AnalyticsRuntime satisfies the sink, the handler is a PurchaseRuntime onEvent
    const sink: PurchaseAnalyticsSink = null as unknown as AnalyticsRuntime;
    const price: PurchasePriceResolver = (): PurchasePrice => ({ revenue: 29, currency: 'RUB' });
    const handler: PurchaseEventHandler<Rewards> = createPurchaseAnalyticsHandler<Rewards>(sink, price, onEvent);
    const record: PurchaseAnalyticsRecord = purchaseEventToAnalytics({ type: 'started', productId: 'gold_1', source: undefined }, price);
    const offers = null as unknown as OfferRuntime;
    const rewardsOf = (productId: string): Rewards | undefined => offers.offerByProduct(productId)?.rewards;
    void [minimal, publicMethods, status, list, pending, stats, payer, handler, record, rewardsOf, durable];

    // @ts-expect-error the idempotency claim is internal
    purchases.claim;
    // @ts-expect-error the grant step is internal
    purchases.deliver;
    // @ts-expect-error the registry is reachable only through the injected store
    purchases.grantedStore;
    // @ts-expect-error event dispatch is internal
    purchases.emit;
    // @ts-expect-error a payer cannot be forced from outside
    purchases.payer = true;
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
