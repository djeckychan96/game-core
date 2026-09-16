// OfferRuntime v0.4 — public types of Game Core's renderer-independent LiveOps offer chain.
// The semantics are Trail Arrow 0.1.22 `src/app/OfferChain.ts` ported 1:1 (spec:
// docs/superpowers/specs/2026-09-16-offer-runtime-v0.4-design.md). Nothing in this module knows a
// renderer, a wall clock, a storage or a payment SDK: the host injects state, time, level and the
// live catalog, and grants rewards itself.

/** Ladder variant: 0 = A, 1 = B. */
export type OfferVariant = 0 | 1;

export interface OfferReward {
  /** Host-owned resource id (e.g. `coins`); the runtime never interprets it. */
  id: string;
  amount: number;
}

export interface OfferDef {
  /** Platform product id; also the key of the live catalog gate. */
  productId: string;
  /** 0 = the welcome offer, 1..`topTier` = the ladder. */
  tier: number;
  variant: OfferVariant;
  /** Localization key of the window title; the host translates. */
  titleKey: string;
  /** How long the offer stays active once activated. */
  timerSec: number;
  /** What a purchase grants — data only, granted by the host after `onPurchased`. */
  rewards: OfferReward[];
}

export interface OfferChainConfig {
  /** The chain starts (welcome first) once the player's level reaches this. Expiries are processed below it. */
  startLevel: number;
  /** Highest ladder tier; `tiers.length` must equal it. */
  topTier: number;
  /** The one-time welcome offer (`tier` 0). */
  welcome: OfferDef;
  /** `tiers[tier − 1][variant]`; every tier carries both variants. */
  tiers: OfferDef[][];
  /** Cooldown after a purchase before the next (higher) tier. */
  nextAfterBuySec: number;
  /** Cooldown after an expiry before the next (lower) tier. */
  nextAfterDeclineSec: number;
  /** A purchase of the just-expired offer inside this window still counts as "bought". */
  latePurchaseWindowSec: number;
  /** `clampOfferTimes`: `until` may never be further ahead than this. */
  maxUntilAheadSec: number;
  /** `clampOfferTimes`: `nextAt` may never be further ahead than this. */
  maxNextAheadSec: number;
}

/** The ten numeric keys of the chain state (Trail Arrow: profile resources `offer_*`). */
export type OfferStateKey =
  | 'welcome'
  | 'until'
  | 'activeTier'
  | 'activeVariant'
  | 'seenMask'
  | 'variantMask'
  | 'nextTier'
  | 'nextAt'
  | 'declined'
  | 'declinedAt';

export const OFFER_STATE_KEYS: readonly OfferStateKey[] = [
  'welcome',
  'until',
  'activeTier',
  'activeVariant',
  'seenMask',
  'variantMask',
  'nextTier',
  'nextAt',
  'declined',
  'declinedAt'
];

/** Values of the `welcome` key: never shown / active / finished (bought or expired). */
export const OFFER_WELCOME = { NEW: 0, ACTIVE: 1, DONE: 2 } as const;
export type OfferWelcomeState = (typeof OFFER_WELCOME)[keyof typeof OFFER_WELCOME];

/**
 * Host-owned persistence of the ten keys. A missing key reads as 0; `set` creates it. The values
 * are NOT monotonic (timers move back and forth), so a cloud merge must take the whole block from
 * one winner, never max-merge the keys.
 */
export interface OfferStateStore {
  get(key: OfferStateKey): number;
  set(key: OfferStateKey, value: number): void;
}

/** Everything the chain reads from the outside world, injected by the host. */
export interface OfferChainInput {
  /** Server-anchored "now" in unix seconds (Trail Arrow: `LOGIN_AT + session seconds`). */
  now(): number;
  /** The player's current level. */
  level(): number;
  /** Live catalog gate: does the platform sell this product right now? Consulted on every decision, never cached. */
  hasPrice(productId: string): boolean;
  /** The welcome product is already owned (bought before the chain existed). */
  welcomeOwned(): boolean;
}

export type OfferEventType = 'activated' | 'expired' | 'purchased' | 'blocked_no_price';

/**
 * What happened, with enough data for the host's analytics. `activated`/`expired` carry the
 * offer that appeared/left the screen; `purchased` carries whether the chain moved; `blocked_no_price`
 * fires once per runtime lifetime when a tier is due but nothing in the ladder has a price.
 */
export type OfferEvent =
  | { type: 'activated'; offer: OfferDef; level: number; now: number }
  | { type: 'expired'; offer: OfferDef; level: number; now: number }
  | { type: 'purchased'; offer: OfferDef; moved: boolean; level: number; now: number }
  | { type: 'blocked_no_price'; level: number; now: number };

export type OfferEventHandler = (event: OfferEvent) => void;

export type OfferErrorPhase = 'onEvent';

export interface OfferErrorContext {
  phase: OfferErrorPhase;
  event: OfferEvent;
}

export type OfferErrorHandler = (error: unknown, context: OfferErrorContext) => void;

export interface OfferRuntimeOptions {
  config: OfferChainConfig;
  state: OfferStateStore;
  input: OfferChainInput;
  onEvent?: OfferEventHandler;
  /** Where a throwing `onEvent` lands; defaults to console.error. The chain state is never affected. */
  onOfferError?: OfferErrorHandler;
  /** Frame-time cadence of `update` → `tick`; default 1000 ms like the donor's OfferChainSystem. */
  tickIntervalMs?: number;
}

export interface OfferRuntimeStats {
  /** productId of the active offer, or null. */
  active: string | null;
  welcome: number;
  tier: number;
  variant: OfferVariant;
  until: number;
  nextTier: number;
  nextAt: number;
  secondsLeft: number;
  /** `tick` calls (explicit or through `update`). */
  ticks: number;
  /** Chain transitions (ticks that changed state + purchases that moved the chain). */
  changes: number;
  /** `onPurchased` calls for a chain product (moved or not). */
  purchases: number;
  /** Events delivered to `onEvent`. */
  events: number;
  blockedReported: boolean;
  /** Caught `onEvent` exceptions. */
  callbackErrors: number;
}
