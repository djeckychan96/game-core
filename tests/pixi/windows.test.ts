import { describe, expect, it } from 'vitest';
import { advance, createKit, pointer } from './setup';
import { ResultWindowView, type ResultWindowParams } from '../../src/pixi/ResultWindowView';
import { LivesWindowView } from '../../src/pixi/LivesWindowView';
import { ShopWindowView, type ShopItem } from '../../src/pixi/ShopWindowView';
import { SettingsWindowView } from '../../src/pixi/SettingsWindowView';
import { NoAdsWindowView } from '../../src/pixi/NoAdsWindowView';
import { StarterPackWindowView } from '../../src/pixi/StarterPackWindowView';
import type { UiButton } from '../../src/pixi/UiButton';
import type { Container, Rectangle, Text } from 'pixi.js';

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
    // earned stars pop in through MotionRuntime after the entrance
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
    expect(field<Text>(view, 'rewardAmount').y).toBe(101);
    view.close('background');
    advance(kit.core, 200);
    expect(dismissed).toEqual(['background']);
    view.show({ ...RESULT, retry: false });
    advance(kit.core, 500);
    expect(field<UiButton>(view, 'retryButton').visible).toBe(false);
    expect(field<UiButton>(view, 'nextButton').x).toBe(0);
    view.destroy();
  });

  it('fits its measured bounds into 0.88 × 0.84 of the safe area, origin at the center', () => {
    const kit = createKit();
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {} });
    view.show(RESULT);
    advance(kit.core, 500);
    view.resize(320, 568, { insets: { top: 20, bottom: 20 } });
    const panel = field<Container>(view, 'panel');
    const bounds = panel.getLocalBounds();
    expect(panel.scale.x * bounds.width).toBeLessThanOrEqual(320 * 0.88 + 0.01);
    expect(panel.scale.x * bounds.height).toBeLessThanOrEqual(528 * 0.84 + 0.01);
    expect(panel.x).toBeCloseTo(160, 1);
    expect(panel.y).toBeCloseTo(20 + 528 / 2, 1);
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
