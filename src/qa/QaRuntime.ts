// QA Panel V1 — the ONE command registry. The panel's buttons and an automation (Playwright, an AI agent)
// call the same `run(command, params)`; the state an automation asserts on is `getState()` (JSON), never the
// panel's text. Core owns the registry, the metrics, the diagnostics and the network fault state; every
// game value and every destructive effect is a host callback — Core knows no coins, lives, moves or levels.
import { BUILD_INFO } from '../buildInfo';
import { NETWORK_FAULT_MODES, isLatencyMs } from './NetworkFaultProfile';
import type { NetworkFaultProfile } from './NetworkFaultProfile';
import { safeText, toQaJson } from './redact';
import type {
  GameCoreQaOptions,
  NetworkFaultMode,
  QaCapability,
  QaCapabilityInfo,
  QaCoreRuntimes,
  QaError,
  QaErrorCode,
  QaJson,
  QaMemorySample,
  QaMetrics,
  QaParams,
  QaResetKind,
  QaResult,
  QaSelectOption,
  QaState,
  QaTimeScaleHook
} from './types';

export const QA_RESET_KINDS: readonly QaResetKind[] = ['all', 'gameplay', 'core'];
export const QA_RESET_LABELS: Readonly<Record<QaResetKind, string>> = {
  all: 'Reset all',
  gameplay: 'Reset gameplay progress',
  core: 'Reset Core state'
};
export const QA_TIME_SCALES: readonly number[] = [0.5, 1, 2];
/** The metrics window: FPS / frame time are averaged over this much host frame time. */
export const QA_SAMPLE_WINDOW_MS = 500;
/** A frame longer than this is a hidden tab / a debugger stop, not a frame: it is dropped from the sample. */
const MAX_FRAME_MS = 1000;
const MAX_TIME_SCALE = 16;
const ID = /^[a-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;
const RESERVED = /^(reset|network|timeScale|panel)(\.|$)/;

export type QaChange = 'sample' | 'command' | 'registry' | 'open' | 'close' | 'ready' | 'metrics';
export type QaListener = (change: QaChange) => void;

const fail = (command: string, code: QaErrorCode, message: string): QaResult => ({ ok: false, command, error: { code, message } });
const errorMessage = (error: unknown): string => safeText(error instanceof Error ? error.message : error) ?? 'unknown error';
const round1 = (value: number): number => Math.round(value * 10) / 10;
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const defaultMemory = (): QaMemorySample | null => {
  const memory = (globalThis as { performance?: { memory?: Partial<QaMemorySample> } }).performance?.memory;
  return memory ? { usedJSHeapSize: memory.usedJSHeapSize ?? NaN, totalJSHeapSize: memory.totalJSHeapSize ?? NaN, jsHeapSizeLimit: memory.jsHeapSizeLimit ?? NaN } : null;
};
const defaultOnline = (): boolean | null => {
  const online = (globalThis as { navigator?: { onLine?: unknown } }).navigator?.onLine;
  return typeof online === 'boolean' ? online : null;
};
const defaultClipboard = (text: string): Promise<void> => {
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } } }).navigator?.clipboard;
  return clipboard?.writeText ? clipboard.writeText(text) : Promise.reject(new Error('clipboard unavailable'));
};
const toMB = (bytes: number): number => round1(bytes / (1024 * 1024));

const normalizeOptions = (options: ReadonlyArray<QaSelectOption | string>): QaSelectOption[] =>
  options.map((option) => (typeof option === 'string' ? { value: option, label: option } : { value: String(option.value), label: option.label ?? String(option.value) }));

function validateCapability(capability: QaCapability): void {
  if (!capability || typeof capability !== 'object') throw new TypeError('GameCoreQA: a capability must be an object');
  if (typeof capability.id !== 'string' || !ID.test(capability.id)) throw new TypeError(`GameCoreQA: bad capability id ${String(capability.id)}`);
  if (RESERVED.test(capability.id)) throw new TypeError(`GameCoreQA: capability id ${capability.id} uses a reserved prefix (reset / network / timeScale / panel)`);
  if (typeof capability.label !== 'string' || capability.label === '') throw new TypeError(`GameCoreQA: capability ${capability.id} needs a label`);
  const need = (...names: string[]) => {
    for (const name of names) if (typeof (capability as unknown as Record<string, unknown>)[name] !== 'function') throw new TypeError(`GameCoreQA: ${capability.kind} capability ${capability.id} needs ${name}()`);
  };
  switch (capability.kind) {
    case 'number': need('get', 'set'); break;
    case 'select': need('options', 'get', 'set'); break;
    case 'toggle': need('get', 'set'); break;
    case 'action': need('run'); break;
    default: throw new TypeError(`GameCoreQA: unknown capability kind ${String((capability as { kind?: unknown }).kind)}`);
  }
}

