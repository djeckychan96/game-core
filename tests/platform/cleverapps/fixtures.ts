import { createCleverAppsPlatform } from '../../../src/platform/adapters/cleverapps';
import type {
  CleverAppsConnector,
  CleverAppsPlatform,
  CleverAppsPlatformOptions
} from '../../../src/platform/adapters/cleverapps';

export type FakeMode = 'ok' | 'false' | 'fail' | 'hang';

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** A scriptable structural Connector double. It never loads a vendor script or performs a request. */
export class FakeConnector {
  readonly calls: string[] = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly cloud: Record<string, unknown> = {};

  initMode: Exclude<FakeMode, 'false'> = 'ok';
  playerReadyMode: Exclude<FakeMode, 'false'> = 'ok';
  storageReadyMode: Exclude<FakeMode, 'false'> = 'ok';
  loadMode: FakeMode = 'ok';
  invalidKeyList = false;
  setModes: FakeMode[] = [];
  loggedIn = true;
  userId = 'fb-player-1';
  playerName = 'Ada Player';
  language = 'en_US';
  isMobile: boolean | undefined = true;
  os: string | undefined = 'iOS';
  nativeLoading = true;
  startGameMode: Exclude<FakeMode, 'false'> = 'ok';
  rewardedSupported = true;
  rewardedAvailable = true;
  interstitialSupported = true;
  interstitialAvailable = true;
  rewardedShowMode: FakeMode = 'ok';
  interstitialShowMode: FakeMode = 'ok';

  constructor() {
    for (const value of [this.connector.info, this.connector.player, this.connector.platform, this.connector.storage, this.connector.ads]) {
      if (value) owners.set(value, this);
    }
  }

  private external<T>(mode: FakeMode, value: T, error: string): Promise<T> {
    if (mode === 'hang') return never();
    if (mode === 'fail') return Promise.reject(new Error(error));
    if (mode === 'false') return Promise.resolve(false as T);
    return Promise.resolve(value);
  }

  readonly connector: CleverAppsConnector = {
    info: {
      get language() {
        return fakeFor(this).language;
      },
      get isMobile() {
        return fakeFor(this).isMobile;
      },
      get os() {
        return fakeFor(this).os;
      },
      source: 'instant'
    },
    player: {
      get ready() {
        const fake = fakeFor(this);
        fake.calls.push('player.ready');
        return fake.external(fake.playerReadyMode, undefined, 'player_down');
      },
      get id() {
        return fakeFor(this).userId;
      },
      get name() {
        return fakeFor(this).playerName;
      }
    },
    social: {
      isLoggedIn: () => {
        this.calls.push('social.isLoggedIn');
        return this.loggedIn;
      }
    },
    platform: {
      get hasNativeLoadingScreen() {
        return fakeFor(this).nativeLoading;
      },
      getUserID: () => {
        this.calls.push('platform.getUserID');
        return this.userId;
      },
      reportLoadingProgress: (progress) => void this.calls.push(`loading:${progress}`),
      startGame: () => {
        this.calls.push('platform.startGame');
        return this.external(this.startGameMode, undefined, 'start_game_down');
      }
    },
    storage: {
      isSupported: true,
      get ready() {
        const fake = fakeFor(this);
        fake.calls.push('storage.ready');
        return fake.external(fake.storageReadyMode, undefined, 'storage_ready_down');
      },
      load: () => {
        this.calls.push('storage.load');
        return this.external(this.loadMode, true, 'storage_load_down');
      },
      get: (key) => {
        this.calls.push(`storage.get:${key}`);
        return this.cloud[key];
      },
      getKeys: () => {
        this.calls.push('storage.getKeys');
        if (this.invalidKeyList) return null as unknown as readonly string[];
        return Object.keys(this.cloud);
      },
      set: (key, value) => {
        this.calls.push(`storage.set:${key}`);
        const mode = this.setModes.shift() ?? 'ok';
        return this.external(mode, true, 'storage_set_down').then((ok) => {
          if (ok) this.cloud[key] = value;
          return ok;
        });
      }
    },
    ads: {
      get isRewardedSupported() {
        return fakeFor(this).rewardedSupported;
      },
      get isRewardedAvailable() {
        return fakeFor(this).rewardedAvailable;
      },
      get isInterstitialSupported() {
        return fakeFor(this).interstitialSupported;
      },
      get isInterstitialAvailable() {
        return fakeFor(this).interstitialAvailable;
      },
      showRewardedVideo: () => {
        this.calls.push('ads.showRewardedVideo');
        return this.external(this.rewardedShowMode, true, 'rewarded_down');
      },
      showInterstitial: () => {
        this.calls.push('ads.showInterstitial');
        return this.external(this.interstitialShowMode, true, 'interstitial_down');
      },
      on: (event, listener) => {
        this.calls.push(`ads.on:${event}`);
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(listener);
      },
      off: (event, listener) => {
        this.calls.push(`ads.off:${event}`);
        this.listeners.get(event)?.delete(listener);
      }
    }
  };

  readonly init = (): Promise<CleverAppsConnector> => {
    this.calls.push('init');
    return this.external(this.initMode, this.connector, 'init_down');
  };

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  count(prefix: string): number {
    return this.calls.filter((call) => call.startsWith(prefix)).length;
  }
}

// Accessor objects above deliberately mirror SDK property getters. This binding maps each nested
// object back to its owning fake without weakening the production structural types.
const owners = new WeakMap<object, FakeConnector>();
function fakeFor(value: object): FakeConnector {
  const owner = owners.get(value);
  if (!owner) throw new Error('fake_owner_missing');
  return owner;
}

export interface CleverAppsHarness {
  fake: FakeConnector;
  platform: CleverAppsPlatform;
  diagnostics: string[];
}

export function makeCleverApps(setup: (fake: FakeConnector) => void = () => {}, options: Partial<CleverAppsPlatformOptions> = {}): CleverAppsHarness {
  const fake = new FakeConnector();
  setup(fake);
  const diagnostics: string[] = [];
  const platform = createCleverAppsPlatform({ init: fake.init, onDiagnostic: (code) => diagnostics.push(code), ...options });
  return { fake, platform, diagnostics };
}

export async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}
