import { describe, expect, it } from 'vitest';
import { advance, createKit, pointer } from './setup';
import { Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import {
  ALT_READY_UI_THEME,
  BUBBLE_READY_UI_THEME,
  DEFAULT_READY_UI_THEME,
  UI_BUTTON_ROLES,
  buttonStyleOf,
  resolveTheme,
  type ReadyUiTheme,
  type UiButtonRole,
  type UiFill
} from '../../src/pixi/theme';
import { UiPanel, UiSurface, drawAwning, drawCloseMark, drawLevelNodeWall, drawPanel, drawSurface, toFillInput } from '../../src/pixi/skin';
import { UiButton } from '../../src/pixi/UiButton';
import { ModalWindow, type ModalWindowOptions } from '../../src/pixi/ModalWindow';
import { SettingsWindowView } from '../../src/pixi/SettingsWindowView';
import { LivesWindowView } from '../../src/pixi/LivesWindowView';
import { ShopWindowView } from '../../src/pixi/ShopWindowView';
import { ResultWindowView } from '../../src/pixi/ResultWindowView';
import { StarterPackWindowView } from '../../src/pixi/StarterPackWindowView';
import { HudView } from '../../src/pixi/HudView';
import { LevelMapView } from '../../src/pixi/LevelMapView';

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

/** Every fill / stroke instruction of a Graphics: what was drawn, with which colour and alpha. */
function instructions(g: Graphics): Array<{ action: string; color: number | null; alpha: number; texture: boolean }> {
  return g.context.instructions.map((instruction) => {
    const data = instruction.data as { style?: { color?: number; alpha?: number; texture?: Texture; fill?: unknown } };
    const style = data.style ?? {};
    return { action: instruction.action, color: style.color ?? null, alpha: style.alpha ?? 1, texture: Boolean(style.fill) };
  });
}

const colorsOf = (g: Graphics): number[] => instructions(g).map((i) => i.color).filter((c): c is number => c !== null);

/** A minimal window on the base class: one themed panel with a header, one button per role, the ×. */
class ProbeWindow extends ModalWindow<void> {
  readonly buttonsByRole = new Map<UiButtonRole, UiButton>();
  readonly surface: Container;
  constructor(options: ModalWindowOptions) {
    super(options);
    this.surface = this.createPanel(968, 1070, { art: this.textures.panelPurple });
    this.panel.addChildAt(this.surface, 0);
    UI_BUTTON_ROLES.forEach((role, i) => {
      const button = this.createButton(role, role, role.toUpperCase(), () => {});
      button.position.set(0, -300 + i * 110);
      this.panel.addChild(button);
      this.buttonsByRole.set(role, button);
    });
    this.placeClose();
  }
  protected applyParams(): void {}
}

/** Five standard windows under a theme: their panel / button geometry and every colour drawn (the geometry invariant). */
function windowGeometry(theme: ReadyUiTheme): { out: Record<string, unknown>; colors: number[]; errors: unknown[] } {
  const kit = createKit();
  const views = {
    settings: new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme, onToggle: () => {}, onHome: () => {}, onRestart: () => {} }),
    lives: new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme, onRefill: () => {}, onWatchAd: () => {} }),
    shop: new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme, onBuy: () => {} }),
    result: new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme, onNext: () => {}, onRetry: () => {} }),
    starter: new StarterPackWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme, onBuy: () => {} })
  };
  views.settings.show({ sound: true, music: false, gameButtons: true, version: 'v1' });
  views.lives.show({ lives: 2, maxLives: 5, timerText: '01:00', refillPrice: 900 });
  views.shop.show({ items: [{ id: 'a', amount: 100, price: '$1' }, { id: 'b', amount: 200, price: '$2' }] });
  views.result.show({ level: 3, stars: 2, rewardCoins: 50 });
  views.starter.show({ price: '$4.99', rewards: { coins: 3500, infiniteLives: '1h', boosters: 'x3' } });
  advance(kit.core, 600);
  const out: Record<string, unknown> = {};
  const colors: number[] = [];
  for (const [name, view] of Object.entries(views)) {
    view.resize(390, 844, { insets: { top: 47, bottom: 34 }, pixelRatio: 2 });
    const panel = field<Container>(view, 'panel');
    const local = panel.getLocalBounds();
    // the rect only: a Bounds also carries the matrix of the last child it visited, which is not geometry
    const dump: Record<string, unknown> = { x: panel.x, y: panel.y, scale: +panel.scale.x.toFixed(5), bounds: { x: local.x, y: local.y, width: local.width, height: local.height } };
    const buttons = field<UiButton[]>(view, 'buttons');
    dump.buttons = buttons.map((b) => ({ x: b.x, y: b.y, w: b.boxWidth, h: b.boxHeight, hit: { ...(b.hitArea as unknown as { x: number; y: number; width: number; height: number }) }, scale: +b.scale.x.toFixed(5), role: b.role, enabled: b.enabled }));
    const visit = (node: Container): void => {
      if (node instanceof Graphics) colors.push(...colorsOf(node));
      for (const child of node.children) visit(child);
    };
    visit(panel);
    out[name] = dump;
  }
  for (const view of Object.values(views)) view.destroy();
  return { out, colors, errors: kit.uiErrors };
}

