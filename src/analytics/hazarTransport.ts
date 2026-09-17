import { AnalyticsTransportError } from './AnalyticsTransportError';
import type { AnalyticsEnvelope, AnalyticsTransport } from './types';

/** The production Hazar ingest endpoints. Which one a build uses is the host's config. */
export const HAZAR_INGEST_ENDPOINTS = {
  RU: 'https://analytics.hazargames.ru/ingest',
  EU: 'https://analytics.hazargames.com/ingest'
} as const;

export interface HazarFetchInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  keepalive: boolean;
}

/** The slice of a fetch `Response` the transport reads. */
export interface HazarFetchResponse {
  ok: boolean;
  status: number;
}

/** Structurally the platform `fetch`: a browser host passes `fetch` itself. */
export type HazarFetchFn = (url: string, init: HazarFetchInit) => Promise<HazarFetchResponse>;

export interface HazarAnalyticsTransportOptions {
  /** Full ingest URL (`HAZAR_INGEST_ENDPOINTS.RU` / `.EU`, or a test stand). */
  endpoint: string;
  /**
   * The project/platform JWT — from the host's build config, never from this repository. A
   * function is read on every request (token rotation).
   */
  token: string | (() => string);
  /**
   * The network, injected — Core never reaches for a global. A browser host passes `fetch`; to
   * bound a hung request it passes a wrapper with its own abort
   * (`(url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) })`).
   */
  fetchFn: HazarFetchFn;
  /** Extra request headers (never `Authorization` / `Content-Type` — those are the contract). */
  headers?: Record<string, string>;
  /** `keepalive` of the request, so a flush on page hide survives the unload. Default true. */
  keepalive?: boolean;
}

// The sink looked at the payload and refused it: retrying the same bytes cannot succeed.
const NON_RETRYABLE_STATUS: readonly number[] = [400, 413, 422];

/**
 * Hazar ingest contract: `POST <endpoint>`, `Authorization: Bearer <JWT>`,
 * `Content-Type: application/json`, body = a JSON array of envelopes. A non-2xx answer or a
 * network failure rejects, so `AnalyticsRuntime` keeps the batch and retries on the next flush;
 * 400/413/422 reject as non-retryable and the batch is dropped. The token never appears in an
 * error message.
 */
export function createHazarAnalyticsTransport(options: HazarAnalyticsTransportOptions): AnalyticsTransport {
  const { endpoint, token, headers, keepalive = true } = options;
  // called as a bare function on purpose: the platform `fetch` throws "Illegal invocation" when
  // it is invoked as a method of another object
  const fetchFn = options.fetchFn;
  if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) throw new RangeError('createHazarAnalyticsTransport: endpoint must be an http(s) URL');
  if (typeof fetchFn !== 'function') throw new RangeError('createHazarAnalyticsTransport: fetchFn is required (the host injects its network function)');
  if (typeof token !== 'function' && (typeof token !== 'string' || token === '')) throw new RangeError('createHazarAnalyticsTransport: token is required');

  return {
    async send(events: AnalyticsEnvelope[]): Promise<void> {
      const jwt = typeof token === 'function' ? token() : token;
      if (typeof jwt !== 'string' || jwt === '') throw new AnalyticsTransportError('Hazar ingest: no token yet', { retryable: true });
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: { ...headers, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
        keepalive
      });
      if (!response.ok) {
        throw new AnalyticsTransportError(`Hazar ingest: HTTP ${response.status}`, {
          retryable: !NON_RETRYABLE_STATUS.includes(response.status),
          status: response.status
        });
      }
    }
  };
}
