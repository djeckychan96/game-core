import { type NineSliceSprite, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import type { ReadyUiOptionalTextureName } from './assets';
import { createNineSlice } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import { resolveWindowSkin, selectWindowSkin, skinNineSlice, skinTextLook, type ReadyUiSkin, type ReadyUiSkinBox, type ReadyUiSkinConfirmLayout, type WindowSkinLook } from './skin';
import { createFigmaLabel, createLabel, fitLabelWidth, placeFigmaLabel, type FigmaTextLook } from './text';
import { UiButton } from './UiButton';

/**
 * The pre-style kit names of Style 1's Confirm art: a host on the `variant: 'figma'` path requests them with
 * `loadReadyUiAssets({ include: CONFIRM_EXIT_FIGMA_TEXTURES })`; a host with a style loads `{ skin }` instead.
 */
export const CONFIRM_EXIT_FIGMA_TEXTURES = ['windowBase', 'windowClose', 'messageGlow', 'brokenHeart', 'buttonGreen'] as const satisfies readonly ReadyUiOptionalTextureName[];

/** `'donor'`: the Trail Arrow ConfirmWindow art (required pack). `'figma'`: drawn by a Ready UI style (Style 1 = the Figma confirm-exit). */
export type ConfirmWindowVariant = 'donor' | 'figma';

/**
 * What the one action does — it only picks the button's default copy (`core.confirm.exit` / `core.confirm.restart`);
 * the host runs the action itself in `onConfirm`. Both use the same window and layout.
 */
export type ConfirmWindowAction = 'exit' | 'restart';

const ACTION_LABEL = {
  exit: { key: 'core.confirm.exit', legacy: READY_UI_LEGACY_TEXT.confirm.exit },
  restart: { key: 'core.confirm.restart', legacy: READY_UI_LEGACY_TEXT.confirm.restart }
} as const satisfies Record<ConfirmWindowAction, { key: string; legacy: string }>;

export interface ConfirmWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /**
   * Per-window override of the theme's style. Omitted: `theme.skin` when it covers `confirm`, else the donor art
   * (unchanged). `'donor'`: the donor art whatever the theme says. `'figma'`: the theme's style when it covers
   * `confirm`, else Style 1 (its textures from `{ skin }` or `include: CONFIRM_EXIT_FIGMA_TEXTURES`).
   */
  variant?: ConfirmWindowVariant;
  /** Default `ARE YOU SURE?` (donor `ui.confirm.header`, Figma slot/title). */
  title?: string;
  /** Default `You will lose 1 heart` (donor `ui.confirm.body`) / `YOU WILL LOSE 1 HEART` (Figma slot/body). */
  body?: string;
  /** The action the button stands for (its default copy). Default `'exit'`. */
  action?: ConfirmWindowAction;
  /** Default by `action`: `EXIT` (donor `ui.confirm.exit`, Figma slot/label) / `RESTART`. */
  confirmLabel?: string;
  /** Styled only: default `-1` (slot/life-delta), runtime text over the life-lost art (the donor art bakes it in). */
  lifeDelta?: string;
  /**
   * Styled only: draw the style's illustration — the life-lost art, its `lifeDelta` and the glow behind them. Default
   * true. `false` = a window without one (e.g. a restart that loses level progress, not a life): the band the art took
   * closes up — the body and the button move into it and the window is that much shorter. The donor art bakes its
   * broken heart in, so the donor look ignores it.
   */
  illustration?: boolean;
  /** The one action button, a close continuation. Cancel = the × or the backdrop → `onDismiss`. */
  onConfirm: () => void;
}

type ConfirmLook = WindowSkinLook<'confirm'>;

/** The style drawing this window (null = donor) with its layout and art; a missing piece fails here, before anything registers. */
function confirmLook(options: ConfirmWindowViewOptions): ConfirmLook | null {
  const skin = selectWindowSkin('confirm', options.variant, options.theme?.skin);
  if (!skin) return null;
  const look = resolveWindowSkin('ConfirmWindowView', 'confirm', skin, options.textures, { variant: options.variant === 'figma', include: 'CONFIRM_EXIT_FIGMA_TEXTURES' });
  return options.illustration === false ? { ...look, layout: withoutIllustration(look.layout) } : look;
}

/**
 * The style's layout without its illustration: the band from the art's top down to the next content box below it
 * closes up — that box and everything under it move up, and the window loses the same height. Title and × stay.
 */
function withoutIllustration(layout: ReadyUiSkinConfirmLayout): ReadyUiSkinConfirmLayout {
  const top = layout.heart.y;
  const below = [layout.body, layout.button].filter((box) => box.y > top);
  if (below.length === 0) return layout;
  const next = Math.min(...below.map((box) => box.y));
  const lift = next - top;
  const up = <B extends ReadyUiSkinBox>(box: B): B => (box.y >= next ? { ...box, y: box.y - lift } : box);
  return { ...layout, window: { ...layout.window, height: layout.window.height - lift }, body: up(layout.body), button: up(layout.button) };
}