/** The local bounds of the path an instruction filled / stroked. */
function pathBounds(g: Graphics, index: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const instruction = g.context.instructions[index];
  if (!instruction) throw new Error(`no instruction ${index}`);
  const path = (instruction.data as { path: { bounds: { minX: number; minY: number; maxX: number; maxY: number } } }).path;
  const b = path.bounds;
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

describe('resolveTheme', () => {
  it('returns the default theme itself without overrides and the same theme for a resolved theme', () => {
    expect(resolveTheme()).toBe(DEFAULT_READY_UI_THEME);
    expect(resolveTheme(DEFAULT_READY_UI_THEME)).toEqual(DEFAULT_READY_UI_THEME);
    expect(resolveTheme(undefined, ALT_READY_UI_THEME)).toBe(ALT_READY_UI_THEME);
  });

  it('applies a partial override and keeps every other value of the default', () => {
    const theme = resolveTheme({ panel: { headerFill: { type: 'solid', color: 0x123456 } }, text: { fontFamily: 'Custom' } });
    expect(theme.panel.headerFill).toEqual({ type: 'solid', color: 0x123456 });
    expect(theme.panel.fill).toEqual(DEFAULT_READY_UI_THEME.panel.fill);
    expect(theme.panel.border).toEqual(DEFAULT_READY_UI_THEME.panel.border);
    expect(theme.panel.well).toEqual(DEFAULT_READY_UI_THEME.panel.well);
    expect(theme.text.fontFamily).toBe('Custom');
    expect(theme.text.fill).toBe(DEFAULT_READY_UI_THEME.text.fill);
    expect(theme.button).toEqual(DEFAULT_READY_UI_THEME.button);
    expect(theme.levelMap).toEqual(DEFAULT_READY_UI_THEME.levelMap);
  });

  it('a nested override of one role keeps the role\'s other fields and the other roles', () => {
    const theme = resolveTheme({ button: { positive: { fill: { type: 'solid', color: 0x2244ff }, pressed: { depth: null } } } });
    const positive = theme.button.positive;
    expect(positive.fill).toEqual({ type: 'solid', color: 0x2244ff });
    expect(positive.radius).toBe(DEFAULT_READY_UI_THEME.button.positive.radius);
    expect(positive.border).toEqual(DEFAULT_READY_UI_THEME.button.positive.border);
    expect(positive.depth).toEqual(DEFAULT_READY_UI_THEME.button.positive.depth);
    expect(positive.text).toBe(DEFAULT_READY_UI_THEME.button.positive.text);
    expect(positive.pressed).toEqual({ ...DEFAULT_READY_UI_THEME.button.positive.pressed, depth: null });
    expect(theme.button.danger).toEqual(DEFAULT_READY_UI_THEME.button.danger);
    expect(theme.button.reward).toEqual(DEFAULT_READY_UI_THEME.button.reward);
    // an explicit null removes a part (no border), undefined leaves it alone
    expect(resolveTheme({ panel: { border: null } }).panel.border).toBeNull();
    expect(resolveTheme({ panel: { border: undefined } } as never).panel.border).toEqual(DEFAULT_READY_UI_THEME.panel.border);
  });

  it('never mutates the base theme or the overrides, and resolves deterministically', () => {
    const before = JSON.stringify(DEFAULT_READY_UI_THEME);
    const overrides = { button: { positive: { fill: { type: 'solid', color: 0x00ff00 } as UiFill } }, panel: { radius: 10 } };
    const snapshot = JSON.stringify(overrides);
    const a = resolveTheme(overrides);
    const b = resolveTheme(overrides);
    expect(JSON.stringify(DEFAULT_READY_UI_THEME)).toBe(before);
    expect(JSON.stringify(overrides)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.button.positive).not.toBe(DEFAULT_READY_UI_THEME.button.positive);
    // the defaults are frozen: an accidental write throws in strict mode instead of leaking into the next game
    expect(() => { (DEFAULT_READY_UI_THEME.panel as { radius: number }).radius = 1; }).toThrow();
    expect(Object.isFrozen(ALT_READY_UI_THEME.button.reward)).toBe(true);
    // a resolved theme handed on as overrides (one theme object for every view) resolves to an equal theme
    expect(resolveTheme(a)).toEqual(a);
  });

  it('resolves every semantic button role, on the default and the alternative theme', () => {
    expect(UI_BUTTON_ROLES).toEqual(['primary', 'secondary', 'positive', 'danger', 'reward', 'neutral', 'disabled']);
    for (const theme of [DEFAULT_READY_UI_THEME, ALT_READY_UI_THEME]) {
      for (const role of UI_BUTTON_ROLES) {
        const style = buttonStyleOf(theme, role);
        expect(style).toBe(theme.button[role]);
        expect(['solid', 'linear-gradient']).toContain(style.fill.type);
        expect(style.radius).toBeGreaterThan(0);
        expect(typeof style.text).toBe('number');
      }
    }
    // colour is a property of the theme: the same role, another colour
    const green = DEFAULT_READY_UI_THEME.button.positive.fill as { color: number };
    const teal = ALT_READY_UI_THEME.button.positive.fill as { color: number };
    expect(green.color).not.toBe(teal.color);
    expect(DEFAULT_READY_UI_THEME.button.reward.fill.type).toBe('linear-gradient');
    expect(ALT_READY_UI_THEME.close.background).not.toBeNull();
    expect(DEFAULT_READY_UI_THEME.close.background).toBeNull();
  });
});

describe('skin primitives', () => {
  it('a solid fill is a plain colour, a gradient a local-space FillGradient (cached per colour pair)', () => {
    expect(toFillInput({ type: 'solid', color: 0xabcdef })).toEqual({ color: 0xabcdef, alpha: 1 });
    expect(toFillInput({ type: 'solid', color: 0xabcdef, alpha: 0.5 })).toEqual({ color: 0xabcdef, alpha: 0.5 });
    const a = toFillInput({ type: 'linear-gradient', from: 0xff0000, to: 0x0000ff, direction: 'vertical' }) as { fill: { textureSpace: string; end: { x: number; y: number } } };
    const b = toFillInput({ type: 'linear-gradient', from: 0xff0000, to: 0x0000ff, direction: 'vertical' }) as { fill: unknown };
    const c = toFillInput({ type: 'linear-gradient', from: 0xff0000, to: 0x0000ff, direction: 'horizontal' }) as { fill: { end: { x: number; y: number } } };
    expect(a.fill.textureSpace).toBe('local');
    expect(a.fill).toBe(b.fill);
    expect(a.fill.end).toEqual({ x: 0, y: 1 });
    expect(c.fill.end).toEqual({ x: 1, y: 0 });
    expect(c.fill).not.toBe(a.fill);
  });

  it('draws a solid surface: shadow, depth lip, body and inside border, all inside the box', () => {
    const g = new Graphics();
    drawSurface(g, -100, -50, 200, 100, { fill: { type: 'solid', color: 0x3cc026 }, radius: 30, border: { color: 0x241c2f, width: 6 }, depth: { color: 0x039438, height: 14 }, shadow: { color: 0x000000, alpha: 0.2, offsetY: 8 } });
    const drawn = instructions(g);
    expect(drawn.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'stroke']);
    expect(drawn[0]).toMatchObject({ color: 0x000000, alpha: 0.2 });
    expect(drawn[1]).toMatchObject({ color: 0x039438 });
    expect(drawn[2]).toMatchObject({ color: 0x3cc026 });
    expect(drawn[3]).toMatchObject({ action: 'stroke', color: 0x241c2f });
    const bounds = g.getLocalBounds();
    expect(bounds.x).toBeGreaterThanOrEqual(-100.01);
    expect(bounds.y).toBeGreaterThanOrEqual(-50.01);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(100.01);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(50.01);
  });

  it('draws a gradient surface through a FillGradient texture and a header/body panel with independent fills', () => {
    const g = new Graphics();
    drawSurface(g, 0, 0, 300, 120, { fill: { type: 'linear-gradient', from: 0xfec001, to: 0xfc5363, direction: 'vertical' }, radius: 20, border: null, depth: null, shadow: null });
    const gradient = instructions(g);
    expect(gradient).toHaveLength(1);
    expect(gradient[0]?.texture).toBe(true);

    const p = new Graphics();
    drawPanel(p, -484, -535, 968, 1070, {
      fill: { type: 'solid', color: 0xc0beff }, radius: 44, border: { color: 0x261a34, width: 6 }, depth: { color: 0xa8a1f1, height: 20 }, shadow: null,
      headerFill: { type: 'linear-gradient', from: 0x7354d7, to: 0x5a3fb8, direction: 'horizontal' }, headerHeight: 160, headerDivider: { color: 0x573da1, width: 14 },
      well: { fill: { type: 'solid', color: 0xa0a0f5 }, radius: 36, border: null, depth: null, shadow: null }
    });
    const panel = instructions(p);
    // depth, body, header (gradient), divider, border
    expect(panel.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'fill', 'stroke']);
    expect(panel[0]).toMatchObject({ color: 0xa8a1f1 });
    expect(panel[1]).toMatchObject({ color: 0xc0beff });
    expect(panel[2]?.texture).toBe(true);
    expect(panel[3]).toMatchObject({ color: 0x573da1 });
    expect(panel[4]).toMatchObject({ action: 'stroke', color: 0x261a34 });
    // a body-only panel (no header) skips the band; a solid header is a plain colour
    const q = new Graphics();
    drawPanel(q, 0, 0, 100, 100, { ...DEFAULT_READY_UI_THEME.panel, headerFill: null });
    expect(instructions(q).map((i) => i.action)).toEqual(['fill', 'fill', 'stroke']);
    const r = new Graphics();
    drawPanel(r, 0, 0, 100, 100, DEFAULT_READY_UI_THEME.panel, 40);
    expect(instructions(r)[2]).toMatchObject({ color: 0x7354d7 });
  });

  it('UiPanel / UiSurface redraw only on a real change and declare their box as bounds', () => {
    const panel = new UiPanel({ style: DEFAULT_READY_UI_THEME.panel, width: 968, height: 1070 });
    expect(panel.redrawCount).toBe(1);
    expect(panel.getLocalBounds()).toMatchObject({ x: -484, y: -535, width: 968, height: 1070 });
    panel.resize(968, 1070);
    expect(panel.redrawCount).toBe(1);
    panel.resize(968, 800);
    expect(panel.redrawCount).toBe(2);
    expect(panel.getLocalBounds()).toMatchObject({ y: -400, height: 800 });
    panel.setStyle(DEFAULT_READY_UI_THEME.panel);
    expect(panel.redrawCount).toBe(2);
    panel.setStyle(ALT_READY_UI_THEME.panel);
    expect(panel.redrawCount).toBe(3);
    expect(colorsOf(panel.graphics)).toContain(0x1f6fd8);

    const badge = new UiSurface({ style: DEFAULT_READY_UI_THEME.badge.neutral, width: 218, height: 72, shape: 'capsule' });
    expect(badge.redrawCount).toBe(1);
    // the shadow sits inside the declared box: bounds are exactly the box even though a shadow is drawn
    expect(badge.getLocalBounds()).toMatchObject({ x: -109, y: -36, width: 218, height: 72 });
    badge.setStyle(DEFAULT_READY_UI_THEME.badge.info, 'ribbon');
    expect(badge.redrawCount).toBe(2);
    const card = new UiSurface({ style: DEFAULT_READY_UI_THEME.card, width: 318, height: 418 });
    expect(instructions(card.graphics).map((i) => i.action)).toEqual(['fill', 'fill', 'stroke', 'fill']);
  });

  it('the close mark draws the outline under the arms, an optional backing, and a pressed variant', () => {
    const plain = new Graphics();
    drawCloseMark(plain, 51, DEFAULT_READY_UI_THEME.close);
    const marks = instructions(plain);
    expect(marks.map((i) => i.action)).toEqual(['stroke', 'stroke']);
    expect(marks[0]).toMatchObject({ color: 0x241c2f });
    expect(marks[1]).toMatchObject({ color: 0xffffff });
    const disc = new Graphics();
    drawCloseMark(disc, 51, ALT_READY_UI_THEME.close);
    const alt = instructions(disc);
    expect(alt.map((i) => i.action)).toEqual(['fill', 'stroke', 'stroke']);
    expect(alt[0]).toMatchObject({ color: 0xe8f3ff });
    expect(alt[2]).toMatchObject({ color: 0x10233f });
    const pressed = new Graphics();
    drawCloseMark(pressed, 51, ALT_READY_UI_THEME.close, true);
    expect(instructions(pressed)[0]).toMatchObject({ color: 0xbfd9f7 });
  });
});

