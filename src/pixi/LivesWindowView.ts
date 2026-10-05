import { CanvasTextMetrics, Container, type NineSliceSprite, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { OfferPanel, type ReadyUiOffer } from './OfferPanel';
import type { ReadyUiOptionalTextureName } from './assets';
import { createNineSlice } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import { resolveWindowSkin, selectWindowSkin, skinNineSlice, skinTextLook, type ReadyUiSkin, type ReadyUiSkinBox, type ReadyUiSkinLivesTextBox, type WindowSkinLook } from './skin';
import { createFigmaLabel, createLabel, fitLabelWidth, formatAmount, placeFigmaLabel, type FigmaTextLook } from './text';
import { UiButton } from './UiButton';

export interface LivesWindowParams {
  lives: number;
  maxLives: number;
  /** Formatted time to the next life (ignored when lives are full). */
  timerText?: string;
  /** Coin price of an instant refill. */
  refillPrice: number;
  /** Offer a "+1 for an ad" button. Default true. */
  adOffer?: boolean;
  /**
   * Offer the coin REFILL button. Default true. `false` = no refill offer (a game without a refill economy): the button
   * is hidden and the rewarded button, when offered, takes the centre.
   */
  refillOffer?: boolean;
  /**
   * Styled only: an OFFER panel under the window (the style's `windows.offer`; drawn only with `onOffer`). The window
   * and the panel are centred together; absent / null = the window alone, centred as before.
   */
  offer?: ReadyUiOffer | null;
}

/**
 * The pre-style kit names of Style 1's Lives art: a host on the `variant: 'figma'` path requests them with
 * `loadReadyUiAssets({ include: LIVES_FIGMA_TEXTURES })`; a host with a style loads `{ skin }` instead.
 */
export const LIVES_FIGMA_TEXTURES = [
  'windowBase', 'windowClose', 'buttonGreen', 'buttonOrange', 'buttonHighlight', 'panelInset', 'livesHeart', 'iconCoin', 'iconHeart', 'iconAd'
] as const satisfies readonly ReadyUiOptionalTextureName[];

/** `'donor'`: the Trail Arrow RefillHearts art (required pack). `'figma'`: drawn by a Ready UI style (Style 1 = the Figma Lives window). */
export type LivesWindowVariant = 'donor' | 'figma';

export interface LivesWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /**
   * Per-window override of the theme's style. Omitted: `theme.skin` when it covers `lives`, else the donor art
   * (unchanged). `'donor'`: the donor art whatever the theme says. `'figma'`: the theme's style when it covers
   * `lives`, else Style 1 (its textures from `{ skin }` or `include: LIVES_FIGMA_TEXTURES`).
   */
  variant?: LivesWindowVariant;
  /** Default `REFILL HEARTS!` */
  title?: string;
  /** Default `Next heart in` (donor) / `NEXT HEART IN` (Figma) */
  nextLifeLabel?: string;
  /** Default `REFILL` (donor) / `REFILL NOW!` (Figma) */
  refillLabel?: string;
  /** Capsule text when lives are full. Default `MAX` */
  fullLabel?: string;
  /** Styled only: the rewarded button's word. Default `GET`. */
  adLabel?: string;
  /** Styled only: the reward on its icon. Default `+1` (the donor bakes it into its art). */
  adRewardLabel?: string;
  /** Close continuations. */
  onRefill: (params: LivesWindowParams) => void;
  onWatchAd?: (params: LivesWindowParams) => void;
  /** The OFFER panel's buy button (close continuation; the purchase is the host's). Without it no offer is drawn. */
  onOffer?: (params: LivesWindowParams) => void;
}

type LivesLook = WindowSkinLook<'lives'>;

/** The style drawing this window (null = donor) with its layout and art; a missing piece fails here, before anything registers. */
function livesLook(options: LivesWindowViewOptions): LivesLook | null {
  const skin = selectWindowSkin('lives', options.variant, options.theme?.skin);
  if (!skin) return null;
  return resolveWindowSkin('LivesWindowView', 'lives', skin, options.textures, { variant: options.variant === 'figma', include: 'LIVES_FIGMA_TEXTURES' });
}

