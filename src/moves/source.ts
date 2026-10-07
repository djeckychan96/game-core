// LevelBalanceSource V1 — where level balances come from, behind one interface: today the host's local table
// (createStaticLevelBalanceSource over JSON-like data it already loaded), later a server answer of the same shape
// (another implementation of the same interface). MoveRuntime never sees a source: the host asks `get()` and hands
// the balance to `start()`. No HTTP, backend, file path or game content format in Core.
import { readLevelBalance } from './balance';
import type { LevelBalance } from './balance';

/** The balance data document — what a local table holds, and what a server will answer. Unknown fields are ignored. */
export interface LevelBalanceTable {
  /** The data revision `LevelBalanceSource.version` reports (a table version, a server revision). A non-empty string. */
  version: string;
  /** One record per progression key (keys unique). */
  levels: readonly LevelBalance[];
}

/**
 * Where level balances come from. Implementations: `createStaticLevelBalanceSource` (data the host already loaded);
 * a server source is another implementation — the host and `MoveRuntime` do not change.
 */
export interface LevelBalanceSource {
  /** The revision of the data `get` answers from: null until a load succeeded. */
  readonly version: string | null;
  /**
   * Makes the data available. Resolves once `get` can answer; rejects when it could not (unreachable, invalid data),
   * and then nothing changes — `get` keeps the data of the last successful load, if any.
   */
  load(): Promise<void>;
  /**
   * The balance of one progression key (frozen), or null when the loaded data has none for it — the host decides
   * what a level without a balance plays like. Throws before the first successful load (`version` null): an
   * unloaded source is not "no balance".
   */
  get(progressionKey: string): LevelBalance | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the document and answers its balances by progression key (frozen copies of the known fields). */
function readTable(table: unknown, reject: (message: string) => never): { version: string; levels: Map<string, LevelBalance> } {
  if (!isObject(table)) reject('the table must be an object { version, levels }');
  const { version, levels } = table as Record<string, unknown>;
  if (typeof version !== 'string' || version === '') reject('version must be a non-empty string');
  if (!Array.isArray(levels)) reject('levels must be an array');
  const byKey = new Map<string, LevelBalance>();
  (levels as unknown[]).forEach((record, index) => {
    const key = isObject(record) && typeof record.progressionKey === 'string' && record.progressionKey !== '' ? ` ("${record.progressionKey}")` : '';
    const balance = readLevelBalance(record, (message) => reject(`levels[${index}]${key} ${message}`));
    if (byKey.has(balance.progressionKey)) reject(`levels[${index}]${key} repeats a progressionKey — one balance per level`);
    byKey.set(balance.progressionKey, balance);
  });
  return { version: version as string, levels: byKey };
}

/** Throws a RangeError naming the first problem: the document shape, any record (see `validateLevelBalance`), a repeated progressionKey. */
export function validateLevelBalanceTable(table: LevelBalanceTable): void {
  readTable(table, (message) => {
    throw new RangeError(`validateLevelBalanceTable: ${message}`);
  });
}

/**
 * A source over a table the host already has (a bundled JSON file it imported or fetched itself). `load()` checks
 * the table once and copies it — later changes to the host's object do not reach `get` — and an invalid table makes
 * `load()` reject with the validator's RangeError, as a server answer with invalid data would. Repeated calls answer
 * the same promise.
 *
 *   const balances = createStaticLevelBalanceSource(levelBalanceJson);
 *   await balances.load();
 *   const balance = balances.get(progressionKey);   // null: no balance for this level (the host decides)
 *   if (balance) moves.start(balance);
 */
export function createStaticLevelBalanceSource(table: LevelBalanceTable): LevelBalanceSource {
  let loading: Promise<void> | null = null;
  let version: string | null = null;
  let levels: Map<string, LevelBalance> | null = null;
  return {
    get version() {
      return version;
    },
    load() {
      if (!loading) {
        loading = Promise.resolve().then(() => {
          const read = readTable(table, (message) => {
            throw new RangeError(`LevelBalanceSource: ${message}`);
          });
          levels = read.levels;
          version = read.version;
        });
      }
      return loading;
    },
    get(progressionKey: string) {
      if (typeof progressionKey !== 'string' || progressionKey === '') throw new TypeError('LevelBalanceSource.get(): progressionKey must be a non-empty string');
      if (levels === null) throw new Error('LevelBalanceSource.get(): the balance is not loaded — await load() first');
      return levels.get(progressionKey) ?? null;
    }
  };
}
