import { type Container, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import type { WindowHiddenReason } from '../index';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName } from './assets';
import { WinConfettiEffect, type WinConfettiConfig } from './fx/WinConfettiEffect';
import { WinStarsEffect } from './fx/WinStarsEffect';
import { ModalWindow, VICTORY_ENTRANCE, type ModalWindowOptions } from './ModalWindow';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import type { NineSliceSpec } from './nineSlice';
import { resolveWindowSkin, selectWindowSkin, skinAssetKey, skinNineSlice, skinTextBoxLook, skinTextLook, type ReadyUiSkin, type ReadyUiSkinBox, type ReadyUiSkinLivesTextBox, type ReadyUiSkinResultButtonLayout, type WindowSkinLook } from './skin';
import { UiButton } from './UiButton';
import { createFigmaLabel, createLabel, fitLabelWidth, formatAmount, placeFigmaLabel, type FigmaTextLook } from './text';
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
  /**
   * Styled fail only (a Ready UI style that covers `result`): the runtime text next to the style's life-lost art.
   * Default `-1`; `null` = no life-lost art at all (a game without lives). Ignored by the donor look.
   */
  lifeDelta?: string | null;
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

type ResultLook = WindowSkinLook<'result'>;

/** The style drawing this window (null = donor) with its layout and art; a missing piece fails here, before anything registers. */
function resultLook(options: ResultWindowViewOptions): ResultLook | null {
  const skin = selectWindowSkin('result', undefined, options.theme?.skin);
  if (!skin) return null;
  return resolveWindowSkin('ResultWindowView', 'result', skin, options.textures, { variant: false, include: '' });
}

/** Style frame x / y → panel units (the styled panel origin is the frame centre). */
const fx = (look: ResultLook, x: number): number => x - look.skin.frame.width / 2;
const fy = (look: ResultLook, y: number): number => y - look.skin.frame.height / 2;
const panelBox = (look: ResultLook, b: ReadyUiSkinBox): ReadyUiSkinBox => ({ x: fx(look, b.x), y: fy(look, b.y), width: b.width, height: b.height });