/** ModalWindow options: the donor's, or the style's dim and its window's share of the style frame. */
function modalOptions(options: LivesWindowViewOptions, look: LivesLook | null): ModalWindowOptions {
  const id = options.id ?? 'lives-window';
  if (!look) return { ...options, id };
  const { skin, layout } = look;
  return {
    ...options,
    id,
    backdropColor: options.backdropColor ?? skin.backdrop.color,
    backdropAlpha: options.backdropAlpha ?? skin.backdrop.alpha,
    // the frame fit: the window's share of the style frame (1080 × 2344), like the kit's design contain-fit
    fit: { widthRatio: layout.window.width / skin.frame.width, heightRatio: layout.window.height / skin.frame.height, ...(options.fit ?? {}) }
  };
}

/** Style frame x / y → panel units (the styled panel origin is the frame centre). */
const X = (look: LivesLook, x: number): number => x - look.skin.frame.width / 2;
const Y = (look: LivesLook, y: number): number => y - look.skin.frame.height / 2;
const panelBox = (look: LivesLook, b: ReadyUiSkinBox): ReadyUiSkinBox => ({ x: X(look, b.x), y: Y(look, b.y), width: b.width, height: b.height });
/** Frame box → a button's local units (its origin is the button centre). */
const buttonBox = (button: ReadyUiSkinBox, b: ReadyUiSkinBox): ReadyUiSkinBox => ({ x: b.x - button.x - button.width / 2, y: b.y - button.y - button.height / 2, width: b.width, height: b.height });

/** A text box's look: the style's, with the box's own fill / stroke over it. */
function boxLook(look: FigmaTextLook, box: ReadyUiSkinLivesTextBox): FigmaTextLook {
  const own: FigmaTextLook = { ...look };
  if (box.fill !== undefined) own.fill = box.fill;
  if (box.stroke) {
    own.strokeOutside = box.stroke.width;
    own.strokeColor = box.stroke.color;
  }
  return own;
}

function sprite(texture: Texture, b: ReadyUiSkinBox): Sprite {
  const s = new Sprite(texture);
  s.position.set(b.x, b.y);
  s.width = b.width;
  s.height = b.height;
  return s;
}

/**
 * Refill Hearts window, in two variants.
 *
 * `'donor'` (default): the donor's RefillHearts prefab geometry 1:1 (968 × 1070 purple panel, inner 900 × 382
 * panel, heart at x −261 with `n/max` inside, countdown on the right, REFILL with the coin price and a "+1 for an
 * ad" button at y 350, × at (416, −437)).
 *
 * `'figma'` (a Ready UI style, `theme.skin` or the variant; Style 1 = the Figma Lives window 1:1): the window shell and
 * the primary / rewarded button surfaces as the style's 9-slices, the inner panel as a 9-slice, the heart and the
 * price / reward / ad icons as sprites; the count (the lives, as Figma shows it), the countdown, the price and every
 * label are runtime text in the style's boxes.
 *
 * Both: the same params, actions and states — REFILL disabled at full lives and drawn only when offered
 * (`refillOffer`), the ad button only when offered and handled (the one shown button then centred), `setTimer` while
 * open, continuations after the close.
 */
export class LivesWindowView extends ModalWindow<LivesWindowParams> {
  readonly variant: LivesWindowVariant;
  /** The Ready UI style drawing this window, or null (donor). */
  readonly skin: ReadyUiSkin | null;
  private readonly look: LivesLook | null;
  private readonly title: Text;
  private readonly countText: Text;
  private readonly nextLabel: Text;
  private readonly timerText: Text;
  private readonly refillButton: UiButton;
  private readonly adButton: UiButton;
  private readonly priceText: Text;
  /** Styled only: the price icon that follows the price text (Figma auto-layout row). */
  private readonly priceCoin: Sprite | null;
  private readonly fullLabel: string;
  private readonly onRefill: (params: LivesWindowParams) => void;
  private readonly onWatchAd: ((params: LivesWindowParams) => void) | null;
  private readonly onOffer: ((params: LivesWindowParams) => void) | null;
  /** Styled with a style OFFER layout (and its art): builds the panel under the window on its first offer. */
  private readonly createOfferPanel: (() => OfferPanel) | null;
  private offerPanel: OfferPanel | null = null;
  /** Styled: the window shell (resized when the button row collapses). */
  private readonly surface: NineSliceSprite | null;
  /** Styled: how much shorter the window is this show (no REFILL and no rewarded button → their row closes up). */
  private collapse = 0;
  /** The caller's own fit height ratio (the styled fit otherwise follows the composition). */
  private readonly ownFitHeight: number | undefined;
  private params: LivesWindowParams | null = null;

