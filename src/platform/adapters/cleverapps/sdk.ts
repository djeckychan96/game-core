// The documented part of connector.latest.js used by this adapter. These are structural types:
// the vendor script belongs to the host build and is never imported or bundled by Game Core.

export interface CleverAppsEventSource {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface CleverAppsInfo {
  source?: string | undefined;
  language?: string | undefined;
  isMobile?: boolean | undefined;
  os?: string | undefined;
}

export interface CleverAppsPlayer extends Partial<CleverAppsEventSource> {
  ready?: PromiseLike<unknown>;
  id?: string;
  name?: string;
}

export interface CleverAppsSocial extends Partial<CleverAppsEventSource> {
  /** The documented signal that separates an authenticated player from a temporary guest id. */
  isLoggedIn?(): boolean;
}

export interface CleverAppsPlatformApi extends Partial<CleverAppsEventSource> {
  hasNativeLoadingScreen?: boolean;
  getUserID?(): string;
  reportLoadingProgress?(percent: number): void;
  startGame?(): PromiseLike<unknown>;
  notifyGameReady?(): void;
  gameplayStart?(): void;
  gameplayStop?(): void;
}

export interface CleverAppsStorageApi extends Partial<CleverAppsEventSource> {
  ready?: PromiseLike<unknown>;
  isSupported?: boolean;
  load(): PromiseLike<boolean>;
  get(key: string): unknown;
  getKeys(): readonly string[];
  set(key: string, value: object): PromiseLike<boolean>;
}

export interface CleverAppsAdsApi extends CleverAppsEventSource {
  isRewardedSupported?: boolean;
  isRewardedAvailable?: boolean;
  isInterstitialSupported?: boolean;
  isInterstitialAvailable?: boolean;
  showRewardedVideo(): PromiseLike<boolean>;
  showInterstitial(): PromiseLike<boolean>;
}

export interface CleverAppsConnector {
  info?: CleverAppsInfo;
  player?: CleverAppsPlayer;
  social?: CleverAppsSocial;
  platform: CleverAppsPlatformApi;
  storage: CleverAppsStorageApi;
  ads: CleverAppsAdsApi;
}

interface CleverAppsGlobals {
  connector?: CleverAppsConnector;
  onConnectorInit?: () => unknown;
}

function currentConnector(): CleverAppsConnector | null {
  const candidate = (globalThis as unknown as CleverAppsGlobals).connector;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

/**
 * Host-loader seam from the Connector documentation. A connector already present resolves at once;
 * otherwise the adapter chains the host's existing onConnectorInit callback and waits for it.
 */
export function waitForCleverAppsConnector(): Promise<CleverAppsConnector> {
  const ready = currentConnector();
  if (ready) return Promise.resolve(ready);
  const globals = globalThis as unknown as CleverAppsGlobals;
  const previous = globals.onConnectorInit;
  return new Promise<CleverAppsConnector>((resolve, reject) => {
    const listener = (): void => {
      if (globals.onConnectorInit === listener) {
        if (previous) globals.onConnectorInit = previous;
        else delete globals.onConnectorInit;
      }
      try {
        previous?.();
      } catch {
        // The host callback is independent from adapter readiness.
      }
      const connector = currentConnector();
      if (connector) resolve(connector);
      else reject(new Error('cleverapps_connector_missing'));
    };
    globals.onConnectorInit = listener;
  });
}

/** The production default. This is the only Game Core file that names Connector globals. */
export function initCleverAppsConnector(): Promise<CleverAppsConnector> {
  return waitForCleverAppsConnector();
}
