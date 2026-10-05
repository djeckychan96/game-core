import { describe, expect, it } from 'vitest';
import { advance, createKit, pointer } from './setup';
import { ResultWindowView, type ResultWindowParams } from '../../src/pixi/ResultWindowView';
import { LIVES_FIGMA_TEXTURES, LivesWindowView, type LivesWindowParams, type LivesWindowViewOptions } from '../../src/pixi/LivesWindowView';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { formatAmount } from '../../src/pixi/text';
import { ShopWindowView, type ShopItem } from '../../src/pixi/ShopWindowView';
import { SettingsWindowView } from '../../src/pixi/SettingsWindowView';
import { NoAdsWindowView } from '../../src/pixi/NoAdsWindowView';
import { StarterPackWindowView } from '../../src/pixi/StarterPackWindowView';
import { CONFIRM_EXIT_FIGMA_TEXTURES, ConfirmWindowView } from '../../src/pixi/ConfirmWindowView';
import type { UiButton } from '../../src/pixi/UiButton';
import { CanvasTextMetrics, NineSliceSprite, Texture, TextureSource, type Container, type Rectangle, type Sprite, type Text } from 'pixi.js';

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

function tap(target: UiButton, kit: ReturnType<typeof createKit>): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
}

const RESULT: ResultWindowParams = { level: 19, stars: 2, rewardCoins: 100 };

describe('ResultWindowView', () => {
  it('runs show → entering → shown on the host clock and blocks gameplay while open', () => {
    const kit = createKit();
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {} });
    expect(view.visible).toBe(false);
    expect(view.show(RESULT)).toBe(true);
    expect(view.state).toBe('entering');
    expect(view.visible).toBe(true);
    expect(kit.ui.isBlocking()).toBe(true);
    advance(kit.core, 220);
    expect(view.state).toBe('entering');
    advance(kit.core, 300);
    expect(view.state).toBe('shown');
    // the earned stars come in through MotionRuntime after the entrance
    expect(kit.motion.getStats().activeMotions).toBeGreaterThan(0);
    advance(kit.core, 1500);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(view.show(RESULT)).toBe(false); // already open
    view.destroy();
    expect(kit.ui.isBlocking()).toBe(false);
    expect(kit.ui.getStats().windows).toBe(0);
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('CONTINUE / RETRY are close continuations: they run once, after hidden, never on cancel', () => {
    const kit = createKit();
    const next: number[] = [];
    const retry: number[] = [];
    const hidden: string[] = [];
    const view = new ResultWindowView({
      ui: kit.ui, motion: kit.motion, textures: kit.textures,
      onNext: (p) => next.push(p.level),
      onRetry: (p) => retry.push(p.level),
      onHidden: (reason) => hidden.push(reason)
    });
    view.show(RESULT);
    advance(kit.core, 500);
    tap(field<UiButton>(view, 'nextButton'), kit);
    expect(view.state).toBe('leaving');
    expect(next).toEqual([]);
    advance(kit.core, 200);
    expect(view.state).toBe('hidden');
    expect(next).toEqual([19]);
    expect(hidden).toEqual(['button']);
    expect(kit.ui.isBlocking()).toBe(false);

    view.show({ ...RESULT, level: 20 });
    advance(kit.core, 500);
    tap(field<UiButton>(view, 'retryButton'), kit);
    advance(kit.core, 200);
    expect(retry).toEqual([20]);

    view.show({ ...RESULT, level: 21 });
    advance(kit.core, 100);
    kit.core.cancelAll();
    expect(view.state).toBe('hidden');
    expect(view.visible).toBe(false);
    expect(hidden.at(-1)).toBe('cancelled');
    expect(next).toEqual([19]);
    expect(retry).toEqual([20]);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('keeps the donor geometry: ribbon at −317, buttons at (±230, 310), × at (445, −369)', () => {
    const kit = createKit();
    const dismissed: string[] = [];
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {}, onRetry: () => {}, onDismiss: (r) => dismissed.push(r) });
    view.show(RESULT);
    advance(kit.core, 500);
    expect(field<UiButton>(view, 'nextButton').position).toMatchObject({ x: -230, y: 310 });
    expect(field<UiButton>(view, 'retryButton').position).toMatchObject({ x: 230, y: 310 });
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 445, y: -369 });
    expect(field<Text>(view, 'rewardAmount').y).toBe(119); // Trail Arrow's fix of the donor 101 (overlapped the coin)
    view.close('background');
    advance(kit.core, 200);
    expect(dismissed).toEqual(['background']);
    view.show({ ...RESULT, retry: false });
    advance(kit.core, 500);
    expect(field<UiButton>(view, 'retryButton').visible).toBe(false);
    expect(field<UiButton>(view, 'nextButton').x).toBe(0);
    view.destroy();
  });

  it('fits the victory frame (star crown … CTA row) into 0.88 × 0.84 of the safe area, frame centered', () => {
    const kit = createKit();
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {} });
    view.show(RESULT);
    advance(kit.core, 500);
    view.resize(320, 568, { insets: { top: 20, bottom: 20 } });
    const panel = field<Container>(view, 'panel');
    // ribbon 1019 wide; top star 288 at y −600 … CTA row 207 at y 310
    const frame = { x: -509.5, y: -744, width: 1019, height: 1157.5 };
    expect(panel.scale.x).toBeCloseTo(Math.min((320 * 0.88) / frame.width, (528 * 0.84) / frame.height), 6);
    expect(panel.x).toBeCloseTo(160, 1);
    expect(panel.y + (frame.y + frame.height / 2) * panel.scale.y).toBeCloseTo(20 + 528 / 2, 1);
    // the visible content (hidden stars excluded) sits inside the frame
    const bounds = panel.getLocalBounds();
    expect(bounds.y).toBeGreaterThanOrEqual(frame.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(frame.y + frame.height + 0.01);
    view.destroy();
  });
});

