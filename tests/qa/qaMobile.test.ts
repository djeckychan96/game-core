import { afterEach, describe, expect, it } from 'vitest';
import * as root from '../../src/index';
import * as pixi from '../../src/pixi/index';
import { QA_METRICS_ATTRIBUTE, QA_PANEL_ATTRIBUTE, formatMiniMetrics, installGameCoreQA, type GameCoreQA, type GameCoreQaOptions } from '../../src/qa/index';

// A tiny DOM with bubbling (what QA Panel V1.1 needs: attributes, text, style text, listeners with stopPropagation).
type Listener = (event: FakeEvent) => void;
interface FakeEvent { type: string; stopped: boolean; defaultPrevented: boolean; stopPropagation(): void; preventDefault(): void }
class FakeText {
  parent: FakeEl | null = null;
  constructor(public textContent: string) {}
}
class FakeEl {
  attributes: Record<string, string> = {};
  children: Array<FakeEl | FakeText> = [];
  parent: FakeEl | null = null;
  value = '';
  disabled = false;
  listeners = new Map<string, Listener[]>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDoc) {}
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  append(...nodes: Array<FakeEl | string>): void {
    for (const node of nodes) {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parent = this;
      this.children.push(child);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  get textContent(): string {
    return this.children.map((child) => child.textContent).join('');
  }
  set textContent(text: string) {
    this.children = text ? [new FakeText(text)] : [];
  }
  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }
  /** Bubbles from this node to the root, like a DOM event in the bubble phase. */
  dispatch(type: string): FakeEvent {
    const event: FakeEvent = { type, stopped: false, defaultPrevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
    for (let node: FakeEl | null = this; node && !event.stopped; node = node.parent) for (const listener of node.listeners.get(type) ?? []) listener(event);
    return event;
  }
  click(): void {
    this.dispatch('click');
  }
  find(qa: string): FakeEl | null {
    if (this.attributes['data-qa'] === qa) return this;
    for (const child of this.children) {
      if (child instanceof FakeEl) {
        const hit = child.find(qa);
        if (hit) return hit;
      }
    }
    return null;
  }
  styleText(): string {
    return this.children.filter((c): c is FakeEl => c instanceof FakeEl && c.tagName === 'style').map((c) => c.textContent).join('');
  }
}
class FakeDoc {
  body: FakeEl = new FakeEl('body', this);
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }
}

const installed: GameCoreQA[] = [];
afterEach(() => {
  for (const qa of installed.splice(0)) qa.dispose();
});
function setup(options: Partial<GameCoreQaOptions> = {}) {
  const doc = new FakeDoc();
  const qa = installGameCoreQA({ container: doc.body, globalName: false, now: () => 1_700_000_000_000, memory: () => null, online: () => true, ...options });
  installed.push(qa);
  const panel = () => doc.body.find('panel');
  const mini = () => doc.body.find('mini-metrics');
  return { qa, doc, panel, mini };
}
const feed = (qa: GameCoreQA, ms: number, frames: number) => {
  for (let i = 0; i < frames; i++) qa.frame(ms);
};

describe('QA Panel V1.1 — mobile touch scroll', () => {
  it('1. the panel is its own vertical scroller and EVERY panel element allows pan-y (a host `* { touch-action: none }` loses)', () => {
    const { qa, panel } = setup();
    qa.open();
    const css = panel()!.styleText().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.gcqa\{position:fixed;[^}]*max-height:100%;overflow:auto;[^}]*overscroll-behavior:contain;[^}]*touch-action:pan-y/);
    // `.gcqa *` (specificity 0,1,0) outranks the host's universal `*` (0,0,0): the children state pan-y themselves
    expect(css).toMatch(/\.gcqa \*\{[^}]*touch-action:pan-y\}/);
  });

  it('2. a touch / pointer / wheel scroll inside the panel never reaches the game (its body / document listeners)', () => {
    const { qa, doc, panel } = setup({ capabilities: [{ kind: 'number', id: 'coins', label: 'Coins', get: () => 1, set: () => {} }] });
    const game: string[] = [];
    // SoliPix: body touchmove preventDefault (anti swipe-to-refresh) + document drag handlers
    for (const type of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'wheel']) doc.body.addEventListener(type, (e) => { game.push(type); e.preventDefault(); });
    qa.open();
    const child = panel()!.find('input-coins')!;
    for (const type of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'wheel']) {
      const event = child.dispatch(type);
      expect(event.defaultPrevented, type).toBe(false); // nothing cancels the browser's own scroll
    }
    expect(game).toEqual([]);
    expect(qa.getState().open).toBe(true); // a scroll never closes the panel
  });
});

