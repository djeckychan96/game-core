// LivesRuntime V1.1 — the lives of a game whose lives belong to Core: the count, the cap, the regeneration
// and the open level attempt live in the SaveGate Core record `lives`, never in a game key. Generic
// semantics of Trail Arrow 0.1.31 (ClientLogicSystem / HeartsRefillSystem); every number is the host's
// config. It only COUNTS: windows, ads, purchases, prices, free-level or unlimited-lives rules and the
// HUD timer text stay outside. No timer, no global: time comes from the injected clock (epoch ms).
import type { SaveGate, SaveReadStatus, SaveWriteResult } from '../save/SaveGate';

/** The runtime's record in the SaveGate Core namespace: `<profile.id>.core` → `{ lives: { v, lives, regenStart, attempt? } }`. */
const RECORD = 'lives';
/**
 * Any change of the record's shape bumps it; another version is unknown data (unavailable, never overwritten).
 * V1.1 stays 1: `attempt` is an optional field whose absence means "closed" — exactly what a record written
 * before it holds — so every stored V1 record reads unchanged.
 */
const FORMAT = 1;

/** The game's lives rules — product numbers, passed by the host (Trail Arrow: 5 / 1800 / true). */
export interface LivesConfig {
  /** The cap, an integer ≥ 1. Regeneration, grants and the win refund never go past it. */
  maxLives: number;
  /** A new player's lives, an integer 0..maxLives. Default: maxLives. */
  startLives?: number;
  /** Below the cap, one life comes back per this many seconds (an integer ≥ 1). */
  regenSeconds: number;
  /** A won attempt gives its life back (Trail Arrow: a life is paid at the level entry and a win returns it). */
  refundOnWin: boolean;
}

/**
 * idle → load() → loading → ready (the count is known: the stored one, or `startLives` when the read
 * succeeded and nothing is stored) or unavailable (the Core read failed, or the stored record is not a V1
 * lives record: the count is UNKNOWN and nothing is ever written — never a default over it).
 */
export type LivesStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Why the runtime is unavailable. */
export type LivesProblem = 'read_failed' | 'invalid_record';

export type LivesRefusal =
  /** load() has not settled. */
  | 'not_loaded'
  /** The count is unknown (a failed Core read, an invalid record). */
  | 'unavailable'
  /** The SaveGate is not open yet — a change could not be saved. */
  | 'not_open'
  /** dispose() was called. */
  | 'disposed'
  /** startAttempt() with 0 lives. */
  | 'no_lives'
  /** endAttempt() without a running attempt (a repeated level end); resumeAttempt() without a stored open one. */
  | 'no_attempt'
  /** refill() at the cap — the host charges nothing. */
  | 'full'
  /** Not an integer ≥ 0. */
  | 'invalid_amount';

/** How an attempt ended: only a win can refund (config `refundOnWin`); a fail or an exit returns nothing. */
export type LivesAttemptOutcome = 'win' | 'fail' | 'exit';

export type LivesChangeKind = 'spend' | 'refund' | 'grant' | 'refill' | 'regen';

export interface LivesResult {
  ok: boolean;
  /** null when ok. A refusal changes nothing and writes nothing. */
  reason: LivesRefusal | null;
  /** The count after the call; null while it is unknown (not loaded, unavailable). */
  lives: number | null;
  /** What this call changed (−1 for a spend, the capped amount for a grant / refill / refund), 0 when nothing. */
  delta: number;
  /** The SaveGate write of the whole record (never rejects); null when nothing was written. */
  saved: Promise<SaveWriteResult> | null;
}

/** One change of the count (never sent for a refusal, a 0 delta or the load). */
export interface LivesChange {
  kind: LivesChangeKind;
  /** Signed: −1 for a spend, > 0 otherwise. */
  delta: number;
  /** After the change. */
  lives: number;
  maxLives: number;
  /** grant / refill: the caller's source (`rewarded`, `coins`, `purchase` …), handed on as is. */
  source?: string;
}

export type LivesListener = (change: LivesChange) => void;

