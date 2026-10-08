import { Container, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { createNineSlice } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import { resolveWindowSkin, selectWindowSkin, skinNineSlice, skinTextBoxLook, skinTextLook, type ReadyUiSkin, type ReadyUiSkinBox, type ReadyUiSkinLivesTextBox, type ReadyUiSkinNoAdsLayout, type WindowSkinLook } from './skin';
import { UiButton } from './UiButton';
import { createFigmaLabel, createLabel, figmaLabelAdvance, fitLabelWidth, placeFigmaLabel, type FigmaTextLook } from './text';

export interface NoAdsWindowParams {
  /** Localized price string shown on the buy button. */
  price: string;
  /** Description on the dark band. Default `Removes pop-up ads.\nRewarded ads still available` */
  description?: string;
  /**
   * Styled only: the price is in the game's coins — the style's coin follows it on the button (Figma's sample). Default
   * false: a store price string (real money), no coin. The donor look ignores it.
   */
  coinPrice?: boolean;
}

export interface NoAdsWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** The two rotated corner words (styled: the two title lines). Defaults `NO` / `ADS`. */
  wordNo?: string;
  wordAds?: string;
  /** Close continuation: the player tapped the price button. */
  onBuy: (params: NoAdsWindowParams) => void;
}

type NoAdsLook = WindowSkinLook<'noAds'>;

/** The style drawing this window (null = donor) with its layout and art; a missing piece fails here, before anything registers. */
function noAdsLook(options: NoAdsWindowViewOptions): NoAdsLook | null {
  const skin = selectWindowSkin('noAds', undefined, options.theme?.skin);
  if (!skin) return null;
  return resolveWindowSkin('NoAdsWindowView', 'noAds', skin, options.textures, { variant: false, include: '' });
}

function modalOptions(options: NoAdsWindowViewOptions, look: NoAdsLook | null): ModalWindowOptions {
  const id = options.id ?? 'noads-window';
  if (!look) return { ...options, id };
  const { skin, layout } = look;
  return {
    ...options,
    id,
    backdropColor: options.backdropColor ?? skin.backdrop.color,
    backdropAlpha: options.backdropAlpha ?? skin.backdrop.alpha,
    // the frame fit: the window's share of the style frame (1080 × 2344), like every styled window
    fit: { widthRatio: layout.window.width / skin.frame.width, heightRatio: layout.window.height / skin.frame.height, ...(options.fit ?? {}) }
  };
}

/** The styled-only nodes. */
interface StyledNoAds {
  skin: ReadyUiSkin;
  layout: ReadyUiSkinNoAdsLayout;
  text: FigmaTextLook;
  note: Text;
  /** The price row (button-local): the price text, then the coin; scaled down as one when it is wider than the button. */
  priceRow: Container;
  priceText: Text;
  coin: Sprite;
}

/**
 * "No Ads" offer. No purchase logic inside: the price is data, BUY is a close() continuation, × / the backdrop only
 * dismiss.
 *
 * Donor (no style): the donor's OfferNoAds prefab — 975 × 1355 blue panel with the crossed-out clapperboard baked in,
 * `NO` / `ADS` rotated −32° over the top-left corner, the description on the dark band at y 248, the green price button
 * at y 517, × at (415, −607).
 *
 * Styled (a Ready UI style that covers `noAds`, `theme.skin`; theme_light_6 `screen_ads_off`): the style's window art,
 * its ×, the rays behind the hero, the two title lines (`wordNo` / `wordAds`), the description's first line in its big
 * box (wrapping) and its second line as the note, the price button (`buttonPrimary`, 9-slice) with the price and, for a
 * coin price (`coinPrice`), the style's coin. The window keeps its share of the style frame.
 */
export class NoAdsWindowView extends ModalWindow<NoAdsWindowParams> {
  /** The Ready UI style drawing this window, or null (donor). */
  readonly skin: ReadyUiSkin | null;
  private readonly description: Text;
  private readonly buyButton: UiButton;
  private readonly onBuy: (params: NoAdsWindowParams) => void;
  private readonly styled: StyledNoAds | null;
  private params: NoAdsWindowParams | null = null;

