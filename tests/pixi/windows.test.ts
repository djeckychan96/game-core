import { describe, expect, it } from 'vitest';
import { advance, createKit, pointer } from './setup';
import { ResultWindowView, type ResultWindowParams } from '../../src/pixi/ResultWindowView';
import { LivesWindowView } from '../../src/pixi/LivesWindowView';
import { ShopWindowView, type ShopItem } from '../../src/pixi/ShopWindowView';
import type { UiButton } from '../../src/pixi/UiButton';

function button(view: object, field: string): UiButton {
  const value = (view as Record<string, unknown>)[field];
  if (!value) throw new Error(`no button ${field}`);
  return value as UiButton;
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

  it('NEXT / RETRY are close continuations: they run once, after hidden, never on cancel', () => {
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
    tap(button(view, 'nextButton'), kit);
    expect(view.state).toBe('leaving');
    expect(next).toEqual([]); // not before the leave finished
    advance(kit.core, 200);
    expect(view.state).toBe('hidden');
    expect(next).toEqual([19]);
    expect(hidden).toEqual(['button']);
    expect(kit.ui.isBlocking()).toBe(false);

    view.show({ ...RESULT, level: 20 });
    advance(kit.core, 500);
    tap(button(view, 'retryButton'), kit);
    advance(kit.core, 200);
    expect(retry).toEqual([20]);

    // cancelAll mid-entrance: view cleanup only
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

  it('hides the retry button on demand and closes from the × / backdrop with onDismiss', () => {
    const kit = createKit();
    const dismissed: string[] = [];
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {}, onDismiss: (reason) => dismissed.push(reason) });
    view.show({ ...RESULT, retry: false });
    advance(kit.core, 500);
    expect(button(view, 'retryButton').visible).toBe(false);
    expect(button(view, 'nextButton').x).toBe(0);
    const close = (view as unknown as { closeButton: UiButton }).closeButton;
    tap(close, kit);
    advance(kit.core, 200);
    expect(dismissed).toEqual(['button']);
    view.show(RESULT);
    advance(kit.core, 500);
    expect(view.close('background')).toBe(true);
    advance(kit.core, 200);
    expect(dismissed).toEqual(['button', 'background']);
    view.destroy();
  });

  it('fits the panel into the viewport insets on resize', () => {
    const kit = createKit();
    const view = new ResultWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onNext: () => {} });
    view.show(RESULT);
    advance(kit.core, 500);
    view.resize(320, 568, { insets: { top: 20, bottom: 20 } });
    const panel = (view as unknown as { panel: { scale: { x: number }; x: number } }).panel;
    expect(panel.scale.x * 1040).toBeLessThanOrEqual(320 * 0.9 + 0.01);
    expect(panel.x).toBeCloseTo(160, 1);
    view.resize(1280, 800);
    expect(panel.scale.x * 900).toBeLessThanOrEqual(800 * 0.82 + 0.01);
    view.destroy();
  });
});

describe('LivesWindowView', () => {
  it('shows lives / timer and runs refill or ad continuations after close', () => {
    const kit = createKit();
    const refills: number[] = [];
    const ads: number[] = [];
    const view = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onRefill: (p) => refills.push(p.lives), onWatchAd: (p) => ads.push(p.lives) });
    view.show({ lives: 3, maxLives: 5, timerText: '17:42', refillPrice: 900 });
    advance(kit.core, 500);
    const texts = view as unknown as { countText: { text: string }; timerText: { text: string }; priceText: { text: string } };
    expect(texts.countText.text).toBe('3/5');
    expect(texts.timerText.text).toBe('17:42');
    expect(texts.priceText.text).toBe('900');
    view.setTimer('17:41');
    expect(texts.timerText.text).toBe('17:41');
    tap(button(view, 'refillButton'), kit);
    advance(kit.core, 200);
    expect(refills).toEqual([3]);
    expect(view.state).toBe('hidden');

    view.show({ lives: 5, maxLives: 5, refillPrice: 900 });
    advance(kit.core, 500);
    expect(texts.timerText.text).toBe('FULL');
    expect(button(view, 'refillButton').enabled).toBe(false);
    tap(button(view, 'adButton'), kit);
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

  it('lays out the packs, hides unused cards and buys through a close continuation', () => {
    const kit = createKit();
    const bought: string[] = [];
    const view = new ShopWindowView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onBuy: (item) => bought.push(item.id) });
    view.show({ items });
    advance(kit.core, 500);
    const cards = (view as unknown as { cards: Array<{ root: { visible: boolean }; amount: { text: string }; button: UiButton }> }).cards;
    expect(cards.filter((c) => c.root.visible).length).toBe(4);
    expect(cards[1]?.amount.text).toBe('3 500');
    expect(cards[5]?.button.enabled).toBe(false);
    tap(cards[1]!.button, kit);
    expect(bought).toEqual([]);
    advance(kit.core, 200);
    expect(bought).toEqual(['b']);
    expect(view.state).toBe('hidden');
    // a hidden card's button never buys
    view.show({ items: items.slice(0, 1) });
    advance(kit.core, 500);
    tap(cards[3]!.button, kit);
    advance(kit.core, 200);
    expect(bought).toEqual(['b']);
    expect(view.state).toBe('shown');
    view.destroy();
    expect(kit.ui.getStats().windows).toBe(0);
  });
});
