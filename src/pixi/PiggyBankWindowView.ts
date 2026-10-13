import { Container, Graphics, type NineSliceSprite, Rectangle, Sprite, type FederatedPointerEvent, type Text, type Texture } from 'pixi.js';
import type { MotionHandle, PiggyBankChange, PiggyBankSnapshot, PiggyBankState, WindowHiddenReason } from '../index';
import { DecorBurst } from './fx/DecorBurst';
import { SparkleView, playSparkleLoop } from './fx/Sparkle';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { createNineSlice } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import {
  resolveWindowSkin,
  selectWindowSkin,
  skinNineSlice,
  skinTextBoxLook,
  skinTextLook,
  type ReadyUiSkin,
  type ReadyUiSkinBox,
  type ReadyUiSkinLivesTextBox,
  type ReadyUiSkinPiggyBankLayout,
  type ReadyUiSkinPiggyCounterLayout,
  type ReadyUiSkinSparkBox,
  type ReadyUiSkinWrappedTextBox,
  type WindowSkinLook
} from './skin';
import { UiButton } from './UiButton';
import { createFigmaLabel, figmaLabelAdvance, placeFigmaLabel, type FigmaTextLook } from './text';

/** What the window reads — a Core `PiggyBankService` satisfies it (types only: the kit imports no runtime). */
export interface PiggyBankSource {
  snapshot(): PiggyBankSnapshot;
  onChange(listener: (change: PiggyBankChange) => void): () => void;
}

export interface PiggyBankWindowParams {
  /** Open on the tutorial screen (a tap anywhere then shows the bank). Default false: the bank. */
  tutorial?: boolean;
}

export interface PiggyBankWindowViewOptions extends Omit<ModalWindowOptions, 'id' | 'fit' | 'closeOnBackdrop'> {
  id?: string;
  /** The bank: the window renders `snapshot()` and follows `onChange` while it is up. */
  bank: PiggyBankSource;
  /** Window copy (each: explicit, else the i18n key `core.piggy.*`, else the English default). */
  titleTop?: string;
  titleBottom?: string;
  buyLabel?: string;
  /** The state copy, two lines per state; `[marked]` text in the first line takes the style's highlight. */
  message?: (state: PiggyBankState, bank: PiggyBankSnapshot) => readonly [string, string];
  /** The tutorial's rule for the purchase threshold; default `core.piggy.tutorial` with `{threshold}`. */
  tutorialText?: (threshold: number) => string;
  tapToContinue?: string;
  /** A product price's label (a platform SKU: the host reads it from the catalog); absent or null: no price row. */
  productPrice?: (productId: string) => string | null;
  /** BUY tapped on a bank that can be bought: runs after the window closed, with the snapshot it showed. */
  onBuy: (bank: PiggyBankSnapshot) => void;
}

/** The sparkles flashing in turn: the bank's (the title's two, the pig's) and the tutorial's. */
export const PIGGY_BANK_SPARKS_LOOP = Object.freeze({ loopMs: 3600, gapMs: 700, delayMs: 400, tutorialLoopMs: 4800, tutorialGapMs: 420 });

type PiggyLook = WindowSkinLook<'piggyBank'>;
type Mode = 'bank' | 'tutorial';

/** A one-line text whose `[marked]` part has its own fill: up to three labels in a row, centred on the box (shrinking to its width). */
class MarkedLine extends Container {
  private readonly parts: Text[];

  constructor(owner: { theme: PiggyBankWindowView['theme'] }, private readonly box: ReadyUiSkinLivesTextBox, look: FigmaTextLook, highlight: number | null) {
    super();
    this.eventMode = 'none';
    const plain = skinTextBoxLook(look, box);
    const marked = highlight === null ? plain : { ...plain, fill: highlight };
    this.parts = [plain, marked, plain].map((partLook) => createFigmaLabel(owner.theme, '', box.fontSize, partLook));
    this.addChild(...this.parts);
  }

