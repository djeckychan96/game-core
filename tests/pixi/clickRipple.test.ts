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

/**
 * The production ocean, transcribed 1:1 from Trail Arrow's `ArrowRenderer.updateOceanRipples`:
 * t = min(1, elapsed / 620); per phase of [0, 0.18]: k = clamp((t − phase) / (1 − phase)), a
 * phased ring is skipped while k ≤ 0, radius (10 + 46k)·inv, width (3 − 1.8k)·inv, alpha 0.6(1 − k);
 * the whole ripple ends at t ≥ 1. `inv` is 1 / world scale (constant size on screen).
 */
function donorOcean(elapsedMs: number, inv = 1): Array<{ radius: number; width: number; alpha: number } | null> {
  const t = Math.min(1, elapsedMs / 620);
  if (t >= 1) return [null, null];
  return [0, 0.18].map((phase) => {
    const k = Math.min(1, Math.max(0, (t - phase) / (1 - phase)));
    if (k <= 0 && phase > 0) return null;
    return { radius: (10 + 46 * k) * inv, width: (3 - 1.8 * k) * inv, alpha: 0.6 * (1 - k) };
  });
}

const FRAME_MS = 1000 / 60;

describe('ClickRippleEffect', () => {
  it('defaults are the production ocean of Trail Arrow', () => {
    expect(DEFAULT_CLICK_RIPPLE).toEqual({
      ringPhases: [0, 0.18],
      startRadius: 10,
      endRadius: 56,
      durationMs: 620,
      lineWidth: 3,
      lineWidthEnd: 1.2,
      color: 0xffffff,
      alpha: 0.6,
      ringAlphaDecay: 1,
      radiusEase: 'linear',
      alphaEase: 'linear',
      haloColor: 0x000000,
      haloAlpha: 0,
      haloWidth: 1.5,
      blendMode: 'normal',
      maxActive: 8,
      sizeSpace: 'screen'
    });
  });

  it('spawn draws the first ring at once, the phased ring waits, one pooled Graphics per ring', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    const handle = effect.spawn(120, 200);
    expect(handle?.active).toBe(true);
    expect(effect.getStats()).toMatchObject({ activeRipples: 1, activeRings: 2, createdRings: 2, pooledRings: 0, spawned: 1 });
    expect(kit.motion.getStats().activeTweens).toBe(1);
    const shown = visibleRings(effect);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.position.x).toBe(120);
    expect(shown[0]?.position.y).toBe(200);
    const strokes = strokesOf(shown[0]!);
    expect(strokes).toHaveLength(1); // no halo in production
    expect(strokes[0]).toMatchObject({ radius: 10, width: 3, color: 0xffffff });
    expect(strokes[0]?.alpha).toBeCloseTo(0.6, 9);
    // the second ring appears once t passes its 0.18 phase (111.6 ms)
    kit.core.update(111);
    expect(visibleRings(effect)).toHaveLength(1);
    kit.core.update(1);
    expect(visibleRings(effect)).toHaveLength(2);
    effect.destroy();
  });

  it('matches the donor formula frame by frame and ends both rings together at 620 ms', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    effect.spawn(0, 0);
    const owned = rings(effect);
    expect(owned).toHaveLength(2);
    let elapsed = 0;
    let frames = 0;
    while (elapsed < 620) {
      const donor = donorOcean(elapsed);
      for (let i = 0; i < 2; i++) {
        const expected = donor[i];
        const ring = owned[i]!;
        if (!expected) {
          expect(ring.visible, `ring ${i} at ${elapsed.toFixed(1)} ms should be hidden`).toBe(false);
          continue;
        }
        expect(ring.visible, `ring ${i} at ${elapsed.toFixed(1)} ms should be visible`).toBe(true);
        const [stroke] = strokesOf(ring);
        expect(stroke?.radius).toBeCloseTo(expected.radius, 9);
        expect(stroke?.width).toBeCloseTo(expected.width, 9);
        expect(stroke?.alpha).toBeCloseTo(expected.alpha, 9);
      }
      kit.core.update(FRAME_MS);
      elapsed += FRAME_MS;
      frames += 1;
    }
    expect(frames).toBe(38); // 38 × 16.67 ms = 633 ms > 620 ms
    // the frame that crosses t = 1 releases BOTH rings and completes the ripple
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, activeRings: 0, pooledRings: 2, completed: 1, cancelled: 0 });
    expect(kit.motion.getStats().activeTweens).toBe(0);
    expect(visibleRings(effect)).toHaveLength(0);
    expect(kit.motionErrors).toEqual([]);
    effect.destroy();
  });

  it('reuses pooled rings across spawns instead of creating new Graphics', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    for (let i = 0; i < 4; i++) {
      effect.spawn(10 * i, 0);
      advance(kit.core, 620 + 32);
    }
    expect(effect.getStats()).toMatchObject({ createdRings: 2, completed: 4, activeRings: 0, pooledRings: 2 });
    // default prewarm is two ripples' worth; prewarm is capped at maxActive × rings
    const warm = new ClickRippleEffect({ motion: kit.motion, id: 'w', maxActive: 3 });
    expect(warm.getStats()).toMatchObject({ createdRings: 4, pooledRings: 4 });
    expect(warm.prewarm(100)).toBe(2);
    expect(warm.getStats().createdRings).toBe(6);
    effect.destroy();
    warm.destroy();
  });

  it('quick repeated taps stack up to maxActive = 8, then the oldest ripple is recycled for the newest tap', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    const handles = Array.from({ length: 8 }, (_, i) => {
      const handle = effect.spawn(i, i);
      kit.core.update(20);
      return handle;
    });
    expect(effect.getStats()).toMatchObject({ activeRipples: 8, activeRings: 16, createdRings: 16, recycled: 0 });
    expect(kit.motion.getStats().activeTweens).toBe(8);
    const ninth = effect.spawn(9, 9);
    expect(ninth?.active).toBe(true);
    expect(handles[0]?.active).toBe(false);
    expect(handles[1]?.active).toBe(true);
    expect(effect.getStats()).toMatchObject({ activeRipples: 8, activeRings: 16, createdRings: 16, recycled: 1, cancelled: 0 });
    expect(kit.motion.getStats().activeTweens).toBe(8);
    // a handle cancels only its own ripple
    expect(ninth?.cancel()).toBe(true);
    expect(ninth?.cancel()).toBe(false);
    expect(effect.getStats()).toMatchObject({ activeRipples: 7, cancelled: 1 });
    expect(effect.cancelAll()).toBe(7);
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, activeRings: 0, pooledRings: 16, cancelled: 8 });
    expect(kit.motion.getStats().activeTweens).toBe(0);
    expect(effect.cancelAll()).toBe(0);
    // the pool is reused: the next 8 taps create nothing new
    for (let i = 0; i < 8; i++) effect.spawn(i, 0);
    expect(effect.getStats()).toMatchObject({ activeRipples: 8, createdRings: 16, pooledRings: 0 });
    effect.destroy();
  });

  it('keeps a constant on-screen size under a zoomed world (sizeSpace "screen"), like the donor', () => {
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
    // radius and width are divided by the world scale: 10 px on screen stays 10 px on screen
    const [stroke] = strokesOf(ring);
    expect(stroke?.radius).toBeCloseTo(5, 9);
    expect(stroke?.width).toBeCloseTo(1.5, 9);
    // the inverse is re-evaluated every frame, so a pinch mid-ripple does not change the screen size
    world.scale.set(4);
    kit.core.update(FRAME_MS);
    const [afterZoom] = strokesOf(ring);
    expect(afterZoom?.radius).toBeCloseTo(donorOcean(FRAME_MS, 1 / 4)[0]!.radius, 9);
    expect(afterZoom?.width).toBeCloseTo(donorOcean(FRAME_MS, 1 / 4)[0]!.width, 9);
    // a collapsed world is clamped exactly like the donor (1 / max(0.05, scale))
    world.scale.set(0.01);
    kit.core.update(FRAME_MS);
    expect(strokesOf(ring)[0]?.radius).toBeCloseTo(donorOcean(2 * FRAME_MS, 20)[0]!.radius, 9);
    // "local" sizing scales with the world instead; sizeScale multiplies either way
    world.scale.set(2);
    effect.configure({ sizeSpace: 'local' });
    effect.setSizeScale(3);
    effect.spawn(0, 0, { sizeScale: 0.5, color: 0x22aaff });
    const local = visibleRings(effect).at(-1)!;
    const [localStroke] = strokesOf(local);
    expect(localStroke?.radius).toBeCloseTo(10 * 1.5, 9);
    expect(localStroke?.width).toBeCloseTo(3 * 1.5, 9);
    expect(localStroke?.color).toBe(0x22aaff);
    expect(effect.spawn(Number.NaN, 0)).toBeNull();
    expect(() => effect.setSizeScale(-1)).toThrow(RangeError);
    effect.destroy();
    world.destroy({ children: true });
  });

  it('configure changes future spawns only and validates its input', () => {
    const kit = createKit();
    const effect = new ClickRippleEffect({ motion: kit.motion, id: 't', prewarm: 0 });
    const before = effect.spawn(0, 0);
    effect.configure({ ringPhases: [0, 0.3, 0.6], haloAlpha: 0.35, color: 0x00ff00 });
    expect(effect.config.ringPhases).toEqual([0, 0.3, 0.6]);
    expect(effect.config.durationMs).toBe(620);
    expect(Object.isFrozen(effect.config.ringPhases)).toBe(true);
    effect.spawn(0, 0);
    expect(effect.getStats().activeRings).toBe(2 + 3);
    const latest = rings(effect).slice(-3);
    expect(latest.filter((ring) => ring.visible)).toHaveLength(1); // phases 0.3 / 0.6 wait
    const strokes = strokesOf(latest[0]!);
    expect(strokes).toHaveLength(2); // halo + ring
    expect(strokes[0]?.color).toBe(0x000000);
    expect(strokes[0]?.width).toBeCloseTo(3 + 2 * 1.5, 9);
    expect(strokes[1]?.color).toBe(0x00ff00);
    expect(before?.active).toBe(true);
    advance(kit.core, 640);
    expect(effect.getStats()).toMatchObject({ activeRipples: 0, completed: 2 });
    for (const bad of [
      { ringPhases: [] }, { ringPhases: [0, 1] }, { ringPhases: [-0.1] }, { durationMs: 0 }, { alpha: 2 },
      { maxActive: 0 }, { radiusEase: 'bounce' as never }, { sizeSpace: 'world' as never }
    ]) {
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