/** Window-local style x / y → panel units (the panel origin is the window box centre). */
const px = (layout: ReadyUiSkinConfirmLayout, x: number): number => x - layout.window.width / 2;
const py = (layout: ReadyUiSkinConfirmLayout, y: number): number => y - layout.window.height / 2;

/** ModalWindow options: the donor's, or the style's dim and its window's share of the style frame. */
function modalOptions(options: ConfirmWindowViewOptions, look: ConfirmLook | null): ModalWindowOptions {
  const id = options.id ?? 'confirm-window';
  if (!look) {
    // donor WindowsSystem: ConfirmWindow mobile widthRatio 0.92 over the portrait default heightRatio 0.72
    return { ...options, id, fit: { widthRatio: 0.92, heightRatio: 0.72, ...(options.fit ?? {}) } };
  }
  const { skin, layout } = look;
  return {
    ...options,
    id,
    backdropColor: options.backdropColor ?? skin.backdrop.color,
    backdropAlpha: options.backdropAlpha ?? skin.backdrop.alpha,
    // the frame fit: the window's share of the style frame (1080 × 2344), like the kit's design contain-fit
    fit: { widthRatio: layout.window.width / skin.frame.width, heightRatio: layout.window.height / skin.frame.height, ...(options.fit ?? {}) }
  };
}

/**
 * "Are you sure? You will lose 1 heart", in two variants; one window for every action that costs a life (`action`:
 * exit or restart — only the default button copy differs, the host routes `onConfirm`).
 *
 * `'donor'` (default): the donor's ConfirmWindow (Trail Arrow `Confirm` prefab) 1:1 — the 968 × 1006 `confirmPanel`
 * art with the broken heart and its "-1" baked in, header at (6, −417), body at (16, 157), one 600 × 206 button at
 * y 334, × at (418, −413).
 *
 * `'figma'` (a Ready UI style, `theme.skin` or the variant; Style 1 = the Figma confirm-exit window 1:1): the window
 * shell and the button surface are the style's 9-slices (its caps); title, body, the "-1" and the button label are
 * runtime text laid out in the style's boxes; the close glyph, the glow and the life-lost art are separate sprites, in
 * the Figma order (the glow sits above the shell, its title and the ×). The window keeps its share of the style frame.
 * `illustration: false` leaves the art, its "-1" and the glow out and closes their band up (a shorter window).
 *
 * Both: the × and a backdrop tap cancel (`onDismiss`); the button runs `onConfirm`.
 */
export class ConfirmWindowView extends ModalWindow {
  readonly variant: ConfirmWindowVariant;
  readonly action: ConfirmWindowAction;
  /** The Ready UI style drawing this window, or null (donor). */
  readonly skin: ReadyUiSkin | null;
  private readonly layout: ReadyUiSkinConfirmLayout | null;
  private readonly title: Text;
  private readonly body: Text;
  private readonly confirmButton: UiButton;
  private readonly onConfirm: () => void;
  // 'figma' only (null for 'donor'; glow / heart / lifeDelta also null with `illustration: false`)
  private readonly surface: NineSliceSprite | null;
  private readonly glow: Sprite | null;
  private readonly heart: Sprite | null;
  private readonly lifeDelta: Text | null;
  private readonly confirmLabel: Text | null;