describe('Bubble skin primitives (V1.1)', () => {
  const plain = { fill: { type: 'solid', color: 0x3cc026 } as UiFill, radius: 30, border: null, depth: null, shadow: null };

  it('a strip lip and a gloss band are strips of the body outline; a soft shadow stacks layers; the plate lip is unchanged', () => {
    const g = new Graphics();
    drawSurface(g, 0, 0, 200, 100, { ...plain, border: { color: 0x111111, width: 4 }, depth: { color: 0x222222, height: 20, style: 'strip' }, shadow: { color: 0x000000, alpha: 0.3, offsetY: 9, layers: 3 }, highlight: { color: 0xeeeeee, height: 24, alpha: 0.8 } });
    const drawn = instructions(g);
    // three shadow layers, the body, the lip strip, the gloss, the border
    expect(drawn.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'stroke']);
    for (let i = 0; i < 3; i++) {
      expect(drawn[i]).toMatchObject({ color: 0x000000 });
      expect(drawn[i]?.alpha).toBeCloseTo(0.1, 6);
      expect(pathBounds(g, i).minY).toBeCloseTo(3 * (i + 1), 6);
    }
    expect(drawn[3]).toMatchObject({ color: 0x3cc026 });
    expect(drawn[4]).toMatchObject({ color: 0x222222 });
    expect(drawn[5]).toMatchObject({ color: 0xeeeeee, alpha: 0.8 });
    // the body is 91 tall (the shadow's 9 stay inside the box): the lip is its bottom 20, the gloss its top 24
    expect(pathBounds(g, 3)).toMatchObject({ minY: 0, maxY: 91 });
    expect(pathBounds(g, 4)).toMatchObject({ minY: 71, maxY: 91 });
    expect(pathBounds(g, 5)).toMatchObject({ minY: 0, maxY: 24 });
    // everything inside the box
    const bounds = g.getLocalBounds();
    expect(bounds.x).toBeGreaterThanOrEqual(-0.01);
    expect(bounds.y).toBeGreaterThanOrEqual(-0.01);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(200.01);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(100.01);

    // V1 plate lip: still depth first, then the smaller body; no gloss without a highlight
    const v1 = new Graphics();
    drawSurface(v1, 0, 0, 200, 100, { ...plain, depth: { color: 0x222222, height: 20 } });
    expect(instructions(v1).map((i) => [i.action, i.color])).toEqual([['fill', 0x222222], ['fill', 0x3cc026]]);
    expect(pathBounds(v1, 1)).toMatchObject({ minY: 0, maxY: 80 });
    // a top strip lip
    const top = new Graphics();
    drawSurface(top, 0, 0, 200, 100, { ...plain, depth: { color: 0x222222, height: 10, edge: 'top', style: 'strip' } });
    expect(pathBounds(top, 1).minY).toBeCloseTo(0, 6);
    expect(pathBounds(top, 1).maxY).toBeCloseTo(10, 6);
  });

  it('a strip shorter than the corner radius is cut by the corner arcs (it never pokes out of the rounded outline)', () => {
    const g = new Graphics();
    drawSurface(g, 0, 0, 200, 100, { ...plain, radius: 40, highlight: { color: 0xffffff, height: 10 } });
    const gloss = pathBounds(g, 1);
    // r = 40, h = 10: the strip starts where the arc is 10 below the top — 40 − 40·sin(acos(30/40)) ≈ 13.5 in from each side
    expect(gloss.minY).toBeCloseTo(0, 3);
    expect(gloss.maxY).toBeCloseTo(10, 3);
    expect(gloss.minX).toBeGreaterThan(13);
    expect(gloss.minX).toBeLessThan(14.5);
    expect(gloss.maxX).toBeGreaterThan(185.5);
    expect(gloss.maxX).toBeLessThan(187);
    const lip = new Graphics();
    drawSurface(lip, 0, 0, 200, 100, { ...plain, radius: 40, depth: { color: 0x222222, height: 10, style: 'strip' } });
    const strip = pathBounds(lip, 1);
    expect(strip.minY).toBeCloseTo(90, 3);
    expect(strip.maxY).toBeCloseTo(100, 3);
    expect(strip.minX).toBeGreaterThan(13);
    expect(strip.maxX).toBeLessThan(187);
    // a capsule's strips use its half-height corners; a strip as tall as the body is the body
    const capsule = new Graphics();
    drawSurface(capsule, 0, 0, 218, 72, { ...plain, radius: -1, highlight: { color: 0xffffff, height: 100 } }, 'capsule');
    expect(pathBounds(capsule, 1)).toMatchObject({ minX: 0, minY: 0, maxX: 218, maxY: 72 });
  });

  it('the tab shape has rounded top corners over a flat bottom; the ribbon strips follow the notches', () => {
    const tab = new Graphics();
    drawSurface(tab, 0, 0, 200, 80, { ...plain, radius: 30, depth: { color: 0x222222, height: 10, style: 'strip' }, highlight: { color: 0xffffff, height: 10 } }, 'tab');
    const drawn = instructions(tab);
    expect(drawn.map((i) => i.action)).toEqual(['fill', 'fill', 'fill']);
    expect(pathBounds(tab, 0)).toMatchObject({ minX: 0, minY: 0, maxX: 200, maxY: 80 });
    // the bottom strip of a tab is the full width (flat edge), the top strip is cut by the corners
    expect(pathBounds(tab, 1)).toMatchObject({ minX: 0, minY: 70, maxX: 200, maxY: 80 });
    expect(pathBounds(tab, 2).minX).toBeGreaterThan(5);
    const ribbon = new Graphics();
    drawSurface(ribbon, 0, 0, 1000, 116, { ...plain, radius: 16, depth: { color: 0x222222, height: 14, style: 'strip' }, highlight: { color: 0xffffff, height: 16 } }, 'ribbon');
    const notch = Math.min(116 * 0.35, 1000 * 0.08);
    const lip = pathBounds(ribbon, 1);
    expect(lip).toMatchObject({ minX: 0, maxX: 1000, maxY: 116 });
    expect(lip.minY).toBeCloseTo(102, 3);
    const gloss = pathBounds(ribbon, 2);
    expect(gloss).toMatchObject({ minX: 0, minY: 0, maxX: 1000 });
    expect(gloss.maxY).toBeCloseTo(16, 3);
    expect(notch).toBeGreaterThan(0);
    // a UiSurface takes the tab shape and the theme's tab tokens
    const active = new UiSurface({ style: BUBBLE_READY_UI_THEME.tab.active, width: 300, height: 120, shape: 'tab' });
    expect(active.getLocalBounds()).toMatchObject({ x: -150, y: -60, width: 300, height: 120 });
    // a smooth body and a soft gloss are gradient textures; the outline is the one flat colour
    expect(instructions(active.graphics).map((i) => [i.action, i.texture])).toEqual([['fill', true], ['fill', true], ['stroke', false]]);
    expect(colorsOf(active.graphics)).toEqual([0xffffff, 0xffffff, 0x2c3f78]); // a texture fill carries a white tint
    expect(resolveTheme({ tab: { activeText: 0x123456 } }).tab).toEqual({ ...DEFAULT_READY_UI_THEME.tab, activeText: 0x123456 });
    expect(resolveTheme({ tab: { active: { highlight: null } } }, BUBBLE_READY_UI_THEME).tab.active.highlight).toBeNull();
  });

  it('the awning is stripes ending in scallops, a whole number across the width, inside the box; the Shop draws it instead of the tiles', () => {
    const g = new Graphics();
    drawAwning(g, -195, 0, 390, 119, { fillA: { type: 'solid', color: 0xbfd6f6 }, fillB: { type: 'solid', color: 0x5f88ce }, segments: 5, gloss: null, shadow: { color: 0x000000, alpha: 0.3, offsetY: 12, layers: 2 } });
    const drawn = instructions(g);
    // 2 shadow layers (one fill each), then the 5 stripes
    expect(drawn.map((i) => i.action)).toEqual(Array(7).fill('fill'));
    expect(drawn[0]?.alpha).toBeCloseTo(0.15, 6);
    expect(drawn.slice(2).map((i) => i.color)).toEqual([0xbfd6f6, 0x5f88ce, 0xbfd6f6, 0x5f88ce, 0xbfd6f6]);
    const first = pathBounds(g, 2);
    expect(first.minX).toBeCloseTo(-195, 6);
    expect(first.maxX).toBeCloseTo(-195 + 78, 6);
    expect(first.maxY).toBeCloseTo(119 - 12, 6);
    const last = pathBounds(g, 6);
    expect(last.maxX).toBeCloseTo(195, 6);
    // gradient stripes are textures mapped onto each stripe; the gloss is one soft band over the straight part
    const glossy = new Graphics();
    drawAwning(glossy, 0, 0, 390, 60, BUBBLE_READY_UI_THEME.awning as NonNullable<typeof BUBBLE_READY_UI_THEME.awning>);
    const drawnGlossy = instructions(glossy);
    expect(drawnGlossy).toHaveLength(2 + 7 + 1);
    expect(drawnGlossy.slice(2, 9).every((i) => i.texture)).toBe(true);
    expect(drawnGlossy[9]?.texture).toBe(true);
    const glossBounds = pathBounds(glossy, 9);
    expect(glossBounds).toMatchObject({ minX: 0, minY: 0, maxX: 390 });
    expect(glossBounds.maxY).toBeLessThanOrEqual(60 - 12 - 390 / 14 + 0.01);
    const bounds = g.getLocalBounds();
    expect(bounds.x).toBeGreaterThanOrEqual(-195.01);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(195.01);
    expect(bounds.y).toBeGreaterThanOrEqual(-0.01);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(119.01);

    const kit = createKit();
    const bubble = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme: BUBBLE_READY_UI_THEME, onBuy: () => {} });
    bubble.resize(390, 844, { insets: { top: 47, bottom: 34 } });
    const awning = field<Graphics>(bubble, 'awning');
    expect(awning).toBeInstanceOf(Graphics);
    expect(field<Sprite[]>(bubble, 'headerTiles')).toHaveLength(0);
    // 2 shadow layers, 7 gradient stripes, the soft gloss
    expect(instructions(awning).filter((i) => i.texture)).toHaveLength(8);
    expect(instructions(awning)).toHaveLength(10);
    const redraws = awning.context.instructions.length;
    bubble.resize(390, 844, { insets: { top: 47, bottom: 34 } });
    expect(awning.context.instructions.length).toBe(redraws); // same size: not rebuilt
    bubble.destroy();
    const plain = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: () => {} });
    plain.resize(390, 844);
    expect((plain as unknown as { awning: unknown }).awning).toBeNull();
    expect(field<Sprite[]>(plain, 'headerTiles').length).toBeGreaterThan(0);
    plain.destroy();
    const art = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme: resolveTheme({ skin: 'art' }, BUBBLE_READY_UI_THEME), onBuy: () => {} });
    expect((art as unknown as { awning: unknown }).awning).toBeNull();
    art.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('level-map nodes: `theme.levelNode` builds a layered node (ring + side base, a cap with the number, a themed rail, no glow) with the badge geometry; the V1 themes keep the badge art', () => {
    type NodeProbe = { state: 'completed' | 'current' | 'locked'; root: Container; inner: Container; label: Container; stars: Container[]; lock: Container | null; base: Graphics | null; wall: Graphics | null; cap: Container | null; capSize: number; innerRadius: number; restElevation: number; elevation: number };
    const build = (theme: ReadyUiTheme) => {
      const kit = createKit();
      const map = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme, levels: [{ index: 1, stars: 3 }, { index: 2, stars: 2 }, { index: 3, stars: 0 }, { index: 4, stars: 0 }], currentLevel: 3, onSelectLevel: () => {} });
      map.resize(390, 844, { insets: { top: 47, bottom: 120 }, pixelRatio: 2 });
      const nodes = field<Map<number, NodeProbe>>(map, 'nodes');
      const facts = [...nodes.values()].map((n) => ({ node: n, state: n.state, y: +n.root.y.toFixed(3), hit: { ...(n.root.hitArea as unknown as { x: number; y: number; width: number; height: number }) }, first: n.inner.children[0] as Container }));
      return { kit, map, facts, rail: field<Container>(map, 'railLayer').children, shine: field<Sprite>(map, 'shine') };
    };
    const bubble = build(BUBBLE_READY_UI_THEME);
    const plain = build(DEFAULT_READY_UI_THEME);
    expect(bubble.facts.length).toBe(4);
    expect(bubble.facts.map((f) => f.state)).toEqual(plain.facts.map((f) => f.state));
    expect(bubble.facts.map((f) => [f.y, f.hit])).toEqual(plain.facts.map((f) => [f.y, f.hit]));
    const skin = BUBBLE_READY_UI_THEME.levelNode as NonNullable<typeof BUBBLE_READY_UI_THEME.levelNode>;
    const D = BUBBLE_READY_UI_THEME.levelMap.badgeSize;
    const innerRadius = D / 2 - D * skin.ringRatio;
    const capSize = 2 * (innerRadius - D * skin.capInset);
    const rest = skin.restElevation * capSize;
    expect(rest).toBeGreaterThan(0);
    for (const f of bubble.facts) {
      const n = f.node;
      // a piston: the still base, the wall, the cap — in that order
      expect(n.base).toBeInstanceOf(Graphics);
      expect(n.wall).toBeInstanceOf(Graphics);
      expect(n.cap).toBeInstanceOf(Container);
      expect(n.inner.children.slice(0, 3)).toEqual([n.base, n.wall, n.cap]);
      expect(n.capSize).toBeCloseTo(capSize, 6);
      expect(n.innerRadius).toBeCloseTo(innerRadius, 6);
      const disc = (n.cap as Container).children[0] as UiSurface;
      expect(disc).toBeInstanceOf(UiSurface);
      expect(disc.getLocalBounds()).toMatchObject({ x: -capSize / 2, y: -capSize / 2, width: capSize, height: capSize });
      // at rest the cap already sits its rest elevation above the floor and the wall reaches up to it: a visible rim
      expect(n.restElevation).toBeCloseTo(rest, 6);
      expect(n.elevation).toBeCloseTo(rest, 6);
      expect((n.cap as Container).y).toBeCloseTo(-rest, 6);
      const wallBounds = pathBounds(n.wall as Graphics, 0);
      expect(wallBounds.minY).toBeCloseTo(-rest, 3);
      expect(wallBounds.maxY).toBeCloseTo(capSize / 2, 3);
      expect(Math.abs(wallBounds.minX)).toBeCloseTo(capSize / 2, 3);
      expect(instructions(n.wall as Graphics)).toHaveLength(1);
      // the number (and the stars) sit on the cap; the base carries 2 shadow layers, the ring and the floor
      expect((n.cap as Container).children).toContain(n.label);
      for (const star of n.stars) expect((n.cap as Container).children).toContain(star);
      const drawn = instructions(n.base as Graphics);
      expect(drawn.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'fill']);
      const ringFill = ((n.base as Graphics).context.instructions[2]?.data as { style: { fill: unknown } }).style.fill;
      const expectedRing = n.state === 'current' ? skin.selectedRing : skin[n.state].ring; // level 3 is the focused one
      expect(ringFill).toBe((toFillInput(expectedRing) as { fill: unknown }).fill);
      expect(drawn[3]).toMatchObject({ color: (skin[n.state].base as { color: number }).color });
      expect(n.lock).toBeNull(); // Bubble: no lock icon
    }
    expect(bubble.facts[0]?.node.stars).toHaveLength(3);
    // the themed rail: one bar per gap, bright up to the current level (3), dark ahead
    expect(bubble.rail).toHaveLength(3);
    expect(bubble.rail.every((seg) => seg instanceof Graphics)).toBe(true);
    expect(bubble.rail.map((seg) => colorsOf(seg as Graphics)[0])).toEqual([0x3fa9ff, 0x3fa9ff, 0x232c48]);
    expect(bubble.shine.visible).toBe(false);
    // the default theme: the badge art, the lock, the rail art, the glow
    for (const f of plain.facts) {
      expect(f.first).toBeInstanceOf(Sprite);
      expect(f.node.cap).toBeNull();
      expect(f.node.base).toBeNull();
      expect(f.node.wall).toBeNull();
      expect(f.node.elevation).toBe(0);
    }
    expect((plain.facts[2]?.first as Sprite).texture).toBe(plain.kit.textures.badgeCurrent);
    expect(plain.facts[3]?.node.lock).not.toBeNull();
    expect(plain.rail.every((seg) => seg instanceof Sprite)).toBe(true);
    expect(plain.shine.visible).toBe(true);
    bubble.map.destroy();
    plain.map.destroy();
    const art = build(resolveTheme({ skin: 'art' }, BUBBLE_READY_UI_THEME));
    for (const f of art.facts) expect(f.first).toBeInstanceOf(Sprite);
    art.map.destroy();
    expect(bubble.kit.uiErrors).toEqual([]);
  });

  it('level-map selection lift: the cap rises by a quarter of its diameter over its rest elevation once the map settles, the wall follows it, it returns to rest, runs once per real change, cancels on a quick re-selection, never leaves an offset', () => {
    type NodeProbe = { root: Container; base: Graphics | null; wall: Graphics | null; cap: Container | null; capSize: number; restElevation: number; elevation: number };
    const kit = createKit();
    const levels = Array.from({ length: 6 }, (_, i) => ({ index: i + 1, stars: i < 3 ? 3 : 0 }));
    const map = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme: BUBBLE_READY_UI_THEME, levels, currentLevel: 4, onSelectLevel: () => {} });
    map.resize(390, 844, { insets: { top: 47, bottom: 120 }, pixelRatio: 2 });
    const nodes = () => field<Map<number, NodeProbe>>(map, 'nodes');
    const nodeOf = (level: number) => nodes().get(level) as NodeProbe;
    const elev = (level: number) => nodeOf(level).elevation;
    const skin = BUBBLE_READY_UI_THEME.levelNode as NonNullable<typeof BUBBLE_READY_UI_THEME.levelNode>;
    const rest = nodeOf(4).restElevation;
    const rise = nodeOf(4).capSize * skin.lift; // 252 × 0.25 = 63 node units on top of the 20.16 rest
    expect(rest).toBeCloseTo(0.08 * 252, 6);
    expect(rise).toBeCloseTo(63, 6);
    /** The wall is drawn exactly up to the cap: its top edge is the cap's elevation, its bottom the floor's rim. */
    const wallFollowsCap = (level: number): void => {
      const n = nodeOf(level);
      const bounds = pathBounds(n.wall as Graphics, 0);
      expect(bounds.minY).toBeCloseTo(-n.elevation, 3);
      expect(bounds.maxY).toBeCloseTo(n.capSize / 2, 3);
      expect((n.cap as Container).y).toBeCloseTo(-n.elevation, 6);
    };
    // the initial focus is not a selection change: nothing lifts, but the cap already rests above the floor
    advance(kit.core, 600);
    expect(elev(4)).toBeCloseTo(rest, 6);
    wallFollowsCap(4);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    // an instant scroll to another level: the map is in place, the cap lifts at once — fast up, softer down
    map.scrollToLevel(2, false);
    const node2 = nodeOf(2);
    const root2y = node2.root.y;
    const hit2 = { ...(node2.root.hitArea as unknown as { x: number; y: number; width: number; height: number }) };
    const base2 = instructions(node2.base as Graphics).length;
    advance(kit.core, 100);
    expect(elev(2)).toBeGreaterThan(rest + 30);
    wallFollowsCap(2);
    advance(kit.core, 70);
    expect(elev(2)).toBeCloseTo(rest + rise, 3);
    wallFollowsCap(2);
    advance(kit.core, 150);
    expect(elev(2)).toBeGreaterThan(rest);
    expect(elev(2)).toBeLessThan(rest + rise);
    wallFollowsCap(2);
    advance(kit.core, 150);
    expect(elev(2)).toBeCloseTo(rest, 6); // back to REST, not to a flat zero
    wallFollowsCap(2);
    // only the cap and the wall moved: the root, the hit area and the base are exactly as before
    expect(node2.root.y).toBe(root2y);
    expect({ ...(node2.root.hitArea as unknown as { x: number; y: number; width: number; height: number }) }).toEqual(hit2);
    expect(instructions(node2.base as Graphics)).toHaveLength(base2);
    expect((node2.base as Graphics).y).toBe(0);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    // idle: no repeat
    advance(kit.core, 3000);
    expect(elev(2)).toBeCloseTo(rest, 6);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    // the same level again: not a change, no lift
    map.scrollToLevel(2, false);
    advance(kit.core, 100);
    expect(elev(2)).toBeCloseTo(rest, 6);
    // a quick re-selection cancels the running lift and puts the cap back at its rest at once
    map.scrollToLevel(3, false);
    advance(kit.core, 60);
    expect(elev(3)).toBeGreaterThan(rest);
    map.scrollToLevel(5, false);
    expect(elev(3)).toBeCloseTo(rest, 6);
    wallFollowsCap(3);
    advance(kit.core, 60);
    expect(elev(5)).toBeGreaterThan(rest);
    // a resize mid-lift: every cap is at its rest elevation, nothing lifts by itself
    map.resize(400, 900, { insets: { top: 47, bottom: 120 }, pixelRatio: 2 });
    for (const n of nodes().values()) { expect(n.elevation).toBeCloseTo(n.restElevation, 6); expect(n.restElevation).toBeGreaterThan(0); }
    advance(kit.core, 1000);
    for (const n of nodes().values()) expect(n.elevation).toBeCloseTo(n.restElevation, 6);
    // an animated scroll lifts only once the map has settled
    map.scrollToLevel(1, true);
    advance(kit.core, 100);
    for (const n of nodes().values()) expect(n.elevation).toBeCloseTo(n.restElevation, 6);
    advance(kit.core, 700); // the scroll (≤ 650 ms) is over, the lift is on its way up
    expect(elev(1)).toBeGreaterThan(rest);
    wallFollowsCap(1);
    advance(kit.core, 600);
    expect(elev(1)).toBeCloseTo(rest, 6);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    // cancelAll mid-lift: the cap is back at its rest at once
    map.scrollToLevel(4, false);
    advance(kit.core, 80);
    expect(elev(4)).toBeGreaterThan(rest);
    kit.core.cancelAll();
    expect(elev(4)).toBeCloseTo(rest, 6);
    wallFollowsCap(4);
    map.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('a raised face (the 3D button): the body shows under the face as a rounded thickness inside the outline; the press lowers the face', () => {
    const primary = BUBBLE_READY_UI_THEME.button.primary;
    expect(primary.face).not.toBeNull();
    expect(primary.depth).toBeNull();
    const g = new Graphics();
    drawSurface(g, 0, 0, 522, 228, primary);
    const drawn = instructions(g);
    // 3 shadow layers, the body, the face, the face gloss, the gold outline
    expect(drawn.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'fill', 'stroke']);
    expect(drawn[3]?.texture).toBe(true);
    expect(drawn[4]?.texture).toBe(true);
    expect(drawn[6]).toMatchObject({ color: 0xe8b83c });
    const bodyHeight = 228 - 12;
    const edge = 8 + 2;
    const face = pathBounds(g, 4);
    expect(face.minX).toBeCloseTo(edge, 3);
    expect(face.maxX).toBeCloseTo(522 - edge, 3);
    expect(face.minY).toBeCloseTo(edge, 3);
    expect(face.maxY).toBeCloseTo(bodyHeight - edge - 22, 3); // the thickness: 22 of body under the face, inside the outline
    expect(pathBounds(g, 3)).toMatchObject({ minX: 0, minY: 0, maxX: 522, maxY: bodyHeight });
    // the wall of a node: at rest a low rim, at a lift a wall up to the cap, clipped by the floor's circle
    const wall = new Graphics();
    drawLevelNodeWall(wall, 126, 132, 20, { type: 'solid', color: 0x2c8a1b });
    expect(pathBounds(wall, 0)).toMatchObject({ minX: -126, minY: -20, maxX: 126, maxY: 126 });
    const high = new Graphics();
    drawLevelNodeWall(high, 126, 132, 83, { type: 'solid', color: 0x2c8a1b });
    const hb = pathBounds(high, 0);
    expect(hb.minY).toBeCloseTo(-83, 3);
    expect(hb.maxY).toBeCloseTo(126, 3);
    expect(hb.maxX).toBeLessThanOrEqual(132.01); // never outside the floor's circle
    // a pressed primary button lowers its face
    const kit = createKit();
    const button = new UiButton({ ui: kit.ui, id: 'p', theme: BUBBLE_READY_UI_THEME, role: 'primary', width: 522, height: 228, label: 'PLAY', onTap: () => {} });
    const top = -228 / 2; // a button's skin is drawn around its centre
    expect(pathBounds(button.skin as Graphics, 4).maxY).toBeCloseTo(top + bodyHeight - edge - 22, 3);
    button.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 80);
    expect(button.isPressed).toBe(true);
    expect(pathBounds(button.skin as Graphics, 4).maxY).toBeCloseTo(top + bodyHeight - edge - 6, 3);
    button.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('BUBBLE theme: every role is a gradient with a gloss band, a strip lip and a soft shadow; the pressed look drops the gloss and the lip', () => {
    expect(Object.isFrozen(BUBBLE_READY_UI_THEME.button.positive)).toBe(true);
    for (const role of UI_BUTTON_ROLES) {
      const style = buttonStyleOf(BUBBLE_READY_UI_THEME, role);
      expect(style.fill.type).toBe('linear-gradient');
      // every role has a gloss and a flat strip lip except the screen CTA (primary: a raised face in a gold outline, its gloss on the face, no lip)
      if (role === 'primary') {
        expect(style.depth).toBeNull();
        expect(style.face?.highlight).not.toBeNull();
      } else {
        expect(style.highlight).not.toBeNull();
        expect(style.depth?.style).toBe('strip');
      }
      expect(style.shadow?.layers).toBeGreaterThan(1);
      expect(style.radius).toBeGreaterThan(0);
    }
    expect(BUBBLE_READY_UI_THEME.panel.well.highlight).not.toBeNull();
    expect(BUBBLE_READY_UI_THEME.panel.headerFill).toEqual({ type: 'solid', color: 0xffffff, alpha: 0.08 });
    expect(BUBBLE_READY_UI_THEME.card.inset).toBeNull();
    expect(BUBBLE_READY_UI_THEME.card.depth?.height).toBe(98);
    expect(BUBBLE_READY_UI_THEME.card.depth?.fill?.type).toBe('linear-gradient');
    expect(BUBBLE_READY_UI_THEME.close.background).toBeNull();
    expect(BUBBLE_READY_UI_THEME.levelMap).toEqual(DEFAULT_READY_UI_THEME.levelMap);
    // V1.2: the three layers are independent — a three-stop smooth body, a soft gloss (fades), a flat lip
    const positive = BUBBLE_READY_UI_THEME.button.positive;
    expect(positive.fill.type === 'linear-gradient' && positive.fill.stops?.length).toBe(3);
    expect(positive.highlight?.soft).toBeGreaterThan(0);
    expect(positive.depth?.style).toBe('strip');
    expect(BUBBLE_READY_UI_THEME.levelNode?.current.cap.fill.type).toBe('radial-gradient');
    expect(BUBBLE_READY_UI_THEME.button.primary.depth).toBeNull(); // PLAY: one smooth body in a gold outline, no lip
    expect(BUBBLE_READY_UI_THEME.text.numberFill?.type).toBe('linear-gradient');

    const kit = createKit();
    const button = new UiButton({ ui: kit.ui, id: 'b', theme: BUBBLE_READY_UI_THEME, role: 'positive', label: 'GO', onTap: () => {} });
    // 2 shadow layers, body (gradient), lip (flat), gloss (a fading gradient), border
    const idle = instructions(button.skin as Graphics);
    expect(idle.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'stroke']);
    expect(idle[2]?.texture).toBe(true);
    expect(idle[3]).toMatchObject({ color: 0x1f8f14 });
    expect(idle[4]?.texture).toBe(true);
    expect((button.labelText as Text).style.fill).toBe(0xfff6e2);
    button.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 80);
    expect(button.isPressed).toBe(true);
    // pressed: the flat bottom colour, no lip, no gloss — the shadow and the border stay
    const pressed = instructions(button.skin as Graphics);
    expect(pressed.map((i) => i.action)).toEqual(['fill', 'fill', 'fill', 'stroke']);
    expect(pressed[2]).toMatchObject({ color: 0x2fa61a });
    button.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 300);
    expect(instructions(button.skin as Graphics)).toHaveLength(6);
    button.setEnabled(false);
    expect(colorsOf(button.skin as Graphics)).toContain(0x666e84);
    button.destroy();
    // a pressed override may keep the gloss (omitted) or replace it
    const keep = new UiButton({ ui: kit.ui, id: 'k', theme: BUBBLE_READY_UI_THEME, role: 'positive', style: { ...BUBBLE_READY_UI_THEME.button.positive, shadow: null, pressed: { fill: { type: 'solid', color: 0x111111 } } }, onTap: () => {} });
    keep.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 80);
    expect(instructions(keep.skin as Graphics).map((i) => [i.action, i.texture, i.color])).toEqual([['fill', false, 0x111111], ['fill', false, 0x1f8f14], ['fill', true, 0xffffff], ['stroke', false, 0x1a6e10]]);
    keep.destroy();
    expect(kit.uiErrors).toEqual([]);
  });
});

