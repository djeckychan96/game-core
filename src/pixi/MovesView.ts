import { Container, Rectangle, Sprite, type Text } from 'pixi.js';
import type { LocalizationTextProvider } from '../index';
import type { ReadyUiTextures } from './assets';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import { resolveSkinView, selectSkinView, skinTextBoxLook, skinTextLook, type ReadyUiSkin, type ReadyUiSkinMovesLayout } from './skin';
import { applyTextResolution, createFigmaLabel, placeFigmaLabel } from './text';
import { resolveTheme, type ReadyUiTheme, type ReadyUiThemeOverrides } from './theme';

export interface MovesViewOptions {
  textures: ReadyUiTextures;
  /** Must carry a style that covers `moves` (Core has no donor moves art). */
  theme?: ReadyUiThemeOverrides;
  /** Optional structural localization provider for the caption (`core.moves.label`). */
  i18n?: LocalizationTextProvider;
  /** The caption, already localized; wins over the provider. Default `MOVES`. */
  label?: string;
  /** Moves left to show at first. Default 0. */
  remaining?: number;
  /** Start hidden (`show()` reveals it). Default false. */
  hidden?: boolean;
}

/**
 * The moves counter of a gameplay screen: the style's box with its caption (`MOVES`) and the number of moves left.
 * Visual only — it knows nothing about a move limit or a runtime: the host passes the number it wants shown
 * (`setRemaining`), shows / hides it, and places it in its own gameplay composition. Visuals come only from the
 * selected style (`theme.skin` covering `moves`: the box art, the text boxes and their looks).
 *
 * Units: design units of the style; the origin is the box centre (`boxWidth × boxHeight`), so the host positions and
 * scales the view like any other node, then calls `setResolution(onScreenScale × devicePixelRatio)` for crisp text.
 */
export class MovesView extends Container {
  readonly theme: ReadyUiTheme;
  /** The style drawing the counter. */
  readonly skin: ReadyUiSkin;
  /** The box's design size (units); the view's origin is its centre. */
  readonly boxWidth: number;
  readonly boxHeight: number;
  private readonly layout: ReadyUiSkinMovesLayout;
  private readonly caption: Text;
  private readonly count: Text;
  private value = 0;

  constructor(options: MovesViewOptions) {
    super();
    this.theme = resolveTheme(options.theme);
    const skin = selectSkinView('moves', this.theme.skin);
    if (!skin) throw new Error("MovesView needs a Ready UI style that covers 'moves' (theme.skin): Core has no donor moves art");
    const look = resolveSkinView('MovesView', 'moves', skin, options.textures);
    this.skin = skin;
    this.layout = look.layout;
    const L = this.layout;
    this.boxWidth = L.box.width;
    this.boxHeight = L.box.height;
    // box-local (top-left) → view units (origin at the box centre)
    const ox = -L.box.width / 2;
    const oy = -L.box.height / 2;

    const panel = new Sprite(look.art.movesPanel!);
    panel.position.set(ox + L.panel.x, oy + L.panel.y);
    panel.width = L.panel.width;
    panel.height = L.panel.height;
    panel.eventMode = 'none';
    // the declared box, never the art's render bounds (its shadow) nor the text: a host lays the view out by its box
    this.boundsArea = new Rectangle(ox, oy, L.box.width, L.box.height);
    this.eventMode = 'none';

    const text = skinTextLook(skin);
    const captionText = localizedText(options.label, options.i18n, 'core.moves.label', READY_UI_LEGACY_TEXT.moves);
    this.caption = createFigmaLabel(this.theme, captionText, L.label.fontSize, skinTextBoxLook(text, L.label));
    placeFigmaLabel(this.caption, { x: ox + L.label.x, y: oy + L.label.y, width: L.label.width, height: L.label.height, align: 'center' });
    this.count = createFigmaLabel(this.theme, '0', L.count.fontSize, skinTextBoxLook(text, L.count));
    this.addChild(panel, this.caption, this.count);
    this.setRemaining(options.remaining ?? 0);
    if (options.hidden) this.visible = false;
  }

  /** The number shown now. */
  get remaining(): number {
    return this.value;
  }

  /** Whether the counter is shown. */
  get shown(): boolean {
    return this.visible;
  }

  /** Shows `value` moves left (a whole number ≥ 0: a fraction is floored, a negative or non-finite value shows 0). */
  setRemaining(value: number): void {
    this.value = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    this.count.text = String(this.value);
    const L = this.layout;
    // a longer number shrinks to the box (placeFigmaLabel), it never grows past it
    placeFigmaLabel(this.count, { x: -L.box.width / 2 + L.count.x, y: -L.box.height / 2 + L.count.y, width: L.count.width, height: L.count.height, align: 'center' });
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  /** The text raster density: the view's on-screen scale × the device pixel ratio (call after the host scales it). */
  setResolution(resolution: number): void {
    applyTextResolution(this, resolution);
  }
}