export interface LivesSnapshot {
  status: LivesStatus;
  /** The reason of `unavailable`, else null. */
  problem: LivesProblem | null;
  /** null while unknown — the runtime never reports 0 or `startLives` for a count it could not read. */
  lives: number | null;
  maxLives: number;
  /** lives === maxLives (false while unknown). */
  full: boolean;
  /** ready AND the SaveGate is open AND not disposed: the changes are accepted. */
  writable: boolean;
  /** A new attempt can be paid now: writable and at least one life. */
  canStart: boolean;
  /** This session started or resumed an attempt that has not ended (a stored one not resumed yet is not counted). */
  attemptOpen: boolean;
  /** Epoch ms of the next regenerated life; null at the cap or while unknown. */
  nextLifeAt: number | null;
  /** ms until then (HUD / LivesWindowView timer); null at the cap, while unknown or with a non-finite clock. */
  nextLifeInMs: number | null;
}

/** The SaveGate methods the runtime uses — pass the game's SaveGate. */
export type LivesSaveGate = Pick<SaveGate, 'load' | 'snapshot' | 'readCore' | 'writeCore'>;

export interface LivesRuntimeOptions {
  /** The game's SaveGate: the runtime reads and writes only its own Core record. */
  gate: LivesSaveGate;
  config: LivesConfig;
  /** Epoch ms. Default `Date.now`; pass a server-anchored clock when the host has one. */
  now?: () => number;
  /** Where a throwing change listener lands; defaults to console.error. The change itself stands. */
  onListenerError?: (error: unknown, change: LivesChange) => void;
}

interface LivesRecord {
  v: number;
  lives: number;
  /** Epoch ms the running regeneration period started; null at the cap. */
  regenStart: number | null;
  /** V1.1: true while a paid attempt is open (written with its spend, removed with its end); absent = closed. */
  attempt?: boolean;
}

const CONFIG_KEYS = ['maxLives', 'startLives', 'regenSeconds', 'refundOnWin'];
const OUTCOMES: readonly LivesAttemptOutcome[] = ['win', 'fail', 'exit'];

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const isLivesRecord = (value: unknown): value is LivesRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === FORMAT &&
    isCount(record.lives) &&
    (record.regenStart === null || (typeof record.regenStart === 'number' && Number.isFinite(record.regenStart) && record.regenStart >= 0)) &&
    (record.attempt === undefined || typeof record.attempt === 'boolean')
  );
};

function checkConfig(config: LivesConfig): void {
  const fail = (message: string): never => {
    throw new RangeError(`LivesRuntime: config.${message}`);
  };
  if (typeof config !== 'object' || config === null) throw new RangeError('LivesRuntime: config { maxLives, regenSeconds, refundOnWin } is required');
  for (const key of Object.keys(config)) if (!CONFIG_KEYS.includes(key)) fail(`${key} is not a lives rule (allowed: ${CONFIG_KEYS.join(', ')})`);
  if (!Number.isSafeInteger(config.maxLives) || config.maxLives < 1) fail('maxLives must be an integer ≥ 1');
  if (!Number.isSafeInteger(config.regenSeconds) || config.regenSeconds < 1) fail('regenSeconds must be an integer ≥ 1');
  if (config.startLives !== undefined && (!isCount(config.startLives) || config.startLives > config.maxLives)) fail('startLives must be an integer 0..maxLives');
  if (typeof config.refundOnWin !== 'boolean') fail('refundOnWin must be a boolean');
}