  set(value: string): void {
    const open = value.indexOf('[');
    const close = open < 0 ? -1 : value.indexOf(']', open + 1);
    const pieces = close < 0 ? [value.replace(/[[\]]/g, ''), '', ''] : [value.slice(0, open), value.slice(open + 1, close), value.slice(close + 1)];
    let x = 0;
    this.parts.forEach((part, i) => {
      part.text = pieces[i] ?? '';
      part.visible = part.text !== '';
      if (!part.visible) return;
      const advance = figmaLabelAdvance(part);
      placeFigmaLabel(part, { x, y: 0, width: advance, height: this.box.height, align: 'left' });
      x += advance;
    });
    const k = x > this.box.width ? this.box.width / x : 1;
    this.scale.set(k);
    this.pivot.set(x / 2, this.box.height / 2);
    this.position.set(this.box.x + this.box.width / 2, this.box.y + this.box.height / 2);
  }
}

/**
 * The piggy bank window (theme_light_11 `screen_pig_bank` + `screen_pig_bank_learning`): one modal, two screens. No
 * bank logic inside: it renders the bank's snapshot (the balance in the bubble, the fill bar with the purchase threshold
 * and the capacity, the state copy, BUY with the level's price) and follows its changes while it is up; BUY on a bank
 * that can be bought is a close() continuation (`onBuy`), × / the backdrop only dismiss. The info button shows the
 * tutorial; on the tutorial a tap anywhere (the window or the backdrop) returns to the bank.
 *
 * Styled only (a Ready UI style that covers `piggyBank`, `theme.skin`): Core has no donor piggy bank. BUY below the
 * threshold (or not for sale, or a bank that cannot write) is the style's grey button, inert. The decor runs on the
 * MotionRuntime while the window is up: the rays turn and the stars twinkle (a style with `burst`), the sparkles flash
 * in turn; everything stops on hidden.
 */
export class PiggyBankWindowView extends ModalWindow<PiggyBankWindowParams | void> {
  /** The Ready UI style drawing this window. */
  readonly skin: ReadyUiSkin;
  private readonly layout: ReadyUiSkinPiggyBankLayout;
  private readonly art: PiggyLook['art'];
  private readonly look: FigmaTextLook;
  private readonly options: PiggyBankWindowViewOptions;
  private readonly bankScreen = new Container();
  private readonly tutorialScreen = new Container();
  private readonly infoButton: UiButton;
  private readonly buyButton: UiButton;
  private readonly buyOff: Sprite;
  private readonly buyLabel: Text;
  private readonly priceRow = new Container();
  private readonly priceText: Text;
  private readonly priceCoin: Sprite;
  private readonly bubbleAmount: Text;
  private readonly bubbleCoin: Sprite;
  private readonly fill: NineSliceSprite;
  private readonly marker: Sprite;
  private readonly threshold: { coin: Sprite; amount: Text };
  private readonly capacity: { coin: Sprite; amount: Text };
  private readonly message: [MarkedLine, MarkedLine];
  private readonly tutorialBody: Text;
  private readonly tutorialTap: Text;
  private readonly burst: DecorBurst | null;
  private readonly sparks: SparkleView[];
  private readonly tutorialSparks: SparkleView[];
  private readonly labels: { buy: string; tap: string };
  private mode: Mode = 'bank';
  private current: PiggyBankSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private sparksLoop: MotionHandle | null = null;

