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

/** Share of the viewport the panel's measured bounds may take (the donor's WindowsSystem fit). */
export interface ModalFit {
  widthRatio: number;
  heightRatio: number;
}

/** The two donor entrances: every info window pops from 0.84 / +60; the victory window from 0.7 / +130. */
export interface ModalEntrance {
  fromScale: number;
  fromY: number;
  durationMs: number;
  ease: EaseFn;
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
  /** default POP_ENTRANCE (0.84 scale, +60 y, 320 ms back.out(1.5)) */
  entrance?: Partial<ModalEntrance>;
  /** default 160 ms */
  leaveDurationMs?: number;
  /** Tap on the dim backdrop closes with reason 'background'. Default true. */
  closeOnBackdrop?: boolean;
  /** Draw the red × (donor: 51 design units). Default true. */
  closeButton?: boolean;
  /** Contain-fit ratios of the panel's measured bounds. Default 0.88 × 0.84 (donor mobile). */
  fit?: Partial<ModalFit>;
  /** Backdrop color/alpha; defaults to the theme's black 0.55. */
  backdropColor?: number;
  backdropAlpha?: number;
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

export const POP_ENTRANCE: ModalEntrance = { fromScale: 0.84, fromY: 60, durationMs: 320, ease: backOut(1.5) };
export const VICTORY_ENTRANCE: ModalEntrance = { fromScale: 0.7, fromY: 130, durationMs: 440, ease: backOut(1.9) };

/** Donor close button: a 51-unit red × whose hit area is expanded to a comfortable square. */
export const CLOSE_SIZE = 51;
const CLOSE_HIT = 150;

/**
 * Base of every Ready UI modal, laid out the way the donor's WindowsSystem did it: the dim
 * backdrop covers the viewport, the panel is composed in design units around its own origin,
 * scaled so its MEASURED bounds fit `fit.widthRatio × fit.heightRatio` of the viewport, and its
 * origin sits at the viewport center. A WindowController drives hidden → entering → shown →
 * leaving; the entrance maps progress onto alpha / y / scale from the fit scale.
 * Subclasses build content in `panel`; business callbacks always run as close() continuations.
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
  protected readonly entrance: ModalEntrance;
  protected readonly fit: ModalFit;
  protected viewportWidth = 0;
  protected viewportHeight = 0;
  protected pixelRatio = 1;
  protected insets: ModalInsets = {};
  protected fitScale = 1;
  private readonly onDismiss: ((reason: WindowCloseReason) => void) | null;
  private readonly onHiddenHook: ((reason: WindowHiddenReason) => void) | null;
  private readonly closeOnBackdrop: boolean;
  private readonly backdropColor: number;
  private readonly backdropAlpha: number;
  private readonly buttons: UiButton[] = [];
  private idleX = 0;
  private idleY = 0;
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
    this.closeOnBackdrop = options.closeOnBackdrop ?? true;
    this.backdropColor = options.backdropColor ?? this.theme.colors.backdrop;
    this.backdropAlpha = options.backdropAlpha ?? this.theme.colors.backdropAlpha;
    this.entrance = { ...POP_ENTRANCE, ...(options.entrance ?? {}) };
    this.fit = { widthRatio: 0.88, heightRatio: 0.84, ...(options.fit ?? {}) };
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
        width: CLOSE_SIZE,
        height: CLOSE_SIZE,
        minHitSize: CLOSE_HIT,
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
      enterDurationMs: this.entrance.durationMs,
      enterEase: this.entrance.ease,
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

  /** Design-unit box used for fitting. Default: the panel's measured local bounds (like the donor). */
  protected panelBounds(): Rectangle {
    const bounds = this.panel.getLocalBounds();
    return new Rectangle(bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height));
  }

  /** Hook for view cleanup on hidden (already forced back to idle). */
  protected onHiddenView(_reason: WindowHiddenReason): void {}

  /** Hook when the entrance finished. */
  protected onShown(): void {}

  /** Registers a button so hidden/destroy settle and dispose it. */
  protected addButton(button: UiButton): UiButton {
    this.buttons.push(button);
    return button;
  }

  /** A themed panel button with the donor's default label metrics (fs 62 at y −9 for 207-tall buttons). */
  protected createButton(id: string, texture: Texture, label: string, onTap: () => void, width = 439, height = 207, fontSize = 62, labelOffsetY = -9): UiButton {
    const button = new UiButton({
      ui: this.ui,
      id: `${this.id}:${id}`,
      theme: this.theme,
      texture,
      width,
      height,
      label,
      fontSize,
      labelOffsetY,
      pressScale: 0.9,
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
    this.insets = options.insets ?? {};
    this.pixelRatio = options.pixelRatio ?? this.pixelRatio;
    this.backdrop.clear().rect(0, 0, this.viewportWidth, this.viewportHeight).fill({ color: this.backdropColor, alpha: this.backdropAlpha });
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

  // --- layout ---

  /** The viewport minus insets, in px. */
  protected safeArea(): { x: number; y: number; width: number; height: number } {
    const top = Math.max(0, this.insets.top ?? 0);
    const bottom = Math.max(0, this.insets.bottom ?? 0);
    const left = Math.max(0, this.insets.left ?? 0);
    const right = Math.max(0, this.insets.right ?? 0);
    return { x: left, y: top, width: Math.max(1, this.viewportWidth - left - right), height: Math.max(1, this.viewportHeight - top - bottom) };
  }

  /** Donor fit: scale = min(maxW / boundsW, maxH / boundsH); origin at the safe-area center. */
  protected layoutPanel(): void {
    this.placeClose();
    const bounds = this.panelBounds();
    const safe = this.safeArea();
    this.fitScale = Math.min((safe.width * this.fit.widthRatio) / bounds.width, (safe.height * this.fit.heightRatio) / bounds.height);
    this.panel.scale.set(this.fitScale);
    this.panel.hitArea = new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
    this.idleX = safe.x + safe.width / 2;
    this.idleY = safe.y + safe.height / 2;
    this.panel.position.set(this.idleX, this.idleY);
    applyTextResolution(this.panel, this.fitScale * this.pixelRatio);
  }

  /** Where the × sits, in panel design units; subclasses use their donor coordinates. */
  protected closeButtonPosition(): { x: number; y: number } {
    return { x: 416, y: -437 };
  }

  protected placeClose(): void {
    if (!this.closeButton) return;
    const at = this.closeButtonPosition();
    this.closeButton.position.set(at.x, at.y);
    this.panel.setChildIndex(this.closeButton, this.panel.children.length - 1);
  }

  /** Lets a subclass override the idle placement (e.g. a full-screen window) after the base fit. */
  protected setIdle(x: number, y: number, scale: number): void {
    this.idleX = x;
    this.idleY = y;
    this.fitScale = scale;
    this.panel.scale.set(scale);
    this.panel.position.set(x, y);
  }

  /** Progress is already eased; every property is a linear blend from its start to its idle value. */
  protected applyTransition(progress: number): void {
    const p = Math.min(1, Math.max(0, progress));
    this.backdrop.alpha = p;
    this.panel.alpha = p;
    this.panel.y = this.idleY + this.entrance.fromY * this.fitScale * (1 - progress);
    this.panel.x = this.idleX;
    const k = this.entrance.fromScale + (1 - this.entrance.fromScale) * progress;
    this.panel.scale.set(this.fitScale * k);
  }

  private onBackdropTap(event: FederatedPointerEvent): void {
    if (!this.closeOnBackdrop || event.target !== this.backdrop) return;
    this.close('background');
  }
}
