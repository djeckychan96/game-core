import { Container, type FederatedPointerEvent, type NineSliceSprite, Rectangle, Sprite, type Text, type Texture } from 'pixi.js';
import type { ButtonCancelReason, ButtonController, EaseFn, EaseName, MotionHandle, MotionRuntime, UiRuntime } from '../index';
import { createNineSlice, type NineSliceSpec } from './nineSlice';
import { createLabel, fitLabelWidth } from './text';
import type { ReadyUiTheme } from './theme';
import { sineInOut } from './uiMotion';

/** Idle "breathing" of a primary call to action (e.g. PLAY): the button swells to `scale` and back, endlessly. */
export interface UiButtonBreathing {
  /** Peak size over the idle size (1.04 = 4 % larger). */
  scale: number;
  /** One whole in-and-out cycle, in ms. */
  periodMs: number;
}

/** The default breathing (`breathing: true`): 4 % over a 1.3 s cycle, a soft sine with no spring. */
export const UI_BUTTON_BREATHING: Readonly<UiButtonBreathing> = Object.freeze({ scale: 1.04, periodMs: 1300 });

export interface UiButtonOptions {
  ui: UiRuntime;
  /** UiRuntime button id (scope `ui:button:<id>`); unique per runtime. */
  id: string;
  theme: ReadyUiTheme;
  /** Background art; drawn centered at `width × height` (defaults to the texture's own size). */
  texture: Texture;
  width?: number;
  height?: number;
  /** Draw `texture` as a 9-slice over the `width × height` box instead of stretching it (e.g. READY_UI_NINE_SLICES). */
  nineSlice?: NineSliceSpec;
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
  /** The host's MotionRuntime. Needed only by `breathing`. */
  motion?: MotionRuntime;
  /**
   * Opt-in idle breathing for a primary call to action: `true` = UI_BUTTON_BREATHING, an object overrides its numbers.
   * Default off. Needs `motion`. It composes with the press (idle × breathing × press), stops while the button is
   * disabled, and leaves the hit area at its idle size.
   */
  breathing?: boolean | Partial<UiButtonBreathing>;
}

/**
 * The button's own hit rectangle, held at its idle size on screen while the button breathes: the local point is
 * scaled by the breathing factor before the test, which cancels the breathing part of the button's transform.
 */
class BreathingHitArea extends Rectangle {
  factor = 1;

  override contains(x: number, y: number): boolean {
    return super.contains(x * this.factor, y * this.factor);
  }
}

function resolveBreathing(breathing: boolean | Partial<UiButtonBreathing> | undefined): UiButtonBreathing | null {
  if (!breathing) return null;
  const config = breathing === true ? UI_BUTTON_BREATHING : { ...UI_BUTTON_BREATHING, ...breathing };
  if (!(config.scale > 0) || !(config.periodMs > 0)) {
    throw new RangeError(`UiButton breathing: scale and periodMs must be > 0, got ${config.scale} / ${config.periodMs}`);
  }
  return { scale: config.scale, periodMs: config.periodMs };
}

/**
 * A Pixi button driven by the foundation's ButtonController: Pixi pointer events are forwarded
 * to the controller, its 0..1 press progress is mapped onto `scale` from an explicit idle scale.
 * The tap action is the controller's settled `onTap`, never a raw pointerup.
 * `scale` has one writer, the button itself: idle scale × breathing (opt-in, one owned tween) × press.
 */
export class UiButton extends Container {
  readonly controller: ButtonController;
  readonly background: Sprite | NineSliceSprite;
  readonly labelText: Text | null;
  readonly icon: Sprite | null;
  private readonly idleScale = { x: 1, y: 1 };
  private readonly pressScale: number;
  private readonly maxLabelWidth: number;
  private readonly motion: MotionRuntime | null;
  /** Current factors of the composed scale: press from the controller's progress, breath from the breathing tween. */
  private pressFactor = 1;
  private breathFactor = 1;
  private breathingConfig: UiButtonBreathing | null = null;
  /** The one breathing tween, owned by the button (never two). */
  private breathHandle: MotionHandle | null = null;
  private breathArea: BreathingHitArea | null = null;

