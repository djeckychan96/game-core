import { Container, type FederatedPointerEvent, type FederatedWheelEvent, Graphics, NineSliceSprite, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import type { LocalizationTextProvider, MotionHandle, MotionRuntime, UiRuntime, WindowState } from '../index';
import type { ReadyUiTextures } from './assets';
import { BottomNavView } from './BottomNavView';
import { levelMapNavOptions, type LevelMapScreenInsets, type LevelMapScreenNav, type LevelMapScreenResizeOptions } from './LevelMapScreen';
import { localizedText } from './localization';
import { READY_UI_EN } from './locales/en';
import type { ShopItem } from './ShopWindowView';
import {
  resolveSkinView,
  selectSkinView,
  skinNineSlice,
  skinTextBoxLook,
  skinTextLook,
  type ReadyUiSkin,
  type ReadyUiSkinLivesTextBox,
  type ReadyUiSkinShopScreenLayout,
  type SkinViewLook
} from './skin';
import { applyTextResolution, createFigmaLabel, placeFigmaLabel } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';
import { UiButton } from './UiButton';

/** The style's pack pictures, one per card slot (the sixth serves every later slot). */
export type ShopPackRole = 'shopPack1' | 'shopPack2' | 'shopPack3' | 'shopPack4' | 'shopPack5' | 'shopPack6';

const PACK_ROLES: readonly ShopPackRole[] = ['shopPack1', 'shopPack2', 'shopPack3', 'shopPack4', 'shopPack5', 'shopPack6'];

/**
 * One pack of the shop: the host's data (from its catalog / PurchaseRuntime products) — Core invents no product, price
 * or amount. `ShopItem` (`id`, `amount`, already-localized `price`) plus how the card shows it.
 */
export interface ShopScreenItem extends ShopItem {
  /** The pack picture: a host texture (contain-fit into the style's pack box) or a style role; default the style's art for the card's slot. */
  readonly icon?: Texture | ShopPackRole;
  /** `false` = drawn dimmed and inert (not on sale now); default true. */
  readonly available?: boolean;
}

export interface ShopScreenOptions {
  ui: UiRuntime;
  /** The host's MotionRuntime: the scroll fling (scope `<id>:scroll`) and the navigation's LOCK shake. */
  motion: MotionRuntime;
  textures: ReadyUiTextures;
  /** Must carry a style that covers `shopScreen` and `bottomNav` (Core has no donor art for the shop tab). */
  theme?: ReadyUiThemeOverrides;
  i18n?: LocalizationTextProvider;
  /** Unique id per UiRuntime; the parts register as `<id>:item:<n>`, `<id>:close`, `<id>:nav`. Default `shop-screen`. */
  id?: string;
  /** The packs, in card order (three per row); default none. Replace them with `setItems`. */
  items?: readonly ShopScreenItem[];
  /** The title on the tape, already localized; default the localized `core.shop.title` (SHOP / МАГАЗИН). */
  title?: string;
  /** Settled tap on an available pack while buying is enabled. The purchase is the host's (PurchaseRuntime): the screen stays open. */
  onBuy: (item: ShopScreenItem) => void;
  /** The style's × (drawn only with it): the host leaves the shop (e.g. back to the map). */
  onClose?: () => void;
  /**
   * The bottom navigation — the same SHOP | HOME | LOCK slots as LevelMapScreen, SHOP drawn selected (or a generic item
   * list): the host routes `home.onTap` back to its map; a SHOP / HOME slot without `onTap` is inert, LOCK shakes.
   */
  nav?: LevelMapScreenNav;
  /** Start hidden (a tab the host shows later with `show()`). Default false. */
  hidden?: boolean;
  width?: number;
  height?: number;
}

/** Where the tab is: hidden, opening (`entering`), open, or closing (`leaving`) — the WindowController's state names. */
export type ShopScreenState = WindowState;

export interface ShopScreenShowOptions {
  /** `false` = shown at once (no entrance). Default true. */
  animate?: boolean;
  /** Runs once this show has finished its entrance (at once when the tab is already open); a `hide()` before that drops it. */
  onShown?: () => void;
}

export interface ShopScreenHideOptions {
  /** `false` = hidden at once (no leave). Default true. */
  animate?: boolean;
  /**
   * Runs once this hide has finished its leave and the tab is invisible (at once when it is already hidden) — e.g. the
   * host's map return; a `show()` before that drops it (the tab never closed).
   */
  onHidden?: () => void;
}

interface ShopCard {
  readonly item: ShopScreenItem;
  /** The card's motion layer: the entrance fades and lifts it (the button keeps its own scale and alpha). */
  readonly slot: Container;
  /** The grid row: the entrance staggers the rows. */
  readonly row: number;
  readonly button: UiButton;
  readonly pack: Sprite;
  readonly amount: Text;
  readonly price: Text;
}

const DRAG_THRESHOLD = 6;
const CARD_PRESS_SCALE = 0.9;

/**
 * The tab's entrance / leave: ONE progress (0 hidden … 1 open) tweened linearly, each part on its own stretch of it with
 * an ease-out — the awning (and the ×) slide down from above the viewport, the background and the navigation fade in,
 * the title and then the card rows rise into place, row by row. The leave runs the same curve backwards (the cards go
 * first, the background last), and an interrupted transition turns round from where it is, its time scaled by the
 * distance left. Plain alpha / position writes, no filters.
 */
const TRANSITION = {
  enterMs: 380,
  leaveMs: 300,
  background: [0, 0.5],
  awning: [0, 0.7],
  title: [0.2, 0.65],
  /** row r: from `rowStart + rowStep × min(r, 3)`, over `rowSpan` */
  rowStart: 0.3,
  rowStep: 0.1,
  rowSpan: 0.4,
  /** design units the title and the cards rise by */
  rise: 36
} as const;

/** `p` mapped onto the stretch [from, to] (0 before it, 1 after it), eased out (cubic, MotionRuntime's `easeOut`). */
function stretch(p: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (p - from) / (to - from)));
  return 1 - (1 - t) ** 3;
}

