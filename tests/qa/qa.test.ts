import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as root from '../../src/index';
import * as qaEntry from '../../src/qa/index';
import { NetworkFaultError, NetworkFaultProfile, installGameCoreQA, withNetworkFaults, type GameCoreQA, type GameCoreQaOptions } from '../../src/qa/index';
import type { GamePlatform, PlatformAdResult } from '../../src/index';

// --- a tiny DOM: what QaPanelView uses (createElement, setAttribute, append, remove, textContent, value, disabled, click) ---
class FakeText {
  parent: FakeEl | null = null;
  constructor(public textContent: string) {}
}
class FakeEl {
  attributes: Record<string, string> = {};
  children: Array<FakeEl | FakeText> = [];
  parent: FakeEl | null = null;
  value = '';
  disabled = false;
  listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDoc) {}
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  append(...nodes: Array<FakeEl | string>): void {
    for (const node of nodes) {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      child.parent = this;
      this.children.push(child);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  get textContent(): string {
    return this.children.map((child) => child.textContent).join('');
  }
  set textContent(text: string) {
    this.children = text ? [new FakeText(text)] : [];
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }
  click(): void {
    let stopped = false;
    const event = { type: 'click', stopPropagation: () => { stopped = true; } };
    for (let node: FakeEl | null = this; node && !stopped; node = node.parent) for (const listener of node.listeners.get('click') ?? []) listener(event);
  }
  find(qa: string): FakeEl | null {
    if (this.attributes['data-qa'] === qa) return this;
    for (const child of this.children) {
      if (child instanceof FakeEl) {
        const hit = child.find(qa);
        if (hit) return hit;
      }
    }
    return null;
  }
}
class FakeDoc {
  body: FakeEl = new FakeEl('body', this);
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const installed: GameCoreQA[] = [];
afterEach(() => {
  for (const qa of installed.splice(0)) qa.dispose();
});

function setup(options: Partial<GameCoreQaOptions> = {}) {
  const doc = new FakeDoc();
  const qa = installGameCoreQA({ container: doc.body, globalName: false, now: () => 1_700_000_000_000, memory: () => null, online: () => true, ...options });
  installed.push(qa);
  const panel = () => doc.body.find('panel');
  const el = (id: string) => {
    const node = panel()?.find(id);
    if (!node) throw new Error(`no [data-qa=${id}] in the panel`);
    return node;
  };
  return { qa, doc, panel, el };
}

function numberCap(initial = 10) {
  let value: number | null = initial;
  const set = vi.fn((next: number) => { value = next; });
  return { set, cap: { kind: 'number' as const, id: 'coins', label: 'Coins', min: 0, get: () => value, set } };
}

describe('QA panel lifecycle', () => {
  it('1. is closed by default: no DOM, no global unless installed', () => {
    const { qa, doc } = setup();
    expect(doc.body.children).toHaveLength(0);
    expect(qa.getState().open).toBe(false);
    // importing the entry installs nothing; the root entry carries no QA API
    expect('GameCoreQA' in globalThis).toBe(false);
    expect(Object.keys(root).filter((name) => /qa|NetworkFault/i.test(name))).toEqual([]);
  });

  it('2. open / close / toggle are explicit', () => {
    const { qa, doc, panel } = setup();
    qa.open();
    expect(panel()).not.toBeNull();
    expect(qa.getState().open).toBe(true);
    qa.close();
    expect(doc.body.children).toHaveLength(0);
    qa.toggle();
    expect(panel()).not.toBeNull();
    panel()!.find('close')!.click();
    expect(panel()).toBeNull();
    qa.toggle();
    qa.toggle();
    expect(panel()).toBeNull();
  });

  it('installs the global only when asked, refuses a second install, removes it on dispose', () => {
    const doc = new FakeDoc();
    const qa = installGameCoreQA({ container: doc.body });
    expect((globalThis as Record<string, unknown>).GameCoreQA).toBe(qa);
    expect(() => installGameCoreQA({ container: doc.body })).toThrow(/already installed/);
    qa.dispose();
    expect('GameCoreQA' in globalThis).toBe(false);
  });

  it('ready() waits for markReady() — no sleep needed', async () => {
    const { qa } = setup();
    let state: unknown = null;
    void qa.ready().then((s) => { state = s; });
    await flush();
    expect(state).toBeNull();
    expect(qa.getState().ready).toBe(false);
    qa.markReady();
    await flush();
    expect(state).toMatchObject({ ready: true });
    await expect(qa.ready()).resolves.toMatchObject({ ready: true });
  });
});

describe('metrics', () => {
  it('3. samples FPS / frame time from the host frames, O(1), dropping bogus frames', () => {
    const { qa } = setup();
    expect(qa.getState().metrics.fps).toBeNull();
    for (const bad of [NaN, 0, -5, 5000]) qa.frame(bad);
    for (let i = 0; i < 31; i++) qa.frame(16);
    expect(qa.getState().metrics.fps).toBeNull(); // 496 ms < one window
    qa.frame(24);
    expect(qa.getState().metrics).toMatchObject({ fps: 61.5, frameMs: 16.3, frameMaxMs: 24 }); // 32 frames / 520 ms
  });

  it('4. reports the heap when the browser exposes it', () => {
    const MB = 1024 * 1024;
    const { qa, el } = setup({ memory: () => ({ usedJSHeapSize: 45.25 * MB, totalJSHeapSize: 60 * MB, jsHeapSizeLimit: 2048 * MB }) });
    expect(qa.getState().metrics.memory).toEqual({ usedMB: 45.3, totalMB: 60, limitMB: 2048 });
    qa.open();
    expect(el('metrics').textContent).toContain('45.3 / 60 MB');
  });

  it('5. shows N/A when the heap is not exposed — never a fake number', () => {
    const { qa, el } = setup({ memory: () => null });
    expect(qa.getState().metrics.memory).toBeNull();
    qa.open();
    expect(el('metrics').textContent).toMatch(/heap\s+N\/A/);
    // the default probe: Node (like Safari / Firefox) has no performance.memory
    const bare = installGameCoreQA({ globalName: false, container: new FakeDoc().body });
    installed.push(bare);
    expect(bare.getState().metrics.memory).toBeNull();
    // a half-exposed / zero object is not a measurement either
    const zero = setup({ memory: () => ({ usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 }) });
    expect(zero.qa.getState().metrics.memory).toBeNull();
  });
});

describe('metadata + diagnostics', () => {
  const options: Partial<GameCoreQaOptions> = {
    game: { name: 'Demo', version: '1.2.3', commit: 'abc1234' },
    coreBuild: { version: '0.2.0', commit: '0ce9757', dirty: false, builtAt: '' },
    environment: { platformCode: () => 'YA', language: () => 'ru' }
  };

  it('6. renders the host metadata, the Core build, platform, language, online, time', () => {
    const { qa, el } = setup(options);
    const meta = qa.getState().meta;
    expect(meta).toMatchObject({ game: { name: 'Demo', version: '1.2.3', commit: 'abc1234' }, core: { version: '0.2.0', commit: '0ce9757' }, platform: 'YA', language: 'ru', online: true, now: '2023-11-14T22:13:20.000Z', sessionSeconds: 0 });
    qa.open();
    const text = el('meta').textContent;
    for (const part of ['Demo 1.2.3 (abc1234)', '0.2.0 (0ce9757)', 'YA', 'ru', 'online']) expect(text).toContain(part);
  });

  it('11. copies compact diagnostics; a blocked clipboard shows the text to copy by hand', async () => {
    const clipboard = vi.fn(async () => undefined);
    const { qa, el } = setup({ ...options, clipboard, capabilities: [numberCap().cap], network: new NetworkFaultProfile() });
    const text = qa.getDiagnostics();
    for (const part of ['game: Demo 1.2.3 (abc1234)', 'core: 0.2.0 (0ce9757)', 'platform: YA · language: ru · online: yes', 'fps: N/A', 'heap: N/A', 'network sim: NORMAL', 'qa: coins, network', 'values: {"coins":10}']) {
      expect(text).toContain(part);
    }
    qa.open();
    el('copy').click();
    await flush();
    expect(clipboard).toHaveBeenCalledWith(text);
    expect(el('status').textContent).toContain('copied');

    const blocked = setup({ clipboard: () => Promise.reject(new Error('denied')) });
    blocked.qa.open();
    blocked.el('copy').click();
    await flush();
    expect(blocked.el('copy-fallback').value).toBe(blocked.qa.getDiagnostics());
  });

  it('18. never shows secrets: token / jwt / auth keys and JWT-looking values are redacted', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const { qa } = setup({
      game: { name: 'Demo', commit: jwt },
      inspectors: { ledger: () => ({ appliedPurchaseTokens: ['tok-1', 'tok-2', 'tok-3'], count: 3, analytics: { jwt, authHeader: 'Bearer x', apiKey: 'k' }, note: `x ${jwt}` }) }
    });
    const state = JSON.stringify(qa.getState());
    const text = qa.getDiagnostics();
    for (const secret of ['tok-1', 'tok-3', jwt, 'Bearer x', '"k"']) {
      expect(state).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(qa.getState().inspect.ledger).toEqual({ appliedPurchaseTokens: '[redacted ×3]', count: 3, analytics: { jwt: '[redacted]', authHeader: '[redacted]', apiKey: '[redacted]' }, note: '[redacted]' });
  });

  it('summarizes Core runtimes read-only through their snapshots', () => {
    const { qa } = setup({
      runtimes: () => ({
        save: { snapshot: () => ({ phase: 'open', coreKey: 'demo.core', groups: [{ keys: ['a'], status: 'loaded' }], core: 'loaded' }) },
        lives: { snapshot: () => ({ status: 'ready', problem: null, lives: 3, maxLives: 5, full: false, writable: true, canStart: true, attemptOpen: true, nextLifeAt: 1, nextLifeInMs: 60000 }) }
      })
    });
    expect(qa.getState().core).toEqual({
      save: { phase: 'open', core: 'loaded', groups: ['loaded'] },
      lives: { status: 'ready', lives: 3, maxLives: 5, attemptOpen: true, nextLifeInMs: 60000, writable: true, problem: null }
    });
  });
});

describe('registry + commands (the panel and an automation call the same run)', () => {
  it('7. action: run(id, params) and the panel button reach the same callback', async () => {
    const run = vi.fn((params: unknown) => ({ got: params }));
    const { qa, el } = setup({ capabilities: [{ kind: 'action', id: 'debug.win', label: 'Win level', run }] });
    expect(qa.listCapabilities()).toEqual([{ id: 'debug.win', kind: 'action', label: 'Win level', hint: null, commands: ['debug.win'], destructive: false }]);
    await expect(qa.run('debug.win', { stars: 3 })).resolves.toEqual({ ok: true, command: 'debug.win', value: { got: { stars: 3 } } });
    qa.open();
    el('run-debug.win').click();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(el('status').textContent).toContain('✓ debug.win');
  });

  it('8. number: validated set, read back; the −/+/Set buttons use the same command', async () => {
    const { cap, set } = numberCap(10);
    const { qa, el } = setup({ capabilities: [cap] });
    await expect(qa.run('coins.set', { value: 100 })).resolves.toEqual({ ok: true, command: 'coins.set', value: 100 });
    expect(await qa.run('coins.set', { value: 1.5 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(await qa.run('coins.set', { value: -1 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(await qa.run('coins.set', { value: '5' })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(set).toHaveBeenCalledTimes(1);
    expect(qa.getState().values).toEqual({ coins: 100 });
    qa.open();
    el('inc-coins').click();
    await flush();
    expect(qa.getState().values.coins).toBe(101);
    el('input-coins').value = '7';
    el('set-coins').click();
    await flush();
    expect(qa.getState().values.coins).toBe(7);
    expect(el('value-coins').textContent).toBe('7');
  });

  it('9. select: level choice through options / get / set; a number is its decimal string', async () => {
    let level = '1';
    const set = vi.fn((value: string) => { level = value; });
    const { qa, el } = setup({ capabilities: [{ kind: 'select', id: 'level', label: 'Level', options: () => ['1', '2', { value: '10', label: 'Level 10' }], get: () => level, set }] });
    expect(qa.listCapabilities()[0]).toMatchObject({ commands: ['level.set'], options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '10', label: 'Level 10' }] });
    await expect(qa.run('level.set', { value: 10 })).resolves.toEqual({ ok: true, command: 'level.set', value: '10' });
    expect(await qa.run('level.set', { value: 99 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    qa.open();
    el('input-level').value = '2';
    el('set-level').click();
    await flush();
    expect(set).toHaveBeenLastCalledWith('2');
    expect(qa.getState().values.level).toBe('2');
  });

  it('toggle + structured errors: unknown command, bad params, a host failure — never a throw', async () => {
    let on = false;
    const { qa } = setup({
      capabilities: [
        { kind: 'toggle', id: 'debug.god', label: 'God mode', get: () => on, set: (value) => { on = value; } },
        { kind: 'action', id: 'debug.crash', label: 'Crash', run: () => Promise.reject(new Error('boom')) }
      ]
    });
    await expect(qa.run('debug.god.set', { value: true })).resolves.toEqual({ ok: true, command: 'debug.god.set', value: true });
    expect(await qa.run('debug.god.set', { value: 1 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(await qa.run('nope')).toEqual({ ok: false, command: 'nope', error: { code: 'unknown_command', message: 'unknown command nope' } });
    expect(await qa.run('debug.god.set', 5 as never)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    const crash = await qa.run('debug.crash');
    expect(crash).toEqual({ ok: false, command: 'debug.crash', error: { code: 'failed', message: 'boom' } });
    expect(JSON.parse(JSON.stringify(crash))).toEqual(crash);
    expect(() => qa.register({ kind: 'action', id: 'debug.god', label: 'x', run: () => undefined })).toThrow(/already registered/);
    expect(() => qa.register({ kind: 'action', id: 'network.x', label: 'x', run: () => undefined })).toThrow(/reserved/);
    expect(() => qa.register({ kind: 'number', id: 'Bad Id', label: 'x', get: () => 0, set: () => undefined })).toThrow(/bad capability id/);
    const unregister = qa.register({ kind: 'action', id: 'later', label: 'Later', run: () => 'ok' });
    expect(qa.getState().capabilities).toContain('later');
    unregister();
    expect(qa.getState().capabilities).not.toContain('later');
  });

  it('10. destructive resets and actions need a confirmation — { confirm: true } or the second tap', async () => {
    const gameplay = vi.fn();
    const wipe = vi.fn();
    const { qa, el } = setup({ resets: { gameplay }, capabilities: [{ kind: 'action', id: 'debug.wipe', label: 'Wipe', destructive: true, run: wipe }] });
    expect(await qa.run('reset.gameplay')).toMatchObject({ ok: false, error: { code: 'confirm_required' } });
    expect(await qa.run('debug.wipe')).toMatchObject({ ok: false, error: { code: 'confirm_required' } });
    expect(await qa.run('reset.all', { confirm: true })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(gameplay).not.toHaveBeenCalled();
    expect(qa.getState().resets).toEqual(['gameplay']);
    qa.open();
    expect(el('run-reset.all').disabled).toBe(true);
    el('run-reset.gameplay').click();
    expect(gameplay).not.toHaveBeenCalled();
    el('cancel-reset.gameplay').click();
    expect(gameplay).not.toHaveBeenCalled();
    el('run-reset.gameplay').click();
    el('confirm-reset.gameplay').click();
    await flush();
    expect(gameplay).toHaveBeenCalledTimes(1);
    expect(gameplay).toHaveBeenCalledWith({ confirm: true });
    await expect(qa.run('debug.wipe', { confirm: true })).resolves.toMatchObject({ ok: true });
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('16. timeScale drives the host hook only', async () => {
    let scale = 1;
    const set = vi.fn((value: number) => { scale = value; });
    const { qa, el } = setup({ timeScale: { get: () => scale, set } });
    await expect(qa.run('timeScale.set', { value: 2 })).resolves.toEqual({ ok: true, command: 'timeScale.set', value: 2 });
    expect(await qa.run('timeScale.set', { value: 0 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    qa.open();
    el('timeScale-0.5').click();
    await flush();
    expect(set).toHaveBeenLastCalledWith(0.5);
    expect(qa.getState().timeScale).toBe(0.5);
  });

  it('17. without a timeScale hook the control is disabled and the command unavailable', async () => {
    const { qa, el } = setup();
    expect(qa.getState().timeScale).toBeNull();
    expect(await qa.run('timeScale.set', { value: 2 })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    qa.open();
    for (const scale of ['0.5', '1', '2']) expect(el(`timeScale-${scale}`).disabled).toBe(true);
    expect(el('timeScale').textContent).toContain('N/A');
  });

  it('19. assumes no game resource: nothing registered = nothing shown, and src/qa names none', () => {
    const { qa, el } = setup();
    expect(qa.getState().values).toEqual({});
    expect(qa.listCapabilities()).toEqual([]);
    qa.open();
    expect(el('controls').textContent).toContain('N/A');
    const dir = fileURLToPath(new URL('../../src/qa/', import.meta.url));
    for (const file of readdirSync(dir)) {
      const code = readFileSync(resolve(dir, file), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\b(coins?|moves?|boosters?|stars?|gems?|lamps?|diamonds?)\b/i);
      // no global patch, no request, no frame loop, no storage
      expect(code, file).not.toMatch(/requestAnimationFrame|setInterval|XMLHttpRequest|\bfetch\s*\(|localStorage|sessionStorage|(globalThis|window)\.\w+\s*=[^=]/);
    }
  });
});

describe('NetworkFaultProfile (Core/platform calls only)', () => {
  function platform() {
    const get = vi.fn(async () => ({ a: 1 }));
    const set = vi.fn(async () => true);
    const purchase = vi.fn(async () => ({ status: 'ok' as const, productId: 'p' }));
    const showRewarded = vi.fn(async (placement: string): Promise<PlatformAdResult> => ({ status: 'rewarded', rewarded: true, placement }));
    const raw = {
      identity: { ready: async () => undefined, playerId: () => null, displayName: () => '' },
      environment: { platformCode: () => 'DEV', language: () => 'en', deviceType: () => null, platformOs: () => null, launchPayload: () => '', serverTime: () => null },
      storage: { isCloud: () => false, ready: async () => undefined, get, set, clear: async () => undefined },
      gameplay: { reportLoadingProgress: () => undefined, ready: async () => undefined, start: () => undefined, stop: () => undefined },
      ads: { showInterstitial: showRewarded, showRewarded, isRewardedAvailable: () => true },
      payments: { purchase, restore: async () => [], getCatalog: async () => [], restoreGrant: 'before-consume' as const }
    } as unknown as GamePlatform;
    return { raw, get, set, purchase, showRewarded };
  }

  it('12. NORMAL passes every call through untouched', async () => {
    const faults = new NetworkFaultProfile();
    const { raw, get, purchase } = platform();
    const p = withNetworkFaults(raw, faults);
    await expect(p.storage.get(['a'])).resolves.toEqual({ a: 1 });
    await expect(p.payments!.purchase('p')).resolves.toMatchObject({ status: 'ok' });
    expect(p.identity).toBe(raw.identity);
    expect(p.payments!.restoreGrant).toBe('before-consume');
    expect(get).toHaveBeenCalledTimes(1);
    expect(purchase).toHaveBeenCalledTimes(1);
    expect(faults.snapshot()).toEqual({ mode: 'normal', latencyMs: 1000, failNextArmed: false, calls: 2, faulted: 0, scope: 'core-platform' });
  });

  it('13. OFFLINE: reads / payments reject, writes answer false, ads answer no_fill — the SDK is never called', async () => {
    const faults = new NetworkFaultProfile();
    const { raw, get, set, purchase, showRewarded } = platform();
    const p = withNetworkFaults(raw, faults);
    const { qa } = setup({ network: faults });
    await expect(qa.run('network.set', { mode: 'offline' })).resolves.toMatchObject({ ok: true, value: { mode: 'offline' } });
    await expect(p.storage.get(['a'])).rejects.toBeInstanceOf(NetworkFaultError);
    await expect(p.storage.set({ a: 2 })).resolves.toBe(false);
    await expect(p.payments!.purchase('p')).rejects.toMatchObject({ fault: 'offline', call: 'payments.purchase' });
    await expect(p.ads!.showRewarded('continue')).resolves.toMatchObject({ status: 'no_fill', rewarded: false, placement: 'continue' });
    expect([get, set, purchase, showRewarded].map((fn) => fn.mock.calls.length)).toEqual([0, 0, 0, 0]);
    expect(qa.getState().network).toMatchObject({ mode: 'offline', faulted: 4 });
    expect(await qa.run('network.set', { mode: 'broken' })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('14. LATENCY waits (the injected delay) before the real call', async () => {
    const waits: number[] = [];
    let release: () => void = () => undefined;
    const faults = new NetworkFaultProfile({ delay: (ms) => { waits.push(ms); return new Promise((resolve) => { release = resolve; }); } });
    const { raw, get } = platform();
    const p = withNetworkFaults(raw, faults);
    const { qa, el } = setup({ network: faults });
    await qa.run('network.set', { mode: 'latency', latencyMs: 1500 });
    const pending = p.storage.get(['a']);
    await flush();
    expect(waits).toEqual([1500]);
    expect(get).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toEqual({ a: 1 });
    expect(get).toHaveBeenCalledTimes(1);
    // the panel's LATENCY button sends the same command with its field
    qa.open();
    el('input-latency').value = '300';
    el('network-latency').click();
    await flush();
    expect(qa.getState().network).toMatchObject({ mode: 'latency', latencyMs: 300 });
    expect(await qa.run('network.set', { mode: 'latency', latencyMs: -1 })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('15. FAIL_NEXT fails exactly one call that reaches the network', async () => {
    const faults = new NetworkFaultProfile();
    const { raw, get } = platform();
    const p = withNetworkFaults(raw, faults);
    const { qa } = setup({ network: faults });
    await qa.run('network.failNext');
    expect(qa.getState().network?.failNextArmed).toBe(true);
    await expect(p.storage.get(['a'])).rejects.toMatchObject({ fault: 'fail_next' });
    await expect(p.storage.get(['a'])).resolves.toEqual({ a: 1 });
    // an OFFLINE refusal does not use it up
    await qa.run('network.failNext');
    await qa.run('network.set', { mode: 'offline' });
    await expect(p.storage.get(['a'])).rejects.toMatchObject({ fault: 'offline' });
    await qa.run('network.set', { mode: 'normal' });
    await expect(p.ads!.showRewarded('x')).resolves.toMatchObject({ status: 'error', rewarded: false });
    await expect(faults.run('host.fetch', () => 'ok')).resolves.toBe('ok');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('without a profile the network commands are unavailable', async () => {
    const { qa } = setup();
    expect(qa.getState().network).toBeNull();
    expect(await qa.run('network.set', { mode: 'offline' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});

describe('public entry', () => {
  it('exports the documented QA API only', () => {
    expect(Object.keys(qaEntry).sort()).toEqual([
      'DEFAULT_QA_LATENCY_MS', 'NETWORK_FAULT_MODES', 'NetworkFaultError', 'NetworkFaultProfile', 'QA_GLOBAL_NAME', 'QA_PANEL_ATTRIBUTE', 'QA_RESET_KINDS',
      'QA_RESET_LABELS', 'QA_SAMPLE_WINDOW_MS', 'QA_TIME_SCALES', 'QaPanelView', 'QaRuntime', 'installGameCoreQA', 'isNetworkFault', 'toQaJson', 'withNetworkFaults'
    ]);
  });
});
