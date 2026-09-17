// ReadyUiOverlay — the reusable host infrastructure for putting the Pixi Ready UI over a game that is NOT drawn with Pixi
// (DOM gameplay, a Three.js canvas, any other renderer). Extracted from the Gorodki integration, where this boilerplate was
// ~130 of the ~210 lines of `game-core-ui.js`.
//
// It owns: one transparent Pixi Application, its canvas + hit layer inside the host's container, DPR / resolution, the
// host-callable resize with safe-area insets, the manual clock, the Ready UI asset load, visibility, the input policy and
// dispose. It knows nothing about a game: no state, no economy, no navigation, no platform — the game adds its own views to
// `overlay.root` and lays them out with the numbers `overlay.resize()` returns.
//
// Clock: host-driven, ONE frame source. `overlay.update(frameMs)` is called from the host's existing loop; the Application
// never starts its ticker, and Pixi's global `Ticker.system` / `Ticker.shared` (the renderer's scheduler and the event
// ticker subscribe to them and would auto-start a second requestAnimationFrame loop during `init`) are disarmed before init
// and advanced from `update()`. This module creates no requestAnimationFrame, no timer, no observer and no listener on
// `window` / `document`.
//
// Input: native DOM hit testing, no synthetic events. The render canvas never takes input (`pointer-events: none`); Pixi
// listens on a transparent hit layer above it, and the mode decides where that layer exists for the browser:
//   'passthrough' — nowhere: every tap / drag / click / wheel reaches the gameplay below;
//   'ui'          — only inside the interactive regions (`clip-path`): Ready UI buttons work, the rest is gameplay;
//   'modal'       — everywhere: the gameplay below receives nothing. Entered automatically while `ui.isBlocking()`.
import { Application, Container, Ticker } from 'pixi.js';
import type { ApplicationOptions } from 'pixi.js';
import { loadReadyUiAssets } from './assets';
import type { LoadReadyUiAssetsOptions, ReadyUiTextures } from './assets';

export type ReadyUiOverlayInputMode = 'passthrough' | 'ui' | 'modal';

export interface ReadyUiOverlayInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What `resize()` measured — everything a game needs for `view.resize(width, height, { insets, pixelRatio })`. */
export interface ReadyUiOverlayLayout {
  /** Overlay size in CSS px (= Pixi screen units). */
  width: number;
  height: number;
  /** Renderer resolution (clamped device pixel ratio). */
  resolution: number;
  /** Device safe area that falls INSIDE the overlay, CSS px. */
  safeArea: ReadyUiOverlayInsets;
}

/** A rectangle in overlay CSS px, or a Pixi object whose bounds are re-read on every `resize()` / input change. */
export type ReadyUiOverlayRegion =
  | { x: number; y: number; width: number; height: number }
  | { getBounds(): { x: number; y: number; width: number; height: number } };

export interface ReadyUiOverlayOptions {
  /**
   * Host element the overlay is appended to (as its last child). It must establish a containing block
   * (`position: relative | absolute | fixed`); the helper never restyles it. `document.body` is the full-viewport case:
   * the layer is `position: fixed` and sized from the window.
   */
  container: HTMLElement;
  /** Ready UI art to load during creation (`loadReadyUiAssets` options); `false` = load nothing. Default `{}`. */
  assets?: LoadReadyUiAssetsOptions | false;
  /** Already loaded textures — skips the load. */
  textures?: ReadyUiTextures;
  /** `CoreRuntime` (or anything with `update`) advanced first in `overlay.update(frameMs)`. The host keeps owning it. */
  core?: { update(frameMs: number): unknown };
  /** `UiRuntime` (or anything with `isBlocking`): while it blocks, the effective input mode is 'modal'. */
  ui?: { isBlocking(): boolean };
  /** Input mode outside of modal blocking. Default 'ui'. */
  inputMode?: ReadyUiOverlayInputMode;
  /** z-index of the overlay layer inside the container. Default 10. */
  zIndex?: number;
  /** Upper clamp for the device pixel ratio. Default 2. */
  maxResolution?: number;
  /** Fixed insets, or a reader; default = CSS `env(safe-area-inset-*)` clipped to the overlay's box. */
  safeArea?: ReadyUiOverlayInsets | (() => ReadyUiOverlayInsets);
  /**
   * `false` leaves Pixi's global `Ticker.system` / `Ticker.shared` alone (a page that already runs another Pixi
   * application on them). Default `true`: they are stopped and advanced from `update()`.
   */
  driveSharedTickers?: boolean;
  /** Extra Pixi `Application.init` options (antialias, preference …). Size, resolution, transparency and the stopped ticker are enforced. */
  appOptions?: Partial<ApplicationOptions>;
  /** Application factory — a seam for tests and Application subclasses. */
  createApplication?: () => Application;
}