/**
 * One runtime per game session, over the game's SaveGate:
 *
 *   const lives = new LivesRuntime({ gate, config: { maxLives: 5, regenSeconds: 1800, refundOnWin: true } });
 *   await lives.load();                          // with gate.load(); never rejects
 *   gate.open();
 *   if (!lives.snapshot().canStart) livesWindow.show(…);  // 0 lives: the host's window
 *   lives.startAttempt();                        // a NEW run, at the game's spend moment (level entry, first move …)
 *   lives.resumeAttempt();                       // the gameplay RESTORED its unfinished run (after a reload): no spend
 *   lives.endAttempt(result.win ? 'win' : 'fail');   // levelEnd; 'exit' for a given-up level
 *   lives.grant(1, 'rewarded');                  // after the ad / purchase / offer confirmed it
 *   const s = lives.tick();                      // the host's HUD second → hud.setLives(s.lives, formatTimer(Math.ceil(ms / 1000)))
 *
 * Time is applied on every call from the stored stamp (whole periods become lives, the remainder stays),
 * so a closed game regenerates the same way as a running one. A change is synchronous in memory, then ONE
 * `gate.writeCore('lives', record)` of the whole record; a failed write keeps the memory and is carried by
 * the next write (or `save()`). One logical attempt = one life: the open attempt is part of that record, so
 * its spend and its end (with the refund) are each one durable write, and a reload resumes it instead of paying.
 */
export class LivesRuntime {
  readonly maxLives: number;
  private readonly gate: LivesSaveGate;
  private readonly startLives: number;
  private readonly periodMs: number;
  private readonly refundOnWin: boolean;
  private readonly now: () => number;
  private readonly onListenerError: (error: unknown, change: LivesChange) => void;
  private readonly listeners = new Set<LivesListener>();
  private status: LivesStatus = 'idle';
  private problem: LivesProblem | null = null;
  private lives: number | null = null;
  private regenStart: number | null = null;
  /** This session owns the open attempt (startAttempt / resumeAttempt). */
  private attemptOpen = false;
  /** A durable open attempt from an earlier session, not resumed (yet): resumeAttempt adopts it, startAttempt abandons it. */
  private attemptPending = false;
  /** Time changed the state (settle) since the last write: tick() writes it. */
  private unsaved = false;
  private disposed = false;
  private loading: Promise<LivesSnapshot> | null = null;

  constructor(options: LivesRuntimeOptions) {
    const { gate, config, now, onListenerError } = options ?? ({} as LivesRuntimeOptions);
    if (!gate || typeof gate.load !== 'function' || typeof gate.readCore !== 'function' || typeof gate.writeCore !== 'function' || typeof gate.snapshot !== 'function') {
      throw new TypeError('LivesRuntime: the game SaveGate is required');
    }
    checkConfig(config);
    this.gate = gate;
    this.maxLives = config.maxLives;
    this.startLives = config.startLives ?? config.maxLives;
    this.periodMs = config.regenSeconds * 1000;
    this.refundOnWin = config.refundOnWin;
    this.now = now ?? (() => Date.now());
    this.onListenerError = onListenerError ?? ((error) => console.error('LivesRuntime: a change listener threw', error));
  }

  /** Reads the Core record once, with `gate.load()` (the same promise the host awaits); offline regeneration included. Never rejects. */
  load(): Promise<LivesSnapshot> {
    if (!this.loading) {
      this.status = 'loading';
      this.loading = Promise.resolve()
        .then(() => this.gate.load())
        .then(
          (loaded) => this.restore(loaded?.core),
          () => this.restore('failed')
        );
    }
    return this.loading;
  }

  /** The state at the clock's now (due regeneration applied in memory and reported to listeners, not written). */
  snapshot(): LivesSnapshot {
    if (this.status === 'ready') this.settle(true);
    const known = this.status === 'ready' && this.lives !== null;
    const lives = known ? this.lives : null;
    const writable = this.refusal() === null;
    const nextLifeAt = known && this.regenStart !== null ? this.regenStart + this.periodMs : null;
    const at = this.now();
    return {
      status: this.status,
      problem: this.problem,
      lives,
      maxLives: this.maxLives,
      full: lives !== null && lives >= this.maxLives,
      writable,
      canStart: writable && lives !== null && lives >= 1,
      attemptOpen: this.attemptOpen,
      nextLifeAt,
      nextLifeInMs: nextLifeAt === null || !Number.isFinite(at) ? null : Math.max(0, nextLifeAt - at)
    };
  }

  /** snapshot() that also WRITES what time changed (a regenerated life, a period re-anchored after the clock went back). Call it from the host's HUD second. */
  tick(): LivesSnapshot {
    if (this.status === 'ready') this.settle(true);
    if (this.unsaved && this.refusal() === null) void this.write();
    return this.snapshot();
  }

