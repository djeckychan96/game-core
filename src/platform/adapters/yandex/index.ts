// Public entry `game-core/platform/yandex` — the production Yandex Games platform (v0.8-B1).
// Built as its own bundle: the root entry `game-core` never names the SDK, this one may. It knows
// the root only as TYPES (the capability contract, PurchaseRuntime's `PaymentsAdapter`), so no root
// runtime code is duplicated here:
//
//   import { PlatformRuntime } from 'game-core';
//   import { createYandexPlatform } from 'game-core/platform/yandex';
//   const platform = new PlatformRuntime(createYandexPlatform({ hooks, onPlayer, onDiagnostic }));
export {
  YandexPlatform,
  createYandexPlatform,
  YANDEX_TIMEOUTS,
  YANDEX_PLAYER_RETRY_ATTEMPTS,
  YANDEX_READ_ATTEMPTS,
  YANDEX_LAUNCH_PAYLOAD_MAX,
  YANDEX_NO_PLAYER
} from './YandexPlatform';
export type { YandexPlatformOptions, YandexAdHooks, YandexDiagnosticCode } from './YandexPlatform';
export { initYandexSdk, waitForYandexScript } from './sdk';
export type {
  YandexSdk,
  YandexPlayer,
  YandexPaymentsApi,
  YandexPurchase,
  YandexCatalogProduct,
  YandexFullscreenAdCallbacks,
  YandexRewardedAdCallbacks
} from './sdk';
export { documentVisibility, AD_WATCHDOG_QUIET_MS, AD_WATCHDOG_HARD_MS } from '../../support/adWatchdog';
export type { PlatformVisibility } from '../../support/adWatchdog';
export type { PlatformTimers } from '../../support/withTimeout';
