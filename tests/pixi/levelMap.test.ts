import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { advance, createKit, pointer, type TestKit } from './setup';
import { LevelMapView, type LevelMapViewOptions } from '../../src/pixi/LevelMapView';

function createMap(kit: TestKit, overrides: Partial<LevelMapViewOptions> = {}) {
  const selected: Array<{ level: number; state: string }> = [];
  const locked: number[] = [];
  const focus: number[] = [];
  const levels = Array.from({ length: 36 }, (_, i) => ({ index: i + 1, stars: i < 18 ? (i % 4) : 0, hard: (i + 1) % 7 === 0 }));
  const map = new LevelMapView({
    ui: kit.ui,
    motion: kit.motion,
    textures: kit.textures,
    levels,
    currentLevel: 19,
    width: 390,
    height: 844,
    onSelectLevel: (level, state) => selected.push({ level, state }),
    onLockedTap: (level) => locked.push(level),
    onFocusChange: (info) => focus.push(info.focusLevel),
    ...overrides
  });
  return { map, selected, locked, focus };
}

function node(map: LevelMapView, level: number): Container {
  const container = map.getNodeContainer(level);
  if (!container) throw new Error(`node ${level} not built`);
  return container;
}

function tapNode(map: LevelMapView, level: number, kit: TestKit): void {
  const root = node(map, level);
  const y = map.levelScreenY(level);
  map.emit('pointerdown', pointer(195, y) as never);
  root.emit('pointerdown', pointer(195, y) as never);
  advance(kit.core, 80);
  root.emit('pointerup', pointer(195, y) as never);
  map.emit('pointerup', pointer(195, y) as never);
  advance(kit.core, 200);
}

