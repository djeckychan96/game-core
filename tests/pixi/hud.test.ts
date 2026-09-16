import { describe, expect, it } from 'vitest';
import { advance, createKit, pointer } from './setup';
import { HudView } from '../../src/pixi/HudView';
import type { UiButton } from '../../src/pixi/UiButton';

function badgeButton(hud: HudView, which: 'lives' | 'coins'): UiButton {
  const badge = (hud as unknown as Record<string, { button: UiButton | null }>)[which];
  if (!badge?.button) throw new Error(`${which} badge has no button`);
  return badge.button;
}

describe('HudView', () => {
  it('shows coins, lives and the refill timer; full lives read MAX and hide the plus', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, coins: 12450, lives: 3, maxLives: 5, onCoinsTap: () => {}, onLivesTap: () => {} });
    const lives = (hud as unknown as { lives: { countText: { text: string }; capsuleText: { text: string }; plus: { visible: boolean } } }).lives;
    const coins = (hud as unknown as { coins: { countText: { text: string } } }).coins;
    expect(coins.countText.text).toBe('12 450');
    expect(lives.countText.text).toBe('3');
    hud.setLives(3, '17:42');
    expect(lives.capsuleText.text).toBe('17:42');
    expect(lives.plus.visible).toBe(true);
    hud.setLives(5);
    expect(lives.capsuleText.text).toBe('MAX');
    expect(lives.plus.visible).toBe(false);
    hud.setLivesTimer('00:10');
    expect(lives.capsuleText.text).toBe('MAX'); // still full
    hud.setLives(4, '00:10');
    expect(lives.capsuleText.text).toBe('00:10');
    hud.setCoins(80);
    expect(coins.countText.text).toBe('80');
    expect(hud.coinsAmount).toBe(80);
    expect(hud.livesAmount).toBe(4);
    hud.destroy();
  });

  it('routes settled taps to the host callbacks through ButtonControllers', () => {
    const kit = createKit();
    let coinsTaps = 0;
    let livesTaps = 0;
    let settingsTaps = 0;
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, onCoinsTap: () => coinsTaps++, onLivesTap: () => livesTaps++, onSettingsTap: () => settingsTaps++ });
    expect(kit.ui.getStats().buttons).toBe(3);
    const coins = badgeButton(hud, 'coins');
    coins.emit('pointerdown', pointer(10, 10) as never);
    advance(kit.core, 80);
    expect(coins.scale.x).toBeLessThan(1);
    coins.emit('pointerup', pointer(10, 10) as never);
    advance(kit.core, 200);
    expect(coinsTaps).toBe(1);
    expect(coins.scale.x).toBeCloseTo(1, 5);
    // swipe on the lives badge is not a tap
    const lives = badgeButton(hud, 'lives');
    lives.emit('pointerdown', pointer(0, 0) as never);
    lives.emit('pointermove', pointer(60, 0) as never);
    lives.emit('pointerup', pointer(60, 0) as never);
    advance(kit.core, 200);
    expect(livesTaps).toBe(0);
    expect(settingsTaps).toBe(0);
    expect(kit.uiErrors).toEqual([]);
    hud.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('shows a stars badge on request and pulses it on change', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, stars: 41, onCoinsTap: () => {}, onLivesTap: () => {} });
    const stars = (hud as unknown as { stars: { countText: { text: string }; plus: unknown; x: number } | null }).stars;
    expect(stars).not.toBeNull();
    expect(stars?.countText.text).toBe('41');
    expect(stars?.plus).toBeNull(); // not tappable, no "+"
    expect(stars?.x).toBe(580);
    expect(hud.starAnchor).not.toBeNull();
    hud.setStars(44);
    expect(hud.starsAmount).toBe(44);
    expect(kit.motion.getStats().activeMotions).toBe(1);
    advance(kit.core, 400);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    const bare = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, id: 'hud2' });
    expect(bare.starAnchor).toBeNull();
    bare.destroy();
    hud.destroy();
  });

  it('lays out along the top safe edge and never wider than the viewport', () => {
    const kit = createKit();
    // shadow: false — the soft top shadow deliberately bleeds past the viewport edges
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, shadow: false, onCoinsTap: () => {}, onLivesTap: () => {}, onSettingsTap: () => {} });
    hud.resize(390, 844, { insets: { top: 47 }, pixelRatio: 2 });
    const phoneHeight = hud.barHeight;
    expect(phoneHeight).toBeGreaterThan(47);
    expect(phoneHeight).toBeLessThan(200);
    // donor: the heart icon's left edge sits 60 design units from the edge, its top 83 from the top
    const s = Math.min(390 / 1080, 844 / 2344);
    const row = (hud as unknown as { row: { x: number; y: number; scale: { x: number }; getLocalBounds(): { x: number; y: number } } }).row;
    const rowBounds = row.getLocalBounds();
    expect(row.x + rowBounds.x * row.scale.x).toBeCloseTo(60 * s, 1);
    expect(row.y + rowBounds.y * row.scale.x).toBeCloseTo(47 + 83 * s, 1);
    const bounds = hud.getLocalBounds();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390 + 1);
    hud.resize(320, 568);
    const narrow = hud.getLocalBounds();
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(320 + 1);
    expect(hud.barHeight).toBeLessThan(phoneHeight);
    hud.resize(Number.NaN, 0);
    expect(Number.isFinite(hud.barHeight)).toBe(true);
    hud.destroy();
  });
});
