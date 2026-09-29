import { describe, expect, it, vi } from 'vitest';
import { Container, EventBoundary, Sprite, Texture, updateRenderGroupTransforms, type Rectangle } from 'pixi.js';
import 'pixi.js/events'; // the FederatedContainer mixin a browser gets during renderer detection (EventBoundary.hitTest)
import { advance, createKit, pointer } from './setup';
import { ResultWindowView, WIN_CONFETTI_TEXTURES, type ResultWindowParams, type ResultWindowViewOptions } from '../../src/pixi/ResultWindowView';
import { WIN_STARS_TIMING, WinStarsEffect } from '../../src/pixi/fx/WinStarsEffect';
import type { UiButton } from '../../src/pixi/UiButton';

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

function tap(target: UiButton, kit: ReturnType<typeof createKit>): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
}

const WIN: ResultWindowParams = { level: 19, stars: 3, rewardCoins: 100 };
const FAIL: ResultWindowParams = { level: 19, outcome: 'fail', rewardCoins: 0 };
const { startDelayMs: DELAY, intervalMs: INTERVAL, flyMs: FLY } = WIN_STARS_TIMING;
/** The last landing sprite (a spark: up to 60 ms stagger + 640 ms life) ends 700 ms after its star's touchdown. */
const TAIL = 700;
const PER_SLOT = 1 + 1 + 1 + 10 + 7; // bloom, core, halo, rays, sparks

function createResult(kit: ReturnType<typeof createKit>, extra: Partial<ResultWindowViewOptions> = {}): ResultWindowView {
  return new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {}, onRetry: () => {}, onExit: () => {}, ...extra });
}

const starsOf = (view: ResultWindowView) => field<Sprite[]>(view, 'stars');
const fxOf = (view: ResultWindowView) => field<WinStarsEffect>(view, 'starsFx');
const drawn = (layer: Container) => (layer.children as Sprite[]).filter((s) => s.visible).length;

/** A standalone effect over three rest-placed stars (the Result's geometry), on its own host clock. */
function standalone(textures: 'fx' | 'none' = 'fx') {
  const kit = createKit();
  const specs = [[-272, -540, 240], [0, -600, 288], [272, -540, 240]] as const;
  const stars = specs.map(([x, y, size]) => {
    const s = new Sprite(Texture.WHITE);
    s.anchor.set(0.5);
    s.scale.set(size / Texture.WHITE.width);
    s.position.set(x, y);
    s.visible = false;
    return s;
  });
  const effect = new WinStarsEffect({
    motion: kit.motion, scope: 'stars:fx', stars,
    textures: textures === 'fx' ? { glow: Texture.WHITE, spark: Texture.WHITE } : null
  });
  const panel = new Container();
  panel.addChild(effect, ...stars, effect.front);
  return { kit, stars, effect, rest: specs.map(([x, y, size]) => ({ x, y, scale: size / Texture.WHITE.width })) };
}

/** Advance to exactly `t` ms of effect time (the run's first update comes with the first frame after play()). */
function to(kit: ReturnType<typeof createKit>, effect: WinStarsEffect, t: number, step = 16): void {
  while (effect.running && effect.getStats().elapsedMs + step <= t) kit.core.update(step);
  const rest = t - effect.getStats().elapsedMs;
  if (effect.running && rest > 0) kit.core.update(rest);
}