describe('LevelMapView', () => {
  it('maps progress to completed / current / locked nodes with stars', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    expect(map.levelCount).toBe(36);
    expect(map.currentLevel).toBe(19);
    expect(map.getNodeState(1)).toBe('completed');
    expect(map.getNodeState(18)).toBe('completed');
    expect(map.getNodeState(19)).toBe('current');
    expect(map.getNodeState(20)).toBe('locked');
    expect(map.getNodeState(0)).toBeNull();
    expect(map.getNodeState(37)).toBeNull();
    // every built node is a registered ButtonController
    expect(kit.ui.getStats().buttons).toBe(36);
    // a completed node with 3 stars carries three star sprites, a locked one a lock
    const n4 = node(map, 4); // stars = 3 % 4 = 3
    const inner = n4.children[0] as Container;
    expect(inner.children.length).toBeGreaterThanOrEqual(1 + 3 + 1);
    expect(map.getNodeContainer(40)).toBeNull();
  });

  it('accepts a plain level count', () => {
    const kit = createKit();
    const map = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, levels: 12, currentLevel: 30, onSelectLevel: () => {} });
    expect(map.levelCount).toBe(12);
    expect(map.currentLevel).toBe(12); // clamped to the count
    expect(map.getNodeState(12)).toBe('current');
    map.destroy();
  });

  it('starts with the current level under the focus and lays out inside the insets', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    map.resize(390, 844, { insets: { top: 90, bottom: 200 } });
    expect(map.focusLevel).toBe(19);
    expect(map.selectedLevel).toBe(19);
    // donor: the focused badge rests at 60% of the screen height, kept a badge (+ pill) clear
    // of the bottom inset and of the HUD
    const s = Math.min(390 / 1080, 844 / 2344) * map.theme.levelMap.contentScale;
    const reach = (map.theme.levelMap.badgeSize / 2 + 40) * map.theme.levelMap.nodeScale * s;
    const expectedFocus = Math.max(90 + reach, Math.min(844 * map.theme.levelMap.focusRatio, 844 - 200 - reach));
    expect(map.levelScreenY(19)).toBeCloseTo(expectedFocus, 3);
    expect(map.focusPoint.y).toBeCloseTo(expectedFocus, 3);
    // higher levels climb upward
    expect(map.levelScreenY(20)).toBeLessThan(map.levelScreenY(19));
    expect(map.levelScreenY(18)).toBeGreaterThan(map.levelScreenY(19));
    expect(map.contentScale).toBeCloseTo(s, 6);
    // a tall bottom inset pushes the focus up so the badge never hides under the PLAY button
    map.resize(390, 844, { insets: { top: 90, bottom: 500 } });
    expect(map.levelScreenY(19)).toBeCloseTo(844 - 500 - reach, 3);
    map.destroy();
  });

  it('fires onSelectLevel only for a settled tap on an open level', () => {
    const kit = createKit();
    const { map, selected, locked } = createMap(kit);
    tapNode(map, 19, kit);
    expect(selected).toEqual([{ level: 19, state: 'current' }]);
    tapNode(map, 18, kit);
    expect(selected[1]).toEqual({ level: 18, state: 'completed' });
    tapNode(map, 21, kit);
    expect(locked).toEqual([21]);
    expect(selected.length).toBe(2);
    expect(kit.ui.getStats().taps).toBe(3);
    expect(kit.uiErrors).toEqual([]);
    map.destroy();
  });

  it('turns a swipe into a scroll, never a tap', () => {
    const kit = createKit();
    const { map, selected, focus } = createMap(kit);
    const root = node(map, 19);
    const y = map.levelScreenY(19);
    map.emit('pointerdown', pointer(195, y) as never);
    root.emit('pointerdown', pointer(195, y) as never);
    advance(kit.core, 32);
    for (let i = 1; i <= 10; i++) {
      map.emit('globalpointermove', pointer(195, y - i * 30) as never);
      advance(kit.core, 16);
    }
    root.emit('pointerupoutside', pointer(195, y - 300) as never);
    map.emit('pointerupoutside', pointer(195, y - 300) as never);
    advance(kit.core, 1000);
    expect(selected).toEqual([]);
    expect(kit.ui.getStats().cancelledPresses).toBe(1);
    expect(kit.ui.getStats().taps).toBe(0);
    // dragging up brings lower (completed) levels under the focus, and it snaps to a whole level
    expect(map.focusLevel).toBeLessThan(19);
    expect(focus.length).toBeGreaterThan(0);
    expect(map.levelScreenY(map.focusLevel)).toBeCloseTo(map.focusPoint.y, 2);
    expect(kit.motion.getStats().activeTweens).toBeLessThanOrEqual(2); // shine + focus pulse only
    map.destroy();
  });

  it('scrollToLevel positions instantly or through MotionRuntime, clamped to the level range', () => {
    const kit = createKit();
    const { map, focus } = createMap(kit);
    map.scrollToLevel(5, false);
    expect(map.focusLevel).toBe(5);
    expect(map.selectedLevel).toBe(5);
    expect(map.levelScreenY(5)).toBeCloseTo(map.focusPoint.y, 2);

    map.scrollToLevel(30);
    expect(map.focusLevel).toBe(5); // not yet: animation runs on the host clock
    advance(kit.core, 2000);
    expect(map.focusLevel).toBe(30);
    expect(map.selectedLevel).toBe(19); // locked focus clamps the playable selection
    expect(focus.at(-1)).toBe(30);

    map.scrollToLevel(999, false);
    expect(map.focusLevel).toBe(36);
    map.scrollToLevel(-4, false);
    expect(map.focusLevel).toBe(1);
    map.destroy();
  });

  it('keeps the focused level in place across resizes and rebuilds text resolution', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    map.scrollToLevel(12, false);
    map.resize(320, 568, { insets: { top: 60, bottom: 140 }, pixelRatio: 2 });
    expect(map.focusLevel).toBe(12);
    expect(map.levelScreenY(12)).toBeCloseTo(map.focusPoint.y, 2);
    expect(map.contentScale).toBeCloseTo(Math.min(320 / 1080, 568 / 2344) * map.theme.levelMap.contentScale, 6);
    map.resize(1280, 800, { pixelRatio: 1 });
    expect(map.focusLevel).toBe(12);
    expect(map.contentScale).toBeCloseTo((800 / 2344) * map.theme.levelMap.contentScale, 6);
    // degenerate sizes never throw
    map.resize(0, Number.NaN);
    expect(map.focusLevel).toBe(12);
    map.destroy();
  });

  it('setProgress re-derives states and setLevelStars redraws a node', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    const levels = Array.from({ length: 36 }, (_, i) => ({ index: i + 1, stars: i < 19 ? 2 : 0 }));
    map.setProgress({ levels, currentLevel: 20 });
    expect(map.getNodeState(19)).toBe('completed');
    expect(map.getNodeState(20)).toBe('current');
    expect(map.getNodeState(21)).toBe('locked');
    expect(kit.ui.getStats().buttons).toBe(36);
    const before = map.getNodeContainer(19);
    map.setLevelStars(19, 3);
    expect(map.getNodeContainer(19)).not.toBe(before);
    expect(kit.ui.getStats().buttons).toBe(36);
    map.destroy();
  });

  it('builds a window of nodes around the focus for long maps and extends it while scrolling', () => {
    const kit = createKit();
    const map = new LevelMapView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, levels: 500, currentLevel: 250, buildWindow: 20, onSelectLevel: () => {} });
    expect(kit.ui.getStats().buttons).toBe(41);
    expect(map.getNodeContainer(250)).not.toBeNull();
    expect(map.getNodeContainer(300)).toBeNull();
    map.scrollToLevel(300, false);
    expect(map.getNodeContainer(300)).not.toBeNull();
    expect(kit.ui.getStats().buttons).toBe(41);
    map.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('core.cancelAll settles a press without a business callback', () => {
    const kit = createKit();
    const { map, selected } = createMap(kit);
    const root = node(map, 19);
    const y = map.levelScreenY(19);
    map.emit('pointerdown', pointer(195, y) as never);
    root.emit('pointerdown', pointer(195, y) as never);
    advance(kit.core, 30);
    expect(kit.ui.getStats().presses).toBe(1);
    kit.core.cancelAll();
    expect(kit.ui.getStats().cancelledPresses).toBe(1);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    root.emit('pointerup', pointer(195, y) as never);
    map.emit('pointerup', pointer(195, y) as never);
    advance(kit.core, 200);
    expect(selected).toEqual([]);
    map.destroy();
  });

  it('destroy disposes every controller, cancels motion and removes listeners', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    map.scrollToLevel(10);
    expect(kit.motion.getStats().activeMotions).toBeGreaterThan(0);
    expect(map.listenerCount('pointerdown')).toBe(1);
    map.destroy();
    expect(map.destroyed).toBe(true);
    expect(kit.ui.getStats().buttons).toBe(0);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(map.listenerCount('pointerdown')).toBe(0);
    expect(map.listenerCount('globalpointermove')).toBe(0);
    expect(map.listenerCount('wheel')).toBe(0);
    map.destroy(); // idempotent
    expect(kit.uiErrors).toEqual([]);
    expect(kit.motionErrors).toEqual([]);
  });
  // --- node lifecycle vs. the motions that write into a node (regression: the focus pulse outlived its node) ---

  it('setLevelStars on the focused node moves the focus pulse to the redrawn node — nothing keeps writing into the destroyed root', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    advance(kit.core, 400); // the 200 ms focus lift is done: the infinite pulse runs on node 19
    const old = node(map, 19);
    expect(kit.motion.getStats().activeTweens).toBe(2); // shine + pulse
    const big = map.theme.levelMap.nodeScale * map.theme.levelMap.focusBoost;
    expect(old.scale.x).toBeGreaterThanOrEqual(big * 0.99);

    // SoliPix onWin: the level just won (= the focused node) gets its stars while the pulse is running
    map.setLevelStars(19, 3);
    expect(old.destroyed).toBe(true);
    const fresh = node(map, 19);
    expect(fresh).not.toBe(old);
    advance(kit.core, 1000);
    // the old pulse must have been cancelled WITH its node: a binding-set into a destroyed root (scale is null after
    // Container.destroy) is exactly the '[MotionRuntime] callback/binding threw' console error seen in the host
    expect(kit.motionErrors).toEqual([]);
    expect(kit.motion.getStats().bindingErrors).toBe(0);
    // the redrawn node carries the focus: lifted and pulsing, and there is still exactly one pulse
    expect(fresh.scale.x).toBeGreaterThanOrEqual(big * 0.99);
    const s1 = fresh.scale.x;
    advance(kit.core, 350); // half a pulse pass later the scale has moved
    expect(fresh.scale.x).not.toBeCloseTo(s1, 4);
    expect(kit.motion.getStats().activeTweens).toBe(2); // shine + the ONE pulse, now on the fresh node
    expect(kit.uiErrors).toEqual([]);
    map.destroy();
    expect(kit.motion.getStats().activeMotions).toBe(0);
  });

  it('a node redrawn while it settles back from the focus takes its settle tween down with it', () => {
    const kit = createKit();
    const { map } = createMap(kit);
    advance(kit.core, 400);
    map.scrollToLevel(18, false); // focus 19 → 18: node 19 settles back to the base scale over 180 ms
    advance(kit.core, 16);
    const settling = node(map, 19);
    map.setLevelStars(19, 3); // redrawn mid-settle
    expect(settling.destroyed).toBe(true);
    advance(kit.core, 500);
    expect(kit.motionErrors).toEqual([]);
    expect(node(map, 19).scale.x).toBeCloseTo(map.theme.levelMap.nodeScale, 6);
    expect(node(map, 18).scale.x).toBeGreaterThanOrEqual(map.theme.levelMap.nodeScale * map.theme.levelMap.focusBoost * 0.99);
    map.destroy();
  });

  it('a locked-node shake is cancelled with its node when the map rebuilds', () => {
    const kit = createKit();
    const { map, locked } = createMap(kit);
    const root = node(map, 21);
    const y = map.levelScreenY(21);
    map.emit('pointerdown', pointer(195, y) as never);
    root.emit('pointerdown', pointer(195, y) as never);
    advance(kit.core, 80);
    root.emit('pointerup', pointer(195, y) as never);
    map.emit('pointerup', pointer(195, y) as never);
    advance(kit.core, 16);
    expect(locked).toEqual([21]);
    expect(kit.motion.getStats().activeSequences).toBe(1); // the 240 ms shake is in flight on node 21's inner container
    const shaking = root.children[0] as Container;
    map.setProgress({ levels: 36, currentLevel: 20 }); // rebuild while the shake runs
    expect(shaking.destroyed).toBe(true);
    advance(kit.core, 500);
    expect(kit.motionErrors).toEqual([]);
    expect(kit.motion.getStats().activeSequences).toBe(0);
    map.destroy();
  });
});
