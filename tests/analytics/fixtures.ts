import type { AnalyticsContext, AnalyticsEnvelope, AnalyticsQueueStore, AnalyticsTransport } from '../../src/analytics';

/** Never a real token: the production JWTs live in the games' build configs, not in this repository. */
export const FAKE_TOKEN = 'fake-jwt-for-tests';

export function makeContext(overrides: Partial<AnalyticsContext> = {}): AnalyticsContext {
  return {
    app: 'trail_arrow',
    platform: 'YA',
    appVersion: '0.1.23',
    buildVersion: 123,
    profileId: 'profile-1',
    installedAt: 1_757_000_000,
    device: 'mobile',
    platformOs: 'android',
    ...overrides
  };
}

/** Records every batch; `ok` resolves, `fail` rejects with `error`, `manual` waits for `settle()`. */
export class FakeTransport implements AnalyticsTransport {
  readonly batches: AnalyticsEnvelope[][] = [];
  mode: 'ok' | 'fail' | 'manual' = 'ok';
  error: unknown = new Error('network down');
  active = 0;
  maxActive = 0;
  private readonly pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  send(events: AnalyticsEnvelope[]): Promise<void> {
    this.batches.push(events);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    const done = () => {
      this.active--;
    };
    let result: Promise<void>;
    if (this.mode === 'manual') result = new Promise<void>((resolve, reject) => this.pending.push({ resolve, reject }));
    else result = this.mode === 'ok' ? Promise.resolve() : Promise.reject(this.error);
    result.then(done, done);
    return result;
  }

  /** Settles the oldest pending `manual` send. */
  settle(ok = true): void {
    const next = this.pending.shift();
    if (!next) throw new Error('FakeTransport: nothing to settle');
    if (ok) next.resolve();
    else next.reject(this.error);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  names(): string[][] {
    return this.batches.map((batch) => batch.map((envelope) => envelope.event.name));
  }
}

export class MemoryQueueStore implements AnalyticsQueueStore {
  saved: AnalyticsEnvelope[];
  saves = 0;

  constructor(initial: AnalyticsEnvelope[] = []) {
    this.saved = initial;
  }

  load(): AnalyticsEnvelope[] {
    return this.saved;
  }

  save(events: AnalyticsEnvelope[]): void {
    this.saves++;
    this.saved = events.slice();
  }
}

/** Lets every already-queued microtask (promise reaction) run. */
export async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
