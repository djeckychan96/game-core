import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PlatformRuntime, SaveGate, createDevPlatform } from '../../src/index';
import type { GameProductionProfile, PlatformStorage } from '../../src/index';

type SaveProfile = Pick<GameProductionProfile, 'id' | 'save'>;

const SOLIPIX: SaveProfile = { id: 'solipix', save: { keys: ['solipics_state'] } };
const GORODKI: SaveProfile = {
  id: 'gorodki',
  save: {
    keys: ['gorodki-progress-v2', 'gorodki-progress-v1', 'gorodki-background-v2'],
    groups: [['gorodki-progress-v2', 'gorodki-progress-v1'], ['gorodki-background-v2']]
  }
};

/** A PlatformStorage over a plain object with scripted failures; every call is journaled. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const fake = {
    data: { ...initial } as Record<string, unknown>,
    calls: [] as string[],
    /** A read that asks for one of these keys rejects (the DEV platform on a corrupted value). */
    failingKeys: new Set<string>(),
    getAnswer: undefined as unknown,
    setMode: 'ok' as 'ok' | 'false' | 'reject' | 'throw',
    storage: null as unknown as PlatformStorage
  };
  fake.storage = {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => {
      fake.calls.push(`get:${keys.join(',')}`);
      if (keys.some((key) => fake.failingKeys.has(key))) throw new Error('read_failed');
      if (fake.getAnswer !== undefined) return fake.getAnswer as Record<string, unknown>;
      const answer: Record<string, unknown> = {};
      for (const key of keys) if (key in fake.data) answer[key] = fake.data[key];
      return answer;
    },
    set: (patch) => {
      fake.calls.push(`set:${Object.keys(patch).join(',')}`);
      if (fake.setMode === 'throw') throw new Error('store_threw');
      if (fake.setMode === 'reject') return Promise.reject(new Error('quota'));
      if (fake.setMode === 'false') return Promise.resolve(false);
      Object.assign(fake.data, JSON.parse(JSON.stringify(patch)));
      return Promise.resolve(true);
    },
    clear: async (keys) => {
      for (const key of keys) delete fake.data[key];
    }
  };
  return fake;
}

/** A Web-Storage-shaped store for the DEV platform. */
function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key)
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SaveGate — load before write', () => {
  test('1. a write before the load, during it and before open() is refused and never reaches the storage', async () => {
    const fake = fakeStorage({ solipics_state: { levelId: 7 } });
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    expect(await gate.write({ solipics_state: { levelId: 1 } })).toEqual({ ok: false, reason: 'not_open' });
    expect(await gate.writeCore('ads', { shown: 1 })).toEqual({ ok: false, reason: 'not_open' });
    const loading = gate.load();
    expect(gate.snapshot().phase).toBe('loading');
    expect(await gate.write({ solipics_state: { levelId: 1 } })).toEqual({ ok: false, reason: 'not_open' });
    await loading;
    expect(gate.snapshot().phase).toBe('loaded');
    expect(await gate.write({ solipics_state: { levelId: 1 } })).toEqual({ ok: false, reason: 'not_open' });
    expect(fake.calls.filter((call) => call.startsWith('set:'))).toEqual([]);
    expect(fake.data.solipics_state).toEqual({ levelId: 7 });
    expect(() => new SaveGate({ storage: fake.storage, profile: SOLIPIX }).open()).toThrow(/initial load has not finished/);
  });

  test('2. an existing save loads: values + status loaded, one read per group (the Core record rides with the first)', async () => {
    const fake = fakeStorage({ solipics_state: { levelId: 7, coins: 120 }, unrelated: 1 });
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    const first = gate.load();
    expect(gate.load()).toBe(first); // once
    const loaded = await first;
    expect(loaded.values).toEqual({ solipics_state: { levelId: 7, coins: 120 } });
    expect(loaded.groups).toEqual([{ keys: ['solipics_state'], status: 'loaded' }]);
    expect(loaded.core).toBe('missing');
    expect(fake.calls).toEqual(['get:solipics_state,solipix.core']);
  });

  test('3. after the host applied the load, open() allows writes: one storage.set with the patch', async () => {
    const fake = fakeStorage({ solipics_state: { levelId: 7 } });
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    await gate.load();
    gate.open();
    expect(gate.snapshot().phase).toBe('open');
    expect(await gate.write({ solipics_state: { levelId: 8 } })).toEqual({ ok: true, reason: null });
    expect(fake.calls.at(-1)).toBe('set:solipics_state');
    expect(fake.data.solipics_state).toEqual({ levelId: 8 });
    expect(await gate.write({})).toEqual({ ok: true, reason: null }); // no-op, no storage call
    expect(fake.calls.at(-1)).toBe('set:solipics_state');
    expect(fake.calls.filter((call) => call.startsWith('set:'))).toHaveLength(1);
  });
});

