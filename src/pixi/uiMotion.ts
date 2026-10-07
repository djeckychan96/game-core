import type { Container } from 'pixi.js';
import type { EaseFn, MotionBinding, MotionHandle, MotionRuntime } from '../index';

// Internal motion helpers of the Ready UI kit (not exported from `game-core/pixi`): one mechanic per semantic event,
// shared by the views that show it. Each helper starts ONE MotionRuntime tween / sequence and returns its handle; the
// caller owns it (one writer per property: cancel the previous handle before starting the next one on the same
// property, and before the target is destroyed — Pixi nulls a destroyed container's position / scale).

/** locked.tap: the LevelMap locked-node shake — left, right, back, settle (240 ms), in the targets' local units. */
const LOCKED_SHAKE_STEPS: ReadonlyArray<readonly [offset: number, durationMs: number]> = [[-16, 50], [16, 70], [-9, 60], [0, 60]];

/**
 * Shakes the targets along x with the locked-tap steps (`amplitude` × the LevelMap's ±16 units), each around the x it
 * has when the shake starts, and moves them together. A cancelled shake puts every target back at its start x, so the
 * caller cancels a running shake before starting the next one.
 */
export function shakeX(motion: MotionRuntime, targets: Container | readonly Container[], scope: string, amplitude = 1): MotionHandle {
  const list: readonly Container[] = Array.isArray(targets) ? targets : [targets as Container];
  const rest = list.map((target) => target.x);
  const binding = (target: Container, to: number): MotionBinding => ({
    get: () => target.x,
    set: (value: number) => {
      target.x = value;
    },
    to
  });
  return motion.sequence({
    scope,
    steps: LOCKED_SHAKE_STEPS.map(([offset, durationMs]) => ({
      type: 'tween' as const,
      bindings: list.map((target, i) => binding(target, (rest[i] ?? 0) + offset * amplitude)),
      durationMs,
      ease: 'easeInOut' as const
    })),
    onCancel: () => {
      list.forEach((target, i) => {
        target.x = rest[i] ?? 0;
      });
    }
  });
}

/** A half sine (0 → 1, zero velocity at both ends): the soft in-and-out of an idle "breathing" loop. */
export const sineInOut: EaseFn = (t: number): number => {
  const p = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 0.5 - 0.5 * Math.cos(Math.PI * p);
};
