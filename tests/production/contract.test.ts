import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as root from '../../src/index';
import { SaveGate, SoftCurrencyWallet } from '../../src/index';
import type { GameProductionProfile, GameplayContract, GameplayEvents, GameplayInputQueries, GameplayLevelResult, GameplayProgress, PlatformStorage } from '../../src/index';
import type { LevelMapProgress } from '../../src/pixi/LevelMapView';

// The two clean hosts' seams written against Contract V1 (shapes only — neither game is changed):
// solipix-core-clean window.SoliPixGameplay.actions and gorodki-core-clean window.GORODKI + startGame(host).
function soliPixShaped(): { gameplay: GameplayContract; calls: string[] } {
  const calls: string[] = [];
  const actions = {
    playLevel: (level: number): boolean => { calls.push(`playLevel ${level}`); return level <= 2; }, // false = locked
    restartLevel: () => { calls.push('restartLevel'); },
    setSound: (on: boolean) => { calls.push(`sound ${on}`); },
    setMusic: (on: boolean) => { calls.push(`music ${on}`); }
  };
  const audio = { pauseForAd: () => calls.push('pauseForAd'), resumeAfterAd: () => calls.push('resumeAfterAd') };
  const gameplay: GameplayContract = {
    modes: { frame: 'core', input: 'layer' }, // the host rAF drives the overlay; card drags reach the DOM
    startLevel: actions.playLevel,
    restart: actions.restartLevel,
    setPaused: (paused, reason) => { if (reason === 'ad') (paused ? audio.pauseForAd : audio.resumeAfterAd)(); },
    setSound: actions.setSound,
    setMusic: actions.setMusic,
    getProgress: () => ({ levels: [{ index: 1, stars: 3 }, { index: 2, stars: 0 }, { index: 3 }], currentLevel: 2 })
  };
  return { gameplay, calls };
}

function gorodkiShaped(): { gameplay: GameplayContract; game: { level: number; paused: boolean; soundOn: boolean } } {
  const game = { level: 0, paused: false, soundOn: true, load(i: number) { this.level = i; }, restart() {} };
  const gameplay: GameplayContract = {
    modes: { frame: 'gameplay', input: 'query' }, // Three.js loop calls host.frame(ms); the game asks blocked() / isUiAt()
    startLevel: (level) => game.load(level - 1),
    restart: () => game.restart(),
    setPaused: (paused) => { game.paused = paused; },
    setSound: (on) => { game.soundOn = on; },
    next: () => game.load(game.level + 1),
    getProgress: () => ({ levels: [{ index: 1, stars: 2 }, { index: 2 }], currentLevel: game.level + 1 })
  };
  return { gameplay, game };
}

test('both clean hosts fit Contract V1; getProgress feeds the Ready UI LevelMapView as is', () => {
  const soliPix = soliPixShaped();
  soliPix.gameplay.startLevel(3);
  soliPix.gameplay.setPaused(true, 'ad');
  soliPix.gameplay.setPaused(true, 'ui');
  soliPix.gameplay.setMusic?.(false);
  expect(soliPix.calls).toEqual(['playLevel 3', 'pauseForAd', 'music false']);
  expect(soliPix.gameplay.next).toBeUndefined();

  const gorodki = gorodkiShaped();
  gorodki.gameplay.startLevel(4);
  gorodki.gameplay.setPaused(true, 'ui');
  gorodki.gameplay.setSound(false);
  gorodki.gameplay.next?.();
  expect(gorodki.game).toMatchObject({ level: 4, paused: true, soundOn: false });
  expect(gorodki.gameplay.setMusic).toBeUndefined();

  const map: LevelMapProgress = soliPix.gameplay.getProgress(); // compile-time: structurally the map's progress
  expect(map.currentLevel).toBe(2);
  expect(gorodki.gameplay.getProgress().currentLevel).toBe(5);
});