describe('ResultWindowView outcome: fail', () => {
  type Shown = { visible: boolean; y: number; height: number; x: number };
  const FAIL: ResultWindowParams = { level: 7, stars: 3, rewardCoins: 50, outcome: 'fail' };

  function create(kit: ReturnType<typeof createKit>, log: string[], withExit = true): ResultWindowView {
    return new ResultWindowView({
      ui: kit.ui, motion: kit.motion, textures: kit.textures,
      onNext: (p) => log.push(`next:${p.level}:${p.outcome ?? 'default'}`),
      onRetry: (p) => log.push(`retry:${p.level}:${p.outcome ?? 'default'}`),
      ...(withExit ? { onExit: (p: ResultWindowParams) => log.push(`exit:${p.level}:${p.outcome ?? 'default'}`) } : {}),
      onDismiss: (r) => log.push(`dismiss:${r}`)
    });
  }

  /** Everything a player can see or tap, in panel design units. */
  function snapshot(view: ResultWindowView) {
    const panel = field<Container>(view, 'panel');
    const b = panel.getLocalBounds();
    const btn = (name: string) => {
      const x = field<UiButton>(view, name);
      return { visible: x.visible, enabled: x.enabled, x: x.x, y: x.y, label: x.labelText?.text };
    };
    return {
      title: field<Text>(view, 'titleText').text,
      subtitle: field<Text>(view, 'subtitleText').text,
      reward: ['rewardCaption', 'rewardCoin', 'rewardAmount'].map((n) => field<Shown>(view, n).visible),
      amount: field<Text>(view, 'rewardAmount').text,
      next: btn('nextButton'), retry: btn('retryButton'), failRetry: btn('failRetryButton'), exit: btn('exitButton'),
      close: field<UiButton>(view, 'closeButton').position.y,
      bounds: [b.x, b.y, b.width, b.height].map((v) => Math.round(v)),
      stars: field<Shown[]>(view, 'stars').map((s) => s.visible)
    };
  }

  /** Largest vertical hole between the visible panel children (design units). */
  function largestGap(view: ResultWindowView): number {
    const panel = field<Container>(view, 'panel');
    const spans = panel.children.filter((c) => c.visible).map((c) => [c.y - c.height / 2, c.y + c.height / 2] as const).sort((a, b) => a[0] - b[0]);
    let gap = 0;
    let bottom = spans[0]![1];
    for (const [top, end] of spans.slice(1)) { gap = Math.max(gap, top - bottom); bottom = Math.max(bottom, end); }
    return gap;
  }

  it('1. default outcome is win: reward, CONTINUE, RETRY, stars — the fail buttons never show', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    view.show(RESULT);
    advance(kit.core, 2000);
    const s = snapshot(view);
    expect(s.subtitle).toBe('COMPLETED!');
    expect(s.reward).toEqual([true, true, true]);
    expect(s.amount).toBe('100');
    expect(s.next).toMatchObject({ visible: true, enabled: true, x: -230, y: 310, label: 'CONTINUE' });
    expect(s.retry).toMatchObject({ visible: true, enabled: true, x: 230, y: 310, label: 'RETRY' });
    expect(s.failRetry).toMatchObject({ visible: false, enabled: false });
    expect(s.exit).toMatchObject({ visible: false, enabled: false });
    expect(s.stars).toEqual([true, true, false]);
    view.destroy();
  });

  it('2. explicit outcome win renders exactly like the default', () => {
    const kit = createKit();
    const view = create(kit, []);
    view.show(RESULT);
    advance(kit.core, 2000);
    const byDefault = snapshot(view);
    view.close('programmatic');
    advance(kit.core, 200);
    view.show({ ...RESULT, outcome: 'win' });
    advance(kit.core, 2000);
    expect(snapshot(view)).toEqual(byDefault);
    view.destroy();
  });

  it('3. fail hides the stars and pops none of them', () => {
    const kit = createKit();
    const view = create(kit, []);
    view.show(FAIL);
    advance(kit.core, 460); // the entrance ends here; a win would start the star pops now
    expect(view.state).toBe('shown');
    expect(kit.motion.getStats().activeMotions).toBe(0);
    advance(kit.core, 1500);
    expect(snapshot(view).stars).toEqual([false, false, false]);
    view.destroy();
  });

  it('4. fail hides the reward caption, icon and value and leaves no empty reward space', () => {
    const kit = createKit();
    const view = create(kit, []);
    view.show(RESULT);
    advance(kit.core, 600);
    const winGap = largestGap(view);
    view.close('programmatic');
    advance(kit.core, 200);
    view.show(FAIL);
    advance(kit.core, 600);
    const s = snapshot(view);
    expect(s.title).toBe('LEVEL 7');
    expect(s.subtitle).toBe('FAILED');
    expect(s.reward).toEqual([false, false, false]);
    expect(s.next).toMatchObject({ visible: false, enabled: false });
    expect(s.retry).toMatchObject({ visible: false, enabled: false });
    // no hole where the reward was: every gap is at most the victory layout's own spacing
    expect(largestGap(view)).toBeLessThanOrEqual(Math.max(winGap, 80));
    // the shorter composition is centered in the safe area, not hung from the victory origin
    view.resize(390, 844, { insets: { top: 40, bottom: 20 } });
    const panel = field<Container>(view, 'panel');
    const b = panel.getLocalBounds();
    expect(panel.y + (b.y + b.height / 2) * panel.scale.y).toBeCloseTo(40 + 784 / 2, 1);
    expect(panel.scale.x * b.width).toBeLessThanOrEqual(390 * 0.88 + 0.01);
    view.destroy();
  });

  it('5. fail primary is a green RETRY: onRetry runs once after the close, never onNext', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    view.show(FAIL);
    advance(kit.core, 600);
    const s = snapshot(view);
    const primary = field<UiButton>(view, 'failRetryButton');
    expect(s.failRetry).toMatchObject({ visible: true, enabled: true, x: 0, label: 'RETRY' });
    expect(primary.background.texture).toBe(kit.textures.btnGreen);
    expect(s.failRetry.y).toBeLessThan(s.exit.y); // primary on top
    tap(primary, kit);
    expect(view.state).toBe('leaving');
    expect(log).toEqual([]);
    advance(kit.core, 200);
    expect(view.state).toBe('hidden');
    expect(log).toEqual(['retry:7:fail']);
    view.destroy();
  });

  it('6. the secondary EXIT exists only with onExit and runs it as a close continuation', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    view.show(FAIL);
    advance(kit.core, 600);
    const exit = field<UiButton>(view, 'exitButton');
    expect(snapshot(view).exit).toMatchObject({ visible: true, enabled: true, x: 0, label: 'EXIT' });
    expect(exit.background.texture).toBe(kit.textures.btnYellow);
    // hit areas: the two stacked buttons and the × never overlap
    const rect = (name: string) => {
      const b = field<UiButton>(view, name);
      const h = b.hitArea as Rectangle;
      return { l: b.x + h.x * b.scale.x, t: b.y + h.y * b.scale.y, r: b.x + (h.x + h.width) * b.scale.x, bt: b.y + (h.y + h.height) * b.scale.y };
    };
    const [p, e, c] = [rect('failRetryButton'), rect('exitButton'), rect('closeButton')];
    expect(p.bt).toBeLessThanOrEqual(e.t);
    expect(c.bt <= p.t || c.l >= p.r).toBe(true);
    tap(exit, kit);
    advance(kit.core, 200);
    expect(log).toEqual(['exit:7:fail']);

    const kit2 = createKit();
    const log2: string[] = [];
    const bare = create(kit2, log2, false);
    bare.show(FAIL);
    advance(kit2.core, 600);
    expect(snapshot(bare).exit).toMatchObject({ visible: false, enabled: false });
    expect(snapshot(bare).failRetry).toMatchObject({ visible: true, enabled: true });
    tap(field<UiButton>(bare, 'exitButton'), kit2);
    advance(kit2.core, 200);
    expect(log2).toEqual([]);
    expect(bare.state).toBe('shown');
    view.destroy();
    bare.destroy();
  });

  it('7. × / backdrop run only onDismiss, exactly once; nothing double-fires while leaving', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    view.show(FAIL);
    advance(kit.core, 600);
    const close = field<UiButton>(view, 'closeButton');
    tap(close, kit);
    expect(view.state).toBe('leaving');
    tap(close, kit);
    tap(field<UiButton>(view, 'failRetryButton'), kit);
    tap(field<UiButton>(view, 'exitButton'), kit);
    expect(view.close('background')).toBe(false);
    advance(kit.core, 200);
    expect(log).toEqual(['dismiss:button']);

    view.show(FAIL);
    advance(kit.core, 600);
    tap(field<UiButton>(view, 'failRetryButton'), kit);
    tap(close, kit);
    tap(field<UiButton>(view, 'exitButton'), kit);
    advance(kit.core, 200);
    expect(log).toEqual(['dismiss:button', 'retry:7:fail']);

    view.show(FAIL);
    advance(kit.core, 600);
    view.close('background');
    advance(kit.core, 200);
    expect(log).toEqual(['dismiss:button', 'retry:7:fail', 'dismiss:background']);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('8. win ⇄ fail across repeated show / close / cancel keeps each layout intact', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    const buttons = kit.ui.getStats().buttons;
    view.show(RESULT);
    advance(kit.core, 2000);
    const win = snapshot(view);
    view.close('programmatic');
    advance(kit.core, 200);
    view.show(FAIL);
    advance(kit.core, 600);
    const fail = snapshot(view);
    for (let i = 0; i < 3; i++) {
      tap(field<UiButton>(view, 'failRetryButton'), kit);
      advance(kit.core, 200);
      view.show({ ...RESULT, outcome: 'win' });
      advance(kit.core, 2000);
      expect(snapshot(view)).toEqual(win);
      tap(field<UiButton>(view, 'nextButton'), kit);
      advance(kit.core, 200);
      view.show(FAIL);
      advance(kit.core, 100);
      kit.core.cancelAll(); // cancelled mid-entrance: no continuation
      expect(view.state).toBe('hidden');
      view.show(FAIL);
      advance(kit.core, 600);
      expect(snapshot(view)).toEqual(fail);
    }
    view.close('programmatic');
    advance(kit.core, 200);
    // a programmatic close runs the default continuation (onDismiss) like on every ModalWindow
    expect(log).toEqual(['dismiss:programmatic', 'retry:7:fail', 'next:19:win', 'retry:7:fail', 'next:19:win', 'retry:7:fail', 'next:19:win', 'dismiss:programmatic']);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(kit.ui.getStats().buttons).toBe(buttons);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
    expect(kit.ui.getStats().windows).toBe(0);
  });
});

