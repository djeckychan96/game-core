// The CLIENT-SAFE per-platform config shape. Types and a validator only: resolving a target,
// reading the build env and turning `jwtRef` into a token are the game's build, not Core.
import { PLATFORM_CODES } from './types';
import type { PlatformCode } from './types';

/** Which adapter family serves the target: Yandex has its own SDK, FB / SAM / MSS / VK / OK ride the CleverApps connector. */
export type PlatformProvider = 'yandex' | 'cleverapps' | 'dev';

export const PLATFORM_PROVIDERS: readonly PlatformProvider[] = ['yandex', 'cleverapps', 'dev'];

export interface PlatformAnalyticsConfig {
  /** The Hazar ingest URL of THIS target (`.ru` for YA / VK / OK, `.com` for FB / SAM / MSS). */
  endpoint: string;
  /**
   * The NAME under which the game's build keeps this target's ingest JWT (`"YA"` →
   * `VITE_HAZAR_JWT_YA`). Never the token: a JWT value has no field in this config.
   */
  jwtRef: string;
}

/** Public references to the platform-side project — what the connector script is started with. */
export interface PlatformConnectorConfig {
  /** CleverApps `projectId` (the donor: `twinarrow`). */
  projectId: string;
  /** Connector `source`; omitted = the connector detects it (FB: by the `apps.fbsbx.com` domain). */
  source?: string;
  /** The client config file the build ships for this target (`configs/cleverapps-fb.js`). */
  clientConfig?: string;
}

export interface PlatformTargetConfig {
  provider: PlatformProvider;
  /** Must equal the key it is stored under. */
  platformCode: PlatformCode;
  /** Omitted = no Hazar transport for this target (DEV: console / no-op). */
  analytics?: PlatformAnalyticsConfig;
  connector?: PlatformConnectorConfig;
  /** PUBLIC ids only: app id, ad placement ids, store app id. They ship in every client bundle anyway. */
  publicIds?: Record<string, string>;
}

/**
 * Everything here ends up in the client bundle, so nothing here may be a server secret: the types
 * have no field for one (`instant.appSecret`, `msstart.publicKey` and the like stay in the private
 * file outside the repository) and `validateGamePlatformConfig` refuses one smuggled in by name.
 */
export interface GamePlatformConfig {
  /** Hazar app id — one per game. */
  app: string;
  platforms: Partial<Record<PlatformCode, PlatformTargetConfig>>;
}

// `publicKey` is on the list on purpose: production's `msstart.publicKey` is a SERVER-side value
const SECRET_KEY = /secret|private[_-]?key|service[_-]?key|public[_-]?key|password|passwd|credential|signature|^jwt$|^token$|^api[_-]?key$/i;
const JWT_VALUE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/;
const REF_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function scanForSecrets(value: unknown, path: string, fail: (message: string) => never): void {
  if (typeof value === 'string') {
    if (JWT_VALUE.test(value)) fail(`${path} holds something that looks like a JWT — keep the token in the build env and reference it by jwtRef`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail(`${path}.${key} is a server-secret field — it must never reach a client config`);
    scanForSecrets(child, `${path}.${key}`, fail);
  }
}

/** Throws a RangeError naming the first problem. */
export function validateGamePlatformConfig(config: GamePlatformConfig): void {
  const fail = (message: string): never => {
    throw new RangeError(`validateGamePlatformConfig: ${message}`);
  };
  if (!config || typeof config !== 'object') fail('config is required');
  scanForSecrets(config, 'config', fail);
  if (typeof config.app !== 'string' || config.app === '') fail('app must be a non-empty string');
  const { platforms } = config;
  if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) fail('platforms must not be empty');
  for (const [code, target] of Object.entries(platforms)) {
    const at = `platforms.${code}`;
    if (!(PLATFORM_CODES as readonly string[]).includes(code)) fail(`${at}: unknown platform code`);
    if (!target || typeof target !== 'object') fail(`${at} must be an object`);
    if (target.platformCode !== code) fail(`${at}.platformCode must be "${code}"`);
    if (!PLATFORM_PROVIDERS.includes(target.provider)) fail(`${at}.provider must be one of ${PLATFORM_PROVIDERS.join(' / ')}`);
    if (target.provider === 'dev' && code !== 'DEV') fail(`${at}: the dev provider never serves a production code`);
    if (target.provider === 'yandex' && code !== 'YA' && code !== 'DEV') fail(`${at}: the yandex provider serves YA (or a DEV stand) only`);
    const { analytics, connector, publicIds } = target;
    if (analytics !== undefined) {
      if (!analytics || typeof analytics.endpoint !== 'string' || !/^https:\/\/\S+$/.test(analytics.endpoint)) fail(`${at}.analytics.endpoint must be an https URL`);
      if (typeof analytics.jwtRef !== 'string' || !REF_NAME.test(analytics.jwtRef)) fail(`${at}.analytics.jwtRef must be a reference name, not a token`);
    }
    if (target.provider === 'cleverapps' && (!connector || typeof connector.projectId !== 'string' || connector.projectId === '')) {
      fail(`${at}.connector.projectId is required for the cleverapps provider`);
    }
    if (publicIds !== undefined) {
      if (!publicIds || typeof publicIds !== 'object') fail(`${at}.publicIds must be an object`);
      for (const [name, id] of Object.entries(publicIds)) if (typeof id !== 'string') fail(`${at}.publicIds.${name} must be a string`);
    }
  }
}
