// ContinueOfferRuntime V1.1 — the price policy of "continue the lost level" offers; what the continue gives back
// (its resource and amount) is the gameplay's and never named here. Generic semantics of Trail Arrow 0.1.31 `ContinuePrice.ts`:
// a price ladder per level that climbs on every REAL opening of the offer (not on a purchase), the last step
// repeating; an optional first free continue once per profile. Its state is the SaveGate Core record
// `continueOffer`. It only QUOTES: it never charges coins, shows an ad, grants a game resource or opens a window.
// V1.1: the open offer is durable in the same record — one logical offer = one price step, also across a reload.
import type { SaveGate, SaveReadStatus, SaveWriteResult } from '../save/SaveGate';

/** The runtime's record in the SaveGate Core namespace: `<profile.id>.core` → `{ continueOffer: { v, freeUsed, levelKey, offerCount, open? } }`. */
const RECORD = 'continueOffer';
/**
 * Any change of the record's shape bumps it; another version is unknown data (unavailable, never overwritten).
 * V1.1 stays 1: `open` is an optional field whose absence means "no open offer" — exactly what a record written
 * before it holds (V1 kept the open offer in memory) — so every stored V1 record reads unchanged.
 */
const FORMAT = 1;

/** The game's continue prices — product numbers, passed by the host (Trail Arrow: [900, 1900, 2900] + firstFree). */
export interface ContinueOfferConfig {
  /** The price of the 1st, 2nd … priced offer opened on one level; the last step repeats. Integers ≥ 1, at least one. */
  priceSteps: readonly number[];
  /** The profile's first continue is free: once per profile, used up only by a confirmed free continue. Default false. */
  firstFree?: boolean;
}

/**
 * idle → load() → loading → ready (the stored ladder, or a fresh one when the read succeeded and nothing is
 * stored) or unavailable (the Core read failed, or the stored record is not a V1 continue record: the ladder is
 * UNKNOWN and nothing is ever written — never a fresh ladder or a free continue over it).
 */
export type ContinueOfferStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Why the runtime is unavailable. */
export type ContinueOfferProblem = 'read_failed' | 'invalid_record';

export type ContinueOfferRefusal =
  /** load() has not settled. */
  | 'not_loaded'
  /** The ladder is unknown (a failed Core read, an invalid record). */
  | 'unavailable'
  /** The SaveGate is not open yet — the step could not be saved. */
  | 'not_open'
  /** dispose() was called. */
  | 'disposed'
  /** beginOffer(): not an integer level ≥ 1 or a non-empty string. */
  | 'invalid_level'
  /** resolveOffer() without an open offer (a repeated resolve); resumeOffer() with no stored or open offer. */
  | 'no_offer'
  /** resumeOffer(): the open (or stored) offer belongs to another level — nothing changed, it stays as it was. */
  | 'other_level';

/** How the open offer ended: the run went on (a free, paid or rewarded continue — the host delivered it) or the player declined. */
export type ContinueOfferResolution = 'continued' | 'declined';

/** The price of one opened offer. */
export interface ContinueQuote {
  /** The level the offer belongs to (a number level as its decimal string: 7 and '7' are one level). */
  levelKey: string;
  /** The profile's first free continue (`price` 0, no ladder step taken). */
  free: boolean;
  /** 0 when free, else the ladder price of `step`. */
  price: number;
  /** 1-based position on this level's ladder (1 → priceSteps[0]); 0 for the free offer. */
  step: number;
}

export interface ContinueOfferResult {
  ok: boolean;
  /** null when ok. A refusal changes nothing and writes nothing. */
  reason: ContinueOfferRefusal | null;
  /** beginOffer / resumeOffer: the open offer's price; resolveOffer: the offer that was resolved; null for a refusal. */
  quote: ContinueQuote | null;
  /** beginOffer: true when this answered the offer already open for this level (no new step, nothing written); resumeOffer: always true. */
  reopened: boolean;
  /**
   * The SaveGate write that makes this state durable (never rejects): a new offer opened (its step, if priced,
   * and the open offer — also handed again by a reopen in the same session), an offer closed by resolveOffer()
   * (with the free continue it used up). null when nothing had to be written (a resumed offer: the record
   * already holds it). The quote itself is valid at once.
   */
  saved: Promise<SaveWriteResult> | null;
}

