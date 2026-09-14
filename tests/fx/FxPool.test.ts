import { describe, expect, test } from 'vitest';
import { FxPool } from '../../src/fx/FxPool';
import { createFakeNode, createFakeSurface } from './fakeSurface';

describe('FxPool', () => {
  test('prewarm creates idle nodes up to the requested count', () => {
    let nextId = 1;
    const pool = new FxPool({
      surface: createFakeSurface(),
      createNode: () => createFakeNode(nextId++),
      maxSize: 5
    });

    pool.prewarm(3);

    expect(pool.stats()).toMatchObject({
      createdNodes: 3,
      available: 3,
      active: 0,
      maxSize: 5
    });
  });

  test('acquire reuses prewarmed nodes before creating more', () => {
    let nextId = 1;
    const pool = new FxPool({
      surface: createFakeSurface(),
      createNode: () => createFakeNode(nextId++),
      maxSize: 3
    });
    pool.prewarm(2);

    const first = pool.acquire();
    const second = pool.acquire();

    expect(first?.id).toBe(2);
    expect(second?.id).toBe(1);
    expect(pool.stats()).toMatchObject({
      createdNodes: 2,
      available: 0,
      active: 2,
      acquires: 2,
      misses: 0
    });
  });

  test('release detaches and resets node state before reuse', () => {
    let nextId = 1;
    const surface = createFakeSurface();
    const pool = new FxPool({
      surface,
      createNode: () => createFakeNode(nextId++),
      maxSize: 2
    });
    const node = pool.acquire();
    expect(node).not.toBeNull();
    if (!node) return;

    surface.attach(node);
    surface.setPosition(node, 24, 42);
    surface.setScale(node, 3, 2);
    surface.setRotation(node, 1.4);
    surface.setAlpha(node, 0.25);
    surface.setVisible(node, true);

    pool.release(node);
    const reused = pool.acquire();

    expect(reused).toBe(node);
    expect(node).toMatchObject({
      attached: false,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      alpha: 1,
      visible: false
    });
    expect(pool.stats()).toMatchObject({
      releases: 1,
      active: 1
    });
  });

  test('maxSize prevents unbounded node creation', () => {
    let nextId = 1;
    const pool = new FxPool({
      surface: createFakeSurface(),
      createNode: () => createFakeNode(nextId++),
      maxSize: 2
    });

    const first = pool.acquire();
    const second = pool.acquire();
    const third = pool.acquire();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
    expect(pool.stats()).toMatchObject({
      createdNodes: 2,
      active: 2,
      available: 0,
      misses: 1
    });
  });

  test('clear releases active and idle nodes without destroying capacity accounting', () => {
    let nextId = 1;
    const pool = new FxPool({
      surface: createFakeSurface(),
      createNode: () => createFakeNode(nextId++),
      maxSize: 3
    });
    pool.prewarm(2);
    const active = pool.acquire();
    expect(active).not.toBeNull();

    pool.clear();

    expect(pool.stats()).toMatchObject({
      createdNodes: 2,
      active: 0,
      available: 0,
      maxSize: 3
    });
  });

  test('clear lets the pool refill to maxSize', () => {
    let nextId = 1;
    const pool = new FxPool({
      surface: createFakeSurface(),
      createNode: () => createFakeNode(nextId++),
      maxSize: 2
    });
    pool.prewarm(2);
    pool.clear();

    const first = pool.acquire();
    const second = pool.acquire();
    const third = pool.acquire();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
    expect(pool.stats()).toMatchObject({
      createdNodes: 4,
      active: 2,
      misses: 1
    });
  });
});
