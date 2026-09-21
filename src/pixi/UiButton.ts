import { Container, type FederatedPointerEvent, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import type { ButtonCancelReason, ButtonController, EaseFn, EaseName, UiRuntime } from '../index';
import { createLabel, fitLabelWidth } from './text';
import type { ReadyUiTheme } from './theme';

export interface UiButtonOptions {
  ui: UiRuntime;
  /** UiRuntime button id (scope `ui:button:<id>`); unique per runtime. */
  id: string;
  theme: ReadyUiTheme;
  /** Background art; drawn centered at `width × height` (defaults to the texture's own size). */
  texture: Texture;
  width?: number;
  height?: number;
  label?: string;
  /** Local-units font size for the label. Default: 42% of the button height. */
  fontSize?: number;
  /** Vertical label offset in local units (donor buttons sit their text slightly above center). */
  labelOffsetY?: number;
  /** Optional icon drawn left of / instead of the label. */
  icon?: Texture;
  iconSize?: number;
  iconX?: number;
  iconY?: number;
  onTap: () => void;
  onCancel?: (reason: ButtonCancelReason) => void;
  /** Scale at full press, relative to idle. Default 0.92. */
  pressScale?: number;
  pressDurationMs?: number;
  releaseDurationMs?: number;
  releaseEase?: EaseName | EaseFn;
  /** Minimum tappable square in local units (hit area is expanded to it). */
  minHitSize?: number;
  enabled?: boolean;
}

/**
 * A Pixi button driven by the foundation's ButtonController: Pixi pointer events are forwarded
 * to the controller, its 0..1 press progress is mapped onto `scale` from an explicit idle scale.
 * The tap action is the controller's settled `onTap`, never a raw pointerup.
 */
export class UiButton extends Container {
  readonly controller: ButtonController;
  readonly background: Sprite;
  readonly labelText: Text | null;
  readonly icon: Sprite | null;
  private readonly idleScale = { x: 1, y: 1 };
  private readonly pressScale: number;
  private readonly maxLabelWidth: number;

  constructor(options: UiButtonOptions) {
    super();
    this.pressScale = options.pressScale ?? 0.92;
    this.background = new Sprite(options.texture);
    this.background.anchor.set(0.5);
    const width = options.width ?? options.texture.width;
    const height = options.height ?? options.texture.height;
    this.background.width = width;
    this.background.height = height;
    this.addChild(this.background);

    this.icon = null;
    if (options.icon) {
      const icon = new Sprite(options.icon);
      icon.anchor.set(0.5);
      const size = options.iconSize ?? height * 0.62;
      const k = size / Math.max(1, Math.max(options.icon.width, options.icon.height));
      icon.scale.set(k);
      icon.position.set(options.iconX ?? 0, options.iconY ?? 0);
      this.addChild(icon);
      this.icon = icon;
    }

    this.maxLabelWidth = width * 0.84;
    this.labelText = null;
    if (options.label !== undefined) {
      const fontSize = options.fontSize ?? Math.round(height * 0.42);
      const label = createLabel(options.theme, options.label, { fontSize });
      label.y = options.labelOffsetY ?? -height * 0.04;
      fitLabelWidth(label, this.maxLabelWidth);
      this.addChild(label);
      this.labelText = label;
    }

    const hit = Math.max(options.minHitSize ?? 0, 0);
    const hitW = Math.max(width, hit);
    const hitH = Math.max(height, hit);
    this.hitArea = new Rectangle(-hitW / 2, -hitH / 2, hitW, hitH);
    this.eventMode = 'static';
    this.cursor = 'pointer';

    const controllerOptions: Parameters<UiRuntime['createButton']>[0] = {
      id: options.id,
      enabled: options.enabled ?? true,
      pressDurationMs: options.pressDurationMs ?? 80,
      releaseDurationMs: options.releaseDurationMs ?? 120,
      releaseEase: options.releaseEase ?? 'backOut',
      onProgress: (progress) => this.applyProgress(progress),
      onTap: options.onTap
    };
    if (options.onCancel) controllerOptions.onCancel = options.onCancel;
    this.controller = options.ui.createButton(controllerOptions);

    this.on('pointerdown', this.onPointerDown, this);
    this.on('pointermove', this.onPointerMove, this);
    this.on('pointerup', this.onPointerUp, this);
    this.on('pointerupoutside', this.onPointerUpOutside, this);
    this.on('pointercancel', this.onPointerCancel, this);
    this.on('pointerleave', this.onPointerLeave, this);
  }

  get enabled(): boolean {
    return this.controller.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.controller.setEnabled(enabled);
    this.alpha = enabled ? 1 : 0.55;
    this.cursor = enabled ? 'pointer' : 'default';
  }

  setLabel(text: string): void {
    if (!this.labelText) return;
    this.labelText.text = text;
    fitLabelWidth(this.labelText, this.maxLabelWidth);
  }

  /** The scale the button rests at; press progress is always mapped from this baseline. */
  setIdleScale(x: number, y = x): void {
    this.controller.cancel();
    this.idleScale.x = x;
    this.idleScale.y = y;
    this.scale.set(x, y);
  }

  /** Threshold in the host's pointer units (screen px): swipes longer than it are not taps. */
  setTapThreshold(px: number): void {
    this.controller.setTapThreshold(px);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return;
    this.controller.dispose();
    this.off('pointerdown', this.onPointerDown, this);
    this.off('pointermove', this.onPointerMove, this);
    this.off('pointerup', this.onPointerUp, this);
    this.off('pointerupoutside', this.onPointerUpOutside, this);
    this.off('pointercancel', this.onPointerCancel, this);
    this.off('pointerleave', this.onPointerLeave, this);
    super.destroy(options ?? { children: true });
  }

  private applyProgress(progress: number): void {
    const k = 1 + (this.pressScale - 1) * progress;
    this.scale.set(this.idleScale.x * k, this.idleScale.y * k);
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    this.controller.pointerDown(event.pointerId, event.global.x, event.global.y);
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    this.controller.pointerMove(event.pointerId, event.global.x, event.global.y);
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    this.controller.pointerUp(event.pointerId, event.global.x, event.global.y, true);
  }

  private onPointerUpOutside(event: FederatedPointerEvent): void {
    this.controller.pointerUp(event.pointerId, event.global.x, event.global.y, false);
  }

  private onPointerCancel(event: FederatedPointerEvent): void {
    this.controller.pointerCancel(event.pointerId, 'pointerCancel');
  }

  private onPointerLeave(event: FederatedPointerEvent): void {
    this.controller.pointerCancel(event.pointerId, 'leave');
  }
}
