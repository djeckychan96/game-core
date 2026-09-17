import { expect, test, vi } from 'vitest';
import { MemoryOfferStateStore, OfferRuntime } from '../../src/offers';
import { PlatformCatalog, PlatformRuntime, createDevPlatform, normalizePlatformProducts, validateGamePlatformConfig } from '../../src/platform';
import type { GamePlatformConfig, PlatformProduct } from '../../src/platform';
import { AdsRuntime, MemoryAdsStateStore } from '../../src/ads';
import { RUB_PER_USD, T0 as ADS_T0, donorConfig } from '../ads/fixtures';
import { T0, makeConfig } from '../offers/fixtures';

const PRODUCTS: PlatformProduct[] = [
  { id: 'starter_pack', priceText: '149 ₽', currency: 'RUB' },
  { id: 'gold_1', priceText: '99 ₽', currency: 'RUB' }
];

// ---------------------------------------------------------------- catalog

test('catalog normalization: a product is an id AND a ready price string (the donor rule); the rest is dropped, a repeated id — the later wins', () => {
  expect(
    normalizePlatformProducts([
      { id: 'gold_1', priceText: '99 ₽', currency: 'RUB' },
      { id: 'no_price', priceText: '', currency: 'RUB' },
      { id: '', priceText: '10 ₽', currency: 'RUB' },
      { id: 'no_currency', priceText: '$2.99' },
      { id: 7, priceText: '1' },
      null,
      'gold_2',
      { id: 'gold_1', priceText: '89 ₽', currency: 'RUB', price: 89, extra: true }
    ])
  ).toEqual([
    { id: 'gold_1', priceText: '89 ₽', currency: 'RUB' },
    { id: 'no_currency', priceText: '$2.99', currency: '' }
  ]);
  for (const junk of [null, undefined, {}, 'catalog', 42]) expect(normalizePlatformProducts(junk)).toEqual([]);
});

test('the catalog is live state: empty until refreshed, a late catalog MERGES, an empty or failed refresh never takes a price away', async () => {
  let answer: (() => Promise<PlatformProduct[]>) | null = async () => [];
  const changes: number[] = [];
  const errors: string[] = [];
  const catalog = new PlatformCatalog(
    { getCatalog: () => answer!() },
    { onChange: (products) => changes.push(products.length), onError: (_e, c) => errors.push(c.phase) }
  );
  expect([catalog.hasPrice('starter_pack'), catalog.currency(), catalog.size]).toEqual([false, '', 0]);

  expect(await catalog.refresh()).toEqual({ status: 'empty', products: 0, changed: false }); // products not applied yet
  answer = async () => [PRODUCTS[0]!];
  expect(await catalog.refresh()).toEqual({ status: 'ok', products: 1, changed: true });
  expect([catalog.hasPrice('starter_pack'), catalog.priceText('starter_pack'), catalog.currency()]).toEqual([true, '149 ₽', 'RUB']);

  answer = async () => [PRODUCTS[1]!]; // the late part of the catalog
  expect(await catalog.refresh()).toMatchObject({ status: 'ok', products: 2 });
  answer = () => Promise.reject(new Error('sdk_timeout:getCatalog'));
  expect(await catalog.refresh()).toEqual({ status: 'error', products: 2, changed: false });
  answer = async () => [];
  expect(await catalog.refresh()).toEqual({ status: 'empty', products: 2, changed: false });
  expect(catalog.products().map((p) => p.id)).toEqual(['starter_pack', 'gold_1']);
  expect(catalog.product('gold_1')).toEqual(PRODUCTS[1]);

  expect(await catalog.refresh()).toMatchObject({ changed: false }); // same answer → no redraw
  expect(catalog.merge([{ id: 'gold_1', priceText: '$1.99', currency: 'USD' }])).toBe(true); // the push path of a polling adapter
  expect([catalog.priceText('gold_1'), catalog.currency()]).toEqual(['$1.99', 'USD']);
  expect(changes).toEqual([1, 2, 2]);
  expect(errors).toEqual(['refresh']);
});

