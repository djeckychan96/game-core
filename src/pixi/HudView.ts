import { Container, Rectangle, Sprite, type Text } from 'pixi.js';
import type { MotionHandle, MotionRuntime, UiRuntime } from '../index';
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
  /** Total stars badge (donor: third capsule with a gold star, not tappable). Omit to hide. */
  stars?: number;
  /** Text on the lives capsule when lives are full. Default `MAX`. */
  fullLivesLabel?: string;
  /** Show the gear button on the right. Default true. */
  settings?: boolean;
  /** Draw the donor's soft top shadow under the bar so it reads over any map art. Default true. */
  shadow?: boolean;
  onCoinsTap?: () => void;
  onLivesTap?: () => void;
  onStarsTap?: () => void;
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
const STAR_ICON = 112;
const GEAR_SIZE = 100;
const GEAR_BACK_RATIO = 1.45;
const LEFT_MARGIN = 60;
const RIGHT_MARGIN = 48;
const TOP_MARGIN = 83;
const SETTINGS_TOP_MARGIN = 75;
const ROW_GAP = 40;
/** Donor: the row's area is 1/20 of the viewport in portrait, 1/50 in landscape, then width-capped. */
const PORTRAIT_AREA_RATIO = 20;
const LANDSCAPE_AREA_RATIO = 50;

/** Design box of one badge: the icon square over the capsule's left edge up to the capsule's right edge. */
const BADGE_BOUNDS = new Rectangle(-ICON_BOX / 2, -ICON_BOX / 2, CAPSULE_X + CAPSULE_W / 2 + ICON_BOX / 2, Math.max(ICON_BOX, PLUS_Y + PLUS_H / 2 + ICON_BOX / 2));

/**
 * A resource badge: capsule + icon over its left edge + counter + optional "+" button.
 * The whole badge is one UiButton so the press feedback and the tap are a settled controller.
 *
 * Its bounds are DECLARED (`boundsArea` = the design box), never measured from the sprites: the icon pulses and the
 * button press scale are transient animation state, and a layout that measured them would bake the animated size
 * into the row's base geometry (a HUD that stays enlarged after a coin flight was exactly that).
 */
class ResourceBadge extends Container {
  readonly button: UiButton | null;
  readonly icon: Sprite;
  /** The icon's layout scale; a pulse is always `iconScale × factor` and settles back to it. */
  readonly iconScale: number;
  readonly countText: Text;
  readonly capsuleText: Text;
  readonly plus: Sprite | null;
  /** The one running pulse on this badge (a new pulse cancels it, so pulses never stack). */
  pulse: MotionHandle | null = null;

