import { Container, Rectangle, Sprite, type Text } from 'pixi.js';
import type { MotionRuntime, UiRuntime } from '../index';
import type { ReadyUiTextures } from './assets';
import { UiButton } from './UiButton';
import { applyTextResolution, createLabel, fitLabelWidth, formatAmount } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';

export interface HudInsets {
  top?: number;
  left?: number;
  right?: number;
}

export interface HudResizeOptions {
  /** Safe-area / reserved space in viewport px. */
  insets?: HudInsets;
  pixelRatio?: number;
}

export interface HudViewOptions {
  ui: UiRuntime;
  motion: MotionRuntime;
  textures: ReadyUiTextures;
  theme?: ReadyUiThemeOverrides;
  /** Unique id per UiRuntime; buttons register as `<id>:coins`, `<id>:lives`, `<id>:settings`. */
  id?: string;
  coins?: number;
  lives?: number;
  maxLives?: number;
  /** Text on the lives capsule when lives are full. Default `MAX`. */
  fullLivesLabel?: string;
  /** Show the gear button on the right. Default true. */
  settings?: boolean;
  /** Draw the donor's soft top shadow under the bar so it reads over any map art. Default true. */
  shadow?: boolean;
  onCoinsTap?: () => void;
  onLivesTap?: () => void;
  onSettingsTap?: () => void;
  width?: number;
  height?: number;
}

/** Donor top-resource geometry (design units of the 1080-wide portrait box). */
const CAPSULE_W = 218;
const CAPSULE_H = 72;
const CAPSULE_X = 109;
const ICON_BOX = 128;
const PLUS_W = 53;
const PLUS_H = 57;
const PLUS_X = 36;
const PLUS_Y = 36;
const BADGE_GAP = 290;
const GEAR_SIZE = 100;
const ROW_SCALE = 1.05;
const LEFT_MARGIN = 60;
const RIGHT_MARGIN = 48;
const TOP_MARGIN = 83;
const ROW_GAP = 40;

/**
 * A resource badge: capsule + icon over its left edge + counter + optional "+" button.
 * The whole badge is one UiButton so the press feedback and the tap are a settled controller.
 */
class ResourceBadge extends Container {
  readonly button: UiButton | null;
  readonly icon: Sprite;
  readonly countText: Text;
  readonly capsuleText: Text;
  readonly plus: Sprite | null;

  constructor(options: {
    ui: UiRuntime;
    id: string;
    theme: ReadyUiTheme;
    textures: ReadyUiTextures;
    icon: 'coin' | 'heart';
    onTap: (() => void) | null;
  }) {
    super();
    const { theme, textures } = options;

    // Tappable badges are a UiButton whose (hidden) background spans capsule + icon; the visuals
    // are its children, so the settled press scales the whole badge from the icon center.
    this.button = null;
    let host: Container = this;
    if (options.onTap) {
      const button = new UiButton({
        ui: options.ui,
        id: options.id,
        theme,
        texture: textures.hudCapsule,
        width: CAPSULE_X + CAPSULE_W / 2 + ICON_BOX / 2,
        height: ICON_BOX,
        onTap: options.onTap,
        pressScale: 0.94
      });
      button.background.visible = false;
      button.background.x = (CAPSULE_X + CAPSULE_W / 2 - ICON_BOX / 2) / 2;
      button.hitArea = new Rectangle(-ICON_BOX / 2, -ICON_BOX / 2, CAPSULE_X + CAPSULE_W / 2 + ICON_BOX / 2, ICON_BOX);
      this.addChild(button);
      this.button = button;
      host = button;
    }

    const capsule = new Sprite(textures.hudCapsule);
    capsule.anchor.set(0.5);
    capsule.width = CAPSULE_W;
    capsule.height = CAPSULE_H;
    capsule.x = CAPSULE_X;
    host.addChild(capsule);

    const iconTex = options.icon === 'coin' ? textures.hudCoin : textures.hudHeart;
    this.icon = new Sprite(iconTex);
    this.icon.anchor.set(0.5);
    const k = ICON_BOX / Math.max(1, Math.max(iconTex.width, iconTex.height));
    this.icon.scale.set(k);
    host.addChild(this.icon);

    // the heart shows the count inside the icon; the coin shows it on the capsule
    this.countText = createLabel(theme, '0', { fontSize: options.icon === 'heart' ? 54 : 40, stroke: options.icon === 'heart' ? 5 : false });
    this.capsuleText = createLabel(theme, '', { fontSize: 40, stroke: false });
    if (options.icon === 'heart') {
      this.countText.position.set(0, -2);
      this.capsuleText.position.set(131, -3);
    } else {
      this.countText.position.set(131, -3);
      this.capsuleText.visible = false;
    }
    host.addChild(this.countText, this.capsuleText);

    this.plus = null;
    if (options.onTap) {
      const plus = new Sprite(textures.hudPlus);
      plus.anchor.set(0.5);
      plus.width = PLUS_W;
      plus.height = PLUS_H;
      plus.position.set(PLUS_X, PLUS_Y);
      host.addChild(plus);
      this.plus = plus;
    }
  }