function summarizeCore(runtimes: QaCoreRuntimes): Record<string, QaJson> {
  const out: Record<string, QaJson> = {};
  const read = <T>(name: string, source: { snapshot(): T } | null | undefined, pick: (snapshot: T) => Record<string, unknown>) => {
    if (!source) return;
    try {
      out[name] = toQaJson(pick(source.snapshot()));
    } catch (error) {
      out[name] = { error: errorMessage(error) };
    }
  };
  read('save', runtimes.save, (s) => ({ phase: s.phase, core: s.core, groups: s.groups.map((group) => group.status) }));
  read('wallet', runtimes.wallet, (s) => ({ status: s.status, currency: s.currency, balance: s.balance, writable: s.writable, problem: s.problem, rewardedLevels: s.rewardedLevels.length }));
  read('lives', runtimes.lives, (s) => ({ status: s.status, lives: s.lives, maxLives: s.maxLives, attemptOpen: s.attemptOpen, nextLifeInMs: s.nextLifeInMs, writable: s.writable, problem: s.problem }));
  read('continueOffer', runtimes.continueOffer, (s) => ({ status: s.status, levelKey: s.levelKey, offerCount: s.offerCount, freeAvailable: s.freeAvailable, offer: s.offer, writable: s.writable, problem: s.problem }));
  return out;
}

export class QaRuntime {
  private readonly capabilities = new Map<string, QaCapability>();
  private readonly listeners = new Set<QaListener>();
  private readonly readyWaiters: Array<(state: QaState) => void> = [];
  private readonly options: GameCoreQaOptions;
  private readonly now: () => number;
  private readonly startedAt: number | null;
  private readonly network: NetworkFaultProfile | null;
  private readonly timeScale: QaTimeScaleHook | null;
  private readonly resets: Partial<Record<QaResetKind, (params: QaParams) => unknown>>;
  private isReady = false;
  private isOpen = false;
  /** The compact metrics overlay (V1.1): independent of the panel, off by default. */
  private metricsOverlay = false;
  private disposed = false;
  private windowMs = 0;
  private windowFrames = 0;
  private windowMax = 0;
  private sample: { fps: number; frameMs: number; frameMaxMs: number } | null = null;

  constructor(options: GameCoreQaOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.clock();
    this.network = options.network ?? null;
    this.timeScale = options.timeScale ?? null;
    this.resets = { ...(options.resets ?? {}) };
    for (const kind of Object.keys(this.resets)) {
      if (!QA_RESET_KINDS.includes(kind as QaResetKind)) throw new TypeError(`GameCoreQA: unknown reset ${kind} (allowed: ${QA_RESET_KINDS.join(', ')})`);
      if (typeof this.resets[kind as QaResetKind] !== 'function') throw new TypeError(`GameCoreQA: reset ${kind} must be a function`);
    }
    for (const capability of options.capabilities ?? []) this.register(capability);
  }

  // --- lifecycle -------------------------------------------------------------------------------------------

  /** The host calls this once boot is done (save loaded, capabilities registered). */
  markReady(): void {
    if (this.isReady || this.disposed) return;
    this.isReady = true;
    const state = this.getState();
    for (const resolve of this.readyWaiters.splice(0)) resolve(state);
    this.emit('ready');
  }

