import { describe, expect, it } from 'vitest';
import { Container, type Graphics } from 'pixi.js';
import { advance, createKit } from './setup';
import { ClickRippleEffect, DEFAULT_CLICK_RIPPLE } from '../../src/pixi/fx/ClickRippleEffect';

interface StrokeSnapshot {
  radius: number;
  width: number;
  color: number;
  alpha: number;
}

/** The strokes a ring Graphics currently holds (halo first, ring last), read from Pixi's instructions. */
function strokesOf(ring: Graphics): StrokeSnapshot[] {
  return ring.context.instructions
    .filter((instruction) => instruction.action === 'stroke')
    .map((instruction) => {
      const data = instruction.data as { style: { width: number; color: number; alpha: number }; path: { instructions: Array<{ action: string; data: number[] }> } };
      const circle = data.path.instructions.find((step) => step.action === 'circle');
      return { radius: circle?.data[2] ?? -1, width: data.style.width, color: data.style.color, alpha: data.style.alpha };
    });
}

function rings(effect: ClickRippleEffect): Graphics[] {
  return effect.children as Graphics[];
}

function visibleRings(effect: ClickRippleEffect): Graphics[] {
  return rings(effect).filter((ring) => ring.visible);
}

describe('ClickRippleEffect', () => {
  it('spawn draws the first ring at once and holds one pooled Graphics per ring', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    const handle = effect.spawn(120, 200);
    expect(handle?.active).toBe(true);
    expect(effect.getStats()).toMatchObject({ activeRipples: 1, activeRings: 3, createdRings: 3, pooledRings: 0, spawned: 1 });
    expect(kit.motion.getStats().activeTweens).toBe(1);
    // first ring visible immediately at startRadius, the staggered ones still hidden
    const shown = visibleRings(effect);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.position.x).toBe(120);
    expect(shown[0]?.position.y).toBe(200);
    const strokes = strokesOf(shown[0]!);
    expect(strokes).toHaveLength(2); // halo + ring
    expect(strokes[1]).toMatchObject({ radius: DEFAULT_CLICK_RIPPLE.startRadius, width: DEFAULT_CLICK_RIPPLE.lineWidth, color: 0xffffff });
    expect(strokes[1]?.alpha).toBeCloseTo(DEFAULT_CLICK_RIPPLE.alpha, 5);
    expect(strokes[0]?.color).toBe(DEFAULT_CLICK_RIPPLE.haloColor);
    expect(strokes[0]?.width).toBeCloseTo(DEFAULT_CLICK_RIPPLE.lineWidth + 2 * DEFAULT_CLICK_RIPPLE.haloWidth, 5);
    effect.destroy();
  });

  it('runs the lifecycle through the host clock: rings stagger in, grow, thin, fade and return to the pool', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    effect.spawn(0, 0);
    const { durationMs, staggerMs, startRadius, endRadius } = DEFAULT_CLICK_RIPPLE;
    advance(kit.core, staggerMs + 16);
    expect(visibleRings(effect)).toHaveLength(2);
    advance(kit.core, staggerMs);
    expect(visibleRings(effect)).toHaveLength(3);
    // the first ring grows monotonically while its alpha only ever decreases
    const first = rings(effect)[0]!;
    let lastRadius = strokesOf(first)[1]!.radius;
    let lastAlpha = strokesOf(first)[1]!.alpha;
    expect(lastRadius).toBeGreaterThan(startRadius);
    for (let i = 0; i < 8; i++) {
      advance(kit.core, 16);
      const [, ring] = strokesOf(first);
      expect(ring!.radius).toBeGreaterThanOrEqual(lastRadius);
      expect(ring!.alpha).toBeLessThanOrEqual(lastAlpha);
      expect(ring!.radius).toBeLessThanOrEqual(endRadius);
      lastRadius = ring!.radius;
      lastAlpha = ring!.alpha;
    }
    // the first ring finishes before the last one does
    advance(kit.core, durationMs - (2 * staggerMs + 16 + 8 * 16) + 16);
    expect(effect.getStats().activeRings).toBe(2);
    expect(effect.getStats().pooledRings).toBe(1);
    // run out the whole train → nothing active, every ring pooled, one completion, no tween left
    advance(kit.core, durationMs + 3 * staggerMs);
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, activeRings: 0, pooledRings: 3, completed: 1, cancelled: 0 });
    expect(kit.motion.getStats().activeTweens).toBe(0);
    expect(visibleRings(effect)).toHaveLength(0);
    expect(kit.motionErrors).toEqual([]);
    effect.destroy();
  });

  it('reuses pooled rings across spawns instead of creating new Graphics', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    const total = DEFAULT_CLICK_RIPPLE.durationMs + DEFAULT_CLICK_RIPPLE.staggerMs * 2;
    for (let i = 0; i < 4; i++) {
      effect.spawn(10 * i, 0);
      advance(kit.core, total + 32);
    }
    expect(effect.getStats()).toMatchObject({ createdRings: 3, completed: 4, activeRings: 0, pooledRings: 3 });
    // prewarm creates the idle rings up front, capped at maxActive × rings
    const warm = new ClickRippleEffect({ motion: kit.motion, id: 'w', rings: 2, maxActive: 3 });
    expect(warm.getStats()).toMatchObject({ createdRings: 4, pooledRings: 4 });
    expect(warm.prewarm(100)).toBe(2);
    expect(warm.getStats().createdRings).toBe(6);
    effect.destroy();
    warm.destroy();
  });

  it('repeated taps stack up to maxActive, then the oldest ripple is recycled for the newest tap', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0, maxActive: 3 });
    const handles = [0, 1, 2].map((i) => effect.spawn(i, i));
    expect(effect.getStats()).toMatchObject({ activeRipples: 3, activeRings: 9, createdRings: 9 });
    advance(kit.core, 40);
    const fourth = effect.spawn(9, 9);
    expect(fourth?.active).toBe(true);
    expect(handles[0]?.active).toBe(false);
    expect(handles[1]?.active).toBe(true);
    expect(effect.getStats()).toMatchObject({ activeRipples: 3, activeRings: 9, createdRings: 9, recycled: 1, cancelled: 0 });
    expect(kit.motion.getStats().activeTweens).toBe(3);
    // a handle cancels only its own ripple
    expect(fourth?.cancel()).toBe(true);
    expect(fourth?.cancel()).toBe(false);
    expect(effect.getStats()).toMatchObject({ activeRipples: 2, cancelled: 1 });
    expect(effect.cancelAll()).toBe(2);
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, activeRings: 0, pooledRings: 9, cancelled: 3 });
    expect(kit.motion.getStats().activeTweens).toBe(0);
    expect(effect.cancelAll()).toBe(0);
    effect.destroy();
  });

  it('spawnGlobal converts screen points through the container transform; setSizeScale scales the drawing', () => {
    const kit = createKit();
    const world = new Container();
    world.position.set(100, 50);
    world.scale.set(2);
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    world.addChild(effect);
    effect.spawnGlobal(300, 250);
    const ring = visibleRings(effect)[0]!;
    expect(ring.position.x).toBeCloseTo(100, 5);
    expect(ring.position.y).toBeCloseTo(100, 5);
    // a resize changes the size scale: the same tap draws proportionally bigger rings
    effect.setSizeScale(2);
    effect.spawn(0, 0, { sizeScale: 1.5, color: 0x22aaff });
    const big = visibleRings(effect)[1]!;
    const [halo, main] = strokesOf(big);
    expect(main?.radius).toBeCloseTo(DEFAULT_CLICK_RIPPLE.startRadius * 3, 5);
    expect(main?.width).toBeCloseTo(DEFAULT_CLICK_RIPPLE.lineWidth * 3, 5);
    expect(main?.color).toBe(0x22aaff);
    expect(halo?.width).toBeCloseTo((DEFAULT_CLICK_RIPPLE.lineWidth + 2 * DEFAULT_CLICK_RIPPLE.haloWidth) * 3, 5);
    expect(effect.spawn(Number.NaN, 0)).toBeNull();
    expect(() => effect.setSizeScale(-1)).toThrow(RangeError);
    effect.destroy();
    world.destroy({ children: true });
  });

  it('configure changes future spawns only and validates its input', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    const before = effect.spawn(0, 0);
    effect.configure({ rings: 5, haloAlpha: 0, color: 0x00ff00, staggerMs: 0 });
    expect(effect.config.rings).toBe(5);
    expect(effect.config.durationMs).toBe(DEFAULT_CLICK_RIPPLE.durationMs);
    effect.spawn(0, 0);
    expect(effect.getStats().activeRings).toBe(3 + 5);
    const latest = rings(effect).slice(-5);
    expect(latest.every((ring) => ring.visible)).toBe(true); // no stagger → all five at once
    expect(strokesOf(latest[0]!)).toHaveLength(1); // halo off
    expect(strokesOf(latest[0]!)[0]?.color).toBe(0x00ff00);
    expect(before?.active).toBe(true);
    for (const bad of [{ rings: 0 }, { rings: 1.5 }, { durationMs: 0 }, { alpha: 2 }, { maxActive: 0 }, { radiusEase: 'bounce' as never }]) {
      expect(() => effect.configure(bad)).toThrow(RangeError);
    }
    expect(() => new ClickRippleEffect({ motion: kit.motion, endRadius: -1 })).toThrow(RangeError);
    effect.destroy();
  });

  it('pauses and resumes with the motion scope like every other Game Core motion', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    effect.spawn(0, 0);
    expect(kit.core.pauseScope(effect.scope)).toBe(1);
    advance(kit.core, 2000);
    expect(effect.getStats().activeRipples).toBe(1);
    expect(kit.core.resumeScope(effect.scope)).toBe(1);
    advance(kit.core, 2000);
    expect(effect.getStats().activeRipples).toBe(0);
    // cancelAll on the core settles the ripples together with the UI
    effect.spawn(0, 0);
    kit.core.cancelAll();
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, cancelled: 1 });
    effect.destroy();
  });

  it('destroy cancels the tweens, destroys the rings and never calls back afterwards', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't' });
    const handle = effect.spawn(5, 5);
    effect.spawn(6, 6);
    const owned = rings(effect);
    expect(owned.length).toBeGreaterThan(0);
    effect.destroy();
    expect(effect.destroyed).toBe(true);
    expect(handle?.active).toBe(false);
    expect(kit.motion.getStats().activeTweens).toBe(0);
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, activeRings: 0, pooledRings: 0, cancelled: 2 });
    expect(owned.every((ring) => ring.destroyed)).toBe(true);
    expect(effect.spawn(0, 0)).toBeNull();
    expect(effect.spawnGlobal(0, 0)).toBeNull();
    expect(effect.prewarm(3)).toBe(0);
    advance(kit.core, 2000);
    expect(kit.motion.getStats().callbackErrors).toBe(0);
    expect(kit.motionErrors).toEqual([]);
    effect.destroy(); // idempotent
    // a runtime disposed before the effect: destroy still settles locally
    const late = new ClickRippleEffect({ motion: kit.motion, id: 'late', prewarm: 0 });
    late.spawn(1, 1);
    kit.motion.dispose();
    expect(late.getStats().activeRipples).toBe(0);
    late.destroy();
    expect(kit.motionErrors).toEqual([]);
  });
});