  /**
   * Pays one life for a NEW level attempt, at the moment the game chooses (Trail Arrow: the level entry), and
   * opens it durably — the spend and the open attempt are one write. One attempt runs at a time: a repeated
   * start in the session is answered ok without a second spend; a restart is endAttempt() + startAttempt().
   * A stored open attempt that was not resumed is abandoned here (no refund) and the new one is paid.
   * 0 lives → `no_lives`.
   */
  startAttempt(): LivesResult {
    const refusal = this.prepare();
    if (refusal) return this.refuse(refusal);
    if (this.attemptOpen) return this.unchanged();
    const lives = this.lives as number;
    if (lives < 1) return this.refuse('no_lives');
    if (lives >= this.maxLives) {
      const now = this.now();
      this.regenStart = Number.isFinite(now) ? now : null; // a broken clock: the period starts at the next finite reading
    }
    this.attemptPending = false;
    this.attemptOpen = true;
    return this.change('spend', -1);
  }

  /**
   * Continues the stored open attempt WITHOUT a spend — call it when the gameplay restored its unfinished run
   * (SoliPix `onLevelChanged({ restored: true })`). Nothing is written (the record already says open).
   * Idempotent; `no_attempt` when no attempt is open (never paid, already ended, or its write never landed):
   * the host then starts a new one.
   */
  resumeAttempt(): LivesResult {
    const refusal = this.prepare();
    if (refusal) return this.refuse(refusal);
    if (this.attemptOpen) return this.unchanged();
    if (!this.attemptPending) return this.refuse('no_attempt');
    this.attemptPending = false;
    this.attemptOpen = true;
    return this.unchanged();
  }

  /**
   * Ends the attempt this session started or resumed, durably — the close (and a win's refund under
   * `refundOnWin`, up to the cap) is one write; a fail or an exit returns nothing. A second end, or an end
   * without start / resume → `no_attempt`. A run the gameplay only suspends (kept to be resumed) is not ended.
   */
  endAttempt(outcome: LivesAttemptOutcome): LivesResult {
    if (!OUTCOMES.includes(outcome)) throw new TypeError(`LivesRuntime.endAttempt(): outcome must be one of ${OUTCOMES.join(' / ')}`);
    const refusal = this.prepare();
    if (refusal) return this.refuse(refusal);
    if (!this.attemptOpen) return this.refuse('no_attempt');
    this.attemptOpen = false;
    if (outcome !== 'win' || !this.refundOnWin || (this.lives as number) >= this.maxLives) {
      return { ok: true, reason: null, lives: this.lives, delta: 0, saved: this.write() };
    }
    return this.change('refund', 1);
  }

  /** Adds up to `amount` lives (an integer ≥ 0), capped — `delta` says what was really added. Only for a CONFIRMED source (a watched ad, a delivered purchase, an offer reward). */
  grant(amount: number, source?: string): LivesResult {
    if (!isCount(amount)) return this.refuse('invalid_amount');
    const refusal = this.prepare();
    if (refusal) return this.refuse(refusal);
    const delta = Math.min(amount, this.maxLives - (this.lives as number));
    return delta === 0 ? this.unchanged() : this.change('grant', delta, source);
  }

  /** Sets the cap (a paid refill, after the host took the price). At the cap → `full`, nothing changes. */
  refill(source?: string): LivesResult {
    const refusal = this.prepare();
    if (refusal) return this.refuse(refusal);
    const delta = this.maxLives - (this.lives as number);
    return delta === 0 ? this.refuse('full') : this.change('refill', delta, source);
  }

  /** Writes the current record (a new player once the gate is open, or a retry after a failed write). */
  save(): LivesResult {
    const refusal = this.prepare();
    if (refusal) return this.refuse(refusal);
    return { ok: true, reason: null, lives: this.lives, delta: 0, saved: this.write() };
  }