/**
 * The shop TAB of the main-screen navigation (theme_light_6 `market_screen_*`): a full-screen, opaque, NON-modal screen —
 * the style's background, the awning across the top, the title tape and a grid of pack cards (three per row, scrolling
 * when they do not fit) and the same bottom navigation as LevelMapScreen with SHOP selected. It is not a window: no
 * dim, no WindowController, `ui.isBlocking()` stays false, and nothing is drawn over the map — the host shows it
 * instead of the map screen (`map.visible = false; shop.show()`), and HOME / × bring the map back the same way, so the
 * map, its scroll and the progress are never rebuilt. Routing, the catalog and the purchase stay the host's: a card tap
 * reports `onBuy(item)`; `setBuyEnabled(false)` holds the cards while the host's purchase is in flight. The modal
 * `ShopWindowView` is a separate, unchanged view.
 *
 * Layout: the style's 1080 × 2344 frame, its top edge on the viewport's top edge and its centre on the safe area's centre,
 * in one of Figma's two compositions. MOBILE (the phone frame): scaled to the safe width — the three cards span the
 * width like Figma's phone — while the designed rows (`grid.rows`) fit above the navigation at that scale; the awning
 * reaches up under the status bar, the × keeps its distance from the safe area's right edge (never above the safe top).
 * DESKTOP (Figma PC, every viewport where the mobile one does not fit — wide or short): the contain-fit design scale
 * (the column compact in the centre), the awning raised to `desktop.awningY` and the × beside the title tape. In both
 * the background and the awning tiles span the whole viewport and the navigation sits at the bottom edge above the
 * bottom inset (its own unchanged scale).
 *
 * Motion: `show()` / `hide()` play a short entrance / leave (380 / 300 ms, see TRANSITION) that a call in the other
 * direction turns round from where it is; `{ animate: false }` switches at once. While open or opening the screen takes
 * every tap over it (nothing under it is reached); while leaving it takes none — a host that shows its map under it
 * before `hide()` gets the map's taps at once — and no card or × reports. `hide({ onHidden })` runs the host's
 * continuation once the leave is over (the tab invisible).
 */
