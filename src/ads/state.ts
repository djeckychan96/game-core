import type { AdsCount, AdsStateKey, AdsStateStore } from './types';

export const ADS_STATE_KEYS: readonly AdsStateKey[] = ['dayStamp', 'hourStamp', 'payer', 'lastInterAt', 'lastRewardAt'];

export interface AdsStateSnapshot {
  values: Record<AdsStateKey, number>;
  counts: Record<string, AdsCount>;
}

const clean = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * A plain in-memory `AdsStateStore`: every key and every count starts at 0 (the donor's empty
 * `adstats` blob). For tests, demos and hosts that persist the snapshot themselves; a game with
 * its own storage implements `AdsStateStore` over it instead. `load` takes anything — broken or
 * foreign data reads as defaults, never throws (the donor's strict shape check).
 */
export class MemoryAdsStateStore implements AdsStateStore {
  private values: Record<AdsStateKey, number>;
  private counts: Record<string, AdsCount> = {};

  constructor(initial?: unknown) {
    this.values = {} as Record<AdsStateKey, number>;
    this.load(initial);
  }

  get(key: AdsStateKey): number {
    return this.values[key] ?? 0;
  }

  set(key: AdsStateKey, value: number): void {
    this.values[key] = value;
  }

  getCount(placement: string): AdsCount {
    const count = this.counts[placement];
    return count ? { day: count.day, hour: count.hour } : { day: 0, hour: 0 };
  }

  setCount(placement: string, value: AdsCount): void {
    this.counts[placement] = { day: value.day, hour: value.hour };
  }

  listCounts(): string[] {
    return Object.keys(this.counts);
  }

  /** A copy of everything, e.g. for the host's save. */
  snapshot(): AdsStateSnapshot {
    const counts: Record<string, AdsCount> = {};
    for (const [placement, count] of Object.entries(this.counts)) counts[placement] = { ...count };
    return { values: { ...this.values }, counts };
  }

  /** Replaces everything, e.g. from the host's load. Garbage becomes 0; garbage as a whole becomes the empty state. */
  load(data: unknown): void {
    const source = data && typeof data === 'object' ? (data as Partial<Record<keyof AdsStateSnapshot, unknown>>) : {};
    const values = source.values && typeof source.values === 'object' ? (source.values as Record<string, unknown>) : {};
    for (const key of ADS_STATE_KEYS) this.values[key] = clean(values[key]);
    this.counts = {};
    const counts = source.counts && typeof source.counts === 'object' ? (source.counts as Record<string, unknown>) : {};
    for (const [placement, count] of Object.entries(counts)) {
      if (!count || typeof count !== 'object') continue;
      const { day, hour } = count as Partial<Record<keyof AdsCount, unknown>>;
      this.counts[placement] = { day: clean(day), hour: clean(hour) };
    }
  }
}
