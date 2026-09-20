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
export { PurchaseRuntime, createGrantedPurchaseStore, DEFAULT_GRANTED_PURCHASE_CAP } from './purchases';
export type {
  GrantedPurchaseStoreOptions,
  MemoryGrantedPurchaseStore,
  PlatformPurchase,
  PlatformPurchaseStatus,
  PlatformPurchaseResult,
  RestoreGrantPolicy,
  PurchaseProductKind,
  PaymentsAdapter,
  GrantedPurchaseStore,
  PurchaseGrantContext,
  PurchaseErrorReason,
  PurchaseEvent,
  PurchaseEventType,
  PurchaseEventHandler,
  PurchaseErrorPhase,
  PurchaseErrorContext,
  PurchaseCallbackErrorHandler,
  PurchaseRuntimeOptions,
  PurchaseStatus,
  PurchaseResult,
  RestoredPurchase,
  RestoreResult,
  PurchasePending,
  PurchaseRuntimeStats
} from './purchases';
export {
  AdsRuntime, parseAdsTsv, validateAdsConfig, MemoryAdsStateStore, ADS_STATE_KEYS, ADS_DEFAULT_SEGMENT_ID, ADS_BANNER_PLACEMENT,
  resolveAdsPolicy, adsPolicyFromConfig, validateAdsPolicy, freezeAdsPolicy, ADS_POLICY_NEUTRAL, TRAIL_ARROW_AD_POLICY_V1, TRAIL_ARROW_AD_POLICY_V2, TRAIL_ARROW_ADS_CONFIG_V1
} from './ads';
export type {
  AdsStateSnapshot,
  AdsPlacementId,
  AdsCadence,
  AdsInterstitialPlacementPolicy,
  AdsRewardedPlacementPolicy,
  AdsBannerPlacementPolicy,
  AdsInterstitialPolicy,
  AdsRewardedPolicy,
  AdsBannerPolicy,
  AdsNoAdsPolicy,
  AdsNoAdsOfferPolicy,
  AdsRequestTimeouts,
  AdsSessionPolicy,
  AdsPolicy,
  AdsPolicyOverrides,
  AdPlacementType,
  AdPayerClass,
  AdSegment,
  AdPlacementRule,
  AdPlacement,
  AdsConfig,
  AdsDenyReason,
  AdsDecision,
  AdsDecisionSource,
  AdsPolicyDecision,
  AdsStateKey,
  AdsCount,
  AdsStateStore,
  AdsInput,
  AdsEvent,
  AdsEventType,
  AdsEventHandler,
  AdsErrorPhase,
  AdsErrorContext,
  AdsErrorHandler,
  AdsRuntimeOptions,
  AdsRuntimeStats,
  AdsSessionStats
} from './ads';
export { PlatformRuntime, PlatformCatalog, normalizePlatformProducts, validateGamePlatformConfig, createDevPlatform, PLATFORM_CODES, PLATFORM_PROVIDERS } from './platform';
export type {
  PlatformRuntimeOptions,
  PlatformCatalogSource,
  PlatformCatalogOptions,
  PlatformCatalogErrorPhase,
  PlatformCatalogErrorHandler,
  PlatformCatalogRefreshStatus,
  PlatformCatalogRefresh,
  PlatformProvider,
  PlatformAnalyticsConfig,
  PlatformConnectorConfig,
  PlatformTargetConfig,
  GamePlatformConfig,
  DevKeyValueStore,
  DevAdType,
  DevPurchaseOutcome,
  DevPlatformOptions,
  DevPlatformState,
  DevPlatformControl,
  DevPlatform,
  PlatformCode,
  PlatformDeviceType,
  PlatformIdentity,
  PlatformEnvironment,
  PlatformStorage,
  PlatformGameplay,
  PlatformAdStatus,
  PlatformAdResult,
  PlatformAds,
  PlatformProduct,
  PlatformPayments,
  PlatformLifecycle,
  GamePlatform,
  PlatformCapability,
  PlatformCapabilities
} from './platform';
// composition-level wiring between runtimes (types only on both sides — no runtime coupling)
export { createOfferAnalyticsHandler, offerEventToAnalytics } from './composition/offerAnalytics';
export type { OfferAnalyticsSink, OfferAnalyticsRecord } from './composition/offerAnalytics';
export { createPurchaseAnalyticsHandler, purchaseEventToAnalytics } from './composition/purchaseAnalytics';
export type { PurchaseAnalyticsSink, PurchaseAnalyticsRecord, PurchasePrice, PurchasePriceResolver } from './composition/purchaseAnalytics';
export { createAdsAnalyticsHandler, adsEventToAnalytics } from './composition/adsAnalytics';
export type { AdsAnalyticsSink, AdsAnalyticsRecord } from './composition/adsAnalytics';
export { createPurchaseAdsHandler, isConfirmedPayment } from './composition/purchaseAds';
export type { PurchaseAdsSink } from './composition/purchaseAds';
export { createPlatformAnalyticsContext, readPlatformAnalyticsFields } from './composition/platformAnalytics';
export type { PlatformAnalyticsSource, PlatformAnalyticsFields, PlatformAnalyticsHostContext } from './composition/platformAnalytics';
