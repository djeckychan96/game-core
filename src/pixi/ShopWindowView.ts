import { Container, type FederatedPointerEvent, Graphics, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import type { MotionHandle } from '../index';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { drawAwning } from './skin';
import { UiButton } from './UiButton';
import { applyTextResolution, createLabel, fitLabelWidth, formatAmount } from './text';

export interface ShopItem {
  id: string;
  /** Coins in the pack. */
  amount: number;
  /** Already-localized price string (`$1.99`, `99 ₽`). */
  price: string;
}

export interface ShopWindowParams {
  items: ShopItem[];
  /** Blue ribbon caption. Default `SPECIAL OFFER` (donor). */
  title?: string;
}

export interface ShopWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  title?: string;
  /** Close continuation: the player tapped a pack. */
  onBuy: (item: ShopItem) => void;
}

/** Donor Shop prefab geometry (design units). */
const HEADER_W = 1080;
const HEADER_H = 539;
const HEADER_HEIGHT_RATIO = 36 / 255;
const CLOSE_MARGIN_RIGHT = 64;
const CLOSE_MARGIN_TOP = 124;
const SHOP_CLOSE = 89; // the shop's × is the bigger 89-unit one
const CONTENT_MARGIN = 32;
const TOP_MARGIN = 36;
const BOTTOM_MARGIN = 48;
const MASK_TOP_BLEED = 220;
const SECTION_MAX_SCALE = 1.5;
const CARD_W = 318;
const CARD_H = 418;
const ITEM_SLOTS: Array<[number, number]> = [[-340, 314], [0, 313], [340, 307], [-340, 750], [0, 750], [340, 750]];
const DRAG_THRESHOLD = 6;

interface CardView {
  button: UiButton;
  icon: Sprite;
  amount: Text;
  price: Text;
  item: ShopItem | null;
}

/**
 * Coin shop — the donor's full-screen layout: the striped awning tiled across the top
 * (height 36/255 of the screen), the big × at the top-right, then a column of content scaled to
 * the screen width minus 2 × 32: the blue `SPECIAL OFFER` ribbon and a 3-column grid of pack cards
 * (amount on top, coin pile, price on the card's bottom band). The column scrolls when it does
 * not fit. Each card is a ButtonController; BUY is a close() continuation.
 */
export class ShopWindowView extends ModalWindow<ShopWindowParams> {
  private readonly header: Container;
  private readonly headerTiles: Sprite[] = [];
  private readonly content: Container;
  private readonly gold: Container;
  private readonly title: Text;
  private readonly cards: CardView[] = [];
  private readonly contentMask: Graphics;
  private readonly onBuy: (item: ShopItem) => void;
  private readonly scrollScope: string;
  private designScale = 1;
  private scrollBase = 0;
  private scrollOffset = 0;
  private scrollMin = 0;
  private headerIdleY = 0;
  private dragPointerId: number | null = null;
  private dragLastY = 0;
  private dragMoved = 0;
  private dragVelocity = 0;
  private scrollHandle: MotionHandle | null = null;

  constructor(options: ShopWindowViewOptions) {
    super({ ...options, id: options.id ?? 'shop-window', closeButton: false });
    this.onBuy = options.onBuy;
    this.scrollScope = `${this.id}:scroll`;
    const t = this.textures;

    this.content = new Container();
    this.content.eventMode = 'static';
    this.gold = new Container();
    this.content.addChild(this.gold);
    const ribbon = this.createBadge(1000, 116, 'info', 'ribbon', t.shopRibbon);
    ribbon.x = 3;
    this.gold.addChild(ribbon);
    this.title = createLabel(this.theme, options.title ?? 'SPECIAL OFFER', { fontSize: 80, stroke: 11 });
    this.title.y = -6;
    this.gold.addChild(this.title);

    const coinTextures: Texture[] = [t.shopCoins1, t.shopCoins2, t.shopCoins3, t.shopCoins4, t.shopCoins5, t.shopCoins6];
    ITEM_SLOTS.forEach(([x, y], i) => {
      // the card is the button: a themed card surface (or the donor art) as its first child, the press scales the whole card
      const card = this.createCard(CARD_W, CARD_H, t.shopCard);
      const button = new UiButton({
        ui: this.ui,
        id: `${this.id}:item:${i}`,
        theme: this.theme,
        ...(card instanceof Sprite ? { texture: t.shopCard } : {}),
        width: CARD_W,
        height: CARD_H,
        pressScale: 0.9,
        onTap: () => this.buy(i)
      });
      if (!(card instanceof Sprite)) button.addChildAt(card, 0);
      button.position.set(x, y);
      const icon = new Sprite(coinTextures[i] ?? t.coinBig);
      icon.anchor.set(0.5);
      icon.width = 260;
      icon.height = 220;
      icon.position.set(i === 0 ? 5 : 0, -29);
      const amount = createLabel(this.theme, '0', { fontSize: 68, stroke: 8 });
      amount.y = -140;
      const price = createLabel(this.theme, '', { fontSize: 68, stroke: 8 });
      price.y = 141;
      button.addChild(icon, amount, price);
      this.gold.addChild(button);
      this.addButton(button);
      this.cards.push({ button, icon, amount, price, item: null });
    });
    this.panel.addChild(this.content);

    this.contentMask = new Graphics();
    this.panel.addChild(this.contentMask);
    this.content.mask = this.contentMask;

    this.header = new Container();
    this.header.eventMode = 'none';
    // the awning: drawn from `theme.awning` when the theme has one (and is not the art skin), else the v0.4 tiles
    this.awning = null;
    if (this.theme.awning && this.theme.skin !== 'art') {
      const awning = new Graphics();
      awning.eventMode = 'none';
      this.header.addChild(awning);
      this.awning = awning;
    }
    this.panel.addChild(this.header);

    const close = this.createClose('close', SHOP_CLOSE, 160, options.closeTexture);
    this.panel.addChild(close);
    this.shopClose = close;

    this.content.on('pointerdown', this.onPointerDown, this);
    this.content.on('globalpointermove', this.onPointerMove, this);
    this.content.on('pointerup', this.onPointerUp, this);
    this.content.on('pointerupoutside', this.onPointerUp, this);
    this.layoutPanel();
  }