  constructor(options: UiButtonOptions) {
    super();
    this.pressScale = options.pressScale ?? 0.92;
    this.motion = options.motion ?? null;
    const width = options.width ?? options.texture.width;
    const height = options.height ?? options.texture.height;
    if (options.nineSlice) {
      this.background = createNineSlice(options.texture, options.nineSlice, width, height);
    } else {
      const sprite = new Sprite(options.texture);
      sprite.anchor.set(0.5);
      sprite.width = width;
      sprite.height = height;
      this.background = sprite;
    }
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
    if (options.breathing) this.setBreathing(options.breathing);
  }

  get enabled(): boolean {
    return this.controller.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.controller.setEnabled(enabled);
    this.alpha = enabled ? 1 : 0.55;
    this.cursor = enabled ? 'pointer' : 'default';
    this.syncBreathing();
  }

  /**
   * Turns the idle breathing on (`true` = UI_BUTTON_BREATHING, or its numbers overridden) or off (`false`). It runs
   * while the button is enabled; a breathing cancelled from outside (`core.cancelAll()`) comes back on the next
   * `setIdleScale` (every layout) / `setEnabled(true)` / `setBreathing`.
   */
  setBreathing(breathing: boolean | Partial<UiButtonBreathing>): void {
    const config = resolveBreathing(breathing);
    if (config && !this.motion) throw new Error(`UiButton '${this.controller.id}': breathing needs options.motion`);
    this.stopBreathing();
    this.breathingConfig = config;
    this.syncBreathing();
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
    this.applyScale();
    this.syncBreathing();
  }

  /** Threshold in the host's pointer units (screen px): swipes longer than it are not taps. */
  setTapThreshold(px: number): void {
    this.controller.setTapThreshold(px);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return;
    this.breathingConfig = null;
    this.stopBreathing(); // before Pixi nulls `scale`: the tween's cancel writes it once more
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
    this.pressFactor = 1 + (this.pressScale - 1) * progress;
    this.applyScale();
  }

  private applyScale(): void {
    const k = this.breathFactor * this.pressFactor;
    this.scale.set(this.idleScale.x * k, this.idleScale.y * k);
  }

  private setBreath(value: number): void {
    this.breathFactor = value;
    if (this.breathArea && this.hitArea === this.breathArea) this.breathArea.factor = value;
    this.applyScale();
  }

  /** Breathing runs while it is configured and the button is enabled and alive; idempotent (one tween at most). */
  private syncBreathing(): void {
    const config = this.breathingConfig;
    if (this.destroyed || !config || !this.motion || !this.controller.enabled) {
      this.stopBreathing();
      return;
    }
    if (this.breathHandle?.active) return;
    if (this.hitArea instanceof Rectangle && !(this.hitArea instanceof BreathingHitArea)) {
      const own = this.hitArea;
      this.breathArea = new BreathingHitArea(own.x, own.y, own.width, own.height);
      this.hitArea = this.breathArea;
    }
    const handle: MotionHandle = this.motion.tween({
      scope: `${this.controller.scope}:breathing`,
      bindings: [{ get: () => this.breathFactor, set: (value: number) => this.setBreath(value), from: 1, to: config.scale }],
      durationMs: config.periodMs / 2,
      ease: sineInOut,
      repeat: Infinity,
      yoyo: true,
      onCancel: () => {
        if (this.breathHandle === handle) this.breathHandle = null;
        this.setBreath(1);
      }
    });
    this.breathHandle = handle;
  }

  private stopBreathing(): void {
    const handle = this.breathHandle;
    this.breathHandle = null;
    if (handle) handle.cancel(); // its onCancel settles the factor back to 1
    else if (this.breathFactor !== 1) this.setBreath(1);
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
