import type { CoreRuntimeModule } from '../core/CoreRuntime';
import {
  activeOffer,
  clampOfferTimes,
  isChainBlocked,
  offerByProduct,
  onOfferPurchased,
  secondsLeft,
  shownOffer,
  tickOffers
} from './chain';
import { validateOfferChainConfig } from './config';
import type {
  OfferChainConfig,
  OfferChainInput,
  OfferDef,
  OfferErrorHandler,
  OfferEvent,
  OfferEventHandler,
  OfferRuntimeOptions,
  OfferRuntimeStats,
  OfferStateStore
} from './types';

const DEFAULT_TICK_INTERVAL_MS = 1000;

// Same shape as the other modules' default handlers — independently re-declared (module boundary rule).
function defaultOnOfferError(error: unknown, context: { phase: string; event: OfferEvent }): void {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[OfferRuntime] onEvent threw', context, error);
  }
}

/**
 * The LiveOps offer chain as a Game Core module: Trail Arrow's `OfferChainSystem` + the purchase
 * hook of its `DataUpdateSystem`, over the pure chain in `chain.ts`.
 *
 * - `update(frameMs)` only paces `tick()` (once per `tickIntervalMs` of frame time, at most one
 *   transition per update); every deadline is computed from `input.now()`, the host's server-
 *   anchored clock, never from frame time or `Date`.
 * - The catalog gate `input.hasPrice` is live: asked on every decision, never snapshotted.
 * - Purchases and rewards stay with the host: `onPurchased(productId)` only moves the chain and
 *   reports `moved`; `offerByProduct(productId).rewards` is what the host grants.
 * - Events (`activated`, `expired`, `purchased`, `blocked_no_price`) go to the injected `onEvent`;
 *   `blocked_no_price` fires once per runtime lifetime.
 */
export class OfferRuntime implements CoreRuntimeModule {
  private readonly config: OfferChainConfig;
  private readonly state: OfferStateStore;
  private readonly input: OfferChainInput;
  private readonly onEvent: OfferEventHandler | null;
  private readonly onOfferError: OfferErrorHandler;
  private readonly tickIntervalMs: number;
  private accumulatorMs: number;
  private ticks = 0;
  private changes = 0;
  private purchases = 0;
  private events = 0;
  private callbackErrors = 0;
  private blockedReported = false;

  constructor(options: OfferRuntimeOptions) {
    validateOfferChainConfig(options.config);
    if (!options.state) throw new RangeError('OfferRuntime: options.state is required');
    if (!options.input) throw new RangeError('OfferRuntime: options.input is required');
    const interval = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    if (!(Number.isFinite(interval) && interval >= 0)) throw new RangeError('OfferRuntime: tickIntervalMs must be a finite number ≥ 0');
    this.config = options.config;
    this.state = options.state;
    this.input = options.input;
    this.onEvent = options.onEvent ?? null;
    this.onOfferError = options.onOfferError ?? defaultOnOfferError;
    this.tickIntervalMs = interval;
    // like the donor (`lastCheckMs = 0`): the very first update ticks at once
    this.accumulatorMs = interval;
  }

  /**
   * Host frame: accumulates frame time and runs one `tick()` once `tickIntervalMs` has passed.
   * A long frame (the tab was hidden) still yields exactly one tick — the donor resets its
   * check time rather than catching up, so several transitions are never collapsed into one
   * update. Returns true when the chain state changed (the host saves the profile).
   */
  update(frameMs: number): boolean {
    const dt = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
    this.accumulatorMs += dt;
    if (this.accumulatorMs < this.tickIntervalMs) return false;
    this.accumulatorMs = 0;
    return this.tick();
  }

  /**
   * One step of the chain at `input.now()`: at most one transition (T1…T6 order), events for what
   * changed, `blocked_no_price` once when a tier is due and nothing has a price. Hosts call it
   * directly after a resume from background or a profile load.
   */
  tick(): boolean {
    const now = this.input.now();
    const level = this.input.level();
    const hasPrice = (productId: string) => this.input.hasPrice(productId); // live on every call
    const welcomeOwned = this.input.welcomeOwned();
    this.ticks++;
    const before = shownOffer(this.config, this.state);
    const changed = tickOffers(this.config, this.state, now, level, hasPrice, welcomeOwned);
    if (!changed) {
      if (!this.blockedReported && isChainBlocked(this.config, this.state, now, level, hasPrice, welcomeOwned)) {
        this.blockedReported = true;
        this.emit({ type: 'blocked_no_price', level, now });
      }
      return false;
    }
    this.changes++;
    const after = shownOffer(this.config, this.state);
    if (before && before !== after) this.emit({ type: 'expired', offer: before, level, now });
    if (after && after !== before) this.emit({ type: 'activated', offer: after, level, now });
    return true;
  }

  /** The active offer at `input.now()`, or null. */
  getActive(): OfferDef | null {
    return activeOffer(this.config, this.state, this.input.now());
  }

  /** Seconds until the active offer ends; 0 when none is active. */
  secondsLeft(): number {
    return secondsLeft(this.config, this.state, this.input.now());
  }

  /** The chain offer for a product id (its `rewards` are what the host grants), or null. */
  offerByProduct(productId: string): OfferDef | null {
    return offerByProduct(this.config, productId);
  }

  /**
   * A purchase of `productId` succeeded (the host already granted its rewards, or will). Moves the
   * chain if it was the active offer or a late purchase of the just-expired one, emits
   * `purchased` with `moved`, and returns `moved`. A product outside the chain returns false
   * without an event.
   */
  onPurchased(productId: string): boolean {
    const offer = offerByProduct(this.config, productId);
    if (!offer) return false;
    const now = this.input.now();
    const level = this.input.level();
    this.purchases++;
    const moved = onOfferPurchased(this.config, this.state, productId, now);
    if (moved) this.changes++;
    this.emit({ type: 'purchased', offer, moved, level, now });
    return moved;
  }

  /** Caps the saved times against `input.now()` (profile load / clock repair). True if anything changed. */
  clampTimes(): boolean {
    return clampOfferTimes(this.config, this.state, this.input.now());
  }

  getStats(): OfferRuntimeStats {
    const now = this.input.now();
    const active = activeOffer(this.config, this.state, now);
    return {
      active: active ? active.productId : null,
      welcome: this.state.get('welcome'),
      tier: this.state.get('activeTier'),
      variant: this.state.get('activeVariant') === 1 ? 1 : 0,
      until: this.state.get('until'),
      nextTier: this.state.get('nextTier'),
      nextAt: this.state.get('nextAt'),
      secondsLeft: secondsLeft(this.config, this.state, now),
      ticks: this.ticks,
      changes: this.changes,
      purchases: this.purchases,
      events: this.events,
      blockedReported: this.blockedReported,
      callbackErrors: this.callbackErrors
    };
  }

  private emit(event: OfferEvent): void {
    this.events++;
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch (error) {
      this.callbackErrors++;
      try {
        this.onOfferError(error, { phase: 'onEvent', event });
      } catch {
        // an error handler can never take the chain down
      }
    }
  }
}