test('events: levelEnd carries level, win, firstCompletion, optional stars and generic metrics; Gorodki hooks map onto the input queries', () => {
  const seen: unknown[] = [];
  const events: GameplayEvents = {
    ready: () => seen.push('ready'),
    levelStart: (event) => seen.push(['start', event.level]),
    levelEnd: (result) => seen.push(['end', result]),
    levelExit: (event) => seen.push(['exit', event.level])
  };
  const gorodkiWin: GameplayLevelResult = { level: 5, levelId: 'classic-9', win: true, firstCompletion: true, stars: 2, metrics: { throws: 3, par: 2, reason: 'cleared' } };
  const soliPixLose: GameplayLevelResult = { level: 2, win: false, firstCompletion: false, metrics: { movesLeft: 0 } };
  events.ready();
  events.levelStart({ level: 5, levelId: 'classic-9' });
  events.levelEnd(gorodkiWin);
  events.levelEnd(soliPixLose);
  events.levelExit({ level: 2 });
  expect(seen).toEqual(['ready', ['start', 5], ['end', gorodkiWin], ['end', soliPixLose], ['exit', 2]]);

  const queries: GameplayInputQueries = { isBlocking: () => true, isUiAt: (x, y) => x > 100 && y < 50 };
  const gorodkiHost = { blocked: () => queries.isBlocking(), isUiAt: (x: number, y: number) => queries.isUiAt(x, y) };
  expect([gorodkiHost.blocked(), gorodkiHost.isUiAt(120, 10), gorodkiHost.isUiAt(10, 10)]).toEqual([true, true, false]);
});

test('stars are the quality of a result, never its completion: a 0-star win is completed, a fail is win: false', async () => {
  // Contract V1 results of a moves game (compile-time: all valid)
  const zeroStarWin: GameplayLevelResult = { level: 3, win: true, firstCompletion: true, stars: 0, metrics: { movesLeft: 4 } };
  const starlessWin: GameplayLevelResult = { level: 4, win: true, firstCompletion: true, metrics: {} };
  const failWithStars: GameplayLevelResult = { level: 5, win: false, firstCompletion: false, stars: 3, metrics: { movesLeft: 0 } };
  // progress after the 0-star win: level 3 is completed (below currentLevel) with 0 stars; level 4 is the current one
  const progress: GameplayProgress = { levels: [{ index: 1, stars: 2 }, { index: 2, stars: 3 }, { index: 3, stars: 0 }, { index: 4 }], currentLevel: 4 };
  const map: LevelMapProgress = progress; // the map takes it as is (its node states: tests/pixi/levelMap.test.ts)
  expect([map.currentLevel, progress.levels[2]]).toEqual([4, { index: 3, stars: 0 }]);

  // the Core consumer of levelEnd decides by win / firstCompletion only (a fixed test reward that reads no stars)
  const data: Record<string, unknown> = {};
  const storage: PlatformStorage = {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])),
    set: async (patch) => {
      Object.assign(data, JSON.parse(JSON.stringify(patch)));
      return true;
    },
    clear: async () => {}
  };
  const profile: Pick<GameProductionProfile, 'id' | 'save' | 'economy'> = {
    id: 'moves',
    save: { keys: ['moves_state'] },
    economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0, levelReward: () => 10 } }
  };
  const gate = new SaveGate({ storage, profile });
  const wallet = new SoftCurrencyWallet({ gate, profile });
  await Promise.all([gate.load(), wallet.load()]);
  gate.open();
  expect(wallet.applyLevelResult(zeroStarWin)).toMatchObject({ ok: true, kind: 'first', amount: 10 });
  expect(wallet.snapshot().rewardedLevels).toEqual(['3']); // the 0-star level counts as completed (paid once)
  expect(wallet.applyLevelResult(zeroStarWin)).toMatchObject({ kind: 'replay', amount: 0 });
  expect(wallet.applyLevelResult(starlessWin)).toMatchObject({ ok: true, kind: 'first', amount: 10 }); // no stars ≠ a fail
  expect(wallet.applyLevelResult(failWithStars)).toMatchObject({ kind: 'fail', amount: 0 }); // stars on a fail change nothing
  expect(wallet.snapshot()).toMatchObject({ balance: 20, rewardedLevels: ['3', '4'] });
});

test('src/production is types + one validator: no runtime globals, no renderer, imports only the ads / platform validators', () => {
  const dir = fileURLToPath(new URL('../../src/production/', import.meta.url));
  const files = readdirSync(dir).sort();
  expect(files).toEqual(['contract.ts', 'index.ts', 'profile.ts']);
  for (const file of files) {
    const source = readFileSync(dir + file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const pattern of [/\bDate\b/, /\bsetTimeout\b/, /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bfetch\b/, /pixi/i, /\bYaGames\b/, /Math\.random/]) {
      expect(pattern.test(source), `${file} references ${pattern}`).toBe(false);
    }
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
      expect(['./contract', './profile', '../ads/policy', '../platform/config']).toContain(specifier);
    }
  }
  const contract = readFileSync(dir + 'contract.ts', 'utf-8');
  expect(/^export (const|function|class|let|enum)\b/m.test(contract), 'contract.ts must stay types only').toBe(false);
  expect(typeof root.validateGameProductionProfile).toBe('function');
});