/** The styled WIN composition (the crown, the ribbon, the reward, the CTA row, the ×) in frame units: the fit box of both outcomes. */
function styledWinFrame(look: ResultLook): ReadyUiSkinBox {
  const L = look.layout.win;
  const boxes: ReadyUiSkinBox[] = [L.ribbon, L.coin, L.next.button, L.retry.button, L.close, ...L.stars.map((s) => ({ x: s.x - s.size / 2, y: s.y - s.size / 2, width: s.size, height: s.size }))];
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Fails before anything registers when confetti is on and its art was not loaded. */
function modalOptions(options: ResultWindowViewOptions, look: ResultLook | null): ModalWindowOptions {
  if (options.confetti) {
    const missing = WIN_CONFETTI_TEXTURES.filter((name) => !options.textures[name]);
    if (missing.length) {
      const list = missing.map((name) => `${name} (${READY_UI_OPTIONAL_ASSET_FILES[name]})`).join(', ');
      throw new Error(`ResultWindowView confetti: no ${list} in textures — load them with loadReadyUiAssets({ include: WIN_CONFETTI_TEXTURES })`);
    }
  }
  const base = { ...options, id: options.id ?? 'result-window', entrance: options.entrance ?? VICTORY_ENTRANCE };
  if (look) {
    // the style's dim and the frame fit: the composition keeps its share of the style frame (1080 × 2344)
    const frame = styledWinFrame(look);
    return {
      ...base,
      backdropColor: options.backdropColor ?? look.skin.backdrop.color,
      backdropAlpha: options.backdropAlpha ?? look.skin.backdrop.alpha,
      fit: { widthRatio: frame.width / look.skin.frame.width, heightRatio: frame.height / look.skin.frame.height, ...(options.fit ?? {}) }
    };
  }
  return {
    ...base,
    backdropColor: options.backdropColor ?? resolveTheme(options.theme).colors.resultBackdrop,
    backdropAlpha: options.backdropAlpha ?? resolveTheme(options.theme).colors.resultBackdropAlpha
  };
}

/** The styled-only nodes: per-outcome ribbon / glow, the fail's life-lost art, its delta and its outcome line. */
interface StyledNodes {
  look: ResultLook;
  ribbonWin: Sprite;
  ribbonFail: Sprite;
  /** null: the style draws no glow for that outcome. */
  glowWin: Sprite | null;
  glowFail: Sprite | null;
  lifeLost: Sprite;
  lifeDelta: Text;
  status: Text;
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
 *
 * Styled (a Ready UI style that covers `result`, `theme.skin`; Style 1 = Figma screen/result-win / result-fail): the
 * style's ribbon per outcome (red / grey) with its tinted ×, the blurred glow band behind the content, the reward coin,
 * the CTA surfaces as the style's 9-slices (the WIN secondary on the rewarded surface with its highlight), the fail's
 * life-lost art with its runtime delta and the outcome line under it, EXIT on the style's exit surface; every text is
 * runtime text in the style's boxes; the crown's stars are the style's `resultStar` at its rest boxes, an outcome's glow
 * is optional (`glow: null`), the WIN highlight too (`highlight: null`), and EXIT is a 9-slice when its asset has caps.
 * Same params, callbacks, stars, confetti and fit rule; the scale is the style frame's contain-fit, like every styled
 * window. The style's hero art slot is game content and is not drawn.
 */
export class ResultWindowView extends ModalWindow<ResultWindowParams> {
  /** The Ready UI style drawing this window, or null (donor). */
  readonly skin: ReadyUiSkin | null;
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
  /** Styled only (null for the donor look). */
  private readonly styled: StyledNodes | null;
  private readonly lifeDeltaText: string | null;

  constructor(options: ResultWindowViewOptions) {
    const look = resultLook(options);
    super(modalOptions(options, look));
    this.skin = look?.skin ?? null;
    this.onNext = options.onNext;
    this.onRetry = options.onRetry ?? null;
    this.onExit = options.onExit ?? null;
    this.lifeDeltaText = options.lifeDelta === undefined ? '-1' : options.lifeDelta;
    const t = this.textures;
    const nextText = localizedText(options.nextLabel, this.i18n, 'core.result.continue', READY_UI_LEGACY_TEXT.result.continue);
    const retryText = localizedText(options.retryLabel, this.i18n, 'core.result.retry', READY_UI_LEGACY_TEXT.result.retry);
    const exitText = localizedText(options.exitLabel, this.i18n, 'core.result.exit', READY_UI_LEGACY_TEXT.result.exit);
    const rewardsText = localizedText(options.rewardsLabel, this.i18n, 'core.result.rewards', READY_UI_LEGACY_TEXT.result.rewards);

    // stars crown the ribbon (hidden unless params.stars > 0). Donor: 2× the first crown, the middle one 20 % larger and
    // raised like Vlad's WIN; all of them clear of the title (its top ≈ −413) and of the ×. All three stand upright (the
    // kit's starGoldL / starGoldR are the level map's tilted side stars). Styled: the style's rest boxes.
    const starSpecs = look
      ? look.layout.win.stars.map((s) => ({ x: fx(look, s.x), y: fy(look, s.y), size: s.size }))
      : [{ x: -272, y: -540, size: 240 }, { x: 0, y: -600, size: 288 }, { x: 272, y: -540, size: 240 }];
    // the stars are the style's own art (`resultStar`), the kit's gold star for the donor look
    const starTexture = look ? look.art.resultStar : t.starGold;
    for (const spec of starSpecs) {
      const star = new Sprite(starTexture);
      star.anchor.set(0.5);
      star.scale.set(spec.size / Math.max(1, starTexture.width));
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

    if (look) {
      const { skin, layout: L, art: A } = look;
      const text: FigmaTextLook = skinTextLook(skin);
      const label = (value: string, fontSize: number): Text => createFigmaLabel(this.theme, value, fontSize, text);
      /** A text box with its own fill / OUTSIDE stroke over the style's look. */
      const boxLabel = (value: string, box: ReadyUiSkinLivesTextBox): Text => createFigmaLabel(this.theme, value, box.fontSize, skinTextBoxLook(text, box));
      const art = (texture: Texture, b: ReadyUiSkinBox): Sprite => {
        const sprite = new Sprite(texture);
        sprite.position.set(fx(look, b.x), fy(look, b.y));
        sprite.width = b.width;
        sprite.height = b.height;
        return sprite;
      };
      /** A styled CTA: the surface (a 9-slice, or fixed art drawn at the box), its runtime label in the style's button-local box. */
      const button = (id: string, texture: Texture, caps: NineSliceSpec | undefined, layout: ReadyUiSkinResultButtonLayout, value: string, onTap: () => void): UiButton => {
        const b = layout.button;
        const view = this.addButton(new UiButton({
          ui: this.ui, id: `${this.id}:${id}`, theme: this.theme, texture,
          ...(caps ? { nineSlice: caps } : {}),
          width: b.width, height: b.height, pressScale: 0.9, onTap
        }));
        view.position.set(fx(look, b.x + b.width / 2), fy(look, b.y + b.height / 2));
        const caption = label(value, layout.label.fontSize);
        caption.eventMode = 'none';
        placeFigmaLabel(caption, { x: layout.label.x - b.width / 2, y: layout.label.y - b.height / 2, width: layout.label.width, height: layout.label.height, align: 'center' });
        view.addChild(caption);
        return view;
      };

      const glowWin = L.win.glow ? art(A.resultGlowWin, L.win.glow) : null;
      const glowFail = L.fail.glow ? art(A.resultGlowFail, L.fail.glow) : null;
      // the glows reach far outside the composition: never part of the fit, the centring or the tap area
      for (const glow of [glowWin, glowFail]) if (glow) glow.measurable = false;
      this.rewardCoin = art(A.rewardCoin, L.win.coin);
      this.rewardAmount = boxLabel('0', L.win.amount);
      this.rewardCaption = label(rewardsText, L.win.rewardsLabel.fontSize);
      placeFigmaLabel(this.rewardCaption, { ...panelBox(look, L.win.rewardsLabel), align: 'center' });
      const lifeLost = art(A.lifeLostArt, L.fail.lifeLost);
      const lifeDelta = boxLabel(this.lifeDeltaText ?? '', L.fail.lifeDelta);
      placeFigmaLabel(lifeDelta, { ...panelBox(look, L.fail.lifeDelta), align: L.fail.lifeDelta.align ?? 'left' });
      const status = label('', L.fail.status.fontSize);

      const primaryCaps = skinNineSlice(skin, 'buttonPrimary', 'result');
      this.nextButton = button('next', A.buttonPrimary, primaryCaps, L.win.next, nextText, () => this.finish('next'));
      this.retryButton = button('retry', A.buttonRewarded, skinNineSlice(skin, 'buttonRewarded', 'result'), L.win.retry, retryText, () => this.finish('retry'));
      const highlight = L.win.retry.highlight;
      if (highlight) {
        const glare = new Sprite(A.buttonHighlight);
        glare.position.set(highlight.x - L.win.retry.button.width / 2, highlight.y - L.win.retry.button.height / 2);
        glare.width = highlight.width;
        glare.height = highlight.height;
        glare.eventMode = 'none';
        this.retryButton.addChildAt(glare, 1); // over the surface, under the label
      }
      this.failRetryButton = button('fail-retry', A.buttonPrimary, primaryCaps, L.fail.retry, retryText, () => this.finish('retry'));
      // EXIT: fixed art drawn at its box, or a 9-slice when the style's asset carries caps
      this.exitButton = button('exit', A.buttonExit, skin.assets[skinAssetKey(skin, 'result', 'buttonExit')]?.nineSlice, L.fail.exit, exitText, () => this.finish('exit'));

      const ribbonWin = art(A.resultRibbonWin, L.win.ribbon);
      const ribbonFail = art(A.resultRibbonFail, L.fail.ribbon);
      this.titleText = label('LEVEL 1', L.win.title.fontSize);
      this.subtitleText = label('COMPLETED!', L.win.subtitle.fontSize);

      // decoration never takes input: taps on it still land inside the panel's hit area (no backdrop close)
      for (const node of [glowWin, glowFail, this.rewardCoin, this.rewardAmount, this.rewardCaption, lifeLost, lifeDelta, status, ribbonWin, ribbonFail, this.titleText, this.subtitleText]) if (node) node.eventMode = 'none';
      // Figma bottom → top: the glow band, the reward / the broken heart, the CTAs, the outcome line, the ribbon; then
      // the crown (as the donor: over the ribbon, under its text), the ribbon text and the × (placeClose)
      for (const glow of [glowWin, glowFail]) if (glow) this.panel.addChild(glow);
      this.panel.addChild(
        this.rewardCoin, this.rewardAmount, this.rewardCaption, lifeLost, lifeDelta,
        this.nextButton, this.retryButton, this.failRetryButton, this.exitButton, status, ribbonWin, ribbonFail,
        this.starsFx, ...this.stars, this.starsFx.front, this.titleText, this.subtitleText
      );
      this.styled = { look, ribbonWin, ribbonFail, glowWin, glowFail, lifeLost, lifeDelta, status };
      if (this.closeButton) {
        this.closeButton.background.texture = A.resultCloseWin;
        this.closeButton.background.width = L.win.close.width;
        this.closeButton.background.height = L.win.close.height;
      }
      const frame = styledWinFrame(look);
      this.frame = new Rectangle(fx(look, frame.x), fy(look, frame.y), frame.width, frame.height);
    } else {
      this.styled = null;
      const ribbon = this.sprite(t.victoryRibbon, 1019, 239);
      ribbon.y = -317;
      this.panel.addChildAt(ribbon, 0);
      this.panel.addChild(this.starsFx, ...this.stars, this.starsFx.front);

      this.titleText = createLabel(this.theme, 'LEVEL 1', { fontSize: 60, stroke: 9 });
      this.titleText.y = -373;
      this.subtitleText = createLabel(this.theme, 'COMPLETED!', { fontSize: 60, stroke: 9 });
      this.subtitleText.y = -304;
      this.panel.addChild(this.titleText, this.subtitleText);

      this.rewardCaption = createLabel(this.theme, rewardsText, { fontSize: 38, stroke: 9 });
      this.rewardCaption.y = -139;
      this.rewardCoin = this.sprite(t.coinBig, 196, 210);
      this.rewardAmount = createLabel(this.theme, '0', { fontSize: 88, stroke: 9 });
      this.rewardAmount.y = 119; // donor 101 overlapped the coin; Trail Arrow's fix moved it 18 lower
      this.panel.addChild(this.rewardCaption, this.rewardCoin, this.rewardAmount);

      this.nextButton = this.createButton('next', t.btnGreen, nextText, () => this.finish('next'));
      this.nextButton.position.set(-230, 310);
      this.retryButton = this.createButton('retry', t.btnYellow, retryText, () => this.finish('retry'));
      this.retryButton.position.set(230, 310);
      // fail: the win's CONTINUE size for the primary, the secondary at 0.85 of it, 26 units apart
      this.failRetryButton = this.createButton('fail-retry', t.btnGreen, retryText, () => this.finish('retry'));
      this.failRetryButton.position.set(0, -48);
      this.exitButton = this.createButton('exit', t.btnYellow, exitText, () => this.finish('exit'), 373, 176, 53, -8);
      this.exitButton.position.set(0, 170);
      this.panel.addChild(this.nextButton, this.retryButton, this.failRetryButton, this.exitButton);
      // the stars are hidden until they pop, so they are counted here, not measured at fit time
      const framed: Container[] = [ribbon, ...this.stars, this.rewardCoin, this.nextButton, this.retryButton];
      if (this.closeButton) framed.push(this.closeButton);
      this.frame = centeredBox(framed);
    }
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
    this.titleText.text = params.title ?? this.i18n?.t('core.result.level', { level: params.level }) ?? READY_UI_LEGACY_TEXT.result.level(params.level);
    const subtitle = localizedText(
      params.subtitle,
      this.i18n,
      fail ? 'core.result.failed' : 'core.result.completed',
      fail ? READY_UI_LEGACY_TEXT.result.failed : READY_UI_LEGACY_TEXT.result.completed
    );
    this.rewardCaption.visible = !fail;
    this.rewardCoin.visible = !fail;
    this.rewardAmount.visible = !fail;
    this.rewardAmount.text = fail ? '' : formatAmount(params.rewardCoins);
    const showRetry = !fail && (params.retry ?? true) && this.onRetry !== null;
    setShown(this.nextButton, !fail);
    setShown(this.retryButton, showRetry);
    setShown(this.failRetryButton, fail);
    setShown(this.exitButton, fail && this.onExit !== null);
    if (this.styled) this.applyStyled(this.styled, fail, subtitle, showRetry);
    else {
      fitLabelWidth(this.titleText, 760);
      this.subtitleText.text = subtitle;
      fitLabelWidth(this.subtitleText, 760);
      this.nextButton.x = showRetry ? -230 : 0;
    }
    this.starsFx.reset();
    // applyParams runs once per show (the controller's onShow): a WIN starts the confetti from t = 0
    if (fail) this.confetti?.cancel();
    else this.confetti?.play();
  }

  /** Styled: the outcome's ribbon, glow, × and text boxes; the fail's outcome line goes under its art (the ribbon has one line). */
  private applyStyled(nodes: StyledNodes, fail: boolean, subtitle: string, showRetry: boolean): void {
    const { look } = nodes;
    const L = look.layout;
    const outcome = fail ? L.fail : L.win;
    placeFigmaLabel(this.titleText, { ...panelBox(look, outcome.title), align: 'center' });
    this.subtitleText.visible = !fail;
    nodes.status.visible = fail;
    if (fail) {
      nodes.status.text = subtitle;
      placeFigmaLabel(nodes.status, { ...panelBox(look, L.fail.status), align: 'center' });
    } else {
      this.subtitleText.text = subtitle;
      placeFigmaLabel(this.subtitleText, { ...panelBox(look, L.win.subtitle), align: 'center' });
      placeFigmaLabel(this.rewardAmount, { ...panelBox(look, L.win.amount), align: 'center' });
    }
    nodes.ribbonWin.visible = !fail;
    nodes.ribbonFail.visible = fail;
    if (nodes.glowWin) nodes.glowWin.visible = !fail;
    if (nodes.glowFail) nodes.glowFail.visible = fail;
    const lifeLost = fail && this.lifeDeltaText !== null;
    nodes.lifeLost.visible = nodes.lifeDelta.visible = lifeLost;
    if (this.closeButton) this.closeButton.background.texture = fail ? look.art.resultCloseFail : look.art.resultCloseWin;
    // CONTINUE alone moves to the frame centre, like the donor's
    const next = L.win.next.button;
    this.nextButton.x = showRetry ? fx(look, next.x + next.width / 2) : 0;
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
    const look = this.styled?.look;
    if (!look) return { x: 445, y: -369 };
    const c = this.params?.outcome === 'fail' ? look.layout.fail.close : look.layout.win.close;
    return { x: fx(look, c.x + c.width / 2), y: fy(look, c.y + c.height / 2) };
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
