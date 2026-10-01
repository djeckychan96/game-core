import { describe, expect, it } from 'vitest';
import { Sprite, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer } from './setup';
import { HudView } from '../../src/pixi/HudView';
import type { ReadyUiTextures } from '../../src/pixi/assets';
import type { ReadyUiSkinRole, ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import type { UiButton } from '../../src/pixi/UiButton';

function badgeButton(hud: HudView, which: 'lives' | 'coins'): UiButton {
  const badge = (hud as unknown as Record<string, { button: UiButton | null }>)[which];
  if (!badge?.button) throw new Error(`${which} badge has no button`);
  return badge.button;
}

const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

function style1Textures(textures: ReadyUiTextures): ReadyUiTextures {
  const roles = {} as ReadyUiSkinTextures & Record<string, Texture>;
  for (const role of Object.keys(READY_UI_STYLE_1.assets) as ReadyUiSkinRole[]) roles[role] = labelled(`style-1:${role}`);
  for (const role of ['hudCapsule', 'hudHeart', 'hudCoin', 'hudPlus', 'hudGear', 'hudGearBack', 'hudStar']) {
    roles[role] ??= labelled(`style-1:${role}`);
  }
  return { ...textures, skins: { [READY_UI_STYLE_1.id]: roles } };
}

function spriteTextures(root: { children: readonly unknown[] }): Texture[] {
  const found: Texture[] = [];
  const visit = (node: { children?: readonly unknown[] }): void => {
    if (node instanceof Sprite) found.push(node.texture);
    for (const child of node.children ?? []) visit(child as { children?: readonly unknown[] });
  };
  visit(root);
  return found;
}

describe('HudView', () => {
  it('uses Style 1 HUD roles only when that skin is explicitly selected', () => {
    const kit = createKit();
    const textures = style1Textures(kit.textures);
    const styled = new HudView({
      ui: kit.ui,
      motion: kit.motion,
      textures,
      theme: { skin: READY_UI_STYLE_1 },
      coins: 80,
      lives: 5,
      maxLives: 5,
      stars: 12,
      shadow: false,
      onCoinsTap: () => {},
      onLivesTap: () => {},
      onSettingsTap: () => {}
    });
    const styledSprites = spriteTextures(styled).map((texture) => texture.source.label);
    expect(styledSprites).toEqual(expect.arrayContaining([
      'style-1:hudCapsule',
      'style-1:hudHeart',
      'style-1:hudCoin',
      'style-1:hudPlus',
      'style-1:hudGear',
      'style-1:hudGearBack',
      'style-1:hudStar'
    ]));

    const donorKit = createKit();
    const donor = new HudView({
      ui: donorKit.ui,
      motion: donorKit.motion,
      textures: donorKit.textures,
      coins: 80,
      lives: 5,
      stars: 12,
      shadow: false,
      onCoinsTap: () => {},
      onLivesTap: () => {},
      onSettingsTap: () => {}
    });
    const donorSprites = spriteTextures(donor);
    expect(donorSprites).toEqual(expect.arrayContaining([
      donorKit.textures.hudCapsule,
      donorKit.textures.hudHeart,
      donorKit.textures.hudCoin,
      donorKit.textures.hudPlus,
      donorKit.textures.hudGear,
      donorKit.textures.hudGearBack,
      donorKit.textures.starGold
    ]));
    expect(donorSprites.some((texture) => texture.source.label.startsWith('style-1:'))).toBe(false);
    styled.destroy();
    donor.destroy();
  });

  it('fails clearly when explicit Style 1 HUD textures were not loaded completely', () => {
    const kit = createKit();
    const textures = style1Textures(kit.textures);
    delete (textures.skins?.[READY_UI_STYLE_1.id] as Record<string, Texture>).hudCoin;
    expect(() => new HudView({ ui: kit.ui, motion: kit.motion, textures, theme: { skin: READY_UI_STYLE_1 } }))
      .toThrow("HudView style 'style-1': no hudCoin (hud/coin.webp) in textures — load them with loadReadyUiAssets({ skin })");
    expect(kit.ui.getStats().buttons).toBe(0);
  });

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

  it('overlapping counter pulses never compound: the icon always settles back to its layout scale', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, coins: 0, onCoinsTap: () => {} });
    const coins = (hud as unknown as { coins: { icon: { scale: { x: number } }; iconScale: number } }).coins;
    const base = coins.icon.scale.x;
    expect(base).toBeCloseTo(coins.iconScale, 8);
    // the reward flight: one setCoins per coin, 60 ms apart, each inside the previous 260 ms pulse
    for (let i = 1; i <= 12; i++) {
      hud.setCoins(i);
      advance(kit.core, 60);
      expect(coins.icon.scale.x).toBeLessThanOrEqual(base * 1.22 + 1e-6); // never above ONE pop
    }
    expect(kit.motion.getStats().activeMotions).toBe(1); // one pulse per badge, never a stack
    advance(kit.core, 1000);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    expect(coins.icon.scale.x).toBeCloseTo(base, 8);
    expect(kit.motionErrors).toEqual([]);
    hud.destroy();
  });

  it('a resize during a pulse lays out from the declared badge geometry, not the animated sprite', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, coins: 5, stars: 3, shadow: false, onCoinsTap: () => {}, onSettingsTap: () => {} });
    type Row = { x: number; y: number; scale: { x: number }; getLocalBounds(): { x: number; y: number; width: number; height: number } };
    const row = (hud as unknown as { row: Row }).row;
    const coins = (hud as unknown as { coins: { icon: { scale: { x: number } }; iconScale: number } }).coins;
    hud.resize(390, 844, { insets: { top: 47 }, pixelRatio: 2 });
    const idle = { x: row.x, y: row.y, scale: row.scale.x, bar: hud.barHeight, bounds: { ...row.getLocalBounds() } };
    hud.setCoins(500); // pulse in flight
    advance(kit.core, 30);
    expect(coins.icon.scale.x).toBeGreaterThan(coins.iconScale * 1.05);
    hud.resize(390, 844, { insets: { top: 47 }, pixelRatio: 2 });
    expect(row.getLocalBounds()).toEqual(idle.bounds); // the transient scale is invisible to the layout
    expect(row.x).toBeCloseTo(idle.x, 6);
    expect(row.y).toBeCloseTo(idle.y, 6);
    expect(row.scale.x).toBeCloseTo(idle.scale, 8);
    expect(hud.barHeight).toBeCloseTo(idle.bar, 6);
    advance(kit.core, 400);
    expect(coins.icon.scale.x).toBeCloseTo(coins.iconScale, 8);
    // a press on the coin badge (0.94×) is transient too
    badgeButton(hud, 'coins').emit('pointerdown', pointer(10, 10) as never);
    advance(kit.core, 80);
    hud.resize(390, 844, { insets: { top: 47 }, pixelRatio: 2 });
    expect(row.getLocalBounds()).toEqual(idle.bounds);
    expect(hud.barHeight).toBeCloseTo(idle.bar, 6);
    hud.destroy();
  });

  it('stars omitted (a game without a star balance): no star badge, lives + coins keep the row, nothing overlaps the gear', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, coins: 80, lives: 5, maxLives: 5, shadow: false, onCoinsTap: () => {}, onLivesTap: () => {}, onSettingsTap: () => {} });
    const parts = hud as unknown as { stars: unknown; row: { children: unknown[]; x: number; getBounds(): { x: number; y: number; width: number; height: number } }; coins: { x: number }; gear: { getBounds(): { x: number } } };
    expect(parts.stars).toBeNull();
    expect(hud.starAnchor).toBeNull();
    expect(parts.row.children.length).toBe(2); // lives + coins only: no empty third slot
    expect(parts.coins.x).toBe(290);
    hud.setStars(12); // harmless no-op for the view
    expect(parts.row.children.length).toBe(2);
    for (const [w, h] of [[390, 844], [1280, 720]]) {
      hud.resize(w, h, { insets: { top: 47 } });
      const row = parts.row.getBounds();
      expect(row.x).toBeGreaterThan(0);
      expect(row.x + row.width).toBeLessThan(parts.gear.getBounds().x);
      expect(hud.barHeight).toBeGreaterThan(row.y + row.height);
    }
    hud.destroy();
  });

  it('barHeight is the bottom edge of the badge row plus the donor margin (what a map / board must reserve)', () => {
    const kit = createKit();
    const hud = new HudView({ ui: kit.ui, motion: kit.motion, textures: kit.textures, shadow: false, onCoinsTap: () => {}, onLivesTap: () => {} });
    hud.resize(390, 844, { insets: { top: 47 } });
    const s = Math.min(390 / 1080, 844 / 2344);
    const row = (hud as unknown as { row: { getBounds(): { y: number; height: number } } }).row;
    const rowBottom = row.getBounds().y + row.getBounds().height;
    expect(hud.barHeight).toBeCloseTo(rowBottom + 12 * s, 3);
    expect(hud.barHeight).toBeGreaterThan(rowBottom); // was: the badge CENTRES + 12 units (half a badge short)
    hud.destroy();
  });
});