describe('ResultWindowView responsive frame: one scale for win and fail', () => {
  const WIN3: ResultWindowParams = { level: 19, stars: 3, rewardCoins: 100 };
  const FAIL: ResultWindowParams = { level: 7, rewardCoins: 0, outcome: 'fail' };
  type Box = { left: number; top: number; right: number; bottom: number; height: number; scale: number };

  function create(kit: ReturnType<typeof createKit>): ResultWindowView {
    return new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {}, onRetry: () => {}, onExit: () => {} });
  }

  /** Screen box (px) of every visible panel child — the stars included once they popped in. */
  function screenBox(view: ResultWindowView): Box {
    const panel = field<Container>(view, 'panel');
    const s = panel.scale.x;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const c of panel.children) {
      if (!c.visible) continue;
      box.left = Math.min(box.left, panel.x + (c.x - c.width / 2) * s);
      box.right = Math.max(box.right, panel.x + (c.x + c.width / 2) * s);
      box.top = Math.min(box.top, panel.y + (c.y - c.height / 2) * s);
      box.bottom = Math.max(box.bottom, panel.y + (c.y + c.height / 2) * s);
    }
    return { ...box, height: box.bottom - box.top, scale: s };
  }

  function measure(kit: ReturnType<typeof createKit>, view: ResultWindowView, params: ResultWindowParams, w: number, h: number, insets?: { top: number; bottom: number }): Box {
    view.resize(w, h, insets ? { insets } : {});
    view.show(params);
    advance(kit.core, 2500); // entrance + star entrance settled
    expect(view.state).toBe('shown');
    const box = screenBox(view);
    view.close('programmatic');
    advance(kit.core, 200);
    return box;
  }

  it('desktop 1280×800: fail reuses the win scale instead of zooming its shorter content', () => {
    const kit = createKit();
    const view = create(kit);
    const win = measure(kit, view, WIN3, 1280, 800);
    const fail = measure(kit, view, FAIL, 1280, 800);
    expect(fail.scale).toBeCloseTo(win.scale, 6);
    expect(fail.height).toBeLessThan(win.height);
    expect(win.height).toBeLessThanOrEqual(800 * 0.84 + 0.01);
    view.destroy();
  });

  it('desktop 1280×800: the star crown, the × and the CTA rows stay inside the viewport, the win centered as one frame', () => {
    const kit = createKit();
    const view = create(kit);
    for (const params of [WIN3, FAIL]) {
      const box = measure(kit, view, params, 1280, 800);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(800);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(1280);
      // equal margins above the crown and under the buttons
      expect(Math.abs(box.top - (800 - box.bottom))).toBeLessThan(1);
    }
    view.destroy();
  });

  it('mobile 390×844: both outcomes keep the ribbon-width fit and stay on screen', () => {
    const kit = createKit();
    const view = create(kit);
    for (const params of [WIN3, FAIL]) {
      const box = measure(kit, view, params, 390, 844);
      expect(box.scale).toBeCloseTo((390 * 0.88) / 1019, 6);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(844);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(390);
    }
    view.destroy();
  });

  it('safe-area insets bound both outcomes on phone and desktop', () => {
    const kit = createKit();
    const view = create(kit);
    for (const [w, h, insets] of [[390, 844, { top: 47, bottom: 34 }], [1280, 800, { top: 60, bottom: 40 }]] as const) {
      const win = measure(kit, view, WIN3, w, h, insets);
      const fail = measure(kit, view, FAIL, w, h, insets);
      expect(fail.scale).toBeCloseTo(win.scale, 6);
      for (const box of [win, fail]) {
        expect(box.top).toBeGreaterThanOrEqual(insets.top);
        expect(box.bottom).toBeLessThanOrEqual(h - insets.bottom);
      }
    }
    view.destroy();
  });
});

describe('LivesWindowView', () => {
  it('shows lives / timer, MAX when full, and runs refill or ad continuations after close', () => {
    const kit = createKit();
    const refills: number[] = [];
    const ads: number[] = [];
    const view = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onRefill: (p) => refills.push(p.lives), onWatchAd: (p) => ads.push(p.lives) });
    view.show({ lives: 3, maxLives: 5, timerText: '17:42', refillPrice: 900 });
    advance(kit.core, 400);
    expect(view.state).toBe('shown'); // the 320 ms pop
    expect(field<Text>(view, 'countText').text).toBe('3/5');
    expect(field<Text>(view, 'timerText').text).toBe('17:42');
    expect(field<Text>(view, 'priceText').text).toBe('900');
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 416, y: -437 });
    expect(field<UiButton>(view, 'refillButton').position).toMatchObject({ x: -253, y: 350 });
    view.setTimer('17:41');
    expect(field<Text>(view, 'timerText').text).toBe('17:41');
    tap(field<UiButton>(view, 'refillButton'), kit);
    advance(kit.core, 200);
    expect(refills).toEqual([3]);
    expect(view.state).toBe('hidden');

    view.show({ lives: 5, maxLives: 5, refillPrice: 900 });
    advance(kit.core, 500);
    expect(field<Text>(view, 'timerText').text).toBe('MAX');
    expect(field<UiButton>(view, 'refillButton').enabled).toBe(false);
    tap(field<UiButton>(view, 'adButton'), kit);
    advance(kit.core, 200);
    expect(ads).toEqual([5]);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });
});