test('the catalog owns no schedule: concurrent refreshes share one platform call, no timer is ever set, a throwing onChange is contained', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    let release!: (products: PlatformProduct[]) => void;
    const contained: unknown[] = [];
    const catalog = new PlatformCatalog(
      { getCatalog: () => (calls++, new Promise<PlatformProduct[]>((resolve) => (release = resolve))) },
      {
        onChange: () => {
          throw new Error('shop redraw failed');
        },
        onError: (error) => contained.push(error)
      }
    );
    const both = Promise.all([catalog.refresh(), catalog.refresh()]);
    release(PRODUCTS);
    expect((await both).map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(calls).toBe(1);
    expect(contained).toHaveLength(1);
    expect(catalog.size).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('platform.catalog feeds the three donor consumers: OfferRuntime.hasPrice, the shop label, AdsInput.currencyScale', async () => {
  const platform = new PlatformRuntime(createDevPlatform({ products: [{ id: 'starter_pack', priceText: '$1.99', currency: 'USD' }] }));
  const offers = new OfferRuntime({
    config: makeConfig(),
    state: new MemoryOfferStateStore(),
    input: { now: () => T0, level: () => 8, hasPrice: (id) => platform.catalog.hasPrice(id), welcomeOwned: () => false }
  });
  offers.update(16);
  expect(offers.getActive()).toBeNull(); // no platform price yet → the offer never activates
  expect(await platform.catalog.refresh()).toMatchObject({ status: 'ok', products: 1 });
  offers.tick();
  expect(offers.getActive()?.productId).toBe('starter_pack');
  expect(platform.catalog.priceText('starter_pack')).toBe('$1.99');

  // AdsInput.currencyScale reads the CATALOG's currency instead of the build mode: the same $1 payer
  // is pay_3 on a USD catalog and would be pay_1 if the dollars were read as roubles
  const segmentOf = (source: PlatformRuntime): string | null =>
    new AdsRuntime({
      config: donorConfig(),
      state: new MemoryAdsStateStore(),
      input: {
        now: () => ADS_T0, level: () => 30, hasNoAds: () => false, payCount: () => 1, paySumCents: () => 100, payMaxCents: () => 100,
        currencyScale: () => (source.catalog.currency() === 'USD' ? 1 / RUB_PER_USD : 1)
      }
    }).getStats().segmentId;
  expect(segmentOf(platform)).toBe('pay_3');
  const roubles = new PlatformRuntime(createDevPlatform({ products: PRODUCTS }));
  await roubles.catalog.refresh();
  expect(segmentOf(roubles)).toBe('pay_1');

  const noPayments = new PlatformRuntime(createDevPlatform({ payments: false }));
  expect(await noPayments.catalog.refresh()).toEqual({ status: 'unavailable', products: 0, changed: false });
  expect(noPayments.catalog.hasPrice('starter_pack')).toBe(false);
});

// ---------------------------------------------------------------- config

const CONFIG: GamePlatformConfig = {
  app: 'twin_arrow',
  platforms: {
    YA: { provider: 'yandex', platformCode: 'YA', analytics: { endpoint: 'https://analytics.example.ru/ingest', jwtRef: 'YA' } },
    FB: {
      provider: 'cleverapps',
      platformCode: 'FB',
      analytics: { endpoint: 'https://analytics.example.com/ingest', jwtRef: 'FB' },
      connector: { projectId: 'twinarrow', clientConfig: 'configs/cleverapps-fb.js' },
      publicIds: { appId: '1389741603286217', rewarded: '1389744803285897' }
    },
    VK: { provider: 'cleverapps', platformCode: 'VK', connector: { projectId: 'twinarrow' } },
    DEV: { provider: 'dev', platformCode: 'DEV' }
  }
};

test('a client-safe platform config validates: provider + code + analytics endpoint / jwtRef + connector refs + public ids', () => {
  expect(() => validateGamePlatformConfig(CONFIG)).not.toThrow();
});

test('the config can not carry a server secret or a JWT value — by type and by validation', () => {
  const fakeJwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`; // shaped like a token, never a real one
  const smuggled: Array<[RegExp, unknown]> = [
    [/appSecret is a server-secret field/, { ...CONFIG, platforms: { FB: { ...CONFIG.platforms.FB, connector: { projectId: 'twinarrow', appSecret: 'x' } } } }],
    [/serviceKey is a server-secret field/, { ...CONFIG, serviceKey: 'x' }],
    [/privateKey is a server-secret field/, { ...CONFIG, platforms: { YA: { ...CONFIG.platforms.YA, privateKey: 'x' } } }],
    [/secretKey is a server-secret field/, { ...CONFIG, platforms: { YA: { ...CONFIG.platforms.YA, publicIds: { secretKey: 'x' } } } }],
    [/publicKey is a server-secret field/, { ...CONFIG, platforms: { MSS: { provider: 'cleverapps', platformCode: 'MSS', connector: { projectId: 'twinarrow' }, msstart: { publicKey: 'x' } } } }],
    [/jwt is a server-secret field/, { ...CONFIG, platforms: { YA: { ...CONFIG.platforms.YA, analytics: { endpoint: 'https://a.example/ingest', jwtRef: 'YA', jwt: 'x' } } } }],
    [/looks like a JWT/, { ...CONFIG, platforms: { YA: { ...CONFIG.platforms.YA, analytics: { endpoint: 'https://a.example/ingest', jwtRef: fakeJwt } } } }],
    [/looks like a JWT/, { ...CONFIG, platforms: { FB: { ...CONFIG.platforms.FB, publicIds: { appId: fakeJwt } } } }],
    [/jwtRef must be a reference name/, { ...CONFIG, platforms: { YA: { ...CONFIG.platforms.YA, analytics: { endpoint: 'https://a.example/ingest', jwtRef: 'Bearer abc def' } } } }]
  ];
  for (const [message, config] of smuggled) expect(() => validateGamePlatformConfig(config as GamePlatformConfig), String(message)).toThrow(message);

  // and the types have no place for one
  const typed: GamePlatformConfig = {
    app: 'a',
    platforms: {
      // @ts-expect-error a target config has no secret field
      YA: { provider: 'yandex', platformCode: 'YA', appSecret: 'x' },
      // @ts-expect-error the analytics block references the JWT by name — it has no value field
      FB: { provider: 'cleverapps', platformCode: 'FB', connector: { projectId: 'p' }, analytics: { endpoint: 'https://a.example/ingest', jwtRef: 'FB', jwt: 'x' } }
    }
  };
  void typed;
});

test('config shape rules: known codes, the key is the code, explicit provider, https endpoint, projectId for the connector', () => {
  const bad: Array<[RegExp, unknown]> = [
    [/config is required/, null],
    [/app must be a non-empty string/, { ...CONFIG, app: '' }],
    [/platforms must not be empty/, { app: 'a', platforms: {} }],
    [/platforms\.STEAM: unknown platform code/, { app: 'a', platforms: { STEAM: { provider: 'dev', platformCode: 'STEAM' } } }],
    [/platforms\.FB\.platformCode must be "FB"/, { app: 'a', platforms: { FB: { provider: 'cleverapps', platformCode: 'YA', connector: { projectId: 'p' } } } }],
    [/provider must be one of/, { app: 'a', platforms: { YA: { provider: 'autodetect', platformCode: 'YA' } } }],
    [/dev provider never serves a production code/, { app: 'a', platforms: { YA: { provider: 'dev', platformCode: 'YA' } } }],
    [/yandex provider serves YA/, { app: 'a', platforms: { FB: { provider: 'yandex', platformCode: 'FB' } } }],
    [/endpoint must be an https URL/, { app: 'a', platforms: { YA: { provider: 'yandex', platformCode: 'YA', analytics: { endpoint: 'http://a.example/ingest', jwtRef: 'YA' } } } }],
    [/connector\.projectId is required/, { app: 'a', platforms: { OK: { provider: 'cleverapps', platformCode: 'OK' } } }],
    [/publicIds\.appId must be a string/, { app: 'a', platforms: { DEV: { provider: 'dev', platformCode: 'DEV', publicIds: { appId: 1 } } } }]
  ];
  for (const [message, config] of bad) expect(() => validateGamePlatformConfig(config as GamePlatformConfig), String(message)).toThrow(message);
});
