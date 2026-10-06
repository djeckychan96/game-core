import { Container, type FederatedPointerEvent, NineSliceSprite, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import type { ButtonController, LocalizationTextProvider, UiRuntime } from '../index';
import type { ReadyUiTextures } from './assets';
import { resolveSkinView, selectSkinView, skinNineSlice, skinTextLook, type ReadyUiSkinBottomNavItemLayout, type ReadyUiSkinBottomNavLayout, type ReadyUiSkinRole, type SkinViewLook } from './skin';
import { applyTextResolution, createFigmaLabel, placeFigmaLabel } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';

/** One destination of the bottom navigation. Core knows nothing about what it opens: routing stays with the host. */
export interface BottomNavItem {
  /** Stable id: the argument of `onSelect` / `onLockedTap` and of `setSelected` / `setLocked`. Unique per view. */
  readonly id: string;
  /** The item's icon: a texture, or a role of the selected style (e.g. `'iconShop'`). None = no icon. */
  readonly icon?: Texture | ReadyUiSkinRole;
  /** Display text, already localized. Wins over `labelKey`. */
  readonly label?: string;
  /** A localization key resolved through the view's `i18n` provider when there is no `label`. Neither = no label. */
  readonly labelKey?: string;
  /** A locked item shows the style's lock instead of its icon (with its label where the style's locked state has one) and never selects. Default false. */
  readonly locked?: boolean;
  /**
   * A disabled item keeps its look (no style has disabled art) but is inert: no press feedback, no callback, no
   * pointer cursor. Default false.
   */
  readonly disabled?: boolean;
}

export interface BottomNavInsets {
  bottom?: number;
  left?: number;
  right?: number;
}

export interface BottomNavResizeOptions {
  /** Safe-area / reserved space in viewport px; the panel reaches down through the bottom inset. */
  insets?: BottomNavInsets;
  pixelRatio?: number;
}

export interface BottomNavViewOptions {
  ui: UiRuntime;
  textures: ReadyUiTextures;
  /** Must carry a style that covers `bottomNav` (Core has no donor bottom navigation art). */
  theme?: ReadyUiThemeOverrides;
  i18n?: LocalizationTextProvider;
  /** Unique id per UiRuntime; items register as `<id>:item:<item id>`. Default `bottom-nav`. */
  id?: string;
  items: readonly BottomNavItem[];
  /** The item drawn as selected (the host's current destination). Default none. */
  selectedId?: string | null;
  /** Settled tap on an item that is neither locked nor disabled — selected or not. The view does not change its own selection: the host routes, then calls `setSelected`. */
  onSelect: (id: string) => void;
  /** Settled tap on a locked item that is not disabled (`onSelect` is never called for it). */
  onLockedTap?: (id: string) => void;
  width?: number;
  height?: number;
}

interface NavItemNode {
  readonly item: BottomNavItem;
  locked: boolean;
  disabled: boolean;
  /** Slot position and the fit scale. */
  readonly root: Container;
  /** Press feedback lives one level down. */
  readonly inner: Container;
  readonly background: NineSliceSprite;
  readonly icon: Sprite | null;
  readonly lock: Sprite;
  readonly label: Text | null;
  readonly controller: ButtonController;
}

const PRESS_SCALE = 0.94;

/**
 * Bottom navigation bar: a full-width panel at the bottom edge with N items, one of them drawn as selected and any of
 * them locked or disabled. Visuals come only from the selected style (`theme.skin` covering `bottomNav`: panel,
 * selected background, lock, geometry, label boxes, text colour and outline); behaviour is the same for every style.
 * Each item is a ButtonController, so a press cancelled by a swipe, `cancelScope` or `core.cancelAll()` never calls back.
 *
 * Layout: slots `pitch` design units apart, centred on the viewport (shrinking to fit a narrow screen; an item scales
 * down only when its selected background no longer fits its slot), the panel's top edge `panelHeight` units above the
 * bottom inset, the panel and the selected background reaching down to the viewport's bottom edge.
 */
export class BottomNavView extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  private readonly look: SkinViewLook<'bottomNav'>;
  private readonly layout: ReadyUiSkinBottomNavLayout;
  private readonly onSelect: (id: string) => void;
  private readonly onLockedTap: ((id: string) => void) | null;
  private readonly content: Container;
  private readonly panel: NineSliceSprite;
  private readonly nodes: NavItemNode[] = [];
  private selected: string | null;
  private panelTopPx = 0;
  private viewportHeight = 0;
  private itemScale = 1;
  private bottomUnits = 0;
  private disposed = false;

  constructor(options: BottomNavViewOptions) {
    super();
    this.id = options.id ?? 'bottom-nav';
    this.theme = resolveTheme(options.theme);
    const skin = selectSkinView('bottomNav', this.theme.skin);
    if (!skin) throw new Error("BottomNavView needs a Ready UI style that covers 'bottomNav' (theme.skin): Core has no donor bottom navigation art");
    this.look = resolveSkinView('BottomNavView', 'bottomNav', skin, options.textures);
    this.layout = this.look.layout;
    this.onSelect = options.onSelect;
    this.onLockedTap = options.onLockedTap ?? null;

    if (options.items.length === 0) throw new Error('BottomNavView: no items');
    const ids = new Set<string>();
    for (const item of options.items) {
      if (typeof item.id !== 'string' || !item.id) throw new Error('BottomNavView: every item needs a non-empty string id');
      if (ids.has(item.id)) throw new Error(`BottomNavView: duplicate item id '${item.id}'`);
      ids.add(item.id);
    }
    const selectedId = options.selectedId ?? null;
    if (selectedId !== null && !ids.has(selectedId)) throw new Error(`BottomNavView: no item '${selectedId}' to select`);
    this.selected = selectedId;

    this.content = new Container();
    this.addChild(this.content);
    const panelTexture = this.look.art.navPanel!;
    const panelCaps = skinNineSlice(skin, 'navPanel');
    this.panel = new NineSliceSprite({ texture: panelTexture, leftWidth: panelCaps.left, topHeight: panelCaps.top, rightWidth: panelCaps.right, bottomHeight: panelCaps.bottom });
    this.panel.eventMode = 'none';
    this.content.addChild(this.panel);

    // the style's text look, the nav's own outline over it, the nav's label colour
    const outline = this.layout.text;
    const textLook = { ...skinTextLook(skin), ...(outline ? { strokeOutside: outline.strokeOutside, shadowY: outline.shadowY } : {}), ...(outline?.strokeColor !== undefined ? { strokeColor: outline.strokeColor } : {}), fill: this.layout.textFill };
    for (const item of options.items) {
      const root = new Container();
      const inner = new Container();
      root.addChild(inner);
      const selCaps = skinNineSlice(skin, 'navSelected');
      const background = new NineSliceSprite({ texture: this.look.art.navSelected!, leftWidth: selCaps.left, topHeight: selCaps.top, rightWidth: selCaps.right, bottomHeight: selCaps.bottom });
      background.eventMode = 'none';
      const iconTexture = this.iconTexture(item, skin.id, options.textures);
      const icon = iconTexture ? new Sprite(iconTexture) : null;
      const lock = new Sprite(this.look.art.navLock!);
      const text = item.label ?? (item.labelKey !== undefined ? options.i18n?.t(item.labelKey) : undefined);
      const label = text !== undefined && text !== '' ? createFigmaLabel(this.theme, text, this.layout.normal.label?.fontSize ?? 40, textLook) : null;
      for (const sprite of [icon, lock]) {
        if (!sprite) continue;
        sprite.anchor.set(0.5);
        sprite.eventMode = 'none';
      }
      inner.addChild(background);
      if (icon) inner.addChild(icon);
      inner.addChild(lock);
      if (label) inner.addChild(label);
      root.eventMode = 'static';
      root.cursor = 'pointer';

      const controller = options.ui.createButton({
        id: `${this.id}:item:${item.id}`,
        enabled: item.disabled !== true,
        pressDurationMs: 70,
        releaseDurationMs: 140,
        releaseEase: 'backOut',
        onProgress: (progress) => inner.scale.set(1 - (1 - PRESS_SCALE) * progress),
        onTap: () => this.onItemTap(item.id)
      });
      const node: NavItemNode = { item, locked: item.locked === true, disabled: item.disabled === true, root, inner, background, icon, lock, label, controller };
      root.on('pointerdown', (event: FederatedPointerEvent) => controller.pointerDown(event.pointerId, event.global.x, event.global.y));
      root.on('pointermove', (event: FederatedPointerEvent) => controller.pointerMove(event.pointerId, event.global.x, event.global.y));
      root.on('pointerup', (event: FederatedPointerEvent) => controller.pointerUp(event.pointerId, event.global.x, event.global.y, true));
      root.on('pointerupoutside', (event: FederatedPointerEvent) => controller.pointerUp(event.pointerId, event.global.x, event.global.y, false));
      root.on('pointercancel', (event: FederatedPointerEvent) => controller.pointerCancel(event.pointerId, 'pointerCancel'));
      this.content.addChild(root);
      this.nodes.push(node);
    }
    this.resize(options.width ?? 390, options.height ?? 844);
  }

  /** The item drawn as selected, or null. */
  get selectedId(): string | null {
    return this.selected;
  }

  get itemIds(): string[] {
    return this.nodes.map((node) => node.item.id);
  }

  /** Viewport y (px) of the panel's top edge: what a screen places its bottom-most content above. */
  get top(): number {
    return this.panelTopPx;
  }

  /** Viewport px from the bottom edge up to the panel's top edge (the bottom inset included). */
  get barHeight(): number {
    return this.viewportHeight - this.panelTopPx;
  }

  isLocked(id: string): boolean {
    return this.node(id).locked;
  }

  isDisabled(id: string): boolean {
    return this.node(id).disabled;
  }

  /** The item's slot container (for host FX and checks), or null for an unknown id. */
  getItemContainer(id: string): Container | null {
    return this.nodes.find((node) => node.item.id === id)?.root ?? null;
  }

  /** Draws `id` as selected (null = none). The host calls it after it routed; a tap never selects by itself. */
  setSelected(id: string | null): void {
    if (id !== null) this.node(id);
    this.selected = id;
    this.layoutItems();
  }

  /** Locks or unlocks an item; a locked item shows the lock and only reports `onLockedTap`. */
  setLocked(id: string, locked: boolean): void {
    this.node(id).locked = locked;
    this.layoutItems();
  }

  /** Disables or enables an item; a disabled item keeps its look and ignores taps (a press in progress is cancelled). */
  setDisabled(id: string, disabled: boolean): void {
    const node = this.node(id);
    node.disabled = disabled;
    node.controller.setEnabled(!disabled);
    this.layoutItems();
  }

  resize(width: number, height: number, options: BottomNavResizeOptions = {}): void {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    const insets = options.insets ?? {};
    const bottom = Math.max(0, insets.bottom ?? 0);
    const left = Math.max(0, insets.left ?? 0);
    const right = Math.max(0, insets.right ?? 0);
    const s = Math.min(w / this.theme.designWidth, h / this.theme.designHeight);
    const layout = this.layout;
    this.viewportHeight = h;
    this.bottomUnits = bottom / s;
    this.panelTopPx = h - bottom - layout.panelHeight * s;
    const centerX = left + (w - left - right) / 2;
    this.content.position.set(centerX, this.panelTopPx);
    this.content.scale.set(s);

    // the panel spans the whole viewport width and reaches down through the bottom inset
    this.panel.position.set(-centerX / s, -layout.panelBleedTop);
    this.panel.width = w / s;
    this.panel.height = layout.panelBleedTop + layout.panelHeight + this.bottomUnits;

    // slots `pitch` apart, shrinking on a narrow screen; an item scales only when its selected background stops fitting
    const available = (w - left - right) / s;
    const pitch = Math.min(layout.pitch, available / this.nodes.length);
    this.itemScale = Math.min(1, pitch / layout.selectedBackground.width);
    this.nodes.forEach((node, i) => {
      node.root.position.set((i - (this.nodes.length - 1) / 2) * pitch, 0);
      node.root.scale.set(this.itemScale);
      const k = this.itemScale;
      const top = layout.selected.icon.y - layout.selected.icon.size / 2;
      node.root.hitArea = new Rectangle(-pitch / 2 / k, top, pitch / k, (layout.panelHeight + this.bottomUnits) / k - top);
    });
    this.layoutItems();
    applyTextResolution(this.content, s * this.itemScale * (options.pixelRatio ?? 1));
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of this.nodes) {
      node.controller.dispose();
      node.root.removeAllListeners();
    }
    super.destroy(options ?? { children: true });
  }

  // --- internals ---

  private node(id: string): NavItemNode {
    const node = this.nodes.find((entry) => entry.item.id === id);
    if (!node) throw new Error(`BottomNavView: no item '${id}'`);
    return node;
  }

  private iconTexture(item: BottomNavItem, skinId: string, textures: ReadyUiTextures): Texture | null {
    if (item.icon === undefined) return null;
    if (typeof item.icon !== 'string') return item.icon;
    const texture = textures.skins?.[skinId]?.[item.icon];
    if (!texture) throw new Error(`BottomNavView: item '${item.id}' names icon role '${item.icon}', which style '${skinId}' did not load`);
    return texture;
  }

  /** Applies each item's state (locked > selected > normal) to its parts. */
  private layoutItems(): void {
    const layout = this.layout;
    for (const node of this.nodes) {
      const state: ReadyUiSkinBottomNavItemLayout = node.locked ? layout.locked : node.item.id === this.selected ? layout.selected : layout.normal;
      const selected = !node.locked && node.item.id === this.selected;
      node.background.visible = selected;
      if (selected) {
        const box = layout.selectedBackground;
        node.background.position.set(box.x, box.y);
        node.background.width = box.width;
        // down to the viewport's bottom edge, whatever the item's fit scale
        node.background.height = (layout.panelHeight + this.bottomUnits) / this.itemScale - box.y;
      }
      const place = (sprite: Sprite, visible: boolean): void => {
        sprite.visible = visible;
        if (!visible) return;
        sprite.position.set(state.icon.x, state.icon.y);
        sprite.scale.set(state.icon.size / Math.max(1, sprite.texture.width, sprite.texture.height));
      };
      if (node.icon) place(node.icon, !node.locked);
      place(node.lock, node.locked);
      if (node.label) {
        const box = state.label;
        node.label.visible = box !== null;
        if (box) {
          node.label.style.fontSize = box.fontSize;
          placeFigmaLabel(node.label, { x: box.x, y: box.y, width: box.width, height: box.height, align: 'center' });
        }
      }
      node.root.cursor = node.locked || node.disabled ? 'default' : 'pointer';
    }
  }

  private onItemTap(id: string): void {
    if (this.disposed) return;
    const node = this.node(id);
    if (node.disabled) return;
    if (node.locked) {
      this.onLockedTap?.(id);
      return;
    }
    this.onSelect(id);
  }
}
