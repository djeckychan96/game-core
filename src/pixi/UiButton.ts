import { Container, type FederatedPointerEvent, Graphics, Rectangle, Sprite, type Text, Texture } from 'pixi.js';
import type { ButtonCancelReason, ButtonController, EaseFn, EaseName, UiRuntime } from '../index';
import { drawCloseMark, drawSurface } from './skin';
import { createLabel, fitLabelWidth } from './text';
import type { ReadyUiTheme, UiButtonRole, UiButtonStyle, UiCloseStyle } from './theme';

/** Donor standard button box (design units) — the default size of a role button. */
export const DEFAULT_BUTTON_WIDTH = 439;
export const DEFAULT_BUTTON_HEIGHT = 207;
/** Donor close control box — the default size of a `close` role button. */
export const DEFAULT_CLOSE_SIZE = 51;

export interface UiButtonOptions {
  ui: UiRuntime;
  /** UiRuntime button id (scope `ui:button:<id>`); unique per runtime. */
  id: string;
  theme: ReadyUiTheme;
  /**
   * Background art (game-specific skins: PLAY, tool buttons). A button given a texture keeps it — the theme never
   * recolours art. Without `texture`, `role` or `style` the button has no background of its own (a hit host).
   */
  texture?: Texture;
  /** Semantic role: the theme decides the look (`close` draws the × mark from `theme.close`). */
  role?: UiButtonRole | 'close';
  /** An explicit programmatic skin (overrides `role`). */
  style?: UiButtonStyle;
  /** Box in local units. Defaults: the texture's size, or the donor 439 × 207 for a role, 51 × 51 for `close`. */
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
 *
 * Skin (Theme System V1): a `role` button draws its background from the theme with Graphics — idle, pressed (when
 * the press progress crosses one half) and disabled looks, each drawn once per state change; a `texture` button
 * keeps its art and the v0.4 disabled alpha. The box, the hit area and the label metrics are the same either way.
 */
export class UiButton extends Container {
  readonly controller: ButtonController;
  /** The art background. For a role button an empty, invisible sprite (kept so hosts may still address it). */
  readonly background: Sprite;
  /** The programmatic background of a role / style button; null for a texture button. */
  readonly skin: Graphics | null;
  readonly role: UiButtonRole | 'close' | null;
  readonly labelText: Text | null;
  readonly icon: Sprite | null;
  readonly boxWidth: number;
  readonly boxHeight: number;
  private readonly theme: ReadyUiTheme;
  private readonly idleScale = { x: 1, y: 1 };
  private readonly pressScale: number;
  private readonly maxLabelWidth: number;
  private style: UiButtonStyle | null;
  private closeStyle: UiCloseStyle | null;
  private pressed = false;
  private redraws = 0;

  constructor(options: UiButtonOptions) {
    super();
    this.theme = options.theme;
    this.pressScale = options.pressScale ?? 0.92;
    this.role = options.role ?? (options.style ? 'primary' : null);
    this.closeStyle = options.role === 'close' && !options.style ? options.theme.close : null;
    this.style = options.style ?? (options.role && options.role !== 'close' ? options.theme.button[options.role] : null);
    const programmatic = this.style !== null || this.closeStyle !== null;
    const texture = programmatic ? null : options.texture ?? null;
    const defaultW = this.closeStyle ? DEFAULT_CLOSE_SIZE : DEFAULT_BUTTON_WIDTH;
    const defaultH = this.closeStyle ? DEFAULT_CLOSE_SIZE : DEFAULT_BUTTON_HEIGHT;
    const width = options.width ?? (texture ? texture.width : defaultW);
    const height = options.height ?? (texture ? texture.height : defaultH);
    this.boxWidth = width;
    this.boxHeight = height;

    this.background = new Sprite(texture ?? Texture.EMPTY);
    this.background.anchor.set(0.5);
    this.background.width = width;
    this.background.height = height;
    this.background.visible = texture !== null;
    this.addChild(this.background);

    this.skin = null;
    if (programmatic) {
      const skin = new Graphics();
      skin.eventMode = 'none';
      this.addChild(skin);
      this.skin = skin;
    }

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
      const label = createLabel(options.theme, options.label, { fontSize, fill: this.style ? this.style.text : options.theme.text.fill });
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
    if (programmatic) this.redrawSkin();
    if (!(options.enabled ?? true)) this.applyEnabledLook(false);

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

  /** Whether the background is drawn from the theme (role / style) rather than a texture. */
  get programmatic(): boolean {
    return this.skin !== null;
  }

  /** True while the press progress is past one half (the pressed skin is shown). */
  get isPressed(): boolean {
    return this.pressed;
  }

  /** How many times the programmatic skin was (re)built; 0 for a texture button. */
  get redrawCount(): number {
    return this.redraws;
  }

  setEnabled(enabled: boolean): void {
    const changed = enabled !== this.controller.enabled;
    this.controller.setEnabled(enabled);
    this.cursor = enabled ? 'pointer' : 'default';
    if (changed || !enabled) this.applyEnabledLook(enabled);
  }

  setLabel(text: string): void {
    if (!this.labelText) return;
    this.labelText.text = text;
    fitLabelWidth(this.labelText, this.maxLabelWidth);
  }

  /** Re-skins a role / style button (a theme change at runtime); no-op for a texture button. */
  setStyle(style: UiButtonStyle): void {
    if (!this.skin || style === this.style) return;
    this.style = style;
    this.closeStyle = null;
    if (this.labelText) this.labelText.style.fill = style.text;
    this.redrawSkin();
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

  private applyEnabledLook(enabled: boolean): void {
    if (this.skin && this.style) {
      // a role button takes the theme's `disabled` role; the label follows
      this.alpha = 1;
      if (this.labelText) this.labelText.style.fill = enabled ? this.style.text : this.theme.button.disabled.text;
      this.redrawSkin();
      return;
    }
    // texture buttons and the close mark keep the v0.4 look: dimmed
    this.alpha = enabled ? 1 : 0.55;
  }

  private redrawSkin(): void {
    const skin = this.skin;
    if (!skin) return;
    this.redraws++;
    skin.clear();
    const w = this.boxWidth;
    const h = this.boxHeight;
    if (this.closeStyle) {
      drawCloseMark(skin, Math.min(w, h), this.closeStyle, this.pressed);
    } else if (this.style) {
      const base = this.controller.enabled ? this.style : this.theme.button.disabled;
      const pressed = this.pressed && this.controller.enabled ? base.pressed : null;
      const style = pressed ? { ...base, fill: pressed.fill ?? base.fill, depth: pressed.depth === undefined ? base.depth : pressed.depth, border: pressed.border === undefined ? base.border : pressed.border } : base;
      drawSurface(skin, -w / 2, -h / 2, w, h, style);
    }
    skin.boundsArea = new Rectangle(-w / 2, -h / 2, w, h);
    this._didViewChangeTick++;
  }

  private applyProgress(progress: number): void {
    const k = 1 + (this.pressScale - 1) * progress;
    this.scale.set(this.idleScale.x * k, this.idleScale.y * k);
    const pressed = progress >= 0.5;
    if (pressed !== this.pressed) {
      this.pressed = pressed;
      if (this.skin) this.redrawSkin();
    }
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