describe("LivesWindowView variant 'figma' (Style 1: theme_light_4 22:27562 on the screen/lives art, docs/figma/style1-theme-light-4)", () => {
  // Figma screen units → panel units: the Figma variant's panel origin is the screen centre (540, 1172)
  const X = (x: number) => x - 540;
  const Y = (y: number) => y - 1172;
  // tests/pixi/setup.ts fakes the font: advance 0.56 em per char, line box ascent 0.9 em + descent 0.25 em
  const baseline = (boxY: number, boxH: number, size: number, originY = 1172) => boxY - originY + (boxH - 1.15 * size) / 2 + 0.9 * size;
  const PARAMS: LivesWindowParams = { lives: 3, maxLives: 5, timerText: '17:42', refillPrice: 900 };
  const within = (actual: number, expected: number, what?: string) => expect(actual, what).toBeCloseTo(expected, 6);

  /** One texture per key, so a layer is identified by the texture it draws. */
  function distinctTextures(kit: ReturnType<typeof createKit>): ReadyUiTextures {
    const out = {} as Record<string, Texture>;
    for (const key of Object.keys(kit.textures)) out[key] = new Texture({ source: new TextureSource({ width: 2, height: 2, label: key }) });
    return out as ReadyUiTextures;
  }
  function create(kit: ReturnType<typeof createKit>, log: string[], textures: ReadyUiTextures, extra: Partial<LivesWindowViewOptions> = {}): LivesWindowView {
    return new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures, variant: 'figma', id: 'lives',
      onRefill: (p) => log.push(`refill:${p.lives}`), onWatchAd: (p) => log.push(`ad:${p.lives}`), onDismiss: (r) => log.push(`dismiss:${r}`), ...extra });
  }
  /** The glyph run of a Figma label: [left, right] and its baseline, in the label's parent units. */
  function run(label: Text): { left: number; right: number; center: number; baseline: number } {
    const b = label.getLocalBounds(); // 4 stroke + run + 4 stroke + 4 shadow wide; baseline 4 + glyph ascent below the top
    const glyphAscent = CanvasTextMetrics.measureText(label.text, label.style).fontProperties.ascent;
    const left = label.x + (b.x + 4) * label.scale.x;
    const right = label.x + (b.x + b.width - 8) * label.scale.x;
    return { left, right, center: (left + right) / 2, baseline: label.y + (b.y + 4 + glyphAscent) * label.scale.y };
  }
  const drawing = (parent: Container, texture: Texture | undefined) => parent.children.find((c) => (c as Sprite).texture === texture) as Sprite | NineSliceSprite;

  it('builds the Figma layers: 9-slice shell / inner panel / button surfaces, art at its export boxes, runtime text in its boxes', () => {
    const kit = createKit();
    const textures = distinctTextures(kit);
    const view = create(kit, [], textures);
    view.show(PARAMS);
    advance(kit.core, 400);
    const panel = field<Container>(view, 'panel');

    const shell = drawing(panel, textures.windowBase) as NineSliceSprite;
    expect(shell).toBeInstanceOf(NineSliceSprite);
    expect([shell.leftWidth, shell.topHeight, shell.rightWidth, shell.bottomHeight]).toEqual([92, 187, 92, 110]);
    const s = shell.getLocalBounds(); // Component 9 960 × 990 at (60, 677) — the window alone, centred — + the 4 / 4 / 4 / 8 bleed
    expect([shell.x + s.x, shell.y + s.y, s.width, s.height]).toEqual([X(56), Y(673), 968, 1002]);
    const inset = drawing(panel, textures.panelInset) as NineSliceSprite;
    expect(inset).toBeInstanceOf(NineSliceSprite);
    expect([inset.leftWidth, inset.topHeight, inset.rightWidth, inset.bottomHeight]).toEqual([58, 58, 58, 58]);
    const i = inset.getLocalBounds();
    expect([inset.x + i.x, inset.y + i.y, i.width, i.height]).toEqual([X(90), Y(969), 900, 382]);
    const heart = drawing(panel, textures.livesHeart) as Sprite;
    expect([heart.x, heart.y, heart.width, heart.height]).toEqual([X(152), Y(1016), 326, 298]);
    const close = field<UiButton>(view, 'closeButton');
    expect(close.background.texture).toBe(textures.windowClose);
    expect([close.x, close.y, close.background.width, close.background.height]).toEqual([X(923 + 25.5), Y(738 + 25.5), 51, 51]);

    const refill = field<UiButton>(view, 'refillButton');
    expect(refill.background).toBeInstanceOf(NineSliceSprite);
    expect(refill.background.texture).toBe(textures.buttonGreen);
    expect([refill.x, refill.y, refill.background.width, refill.background.height]).toEqual([X(90 + 185.5), Y(1396 + 103.5), 371, 207]);
    const ad = field<UiButton>(view, 'adButton');
    expect(ad.background).toBeInstanceOf(NineSliceSprite);
    expect(ad.background.texture).toBe(textures.buttonOrange);
    expect([ad.x, ad.y, ad.background.width, ad.background.height]).toEqual([X(483 + 253.5), Y(1396 + 103.5), 507, 207]);
    // inside the ad button (origin = its centre 736.5, 1499.5), in the Figma order: highlight, GET, heart icon, +1, clapper
    const bx = (x: number) => x - 736.5;
    const by = (y: number) => y - 1499.5;
    const highlight = drawing(ad, textures.buttonHighlight) as Sprite;
    expect([highlight.x, highlight.y, highlight.width, highlight.height]).toEqual([bx(491), by(1401), 307, 172]);
    const rewardIcon = drawing(ad, textures.iconHeart) as Sprite;
    expect([rewardIcon.x, rewardIcon.y, rewardIcon.width, rewardIcon.height]).toEqual([bx(819), by(1412), 154, 154]);
    const adIcon = drawing(ad, textures.iconAd) as Sprite;
    expect([adIcon.x, adIcon.y, adIcon.width, adIcon.height]).toEqual([bx(511), by(1412), 128, 134]);
    const adTexts = ad.children.filter((c) => (c as Text).text !== undefined) as Text[];
    expect(adTexts.map((t) => t.text)).toEqual(['GET', '+1']);
    expect(ad.children.indexOf(highlight)).toBeLessThan(ad.children.indexOf(adTexts[0]!));
    expect(ad.children.indexOf(adIcon)).toBe(ad.children.length - 1);

    // runtime text: centred / left runs, the font's line box centred in the Figma box
    const title = run(field<Text>(view, 'title'));
    within(title.center, X(540), 'title');
    within(title.baseline, baseline(711, 104, 80), 'title');
    const next = run(field<Text>(view, 'nextLabel'));
    within(next.center, X(531 + 221), 'next');
    within(next.baseline, baseline(1087, 60, 50), 'next');
    const count = run(field<Text>(view, 'countText'));
    expect(field<Text>(view, 'countText').text).toBe('3');
    within(count.center, X(272 + 42), 'count');
    within(count.baseline, baseline(1071, 180, 150), 'count');
    const timer = run(field<Text>(view, 'timerText'));
    within(timer.center, X(531 + 221), 'timer');
    within(timer.baseline, baseline(1150, 84, 70), 'timer');
    const refillLabel = run(refill.children.find((c) => (c as Text).text === 'REFILL NOW!') as Text);
    within(refillLabel.center, 112 + 165.5 - 275.5, 'refill label');
    within(refillLabel.baseline, baseline(1402, 84, 50, 1499.5), 'refill label');
    const get = run(adTexts[0]!);
    within(get.center, bx(620 + 233.199 / 2), 'GET');
    within(get.baseline, baseline(1409, 159, 60, 1499.5), 'GET');
    const plusOne = run(adTexts[1]!);
    within(plusOne.left, bx(859), '+1');
    within(plusOne.baseline, baseline(1447, 72, 60, 1499.5), '+1');
    // Frame 381: "900", a 1-unit gap and the 100 × 100 coin, one row centred on REFILL, centred in its 100 height
    const price = run(field<Text>(view, 'priceText'));
    const coin = field<Sprite>(view, 'priceCoin');
    expect(coin.texture).toBe(textures.iconCoin);
    expect([coin.width, coin.height, coin.y]).toEqual([100, 100, 1472 - 1499.5]);
    within(coin.x, price.right + 1, 'coin follows the price');
    within(price.left + (coin.x + 100), 0, 'row centred on the button');
    within(price.baseline, baseline(1472, 100, 64, 1499.5), 'price');

    for (const layer of [shell, inset, heart, field<Text>(view, 'title'), field<Text>(view, 'countText'), field<Text>(view, 'nextLabel'), field<Text>(view, 'timerText')]) {
      expect(layer.eventMode).toBe('none');
    }
    expect(panel.children[panel.children.length - 1]).toBe(close);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('keeps the donor behaviour: count, countdown / MAX, price, REFILL disabled when full, ad offer, continuations after the close', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log, kit.textures);
    view.show(PARAMS);
    advance(kit.core, 400);
    expect(view.state).toBe('shown');
    expect([field<Text>(view, 'countText').text, field<Text>(view, 'timerText').text, field<Text>(view, 'priceText').text]).toEqual(['3', '17:42', '900']);
    view.setTimer('9:05');
    expect(field<Text>(view, 'timerText').text).toBe('9:05');
    within(run(field<Text>(view, 'timerText')).center, X(752), 'timer stays centred');
    tap(field<UiButton>(view, 'refillButton'), kit);
    advance(kit.core, 200);
    expect(log).toEqual(['refill:3']);
    expect(view.state).toBe('hidden');

    view.show({ lives: 5, maxLives: 5, refillPrice: 12450 });
    advance(kit.core, 400);
    expect(field<Text>(view, 'timerText').text).toBe('MAX');
    expect(field<Text>(view, 'priceText').text).toBe(formatAmount(12450)); // thin-space thousands, as the donor
    const price = run(field<Text>(view, 'priceText'));
    within(price.left + field<Sprite>(view, 'priceCoin').x + 100, 0, 'a longer price stays centred with its coin');
    expect(field<UiButton>(view, 'refillButton').enabled).toBe(false);
    view.setTimer('00:01'); // ignored at full lives, like the donor
    expect(field<Text>(view, 'timerText').text).toBe('MAX');
    tap(field<UiButton>(view, 'adButton'), kit);
    advance(kit.core, 200);
    expect(log).toEqual(['refill:3', 'ad:5']);

    view.show({ ...PARAMS, adOffer: false });
    advance(kit.core, 400);
    expect(field<UiButton>(view, 'adButton').visible).toBe(false);
    expect(field<UiButton>(view, 'refillButton').x).toBe(0); // REFILL alone: centred
    tap(field<UiButton>(view, 'closeButton'), kit);
    advance(kit.core, 200);
    view.show(PARAMS);
    advance(kit.core, 400);
    expect(field<UiButton>(view, 'refillButton').x).toBe(X(275.5));
    const backdrop = field<Container>(view, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 200);
    expect(log).toEqual(['refill:3', 'ad:5', 'dismiss:button', 'dismiss:background']);
    expect(kit.uiErrors).toEqual([]);
    view.destroy();

    const noAds = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, variant: 'figma', onRefill: () => {} });
    noAds.show(PARAMS);
    expect(field<UiButton>(noAds, 'adButton').visible).toBe(false);
    noAds.destroy();
  });

  it('defaults to the Figma copy and dim; options set every label', () => {
    const kit = createKit();
    const view = create(kit, [], kit.textures);
    const texts = (v: LivesWindowView) => [
      field<Text>(v, 'title').text, field<Text>(v, 'nextLabel').text,
      ...(field<UiButton>(v, 'refillButton').children.filter((c) => (c as Text).text !== undefined) as Text[]).map((t) => t.text).slice(0, 1),
      ...(field<UiButton>(v, 'adButton').children.filter((c) => (c as Text).text !== undefined) as Text[]).map((t) => t.text)
    ];
    expect(texts(view)).toEqual(['REFILL HEARTS!', 'NEXT HEART IN', 'REFILL NOW!', 'GET', '+1']);
    expect([field<number>(view, 'backdropColor'), field<number>(view, 'backdropAlpha')]).toEqual([0x080b0d, 0.8]);
    view.destroy();
    const ru = create(kit, [], kit.textures, { title: 'ПОПОЛНИТЬ ЖИЗНИ!', nextLifeLabel: 'СЛЕДУЮЩАЯ ЧЕРЕЗ', refillLabel: 'ПОПОЛНИТЬ!', adLabel: 'ВЗЯТЬ', adRewardLabel: '+2' });
    expect(texts(ru)).toEqual(['ПОПОЛНИТЬ ЖИЗНИ!', 'СЛЕДУЮЩАЯ ЧЕРЕЗ', 'ПОПОЛНИТЬ!', 'ВЗЯТЬ', '+2']);
    const title = run(field<Text>(ru, 'title'));
    expect(title.right - title.left).toBeLessThanOrEqual(690 + 1e-6); // a long title shrinks into its 690 box
    ru.destroy();
  });

  it('fits like the Figma frame: the 960 × 990 window keeps its place in the contain-fitted 1080 × 2344 screen', () => {
    for (const [w, h] of [[390, 844], [1280, 800], [1080, 2344]] as const) {
      const kit = createKit();
      const view = create(kit, [], kit.textures);
      view.resize(w, h);
      view.show(PARAMS);
      advance(kit.core, 400);
      const k = Math.min(w / 1080, h / 2344);
      const shell = (drawing(field<Container>(view, 'panel'), kit.textures.windowBase) as NineSliceSprite).getBounds();
      expect(shell.width, `${w}×${h}`).toBeCloseTo(968 * k, 6);
      expect(shell.height, `${w}×${h}`).toBeCloseTo(1002 * k, 6);
      expect(shell.x + 4 * k, `${w}×${h}`).toBeCloseTo(w / 2 + X(60) * k, 6);
      expect(shell.y + 4 * k, `${w}×${h}`).toBeCloseTo(h / 2 + Y(677) * k, 6);
      view.destroy();
    }
  });

  it('requested without its art (not in `include`): a clear error before anything registers', () => {
    const kit = createKit();
    const { buttonOrange: _drop, ...textures } = kit.textures;
    expect(() => create(kit, [], textures)).toThrow(/variant 'figma': no buttonOrange \(button\/button_orange@2x\.webp\).*include: LIVES_FIGMA_TEXTURES/);
    expect(kit.ui.getStats().windows).toBe(0);
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('the default stays the donor window and needs only the required pack', () => {
    const kit = createKit();
    const required = { ...kit.textures };
    for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
    const view = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: required, onRefill: () => {} });
    expect(view.variant).toBe('donor');
    expect(LIVES_FIGMA_TEXTURES.every((name) => !(name in required))).toBe(true);
    view.show(PARAMS);
    expect(field<Text>(view, 'countText').text).toBe('3/5');
    view.destroy();
  });
});

