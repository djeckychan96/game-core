// Composition-level seam: Platform Layer → AnalyticsRuntime's context. Types only on both sides.
// The platform GIVES four facts — the Hazar `p` code of the explicit build target, the player id,
// its own knowledge of the device, the language — and owns nothing else: `app`, `installedAt`,
// the `platformOs` fallback, the versions, A/B and `baseData` stay with the host, and so does the
// JWT (a build-env value behind `jwtRef`, never seen by Core).
//
//   context: createPlatformAnalyticsContext(platform, ({ playerId, language }) => ({
//     app: 'twin_arrow', appVersion, buildVersion, installedAt, platformOs,
//     profileId: sessionProfileId ?? playerId ?? localUuid,   // the HOST decides — see below
//     device: uaDevice,                                       // the fallback; the platform's word wins
//     baseData: { ...gameBaseData, lang: language }
//   }))
//
// `profileId` is deliberately NOT taken from the platform here: a guest whose id arrives mid-session
// would split one player in two (the donor's 17.08 doubling fix pins the id per session and sends
// `identity_link`) — that policy knows the game, so the host applies it with `fields.playerId`.
import type { AnalyticsContext, AnalyticsContextProvider } from '../analytics/types';
import type { PlatformCode, PlatformDeviceType, PlatformEnvironment, PlatformIdentity } from '../platform/types';

/** What the seam reads — `PlatformRuntime` and any `GamePlatform` satisfy it. */
export interface PlatformAnalyticsSource {
  identity: Pick<PlatformIdentity, 'playerId'>;
  environment: Pick<PlatformEnvironment, 'platformCode' | 'language' | 'deviceType'>;
}

export interface PlatformAnalyticsFields {
  platform: PlatformCode;
  /** null for a guest (an empty id reads as null too). */
  playerId: string | null;
  /** null = the platform does not know; the host's detection stands. */
  device: PlatformDeviceType | null;
  language: string;
}

/** The host's share of the context: everything but `platform`; its `device` is the fallback. */
export type PlatformAnalyticsHostContext = Omit<AnalyticsContext, 'platform'>;

export function readPlatformAnalyticsFields(source: PlatformAnalyticsSource): PlatformAnalyticsFields {
  const playerId = source.identity.playerId();
  return {
    platform: source.environment.platformCode(),
    playerId: typeof playerId === 'string' && playerId !== '' ? playerId : null,
    device: source.environment.deviceType(),
    language: source.environment.language()
  };
}

/**
 * An `AnalyticsRuntime` context provider: read on every `track`, so `p` always is the platform's
 * code (the production bug class "an FB build reporting under the YA project" has no host line to
 * get wrong) and a late platform answer is picked up by the next event.
 */
export function createPlatformAnalyticsContext(
  source: PlatformAnalyticsSource,
  host: (fields: PlatformAnalyticsFields) => PlatformAnalyticsHostContext
): AnalyticsContextProvider {
  return () => {
    const fields = readPlatformAnalyticsFields(source);
    const context = host(fields);
    return { ...context, platform: fields.platform, device: fields.device ?? context.device };
  };
}