  constructor(options: LivesWindowViewOptions) {
    const look = livesLook(options);
    super(modalOptions(options, look));
    this.variant = look ? 'figma' : 'donor';
    this.skin = look?.skin ?? null;
    this.look = look;
    this.onRefill = options.onRefill;
    this.onWatchAd = options.onWatchAd ?? null;
    this.onOffer = options.onOffer ?? null;
    this.ownFitHeight = options.fit?.heightRatio;
    this.fullLabel = localizedText(options.fullLabel, this.i18n, 'core.common.max', READY_UI_LEGACY_TEXT.lives.full);

    if (look) {
      const { skin, layout: L, art: A } = look;
      const textLook = skinTextLook(skin);
      const label = (text: string, box: ReadyUiSkinLivesTextBox): Text => createFigmaLabel(this.theme, text, box.fontSize, boxLook(textLook, box));
      const surface = createNineSlice(A.windowSurface, skinNineSlice(skin, 'windowSurface', 'lives'), L.window.width, L.window.height);
      this.surface = surface;
      surface.position.set(X(look, L.window.x + L.window.width / 2), Y(look, L.window.y + L.window.height / 2));
      this.title = label(localizedText(options.title, this.i18n, 'core.lives.title', READY_UI_LEGACY_TEXT.lives.title), L.title);
      placeFigmaLabel(this.title, { ...panelBox(look, L.title), align: L.title.align ?? 'center' });
      if (this.closeButton) {
        this.closeButton.background.texture = A.windowClose;
        this.closeButton.background.width = L.close.width;
        this.closeButton.background.height = L.close.height;
      }
      const inset = createNineSlice(A.panelInset, skinNineSlice(skin, 'panelInset', 'lives'), L.inset.width, L.inset.height);
      inset.position.set(X(look, L.inset.x + L.inset.width / 2), Y(look, L.inset.y + L.inset.height / 2));
      const heart = sprite(A.lifeArt, panelBox(look, L.heart));
      this.countText = label('5', L.count);
      this.nextLabel = label(localizedText(options.nextLifeLabel, this.i18n, 'core.lives.next', READY_UI_LEGACY_TEXT.lives.styledNext), L.nextLabel);
      placeFigmaLabel(this.nextLabel, { ...panelBox(look, L.nextLabel), align: L.nextLabel.align ?? 'center' });
      this.timerText = label('00:00', L.timer);

      this.refillButton = this.addButton(new UiButton({
        ui: this.ui, id: `${this.id}:refill`, theme: this.theme, texture: A.buttonPrimary, nineSlice: skinNineSlice(skin, 'buttonPrimary', 'lives'),
        width: L.refill.width, height: L.refill.height, pressScale: 0.9, onTap: () => this.finish('refill')
      }));
      this.refillButton.position.set(X(look, L.refill.x + L.refill.width / 2), Y(look, L.refill.y + L.refill.height / 2));
      const refillLabel = label(localizedText(options.refillLabel, this.i18n, 'core.lives.refill', READY_UI_LEGACY_TEXT.lives.styledRefill), L.refillLabel);
      placeFigmaLabel(refillLabel, { ...buttonBox(L.refill, L.refillLabel), align: L.refillLabel.align ?? 'center' });
      this.priceText = createFigmaLabel(this.theme, '900', L.priceRow.fontSize, textLook);
      this.priceCoin = sprite(A.priceIcon, { x: 0, y: 0, width: L.coin.width, height: L.coin.height });
      this.refillButton.addChild(refillLabel, this.priceText, this.priceCoin);

      this.adButton = this.addButton(new UiButton({
        ui: this.ui, id: `${this.id}:ad`, theme: this.theme, texture: A.buttonRewarded, nineSlice: skinNineSlice(skin, 'buttonRewarded', 'lives'),
        width: L.ad.width, height: L.ad.height, pressScale: 0.9, onTap: () => this.finish('ad')
      }));
      this.adButton.position.set(X(look, L.ad.x + L.ad.width / 2), Y(look, L.ad.y + L.ad.height / 2));
      const adLabel = label(localizedText(options.adLabel, this.i18n, 'core.lives.ad_action', READY_UI_LEGACY_TEXT.lives.adAction), L.adLabel);
      placeFigmaLabel(adLabel, { ...buttonBox(L.ad, L.adLabel), align: L.adLabel.align ?? 'center' });
      const rewardLabel = label(options.adRewardLabel ?? '+1', L.rewardLabel);
      placeFigmaLabel(rewardLabel, { ...buttonBox(L.ad, L.rewardLabel), align: L.rewardLabel.align ?? 'left' });
      // Figma order: the highlight over the face (when the style has one), GET, the heart icon and its "+1", the clapper on top
      if (L.adHighlight) this.adButton.addChild(sprite(A.buttonHighlight, buttonBox(L.ad, L.adHighlight)));
      this.adButton.addChild(
        adLabel,
        sprite(A.rewardIcon, buttonBox(L.ad, L.rewardIcon)), rewardLabel,
        sprite(A.adIcon, buttonBox(L.ad, L.adIcon))
      );

      // decoration never takes input: taps on it still land inside the panel's hit area (no backdrop close)
      for (const node of [surface, this.title, inset, heart, this.countText, this.nextLabel, this.timerText]) node.eventMode = 'none';
      this.panel.addChildAt(surface, 0);
      this.panel.addChild(this.title, inset, heart, this.countText, this.nextLabel, this.timerText, this.refillButton, this.adButton);
      const offer = skin.windows.offer;
      // the OFFER art is there only when required (a style with `windows.offer`, loaded with `{ skin }`)
      this.createOfferPanel = offer && A.offerPanel && A.offerBadge && A.offerLivesArt && A.offerCoinArt
        ? () => new OfferPanel({
          ui: this.ui, theme: this.theme, i18n: this.i18n, id: this.id, skin, window: 'lives', layout: offer, text: textLook,
          art: { offerPanel: A.offerPanel, offerBadge: A.offerBadge, offerLivesArt: A.offerLivesArt, offerCoinArt: A.offerCoinArt, buttonPrimary: A.buttonPrimary, priceIcon: A.priceIcon, windowClose: A.windowClose },
          register: (button) => this.addButton(button),
          onBuy: () => this.finish('offer'),
          onClose: () => this.close('button')
        })
        : null;
      this.placeClose();
      return;
    }

    const t = this.textures;
    this.priceCoin = null;
    this.createOfferPanel = null;
    this.surface = null;
    this.panel.addChildAt(this.sprite(t.panelPurple, 968, 1070), 0);
    this.title = createLabel(this.theme, localizedText(options.title, this.i18n, 'core.lives.title', READY_UI_LEGACY_TEXT.lives.title), { fontSize: 88, stroke: 11 });
    this.title.y = -440;
    fitLabelWidth(this.title, 780);
    this.panel.addChild(this.title);

    this.panel.addChild(this.sprite(t.panelInner, 900, 382));
    const heart = this.sprite(t.heartBig, 326, 298);
    heart.x = -261;
    this.panel.addChild(heart);
    this.countText = createLabel(this.theme, '1/5', { fontSize: 132, stroke: 10 });
    this.countText.position.set(-267, -30);
    this.nextLabel = createLabel(this.theme, localizedText(options.nextLifeLabel, this.i18n, 'core.lives.next', READY_UI_LEGACY_TEXT.lives.donorNext), { fontSize: 50, stroke: 7 });
    this.nextLabel.position.set(180, -69);
    this.timerText = createLabel(this.theme, '00:00', { fontSize: 92, stroke: 10 });
    this.timerText.position.set(180, 29);
    this.panel.addChild(this.countText, this.nextLabel, this.timerText);

    // REFILL: label above, price + coin below (donor button layout)
    this.refillButton = this.createButton('refill', t.btnGreenShort, localizedText(options.refillLabel, this.i18n, 'core.lives.refill', READY_UI_LEGACY_TEXT.lives.donorRefill), () => this.finish('refill'), 371, 207, 52, -50);
    if (this.refillButton.labelText) fitLabelWidth(this.refillButton.labelText, 300);
    const price = new Container();
    price.position.set(18, 0);
    this.priceText = createLabel(this.theme, '900', { fontSize: 68, stroke: 7, anchorX: 1 });
    this.priceText.position.set(0, 17);
    const coin = this.sprite(t.coinSmall, 100, 100);
    coin.position.set(48, 22);
    price.addChild(this.priceText, coin);
    this.refillButton.addChild(price);
    this.refillButton.position.set(-253, 350);

    this.adButton = this.createButton('ad', t.btnYellowWide, '', () => this.finish('ad'), 507, 207);
    if (this.adButton.labelText) this.adButton.labelText.visible = false;
    const ads = this.sprite(t.ads, 128, 134);
    ads.position.set(-87, -15);
    const plusOne = this.sprite(t.heartPlus1, 154, 154);
    plusOne.position.set(71, -7);
    this.adButton.addChild(ads, plusOne);
    this.adButton.position.set(206, 350);
    this.panel.addChild(this.refillButton, this.adButton);
    this.placeClose();
  }