  constructor(options: PiggyBankWindowViewOptions) {
    const skin = selectWindowSkin('piggyBank', undefined, options.theme?.skin);
    if (!skin) throw new Error("PiggyBankWindowView: needs a Ready UI style that covers 'piggyBank' (theme: { skin })");
    const look = resolveWindowSkin('PiggyBankWindowView', 'piggyBank', skin, options.textures, { variant: false, include: '' });
    const L = look.layout;
    super({
      ...options,
      id: options.id ?? 'piggy-bank',
      closeOnBackdrop: false,
      backdropColor: options.backdropColor ?? skin.backdrop.color,
      backdropAlpha: options.backdropAlpha ?? skin.backdrop.alpha,
      // the frame fit: the window's share of the style frame (1080 × 2344), like every styled window
      fit: { widthRatio: L.window.width / skin.frame.width, heightRatio: L.window.height / skin.frame.height }
    });
    this.skin = skin;
    this.layout = L;
    this.art = look.art;
    this.look = skinTextLook(skin);
    this.options = options;
    const A = look.art;
    const legacy = READY_UI_LEGACY_TEXT.piggy;
    this.labels = {
      buy: localizedText(options.buyLabel, this.i18n, 'core.piggy.buy', legacy.buy),
      tap: localizedText(options.tapToContinue, this.i18n, 'core.piggy.tap_to_continue', legacy.tapToContinue)
    };

    // window-local coordinates (x / y from the window box's top-left): the panel origin is the window centre
    const root = new Container();
    root.position.set(-L.window.width / 2, -L.window.height / 2);
    const surface = createNineSlice(A.piggyPanel, skinNineSlice(skin, 'piggyPanel', 'piggyBank'), L.window.width, L.window.height);
    surface.position.set(L.window.width / 2, L.window.height / 2);
    surface.eventMode = 'none';
    const windowBox = { x: 0, y: 0, width: L.window.width, height: L.window.height };

    // --- the bank ---
    this.burst = L.burst
      ? new DecorBurst({ motion: this.motion, scope: `${this.id}:decor`, rays: A.piggyDecor, box: L.decor, burst: L.burst, stars: (A.piggyStars as Texture | undefined) ?? null, look: 'lively', clip: windowBox })
      : null;
    const decor = this.burst ?? boxSprite(A.piggyDecor, L.decor);
    decor.measurable = false;
    const hero = boxSprite(A.piggyArt, L.hero);
    const titleTop = localizedText(options.titleTop, this.i18n, 'core.piggy.title_1', legacy.title1);
    const titleBottom = localizedText(options.titleBottom, this.i18n, 'core.piggy.title_2', legacy.title2);
    const titleArtTexture = A.piggyTitle as Texture | undefined;
    const title: Container[] = L.titleArt && titleArtTexture && titleTop === L.titleArt.lines[0] && titleBottom === L.titleArt.lines[1]
      ? [boxSprite(titleArtTexture, L.titleArt.box)]
      : [this.textLabel(titleTop, L.title[0]), this.textLabel(titleBottom, L.title[1])];
    this.sparks = this.sparkViews(L.sparks);

    const bubble = boxSprite(A.piggyBubble, L.bubble.box);
    this.bubbleAmount = createFigmaLabel(this.theme, '', L.bubble.amount.fontSize, skinTextBoxLook(this.look, { x: 0, y: 0, width: 0, height: 0, ...L.bubble.amount }));
    this.bubbleAmount.eventMode = 'none';
    this.bubbleCoin = boxSprite(A.priceIcon, { x: 0, y: L.bubble.coin.y, width: L.bubble.coin.width, height: L.bubble.coin.height });

    const B = L.bar;
    const barBack = boxSprite(A.piggyBarBack, B.back);
    this.fill = createNineSlice(A.piggyBarFill, skinNineSlice(skin, 'piggyBarFill', 'piggyBank'), B.fill.width, B.fill.height);
    this.fill.eventMode = 'none';
    const barFrame = B.frame ? boxSprite(A.piggyBarFrame, B.frame) : null;
    this.marker = boxSprite(A.piggyBarMarker, { x: 0, y: B.marker.y, width: B.marker.width, height: B.marker.height });
    const barCoin = boxSprite(A.piggyCoin, B.coin);
    this.threshold = this.counter(B.threshold);
    this.capacity = this.counter(B.capacity);
    this.message = [
      new MarkedLine(this, L.message[0], this.look, L.message[0].highlight),
      new MarkedLine(this, L.message[1], this.look, null)
    ];

    this.infoButton = this.addButton(new UiButton({
      ui: this.ui,
      id: `${this.id}:info`,
      theme: this.theme,
      texture: A.piggyInfo,
      width: L.info.width,
      height: L.info.height,
      pressScale: 0.9,
      onTap: () => this.setMode('tutorial')
    }));
    this.infoButton.position.set(L.info.x + L.info.width / 2, L.info.y + L.info.height / 2);

    this.buyButton = this.addButton(new UiButton({
      ui: this.ui,
      id: `${this.id}:buy`,
      theme: this.theme,
      texture: A.buttonPrimary,
      nineSlice: skinNineSlice(skin, 'buttonPrimary', 'piggyBank'),
      width: L.button.width,
      height: L.button.height,
      pressScale: 0.9,
      onTap: () => this.buy()
    }));
    this.buyButton.position.set(L.button.x + L.button.width / 2, L.button.y + L.button.height / 2);
    // the inert look: the style's grey button art at the box (never the dimmed green)
    this.buyOff = new Sprite(A.piggyButtonOff);
    this.buyOff.anchor.set(0.5);
    this.buyOff.width = L.button.width;
    this.buyOff.height = L.button.height;
    this.buyOff.eventMode = 'none';
    this.buyOff.visible = false;
    this.buyButton.addChildAt(this.buyOff, 1);
    this.buyLabel = createFigmaLabel(this.theme, '', L.buttonLabel.fontSize, skinTextBoxLook(this.look, L.buttonLabel));
    this.buyLabel.eventMode = 'none';
    const priceLook = skinTextBoxLook(this.look, { x: 0, y: 0, width: 0, height: 0, fontSize: L.price.fontSize, ...(L.price.fill !== undefined ? { fill: L.price.fill } : {}), ...(L.price.stroke ? { stroke: L.price.stroke } : {}) });
    this.priceText = createFigmaLabel(this.theme, '', L.price.fontSize, priceLook);
    this.priceText.eventMode = 'none';
    this.priceCoin = new Sprite(A.priceIcon);
    this.priceCoin.width = L.priceCoin.width;
    this.priceCoin.height = L.priceCoin.height;
    this.priceCoin.eventMode = 'none';
    this.priceRow.eventMode = 'none';
    this.priceRow.addChild(this.priceText, this.priceCoin);
    this.buyButton.addChild(this.buyLabel, this.priceRow);

    if (this.closeButton) {
      this.closeButton.background.texture = A.piggyClose;
      this.closeButton.background.width = L.close.width;
      this.closeButton.background.height = L.close.height;
    }

    // Figma bottom → top: the rays, the pig, the title, the sparkles, the bubble, the bar (back, fill, frame, ticks, the
    // coin, the counters), the copy, BUY; the info button; the × on top (placeClose)
    this.bankScreen.addChild(decor, hero, ...title, ...this.sparks, bubble, this.bubbleAmount, this.bubbleCoin, barBack, this.fill);
    if (barFrame) this.bankScreen.addChild(barFrame);
    this.bankScreen.addChild(this.marker, barCoin, this.threshold.coin, this.threshold.amount, this.capacity.coin, this.capacity.amount, ...this.message, this.buyButton, this.infoButton);

    // --- the tutorial ---
    const T = L.tutorial;
    const pictures = new Container();
    pictures.eventMode = 'none';
    if (T.decor) {
      // still: the tutorial's rays are Figma's picture, squeezed with its frame (never turned)
      const still = new DecorBurst({ motion: this.motion, scope: `${this.id}:tutorial`, rays: A.piggyDecor, box: T.decor, burst: T.decor.burst, stars: (A.piggyStars as Texture | undefined) ?? null, look: 'lively' });
      pictures.addChild(still);
    }
    const tutorialHero = boxSprite(T.hero.ownArt ? A.piggyTutorialArt : A.piggyArt, T.hero);
    pictures.addChild(boxSprite(A.piggyHand, T.hand), ...T.arrows.map((arrow) => boxSprite(A.piggyArrow, arrow)), boxSprite(A.piggyCoins, T.coins), tutorialHero);
    if (T.clip) {
      const clip = new Graphics().rect(T.clip.x, T.clip.y, T.clip.width, T.clip.height).fill(0xffffff);
      pictures.addChild(clip);
      pictures.mask = clip;
    }
    this.tutorialSparks = this.sparkViews(T.sparks);
    this.tutorialBody = this.wrapped(T.body);
    this.tutorialTap = this.wrapped(T.tap);
    // a tap anywhere on the window returns to the bank
    const catcher = new Container();
    catcher.hitArea = new Rectangle(0, 0, L.window.width, L.window.height);
    catcher.eventMode = 'static';
    catcher.cursor = 'pointer';
    catcher.on('pointertap', () => this.setMode('bank'));
    this.tutorialScreen.addChild(pictures, ...this.tutorialSparks, this.tutorialBody, this.tutorialTap, catcher);
    this.tutorialScreen.visible = false;

    root.addChild(surface, this.bankScreen, this.tutorialScreen);
    this.panel.addChild(root);
    this.backdrop.on('pointertap', this.onBackdrop, this);
    this.placeClose();
  }

