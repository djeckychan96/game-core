import { CanvasTextMetrics, Container, Sprite, type Text, type Texture } from 'pixi.js';
import type { LocalizationTextProvider, UiRuntime } from '../index';
import { createNineSlice } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import type { ReadyUiSkin, ReadyUiSkinBox, ReadyUiSkinLivesTextBox, ReadyUiSkinOfferLayout, ReadyUiSkinWindow } from './skin';
import { skinNineSlice } from './skin';
import { createFigmaLabel, formatAmount, placeFigmaLabel, type FigmaTextLook } from './text';
import type { ReadyUiTheme } from './theme';
import { UiButton } from './UiButton';

/** The style's own OFFER hero art (`offerLivesArt`: unlimited lives; `offerCoinArt`: coins). */
export type ReadyUiOfferArt = 'offerLivesArt' | 'offerCoinArt';

/** One OFFER item: the host's icon (game content, e.g. a booster) and its count. */
export interface ReadyUiOfferItem {
  icon: Texture;
  label: string;
}

/**
 * An OFFER shown under a styled window (Lives, Confirm): data only — the purchase is the host's (the window reports the
 * tap as a close continuation). Ignored by the donor look and by a style without an offer layout.
 */
export interface ReadyUiOffer {
  /** Default `OFFER` (`core.offer.title`). */
  title?: string;
  /** The hero: the style's art (`'offerLivesArt'` / `'offerCoinArt'`) or a host texture. */
  icon: ReadyUiOfferArt | Texture;
  /** The hero's caption, e.g. `35d` / `2000`. */
  iconLabel?: string;
  /** At most two items (more are not drawn). */
  items?: readonly ReadyUiOfferItem[];
  /** Coin price on the buy button. */
  price: number;
  /** Corner badge text (`x3`, `-60%`); absent / empty = no badge. */
  badge?: string;
}

/** The OFFER panel's art, resolved from the window's style look. */
export interface OfferPanelArt {
  offerPanel: Texture;
  offerBadge: Texture;
  offerLivesArt: Texture;
  offerCoinArt: Texture;
  buttonPrimary: Texture;
  priceIcon: Texture;
  windowClose: Texture;
}

export interface OfferPanelOptions {
  ui: UiRuntime;
  theme: ReadyUiTheme;
  i18n: LocalizationTextProvider | undefined;
  /** The window's id: the buttons register as `<id>:offer` / `<id>:offer-close`. */
  id: string;
  skin: ReadyUiSkin;
  window: ReadyUiSkinWindow;
  layout: ReadyUiSkinOfferLayout;
  art: OfferPanelArt;
  text: FigmaTextLook;
  /** Registers a button with the window (settle / dispose with it). */
  register: (button: UiButton) => UiButton;
  onBuy: () => void;
  onClose: () => void;
}

function boxLook(look: FigmaTextLook, box: ReadyUiSkinLivesTextBox): FigmaTextLook {
  const own: FigmaTextLook = { ...look };
  if (box.fill !== undefined) own.fill = box.fill;
  if (box.stroke) {
    own.strokeOutside = box.stroke.width;
    own.strokeColor = box.stroke.color;
  }
  return own;
}

function place(sprite: Sprite, b: ReadyUiSkinBox): Sprite {
  sprite.position.set(b.x, b.y);
  sprite.width = b.width;
  sprite.height = b.height;
  return sprite;
}

/** Contain-fits a texture into a box, centred. */
function containInto(sprite: Sprite, b: ReadyUiSkinBox): void {
  const tw = Math.max(1, sprite.texture.width);
  const th = Math.max(1, sprite.texture.height);
  const k = Math.min(b.width / tw, b.height / th);
  sprite.width = tw * k;
  sprite.height = th * k;
  sprite.position.set(b.x + (b.width - tw * k) / 2, b.y + (b.height - th * k) / 2);
}

/**
 * The OFFER panel (internal, drawn by LivesWindowView / ConfirmWindowView under their window): local origin = the panel
 * box's top-left, every box from the style's `windows.offer`. `set(offer)` writes the data; nothing here buys anything.
 */
export class OfferPanel extends Container {
  readonly layout: ReadyUiSkinOfferLayout;
  readonly buyButton: UiButton;
  readonly closeButton: UiButton | null;
  private readonly art: OfferPanelArt;
  private readonly textLook: FigmaTextLook;
  private readonly theme: ReadyUiTheme;
  private readonly i18n: LocalizationTextProvider | undefined;
  private readonly title: Text;
  private readonly badge: Sprite;
  private readonly badgeLabel: Text;
  private readonly hero: Sprite;
  private heroLabel: Text;
  private readonly items: { icon: Sprite; label: Text }[];
  private readonly priceText: Text;
  private readonly priceCoin: Sprite;

