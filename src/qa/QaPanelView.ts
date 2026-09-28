// QA Panel V1 — the DOM panel. A thin view over QaRuntime: it renders `listCapabilities()` / `getState()` and
// every button calls `runtime.run(command, params)` — the same command an automation calls. No logic of its
// own, no timer, no frame loop (the live metrics refresh on the runtime's `sample`, i.e. the host's frames).
// DOM exists only while the panel is open.
import type { QaRuntime } from './QaRuntime';
import { QA_RESET_KINDS, QA_RESET_LABELS, QA_TIME_SCALES } from './QaRuntime';
import type { QaCapabilityInfo, QaJson, QaResult, QaState } from './types';

export const QA_PANEL_ATTRIBUTE = 'data-game-core-qa';

const STYLE = `
.gcqa{position:fixed;top:0;right:0;z-index:2147483000;box-sizing:border-box;width:min(420px,100vw);max-height:100%;overflow:auto;
 -webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:calc(8px + env(safe-area-inset-top)) 10px 10px;background:#0e1016;color:#e6e8ee;
 font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;text-align:left;touch-action:pan-y;user-select:text;-webkit-user-select:text}
.gcqa *{box-sizing:border-box;font:inherit;touch-action:pan-y}
.gcqa-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.gcqa-title{flex:1;font-weight:700;font-size:13px;color:#fff}
.gcqa-sec{border-top:1px solid #2c3140;padding:6px 0}
.gcqa-h{font-weight:700;color:#9fb4ff;margin-bottom:4px}
.gcqa-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:3px 0}
.gcqa-label{flex:1 1 120px;min-width:0;overflow-wrap:anywhere}
.gcqa-val{color:#ffd88a}
.gcqa-muted{color:#8a90a0}
.gcqa-kv{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.gcqa button,.gcqa select,.gcqa input{min-height:30px;border:1px solid #3a4152;border-radius:6px;background:#232838;color:#e6e8ee;padding:3px 8px}
.gcqa button:disabled{opacity:.4}
.gcqa button.gcqa-on{background:#2f5bd8;border-color:#2f5bd8;color:#fff}
.gcqa button.gcqa-danger{border-color:#a33a3a;color:#ffb3b3}
.gcqa input{width:84px}
.gcqa select{max-width:160px}
.gcqa-status{min-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.gcqa-ok{color:#8be28b}.gcqa-err{color:#ff8f8f}
.gcqa textarea{width:100%;height:120px;background:#0b0d12;color:#e6e8ee;border:1px solid #3a4152}
`;

// Touch scrolling (V1.1): `touch-action` is NOT inherited, and games commonly ship `* { touch-action: none }` (SoliPix does, to
// kill zoom) — a universal rule that sets `none` on EVERY panel child. A finger lands on a child, the browser intersects
// the touch-action of the target and its ancestors up to the scroller (the panel) → `none` → it never pans; the wheel
// ignores touch-action, hence "scrolls on desktop, not on a phone". So every panel element states `pan-y` itself
// (`.gcqa *` outranks `*`), and `overscroll-behavior: contain` keeps the scroll from chaining to the page.
// A game's `touchmove` preventDefault on body / document (bubble phase) never runs: the panel stops the event first.
// events the panel keeps to itself, so a game listening on window / document never sees a tap or a key meant for the panel
const SWALLOWED = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'touchmove', 'wheel', 'keydown', 'keyup'];

type Doc = { createElement(tag: string): HTMLElement };
type Child = HTMLElement | string | null | false | undefined;

const na = (value: unknown, suffix = ''): string => (value === null || value === undefined ? 'N/A' : `${String(value)}${suffix}`);
const show = (value: QaJson): string => (value === null ? 'N/A' : typeof value === 'object' ? JSON.stringify(value) : String(value));

