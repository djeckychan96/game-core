// QA Panel V1 — types. A QA / automation capability of a QA BUILD of a game: never part of the root entry,
// never installed by itself (the host imports `game-core/qa` behind its own build-time flag and calls
// `installGameCoreQA`). Everything a command answers or the state reports is JSON — an automation reads it
// with `page.evaluate`, never by parsing the panel's text.
import type { GameCoreBuildInfo } from '../buildInfo';
import type { SaveGateSnapshot } from '../save/SaveGate';
import type { SoftCurrencyWalletSnapshot } from '../economy/SoftCurrencyWallet';
import type { LivesSnapshot } from '../lives/LivesRuntime';
import type { ContinueOfferSnapshot } from '../continue/ContinueOfferRuntime';
import type { PlatformEnvironment } from '../platform/types';
import type { NetworkFaultProfile } from './NetworkFaultProfile';

export type QaJson = null | boolean | number | string | QaJson[] | { [key: string]: QaJson };
/** Command parameters, as an automation passes them (`run('coins.set', { value: 100 })`). */
export type QaParams = Readonly<Record<string, unknown>>;

interface QaCapabilityBase {
  /** Stable id: `[a-z][A-Za-z0-9_-]*` segments joined by `.` — `coins`, `level`, `debug.win`. Reserved prefixes: `reset`, `network`, `timeScale`, `panel`. */
  id: string;
  label: string;
  /** One line under the label in the panel. */
  hint?: string;
}

/** A number the game owns (coins, lives, boosters, a consumable). Command `<id>.set` `{ value: number }`. */
export interface QaNumberCapability extends QaCapabilityBase {
  kind: 'number';
  /** null = the game does not know it now. */
  get(): number | null;
  set(value: number): unknown;
  min?: number;
  max?: number;
  /** The panel's −/+ step (default 1). */
  step?: number;
  /** Only integers are accepted (default true). */
  integer?: boolean;
}

export interface QaSelectOption {
  value: string;
  label?: string;
}

/** One of a list the game owns (the level). Command `<id>.set` `{ value: string | number }` (a number is taken as its decimal string). */
export interface QaSelectCapability extends QaCapabilityBase {
  kind: 'select';
  options(): ReadonlyArray<QaSelectOption | string>;
  get(): string | null;
  set(value: string): unknown;
}

/** An on/off switch the game owns. Command `<id>.set` `{ value: boolean }`. */
export interface QaToggleCapability extends QaCapabilityBase {
  kind: 'toggle';
  get(): boolean;
  set(value: boolean): unknown;
}

/** A one-shot game command. Command `<id>` with the caller's params passed through. */
export interface QaActionCapability extends QaCapabilityBase {
  kind: 'action';
  run(params: QaParams): unknown;
  /** Needs `{ confirm: true }` — the panel asks for a second tap, an automation passes it. */
  destructive?: boolean;
}

export type QaCapability = QaNumberCapability | QaSelectCapability | QaToggleCapability | QaActionCapability;
export type QaCapabilityKind = QaCapability['kind'];

/** The three standard resets. Core only shows them and asks for the confirmation — the host's callback does the reset. */
export type QaResetKind = 'all' | 'gameplay' | 'core';

/** Time scale is the HOST's: Core never touches `Date`, `performance`, timers or `requestAnimationFrame`. */
export interface QaTimeScaleHook {
  get(): number;
  set(value: number): unknown;
}

/** Core runtimes the panel summarizes (read-only, through their `snapshot()`); each may be absent. */
export interface QaCoreRuntimes {
  save?: { snapshot(): SaveGateSnapshot } | null | undefined;
  wallet?: { snapshot(): SoftCurrencyWalletSnapshot } | null | undefined;
  lives?: { snapshot(): LivesSnapshot } | null | undefined;
  continueOffer?: { snapshot(): ContinueOfferSnapshot } | null | undefined;
}

export interface QaGameInfo {
  name?: string;
  version?: string;
  commit?: string;
}

