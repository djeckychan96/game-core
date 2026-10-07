// The three opt-in / feedback motions of the Ready UI kit: PLAY idle breathing (UiButton), HUD counter feedback for
// coins and lives (HudView `resourceFeedback`), and the locked-tap shake of a BottomNav item (LOCK on LevelMapScreen).
import { describe, expect, it } from 'vitest';
import { Container, Rectangle, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer, type TestKit } from './setup';
import { BottomNavView } from '../../src/pixi/BottomNavView';
import { HudView } from '../../src/pixi/HudView';
import { LevelMapScreen, type LevelMapScreenOptions } from '../../src/pixi/LevelMapScreen';
import type { ReadyUiTextures } from '../../src/pixi/assets';
import type { ReadyUiSkin, ReadyUiSkinAssetKey, ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import { formatAmount } from '../../src/pixi/text';
import { resolveTheme } from '../../src/pixi/theme';
import { UI_BUTTON_BREATHING, UiButton } from '../../src/pixi/UiButton';

const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

function styled(kit: TestKit, skin: ReadyUiSkin): ReadyUiTextures {
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[role] = labelled(`${skin.id}:${role}`);
  return { ...kit.textures, skins: { [skin.id]: roles } };
}

function button(kit: TestKit, extra: Partial<ConstructorParameters<typeof UiButton>[0]> = {}): { view: UiButton; taps: number[] } {
  const taps: number[] = [];
  const view = new UiButton({
    ui: kit.ui,
    id: 'cta',
    theme: resolveTheme(),
    texture: Texture.WHITE,
    width: 400,
    height: 200,
    onTap: () => taps.push(1),
    ...extra
  });
  return { view, taps };
}

/** Samples `read()` every 16 ms for `ms`. */
function sample(kit: TestKit, ms: number, read: () => number): number[] {
  const out: number[] = [];
  for (let t = 0; t < ms; t += 16) {
    advance(kit.core, 16);
    out.push(read());
  }
  return out;
}

const breathingTweens = (kit: TestKit): number => kit.motion.getStats().activeTweens;

describe('UiButton breathing (opt-in idle motion of a primary CTA)', () => {
  it('is off by default: no tween, the scale stays the idle scale', () => {
    const kit = createKit();
    const { view } = button(kit, { motion: kit.motion });
    view.setIdleScale(0.5);
    const scales = sample(kit, 1500, () => view.scale.x);
    expect(new Set(scales)).toEqual(new Set([0.5]));
    expect(kit.motion.getStats().activeMotions).toBe(0);
    view.destroy();
  });

  it('breathes idle → idle × 1.04 → idle over 1.3 s with one owned tween, softly (no overshoot)', () => {
    const kit = createKit();
    const { view } = button(kit, { motion: kit.motion, breathing: true });
    view.setIdleScale(0.5);
    expect(UI_BUTTON_BREATHING).toEqual({ scale: 1.04, periodMs: 1300 });
    expect(breathingTweens(kit)).toBe(1);
    const scales = sample(kit, 2600, () => view.scale.x);
    expect(Math.max(...scales)).toBeCloseTo(0.5 * 1.04, 3);
    expect(Math.max(...scales)).toBeLessThanOrEqual(0.5 * 1.04 + 1e-9); // a sine, never a spring past the peak
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    // peaks half a period in (650 ms), back at idle after a whole period (1300 ms)
    const at = (ms: number): number => scales[Math.round(ms / 16) - 1]!;
    expect(at(656)).toBeGreaterThan(0.5 * 1.039);
    expect(at(1296)).toBeLessThan(0.5 * 1.001);
    // repeated setIdleScale / setBreathing never add a second tween
    for (let i = 0; i < 5; i++) {
      view.setIdleScale(0.6);
      view.setBreathing(true);
    }
    expect(breathingTweens(kit)).toBe(1);
    view.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);
  });

  it('composes with the press: idle × breathing × press, and the tap still fires once', () => {
    const kit = createKit();
    const { view, taps } = button(kit, { motion: kit.motion, breathing: { scale: 1.04, periodMs: 1300 }, pressScale: 0.9 });
    view.setIdleScale(0.5);
    advance(kit.core, 640); // near the top of the breath
    view.emit('pointerdown', pointer(10, 10) as never);
    advance(kit.core, 96); // fully pressed (80 ms) while the breath goes on
    const breath = (view as unknown as { breathFactor: number }).breathFactor;
    expect(breath).toBeGreaterThan(1.03);
    expect(view.scale.x).toBeCloseTo(0.5 * breath * 0.9, 6);
    view.emit('pointerup', pointer(10, 10) as never);
    advance(kit.core, 200);
    expect(taps).toEqual([1]);
    const after = (view as unknown as { breathFactor: number }).breathFactor;
    expect(view.scale.x).toBeCloseTo(0.5 * after, 6); // released: back to idle × breathing, no leftover press
    expect(breathingTweens(kit)).toBe(1);
    // rapid taps keep one breathing tween and settle back to idle × breathing
    for (let i = 0; i < 6; i++) {
      view.emit('pointerdown', pointer(10, 10) as never);
      advance(kit.core, 32);
      view.emit('pointerup', pointer(10, 10) as never);
      advance(kit.core, 16);
    }
    advance(kit.core, 300);
    expect(taps.length).toBe(7);
    expect(breathingTweens(kit)).toBe(1);
    expect(view.scale.x).toBeCloseTo(0.5 * (view as unknown as { breathFactor: number }).breathFactor, 6);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('keeps the hit area at its idle size on screen while the button breathes', () => {
    const kit = createKit();
    const { view } = button(kit, { motion: kit.motion, breathing: true });
    const idle = view.hitArea as Rectangle;
    expect([idle.x, idle.y, idle.width, idle.height]).toEqual([-200, -100, 400, 200]);
    advance(kit.core, 650); // at the peak: the button is 4 % larger
    const breath = (view as unknown as { breathFactor: number }).breathFactor;
    expect(breath).toBeGreaterThan(1.039);
    // a local point maps to (local × breath) idle units: the hit edge stays at 200 idle units, not 200 × 1.04
    expect(view.hitArea!.contains((200 / breath) * 0.99, 0)).toBe(true);
    expect(view.hitArea!.contains((200 / breath) * 1.01, 0)).toBe(false);
    view.setBreathing(false);
    expect(view.hitArea!.contains(199, 0)).toBe(true);
    expect(view.hitArea!.contains(201, 0)).toBe(false);
    view.destroy();
  });

  it('stops while disabled, comes back on enable; a breath cancelled from outside comes back on the next layout', () => {
    const kit = createKit();
    const { view } = button(kit, { motion: kit.motion, breathing: true });
    view.setIdleScale(0.5);
    advance(kit.core, 300);
    view.setEnabled(false);
    expect(breathingTweens(kit)).toBe(0);
    expect(view.scale.x).toBe(0.5);
    advance(kit.core, 500);
    expect(view.scale.x).toBe(0.5);
    view.setEnabled(true);
    expect(breathingTweens(kit)).toBe(1);
    advance(kit.core, 300);
    kit.core.cancelAll(); // a host-wide settle
    expect(breathingTweens(kit)).toBe(0);
    expect(view.scale.x).toBe(0.5);
    view.setIdleScale(0.5); // the next resize
    expect(breathingTweens(kit)).toBe(1);
    view.setBreathing(false);
    expect(breathingTweens(kit)).toBe(0);
    expect(view.scale.x).toBe(0.5);
    view.destroy();
    expect(kit.motionErrors).toEqual([]);
  });

  it('destroy mid-breath and mid-press leaves nothing running and nothing writing', () => {
    const kit = createKit();
    const { view } = button(kit, { motion: kit.motion, breathing: true });
    advance(kit.core, 200);
    view.emit('pointerdown', pointer(10, 10) as never);
    advance(kit.core, 30);
    view.destroy();
    advance(kit.core, 1500);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.uiErrors).toEqual([]);
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('needs a MotionRuntime and sane numbers', () => {
    const kit = createKit();
    expect(() => button(kit, { breathing: true })).toThrow("UiButton 'cta': breathing needs options.motion");
    const kit2 = createKit();
    expect(() => button(kit2, { motion: kit2.motion, breathing: { periodMs: 0 } })).toThrow(RangeError);
  });
});

describe.each([
  { name: 'Style 1', skin: READY_UI_STYLE_1 },
  { name: 'Style 2', skin: READY_UI_STYLE_2 }
])('LevelMapScreen PLAY breathing + LOCK shake ($name)', ({ skin }) => {
  const create = (kit: TestKit, overrides: Partial<LevelMapScreenOptions> = {}): LevelMapScreen => new LevelMapScreen({
    ui: kit.ui,
    motion: kit.motion,
    textures: styled(kit, skin),
    theme: { skin },
    map: { levels: 30, currentLevel: 12 },
    hud: { coins: 120, lives: 3, maxLives: 5 },
    onPlay: () => {},
    width: 390,
    height: 844,
    ...overrides
  });

  it('PLAY breathes only with playBreathing; the layout scale stays the base of it; destroy cleans up', () => {
    const kit = createKit();
    const plain = create(kit);
    const baseline = kit.motion.getStats().activeTweens; // the map's own idle loops (focus glow + focus pulse)
    const idle = plain.play.scale.x;
    expect(new Set(sample(kit, 1400, () => plain.play.scale.x))).toEqual(new Set([idle]));
    plain.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);

    const breathing = create(kit, { playBreathing: true });
    expect(kit.motion.getStats().activeTweens).toBe(baseline + 1);
    const base = breathing.play.scale.x;
    const scales = sample(kit, 1400, () => breathing.play.scale.x);
    expect(Math.max(...scales) / base).toBeCloseTo(1.04, 2);
    // resizes (rotate, a layout pass every show) keep one breathing tween, around the new layout scale
    breathing.resize(1280, 800);
    breathing.resize(320, 568);
    breathing.resize(390, 844);
    expect(kit.motion.getStats().activeTweens).toBe(baseline + 1);
    const again = sample(kit, 1400, () => breathing.play.scale.x);
    expect(Math.min(...again)).toBeGreaterThanOrEqual(base - 1e-9);
    expect(Math.max(...again) / base).toBeCloseTo(1.04, 2);
    breathing.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.uiErrors).toEqual([]);
  });

  it('LOCK: a tap shakes the slot (left, right, back in 240 ms) and reports when it has onTap; no onTap needed; disabled = inert', () => {
    const kit = createKit();
    const taps: string[] = [];
    const screen = create(kit, { nav: { lock: { onTap: () => taps.push('lock') } } });
    const lock = screen.nav.getItemContainer('lock')!;
    const inner = lock.children[0] as Container;
    lock.emit('pointerdown', pointer(1, 1) as never);
    advance(kit.core, 48);
    lock.emit('pointerup', pointer(1, 1) as never);
    expect(taps).toEqual(['lock']);
    // 240 ms of steps; the sequence starts each step on a frame, so at 16 ms frames it lands by ~280 ms
    const xs = sample(kit, 320, () => inner.x);
    expect(Math.min(...xs)).toBeLessThan(-10);
    expect(Math.max(...xs)).toBeGreaterThan(10);
    expect(inner.x).toBe(0);
    // a second tap mid-shake restarts it: one shake at a time
    lock.emit('pointerdown', pointer(1, 1) as never);
    lock.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 60);
    lock.emit('pointerdown', pointer(1, 1) as never);
    lock.emit('pointerup', pointer(1, 1) as never);
    expect(kit.motion.getStats().activeSequences).toBe(1);
    // destroy mid-shake: cancelled before Pixi nulls the container
    screen.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);

    // no onTap: LOCK is still a locked, tappable slot (it shakes); SHOP / HOME without onTap stay disabled
    const kit2 = createKit();
    const bare = create(kit2, { nav: {} });
    expect(['shop', 'home', 'lock'].map((id) => bare.nav.isDisabled(id))).toEqual([true, true, false]);
    const bareInner = bare.nav.getItemContainer('lock')!.children[0] as Container;
    bare.nav.getItemContainer('lock')!.emit('pointerdown', pointer(1, 1) as never);
    bare.nav.getItemContainer('lock')!.emit('pointerup', pointer(1, 1) as never);
    expect(Math.min(...sample(kit2, 120, () => bareInner.x))).toBeLessThan(-10);
    bare.destroy();
    expect(kit2.uiErrors).toEqual([]);

    // lock: { disabled: true } is inert: no press, no shake, no callback
    const kit3 = createKit();
    const inertTaps: string[] = [];
    const inert = create(kit3, { nav: { lock: { onTap: () => inertTaps.push('lock'), disabled: true } } });
    const inertLock = inert.nav.getItemContainer('lock')!;
    const inertInner = inertLock.children[0] as Container;
    inertLock.emit('pointerdown', pointer(1, 1) as never);
    advance(kit3.core, 80);
    expect(inertInner.scale.x).toBe(1);
    inertLock.emit('pointerup', pointer(1, 1) as never);
    expect(new Set(sample(kit3, 260, () => inertInner.x))).toEqual(new Set([0]));
    expect(inertTaps).toEqual([]);
    expect(kit3.motion.getStats().activeSequences).toBe(0);
    inert.destroy();
  });
});