export interface ContinueOfferSnapshot {
  status: ContinueOfferStatus;
  /** The reason of `unavailable`, else null. */
  problem: ContinueOfferProblem | null;
  /** ready AND the SaveGate is open AND not disposed: offers can be opened and resolved. */
  writable: boolean;
  /** The next new offer would be the free one; null while unknown. */
  freeAvailable: boolean | null;
  /** The level whose ladder is stored (null: no priced offer was ever opened, or unknown). */
  levelKey: string | null;
  /** Priced offers opened on `levelKey` so far; null while unknown. */
  offerCount: number | null;
  /** The offer opened or resumed in this session and not resolved yet, else null (a stored one not resumed is not counted). */
  offer: ContinueQuote | null;
}

/** The SaveGate methods the runtime uses — pass the game's SaveGate. */
export type ContinueOfferSaveGate = Pick<SaveGate, 'load' | 'snapshot' | 'readCore' | 'writeCore'>;

export interface ContinueOfferRuntimeOptions {
  /** The game's SaveGate: the runtime reads and writes only its own Core record. */
  gate: ContinueOfferSaveGate;
  config: ContinueOfferConfig;
}

interface ContinueOfferRecord {
  v: number;
  /** The free continue was used (a confirmed one); a declined free offer leaves it false. */
  freeUsed: boolean;
  /** The one level whose ladder is remembered (Trail Arrow CONTINUE_LEVEL); null = none yet. */
  levelKey: string | null;
  /** Priced offers opened on it (Trail Arrow CONTINUE_COUNT). */
  offerCount: number;
  /** V1.1: the offer opened and not resolved yet (written with its opening, removed with its resolve); absent = none. */
  open?: ContinueQuote;
}

const CONFIG_KEYS = ['priceSteps', 'firstFree'];
const RESOLUTIONS: readonly ContinueOfferResolution[] = ['continued', 'declined'];

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** A stored open offer: the free one is price 0 / step 0, a priced one has both ≥ 1. */
const isQuote = (value: unknown): value is ContinueQuote => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const quote = value as Record<string, unknown>;
  if (typeof quote.levelKey !== 'string' || quote.levelKey === '' || typeof quote.free !== 'boolean') return false;
  if (!isCount(quote.price) || !isCount(quote.step)) return false;
  return quote.free ? quote.price === 0 && quote.step === 0 : quote.price >= 1 && quote.step >= 1;
};

const isContinueRecord = (value: unknown): value is ContinueOfferRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === FORMAT &&
    typeof record.freeUsed === 'boolean' &&
    (record.levelKey === null || (typeof record.levelKey === 'string' && record.levelKey !== '')) &&
    isCount(record.offerCount) &&
    (record.open === undefined || isQuote(record.open))
  );
};

/** A level's identity: a non-empty string as is, an integer ≥ 1 as its decimal string; else null. */
function toLevelKey(level: unknown): string | null {
  if (typeof level === 'string') return level === '' ? null : level;
  if (Number.isSafeInteger(level) && (level as number) >= 1) return String(level);
  return null;
}

function checkConfig(config: ContinueOfferConfig): void {
  const fail = (message: string): never => {
    throw new RangeError(`ContinueOfferRuntime: config.${message}`);
  };
  if (typeof config !== 'object' || config === null) throw new RangeError('ContinueOfferRuntime: config { priceSteps } is required');
  for (const key of Object.keys(config)) if (!CONFIG_KEYS.includes(key)) fail(`${key} is not a continue rule (allowed: ${CONFIG_KEYS.join(', ')})`);
  const steps = config.priceSteps;
  if (!Array.isArray(steps) || steps.length === 0) fail('priceSteps must be a non-empty array');
  if (!steps.every((price) => Number.isSafeInteger(price) && price >= 1)) fail('priceSteps must hold integers ≥ 1 (a free continue is firstFree)');
  if (config.firstFree !== undefined && typeof config.firstFree !== 'boolean') fail('firstFree must be a boolean');
}