  constructor(options: NoAdsWindowViewOptions) {
    const look = noAdsLook(options);
    super(modalOptions(options, look));
    this.skin = look?.skin ?? null;
    this.onBuy = options.onBuy;
    const wordNo = localizedText(options.wordNo, this.i18n, 'core.no_ads.word_no', READY_UI_LEGACY_TEXT.noAds.no);
    const wordAds = localizedText(options.wordAds, this.i18n, 'core.no_ads.word_ads', READY_UI_LEGACY_TEXT.noAds.ads);

    if (!look) {
      const t = this.textures;
      this.styled = null;
      this.panel.addChildAt(this.sprite(t.noAdsPanel, 975, 1355), 0);

      const no = createLabel(this.theme, wordNo, { fontSize: 108, stroke: 12 });
      no.position.set(-452, -672);
      no.rotation = (-32 * Math.PI) / 180;
      fitLabelWidth(no, 320);
      const ads = createLabel(this.theme, wordAds, { fontSize: 108, stroke: 12 });
      ads.position.set(-386, -584);
      ads.rotation = (-32 * Math.PI) / 180;
      fitLabelWidth(ads, 320);
      this.panel.addChild(no, ads);

      this.description = createLabel(this.theme, '', { fontSize: 54, stroke: 6 });
      this.description.position.set(-9, 248);
      this.panel.addChild(this.description);

      this.buyButton = this.createButton('buy', t.noAdsBuy, '', () => this.finish(), 600, 206, 97, -11);
      this.buyButton.y = 517;
      this.panel.addChild(this.buyButton);
      this.placeClose();
      return;
    }

    const { skin, layout: L, art: A } = look;
    const text = skinTextLook(skin);
    const box = (b: ReadyUiSkinBox): ReadyUiSkinBox => ({ x: b.x - L.window.width / 2, y: b.y - L.window.height / 2, width: b.width, height: b.height });
    const art = (texture: Texture, b: ReadyUiSkinBox): Sprite => {
      const sprite = new Sprite(texture);
      const at = box(b);
      sprite.position.set(at.x, at.y);
      sprite.width = b.width;
      sprite.height = b.height;
      sprite.eventMode = 'none';
      return sprite;
    };
    const label = (value: string, b: ReadyUiSkinLivesTextBox): Text => {
      const node = createFigmaLabel(this.theme, value, b.fontSize, skinTextBoxLook(text, b));
      placeFigmaLabel(node, { ...box(b), align: b.align ?? 'center' });
      node.eventMode = 'none';
      return node;
    };

    // the window shell: a 9-slice over the window box (its ring in the caps' pad), centred on the panel origin
    const panelArt = createNineSlice(A.noAdsPanel, skinNineSlice(skin, 'noAdsPanel', 'noAds'), L.window.width, L.window.height);
    panelArt.eventMode = 'none';
    const decor = art(A.noAdsDecor, L.decor);
    // the rays reach outside the window: never part of the fit, the centring or the tap area
    decor.measurable = false;
    const hero = art(A.noAdsArt, L.hero);
    const titleTop = label(wordNo, L.title[0]);
    const titleBottom = label(wordAds, L.title[1]);
    this.description = createFigmaLabel(this.theme, '', L.description.fontSize, skinTextBoxLook(text, L.description));
    this.description.eventMode = 'none';
    const note = label('', L.note);

    this.buyButton = this.addButton(new UiButton({
      ui: this.ui,
      id: `${this.id}:buy`,
      theme: this.theme,
      texture: A.buttonPrimary,
      nineSlice: skinNineSlice(skin, 'buttonPrimary', 'noAds'),
      width: L.button.width,
      height: L.button.height,
      pressScale: 0.9,
      onTap: () => this.finish()
    }));
    const buttonAt = box(L.button);
    this.buyButton.position.set(buttonAt.x + L.button.width / 2, buttonAt.y + L.button.height / 2);
    const priceLook = skinTextBoxLook(text, { x: 0, y: 0, width: 0, height: 0, fontSize: L.price.fontSize, ...(L.price.fill !== undefined ? { fill: L.price.fill } : {}), ...(L.price.stroke ? { stroke: L.price.stroke } : {}) });
    const priceText = createFigmaLabel(this.theme, '', L.price.fontSize, priceLook);
    priceText.eventMode = 'none';
    const coin = new Sprite(A.priceIcon);
    coin.width = L.coin.width;
    coin.height = L.coin.height;
    coin.eventMode = 'none';
    const priceRow = new Container();
    priceRow.eventMode = 'none';
    priceRow.addChild(priceText, coin);
    this.buyButton.addChild(priceRow);

    if (this.closeButton) {
      this.closeButton.background.texture = A.noAdsClose;
      this.closeButton.background.width = L.close.width;
      this.closeButton.background.height = L.close.height;
    }
    this.styled = { skin, layout: L, text, note, priceRow, priceText, coin };
    // Figma bottom → top: the window, the rays, the hero, the title, the copy, the button; the × on top (placeClose)
    this.panel.addChild(panelArt, decor, hero, titleTop, titleBottom, this.description, note, this.buyButton);
    this.placeClose();
  }