interface ManagedTicker {
  ticker: Ticker;
  autoStart: boolean;
  started: boolean;
}

const ZERO_INSETS: ReadyUiOverlayInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const SHARED_TICKERS = (): Ticker[] => [Ticker.system, Ticker.shared];

export class ReadyUiOverlay {
  /** The Pixi Application (never started). Exposed for host diagnostics and custom rendering needs. */
  readonly app: Application;
  /** Game views go here (`overlay.add(view)`); draw order = insertion order. */
  readonly root = new Container();
  /** Wrapper element inside the container: render canvas + hit layer + safe-area probe. */
  readonly layer: HTMLElement;
  /** The transparent render canvas (`pointer-events: none`). */
  readonly canvas: HTMLCanvasElement;
  /** The transparent element Pixi listens on; the input mode decides where it takes pointer input. */
  readonly hitLayer: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly win: Window;
  private readonly core: { update(frameMs: number): unknown } | null;
  private readonly ui: { isBlocking(): boolean } | null;
  private readonly maxResolution: number;
  private readonly safeAreaSource: ReadyUiOverlayOptions['safeArea'];
  private readonly probe: HTMLElement | null;
  private readonly tickers: ManagedTicker[];
  private readonly loadedTextures: ReadyUiTextures | null;
  private mode: ReadyUiOverlayInputMode;
  private regions: ReadonlyArray<ReadyUiOverlayRegion> = [];
  private blocking = false;
  private shown = true;
  private clockMs = 0;
  private current: ReadyUiOverlayLayout = { width: 1, height: 1, resolution: 1, safeArea: ZERO_INSETS };
  private isDisposed = false;
  private readonly onContextMenu = (event: Event): void => event.preventDefault();

  /** Use `createReadyUiOverlay(options)`; the constructor only assembles what the factory prepared. */
  constructor(app: Application, options: ReadyUiOverlayOptions, tickers: ManagedTicker[] = [], textures: ReadyUiTextures | null = null) {
    this.app = app;
    this.loadedTextures = textures;
    this.container = options.container;
    const doc = this.container.ownerDocument;
    this.win = doc.defaultView as Window;
    this.core = options.core ?? null;
    this.ui = options.ui ?? null;
    this.mode = options.inputMode ?? 'ui';
    this.maxResolution = options.maxResolution ?? 2;
    this.safeAreaSource = options.safeArea;
    this.tickers = tickers;
    this.clockMs = Math.max(0, ...tickers.map((entry) => entry.ticker.lastTime));

    const fixed = this.container === doc.body;
    this.layer = doc.createElement('div');
    this.layer.dataset.gameCore = 'ready-ui-overlay';
    Object.assign(this.layer.style, {
      position: fixed ? 'fixed' : 'absolute', left: '0', top: '0', width: '100%', height: '100%',
      zIndex: String(options.zIndex ?? 10), overflow: 'hidden', pointerEvents: 'none'
    });
    this.canvas = app.canvas as HTMLCanvasElement;
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', display: 'block', pointerEvents: 'none' });
    // A <canvas> (never drawn, no context) because Pixi maps client coordinates through the target's width / height attributes.
    this.hitLayer = doc.createElement('canvas');
    Object.assign(this.hitLayer.style, { position: 'absolute', left: '0', top: '0', display: 'block', touchAction: 'none' });
    this.hitLayer.addEventListener('contextmenu', this.onContextMenu);
    this.layer.append(this.canvas, this.hitLayer);
    if (this.safeAreaSource === undefined) {
      // env() is only readable through CSS: an invisible element whose padding is the device safe area.
      this.probe = doc.createElement('div');
      this.probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      this.layer.append(this.probe);
    } else {
      this.probe = null;
    }
    this.container.append(this.layer);
    app.renderer.events.setTargetElement(this.hitLayer);
    app.stage.addChild(this.root);
    this.resize();
  }

