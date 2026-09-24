import { Sprite, type Text } from 'pixi.js';
import type { WindowHiddenReason } from '../index';
import { ModalWindow, VICTORY_ENTRANCE, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth, formatAmount } from './text';
import { resolveTheme } from './theme';

export interface ResultWindowParams {
  level: number;
  /**
   * `'win'` (default) is the victory layout; `'fail'` is the final-defeat layout: the ribbon with
   * `LEVEL <n>` / `FAILED`, no stars, no reward, a green RETRY (`onRetry`) over an optional
   * yellow EXIT (`onExit`). Callbacks receive these params, so they can read the outcome.
   */
  outcome?: 'win' | 'fail';
  /** 0..3 stars, popped in over the ribbon one by one; 0 / undefined draws no stars. Ignored on fail. */
  stars?: number;
  /** Coins earned (shown under the big coin). Ignored on fail (pass 0). */
  rewardCoins: number;
  /** Ribbon lines. Defaults: `LEVEL <n>` / `COMPLETED!` (win) or `FAILED` (fail). */
  title?: string;
  subtitle?: string;
  /** Show the secondary (retry) button on a win. Default true. On a fail RETRY is the primary. */
  retry?: boolean;
}

export interface ResultWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** Primary button label. Default `CONTINUE`. */
  nextLabel?: string;
  /** Retry label (the win's secondary, the fail's primary). Default `RETRY`. */
  retryLabel?: string;
  /** The fail's secondary button label. Default `EXIT`. */
  exitLabel?: string;
  /** Caption above the reward. Default `REWARDS`. */
  rewardsLabel?: string;
  /** Business continuations: run only after the window has fully closed. */
  onNext: (params: ResultWindowParams) => void;
  onRetry?: (params: ResultWindowParams) => void;
  /** The fail's EXIT (e.g. back to the map); the button is drawn only when this is given. */
  onExit?: (params: ResultWindowParams) => void;
}

/**
 * Level result window. Win: the donor's LevelComplete geometry — no panel, the red ribbon at
 * y −317 with `LEVEL n` / `COMPLETED!`, `REWARDS` caption, the big coin with the amount under it,
 * green CONTINUE at (−230, 310) and a yellow secondary at (230, 310), × at (445, −369); slate
 * 0.94 backdrop and the 440 ms back.out(1.9) pop. Optional stars crown the ribbon.
 * Fail: the same ribbon and ×, then RETRY (green, primary) and EXIT (yellow, smaller) stacked
 * right under it — no stars, no reward space — with the shorter box centered in the safe area.
 * Next/Retry/Exit are close() continuations, so a cancelled window never triggers navigation;
 * the × and the backdrop run only `onDismiss(reason)`, never a retry or an exit.
 */
export class ResultWindowView extends ModalWindow<ResultWindowParams> {
  private readonly titleText: Text;
  private readonly subtitleText: Text;
  private readonly stars: Sprite[] = [];
  private readonly rewardCaption: Text;
  private readonly rewardCoin: Sprite;
  private readonly rewardAmount: Text;
  private readonly nextButton: UiButton;
  private readonly retryButton: UiButton;
  private readonly failRetryButton: UiButton;
  private readonly exitButton: UiButton;
  private readonly onNext: (params: ResultWindowParams) => void;
  private readonly onRetry: ((params: ResultWindowParams) => void) | null;
  private readonly onExit: ((params: ResultWindowParams) => void) | null;
  private params: ResultWindowParams | null = null;

