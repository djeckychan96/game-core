// OrientationGuard — the blocking "rotate the device" cover of a portrait-only game on a touch device.
//
// Detection is ONE media query, read through `matchMedia` and its `change` event (no user-agent, no pixel threshold):
//   (orientation: landscape) and (pointer: coarse)
// `orientation` is the viewport's aspect; `pointer: coarse` says the PRIMARY pointer is a finger. A desktop's primary pointer is
// a mouse / trackpad (`fine`), so a wide desktop window — 1280×800, 1920×1080, a touch laptop driven by its trackpad — never
// matches, whatever its size. The viewport (not `screen.orientation`) is what the game lays out in: an Android tablet in split
// screen with a tall game pane is not blocked.
//
// While the query matches, one `position: fixed` element covers the whole viewport above everything (z-index max by
// default): the browser hit-tests every pointer / touch / click / wheel to it, and it stops their propagation, so neither
// gameplay elements (DOM, a Pixi / WebGL canvas, the Ready UI overlay) nor bubbling listeners on body / document / window
// see them. It owns that element, its listeners and one MediaQueryList listener — no timer, no requestAnimationFrame, no
// window / document listener. It does NOT pause the game (Gameplay Contract V1 `setPaused` has no arbitration between a
// modal, an ad and this cover): `onChange` tells the host, and the host pauses through its own path.
/** The orientation a game is laid out for. 'portrait' = a touch device in landscape gets the cover; 'any' = never. */
export type GameOrientation = 'any' | 'portrait';

export const ORIENTATION_GUARD_QUERY = '(orientation: landscape) and (pointer: coarse)';

export interface OrientationGuardOptions {
  /** 'portrait' blocks a touch device held in landscape. 'any' (the default) makes the guard inert: no element, no listener. */
  orientation?: GameOrientation | undefined;
  /** Where the cover is appended (as the last child); default `document.body`. It is `position: fixed` either way. */
  container?: HTMLElement;
  /** Default 'Поверните устройство'. Set as plain text. */
  text?: string;
  /** Default 2147483647 — above any game layer. */
  zIndex?: number;
  /**
   * Every later change of `blocked`, and `false` once from `dispose()` of a blocked guard. Never called during creation:
   * read `guard.blocked` right after creating it (a game started in landscape is blocked from the first frame).
   */
  onChange?: (blocked: boolean) => void;
}

/** The part of MediaQueryList the guard uses; `addListener` / `removeListener` for Safari < 14. */
interface MediaQuerySource {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

const DEFAULT_TEXT = 'Поверните устройство';
const SWALLOWED_EVENTS = [
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel'
] as const;
// A phone held upright between two rotation arrows; strokes use the text colour.
const ICON_SVG = '<svg width="96" height="96" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="35" y="20" width="30" height="60" rx="6"/><path d="M45 71h10"/>'
  + '<path d="M70 15.4A40 40 0 0 1 87.6 36.3"/><path d="M89.9 27.6L87.6 36.3L80.2 31.2"/>'
  + '<path d="M30 84.6A40 40 0 0 1 12.4 63.7"/><path d="M10.1 72.4L12.4 63.7L19.8 68.8"/></svg>';

export class OrientationGuard {
  readonly orientation: GameOrientation;
  /** The cover (hidden while not blocked), or null when the guard is inert: 'any', or no document / `matchMedia`. */
  readonly element: HTMLElement | null;

  private readonly query: MediaQuerySource | null;
  private readonly onChange: ((blocked: boolean) => void) | null;
  private isBlocked = false;
  private isDisposed = false;
  private readonly onQueryChange = (): void => this.sync();
  private readonly swallow = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  /** Use `createOrientationGuard(options)`. */
  constructor(options: OrientationGuardOptions = {}) {
    this.orientation = options.orientation ?? 'any';
    this.onChange = options.onChange ?? null;
    const container = options.container ?? (typeof document === 'undefined' ? undefined : document.body);
    const win = container?.ownerDocument?.defaultView;
    if (this.orientation !== 'portrait' || !container || typeof win?.matchMedia !== 'function') {
      this.element = null;
      this.query = null;
      return;
    }
    const doc = container.ownerDocument;
    const text = options.text ?? DEFAULT_TEXT;
    const element = doc.createElement('div');
    element.dataset.gameCore = 'orientation-guard';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-label', text);
    Object.assign(element.style, {
      position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', zIndex: String(options.zIndex ?? 2147483647),
      display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', boxSizing: 'border-box',
      padding: 'max(24px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px)) max(24px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px))',
      background: '#12151e', color: '#ffffff', font: '600 22px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', textAlign: 'center',
      pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none', webkitTapHighlightColor: 'transparent'
    });
    const icon = doc.createElement('div');
    icon.innerHTML = ICON_SVG;
    Object.assign(icon.style, { display: 'flex', opacity: '0.9' });
    const label = doc.createElement('div');
    label.textContent = text;
    element.append(icon, label);
    for (const type of SWALLOWED_EVENTS) element.addEventListener(type, this.swallow, { passive: false });
    container.append(element);
    this.element = element;

    const query = win.matchMedia(ORIENTATION_GUARD_QUERY) as MediaQuerySource;
    if (typeof query.addEventListener === 'function') query.addEventListener('change', this.onQueryChange);
    else query.addListener?.(this.onQueryChange);
    this.query = query;
    this.isBlocked = query.matches;
    element.style.display = this.isBlocked ? 'flex' : 'none';
  }

  /** True while the cover is up: the host keeps gameplay paused / ignores its input (e.g. in a `blocked()` hook). */
  get blocked(): boolean {
    return this.isBlocked;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** Removes the cover, its listeners and the query listener. A blocked guard reports `false` once. Repeat-safe. */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const wasBlocked = this.isBlocked;
    this.isBlocked = false;
    const query = this.query;
    if (query) {
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', this.onQueryChange);
      else query.removeListener?.(this.onQueryChange);
    }
    if (this.element) {
      for (const type of SWALLOWED_EVENTS) this.element.removeEventListener(type, this.swallow);
      this.element.remove();
    }
    if (wasBlocked) this.onChange?.(false);
  }

  private sync(): void {
    if (this.isDisposed || !this.query || !this.element) return;
    const blocked = this.query.matches;
    if (blocked === this.isBlocked) return;
    this.isBlocked = blocked;
    this.element.style.display = blocked ? 'flex' : 'none';
    this.onChange?.(blocked);
  }
}

/** Creates the guard; with `orientation: 'portrait'` its cover is mounted (hidden unless a touch device is in landscape). */
export function createOrientationGuard(options: OrientationGuardOptions = {}): OrientationGuard {
  return new OrientationGuard(options);
}
