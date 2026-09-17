/**
 * A transport failure that says whether retrying can help. `retryable: false` (the sink refused
 * the payload itself — HTTP 400/413/422) makes `AnalyticsRuntime` drop the batch instead of
 * re-queueing it: a poisoned batch at the head of a persisted queue would otherwise block every
 * later event, in this session and the next ones. Any other rejection is treated as retryable.
 */
export class AnalyticsTransportError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(message: string, options: { retryable: boolean; status?: number }) {
    super(message);
    this.name = 'AnalyticsTransportError';
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}
