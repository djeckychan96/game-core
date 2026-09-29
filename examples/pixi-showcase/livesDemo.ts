// Figma Lives proof page: the Core LivesWindowView alone, driven by the host ticker like a game. Target of
// `npm run showcase:lives` (scripts/lives-check.mjs). Query:
//   ?donor=1         the default variant as every existing game gets it: required pack only, no `include`
//   ?lang=ru         runtime Russian copy — the art carries no text
//   ?state=full      lives at the cap: MAX, REFILL disabled
//   ?state=noad      no ad offer: REFILL alone, centred
//   ?parity=1        flat background, no dim, the Figma values: the check diffs the capture against Figma's render
import { Application, Container, Text } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { LIVES_FIGMA_TEXTURES, LivesWindowView, loadReadyUiAssets, type LivesWindowParams } from 'game-core/pixi';

const params = new URLSearchParams(location.search);
const parity = params.has('parity');
const donor = params.has('donor');
const state = params.get('state');
// EN = the Figma copy. RU: title / next = SoliPix's LIVES_WORDS; REFILL / GET / MAX = demo copy (no game has them yet)
const COPY = {
  en: { title: 'REFILL HEARTS!', nextLifeLabel: 'NEXT HEART IN', refillLabel: 'REFILL NOW!', adLabel: 'GET', fullLabel: 'MAX' },
  ru: { title: 'ЖИЗНИ', nextLifeLabel: 'Новая жизнь через', refillLabel: 'ПОПОЛНИТЬ!', adLabel: 'ВЗЯТЬ', fullLabel: 'МАКС' }
};
const copy = params.get('lang') === 'ru' ? COPY.ru : COPY.en;
document.body.classList.toggle('parity', parity);
const SHOW: LivesWindowParams = state === 'full'
  ? { lives: 5, maxLives: 5, refillPrice: 900 }
  : { lives: 1, maxLives: 5, timerText: '24:15', refillPrice: 900, adOffer: state !== 'noad' }; // the Figma values

const app = new Application();
// the production overlay's resolution rule: device pixel ratio clamped to 2
await app.init({ resizeTo: window, resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2), autoDensity: true, antialias: true, backgroundAlpha: 0 });
document.body.appendChild(app.canvas);
const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);
app.ticker.add((ticker) => core.update(ticker.deltaMS));
// the Figma Lives skin is requested explicitly: only then are its textures loaded (and a missing one fails)
const textures = await loadReadyUiAssets(donor ? { baseUrl: './pixi-ui/' } : { baseUrl: './pixi-ui/', include: LIVES_FIGMA_TEXTURES });
const events: string[] = [];

const view = new LivesWindowView({
  ui, motion, textures, id: 'lives', ...(donor ? {} : { variant: 'figma' as const }), ...copy,
  ...(parity ? { backdropAlpha: 0 } : {}),
  onRefill: (p) => events.push(`refill:${p.lives}`),
  onWatchAd: (p) => events.push(`ad:${p.lives}`),
  onDismiss: (reason) => events.push(`dismiss:${reason}`)
});
app.stage.addChild(view);
function layout(): void {
  view.resize(window.innerWidth, window.innerHeight, { pixelRatio: app.renderer.resolution });
}
window.addEventListener('resize', layout);
layout();
view.show({ ...SHOW });

type Rect = { x: number; y: number; width: number; height: number };
const rectOf = (node: Container): Rect => {
  const b = node.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
};
const PARTS = ['title', 'countText', 'nextLabel', 'timerText', 'priceText', 'refillButton', 'adButton', 'closeButton'] as const;
(window as unknown as { __lives: unknown }).__lives = {
  events,
  show: () => view.show({ ...SHOW }),
  state: () => view.state,
  resolution: () => app.renderer.resolution,
  scene: () => {
    const v = view as unknown as Record<(typeof PARTS)[number] | 'panel', Container> & { fitScale: number };
    const parts: Record<string, unknown> = {};
    for (const name of PARTS) {
      const node = v[name];
      parts[name] = { rect: rectOf(node), visible: node.visible, ...(node instanceof Text ? { text: node.text } : {}) };
    }
    return { variant: view.variant, fitScale: v.fitScale, panel: { x: v.panel.x, y: v.panel.y, scale: v.panel.scale.x }, parts };
  },
  tap: (name: 'refill' | 'ad' | 'close') => {
    const v = view as unknown as Record<'refillButton' | 'adButton' | 'closeButton', Container>;
    const r = rectOf(v[name === 'refill' ? 'refillButton' : name === 'ad' ? 'adButton' : 'closeButton']);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
};
