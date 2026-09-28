// QA Panel demo host — what a game's QA BUILD does. The game owns every value (its coins, lives, level, its
// own time scale); Core only gets callbacks. The platform is the DEV platform behind `withNetworkFaults`, so the
// panel's network modes act on the real SaveGate write below. `window.GameCoreQA` exists because this page
// installs it — a production build would not import `game-core/qa` at all (npm run qa:isolation).
import { BUILD_INFO, SaveGate, createDevPlatform } from 'game-core';
import { NetworkFaultProfile, installGameCoreQA, withNetworkFaults } from 'game-core/qa';

const LEVELS = Array.from({ length: 30 }, (_, i) => String(i + 1));
const fresh = () => ({ coins: 120, lives: 5, level: '1', unlockAll: false });
let game = fresh();
let timeScale = 1;

const faults = new NetworkFaultProfile();
const platform = withNetworkFaults(createDevPlatform({ language: 'ru' }), faults);
const gate = new SaveGate({ storage: platform.storage, profile: { id: 'qademo', save: { keys: ['progress'] } } });

const qa = installGameCoreQA({
  game: { name: 'QA demo', version: '0.0.1', commit: 'demo' },
  coreBuild: BUILD_INFO,
  environment: platform.environment,
  runtimes: () => ({ save: gate }),
  inspectors: { purchases: () => ({ appliedPurchaseTokens: ['demo-token-1', 'demo-token-2'], restored: 0 }) },
  network: faults,
  timeScale: { get: () => timeScale, set: (value) => { timeScale = value; } },
  resets: {
    gameplay: () => { game = { ...fresh(), coins: game.coins }; return gate.write({ progress: game }); },
    all: () => { game = fresh(); return gate.write({ progress: game }); }
  },
  capabilities: [
    { kind: 'number', id: 'coins', label: 'Coins', min: 0, step: 10, get: () => game.coins, set: (v) => { game.coins = v; } },
    { kind: 'number', id: 'lives', label: 'Lives', min: 0, max: 5, get: () => game.lives, set: (v) => { game.lives = v; } },
    { kind: 'select', id: 'level', label: 'Level', options: () => LEVELS, get: () => game.level, set: (v) => { game.level = v; } },
    { kind: 'toggle', id: 'unlockAll', label: 'Unlock all levels', get: () => game.unlockAll, set: (v) => { game.unlockAll = v; } },
    { kind: 'action', id: 'save', label: 'Save progress now', hint: 'One SaveGate write through the QA platform', run: () => gate.write({ progress: game }) }
  ]
});

// boot: load the save, open the gate, then tell automation the QA API is settled
void gate.load().then((loaded) => {
  const stored = loaded.values.progress as Partial<ReturnType<typeof fresh>> | undefined;
  if (stored) game = { ...fresh(), ...stored };
  gate.open();
  qa.markReady();
});

// the game's own frame loop: it moves the runner at ITS time scale and feeds the QA sampler
const runner = document.getElementById('runner')!;
const hud = document.getElementById('hud')!;
let x = 0;
let last = 0;
const frame = (t: number) => {
  const dt = last === 0 ? 16.7 : t - last;
  last = t;
  qa.frame(dt);
  x = (x + dt * 0.12 * timeScale) % Math.max(1, innerWidth - 40);
  runner.style.transform = `translateX(${x}px)`;
  hud.textContent = `coins ${game.coins} · lives ${game.lives} · level ${game.level} · x${timeScale} · open the panel: GameCoreQA.open()`;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