describe('UiButton skin', () => {
  it('a role button draws the theme\'s style once, the pressed look past half press, and settles back', () => {
    const kit = createKit();
    const theme = resolveTheme();
    const taps: number[] = [];
    const button = new UiButton({ ui: kit.ui, id: 'b', theme, role: 'positive', label: 'BUY', onTap: () => taps.push(1) });
    expect(button.programmatic).toBe(true);
    expect(button.skin).not.toBeNull();
    expect(button.background.visible).toBe(false);
    expect(button.redrawCount).toBe(1);
    expect(button.boxWidth).toBe(439);
    expect(button.boxHeight).toBe(207);
    expect(colorsOf(button.skin as Graphics)).toEqual([0x039438, 0x3cc026, 0x241c2f]);
    expect((button.labelText as Text).style.fill).toBe(0xffffff);
    button.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 80);
    expect(button.isPressed).toBe(true);
    expect(button.redrawCount).toBe(2);
    // pressed: the flat darker look (the default pressed = the depth colour, no lip)
    expect(colorsOf(button.skin as Graphics)).toEqual([0x039438, 0x241c2f]);
    button.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 200);
    expect(taps).toEqual([1]);
    expect(button.isPressed).toBe(false);
    expect(button.redrawCount).toBe(3);
    expect(colorsOf(button.skin as Graphics)).toEqual([0x039438, 0x3cc026, 0x241c2f]);
    // idle frames never redraw
    advance(kit.core, 1000);
    expect(button.redrawCount).toBe(3);
    button.destroy();
  });

  it('a disabled role button takes the theme\'s disabled role (not an alpha), a texture button keeps the v0.4 dim', () => {
    const kit = createKit();
    const theme = resolveTheme();
    const button = new UiButton({ ui: kit.ui, id: 'b', theme, role: 'danger', label: 'EXIT', width: 599, height: 207, onTap: () => {} });
    button.setEnabled(false);
    expect(button.alpha).toBe(1);
    expect(colorsOf(button.skin as Graphics)).toEqual([0x737384, 0xa3a3b3, 0x241c2f]);
    expect((button.labelText as Text).style.fill).toBe(0xeeeef4);
    // no pressed look while disabled
    button.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 100);
    expect(colorsOf(button.skin as Graphics)).toEqual([0x737384, 0xa3a3b3, 0x241c2f]);
    button.setEnabled(true);
    expect(colorsOf(button.skin as Graphics)).toEqual([0xa31a2a, 0xd02d46, 0x241c2f]);
    expect((button.labelText as Text).style.fill).toBe(0xffffff);

    const art = new UiButton({ ui: kit.ui, id: 'a', theme, texture: kit.textures.btnGreen, width: 439, height: 207, label: 'PLAY', onTap: () => {} });
    expect(art.programmatic).toBe(false);
    expect(art.skin).toBeNull();
    expect(art.background.visible).toBe(true);
    expect(art.background.texture).toBe(kit.textures.btnGreen);
    art.setEnabled(false);
    expect(art.alpha).toBe(0.55);
    button.destroy();
    art.destroy();
  });

  it('a close role button draws the × from theme.close and an explicit style overrides the role', () => {
    const kit = createKit();
    const close = new UiButton({ ui: kit.ui, id: 'x', theme: resolveTheme(), role: 'close', onTap: () => {} });
    expect(close.boxWidth).toBe(51);
    expect(instructions(close.skin as Graphics).map((i) => i.action)).toEqual(['stroke', 'stroke']);
    const custom = new UiButton({ ui: kit.ui, id: 'c', theme: resolveTheme(), role: 'positive', style: { ...DEFAULT_READY_UI_THEME.button.positive, fill: { type: 'solid', color: 0x777777 }, depth: null }, onTap: () => {} });
    expect(colorsOf(custom.skin as Graphics)).toEqual([0x777777, 0x241c2f]);
    custom.setStyle(ALT_READY_UI_THEME.button.reward);
    expect(instructions(custom.skin as Graphics)[1]?.texture).toBe(true);
    close.destroy();
    custom.destroy();
  });
});