  /** The screen on show: the bank or the tutorial. */
  get screen(): Mode {
    return this.mode;
  }

  /** The window's buttons (BUY, the tutorial's info, the ×). */
  get controls(): { buy: UiButton; info: UiButton; close: UiButton | null } {
    return { buy: this.buyButton, info: this.infoButton, close: this.closeButton };
  }

  protected applyParams(params: PiggyBankWindowParams | void): void {
    this.unsubscribe?.();
    this.unsubscribe = this.options.bank.onChange(() => this.render());
    this.render();
    this.setMode(params && params.tutorial ? 'tutorial' : 'bank', true);
  }

  protected override onHiddenView(_reason: WindowHiddenReason): void {
    this.stopDecor();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.stopDecor();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.backdrop.off('pointertap', this.onBackdrop, this);
    super.destroy(options);
  }

  /** The window box (the fit, the backdrop test and the hit area — not the rays); measured while the base constructor lays out. */
  protected override panelBounds(): Rectangle {
    const L = this.layout as ReadyUiSkinPiggyBankLayout | undefined;
    if (!L) return super.panelBounds();
    return new Rectangle(-L.window.width / 2, -L.window.height / 2, L.window.width, L.window.height);
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    const L = this.layout as ReadyUiSkinPiggyBankLayout | undefined;
    if (!L) return super.closeButtonPosition();
    return { x: L.close.x + L.close.width / 2 - L.window.width / 2, y: L.close.y + L.close.height / 2 - L.window.height / 2 };
  }

