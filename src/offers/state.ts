import { OFFER_STATE_KEYS, type OfferStateKey, type OfferStateStore } from './types';

/**
 * A plain in-memory `OfferStateStore`: every key starts at 0 (a missing profile resource reads as
 * 0 in the donor too). For tests, demos and hosts that persist the snapshot themselves; a game
 * with its own profile model implements `OfferStateStore` over it instead.
 */
export class MemoryOfferStateStore implements OfferStateStore {
  private readonly values: Record<OfferStateKey, number>;

  constructor(initial: Partial<Record<OfferStateKey, number>> = {}) {
    this.values = {} as Record<OfferStateKey, number>;
    for (const key of OFFER_STATE_KEYS) this.values[key] = 0;
    for (const key of OFFER_STATE_KEYS) {
      const value = initial[key];
      if (typeof value === 'number' && Number.isFinite(value)) this.values[key] = value;
    }
  }

  get(key: OfferStateKey): number {
    return this.values[key] ?? 0;
  }

  set(key: OfferStateKey, value: number): void {
    this.values[key] = value;
  }

  /** A copy of all ten keys, e.g. for the host's save. */
  snapshot(): Record<OfferStateKey, number> {
    return { ...this.values };
  }

  /** Replaces all ten keys (missing ones become 0), e.g. from the host's load. */
  load(values: Partial<Record<OfferStateKey, number>>): void {
    for (const key of OFFER_STATE_KEYS) {
      const value = values[key];
      this.values[key] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
  }
}
