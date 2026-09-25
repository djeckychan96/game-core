import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pixiEntry from '../../src/pixi/index';
import { ORIENTATION_GUARD_QUERY, createOrientationGuard, type OrientationGuardOptions } from '../../src/pixi/OrientationGuard';

// --- a device: a viewport size and a primary pointer, evaluated by a tiny media-query engine (only `and` + `(feature: value)`),
// so the tests pin what the guard's query MEANS instead of trusting a hard-coded `matches` ---
interface Device { width: number; height: number; pointer: 'coarse' | 'fine' }

class FakeMediaQueryList {
  readonly listeners = new Set<() => void>();
  readonly legacyListeners = new Set<() => void>();
  constructor(readonly media: string, private readonly device: Device, private readonly legacyOnly = false) {
    if (legacyOnly) {
      (this as { addEventListener?: unknown }).addEventListener = undefined;
      (this as { removeEventListener?: unknown }).removeEventListener = undefined;
    }
  }
  get matches(): boolean {
    return this.media.split(/\s+and\s+/).every((term) => {
      const [, feature, value] = /^\(\s*([a-z-]+)\s*:\s*([a-z-]+)\s*\)$/.exec(term.trim()) ?? [];
      if (feature === 'orientation') return value === (this.device.width > this.device.height ? 'landscape' : 'portrait');
      if (feature === 'pointer') return value === this.device.pointer;
      throw new Error(`fake media engine: unsupported term ${term}`);
    });
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'change') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === 'change') this.listeners.delete(listener);
  }
  addListener(listener: () => void): void {
    this.legacyListeners.add(listener);
  }
  removeListener(listener: () => void): void {
    this.legacyListeners.delete(listener);
  }
}