  private shopClose: UiButton | null = null;
  /** The themed awning (null = the tiled art). Redrawn only when its size changes. */
  private readonly awning: Graphics | null;
  private awningWidth = 0;
  private awningHeight = 0;

  protected applyParams(params: ShopWindowParams): void {
    if (params.title) {
      this.title.text = params.title;
      fitLabelWidth(this.title, 900);
    }
    const items = params.items.slice(0, this.cards.length);
    this.cards.forEach((card, i) => {
      const item = items[i] ?? null;
      card.item = item;
      card.button.visible = item !== null;
      card.button.setEnabled(item !== null);
      if (!item) return;
      card.amount.text = formatAmount(item.amount);
      fitLabelWidth(card.amount, 280);
      card.price.text = item.price;
      fitLabelWidth(card.price, 268);
    });
    this.scrollOffset = 0;
    this.layoutPanel();
  }

  /** Full-screen: panel origin at the viewport center, scaled by the contain-fit design scale. */
  protected override layoutPanel(): void {
    if (!this.header) return; // base constructor runs before the subclass fields exist
    const w = this.viewportWidth;
    const h = this.viewportHeight;
    const s = Math.min(w / this.theme.designWidth, h / this.theme.designHeight);
    this.designScale = s;
    const vw = w / s;
    const vh = h / s;
    const top = Math.max(0, this.insets.top ?? 0) / s;
    const bottom = Math.max(0, this.insets.bottom ?? 0) / s;
    this.setIdle(w / 2, h / 2, s);
    this.panel.hitArea = new Rectangle(-vw / 2, -vh / 2, vw, vh);

    // awning: tiles across the width, height 36/255 of the screen
    const headerScale = (vh * HEADER_HEIGHT_RATIO) / HEADER_H;
    const tileW = HEADER_W * headerScale;
    const tileH = HEADER_H * headerScale;
    const count = Math.max(1, Math.ceil(vw / tileW) + 2);
    const startX = -(count * tileW) / 2 + tileW / 2;
    if (this.awning) {
      // one themed awning across the viewport; it declares the tiles' span as its bounds so the header keeps its geometry
      const awningW = Math.round(vw);
      const awningH = Math.round(tileH);
      if (awningW !== this.awningWidth || awningH !== this.awningHeight) {
        this.awningWidth = awningW;
        this.awningHeight = awningH;
        this.awning.clear();
        drawAwning(this.awning, -awningW / 2, 0, awningW, awningH, this.theme.awning as NonNullable<typeof this.theme.awning>);
        this.awning.boundsArea = new Rectangle(startX - tileW / 2, 0, count * tileW, tileH);
        this.awning._didViewChangeTick++;
      }
    } else {
      while (this.headerTiles.length < count) {
        const tile = new Sprite(this.textures.shopHeader);
        tile.anchor.set(0.5, 0);
        tile.eventMode = 'none';
        this.header.addChild(tile);
        this.headerTiles.push(tile);
      }
      this.headerTiles.forEach((tile, i) => {
        tile.visible = i < count;
        tile.width = tileW;
        tile.height = tileH;
        tile.position.set(startX + i * tileW, 0);
      });
    }
    this.headerIdleY = -vh / 2 + top;
    this.header.y = this.headerIdleY;
    const headerBottom = this.headerIdleY + HEADER_H * headerScale;

    if (this.shopClose) {
      this.shopClose.position.set(vw / 2 - CLOSE_MARGIN_RIGHT - SHOP_CLOSE / 2, -vh / 2 + top + CLOSE_MARGIN_TOP + SHOP_CLOSE / 2);
    }

    // content column scaled to the width; scrolls when taller than the area under the awning
    this.gold.scale.set(1);
    const goldBounds = this.gold.getLocalBounds();
    const sectionScale = Math.min(SECTION_MAX_SCALE, (vw - CONTENT_MARGIN * 2) / Math.max(1, goldBounds.width));
    this.gold.scale.set(sectionScale);
    this.gold.x = -(goldBounds.x + goldBounds.width / 2) * sectionScale;
    this.gold.y = -goldBounds.y * sectionScale;
    const viewportTop = headerBottom + TOP_MARGIN;
    const viewportBottom = vh / 2 - bottom - BOTTOM_MARGIN;
    const visibleHeight = Math.max(1, viewportBottom - viewportTop);
    const contentHeight = goldBounds.height * sectionScale;
    this.scrollBase = viewportTop;
    this.scrollMin = -Math.max(0, contentHeight - visibleHeight);
    this.content.hitArea = new Rectangle(-vw / 2, -MASK_TOP_BLEED, vw, contentHeight + MASK_TOP_BLEED * 2);
    this.contentMask.clear().rect(-vw / 2, viewportTop - MASK_TOP_BLEED, vw, visibleHeight + MASK_TOP_BLEED).fill(0xffffff);
    this.setScroll(this.scrollOffset);
    applyTextResolution(this.panel, s * sectionScale * this.pixelRatio);
  }

