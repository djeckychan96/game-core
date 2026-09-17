// Platform Layer v0.8 — the capability-based platform contract (root entry `game-core`). Slice A:
// the contract, the facade, the catalog, the client-safe config shape and the DEV platform. The
// Yandex / CleverApps adapters plug into the same `GamePlatform` in the next slice.
export { PlatformRuntime } from './PlatformRuntime';
export type { PlatformRuntimeOptions } from './PlatformRuntime';
export { PlatformCatalog, normalizePlatformProducts } from './catalog';
export type {
  PlatformCatalogSource,
  PlatformCatalogOptions,
  PlatformCatalogErrorPhase,
  PlatformCatalogErrorHandler,
  PlatformCatalogRefreshStatus,
  PlatformCatalogRefresh
} from './catalog';
export { validateGamePlatformConfig, PLATFORM_PROVIDERS } from './config';
export type {
  PlatformProvider,
  PlatformAnalyticsConfig,
  PlatformConnectorConfig,
  PlatformTargetConfig,
  GamePlatformConfig
} from './config';
export { createDevPlatform } from './adapters/dev';
export type {
  DevKeyValueStore,
  DevAdType,
  DevPurchaseOutcome,
  DevPlatformOptions,
  DevPlatformState,
  DevPlatformControl,
  DevPlatform
} from './adapters/dev';
export { PLATFORM_CODES } from './types';
export type {
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
} from './types';
