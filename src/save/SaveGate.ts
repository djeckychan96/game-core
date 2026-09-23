// SaveGate V1 — the load-before-write rule both clean hosts wrote by hand: platform storage read →
// the host applies the loaded values → only then writes. It only MOVES values through PlatformStorage:
// the game's save format, migrations, the local mirror, cloud / local merges, guest → player adoption
// and retries stay in the host / gameplay. No timer, no clock, no global.
import { checkSaveSection, coreSaveKey, saveReadGroups } from '../production/profile';
import type { GameProductionProfile } from '../production/profile';
import type { PlatformStorage } from '../platform/types';

/** idle → load() → loading → loaded → open() → open. Writes are refused until `open`. */
export type SaveGatePhase = 'idle' | 'loading' | 'loaded' | 'open';

/**
 * The initial read of one read group (or of the Core record). `missing` = the read SUCCEEDED and nothing
 * is stored (a new player: start from defaults, then save); `failed` = the read itself failed — the gate
 * never writes those keys, so defaults can never overwrite a save that could not be read.
 */
export type SaveReadStatus = 'pending' | 'loaded' | 'missing' | 'failed';

export interface SaveGroupRead {
  keys: readonly string[];
  status: SaveReadStatus;
}

export interface SaveLoadResult {
  /** The stored values of the game's keys; a key never written (or null) is absent. */
  values: Record<string, unknown>;
  /** One per read group, in profile order; `error` = the storage rejection of a `failed` read. */
  groups: ReadonlyArray<SaveGroupRead & { error?: unknown }>;
  /** The Core record, read with the FIRST group (one storage read, one failure domain with it). */
  core: SaveReadStatus;
}

export type SaveWriteReason = 'not_open' | 'unknown_key' | 'read_failed' | 'storage_refused' | 'storage_rejected';

export interface SaveWriteResult {
  ok: boolean;
  /** null when ok. Refusals (`not_open`, `unknown_key`, `read_failed`) never reach the storage. */
  reason: SaveWriteReason | null;
  /** The storage's rejection (`storage_rejected` only). */
  error?: unknown;
}

export interface SaveGateSnapshot {
  phase: SaveGatePhase;
  coreKey: string;
  groups: SaveGroupRead[];
  core: SaveReadStatus;
}

export interface SaveGateOptions {
  /** `platform.storage` of a PlatformRuntime (read after `platform.ready()`). */
  storage: PlatformStorage;
  /** The game's `id` (the Core record's namespace) and `save` section of its production profile. */
  profile: Pick<GameProductionProfile, 'id' | 'save'>;
}

interface GroupState {
  keys: readonly string[];
  status: SaveReadStatus;
  error?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refused = (reason: SaveWriteReason): Promise<SaveWriteResult> => Promise.resolve({ ok: false, reason });

/**
 * One gate per game session over `profile.save.keys` (by read groups) plus the Core-owned record
 * `<profile.id>.core` (an object of Core records, never merged into the game's keys).
 *
 *   const gate = new SaveGate({ storage: platform.storage, profile });
 *   const loaded = await gate.load();          // never rejects: statuses say loaded / missing / failed
 *   gameplay.apply(loaded.values);             // the gameplay's own format and migration
 *   gate.open();                               // writes allowed from here on
 *   gate.write({ solipics_state: data });      // → { ok, reason }
 */
export class SaveGate {
  readonly coreKey: string;
  private readonly storage: PlatformStorage;
  private readonly groups: GroupState[];
  private readonly groupOf = new Map<string, GroupState>();
  private phase: SaveGatePhase = 'idle';
  private coreStatus: SaveReadStatus = 'pending';
  private core: Record<string, unknown> = {};
  private loading: Promise<SaveLoadResult> | null = null;

  constructor(options: SaveGateOptions) {
    const { storage, profile } = options ?? ({} as SaveGateOptions);
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('SaveGate: a storage with get() / set() is required');
    }
    if (!profile || typeof profile.id !== 'string' || profile.id === '') throw new TypeError('SaveGate: profile { id, save } is required');
    checkSaveSection(profile.id, profile.save, (message) => {
      throw new RangeError(`SaveGate: ${message}`);
    });
    this.storage = storage;
    this.coreKey = coreSaveKey(profile.id);
    this.groups = saveReadGroups(profile.save).map((keys) => ({ keys: [...keys], status: 'pending' as SaveReadStatus }));
    for (const group of this.groups) for (const key of group.keys) this.groupOf.set(key, group);
  }