  protected applyParams(params: LivesWindowParams): void {
    const look = this.look;
    if (look) {
      const L = look.layout;
      this.params = params;
      const full = params.lives >= params.maxLives;
      this.countText.text = String(params.lives);
      placeFigmaLabel(this.countText, { ...panelBox(look, L.count), align: L.count.align ?? 'center' });
      this.timerText.text = full ? this.fullLabel : params.timerText ?? '';
      placeFigmaLabel(this.timerText, { ...panelBox(look, L.timer), align: L.timer.align ?? 'center' });
      this.priceText.text = formatAmount(params.refillPrice);
      this.layoutPrice(look);
      const showAd = (params.adOffer ?? true) && this.onWatchAd !== null;
      const showRefill = params.refillOffer ?? true;
      this.adButton.visible = showAd;
      this.adButton.setEnabled(showAd);
      this.refillButton.visible = showRefill;
      this.refillButton.setEnabled(showRefill && !full);
      this.refillButton.x = showAd ? X(look, L.refill.x + L.refill.width / 2) : 0;
      this.adButton.x = showRefill ? X(look, L.ad.x + L.ad.width / 2) : 0;
      this.layoutCollapse(look, !showAd && !showRefill);
      this.layoutOffer(look, params);
      return;
    }
    this.params = params;
    const full = params.lives >= params.maxLives;
    this.countText.text = `${params.lives}/${params.maxLives}`;
    this.timerText.text = full ? this.fullLabel : params.timerText ?? '';
    fitLabelWidth(this.timerText, 420);
    this.priceText.text = formatAmount(params.refillPrice);
    const showAd = (params.adOffer ?? true) && this.onWatchAd !== null;
    const showRefill = params.refillOffer ?? true;
    this.adButton.visible = showAd;
    this.adButton.setEnabled(showAd);
    this.refillButton.visible = showRefill;
    this.refillButton.setEnabled(showRefill && !full);
    this.refillButton.x = showAd ? -253 : 0;
    this.adButton.x = showRefill ? 206 : 0;
  }

