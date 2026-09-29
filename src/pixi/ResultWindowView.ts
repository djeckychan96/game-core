import { type Container, Rectangle, Sprite, type Text } from 'pixi.js';
import type { WindowHiddenReason } from '../index';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName } from './assets';
import { WinConfettiEffect, type WinConfettiConfig } from './fx/WinConfettiEffect';
import { WinStarsEffect } from './fx/WinStarsEffect';
import { ModalWindow, VICTORY_ENTRANCE, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth, formatAmount } from './text';
import { resolveTheme } from './theme';

/**
 * The textures of the WIN confetti (Trail Arrow's own firework spark + glow). Not in the required pack: a host that
 * enables `confetti` requests them with `loadReadyUiAssets({ include: WIN_CONFETTI_TEXTURES })`.
 */
export const WIN_CONFETTI_TEXTURES = ['fxSparkStar', 'fxGlowSoft'] as const satisfies readonly ReadyUiOptionalTextureName[];

export interface ResultWindowParams {
  level: number;
  /**
   * `'win'` (default) is the victory layout; `'fail'` is the final-defeat layout: the ribbon with
   * `LEVEL <n>` / `FAILED`, no stars, no reward, a green RETRY (`onRetry`) over an optional
   * yellow EXIT (`onExit`). Callbacks receive these params, so they can read the outcome.
   */
  outcome?: 'win' | 'fail';
  /**
   * 0..3 stars crowning the ribbon, coming in one by one after the entrance (never more than earned); 0 / undefined
   * draws no stars. Ignored on fail.
   */
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
  /**
   * One-shot confetti over the WIN composition (never on a fail). Default off. `true` = the WIN fireworks (a few
   * large colour volleys around the window) at the `mobile` tier; an object overrides that config (e.g. `{ tier: 'desktop' }`).
   * Needs WIN_CONFETTI_TEXTURES in `textures`.
   */
  confetti?: boolean | Partial<WinConfettiConfig>;
}

/** Fails before anything registers when confetti is on and its art was not loaded. */
function modalOptions(options: ResultWindowViewOptions): ModalWindowOptions {
  if (options.confetti) {
    const missing = WIN_CONFETTI_TEXTURES.filter((name) => !options.textures[name]);
    if (missing.length) {
      const list = missing.map((name) => `${name} (${READY_UI_OPTIONAL_ASSET_FILES[name]})`).join(', ');
      throw new Error(`ResultWindowView confetti: no ${list} in textures — load them with loadReadyUiAssets({ include: WIN_CONFETTI_TEXTURES })`);
    }
  }
  return {
    ...options,
    id: options.id ?? 'result-window',
    entrance: options.entrance ?? VICTORY_ENTRANCE,
    backdropColor: options.backdropColor ?? resolveTheme(options.theme).colors.resultBackdrop,
    backdropAlpha: options.backdropAlpha ?? resolveTheme(options.theme).colors.resultBackdropAlpha
  };
}

/**
 * Level result window. Win: the donor's LevelComplete geometry — no panel, the red ribbon at
 * y −317 with `LEVEL n` / `COMPLETED!`, `REWARDS` caption, the big coin with the amount under it,
 * green CONTINUE at (−230, 310) and a yellow secondary at (230, 310), × at (445, −369); slate
 * 0.94 backdrop and the 440 ms back.out(1.9) pop. The earned stars crown the ribbon: once the entrance has landed
 * they come in left to right, 0.35 s apart — each drops from above onto its place, large, and settles with a small
 * spring; at touchdown a short flash, coloured rays and sparks go off behind / around it (the flash and the rays need
 * WIN_CONFETTI_TEXTURES in `textures`; without them the stars still fly in, spring and glow).
 * Fail: the same ribbon and ×, then RETRY (green, primary) and EXIT (yellow, smaller) stacked
 * right under it — no stars, no reward space — with the shorter box centered in the safe area.
 * Both outcomes share one scale: the fit uses the full victory frame (star crown … CTA row), not
 * the currently visible content, so a short fail is never zoomed up and the crown never clips.
 * Next/Retry/Exit are close() continuations, so a cancelled window never triggers navigation;
 * the × and the backdrop run only `onDismiss(reason)`, never a retry or an exit.
 * Optional WIN confetti (`confetti`): an input-transparent layer over the composition, in panel design units around
 * the frame centre; it starts at every WIN show (t = 0) and stops on every path to hidden (the fx scope).
 */