  constructor(options: ResultWindowViewOptions) {
    super({
      ...options,
      id: options.id ?? 'result-window',
      entrance: options.entrance ?? VICTORY_ENTRANCE,
      backdropColor: options.backdropColor ?? resolveTheme(options.theme).colors.resultBackdrop,
      backdropAlpha: options.backdropAlpha ?? resolveTheme(options.theme).colors.resultBackdropAlpha
    });
    this.onNext = options.onNext;
    this.onRetry = options.onRetry ?? null;
    this.onExit = options.onExit ?? null;
    const t = this.textures;

    const ribbon = this.sprite(t.victoryRibbon, 1019, 239);
    ribbon.y = -317;
    this.panel.addChildAt(ribbon, 0);

    // stars crown the ribbon (not in the donor window; hidden unless params.stars > 0)
    const starSpecs = [
      { x: -170, y: -430, size: 120, tex: t.starGoldL },
      { x: 0, y: -468, size: 144, tex: t.starGold },
      { x: 170, y: -430, size: 120, tex: t.starGoldR }
    ];
    for (const spec of starSpecs) {
      const star = new Sprite(spec.tex);
      star.anchor.set(0.5);
      star.scale.set(spec.size / Math.max(1, spec.tex.width));
      star.position.set(spec.x, spec.y);
      star.visible = false;
      this.panel.addChild(star);
      this.stars.push(star);
    }

    this.titleText = createLabel(this.theme, 'LEVEL 1', { fontSize: 60, stroke: 9 });
    this.titleText.y = -373;
    this.subtitleText = createLabel(this.theme, 'COMPLETED!', { fontSize: 60, stroke: 9 });
    this.subtitleText.y = -304;
    this.panel.addChild(this.titleText, this.subtitleText);

    this.rewardCaption = createLabel(this.theme, options.rewardsLabel ?? 'REWARDS', { fontSize: 38, stroke: 9 });
    this.rewardCaption.y = -139;
    this.rewardCoin = this.sprite(t.coinBig, 196, 210);
    this.rewardAmount = createLabel(this.theme, '0', { fontSize: 88, stroke: 9 });
    this.rewardAmount.y = 101;
    this.panel.addChild(this.rewardCaption, this.rewardCoin, this.rewardAmount);

    this.nextButton = this.createButton('next', t.btnGreen, options.nextLabel ?? 'CONTINUE', () => this.finish('next'));
    this.nextButton.position.set(-230, 310);
    this.retryButton = this.createButton('retry', t.btnYellow, options.retryLabel ?? 'RETRY', () => this.finish('retry'));
    this.retryButton.position.set(230, 310);
    // fail: the win's CONTINUE size for the primary, the secondary at 0.85 of it, 26 units apart
    this.failRetryButton = this.createButton('fail-retry', t.btnGreen, options.retryLabel ?? 'RETRY', () => this.finish('retry'));
    this.failRetryButton.position.set(0, -48);
    this.exitButton = this.createButton('exit', t.btnYellow, options.exitLabel ?? 'EXIT', () => this.finish('exit'), 373, 176, 53, -8);
    this.exitButton.position.set(0, 170);
    this.panel.addChild(this.nextButton, this.retryButton, this.failRetryButton, this.exitButton);
    this.placeClose();
  }

  protected applyParams(params: ResultWindowParams): void {
    this.params = params;
    const fail = params.outcome === 'fail';
    this.titleText.text = params.title ?? `LEVEL ${params.level}`;
    fitLabelWidth(this.titleText, 760);
    this.subtitleText.text = params.subtitle ?? (fail ? 'FAILED' : 'COMPLETED!');
    fitLabelWidth(this.subtitleText, 760);
    this.rewardCaption.visible = !fail;
    this.rewardCoin.visible = !fail;
    this.rewardAmount.visible = !fail;
    this.rewardAmount.text = fail ? '' : formatAmount(params.rewardCoins);
    const showRetry = !fail && (params.retry ?? true) && this.onRetry !== null;
    setShown(this.nextButton, !fail);
    setShown(this.retryButton, showRetry);
    this.nextButton.x = showRetry ? -230 : 0;
    setShown(this.failRetryButton, fail);
    setShown(this.exitButton, fail && this.onExit !== null);
    for (const star of this.stars) star.visible = false;
  }

  /** A fail is shorter than a win: center its measured box, not the victory origin. */
  protected override layoutPanel(): void {
    super.layoutPanel();
    if (this.params?.outcome !== 'fail') return;
    const bounds = this.panelBounds();
    const safe = this.safeArea();
    this.setIdle(safe.x + safe.width / 2, safe.y + safe.height / 2 - (bounds.y + bounds.height / 2) * this.fitScale, this.fitScale);
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 445, y: -369 };
  }

  protected override onShown(): void {
    const earned = this.params?.outcome === 'fail' ? 0 : Math.max(0, Math.min(3, Math.round(this.params?.stars ?? 0)));
    for (let i = 0; i < earned; i++) {
      const star = this.stars[i];
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

  private finish(action: 'next' | 'retry' | 'exit'): void {
    const params = this.params;
    if (!params) return;
    this.close('button', () => {
      if (action === 'next') this.onNext(params);
      else if (action === 'retry') this.onRetry?.(params);
      else this.onExit?.(params);
    });
  }
}

/** Hidden buttons are also disabled, so no path can tap them. */
function setShown(button: UiButton, shown: boolean): void {
  button.visible = shown;
  button.setEnabled(shown);
}