  /** Donor entrance: awning slides down from −180, content fades and grows from 0.5. */
  protected override applyTransition(progress: number): void {
    const p = Math.min(1, Math.max(0, progress));
    this.backdrop.alpha = p;
    this.panel.alpha = 1;
    this.panel.position.set(this.viewportWidth / 2, this.viewportHeight / 2);
    this.panel.scale.set(this.designScale);
    if (this.header) this.header.y = this.headerIdleY - 180 * (1 - progress);
    if (this.content) {
      this.content.alpha = p;
      this.content.scale.set(0.5 + 0.5 * progress);
      this.content.x = 0;
    }
    if (this.shopClose) this.shopClose.alpha = p;
  }

  get scrollable(): boolean {
    return this.scrollMin < 0;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.content) {
      this.content.off('pointerdown', this.onPointerDown, this);
      this.content.off('globalpointermove', this.onPointerMove, this);
      this.content.off('pointerup', this.onPointerUp, this);
      this.content.off('pointerupoutside', this.onPointerUp, this);
    }
    this.motion.cancelScope(this.scrollScope);
    super.destroy(options);
  }

  // --- scroll ---

  private setScroll(offset: number): void {
    this.scrollOffset = Math.max(this.scrollMin, Math.min(0, offset));
    this.content.y = this.scrollBase + this.scrollOffset;
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.scrollable || this.dragPointerId !== null) return;
    this.dragPointerId = event.pointerId;
    this.dragLastY = event.global.y;
    this.dragMoved = 0;
    this.dragVelocity = 0;
    this.stopFling();
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const dy = event.global.y - this.dragLastY;
    this.dragLastY = event.global.y;
    this.dragMoved += Math.abs(dy);
    this.dragVelocity = this.dragVelocity * 0.6 + dy * 0.4;
    if (this.dragMoved > DRAG_THRESHOLD) {
      // a drag cancels any card press so the release is never a purchase
      for (const card of this.cards) card.button.controller.cancel();
      this.setScroll(this.scrollOffset + dy / this.designScale);
    }
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    if (this.dragMoved <= DRAG_THRESHOLD || Math.abs(this.dragVelocity) < 1) return;
    const target = this.scrollOffset + (this.dragVelocity * 25) / this.designScale;
    this.scrollHandle = this.motion.tween({
      scope: this.scrollScope,
      bindings: [{ get: () => this.scrollOffset, set: (v: number) => this.setScroll(v), to: Math.max(this.scrollMin, Math.min(0, target)) }],
      durationMs: 800,
      ease: 'easeOut',
      onComplete: () => { this.scrollHandle = null; },
      onCancel: () => { this.scrollHandle = null; }
    });
  }

  private stopFling(): void {
    const handle = this.scrollHandle;
    this.scrollHandle = null;
    handle?.cancel();
  }

  private buy(index: number): void {
    const item = this.cards[index]?.item;
    if (!item) return;
    this.close('button', () => this.onBuy(item));
  }
}

