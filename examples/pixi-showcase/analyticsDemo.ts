// AnalyticsRuntime demo for the showcase: a FAKE transport (nothing leaves the page, no endpoint,
// no JWT) that keeps every batch it was given, and a demo context. A game passes its own
// app / platform / build version / profile and `createHazarAnalyticsTransport({ endpoint, token, fetchFn: fetch })`.
import { BUILD_INFO } from 'game-core';
import type { AnalyticsContext, AnalyticsEnvelope, AnalyticsTransport } from 'game-core';

/** Records batches instead of sending them; `failNext` makes the next sends reject (retry demo). */
export class DemoAnalyticsTransport implements AnalyticsTransport {
  readonly batches: AnalyticsEnvelope[][] = [];
  failNext = 0;
  failed = 0;

  send(events: AnalyticsEnvelope[]): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      this.failed++;
      return Promise.reject(new Error('demo transport: offline'));
    }
    this.batches.push(events);
    console.info(`[analytics demo] batch #${this.batches.length} · ${events.length} event(s)`, events);
    return Promise.resolve();
  }

  get lastBatch(): AnalyticsEnvelope[] {
    return this.batches[this.batches.length - 1] ?? [];
  }

  get eventsSent(): number {
    return this.batches.reduce((sum, batch) => sum + batch.length, 0);
  }
}

/** `interaction` events read better by their action. */
export function eventLabel(envelope: AnalyticsEnvelope): string {
  const action = envelope.event.data['action'];
  return envelope.event.name === 'interaction' && typeof action === 'string' ? action : envelope.event.name;
}

/** The demo identity: app_ver is this build's real version, the A/B fields are a plain control group. */
export function demoAnalyticsContext(level: () => number): () => AnalyticsContext {
  return () => ({
    app: 'game_core_showcase',
    platform: 'DEV',
    appVersion: BUILD_INFO.version,
    profileId: 'showcase-local-profile',
    device: 'mobile',
    platformOs: 'web',
    configName: 'showcase_default',
    configGroup: 'control',
    baseData: { level: level(), env: 'showcase' }
  });
}
