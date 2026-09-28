// Public entry of the Game Core QA Panel: `import { installGameCoreQA } from "game-core/qa"` — a QA BUILD only.
//
// Production isolation is the build's, not a secret: this entry is never part of `game-core` (root) or
// `game-core/pixi`, and nothing here installs itself. The host imports it behind its own build-time flag
// (`if (__QA_BUILD__) { const { installGameCoreQA } = await import('game-core/qa'); … }`), so a production
// build has no QA module, no `GameCoreQA` global and no QA command — `npm run qa:isolation` proves it.
import { QaPanelView } from './QaPanelView';
import { QaRuntime } from './QaRuntime';
import type { GameCoreQaOptions, QaCapability, QaCapabilityInfo, QaResult, QaState } from './types';

export { QaRuntime, QA_RESET_KINDS, QA_RESET_LABELS, QA_TIME_SCALES, QA_SAMPLE_WINDOW_MS } from './QaRuntime';
export type { QaChange, QaListener } from './QaRuntime';
export { QaPanelView, QA_PANEL_ATTRIBUTE } from './QaPanelView';
export { NetworkFaultProfile, NetworkFaultError, withNetworkFaults, isNetworkFault, NETWORK_FAULT_MODES, DEFAULT_QA_LATENCY_MS } from './NetworkFaultProfile';
export type { NetworkFaultKind, NetworkFaultProfileOptions } from './NetworkFaultProfile';
export { toQaJson } from './redact';
export { setQaLives, createLivesQaCapability, QA_LIVES_SOURCE } from './livesSeam';
export type { QaLivesTarget, QaLivesSetResult } from './livesSeam';
export type * from './types';

/** The default global an automation / a tester's console reads. */
export const QA_GLOBAL_NAME = 'GameCoreQA';

/** `window.GameCoreQA`: the machine API and the panel. Every method answers JSON; `run` never throws or rejects. */
export interface GameCoreQA {
  readonly apiVersion: 1;
  open(): void;
  close(): void;
  toggle(): void;
  /** Resolves with the state once the host called `markReady()` (boot done). */
  ready(): Promise<QaState>;
  markReady(): void;
  listCapabilities(): QaCapabilityInfo[];
  getState(): QaState;
  getDiagnostics(): string;
  copyDiagnostics(): Promise<{ ok: boolean; text: string }>;
  run(command: string, params?: Record<string, unknown>): Promise<QaResult>;
  register(capability: QaCapability): () => void;
  /** The host's frame time (ms) from its own loop — the FPS / frame-time source. */
  frame(frameMs: number): void;
  /** Removes the panel and the global. */
  dispose(): void;
}

type Host = { document?: { body?: unknown } } & Record<string, unknown>;

/**
 * Installs the QA API (and the global, unless `globalName: false`). Call it only in a QA build.
 * Nothing is drawn before `open()`. A second install under the same global throws.
 */
export function installGameCoreQA(options: GameCoreQaOptions = {}): GameCoreQA {
  const host = globalThis as unknown as Host;
  const globalName = options.globalName === undefined ? QA_GLOBAL_NAME : options.globalName;
  if (globalName !== false && host[globalName] !== undefined) throw new Error(`GameCoreQA: ${globalName} is already installed`);
  const runtime = new QaRuntime(options);
  const container = (options.container ?? host.document?.body ?? null) as (HTMLElement & { ownerDocument?: Document | null }) | null;
  const doc = container?.ownerDocument ?? null;
  const view = container && doc ? new QaPanelView(runtime, container, doc) : null;
  let disposed = false;
  const api: GameCoreQA = {
    apiVersion: 1,
    open: () => runtime.open(),
    close: () => runtime.close(),
    toggle: () => runtime.toggle(),
    ready: () => runtime.ready(),
    markReady: () => runtime.markReady(),
    listCapabilities: () => runtime.listCapabilities(),
    getState: () => runtime.getState(),
    getDiagnostics: () => runtime.getDiagnostics(),
    copyDiagnostics: () => runtime.copyDiagnostics(),
    run: (command, params) => runtime.run(command, params ?? {}),
    register: (capability) => runtime.register(capability),
    frame: (frameMs) => runtime.frame(frameMs),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      view?.dispose();
      runtime.dispose();
      if (globalName !== false && host[globalName] === api) delete host[globalName];
    }
  };
  if (globalName !== false) host[globalName] = api;
  return api;
}
