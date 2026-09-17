// AdsRuntime v0.7 — the renderer- and platform-independent ad decision layer (root entry `game-core`).
export { AdsRuntime } from './AdsRuntime';
export { parseAdsTsv, validateAdsConfig, ADS_DEFAULT_SEGMENT_ID, ADS_BANNER_PLACEMENT } from './config';
export { MemoryAdsStateStore, ADS_STATE_KEYS } from './state';
export type { AdsStateSnapshot } from './state';
export type {
  AdPlacementType,
  AdPayerClass,
  AdSegment,
  AdPlacementRule,
  AdPlacement,
  AdsConfig,
  AdsDenyReason,
  AdsDecision,
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
  AdsRuntimeStats
} from './types';