  private setMode(mode: Mode, force = false): void {
    if (this.mode === mode && !force) return;
    this.mode = mode;
    const tutorial = mode === 'tutorial';
    this.bankScreen.visible = !tutorial;
    this.tutorialScreen.visible = tutorial;
    if (this.closeButton) this.closeButton.visible = !tutorial;
    if (this.state === 'hidden') return;
    this.startDecor();
  }

  /** The decor of the screen on show runs while the window is up (from the show to hidden). */
  private startDecor(): void {
    this.stopDecor();
    const P = PIGGY_BANK_SPARKS_LOOP;
    const tutorial = this.mode === 'tutorial';
    if (!tutorial) this.burst?.play();
    const sparks = tutorial ? this.tutorialSparks : this.sparks;
    if (!sparks.length) return;
    const gap = tutorial ? P.tutorialGapMs : P.gapMs;
    this.sparksLoop = playSparkleLoop(this.motion, sparks, {
      loopMs: tutorial ? P.tutorialLoopMs : P.loopMs,
      delayMs: P.delayMs,
      flashes: sparks.map((_, i) => ({ sparkle: i, atMs: i * gap })),
      scope: `${this.id}:decor`
    });
  }

  private stopDecor(): void {
    this.burst?.stop();
    const loop = this.sparksLoop;
    this.sparksLoop = null;
    loop?.cancel();
  }

  private onBackdrop(event: FederatedPointerEvent): void {
    if (event.target !== this.backdrop || this.state !== 'shown') return;
    if (this.mode === 'tutorial') this.setMode('bank');
    else this.close('background');
  }

  /** BUY is for sale and the bank can be bought now (the threshold reached, a price, a writable bank). */
  private canBuy(bank: PiggyBankSnapshot | null): boolean {
    return !!bank && bank.writable && bank.canBuy && bank.price !== null;
  }

  private buy(): void {
    const bank = this.current;
    if (!bank || !this.canBuy(bank) || this.mode !== 'bank') return;
    this.close('button', () => this.options.onBuy(bank));
  }