describe('ShopWindowView', () => {
  const items: ShopItem[] = [
    { id: 'a', amount: 1000, price: '$0.99' },
    { id: 'b', amount: 3500, price: '$2.99' },
    { id: 'c', amount: 8000, price: '$5.99' },
    { id: 'd', amount: 16500, price: '$9.99' }
  ];
  type Card = { button: UiButton; amount: Text; price: Text; item: ShopItem | null };

  it('lays out full-screen like the donor: awning across the top, column scaled to the width', () => {
    const kit = createKit();
    const view = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: () => {} });
    view.resize(390, 844);
    view.show({ items });
    advance(kit.core, 500);
    const s = Math.min(390 / 1080, 844 / 2344);
    const panel = field<Container>(view, 'panel');
    expect(panel.scale.x).toBeCloseTo(s, 5);
    expect(panel.position).toMatchObject({ x: 195, y: 422 });
    const header = field<Container>(view, 'header');
    const tiles = header.children.filter((c) => c.visible);
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    const tileW = tiles[0]!.width;
    expect(tiles.length * tileW).toBeGreaterThanOrEqual(844 / s / 2); // covers the width with margin
    expect(tiles[0]!.height * s).toBeCloseTo(844 * (36 / 255), 0);
    const close = field<UiButton>(view, 'shopClose');
    expect(close.x * s + 195).toBeLessThan(390);
    expect(close.y * s + 422).toBeGreaterThan(0);
    const gold = field<Container>(view, 'gold');
    expect(gold.getLocalBounds().width * gold.scale.x * s).toBeLessThanOrEqual(390 - 64 * s + 1);
    const cards = field<Card[]>(view, 'cards');
    expect(cards.filter((c) => c.button.visible).length).toBe(4);
    expect(cards[1]?.amount.text).toBe('3 500');
    expect(cards[1]?.price.text).toBe('$2.99');
    expect(cards[5]?.button.enabled).toBe(false);
    view.destroy();
  });

  it('buys through a close continuation and never from a hidden card or after a drag', () => {
    const kit = createKit();
    const bought: string[] = [];
    const view = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: (item) => bought.push(item.id) });
    view.show({ items });
    advance(kit.core, 500);
    const cards = field<Card[]>(view, 'cards');
    tap(cards[1]!.button, kit);
    expect(bought).toEqual([]);
    advance(kit.core, 200);
    expect(bought).toEqual(['b']);
    expect(view.state).toBe('hidden');
    view.show({ items: items.slice(0, 1) });
    advance(kit.core, 500);
    tap(cards[3]!.button, kit);
    advance(kit.core, 200);
    expect(bought).toEqual(['b']);
    expect(view.state).toBe('shown');
    view.destroy();
    expect(kit.ui.getStats().windows).toBe(0);
    expect(kit.ui.getStats().buttons).toBe(0);
  });
});

