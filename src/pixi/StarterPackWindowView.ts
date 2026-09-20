import { Container, Sprite, type Text } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth, formatAmount } from './text';

export interface StarterPackRewards {
  /** Coins in the pack (under the coin pile). */
  coins: number;
  /** Infinite-lives duration caption, e.g. `1h`. Omit to hide the heart. */
  infiniteLives?: string;
  /** Booster caption next to the bulb, e.g. `x3`. Omit to hide the booster bar. */
  boosters?: string;
}

export interface StarterPackWindowParams {
  /** Localized price string on the buy button. */
  price: string;
  rewards: StarterPackRewards;
  /** Rotated header, two or three lines. Default `STARTER\nPACK` */
  title?: string;
}

export interface StarterPackWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** Close continuation: the player tapped the price button. */
  onBuy: (params: StarterPackWindowParams) => void;
}

/** Donor: a header wider than this shrinks (long tier names — LEGENDARY, ROYAL — overflowed the panel). */
const HEADER_MAX_WIDTH = 430;

/**
 * Starter Pack offer — the donor's OfferStarterPack prefab: 975 × 1355 warm-gradient panel,
 * the chest hero (620 × 620 at (−6, −310)), `STARTER PACK` rotated −14° at the top-left, the
 * rewards row at y 158 (coin pile + amount, ∞-heart + duration), the red booster bar at y 353
 * with the bulb, the green price button at y 542, × at (410, −587), and the offer countdown
 * under the rotated header (donor `layoutTimer`, decision of 15.09).
 * Data only: the host (an OfferRuntime adapter) feeds title / price / rewards through `show`,
 * the countdown through `setTimer`, the purchase-in-flight state through `setBuyEnabled`;
 * BUY is a close() continuation and no LiveOps logic lives here.
 */
export class StarterPackWindowView extends ModalWindow<StarterPackWindowParams> {
  private readonly title: Text;
  private readonly timerText: Text;
  private readonly coinsText: Text;
  private readonly livesText: Text;
  private readonly livesIcon: Sprite;
  private readonly boosterBar: Container;
  private readonly boosterText: Text;
  private readonly goldIcon: Sprite;
  private readonly buyButton: UiButton;
  private readonly onBuy: (params: StarterPackWindowParams) => void;
  private params: StarterPackWindowParams | null = null;

  constructor(options: StarterPackWindowViewOptions) {
    super({ ...options, id: options.id ?? 'starter-pack-window', fit: options.fit ?? { widthRatio: 0.94, heightRatio: 0.92 } });
    this.onBuy = options.onBuy;
    const t = this.textures;

    this.panel.addChildAt(this.createPanel(975, 1355, { style: this.theme.promoPanel, art: t.starterPanel }), 0);
    const hero = this.sprite(t.starterIcon, 620, 620);
    hero.position.set(-6, -310);
    this.panel.addChild(hero);

    this.title = createLabel(this.theme, 'STARTER\nPACK', { fontSize: 84, stroke: 10 });
    this.title.position.set(-304, -577);
    this.title.rotation = (-14 * Math.PI) / 180;
    this.panel.addChild(this.title);
    // donor: Firasans Black 60, stroke 8, same tilt as the header; hidden until the host sets a text
    this.timerText = createLabel(this.theme, '', { fontSize: 60, stroke: 8 });
    this.timerText.visible = false;
    this.panel.addChild(this.timerText);

    const items = new Container();
    items.y = 158;
    this.goldIcon = this.sprite(t.starterGold, 260, 220);
    this.goldIcon.x = -105;
    this.coinsText = createLabel(this.theme, '3500', { fontSize: 70, stroke: 9 });
    this.coinsText.position.set(-105, 63);
    this.livesIcon = this.sprite(t.starterHearts, 162, 162);
    this.livesIcon.position.set(105, 6);
    this.livesText = createLabel(this.theme, '1h', { fontSize: 58, stroke: 8 });
    this.livesText.position.set(105, 69);
    items.addChild(this.goldIcon, this.coinsText, this.livesIcon, this.livesText);
    this.panel.addChild(items);

    this.boosterBar = new Container();
    this.boosterBar.y = 353;
    const border = this.createBadge(810, 161, 'accent', 'rounded', t.starterBorder);
    const bulb = this.sprite(t.bulb, 190, 190);
    bulb.position.set(-45, -12);
    this.boosterText = createLabel(this.theme, 'x3', { fontSize: 52, stroke: 6, anchorX: 0 });
    this.boosterText.position.set(-28, 46);
    this.boosterBar.addChild(border, bulb, this.boosterText);
    this.panel.addChild(this.boosterBar);

    this.buyButton = this.createButton('buy', 'positive', '', () => this.finish(), 600, 206, 92, -8);
    this.buyButton.y = 542;
    this.panel.addChild(this.buyButton);
    this.placeClose();
  }

  protected applyParams(params: StarterPackWindowParams): void {
    this.params = params;
    this.title.text = params.title ?? 'STARTER\nPACK';
    fitLabelWidth(this.title, HEADER_MAX_WIDTH);
    this.layoutTimer();
    this.coinsText.text = formatAmount(params.rewards.coins);
    const lives = params.rewards.infiniteLives;
    this.livesIcon.visible = Boolean(lives);
    this.livesText.visible = Boolean(lives);
    this.livesText.text = lives ?? '';
    // a single reward centers the coin pile like the donor's two-item row collapses
    this.goldIcon.x = lives ? -105 : 0;
    this.coinsText.x = lives ? -105 : 0;
    const boosters = params.rewards.boosters;
    this.boosterBar.visible = Boolean(boosters);
    this.boosterText.text = boosters ?? '';
    this.buyButton.setLabel(params.price);
    if (this.buyButton.labelText) fitLabelWidth(this.buyButton.labelText, 520);
  }

  /** The offer countdown under the header (e.g. `11:59:58`). An empty string hides it. */
  setTimer(text: string): void {
    this.timerText.text = text;
    this.timerText.visible = text.length > 0;
    this.layoutTimer();
  }

  /** Whether BUY accepts taps — false while the host's purchase is in flight (donor `setPurchaseState`: alpha 0.85). */
  setBuyEnabled(enabled: boolean): void {
    this.buyButton.setEnabled(enabled);
    this.buyButton.alpha = enabled ? 1 : 0.85;
  }

  get buyEnabled(): boolean {
    return this.buyButton.enabled;
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 410, y: -587 };
  }

  /**
   * Donor `layoutTimer`: the countdown sits under the header along the header's own rotated
   * "down" axis, half the header height (which follows a shrunk title) plus 40 units away.
   */
  private layoutTimer(): void {
    const rotation = this.title.rotation;
    const d = this.title.height / 2 + 40;
    this.timerText.rotation = rotation;
    this.timerText.position.set(this.title.x - d * Math.sin(rotation), this.title.y + d * Math.cos(rotation));
  }

  private finish(): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => this.onBuy(params));
  }
}
