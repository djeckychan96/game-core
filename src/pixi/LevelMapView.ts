import {
  Container,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  Graphics,
  Rectangle,
  Sprite,
  type Text
} from 'pixi.js';
import type { ButtonController, MotionHandle, MotionRuntime, UiRuntime } from '../index';
import type { ReadyUiTextures } from './assets';
import { applyTextResolution, createLabel, fitLabelWidth } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';

export type LevelNodeState = 'completed' | 'current' | 'locked';

export interface LevelMapLevel {
  /** 1-based level number. */
  index: number;
  /** Earned stars 0..3; drawn on completed levels only. */
  stars?: number;
  /** Shows the red "HARD" pill under the badge (open levels only, like the donor). */
  hard?: boolean;
}

export interface LevelMapProgress {
  /** Either explicit per-level data or just a level count (stars default to 0). */
  levels: LevelMapLevel[] | number;
  /** The level the player is on: everything below is completed, everything above is locked. */
  currentLevel: number;
}

export interface LevelMapInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface LevelMapResizeOptions {
  /** Reserved space (HUD, buttons, safe area) in viewport px; the map scrolls inside the rest. */
  insets?: LevelMapInsets;
  /** devicePixelRatio of the host renderer; keeps canvas text crisp under the map's scale. */
  pixelRatio?: number;
}

export interface LevelMapFocusInfo {
  /** The level whose node sits under the focus glow (may be locked). */
  focusLevel: number;
  /** The playable level a PLAY button should launch: focus clamped to the open range. */
  selectedLevel: number;
}

export interface LevelMapViewOptions extends LevelMapProgress {
  ui: UiRuntime;
  motion: MotionRuntime;
  textures: ReadyUiTextures;
  theme?: ReadyUiThemeOverrides;
  /** Unique id per UiRuntime; buttons register as `<id>:node:<level>`. Default `level-map`. */
  id?: string;
  /** Settled tap on an open level (completed = replay, current = play). */
  onSelectLevel: (level: number, state: 'completed' | 'current') => void;
  /** Settled tap on a locked level (the node already shakes). */
  onLockedTap?: (level: number) => void;
  /** The focus/selected level changed while scrolling. */
  onFocusChange?: (info: LevelMapFocusInfo) => void;
  /** Text inside the hard pill. Default `HARD`. */
  hardLabel?: string;
  /** Draw the donor's dark arrow-pattern background under the map. Default true. */
  background?: boolean;
  /** Nodes built around the focus at once (donor: 40 each side); more are built while scrolling. */
  buildWindow?: number;
  /** Initial layout; call resize() later for the real viewport. */
  width?: number;
  height?: number;
}

interface LevelNode {
  index: number;
  state: LevelNodeState;
  /** Scroll position slot (design units) and focus scaling live here. */
  root: Container;
  /** Press feedback lives one level down so it never fights the focus pulse. */
  inner: Container;
  controller: ButtonController;
  label: Text;
  stars: Sprite[];
  lock: Sprite | null;
}

const FIGMA_BADGE_BASE = 232;
const DRAG_THRESHOLD_PX = 8;
const NODE_TAP_THRESHOLD_PX = 14;
const FLING_PROJECTION_MS = 170;
const REBUILD_MARGIN = 6;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Vertical scrolling level map — the Trail Arrow level ribbon extracted into Game Core.
 * Levels climb upward; the focused level sits under a fixed glow; drag anywhere to scroll,
 * release to fling and snap; tap an open badge to select it. Every animation runs through the
 * host's MotionRuntime and every tap through a ButtonController, so `core.cancelAll()` settles
 * the map like any other Game Core UI and no business callback can fire from a cancelled press.
 */
