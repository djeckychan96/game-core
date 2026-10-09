import { Container, type NineSliceSprite, Rectangle, Sprite, type Text } from 'pixi.js';
import type { LocalizationTextProvider } from '../index';
import type { ReadyUiTextures } from './assets';
import { localizedText } from './localization';
import { createNineSlice, type NineSliceSpec } from './nineSlice';
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
 *
 * A style whose `movesPanel` declares 9-slice caps draws it as a 9-slice (Style 2: theme_light_9's orange tab that rises
 * from the screen's bottom edge); the host may then stretch it down to that edge with `stretchPanel` — the box, the
 * texts and the layout bounds stay where they are.
 */
export class MovesView extends Container {
  readonly theme: ReadyUiTheme;
  /** The style drawing the counter. */
  readonly skin: ReadyUiSkin;
  /** The box's design size (units); the view's origin is its centre. */
  readonly boxWidth: number;
  readonly boxHeight: number;
  /** Whether the style's panel is a 9-slice that `stretchPanel` can lengthen (a plain panel keeps its size). */
  readonly panelStretches: boolean;
  private readonly layout: ReadyUiSkinMovesLayout;
  private readonly panel: Sprite | NineSliceSprite;
  private readonly panelSlice: NineSliceSpec | null;
  private panelHeight: number;
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

    // a panel with caps (its asset's nineSlice) is a 9-slice over the panel box; otherwise the render, sized to the box
    const slice = skin.assets.movesPanel?.nineSlice ?? null;
    const panel = slice ? createNineSlice(look.art.movesPanel!, slice, L.panel.width, L.panel.height) : new Sprite(look.art.movesPanel!);
    if (!slice) {
      panel.position.set(ox + L.panel.x, oy + L.panel.y);
      panel.width = L.panel.width;
      panel.height = L.panel.height;
    }
    panel.eventMode = 'none';
    this.panel = panel;
    this.panelSlice = slice;
    this.panelStretches = slice !== null;
    this.panelHeight = L.panel.height;
    this.placePanel();
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

  /**
   * A 9-slice panel (`panelStretches`) reaches down to `bottom` — view units (the origin is the box centre), e.g. the
   * screen's bottom edge mapped into the view — never shorter than the layout's panel; `null` = the layout height again.
   * Only the panel grows (its centre band stretches, the caps stay): the box, the texts and the layout bounds keep their
   * place. A plain panel ignores it (stretching a render would distort it).
   */
  stretchPanel(bottom: number | null): void {
    if (!this.panelSlice) return;
    const L = this.layout;
    const top = -L.box.height / 2 + L.panel.y;
    const height = bottom === null || !Number.isFinite(bottom) ? L.panel.height : Math.max(L.panel.height, bottom - top);
    if (height === this.panelHeight) return;
    this.panelHeight = height;
    this.placePanel();
  }

  /** The panel's bottom edge now (view units): the layout's, or lower after `stretchPanel`. */
  get panelBottom(): number {
    return -this.layout.box.height / 2 + this.layout.panel.y + this.panelHeight;
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  /** The 9-slice panel over its box (top-left at the layout's panel box, `panelHeight` high), its bleed outside the box. */
  private placePanel(): void {
    const slice = this.panelSlice;
    if (!slice) return;
    const L = this.layout;
    const panel = this.panel as NineSliceSprite;
    const pad = slice.pad ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const fullHeight = this.panelHeight + pad.top + pad.bottom;
    panel.height = fullHeight;
    panel.anchor.y = (pad.top + this.panelHeight / 2) / fullHeight;
    panel.position.set(-L.box.width / 2 + L.panel.x + L.panel.width / 2, -L.box.height / 2 + L.panel.y + this.panelHeight / 2);
  }

  /** The text raster density: the view's on-screen scale × the device pixel ratio (call after the host scales it). */
  setResolution(resolution: number): void {
    applyTextResolution(this, resolution);
  }
}