  /** The initial read, once (a second call answers the same promise). Every group is one `storage.get`, in order. */
  load(): Promise<SaveLoadResult> {
    if (!this.loading) {
      this.phase = 'loading';
      this.loading = this.readAll();
    }
    return this.loading;
  }

  /** The host APPLIED the loaded values: writes are allowed from now on. Throws before load() has settled. */
  open(): void {
    if (this.phase === 'idle' || this.phase === 'loading') throw new Error('SaveGate.open(): the initial load has not finished');
    this.phase = 'open';
  }

  /**
   * Writes game keys with ONE `storage.set`. Refused without a storage call before open(), for a key that
   * is not in `save.keys` (the Core record included) and for a key whose group failed its initial read.
   * Never rejects; an empty patch is a no-op.
   */
  write(patch: Record<string, unknown>): Promise<SaveWriteResult> {
    if (!isRecord(patch)) throw new TypeError('SaveGate.write(): the patch must be an object');
    if (this.phase !== 'open') return refused('not_open');
    const keys = Object.keys(patch);
    for (const key of keys) {
      const group = this.groupOf.get(key);
      if (!group) return refused('unknown_key');
      if (group.status === 'failed') return refused('read_failed');
    }
    if (keys.length === 0) return Promise.resolve({ ok: true, reason: null });
    return this.commit({ ...patch });
  }

  /** A record of the Core namespace as loaded or last written (undefined when absent). Treat it as read-only. */
  readCore(record: string): unknown {
    return this.core[record];
  }

  /**
   * Writes one Core record: the whole Core object goes to `coreKey`, never to a game key. Same refusals
   * as write(); a record whose write failed is still carried by the next writeCore().
   */
  writeCore(record: string, value: unknown): Promise<SaveWriteResult> {
    if (typeof record !== 'string' || record === '') throw new TypeError('SaveGate.writeCore(): a record name is required');
    if (this.phase !== 'open') return refused('not_open');
    if (this.coreStatus === 'failed') return refused('read_failed');
    this.core = { ...this.core, [record]: value };
    return this.commit({ [this.coreKey]: this.core });
  }

  snapshot(): SaveGateSnapshot {
    return {
      phase: this.phase,
      coreKey: this.coreKey,
      groups: this.groups.map((group) => ({ keys: [...group.keys], status: group.status })),
      core: this.coreStatus
    };
  }

  private async readAll(): Promise<SaveLoadResult> {
    const values: Record<string, unknown> = {};
    for (const [index, group] of this.groups.entries()) {
      const withCore = index === 0;
      let data: Record<string, unknown>;
      try {
        const answer: unknown = await this.storage.get(withCore ? [...group.keys, this.coreKey] : group.keys);
        // a raw adapter outside PlatformRuntime: a non-object answer is a failed read, never "nothing stored"
        if (!isRecord(answer)) throw new TypeError('SaveGate: storage.get() answered a non-object');
        data = answer;
      } catch (error) {
        group.status = 'failed';
        group.error = error;
        if (withCore) this.coreStatus = 'failed';
        continue;
      }
      let found = false;
      for (const key of group.keys) {
        const value = data[key];
        if (value === undefined || value === null) continue;
        values[key] = value;
        found = true;
      }
      group.status = found ? 'loaded' : 'missing';
      if (withCore) {
        const core = data[this.coreKey];
        if (core === undefined || core === null) this.coreStatus = 'missing';
        else if (isRecord(core)) {
          this.core = { ...core };
          this.coreStatus = 'loaded';
        } else this.coreStatus = 'failed'; // not a Core record object: kept, never overwritten
      }
    }
    this.phase = 'loaded';
    return {
      values,
      groups: this.groups.map((group) => ({
        keys: [...group.keys],
        status: group.status,
        ...(group.status === 'failed' ? { error: group.error } : {})
      })),
      core: this.coreStatus
    };
  }

  private async commit(patch: Record<string, unknown>): Promise<SaveWriteResult> {
    try {
      const ok = await this.storage.set(patch);
      return ok === true ? { ok: true, reason: null } : { ok: false, reason: 'storage_refused' };
    } catch (error) {
      return { ok: false, reason: 'storage_rejected', error };
    }
  }
}