/**
 * One runtime per game session, over the game's SaveGate:
 *
 *   const offers = new ContinueOfferRuntime({ gate, config: { priceSteps: [900, 1900, 2900], firstFree: true } });
 *   await offers.load();                          // with gate.load(); never rejects
 *   gate.open();
 *   const { quote } = offers.beginOffer(level);   // the run is lost: a REAL opening → the price to show
 *   offers.beginOffer(level);                     // the same offer again (back from the shop, a failed buy): same quote
 *   offers.resumeOffer(level);                    // the gameplay RESTORED this lost run (after a reload): the stored quote
 *   // the host charges quote.price / plays the rewarded ad / takes the free one, gives the game resource back, then:
 *   offers.resolveOffer('continued');             // or 'declined' (the run ends lost)
 *
 * Ladder (Trail Arrow): every new priced offer on the level takes the next step — the step is taken when the
 * offer OPENS, so a paid, a rewarded and a declined offer all use it; the last step repeats. One level is
 * remembered: an offer on another level starts its ladder from the first step (nothing else resets it — a win,
 * a restart or a relaunch keeps the level's count). The free continue takes no step and is used up only by
 * `resolveOffer('continued')`. Every write is ONE `gate.writeCore('continueOffer', record)` of the whole record;
 * a failed write keeps the memory and is carried by the next write (or `save()`).
 *
 * One logical offer = one price step: the open offer is part of that record — its opening (with its step) is one
 * write, its resolve (with the free continue used) is one write — so a run the gameplay restored after a reload
 * is answered by `resumeOffer()` with the same quote, never a new step. A stored offer that was not resumed is
 * abandoned by the next `beginOffer()` (a new logical offer: its step stays taken). No attempt id: the host
 * knows whether the lost run is the restored one or a new one.
 */
export class ContinueOfferRuntime {
  private readonly gate: ContinueOfferSaveGate;
  private readonly priceSteps: readonly number[];
  private readonly firstFree: boolean;
  private status: ContinueOfferStatus = 'idle';
  private problem: ContinueOfferProblem | null = null;
  private freeUsed = false;
  private levelKey: string | null = null;
  private offerCount = 0;
  /** The offer this session opened or resumed and did not resolve. */
  private open: ContinueQuote | null = null;
  /** The write that opened it (null for a resumed one — the record already held it): a reopen hands it again. */
  private openSaved: Promise<SaveWriteResult> | null = null;
  /** A durable open offer of an earlier session, not resumed (yet): resumeOffer adopts it, beginOffer abandons it. */
  private pending: ContinueQuote | null = null;
  private disposed = false;
  private loading: Promise<ContinueOfferSnapshot> | null = null;

  constructor(options: ContinueOfferRuntimeOptions) {
    const { gate, config } = options ?? ({} as ContinueOfferRuntimeOptions);
    if (!gate || typeof gate.load !== 'function' || typeof gate.readCore !== 'function' || typeof gate.writeCore !== 'function' || typeof gate.snapshot !== 'function') {
      throw new TypeError('ContinueOfferRuntime: the game SaveGate is required');
    }
    checkConfig(config);
    this.gate = gate;
    this.priceSteps = [...config.priceSteps];
    this.firstFree = config.firstFree ?? false;
  }