describe('WinStarsEffect timeline (Result WIN stars)', () => {
  it('1. stars come in left to right, 350 ms apart: each appears above its place, large and see-through, then lands', () => {
    const { kit, stars, effect, rest } = standalone();
    expect(effect.play(3)).toBe(true);
    expect(effect.durationFor(3)).toBe(DELAY + 2 * INTERVAL + FLY + TAIL);
    for (let i = 0; i < 3; i++) {
      const start = DELAY + i * INTERVAL;
      to(kit, effect, start - 1);
      expect(stars[i]!.visible, `star ${i} before ${start}`).toBe(false);
      to(kit, effect, start + 40);
      const star = stars[i]!;
      expect(star.visible).toBe(true);
      expect(star.y).toBeLessThan(rest[i]!.y - 0.5 * 240); // well above its place
      expect(star.scale.x).toBeGreaterThan(rest[i]!.scale * 1.5); // large
      expect(star.alpha).toBeGreaterThan(0);
      expect(star.alpha).toBeLessThan(0.6); // see-through
      expect(star.x).toBe(rest[i]!.x); // straight down
      expect(star.rotation).toBeLessThan(-0.2); // turned anticlockwise, it turns back clockwise in flight
      // stars to its right have not started yet
      for (let j = i + 1; j < 3; j++) expect(stars[j]!.visible).toBe(false);
      const turn = star.rotation;
      to(kit, effect, start + FLY - 60);
      expect(star.rotation).toBeGreaterThan(turn); // clockwise (+ on screen, y down)
      expect(star.rotation).toBeLessThan(0);
      to(kit, effect, start + FLY);
      expect(star.rotation).toBe(0); // upright at touchdown
      expect(star.alpha).toBe(1);
      expect(star.position).toMatchObject({ x: rest[i]!.x, y: rest[i]!.y });
    }
    effect.destroy();
  });

  it('2. touchdown springs the scale (a dip under the rest size, a small overshoot) and settles exactly at rest', () => {
    const { kit, stars, effect, rest } = standalone();
    effect.play(1);
    const land = DELAY + FLY;
    const scales: number[] = [];
    to(kit, effect, land);
    for (let t = land; t <= land + 600; t += 10) {
      to(kit, effect, t, 10);
      scales.push(stars[0]!.scale.x / rest[0]!.scale);
    }
    const min = Math.min(...scales);
    const max = Math.max(...scales);
    expect(min).toBeGreaterThan(0.85);
    expect(min).toBeLessThan(0.93);
    expect(max).toBeGreaterThan(1.01);
    expect(max).toBeLessThan(1.06);
    to(kit, effect, effect.durationFor(1) + 50);
    expect(effect.running).toBe(false);
    expect(stars[0]!.scale.x).toBe(rest[0]!.scale);
    expect(stars[0]!.position).toMatchObject({ x: rest[0]!.x, y: rest[0]!.y });
    expect(stars[0]!.alpha).toBe(1);
    effect.destroy();
  });

  it('3. landing: a flash lights up behind the star just before touchdown, then rays, sparks and a halo; all gone, the star stays', () => {
    const { kit, stars, effect } = standalone();
    expect(effect.getStats().created).toBe(3 * PER_SLOT);
    effect.play(1);
    to(kit, effect, DELAY + FLY - 150);
    expect(effect.getStats().active).toBe(0);
    expect(effect.visible).toBe(false); // nothing drawn → layer hidden
    to(kit, effect, DELAY + FLY - 50);
    expect(effect.getStats().active).toBe(1); // the landing spot starts to glow
    to(kit, effect, DELAY + FLY + 30);
    // bloom + core + halo + 10 rays + the sparks already out (a stagger of ≤ 60 ms)
    expect(effect.getStats().active).toBeGreaterThanOrEqual(13);
    expect(drawn(effect)).toBe(13);
    expect(drawn(effect.front)).toBeGreaterThan(0);
    expect(effect.visible && effect.front.visible).toBe(true);
    to(kit, effect, DELAY + FLY + 90);
    expect(drawn(effect.front)).toBe(7); // every spark is out
    to(kit, effect, DELAY + FLY + 500);
    expect(drawn(effect)).toBe(0); // the flash, the halo and the rays are short
    expect(drawn(effect.front)).toBeGreaterThan(0); // the sparks last longer
    to(kit, effect, effect.durationFor(1) + 50);
    expect(effect.getStats()).toMatchObject({ active: 0, running: false, completed: 1 });
    expect(drawn(effect) + drawn(effect.front)).toBe(0);
    expect(effect.visible || effect.front.visible).toBe(false);
    expect(stars[0]!.visible).toBe(true);
    effect.destroy();
  });

  it('4. only the earned stars ever show: 0 / 1 / 2 / 3 checked on every frame of the run', () => {
    for (const earned of [0, 1, 2, 3]) {
      const { kit, stars, effect } = standalone();
      expect(effect.play(earned)).toBe(earned > 0);
      const seen = [false, false, false];
      for (let t = 0; t < 2200; t += 16) {
        kit.core.update(16);
        stars.forEach((s, i) => { if (s.visible) seen[i] = true; });
        // a landing sprite of an unearned star never draws (creation order: 13 behind + 7 sparks in front per star)
        (effect.children as Sprite[]).forEach((s, k) => { if (s.visible) expect(Math.floor(k / 13)).toBeLessThan(earned); });
        (effect.front.children as Sprite[]).forEach((s, k) => { if (s.visible) expect(Math.floor(k / 7)).toBeLessThan(earned); });
      }
      expect(seen).toEqual([0, 1, 2].map((i) => i < earned));
      expect(stars.map((s) => s.visible)).toEqual([0, 1, 2].map((i) => i < earned));
      expect(effect.getStats().running).toBe(false);
      effect.destroy();
    }
  });

  it('5. the frame is a pure function of effect time: 16 ms and 33 ms steps agree', () => {
    const sample = (step: number) => {
      const { kit, stars, effect } = standalone();
      effect.play(3);
      const out: number[][] = [];
      for (const t of [100, 300, 333, 700, 990, 1300, 1500]) {
        to(kit, effect, t, step);
        const sprites = [...stars, ...(effect.children as Sprite[]), ...(effect.front.children as Sprite[])];
        out.push(sprites.flatMap((s) => (s.visible ? [s.x, s.y, s.scale.x, s.scale.y, s.alpha, s.rotation] : [NaN])));
      }
      effect.destroy();
      return out;
    };
    const a = sample(16);
    const b = sample(33);
    a.forEach((frame, i) => frame.forEach((v, j) => {
      if (Number.isNaN(v)) expect(b[i]![j]).toBeNaN();
      else expect(Math.abs(v - b[i]![j]!)).toBeLessThan(1e-9);
    }));
  });

  it('6. without the landing art: no flash, rays or sparks — the stars still fly in, spring and glow (their halo)', () => {
    const { kit, stars, effect, rest } = standalone('none');
    expect(effect.getStats().created).toBe(3);
    expect(effect.front.children.length).toBe(0);
    expect(effect.durationFor(3)).toBe(DELAY + 2 * INTERVAL + FLY + 520);
    effect.play(3);
    to(kit, effect, DELAY + 60);
    expect(stars[0]!.scale.x).toBeGreaterThan(rest[0]!.scale);
    to(kit, effect, DELAY + FLY + 20);
    expect(effect.getStats().active).toBe(1); // the halo
    to(kit, effect, 2000);
    expect(stars.every((s) => s.visible && s.alpha === 1)).toBe(true);
    effect.destroy();
  });

  it('7. cancel ends the run with the earned stars at rest; reset hides them; destroy is idempotent and leaves the stars', () => {
    const { kit, stars, effect, rest } = standalone();
    effect.play(2);
    to(kit, effect, DELAY + INTERVAL + 100); // star 2 in flight, star 1 springing
    expect(effect.cancel()).toBe(true);
    expect(effect.getStats()).toMatchObject({ running: false, active: 0, cancelled: 1 });
    expect(stars.map((s) => s.visible)).toEqual([true, true, false]);
    stars.slice(0, 2).forEach((s, i) => expect([s.x, s.y, s.scale.x, s.alpha]).toEqual([rest[i]!.x, rest[i]!.y, rest[i]!.scale, 1]));
    effect.reset();
    expect(stars.map((s) => s.visible)).toEqual([false, false, false]);
    expect(effect.getStats().earned).toBe(0);
    effect.play(3);
    kit.core.update(500);
    effect.destroy();
    effect.destroy();
    expect(effect.destroyed && effect.front.destroyed).toBe(true);
    expect(stars.every((s) => !s.destroyed)).toBe(true);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(effect.play(3)).toBe(false);
    advance(kit.core, 2000);
    expect(kit.motionErrors).toEqual([]);
  });
});

