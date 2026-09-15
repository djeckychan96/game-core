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
  /** Removes a top-level operation from the runtime — must be called BEFORE that operation's own
   * terminal callback (onComplete/onCancel) fires, so a reentrant cancel from within it (or a
   * sibling processed later the same update()) can never re-finalize it a second time. `outcome`
   * records the sequence's own completedMotions/cancelledMotions count exactly once, regardless
   * of how many steps it had. */
  removeOperation(id: number, outcome: 'completed' | 'cancelled'): void;
  /** Whether a top-level operation is still present (not yet finalized by a reentrant call). */
  isOperationActive(id: number): boolean;
}

/**
 * Advances one sequence by deltaMs. Never touches MotionRuntime's own top-level operations map
 * directly — the sequence's current step lives only as `sequence.currentStepOperation`, which is
 * exactly what keeps a running step out of the top-level activeTweens/activeDelays tally. The one
 * exception is the sequence's OWN top-level entry, finalized through `host.removeOperation`
 * immediately before its own onComplete/onCancel — never deferred to the caller.
 */
export function advanceSequence(sequence: RuntimeSequence, deltaMs: number, host: SequenceHost): SequenceStatus {
  if (!sequence.currentStepOperation) {
    const step = sequence.steps[sequence.currentStepIndex];
    if (!step) {
      // No steps at all: an empty sequence completes immediately.
      host.removeOperation(sequence.id, 'completed');
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

  // The current step's own onComplete/onCancel (if any) already fired inside
  // advanceTweenFrame/advanceDelayFrame — which could, reentrantly, have reached back and
  // cancelled/completed this very sequence (e.g. a step's own onComplete cancelling its parent's
  // scope). If that already happened, this sequence is already finalized; do not finalize or
  // fire its own callback a second time.
  if (!host.isOperationActive(sequence.id)) {
    return result;
  }

  if (result === 'cancelled') {
    sequence.currentStepOperation = null;
    host.removeOperation(sequence.id, 'cancelled');
    host.invokeCallback(sequence.onCancel, 'sequence', 'onCancel');
    return 'cancelled';
  }

  // 'completed': this step is done. Move on to the next step, if any; otherwise the whole
  // sequence is done.
  sequence.currentStepIndex += 1;
  sequence.currentStepOperation = null;
  const nextStep = sequence.steps[sequence.currentStepIndex];
  if (!nextStep) {
    host.removeOperation(sequence.id, 'completed');
    host.invokeCallback(sequence.onComplete, 'sequence', 'onComplete');
    return 'completed';
  }
  sequence.currentStepOperation = host.buildStepOperation(nextStep);
  return 'running';
}