export class ResultWindowView extends ModalWindow<ResultWindowParams> {
  private readonly titleText: Text;
  private readonly subtitleText: Text;
  private readonly stars: Sprite[] = [];
  /** The stars' rest boxes (panel units): what the WIN tap area adds for the earned ones. */
  private readonly starBoxes: Rectangle[] = [];
  /** The stars' entrance: flight, spring and the landing flash / rays / sparks around them. */
  private readonly starsFx: WinStarsEffect;
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
  /** Design-unit box of the whole victory composition; the fit box of both outcomes. */
  private frame: Rectangle | null = null;
  /** WIN confetti, only when `options.confetti` is on. */
  private readonly confetti: WinConfettiEffect | null = null;

  constructor(options: ResultWindowViewOptions) {
    super(modalOptions(options));
    this.onNext = options.onNext;
    this.onRetry = options.onRetry ?? null;
    this.onExit = options.onExit ?? null;
    const t = this.textures;

    const ribbon = this.sprite(t.victoryRibbon, 1019, 239);
    ribbon.y = -317;
    this.panel.addChildAt(ribbon, 0);

    // stars crown the ribbon (not in the donor window; hidden unless params.stars > 0): 2× the first crown, the middle
    // one 20 % larger and raised like Vlad's WIN; all of them clear of the title (its top ≈ −413) and of the ×. All three
    // stand upright (the kit's starGoldL / starGoldR are the level map's tilted side stars)
    const starSpecs = [
      { x: -272, y: -540, size: 240, tex: t.starGold },
      { x: 0, y: -600, size: 288, tex: t.starGold },
      { x: 272, y: -540, size: 240, tex: t.starGold }
    ];
    for (const spec of starSpecs) {
      const star = new Sprite(spec.tex);
      star.anchor.set(0.5);
      star.scale.set(spec.size / Math.max(1, spec.tex.width));
      star.position.set(spec.x, spec.y);
      star.visible = false;
      // never measured: the tap area takes the rest box of an earned star, not whatever transform it has mid-flight
      star.measurable = false;
      this.stars.push(star);
      this.starBoxes.push(new Rectangle(spec.x - spec.size / 2, spec.y - spec.size / 2, spec.size, spec.size));
    }
    // their landing flash, rays and halo behind them, the sparks over them; eventMode none, excluded from bounds
    const landing = t.fxGlowSoft && t.fxSparkStar ? { glow: t.fxGlowSoft, spark: t.fxSparkStar } : null;
    this.starsFx = new WinStarsEffect({ motion: this.motion, scope: this.fxScope, stars: this.stars, textures: landing });
    this.panel.addChild(this.starsFx, ...this.stars, this.starsFx.front);

    this.titleText = createLabel(this.theme, 'LEVEL 1', { fontSize: 60, stroke: 9 });
    this.titleText.y = -373;
    this.subtitleText = createLabel(this.theme, 'COMPLETED!', { fontSize: 60, stroke: 9 });
    this.subtitleText.y = -304;
    this.panel.addChild(this.titleText, this.subtitleText);

    this.rewardCaption = createLabel(this.theme, options.rewardsLabel ?? 'REWARDS', { fontSize: 38, stroke: 9 });
    this.rewardCaption.y = -139;
    this.rewardCoin = this.sprite(t.coinBig, 196, 210);
    this.rewardAmount = createLabel(this.theme, '0', { fontSize: 88, stroke: 9 });
    this.rewardAmount.y = 119; // donor 101 overlapped the coin; Trail Arrow's fix moved it 18 lower
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
    // the stars are hidden until they pop, so they are counted here, not measured at fit time
    const framed: Container[] = [ribbon, ...this.stars, this.rewardCoin, this.nextButton, this.retryButton];
    if (this.closeButton) framed.push(this.closeButton);
    this.frame = centeredBox(framed);
    if (options.confetti && t.fxSparkStar && t.fxGlowSoft) {
      // over the composition (the × stays on top), centred on the frame; eventMode none, excluded from bounds
      const config = options.confetti === true ? {} : options.confetti;
      this.confetti = new WinConfettiEffect({ ...config, motion: this.motion, scope: this.fxScope, textures: { spark: t.fxSparkStar, glow: t.fxGlowSoft } });
      this.confetti.position.set(this.frame.x + this.frame.width / 2, this.frame.y + this.frame.height / 2);
      this.panel.addChild(this.confetti);
    }
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
    this.starsFx.reset();
    // applyParams runs once per show (the controller's onShow): a WIN starts the confetti from t = 0
    if (fail) this.confetti?.cancel();
    else this.confetti?.play();
  }

