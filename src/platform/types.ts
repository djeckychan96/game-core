// Platform Layer v0.8 — types. What a game needs from the platform it runs on (Yandex Games, the
// CleverApps connector with FB / Samsung / MSN / VK / OK under it, a DEV stand), as independent
// CAPABILITIES instead of one giant adapter. The shapes come from the production audit of Trail
// Arrow 0.1.22 (`platform/{yandex,cleverapps,localhost}/systems/HttpRequestSystem.ts`): every call
// answers the caller with its own Promise — never a broadcast by opcode. Nothing here knows an SDK,
// the DOM, a storage or a clock; the adapters that do are a separate slice.
import type { PaymentsAdapter } from '../purchases/types';

/** Hazar platform codes of the production targets; assignable to `AnalyticsPlatform`. */
export type PlatformCode = 'YA' | 'FB' | 'SAM' | 'MSS' | 'VK' | 'OK' | 'AN' | 'DEV';

export const PLATFORM_CODES: readonly PlatformCode[] = ['YA', 'FB', 'SAM', 'MSS', 'VK', 'OK', 'AN', 'DEV'];

/** Same values as `AnalyticsDevice` — re-declared, the platform layer imports no runtime. */
export type PlatformDeviceType = 'mobile' | 'tablet' | 'desktop';

/** Who is playing. No social / friends / avatar API: production uses none of it. */
export interface PlatformIdentity {
  /**
   * Resolves when the game may go on — NOT "the player is authorized": a guest resolves too
   * (Yandex: `getPlayer` failed → guest mode, the id arrives later or never).
   */
  ready(): Promise<void>;
  /** The platform's player id; null for a guest / while unknown (an adapter maps `""` to null). Read live. */
  playerId(): string | null;
  /** The platform's name of the player, `""` when there is none. Trimming it for the HUD is the game's business. */
  displayName(): string;
}

/** Where the game runs. Everything is synchronous and read live after `identity.ready()`. */
export interface PlatformEnvironment {
  /** The EXPLICIT build target. Never detected inside Core. */
  platformCode(): PlatformCode;
  /** The platform account's language as the platform gives it (`"ru"`, `"en_US"`). */
  language(): string;
  /** The platform's own knowledge of the device (Yandex `deviceInfo.type`); null = it has none, the host's UA detection stands. */
  deviceType(): PlatformDeviceType | null;
  /** Same rule: null = the host's fallback stands. No production platform reports it today. */
  platformOs(): string | null;
  /** What the game was launched with (Yandex `environment.payload`), `""` when nothing. */
  launchPayload(): string;
  /** The platform's clock, unix SECONDS; null = the platform has none (every CleverApps target) and the host anchors its own. */
  serverTime(): number | null;
}

/**
 * The player's save, by keys. Core only moves data: the local mirror, the rollback guard and
 * `save_seq` know the game's model and stay in the host.
 */
export interface PlatformStorage {
  /** True when the data lives on the platform's servers; false = this device only. */
  isCloud(): boolean;
  ready(): Promise<void>;
  /**
   * The stored values of `keys`; a key that was never written is absent from the answer.
   * A read that FAILED must REJECT — never answer `{}` / null for it: the game would take the
   * failure for a new player and overwrite the cloud save (both production save-loss incidents).
   */
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  /**
   * Writes the patch (a PATCH: keys it does not name stay as they are). True = CONFIRMED: a write that
   * carried this call's patch succeeded on the platform — never "queued" or "accepted locally". An adapter
   * that batches calls answers each by the batch that carried it; when a later call overwrote one of its
   * keys inside that batch, true means the confirmed value is not older than this call's. False = this
   * call got no such confirmation (refused, failed, timed out, or the batch it waited for never ran); the
   * adapter may keep the patch for a later write, but this call's answer never turns true afterwards.
   * A rejection reads as false.
   */
  set(patch: Record<string, unknown>): Promise<boolean>;
  /** Removes the keys (the donor's `user.reset`). Resolves on the same confirmation as `set`, rejects without it. */
  clear(keys: readonly string[]): Promise<void>;
}

