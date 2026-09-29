import { CanvasTextMetrics, Container, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { READY_UI_NINE_SLICES, READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from './assets';
import { createNineSlice } from './nineSlice';
import { createFigmaLabel, createLabel, fitLabelWidth, formatAmount, placeFigmaLabel } from './text';
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
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Figma `screen/lives` (file CNcGCBj8IvUXrPd01FbChm, node 85:8944; the read is docs/figma/lives): boxes in the
 * design units of the 1080 × 2344 screen. Sprite boxes are the SVG export boxes (render bounds).
 */
export const LIVES_FIGMA = {
  screen: { width: 1080, height: 2344 },
  /** ui/window/base 85:9689: the confirm-exit shell at 960 × 1059 */
  window: { x: 60, y: 642, width: 960, height: 1059 },
  /** overlay/dim 85:9387 */
  backdrop: { color: 0x080b0d, alpha: 0.8 },
  /** slot/title: CENTER / CENTER, Fira Sans Black 80 */
  title: { x: 195, y: 676, width: 690, height: 104, fontSize: 80 },
  /** action/close (its 51 × 51 SVG box) */
  close: { x: 923, y: 703, width: 51, height: 51 },
  /** section/next-life Rectangle 65858: flat #a2a0f4, radius 50 */
  inset: { x: 90, y: 934, width: 900, height: 382 },
  /** Group 377: the heart */
  heart: { x: 152, y: 981, width: 326, height: 298 },
  /** Group 378 "1": 150; the box is the hug box of "1", the count is centred on it */
  count: { x: 272, y: 1036, width: 84, height: 180, fontSize: 150 },
  /** NEXT HEART IN: 50, centre */
  nextLabel: { x: 531, y: 1052, width: 442, height: 60, fontSize: 50 },
  /** 24:15: 70, centre */
  timer: { x: 531, y: 1115, width: 442, height: 84, fontSize: 70 },
  /** action/refill-coins: ui/button/surface green */
  refill: { x: 90, y: 1432, width: 371, height: 207 },
  refillLabel: { x: 112, y: 1438, width: 331, height: 84, fontSize: 50 },
  /** Frame 381: price text + 1 + coin, hugging, centred on the button, rows centred in 100 */
  priceRow: { y: 1508, height: 100, gap: 1, fontSize: 64 },
  coin: { width: 100, height: 100 },
  /** action/rewarded-life: ui/button/surface orange + the gold highlight */
  ad: { x: 483, y: 1432, width: 507, height: 207 },
  adHighlight: { x: 491, y: 1437, width: 307, height: 172 },
  adLabel: { x: 620, y: 1445, width: 233.199, height: 159, fontSize: 60 },
  /** Group 385: the rewarded-ad clapper (render box) */
  adIcon: { x: 511, y: 1448, width: 128, height: 134 },
  rewardIcon: { x: 819, y: 1448, width: 154, height: 154 },
  /** +1: LEFT, hugging */
  rewardLabel: { x: 859, y: 1483, width: 68, height: 72, fontSize: 60 }
} as const;

/**
 * The textures of the `'figma'` variant. They are not in the required pack: a host that uses the variant requests
 * them with `loadReadyUiAssets({ include: LIVES_FIGMA_TEXTURES })`; nothing else ever loads them.
 */
export const LIVES_FIGMA_TEXTURES = [
  'windowBase', 'windowClose', 'buttonGreen', 'buttonOrange', 'buttonHighlight', 'panelInset', 'livesHeart', 'iconCoin', 'iconHeart', 'iconAd'
] as const satisfies readonly ReadyUiOptionalTextureName[];

/** `'donor'`: the Trail Arrow RefillHearts art (required pack). `'figma'`: the Figma Lives window. */
export type LivesWindowVariant = 'donor' | 'figma';

export interface LivesWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** Default `'donor'`, unchanged; `'figma'` needs LIVES_FIGMA_TEXTURES in `textures`. */
  variant?: LivesWindowVariant;
  /** Default `REFILL HEARTS!` */
  title?: string;
  /** Default `Next heart in` (donor) / `NEXT HEART IN` (Figma) */
  nextLifeLabel?: string;
  /** Default `REFILL` (donor) / `REFILL NOW!` (Figma) */
  refillLabel?: string;
  /** Capsule text when lives are full. Default `MAX` */
  fullLabel?: string;
  /** `'figma'` only: the rewarded button's word. Default `GET`. */
  adLabel?: string;
  /** `'figma'` only: the reward on its heart icon. Default `+1` (the donor bakes it into its art). */
  adRewardLabel?: string;
  /** Close continuations. */
  onRefill: (params: LivesWindowParams) => void;
  onWatchAd?: (params: LivesWindowParams) => void;
}

const F = LIVES_FIGMA;
/** Figma screen x / y → panel units (the Figma variant's panel origin is the screen centre). */
const X = (x: number): number => x - F.screen.width / 2;
const Y = (y: number): number => y - F.screen.height / 2;
const panelBox = (b: Box): Box => ({ x: X(b.x), y: Y(b.y), width: b.width, height: b.height });
/** Figma screen box → a button's local units (its origin is the button centre). */
const buttonBox = (button: Box, b: Box): Box => ({ x: b.x - button.x - button.width / 2, y: b.y - button.y - button.height / 2, width: b.width, height: b.height });
type FigmaArt = Record<(typeof LIVES_FIGMA_TEXTURES)[number], Texture>;

/** ModalWindow options per variant; the Figma variant fails here, before anything registers, when its art is absent. */
function modalOptions(options: LivesWindowViewOptions): ModalWindowOptions {
  const id = options.id ?? 'lives-window';
  if ((options.variant ?? 'donor') === 'donor') return { ...options, id };
  const textures: ReadyUiTextures = options.textures;
  const missing = LIVES_FIGMA_TEXTURES.filter((name) => !textures[name]);
  if (missing.length) {
    const list = missing.map((name) => `${name} (${READY_UI_OPTIONAL_ASSET_FILES[name]})`).join(', ');
    throw new Error(`LivesWindowView variant 'figma': no ${list} in textures — load them with loadReadyUiAssets({ include: LIVES_FIGMA_TEXTURES })`);
  }
  return {
    ...options,
    id,
    backdropColor: options.backdropColor ?? F.backdrop.color,
    backdropAlpha: options.backdropAlpha ?? F.backdrop.alpha,
    // the Figma frame fit: the window's share of the 1080 × 2344 screen, like the kit's design contain-fit
    fit: { widthRatio: F.window.width / F.screen.width, heightRatio: F.window.height / F.screen.height, ...(options.fit ?? {}) }
  };
}

function sprite(texture: Texture, b: Box): Sprite {
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
 * `'figma'`: the Figma Lives window 1:1 (LIVES_FIGMA): the confirm-exit shell and the green / orange button surfaces
 * as 9-slices, the inner panel as a 9-slice, the heart and the coin / heart / ad icons as sprites; the count (the
 * lives, as Figma shows it), the countdown, the price and every label are runtime text in their Figma boxes.
 *
 * Both: the same params, actions and states — REFILL disabled at full lives, the ad button only when offered and
 * handled (REFILL then centred), `setTimer` while open, continuations after the close.
 */
export class LivesWindowView extends ModalWindow<LivesWindowParams> {
  readonly variant: LivesWindowVariant;
  private readonly title: Text;
  private readonly countText: Text;
  private readonly nextLabel: Text;
  private readonly timerText: Text;
  private readonly refillButton: UiButton;
  private readonly adButton: UiButton;
  private readonly priceText: Text;
  /** 'figma' only: the coin that follows the price text (Figma auto-layout row). */
  private readonly priceCoin: Sprite | null;
  private readonly fullLabel: string;
  private readonly onRefill: (params: LivesWindowParams) => void;
  private readonly onWatchAd: ((params: LivesWindowParams) => void) | null;
  private params: LivesWindowParams | null = null;

  constructor(options: LivesWindowViewOptions) {
    super(modalOptions(options));
    this.variant = options.variant ?? 'donor';
    this.onRefill = options.onRefill;
    this.onWatchAd = options.onWatchAd ?? null;
    this.fullLabel = options.fullLabel ?? 'MAX';

    if (this.variant === 'figma') {
      const t = this.textures as ReadyUiTextures & FigmaArt; // checked by modalOptions()
      const surface = createNineSlice(t.windowBase, READY_UI_NINE_SLICES.windowBase, F.window.width, F.window.height);
      surface.position.set(X(F.window.x + F.window.width / 2), Y(F.window.y + F.window.height / 2));
      this.title = createFigmaLabel(this.theme, options.title ?? 'REFILL HEARTS!', F.title.fontSize);
      placeFigmaLabel(this.title, { ...panelBox(F.title), align: 'center' });
      if (this.closeButton) {
        this.closeButton.background.texture = t.windowClose;
        this.closeButton.background.width = F.close.width;
        this.closeButton.background.height = F.close.height;
      }
      const inset = createNineSlice(t.panelInset, READY_UI_NINE_SLICES.panelInset, F.inset.width, F.inset.height);
      inset.position.set(X(F.inset.x + F.inset.width / 2), Y(F.inset.y + F.inset.height / 2));
      const heart = sprite(t.livesHeart, panelBox(F.heart));
      this.countText = createFigmaLabel(this.theme, '5', F.count.fontSize);
      this.nextLabel = createFigmaLabel(this.theme, options.nextLifeLabel ?? 'NEXT HEART IN', F.nextLabel.fontSize);
      placeFigmaLabel(this.nextLabel, { ...panelBox(F.nextLabel), align: 'center' });
      this.timerText = createFigmaLabel(this.theme, '00:00', F.timer.fontSize);

      this.refillButton = this.addButton(new UiButton({
        ui: this.ui, id: `${this.id}:refill`, theme: this.theme, texture: t.buttonGreen, nineSlice: READY_UI_NINE_SLICES.buttonGreen,
        width: F.refill.width, height: F.refill.height, pressScale: 0.9, onTap: () => this.finish('refill')
      }));
      this.refillButton.position.set(X(F.refill.x + F.refill.width / 2), Y(F.refill.y + F.refill.height / 2));
      const refillLabel = createFigmaLabel(this.theme, options.refillLabel ?? 'REFILL NOW!', F.refillLabel.fontSize);
      placeFigmaLabel(refillLabel, { ...buttonBox(F.refill, F.refillLabel), align: 'center' });
      this.priceText = createFigmaLabel(this.theme, '900', F.priceRow.fontSize);
      this.priceCoin = sprite(t.iconCoin, { x: 0, y: 0, width: F.coin.width, height: F.coin.height });
      this.refillButton.addChild(refillLabel, this.priceText, this.priceCoin);

      this.adButton = this.addButton(new UiButton({
        ui: this.ui, id: `${this.id}:ad`, theme: this.theme, texture: t.buttonOrange, nineSlice: READY_UI_NINE_SLICES.buttonOrange,
        width: F.ad.width, height: F.ad.height, pressScale: 0.9, onTap: () => this.finish('ad')
      }));
      this.adButton.position.set(X(F.ad.x + F.ad.width / 2), Y(F.ad.y + F.ad.height / 2));
      const adLabel = createFigmaLabel(this.theme, options.adLabel ?? 'GET', F.adLabel.fontSize);
      placeFigmaLabel(adLabel, { ...buttonBox(F.ad, F.adLabel), align: 'center' });
      const rewardLabel = createFigmaLabel(this.theme, options.adRewardLabel ?? '+1', F.rewardLabel.fontSize);
      placeFigmaLabel(rewardLabel, { ...buttonBox(F.ad, F.rewardLabel), align: 'left' });
      // Figma order: the highlight over the face, GET, the heart icon and its "+1", the clapper on top
      this.adButton.addChild(
        sprite(t.buttonHighlight, buttonBox(F.ad, F.adHighlight)), adLabel,
        sprite(t.iconHeart, buttonBox(F.ad, F.rewardIcon)), rewardLabel,
        sprite(t.iconAd, buttonBox(F.ad, F.adIcon))
      );

      // decoration never takes input: taps on it still land inside the panel's hit area (no backdrop close)
      for (const node of [surface, this.title, inset, heart, this.countText, this.nextLabel, this.timerText]) node.eventMode = 'none';
      this.panel.addChildAt(surface, 0);
      this.panel.addChild(this.title, inset, heart, this.countText, this.nextLabel, this.timerText, this.refillButton, this.adButton);
      this.placeClose();
      return;
    }

    const t = this.textures;
    this.priceCoin = null;
    this.panel.addChildAt(this.sprite(t.panelPurple, 968, 1070), 0);
    this.title = createLabel(this.theme, options.title ?? 'REFILL HEARTS!', { fontSize: 88, stroke: 11 });
    this.title.y = -440;
    fitLabelWidth(this.title, 780);
    this.panel.addChild(this.title);

    this.panel.addChild(this.sprite(t.panelInner, 900, 382));
    const heart = this.sprite(t.heartBig, 326, 298);
    heart.x = -261;
    this.panel.addChild(heart);
    this.countText = createLabel(this.theme, '1/5', { fontSize: 132, stroke: 10 });
    this.countText.position.set(-267, -30);
    this.nextLabel = createLabel(this.theme, options.nextLifeLabel ?? 'Next heart in', { fontSize: 50, stroke: 7 });
    this.nextLabel.position.set(180, -69);
    this.timerText = createLabel(this.theme, '00:00', { fontSize: 92, stroke: 10 });
    this.timerText.position.set(180, 29);
    this.panel.addChild(this.countText, this.nextLabel, this.timerText);

    // REFILL: label above, price + coin below (donor button layout)
    this.refillButton = this.createButton('refill', t.btnGreenShort, options.refillLabel ?? 'REFILL', () => this.finish('refill'), 371, 207, 52, -50);
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
    if (this.variant === 'figma') {
      this.params = params;
      const full = params.lives >= params.maxLives;
      this.countText.text = String(params.lives);
      placeFigmaLabel(this.countText, { ...panelBox(F.count), align: 'center' });
      this.timerText.text = full ? this.fullLabel : params.timerText ?? '';
      placeFigmaLabel(this.timerText, { ...panelBox(F.timer), align: 'center' });
      this.priceText.text = formatAmount(params.refillPrice);
      this.layoutPrice();
      const showAd = (params.adOffer ?? true) && this.onWatchAd !== null;
      this.adButton.visible = showAd;
      this.adButton.setEnabled(showAd);
      this.refillButton.setEnabled(!full);
      this.refillButton.x = showAd ? X(F.refill.x + F.refill.width / 2) : 0;
      return;
    }
    this.params = params;
    const full = params.lives >= params.maxLives;
    this.countText.text = `${params.lives}/${params.maxLives}`;
    this.timerText.text = full ? this.fullLabel : params.timerText ?? '';
    fitLabelWidth(this.timerText, 420);
    this.priceText.text = formatAmount(params.refillPrice);
    const showAd = (params.adOffer ?? true) && this.onWatchAd !== null;
    this.adButton.visible = showAd;
    this.adButton.setEnabled(showAd);
    this.refillButton.setEnabled(!full);
    this.refillButton.x = showAd ? -253 : 0;
  }

  /** Live countdown update while the window is open. */
  setTimer(timerText: string): void {
    if (!this.params || this.params.lives >= this.params.maxLives) return;
    this.params.timerText = timerText;
    this.timerText.text = timerText;
    if (this.variant === 'figma') placeFigmaLabel(this.timerText, { ...panelBox(F.timer), align: 'center' });
  }

  /** 'figma': the Figma window box (the fit, the backdrop test and the hit area; not the art's bleed). 'donor': measured. */
  protected override panelBounds(): Rectangle {
    return this.variant === 'figma' ? new Rectangle(X(F.window.x), Y(F.window.y), F.window.width, F.window.height) : super.panelBounds();
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    return this.variant === 'figma' ? { x: X(F.close.x + F.close.width / 2), y: Y(F.close.y + F.close.height / 2) } : { x: 416, y: -437 };
  }

  /** 'figma': Frame 381 — the price text, a 1-unit gap and the coin, as one row centred on the REFILL button. */
  private layoutPrice(): void {
    if (!this.priceCoin) return;
    const advance = CanvasTextMetrics.measureText(this.priceText.text, this.priceText.style).lineWidths[0] ?? 0;
    const left = -(advance + F.priceRow.gap + F.coin.width) / 2;
    const top = F.priceRow.y - F.refill.y - F.refill.height / 2;
    placeFigmaLabel(this.priceText, { x: left, y: top, width: advance, height: F.priceRow.height, align: 'left' });
    this.priceCoin.position.set(left + advance + F.priceRow.gap, top);
  }

  private finish(action: 'refill' | 'ad'): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => {
      if (action === 'refill') this.onRefill(params);
      else this.onWatchAd?.(params);
    });
  }
}
