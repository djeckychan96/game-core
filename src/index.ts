export { FxRuntime } from './fx/FxRuntime';
export { FxPool } from './fx/FxPool';
export { PixiFxSurface } from './adapters/pixi/PixiFxSurface';
export * from './fx/FxSurface';
export * from './fx/types';
export { CoreRuntime } from './core/CoreRuntime';
export type {
  CoreRuntimeModule,
  CoreRuntimeErrorContext,
  CoreRuntimeErrorHandler,
  CoreRuntimeErrorPhase
} from './core/CoreRuntime';
export { BUILD_INFO } from './buildInfo';
export type { GameCoreBuildInfo } from './buildInfo';
export { MotionRuntime } from './motion/MotionRuntime';
export type {
  MotionScope,
  EaseName,
  EaseFn,
  MotionBinding,
  MotionUpdateCallback,
  MotionCompleteCallback,
  MotionCancelCallback,
  MotionHandle,
  MotionTweenOptions,
  MotionDelayOptions,
  MotionSequenceStep,
  MotionSequenceOptions,
  MotionErrorPhase,
  MotionErrorContext,
  MotionErrorHandler,
  MotionRuntimeStats,
  MotionRuntimeOptions
} from './motion/types';
export { UiRuntime } from './ui/UiRuntime';
export { computeLayout } from './ui/layout';
export type {
  UiRuntimeOptions,
  UiRuntimeStats,
  UiMotionDriver,
  UiMotionTweenRequest,
  UiMotionHandle,
  UiScope,
  ButtonController,
  ButtonControllerOptions,
  ButtonState,
  ButtonCancelReason,
  ButtonPointerCancelReason,
  WindowController,
  WindowControllerOptions,
  WindowState,
  WindowTransitionPhase,
  WindowCloseReason,
  WindowHiddenReason,
  WindowCloseIntent,
  LayoutInput,
  LayoutResult,
  LayoutRect,
  LayoutInsets,
  LayoutOrientation,
  UiErrorContext,
  UiErrorHandler,
  UiErrorPhase,
  UiControllerKind
} from './ui/types';
export {
  OfferRuntime,
  offerByProduct,
  activeOffer,
  secondsLeft,
  pickAvailableOffer,
  isChainBlocked,
  clampOfferTimes,
  tickOffers,
  onOfferPurchased,
  DEFAULT_OFFER_CHAIN_TIMING,
  DEFAULT_WELCOME_TIMER_SEC,
  DEFAULT_TIER_TIMER_SEC,
  OFFER_HOUR_SEC,
  OFFER_DAY_SEC,
  validateOfferChainConfig,
  MemoryOfferStateStore,
  OFFER_STATE_KEYS,
  OFFER_WELCOME
} from './offers';
export type {
  OfferVariant,
  OfferReward,
  OfferDef,
  OfferChainConfig,
  OfferStateKey,
  OfferWelcomeState,
  OfferStateStore,
  OfferChainInput,
  OfferPriceGate,
  OfferEventType,
  OfferEvent,
  OfferEventHandler,
  OfferErrorPhase,
  OfferErrorContext,
  OfferErrorHandler,
  OfferRuntimeOptions,
  OfferRuntimeStats
} from './offers';
export { AnalyticsRuntime, AnalyticsTransportError, createHazarAnalyticsTransport, HAZAR_INGEST_ENDPOINTS, ANALYTICS_EVENTS } from './analytics';
export type {
  HazarAnalyticsTransportOptions,
  HazarFetchFn,
  HazarFetchInit,
  HazarFetchResponse,
  AnalyticsDevice,
  AnalyticsPlatform,
  AnalyticsValue,
  AnalyticsEventData,
  AnalyticsEnvelopeData,
  AnalyticsEnvelope,
  AnalyticsContext,
  AnalyticsContextProvider,
  AnalyticsTransport,
  AnalyticsQueueStore,
  AnalyticsErrorPhase,
  AnalyticsErrorContext,
  AnalyticsErrorHandler,
  AnalyticsRuntimeOptions,
  AnalyticsTrackOptions,
  AnalyticsRuntimeStats,
  AnalyticsEventName,
  AnalyticsInstallEvent,
  AnalyticsSessionEvent,
  AnalyticsLoadingStatus,
  AnalyticsLoadingEvent,
  AnalyticsTutorialEvent,
  AnalyticsLevelStatus,
  AnalyticsLevelEvent,
  AnalyticsUiClickEvent,
  AnalyticsAdType,
  AnalyticsAdStatus,
  AnalyticsAdvertisementEvent,
  AnalyticsEconomyAction,
  AnalyticsEconomyEvent,
  AnalyticsPurchaseStatus,
  AnalyticsPurchaseEvent,
  AnalyticsLivesRefillEvent
} from './analytics';
// composition-level wiring between runtimes (types only on both sides — no runtime coupling)
export { createOfferAnalyticsHandler, offerEventToAnalytics } from './composition/offerAnalytics';
export type { OfferAnalyticsSink, OfferAnalyticsRecord } from './composition/offerAnalytics';
