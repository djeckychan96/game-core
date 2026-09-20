import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Application, Container, EventBoundary, Rectangle, Ticker } from 'pixi.js';
import 'pixi.js/events'; // the FederatedContainer mixin a browser gets during renderer detection
import { createKit } from './setup';
import * as pixiEntry from '../../src/pixi/index';
import * as rootEntry from '../../src/index';
import { createReadyUiOverlay, type ReadyUiOverlayOptions } from '../../src/pixi/ReadyUiOverlay';

// --- a DOM just big enough for the overlay: elements, styles, listeners, a window with a DPR and a safe area ---
class FakeElement {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  width = 0;
  height = 0;
  clientWidth = 0;
  clientHeight = 0;
  rect = { left: 0, top: 0 };
  listeners = new Map<string, Set<unknown>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  addEventListener(type: string, listener: unknown): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: unknown): void {
    this.listeners.get(type)?.delete(listener);
  }
  getBoundingClientRect() {
    return { left: this.rect.left, top: this.rect.top, width: this.clientWidth, height: this.clientHeight };
  }
}

class FakeDocument {
  defaultView = {
    devicePixelRatio: 2,
    innerWidth: 390,
    innerHeight: 844,
    safePadding: { paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' },
    getComputedStyle: (_el: FakeElement) => this.defaultView.safePadding
  };
  body = new FakeElement('body', this);
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

function createFakeApp(doc: FakeDocument) {
  const canvas = doc.createElement('canvas');
  const stage = new Container();
  const boundary = new EventBoundary(stage);
  boundary.rootTarget = null as never; // like Pixi before its first pointer event
  const app = {
    canvas,
    stage,
    ticker: new Ticker(),
    initOptions: null as Record<string, unknown> | null,
    renders: 0,
    stops: 0,
    destroys: [] as unknown[][],
    resizes: [] as number[][],
    renderer: {
      events: {
        domElement: null as FakeElement | null,
        rootBoundary: boundary,
        setTargetElement(element: FakeElement | null) { this.domElement = element; },
        mapPositionToPoint(point: { x: number; y: number }, x: number, y: number) { point.x = x; point.y = y; }
      },
      resize(w: number, h: number, resolution: number) {
        app.resizes.push([w, h, resolution]);
        canvas.width = w * resolution;
        canvas.height = h * resolution;
      }
    },
    async init(options: Record<string, unknown>) { app.initOptions = options; },
    stop() { app.stops++; },
    render() { app.renders++; },
    destroy(...args: unknown[]) { app.destroys.push(args); }
  };
  return app;
}

function setup(extra: Partial<ReadyUiOverlayOptions> = {}, host: 'container' | 'body' = 'container', loaded = true) {
  const doc = new FakeDocument();
  const container = host === 'body' ? doc.body : doc.createElement('div');
  container.clientWidth = 320;
  container.clientHeight = 480;
  const gameplay = doc.createElement('div');
  container.append(gameplay);
  const app = createFakeApp(doc);
  const kit = createKit();
  const create = () => createReadyUiOverlay({
    container: container as unknown as HTMLElement,
    ...(loaded ? { textures: kit.textures } : {}),
    createApplication: () => app as unknown as Application,
    ...extra
  });
  return { doc, container, gameplay, app, kit, create };
}

const interactive = (x: number, y: number, w: number, h: number): Container => {
  const node = new Container();
  node.eventMode = 'static';
  node.hitArea = new Rectangle(x, y, w, h);
  return node;
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const ticker of [Ticker.system, Ticker.shared]) {
    ticker.stop();
    ticker.autoStart = true;
  }
});

