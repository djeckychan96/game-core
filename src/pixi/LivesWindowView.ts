import { Container, Rectangle, type Text } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth, formatAmount } from './text';

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

export interface LivesWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  title?: string;
  nextLifeLabel?: string;
  refillLabel?: string;
  fullLabel?: string;
  /** Close continuations. */
  onRefill: (params: LivesWindowParams) => void;
  onWatchAd?: (params: LivesWindowParams) => void;
}

const PANEL = new Rectangle(-484, -535, 968, 1070);

/**
 * Lives / out-of-lives window on the donor's purple info panel: big heart with `n/max`,
 * the refill countdown, REFILL NOW (coin price) and an optional ad button.
 */
export class LivesWindowView extends ModalWindow<LivesWindowParams> {
  private readonly title: Text;
  private readonly countText: Text;
  private readonly nextLabel: Text;
  private readonly timerText: Text;
  private readonly refillButton: UiButton;
  private readonly adButton: UiButton;
  private readonly priceText: Text;
  private readonly fullLabel: string;
  private readonly onRefill: (params: LivesWindowParams) => void;
  private readonly onWatchAd: ((params: LivesWindowParams) => void) | null;
  private params: LivesWindowParams | null = null;

  constructor(options: LivesWindowViewOptions) {
    super({ ...options, id: options.id ?? 'lives-window' });
    this.onRefill = options.onRefill;
    this.onWatchAd = options.onWatchAd ?? null;
    this.fullLabel = options.fullLabel ?? 'FULL';
    const t = this.textures;

    this.panel.addChildAt(this.sprite(t.panelPurple, 968, 1070), 0);
    this.title = createLabel(this.theme, options.title ?? 'REFILL HEARTS!', { fontSize: 88 });
    this.title.y = -440;
    this.panel.addChild(this.title);

    const inner = this.sprite(t.panelInner, 900, 382);
    this.panel.addChild(inner);
    const heart = this.sprite(t.heartBig, 326, 298);
    heart.x = -261;
    this.panel.addChild(heart);
    this.countText = createLabel(this.theme, '1/5', { fontSize: 108 });
    this.countText.position.set(-267, -30);
    this.nextLabel = createLabel(this.theme, options.nextLifeLabel ?? 'NEXT HEART IN', { fontSize: 50 });
    this.nextLabel.position.set(180, -69);
    this.timerText = createLabel(this.theme, '00:00', { fontSize: 92 });
    this.timerText.position.set(180, 29);
    this.panel.addChild(this.countText, this.nextLabel, this.timerText);

    // REFILL NOW: label above, price + coin below (donor button layout)
    this.refillButton = this.createButton('refill', t.btnGreenShort, options.refillLabel ?? 'REFILL NOW!', () => this.finish('refill'), 371, 207);
    if (this.refillButton.labelText) {
      this.refillButton.labelText.y = -50;
      this.refillButton.labelText.style.fontSize = 46;
      fitLabelWidth(this.refillButton.labelText, 310);
    }
    const price = new Container();
    this.priceText = createLabel(this.theme, '900', { fontSize: 64, anchorX: 1 });
    this.priceText.position.set(18, 17);
    const coin = this.sprite(t.coinSmall, 100, 100);
    coin.position.set(66, 22);
    price.addChild(this.priceText, coin);
    this.refillButton.addChild(price);
    this.refillButton.position.set(-253, 350);

    this.adButton = this.createButton('ad', t.btnYellowWide, '', () => this.finish('ad'), 507, 207);
    const ads = this.sprite(t.ads, 128, 134);
    ads.position.set(-87, -15);
    const plusOne = this.sprite(t.heartPlus1, 154, 154);
    plusOne.position.set(71, -7);
    this.adButton.addChild(ads, plusOne);
    this.adButton.position.set(206, 350);
    this.panel.addChild(this.refillButton, this.adButton);
    if (this.closeButton) this.panel.setChildIndex(this.closeButton, this.panel.children.length - 1);
  }

  protected applyParams(params: LivesWindowParams): void {
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
  }

  protected panelBounds(): Rectangle {
    return PANEL;
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