describe('SettingsWindowView', () => {
  it('toggles sound / music in place, shows the slash when off, and reports each toggle', () => {
    const kit = createKit();
    const toggles: string[] = [];
    const view = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onToggle: (s, e) => toggles.push(`${s}:${e}`) });
    view.show({ sound: true, music: false, version: 'VERSION 0.4.0' });
    advance(kit.core, 400);
    const t = field<Record<'sound' | 'music' | 'haptic', { button: UiButton; off: { visible: boolean }; label: Text }>>(view, 'toggles');
    expect(t.sound.off.visible).toBe(false);
    expect(t.music.off.visible).toBe(true);
    expect(t.haptic.button.visible).toBe(false); // hidden like the donor
    expect(t.sound.button.x).toBe(-150);
    expect(t.music.button.x).toBe(150);
    expect(t.sound.label.y).toBe(-185);
    expect(field<Text>(view, 'version').text).toBe('VERSION 0.4.0');
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 402, y: -461 });
    tap(t.sound.button, kit);
    expect(t.sound.off.visible).toBe(true);
    expect(view.state).toBe('shown'); // toggles do not close the window
    tap(t.music.button, kit);
    expect(t.music.off.visible).toBe(false);
    expect(toggles).toEqual(['sound:false', 'music:true']);
    expect(view.currentSettings).toMatchObject({ sound: false, music: true });
    view.setSettings({ sound: true });
    expect(t.sound.off.visible).toBe(false);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('shows HOME / RESTART only on request and runs them as continuations', () => {
    const kit = createKit();
    const done: string[] = [];
    const view = new SettingsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onToggle: () => {}, onHome: () => done.push('home'), onRestart: () => done.push('restart') });
    view.show({ sound: true, music: true });
    advance(kit.core, 400);
    expect(field<UiButton>(view, 'homeButton').visible).toBe(false);
    view.close('programmatic');
    advance(kit.core, 200);
    view.show({ sound: true, music: true, gameButtons: true });
    advance(kit.core, 400);
    expect(field<UiButton>(view, 'homeButton').visible).toBe(true);
    expect(field<UiButton>(view, 'restartButton').position).toMatchObject({ x: 0, y: 250 });
    tap(field<UiButton>(view, 'restartButton'), kit);
    expect(done).toEqual([]);
    advance(kit.core, 200);
    expect(done).toEqual(['restart']);
    view.destroy();
  });
});

describe('NoAdsWindowView / StarterPackWindowView', () => {
  it('No Ads shows the price on the button and buys through a continuation', () => {
    const kit = createKit();
    const bought: string[] = [];
    const view = new NoAdsWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: (p) => bought.push(p.price) });
    view.show({ price: '$1.99' });
    advance(kit.core, 400);
    const buy = field<UiButton>(view, 'buyButton');
    expect(buy.labelText?.text).toBe('$1.99');
    expect(buy.y).toBe(517);
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 415, y: -607 });
    tap(buy, kit);
    advance(kit.core, 200);
    expect(bought).toEqual(['$1.99']);
    expect(view.state).toBe('hidden');
    view.destroy();
  });

  it('Starter Pack renders configurable rewards and buys through a continuation', () => {
    const kit = createKit();
    const bought: number[] = [];
    const view = new StarterPackWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: (p) => bought.push(p.rewards.coins) });
    view.show({ price: '$0.99', rewards: { coins: 3500, infiniteLives: '1h', boosters: 'x3' } });
    advance(kit.core, 400);
    expect(field<Text>(view, 'coinsText').text).toBe('3 500');
    expect(field<Text>(view, 'livesText').text).toBe('1h');
    expect(field<Container>(view, 'boosterBar').visible).toBe(true);
    expect(field<UiButton>(view, 'buyButton').labelText?.text).toBe('$0.99');
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 410, y: -587 });
    view.close('programmatic');
    advance(kit.core, 200);
    view.show({ price: '$0.99', rewards: { coins: 500 } });
    advance(kit.core, 400);
    expect(field<Container>(view, 'boosterBar').visible).toBe(false);
    expect(field<Text>(view, 'coinsText').x).toBe(0);
    tap(field<UiButton>(view, 'buyButton'), kit);
    advance(kit.core, 200);
    expect(bought).toEqual([500]);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
    expect(kit.uiErrors).toEqual([]);
  });

  it('Starter Pack setTimer shows the countdown under the rotated header (donor layoutTimer) and hides it when empty', () => {
    const kit = createKit();
    const view = new StarterPackWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: () => {} });
    const timer = field<Text>(view, 'timerText');
    const title = field<Text>(view, 'title');
    expect(timer.visible).toBe(false);
    view.show({ price: '$0.99', rewards: { coins: 3500 } });
    expect(timer.visible).toBe(false);
    view.setTimer('11:59:58');
    expect(timer.visible).toBe(true);
    expect(timer.text).toBe('11:59:58');
    expect(timer.rotation).toBeCloseTo(title.rotation, 6);
    const d = title.height / 2 + 40;
    expect(timer.x).toBeCloseTo(title.x - d * Math.sin(title.rotation), 4);
    expect(timer.y).toBeCloseTo(title.y + d * Math.cos(title.rotation), 4);
    expect(timer.y).toBeGreaterThan(title.y); // below the header, along its tilt
    view.setTimer('');
    expect(timer.visible).toBe(false);
    // a long tier title shrinks to the donor's 430-unit cap and the timer follows the smaller header
    view.close('programmatic');
    advance(kit.core, 200);
    view.show({ price: '$39.99', title: 'LEGENDARY\nPACK', rewards: { coins: 130000, infiniteLives: '7d', boosters: 'x30' } });
    expect(title.width).toBeLessThanOrEqual(430 + 1e-6);
    view.setTimer('23:59:59');
    expect(timer.y).toBeCloseTo(title.y + (title.height / 2 + 40) * Math.cos(title.rotation), 4);
    view.destroy();
    expect(kit.uiErrors).toEqual([]);
  });

  it('Starter Pack setBuyEnabled(false) blocks BUY taps (purchase in flight, alpha 0.85) until re-enabled', () => {
    const kit = createKit();
    const bought: string[] = [];
    const view = new StarterPackWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: (p) => bought.push(p.price) });
    view.show({ price: '$2.99', rewards: { coins: 5000, boosters: 'x3' } });
    advance(kit.core, 400);
    const buy = field<UiButton>(view, 'buyButton');
    expect(view.buyEnabled).toBe(true);
    view.setBuyEnabled(false);
    expect(view.buyEnabled).toBe(false);
    expect(buy.alpha).toBe(0.85);
    tap(buy, kit);
    advance(kit.core, 200);
    expect(bought).toEqual([]);
    expect(view.state).toBe('shown');
    view.setBuyEnabled(true);
    expect(buy.alpha).toBe(1);
    tap(buy, kit);
    advance(kit.core, 200);
    expect(bought).toEqual(['$2.99']);
    expect(view.state).toBe('hidden');
    view.destroy();
    expect(kit.uiErrors).toEqual([]);
  });
});