  constructor(options: {
    ui: UiRuntime;
    id: string;
    theme: ReadyUiTheme;
    textures: ReadyUiTextures;
    icon: 'coin' | 'heart' | 'star';
    onTap: (() => void) | null;
  }) {
    super();
    const { theme, textures } = options;
    this.boundsArea = BADGE_BOUNDS;

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

    const iconTex = options.icon === 'coin' ? textures.hudCoin : options.icon === 'star' ? textures.starGold : textures.hudHeart;
    this.icon = new Sprite(iconTex);
    this.icon.anchor.set(0.5);
    // the star art has no transparent padding: 112 gives the same visible size as the 128 icons
    const box = options.icon === 'star' ? STAR_ICON : ICON_BOX;
    const k = box / Math.max(1, Math.max(iconTex.width, iconTex.height));
    this.iconScale = k;
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
    if (options.onTap && options.icon !== 'star') {
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
  private readonly stars: ResourceBadge | null;
  private readonly gear: UiButton | null;
  private readonly fullLivesLabel: string;
  private readonly fxScope: string;

  private coinsValue: number;
  private starsValue: number;
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
    this.starsValue = Math.max(0, options.stars ?? 0);
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
    this.stars = null;
    if (options.stars !== undefined) {
      const stars = new ResourceBadge({
        ui: options.ui,
        id: `${this.id}:stars`,
        theme: this.theme,
        textures: options.textures,
        icon: 'star',
        onTap: options.onStarsTap ?? null
      });
      stars.x = BADGE_GAP * 2;
      this.row.addChild(stars);
      this.stars = stars;
    }

    this.gear = null;
    if (options.settings ?? true) {
      const gear = new UiButton({
        ui: options.ui,
        id: `${this.id}:settings`,
        theme: this.theme,
        texture: options.textures.hudGearBack,
        width: GEAR_SIZE * GEAR_BACK_RATIO,
        height: GEAR_SIZE * GEAR_BACK_RATIO * (140 / 160),
        icon: options.textures.hudGear,
        iconSize: GEAR_SIZE,
        pressScale: 0.9,
        onTap: options.onSettingsTap ?? (() => {}),
        minHitSize: 160
      });
      if (!options.onSettingsTap) gear.setEnabled(false);
      this.addChild(gear);
      this.gear = gear;
    }

    this.refreshCoins();
    this.refreshStars();
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

  get starsAmount(): number {
    return this.starsValue;
  }

  /** World position of the star icon (px) — a target for "stars fly to the counter" effects. */
  get starAnchor(): { x: number; y: number } | null {
    if (!this.stars) return null;
    const p = this.stars.icon.getGlobalPosition();
    return { x: p.x, y: p.y };
  }

  setStars(value: number, animate = true): void {
    const next = Math.max(0, Math.round(value));
    const changed = next !== this.starsValue;
    this.starsValue = next;
    this.refreshStars();
    if (changed && animate && this.stars) this.pulse(this.stars);
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
    if (changed && animate) this.pulse(this.coins);
  }

  setLives(value: number, timerText = ''): void {
    const next = Math.max(0, Math.min(this.maxLivesValue, Math.round(value)));
    const changed = next !== this.livesValue;
    this.livesValue = next;
    this.timerText = timerText;
    this.refreshLives();
    if (changed) this.pulse(this.lives);
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
    // donor: the stage is scaled by the contain-fit factor and the HUD is laid out in design units
    const s = Math.min(w / this.theme.designWidth, h / this.theme.designHeight);
    const vw = (w - left - right) / s;
    const vh = (h - top) / s;
    const portrait = vh > vw;

    this.row.scale.set(1);
    const rowBounds = this.row.getLocalBounds();
    const gearBounds = this.gear ? this.gear.getLocalBounds() : null;
    const baseArea = Math.max(1, rowBounds.width * rowBounds.height);
    const targetArea = (vw * vh) / (portrait ? PORTRAIT_AREA_RATIO : LANDSCAPE_AREA_RATIO);
    const areaScale = Math.sqrt(targetArea / baseArea);
    const rowContent = rowBounds.width + (gearBounds ? ROW_GAP + gearBounds.width * GEAR_BACK_RATIO : 0);
    const rowAvail = vw - LEFT_MARGIN - RIGHT_MARGIN;
    const rowScale = Math.min(areaScale, rowAvail / Math.max(1, rowContent));
    this.rowScale = rowScale;

    this.row.scale.set(rowScale * s);
    this.row.position.set(left + (LEFT_MARGIN - rowBounds.x * rowScale) * s, top + (TOP_MARGIN - rowBounds.y * rowScale) * s);
    if (this.gear && gearBounds) {
      this.gear.setIdleScale(rowScale * s);
      this.gear.position.set(
        w - right - (RIGHT_MARGIN + (gearBounds.x + gearBounds.width) * rowScale) * s,
        top + (SETTINGS_TOP_MARGIN - gearBounds.y * rowScale) * s
      );
    }
    // the row's top edge sits at TOP_MARGIN, so the bar ends at its bottom edge (+12 units), whatever rowBounds.y is
    this.heightPx = top + (TOP_MARGIN + rowBounds.height * rowScale + 12) * s;
    if (this.shadow) {
      this.shadow.width = w * 1.05;
      this.shadow.height = this.heightPx * 2.1;
      this.shadow.position.set(w / 2, -this.heightPx * 0.35);
    }
    const pr = options.pixelRatio ?? 1;
    applyTextResolution(this, rowScale * s * pr);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.disposed) return;
    this.disposed = true;
    this.motion.cancelScope(this.fxScope);
    this.lives.button?.destroy();
    this.coins.button?.destroy();
    this.stars?.button?.destroy();
    this.gear?.destroy();
    super.destroy(options ?? { children: true });
  }

  private refreshCoins(): void {
    this.coins.setCount(formatAmount(this.coinsValue), CAPSULE_W * 0.72);
  }

  private refreshStars(): void {
    this.stars?.setCount(formatAmount(this.starsValue), CAPSULE_W * 0.72);
  }

  private refreshLives(): void {
    this.lives.setCount(String(this.livesValue), ICON_BOX * 0.7);
    const full = this.livesValue >= this.maxLivesValue;
    this.lives.setCapsuleText(full ? this.fullLivesLabel : this.timerText);
    if (this.lives.plus) this.lives.plus.visible = !full;
  }

  /**
   * Counter feedback: the icon pops to 1.22× and settles. The base is the badge's OWN layout scale, never the sprite's
   * current (possibly animated) scale, and a badge runs one pulse at a time — a burst of updates (coins flying in one by
   * one) restarts the pop instead of stacking tweens whose captured bases would compound.
   */
  private pulse(badge: ResourceBadge): void {
    badge.pulse?.cancel();
    const icon = badge.icon;
    const base = badge.iconScale;
    const k = { v: 1 };
    const handle = this.motion.tween({
      scope: this.fxScope,
      bindings: [{ get: () => k.v, set: (v: number) => { k.v = v; icon.scale.set(base * v); }, from: 1.22, to: 1 }],
      durationMs: 260,
      ease: 'backOut',
      onComplete: () => { if (badge.pulse === handle) badge.pulse = null; icon.scale.set(base); },
      onCancel: () => { if (badge.pulse === handle) badge.pulse = null; icon.scale.set(base); }
    });
    badge.pulse = handle;
  }
}
