import { Container, Rectangle, Sprite, type Text } from 'pixi.js';
import type { WindowCloseReason, WindowHiddenReason } from '../index';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth, formatAmount } from './text';

export interface ResultWindowParams {
  level: number;
  /** 0..3 stars earned; drawn in a row under the ribbon and popped in one by one. */
  stars: number;
  /** Coins earned (shown next to the big coin). */
  rewardCoins: number;
  /** Ribbon lines. Defaults: `LEVEL <n>` / `COMPLETED!` */
  title?: string;
  subtitle?: string;
  /** Show the secondary (retry) button. Default true. */
  retry?: boolean;
}

export interface ResultWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** Primary button label. Default `NEXT`. */
  nextLabel?: string;
  /** Secondary button label. Default `RETRY`. */
  retryLabel?: string;
  /** Caption above the reward. Default `REWARDS`. */
  rewardsLabel?: string;
  /** Business continuations: run only after the window has fully closed. */
  onNext: (params: ResultWindowParams) => void;
  onRetry?: (params: ResultWindowParams) => void;
}

const PANEL = new Rectangle(-520, -470, 1040, 900);

/**
 * Level result / victory window — the Trail Arrow LevelCompleteWindow art re-hosted in Game Core:
 * red ribbon with the title, three stars, the reward block, NEXT / RETRY buttons and a ×.
 * Next/Retry are close() continuations, so a cancelled window never triggers navigation.
 */
export class ResultWindowView extends ModalWindow<ResultWindowParams> {
  private readonly titleText: Text;
  private readonly subtitleText: Text;
  private readonly stars: Sprite[] = [];
  private readonly starSlots: Sprite[] = [];
  private readonly rewardCaption: Text;
  private readonly rewardAmount: Text;
  private readonly nextButton: UiButton;
  private readonly retryButton: UiButton;
  private readonly onNext: (params: ResultWindowParams) => void;
  private readonly onRetry: ((params: ResultWindowParams) => void) | null;
  private params: ResultWindowParams | null = null;

  constructor(options: ResultWindowViewOptions) {
    super({ ...options, id: options.id ?? 'result-window' });
    this.onNext = options.onNext;
    this.onRetry = options.onRetry ?? null;
    const t = this.textures;

    const ribbon = this.sprite(t.victoryRibbon, 1019, 239);
    ribbon.y = -317;
    this.panel.addChildAt(ribbon, 0);

    this.titleText = createLabel(this.theme, 'LEVEL 1', { fontSize: 60 });
    this.titleText.y = -373;
    this.subtitleText = createLabel(this.theme, 'COMPLETED!', { fontSize: 60 });
    this.subtitleText.y = -304;
    this.panel.addChild(this.titleText, this.subtitleText);

    // stars: side ones tilted like the map badges, center one raised
    const starSpecs = [
      { x: -150, y: -110, size: 150, gold: t.starGoldL, empty: t.starEmptyL },
      { x: 0, y: -150, size: 176, gold: t.starGold, empty: t.starEmpty },
      { x: 150, y: -110, size: 150, gold: t.starGoldR, empty: t.starEmptyR }
    ];
    for (const spec of starSpecs) {
      const slot = new Sprite(spec.empty);
      slot.anchor.set(0.5);
      slot.scale.set(spec.size / Math.max(1, spec.empty.width));
      slot.position.set(spec.x, spec.y);
      slot.alpha = 0.55;
      this.panel.addChild(slot);
      this.starSlots.push(slot);
      const star = new Sprite(spec.gold);
      star.anchor.set(0.5);
      star.scale.set(spec.size / Math.max(1, spec.gold.width));
      star.position.set(spec.x, spec.y);
      star.visible = false;
      this.panel.addChild(star);
      this.stars.push(star);
    }

    const rewardRoot = new Container();
    rewardRoot.y = 60;
    this.rewardCaption = createLabel(this.theme, options.rewardsLabel ?? 'REWARDS', { fontSize: 38 });
    this.rewardCaption.y = -60;
    const coin = this.sprite(t.coinBig, 196, 210);
    coin.position.set(-90, 60);
    this.rewardAmount = createLabel(this.theme, '0', { fontSize: 88 });
    this.rewardAmount.anchor.set(0, 0.5);
    this.rewardAmount.position.set(20, 60);
    rewardRoot.addChild(this.rewardCaption, coin, this.rewardAmount);
    this.panel.addChild(rewardRoot);

    this.retryButton = this.createButton('retry', t.btnYellow, options.retryLabel ?? 'RETRY', () => this.finish('retry'));
    this.retryButton.position.set(-230, 310);
    this.nextButton = this.createButton('next', t.btnGreen, options.nextLabel ?? 'NEXT', () => this.finish('next'));
    this.nextButton.position.set(230, 310);
    this.panel.addChild(this.retryButton, this.nextButton);
    if (this.closeButton) this.panel.setChildIndex(this.closeButton, this.panel.children.length - 1);
  }

  protected applyParams(params: ResultWindowParams): void {
    this.params = params;
    this.titleText.text = params.title ?? `LEVEL ${params.level}`;
    fitLabelWidth(this.titleText, 760);
    this.subtitleText.text = params.subtitle ?? 'COMPLETED!';
    fitLabelWidth(this.subtitleText, 760);
    this.rewardAmount.text = formatAmount(params.rewardCoins);
    const showRetry = params.retry ?? true;
    this.retryButton.visible = showRetry;
    this.retryButton.setEnabled(showRetry);
    this.nextButton.x = showRetry ? 230 : 0;
    this.retryButton.x = -230;
    for (const star of this.stars) {
      star.visible = false;
      star.scale.set(star.scale.x);
    }
  }

  protected panelBounds(): Rectangle {
    return PANEL;
  }

  /** The window has no backing panel: the × sits on the ribbon's top-right corner. */
  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 468, y: -408 };
  }

  protected override onShown(): void {
    const earned = Math.max(0, Math.min(3, Math.round(this.params?.stars ?? 0)));
    // pop the earned stars in one after another, each with a spring
    const order = [0, 1, 2];
    for (let i = 0; i < earned; i++) {
      const idx = order[i];
      if (idx === undefined) continue;
      const star = this.stars[idx];
      if (!star) continue;
      const finalScale = star.scale.x;
      const k = { v: 0 };
      this.motion.tween({
        scope: this.fxScope,
        delayMs: 120 + i * 160,
        durationMs: 380,
        ease: 'backOut',
        bindings: [{ get: () => k.v, set: (v: number) => { k.v = v; star.visible = true; star.scale.set(finalScale * Math.max(0.001, v)); }, from: 0, to: 1 }],
        onCancel: () => { star.scale.set(finalScale); }
      });
    }
  }

  protected override onHiddenView(_reason: WindowHiddenReason): void {
    for (const star of this.stars) star.visible = false;
  }

  private finish(action: 'next' | 'retry'): void {
    const params = this.params;
    if (!params) return;
    const reason: WindowCloseReason = 'button';
    this.close(reason, () => {
      if (action === 'next') this.onNext(params);
      else this.onRetry?.(params);
    });
  }
}