describe('SaveGate — missing vs failed', () => {
  test('4. nothing stored (a new player) is missing; a rejected or non-object read is failed', async () => {
    const empty = fakeStorage({ solipics_state: null }); // Yandex clear() leaves null behind
    const missing = await new SaveGate({ storage: empty.storage, profile: SOLIPIX }).load();
    expect(missing.values).toEqual({});
    expect(missing.groups).toEqual([{ keys: ['solipics_state'], status: 'missing' }]);
    expect(missing.core).toBe('missing');

    const broken = fakeStorage({ solipics_state: { levelId: 7 } });
    broken.failingKeys.add('solipics_state');
    const failed = await new SaveGate({ storage: broken.storage, profile: SOLIPIX }).load();
    expect(failed.values).toEqual({});
    expect(failed.groups[0]?.status).toBe('failed');
    expect((failed.groups[0]?.error as Error).message).toBe('read_failed');
    expect(failed.core).toBe('failed');

    const odd = fakeStorage();
    odd.getAnswer = null; // a raw adapter outside PlatformRuntime answering null for a failure
    const nonObject = await new SaveGate({ storage: odd.storage, profile: SOLIPIX }).load();
    expect(nonObject.groups[0]?.status).toBe('failed');
  });

  test('5. a new player starts from defaults and can save them after open()', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    const loaded = await gate.load();
    expect(loaded.groups[0]?.status).toBe('missing');
    const defaults = { levelId: 1, coins: 80 };
    gate.open();
    expect(await gate.write({ solipics_state: defaults })).toEqual({ ok: true, reason: null });
    expect(fake.data.solipics_state).toEqual(defaults);
  });

  test('6. a failed initial read can never be overwritten by defaults — deterministic for the gate lifetime', async () => {
    const fake = fakeStorage({ solipics_state: { levelId: 42, coins: 9000 } });
    fake.failingKeys.add('solipics_state');
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    await gate.load();
    fake.failingKeys.clear(); // the platform recovers — the gate still never writes what it could not read
    gate.open();
    for (let i = 0; i < 3; i++) {
      expect(await gate.write({ solipics_state: { levelId: 1, coins: 80 } })).toEqual({ ok: false, reason: 'read_failed' });
      expect(await gate.writeCore('ads', { shown: 1 })).toEqual({ ok: false, reason: 'read_failed' });
    }
    expect(fake.calls.filter((call) => call.startsWith('set:'))).toEqual([]);
    expect(fake.data.solipics_state).toEqual({ levelId: 42, coins: 9000 });
    expect(gate.snapshot()).toEqual({ phase: 'open', coreKey: 'solipix.core', groups: [{ keys: ['solipics_state'], status: 'failed' }], core: 'failed' });
  });
});

