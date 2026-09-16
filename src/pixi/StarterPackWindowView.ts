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

/**
 * Starter Pack offer — the donor's OfferStarterPack prefab: 975 × 1355 warm-gradient panel,
 * the chest hero (620 × 620 at (−6, −310)), `STARTER PACK` rotated −14° at the top-left, the
 * rewards row at y 158 (coin pile + amount, ∞-heart + duration), the red booster bar at y 353
 * with the bulb, the green price button at y 542, × at (410, −587).
 * Ready for a future OfferRuntime: everything shown is data, BUY is a close() continuation.
 */
export class StarterPackWindowView extends ModalWindow<StarterPackWindowParams> {
  private readonly title: Text;
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

    this.panel.addChildAt(this.sprite(t.starterPanel, 975, 1355), 0);
    const hero = this.sprite(t.starterIcon, 620, 620);
    hero.position.set(-6, -310);
    this.panel.addChild(hero);

    this.title = createLabel(this.theme, 'STARTER\nPACK', { fontSize: 84, stroke: 10 });
    this.title.position.set(-304, -577);
    this.title.rotation = (-14 * Math.PI) / 180;
    this.panel.addChild(this.title);

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
    const border = this.sprite(t.starterBorder, 810, 161);
    const bulb = this.sprite(t.bulb, 190, 190);
    bulb.position.set(-45, -12);
    this.boosterText = createLabel(this.theme, 'x3', { fontSize: 52, stroke: 6, anchorX: 0 });
    this.boosterText.position.set(-28, 46);
    this.boosterBar.addChild(border, bulb, this.boosterText);
    this.panel.addChild(this.boosterBar);

    this.buyButton = this.createButton('buy', t.starterBuy, '', () => this.finish(), 600, 206, 92, -8);
    this.buyButton.y = 542;
    this.panel.addChild(this.buyButton);
    this.placeClose();
  }

  protected applyParams(params: StarterPackWindowParams): void {
    this.params = params;
    this.title.text = params.title ?? 'STARTER\nPACK';
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

  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 410, y: -587 };
  }

  private finish(): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => this.onBuy(params));
  }
}
