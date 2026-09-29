import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Container, EventBoundary, Rectangle, Texture, updateRenderGroupTransforms, type Sprite } from 'pixi.js';
import 'pixi.js/events'; // the FederatedContainer mixin a browser gets during renderer detection (EventBoundary.hitTest)
import { advance, createKit, pointer } from './setup';
import { ResultWindowView, WIN_CONFETTI_TEXTURES, type ResultWindowParams, type ResultWindowViewOptions } from '../../src/pixi/ResultWindowView';
import { WIN_CONFETTI_TIERS, WinConfettiEffect, resolveWinConfettiConfig } from '../../src/pixi/fx/WinConfettiEffect';
import { READY_UI_OPTIONAL_ASSET_FILES } from '../../src/pixi/assets';
import type { UiButton } from '../../src/pixi/UiButton';

/** Deterministic RNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
// mobile tier (the default): 12 volleys × (40 particles + 1 flash)
const MOBILE_SLOTS = 12 * 41;
// 280 delay + 11 × 480 interval + 1480 life
const MOBILE_RUN_MS = 280 + 11 * 480 + 1480;

function createResult(kit: ReturnType<typeof createKit>, extra: Partial<ResultWindowViewOptions> = {}): ResultWindowView {
  return new ResultWindowView({
    ui: kit.ui, motion: kit.motion, textures: kit.textures,
    onNext: () => {}, onRetry: () => {}, onExit: () => {},
    confetti: { random: seeded(7) },
    ...extra
  });
}

const fx = (view: ResultWindowView): WinConfettiEffect => field<WinConfettiEffect>(view, 'confetti');

describe('WinConfettiEffect config (WIN fireworks volleys)', () => {
  it('keeps the tiers and timing; the pool bound is bursts × (sparks + 1)', () => {
    expect(WIN_CONFETTI_TIERS).toEqual({
      desktop: { bursts: 13, sparksPerBurst: 38 },
      mobile: { bursts: 12, sparksPerBurst: 40 },
      lowPerf: { bursts: 9, sparksPerBurst: 24 }
    });
    const cfg = resolveWinConfettiConfig();
    expect([cfg.tier, cfg.bursts, cfg.sparksPerBurst, cfg.startDelayMs, cfg.burstIntervalMs, cfg.lifetimeMs]).toEqual(['mobile', 12, 40, 280, 480, 1480]);
    expect(resolveWinConfettiConfig({ tier: 'desktop' }).bursts).toBe(13);
    expect(resolveWinConfettiConfig({ tier: 'lowPerf', sparksPerBurst: 4 }).sparksPerBurst).toBe(4);
    expect(() => resolveWinConfettiConfig({ bursts: 40, sparksPerBurst: 40 })).toThrow(/≤ 512/);
    expect(() => resolveWinConfettiConfig({ tier: 'huge' as never })).toThrow(/tier/);
    expect(() => resolveWinConfettiConfig({ lifetimeMs: 0 })).toThrow(/lifetimeMs/);

    const kit = createKit();
    for (const [tier, preset] of Object.entries(WIN_CONFETTI_TIERS)) {
      const effect = new WinConfettiEffect({ motion: kit.motion, scope: 'fx', textures: { spark: Texture.WHITE, glow: Texture.WHITE }, tier: tier as never });
      expect(effect.getStats().created, tier).toBe(preset.bursts * (preset.sparksPerBurst + 1));
      expect(effect.children.length).toBe(effect.getStats().created);
      effect.destroy();
    }
  });
});

describe('ResultWindowView WIN confetti', () => {
  it('1. FAIL draws 0 particles and never starts a run', () => {
    const kit = createKit();
    const view = createResult(kit);
    view.show(FAIL);
    let peak = 0;
    for (let ms = 0; ms < MOBILE_RUN_MS + 500; ms += 16) {
      kit.core.update(16);
      peak = Math.max(peak, fx(view).getStats().active);
    }
    expect(peak).toBe(0);
    expect(fx(view).getStats()).toMatchObject({ active: 0, peakActive: 0, plays: 0, running: false });
    view.destroy();
  });

  it('2. a WIN show starts the effect exactly once: one tween in the window fx scope, not re-started by the entrance or a resize', () => {
    const kit = createKit();
    const view = createResult(kit);
    const tween = vi.spyOn(kit.motion, 'tween');
    view.show(WIN);
    const runs = () => tween.mock.calls.filter(([o]) => o.scope === 'result-window:fx' && o.bindings.length === 0).length;
    expect(runs()).toBe(1);
    expect(fx(view).getStats().plays).toBe(1);
    advance(kit.core, 600); // entrance done → onShown pops the stars (their own tweens, same scope)
    view.resize(1280, 800);
    view.resize(390, 844);
    advance(kit.core, 400);
    expect(runs()).toBe(1);
    expect(fx(view).getStats().plays).toBe(1);
    tween.mockRestore();
    view.destroy();
  });

  it('3. start delay: nothing is drawn before 280 ms, the first volley (40 particles + flash) right after', () => {
    const kit = createKit();
    const view = createResult(kit);
    view.show(WIN);
    advance(kit.core, 272, 16);
    expect(fx(view).getStats().active).toBe(0);
    expect(fx(view).getStats().elapsedMs).toBeCloseTo(272, 9);
    advance(kit.core, 16, 16); // 288 ms
    expect(fx(view).getStats().active).toBe(41);
    advance(kit.core, 480, 16); // 768 ms: volley 1's particles + volley 2 (its flash is gone: a flash lives 20 % = 296 ms)
    expect(fx(view).getStats().active).toBe(40 + 41);
    view.destroy();
  });

  it('4 + 5. active ≤ maxParticles (and ≤ the concurrent bursts) on every frame; created never grows', () => {
    const kit = createKit();
    const view = createResult(kit);
    const { created, maxParticles } = fx(view).getStats();
    expect(created).toBe(MOBILE_SLOTS);
    expect(maxParticles).toBe(MOBILE_SLOTS);
    view.show(WIN);
    // a volley lives 1480 ms, one starts every 480 ms → at most 4 alive at once
    const concurrent = Math.ceil(1480 / 480) * 41;
    let frames = 0;
    for (let ms = 0; ms < MOBILE_RUN_MS + 200; ms += 16) {
      kit.core.update(16);
      const s = fx(view).getStats();
      expect(s.active).toBeLessThanOrEqual(maxParticles);
      expect(s.active).toBeLessThanOrEqual(concurrent);
      expect(s.created).toBe(created);
      expect(s.pooled).toBe(created - s.active);
      expect(fx(view).children.length).toBe(created);
      frames += 1;
    }
    expect(frames).toBeGreaterThan(200);
    // exact peak: 4 volleys' particles at once, minus the 2 oldest blooms (a bloom is drawn for 55 % = 814 ms),
    // + 1 flash (a flash lives 296 ms < the 480 ms interval)
    expect(fx(view).getStats().peakActive).toBe(4 * 40 - 2 + 1);
    // the run completed on its own: back to idle
    expect(fx(view).getStats()).toMatchObject({ active: 0, pooled: created, running: false, completed: 1 });
    view.destroy();
  });

  it('6. 10 WIN open/close cycles: created, children and every runtime count stay flat', () => {
    const kit = createKit();
    const view = createResult(kit);
    const panel = field<Container>(view, 'panel');
    const motionBase = kit.motion.getStats().activeMotions;
    const created = fx(view).getStats().created;
    const children = panel.children.length;
    for (let cycle = 1; cycle <= 10; cycle++) {
      expect(view.show(WIN)).toBe(true);
      advance(kit.core, 700 + cycle * 97); // close at a different point of the run each time
      expect(fx(view).getStats().active).toBeGreaterThan(0);
      tap(field<UiButton>(view, 'nextButton'), kit);
      advance(kit.core, 240);
      expect(view.state).toBe('hidden');
      const s = fx(view).getStats();
      expect(s).toMatchObject({ active: 0, pooled: created, created, running: false, plays: cycle });
      expect(panel.children.length).toBe(children);
      expect(fx(view).children.length).toBe(created);
      expect(kit.motion.getStats().activeMotions).toBe(motionBase);
    }
    expect(kit.ui.getStats().windows).toBe(1);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('7. close path (CONTINUE mid-run) → active 0 once hidden; nothing runs after', () => {
    const kit = createKit();
    const next: number[] = [];
    const view = createResult(kit, { onNext: (p) => next.push(p.level) });
    view.show(WIN);
    advance(kit.core, 900);
    expect(fx(view).getStats().active).toBeGreaterThan(0);
    tap(field<UiButton>(view, 'nextButton'), kit);
    advance(kit.core, 240);
    expect(view.state).toBe('hidden');
    expect(next).toEqual([19]);
    expect(fx(view).getStats()).toMatchObject({ active: 0, running: false, cancelled: 1, completed: 0 });
    const after = fx(view).getStats();
    advance(kit.core, 3000);
    expect(fx(view).getStats()).toEqual(after);
    view.destroy();
  });

  it('8. backdrop and × paths → active 0', () => {
    const kit = createKit();
    const dismissed: string[] = [];
    const view = createResult(kit, { onDismiss: (reason) => dismissed.push(reason) });
    view.show(WIN);
    advance(kit.core, 1000);
    expect(fx(view).getStats().active).toBeGreaterThan(0);
    const backdrop = field<Container>(view, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 240);
    expect(view.state).toBe('hidden');
    expect(fx(view).getStats()).toMatchObject({ active: 0, running: false });

    view.show(WIN);
    advance(kit.core, 1000);
    expect(fx(view).getStats().active).toBeGreaterThan(0);
    tap(field<UiButton>(view, 'closeButton'), kit);
    advance(kit.core, 240);
    expect(view.state).toBe('hidden');
    expect(dismissed).toEqual(['background', 'button']);
    expect(fx(view).getStats()).toMatchObject({ active: 0, running: false, cancelled: 2 });
    view.destroy();
  });

  it('9. ui.cancelAll, motion.cancelScope(fx) and motion.cancelAll each stop the run at once', () => {
    const kit = createKit();
    const view = createResult(kit);
    const cases: Array<[string, () => void]> = [
      ['ui.cancelAll', () => kit.ui.cancelAll()],
      ['motion.cancelScope', () => kit.motion.cancelScope('result-window:fx')],
      ['motion.cancelAll', () => kit.motion.cancelAll()]
    ];
    for (const [name, cancel] of cases) {
      view.close('programmatic');
      advance(kit.core, 240);
      expect(view.show(WIN), name).toBe(true);
      advance(kit.core, 1200);
      expect(fx(view).getStats().active, name).toBeGreaterThan(0);
      cancel();
      expect(fx(view).getStats(), name).toMatchObject({ active: 0, running: false });
      advance(kit.core, 500);
      expect(fx(view).getStats().active, name).toBe(0);
    }
    expect(kit.motionErrors).toEqual([]);
    view.destroy();
  });

  it('10. destroy mid-run → active 0, idempotent, no later callback', () => {
    const kit = createKit();
    const view = createResult(kit);
    view.show(WIN);
    advance(kit.core, 1000);
    const effect = fx(view);
    expect(effect.getStats().active).toBeGreaterThan(0);
    const render = vi.spyOn(effect as unknown as { render: (e: number) => void }, 'render');
    view.destroy();
    view.destroy();
    effect.destroy();
    expect(effect.destroyed).toBe(true);
    expect(effect.getStats()).toMatchObject({ active: 0, running: false });
    expect(kit.motion.getStats().activeMotions).toBe(0);
    advance(kit.core, 3000);
    expect(render).not.toHaveBeenCalled();
    expect(effect.play()).toBe(false);
    expect(kit.motionErrors).toEqual([]);
  });

  it('11. a repeat WIN restarts from t = 0 with the same timeline', () => {
    const kit = createKit();
    const view = createResult(kit);
    const timeline = (): number[] => {
      const counts: number[] = [];
      for (let ms = 0; ms < 1400; ms += 16) {
        kit.core.update(16);
        counts.push(fx(view).getStats().active);
      }
      return counts;
    };
    view.show(WIN);
    const first = timeline();
    view.close('programmatic');
    advance(kit.core, 240);
    view.show({ ...WIN, level: 20 });
    expect(fx(view).getStats().elapsedMs).toBe(0);
    const second = timeline();
    expect(second).toEqual(first); // same spawn schedule, from the start: 0 until 280 ms, then burst by burst
    expect(second.slice(0, 17).every((n) => n === 0)).toBe(true);
    expect(fx(view).getStats().plays).toBe(2);
    view.destroy();
  });

  it('12. 16 ms and 33 ms frame steps give the same particles at the same time (a pure function of elapsed)', () => {
    const run = (stepMs: number, totalMs: number) => {
      const kit = createKit();
      const effect = new WinConfettiEffect({ motion: kit.motion, scope: 'fx', textures: { spark: Texture.WHITE, glow: Texture.WHITE }, tier: 'desktop', random: seeded(42) });
      effect.play();
      advance(kit.core, totalMs, stepMs);
      const sprites = effect.children as Sprite[];
      const snapshot = sprites.map((s) => [s.visible ? 1 : 0, s.x, s.y, s.rotation, s.alpha, s.scale.x]);
      const particles = field<Array<{ spawnMs: number; rotation0: number; angularVelocity: number; core: boolean; active: boolean }>>(effect, 'particles');
      const rotations = particles.map((p) => (p.active && !p.core ? p.rotation0 + p.angularVelocity * ((totalMs - p.spawnMs) / 1000) : null));
      const count = sprites.length;
      effect.destroy();
      return { snapshot, rotations, sprites: count };
    };
    // 528 = 33 × 16 = 16 × 33, 1056 = 33 × 32 = 16 × 66, 2112 = 33 × 64 = 16 × 132
    for (const at of [528, 1056, 2112]) {
      const a = run(16, at);
      const b = run(33, at);
      expect(a.sprites).toBe(13 * 39);
      expect(a.snapshot.filter((s) => s[0] === 1).length).toBeGreaterThan(0);
      for (let i = 0; i < a.snapshot.length; i++) {
        expect(a.snapshot[i]![0], `particle ${i} visibility at ${at} ms`).toBe(b.snapshot[i]![0]);
        if (a.snapshot[i]![0] === 0) continue; // a hidden sprite keeps its last drawn values: not part of the picture
        for (let k = 1; k < 6; k++) {
          // tolerance: elapsed goes through the tween's progress (elapsed / total × total), 1e-9 absorbs that float round trip
          expect(Math.abs(a.snapshot[i]![k]! - b.snapshot[i]![k]!), `particle ${i} field ${k} at ${at} ms`).toBeLessThan(1e-9);
        }
      }
      // rotation is rotation0 + ω · age, never an increment per frame
      const sprites = a.snapshot;
      a.rotations.forEach((r, i) => {
        if (r !== null) expect(Math.abs(sprites[i]![3]! - r)).toBeLessThan(1e-9);
      });
    }
  });

  it('13. the layer takes no input and is excluded from bounds: taps reach the backdrop and the buttons through it', () => {
    const kit = createKit();
    const view = createResult(kit);
    view.show(WIN);
    advance(kit.core, 1100);
    const effect = fx(view);
    expect(effect.getStats().active).toBeGreaterThan(0);
    expect(effect.eventMode).toBe('none');
    expect(effect.interactiveChildren).toBe(false);
    expect(effect.measurable).toBe(false);
    expect((effect.children as Sprite[]).every((s) => s.eventMode === 'none')).toBe(true);

    // a resize mid-run: the panel tap area is the same as without confetti
    const plainKit = createKit();
    const plain = createResult(plainKit, { confetti: false });
    plain.show(WIN);
    advance(plainKit.core, 1100); // same moment: the stars have popped in both
    view.resize(390, 844);
    plain.resize(390, 844);
    const hit = (v: ResultWindowView) => {
      const r = field<Container>(v, 'panel').hitArea as Rectangle;
      return [r.x, r.y, r.width, r.height];
    };
    expect(hit(view)).toEqual(hit(plain));

    // Pixi's own hit test (world transforms updated as a render would) at every visible particle and at every
    // button centre: exactly the target the same scene without confetti gives — never the effect or a sprite
    const boundaryOf = (v: ResultWindowView) => {
      const root = new Container();
      root.isRenderGroup = true;
      root.addChild(v);
      updateRenderGroupTransforms(root.renderGroup!, true);
      return new EventBoundary(root);
    };
    const withFx = boundaryOf(view);
    const without = boundaryOf(plain);
    const roleOf = (v: ResultWindowView, target: Container | null): string => {
      for (let node: Container | null = target; node; node = node.parent) {
        for (const name of ['nextButton', 'retryButton', 'closeButton', 'backdrop', 'panel', 'confetti']) {
          if ((v as unknown as Record<string, unknown>)[name] === node) return name;
        }
      }
      return String(target);
    };
    const points: Array<{ x: number; y: number }> = [];
    for (const sprite of effect.children as Sprite[]) if (sprite.visible) points.push(sprite.getGlobalPosition());
    expect(points.length).toBeGreaterThan(10);
    for (const name of ['nextButton', 'retryButton', 'closeButton'] as const) points.push(field<Container>(view, name).getGlobalPosition());
    const roles = new Set<string>();
    for (const at of points) {
      const role = roleOf(view, withFx.hitTest(at.x, at.y));
      expect(role).not.toBe('confetti');
      expect(role, `at ${at.x}, ${at.y}`).toBe(roleOf(plain, without.hitTest(at.x, at.y)));
      roles.add(role);
    }
    expect([...roles]).toEqual(expect.arrayContaining(['nextButton', 'retryButton', 'closeButton', 'backdrop']));
    const panel = field<Container>(view, 'panel');
    expect(panel.children[panel.children.length - 1]).toBe(field(view, 'closeButton')); // the × stays on top
    plain.destroy();
    view.destroy();
  });

  it('14. confetti off (the default): the Result is exactly as before — no layer, no extra tween, no fx texture needed', () => {
    const scene = (confetti: ResultWindowViewOptions['confetti'] | 'absent') => {
      const kit = createKit();
      const tween = vi.spyOn(kit.motion, 'tween');
      const extra = confetti === 'absent' ? {} : { confetti };
      const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {}, onRetry: () => {}, ...extra });
      view.show(WIN);
      advance(kit.core, 2000);
      const panel = field<Container>(view, 'panel');
      const out = { children: panel.children.map((c) => c.constructor.name), tweens: tween.mock.calls.length, hasFx: (view as unknown as { confetti: unknown }).confetti !== null };
      tween.mockRestore();
      view.destroy();
      return out;
    };
    const absent = scene('absent');
    expect(absent.hasFx).toBe(false);
    expect(scene(false)).toEqual(absent);
    expect(scene(undefined)).toEqual(absent);
    const on = scene(true);
    expect(on.hasFx).toBe(true);
    expect(on.children.length).toBe(absent.children.length + 1);
    expect(on.tweens).toBe(absent.tweens + 1);

    // an existing skin without the optional fx art keeps working; asking for confetti without it fails clearly, before registering
    const kit = createKit();
    const textures = { ...kit.textures };
    for (const name of WIN_CONFETTI_TEXTURES) delete textures[name];
    const old = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures, onNext: () => {} });
    old.destroy();
    expect(() => new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures, onNext: () => {}, confetti: true }))
      .toThrow('ResultWindowView confetti: no fxSparkStar (fx/spark_star.webp), fxGlowSoft (fx/glow_soft.webp) in textures — load them with loadReadyUiAssets({ include: WIN_CONFETTI_TEXTURES })');
    expect(kit.ui.getStats().windows).toBe(0);
    expect(WIN_CONFETTI_TEXTURES.map((n) => READY_UI_OPTIONAL_ASSET_FILES[n])).toEqual(['fx/spark_star.webp', 'fx/glow_soft.webp']);
  });

  it('the source has no clock of its own, no per-particle tween and no allocation in the frame function', () => {
    const source = readFileSync(resolve(__dirname, '../../src/pixi/fx/WinConfettiEffect.ts'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/requestAnimationFrame|setTimeout|setInterval|Ticker|gsap|Graphics|\.delay\(|\.sequence\(/);
    expect(code.match(/\.tween\(/g)?.length).toBe(1); // one tween per run, in play()
    const render = /private render\(elapsed: number\): void \{([\s\S]*?)\n {2}\}\n/.exec(code)?.[1];
    expect(render).toBeDefined();
    expect(render).not.toMatch(/\bnew\b|=>|\[\s*\]|\{\s*\}|\.map\(|\.filter\(|\.slice\(|\.push\(|\.\.\./);
    expect(render).not.toMatch(/rotation\s*\+=/);
  });
});
