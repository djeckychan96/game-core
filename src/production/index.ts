// Production foundation V1 (root entry `game-core`): the Gameplay Contract V1 and the Game Production
// Profile V1 — types plus the profile validator. No runtime reads them yet.
export { validateGameProductionProfile, PROGRESSION_MODES, PRODUCTION_OWNERS } from './profile';
export type {
  ProductionOwner,
  ProgressionMode,
  ProductionProgressionProfile,
  ProductionUiProfile,
  LevelRewardPolicy,
  CoreSoftCurrencyProfile,
  GameplaySoftCurrencyProfile,
  SoftCurrencyProfile,
  ProductionEconomyProfile,
  ProductionAdsProfile,
  ProductionNoAdsProduct,
  ProductionCoinPack,
  ProductionMonetizationProfile,
  ProductionPlatformProfile,
  ProductionSaveProfile,
  GameProductionProfile
} from './profile';
export type {
  GameplayMetricValue,
  GameplayMetrics,
  GameplayLevelRef,
  GameplayLevelStart,
  GameplayLevelResult,
  GameplayLevelExit,
  GameplayEvents,
  GameplayLevelProgress,
  GameplayProgress,
  GameplayPauseReason,
  GameplayCommands,
  GameplayFrameOwner,
  GameplayInputMode,
  GameplayIntegrationModes,
  GameplayInputQueries,
  GameplayContract
} from './contract';