  /** Resolves with the state once the host called `markReady()` — an automation awaits this, never a sleep. */
  ready(): Promise<QaState> {
    return this.isReady ? Promise.resolve(this.getState()) : new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  open(): void {
    if (this.isOpen || this.disposed) return;
    this.isOpen = true;
    this.emit('open');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.emit('close');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  get opened(): boolean {
    return this.isOpen;
  }

  get metricsShown(): boolean {
    return this.metricsOverlay;
  }

  subscribe(listener: QaListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.close();
    if (this.metricsOverlay) {
      this.metricsOverlay = false;
      this.emit('metrics');
    }
    this.disposed = true;
    this.listeners.clear();
  }

  // --- registry --------------------------------------------------------------------------------------------

  /** Adds a capability; returns its unregister. A bad or duplicate id throws (a programming error, at boot). */
  register(capability: QaCapability): () => void {
    validateCapability(capability);
    if (this.capabilities.has(capability.id)) throw new TypeError(`GameCoreQA: capability ${capability.id} is already registered`);
    this.capabilities.set(capability.id, capability);
    this.emit('registry');
    return () => {
      if (this.capabilities.get(capability.id) !== capability) return;
      this.capabilities.delete(capability.id);
      this.emit('registry');
    };
  }

  listCapabilities(): QaCapabilityInfo[] {
    const list: QaCapabilityInfo[] = [];
    for (const capability of this.capabilities.values()) {
      const info: QaCapabilityInfo = {
        id: capability.id,
        kind: capability.kind,
        label: capability.label,
        hint: capability.hint ?? null,
        commands: [capability.kind === 'action' ? capability.id : `${capability.id}.set`],
        destructive: capability.kind === 'action' && capability.destructive === true
      };
      if (capability.kind === 'number') {
        if (capability.min !== undefined) info.min = capability.min;
        if (capability.max !== undefined) info.max = capability.max;
        info.step = capability.step ?? 1;
      }
      if (capability.kind === 'select') {
        try {
          info.options = normalizeOptions(capability.options());
        } catch {
          info.options = [];
        }
      }
      list.push(info);
    }
    for (const kind of QA_RESET_KINDS) {
      if (this.resets[kind]) list.push({ id: `reset.${kind}`, kind: 'action', label: QA_RESET_LABELS[kind], hint: null, commands: [`reset.${kind}`], destructive: true });
    }
    if (this.network) list.push({ id: 'network', kind: 'network', label: 'Network (Core/platform simulation)', hint: null, commands: ['network.set', 'network.failNext'], destructive: false });
    if (this.timeScale) list.push({ id: 'timeScale', kind: 'timeScale', label: 'Time scale', hint: null, commands: ['timeScale.set'], destructive: false });
    return list;
  }

  // --- commands --------------------------------------------------------------------------------------------

  /** THE command API. Always resolves with a JSON result; a refusal or a host failure is `{ ok: false, error }`. */
  async run(command: string, params: unknown = {}): Promise<QaResult> {
    const id = typeof command === 'string' ? command : String(command);
    if (this.disposed) return fail(id, 'disposed', 'GameCoreQA was disposed');
    if (!isPlainObject(params)) return fail(id, 'invalid_params', 'params must be an object');
    const result = await this.execute(id, params);
    this.emit('command');
    return result;
  }

  private async execute(id: string, params: QaParams): Promise<QaResult> {
    if (id === 'network.set' || id === 'network.failNext') return this.runNetwork(id, params);
    if (id === 'timeScale.set') return this.runTimeScale(id, params);
    if (id === 'panel.metrics.set') {
      if (typeof params.value !== 'boolean') return fail(id, 'invalid_params', 'value must be a boolean');
      if (params.value !== this.metricsOverlay) {
        this.metricsOverlay = params.value;
        this.emit('metrics');
      }
      return { ok: true, command: id, value: this.metricsOverlay };
    }
    if (id.startsWith('reset.')) {
      const kind = id.slice(6) as QaResetKind;
      if (!QA_RESET_KINDS.includes(kind)) return fail(id, 'unknown_command', `unknown command ${id}`);
      const reset = this.resets[kind];
      if (!reset) return fail(id, 'unavailable', `the game registered no ${id}`);
      if (params.confirm !== true) return fail(id, 'confirm_required', `${id} is destructive: pass { confirm: true }`);
      return this.call(id, () => reset(params), (value) => toQaJson(value));
    }
    const action = this.capabilities.get(id);
    if (action?.kind === 'action') {
      if (action.destructive && params.confirm !== true) return fail(id, 'confirm_required', `${id} is destructive: pass { confirm: true }`);
      return this.call(id, () => action.run(params), (value) => toQaJson(value));
    }
    const capability = id.endsWith('.set') ? this.capabilities.get(id.slice(0, -4)) : undefined;
    if (!capability || capability.kind === 'action') return fail(id, 'unknown_command', `unknown command ${id}`);
    const value = params.value;
    switch (capability.kind) {
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) return fail(id, 'invalid_params', 'value must be a finite number');
        if (capability.integer !== false && !Number.isInteger(value)) return fail(id, 'invalid_params', 'value must be an integer');
        if (capability.min !== undefined && value < capability.min) return fail(id, 'invalid_params', `value must be ≥ ${capability.min}`);
        if (capability.max !== undefined && value > capability.max) return fail(id, 'invalid_params', `value must be ≤ ${capability.max}`);
        return this.call(id, () => capability.set(value), () => toQaJson(capability.get()));
      }
      case 'select': {
        if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return fail(id, 'invalid_params', 'value must be a string or a number');
        const key = String(value);
        let options: QaSelectOption[];
        try {
          options = normalizeOptions(capability.options());
        } catch (error) {
          return fail(id, 'failed', errorMessage(error));
        }
        if (!options.some((option) => option.value === key)) return fail(id, 'invalid_params', `${key} is not an option of ${capability.id}`);
        return this.call(id, () => capability.set(key), () => toQaJson(capability.get()));
      }
      case 'toggle': {
        if (typeof value !== 'boolean') return fail(id, 'invalid_params', 'value must be a boolean');
        return this.call(id, () => capability.set(value), () => toQaJson(capability.get()));
      }
    }
  }