  constructor(options: ConfirmWindowViewOptions) {
    const look = confirmLook(options);
    super(modalOptions(options, look));
    this.variant = look ? 'figma' : 'donor';
    this.skin = look?.skin ?? null;
    this.layout = look?.layout ?? null;
    this.action = options.action ?? 'exit';
    this.onConfirm = options.onConfirm;
    const actionLabel = ACTION_LABEL[this.action];
    const confirmText = localizedText(options.confirmLabel, this.i18n, actionLabel.key, actionLabel.legacy);
    const onTap = (): void => { this.close('button', () => this.onConfirm()); };

    if (!look) {
      const t = this.textures;
      this.panel.addChildAt(this.sprite(t.confirmPanel, 968, 1006), 0);
      this.title = createLabel(this.theme, localizedText(options.title, this.i18n, 'core.confirm.title', READY_UI_LEGACY_TEXT.confirm.title), { fontSize: 74, stroke: 10 });
      this.title.position.set(6, -417);
      fitLabelWidth(this.title, 760);
      this.body = createLabel(this.theme, localizedText(options.body, this.i18n, 'core.confirm.lose_life', READY_UI_LEGACY_TEXT.confirm.donorBody), { fontSize: 74, stroke: 10 });
      this.body.position.set(16, 157);
      fitLabelWidth(this.body, 880);
      this.panel.addChild(this.title, this.body);

      this.confirmButton = this.createButton('confirm', t.confirmButton, confirmText, onTap, 600, 206, 82, -9);
      if (this.confirmButton.labelText) fitLabelWidth(this.confirmButton.labelText, 520);
      this.confirmButton.y = 334;
      this.panel.addChild(this.confirmButton);
      this.surface = this.glow = this.heart = null;
      this.lifeDelta = this.confirmLabel = null;
      this.placeClose();
      return;
    }

    const { skin, layout: L, art: A } = look;
    // the window's own text look (the kit font) or the style's
    const text: FigmaTextLook = L.text ? { ...L.text } : skinTextLook(skin);
    this.surface = createNineSlice(A.windowSurface, skinNineSlice(skin, 'windowSurface', 'confirm'), L.window.width, L.window.height);
    this.title = createFigmaLabel(this.theme, localizedText(options.title, this.i18n, 'core.confirm.title', READY_UI_LEGACY_TEXT.confirm.title), L.title.fontSize, text);
    placeFigmaLabel(this.title, { ...this.box(L.title), align: 'center' });
    if (this.closeButton) {
      this.closeButton.background.texture = A.windowClose;
      this.closeButton.background.width = L.close.width;
      this.closeButton.background.height = L.close.height;
    }
    const illustration = options.illustration ?? true;
    this.glow = illustration ? this.art(A.heroGlow, L.glow) : null;

    this.confirmButton = this.addButton(new UiButton({
      ui: this.ui,
      id: `${this.id}:confirm`,
      theme: this.theme,
      texture: A.buttonPrimary,
      nineSlice: skinNineSlice(skin, 'buttonPrimary', 'confirm'),
      width: L.button.width,
      height: L.button.height,
      pressScale: 0.9,
      onTap
    }));
    this.confirmButton.position.set(px(L, L.button.x + L.button.width / 2), py(L, L.button.y + L.button.height / 2));
    this.confirmLabel = createFigmaLabel(this.theme, confirmText, L.buttonLabel.fontSize, text);
    const label = L.buttonLabel;
    placeFigmaLabel(this.confirmLabel, { x: label.x - L.button.width / 2, y: label.y - L.button.height / 2, width: label.width, height: label.height, align: 'center' });
    this.confirmButton.addChild(this.confirmLabel);

    this.body = createFigmaLabel(this.theme, localizedText(options.body, this.i18n, 'core.confirm.lose_life', READY_UI_LEGACY_TEXT.confirm.styledBody), L.body.fontSize, text);
    placeFigmaLabel(this.body, { ...this.box(L.body), align: 'center' });
    this.heart = illustration ? this.art(A.lifeLostArt, L.heart) : null;
    this.lifeDelta = illustration ? createFigmaLabel(this.theme, options.lifeDelta ?? '-1', L.lifeDelta.fontSize, text) : null;
    if (this.lifeDelta) placeFigmaLabel(this.lifeDelta, { ...this.box(L.lifeDelta), align: 'left' });

    // Decorative layers never take input: the glow lies over the × and Pixi hit-tests every child of the interactive
    // panel, so a hit on it would stop at the panel. Taps on them still land inside the panel's hit area (no backdrop).
    for (const node of [this.surface, this.title, this.glow, this.body, this.heart, this.lifeDelta]) if (node) node.eventMode = 'none';
    // Figma bottom → top; the × (created by the base) goes in right after the title, see placeClose()
    this.panel.addChildAt(this.surface, 0);
    this.panel.addChildAt(this.title, 1);
    for (const node of [this.glow, this.confirmButton, this.body, this.heart, this.lifeDelta]) if (node) this.panel.addChild(node);
    this.placeClose();
  }

  protected applyParams(): void {}

  /** Styled: the style's window box (the fit, the backdrop test and the hit area; not the art's bleed). Donor: measured. */
  protected override panelBounds(): Rectangle {
    const L = this.layout;
    return L ? new Rectangle(px(L, 0), py(L, 0), L.window.width, L.window.height) : super.panelBounds();
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    const L = this.layout;
    return L ? { x: px(L, L.close.x + L.close.width / 2), y: py(L, L.close.y + L.close.height / 2) } : { x: 418, y: -413 };
  }

  /** Styled: action/close lives inside ui/window/base, i.e. under the message-card glow. */
  protected override placeClose(): void {
    super.placeClose();
    if (this.layout && this.closeButton && this.title && this.title.parent === this.panel) {
      this.panel.setChildIndex(this.closeButton, this.panel.getChildIndex(this.title) + 1);
    }
  }

  private box(b: ReadyUiSkinBox): ReadyUiSkinBox {
    const L = this.layout as ReadyUiSkinConfirmLayout;
    return { x: px(L, b.x), y: py(L, b.y), width: b.width, height: b.height };
  }

  private art(texture: Texture, b: ReadyUiSkinBox): Sprite {
    const L = this.layout as ReadyUiSkinConfirmLayout;
    const sprite = new Sprite(texture);
    sprite.position.set(px(L, b.x), py(L, b.y));
    sprite.width = b.width;
    sprite.height = b.height;
    return sprite;
  }
}
