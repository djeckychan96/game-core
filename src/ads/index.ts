// AdsRuntime v0.7 + Ads Policy V1 — the renderer- and platform-independent ad decision layer (root entry `game-core`).
export { AdsRuntime } from './AdsRuntime';
export { parseAdsTsv, validateAdsConfig, ADS_DEFAULT_SEGMENT_ID, ADS_BANNER_PLACEMENT } from './config';
export { MemoryAdsStateStore, ADS_STATE_KEYS } from './state';
export type { AdsStateSnapshot } from './state';
export { resolveAdsPolicy, adsPolicyFromConfig, validateAdsPolicy, freezeAdsPolicy, ADS_POLICY_NEUTRAL } from './policy';
export type {
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
  AdsPolicyOverrides
} from './policy';
export { TRAIL_ARROW_AD_POLICY_V1, TRAIL_ARROW_AD_POLICY_V2, TRAIL_ARROW_ADS_CONFIG_V1 } from './presets';
export type {
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
} from './types';
