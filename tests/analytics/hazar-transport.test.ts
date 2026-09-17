import { expect, test, vi } from 'vitest';
import { AnalyticsRuntime, AnalyticsTransportError, HAZAR_INGEST_ENDPOINTS, createHazarAnalyticsTransport } from '../../src/analytics';
import type { HazarFetchFn, HazarFetchInit } from '../../src/analytics';
import { FAKE_TOKEN, makeContext } from './fixtures';

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: HazarFetchInit }> = [];
  const state = { status, networkError: null as Error | null };
  const fetchFn: HazarFetchFn = async (url, init) => {
    calls.push({ url, init });
    if (state.networkError) throw state.networkError;
    return { ok: state.status >= 200 && state.status < 300, status: state.status };
  };
  return { fetchFn, calls, state };
}

test('the production endpoints are RU and EU /ingest', () => {
  expect(HAZAR_INGEST_ENDPOINTS).toEqual({
    RU: 'https://analytics.hazargames.ru/ingest',
    EU: 'https://analytics.hazargames.com/ingest'
  });
});

test('contract: POST <endpoint>, Bearer JWT, application/json, body = the array of envelopes', async () => {
  const { fetchFn, calls } = fakeFetch();
  const analytics = new AnalyticsRuntime({
    context: makeContext(),
    transport: createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn })
  });
  analytics.level({ level: 1, status: 'start' });
  analytics.track('custom', { a: 1 });
  await analytics.flush();
  expect(calls).toHaveLength(1);
  const { url, init } = calls[0]!;
  expect(url).toBe('https://analytics.hazargames.ru/ingest');
  expect(init.method).toBe('POST');
  expect(init.headers).toEqual({ Authorization: `Bearer ${FAKE_TOKEN}`, 'Content-Type': 'application/json' });
  expect(init.keepalive).toBe(true);
  const body = JSON.parse(init.body);
  expect(Array.isArray(body)).toBe(true);
  expect(body).toHaveLength(2);
  expect(body[0]).toEqual({
    app: 'trail_arrow',
    p: 'YA',
    event: {
      name: 'level',
      app_ver: '0.1.23',
      build_ver: 123,
      data: { level: 1, status: 'start', profile_id: 'profile-1', installed_at: 1_757_000_000, device: 'mobile', platform_os: 'android' }
    }
  });
  expect(analytics.getStats()).toMatchObject({ sent: 2, queued: 0 });
});

test('fetchFn is called as a bare function (the platform fetch throws "Illegal invocation" as a method)', async () => {
  let receiver: unknown = 'unset';
  const transport = createHazarAnalyticsTransport({
    endpoint: HAZAR_INGEST_ENDPOINTS.EU,
    token: FAKE_TOKEN,
    fetchFn: function (this: unknown) {
      receiver = this;
      return Promise.resolve({ ok: true, status: 200 });
    }
  });
  await transport.send([]);
  expect(receiver).toBeUndefined();
});

test('a token function is read per request; extra headers never override the contract headers', async () => {
  const { fetchFn, calls } = fakeFetch();
  let token = 'fake-token-1';
  const transport = createHazarAnalyticsTransport({
    endpoint: HAZAR_INGEST_ENDPOINTS.EU,
    token: () => token,
    fetchFn,
    headers: { 'X-Test': '1', Authorization: 'nope', 'Content-Type': 'text/plain' },
    keepalive: false
  });
  await transport.send([]);
  token = 'fake-token-2';
  await transport.send([]);
  expect(calls.map((c) => c.init.headers.Authorization)).toEqual(['Bearer fake-token-1', 'Bearer fake-token-2']);
  expect(calls[0]!.init.headers).toMatchObject({ 'X-Test': '1', 'Content-Type': 'application/json' });
  expect(calls[0]!.init.keepalive).toBe(false);
});

test('HTTP 5xx / 401 / a network failure reject as retryable: the runtime keeps the batch and delivers it later', async () => {
  const { fetchFn, calls, state } = fakeFetch(503);
  const analytics = new AnalyticsRuntime({
    context: makeContext(),
    onError: () => {},
    transport: createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn })
  });
  analytics.track('a');
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 1, sent: 0, lastError: 'Hazar ingest: HTTP 503' });
  state.status = 401;
  await analytics.flush();
  state.networkError = new TypeError('Failed to fetch');
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 1, batchesFailed: 3, dropped: 0 });
  state.networkError = null;
  state.status = 204;
  await analytics.flush();
  expect(analytics.getStats()).toMatchObject({ queued: 0, sent: 1 });
  expect(calls).toHaveLength(4);
});

test('HTTP 400 / 413 / 422 reject as non-retryable and the batch is dropped', async () => {
  for (const status of [400, 413, 422]) {
    const { fetchFn } = fakeFetch(status);
    const transport = createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn });
    const error = await transport.send([]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalyticsTransportError);
    expect(error).toMatchObject({ retryable: false, status });
    const analytics = new AnalyticsRuntime({ context: makeContext(), transport, onError: () => {} });
    analytics.track('a');
    await analytics.flush();
    expect(analytics.getStats()).toMatchObject({ queued: 0, dropped: 1 });
  }
});

test('the token never leaks into an error, and an empty rotating token is a retryable failure without a request', async () => {
  const { fetchFn, calls } = fakeFetch(500);
  const transport = createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn });
  const error = (await transport.send([]).catch((e: unknown) => e)) as Error;
  expect(error.message).not.toContain(FAKE_TOKEN);
  const noToken = createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: () => '', fetchFn });
  await expect(noToken.send([])).rejects.toMatchObject({ retryable: true });
  expect(calls).toHaveLength(1);
});

test('endpoint, token and fetchFn are required — nothing is read from a global', () => {
  const fetchFn = vi.fn();
  expect(() => createHazarAnalyticsTransport({ endpoint: '', token: FAKE_TOKEN, fetchFn })).toThrow(RangeError);
  expect(() => createHazarAnalyticsTransport({ endpoint: 'analytics.hazargames.ru/ingest', token: FAKE_TOKEN, fetchFn })).toThrow(RangeError);
  expect(() => createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: '', fetchFn })).toThrow(RangeError);
  expect(() => createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn: undefined as never })).toThrow(RangeError);
  const globalFetch = vi.spyOn(globalThis, 'fetch');
  createHazarAnalyticsTransport({ endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn });
  expect(globalFetch).not.toHaveBeenCalled();
  globalFetch.mockRestore();
});

test('the platform fetch type-checks as fetchFn', () => {
  const options = { endpoint: HAZAR_INGEST_ENDPOINTS.RU, token: FAKE_TOKEN, fetchFn: fetch };
  expect(() => createHazarAnalyticsTransport(options)).not.toThrow();
});