describe('ConfirmWindowView default variant (donor ConfirmWindow: exit with a life lost) — unchanged', () => {
  function create(kit: ReturnType<typeof createKit>, log: string[]): ConfirmWindowView {
    return new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'exit-confirm',
      title: 'ВЫ УВЕРЕНЫ?', body: 'Вы потеряете 1 жизнь', confirmLabel: 'ВЫХОД',
      onConfirm: () => log.push('confirm'), onDismiss: (reason) => log.push(`cancel:${reason}`) });
  }

  it('renders the donor structure: baked broken-heart panel 968 × 1006, header / body / one button / × at donor coordinates', () => {
    const kit = createKit();
    const view = create(kit, []);
    view.show();
    advance(kit.core, 400);
    expect(view.state).toBe('shown');
    const panel = field<Container>(view, 'panel');
    const art = panel.children[0] as unknown as { texture: unknown; width: number; height: number };
    expect(art.texture).toBe(kit.textures.confirmPanel);
    expect([art.width, art.height]).toEqual([968, 1006]);
    expect(field<Text>(view, 'title').text).toBe('ВЫ УВЕРЕНЫ?');
    expect(field<Text>(view, 'title').position).toMatchObject({ x: 6, y: -417 });
    expect(field<Text>(view, 'body').text).toBe('Вы потеряете 1 жизнь');
    expect(field<Text>(view, 'body').position).toMatchObject({ x: 16, y: 157 });
    const button = field<UiButton>(view, 'confirmButton');
    expect(button.labelText?.text).toBe('ВЫХОД');
    expect(button.background.texture).toBe(kit.textures.confirmButton);
    expect([button.background.width, button.background.height, button.y]).toEqual([600, 206, 334]);
    expect(field<UiButton>(view, 'closeButton').position).toMatchObject({ x: 418, y: -413 });
    expect(view.variant).toBe('donor');
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('the button runs onConfirm after the close; the × and the backdrop cancel (onDismiss), never onConfirm', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    view.show();
    advance(kit.core, 400);
    tap(field<UiButton>(view, 'confirmButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm']);
    expect(view.state).toBe('hidden');

    view.show();
    advance(kit.core, 400);
    tap(field<UiButton>(view, 'closeButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm', 'cancel:button']);

    view.show();
    advance(kit.core, 400);
    const backdrop = field<Container>(view, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm', 'cancel:button', 'cancel:background']);
    expect(view.state).toBe('hidden');
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('390 × 844: the donor fit (0.92 of the width) — the whole panel on screen, centred', () => {
    const kit = createKit();
    const view = create(kit, []);
    view.resize(390, 844);
    view.show();
    advance(kit.core, 400);
    const box = field<Container>(view, 'panel').getBounds();
    expect(box.width).toBeCloseTo(390 * 0.92, 0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.x + box.width / 2).toBeCloseTo(195, 0);
    expect(box.y + box.height / 2).toBeCloseTo(422, 0);
    view.destroy();
  });

  it('needs only the required pack: no Figma texture in the record, same build', () => {
    const kit = createKit();
    const required = { ...kit.textures };
    for (const name of CONFIRM_EXIT_FIGMA_TEXTURES) delete required[name];
    const view = new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: required, onConfirm: () => {} });
    expect(view.variant).toBe('donor');
    expect(field<Container>(view, 'panel').children.length).toBe(5); // art, title, body, button, ×
    view.destroy();
  });
});