  private render(): void {
    const bank = this.options.bank.snapshot();
    this.current = bank;
    const L = this.layout;
    const balance = bank.balance ?? 0;
    const capacity = bank.capacity ?? 0;
    const threshold = bank.threshold ?? 0;

    // the bubble: the balance and the coin, one row centred on the bubble
    const Bu = L.bubble;
    setText(this.bubbleAmount, String(balance));
    const advance = figmaLabelAdvance(this.bubbleAmount);
    const left = Bu.centerX - (advance + Bu.gap + Bu.coin.width) / 2;
    placeFigmaLabel(this.bubbleAmount, { x: left, y: Bu.y, width: advance, height: Bu.height, align: 'left' });
    this.bubbleCoin.x = left + advance + Bu.gap;

    // the bar: the fill resized to the bank's share (nothing at 0, never narrower than its ends), the tick on the threshold
    const F = L.bar.fill;
    const share = capacity > 0 ? Math.min(1, balance / capacity) : 0;
    this.fill.visible = share > 0;
    if (share > 0) {
      const width = share >= 1 ? F.width : Math.min(F.width, Math.max(F.fillMin, F.width * share));
      this.fill.width = width;
      this.fill.position.set(F.x + width / 2, F.y + F.height / 2);
    }
    const tickX = F.x + F.width * (capacity > 0 ? Math.min(1, threshold / capacity) : 0.5);
    this.marker.x = tickX - L.bar.marker.width / 2;
    this.placeCounter(this.threshold, L.bar.threshold, threshold, tickX);
    this.placeCounter(this.capacity, L.bar.capacity, capacity, null);

    // the copy of the bank's state
    const state: PiggyBankState = bank.state ?? 'empty';
    const [first, second] = this.options.message?.(state, bank) ?? this.stateCopy(state);
    this.message[0].set(first);
    this.message[1].set(second);

    // BUY: the green button with the label over the price, or the grey one (inert)
    const enabled = this.canBuy(bank);
    this.buyButton.setEnabled(enabled);
    this.buyButton.alpha = 1;
    this.buyButton.background.visible = enabled;
    this.buyOff.visible = !enabled;
    const price = bank.price;
    const priceLabel = price === null ? null : price.kind === 'wallet' ? String(price.amount) : this.options.productPrice?.(price.productId) ?? null;
    const coin = price?.kind === 'wallet';
    const B = L.button;
    const dx = -B.width / 2;
    const dy = -B.height / 2;
    setText(this.buyLabel, this.labels.buy);
    if (priceLabel === null) {
      // no price row: the label alone, centred on the button's face (its label and price boxes together)
      const top = L.buttonLabel.y;
      const bottom = L.price.y + L.price.height;
      placeFigmaLabel(this.buyLabel, { x: L.buttonLabel.x + dx, y: dy + (top + bottom) / 2 - L.buttonLabel.height / 2, width: L.buttonLabel.width, height: L.buttonLabel.height, align: 'center' });
      this.priceRow.visible = false;
    } else {
      placeFigmaLabel(this.buyLabel, { x: L.buttonLabel.x + dx, y: L.buttonLabel.y + dy, width: L.buttonLabel.width, height: L.buttonLabel.height, align: 'center' });
      this.priceRow.visible = true;
      setText(this.priceText, priceLabel);
      this.priceCoin.visible = coin;
      const textWidth = figmaLabelAdvance(this.priceText);
      const width = textWidth + (coin ? L.price.gap + L.priceCoin.width : 0);
      placeFigmaLabel(this.priceText, { x: 0, y: L.price.y, width: textWidth, height: L.price.height, align: 'left' });
      this.priceCoin.position.set(textWidth + L.price.gap, L.priceCoin.y);
      // wider than the button's inner width (84 %), the whole row shrinks around its centre
      const k = Math.min(1, (B.width * 0.84) / Math.max(1, width));
      const rowTop = Math.min(L.price.y, L.priceCoin.y);
      const rowHeight = Math.max(L.price.y + L.price.height, L.priceCoin.y + L.priceCoin.height) - rowTop;
      this.priceRow.pivot.set(width / 2, rowTop + rowHeight / 2);
      this.priceRow.scale.set(k);
      this.priceRow.position.set(0, rowTop + rowHeight / 2 + dy);
    }

    // the tutorial's rule names this level's threshold
    const T = L.tutorial;
    const rule = this.options.tutorialText?.(threshold) ?? this.i18n?.t('core.piggy.tutorial', { threshold }) ?? READY_UI_LEGACY_TEXT.piggy.tutorial.replace('{threshold}', String(threshold));
    placeWrapped(this.tutorialBody, rule, T.body);
    placeWrapped(this.tutorialTap, this.labels.tap, T.tap);
  }

