// Public entry `game-core/platform/cleverapps`. connector.latest.js remains a host-owned asset;
// this bundle contains only a structural adapter and never loads the vendor script.
export {
  CleverAppsPlatform,
  createCleverAppsPlatform,
  CLEVERAPPS_STORAGE_VERSION,
  CLEVERAPPS_TIMEOUTS
} from './CleverAppsPlatform';
export type {
  CleverAppsDiagnosticCode,
  CleverAppsPlatformOptions
} from './CleverAppsPlatform';
export { initCleverAppsConnector, waitForCleverAppsConnector } from './sdk';
export type {
  CleverAppsAdsApi,
  CleverAppsConnector,
  CleverAppsEventSource,
  CleverAppsInfo,
  CleverAppsPlatformApi,
  CleverAppsPlayer,
  CleverAppsSocial,
  CleverAppsStorageApi
} from './sdk';
export { AD_WATCHDOG_HARD_MS, AD_WATCHDOG_QUIET_MS, documentVisibility } from '../../support/adWatchdog';
export type { PlatformVisibility } from '../../support/adWatchdog';
export type { PlatformTimers } from '../../support/withTimeout';