  /** Reads the Core record once, with `gate.load()` (the same promise the host awaits). Never rejects. */
  load(): Promise<ContinueOfferSnapshot> {
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

  snapshot(): ContinueOfferSnapshot {
    const known = this.status === 'ready';
    return {
      status: this.status,
      problem: this.problem,
      writable: this.refusal() === null,
      freeAvailable: known ? this.firstFree && !this.freeUsed : null,
      levelKey: known ? this.levelKey : null,
      offerCount: known ? this.offerCount : null,
      offer: this.currentQuote()
    };
  }

  /**
   * Opens the continue offer of a NEW lost run on `level` (a number level or the game's string id) and answers
   * its quote: the free one while it is available, else the next step of the level's ladder, taken now — the
   * step and the open offer are one write. The offer this session already opened or resumed for the same level
   * is answered again (`reopened`, no step, no write) — back from the shop, after a failed purchase. An open
   * offer of another level, and a stored offer of an earlier session that was not resumed, are abandoned.
   */
  beginOffer(level: string | number): ContinueOfferResult {
    const key = toLevelKey(level);
    if (key === null) return this.refuse('invalid_level');
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    if (this.open && this.open.levelKey === key) return this.reopen();
    this.pending = null;
    if (this.firstFree && !this.freeUsed) return this.opened({ levelKey: key, free: true, price: 0, step: 0 });
    this.offerCount = this.levelKey === key ? this.offerCount + 1 : 1;
    this.levelKey = key;
    const step = this.offerCount;
    const price = this.priceSteps[Math.min(step, this.priceSteps.length) - 1] as number; // the last step repeats
    return this.opened({ levelKey: key, free: false, price, step });
  }

  /**
   * Continues the stored open offer of `level` WITHOUT a new step — call it when the gameplay restored its lost
   * run (SoliPix `onLevelChanged({ restored: true })` with no moves left): the same quote, no step, nothing
   * written (the record already holds it). Idempotent; answers the offer this session opened for the level too.
   * `no_offer` when none is open or stored (never opened, resolved, or its write never landed): the host then
   * begins a new one. `other_level` when the open or stored offer is another level's: nothing changes.
   */
  resumeOffer(level: string | number): ContinueOfferResult {
    const key = toLevelKey(level);
    if (key === null) return this.refuse('invalid_level');
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    const offer = this.open ?? this.pending;
    if (!offer) return this.refuse('no_offer');
    if (offer.levelKey !== key) return this.refuse('other_level');
    if (!this.open) {
      this.open = offer;
      this.openSaved = null;
      this.pending = null;
    }
    return this.reopen();
  }

  /** The open offer's quote (a copy), or null. */
  currentQuote(): ContinueQuote | null {
    return this.open ? { ...this.open } : null;
  }

  /**
   * Closes the offer this session opened or resumed, durably — one write (a stored offer not resumed is not
   * closed: `no_offer`). Call `'continued'` only AFTER the host delivered the continue (took the price, the ad
   * rewarded, gave the resource back): for the free offer that is what uses the free continue up (in the same
   * write). A priced step was taken when the offer opened; a declined free offer stays available. A second
   * resolve → `no_offer`.
   */
  resolveOffer(resolution: ContinueOfferResolution): ContinueOfferResult {
    if (!RESOLUTIONS.includes(resolution)) throw new TypeError(`ContinueOfferRuntime.resolveOffer(): resolution must be one of ${RESOLUTIONS.join(' / ')}`);
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    const quote = this.open;
    if (!quote) return this.refuse('no_offer');
    this.open = null;
    this.openSaved = null;
    if (quote.free && resolution === 'continued') this.freeUsed = true;
    return { ok: true, reason: null, quote: { ...quote }, reopened: false, saved: this.write() };
  }

  /** Writes the current record (a retry after a failed write). */
  save(): ContinueOfferResult {
    const refusal = this.refusal();
    if (refusal) return this.refuse(refusal);
    return { ok: true, reason: null, quote: this.currentQuote(), reopened: false, saved: this.write() };
  }

  /** Every change is refused (`disposed`) from now on. The stored record stays. */
  dispose(): void {
    this.disposed = true;
  }

  private restore(core: SaveReadStatus | undefined): ContinueOfferSnapshot {
    const record = core === 'loaded' ? this.gate.readCore(RECORD) : undefined;
    if (core === 'missing' || (core === 'loaded' && (record === undefined || record === null))) {
      // the read succeeded and no offer was ever stored: a fresh ladder
      this.status = 'ready';
    } else if (core === 'loaded' && isContinueRecord(record)) {
      this.freeUsed = record.freeUsed;
      this.levelKey = record.levelKey;
      this.offerCount = record.offerCount;
      this.pending = record.open ? { ...record.open } : null;
      this.status = 'ready';
    } else {
      // failed (or never settled): the ladder and the free continue are unknown — no default, no write
      this.problem = core === 'loaded' ? 'invalid_record' : 'read_failed';
      this.status = 'unavailable';
    }
    return this.snapshot();
  }

  private refusal(): ContinueOfferRefusal | null {
    if (this.disposed) return 'disposed';
    if (this.status === 'unavailable') return 'unavailable';
    if (this.status !== 'ready') return 'not_loaded';
    return this.gate.snapshot().phase === 'open' ? null : 'not_open';
  }

  private opened(quote: ContinueQuote): ContinueOfferResult {
    this.open = quote;
    this.openSaved = this.write();
    return { ok: true, reason: null, quote: { ...quote }, reopened: false, saved: this.openSaved };
  }

  private reopen(): ContinueOfferResult {
    return { ok: true, reason: null, quote: this.currentQuote(), reopened: true, saved: this.openSaved };
  }

  private refuse(reason: ContinueOfferRefusal): ContinueOfferResult {
    return { ok: false, reason, quote: null, reopened: false, saved: null };
  }

  /** One writeCore of the whole record. A failed write is not retried here: the next opening, resolve or save() carries it. */
  private write(): Promise<SaveWriteResult> {
    const record: ContinueOfferRecord = { v: FORMAT, freeUsed: this.freeUsed, levelKey: this.levelKey, offerCount: this.offerCount };
    const open = this.open ?? this.pending;
    if (open) record.open = { ...open }; // none = absent, the V1 shape
    return this.gate.writeCore(RECORD, record);
  }
}
