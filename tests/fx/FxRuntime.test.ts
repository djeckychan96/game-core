import { describe, expect, test } from 'vitest';
import { FxRuntime } from '../../src/fx/FxRuntime';
import { createFakeNode, createFakeSurface, type FakeNode } from './fakeSurface';

const poolKey = 'test-pool';

function createRuntime(maxSize = 8, prewarm = maxSize) {
  let nextId = 1;
  const surface = createFakeSurface();
  const runtime = new FxRuntime<FakeNode>(surface, { random: () => 0.5 });
  runtime.registerPool(poolKey, {
    createNode: () => createFakeNode(nextId++),
    maxSize,
    prewarm
  });
  return { runtime };
}

describe('FxRuntime', () => {
  test('update returns false when idle', () => {
    const { runtime } = createRuntime();

    expect(runtime.update(16)).toBe(false);
  });

  test('projectile reaches its end point before releasing', () => {
    const { runtime } = createRuntime(1);
    let completePoint: { x: number; y: number } | null = null;

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      durationMs: 100,
      onComplete: ({ node }) => {
        completePoint = { x: node.x, y: node.y };
      }
    });

    expect(runtime.update(100)).toBe(true);

    expect(completePoint).toEqual({ x: 100, y: 50 });
    expect(runtime.getStats().activeEffects).toBe(0);
  });

  test('projectile impact fires once when crossing impactT', () => {
    const { runtime } = createRuntime(1);
    let impacts = 0;

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      impactT: 0.5,
      onImpact: () => {
        impacts += 1;
      }
    });

    runtime.update(49);
    runtime.update(1);
    runtime.update(1);
    runtime.update(100);

    expect(impacts).toBe(1);
  });

  test('projectile completion fires once', () => {
    const { runtime } = createRuntime(1);
    let completions = 0;

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 20,
      onComplete: () => {
        completions += 1;
      }
    });

    runtime.update(20);
    runtime.update(20);

    expect(completions).toBe(1);
  });

  test('projectile delay keeps node hidden until local time starts', () => {
    const { runtime } = createRuntime(1);
    let impacts = 0;

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 30, y: 0 },
      durationMs: 100,
      delayMs: 50,
      impactT: 0.1,
      onImpact: () => {
        impacts += 1;
      }
    });

    runtime.update(49);
    const statsBeforeStart = runtime.getStats();
    runtime.update(1);
    runtime.update(10);

    expect(statsBeforeStart.activeEffects).toBe(1);
    expect(impacts).toBe(1);
  });

  test('radial burst releases all nodes after their durations finish', () => {
    const { runtime } = createRuntime(4);

    runtime.addRadialBurst({
      poolKey,
      center: { x: 10, y: 20 },
      count: 4,
      distanceMin: 20,
      distanceMax: 20,
      durationMinMs: 50,
      durationMaxMs: 50,
      scaleMin: 0.5,
      scaleMax: 0.5,
      alpha: 0.6
    });

    expect(runtime.update(25)).toBe(true);
    expect(runtime.getStats().activeEffects).toBe(4);
    expect(runtime.update(25)).toBe(true);
    expect(runtime.getStats()).toMatchObject({
      activeEffects: 0,
      poolReleases: 4
    });
  });

  test('cancelScope releases all effects in the scope without completion callbacks', () => {
    const { runtime } = createRuntime(4);
    let completions = 0;
    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      scope: 'level-complete',
      onComplete: () => {
        completions += 1;
      }
    });
    runtime.addRadialBurst({
      poolKey,
      center: { x: 0, y: 0 },
      count: 2,
      distanceMin: 10,
      distanceMax: 10,
      durationMinMs: 100,
      durationMaxMs: 100,
      scope: 'level-complete'
    });

    const cancelled = runtime.cancelScope('level-complete');

    expect(cancelled).toBe(3);
    expect(completions).toBe(0);
    expect(runtime.getStats()).toMatchObject({
      activeEffects: 0,
      poolReleases: 3
    });
  });

  test('prewarmed capacity prevents node creation and misses during a burst', () => {
    const { runtime } = createRuntime(4, 4);
    const before = runtime.getStats();

    runtime.addRadialBurst({
      poolKey,
      center: { x: 0, y: 0 },
      count: 4,
      distanceMin: 10,
      distanceMax: 10,
      durationMinMs: 20,
      durationMaxMs: 20
    });
    runtime.update(20);
    const after = runtime.getStats();

    expect(after.createdNodes).toBe(before.createdNodes);
    expect(after.poolMisses).toBe(0);
    expect(after.droppedEffects).toBe(0);
    expect(after.activeEffects).toBe(0);
  });
});