describe('SaveGate — read groups (Gorodki)', () => {
  test('7. two groups are two failure domains: a legacy raw background locks only itself (DEV platform, real storage)', async () => {
    const store = memoryStore({
      'gorodki-progress-v2': JSON.stringify({ 1: 3, 2: 2 }),
      'gorodki-background-v2': 'city' // the source game stored the raw id, not JSON: the DEV read rejects
    });
    const platform = new PlatformRuntime(createDevPlatform({ store, storagePrefix: '', ads: false, payments: false, banner: false }));
    await platform.ready();
    const gate = new SaveGate({ storage: platform.storage, profile: GORODKI });
    const loaded = await gate.load();
    expect(loaded.values).toEqual({ 'gorodki-progress-v2': { 1: 3, 2: 2 } });
    expect(loaded.groups.map((group) => group.status)).toEqual(['loaded', 'failed']);
    expect(loaded.core).toBe('missing');
    gate.open();
    expect(await gate.write({ 'gorodki-progress-v2': { 1: 3, 2: 3 } })).toEqual({ ok: true, reason: null });
    expect(await gate.write({ 'gorodki-background-v2': 'forest' })).toEqual({ ok: false, reason: 'read_failed' });
    // a patch across a failed group is refused whole
    expect(await gate.write({ 'gorodki-progress-v2': {}, 'gorodki-background-v2': 'forest' })).toEqual({ ok: false, reason: 'read_failed' });
    expect(JSON.parse(store.getItem('gorodki-progress-v2') as string)).toEqual({ 1: 3, 2: 3 });
    expect(store.getItem('gorodki-background-v2')).toBe('city');
    expect(store.getItem('gorodki-progress-v1')).toBeNull(); // never written: the gate writes only what it is given
  });

  test('without groups every key is one domain (one read); groups must partition save.keys', async () => {
    const fake = fakeStorage();
    await new SaveGate({ storage: fake.storage, profile: { id: 'gorodki', save: { keys: GORODKI.save.keys } } }).load();
    expect(fake.calls).toEqual(['get:gorodki-progress-v2,gorodki-progress-v1,gorodki-background-v2,gorodki.core']);
    const grouped = fakeStorage();
    await new SaveGate({ storage: grouped.storage, profile: GORODKI }).load();
    expect(grouped.calls).toEqual(['get:gorodki-progress-v2,gorodki-progress-v1,gorodki.core', 'get:gorodki-background-v2']);
    const make = (save: unknown) => () => new SaveGate({ storage: fake.storage, profile: { id: 'g', save } as SaveProfile });
    expect(make({ keys: ['a', 'b'], groups: [['a']] })).toThrow(/save\.keys\[1\] "b" is in no group/);
    expect(make({ keys: ['a', 'b'], groups: [['a', 'b'], ['b']] })).toThrow(/save\.groups\[1\]\[0\] "b" is in two groups/);
    expect(make({ keys: ['a'], groups: [['a'], ['c']] })).toThrow(/save\.groups\[1\]\[0\] must be one of save\.keys/);
    expect(make({ keys: ['a'], groups: [] })).toThrow(/save\.groups must be a non-empty array/);
  });
});