describe('ModalWindow skin', () => {
  it('the standard window draws a UiPanel with the theme header / body and role buttons; theme.skin art keeps the sprites', () => {
    const kit = createKit();
    const themed = new ProbeWindow({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'probe' });
    expect(themed.surface).toBeInstanceOf(UiPanel);
    const colors = colorsOf((themed.surface as UiPanel).graphics);
    expect(colors).toContain(0x7354d7); // header
    expect(colors).toContain(0xc0beff); // body
    expect(colors).toContain(0x261a34); // border
    for (const role of UI_BUTTON_ROLES) expect(themed.buttonsByRole.get(role)?.programmatic).toBe(true);
    const close = field<UiButton>(themed, 'closeButton');
    expect(close.role).toBe('close');
    expect(close.programmatic).toBe(true);
    themed.destroy();

    const art = new ProbeWindow({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'art', theme: { skin: 'art' } });
    expect(art.surface).toBeInstanceOf(Sprite);
    expect((art.surface as Sprite).texture).toBe(kit.textures.panelPurple);
    for (const role of UI_BUTTON_ROLES) {
      const button = art.buttonsByRole.get(role) as UiButton;
      expect(button.programmatic).toBe(false);
      expect(button.background.visible).toBe(true);
    }
    expect(field<UiButton>(art, 'closeButton').programmatic).toBe(false);
    expect(field<UiButton>(art, 'closeButton').background.texture).toBe(kit.textures.btnClose);
    art.destroy();

    // an explicit custom panel / close art wins over the programmatic default (game-specific art never disappears)
    const custom = new ProbeWindow({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'custom', panelTexture: kit.textures.starterPanel, closeTexture: kit.textures.btnClose });
    expect((custom.surface as Sprite).texture).toBe(kit.textures.starterPanel);
    expect(field<UiButton>(custom, 'closeButton').background.texture).toBe(kit.textures.btnClose);
    expect(custom.buttonsByRole.get('positive')?.programmatic).toBe(true);
    custom.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('the same window under two themes has the same geometry (positions, sizes, hit areas, fit) and different colours', () => {
    const a = windowGeometry(DEFAULT_READY_UI_THEME);
    const b = windowGeometry(ALT_READY_UI_THEME);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.out).toEqual(b.out);
    expect(a.colors.length).toBeGreaterThan(10);
    expect(a.colors).not.toEqual(b.colors);
    expect(a.colors).toContain(0x7354d7);
    expect(b.colors).toContain(0x1f6fd8);
    expect(b.colors).not.toContain(0x7354d7);
  });

  it('the Bubble theme keeps the same geometry too, with its own colours (gloss, strip lips, soft shadows are all inside the boxes)', () => {
    const a = windowGeometry(DEFAULT_READY_UI_THEME);
    const c = windowGeometry(BUBBLE_READY_UI_THEME);
    expect(c.errors).toEqual([]);
    expect(a.out).toEqual(c.out);
    expect(c.colors).toContain(0x1f8f14); // positive lip
    expect(c.colors).toContain(0x92a8d6); // well lip
    expect(c.colors).not.toContain(0x7354d7);
    // the fits are the same even though every Bubble surface draws a soft shadow: the shadow is inside the declared box
    expect(c.colors.filter((color) => color === 0x000000).length).toBeGreaterThan(a.colors.filter((color) => color === 0x000000).length);
  });

  it('Settings: `toggleWell` draws the themed inner card under the toggles (sized to the visible toggles), never under art', () => {
    const kit = createKit();
    const view = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme: BUBBLE_READY_UI_THEME, toggleWell: true, onToggle: () => {}, onHome: () => {}, onRestart: () => {} });
    const well = field<UiSurface>(view, 'toggleWell');
    expect(well).toBeInstanceOf(UiSurface);
    expect(colorsOf(well.graphics)).toContain(0x92a8d6);
    const panel = field<Container>(view, 'panel');
    const row = field<Container>(view, 'toggleRow');
    expect(panel.getChildIndex(well)).toBe(panel.getChildIndex(row) - 1);
    view.show({ sound: true, music: true });
    const main = { width: well.surfaceWidth, height: well.surfaceHeight, y: well.y };
    // two toggles: the card spans the captions (185 above the tiles) and the 220-tall tiles
    expect(main.width).toBe(300 + 224 + 52 * 2);
    expect(main.height).toBe(185 + 110 + 58 + 44);
    const t = field<Record<'sound', { button: Container; label: Container }>>(view, 'toggles');
    const labelTop = row.y + t.sound.label.y - 40;
    const tileBottom = row.y + t.sound.button.y + 110;
    expect(main.y - main.height / 2).toBeLessThan(labelTop);
    expect(main.y + main.height / 2).toBeGreaterThan(tileBottom);
    expect(main.y + main.height / 2).toBeLessThan(panel.getLocalBounds().y + panel.getLocalBounds().height);
    // in a level the row moves up: the card follows, the same size
    view.controller.cancel();
    view.show({ sound: true, music: true, gameButtons: true });
    expect(well.surfaceWidth).toBe(main.width);
    expect(well.surfaceHeight).toBe(main.height);
    expect(well.y).toBeLessThan(main.y);
    const home = field<UiButton>(view, 'homeButton');
    expect(well.y + main.height / 2).toBeLessThanOrEqual(row.y + home.y - (207 * 0.72) / 2);
    view.destroy();

    const art = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme: { skin: 'art' }, toggleWell: true, onToggle: () => {} });
    expect((art as unknown as { toggleWell: unknown }).toggleWell).toBeNull();
    art.destroy();
    const plain = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onToggle: () => {} });
    expect((plain as unknown as { toggleWell: unknown }).toggleWell).toBeNull();
    plain.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('Lives: the well and the role buttons are themed; Shop: card, ribbon and the big × are themed; a full-lives refill is the disabled role', () => {
    const kit = createKit();
    const lives = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onRefill: () => {}, onWatchAd: () => {} });
    lives.show({ lives: 5, maxLives: 5, refillPrice: 900 });
    const refill = field<UiButton>(lives, 'refillButton');
    expect(refill.role).toBe('positive');
    expect(refill.enabled).toBe(false);
    expect(colorsOf(refill.skin as Graphics)[1]).toBe(0xa3a3b3);
    expect(field<UiButton>(lives, 'adButton').role).toBe('reward');
    const wells = field<Container>(lives, 'panel').children.filter((c) => c instanceof UiSurface);
    expect(wells).toHaveLength(1);
    lives.destroy();

    const shop = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: () => {} });
    shop.show({ items: [{ id: 'a', amount: 100, price: '$1' }] });
    const cards = field<Array<{ button: UiButton }>>(shop, 'cards');
    expect(cards[0]?.button.children[0]).toBeInstanceOf(UiSurface);
    expect(cards[0]?.button.background.visible).toBe(false);
    const gold = field<Container>(shop, 'gold');
    expect(gold.children[0]).toBeInstanceOf(UiSurface);
    expect(colorsOf((gold.children[0] as UiSurface).graphics)).toContain(0x27a2ff);
    const close = field<UiButton>(shop, 'shopClose');
    expect(close.role).toBe('close');
    expect(close.boxWidth).toBe(89);
    // the awning stays art
    expect(field<Sprite[]>(shop, 'headerTiles')[0]?.texture).toBe(kit.textures.shopHeader);
    shop.destroy();
    expect(kit.uiErrors).toEqual([]);
  });
});