class FakeElement {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  innerHTML = '';
  listeners = new Map<string, Set<{ listener: (event: unknown) => void; options: unknown }>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add({ listener, options });
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type);
    for (const entry of set ?? []) if (entry.listener === listener) set!.delete(entry);
  }
  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
  /** What the browser does for an event whose hit-test target is this element: its own listeners run. */
  dispatch(type: string) {
    const event = { type, cancelable: true, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
    for (const { listener } of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

class FakeDocument {
  readonly queries: FakeMediaQueryList[] = [];
  readonly defaultView: { matchMedia?: (query: string) => FakeMediaQueryList };
  body = new FakeElement('body', this);
  constructor(readonly device: Device, options: { matchMedia?: boolean; legacyOnly?: boolean } = {}) {
    this.defaultView = options.matchMedia === false ? {} : {
      matchMedia: (query: string) => {
        const list = new FakeMediaQueryList(query, this.device, options.legacyOnly);
        this.queries.push(list);
        return list;
      }
    };
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  /** Resize / rotate the viewport; like a browser, only a list whose `matches` flipped fires `change`. */
  resize(width: number, height: number, pointer: Device['pointer'] = this.device.pointer): void {
    const before = this.queries.map((list) => list.matches);
    Object.assign(this.device, { width, height, pointer });
    this.queries.forEach((list, i) => {
      if (list.matches === before[i]) return;
      for (const listener of [...list.listeners, ...list.legacyListeners]) listener();
    });
  }
}

const PHONE_PORTRAIT: Device = { width: 390, height: 844, pointer: 'coarse' };
const PHONE_LANDSCAPE: Device = { width: 844, height: 390, pointer: 'coarse' };
const DESKTOP: Device = { width: 1280, height: 800, pointer: 'fine' };

function setup(device: Device, extra: Partial<OrientationGuardOptions> = {}, docOptions: { matchMedia?: boolean; legacyOnly?: boolean } = {}) {
  const doc = new FakeDocument({ ...device }, docOptions);
  const gameplay = doc.createElement('div');
  doc.body.append(gameplay);
  const changes: boolean[] = [];
  const guard = createOrientationGuard({
    orientation: 'portrait',
    container: doc.body as unknown as HTMLElement,
    onChange: (blocked) => changes.push(blocked),
    ...extra
  });
  const element = guard.element as unknown as FakeElement | null;
  return { doc, gameplay, guard, element, changes };
}

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OrientationGuard (portrait-only game)', () => {
  it('reads ONE media query: a landscape viewport with a coarse (finger) primary pointer', () => {
    const { doc } = setup(PHONE_PORTRAIT);
    expect(ORIENTATION_GUARD_QUERY).toBe('(orientation: landscape) and (pointer: coarse)');
    expect(doc.queries.map((list) => list.media)).toEqual([ORIENTATION_GUARD_QUERY]);
  });

  it('1. portrait touch → mounted over the game but hidden; gameplay stays reachable', () => {
    const { doc, gameplay, guard, element, changes } = setup(PHONE_PORTRAIT);
    expect(guard.blocked).toBe(false);
    expect(element).not.toBeNull();
    expect(doc.body.children).toEqual([gameplay, element]);
    expect(element!.style.display).toBe('none');
    expect(changes).toEqual([]);
  });

  it('2. landscape touch → a visible full-viewport cover above everything, safe-area padded, with the text and an icon', () => {
    const { guard, element, changes } = setup(PHONE_LANDSCAPE);
    expect(guard.blocked).toBe(true);
    expect(changes).toEqual([]); // the initial state is read from `blocked`, never pushed from inside the factory
    expect(element!.style).toMatchObject({
      display: 'flex', position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', zIndex: '2147483647', pointerEvents: 'auto', touchAction: 'none'
    });
    for (const side of ['top', 'right', 'bottom', 'left']) expect(element!.style.padding).toContain(`env(safe-area-inset-${side}`);
    expect(element!.dataset.gameCore).toBe('orientation-guard');
    expect(element!.attributes).toMatchObject({ role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Поверните устройство' });
    const [icon, label] = element!.children as [FakeElement, FakeElement];
    expect(icon.innerHTML).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(label.textContent).toBe('Поверните устройство');
  });

  it('text and z-index are host options; the text is set as plain text, never as markup', () => {
    const { element } = setup(PHONE_LANDSCAPE, { text: 'Rotate <b>device</b>', zIndex: 50 });
    expect(element!.children[1]!.textContent).toBe('Rotate <b>device</b>');
    expect(element!.children[1]!.innerHTML).toBe('');
    expect(element!.style.zIndex).toBe('50');
  });

  it('3. landscape touch: every pointer / touch / mouse / click / wheel event that hits the cover is swallowed', () => {
    const { element } = setup(PHONE_LANDSCAPE);
    expect([...element!.listeners.keys()].sort()).toEqual([...INPUT_EVENTS].sort());
    for (const type of INPUT_EVENTS) {
      const event = element!.dispatch(type);
      expect(event.propagationStopped, type).toBe(true); // bubbling body / document / window listeners never see it
      expect(event.defaultPrevented, type).toBe(true); // no scroll, zoom, long-press menu or synthesized click
    }
    // touch listeners must be allowed to preventDefault
    for (const type of ['touchstart', 'touchmove', 'wheel']) {
      for (const { options } of element!.listeners.get(type)!) expect(options).toMatchObject({ passive: false });
    }
  });

  it('4. landscape → portrait → the cover hides again and the host hears both changes', () => {
    const { doc, guard, element, changes } = setup(PHONE_PORTRAIT);
    doc.resize(844, 390);
    expect([guard.blocked, element!.style.display]).toEqual([true, 'flex']);
    doc.resize(390, 844);
    expect([guard.blocked, element!.style.display]).toEqual([false, 'none']);
    expect(changes).toEqual([true, false]);
  });

  it('5. repeated rotations and resizes never add listeners; the host hears only real changes', () => {
    const { doc, guard, element, changes } = setup(PHONE_PORTRAIT);
    const list = doc.queries[0]!;
    const elementListeners = element!.listenerCount();
    for (let i = 0; i < 10; i++) {
      doc.resize(844, 390);
      doc.resize(800, 360); // still landscape: no change event, no callback
      doc.resize(390, 844);
    }
    expect(doc.queries).toHaveLength(1);
    expect(list.listeners.size).toBe(1);
    expect(element!.listenerCount()).toBe(elementListeners);
    expect(doc.body.children.filter((child) => child === element)).toHaveLength(1);
    expect(changes).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 0));
    expect(guard.blocked).toBe(false);
  });

  it('6. dispose removes the query listener, the element listeners and the element; repeat-safe; a blocked guard reports false once', () => {
    const { doc, gameplay, guard, element, changes } = setup(PHONE_LANDSCAPE);
    const list = doc.queries[0]!;
    guard.dispose();
    guard.dispose();
    expect(list.listeners.size).toBe(0);
    expect(element!.listenerCount()).toBe(0);
    expect(doc.body.children).toEqual([gameplay]);
    expect([guard.disposed, guard.blocked]).toEqual([true, false]);
    expect(changes).toEqual([false]);
    doc.resize(390, 844);
    doc.resize(844, 390);
    expect(changes).toEqual([false]);
  });

  it('dispose of an unblocked guard reports nothing', () => {
    const { guard, changes } = setup(PHONE_PORTRAIT);
    guard.dispose();
    expect(changes).toEqual([]);
  });

  it('7. desktop landscape (1280×800, 1920×1080) → never blocked: the primary pointer is fine', () => {
    const { doc, guard, element, changes } = setup(DESKTOP);
    expect([guard.blocked, element!.style.display]).toEqual([false, 'none']);
    doc.resize(1920, 1080);
    doc.resize(2560, 1080);
    expect([guard.blocked, element!.style.display, changes]).toEqual([false, 'none', []]);
  });

  it('8. desktop portrait (800×1280) → not blocked', () => {
    const { guard, element } = setup({ width: 800, height: 1280, pointer: 'fine' });
    expect([guard.blocked, element!.style.display]).toEqual([false, 'none']);
  });

  it('a device that switches its primary pointer (a tablet gets a trackpad) follows the query', () => {
    const { doc, guard, changes } = setup(PHONE_LANDSCAPE);
    doc.resize(844, 390, 'fine');
    doc.resize(844, 390, 'coarse');
    expect([guard.blocked, changes]).toEqual([true, [false, true]]);
  });

  it("orientation 'any' (the default) is inert: no element, no query, no listener — even on a rotated phone", () => {
    const { doc, guard } = setup(PHONE_LANDSCAPE, { orientation: 'any' });
    expect([guard.orientation, guard.blocked, guard.element]).toEqual(['any', false, null]);
    expect(doc.queries).toHaveLength(0);
    expect(doc.body.children).toHaveLength(1);
    const defaults = createOrientationGuard({ container: doc.body as unknown as HTMLElement });
    expect([defaults.orientation, defaults.blocked, defaults.element]).toEqual(['any', false, null]);
    expect(doc.queries).toHaveLength(0);
    guard.dispose();
    defaults.dispose();
  });

  it('9. no orientation source → safe and inert: Node without a document, a window without matchMedia', () => {
    vi.stubGlobal('document', undefined);
    const bare = createOrientationGuard({ orientation: 'portrait' });
    expect([bare.blocked, bare.element]).toEqual([false, null]);
    bare.dispose();
    expect(bare.disposed).toBe(true);

    const { doc, guard, changes } = setup(PHONE_LANDSCAPE, {}, { matchMedia: false });
    expect([guard.blocked, guard.element, changes]).toEqual([false, null, []]);
    expect(doc.body.children).toHaveLength(1);
    guard.dispose();
  });

  it('defaults to document.body when no container is given', () => {
    const doc = new FakeDocument({ ...PHONE_LANDSCAPE });
    vi.stubGlobal('document', doc);
    const guard = createOrientationGuard({ orientation: 'portrait' });
    expect(doc.body.children).toEqual([guard.element]);
    expect(guard.blocked).toBe(true);
    guard.dispose();
    expect(doc.body.children).toEqual([]);
  });

  it('Safari < 14: falls back to MediaQueryList.addListener / removeListener', () => {
    const { doc, guard, changes } = setup(PHONE_PORTRAIT, {}, { legacyOnly: true });
    const list = doc.queries[0]!;
    expect(list.legacyListeners.size).toBe(1);
    doc.resize(844, 390);
    expect([guard.blocked, changes]).toEqual([true, [true]]);
    guard.dispose();
    expect(list.legacyListeners.size).toBe(0);
  });

  it('takes an optional config value as is (undefined = any), e.g. a future profile ui.orientation', () => {
    const config: { orientation?: 'any' | 'portrait' } = {};
    const { guard, element } = setup(PHONE_LANDSCAPE, { orientation: config.orientation });
    expect([guard.orientation, guard.blocked, element]).toEqual(['any', false, null]);
  });

  it('is exported from game-core/pixi', () => {
    expect(pixiEntry.createOrientationGuard).toBe(createOrientationGuard);
    expect(pixiEntry.ORIENTATION_GUARD_QUERY).toBe(ORIENTATION_GUARD_QUERY);
    expect(typeof pixiEntry.OrientationGuard).toBe('function');
  });
});