export class LevelMapView extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  private readonly ui: UiRuntime;
  private readonly motion: MotionRuntime;
  private readonly textures: ReadyUiTextures;
  private readonly onSelectLevel: (level: number, state: 'completed' | 'current') => void;
  private readonly onLockedTap: ((level: number) => void) | null;
  private readonly onFocusChange: ((info: LevelMapFocusInfo) => void) | null;
  private readonly hardLabel: string;
  private readonly buildWindow: number;

  private readonly scrollScope: string;
  private readonly pulseScope: string;
  private readonly shineScope: string;
  private readonly fxScope: string;

  private readonly background: Sprite | null;
  private readonly maskShape: Graphics;
  private readonly content: Container;
  private readonly shine: Sprite;
  private readonly track: Container;
  private readonly railLayer: Container;
  private readonly nodeLayer: Container;

  private levels: LevelMapLevel[] = [];
  private currentLevelValue = 1;
  private readonly nodes = new Map<number, LevelNode>();
  private builtLo = 0;
  private builtHi = -1;

  private viewportWidth = 0;
  private viewportHeight = 0;
  private mapTop = 0;
  private mapBottom = 0;
  private mapLeft = 0;
  private mapRight = 0;
  private scaleValue = 1;
  private focusY = 0;
  private pixelRatio = 1;

  private trackY = 0;
  private focusLevelValue = 1;
  private highlighted: LevelNode | null = null;
  private pressed: LevelNode | null = null;

  private dragPointerId: number | null = null;
  private dragging = false;
  private dragMoved = 0;
  private lastPointerY = 0;
  private lastPointerTime = 0;
  private velocity = 0;
  private scrollHandle: MotionHandle | null = null;
  private wheelSnapHandle: MotionHandle | null = null;
  private disposed = false;

  constructor(options: LevelMapViewOptions) {
    super();
    this.id = options.id ?? 'level-map';
    this.theme = resolveTheme(options.theme);
    this.ui = options.ui;
    this.motion = options.motion;
    this.textures = options.textures;
    this.onSelectLevel = options.onSelectLevel;
    this.onLockedTap = options.onLockedTap ?? null;
    this.onFocusChange = options.onFocusChange ?? null;
    this.hardLabel = options.hardLabel ?? 'HARD';
    this.buildWindow = Math.max(4, options.buildWindow ?? 40);
    this.scrollScope = `${this.id}:scroll`;
    this.pulseScope = `${this.id}:pulse`;
    this.shineScope = `${this.id}:shine`;
    this.fxScope = `${this.id}:fx`;

    this.background = null;
    if (options.background ?? true) {
      const bg = new Sprite(this.textures.mapBackground);
      bg.anchor.set(0.5);
      bg.eventMode = 'none';
      this.addChild(bg);
      this.background = bg;
    }

    this.maskShape = new Graphics();
    this.addChild(this.maskShape);

    this.content = new Container();
    this.content.mask = this.maskShape;
    this.addChild(this.content);

    this.shine = new Sprite(this.textures.shine);
    this.shine.anchor.set(0.5);
    this.shine.eventMode = 'none';
    // donor: 983 × 626 logical, scaled by nodeScale, sitting behind the focused node
    this.shine.width = 983;
    this.shine.height = 626;
    this.shine.scale.set(this.shine.scale.x * this.theme.levelMap.nodeScale, this.shine.scale.y * this.theme.levelMap.nodeScale);
    this.content.addChild(this.shine);

    this.track = new Container();
    this.railLayer = new Container();
    this.nodeLayer = new Container();
    this.track.addChild(this.railLayer, this.nodeLayer);
    this.content.addChild(this.track);

    this.eventMode = 'static';
    this.on('pointerdown', this.onPointerDown, this);
    this.on('globalpointermove', this.onGlobalPointerMove, this);
    this.on('pointerup', this.onPointerUp, this);
    this.on('pointerupoutside', this.onPointerUp, this);
    this.on('pointercancel', this.onPointerUp, this);
    this.on('wheel', this.onWheel, this);

    this.applyProgress(options.levels, options.currentLevel);
    this.resize(options.width ?? 390, options.height ?? 844);
    this.startShinePulse();
  }

  // --- public state ---

  get currentLevel(): number {
    return this.currentLevelValue;
  }

  get levelCount(): number {
    return this.levels.length;
  }

  get focusLevel(): number {
    return this.focusLevelValue;
  }

  /** The playable level under (or nearest below) the focus — what a PLAY button should launch. */
  get selectedLevel(): number {
    return clamp(this.focusLevelValue, 1, Math.min(this.currentLevelValue, Math.max(1, this.levels.length)));
  }

  /** Design units → viewport px factor currently applied to the map content. */
  get contentScale(): number {
    return this.scaleValue;
  }

  getNodeState(level: number): LevelNodeState | null {
    if (level < 1 || level > this.levels.length) return null;
    return this.stateOf(level);
  }

  /** Design-unit y of a level's slot on the track (level 1 = 0, higher levels climb upward). */
  levelY(level: number): number {
    return -(level - 1) * this.theme.levelMap.levelGap;
  }

  /** Viewport y (px) at which `level`'s node center currently sits. */
  levelScreenY(level: number): number {
    return (this.trackY + this.levelY(level)) * this.scaleValue;
  }

  /** The built node container of `level` (null when outside the built window) — for host FX. */
  getNodeContainer(level: number): Container | null {
    return this.nodes.get(level)?.root ?? null;
  }

  /** Viewport px position of the focus glow (where the selected node rests). */
  get focusPoint(): { x: number; y: number } {
    return { x: this.content.x, y: this.focusY };
  }

  // --- data ---

  /** Replaces levels/progress and rebuilds nodes; keeps the scroll position when possible. */
  setProgress(progress: LevelMapProgress): void {
    this.applyProgress(progress.levels, progress.currentLevel);
    this.rebuild(this.focusLevelValue, true);
    this.setTrackY(this.trackY, true);
  }

  /** Updates one level's stars in place (a completed level's node is redrawn). */
  setLevelStars(level: number, stars: number): void {
    const data = this.levels[level - 1];
    if (!data) return;
    data.stars = clamp(Math.round(stars), 0, 3);
    const node = this.nodes.get(level);
    if (!node) return;
    this.destroyNode(node);
    this.nodes.set(level, this.createNode(level));
    if (this.highlighted?.index === level) {
      this.highlighted = null;
      this.highlight(level);
    }
    this.updateCulling();
  }

  // --- layout ---

  resize(width: number, height: number, options: LevelMapResizeOptions = {}): void {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    const insets = options.insets ?? {};
    this.viewportWidth = w;
    this.viewportHeight = h;
    this.mapTop = Math.max(0, insets.top ?? 0);
    this.mapBottom = Math.max(this.mapTop + 1, h - Math.max(0, insets.bottom ?? 0));
    this.mapLeft = Math.max(0, insets.left ?? 0);
    this.mapRight = Math.max(this.mapLeft + 1, w - Math.max(0, insets.right ?? 0));
    this.pixelRatio = options.pixelRatio ?? this.pixelRatio;

    // contain-fit of the donor's portrait design box (× the donor's progression scale), so a
    // node keeps the same share of the screen on a 320 px phone, an iPhone and a desktop window
    this.scaleValue = Math.min(w / this.theme.designWidth, h / this.theme.designHeight) * this.theme.levelMap.contentScale;
    const s = this.scaleValue;
    const centerX = (this.mapLeft + this.mapRight) / 2;
    this.content.position.set(centerX, 0);
    this.content.scale.set(s);

    // donor: the current badge rests at ~60% of the screen height, but always a whole badge
    // (plus the hard pill) above the PLAY button / bottom inset and below the HUD
    const previousFocus = this.focusLevelValue;
    const reach = (this.theme.levelMap.badgeSize / 2 + 40) * this.theme.levelMap.nodeScale * s;
    const wanted = h * this.theme.levelMap.focusRatio;
    this.focusY = Math.max(this.mapTop + reach, Math.min(wanted, this.mapBottom - reach));
    this.shine.position.set(0, this.focusY / s);

    if (this.background) {
      const tex = this.background.texture;
      const cover = Math.max(w / Math.max(1, tex.width), h / Math.max(1, tex.height));
      this.background.width = tex.width * cover;
      this.background.height = tex.height * cover;
      this.background.position.set(w / 2, h / 2);
    }

    this.maskShape.clear().rect(0, this.mapTop, w, this.mapBottom - this.mapTop).fill(0xffffff);
    this.hitArea = new Rectangle(0, this.mapTop, w, this.mapBottom - this.mapTop);

    // keep the same level under the focus after a rotate/resize (force: the first call also
    // builds the node window and highlights the current level)
    this.setTrackY(this.trackYFor(previousFocus), true);
    applyTextResolution(this.content, s * this.theme.levelMap.nodeScale * this.pixelRatio);
  }

  // --- scrolling ---

  /** Brings `level` under the focus glow, animated through MotionRuntime by default. */
  scrollToLevel(level: number, animate = true): void {
    const target = this.trackYFor(clamp(Math.round(level), 1, Math.max(1, this.levels.length)));
    this.cancelScroll();
    if (!animate) {
      this.setTrackY(target);
      return;
    }
    this.animateTrackTo(target, 'easeInOut');
  }

  /** Snaps the nearest level under the focus (what a release does). */
  snapToNearest(): void {
    this.animateTrackTo(this.trackYFor(this.levelAtTrack(this.trackY)), 'easeOut');
  }

  // --- lifecycle ---

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.off('pointerdown', this.onPointerDown, this);
    this.off('globalpointermove', this.onGlobalPointerMove, this);
    this.off('pointerup', this.onPointerUp, this);
    this.off('pointerupoutside', this.onPointerUp, this);
    this.off('pointercancel', this.onPointerUp, this);
    this.off('wheel', this.onWheel, this);
    this.cancelScroll();
    this.motion.cancelScope(this.pulseScope);
    this.motion.cancelScope(this.shineScope);
    this.motion.cancelScope(this.fxScope);
    for (const node of this.nodes.values()) node.controller.dispose();
    this.nodes.clear();
    this.highlighted = null;
    this.pressed = null;
    super.destroy(options ?? { children: true });
  }

  // --- internals: data ---

  private applyProgress(levels: LevelMapLevel[] | number, currentLevel: number): void {
    const list: LevelMapLevel[] = [];
    if (typeof levels === 'number') {
      const count = Math.max(1, Math.floor(levels));
      for (let i = 1; i <= count; i++) list.push({ index: i, stars: 0 });
    } else {
      const sorted = [...levels].sort((a, b) => a.index - b.index);
      for (const level of sorted) {
        const entry: LevelMapLevel = { index: level.index, stars: clamp(Math.round(level.stars ?? 0), 0, 3) };
        if (level.hard) entry.hard = true;
        list.push(entry);
      }
    }
    this.levels = list;
    this.currentLevelValue = clamp(Math.floor(currentLevel), 1, Math.max(1, list.length));
    this.focusLevelValue = clamp(this.focusLevelValue || this.currentLevelValue, 1, Math.max(1, list.length));
    if (this.nodes.size === 0) this.focusLevelValue = this.currentLevelValue;
  }

  private stateOf(level: number): LevelNodeState {
    if (level < this.currentLevelValue) return 'completed';
    if (level === this.currentLevelValue) return 'current';
    return 'locked';
  }

  private levelData(level: number): LevelMapLevel | undefined {
    const direct = this.levels[level - 1];
    if (direct && direct.index === level) return direct;
    return this.levels.find((entry) => entry.index === level);
  }

  // --- internals: geometry ---

  private trackYFor(level: number): number {
    return this.focusY / this.scaleValue - this.levelY(level);
  }

  private minTrackY(): number {
    return this.trackYFor(1);
  }

  private maxTrackY(): number {
    return this.trackYFor(Math.max(1, this.levels.length));
  }

  private clampTrackY(y: number): number {
    return clamp(y, this.minTrackY(), this.maxTrackY());
  }

  private levelAtTrack(trackY: number): number {
    const raw = 1 + (trackY - this.focusY / this.scaleValue) / this.theme.levelMap.levelGap;
    return clamp(Math.round(raw), 1, Math.max(1, this.levels.length));
  }

  private setTrackY(y: number, force = false): void {
    const next = this.clampTrackY(y);
    if (!force && next === this.trackY) return;
    this.trackY = next;
    this.track.y = next;
    this.ensureWindowCovers(this.levelAtTrack(next));
    this.updateCulling();
    const focus = this.levelAtTrack(next);
    if (focus !== this.focusLevelValue || force) {
      const changed = focus !== this.focusLevelValue;
      this.focusLevelValue = focus;
      this.highlight(focus);
      if (changed && this.onFocusChange) {
        this.onFocusChange({ focusLevel: focus, selectedLevel: this.selectedLevel });
      }
    }
  }

  private updateCulling(): void {
    const s = this.scaleValue;
    const reach = this.theme.levelMap.badgeSize * this.theme.levelMap.nodeScale * 0.9;
    const top = this.mapTop - reach * s;
    const bottom = this.mapBottom + reach * s;
    for (const node of this.nodes.values()) {
      const vy = (this.trackY + node.root.y) * s;
      node.root.visible = vy > top && vy < bottom;
    }
    for (const seg of this.railLayer.children) {
      const vy = (this.trackY + seg.y) * s;
      seg.visible = vy > top - reach * s && vy < bottom + reach * s;
    }
  }

  // --- internals: nodes ---

  private ensureWindowCovers(level: number): void {
    const count = this.levels.length;
    const needsLower = level < this.builtLo + REBUILD_MARGIN && this.builtLo > 1;
    const needsHigher = level > this.builtHi - REBUILD_MARGIN && this.builtHi < count;
    if (needsLower || needsHigher) this.rebuild(level);
  }

  private rebuild(centerLevel: number, force = false): void {
    const count = Math.max(1, this.levels.length);
    const lo = Math.max(1, centerLevel - this.buildWindow);
    const hi = Math.min(count, centerLevel + this.buildWindow);
    if (!force && lo === this.builtLo && hi === this.builtHi && this.nodes.size > 0 && this.nodesMatchState()) return;

    if (this.pressed) {
      this.pressed.controller.cancel();
      this.pressed = null;
    }
    this.motion.cancelScope(this.pulseScope);
    this.highlighted = null;
    for (const node of this.nodes.values()) this.destroyNode(node);
    this.nodes.clear();
    for (const seg of this.railLayer.removeChildren()) seg.destroy();

    const gap = this.theme.levelMap.levelGap;
    const nodeScale = this.theme.levelMap.nodeScale;
    for (let i = lo; i < hi; i++) {
      const seg = new Sprite(this.textures.rail);
      seg.anchor.set(0.5);
      seg.width = 64 * nodeScale; // donor rail: 64 logical px wide, one segment per gap
      seg.height = gap + 20;
      seg.position.set(0, (this.levelY(i) + this.levelY(i + 1)) / 2);
      seg.eventMode = 'none';
      this.railLayer.addChild(seg);
    }
    for (let i = lo; i <= hi; i++) this.nodes.set(i, this.createNode(i));
    this.builtLo = lo;
    this.builtHi = hi;
    applyTextResolution(this.nodeLayer, this.scaleValue * nodeScale * this.pixelRatio);
    this.updateCulling();
  }

  /** Whether every built node still shows the state the current progress implies. */
  private nodesMatchState(): boolean {
    for (const node of this.nodes.values()) {
      if (node.state !== this.stateOf(node.index)) return false;
    }
    return true;
  }

  private createNode(level: number): LevelNode {
    const theme = this.theme.levelMap;
    const data = this.levelData(level);
    const state = this.stateOf(level);
    const D = theme.badgeSize;
    const k = D / FIGMA_BADGE_BASE;

    const root = new Container();
    root.position.set(0, this.levelY(level));
    root.scale.set(theme.nodeScale);
    const inner = new Container();
    root.addChild(inner);

    const baseTex = state === 'current' ? this.textures.badgeCurrent : state === 'locked' ? this.textures.badgeLocked : this.textures.badgeBase;
    const badge = new Sprite(baseTex);
    badge.anchor.set(0.5);
    badge.scale.set(D / Math.max(1, baseTex.width));
    inner.addChild(badge);

    // side stars are pre-tilted PNGs from Figma; only earned stars are drawn (the empty
    // slots are baked into the badge art itself)
    const stars: Sprite[] = [];
    const earned = state === 'completed' ? clamp(data?.stars ?? 0, 0, 3) : 0;
    const starSpecs = [
      { x: -68 * k, y: -18 * k, size: 84 * k, tex: this.textures.starGoldL },
      { x: 0, y: -62 * k, size: 98 * k, tex: this.textures.starGold },
      { x: 68 * k, y: -18 * k, size: 84 * k, tex: this.textures.starGoldR }
    ];
    for (let si = 0; si < earned; si++) {
      const spec = starSpecs[si];
      if (!spec) continue;
      const star = new Sprite(spec.tex);
      star.anchor.set(0.5);
      star.scale.set(spec.size / Math.max(1, spec.tex.width));
      star.position.set(spec.x, spec.y);
      inner.addChild(star);
      stars.push(star);
    }

    const digits = String(level).length;
    const numK = digits >= 3 ? 0.74 : digits === 2 ? 0.92 : 1;
    const locked = state === 'locked';
    const fontSize = (locked ? 70 : 84) * numK * k;
    const label = createLabel(this.theme, String(level), { fontSize, stroke: fontSize * 0.095 });
    label.position.set(0, ((locked ? 6 : 27) + (digits >= 3 ? 7 : digits === 2 ? 3 : 0)) * k);
    inner.addChild(label);

    let lock: Sprite | null = null;
    if (locked) {
      lock = new Sprite(this.textures.lock);
      lock.anchor.set(0.5);
      lock.scale.set((64 * k) / Math.max(1, this.textures.lock.width));
      lock.position.set(0, 78 * k);
      inner.addChild(lock);
    }

    if (data?.hard && !locked) {
      const pillW = 190 * k;
      const pill = new Sprite(this.textures.pillHard);
      pill.anchor.set(0.5);
      pill.scale.set(pillW / Math.max(1, this.textures.pillHard.width));
      const text = createLabel(this.theme, this.hardLabel.toUpperCase(), { fontSize: 36 * k, stroke: 4 * k });
      text.y = -2 * k;
      fitLabelWidth(text, pillW * 0.88);
      const pillRoot = new Container();
      pillRoot.addChild(pill, text);
      pillRoot.position.set(0, 95 * k);
      inner.addChild(pillRoot);
    }

    const hitR = D * 0.56;
    root.hitArea = new Rectangle(-hitR, -hitR, hitR * 2, hitR * 2);
    root.eventMode = 'static';
    root.cursor = locked ? 'default' : 'pointer';

    const controller = this.ui.createButton({
      id: `${this.id}:node:${level}`,
      tapThreshold: NODE_TAP_THRESHOLD_PX,
      pressDurationMs: 70,
      releaseDurationMs: 140,
      releaseEase: 'backOut',
      onProgress: (progress) => {
        const kk = 1 - 0.08 * progress;
        inner.scale.set(kk);
      },
      onTap: () => this.onNodeTap(level)
    });
    const node: LevelNode = { index: level, state, root, inner, controller, label, stars, lock };

    root.on('pointerdown', (event: FederatedPointerEvent) => {
      this.pressed = node;
      controller.pointerDown(event.pointerId, event.global.x, event.global.y);
    });
    root.on('pointerup', (event: FederatedPointerEvent) => {
      controller.pointerUp(event.pointerId, event.global.x, event.global.y, true);
      if (this.pressed === node) this.pressed = null;
    });
    root.on('pointerupoutside', (event: FederatedPointerEvent) => {
      controller.pointerUp(event.pointerId, event.global.x, event.global.y, false);
      if (this.pressed === node) this.pressed = null;
    });
    root.on('pointercancel', (event: FederatedPointerEvent) => {
      controller.pointerCancel(event.pointerId, 'pointerCancel');
      if (this.pressed === node) this.pressed = null;
    });

    this.nodeLayer.addChild(root);
    return node;
  }

  private destroyNode(node: LevelNode): void {
    node.controller.dispose();
    node.root.removeAllListeners();
    node.root.destroy({ children: true });
    if (this.highlighted === node) this.highlighted = null;
    if (this.pressed === node) this.pressed = null;
  }

  private onNodeTap(level: number): void {
    if (this.disposed || this.dragging) return;
    const state = this.stateOf(level);
    if (state === 'locked') {
      this.shakeNode(level);
      this.onLockedTap?.(level);
      return;
    }
    this.onSelectLevel(level, state);
  }

  private shakeNode(level: number): void {
    const node = this.nodes.get(level);
    if (!node) return;
    const inner = node.inner;
    const binding = { get: () => inner.x, set: (v: number) => { inner.x = v; }, to: 0 };
    const step = (to: number, durationMs: number) => ({ type: 'tween' as const, bindings: [{ ...binding, to }], durationMs, ease: 'easeInOut' as const });
    this.motion.sequence({
      scope: this.fxScope,
      steps: [step(-16, 50), step(16, 70), step(-9, 60), step(0, 60)],
      onCancel: () => { inner.x = 0; }
    });
  }

  // --- internals: focus highlight ---

  private highlight(level: number): void {
    const node = this.nodes.get(level) ?? null;
    if (node === this.highlighted) return;
    this.motion.cancelScope(this.pulseScope);
    const base = this.theme.levelMap.nodeScale;
    const prev = this.highlighted;
    this.highlighted = node;
    if (prev && !prev.root.destroyed) {
      this.tweenScale(prev.root, base, 180, 'easeOut');
    }
    if (!node) return;
    const big = base * this.theme.levelMap.focusBoost;
    this.motion.tween({
      scope: this.pulseScope,
      bindings: [this.scaleBinding(node.root, big)],
      durationMs: 200,
      ease: 'backOut',
      onComplete: () => {
        if (this.highlighted !== node || node.root.destroyed || node.state === 'locked') return;
        this.motion.tween({
          scope: this.pulseScope,
          bindings: [this.scaleBinding(node.root, big * 1.05)],
          durationMs: 700,
          ease: 'easeInOut',
          repeat: Infinity,
          yoyo: true
        });
      }
    });
  }

  private scaleBinding(target: Container, to: number) {
    return { get: () => target.scale.x, set: (v: number) => { target.scale.set(v); }, to };
  }

  private tweenScale(target: Container, to: number, durationMs: number, ease: 'easeOut' | 'easeInOut' | 'backOut'): void {
    this.motion.tween({ scope: this.pulseScope, bindings: [this.scaleBinding(target, to)], durationMs, ease });
  }

  private startShinePulse(): void {
    const sx = this.shine.scale.x;
    const sy = this.shine.scale.y;
    const k = { value: 1 };
    this.motion.tween({
      scope: this.shineScope,
      bindings: [{
        get: () => k.value,
        set: (v: number) => {
          k.value = v;
          this.shine.scale.set(sx * v, sy * v);
          this.shine.alpha = 0.7 + 0.3 * (v - 0.8) / 0.2;
        },
        from: 1,
        to: 0.8
      }],
      durationMs: 1400,
      ease: 'easeInOut',
      repeat: Infinity,
      yoyo: true
    });
  }

  // --- internals: pointer / scroll ---

  private onPointerDown(event: FederatedPointerEvent): void {
    if (this.dragPointerId !== null) return;
    this.dragPointerId = event.pointerId;
    this.dragging = false;
    this.dragMoved = 0;
    this.lastPointerY = event.global.y;
    this.lastPointerTime = now();
    this.velocity = 0;
    this.cancelScroll();
  }

  private onGlobalPointerMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const y = event.global.y;
    const dy = y - this.lastPointerY;
    const t = now();
    const dt = Math.max(1, t - this.lastPointerTime);
    this.lastPointerY = y;
    this.lastPointerTime = t;
    this.dragMoved += Math.abs(dy);
    // low-pass the release velocity so one jittery sample does not decide the fling
    this.velocity = this.velocity * 0.6 + (dy / dt) * 0.4;
    if (this.pressed) this.pressed.controller.pointerMove(event.pointerId, event.global.x, event.global.y);
    if (!this.dragging && this.dragMoved > DRAG_THRESHOLD_PX) this.dragging = true;
    if (this.dragging) this.setTrackY(this.trackY + dy / this.scaleValue);
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    const wasDragging = this.dragging;
    this.dragging = false;
    if (!wasDragging) return;
    // a stale velocity from a pause before release should not fling
    const idleMs = now() - this.lastPointerTime;
    const v = idleMs > 80 ? 0 : this.velocity;
    const projected = this.trackY + (v * FLING_PROJECTION_MS) / this.scaleValue;
    const target = this.trackYFor(this.levelAtTrack(this.clampTrackY(projected)));
    this.animateTrackTo(target, 'easeOut');
  }

  private onWheel(event: FederatedWheelEvent): void {
    if (this.dragPointerId !== null) return;
    this.cancelScroll();
    this.setTrackY(this.trackY - event.deltaY / this.scaleValue);
    this.wheelSnapHandle = this.motion.delay({
      scope: this.scrollScope,
      durationMs: 140,
      onComplete: () => {
        this.wheelSnapHandle = null;
        this.snapToNearest();
      }
    });
  }

  private animateTrackTo(target: number, ease: 'easeOut' | 'easeInOut'): void {
    this.cancelScroll();
    const distance = Math.abs(target - this.trackY) * this.scaleValue;
    if (distance < 0.5) {
      this.setTrackY(target, true);
      return;
    }
    const durationMs = clamp(180 + distance * 0.6, 220, 650);
    this.scrollHandle = this.motion.tween({
      scope: this.scrollScope,
      bindings: [{ get: () => this.trackY, set: (v: number) => this.setTrackY(v), to: target }],
      durationMs,
      ease,
      onComplete: () => { this.scrollHandle = null; },
      onCancel: () => { this.scrollHandle = null; }
    });
  }

  private cancelScroll(): void {
    if (this.scrollHandle) {
      const handle = this.scrollHandle;
      this.scrollHandle = null;
      handle.cancel();
    }
    if (this.wheelSnapHandle) {
      const handle = this.wheelSnapHandle;
      this.wheelSnapHandle = null;
      handle.cancel();
    }
  }
}

// Pointer velocity needs timestamps between events; this is a clock read, not a timer.
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
