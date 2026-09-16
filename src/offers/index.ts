// OfferRuntime v0.4 — the renderer-independent LiveOps offer chain (root entry `game-core`).
export { OfferRuntime } from './OfferRuntime';
export {
  offerByProduct,
  activeOffer,
  secondsLeft,
  pickAvailableOffer,
  isChainBlocked,
  clampOfferTimes,
  tickOffers,
  onOfferPurchased
} from './chain';
export type { OfferPriceGate } from './chain';
export {
  DEFAULT_OFFER_CHAIN_TIMING,
  DEFAULT_WELCOME_TIMER_SEC,
  DEFAULT_TIER_TIMER_SEC,
  OFFER_HOUR_SEC,
  OFFER_DAY_SEC,
  validateOfferChainConfig
} from './config';
export { MemoryOfferStateStore } from './state';
export { OFFER_STATE_KEYS, OFFER_WELCOME } from './types';
export type {
  OfferVariant,
  OfferReward,
  OfferDef,
  OfferChainConfig,
  OfferStateKey,
  OfferWelcomeState,
  OfferStateStore,
  OfferChainInput,
  OfferEventType,
  OfferEvent,
  OfferEventHandler,
  OfferErrorPhase,
  OfferErrorContext,
  OfferErrorHandler,
  OfferRuntimeOptions,
  OfferRuntimeStats
} from './types';
