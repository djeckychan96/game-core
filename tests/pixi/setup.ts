// Headless Pixi for the kit tests: PixiJS 8 scene objects work in Node except canvas text
// measurement, which goes through DOMAdapter. A tiny fake 2D context gives deterministic metrics
// so Text/labels can be created and measured without a browser or the `canvas` package.
import { DOMAdapter, Texture } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from '../../src/index';
import { createReadyUiTextures, type ReadyUiTextures } from '../../src/pixi/assets';

function fontSizeOf(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 16;
}

class FakeContext2D {
  font = '';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  textBaseline = 'alphabetic';
  textAlign = 'left';
  letterSpacing = '0px';
  globalAlpha = 1;
  constructor(readonly canvas: FakeCanvas) {}
  measureText(text: string) {
    const size = fontSizeOf(this.font);
    const width = text.length * size * 0.56;
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: size * 0.78,
      actualBoundingBoxDescent: size * 0.24,
      fontBoundingBoxAscent: size * 0.9,
      fontBoundingBoxDescent: size * 0.25
    };
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
  }
  fillText(): void {}
  strokeText(): void {}
  fillRect(): void {}
  clearRect(): void {}
  strokeRect(): void {}
  save(): void {}
  restore(): void {}
  scale(): void {}
  translate(): void {}
  rotate(): void {}
  setTransform(): void {}
  resetTransform(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  drawImage(): void {}
  createLinearGradient() { return { addColorStop(): void {} }; }
  createRadialGradient() { return { addColorStop(): void {} }; }
  createPattern() { return null; }
}

class FakeCanvas {
  private context: FakeContext2D | null = null;
  constructor(public width = 1, public height = 1) {}
  getContext(type: string) {
    if (type !== '2d') return null;
    if (!this.context) this.context = new FakeContext2D(this);
    return this.context;
  }
  toDataURL() { return ''; }
}

let installed = false;

/** Installs the fake adapter once per test process. */
export function installPixiTestAdapter(): void {
  if (installed) return;
  installed = true;
  DOMAdapter.set({
    createCanvas: (width?: number, height?: number) => new FakeCanvas(width, height) as unknown as HTMLCanvasElement,
    createImage: () => ({}) as HTMLImageElement,
    getCanvasRenderingContext2D: () => ({ prototype: FakeContext2D.prototype }) as unknown as { prototype: CanvasRenderingContext2D },
    getWebGLRenderingContext: () => (class {}) as unknown as typeof WebGLRenderingContext,
    getNavigator: () => ({ userAgent: 'node-test', gpu: null }),
    getBaseUrl: () => '/',
    getFontFaceSet: () => null,
    fetch: () => Promise.reject(new Error('no fetch in tests')),
    parseXML: () => { throw new Error('no XML in tests'); }
  });
}

installPixiTestAdapter();

export interface TestKit {
  core: CoreRuntime;
  motion: MotionRuntime;
  ui: UiRuntime;
  textures: ReadyUiTextures;
  uiErrors: unknown[];
  motionErrors: unknown[];
}

/** One CoreRuntime + MotionRuntime + UiRuntime wired like the showcase host, plus white textures. */
export function createKit(): TestKit {
  const core = new CoreRuntime();
  const motionErrors: unknown[] = [];
  const uiErrors: unknown[] = [];
  const motion = new MotionRuntime({ onMotionError: (error, context) => motionErrors.push({ error, context }) });
  const ui = new UiRuntime({ motion, onUiError: (error, context) => uiErrors.push({ error, context }) });
  core.registerRuntime('ui', ui);
  core.registerRuntime('motion', motion);
  return { core, motion, ui, textures: createReadyUiTextures(Texture.WHITE), uiErrors, motionErrors };
}

/** A minimal FederatedPointerEvent stand-in for `container.emit(...)`. */
export function pointer(x = 0, y = 0, pointerId = 1) {
  return { pointerId, global: { x, y }, deltaY: 0, stopPropagation(): void {}, stopImmediatePropagation(): void {} };
}

/** Advances the host clock in fixed steps. */
export function advance(core: CoreRuntime, totalMs: number, stepMs = 16): void {
  let left = totalMs;
  while (left > 0) {
    const step = Math.min(stepMs, left);
    core.update(step);
    left -= step;
  }
}