describe("ConfirmWindowView variant 'figma' (Figma screen/confirm-exit 820:77655, docs/figma/confirm-exit)", () => {
  // Figma screen units → panel units: the panel origin is the window box centre, screen (540, 1172)
  const X = (screenX: number) => screenX - 540;
  const Y = (screenY: number) => screenY - 1172;
  // tests/pixi/setup.ts fakes the font: advance 0.56 em per char, line box ascent 0.9 em + descent 0.25 em
  const baseline = (boxY: number, boxH: number, size: number) => Y(boxY) + (boxH - 1.15 * size) / 2 + 0.9 * size;

  function create(kit: ReturnType<typeof createKit>, log: string[], textures = kit.textures): ConfirmWindowView {
    return new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures, id: 'exit-confirm', variant: 'figma',
      title: 'ВЫ УВЕРЕНЫ?', body: 'Вы потеряете 1 жизнь', confirmLabel: 'ВЫХОД',
      onConfirm: () => log.push('confirm'), onDismiss: (reason) => log.push(`cancel:${reason}`) });
  }

  /** The glyph run of a Figma label: [left, right] and its baseline, in the label's parent units. */
  function run(label: Text): { left: number; right: number; baseline: number } {
    const b = label.getLocalBounds(); // Pixi bounds = 4 stroke + run + 4 stroke + 4 shadow wide; baseline 4 + glyph ascent below the top
    const glyphAscent = CanvasTextMetrics.measureText(label.text, label.style).fontProperties.ascent;
    return { left: label.x + (b.x + 4) * label.scale.x, right: label.x + (b.x + b.width - 8) * label.scale.x, baseline: label.y + (b.y + 4 + glyphAscent) * label.scale.y };
  }

  it('builds the Figma layers bottom → top: 9-slice shell, title, ×, glow, 9-slice button, body, heart, runtime "-1"', () => {
    const kit = createKit();
    const view = create(kit, []);
    view.show();
    advance(kit.core, 400);
    const panel = field<Container>(view, 'panel');
    const names = ['surface', 'title', 'closeButton', 'glow', 'confirmButton', 'body', 'heart', 'lifeDelta'];
    expect(panel.children.map((child) => names.find((n) => field(view, n) === child))).toEqual(names);

    // ui/window/base 960 × 994 at screen (60, 675) + the 4 / 4 / 4 / 8 stroke-and-shadow bleed, as a 9-slice
    const surface = field<NineSliceSprite>(view, 'surface');
    expect(surface).toBeInstanceOf(NineSliceSprite);
    expect(surface.texture).toBe(kit.textures.windowBase);
    expect([surface.leftWidth, surface.topHeight, surface.rightWidth, surface.bottomHeight]).toEqual([92, 187, 92, 110]);
    const s = surface.getLocalBounds();
    expect([s.x, s.y, s.width, s.height]).toEqual([X(56), Y(671), 968, 1006]);

    // sprites at their Figma SVG export boxes (render bounds)
    const glow = field<Sprite>(view, 'glow');
    expect(glow.texture).toBe(kit.textures.messageGlow);
    [glow.x, glow.y, glow.width, glow.height].forEach((v, i) => expect(v).toBeCloseTo([X(89.3), Y(680.3), 902, 806][i]!, 6));
    const heart = field<Sprite>(view, 'heart');
    expect(heart.texture).toBe(kit.textures.brokenHeart);
    [heart.x, heart.y, heart.width, heart.height].forEach((v, i) => expect(v).toBeCloseTo([X(377.001), Y(939), 326, 298][i]!, 6));
    const close = field<UiButton>(view, 'closeButton');
    expect(close.background.texture).toBe(kit.textures.windowClose);
    expect([close.x, close.y, close.background.width, close.background.height]).toEqual([X(923 + 25.5), Y(736 + 25.5), 51, 51]);

    // ui/button/base 600 × 206 at (240, 1400): the green surface as a 9-slice, the label a runtime child
    const button = field<UiButton>(view, 'confirmButton');
    expect([button.x, button.y]).toEqual([X(540), Y(1503)]);
    expect(button.background).toBeInstanceOf(NineSliceSprite);
    expect(button.background.texture).toBe(kit.textures.buttonGreen);
    expect([button.background.width, button.background.height]).toEqual([600, 206]);
    const label = field<Text>(view, 'confirmLabel');
    expect(label.parent).toBe(button);
    expect(label.text).toBe('ВЫХОД');

    // runtime text in the Figma slots: centred / left runs, the font's line box centred in the slot
    const within = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);
    const title = run(field<Text>(view, 'title'));
    within((title.left + title.right) / 2, X(195 + 345));
    within(title.baseline, baseline(709, 104, 80));
    const body = run(field<Text>(view, 'body'));
    expect(field<Text>(view, 'body').text).toBe('Вы потеряете 1 жизнь');
    within((body.left + body.right) / 2, X(123 + 417));
    within(body.baseline, baseline(1261, 113, 50));
    const delta = run(field<Text>(view, 'lifeDelta'));
    expect(field<Text>(view, 'lifeDelta').text).toBe('-1');
    within(delta.left, X(603));
    within(delta.baseline, baseline(1020, 180, 150));
    const labelRun = run(label); // button-local: the @content slot (25, 27, 550 × 128) around the button centre
    within((labelRun.left + labelRun.right) / 2, 0);
    within(labelRun.baseline, 27 - 103 + (128 - 1.15 * 80) / 2 + 0.9 * 80);

    // decoration never takes input (the glow lies over the ×), the controls do
    for (const name of ['surface', 'title', 'glow', 'body', 'heart', 'lifeDelta']) expect(field<Container>(view, name).eventMode, name).toBe('none');
    expect(close.eventMode).toBe('static');
    expect(button.eventMode).toBe('static');
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('keeps runtime text inside its slot: a long label shrinks around its anchor, never past the Figma width', () => {
    const kit = createKit();
    const view = new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, variant: 'figma', onConfirm: () => {},
      title: 'SIND SIE WIRKLICH GANZ SICHER?', confirmLabel: 'SPIEL VERLASSEN UND ZURÜCK', lifeDelta: '-2' });
    const title = run(field<Text>(view, 'title'));
    within2(title.right - title.left, 690);
    within2((title.left + title.right) / 2, X(540));
    const label = run(field<Text>(view, 'confirmLabel'));
    within2(label.right - label.left, 550);
    expect(field<Text>(view, 'lifeDelta').text).toBe('-2');
    expect(run(field<Text>(view, 'lifeDelta')).left).toBeCloseTo(X(603), 6);
    view.destroy();
    function within2(actual: number, expected: number) { expect(actual).toBeCloseTo(expected, 6); }
  });

  it('defaults to the Figma copy and the Figma dim (#080b0d at 0.8)', () => {
    const kit = createKit();
    const view = new ConfirmWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, variant: 'figma', onConfirm: () => {} });
    expect([field<Text>(view, 'title').text, field<Text>(view, 'body').text, field<Text>(view, 'confirmLabel').text, field<Text>(view, 'lifeDelta').text])
      .toEqual(['ARE YOU SURE?', 'YOU WILL LOSE 1 HEART', 'EXIT', '-1']);
    expect([field<number>(view, 'backdropColor'), field<number>(view, 'backdropAlpha')]).toEqual([0x080b0d, 0.8]);
    view.destroy();
  });

  it('the button runs onConfirm after the close; the × and the backdrop cancel (onDismiss), never onConfirm', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = create(kit, log);
    view.show();
    advance(kit.core, 400);
    tap(field<UiButton>(view, 'confirmButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm']);
    expect(view.state).toBe('hidden');

    view.show();
    advance(kit.core, 400);
    tap(field<UiButton>(view, 'closeButton'), kit);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm', 'cancel:button']);

    view.show();
    advance(kit.core, 400);
    const backdrop = field<Container>(view, 'backdrop');
    backdrop.emit('pointertap', { target: backdrop } as never);
    advance(kit.core, 300);
    expect(log).toEqual(['confirm', 'cancel:button', 'cancel:background']);
    expect(view.state).toBe('hidden');
    expect(kit.uiErrors).toEqual([]);
    view.destroy();
  });

  it('fits like the Figma frame: the 960 × 994 window keeps its share of 1080 × 2344, contain-fitted and centred', () => {
    for (const [w, h] of [[390, 844], [1280, 800], [1080, 2344]] as const) {
      const kit = createKit();
      const view = create(kit, []);
      view.resize(w, h);
      view.show();
      advance(kit.core, 400);
      const k = Math.min(w / 1080, h / 2344);
      const shell = field<NineSliceSprite>(view, 'surface').getBounds(); // the box plus its 4 / 4 / 4 / 8 bleed
      expect(shell.width, `${w}×${h}`).toBeCloseTo(968 * k, 6);
      expect(shell.height, `${w}×${h}`).toBeCloseTo(1006 * k, 6);
      expect(shell.x + 4 * k, `${w}×${h}`).toBeCloseTo((w - 960 * k) / 2, 6);
      expect(shell.y + 4 * k, `${w}×${h}`).toBeCloseTo((h - 994 * k) / 2, 6);
      view.destroy();
    }
  });

  it('requested without its art (not in `include`): a clear error before anything registers', () => {
    const kit = createKit();
    const { windowBase: _drop, ...textures } = kit.textures;
    expect(() => create(kit, [], textures)).toThrow(/variant 'figma': no windowBase \(window\/window_base@2x\.webp\).*include: CONFIRM_EXIT_FIGMA_TEXTURES/);
    expect(kit.ui.getStats().windows).toBe(0);
    expect(kit.ui.getStats().buttons).toBe(0);
  });
});
