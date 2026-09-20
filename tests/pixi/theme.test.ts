import { describe, expect, it } from 'vitest';
import { advance, createKit, pointer } from './setup';
import { Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import {
  ALT_READY_UI_THEME,
  DEFAULT_READY_UI_THEME,
  UI_BUTTON_ROLES,
  buttonStyleOf,
  resolveTheme,
  type ReadyUiTheme,
  type UiButtonRole,
  type UiFill
} from '../../src/pixi/theme';
import { UiPanel, UiSurface, drawCloseMark, drawPanel, drawSurface, toFillInput } from '../../src/pixi/skin';
import { UiButton } from '../../src/pixi/UiButton';
import { ModalWindow, type ModalWindowOptions } from '../../src/pixi/ModalWindow';
import { SettingsWindowView } from '../../src/pixi/SettingsWindowView';
import { LivesWindowView } from '../../src/pixi/LivesWindowView';
import { ShopWindowView } from '../../src/pixi/ShopWindowView';
import { ResultWindowView } from '../../src/pixi/ResultWindowView';
import { StarterPackWindowView } from '../../src/pixi/StarterPackWindowView';
import { HudView } from '../../src/pixi/HudView';

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
    const geometry = (theme: ReadyUiTheme) => {
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
        const dump: Record<string, unknown> = { x: panel.x, y: panel.y, scale: +panel.scale.x.toFixed(5), bounds: { ...panel.getLocalBounds() } };
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
    };
    const a = geometry(DEFAULT_READY_UI_THEME);
    const b = geometry(ALT_READY_UI_THEME);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.out).toEqual(b.out);
    expect(a.colors.length).toBeGreaterThan(10);
    expect(a.colors).not.toEqual(b.colors);
    expect(a.colors).toContain(0x7354d7);
    expect(b.colors).toContain(0x1f6fd8);
    expect(b.colors).not.toContain(0x7354d7);
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
