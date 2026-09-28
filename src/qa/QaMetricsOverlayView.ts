// QA Panel V1.1 — the mini metrics overlay: FPS / frame ms / memory as three live lines over the game while the full
// panel is closed. A thin DOM view like QaPanelView: shown by the runtime's `panel.metrics.set { value }` (the panel's
// toggle and an automation call the same command), refreshed on the runtime's `sample` — the ONE sampler fed by the
// host's `frame(ms)`; no timer, no frame loop, no second FPS count. It takes no input (`pointer-events: none`).
//
// Placement: bottom-left, inset by the safe area (a notch / home indicator never covers it) plus 4 px of breathing room.
// Portrait game HUDs keep their buttons in the top bar (Ready UI HudView: lives / coins / settings), so the bottom corner
// holds the overlay without covering a HUD button; whatever lies under it still gets every tap.
import type { QaRuntime } from './QaRuntime';
import type { QaMetrics } from './types';

export const QA_METRICS_ATTRIBUTE = 'data-game-core-qa-metrics';

const STYLE = `
.gcqa-mini{position:fixed;left:calc(4px + env(safe-area-inset-left));bottom:calc(4px + env(safe-area-inset-bottom));z-index:2147482900;
 box-sizing:border-box;margin:0;padding:3px 6px;border-radius:4px;background:rgba(8,10,16,.72);color:#e6ffe6;
 font:11px/1.25 ui-monospace,Menlo,Consolas,monospace;white-space:pre;pointer-events:none;user-select:none;-webkit-user-select:none}
`;

type Doc = { createElement(tag: string): HTMLElement };

/** The three lines: `FPS 59` / `16.9 ms` / `MEM 82 MB` — N/A for what the sampler or the browser does not have. */
export function formatMiniMetrics(metrics: QaMetrics): string {
  return [
    `FPS ${metrics.fps === null ? 'N/A' : Math.round(metrics.fps)}`,
    metrics.frameMs === null ? 'N/A ms' : `${metrics.frameMs} ms`,
    `MEM ${metrics.memory ? `${Math.round(metrics.memory.usedMB)} MB` : 'N/A'}`
  ].join('\n');
}

export class QaMetricsOverlayView {
  private root: HTMLElement | null = null;
  private text: HTMLElement | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly runtime: QaRuntime, private readonly container: HTMLElement, private readonly doc: Doc) {
    this.unsubscribe = runtime.subscribe((change) => {
      if (change === 'metrics') {
        if (runtime.metricsShown) this.mount();
        else this.unmount();
      } else if (change === 'sample') this.update();
    });
    if (runtime.metricsShown) this.mount();
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
    const root = this.doc.createElement('div');
    root.setAttribute('class', 'gcqa-mini');
    root.setAttribute(QA_METRICS_ATTRIBUTE, '');
    root.setAttribute('data-qa', 'mini-metrics');
    root.setAttribute('aria-hidden', 'true');
    const style = this.doc.createElement('style');
    style.append(STYLE);
    const text = this.doc.createElement('div');
    text.setAttribute('data-qa', 'mini-metrics-text');
    root.append(style, text);
    this.root = root;
    this.text = text;
    this.container.append(root);
    this.update();
  }

  private unmount(): void {
    this.root?.remove();
    this.root = null;
    this.text = null;
  }

  private update(): void {
    if (this.text) this.text.textContent = formatMiniMetrics(this.runtime.getMetrics());
  }
}