describe('HudView skin', () => {
  it('the capsules are themed badges and the gear a neutral role button with the gear icon texture; art skin restores the sprites', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, coins: 10, onCoinsTap: () => {}, onSettingsTap: () => {} });
    const gear = hud.children.find((c) => c instanceof UiButton) as UiButton;
    expect(gear.role).toBe('neutral');
    expect(gear.programmatic).toBe(true);
    expect(gear.icon?.texture).toBe(kit.textures.hudGear);
    const row = hud.children.find((c) => !(c instanceof UiButton) && c.children.length >= 2) as Container;
    const capsules: UiSurface[] = [];
    const visit = (node: Container): void => { if (node instanceof UiSurface) capsules.push(node); for (const child of node.children) visit(child); };
    visit(row);
    expect(capsules.length).toBe(2);
    expect(capsules[0]?.surfaceWidth).toBe(218);
    const before = hud.barHeight;
    hud.destroy();

    const art = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, theme: { skin: 'art' }, coins: 10, onCoinsTap: () => {}, onSettingsTap: () => {} });
    const artGear = art.children.find((c) => c instanceof UiButton) as UiButton;
    expect(artGear.programmatic).toBe(false);
    expect(artGear.background.texture).toBe(kit.textures.hudGearBack);
    // the skin does not move the HUD
    expect(art.barHeight).toBeCloseTo(before, 6);
    art.destroy();
    expect(kit.uiErrors).toEqual([]);
  });
});
