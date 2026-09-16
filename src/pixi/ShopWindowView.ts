import { Container, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { UiButton } from './UiButton';
import { createLabel, fitLabelWidth, formatAmount } from './text';

export interface ShopItem {
  id: string;
  /** Coins in the pack. */
  amount: number;
  /** Already-localized price string (`$1.99`, `99 ₽`). */
  price: string;
}

export interface ShopWindowParams {
  items: ShopItem[];
  title?: string;
}

export interface ShopWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  title?: string;
  /** Close continuation: the player tapped BUY on `item`. */
  onBuy: (item: ShopItem) => void;
}

const COLS = 3;
const CARD_W = 318;
const CARD_H = 418;
const CARD_GAP_X = 26;
const CARD_GAP_Y = 30;
const HEADER_H = 300;
const DEFAULT_BOUNDS = new Rectangle(-540, -600, 1080, 1200);

interface CardView {
  root: Container;
  icon: Sprite;
  amount: Text;
  button: UiButton;
  item: ShopItem | null;
}

/**
 * Coin shop on the donor's striped awning: a grid of blue pack cards (coin pile, amount, green
 * BUY button with the price) and a ×. Up to six packs; BUY is a close() continuation.
 */
export class ShopWindowView extends ModalWindow<ShopWindowParams> {
  private readonly title: Text;
  private readonly cards: CardView[] = [];
  private readonly onBuy: (item: ShopItem) => void;
  private readonly header: Container;
  private bounds: Rectangle = DEFAULT_BOUNDS;

  constructor(options: ShopWindowViewOptions) {
    super({ ...options, id: options.id ?? 'shop-window', maxHeightRatio: options.maxHeightRatio ?? 0.86 });
    this.onBuy = options.onBuy;
    const t = this.textures;

    this.header = new Container();
    const awning = this.sprite(t.shopHeader, 1080, 539);
    awning.y = -HEADER_H / 2 + 20;
    this.header.addChild(awning);
    this.title = createLabel(this.theme, options.title ?? 'SHOP', { fontSize: 96 });
    this.title.y = -HEADER_H / 2 + 44;
    this.header.addChild(this.title);
    this.panel.addChildAt(this.header, 0);

    const coinTextures: Texture[] = [t.shopCoins1, t.shopCoins2, t.shopCoins3, t.shopCoins4, t.shopCoins5, t.shopCoins6];
    for (let i = 0; i < 6; i++) {
      const root = new Container();
      const card = this.sprite(t.shopCard, CARD_W, CARD_H);
      root.addChild(card);
      const icon = new Sprite(coinTextures[i] ?? t.coinBig);
      icon.anchor.set(0.5);
      icon.width = 220;
      icon.height = 186;
      icon.y = -70;
      root.addChild(icon);
      const amount = createLabel(this.theme, '0', { fontSize: 52 });
      amount.y = 62;
      root.addChild(amount);
      const button = new UiButton({
        ui: this.ui,
        id: `${this.id}:buy:${i}`,
        theme: this.theme,
        texture: t.shopBuy,
        width: 264,
        height: 102,
        label: '$0.99',
        fontSize: 44,
        labelOffsetY: -6,
        onTap: () => this.buy(i)
      });
      button.y = 150;
      root.addChild(button);
      this.addButton(button);
      this.panel.addChild(root);
      this.cards.push({ root, icon, amount, button, item: null });
    }
    if (this.closeButton) this.panel.setChildIndex(this.closeButton, this.panel.children.length - 1);
    this.layoutCards(6);
  }

  protected applyParams(params: ShopWindowParams): void {
    if (params.title) this.title.text = params.title;
    const items = params.items.slice(0, this.cards.length);
    this.cards.forEach((card, i) => {
      const item = items[i] ?? null;
      card.item = item;
      card.root.visible = item !== null;
      card.button.setEnabled(item !== null);
      if (!item) return;
      card.amount.text = formatAmount(item.amount);
      fitLabelWidth(card.amount, CARD_W * 0.8);
      card.button.setLabel(item.price);
    });
    this.layoutCards(Math.max(1, items.length));
    this.layoutPanel();
  }

  protected panelBounds(): Rectangle {
    // the base constructor lays out before this subclass's fields are initialized
    return this.bounds ?? DEFAULT_BOUNDS;
  }

  private layoutCards(count: number): void {
    const rows = Math.max(1, Math.ceil(count / COLS));
    const cols = Math.min(COLS, count);
    const gridW = cols * CARD_W + (cols - 1) * CARD_GAP_X;
    const gridH = rows * CARD_H + (rows - 1) * CARD_GAP_Y;
    const top = -HEADER_H / 2 + 170;
    this.cards.forEach((card, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      card.root.position.set(-gridW / 2 + CARD_W / 2 + col * (CARD_W + CARD_GAP_X), top + CARD_H / 2 + row * (CARD_H + CARD_GAP_Y));
    });
    const width = Math.max(1080, gridW + 80);
    const height = HEADER_H / 2 + 20 + top + gridH + 60;
    this.bounds = new Rectangle(-width / 2, -HEADER_H / 2 - 20, width, height);
  }

  /** The × sits on the awning, clear of the first card row. */
  protected override closeButtonPosition(bounds: Rectangle): { x: number; y: number } {
    return { x: bounds.x + bounds.width - 60, y: bounds.y + 60 };
  }

  private buy(index: number): void {
    const item = this.cards[index]?.item;
    if (!item) return;
    this.close('button', () => this.onBuy(item));
  }
}
