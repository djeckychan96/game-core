import type { Text } from 'pixi.js';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import type { UiButton } from './UiButton';
import { createLabel, fitLabelWidth } from './text';

export interface ConfirmWindowViewOptions extends Omit<ModalWindowOptions, 'id'> {
  id?: string;
  /** Default `ARE YOU SURE?` (donor `ui.confirm.header`). */
  title?: string;
  /** Default `You will lose 1 heart` (donor `ui.confirm.body`). */
  body?: string;
  /** Default `EXIT` (donor `ui.confirm.exit`). */
  confirmLabel?: string;
  /** The one action button, a close continuation. Cancel = the × or the backdrop → `onDismiss`. */
  onConfirm: () => void;
}

/**
 * "Are you sure? You will lose 1 heart" — the donor's ConfirmWindow (Trail Arrow `Confirm` prefab) 1:1: the 968 × 1006
 * `confirmPanel` art with the broken heart and its "-1" baked in, header at (6, −417), body at (16, 157), one 600 × 206
 * button at y 334, × at (418, −413). The × and a backdrop tap cancel (`onDismiss`); the button runs `onConfirm`.
 */
export class ConfirmWindowView extends ModalWindow {
  private readonly title: Text;
  private readonly body: Text;
  private readonly confirmButton: UiButton;
  private readonly onConfirm: () => void;

  constructor(options: ConfirmWindowViewOptions) {
    // donor WindowsSystem: ConfirmWindow mobile widthRatio 0.92 over the portrait default heightRatio 0.72
    super({ ...options, id: options.id ?? 'confirm-window', fit: { widthRatio: 0.92, heightRatio: 0.72, ...(options.fit ?? {}) } });
    this.onConfirm = options.onConfirm;
    const t = this.textures;

    this.panel.addChildAt(this.sprite(t.confirmPanel, 968, 1006), 0);
    this.title = createLabel(this.theme, options.title ?? 'ARE YOU SURE?', { fontSize: 74, stroke: 10 });
    this.title.position.set(6, -417);
    fitLabelWidth(this.title, 760);
    this.body = createLabel(this.theme, options.body ?? 'You will lose 1 heart', { fontSize: 74, stroke: 10 });
    this.body.position.set(16, 157);
    fitLabelWidth(this.body, 880);
    this.panel.addChild(this.title, this.body);

    this.confirmButton = this.createButton('confirm', t.confirmButton, options.confirmLabel ?? 'EXIT', () => this.close('button', () => this.onConfirm()), 600, 206, 82, -9);
    if (this.confirmButton.labelText) fitLabelWidth(this.confirmButton.labelText, 520);
    this.confirmButton.y = 334;
    this.panel.addChild(this.confirmButton);
    this.placeClose();
  }

  protected applyParams(): void {}

  protected override closeButtonPosition(): { x: number; y: number } {
    return { x: 418, y: -413 };
  }
}
