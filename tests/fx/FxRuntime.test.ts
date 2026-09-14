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

  test('registerPool throws a clear error on a duplicate key instead of silently replacing it', () => {
    const { runtime } = createRuntime(2);
    expect(() =>
      runtime.registerPool(poolKey, {
        createNode: () => createFakeNode(999),
        maxSize: 2
      })
    ).toThrowError(/already/i);
  });

  test('a throwing onImpact is caught, reported, and does not stop the other effect from updating', () => {
    const errors: unknown[] = [];
    let nextId = 1;
    const runtime = new FxRuntime<FakeNode>(createFakeSurface(), {
      onEffectError: (error, context) => {
        errors.push({ error, context });
      }
    });
    runtime.registerPool(poolKey, {
      createNode: () => createFakeNode(nextId++),
      maxSize: 4,
      prewarm: 4
    });

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      impactT: 0.5,
      onImpact: () => {
        throw new Error('boom in onImpact');
      }
    });
    let otherEffectAdvanced = false;
    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      durationMs: 100,
      onComplete: () => {
        otherEffectAdvanced = true;
      }
    });

    expect(() => runtime.update(100)).not.toThrow();

    expect(errors).toHaveLength(1);
    expect((errors[0] as { context: { phase: string } }).context.phase).toBe('onImpact');
    // the second effect still reached completion in the very same update() call that had the
    // first effect's onImpact throw — the throw never aborted the rest of the frame.
    expect(otherEffectAdvanced).toBe(true);
  });

  test('a throwing onComplete is caught and release still happens (no effect left active forever)', () => {
    const errors: unknown[] = [];
    let nextId = 1;
    const runtime = new FxRuntime<FakeNode>(createFakeSurface(), {
      onEffectError: (error, context) => errors.push({ error, context })
    });
    runtime.registerPool(poolKey, { createNode: () => createFakeNode(nextId++), maxSize: 2, prewarm: 2 });

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 20,
      onComplete: () => {
        throw new Error('boom in onComplete');
      }
    });

    expect(() => runtime.update(20)).not.toThrow();

    expect(errors).toHaveLength(1);
    expect((errors[0] as { context: { phase: string } }).context.phase).toBe('onComplete');
    expect(runtime.getStats()).toMatchObject({ activeEffects: 0, poolReleases: 1 });
  });

  test('a throwing onCancel is caught and the node is still released', () => {
    const errors: unknown[] = [];
    let nextId = 1;
    const runtime = new FxRuntime<FakeNode>(createFakeSurface(), {
      onEffectError: (error, context) => errors.push({ error, context })
    });
    runtime.registerPool(poolKey, { createNode: () => createFakeNode(nextId++), maxSize: 2, prewarm: 2 });

    const handle = runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      onCancel: () => {
        throw new Error('boom in onCancel');
      }
    });

    expect(() => handle?.cancel()).not.toThrow();
    expect(errors).toHaveLength(1);
    expect((errors[0] as { context: { phase: string } }).context.phase).toBe('onCancel');
    expect(runtime.getStats()).toMatchObject({ activeEffects: 0, poolReleases: 1 });
  });

  test('onCancel fires exactly once, onComplete/onCancel are mutually exclusive, and double cancel is a no-op', () => {
    let completions = 0;
    let cancellations = 0;
    const { runtime } = createRuntime(1);

    const handle = runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      onComplete: () => {
        completions += 1;
      },
      onCancel: () => {
        cancellations += 1;
      }
    });

    expect(handle?.cancel()).toBe(true);
    expect(handle?.cancel()).toBe(false); // already cancelled: no-op, not a second onCancel
    expect(cancellations).toBe(1);
    expect(completions).toBe(0); // a cancelled effect never completes

    runtime.update(1000); // nothing left to update; must not resurrect the cancelled effect
    expect(completions).toBe(0);
    expect(cancellations).toBe(1);
  });

  test('an effect that completes normally never fires onCancel', () => {
    let completions = 0;
    let cancellations = 0;
    const { runtime } = createRuntime(1);

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 20,
      onComplete: () => {
        completions += 1;
      },
      onCancel: () => {
        cancellations += 1;
      }
    });

    runtime.update(20);

    expect(completions).toBe(1);
    expect(cancellations).toBe(0);
  });

  test('cancelScope fires onCancel exactly once per effect it actually cancels', () => {
    let cancelled: number[] = [];
    const { runtime } = createRuntime(4);

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      scope: 'level-complete',
      onCancel: ({ id }) => cancelled.push(id)
    });
    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      scope: 'other-scope',
      onCancel: ({ id }) => cancelled.push(id)
    });

    const count = runtime.cancelScope('level-complete');

    expect(count).toBe(1);
    expect(cancelled).toHaveLength(1);
    expect(runtime.getStats().activeEffects).toBe(1); // the other-scope effect is still active
  });

  test('cancelAll fires onCancel exactly once for every still-active effect', () => {
    const cancelled: number[] = [];
    const { runtime } = createRuntime(4);

    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      onCancel: ({ id }) => cancelled.push(id)
    });
    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      onCancel: ({ id }) => cancelled.push(id)
    });

    const count = runtime.cancelAll();

    expect(count).toBe(2);
    expect(cancelled).toHaveLength(2);
    expect(runtime.getStats().activeEffects).toBe(0);
  });

  test('dispose cancels active effects and really destroys every pool node', () => {
    let nextId = 1;
    const surface = createFakeSurface();
    const runtime = new FxRuntime<FakeNode>(surface);
    const nodes: FakeNode[] = [];
    runtime.registerPool(poolKey, {
      createNode: () => {
        const node = createFakeNode(nextId++);
        nodes.push(node);
        return node;
      },
      maxSize: 2,
      prewarm: 2
    });

    let cancelled = false;
    runtime.addProjectile({
      poolKey,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      durationMs: 100,
      onCancel: () => {
        cancelled = true;
      }
    });

    runtime.dispose();

    expect(cancelled).toBe(true);
    expect(runtime.getStats().activeEffects).toBe(0);
    for (const node of nodes) expect(node.destroyed).toBe(true);
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