  protected applyParams(params: NoAdsWindowParams): void {
    this.params = params;
    const description = localizedText(params.description, this.i18n, 'core.no_ads.description', READY_UI_LEGACY_TEXT.noAds.description);
    const styled = this.styled;
    if (!styled) {
      this.description.text = description;
      fitLabelWidth(this.description, 760);
      this.buyButton.setLabel(params.price);
      if (this.buyButton.labelText) fitLabelWidth(this.buyButton.labelText, 520);
      return;
    }
    const L = styled.layout;
    const lineBreak = description.indexOf('\n');
    const first = lineBreak < 0 ? description : description.slice(0, lineBreak);
    const rest = lineBreak < 0 ? '' : description.slice(lineBreak + 1).replace(/\n/g, ' ');
    placeWrapped(this.description, first, { x: L.description.x - L.window.width / 2, y: L.description.y - L.window.height / 2, width: L.description.width, height: L.description.height });
    styled.note.text = rest;
    placeFigmaLabel(styled.note, { x: L.note.x - L.window.width / 2, y: L.note.y - L.window.height / 2, width: L.note.width, height: L.note.height, align: L.note.align ?? 'center' });
    // the price row: the text, the gap, the coin (a coin price only), centred on the button; wider than the button's
    // inner width (84 %), the whole row shrinks around its centre
    const coinShown = params.coinPrice === true;
    styled.priceText.text = params.price;
    styled.coin.visible = coinShown;
    const advance = figmaLabelAdvance(styled.priceText);
    const width = advance + (coinShown ? L.price.gap + L.coin.width : 0);
    placeFigmaLabel(styled.priceText, { x: 0, y: L.price.y, width: advance, height: L.price.height, align: 'left' });
    styled.coin.position.set(advance + L.price.gap, L.coin.y);
    const k = Math.min(1, (L.button.width * 0.84) / Math.max(1, width));
    const rowTop = Math.min(L.price.y, L.coin.y);
    const rowHeight = Math.max(L.price.y + L.price.height, L.coin.y + L.coin.height) - rowTop;
    styled.priceRow.pivot.set(width / 2, rowTop + rowHeight / 2);
    styled.priceRow.scale.set(k);
    styled.priceRow.position.set(0, rowTop + rowHeight / 2 - L.button.height / 2);
  }

  /** Styled: the window box (the fit, the backdrop test and the hit area — not the rays or the art's bleed). Donor: measured. */
  protected override panelBounds(): Rectangle {
    const L = this.styled?.layout;
    if (!L) return super.panelBounds();
    return new Rectangle(-L.window.width / 2, -L.window.height / 2, L.window.width, L.window.height);
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    const L = this.styled?.layout;
    if (!L) return { x: 415, y: -607 };
    return { x: L.close.x + L.close.width / 2 - L.window.width / 2, y: L.close.y + L.close.height / 2 - L.window.height / 2 };
  }

  private finish(): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => this.onBuy(params));
  }
}

/**
 * A centred multi-line text box (Figma fixed width, AUTO height, CENTER / CENTER): the text wraps at the box width and
 * the block is centred in the box; a block taller than the box shrinks to it.
 */
function placeWrapped(label: Text, value: string, slot: ReadyUiSkinBox): void {
  label.text = value;
  label.scale.set(1);
  label.style.wordWrap = true;
  label.style.wordWrapWidth = slot.width;
  label.style.align = 'center';
  label.anchor.set(0.5);
  const k = label.height > slot.height && label.height > 0 ? slot.height / label.height : 1;
  label.scale.set(k);
  label.position.set(slot.x + slot.width / 2, slot.y + slot.height / 2);
}