export class ShopScreen extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  readonly nav: BottomNavView;
  private readonly ui: UiRuntime;
  private readonly motion: MotionRuntime;
  private readonly look: SkinViewLook<'shopScreen'>;
  private readonly layout: ReadyUiSkinShopScreenLayout;
  private readonly skin: ReadyUiSkin;
  private readonly onBuy: (item: ShopScreenItem) => void;
  private readonly onCloseTap: (() => void) | null;
  private readonly scrollScope: string;
  private readonly background: Graphics;
  private readonly backgroundArt: Sprite | null;
  /** The frame layer: design units, origin at the frame's top centre. */
  private readonly body: Container;
  private readonly scrollArea: Container;
  private readonly content: Container;
  private readonly contentMask: Graphics;
  /** The awning and the ×: the transition slides this layer down from above the viewport. */
  private readonly chrome: Container;
  private readonly awning: Container;
  private readonly awningTiles: Sprite[] = [];
  /** The title tape and its text: the transition fades and lifts this layer. */
  private readonly titleGroup: Container;
  private readonly ribbon: NineSliceSprite;
  private readonly titleText: Text;
  private readonly closeButton: UiButton | null;
  private cards: ShopCard[] = [];
  private buying = true;
  private scale_ = 1;
  private pixelRatio = 1;
  private scrollOffset = 0;
  private scrollMin = 0;
  private dragPointerId: number | null = null;
  private dragLastY = 0;
  private dragMoved = 0;
  private dragVelocity = 0;
  private scrollHandle: MotionHandle | null = null;
  private viewport = { width: 390, height: 844, insets: {} as LevelMapScreenInsets };
  private disposed = false;
  private stateValue: ShopScreenState = 'shown';
  /** The transition progress: 0 hidden … 1 open. */
  private progress = 1;
  /** Body units the chrome slides up by when hidden (its lowest part ends at the viewport's top edge). */
  private chromeTravel = 0;
  private transitionHandle: MotionHandle | null = null;
  private readonly transitionScope: string;
  /** Continuations of the transition in flight (same direction); a turn-round drops them. */
  private pending: Array<() => void> = [];

  constructor(options: ShopScreenOptions) {
    super();
    this.id = options.id ?? 'shop-screen';
    this.theme = resolveTheme(options.theme);
    const skin = selectSkinView('shopScreen', this.theme.skin);
    if (!skin) throw new Error("ShopScreen needs a Ready UI style that covers 'shopScreen' (theme.skin): Core has no donor art for the shop tab");
    this.look = resolveSkinView('ShopScreen', 'shopScreen', skin, options.textures);
    this.layout = this.look.layout;
    this.skin = skin;
    this.ui = options.ui;
    this.motion = options.motion;
    this.onBuy = options.onBuy;
    this.onCloseTap = options.onClose ?? null;
    this.scrollScope = `${this.id}:scroll`;
    this.transitionScope = `${this.id}:transition`;
    const art = this.look.art;
    const layout = this.layout;
    const textLook = skinTextLook(skin);

    this.background = new Graphics();
    this.background.eventMode = 'none';
    this.backgroundArt = layout.background.art ? new Sprite(art.shopBackground!) : null;
    if (this.backgroundArt) {
      this.backgroundArt.anchor.set(0.5);
      this.backgroundArt.eventMode = 'none';
    }

    this.body = new Container();
    // the scrolled column: a static input area (drag / wheel anywhere on it) holding the moving content
    this.scrollArea = new Container();
    this.scrollArea.eventMode = 'static';
    this.content = new Container();
    this.scrollArea.addChild(this.content);
    this.contentMask = new Graphics();
    this.scrollArea.addChild(this.contentMask);
    this.content.mask = this.contentMask;

    const ribbonBox = layout.title.ribbon;
    const caps = skinNineSlice(skin, 'shopTitle', 'shopScreen');
    this.ribbon = new NineSliceSprite({ texture: art.shopTitle!, leftWidth: caps.left, topHeight: caps.top, rightWidth: caps.right, bottomHeight: caps.bottom });
    this.ribbon.eventMode = 'none';
    this.ribbon.position.set(this.frameX(ribbonBox.x), ribbonBox.y);
    this.ribbon.width = ribbonBox.width;
    this.ribbon.height = ribbonBox.height;
    const titleBox = layout.title.label;
    this.titleText = createFigmaLabel(this.theme, localizedText(options.title, options.i18n, 'core.shop.title', READY_UI_EN['core.shop.title']), titleBox.fontSize, skinTextBoxLook(textLook, titleBox));
    this.titleText.eventMode = 'none';
    this.titleGroup = new Container();
    this.titleGroup.addChild(this.ribbon, this.titleText);
    this.content.addChild(this.titleGroup);
    this.placeTitle();

    this.chrome = new Container();
    this.awning = new Container();
    this.awning.eventMode = 'none';
    this.chrome.addChild(this.awning);

    const close = layout.close;
    this.closeButton = this.onCloseTap ? new UiButton({
      ui: options.ui,
      id: `${this.id}:close`,
      theme: this.theme,
      texture: art.shopClose!,
      width: close.width,
      height: close.height,
      minHitSize: close.minHitSize,
      pressScale: 0.86,
      onTap: () => this.closeTapped()
    }) : null;

    if (this.closeButton) this.chrome.addChild(this.closeButton);
    this.body.addChild(this.scrollArea, this.chrome);

    this.nav = new BottomNavView({
      ui: options.ui,
      motion: options.motion,
      textures: options.textures,
      ...(options.theme ? { theme: options.theme } : {}),
      ...(options.i18n ? { i18n: options.i18n } : {}),
      ...levelMapNavOptions(options.nav ?? {}, options.i18n, 'shop'),
      id: `${this.id}:nav`
    });

    // bottom → top: the fill, the picture, the scrolled column under the awning and the ×, the navigation
    this.addChild(this.background);
    if (this.backgroundArt) this.addChild(this.backgroundArt);
    this.addChild(this.body, this.nav);

    this.scrollArea.on('pointerdown', this.onPointerDown, this);
    this.scrollArea.on('globalpointermove', this.onPointerMove, this);
    this.scrollArea.on('pointerup', this.onPointerUp, this);
    this.scrollArea.on('pointerupoutside', this.onPointerUp, this);
    this.scrollArea.on('wheel', this.onWheel, this);

    this.buildCards(options.items ?? []);
    if (options.hidden === true) {
      this.stateValue = 'hidden';
      this.progress = 0;
    }
    this.visible = this.stateValue !== 'hidden';
    this.eventMode = this.visible ? 'static' : 'none';
    this.resize(options.width ?? 390, options.height ?? 844);
  }

  /** The packs on the cards, in order. */
  get items(): readonly ShopScreenItem[] {
    return this.cards.map((card) => card.item);
  }

  /** Whether the tab is the current one: open or opening (false from `hide()` on, while it still fades out). */
  get shown(): boolean {
    return this.stateValue === 'shown' || this.stateValue === 'entering';
  }

  /** `hidden` | `entering` | `shown` | `leaving` (a hidden tab draws nothing and takes no input). */
  get state(): ShopScreenState {
    return this.stateValue;
  }

  /** Whether a tap on an available card reports `onBuy` (false while the host's purchase is in flight). */
  get buyEnabled(): boolean {
    return this.buying;
  }

  /** Content scroll in design units: 0 at the top, negative when scrolled down; `scrollable` = the cards do not fit. */
  get scrollY(): number {
    return this.scrollOffset;
  }

  get scrollable(): boolean {
    return this.scrollMin < 0;
  }

  /**
   * Shows the tab with its entrance (or at once with `animate: false`); called while it leaves, it turns round from where
   * it is. Items, scroll and the buying state stay as they were.
   */
  show(options: ShopScreenShowOptions = {}): void {
    if (this.disposed) return;
    if (this.stateValue === 'leaving') this.pending = [];
    if (options.onShown) this.pending.push(options.onShown);
    this.visible = true;
    this.eventMode = 'static';
    this.stateValue = 'entering';
    this.transitionTo(1, options.animate !== false);
  }

  /**
   * Hides the tab with its leave (or at once with `animate: false`); called while it opens, it turns round from where it
   * is. A press, a drag or a fling in progress is cancelled at once (never a purchase, never a late scroll) and the
   * screen takes no input from here on; `onHidden` runs when it is invisible.
   */
  hide(options: ShopScreenHideOptions = {}): void {
    if (this.disposed) return;
    if (this.stateValue === 'entering') this.pending = [];
    if (options.onHidden) this.pending.push(options.onHidden);
    this.cancelInput();
    this.eventMode = 'none';
    if (this.stateValue !== 'hidden') this.stateValue = 'leaving';
    this.transitionTo(0, options.animate !== false);
  }

  /** Replaces the packs (the host's catalog changed): new cards in the same layout, scroll kept within the new range. */
  setItems(items: readonly ShopScreenItem[]): void {
    if (this.disposed) return;
    this.cancelInput();
    this.buildCards(items);
    this.layoutViewport();
  }

  /** The tape's title (already localized). */
  setTitle(text: string): void {
    if (this.disposed) return;
    this.titleText.text = text;
    this.placeTitle();
  }

  /**
   * Holds or releases the cards while the host's purchase is in flight: held cards are inert (no press, no `onBuy`)
   * and drawn at 85 %; an unavailable pack stays dimmed and inert either way.
   */
  setBuyEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.buying = enabled;
    for (const card of this.cards) this.applyCardState(card);
  }

  /** The card of `itemId` (for host FX and checks), or null. */
  getCardContainer(itemId: string): Container | null {
    return this.cards.find((card) => card.item.id === itemId)?.button ?? null;
  }

  /** Scrolls the column back to the top at once. */
  scrollToTop(): void {
    this.stopFling();
    this.setScroll(0);
  }

  resize(width: number, height: number, options: LevelMapScreenResizeOptions = {}): void {
    if (this.disposed) return;
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    this.viewport = { width: w, height: h, insets: options.insets ?? {} };
    this.pixelRatio = options.pixelRatio ?? this.pixelRatio;
    this.layoutViewport();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = [];
    this.stopTransition(); // before Pixi nulls the layers' positions
    this.stopFling();
    this.motion.cancelScope(this.scrollScope);
    this.scrollArea.off('pointerdown', this.onPointerDown, this);
    this.scrollArea.off('globalpointermove', this.onPointerMove, this);
    this.scrollArea.off('pointerup', this.onPointerUp, this);
    this.scrollArea.off('pointerupoutside', this.onPointerUp, this);
    this.scrollArea.off('wheel', this.onWheel, this);
    for (const card of this.cards) card.button.destroy();
    this.cards = [];
    this.closeButton?.destroy();
    super.destroy(options ?? { children: true });
  }

  // --- layout ---

  /** Frame x → the body's x (origin on the frame centre). */
  private frameX(x: number): number {
    return x - this.skin.frame.width / 2;
  }

  private placeTitle(): void {
    const box = this.layout.title.label;
    placeFigmaLabel(this.titleText, { x: this.frameX(box.x), y: box.y, width: box.width, height: box.height, align: 'center' });
  }

  private layoutViewport(): void {
    const { width: w, height: h, insets } = this.viewport;
    const top = Math.max(0, insets.top ?? 0);
    const bottom = Math.max(0, insets.bottom ?? 0);
    const left = Math.max(0, insets.left ?? 0);
    const right = Math.max(0, insets.right ?? 0);
    const layout = this.layout;
    // the navigation first (its own design scale): the composition depends on where its panel starts
    this.nav.resize(w, h, { insets: { bottom, left, right }, pixelRatio: this.pixelRatio });
    const mobileScale = (w - left - right) / this.skin.frame.width;
    const designedBottom = layout.grid.top + (layout.grid.rows - 1) * layout.grid.pitchY + layout.card.box.height + layout.scroll.bottomGap;
    const mobile = designedBottom * mobileScale <= this.nav.top;
    const s = mobile ? mobileScale : Math.min(w / this.theme.designWidth, h / this.theme.designHeight);
    this.scale_ = s;
    const centerX = left + (w - left - right) / 2;

    // an opaque screen: while open it takes every tap over it, so nothing under it is reached
    this.hitArea = new Rectangle(0, 0, w, h);
    this.background.clear().rect(0, 0, w, h).fill(layout.background.color);
    if (this.backgroundArt) {
      const texture = this.backgroundArt.texture;
      const k = Math.max(w / Math.max(1, texture.width), h / Math.max(1, texture.height));
      this.backgroundArt.scale.set(k);
      this.backgroundArt.position.set(w / 2, h / 2);
    }

    this.body.position.set(centerX, 0);
    this.body.scale.set(s);
    // the viewport's left / right edges in body units
    const edgeL = -centerX / s;
    const edgeR = (w - centerX) / s;

    // awning tiles `width` apart, one centred on the frame, across the whole viewport width
    const tile = layout.awning;
    this.awning.y = mobile ? 0 : layout.desktop.awningY;
    const kMin = Math.floor((edgeL + tile.width / 2) / tile.width);
    const kMax = Math.ceil((edgeR - tile.width / 2) / tile.width);
    const count = Math.max(1, kMax - kMin + 1);
    while (this.awningTiles.length < count) {
      const sprite = new Sprite(this.look.art.shopAwning!);
      sprite.eventMode = 'none';
      this.awning.addChild(sprite);
      this.awningTiles.push(sprite);
    }
    this.awningTiles.forEach((sprite, i) => {
      sprite.visible = i < count;
      sprite.width = tile.width;
      sprite.height = tile.height;
      sprite.position.set((kMin + i) * tile.width - tile.width / 2, 0);
    });

    this.chromeTravel = this.awning.y + tile.height;
    if (this.closeButton) {
      const close = layout.close;
      const safeRight = (w - right - centerX) / s;
      const safeTop = top / s;
      this.closeButton.setIdleScale(1);
      if (mobile) this.closeButton.position.set(safeRight - close.right - close.width / 2, Math.max(close.y, safeTop) + close.height / 2);
      else this.closeButton.position.set(Math.min(this.frameX(layout.desktop.close.x), safeRight - close.width / 2), Math.max(layout.desktop.close.y, safeTop + close.height / 2));
      this.chromeTravel = Math.max(this.chromeTravel, this.closeButton.y + Math.max(close.height, close.minHitSize) / 2);
    }

    // the scrolled column: from `scroll.top` down to `bottomGap` above the navigation panel
    const areaTop = layout.scroll.top;
    const areaBottom = Math.max(areaTop + 1, this.nav.top / s - layout.scroll.bottomGap);
    this.scrollArea.hitArea = new Rectangle(edgeL, areaTop, edgeR - edgeL, areaBottom - areaTop);
    this.contentMask.clear().rect(edgeL, areaTop, edgeR - edgeL, areaBottom - areaTop).fill(0xffffff);
    this.scrollMin = -Math.max(0, this.contentBottom() - areaBottom);
    this.setScroll(this.scrollOffset);

    applyTextResolution(this.body, s * this.pixelRatio);
    this.applyTransition();
  }

  /** The bottom of the scrolled column (frame y): the last card row's art, or the title tape when there is no card. */
  private contentBottom(): number {
    const layout = this.layout;
    const ribbon = layout.title.ribbon;
    const rows = Math.ceil(this.cards.length / layout.grid.columns);
    const cards = rows > 0 ? layout.grid.top + (rows - 1) * layout.grid.pitchY + layout.card.art.y + layout.card.art.height : 0;
    return Math.max(ribbon.y + ribbon.height, cards);
  }

  // --- cards ---

  private buildCards(items: readonly ShopScreenItem[]): void {
    const ids = new Set<string>();
    for (const item of items) {
      if (typeof item?.id !== 'string' || !item.id) throw new Error('ShopScreen: every item needs a non-empty string id');
      if (ids.has(item.id)) throw new Error(`ShopScreen: duplicate item id '${item.id}'`);
      if (!Number.isFinite(item.amount)) throw new Error(`ShopScreen: item '${item.id}' needs a finite amount`);
      if (typeof item.price !== 'string') throw new Error(`ShopScreen: item '${item.id}' needs a price string (already localized)`);
      ids.add(item.id);
    }
    for (const card of this.cards) {
      card.button.destroy();
      card.slot.destroy();
    }
    this.cards = [];

    const layout = this.layout;
    const card = layout.card;
    const grid = layout.grid;
    const textLook = skinTextLook(this.skin);
    // card-local boxes → button-local (the button's origin is the centre of the card art)
    const cx = card.art.x + card.art.width / 2;
    const cy = card.art.y + card.art.height / 2;
    const slot = (box: ReadyUiSkinLivesTextBox) => ({ x: box.x - cx, y: box.y - cy, width: box.width, height: box.height, align: 'center' as const });

    items.forEach((item, index) => {
      const button = new UiButton({
        ui: this.ui,
        id: `${this.id}:item:${index}`,
        theme: this.theme,
        texture: this.look.art.shopCard!,
        width: card.art.width,
        height: card.art.height,
        pressScale: CARD_PRESS_SCALE,
        onTap: () => this.buy(item)
      });
      const pack = new Sprite(this.packTexture(item, index));
      pack.anchor.set(0.5);
      pack.eventMode = 'none';
      const k = Math.min(card.pack.width / Math.max(1, pack.texture.width), card.pack.height / Math.max(1, pack.texture.height));
      pack.scale.set(k);
      pack.position.set(card.pack.x + card.pack.width / 2 - cx, card.pack.y + card.pack.height / 2 - cy);
      const amount = createFigmaLabel(this.theme, String(Math.round(item.amount)), card.amount.fontSize, skinTextBoxLook(textLook, card.amount));
      const price = createFigmaLabel(this.theme, item.price, card.price.fontSize, skinTextBoxLook(textLook, card.price));
      for (const text of [amount, price]) text.eventMode = 'none';
      placeFigmaLabel(amount, slot(card.amount));
      placeFigmaLabel(price, slot(card.price));
      button.addChild(pack, amount, price);

      const row = Math.floor(index / grid.columns);
      const column = index % grid.columns;
      const inRow = Math.min(grid.columns, items.length - row * grid.columns);
      const boxLeft = this.frameX(this.skin.frame.width / 2 + (column - (inRow - 1) / 2) * grid.pitchX - card.box.width / 2);
      button.position.set(boxLeft + cx, grid.top + row * grid.pitchY + cy);
      const layer = new Container();
      layer.addChild(button);
      this.content.addChild(layer);
      const entry: ShopCard = { item, slot: layer, row, button, pack, amount, price };
      this.cards.push(entry);
      this.applyCardState(entry);
    });
    this.applyTransition();
  }

  private packTexture(item: ShopScreenItem, index: number): Texture {
    const icon = item.icon;
    if (icon !== undefined && typeof icon !== 'string') return icon;
    const role = icon ?? PACK_ROLES[Math.min(index, PACK_ROLES.length - 1)]!;
    if (!PACK_ROLES.includes(role)) throw new Error(`ShopScreen: item '${item.id}' names icon '${String(role)}', which is not a shop pack role (${PACK_ROLES.join(', ')})`);
    return this.look.art[role]!;
  }

  private applyCardState(card: ShopCard): void {
    const available = card.item.available !== false;
    card.button.setEnabled(available && this.buying);
    // unavailable: UiButton's own disabled look; held for a purchase in flight: the donor's 85 % — unless the style
    // draws its inert cards otherwise (a light card faded over a dark fill turns its white face grey)
    const inert = this.layout.card.inertAlpha;
    if (available) card.button.alpha = this.buying ? 1 : inert?.held ?? 0.85;
    else if (inert) card.button.alpha = inert.unavailable;
  }

  private buy(item: ShopScreenItem): void {
    if (this.disposed || !this.shown || !this.buying || item.available === false) return;
    this.onBuy(item);
  }

  private closeTapped(): void {
    if (this.disposed || !this.shown) return;
    this.onCloseTap?.();
  }

  // --- transition ---

  /** Moves the progress to `target` (1 open, 0 hidden): tweened over the share of the full time still to go, or at once. */
  private transitionTo(target: 0 | 1, animate: boolean): void {
    this.stopTransition();
    const distance = Math.abs(target - this.progress);
    if (!animate || distance === 0) {
      this.progress = target;
      this.applyTransition();
      this.settleTransition();
      return;
    }
    const handle: MotionHandle = this.motion.tween({
      scope: this.transitionScope,
      bindings: [{ get: () => this.progress, set: (value: number) => { this.progress = value; this.applyTransition(); }, to: target }],
      durationMs: (target === 1 ? TRANSITION.enterMs : TRANSITION.leaveMs) * distance,
      ease: 'linear',
      onComplete: () => {
        if (this.transitionHandle !== handle) return;
        this.transitionHandle = null;
        this.settleTransition();
      },
      onCancel: () => {
        // cancelled from outside (`core.cancelAll()`, the scope): the tab lands where it was going, never half-drawn
        if (this.transitionHandle !== handle) return;
        this.transitionHandle = null;
        this.progress = target;
        this.applyTransition();
        this.settleTransition();
      }
    });
    this.transitionHandle = handle;
  }

  private stopTransition(): void {
    const handle = this.transitionHandle;
    this.transitionHandle = null;
    handle?.cancel(); // its onCancel sees the handle is no longer current: the progress stays where it is
  }

  /** The progress reached its target: the state settles, a hidden tab goes invisible, the continuations run. */
  private settleTransition(): void {
    if (this.disposed) return;
    if (this.progress >= 1) this.stateValue = 'shown';
    else {
      this.stateValue = 'hidden';
      this.visible = false;
    }
    const done = this.pending;
    this.pending = [];
    for (const callback of done) callback();
  }

  /** Draws the parts for the current progress (layout positions stay the layout's: only the layers' alpha / offsets move). */
  private applyTransition(): void {
    const p = this.progress;
    const fade = stretch(p, TRANSITION.background[0], TRANSITION.background[1]);
    this.background.alpha = fade;
    if (this.backgroundArt) this.backgroundArt.alpha = fade;
    this.nav.alpha = fade;
    this.chrome.y = (stretch(p, TRANSITION.awning[0], TRANSITION.awning[1]) - 1) * this.chromeTravel;
    const title = stretch(p, TRANSITION.title[0], TRANSITION.title[1]);
    this.titleGroup.alpha = title;
    this.titleGroup.y = (1 - title) * TRANSITION.rise;
    for (const card of this.cards) {
      const from = TRANSITION.rowStart + TRANSITION.rowStep * Math.min(card.row, 3);
      const k = stretch(p, from, Math.min(1, from + TRANSITION.rowSpan));
      card.slot.alpha = k;
      card.slot.y = (1 - k) * TRANSITION.rise;
    }
  }

  // --- scroll ---

  private setScroll(offset: number): void {
    this.scrollOffset = Math.max(this.scrollMin, Math.min(0, offset));
    this.content.y = this.scrollOffset;
  }

  private cancelInput(): void {
    this.dragPointerId = null;
    this.stopFling();
    for (const card of this.cards) card.button.controller.cancel();
    this.closeButton?.controller.cancel();
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    this.stopFling();
    if (!this.scrollable || this.dragPointerId !== null) return;
    this.dragPointerId = event.pointerId;
    this.dragLastY = event.global.y;
    this.dragMoved = 0;
    this.dragVelocity = 0;
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const dy = event.global.y - this.dragLastY;
    this.dragLastY = event.global.y;
    this.dragMoved += Math.abs(dy);
    this.dragVelocity = this.dragVelocity * 0.6 + dy * 0.4;
    if (this.dragMoved > DRAG_THRESHOLD) {
      // a drag cancels any card press, so the release is never a purchase
      for (const card of this.cards) card.button.controller.cancel();
      this.setScroll(this.scrollOffset + dy / this.scale_);
    }
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    if (this.dragMoved <= DRAG_THRESHOLD || Math.abs(this.dragVelocity) < 1) return;
    const target = Math.max(this.scrollMin, Math.min(0, this.scrollOffset + (this.dragVelocity * 25) / this.scale_));
    this.scrollHandle = this.motion.tween({
      scope: this.scrollScope,
      bindings: [{ get: () => this.scrollOffset, set: (v: number) => this.setScroll(v), to: target }],
      durationMs: 800,
      ease: 'easeOut',
      onComplete: () => { this.scrollHandle = null; },
      onCancel: () => { this.scrollHandle = null; }
    });
  }

  private onWheel(event: FederatedWheelEvent): void {
    if (!this.scrollable) return;
    this.stopFling();
    this.setScroll(this.scrollOffset - event.deltaY / this.scale_);
  }

  private stopFling(): void {
    const handle = this.scrollHandle;
    this.scrollHandle = null;
    handle?.cancel();
  }
}
