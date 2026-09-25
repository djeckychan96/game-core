// ReadyUiOverlay demo: the Pixi Ready UI over plain DOM gameplay (the SoliPix shape), driven by the host's ONE frame loop.
// Proof target of `npm run showcase:overlay` (scripts/overlay-demo-check.mjs). Three parts, kept apart on purpose:
//   1. DOM gameplay — knows nothing about Pixi or Game Core;
//   2. HOST INFRASTRUCTURE — everything a new game writes to get the overlay (the LOC metric counts this block);
//   3. game-specific Ready UI — views, callbacks, layout.
import { Ticker } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { HudView, SettingsWindowView, UiButton, createOrientationGuard, createReadyUiOverlay, resolveTheme } from 'game-core/pixi';

// ---------- 1. DOM gameplay ----------
const game = document.getElementById('game') as HTMLElement;
const card = document.getElementById('card') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const counters = { domClicks: 0, drags: 0, pixiTaps: 0, gameSaw: [] as string[] };
let drag: { id: number; dx: number; dy: number } | null = null;
card.addEventListener('pointerdown', (event) => {
  drag = { id: event.pointerId, dx: event.clientX - card.offsetLeft, dy: event.clientY - card.offsetTop };
  card.setPointerCapture(event.pointerId);
});
card.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  card.style.left = `${event.clientX - drag.dx}px`;
  card.style.top = `${event.clientY - drag.dy}px`;
});
card.addEventListener('pointerup', () => { if (drag) { drag = null; counters.drags++; } });
document.getElementById('dom-tap')!.addEventListener('click', () => { counters.domClicks++; });
// every pointerdown / click inside the game container, by target: a gameplay element id = the overlay let it through,
// 'overlay' = the Ready UI took it (it still bubbles to a delegated container listener, with the overlay's hit layer as target)
for (const type of ['pointerdown', 'click']) {
  game.addEventListener(type, (event) => {
    const target = event.target as HTMLElement;
    counters.gameSaw.push(`${type}:${target.closest('[data-game-core]') ? 'overlay' : target.id}`);
  });
}

// ---------- 2. HOST INFRASTRUCTURE (the whole overlay wiring of a new game) ----------
const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('motion', motion);
core.registerRuntime('ui', ui);
const overlay = await createReadyUiOverlay({ container: game, core, ui }); // assets: default ./pixi-ui/
// a portrait-only game: a phone held in landscape gets the "rotate" cover (a desktop window never does); a game with a
// simulation pauses it here — `gameplay.setPaused(blocked, 'ui')` — and checks `guard.blocked` once at start
const guardChanges: boolean[] = [];
const guard = createOrientationGuard({ orientation: 'portrait', onChange: (blocked) => { guardChanges.push(blocked); } });

let frames = 0;
let last = performance.now();
function frame(now: number): void { // the game's existing loop — the only requestAnimationFrame on the page
  overlay.update(now - last);
  last = now;
  frames++;
  requestAnimationFrame(frame);
}
window.addEventListener('resize', layout);
// ---------- end of host infrastructure (+ the first three lines of layout() below) ----------

// ---------- 3. game-specific Ready UI ----------
const theme = resolveTheme();
const textures = overlay.textures;
const settings = overlay.add(new SettingsWindowView({ ui, motion, textures, id: 'settings', closeOnBackdrop: false, onToggle: () => undefined, onHome: () => undefined, onRestart: () => undefined }));
const hud = new HudView({ ui, motion, textures, id: 'hud', coins: 1250, lives: 4, maxLives: 5, onCoinsTap: () => { counters.pixiTaps++; }, onLivesTap: () => { counters.pixiTaps++; },
  onSettingsTap: () => settings.show({ sound: true, music: true, version: 'ReadyUiOverlay demo', gameButtons: false }) });
const bonus = new UiButton({ ui, id: 'bonus', theme, texture: textures.btnGreenShort, width: 240, height: 110, label: 'PIXI', onTap: () => { counters.pixiTaps++; } });
overlay.root.addChildAt(hud, 0);
overlay.root.addChildAt(bonus, 1); // windows stay on top

function layout(): void {
  if (overlay.disposed) return; // dispose() destroyed the views with the Application
  const { width, height, safeArea, resolution } = overlay.resize();
  hud.resize(width, height, { insets: safeArea, pixelRatio: resolution });
  settings.resize(width, height, { insets: safeArea, pixelRatio: resolution });
  bonus.setIdleScale(0.5);
  bonus.position.set(width - 80, height / 2);
  // 'ui' mode: the HUD bar and the PIXI button take input, everything else is the DOM game's
  overlay.setInteractiveRegions([{ x: 0, y: 0, width, height: hud.barHeight }, bonus]);
}
layout();
requestAnimationFrame(frame);
setInterval(() => { status.textContent = `mode=${overlay.inputMode} blocking=${overlay.isBlocking} rotate=${guard.blocked} domClicks=${counters.domClicks} drags=${counters.drags} pixiTaps=${counters.pixiTaps}`; }, 250);

(window as unknown as { __overlayDemo: unknown }).__overlayDemo = {
  overlay, core, ui, hud, settings, bonus, counters, layout, guard, guardChanges,
  get frames() { return frames; },
  tickers: () => ({ app: overlay.app.ticker?.started ?? false, // (the Application drops its ticker on destroy)
    system: Ticker.system.started, shared: Ticker.shared.started, systemAutoStart: Ticker.system.autoStart })
};