  private async runNetwork(id: string, params: QaParams): Promise<QaResult> {
    const network = this.network;
    if (!network) return fail(id, 'unavailable', 'no QA network profile: the game did not wrap its platform with withNetworkFaults');
    if (id === 'network.failNext') {
      network.failNext(params.armed !== false);
      return { ok: true, command: id, value: toQaJson(network.snapshot()) };
    }
    const mode = params.mode;
    if (typeof mode !== 'string' || !NETWORK_FAULT_MODES.includes(mode as NetworkFaultMode)) return fail(id, 'invalid_params', `mode must be one of ${NETWORK_FAULT_MODES.join(', ')}`);
    if (params.latencyMs !== undefined && !isLatencyMs(params.latencyMs)) return fail(id, 'invalid_params', 'latencyMs must be an integer 0…60000');
    network.set(mode as NetworkFaultMode, params.latencyMs as number | undefined);
    return { ok: true, command: id, value: toQaJson(network.snapshot()) };
  }

  private async runTimeScale(id: string, params: QaParams): Promise<QaResult> {
    const hook = this.timeScale;
    if (!hook) return fail(id, 'unavailable', 'the game registered no timeScale hook (Core never patches timers or clocks)');
    const value = params.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_TIME_SCALE) return fail(id, 'invalid_params', `value must be a number in (0, ${MAX_TIME_SCALE}]`);
    return this.call(id, () => hook.set(value), () => toQaJson(hook.get()));
  }

  private async call(id: string, effect: () => unknown, answer: (value: unknown) => QaJson): Promise<QaResult> {
    try {
      const value = await effect();
      return { ok: true, command: id, value: answer(value) };
    } catch (error) {
      const out: QaError = { code: 'failed', message: errorMessage(error) };
      return { ok: false, command: id, error: out };
    }
  }

  // --- metrics ---------------------------------------------------------------------------------------------

  /** The host's frame time, from ITS loop (the Pixi ticker, the overlay's rAF). O(1); Core owns no frame loop. */
  frame(frameMs: number): void {
    if (this.disposed || typeof frameMs !== 'number' || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > MAX_FRAME_MS) return;
    this.windowMs += frameMs;
    this.windowFrames += 1;
    if (frameMs > this.windowMax) this.windowMax = frameMs;
    if (this.windowMs < QA_SAMPLE_WINDOW_MS) return;
    this.sample = {
      fps: round1((this.windowFrames * 1000) / this.windowMs),
      frameMs: round1(this.windowMs / this.windowFrames),
      frameMaxMs: round1(this.windowMax)
    };
    this.windowMs = 0;
    this.windowFrames = 0;
    this.windowMax = 0;
    this.emit('sample');
  }

  /** The live numbers of the ONE sampler (`frame(ms)`) — the panel and the mini overlay both read this. */
  getMetrics(): QaMetrics {
    return this.metrics();
  }

  private metrics(): QaMetrics {
    let memory: QaMetrics['memory'] = null;
    try {
      const sample = (this.options.memory ?? defaultMemory)();
      if (sample && [sample.usedJSHeapSize, sample.totalJSHeapSize, sample.jsHeapSizeLimit].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
        memory = { usedMB: toMB(sample.usedJSHeapSize), totalMB: toMB(sample.totalJSHeapSize), limitMB: toMB(sample.jsHeapSizeLimit) };
      }
    } catch {
      memory = null;
    }
    return { fps: this.sample?.fps ?? null, frameMs: this.sample?.frameMs ?? null, frameMaxMs: this.sample?.frameMaxMs ?? null, memory };
  }

  // --- state -----------------------------------------------------------------------------------------------

  getState(): QaState {
    const values: Record<string, QaJson> = {};
    for (const capability of this.capabilities.values()) {
      if (capability.kind === 'action') continue;
      try {
        values[capability.id] = toQaJson(capability.get());
      } catch {
        values[capability.id] = null;
      }
    }
    let timeScale: number | null = null;
    try {
      const value = this.timeScale?.get();
      timeScale = typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      timeScale = null;
    }
    const inspect: Record<string, QaJson> = {};
    for (const [name, read] of Object.entries(this.options.inspectors ?? {})) {
      try {
        inspect[name] = toQaJson(read());
      } catch (error) {
        inspect[name] = { error: errorMessage(error) };
      }
    }
    let core: Record<string, QaJson> = {};
    try {
      core = this.options.runtimes ? summarizeCore(this.options.runtimes()) : {};
    } catch (error) {
      core = { error: errorMessage(error) };
    }
    const game = this.options.game ?? {};
    const build = this.options.coreBuild ?? BUILD_INFO;
    const env = this.options.environment;
    const read = (fn: (() => unknown) | undefined): string | null => {
      try {
        return fn ? safeText(fn()) : null;
      } catch {
        return null;
      }
    };
    const now = this.clock();
    let online: boolean | null = null;
    try {
      online = (this.options.online ?? defaultOnline)();
    } catch {
      online = null;
    }
    return {
      ready: this.isReady,
      open: this.isOpen,
      metricsOverlay: this.metricsOverlay,
      meta: {
        game: { name: safeText(game.name), version: safeText(game.version), commit: safeText(game.commit) },
        core: { version: safeText(build.version) ?? 'unknown', commit: safeText(build.commit) ?? 'unknown', dirty: build.dirty === true },
        platform: read(env ? () => env.platformCode() : undefined),
        language: read(env ? () => env.language() : () => (globalThis as { navigator?: { language?: string } }).navigator?.language),
        online: typeof online === 'boolean' ? online : null,
        now: now === null ? null : new Date(now).toISOString(),
        sessionSeconds: now === null || this.startedAt === null ? null : Math.max(0, Math.floor((now - this.startedAt) / 1000))
      },
      metrics: this.metrics(),
      capabilities: this.listCapabilities().map((info) => info.id),
      values,
      resets: QA_RESET_KINDS.filter((kind) => this.resets[kind] !== undefined),
      network: this.network ? this.network.snapshot() : null,
      timeScale,
      core,
      inspect
    };
  }

  /** Compact text for a bug report (the panel's Copy button). Same data as `getState()`, secrets redacted. */
  getDiagnostics(): string {
    const s = this.getState();
    const na = (value: unknown, suffix = ''): string => (value === null || value === undefined ? 'N/A' : `${String(value)}${suffix}`);
    const g = s.meta.game;
    const m = s.metrics;
    const lines = [
      'Game Core QA diagnostics',
      `time: ${na(s.meta.now)} · session ${na(s.meta.sessionSeconds, ' s')}`,
      `game: ${[g.name ?? 'N/A', g.version, g.commit && `(${g.commit})`].filter(Boolean).join(' ')}`,
      `core: ${s.meta.core.version} (${s.meta.core.commit})`,
      `platform: ${na(s.meta.platform)} · language: ${na(s.meta.language)} · online: ${s.meta.online === null ? 'N/A' : s.meta.online ? 'yes' : 'no'}`,
      `fps: ${na(m.fps)} · frame: ${na(m.frameMs, ' ms')} (max ${na(m.frameMaxMs, ' ms')}) · heap: ${m.memory ? `${m.memory.usedMB} / ${m.memory.limitMB} MB` : 'N/A'}`,
      `network sim: ${s.network ? `${s.network.mode.toUpperCase()}${s.network.mode === 'latency' ? ` ${s.network.latencyMs} ms` : ''}${s.network.failNextArmed ? ' +FAIL_NEXT' : ''} (Core/platform calls only)` : 'N/A'} · time scale: ${s.timeScale === null ? 'N/A' : `x${s.timeScale}`}`,
      `qa: ${s.capabilities.join(', ') || 'none'}`
    ];
    if (Object.keys(s.values).length > 0) lines.push(`values: ${JSON.stringify(s.values)}`);
    for (const [name, value] of Object.entries(s.core)) lines.push(`${name}: ${JSON.stringify(value)}`);
    for (const [name, value] of Object.entries(s.inspect)) lines.push(`inspect.${name}: ${JSON.stringify(value)}`);
    return lines.join('\n');
  }

  /** Copies `getDiagnostics()`; false when the clipboard refused (the panel then shows the text to copy by hand). */
  async copyDiagnostics(): Promise<{ ok: boolean; text: string }> {
    const text = this.getDiagnostics();
    try {
      await (this.options.clipboard ?? defaultClipboard)(text);
      return { ok: true, text };
    } catch {
      return { ok: false, text };
    }
  }

  private clock(): number | null {
    try {
      const value = this.now();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  private emit(change: QaChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        // a listener (the panel) never breaks a command or the host's frame
      }
    }
  }
}