  private stateCopy(state: PiggyBankState): readonly [string, string] {
    const legacy = READY_UI_LEGACY_TEXT.piggy[state];
    return [
      localizedText(undefined, this.i18n, `core.piggy.${state}_1`, legacy[0]),
      localizedText(undefined, this.i18n, `core.piggy.${state}_2`, legacy[1])
    ];
  }

  private placeCounter(counter: { coin: Sprite; amount: Text }, layout: ReadyUiSkinPiggyCounterLayout, value: number, centerX: number | null): void {
    const coin = layout.coin;
    const amount = layout.amount;
    const cx = centerX ?? coin.x + coin.width / 2;
    counter.coin.position.set(cx - coin.width / 2, coin.y);
    const ax = centerX === null ? amount.x : cx - amount.width / 2;
    setText(counter.amount, String(value));
    placeFigmaLabel(counter.amount, { x: ax, y: amount.y, width: amount.width, height: amount.height, align: amount.align ?? 'center' });
  }

  private counter(layout: ReadyUiSkinPiggyCounterLayout): { coin: Sprite; amount: Text } {
    const coin = boxSprite(this.art.piggyCoin, layout.coin);
    const amount = createFigmaLabel(this.theme, '', layout.amount.fontSize, skinTextBoxLook(this.look, layout.amount));
    amount.eventMode = 'none';
    return { coin, amount };
  }

  private textLabel(value: string, box: ReadyUiSkinLivesTextBox): Text {
    const node = createFigmaLabel(this.theme, value, box.fontSize, skinTextBoxLook(this.look, box));
    placeFigmaLabel(node, { x: box.x, y: box.y, width: box.width, height: box.height, align: box.align ?? 'center' });
    node.eventMode = 'none';
    return node;
  }

  private wrapped(box: ReadyUiSkinWrappedTextBox): Text {
    const node = createFigmaLabel(this.theme, '', box.fontSize, skinTextBoxLook(this.look, box));
    node.eventMode = 'none';
    if (box.lineHeight !== undefined) node.style.lineHeight = box.lineHeight;
    return node;
  }

  private sparkViews(sparks: readonly ReadyUiSkinSparkBox[]): SparkleView[] {
    const texture = this.art.piggySpark as Texture | undefined;
    if (!texture) return [];
    return sparks.map((spark) => {
      const view = new SparkleView({
        texture,
        width: spark.size,
        height: spark.height ?? spark.size,
        rotation: (-(spark.rotation ?? 0) * Math.PI) / 180,
        glow: this.textures.fxGlowSoft ?? null
      });
      view.position.set(spark.x, spark.y);
      return view;
    });
  }
}

/** A sprite over a render box (decoration: no input). */
function boxSprite(texture: Texture, box: ReadyUiSkinBox): Sprite {
  const sprite = new Sprite(texture);
  sprite.position.set(box.x, box.y);
  sprite.width = box.width;
  sprite.height = box.height;
  sprite.eventMode = 'none';
  return sprite;
}

function setText(label: Text, value: string): void {
  if (label.text !== value) label.text = value;
}

/** A centred text block wrapping at the box width (Figma fixed width, AUTO height); a taller block shrinks into the box. */
function placeWrapped(label: Text, value: string, box: ReadyUiSkinWrappedTextBox): void {
  setText(label, value);
  label.scale.set(1);
  label.style.wordWrap = true;
  label.style.wordWrapWidth = box.width;
  label.style.align = 'center';
  label.anchor.set(0.5);
  const k = label.height > box.height && label.height > 0 ? box.height / label.height : 1;
  label.scale.set(k);
  label.position.set(box.x + box.width / 2, box.y + box.height / 2);
}