/** The platform's loading / gameplay markers. Safe no-ops where the platform has none. */
export interface PlatformGameplay {
  /** Percent, 0–100 — for a platform with a native loading screen (CleverApps 10 / 50 / 100). */
  reportLoadingProgress(progress: number): void;
  /** The game is loaded and interactive (Yandex `LoadingAPI.ready`, CleverApps `startGame` + `notifyGameReady`). */
  ready(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * How one ad show ended:
 * - `shown` — an interstitial really played;
 * - `rewarded` — a rewarded ad played AND the platform confirmed the reward;
 * - `dismissed` — the player closed a rewarded ad before the reward;
 * - `no_fill` — nothing to show (no ad, offline, the platform said "not available");
 * - `timeout` — the adapter's watchdog gave up on the SDK;
 * - `error` — the SDK threw.
 */
export type PlatformAdStatus = 'shown' | 'rewarded' | 'dismissed' | 'no_fill' | 'timeout' | 'error';

export interface PlatformAdResult {
  status: PlatformAdStatus;
  /** The ONLY thing a game grants a reward on. True exactly when `status === 'rewarded'`. */
  rewarded: boolean;
  placement: string;
  /** The SDK's own answer / error, for diagnostics. */
  raw?: unknown;
}

/**
 * Showing ads. WHETHER a placement may show is `AdsRuntime`'s decision, made before the call;
 * after it the host registers the show: `shown` → `ads.registerShown(placement)` for an
 * interstitial, `rewarded === true` → grant + `registerShown` for a rewarded. Both methods always
 * resolve — a failure is a status, never a rejection. Timeouts, the ad watchdog, sound pause and
 * gameplay stop / start around the ad are the adapter's.
 */
export interface PlatformAds {
  showInterstitial(placement: string): Promise<PlatformAdResult>;
  showRewarded(placement: string): Promise<PlatformAdResult>;
  /** False = hide the rewarded button. A platform without the knowledge answers true ("let them try"). */
  isRewardedAvailable(): boolean;
  /** Only where the platform has a banner (CleverApps targets); the placement comes from the platform's own config. */
  showBanner?(): Promise<boolean>;
  hideBanner?(): Promise<void>;
}

/** One product of the platform's catalog, normalized: the price is the platform's READY string (`"149 ₽"`, `"$2.99"`). */
export interface PlatformProduct {
  id: string;
  priceText: string;
  /** ISO-ish code as the platform gives it (`"RUB"`, `"USD"`, Yandex `"YAN"`); `""` when unknown. */
  currency: string;
}

/**
 * Payments = PurchaseRuntime's `PaymentsAdapter` (purchase / restore / consume / `restoreGrant`,
 * unchanged — hand `platform.payments` straight to `new PurchaseRuntime({ payments })`) plus the
 * catalog, the one thing v0.6 lacks.
 */
export interface PlatformPayments extends PaymentsAdapter {
  /**
   * The catalog as it is NOW. `[]` = the platform has none yet (products not applied, connector
   * still loading) — the host asks again on its own schedule. Rejects when the read failed.
   */
  getCatalog(): Promise<readonly PlatformProduct[]>;
}

/** Install-to-home-screen, the only social-ish feature production uses. */
export interface PlatformLifecycle {
  canCreateShortcut(): Promise<boolean>;
  createShortcut(): Promise<boolean>;
}

/**
 * A platform = the capabilities it really has. The first four are required; a missing optional
 * one means "this platform cannot" (Yandex has no banner and no shortcut, MSN no payments) — the
 * host checks for it, Core never substitutes a stub that pretends.
 */
export interface GamePlatform {
  identity: PlatformIdentity;
  environment: PlatformEnvironment;
  storage: PlatformStorage;
  gameplay: PlatformGameplay;
  ads?: PlatformAds;
  payments?: PlatformPayments;
  lifecycle?: PlatformLifecycle;
}

export type PlatformCapability = keyof GamePlatform;

export interface PlatformCapabilities {
  ads: boolean;
  banner: boolean;
  payments: boolean;
  lifecycle: boolean;
  cloudStorage: boolean;
}