  /** The OFFER panel is parented only while an offer is shown: a detached one goes with the window too. */
  override destroy(options?: Parameters<ModalWindow['destroy']>[0]): void {
    const offer = this.offerPanel;
    super.destroy(options);
    if (offer && !offer.destroyed) offer.destroy({ children: true });
  }

  /** Live countdown update while the window is open. */
  setTimer(timerText: string): void {
    if (!this.params || this.params.lives >= this.params.maxLives) return;
    this.params.timerText = timerText;
    this.timerText.text = timerText;
    if (this.look) placeFigmaLabel(this.timerText, { ...panelBox(this.look, this.look.layout.timer), align: this.look.layout.timer.align ?? 'center' });
  }

  /**
   * Styled: the style's window box, with the OFFER panel under it when one is shown (the fit, the backdrop test and the
   * hit area; not the art's bleed). Donor: measured.
   */
  protected override panelBounds(): Rectangle {
    const look = this.look;
    if (!look) return super.panelBounds();
    const w = look.layout.window;
    const height = w.height - this.collapse;
    const offer = this.offerPanel?.visible ? this.offerPanel.layout.panel : null;
    if (!offer) return new Rectangle(X(look, w.x), Y(look, w.y), w.width, height);
    // the panel shares the window's horizontal centre
    const width = Math.max(w.width, offer.width);
    return new Rectangle(X(look, w.x + (w.width - width) / 2), Y(look, w.y), width, height + offer.gap + offer.height);
  }

