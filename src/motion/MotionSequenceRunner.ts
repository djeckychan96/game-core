// Internal only — never exported from src/index.ts. Orchestrates a RuntimeSequence's step
// transitions; the actual per-frame tween/delay math it delegates to is defined exactly once,
// in MotionRuntime.ts, and reused here through the SequenceHost seam below.
import type { RuntimeDelay, RuntimeSequence, RuntimeTween } from './MotionRuntime';
import type { MotionErrorPhase, MotionSequenceStep } from './types';

export type SequenceStatus = 'running' | 'completed' | 'cancelled';

/**
 * The narrow surface MotionRuntime exposes to this module — just the primitives one sequence
 * step needs, not MotionRuntime's full private surface. Avoids a circular import (this file
 * never imports the MotionRuntime class itself, only its record types).
 */
export interface SequenceHost {
  advanceTweenFrame(tween: RuntimeTween, deltaMs: number): SequenceStatus;
  advanceDelayFrame(delay: RuntimeDelay, deltaMs: number): SequenceStatus;
  buildStepOperation(step: MotionSequenceStep): RuntimeTween | RuntimeDelay;
  invokeCallback(
    fn: (() => void) | undefined,
    kind: 'tween' | 'delay' | 'sequence',
    phase: MotionErrorPhase
  ): void;
}

/**
 * Advances one sequence by deltaMs. Never touches MotionRuntime's own top-level operations map —
 * the sequence's current step lives only as `sequence.currentStepOperation`, which is exactly
 * what keeps a running step out of the top-level activeTweens/activeDelays tally.
 */
export function advanceSequence(sequence: RuntimeSequence, deltaMs: number, host: SequenceHost): SequenceStatus {
  if (!sequence.currentStepOperation) {
    const step = sequence.steps[sequence.currentStepIndex];
    if (!step) {
      // No steps at all: an empty sequence completes immediately.
      host.invokeCallback(sequence.onComplete, 'sequence', 'onComplete');
      return 'completed';
    }
    sequence.currentStepOperation = host.buildStepOperation(step);
  }

  const current = sequence.currentStepOperation;
  const result = current.kind === 'tween'
    ? host.advanceTweenFrame(current, deltaMs)
    : host.advanceDelayFrame(current, deltaMs);

  if (result === 'running') {
    return 'running';
  }

  if (result === 'cancelled') {
    // The step's own onCancel already fired inside advanceTweenFrame/advanceDelayFrame.
    sequence.currentStepOperation = null;
    host.invokeCallback(sequence.onCancel, 'sequence', 'onCancel');
    return 'cancelled';
  }

  // 'completed': this step is done (its own onComplete already fired inside advance*Frame).
  // Move on to the next step, if any; otherwise the whole sequence is done.
  sequence.currentStepIndex += 1;
  sequence.currentStepOperation = null;
  const nextStep = sequence.steps[sequence.currentStepIndex];
  if (!nextStep) {
    host.invokeCallback(sequence.onComplete, 'sequence', 'onComplete');
    return 'completed';
  }
  sequence.currentStepOperation = host.buildStepOperation(nextStep);
  return 'running';
}
