// Figma confirm-exit proof page: the Core ConfirmWindowView alone, over the Figma screen fill, driven by the host
// ticker like a game. Target of `npm run showcase:confirm` (scripts/confirm-exit-check.mjs). Query:
//   ?lang=ru   the SoliPix runtime copy — the art carries no text
//   ?parity=1  flat background, no dim: the check diffs the capture against Figma's render of modal/confirm-exit
//   ?sheet=1   9-slice sheet: the Figma window shell and button surface at other sizes (no window)
//   ?donor=1   the default variant as every existing game gets it: required pack only, no `include`
//   ?skin=1    Style 1 chosen once in the game's Ready UI config (`theme: { skin }` + `loadReadyUiAssets({ skin })`), no variant
import { Application, Container, Text } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { CONFIRM_EXIT_FIGMA_TEXTURES, ConfirmWindowView, READY_UI_NINE_SLICES, READY_UI_STYLE_1, UiButton, createNineSlice, loadReadyUiAssets, resolveTheme } from 'game-core/pixi';

const params = new URLSearchParams(location.search);
const parity = params.has('parity');
const sheet = params.has('sheet');
const donor = params.has('donor');
const styled = params.has('skin');
const COPY = {
  en: { title: 'ARE YOU SURE?', body: 'YOU WILL LOSE 1 HEART', confirmLabel: 'EXIT' }, // the Figma copy
  ru: { title: 'ВЫ УВЕРЕНЫ?', body: 'Вы потеряете 1 жизнь', confirmLabel: 'ВЫХОД' } // SoliPix (donor ru.json)
};
const copy = params.get('lang') === 'ru' ? COPY.ru : COPY.en;
document.body.classList.toggle('parity', parity);

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
// the Figma confirm skin is requested explicitly: only then are its textures loaded (and a missing one fails)
// (?skin=1: the game's Ready UI style, the one place it is chosen — its files load here, the windows get it as theme)
const READY_UI_THEME = { skin: READY_UI_STYLE_1 };
const textures = await loadReadyUiAssets(donor ? { baseUrl: './pixi-ui/' } : styled ? { baseUrl: './pixi-ui/', skin: READY_UI_THEME.skin } : { baseUrl: './pixi-ui/', include: CONFIRM_EXIT_FIGMA_TEXTURES });
const { windowBase, buttonGreen } = textures;
if (!donor && !styled && (!windowBase || !buttonGreen)) throw new Error('confirm demo: include did not load the Figma 9-slice art');
const theme = resolveTheme();
const events: string[] = [];

type Rect = { x: number; y: number; width: number; height: number };
const rectOf = (node: Container): Rect => {
  const b = node.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
};

// ---------- the window ----------
let view: ConfirmWindowView | null = null;
if (!sheet) {
  view = new ConfirmWindowView({
    ui, motion, textures, id: 'exit-confirm', ...(donor ? {} : styled ? { theme: READY_UI_THEME } : { variant: 'figma' as const }), ...copy,
    ...(parity ? { backdropAlpha: 0 } : {}),
    onConfirm: () => events.push('confirm'),
    onDismiss: (reason) => events.push(`dismiss:${reason}`)
  });
  app.stage.addChild(view);
}