describe('BottomNavView locked tap without a MotionRuntime', () => {
  it('still reports the tap and never throws (no shake)', () => {
    const kit = createKit();
    const locked: string[] = [];
    const nav = new BottomNavView({
      ui: kit.ui,
      textures: styled(kit, READY_UI_STYLE_1),
      theme: { skin: READY_UI_STYLE_1 },
      items: [{ id: 'a' }, { id: 'b', locked: true }],
      onSelect: () => {},
      onLockedTap: (id) => locked.push(id)
    });
    const item = nav.getItemContainer('b')!;
    item.emit('pointerdown', pointer(1, 1) as never);
    item.emit('pointerup', pointer(1, 1) as never);
    advance(kit.core, 260);
    expect(locked).toEqual(['b']);
    expect((item.children[0] as Container).x).toBe(0);
    nav.destroy();
    expect(kit.uiErrors).toEqual([]);
  });
});

describe('HudView resourceFeedback (opt-in counter feedback for coins and lives)', () => {
  type Badge = { countText: { text: string; x: number }; capsuleText: { text: string }; plus: { visible: boolean } | null; icon: { scale: { x: number }; x: number }; iconScale: number };
  const parts = (hud: HudView) => hud as unknown as { coins: Badge; lives: Badge };
  const create = (kit: TestKit, coins = 100, lives = 3): HudView => new HudView({
    ui: kit.ui, motion: kit.motion, textures: kit.textures, coins, lives, maxLives: 5, shadow: false,
    onCoinsTap: () => {}, onLivesTap: () => {}, resourceFeedback: true
  });
  /** The distinct texts the counter shows from now until `ms` later. */
  const drawn = (kit: TestKit, text: { text: string }, ms: number): string[] => {
    const seen: string[] = [text.text];
    for (let t = 0; t < ms; t += 16) {
      advance(kit.core, 16);
      if (seen[seen.length - 1] !== text.text) seen.push(text.text);
    }
    return seen;
  };

  it('gain: the amount is new at once; the number rolls up (≤ 12 steps, ≤ 600 ms) and the icon pops', () => {
    const kit = createKit();
    const hud = create(kit, 100);
    const { coins } = parts(hud);
    hud.setCoins(130);
    expect(hud.coinsAmount).toBe(130); // the logical value is never animated
    expect(coins.countText.text).toBe('100');
    advance(kit.core, 16);
    expect(Number(coins.countText.text)).toBeGreaterThan(100); // the first step is on the first frame
    expect(coins.icon.scale.x).toBeGreaterThan(coins.iconScale * 1.1);
    const seen = ['100', ...drawn(kit, coins.countText, 600)];
    const values = [...new Set(seen)].map(Number);
    expect(values.length - 1).toBeLessThanOrEqual(12);
    expect(values).toEqual([...values].sort((a, b) => a - b)); // only up
    expect(coins.countText.text).toBe('130');
    advance(kit.core, 100);
    expect(coins.icon.scale.x).toBeCloseTo(coins.iconScale, 8);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    hud.destroy();
  });

  it('a big gain is still at most 12 redraws; a spend rolls down faster (260 ms) while the icon dips to 0.9', () => {
    const kit = createKit();
    const hud = create(kit, 0);
    const { coins } = parts(hud);
    hud.setCoins(12450);
    const up = drawn(kit, coins.countText, 640);
    expect(up.length - 1).toBeLessThanOrEqual(12);
    expect(up[up.length - 1]).toBe(formatAmount(12450));
    hud.setCoins(12000);
    expect(hud.coinsAmount).toBe(12000);
    advance(kit.core, 16);
    expect(coins.icon.scale.x).toBeLessThan(coins.iconScale * 0.95); // the dip, not a pop
    const down = drawn(kit, coins.countText, 272);
    expect(down[down.length - 1]).toBe(formatAmount(12000));
    advance(kit.core, 64);
    expect(coins.icon.scale.x).toBeCloseTo(coins.iconScale, 8);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    hud.destroy();
  });

  it('rapid changes go on from the number on screen: one roll and one pulse per badge, ending on the last value', () => {
    const kit = createKit();
    const hud = create(kit, 0);
    const { coins } = parts(hud);
    const shown: number[] = [];
    for (let i = 1; i <= 12; i++) {
      hud.setCoins(i * 10); // a reward flight: one setCoins per coin, 60 ms apart
      advance(kit.core, 60);
      shown.push(Number(coins.countText.text));
      expect(kit.motion.getStats().activeMotions).toBeLessThanOrEqual(2);
      expect(coins.icon.scale.x).toBeLessThanOrEqual(coins.iconScale * 1.22 + 1e-6);
    }
    expect(shown).toEqual([...shown].sort((a, b) => a - b)); // never jumps back
    advance(kit.core, 700);
    expect(coins.countText.text).toBe('120');
    expect(hud.coinsAmount).toBe(120);
    // animate = false: drawn at once, no motion
    hud.setCoins(5, false);
    expect(coins.countText.text).toBe('5');
    expect(kit.motion.getStats().activeMotions).toBe(0);
    hud.destroy();
  });

  it('life spend: the count is right at once, the number drops, the heart dips and gives a light shake back to rest', () => {
    const kit = createKit();
    const hud = create(kit, 100, 4);
    const { lives } = parts(hud);
    const restIcon = lives.icon.x;
    const restCount = lives.countText.x;
    hud.setLives(3, '12:00');
    expect(hud.livesAmount).toBe(3);
    expect(lives.capsuleText.text).toBe('12:00'); // the caption and the "+" follow the value at once
    expect(lives.plus?.visible).toBe(true);
    advance(kit.core, 16);
    expect(lives.countText.text).toBe('3'); // one step: on the first frame
    expect(lives.icon.scale.x).toBeLessThan(lives.iconScale);
    const xs = sample(kit, 320, () => lives.icon.x - restIcon);
    expect(Math.min(...xs)).toBeLessThan(-3);
    expect(Math.max(...xs)).toBeGreaterThan(3);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(16 * 0.3 + 1e-9); // light: 0.3 of the locked shake
    expect(lives.icon.x).toBe(restIcon);
    expect(lives.countText.x).toBe(restCount); // the number inside the heart moved with it and is back too
    // a refill to full: MAX at once, the number rolls up with the pop
    hud.setLives(5);
    expect(lives.capsuleText.text).toBe('MAX');
    expect(lives.plus?.visible).toBe(false);
    advance(kit.core, 700);
    expect(lives.countText.text).toBe('5');
    // repeated spends never stack shakes
    for (let i = 0; i < 4; i++) {
      hud.setLives(4 - i);
      advance(kit.core, 30);
      expect(kit.motion.getStats().activeSequences).toBeLessThanOrEqual(1);
    }
    advance(kit.core, 400);
    expect(lives.icon.x).toBe(restIcon);
    expect(lives.countText.text).toBe('1');
    expect(kit.motionErrors).toEqual([]);
    hud.destroy();
  });

  it('a roll cancelled from outside snaps to its value; destroy mid-feedback leaves nothing running', () => {
    const kit = createKit();
    const hud = create(kit, 0, 5);
    const { coins } = parts(hud);
    hud.setCoins(500);
    advance(kit.core, 48);
    kit.core.cancelAll();
    expect(coins.countText.text).toBe('500');
    hud.setCoins(200);
    hud.setLives(2);
    advance(kit.core, 32);
    hud.destroy();
    advance(kit.core, 500);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.uiErrors).toEqual([]);
  });

  it('is opt-in: without it a change draws the number at once and only pops the icon (as before)', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, coins: 100, lives: 4, maxLives: 5, onCoinsTap: () => {}, onLivesTap: () => {} });
    const { coins, lives } = parts(hud);
    hud.setCoins(40);
    hud.setLives(3);
    expect(coins.countText.text).toBe('40');
    expect(lives.countText.text).toBe('3');
    advance(kit.core, 16);
    expect(coins.icon.scale.x).toBeGreaterThan(coins.iconScale); // a spend still pops, like before
    expect(kit.motion.getStats().activeSequences).toBe(0); // no heart shake
    hud.destroy();
  });
});