  /** Styled with an OFFER panel: the window and the panel are centred together (the window alone: the origin, as before). */
  protected override panelCentre(): { x: number; y: number } {
    if (!this.look || (!this.offerPanel?.visible && this.collapse === 0)) return super.panelCentre();
    const b = this.panelBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /**
   * No REFILL and no rewarded button: their row closes up — the window ends that much higher, keeping the margin it had
   * under the buttons below the content above them (the parts whose box ends above the buttons' bottom).
   */
  private layoutCollapse(look: LivesLook, collapsed: boolean): void {
    const L = look.layout;
    const rowTop = Math.min(L.refill.y, L.ad.y);
    const rowBottom = Math.max(L.refill.y + L.refill.height, L.ad.y + L.ad.height);
    const above = [L.inset, L.heart, L.count, L.nextLabel, L.timer]
      .filter((box) => box.y < rowTop && box.y + box.height <= rowBottom)
      .map((box) => box.y + box.height);
    this.collapse = collapsed && above.length > 0 ? Math.max(0, rowBottom - Math.max(...above)) : 0;
    const surface = this.surface;
    if (!surface) return;
    const spec = skinNineSlice(look.skin, 'windowSurface', 'lives');
    const pad = spec.pad ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const height = L.window.height - this.collapse;
    surface.height = height + pad.top + pad.bottom;
    surface.anchor.set(surface.anchor.x, (pad.top + height / 2) / (height + pad.top + pad.bottom));
    surface.y = Y(look, L.window.y + height / 2);
  }

  /** Shows / hides the OFFER panel under the window and gives the styled fit the composition's share of the frame. */
  private layoutOffer(look: LivesLook, params: LivesWindowParams): void {
    const offer = params.offer ?? null;
    const show = this.createOfferPanel !== null && offer !== null && this.onOffer !== null;
    if (show && !this.offerPanel && this.createOfferPanel) this.offerPanel = this.createOfferPanel();
    const panel = this.offerPanel;
    if (panel) {
      // only an offer on show is in the scene: a window without one keeps exactly its own layers
      panel.visible = show;
      panel.buyButton.setEnabled(show);
      panel.closeButton?.setEnabled(show);
      if (show && panel.parent !== this.panel) this.panel.addChild(panel);
      else if (!show && panel.parent) panel.parent.removeChild(panel);
    }
    const w = look.layout.window;
    if (show && panel && offer) {
      panel.set(offer);
      panel.position.set(X(look, w.x + (w.width - panel.layout.panel.width) / 2), Y(look, w.y + w.height - this.collapse + panel.layout.panel.gap));
      this.placeClose();
    }
    if (this.ownFitHeight === undefined) this.fit.heightRatio = this.panelBounds().height / look.skin.frame.height;
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    const look = this.look;
    if (!look) return { x: 416, y: -437 };
    const c = look.layout.close;
    return { x: X(look, c.x + c.width / 2), y: Y(look, c.y + c.height / 2) };
  }

  /** Styled: the price text, the gap and the price icon, as one row centred on the REFILL button (or the style's row centre). */
  private layoutPrice(look: LivesLook): void {
    if (!this.priceCoin) return;
    const L = look.layout;
    const advance = CanvasTextMetrics.measureText(this.priceText.text, this.priceText.style).lineWidths[0] ?? 0;
    const centre = L.priceRow.x === undefined ? 0 : L.priceRow.x - L.refill.x - L.refill.width / 2;
    const left = centre - (advance + L.priceRow.gap + L.coin.width) / 2;
    const top = L.priceRow.y - L.refill.y - L.refill.height / 2;
    placeFigmaLabel(this.priceText, { x: left, y: top, width: advance, height: L.priceRow.height, align: 'left' });
    this.priceCoin.position.set(left + advance + L.priceRow.gap, L.coin.y === undefined ? top : L.coin.y - L.refill.y - L.refill.height / 2);
  }

  private finish(action: 'refill' | 'ad' | 'offer'): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => {
      if (action === 'refill') this.onRefill(params);
      else if (action === 'ad') this.onWatchAd?.(params);
      else this.onOffer?.(params);
    });
  }
}