/** `performance.memory` (Chromium only, non-standard) in bytes; null where the browser does not expose it. */
export interface QaMemorySample {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface QaDocumentLike {
  createElement(tag: string): unknown;
}

export interface GameCoreQaOptions {
  /** Game metadata shown in the header and the diagnostics — the host's, never guessed. */
  game?: QaGameInfo;
  /** The Core build to report; default = the build this QA entry was made from. Pass the root `BUILD_INFO`. */
  coreBuild?: GameCoreBuildInfo;
  /** Platform code + language, read live (`platform.environment` of a PlatformRuntime / GamePlatform). */
  environment?: Pick<PlatformEnvironment, 'platformCode' | 'language'> | null;
  /** Core runtimes to summarize; a function so runtimes created after install are seen. */
  runtimes?: () => QaCoreRuntimes;
  /** Extra read-only state (a ledger summary …): redacted, depth-limited JSON. */
  inspectors?: Record<string, () => unknown>;
  /** QA capabilities known at install; more come with `register()`. */
  capabilities?: readonly QaCapability[];
  /** The standard resets the host implements (`reset.all` / `reset.gameplay` / `reset.core`); a missing one is shown disabled. */
  resets?: Partial<Record<QaResetKind, (params: QaParams) => unknown>>;
  timeScale?: QaTimeScaleHook | null;
  /** The profile the host's QA-aware platform wrapper (`withNetworkFaults`) uses; absent = no network simulation. */
  network?: NetworkFaultProfile | null;
  /** Global name; default `GameCoreQA`, `false` = no global (tests, a host that exposes it itself). */
  globalName?: string | false;
  /** Where the panel goes; default `document.body`. Nothing is created before `open()`. */
  container?: unknown;
  /** Wall clock, epoch ms (default `Date.now`) — only for the diagnostics timestamp and session age. */
  now?: () => number;
  /** Default: `performance.memory` when the browser exposes it, else null ("N/A"). */
  memory?: () => QaMemorySample | null;
  /** Default: `navigator.onLine`; null = unknown. */
  online?: () => boolean | null;
  /** Default: `navigator.clipboard.writeText`. */
  clipboard?: (text: string) => Promise<void>;
}

export type QaErrorCode = 'unknown_command' | 'invalid_params' | 'confirm_required' | 'unavailable' | 'failed' | 'disposed';

export interface QaError {
  code: QaErrorCode;
  message: string;
}

/** Every command answers — never throws, never rejects. */
export type QaResult =
  | { ok: true; command: string; value: QaJson }
  | { ok: false; command: string; error: QaError };

export interface QaCapabilityInfo {
  id: string;
  kind: QaCapabilityKind | 'network' | 'timeScale';
  label: string;
  hint: string | null;
  commands: string[];
  destructive: boolean;
  /** select: the current options. */
  options?: QaSelectOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface QaMetrics {
  /** null until the host fed a full sample window through `frame(ms)`. */
  fps: number | null;
  frameMs: number | null;
  frameMaxMs: number | null;
  /** MB, one decimal; null = the browser does not expose it (never faked). */
  memory: { usedMB: number; totalMB: number; limitMB: number } | null;
}

export interface QaNetworkState {
  mode: NetworkFaultMode;
  latencyMs: number;
  failNextArmed: boolean;
  calls: number;
  faulted: number;
  /** Always `core-platform`: only calls through the QA-aware wrapper are simulated. */
  scope: 'core-platform';
}

export type NetworkFaultMode = 'normal' | 'offline' | 'latency';

export interface QaState {
  ready: boolean;
  open: boolean;
  /** The compact metrics overlay (FPS / frame / memory) is shown — `panel.metrics.set { value }`; it stays when the panel closes. */
  metricsOverlay: boolean;
  meta: {
    game: { name: string | null; version: string | null; commit: string | null };
    core: { version: string; commit: string; dirty: boolean };
    platform: string | null;
    language: string | null;
    online: boolean | null;
    now: string | null;
    sessionSeconds: number | null;
  };
  metrics: QaMetrics;
  /** Capability ids (built-ins included), in panel order. */
  capabilities: string[];
  /** Current value of every number / select / toggle capability; null when its `get()` threw or answered nothing. */
  values: Record<string, QaJson>;
  resets: QaResetKind[];
  network: QaNetworkState | null;
  timeScale: number | null;
  core: Record<string, QaJson>;
  inspect: Record<string, QaJson>;
}
