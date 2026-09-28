// QA-only lives seam — sets the count of a game's Core lives in a QA BUILD. The root runtime keeps NO setter:
// this module lives only in `game-core/qa` and drives the runtime through its PUBLIC API alone —
//   up:   grant(n, 'qa-lives-seam')                               (capped, one write)
//   down: one paid-and-closed attempt per life (startAttempt + endAttempt('exit'): exit never refunds)
// so every record it leaves is one the runtime wrote itself: the count, the regeneration stamp (re-anchored by the
// runtime's own rules) and the attempt flag stay consistent, and no private field is touched.
//
// The open attempt survives: an attempt this session started / resumed is closed, the count adjusted, and a new one
// opened (its spend lands exactly on the target); a stored attempt not resumed yet is ADOPTED first (resumeAttempt,
// no spend) and kept open the same way — never abandoned, never paid twice. A raise (grant) never touches the attempt.
import type { LivesAttemptOutcome, LivesResult, LivesSnapshot } from '../lives/LivesRuntime';
import type { SaveWriteResult } from '../save/SaveGate';
import type { QaNumberCapability } from './types';

/** The `source` of the seam's grant (and its marker: a release scan of a game proves this string is absent). */
export const QA_LIVES_SOURCE = 'qa-lives-seam';

/** The public methods of a Core lives runtime the seam uses. */
export interface QaLivesTarget {
  readonly maxLives: number;
  snapshot(): LivesSnapshot;
  grant(amount: number, source?: string): LivesResult;
  startAttempt(): LivesResult;
  endAttempt(outcome: LivesAttemptOutcome): LivesResult;
  resumeAttempt(): LivesResult;
}

export interface QaLivesSetResult {
  from: number;
  lives: number;
  maxLives: number;
  /** open = this session's attempt kept open; adopted = a stored attempt resumed and kept open; closed = none was open. */
  attempt: 'open' | 'adopted' | 'closed';
  /** Writes of the lives record this call made. */
  writes: number;
  /** Every one of them confirmed by the save (false: the memory stands, the next write carries it — e.g. QA OFFLINE). */
  saved: boolean;
}

/**
 * Sets the lives count to `target` (an integer 0…maxLives) through the runtime's public API. Rejects when the count
 * is unknown or not writable (not loaded, unavailable, gate not open, disposed) — nothing is changed then.
 */
export async function setQaLives(lives: QaLivesTarget, target: number): Promise<QaLivesSetResult> {
  if (!Number.isSafeInteger(target) || target < 0 || target > lives.maxLives) throw new RangeError(`qa lives: value must be an integer 0…${lives.maxLives}`);
  const before = lives.snapshot();
  if (!before.writable || before.lives === null) throw new Error(`qa lives: not writable (${before.status}${before.problem ? ` / ${before.problem}` : ''})`);
  const from = before.lives;
  const writes: Array<Promise<SaveWriteResult>> = [];
  const step = (result: LivesResult, what: string): void => {
    if (!result.ok) throw new Error(`qa lives: ${what} refused (${result.reason ?? 'unknown'})`);
    if (result.saved) writes.push(result.saved);
  };
  const count = (): number => lives.snapshot().lives ?? -1;
  let attempt: QaLivesSetResult['attempt'] = before.attemptOpen ? 'open' : 'closed';
  if (target > from) {
    step(lives.grant(target - from, QA_LIVES_SOURCE), 'grant');
  } else if (target < from) {
    if (attempt === 'closed' && lives.resumeAttempt().ok) attempt = 'adopted';
    const reopen = attempt !== 'closed';
    if (reopen) step(lives.endAttempt('exit'), 'close');
    // the reopening spend is the last life taken: stop one above the target when it follows
    const floor = reopen ? target + 1 : target;
    for (let guard = lives.maxLives + 1; count() > floor && guard > 0; guard--) {
      step(lives.startAttempt(), 'spend');
      step(lives.endAttempt('exit'), 'close');
    }
    if (reopen) step(lives.startAttempt(), 'reopen');
  }
  const after = lives.snapshot();
  if (after.lives !== target) throw new Error(`qa lives: ended at ${String(after.lives)}, wanted ${target}`);
  const results = await Promise.all(writes);
  return { from, lives: after.lives, maxLives: lives.maxLives, attempt, writes: writes.length, saved: results.every((result) => result.ok) };
}

/** The standard `lives` number capability of a QA build over the game's Core lives (`lives.set { value }`). */
export function createLivesQaCapability(lives: QaLivesTarget, options: { id?: string; label?: string; hint?: string } = {}): QaNumberCapability {
  return {
    id: options.id ?? 'lives',
    kind: 'number',
    label: options.label ?? 'Lives',
    hint: options.hint ?? `Core lives 0…${lives.maxLives} (QA seam: grant / paid-and-closed attempts, open attempt kept)`,
    min: 0,
    max: lives.maxLives,
    step: 1,
    get: () => lives.snapshot().lives,
    set: (value: number) => setQaLives(lives, value)
  };
}