describe('ReadyUiOverlay', () => {
  it('mounts a transparent, never-started Application as the last child of the host container', async () => {
    const { container, gameplay, app, create, kit } = setup({ zIndex: 7 });
    const overlay = await create();
    expect(app.initOptions).toMatchObject({ backgroundAlpha: 0, autoStart: false, sharedTicker: false, autoDensity: true, resolution: 2 });
    expect(app.stops).toBe(1);
    expect(container.children).toEqual([gameplay, overlay.layer]);
    const layer = overlay.layer as unknown as FakeElement;
    expect(layer.style).toMatchObject({ position: 'absolute', zIndex: '7', pointerEvents: 'none' });
    expect(layer.children.slice(0, 2)).toEqual([overlay.canvas, overlay.hitLayer]);
    expect((overlay.canvas as unknown as FakeElement).style.pointerEvents).toBe('none');
    expect(app.renderer.events.domElement).toBe(overlay.hitLayer);
    expect(app.stage.children).toEqual([overlay.root]);
    expect(overlay.textures).toBe(kit.textures);
    expect(gameplay.style).toEqual({}); // the gameplay DOM is not touched
    expect(container.style).toEqual({});
  });

  it('document.body is the full-viewport case: fixed layer, window size', async () => {
    const { create } = setup({}, 'body');
    const overlay = await create();
    expect((overlay.layer as unknown as FakeElement).style.position).toBe('fixed');
    expect(overlay.layout).toMatchObject({ width: 390, height: 844 });
  });

  it('never requests an animation frame: Pixi tickers stay stopped and move only with update()', async () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { app, kit, create } = setup();
    const overlay = await create();
    const order: string[] = [];
    const deltas: number[] = [];
    const onSystem = (ticker: Ticker) => { order.push('pixi'); deltas.push(ticker.elapsedMS); };
    Ticker.system.add(onSystem);
    const target = { x: 0 };
    kit.motion.tween({ bindings: [{ get: () => target.x, set: (value) => { target.x = value; }, to: 100 }], durationMs: 100, ease: 'linear' });
    const hosted = await setup({ core: { update: (ms) => { order.push('core'); return kit.core.update(ms); } } }).create();
    hosted.update(16); // (first step of a fresh ticker only anchors its clock)
    hosted.update(50);
    expect(order.slice(-2)).toEqual(['core', 'pixi']);
    expect(deltas.at(-1)).toBe(50);
    expect(target.x).toBeGreaterThan(0);
    expect(target.x).toBeLessThan(100);
    overlay.update(16);
    expect(app.renders).toBe(1);
    expect([Ticker.system.started, Ticker.shared.started, app.ticker.started]).toEqual([false, false, false]);
    expect(raf).not.toHaveBeenCalled();
    Ticker.system.remove(onSystem);
  });

  it('resize(): measures the container, clamps the DPR, mirrors the hit layer, reports the safe area', async () => {
    const { doc, container, app, create } = setup();
    const overlay = await create();
    expect(app.resizes.at(-1)).toEqual([320, 480, 2]);
    doc.defaultView.devicePixelRatio = 3;
    container.clientWidth = 480;
    container.clientHeight = 320;
    const layer = overlay.layer as unknown as FakeElement;
    layer.clientWidth = 480;
    layer.rect = { left: 0, top: 30 }; // the container starts 30 px below the viewport top
    doc.defaultView.innerWidth = 480;
    doc.defaultView.innerHeight = 350;
    doc.defaultView.safePadding = { paddingTop: '47px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '44px' };
    const layout = overlay.resize();
    expect(layout).toEqual({ width: 480, height: 320, resolution: 2, safeArea: { top: 17, right: 0, bottom: 34, left: 44 } });
    expect(overlay.hitLayer.width).toBe(960);
    expect((overlay.hitLayer as unknown as FakeElement).style).toMatchObject({ width: '480px', height: '320px' });
    expect(overlay.resize(200, 100)).toMatchObject({ width: 200, height: 100 });
    const fixed = await setup({ safeArea: () => ({ top: 1, right: 2, bottom: 3, left: 4 }), maxResolution: 1 }).create();
    expect(fixed.layout).toMatchObject({ resolution: 1, safeArea: { top: 1, right: 2, bottom: 3, left: 4 } });
  });

  it('hosts views on one root: add / remove', async () => {
    const overlay = await setup().create();
    const a = overlay.add(new Container());
    const b = overlay.add(new Container());
    expect(overlay.root.children).toEqual([a, b]);
    overlay.remove(a);
    expect(overlay.root.children).toEqual([b]);
  });

  it("input: 'passthrough' gives everything to the gameplay, 'ui' only takes its regions, 'modal' takes all", async () => {
    const overlay = await setup().create();
    const hit = (overlay.hitLayer as unknown as FakeElement).style;
    const button = overlay.add(interactive(10, 10, 100, 40));
    expect(overlay.inputMode).toBe('ui');
    expect(hit.pointerEvents).toBe('none'); // 'ui' without a region takes nothing
    overlay.setInteractiveRegions([{ x: 0, y: 0, width: 320, height: 60 }, { getBounds: () => ({ x: 5, y: 400, width: 50, height: 50 }) }]);
    expect(hit).toMatchObject({ pointerEvents: 'auto', clipPath: 'path("M0 0h320v60h-320ZM5 400h50v50h-50Z")' });
    expect(overlay.hitTest(20, 20)).toBe(button);
    expect(overlay.hitTest(200, 200)).toBeNull();
    expect(overlay.isBlocking).toBe(false);

    overlay.setInputMode('passthrough');
    expect(hit).toMatchObject({ pointerEvents: 'none', clipPath: 'none' });
    expect(overlay.root.eventMode).toBe('none');
    expect(overlay.hitTest(20, 20)).toBeNull();

    overlay.setInputMode('modal');
    expect(hit).toMatchObject({ pointerEvents: 'auto', clipPath: 'none' });
    expect(overlay.isBlocking).toBe(true);
    expect(overlay.hitTest(20, 20)).toBe(button);

    overlay.visible = false;
    expect((overlay.layer as unknown as FakeElement).style.display).toBe('none');
    expect(hit.pointerEvents).toBe('none');
  });

  it('a blocking UiRuntime window turns the overlay modal and gives the gameplay back when it closes', async () => {
    let blocking = false;
    const { app, create } = setup({ ui: { isBlocking: () => blocking }, inputMode: 'passthrough' });
    const overlay = await create();
    const hit = (overlay.hitLayer as unknown as FakeElement).style;
    blocking = true;
    overlay.update(16);
    expect(overlay.isBlocking).toBe(true);
    expect(hit).toMatchObject({ pointerEvents: 'auto', clipPath: 'none' });
    expect(overlay.root.eventMode).toBe('passive');
    blocking = false;
    overlay.update(16);
    expect(overlay.isBlocking).toBe(false);
    expect(hit.pointerEvents).toBe('none');
    overlay.visible = false;
    overlay.update(16);
    expect(app.renders).toBe(2); // hidden: the clock still runs, nothing is drawn
  });

  it('dispose(): removes only its own layer, destroys the Application once, returns the global tickers, is repeat-safe', async () => {
    const { container, gameplay, app, create } = setup();
    expect(Ticker.system.autoStart).toBe(true);
    const overlay = await create();
    expect([Ticker.system.autoStart, Ticker.shared.autoStart]).toEqual([false, false]);
    const hitLayer = overlay.hitLayer as unknown as FakeElement;
    expect(hitLayer.listeners.get('contextmenu')?.size).toBe(1);
    overlay.dispose();
    overlay.dispose();
    expect(app.destroys).toEqual([[{ removeView: true }, { children: true }]]);
    expect(container.children).toEqual([gameplay]);
    expect(hitLayer.listeners.get('contextmenu')?.size).toBe(0);
    expect([Ticker.system.autoStart, Ticker.shared.autoStart]).toEqual([true, true]);
    expect(overlay.disposed).toBe(true);
    overlay.update(16);
    overlay.resize(10, 10);
    overlay.setInputMode('modal');
    expect(app.renders).toBe(0);
    expect(overlay.layout.width).toBe(320);
  });

  it('driveSharedTickers:false leaves the global Pixi tickers alone; a failed asset load leaves nothing behind', async () => {
    const left = setup({ driveSharedTickers: false });
    await left.create();
    expect(Ticker.system.autoStart).toBe(true);
    const failing = setup({ assets: { baseUrl: '/nowhere/' } }, 'container', false); // the test adapter has no fetch
    await expect(failing.create()).rejects.toBeDefined();
    expect(failing.container.children).toEqual([failing.gameplay]);
    expect(failing.app.destroys.length).toBe(1);
    expect(Ticker.system.autoStart).toBe(true);
    const bare = await setup({ assets: false }, 'container', false).create();
    expect(() => bare.textures).toThrow(/no textures/);
  });

  it('is public only through game-core/pixi and imports nothing from the root runtime', () => {
    expect(pixiEntry).toHaveProperty('createReadyUiOverlay');
    expect(pixiEntry).toHaveProperty('ReadyUiOverlay');
    expect(Object.keys(rootEntry)).not.toContain('createReadyUiOverlay');
    expect(Object.keys(rootEntry)).not.toContain('ReadyUiOverlay');
    const source = readFileSync(resolve(__dirname, '../../src/pixi/ReadyUiOverlay.ts'), 'utf-8');
    const imports = source.match(/^import[^;]*;/gm) ?? [];
    expect(imports.map((line) => /from '([^']+)'/.exec(line)?.[1])).toEqual(['pixi.js', 'pixi.js', './assets', './assets', './theme']);
    expect(source).not.toMatch(/requestAnimationFrame\(|setTimeout\(|setInterval\(|ResizeObserver|(window|document)\.addEventListener/);
  });
});