describe('QA Panel V1.1 — mini metrics overlay', () => {
  it('3. is OFF by default: no DOM, getState().metricsOverlay false', () => {
    const { qa, doc, mini } = setup();
    expect(mini()).toBeNull();
    expect(doc.body.children).toHaveLength(0);
    expect(qa.getState().metricsOverlay).toBe(false);
  });

  it('4 + 10. panel.metrics.set / the panel toggle show it — one command, reflected by getState()', async () => {
    const { qa, panel, mini } = setup();
    expect(await qa.run('panel.metrics.set', { value: true })).toEqual({ ok: true, command: 'panel.metrics.set', value: true });
    expect(mini()).not.toBeNull();
    expect(mini()!.attributes[QA_METRICS_ATTRIBUTE]).toBe('');
    expect(qa.getState().metricsOverlay).toBe(true);
    expect(await qa.run('panel.metrics.set', { value: 'yes' })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    await qa.run('panel.metrics.set', { value: false });
    qa.open();
    expect(panel()!.find('panel-metrics')!.textContent).toBe('OFF');
    panel()!.find('panel-metrics')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(qa.getState().metricsOverlay).toBe(true);
    expect(mini()).not.toBeNull();
    expect(panel()!.find('panel-metrics')!.textContent).toBe('ON');
  });

  it('5 + 6. closing the full panel keeps the overlay; OFF removes it; dispose removes it', async () => {
    const { qa, panel, mini, doc } = setup();
    qa.open();
    await qa.run('panel.metrics.set', { value: true });
    panel()!.find('close')!.click();
    expect(panel()).toBeNull();
    expect(mini()).not.toBeNull();
    expect(qa.getState()).toMatchObject({ open: false, metricsOverlay: true });
    await qa.run('panel.metrics.set', { value: false });
    expect(mini()).toBeNull();
    await qa.run('panel.metrics.set', { value: true });
    qa.dispose();
    expect(doc.body.children).toHaveLength(0);
  });

  it('7. FPS / frame come from the ONE sampler (frame(ms)): the overlay changes only on its sample', async () => {
    const { qa, mini } = setup();
    await qa.run('panel.metrics.set', { value: true });
    const text = () => mini()!.find('mini-metrics-text')!.textContent;
    expect(text()).toBe('FPS N/A\nN/A ms\nMEM N/A');
    feed(qa, 20, 24); // 480 ms: no sample yet
    expect(text()).toBe('FPS N/A\nN/A ms\nMEM N/A');
    feed(qa, 20, 1); // 500 ms → the runtime's sample
    const m = qa.getState().metrics;
    expect(m).toMatchObject({ fps: 50, frameMs: 20 });
    expect(text()).toBe(formatMiniMetrics(m));
    expect(text()).toBe('FPS 50\n20 ms\nMEM N/A');
  });

  it('8. memory: N/A when the browser has none, MB when it has', async () => {
    expect(formatMiniMetrics({ fps: 59.4, frameMs: 16.9, frameMaxMs: 20, memory: null })).toBe('FPS 59\n16.9 ms\nMEM N/A');
    const { qa, mini } = setup({ memory: () => ({ usedJSHeapSize: 82 * 1048576, totalJSHeapSize: 100 * 1048576, jsHeapSizeLimit: 4096 * 1048576 }) });
    await qa.run('panel.metrics.set', { value: true });
    expect(mini()!.find('mini-metrics-text')!.textContent).toBe('FPS N/A\nN/A ms\nMEM 82 MB');
  });

  it('9. takes no input: pointer-events none, fixed, bottom-left inside the safe area, under the panel', async () => {
    const { qa, mini } = setup();
    await qa.run('panel.metrics.set', { value: true });
    const css = mini()!.styleText().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.gcqa-mini\{position:fixed;left:calc\(4px \+ env\(safe-area-inset-left\)\);bottom:calc\(4px \+ env\(safe-area-inset-bottom\)\);z-index:2147482900;/);
    expect(css).toMatch(/pointer-events:none/);
    expect(mini()!.attributes['aria-hidden']).toBe('true');
    expect(mini()!.listeners.size).toBe(0);
  });

  it('11. production isolation unchanged: the root / pixi entries carry none of it; its marker is the panel marker family', () => {
    for (const entry of [root, pixi]) expect(Object.keys(entry).filter((name) => /qa|Metrics(Overlay)?View|NetworkFault/i.test(name))).toEqual([]);
    expect(QA_METRICS_ATTRIBUTE.startsWith(QA_PANEL_ATTRIBUTE)).toBe(true); // release scans for `data-game-core-qa` catch the overlay too
  });
});