// ---------- the 9-slice sheet: the same two textures at other sizes ----------
const SHEET = { width: 2800, height: 1760 };
const sheetRoot = new Container();
const sheetItems: Array<{ kind: 'window' | 'button'; label: string; node: Container; width: number; height: number }> = [];
if (sheet && windowBase && buttonGreen) {
  const caption = (text: string, x: number, y: number): void => {
    const t = new Text({ text, style: { fontFamily: theme.text.fontFamily, fontSize: 40, fill: 0xffffff } });
    t.anchor.set(0.5, 0);
    t.position.set(x, y);
    sheetRoot.addChild(t);
  };
  let x = 60;
  for (const [w, h, label] of [[960, 1198, 'Figma master 960 × 1198'], [960, 994, 'confirm-exit 960 × 994'], [640, 560, '640 × 560']] as const) {
    const node = createNineSlice(windowBase, READY_UI_NINE_SLICES.windowBase, w, h);
    node.position.set(x + w / 2, 60 + h / 2);
    sheetRoot.addChild(node);
    caption(label, x + w / 2, 60 + h + 24);
    sheetItems.push({ kind: 'window', label, node, width: w, height: h });
    x += w + 60;
  }
  x = 60;
  for (const [w, h, label] of [[600, 206, 'Figma 600 × 206'], [360, 206, '360 × 206'], [900, 206, '900 × 206'], [600, 170, '600 × 170']] as const) {
    const node = new UiButton({ ui, id: `sheet:${label}`, theme, texture: buttonGreen, nineSlice: READY_UI_NINE_SLICES.buttonGreen, width: w, height: h, onTap: () => {} });
    node.position.set(x + w / 2, 1400 + h / 2);
    sheetRoot.addChild(node);
    caption(label, x + w / 2, 1400 + 206 + 24);
    sheetItems.push({ kind: 'button', label, node, width: w, height: h });
    x += w + 60;
  }
  app.stage.addChild(sheetRoot);
}

function layout(): void {
  view?.resize(window.innerWidth, window.innerHeight, { pixelRatio: app.renderer.resolution });
  if (sheet) {
    const s = Math.min(window.innerWidth / SHEET.width, window.innerHeight / SHEET.height);
    sheetRoot.scale.set(s);
    sheetRoot.position.set((window.innerWidth - SHEET.width * s) / 2, (window.innerHeight - SHEET.height * s) / 2);
  }
}
window.addEventListener('resize', layout);
layout();
view?.show();

// ---------- what the proof reads ----------
const PARTS = ['surface', 'title', 'closeButton', 'glow', 'confirmButton', 'confirmLabel', 'body', 'heart', 'lifeDelta'] as const;
(window as unknown as { __confirm: unknown }).__confirm = {
  events,
  show: () => view?.show(),
  state: () => view?.state ?? 'sheet',
  resolution: () => app.renderer.resolution,
  textures: () => Object.fromEntries((['windowBase', 'buttonGreen', 'windowClose', 'brokenHeart', 'messageGlow'] as const).map((k) => {
    const t = textures[k];
    return [k, t ? { units: [t.width, t.height], px: [t.source.pixelWidth, t.source.pixelHeight], resolution: t.source.resolution } : null];
  })),
  scene: () => {
    if (!view) return { sheet: sheetItems.map((i) => ({ kind: i.kind, label: i.label, width: i.width, height: i.height, rect: rectOf(i.node) })) };
    const v = view as unknown as Record<(typeof PARTS)[number] | 'panel', Container> & { fitScale: number };
    const names = new Map<Container, string>(PARTS.map((p) => [v[p], p]));
    const parts: Record<string, unknown> = {};
    for (const name of PARTS) {
      const node = v[name];
      if (!node) continue; // the donor variant has no Figma layers
      const isText = node instanceof Text;
      parts[name] = {
        rect: rectOf(node),
        local: { x: node.x, y: node.y, width: isText ? undefined : node.width, height: isText ? undefined : node.height },
        ...(isText ? { text: node.text, anchor: { x: node.anchor.x, y: node.anchor.y }, scale: node.scale.x, resolution: node.resolution } : {})
      };
    }
    return {
      variant: view.variant,
      fitScale: v.fitScale,
      panel: { x: v.panel.x, y: v.panel.y, scale: v.panel.scale.x },
      order: v.panel.children.map((c) => names.get(c as Container) ?? c.constructor.name),
      parts
    };
  },
  tap: (name: 'confirm' | 'close') => {
    const v = view as unknown as Record<'confirmButton' | 'closeButton', Container>;
    const r = rectOf(v[name === 'confirm' ? 'confirmButton' : 'closeButton']);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
};