  /** Called after every change of the count, in subscription order; a listener is registered once. Returns the unsubscribe. */
  onChange(listener: LivesListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('LivesRuntime.onChange(): a listener function is required');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drops every listener; changes are refused (`disposed`) from now on. The stored record stays. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private restore(core: SaveReadStatus | undefined): LivesSnapshot {
    const record = core === 'loaded' ? this.gate.readCore(RECORD) : undefined;
    if (core === 'missing' || (core === 'loaded' && (record === undefined || record === null))) {
      // the read succeeded and no lives were ever saved: a new player
      this.lives = this.startLives;
      this.status = 'ready';
    } else if (core === 'loaded' && isLivesRecord(record)) {
      this.lives = Math.min(record.lives, this.maxLives);
      this.regenStart = record.regenStart;
      this.attemptPending = record.attempt === true;
      this.status = 'ready';
    } else {
      // failed (or never settled): the stored count is unknown — no default, no write
      this.problem = core === 'loaded' ? 'invalid_record' : 'read_failed';
      this.status = 'unavailable';
    }
    if (this.status === 'ready') this.settle(false);
    return this.snapshot();
  }

  /**
   * Applies the clock to the count: at the cap no period runs; below it whole elapsed periods become lives
   * (up to the cap) and the stamp keeps the remainder. A missing stamp, or a clock behind the stamp (moved
   * back, or a save from a clock that ran ahead), re-anchors the period at now — never a life taken, never
   * a timer frozen until the old time. A non-finite clock changes nothing. A change is marked `unsaved`.
   */
  private settle(report: boolean): void {
    const lives = this.lives as number;
    if (lives >= this.maxLives) {
      if (this.regenStart !== null) this.unsaved = true;
      this.regenStart = null;
      return;
    }
    const now = this.now();
    if (!Number.isFinite(now)) return;
    if (this.regenStart === null || now < this.regenStart) {
      this.regenStart = now;
      this.unsaved = true;
      return;
    }
    const periods = Math.floor((now - this.regenStart) / this.periodMs);
    if (periods < 1) return;
    const next = Math.min(this.maxLives, lives + periods);
    this.lives = next;
    this.regenStart = next >= this.maxLives ? null : this.regenStart + periods * this.periodMs;
    this.unsaved = true;
    if (report) this.emit({ kind: 'regen', delta: next - lives, lives: next, maxLives: this.maxLives });
  }

  private refusal(): LivesRefusal | null {
    if (this.disposed) return 'disposed';
    if (this.status === 'unavailable') return 'unavailable';
    if (this.status !== 'ready') return 'not_loaded';
    return this.gate.snapshot().phase === 'open' ? null : 'not_open';
  }

  /** The refusal of a change, else applies due regeneration first (written with the change). */
  private prepare(): LivesRefusal | null {
    const refusal = this.refusal();
    if (!refusal) this.settle(true);
    return refusal;
  }

  private refuse(reason: LivesRefusal): LivesResult {
    return { ok: false, reason, lives: this.status === 'ready' ? this.lives : null, delta: 0, saved: null };
  }

  private unchanged(): LivesResult {
    return { ok: true, reason: null, lives: this.lives, delta: 0, saved: null };
  }

  private change(kind: Exclude<LivesChangeKind, 'regen'>, delta: number, source?: string): LivesResult {
    const lives = (this.lives as number) + delta;
    this.lives = lives;
    if (lives >= this.maxLives) this.regenStart = null;
    const saved = this.write();
    this.emit({ kind, delta, lives, maxLives: this.maxLives, ...(source !== undefined ? { source } : {}) });
    return { ok: true, reason: null, lives, delta, saved };
  }

  private emit(change: LivesChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        this.onListenerError(error, change);
      }
    }
  }

  /** One writeCore of the whole record. A failed write is not retried here: the next change, tick() after a new settle, or save() carries it. */
  private write(): Promise<SaveWriteResult> {
    this.unsaved = false;
    const record: LivesRecord = { v: FORMAT, lives: this.lives as number, regenStart: this.regenStart };
    if (this.attemptOpen || this.attemptPending) record.attempt = true; // closed = absent, the pre-V1.1 shape
    return this.gate.writeCore(RECORD, record);
  }
}
