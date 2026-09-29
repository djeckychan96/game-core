import { type NineSliceSprite, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { READY_UI_NINE_SLICES, READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from './assets';
import { createNineSlice } from './nineSlice';
import { createFigmaLabel, createLabel, fitLabelWidth, placeFigmaLabel } from './text';
import { UiButton } from './UiButton';

/**
 * Figma `screen/confirm-exit` (file CNcGCBj8IvUXrPd01FbChm, node 820:77655; the read is docs/figma/confirm-exit):
 * every box in design units relative to the `ui/window/base` box (screen 60, 675 of the 1080 × 2344 frame).
 * Sprite boxes are the SVG export boxes (render bounds), so the art lands where Figma renders it.
 */
export const CONFIRM_EXIT_FIGMA = {
  screen: { width: 1080, height: 2344 },
  /** ui/window/base 820:77659: the 960 × 1198 master (@stretch 80 / 175 / 80 / 80) at 960 × 994. */
  window: { width: 960, height: 994 },
  /** overlay/dim 820:77657 */
  backdrop: { color: 0x080b0d, alpha: 0.8 },
  /** slot/title 73:5211: 690 × 104 box, CENTER / CENTER, Fira Sans Black 80 */
  title: { x: 135, y: 34, width: 690, height: 104, fontSize: 80 },
  /** action/close 73:5212 (50.52 glyph in its 51 × 51 SVG box) */
  close: { x: 863, y: 61, width: 51, height: 51 },
  /** surface/message-card 820:77660: 450 × 354 rounded rect under a 225.7 layer blur */
  glow: { x: 29.3, y: 5.3, width: 902, height: 806 },
  /** art/broken-heart 820:77663 (box 327, 274, 305.4 × 268 + 10 stroke / shadow bleed) */
  heart: { x: 317.001, y: 264, width: 326, height: 298 },
  /** slot/life-delta 820:77672: LEFT / CENTER, hugging, Fira Sans Black 150 */
  lifeDelta: { x: 543, y: 345, width: 146, height: 180, fontSize: 150 },
  /** slot/body 820:77662: 834 × 113 box, CENTER / CENTER, Fira Sans Black 50 */
  body: { x: 63, y: 586, width: 834, height: 113, fontSize: 50 },
  /** ui/button/base 820:77661 */
  button: { x: 180, y: 725, width: 600, height: 206 },
  /** the button's @content / slot/label, button-local; Fira Sans Black 80 */
  buttonLabel: { x: 25, y: 27, width: 550, height: 128, fontSize: 80 }
} as const;

/**
 * The textures of the `'figma'` variant. They are not in the required pack: a host that uses the variant requests
 * them with `loadReadyUiAssets({ include: CONFIRM_EXIT_FIGMA_TEXTURES })`; nothing else ever loads them.
 */
export const CONFIRM_EXIT_FIGMA_TEXTURES = ['windowBase', 'windowClose', 'messageGlow', 'brokenHeart', 'buttonGreen'] as const satisfies readonly ReadyUiOptionalTextureName[];

/** `'donor'`: the Trail Arrow ConfirmWindow art (required pack). `'figma'`: the Figma confirm-exit window. */
export type ConfirmWindowVariant = 'donor' | 'figma';

export interface ConfirmWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** Default `'donor'`, unchanged; `'figma'` needs CONFIRM_EXIT_FIGMA_TEXTURES in `textures`. */
  variant?: ConfirmWindowVariant;
  /** Default `ARE YOU SURE?` (donor `ui.confirm.header`, Figma slot/title). */
  title?: string;
  /** Default `You will lose 1 heart` (donor `ui.confirm.body`) / `YOU WILL LOSE 1 HEART` (Figma slot/body). */
  body?: string;
  /** Default `EXIT` (donor `ui.confirm.exit`, Figma slot/label). */
  confirmLabel?: string;
  /** `'figma'` only: default `-1` (slot/life-delta), runtime text over the broken heart (the donor art bakes it in). */
  lifeDelta?: string;
  /** The one action button, a close continuation. Cancel = the × or the backdrop → `onDismiss`. */
  onConfirm: () => void;
}

const F = CONFIRM_EXIT_FIGMA;
/** Window-local Figma x / y → panel units (the panel origin is the window box centre). */
const px = (x: number): number => x - F.window.width / 2;
const py = (y: number): number => y - F.window.height / 2;
type FigmaArt = Record<(typeof CONFIRM_EXIT_FIGMA_TEXTURES)[number], Texture>;

/** ModalWindow options per variant; the Figma variant fails here, before anything registers, when its art is absent. */
function modalOptions(options: ConfirmWindowViewOptions): ModalWindowOptions {
  const id = options.id ?? 'confirm-window';
  if ((options.variant ?? 'donor') === 'donor') {
    // donor WindowsSystem: ConfirmWindow mobile widthRatio 0.92 over the portrait default heightRatio 0.72
    return { ...options, id, fit: { widthRatio: 0.92, heightRatio: 0.72, ...(options.fit ?? {}) } };
  }
  const textures: ReadyUiTextures = options.textures;
  const missing = CONFIRM_EXIT_FIGMA_TEXTURES.filter((name) => !textures[name]);
  if (missing.length) {
    const list = missing.map((name) => `${name} (${READY_UI_OPTIONAL_ASSET_FILES[name]})`).join(', ');
    throw new Error(`ConfirmWindowView variant 'figma': no ${list} in textures — load them with loadReadyUiAssets({ include: CONFIRM_EXIT_FIGMA_TEXTURES })`);
  }
  return {
    ...options,
    id,
    backdropColor: options.backdropColor ?? F.backdrop.color,
    backdropAlpha: options.backdropAlpha ?? F.backdrop.alpha,
    // the Figma frame fit: the window's share of the 1080 × 2344 screen, like the kit's design contain-fit
    fit: { widthRatio: F.window.width / F.screen.width, heightRatio: F.window.height / F.screen.height, ...(options.fit ?? {}) }
  };
}

/**
 * "Are you sure? You will lose 1 heart", in two variants.
 *
 * `'donor'` (default): the donor's ConfirmWindow (Trail Arrow `Confirm` prefab) 1:1 — the 968 × 1006 `confirmPanel`
 * art with the broken heart and its "-1" baked in, header at (6, −417), body at (16, 157), one 600 × 206 button at
 * y 334, × at (418, −413).
 *
 * `'figma'`: the Figma confirm-exit window 1:1 (CONFIRM_EXIT_FIGMA). The window shell and the button surface are
 * 9-slice textures (READY_UI_NINE_SLICES); title, body, the "-1" and the button label are runtime text laid out in
 * their Figma boxes; the close glyph, the glow and the broken heart are separate sprites, in the Figma order (the
 * glow sits above the shell, its title and the ×). The window keeps its Figma share of the 1080 × 2344 frame.
 *
 * Both: the × and a backdrop tap cancel (`onDismiss`); the button runs `onConfirm`.
 */
export class ConfirmWindowView extends ModalWindow {
  readonly variant: ConfirmWindowVariant;
  private readonly title: Text;
  private readonly body: Text;
  private readonly confirmButton: UiButton;
  private readonly onConfirm: () => void;
  // 'figma' only (null for 'donor')
  private readonly surface: NineSliceSprite | null;
  private readonly glow: Sprite | null;
  private readonly heart: Sprite | null;
  private readonly lifeDelta: Text | null;
  private readonly confirmLabel: Text | null;

  constructor(options: ConfirmWindowViewOptions) {
    super(modalOptions(options));
    this.variant = options.variant ?? 'donor';
    this.onConfirm = options.onConfirm;
    const onTap = (): void => { this.close('button', () => this.onConfirm()); };

    if (this.variant === 'donor') {
      const t = this.textures;
      this.panel.addChildAt(this.sprite(t.confirmPanel, 968, 1006), 0);
      this.title = createLabel(this.theme, options.title ?? 'ARE YOU SURE?', { fontSize: 74, stroke: 10 });
      this.title.position.set(6, -417);
      fitLabelWidth(this.title, 760);
      this.body = createLabel(this.theme, options.body ?? 'You will lose 1 heart', { fontSize: 74, stroke: 10 });
      this.body.position.set(16, 157);
      fitLabelWidth(this.body, 880);
      this.panel.addChild(this.title, this.body);

      this.confirmButton = this.createButton('confirm', t.confirmButton, options.confirmLabel ?? 'EXIT', onTap, 600, 206, 82, -9);
      if (this.confirmButton.labelText) fitLabelWidth(this.confirmButton.labelText, 520);
      this.confirmButton.y = 334;
      this.panel.addChild(this.confirmButton);
      this.surface = this.glow = this.heart = null;
      this.lifeDelta = this.confirmLabel = null;
      this.placeClose();
      return;
    }

    const t = this.textures as ReadyUiTextures & FigmaArt; // checked by modalOptions()
    this.surface = createNineSlice(t.windowBase, READY_UI_NINE_SLICES.windowBase, F.window.width, F.window.height);
    this.title = createFigmaLabel(this.theme, options.title ?? 'ARE YOU SURE?', F.title.fontSize);
    placeFigmaLabel(this.title, { ...this.box(F.title), align: 'center' });
    if (this.closeButton) {
      this.closeButton.background.texture = t.windowClose;
      this.closeButton.background.width = F.close.width;
      this.closeButton.background.height = F.close.height;
    }
    this.glow = this.art(t.messageGlow, F.glow);

    this.confirmButton = this.addButton(new UiButton({
      ui: this.ui,
      id: `${this.id}:confirm`,
      theme: this.theme,
      texture: t.buttonGreen,
      nineSlice: READY_UI_NINE_SLICES.buttonGreen,
      width: F.button.width,
      height: F.button.height,
      pressScale: 0.9,
      onTap
    }));
    this.confirmButton.position.set(px(F.button.x + F.button.width / 2), py(F.button.y + F.button.height / 2));
    this.confirmLabel = createFigmaLabel(this.theme, options.confirmLabel ?? 'EXIT', F.buttonLabel.fontSize);
    const label = F.buttonLabel;
    placeFigmaLabel(this.confirmLabel, { x: label.x - F.button.width / 2, y: label.y - F.button.height / 2, width: label.width, height: label.height, align: 'center' });
    this.confirmButton.addChild(this.confirmLabel);

    this.body = createFigmaLabel(this.theme, options.body ?? 'YOU WILL LOSE 1 HEART', F.body.fontSize);
    placeFigmaLabel(this.body, { ...this.box(F.body), align: 'center' });
    this.heart = this.art(t.brokenHeart, F.heart);
    this.lifeDelta = createFigmaLabel(this.theme, options.lifeDelta ?? '-1', F.lifeDelta.fontSize);
    placeFigmaLabel(this.lifeDelta, { ...this.box(F.lifeDelta), align: 'left' });

    // Decorative layers never take input: the glow lies over the × and Pixi hit-tests every child of the interactive
    // panel, so a hit on it would stop at the panel. Taps on them still land inside the panel's hit area (no backdrop).
    for (const node of [this.surface, this.title, this.glow, this.body, this.heart, this.lifeDelta]) node.eventMode = 'none';
    // Figma bottom → top; the × (created by the base) goes in right after the title, see placeClose()
    this.panel.addChildAt(this.surface, 0);
    this.panel.addChildAt(this.title, 1);
    this.panel.addChild(this.glow, this.confirmButton, this.body, this.heart, this.lifeDelta);
    this.placeClose();
  }

  protected applyParams(): void {}

  /** 'figma': the Figma window box (the fit, the backdrop test and the hit area; not the art's bleed). 'donor': measured. */
  protected override panelBounds(): Rectangle {
    return this.variant === 'figma' ? new Rectangle(px(0), py(0), F.window.width, F.window.height) : super.panelBounds();
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    return this.variant === 'figma' ? { x: px(F.close.x + F.close.width / 2), y: py(F.close.y + F.close.height / 2) } : { x: 418, y: -413 };
  }

  /** 'figma': action/close lives inside ui/window/base, i.e. under the message-card glow. */
  protected override placeClose(): void {
    super.placeClose();
    if (this.variant === 'figma' && this.closeButton && this.title && this.title.parent === this.panel) {
      this.panel.setChildIndex(this.closeButton, this.panel.getChildIndex(this.title) + 1);
    }
  }

  private box(b: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    return { x: px(b.x), y: py(b.y), width: b.width, height: b.height };
  }

  private art(texture: Texture, b: { x: number; y: number; width: number; height: number }): Sprite {
    const sprite = new Sprite(texture);
    sprite.position.set(px(b.x), py(b.y));
    sprite.width = b.width;
    sprite.height = b.height;
    return sprite;
  }
}