  constructor(options: OfferPanelOptions) {
    super();
    const { layout: L, art: A, skin } = options;
    this.layout = L;
    this.art = A;
    this.theme = options.theme;
    this.i18n = options.i18n;
    this.textLook = options.text;
    const label = (text: string, box: ReadyUiSkinLivesTextBox): Text => createFigmaLabel(this.theme, text, box.fontSize, boxLook(this.textLook, box));

    const surface = createNineSlice(A.offerPanel, skinNineSlice(skin, 'offerPanel', options.window), L.panel.width, L.panel.height);
    surface.position.set(L.panel.width / 2, L.panel.height / 2);
    this.title = label(READY_UI_LEGACY_TEXT.offer.title, L.title);
    this.hero = new Sprite(A.offerLivesArt);
    this.heroLabel = label('', L.iconLabel);
    this.items = L.items.map((slot) => ({ icon: place(new Sprite(A.offerLivesArt), slot.icon), label: label('', slot.label) }));

    this.buyButton = options.register(new UiButton({
      ui: options.ui, id: `${options.id}:offer`, theme: this.theme, texture: A.buttonPrimary, nineSlice: skinNineSlice(skin, 'buttonPrimary', options.window),
      width: L.button.width, height: L.button.height, pressScale: 0.9, onTap: options.onBuy
    }));
    this.buyButton.position.set(L.button.x + L.button.width / 2, L.button.y + L.button.height / 2);
    this.priceText = createFigmaLabel(this.theme, '0', L.price.fontSize, this.textLook);
    this.priceCoin = new Sprite(L.coin.art ? A[L.coin.art] : A.priceIcon);
    this.priceCoin.width = L.coin.width;
    this.priceCoin.height = L.coin.height;
    this.buyButton.addChild(this.priceText, this.priceCoin);

    this.closeButton = null;
    if (L.close) {
      const c = L.close;
      this.closeButton = options.register(new UiButton({
        ui: options.ui, id: `${options.id}:offer-close`, theme: this.theme, texture: A.windowClose,
        width: c.width, height: c.height, minHitSize: 150, pressScale: 0.86, onTap: options.onClose
      }));
      this.closeButton.position.set(c.x + c.width / 2, c.y + c.height / 2);
    }

    // the badge sticks out of the panel: drawn last so it lies over the panel's corner
    this.badge = place(new Sprite(A.offerBadge), L.badge);
    this.badgeLabel = label('', L.badgeLabel);

    const decoration = [surface, this.title, this.hero, this.heroLabel, ...this.items.flatMap((item) => [item.icon, item.label]), this.badge, this.badgeLabel];
    for (const node of decoration) node.eventMode = 'none';
    this.addChild(surface, this.title, this.hero, this.heroLabel, ...this.items.flatMap((item) => [item.icon, item.label]), this.buyButton);
    if (this.closeButton) this.addChild(this.closeButton);
    this.addChild(this.badge, this.badgeLabel);
  }

  set(offer: ReadyUiOffer): void {
    const L = this.layout;
    this.title.text = localizedText(offer.title, this.i18n, 'core.offer.title', READY_UI_LEGACY_TEXT.offer.title);
    placeFigmaLabel(this.title, { ...L.title, align: L.title.align ?? 'center' });

    let captionBox = L.iconLabel;
    if (typeof offer.icon === 'string') {
      const art = L.iconArt[offer.icon];
      this.hero.texture = this.art[offer.icon];
      place(this.hero, art);
      captionBox = art.label ?? L.iconLabel;
    } else {
      this.hero.texture = offer.icon;
      containInto(this.hero, L.icon);
    }
    // the caption's look follows its box (a style may letter each hero's caption differently)
    const caption = createFigmaLabel(this.theme, offer.iconLabel ?? '', captionBox.fontSize, boxLook(this.textLook, captionBox));
    caption.eventMode = 'none';
    caption.visible = caption.text !== '';
    placeFigmaLabel(caption, { ...captionBox, align: captionBox.align ?? 'center' });
    this.addChildAt(caption, this.getChildIndex(this.heroLabel));
    this.removeChild(this.heroLabel);
    this.heroLabel.destroy();
    this.heroLabel = caption;

    const items = (offer.items ?? []).slice(0, 2);
    // one item takes the centre between the two slots
    const single = items.length === 1 ? ((L.items[1].icon.x + L.items[1].icon.width / 2) - (L.items[0].icon.x + L.items[0].icon.width / 2)) / 2 : 0;
    this.items.forEach((view, index) => {
      const data = items[index];
      view.icon.visible = view.label.visible = data !== undefined;
      if (!data) return;
      const slot = L.items[index] as (typeof L.items)[number];
      view.icon.texture = data.icon;
      containInto(view.icon, { ...slot.icon, x: slot.icon.x + single });
      view.label.text = data.label;
      placeFigmaLabel(view.label, { ...slot.label, x: slot.label.x + single, align: slot.label.align ?? 'center' });
    });

    this.priceText.text = formatAmount(offer.price);
    const advance = CanvasTextMetrics.measureText(this.priceText.text, this.priceText.style).lineWidths[0] ?? 0;
    const left = -(advance + L.price.gap + L.coin.width) / 2;
    const top = L.price.y - L.button.height / 2;
    placeFigmaLabel(this.priceText, { x: left, y: top, width: advance, height: L.price.height, align: 'left' });
    this.priceCoin.position.set(left + advance + L.price.gap, L.coin.y - L.button.height / 2);

    const badge = offer.badge ?? '';
    this.badge.visible = this.badgeLabel.visible = badge !== '';
    if (badge !== '') {
      const b = L.badgeLabel;
      this.badgeLabel.text = badge;
      // laid out unrotated around the box centre, then turned about that centre
      this.badgeLabel.rotation = 0;
      placeFigmaLabel(this.badgeLabel, { x: -b.width / 2, y: -b.height / 2, width: b.width, height: b.height, align: 'center' });
      const local = { x: this.badgeLabel.x, y: this.badgeLabel.y };
      const angle = (b.rotation * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.badgeLabel.rotation = angle;
      this.badgeLabel.position.set(b.x + b.width / 2 + local.x * cos - local.y * sin, b.y + b.height / 2 + local.x * sin + local.y * cos);
    }
  }
}