  setCount(text: string, maxWidth: number): void {
    this.countText.text = text;
    fitLabelWidth(this.countText, maxWidth);
  }

  setCapsuleText(text: string): void {
    this.capsuleText.text = text;
    fitLabelWidth(this.capsuleText, CAPSULE_W * 0.7);
  }
}

/**
 * Top HUD — lives (heart with the count inside, timer/MAX on the capsule, "+"), coins (capsule
 * counter, "+") and a settings gear on the right, laid out along the top safe edge the way the
 * donor's main screen did. Counters animate through MotionRuntime.
 */
export class HudView extends Container {
  readonly id: string;
  readonly theme: ReadyUiTheme;
  private readonly motion: MotionRuntime;
  private readonly row: Container;
  private readonly shadow: Sprite | null;
  private readonly lives: ResourceBadge;
  private readonly coins: ResourceBadge;
  private readonly gear: UiButton | null;
  private readonly fullLivesLabel: string;
  private readonly fxScope: string;

  private coinsValue: number;
  private livesValue: number;
  private maxLivesValue: number;
  private timerText = '';
  private rowScale = 1;
  private viewportWidth = 0;
  private heightPx = 0;
  private disposed = false;

  constructor(options: HudViewOptions) {
    super();
    this.id = options.id ?? 'hud';
    this.theme = resolveTheme(options.theme);
    this.motion = options.motion;
    this.fullLivesLabel = options.fullLivesLabel ?? 'MAX';
    this.fxScope = `${this.id}:fx`;
    this.coinsValue = Math.max(0, options.coins ?? 0);
    this.maxLivesValue = Math.max(1, options.maxLives ?? 5);
    this.livesValue = Math.max(0, Math.min(this.maxLivesValue, options.lives ?? this.maxLivesValue));

    this.shadow = null;
    if (options.shadow ?? true) {
      const shadow = new Sprite(options.textures.topShadow);
      shadow.anchor.set(0.5, 0);
      shadow.eventMode = 'none';
      // the donor gradient is navy for its blue menu; tinted near-black it works on any map art
      shadow.tint = 0x0a0d18;
      shadow.alpha = 0.8;
      this.addChild(shadow);
      this.shadow = shadow;
    }
    this.row = new Container();
    this.addChild(this.row);

    this.lives = new ResourceBadge({
      ui: options.ui,
      id: `${this.id}:lives`,
      theme: this.theme,
      textures: options.textures,
      icon: 'heart',
      onTap: options.onLivesTap ?? null
    });
    this.coins = new ResourceBadge({
      ui: options.ui,
      id: `${this.id}:coins`,
      theme: this.theme,
      textures: options.textures,
      icon: 'coin',
      onTap: options.onCoinsTap ?? null
    });
    this.coins.x = BADGE_GAP;
    this.row.addChild(this.lives, this.coins);

    this.gear = null;
    if (options.settings ?? true) {
      const gear = new UiButton({
        ui: options.ui,
        id: `${this.id}:settings`,
        theme: this.theme,
        texture: options.textures.hudGearBack,
        width: GEAR_SIZE * 1.45,
        height: GEAR_SIZE * 1.45 * (140 / 160),
        icon: options.textures.hudGear,
        iconSize: GEAR_SIZE,
        onTap: options.onSettingsTap ?? (() => {}),
        minHitSize: 120
      });
      if (!options.onSettingsTap) gear.setEnabled(false);
      this.addChild(gear);
      this.gear = gear;
    }

    this.refreshCoins();
    this.refreshLives();
    this.resize(options.width ?? 390, options.height ?? 844);
  }