  /** Fit box: the victory frame for both outcomes, so the scale never depends on what is visible. */
  protected override panelBounds(): Rectangle {
    return this.frame?.clone() ?? super.panelBounds();
  }

  /**
   * One scale for win and fail (the frame fit); each outcome then centers its own composition:
   * the win its whole frame (crown included), the shorter fail its measured box. The tap area
   * stays the visible content plus the earned stars at rest (layout runs while they are still
   * hidden, and a tap on a landed star must not reach the backdrop), so the backdrop around a
   * fail — or above a crown with fewer stars — still dismisses.
   */
  protected override layoutPanel(): void {
    super.layoutPanel();
    if (!this.frame) return;
    const visible = super.panelBounds();
    const box = this.params?.outcome === 'fail' ? visible : this.frame;
    const safe = this.safeArea();
    this.panel.hitArea = new TapArea(visible, this.starBoxes.slice(0, this.earnedStars()));
    this.setIdle(safe.x + safe.width / 2, safe.y + safe.height / 2 - (box.y + box.height / 2) * this.fitScale, this.fitScale);
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 445, y: -369 };
  }

  protected override onShown(): void {
    // the entrance has landed: the earned stars come in (one run in the fx scope, cancelled on every path to hidden)
    this.starsFx.play(this.earnedStars());
  }

  /** Stars of the current show: 0 on a fail, else params.stars rounded into 0..3. */
  private earnedStars(): number {
    return this.params?.outcome === 'fail' ? 0 : Math.max(0, Math.min(3, Math.round(this.params?.stars ?? 0)));
  }

  protected override onHiddenView(_reason: WindowHiddenReason): void {
    this.starsFx.reset(); // no star, flash or spark stays after a close
    this.confetti?.cancel(); // the fx scope cancel already stopped the run; this keeps the stop independent of it
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

/** Union of center-anchored nodes in panel units; read from sizes, so hidden nodes count too. */
function centeredBox(nodes: Container[]): Rectangle {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x - node.width / 2);
    right = Math.max(right, node.x + node.width / 2);
    top = Math.min(top, node.y - node.height / 2);
    bottom = Math.max(bottom, node.y + node.height / 2);
  }
  return new Rectangle(left, top, right - left, bottom - top);
}

/**
 * The WIN tap area: the visible content's box (its x / y / width / height, as before) plus the rest boxes of the earned
 * stars — each one on its own, so the empty place of an unearned star is still backdrop.
 */
class TapArea extends Rectangle {
  private readonly extra: readonly Rectangle[];

  constructor(box: Rectangle, extra: readonly Rectangle[]) {
    super(box.x, box.y, box.width, box.height);
    this.extra = extra;
  }

  override contains(x: number, y: number): boolean {
    if (super.contains(x, y)) return true;
    for (const box of this.extra) if (box.contains(x, y)) return true;
    return false;
  }
}

/** Hidden buttons are also disabled, so no path can tap them. */
function setShown(button: UiButton, shown: boolean): void {
  button.visible = shown;
  button.setEnabled(shown);
}