export class QaPanelView {
  private root: HTMLElement | null = null;
  private live: { meta: HTMLElement; metrics: HTMLElement; network: HTMLElement | null; core: HTMLElement } | null = null;
  private status: { text: string; ok: boolean } | null = null;
  private confirming: string | null = null;
  private copyText: string | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly runtime: QaRuntime, private readonly container: HTMLElement, private readonly doc: Doc) {
    this.unsubscribe = runtime.subscribe((change) => {
      if (change === 'open') this.mount();
      else if (change === 'close') this.unmount();
      else if (change === 'sample') this.renderLive();
      else if (this.root) this.render();
    });
    if (runtime.opened) this.mount();
  }

  get element(): HTMLElement | null {
    return this.root;
  }

  dispose(): void {
    this.unsubscribe();
    this.unmount();
  }

  private mount(): void {
    if (this.root) return;
    const root = this.el('div', { class: 'gcqa', [QA_PANEL_ATTRIBUTE]: '', 'data-qa': 'panel', role: 'dialog', 'aria-label': 'Game Core QA' });
    for (const type of SWALLOWED) root.addEventListener(type, (event) => event.stopPropagation());
    this.root = root;
    this.container.append(root);
    this.render();
  }

  private unmount(): void {
    this.root?.remove();
    this.root = null;
    this.live = null;
    this.confirming = null;
    this.copyText = null;
  }

  // --- helpers ---------------------------------------------------------------------------------------------

  private el(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
    const node = this.doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    for (const child of children) if (child) node.append(child);
    return node;
  }

  private button(label: string, qa: string, onClick: () => void, options: { disabled?: boolean; on?: boolean; danger?: boolean } = {}): HTMLElement {
    const cls = [options.on && 'gcqa-on', options.danger && 'gcqa-danger'].filter(Boolean).join(' ');
    const node = this.el('button', { type: 'button', 'data-qa': qa, ...(cls ? { class: cls } : {}) }, label);
    if (options.disabled) (node as HTMLButtonElement).disabled = true;
    node.addEventListener('click', () => {
      if (!(node as HTMLButtonElement).disabled) onClick();
    });
    return node;
  }

  private section(qa: string, title: string, ...children: Child[]): HTMLElement {
    return this.el('div', { class: 'gcqa-sec', 'data-qa': qa }, this.el('div', { class: 'gcqa-h' }, title), ...children);
  }

  private row(...children: Child[]): HTMLElement {
    return this.el('div', { class: 'gcqa-row' }, ...children);
  }

  private exec(command: string, params: Record<string, unknown> = {}): void {
    this.confirming = null;
    void this.runtime.run(command, params).then((result) => this.report(result));
  }

  private report(result: QaResult): void {
    this.status = result.ok
      ? { ok: true, text: `✓ ${result.command} → ${show(result.value)}` }
      : { ok: false, text: `✗ ${result.command}: ${result.error.code} — ${result.error.message}` };
    if (this.root) this.render();
  }

  // --- render ----------------------------------------------------------------------------------------------

  private render(): void {
    const root = this.root;
    if (!root) return;
    const state = this.runtime.getState();
    const caps = this.runtime.listCapabilities();
    const meta = this.el('pre', { class: 'gcqa-kv', 'data-qa': 'meta' });
    const metrics = this.el('pre', { class: 'gcqa-kv', 'data-qa': 'metrics' });
    const core = this.el('pre', { class: 'gcqa-kv', 'data-qa': 'core-state' });
    const networkLine = state.network ? this.el('div', { class: 'gcqa-muted', 'data-qa': 'network-state' }) : null;
    this.live = { meta, metrics, network: networkLine, core };
    root.textContent = '';
    root.append(
      this.el('style', {}, STYLE),
      this.el('div', { class: 'gcqa-head' },
        this.el('div', { class: 'gcqa-title' }, 'Game Core QA'),
        this.button('Copy diagnostics', 'copy', () => void this.copy()),
        this.button('×', 'close', () => this.runtime.close())),
      meta,
      this.section('metrics-sec', 'Metrics', metrics,
        this.row(this.el('span', { class: 'gcqa-label' }, 'Mini metrics (stays over the game when the panel is closed)'),
          this.button(state.metricsOverlay ? 'ON' : 'OFF', 'panel-metrics', () => this.exec('panel.metrics.set', { value: !state.metricsOverlay }), { on: state.metricsOverlay }))),
      this.renderControls(state, caps),
      this.renderResets(caps),
      this.renderNetwork(state, networkLine),
      this.renderTimeScale(state),
      this.section('core', 'Save / Core state (read-only)', core),
      this.el('div', { class: `gcqa-status ${this.status?.ok ? 'gcqa-ok' : 'gcqa-err'}`, 'data-qa': 'status' }, this.status?.text ?? ''),
      ...(this.copyText !== null ? [this.renderCopyFallback(this.copyText)] : [])
    );
    this.fillLive(state);
  }

  private renderLive(): void {
    if (this.root && this.live) this.fillLive(this.runtime.getState());
  }

  private fillLive(state: QaState): void {
    if (!this.live) return;
    const m = state.meta;
    const g = m.game;
    this.live.meta.textContent = [
      `game  ${[g.name ?? 'N/A', g.version, g.commit && `(${g.commit})`].filter(Boolean).join(' ')}`,
      `core  ${m.core.version} (${m.core.commit})`,
      `env   ${na(m.platform)} · ${na(m.language)} · ${m.online === null ? 'online N/A' : m.online ? 'online' : 'OFFLINE (browser)'}`,
      `time  ${na(m.now)} · session ${na(m.sessionSeconds, ' s')}`
    ].join('\n');
    const x = state.metrics;
    this.live.metrics.textContent = [
      `FPS   ${x.fps === null ? 'N/A (host feeds GameCoreQA.frame(ms))' : x.fps}`,
      `frame ${na(x.frameMs, ' ms')} · max ${na(x.frameMaxMs, ' ms')}`,
      `heap  ${x.memory ? `${x.memory.usedMB} / ${x.memory.totalMB} MB (limit ${x.memory.limitMB})` : 'N/A (browser does not expose it)'}`
    ].join('\n');
    if (this.live.network && state.network) {
      const n = state.network;
      this.live.network.textContent = `calls ${n.calls} · faulted ${n.faulted}${n.failNextArmed ? ' · FAIL_NEXT armed' : ''}`;
    }
    const lines = Object.entries(state.core).map(([name, value]) => `${name}: ${show(value)}`);
    for (const [name, value] of Object.entries(state.inspect)) lines.push(`${name}: ${show(value)}`);
    this.live.core.textContent = lines.length > 0 ? lines.join('\n') : 'N/A (no Core runtime / inspector registered)';
  }

  private renderControls(state: QaState, caps: QaCapabilityInfo[]): HTMLElement {
    const game = caps.filter((cap) => !cap.id.startsWith('reset.') && cap.kind !== 'network' && cap.kind !== 'timeScale');
    if (game.length === 0) return this.section('controls', 'Game QA controls', this.el('div', { class: 'gcqa-muted' }, 'N/A — the game registered none'));
    return this.section('controls', 'Game QA controls', ...game.map((cap) => this.renderCapability(cap, state.values[cap.id] ?? null)));
  }

  private renderCapability(cap: QaCapabilityInfo, value: QaJson): HTMLElement {
    const label = this.el('span', { class: 'gcqa-label' }, cap.label, cap.kind !== 'action' && ' ', cap.kind !== 'action' && this.el('span', { class: 'gcqa-val', 'data-qa': `value-${cap.id}` }, show(value)));
    const hint = cap.hint ? this.el('div', { class: 'gcqa-muted' }, cap.hint) : null;
    const command = cap.commands[0] ?? cap.id;
    if (cap.kind === 'number') {
      const input = this.el('input', { type: 'number', inputmode: 'numeric', 'data-qa': `input-${cap.id}`, step: String(cap.step ?? 1) }) as HTMLInputElement;
      input.value = typeof value === 'number' ? String(value) : '';
      const step = cap.step ?? 1;
      const current = (): number => (typeof value === 'number' ? value : 0);
      return this.el('div', { 'data-qa': `cap-${cap.id}` }, this.row(label,
        this.button('−', `dec-${cap.id}`, () => this.exec(command, { value: current() - step })),
        input,
        this.button('+', `inc-${cap.id}`, () => this.exec(command, { value: current() + step })),
        this.button('Set', `set-${cap.id}`, () => this.exec(command, { value: input.value.trim() === '' ? NaN : Number(input.value) }))), hint);
    }
    if (cap.kind === 'select') {
      const select = this.el('select', { 'data-qa': `input-${cap.id}` }) as HTMLSelectElement;
      for (const option of cap.options ?? []) {
        const node = this.el('option', { value: option.value }, option.label ?? option.value) as HTMLOptionElement;
        node.value = option.value;
        select.append(node);
      }
      if (typeof value === 'string') select.value = value;
      return this.el('div', { 'data-qa': `cap-${cap.id}` }, this.row(label, select, this.button('Apply', `set-${cap.id}`, () => this.exec(command, { value: select.value }))), hint);
    }
    if (cap.kind === 'toggle') {
      const on = value === true;
      return this.el('div', { 'data-qa': `cap-${cap.id}` }, this.row(label, this.button(on ? 'ON' : 'OFF', `set-${cap.id}`, () => this.exec(command, { value: !on }), { on })), hint);
    }
    return this.el('div', { 'data-qa': `cap-${cap.id}` }, this.row(label, ...this.actionButtons(cap, command)), hint);
  }

  private actionButtons(cap: QaCapabilityInfo, command: string): HTMLElement[] {
    if (!cap.destructive) return [this.button('Run', `run-${cap.id}`, () => this.exec(command))];
    if (this.confirming === command) {
      return [
        this.el('span', { class: 'gcqa-err' }, 'Sure?'),
        this.button('Yes, run', `confirm-${cap.id}`, () => this.exec(command, { confirm: true }), { danger: true }),
        this.button('Cancel', `cancel-${cap.id}`, () => {
          this.confirming = null;
          this.render();
        })
      ];
    }
    return [this.button('Run…', `run-${cap.id}`, () => {
      this.confirming = command;
      this.render();
    }, { danger: true })];
  }

  private renderResets(caps: QaCapabilityInfo[]): HTMLElement {
    const rows = QA_RESET_KINDS.map((kind) => {
      const cap = caps.find((info) => info.id === `reset.${kind}`);
      if (!cap) return this.row(this.el('span', { class: 'gcqa-label gcqa-muted' }, `${QA_RESET_LABELS[kind]} — N/A`), this.button('Run…', `run-reset.${kind}`, () => undefined, { disabled: true }));
      return this.row(this.el('span', { class: 'gcqa-label' }, cap.label), ...this.actionButtons(cap, cap.id));
    });
    return this.section('resets', 'Reset (host callbacks, confirm first)', ...rows);
  }

  private renderNetwork(state: QaState, line: HTMLElement | null): HTMLElement {
    const scope = this.el('div', { class: 'gcqa-muted' }, 'Scope: Core/platform network simulation — only calls through the QA platform wrapper. Other game requests are real.');
    const n = state.network;
    if (!n) return this.section('network', 'Network', scope, this.el('div', { class: 'gcqa-muted' }, 'N/A — the game did not wrap its platform (withNetworkFaults)'));
    const latency = this.el('input', { type: 'number', inputmode: 'numeric', 'data-qa': 'input-latency', min: '0', step: '100' }) as HTMLInputElement;
    latency.value = String(n.latencyMs);
    const mode = (name: 'normal' | 'offline' | 'latency') =>
      this.button(name.toUpperCase(), `network-${name}`, () => this.exec('network.set', name === 'latency' ? { mode: name, latencyMs: Number(latency.value) } : { mode: name }), { on: n.mode === name });
    return this.section('network', 'Network', scope,
      this.row(mode('normal'), mode('offline'), mode('latency'), latency, this.el('span', { class: 'gcqa-muted' }, 'ms')),
      this.row(this.button(n.failNextArmed ? 'FAIL_NEXT armed' : 'FAIL NEXT call', 'network-failNext', () => this.exec('network.failNext'), { on: n.failNextArmed })),
      line);
  }

  private renderTimeScale(state: QaState): HTMLElement {
    const available = state.timeScale !== null;
    const buttons = QA_TIME_SCALES.map((scale) =>
      this.button(`x${scale}`, `timeScale-${scale}`, () => this.exec('timeScale.set', { value: scale }), { disabled: !available, on: state.timeScale === scale }));
    return this.section('timeScale', 'Time scale', this.row(...buttons),
      !available && this.el('div', { class: 'gcqa-muted' }, 'N/A — the game registered no timeScale hook (Core never patches timers)'));
  }

  private renderCopyFallback(text: string): HTMLElement {
    const area = this.el('textarea', { readonly: '', 'data-qa': 'copy-fallback' }) as HTMLTextAreaElement;
    area.value = text;
    return this.el('div', {}, this.el('div', { class: 'gcqa-muted' }, 'Clipboard blocked — copy the text below:'), area);
  }

  private async copy(): Promise<void> {
    const result = await this.runtime.copyDiagnostics();
    this.copyText = result.ok ? null : result.text;
    this.status = result.ok ? { ok: true, text: '✓ diagnostics copied' } : { ok: false, text: '✗ clipboard blocked — text shown below' };
    this.render();
  }
}
