import { Container, type FederatedPointerEvent, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
import type {
  EaseFn,
  MotionRuntime,
  UiRuntime,
  WindowCloseIntent,
  WindowCloseReason,
  WindowController,
  WindowHiddenReason,
  WindowState
} from '../index';
import type { ReadyUiTextures } from './assets';
import { UiButton } from './UiButton';
import { applyTextResolution } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';

export interface ModalInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface ModalResizeOptions {
  insets?: ModalInsets;
  pixelRatio?: number;
}

export interface ModalWindowOptions {
  ui: UiRuntime;
  motion: MotionRuntime;
  textures: ReadyUiTextures;
  theme?: ReadyUiThemeOverrides;
  /** UiRuntime window id; the close button registers as `<id>:close`. */
  id: string;
  /** default true */
  blocksGameplay?: boolean;
  /** default 440 ms, back.out(1.9) — the donor's victory-window pop */
  enterDurationMs?: number;
  enterEase?: EaseFn;
  /** default 160 ms */
  leaveDurationMs?: number;
  /** Tap on the dim backdrop closes with reason 'background'. Default true. */
  closeOnBackdrop?: boolean;
  /** Draw the red × in the panel's top-right corner. Default true. */
  closeButton?: boolean;
  /** Share of the viewport the panel may take (contain-fit). Defaults: 0.9 × 0.82. */
  maxWidthRatio?: number;
  maxHeightRatio?: number;
  /** Return false to veto a close (e.g. while waiting for an ad). */
  onBeforeClose?: (intent: WindowCloseIntent) => boolean | void;
  /** View cleanup on every path to hidden (also cancelAll). Not a business hook. */
  onHidden?: (reason: WindowHiddenReason) => void;
  /** Runs once the window closed via the × or the backdrop (the close continuation). */
  onDismiss?: (reason: WindowCloseReason) => void;
  width?: number;
  height?: number;
}

export function backOut(overshoot: number): EaseFn {
  return (t: number) => {
    const p = t - 1;
    return 1 + p * p * ((overshoot + 1) * p + overshoot);
  };
}

/**
 * Base of every Ready UI modal: a dim backdrop, a centered panel laid out in design units and
 * contain-fitted to the viewport, a WindowController driving hidden → entering → shown → leaving,
 * and the donor's entrance (alpha 0 → 1, y +130 → 0, scale 0.7 → 1 from the fit scale).
 * Subclasses build the panel content in `panel` (design units, centered at 0,0) and report their
 * `panelBounds` for fitting; business callbacks always run as close() continuations.
 */
export abstract class ModalWindow<TParams = void> extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  readonly controller: WindowController<TParams>;
  protected readonly ui: UiRuntime;
  protected readonly motion: MotionRuntime;
  protected readonly textures: ReadyUiTextures;
  protected readonly backdrop: Graphics;
  protected readonly panel: Container;
  protected readonly closeButton: UiButton | null;
  protected readonly fxScope: string;
  private readonly onDismiss: ((reason: WindowCloseReason) => void) | null;
  private readonly onHiddenHook: ((reason: WindowHiddenReason) => void) | null;
  private readonly maxWidthRatio: number;
  private readonly maxHeightRatio: number;
  private readonly closeOnBackdrop: boolean;
  private readonly buttons: UiButton[] = [];
  private fitScale = 1;
  private panelCenterY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private pixelRatio = 1;
  private lastInsets: ModalInsets = {};
  private disposed = false;

  protected constructor(options: ModalWindowOptions) {
    super();
    this.id = options.id;
    this.theme = resolveTheme(options.theme);
    this.ui = options.ui;
    this.motion = options.motion;
    this.textures = options.textures;
    this.onDismiss = options.onDismiss ?? null;
    this.onHiddenHook = options.onHidden ?? null;
    this.maxWidthRatio = options.maxWidthRatio ?? 0.9;
    this.maxHeightRatio = options.maxHeightRatio ?? 0.82;
    this.closeOnBackdrop = options.closeOnBackdrop ?? true;
    this.fxScope = `${this.id}:fx`;
    this.visible = false;

    this.backdrop = new Graphics();
    this.backdrop.eventMode = 'static';
    this.backdrop.on('pointertap', this.onBackdropTap, this);
    this.addChild(this.backdrop);

    this.panel = new Container();
    this.panel.eventMode = 'static';
    this.addChild(this.panel);

    this.closeButton = null;
    if (options.closeButton ?? true) {
      const close = new UiButton({
        ui: options.ui,
        id: `${options.id}:close`,
        theme: this.theme,
        texture: options.textures.btnClose,
        width: 72,
        height: 72,
        minHitSize: 140,
        pressScale: 0.86,
        onTap: () => this.close('button')
      });
      this.panel.addChild(close);
      this.closeButton = close;
      this.buttons.push(close);
    }

    const controllerOptions: Parameters<UiRuntime['createWindow']>[0] = {
      id: options.id,
      blocksGameplay: options.blocksGameplay ?? true,
      enterDurationMs: options.enterDurationMs ?? 440,
      enterEase: options.enterEase ?? backOut(1.9),
      leaveDurationMs: options.leaveDurationMs ?? 160,
      leaveEase: 'easeIn',
      onShow: (params: unknown) => {
        this.visible = true;
        this.applyParams(params as TParams);
        this.layoutPanel();
        this.applyTransition(0);
      },
      onTransition: (progress: number) => this.applyTransition(progress),
      onShown: () => this.onShown(),
      onHidden: (reason: WindowHiddenReason) => {
        for (const button of this.buttons) button.controller.cancel();
        this.motion.cancelScope(this.fxScope);
        this.applyTransition(1);
        this.visible = false;
        this.onHiddenView(reason);
        this.onHiddenHook?.(reason);
      }
    };
    if (options.onBeforeClose) controllerOptions.onBeforeClose = options.onBeforeClose;
    this.controller = options.ui.createWindow<unknown>(controllerOptions) as WindowController<TParams>;

    this.resize(options.width ?? 390, options.height ?? 844);
  }

  // --- subclass contract ---

  /** Mount/apply params. Called from the controller's onShow, before the entrance starts. */
  protected abstract applyParams(params: TParams): void;

  /** The panel's design-unit box used for contain-fitting (x, y relative to the panel origin). */
  protected abstract panelBounds(): Rectangle;

  /** Hook for view cleanup on hidden (already forced back to idle). */
  protected onHiddenView(_reason: WindowHiddenReason): void {}

  /** Hook when the entrance finished. */
  protected onShown(): void {}

  /** Registers a button so hidden/destroy settle and dispose it. */
  protected addButton(button: UiButton): UiButton {
    this.buttons.push(button);
    return button;
  }

  /** Shorthand for a themed panel button. */
  protected createButton(id: string, texture: Texture, label: string, onTap: () => void, width = 439, height = 207): UiButton {
    const button = new UiButton({
      ui: this.ui,
      id: `${this.id}:${id}`,
      theme: this.theme,
      texture,
      width,
      height,
      label,
      fontSize: 62,
      labelOffsetY: -9,
      onTap
    });
    return this.addButton(button);
  }

  protected sprite(texture: Texture, width: number, height: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = width;
    sprite.height = height;
    return sprite;
  }

  // --- public lifecycle ---

  get state(): WindowState {
    return this.controller.state;
  }

  show(params: TParams): boolean {
    return this.controller.show(params);
  }

  /** Close intent with an optional business continuation (runs only if this close completes). */
  close(reason: WindowCloseReason, onClosed?: () => void): boolean {
    const continuation = onClosed ?? (() => this.onDismiss?.(reason));
    return this.controller.close(reason, continuation);
  }

  resize(width: number, height: number, options: ModalResizeOptions = {}): void {
    this.viewportWidth = Number.isFinite(width) && width > 0 ? width : 1;
    this.viewportHeight = Number.isFinite(height) && height > 0 ? height : 1;
    this.lastInsets = options.insets ?? {};
    this.pixelRatio = options.pixelRatio ?? this.pixelRatio;
    this.backdrop.clear().rect(0, 0, this.viewportWidth, this.viewportHeight).fill({ color: this.theme.colors.backdrop, alpha: this.theme.colors.backdropAlpha });
    this.backdrop.hitArea = new Rectangle(0, 0, this.viewportWidth, this.viewportHeight);
    this.layoutPanel();
    if (this.controller.state === 'shown') this.applyTransition(1);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.dispose();
    this.motion.cancelScope(this.fxScope);
    for (const button of this.buttons) button.destroy();
    this.backdrop.off('pointertap', this.onBackdropTap, this);
    super.destroy(options ?? { children: true });
  }

  // --- internals ---

  protected layoutPanel(): void {
    const bounds = this.panelBounds();
    const insets = this.lastInsets;
    const top = Math.max(0, insets.top ?? 0);
    const bottom = Math.max(0, insets.bottom ?? 0);
    const left = Math.max(0, insets.left ?? 0);
    const right = Math.max(0, insets.right ?? 0);
    const availW = Math.max(1, this.viewportWidth - left - right);
    const availH = Math.max(1, this.viewportHeight - top - bottom);
    this.fitScale = Math.min((availW * this.maxWidthRatio) / Math.max(1, bounds.width), (availH * this.maxHeightRatio) / Math.max(1, bounds.height));
    this.panel.scale.set(this.fitScale);
    this.panel.hitArea = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
    this.panelCenterY = top + availH / 2;
    this.panel.position.set(left + availW / 2 - (bounds.x + bounds.width / 2) * this.fitScale, this.panelCenterY - (bounds.y + bounds.height / 2) * this.fitScale);
    if (this.closeButton) {
      const at = this.closeButtonPosition(bounds);
      this.closeButton.position.set(at.x, at.y);
    }
    applyTextResolution(this.panel, this.fitScale * this.pixelRatio);
  }

  /** Where the × sits, in panel design units. Default: the panel's top-right corner. */
  protected closeButtonPosition(bounds: Rectangle): { x: number; y: number } {
    return { x: bounds.x + bounds.width - 36, y: bounds.y + 36 };
  }

  /** Progress is already eased; every property is a linear blend from its start to its idle value. */
  private applyTransition(progress: number): void {
    this.backdrop.alpha = Math.min(1, Math.max(0, progress));
    this.panel.alpha = Math.min(1, Math.max(0, progress));
    const bounds = this.panelBounds();
    const idleY = this.panelCenterY - (bounds.y + bounds.height / 2) * this.fitScale;
    this.panel.y = idleY + 130 * this.fitScale * (1 - progress);
    const k = 0.7 + 0.3 * progress;
    this.panel.scale.set(this.fitScale * k);
  }

  private onBackdropTap(event: FederatedPointerEvent): void {
    if (!this.closeOnBackdrop || event.target !== this.backdrop) return;
    this.close('background');
  }
}
