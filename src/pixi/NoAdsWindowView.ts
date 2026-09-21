import { type Text } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth } from './text';

export interface NoAdsWindowParams {
  /** Localized price string shown on the buy button. */
  price: string;
  /** Description on the dark band. Default `Removes pop-up ads.\nRewarded ads still available` */
  description?: string;
}

export interface NoAdsWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** The two rotated corner words. Defaults `NO` / `ADS`. */
  wordNo?: string;
  wordAds?: string;
  /** Close continuation: the player tapped the price button. */
  onBuy: (params: NoAdsWindowParams) => void;
}

/**
 * "No Ads" offer — the donor's OfferNoAds prefab: 975 × 1355 blue panel with the crossed-out
 * clapperboard baked in, `NO` / `ADS` rotated −32° over the top-left corner, the description
 * on the dark band at y 248, the green price button at y 517, × at (415, −607).
 * No purchase logic inside: the price is data, BUY is a close() continuation.
 */
export class NoAdsWindowView extends ModalWindow<NoAdsWindowParams> {
  private readonly description: Text;
  private readonly buyButton: UiButton;
  private readonly onBuy: (params: NoAdsWindowParams) => void;
  private params: NoAdsWindowParams | null = null;

  constructor(options: NoAdsWindowViewOptions) {
    super({ ...options, id: options.id ?? 'noads-window' });
    this.onBuy = options.onBuy;
    const t = this.textures;

    this.panel.addChildAt(this.sprite(t.noAdsPanel, 975, 1355), 0);

    const no = createLabel(this.theme, options.wordNo ?? 'NO', { fontSize: 108, stroke: 12 });
    no.position.set(-452, -672);
    no.rotation = (-32 * Math.PI) / 180;
    fitLabelWidth(no, 320);
    const ads = createLabel(this.theme, options.wordAds ?? 'ADS', { fontSize: 108, stroke: 12 });
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
  }

  protected applyParams(params: NoAdsWindowParams): void {
    this.params = params;
    this.description.text = params.description ?? 'Removes pop-up ads.\nRewarded ads still available';
    fitLabelWidth(this.description, 760);
    this.buyButton.setLabel(params.price);
    if (this.buyButton.labelText) fitLabelWidth(this.buyButton.labelText, 520);
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 415, y: -607 };
  }

  private finish(): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => this.onBuy(params));
  }
}
