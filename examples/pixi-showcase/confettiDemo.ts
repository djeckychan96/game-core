// WIN confetti proof page: the Core ResultWindowView WIN alone, confetti on, driven by the host ticker like a game.
// Also the WIN star entrance: "WIN 1★ / 2★" replay it with fewer earned stars ("Replay WIN" = 3).
// Open it on a phone over the LAN (`npm run showcase -- --host 0.0.0.0` → http://<mac-ip>:5180/confetti.html).
// Target of `npm run showcase:confetti` (scripts/confetti-check.mjs). Query:
//   ?confetti=0            the Result as every existing game gets it: no confetti, no fx textures requested
//   ?tier=desktop|mobile|lowPerf   density tier (default: mobile on a touch device, desktop otherwise — host policy)
//   ?seed=N                seeded random (repeatable captures); default Math.random
//   ?fireworks=0           the fx art loaded, the fireworks off: the star entrance alone (its flash, rays and sparks)
import { Application } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { ResultWindowView, WIN_CONFETTI_TEXTURES, loadReadyUiAssets, type ResultWindowParams } from 'game-core/pixi';
import { createShowcaseLocalization } from './localizationDemo';

type Tier = 'desktop' | 'mobile' | 'lowPerf';
const params = new URLSearchParams(location.search);
const i18n = createShowcaseLocalization();
document.documentElement.lang = i18n.locale;
const confettiOn = params.get('confetti') !== '0';
const tierParam = params.get('tier');
const tier: Tier = tierParam === 'desktop' || tierParam === 'mobile' || tierParam === 'lowPerf'
  ? tierParam
  : matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
const seedParam = params.get('seed');
const fireworksOn = params.get('fireworks') !== '0';

/** mulberry32: a repeatable random for captures. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const app = new Application();
// the production overlay's resolution rule: device pixel ratio clamped to 2
await app.init({ resizeTo: window, resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2), autoDensity: true, antialias: true, backgroundAlpha: 0 });
document.body.appendChild(app.canvas);
const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);

// the confetti art is requested only when the feature is on
const textures = await loadReadyUiAssets(confettiOn ? { baseUrl: './pixi-ui/', include: WIN_CONFETTI_TEXTURES } : { baseUrl: './pixi-ui/' });
const events: string[] = [];
const WIN: ResultWindowParams = { level: 12, stars: 3, rewardCoins: 50 };
const winWith = (stars: number): ResultWindowParams => ({ ...WIN, stars });
const FAIL: ResultWindowParams = { level: 12, outcome: 'fail', rewardCoins: 0 };
let next: ResultWindowParams | null = null;

const view = new ResultWindowView({
  ui, motion, textures, i18n,
  confetti: confettiOn && fireworksOn ? { tier, ...(seedParam !== null ? { random: seeded(Number(seedParam) || 1) } : {}) } : false,
  onNext: () => events.push('next'),
  onRetry: () => events.push('retry'),
  onExit: () => events.push('exit'),
  onDismiss: (reason) => events.push(`dismiss:${reason}`)
});
app.stage.addChild(view);

type Stats = { created: number; active: number; pooled: number; peakActive: number; maxParticles: number; running: boolean; plays: number; completed: number; cancelled: number; elapsedMs: number };
const effect = (view as unknown as { confetti: { getStats(): Stats; durationMs: number } | null }).confetti;
const NO_FX: Stats = { created: 0, active: 0, pooled: 0, peakActive: 0, maxParticles: 0, running: false, plays: 0, completed: 0, cancelled: 0, elapsedMs: 0 };
const stats = (): Stats => effect?.getStats() ?? NO_FX;
type StarStats = { created: number; active: number; running: boolean; elapsedMs: number; durationMs: number; earned: number; plays: number; completed: number; cancelled: number };
const starsFx = (view as unknown as { starsFx: { getStats(): StarStats } }).starsFx;
type Box = { x: number; y: number; width: number; height: number };
const boundsOf = (name: string): Box | Box[] | null => {
  const node = (view as unknown as Record<string, { getBounds(): Box; visible: boolean } | Array<{ getBounds(): Box; visible: boolean }>>)[name];
  if (!node) return null;
  const box = (n: { getBounds(): Box; visible: boolean }): Box => { const b = n.getBounds(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  return Array.isArray(node) ? node.filter((n) => n.visible).map(box) : box(node);
};

/** Show `params` now, or close the open Result first and show it right after (a close continuation, no timer). */
function open(p: ResultWindowParams): void {
  if (view.state === 'hidden') {
    view.show(p);
    return;
  }
  next = p;
  if (view.state === 'leaving') return; // the running close's continuation picks `next` up
  view.close('programmatic', () => flushNext());
}
function flushNext(): void {
  const p = next;
  next = null;
  if (p) view.show(p);
}