describe('ResultWindowView WIN stars', () => {
  it('8. geometry: 2× the old crown (240 / 288 / 240), upright, the middle 20 % larger and raised; clear of the texts, the reward, the buttons and the ×', () => {
    const kit = createKit();
    const tilted = { ...kit.textures, starGold: new Texture({ source: Texture.WHITE.source }), starGoldL: new Texture({ source: Texture.WHITE.source }), starGoldR: new Texture({ source: Texture.WHITE.source }) };
    const upright = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: tilted, onNext: () => {} });
    expect(starsOf(upright).every((s) => s.texture === tilted.starGold)).toBe(true); // never the level map's tilted L / R art
    upright.destroy();
    const view = createResult(kit);
    const stars = starsOf(view);
    expect(stars.map((s) => [s.x, s.y, s.width, s.rotation])).toEqual([[-272, -540, 240, 0], [0, -600, 288, 0], [272, -540, 240, 0]]);
    view.show(WIN);
    advance(kit.core, 3000);
    const box = (n: Container) => ({ l: n.x - n.width / 2, r: n.x + n.width / 2, t: n.y - n.height / 2, b: n.y + n.height / 2 });
    const others = ['titleText', 'subtitleText', 'rewardCaption', 'rewardCoin', 'rewardAmount', 'nextButton', 'retryButton', 'closeButton'].map((n) => [n, box(field<Container>(view, n))] as const);
    for (const star of stars) {
      const s = box(star);
      for (const [name, o] of others) {
        const overlap = s.l < o.r && o.l < s.r && s.t < o.b && o.t < s.b;
        expect(overlap, `star at ${star.x} over ${name}`).toBe(false);
      }
    }
    // the stars clear the title's top and each other
    expect(box(stars[1]!).b).toBeLessThan(box(field<Container>(view, 'titleText')).t);
    expect(box(stars[0]!).r).toBeLessThanOrEqual(box(stars[1]!).l + 20);
    view.destroy();
  });

  it('9. panel order: flash layer, the stars, spark layer — all under the title; layers take no input and no bounds', () => {
    const kit = createKit();
    const view = createResult(kit);
    const panel = field<Container>(view, 'panel');
    const fx = fxOf(view);
    const stars = starsOf(view);
    const at = (n: Container) => panel.getChildIndex(n);
    expect(stars.map(at)).toEqual([at(fx) + 1, at(fx) + 2, at(fx) + 3]);
    expect(at(fx.front)).toBe(at(fx) + 4);
    expect(at(fx.front)).toBeLessThan(at(field<Container>(view, 'titleText')));
    for (const layer of [fx, fx.front]) {
      expect([layer.eventMode, layer.interactiveChildren, layer.measurable]).toEqual(['none', false, false]);
      expect((layer.children as Sprite[]).every((s) => s.eventMode === 'none')).toBe(true);
    }
    view.destroy();
  });

  it('10. a WIN show runs one star tween after the entrance (one binding, the fx scope); a FAIL none', () => {
    const kit = createKit();
    const view = createResult(kit);
    const tween = vi.spyOn(kit.motion, 'tween');
    const starRuns = () => tween.mock.calls.filter(([o]) => o.scope === 'result-window:fx' && o.bindings.length === 1).length;
    view.show(WIN);
    advance(kit.core, 430);
    expect(starRuns()).toBe(0); // still entering: no star yet
    expect(starsOf(view).some((s) => s.visible)).toBe(false);
    advance(kit.core, 40);
    expect(view.state).toBe('shown');
    expect(starRuns()).toBe(1);
    view.resize(1280, 800);
    advance(kit.core, 2000);
    expect(starRuns()).toBe(1);
    expect(fxOf(view).getStats()).toMatchObject({ plays: 1, completed: 1, earned: 3, running: false });
    view.close('programmatic');
    advance(kit.core, 240);
    view.show(FAIL);
    advance(kit.core, 2000);
    expect(starRuns()).toBe(1);
    expect(starsOf(view).some((s) => s.visible)).toBe(false);
    tween.mockRestore();
    view.destroy();
  });

  it('11. a repeat WIN starts over from t = 0 with the same frames', () => {
    const kit = createKit();
    const view = createResult(kit);
    const run = () => {
      view.show(WIN);
      const frames: number[][] = [];
      for (let i = 0; i < 140; i++) {
        kit.core.update(16);
        const f = fxOf(view);
        frames.push([f.getStats().active, ...starsOf(view).flatMap((s) => (s.visible ? [s.y, s.scale.x, s.alpha] : [0]))]);
      }
      view.close('programmatic');
      advance(kit.core, 240);
      return frames;
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(fxOf(view).getStats().plays).toBe(2);
    view.destroy();
  });

  it('12. every path to hidden mid-run leaves no star, flash or spark; a FAIL after a WIN shows none; nothing runs later', () => {
    const kit = createKit();
    const dismissed: string[] = [];
    const view = createResult(kit, { onDismiss: (r) => dismissed.push(r) });
    const clean = (label: string) => {
      expect(view.state, label).toBe('hidden');
      const fx = fxOf(view);
      expect(fx.getStats(), label).toMatchObject({ active: 0, running: false, earned: 0 });
      expect(drawn(fx) + drawn(fx.front), label).toBe(0);
      expect(starsOf(view).some((s) => s.visible), label).toBe(false);
    };
    const paths: Array<[string, () => void]> = [
      ['continue', () => tap(field<UiButton>(view, 'nextButton'), kit)],
      ['retry', () => tap(field<UiButton>(view, 'retryButton'), kit)],
      ['×', () => tap(field<UiButton>(view, 'closeButton'), kit)],
      ['backdrop', () => { const b = field<Container>(view, 'backdrop'); b.emit('pointertap', { target: b } as never); }],
      ['programmatic', () => view.close('programmatic')],
      ['ui.cancelAll', () => kit.ui.cancelAll()],
      ['core.cancelAll', () => kit.core.cancelAll()]
    ];
    paths.forEach(([label, close], k) => {
      expect(view.show(WIN), label).toBe(true);
      advance(kit.core, 440 + DELAY + FLY + 20 + k * 37); // star 1 just landed: its flash is on
      expect(fxOf(view).getStats().active, label).toBeGreaterThan(0);
      close();
      advance(kit.core, 240);
      clean(label);
    });
    expect(dismissed).toEqual(['button', 'background', 'programmatic']);
    view.show(FAIL);
    for (let t = 0; t < 2000; t += 16) {
      kit.core.update(16);
      expect(drawn(fxOf(view)) + drawn(fxOf(view).front)).toBe(0);
      expect(starsOf(view).some((s) => s.visible)).toBe(false);
    }
    view.close('programmatic');
    advance(kit.core, 240);
    const after = fxOf(view).getStats();
    advance(kit.core, 3000);
    expect(fxOf(view).getStats()).toEqual(after);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('13. motion.cancelScope(fx) while shown ends the entrance with the earned stars at rest, no landing sprite left', () => {
    const kit = createKit();
    const view = createResult(kit);
    view.show({ ...WIN, stars: 2 });
    advance(kit.core, 440 + DELAY + INTERVAL + 60);
    kit.motion.cancelScope('result-window:fx');
    const fx = fxOf(view);
    expect(fx.getStats()).toMatchObject({ running: false, active: 0 });
    expect(drawn(fx) + drawn(fx.front)).toBe(0);
    expect(starsOf(view).map((s) => [s.visible, s.alpha])).toEqual([[true, 1], [true, 1], [false, 1]]);
    view.destroy();
  });

  it('14. 10 WIN open/close cycles: sprites, panel children and motions stay flat; destroy mid-run is clean', () => {
    const kit = createKit();
    const view = createResult(kit, { confetti: true });
    const panel = field<Container>(view, 'panel');
    const children = panel.children.length;
    const created = fxOf(view).getStats().created;
    expect(created).toBe(3 * PER_SLOT);
    for (let cycle = 1; cycle <= 10; cycle++) {
      view.show(WIN);
      advance(kit.core, 500 + cycle * 113);
      tap(field<UiButton>(view, 'nextButton'), kit);
      advance(kit.core, 240);
      expect(panel.children.length).toBe(children);
      expect(fxOf(view).children.length + fxOf(view).front.children.length).toBe(created);
      expect(kit.motion.getStats().activeMotions).toBe(0);
    }
    view.show(WIN);
    advance(kit.core, 1000);
    const fx = fxOf(view);
    view.destroy();
    view.destroy();
    expect(fx.destroyed && fx.front.destroyed).toBe(true);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    advance(kit.core, 2000);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.uiErrors).toEqual([]);
  });

  it('15. a skin without the optional fx art: the stars still come in (fly, spring, halo), nothing else is drawn', () => {
    const kit = createKit();
    const textures = { ...kit.textures };
    for (const name of WIN_CONFETTI_TEXTURES) delete textures[name];
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures, onNext: () => {} });
    expect(fxOf(view).getStats().created).toBe(3);
    view.show(WIN);
    advance(kit.core, 3000);
    expect(starsOf(view).map((s) => s.visible)).toEqual([true, true, true]);
    expect(fxOf(view).getStats()).toMatchObject({ completed: 1, active: 0 });
    view.destroy();
  });

  it('16. a landed star is part of the WIN tap area (a tap on it never dismisses); a mid-flight resize does not change it; an unearned place stays backdrop', () => {
    const kit = createKit();
    const view = createResult(kit);
    view.resize(390, 844);
    const panel = field<Container>(view, 'panel');
    const area = () => { const r = panel.hitArea as Rectangle; return [r.x, r.y, r.width, r.height]; };
    const targetAt = (star: Sprite): string => {
      const root = new Container();
      root.isRenderGroup = true;
      root.addChild(view);
      updateRenderGroupTransforms(root.renderGroup!, true);
      const at = panel.toGlobal({ x: star.x, y: star.y });
      const hit = new EventBoundary(root).hitTest(at.x, at.y);
      root.removeChild(view);
      return hit === field(view, 'backdrop') ? 'backdrop' : hit === null ? 'none' : 'panel';
    };

    view.show(WIN);
    advance(kit.core, 3000);
    const landed = area();
    for (const star of starsOf(view)) {
      expect((panel.hitArea as Rectangle).contains(star.x, star.y)).toBe(true);
      expect(targetAt(star)).toBe('panel');
    }
    view.resize(390, 844); // a resize after the landing measures the same
    expect(area()).toEqual(landed);
    view.close('programmatic');
    advance(kit.core, 240);

    view.show(WIN);
    advance(kit.core, 440 + DELAY + 60); // the first star mid-flight: large, raised, turned
    view.resize(390, 844);
    expect(area()).toEqual(landed);
    view.close('programmatic');
    advance(kit.core, 240);

    view.show({ ...WIN, stars: 1 });
    advance(kit.core, 3000);
    const stars = starsOf(view);
    expect(targetAt(stars[0]!)).toBe('panel');
    expect((panel.hitArea as Rectangle).contains(stars[2]!.x, stars[2]!.y)).toBe(false); // the empty place still dismisses
    expect(targetAt(stars[2]!)).toBe('backdrop');
    view.destroy();
  });
});