  /** Ready UI textures loaded during creation (or passed in). Throws when the overlay was created with `assets: false`. */
  get textures(): ReadyUiTextures {
    if (!this.loadedTextures) throw new Error('ReadyUiOverlay: no textures — created with assets:false and no textures option');
    return this.loadedTextures;
  }

  get layout(): ReadyUiOverlayLayout {
    return this.current;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** The mode the host asked for (see `isBlocking` for the modal override). */
  get inputMode(): ReadyUiOverlayInputMode {
    return this.mode;
  }

  /** True while the gameplay below must not react: host-set 'modal', or the `ui` runtime reports a blocking window. */
  get isBlocking(): boolean {
    return this.mode === 'modal' || this.blocking;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** A hidden overlay is not rendered and takes no input; `update()` still advances the clock. */
  set visible(value: boolean) {
    if (this.shown === value || this.isDisposed) return;
    this.shown = value;
    this.layer.style.display = value ? '' : 'none';
    this.applyInput();
  }

  add<T extends Container>(view: T): T {
    this.root.addChild(view);
    return view;
  }

  remove<T extends Container>(view: T): T {
    this.root.removeChild(view);
    return view;
  }

  setInputMode(mode: ReadyUiOverlayInputMode): void {
    this.mode = mode;
    this.applyInput();
  }

  /** Where the 'ui' mode takes pointer input (typically the HUD). Everything else passes through to the gameplay. */
  setInteractiveRegions(regions: ReadonlyArray<ReadyUiOverlayRegion>): void {
    this.regions = [...regions];
    this.applyInput();
  }

  /**
   * Once per host frame, from the host's own loop: the optional core runtime, then Pixi's stopped global tickers on a
   * clock made of the host's frame times, then the modal sync, then one render.
   */
  update(frameMs: number): void {
    if (this.isDisposed) return;
    this.core?.update(frameMs);
    this.clockMs += Math.max(0, frameMs);
    for (const entry of this.tickers) entry.ticker.update(this.clockMs);
    const blocking = this.ui?.isBlocking() ?? false;
    if (blocking !== this.blocking) {
      this.blocking = blocking;
      this.applyInput();
    }
    this.render();
  }

  /** One extra draw outside `update()` (after a resize while the host loop is paused). */
  render(): void {
    if (!this.isDisposed && this.shown) this.app.render();
  }

  /**
   * Host-callable (window resize, orientation change, container change). Without arguments the container is measured
   * (`document.body` → the window). Re-reads the device pixel ratio and the safe area; returns the numbers for view layout.
   */
  resize(width?: number, height?: number): ReadyUiOverlayLayout {
    if (this.isDisposed) return this.current;
    const body = this.container === this.container.ownerDocument.body;
    const w = Math.max(1, Math.round(width ?? (body ? this.win.innerWidth : this.container.clientWidth)));
    const h = Math.max(1, Math.round(height ?? (body ? this.win.innerHeight : this.container.clientHeight)));
    const resolution = Math.min(Math.max(this.win.devicePixelRatio || 1, 1), this.maxResolution);
    this.app.renderer.resize(w, h, resolution);
    this.hitLayer.width = this.canvas.width;
    this.hitLayer.height = this.canvas.height;
    Object.assign(this.hitLayer.style, { width: `${w}px`, height: `${h}px` });
    this.current = { width: w, height: h, resolution, safeArea: this.readSafeArea(w, h) };
    this.applyInput();
    return this.current;
  }

  /** The Ready UI element under a client point, or null — for hosts that gate coordinate-based gameplay input themselves. */
  hitTest(clientX: number, clientY: number): Container | null {
    if (this.isDisposed || !this.shown || this.mode === 'passthrough') return null;
    const events = this.app.renderer.events;
    // Pixi assigns the boundary's root when it handles its first pointer event; a hit test asked before that starts from the stage.
    if (!events.rootBoundary.rootTarget) events.rootBoundary.rootTarget = this.app.stage;
    const point = { x: 0, y: 0 };
    events.mapPositionToPoint(point, clientX, clientY);
    return (events.rootBoundary.hitTest(point.x, point.y) as Container | null) ?? null;
  }

  /** Removes the layer, destroys the Application (and the views still on `root`), gives the global tickers back. Repeat-safe. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.hitLayer.removeEventListener('contextmenu', this.onContextMenu);
    this.app.destroy({ removeView: true }, { children: true });
    this.layer.remove();
    for (const entry of this.tickers) {
      entry.ticker.autoStart = entry.autoStart;
      if (entry.started) entry.ticker.start();
    }
  }

  private readSafeArea(width: number, height: number): ReadyUiOverlayInsets {
    const source = this.safeAreaSource;
    if (typeof source === 'function') return source();
    if (source) return source;
    if (!this.probe) return ZERO_INSETS;
    const style = this.win.getComputedStyle(this.probe);
    const px = (value: string): number => Math.max(0, parseFloat(value) || 0);
    // env() describes the viewport; only the part of it that overlaps this overlay's box insets the UI
    const rect = this.layer.getBoundingClientRect();
    return {
      top: Math.max(0, px(style.paddingTop) - rect.top),
      left: Math.max(0, px(style.paddingLeft) - rect.left),
      right: Math.max(0, px(style.paddingRight) - (this.win.innerWidth - rect.left - width)),
      bottom: Math.max(0, px(style.paddingBottom) - (this.win.innerHeight - rect.top - height))
    };
  }

  /** The whole input policy: where the hit layer exists for the browser's own hit testing. */
  private applyInput(): void {
    if (this.isDisposed) return;
    const style = this.hitLayer.style;
    const mode = this.isBlocking ? 'modal' : this.mode;
    this.root.eventMode = mode === 'passthrough' ? 'none' : 'passive';
    if (!this.shown || mode === 'passthrough') {
      style.pointerEvents = 'none';
      style.clipPath = 'none';
      return;
    }
    if (mode === 'modal') {
      style.pointerEvents = 'auto';
      style.clipPath = 'none';
      return;
    }
    const path = this.regions
      .map((region) => ('getBounds' in region ? region.getBounds() : region))
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => `M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}Z`)
      .join('');
    style.pointerEvents = path ? 'auto' : 'none';
    style.clipPath = path ? `path("${path}")` : 'none';
  }
}

/**
 * Creates the overlay: disarms Pixi's global tickers, initialises a transparent, never-started Application sized to the
 * container, loads the Ready UI art in parallel, mounts the layer. The host then adds views and calls `update` / `resize`.
 */
export async function createReadyUiOverlay(options: ReadyUiOverlayOptions): Promise<ReadyUiOverlay> {
  const tickers: ManagedTicker[] = options.driveSharedTickers === false
    ? []
    : SHARED_TICKERS().map((ticker) => ({ ticker, autoStart: ticker.autoStart, started: ticker.started }));
  // Before init: the renderer's scheduler subscribes to Ticker.system inside init() and an armed ticker would start its own rAF loop.
  for (const { ticker } of tickers) {
    ticker.autoStart = false;
    ticker.stop();
  }
  const app = options.createApplication ? options.createApplication() : new Application();
  const texturesReady: Promise<ReadyUiTextures | null> = options.textures
    ? Promise.resolve(options.textures)
    : options.assets === false ? Promise.resolve(null) : loadReadyUiAssets(options.assets ?? {});
  const win = options.container.ownerDocument.defaultView as Window;
  const appReady = app.init({
    antialias: true,
    preference: 'webgl',
    powerPreference: 'high-performance',
    ...options.appOptions,
    width: 1,
    height: 1,
    resolution: Math.min(Math.max(win.devicePixelRatio || 1, 1), options.maxResolution ?? 2),
    autoDensity: true,
    backgroundAlpha: 0,
    autoStart: false,
    sharedTicker: false
  });
  let textures: ReadyUiTextures | null;
  try {
    [textures] = await Promise.all([texturesReady, appReady]);
  } catch (error) {
    // a failed creation leaves nothing behind: no canvas, and the global tickers as they were
    await appReady.then(() => app.destroy({ removeView: true }), () => undefined);
    for (const entry of tickers) {
      entry.ticker.autoStart = entry.autoStart;
      if (entry.started) entry.ticker.start();
    }
    throw error;
  }
  app.stop();
  return new ReadyUiOverlay(app, options, tickers, textures);
}