// ---------- DOM controls ----------
const bar = document.getElementById('bar')!;
const statsEl = document.getElementById('stats')!;
document.getElementById('replay')!.addEventListener('click', () => open(WIN));
document.getElementById('fail')!.addEventListener('click', () => open(FAIL));
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-stars]'))) {
  b.addEventListener('click', () => open(winWith(Number(b.dataset.stars))));
}
const link = (over: Record<string, string | null>): string => {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(over)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
};
const toggle = document.getElementById('toggle') as HTMLAnchorElement;
toggle.textContent = confettiOn ? 'confetti: ON' : 'confetti: OFF';
toggle.classList.toggle('on', confettiOn);
toggle.href = link({ confetti: confettiOn ? '0' : null });
for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-tier]'))) {
  a.href = link({ tier: a.dataset.tier!, confetti: null });
  a.classList.toggle('on', confettiOn && a.dataset.tier === tier);
}

// ---------- layout: the Result fits between the control bar and the stats line ----------
function layout(): void {
  const top = bar.getBoundingClientRect().height;
  const bottom = statsEl.getBoundingClientRect().height;
  view.resize(window.innerWidth, window.innerHeight, { pixelRatio: app.renderer.resolution, insets: { top, bottom } });
}
window.addEventListener('resize', layout);

// ---------- host clock + a light stats line (text refreshed every 250 ms of ticker time) ----------
let sinceText = 0;
let frames = 0;
let frameMs = 0;
let fps = 0;
let held = false; // proof hook: the capture freezes the host clock on a chosen frame (rendering goes on)
const cell = (label: string, value: string | number): string => `<span>${label} ${value}</span>`;
function renderStats(): void {
  const s = stats();
  statsEl.innerHTML = confettiOn
    ? [cell('tier', tier), cell('created', s.created), cell('active', s.active), cell('pooled', s.pooled), cell('peakActive', s.peakActive), cell('plays', s.plays), cell('fps', fps.toFixed(0))].join('')
    : [cell('confetti', 'OFF'), cell('fps', fps.toFixed(0))].join('');
}
app.ticker.add((ticker) => {
  if (!held) core.update(ticker.deltaMS);
  frames += 1;
  frameMs += ticker.deltaMS;
  sinceText += ticker.deltaMS;
  if (sinceText >= 250) {
    fps = frameMs > 0 ? (frames * 1000) / frameMs : 0;
    frames = 0;
    frameMs = 0;
    sinceText = 0;
    renderStats();
  }
});

renderStats();
layout();
view.show(WIN);

// ---------- what the proof reads ----------
const tapPoint = (name: 'nextButton' | 'retryButton' | 'closeButton') => {
  const node = (view as unknown as Record<string, { getBounds(): { x: number; y: number; width: number; height: number } }>)[name]!;
  const b = node.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
(window as unknown as { __confetti: unknown }).__confetti = {
  events,
  tier,
  confettiOn,
  durationMs: effect?.durationMs ?? 0,
  state: () => view.state,
  stats,
  motion: () => motion.getStats(),
  ui: () => ui.getStats(),
  nodes: () => {
    let count = 0;
    const walk = (c: { children: unknown[] }): void => { count += 1; for (const child of c.children) walk(child as { children: unknown[] }); };
    walk(app.stage as unknown as { children: unknown[] });
    return count;
  },
  showWin: (stars = 3) => open(winWith(stars)),
  /** The WIN star entrance (flight, spring, landing flash / rays / sparks). */
  stars: () => starsFx.getStats(),
  /** Screen boxes (CSS px) of the visible stars and of what they must not cover. */
  boxes: () => Object.fromEntries(['stars', 'titleText', 'subtitleText', 'rewardCaption', 'rewardCoin', 'rewardAmount', 'nextButton', 'retryButton', 'closeButton'].map((n) => [n, boundsOf(n)])),
  showFail: () => open(FAIL),
  hold: (on: boolean) => { held = on; renderStats(); },
  /** Proof hook: advances the host clock by hand (used while held; the effect's frame is a function of its time). */
  step: (ms: number) => { core.update(ms); renderStats(); },
  tapPoint
};