describe('SaveGate — the Core namespace', () => {
  test('8. the Core record never collides with a game key: rejected at construction, refused on write, own key on writeCore', async () => {
    const fake = fakeStorage({ solipics_state: { coins: 5 } });
    expect(() => new SaveGate({ storage: fake.storage, profile: { id: 'solipix', save: { keys: ['solipix.core'] } } })).toThrow(
      /save\.keys\[0\] "solipix\.core" is the Core record's key/
    );
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    expect(gate.coreKey).toBe('solipix.core');
    await gate.load();
    gate.open();
    expect(await gate.write({ 'solipix.core': { granted: ['t1'] } })).toEqual({ ok: false, reason: 'unknown_key' });
    expect(await gate.write({ some_other_key: 1 })).toEqual({ ok: false, reason: 'unknown_key' });
    expect(await gate.writeCore('granted', ['t1'])).toEqual({ ok: true, reason: null });
    expect(await gate.writeCore('ads', { interstitials: 2 })).toEqual({ ok: true, reason: null });
    expect(fake.calls.filter((call) => call.startsWith('set:'))).toEqual(['set:solipix.core', 'set:solipix.core']);
    expect(fake.data['solipix.core']).toEqual({ granted: ['t1'], ads: { interstitials: 2 } });
    expect(fake.data.solipics_state).toEqual({ coins: 5 }); // the game blob is untouched, nothing mixed into it
    expect(gate.readCore('granted')).toEqual(['t1']);

    // the next session reads the Core record back with the first group
    const next = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    const loaded = await next.load();
    expect(loaded.core).toBe('loaded');
    expect(loaded.values).toEqual({ solipics_state: { coins: 5 } });
    expect(next.readCore('ads')).toEqual({ interstitials: 2 });
  });

  test('a Core record that is not an object is kept and never overwritten; the game keys are unaffected', async () => {
    const fake = fakeStorage({ solipics_state: { coins: 5 }, 'solipix.core': 'garbage' });
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    const loaded = await gate.load();
    expect(loaded.core).toBe('failed');
    expect(loaded.groups[0]?.status).toBe('loaded');
    gate.open();
    expect(await gate.writeCore('granted', [])).toEqual({ ok: false, reason: 'read_failed' });
    expect(await gate.write({ solipics_state: { coins: 6 } })).toEqual({ ok: true, reason: null });
    expect(fake.data['solipix.core']).toBe('garbage');
  });
});

describe('SaveGate — storage write errors', () => {
  test('9. a refused, rejected or throwing storage.set is answered, never thrown, and names the cause', async () => {
    const fake = fakeStorage();
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    await gate.load();
    gate.open();
    fake.setMode = 'false';
    expect(await gate.write({ solipics_state: { a: 1 } })).toEqual({ ok: false, reason: 'storage_refused' });
    fake.setMode = 'reject';
    const rejected = await gate.write({ solipics_state: { a: 1 } });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('storage_rejected');
    expect((rejected.error as Error).message).toBe('quota');
    fake.setMode = 'throw';
    const thrown = await gate.writeCore('granted', ['t1']);
    expect(thrown).toMatchObject({ ok: false, reason: 'storage_rejected' });
    expect((thrown.error as Error).message).toBe('store_threw');
    fake.setMode = 'ok';
    expect(await gate.writeCore('ads', {})).toEqual({ ok: true, reason: null });
    expect(fake.data['solipix.core']).toEqual({ granted: ['t1'], ads: {} }); // the failed record is carried
  });
});

describe('SaveGate — root-module hygiene', () => {
  test('10. no timers: a whole session (load, open, writes, failures) leaves no timer behind', async () => {
    vi.useFakeTimers();
    const fake = fakeStorage({ solipics_state: { a: 1 } });
    const gate = new SaveGate({ storage: fake.storage, profile: SOLIPIX });
    await gate.load();
    gate.open();
    await gate.write({ solipics_state: { a: 2 } });
    fake.setMode = 'reject';
    await gate.writeCore('granted', []);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('11. src/save names no browser / runtime global, clock, timer or platform SDK', () => {
    const dir = fileURLToPath(new URL('../../src/save/', import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts')).sort();
    expect(files).toEqual(['SaveGate.ts', 'index.ts']);
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden = /\b(Date|performance|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|window|globalThis|self|document|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|YaGames|process|structuredClone)\b/;
    for (const name of files) {
      const source = strip(readFileSync(resolve(dir, name), 'utf-8'));
      expect(source.match(forbidden)?.[0] ?? null, name).toBeNull();
      for (const [, from] of source.matchAll(/from '([^']+)'/g)) {
        expect(['./SaveGate', '../production/profile', '../platform/types'], `${name} imports ${from}`).toContain(from);
      }
    }
    // the platform module is imported for its TYPES only
    expect(readFileSync(resolve(dir, 'SaveGate.ts'), 'utf-8')).toMatch(/import type \{ PlatformStorage \} from '\.\.\/platform\/types'/);
  });
});