  /** Height in viewport px the HUD occupies from the top edge (for reserving map space). */
  get barHeight(): number {
    return this.heightPx;
  }

  get coinsAmount(): number {
    return this.coinsValue;
  }

  get livesAmount(): number {
    return this.livesValue;
  }

  /** World position of the coin icon (px) — a target for "coins fly to the bank" effects. */
  get coinAnchor(): { x: number; y: number } {
    const p = this.coins.icon.getGlobalPosition();
    return { x: p.x, y: p.y };
  }

  setCoins(value: number, animate = true): void {
    const next = Math.max(0, Math.round(value));
    const changed = next !== this.coinsValue;
    this.coinsValue = next;
    this.refreshCoins();
    if (changed && animate) this.pulse(this.coins.icon);
  }

  setLives(value: number, timerText = ''): void {
    const next = Math.max(0, Math.min(this.maxLivesValue, Math.round(value)));
    const changed = next !== this.livesValue;
    this.livesValue = next;
    this.timerText = timerText;
    this.refreshLives();
    if (changed) this.pulse(this.lives.icon);
  }

  setMaxLives(max: number): void {
    this.maxLivesValue = Math.max(1, Math.round(max));
    this.setLives(this.livesValue, this.timerText);
  }

  /** Only refreshes the capsule caption (call every second with a formatted refill timer). */
  setLivesTimer(timerText: string): void {
    this.timerText = timerText;
    this.refreshLives();
  }

  resize(width: number, height: number, options: HudResizeOptions = {}): void {
    const w = Number.isFinite(width) && width > 0 ? width : 1;
    const h = Number.isFinite(height) && height > 0 ? height : 1;
    const insets = options.insets ?? {};
    const top = Math.max(0, insets.top ?? 0);
    const left = Math.max(0, insets.left ?? 0);
    const right = Math.max(0, insets.right ?? 0);
    this.viewportWidth = w;
    const s = Math.min(w / this.theme.designWidth, h / this.theme.designHeight);

    // donor: scale by area share, then never wider than the row available on narrow phones
    const rowBounds = this.row.getLocalBounds();
    const gearW = this.gear ? this.gear.width : 0;
    const availW = w - left - right - (LEFT_MARGIN + RIGHT_MARGIN) * s;
    const contentW = rowBounds.width + (this.gear ? ROW_GAP + gearW : 0);
    const scale = Math.min(s * ROW_SCALE, availW / Math.max(1, contentW));
    this.rowScale = scale;

    this.row.scale.set(scale);
    this.row.position.set(left + LEFT_MARGIN * s - rowBounds.x * scale, top + TOP_MARGIN * s - rowBounds.y * scale);
    if (this.gear) {
      this.gear.setIdleScale(scale);
      const gb = this.gear.getLocalBounds();
      this.gear.position.set(w - right - RIGHT_MARGIN * s - (gb.x + gb.width) * scale, top + (TOP_MARGIN - 8) * s - gb.y * scale);
    }
    this.heightPx = top + TOP_MARGIN * s + (rowBounds.height + 24) * scale;
    if (this.shadow) {
      this.shadow.width = w * 1.05;
      this.shadow.height = this.heightPx * 2.1;
      this.shadow.position.set(w / 2, -this.heightPx * 0.35);
    }
    const pr = options.pixelRatio ?? 1;
    applyTextResolution(this, scale * pr);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.motion.cancelScope(this.fxScope);
    this.lives.button?.destroy();
    this.coins.button?.destroy();
    this.gear?.destroy();
    super.destroy(options ?? { children: true });
  }

  private refreshCoins(): void {
    this.coins.setCount(formatAmount(this.coinsValue), CAPSULE_W * 0.72);
  }

  private refreshLives(): void {
    this.lives.setCount(String(this.livesValue), ICON_BOX * 0.7);
    const full = this.livesValue >= this.maxLivesValue;
    this.lives.setCapsuleText(full ? this.fullLivesLabel : this.timerText);
    if (this.lives.plus) this.lives.plus.visible = !full;
  }

  private pulse(target: Sprite): void {
    const base = target.scale.x;
    const k = { v: 1 };
    this.motion.tween({
      scope: this.fxScope,
      bindings: [{ get: () => k.v, set: (v: number) => { k.v = v; target.scale.set(base * v); }, from: 1.22, to: 1 }],
      durationMs: 260,
      ease: 'backOut',
      onCancel: () => target.scale.set(base)
    });
  }
}
