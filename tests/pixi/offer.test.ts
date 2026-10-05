import { describe, expect, it } from 'vitest';
import { Container, NineSliceSprite, type Sprite, type Text, Texture, TextureSource } from 'pixi.js';
import { advance, createKit, pointer } from './setup';
import { ConfirmWindowView, type ConfirmWindowViewOptions } from '../../src/pixi/ConfirmWindowView';
import { LivesWindowView, type LivesWindowParams, type LivesWindowViewOptions } from '../../src/pixi/LivesWindowView';
import type { OfferPanel, ReadyUiOffer } from '../../src/pixi/OfferPanel';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { requiredSkinRoles, type ReadyUiSkin, type ReadyUiSkinRole, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1, STYLE_1_INCLUDE_NAMES } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import { formatAmount } from '../../src/pixi/text';
import type { UiButton } from '../../src/pixi/UiButton';

// theme_light_4 OFFER (Style 1: 22:28069 under Lives 22:27562, 22:28122 under Restart 22:28101): a 960 × 640 panel
// 50 under the window; window + panel are one composition centred on the frame. Data only; the purchase is the host's.
type Kit = ReturnType<typeof createKit>;
const S1 = READY_UI_STYLE_1;
const O = S1.windows.offer;
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });
const booster = (label: string): Texture => new Texture({ source: new TextureSource({ width: 4, height: 2, label }) });

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

function tap(target: UiButton, kit: Kit): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
}

function requiredOnly(kit: Kit): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  return required;
}

function roles(skin: ReadyUiSkin): ReadyUiSkinTextures {
  const out: ReadyUiSkinTextures = {};
  for (const role of Object.keys(skin.assets) as ReadyUiSkinRole[]) out[role] = labelled(`${skin.id}:${role}`);
  return out;
}

const styled = (kit: Kit, art = roles(S1), skin: ReadyUiSkin = S1): ReadyUiTextures => ({ ...requiredOnly(kit), skins: { [skin.id]: art } });

const LIVES: LivesWindowParams = { lives: 1, maxLives: 5, timerText: '24:15', refillPrice: 900 };
const lamp = booster('lamp');
const wand = booster('wand');
const OFFER: ReadyUiOffer = { icon: 'offerLivesArt', iconLabel: '35d', items: [{ icon: lamp, label: '5' }, { icon: wand, label: '10' }], price: 900, badge: 'x3' };

function lives(kit: Kit, textures: ReadyUiTextures, log: string[], extra: Partial<LivesWindowViewOptions> = {}): LivesWindowView {
  return new LivesWindowView({
    ui: kit.ui, motion: kit.motion, textures, theme: { skin: S1 }, id: 'lives',
    onRefill: (p) => log.push(`refill:${p.refillPrice}`), onWatchAd: () => log.push('ad'), onOffer: (p) => log.push(`offer:${p.offer?.price}`),
    onDismiss: (r) => log.push(`dismiss:${r}`), ...extra
  });
}

function confirm(kit: Kit, textures: ReadyUiTextures, log: string[], extra: Partial<ConfirmWindowViewOptions> = {}): ConfirmWindowView {
  return new ConfirmWindowView({
    ui: kit.ui, motion: kit.motion, textures, theme: { skin: S1 }, id: 'restart', action: 'restart',
    onConfirm: () => log.push('confirm'), onOffer: (offer) => log.push(`offer:${offer.price}`), onDismiss: (r) => log.push(`dismiss:${r}`), ...extra
  });
}

const panelOf = (view: object): Container => field<Container>(view, 'panel');
const offerOf = (view: object): OfferPanel | null => (view as { offerPanel: OfferPanel | null }).offerPanel;
const texts = (node: Container): string[] => {
  const out: string[] = [];
  const visit = (n: Container): void => {
    for (const child of n.children as Container[]) {
      if ((child as Text).text !== undefined && child.visible) out.push((child as Text).text);
      visit(child);
    }
  };
  visit(node);
  return out;
};

describe('theme_light_4 OFFER panel (Style 1) under Lives / Confirm', () => {
  it('is style data: an optional offer layout whose roles are required only with it', () => {
    expect(O.panel).toEqual({ width: 960, height: 640, gap: 50 });
    expect(requiredSkinRoles(S1, 'lives').slice(-4)).toEqual(['offerPanel', 'offerBadge', 'offerLivesArt', 'offerCoinArt']);
    const withoutOffer = { ...S1, windows: { ...S1.windows, offer: undefined } } as unknown as ReadyUiSkin;
    expect(requiredSkinRoles(withoutOffer, 'lives')).not.toContain('offerPanel');
    expect(requiredSkinRoles(withoutOffer, 'confirm')).toEqual(['windowSurface', 'windowClose', 'heroGlow', 'lifeLostArt', 'buttonPrimary']);
    expect(S1.assets.offerPanel).toEqual(S1.assets.windowSurface); // the same Component 9 shell, one file
  });

  it('Lives full: window + OFFER centred together, the panel 50 under the window, data in the Figma boxes', () => {
    const kit = createKit();
    const art = roles(S1);
    const log: string[] = [];
    const view = lives(kit, styled(kit, art), log);
    view.resize(1080, 2344);
    view.show({ ...LIVES, offer: OFFER });
    advance(kit.core, 400);
    const offer = offerOf(view) as OfferPanel;
    expect(offer.parent).toBe(panelOf(view));
    // frame (60, 677) is the window alone; the panel is 990 + 50 below its top, panel units from the frame centre
    expect([offer.x, offer.y]).toEqual([60 - 540, 677 + 990 + 50 - 1172]);
    // composition 990 + 50 + 640 = 1680 centred: at the Figma frame size the window top lands at 332 (Figma 22:27562)
    const panel = panelOf(view);
    expect(field<number>(view, 'fitScale')).toBeCloseTo(1, 9);
    expect(panel.y + (677 - 1172)).toBeCloseTo(332, 9);
    expect(panel.y + (677 + 990 + 50 - 1172) + 640).toBeCloseTo(2012, 9);
    const surface = offer.children[0] as NineSliceSprite;
    expect(surface).toBeInstanceOf(NineSliceSprite);
    expect(surface.texture).toBe(art.offerPanel);
    expect([surface.width, surface.height]).toEqual([968, 652]); // 960 × 640 + the shell's 4 / 4 / 4 / 8 bleed
    expect(texts(offer)).toEqual(['OFFER', '35d', '5', '10', '900', 'x3']);
    const hero = field<Sprite>(offer, 'hero');
    expect(hero.texture).toBe(art.offerLivesArt);
    expect([hero.x, hero.y, hero.width, hero.height]).toEqual([65.98, 230.9, 326, 298]);
    const items = field<Array<{ icon: Sprite }>>(offer, 'items');
    expect(items.map((item) => item.icon.texture)).toEqual([lamp, wand]);
    // a 2:1 host texture contain-fits the 162 box: 162 × 81, centred
    expect([items[0]!.icon.x, items[0]!.icon.y, items[0]!.icon.width, items[0]!.icon.height]).toEqual([503, 192 + 40.5, 162, 81]);
    const badge = field<Text>(offer, 'badgeLabel');
    expect(badge.rotation).toBeCloseTo(-Math.PI / 6, 9);
    expect(field<Sprite>(offer, 'badge').texture).toBe(art.offerBadge);
    expect(offer.buyButton.background.texture).toBe(art.buttonPrimary);
    expect([offer.buyButton.x, offer.buyButton.y]).toEqual([458 + 214, 408 + 90]);
    expect(offer.closeButton?.background.texture).toBe(art.windowClose);

    // buy = a close continuation with the params (the host buys)
    tap(offer.buyButton, kit);
    advance(kit.core, 300);
    expect(log).toEqual(['offer:900']);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('Lives without an offer (or without onOffer) keeps the window alone: no panel built, the composition collapses', () => {
    const kit = createKit();
    const log: string[] = [];
    const plain = lives(kit, styled(kit), log);
    const buttons = kit.ui.getStats().buttons;
    plain.resize(1080, 2344);
    plain.show(LIVES);
    advance(kit.core, 400);
    expect(offerOf(plain)).toBeNull();
    expect(panelOf(plain).y + (677 - 1172)).toBeCloseTo(677, 9); // centred alone
    plain.close('button');
    advance(kit.core, 300);
    // an offer, then none: the panel leaves the scene and the window is centred again
    plain.show({ ...LIVES, offer: OFFER });
    advance(kit.core, 400);
    expect(kit.ui.getStats().buttons).toBe(buttons + 2); // buy + its ×, built on the first offer
    expect(panelOf(plain).y + (677 - 1172)).toBeCloseTo(332, 9);
    plain.close('button');
    advance(kit.core, 300);
    plain.show(LIVES);
    advance(kit.core, 400);
    expect(offerOf(plain)?.parent).toBeNull();
    expect(panelOf(plain).y + (677 - 1172)).toBeCloseTo(677, 9);
    plain.destroy();

    const noHandler = lives(kit, styled(kit), log, { onOffer: undefined } as unknown as Partial<LivesWindowViewOptions>);
    noHandler.show({ ...LIVES, offer: OFFER });
    advance(kit.core, 400);
    expect(offerOf(noHandler)).toBeNull();
    noHandler.destroy();
  });

  it('the panel × closes the window like the window × (dismiss), the badge and items follow the data', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = lives(kit, styled(kit), log);
    view.show({ ...LIVES, offer: { icon: 'offerCoinArt', iconLabel: '2000', items: [{ icon: lamp, label: '5' }], price: 1500 } });
    advance(kit.core, 400);
    const offer = offerOf(view) as OfferPanel;
    expect(field<Sprite>(offer, 'badge').visible).toBe(false); // no badge text → no badge
    const items = field<Array<{ icon: Sprite; label: Text }>>(offer, 'items');
    expect([items[0]!.icon.visible, items[1]!.icon.visible]).toEqual([true, false]);
    // one item takes the centre between the two slots (centres 584 / 776)
    expect(items[0]!.icon.x + items[0]!.icon.width / 2).toBeCloseTo(680, 9);
    expect(field<Sprite>(offer, 'hero').width).toBe(267); // the style's coin art at its render box
    expect(texts(offer)).toEqual(['OFFER', '2000', '5', formatAmount(1500)]);
    tap(offer.closeButton as UiButton, kit);
    advance(kit.core, 300);
    expect(log).toEqual(['dismiss:button']);
    view.destroy();
  });

  it('Confirm RESTART + OFFER (22:28101): the same panel under the confirm window, onOffer(offer) after the close', () => {
    const kit = createKit();
    const log: string[] = [];
    const view = confirm(kit, styled(kit), log);
    view.resize(1080, 2344);
    const alone = (): number => panelOf(view).y - 994 / 2;
    view.show();
    advance(kit.core, 400);
    expect(offerOf(view)).toBeNull();
    expect(alone()).toBeCloseTo(675, 9); // the exit / restart window alone (Figma 22:28232: 60, 675)
    view.close('button');
    advance(kit.core, 300);
    const offer: ReadyUiOffer = { icon: 'offerCoinArt', iconLabel: '2000', items: [{ icon: lamp, label: '5' }, { icon: wand, label: '10' }], price: 900, badge: 'x3' };
    view.show({ offer });
    advance(kit.core, 400);
    expect(alone()).toBeCloseTo(330, 9); // Figma 22:28101: the window at 60, 330 over the panel
    const panel = offerOf(view) as OfferPanel;
    expect(panel.y).toBe(994 / 2 + 50);
    tap(panel.buyButton, kit);
    advance(kit.core, 300);
    expect(log).toEqual(['dismiss:button', 'offer:900']); // the first close was the test's own ×
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });

  it('the donor look and the pre-style include path never draw an offer (no art for it)', () => {
    const kit = createKit();
    const log: string[] = [];
    const donor = lives(kit, kit.textures, log, { variant: 'donor' });
    donor.show({ ...LIVES, offer: OFFER });
    advance(kit.core, 400);
    expect(offerOf(donor)).toBeNull();
    donor.destroy();
    const donorConfirm = confirm(kit, kit.textures, log, { variant: 'donor' });
    donorConfirm.show({ offer: OFFER });
    advance(kit.core, 400);
    expect(offerOf(donorConfirm)).toBeNull();
    donorConfirm.destroy();

    // variant 'figma' with the kit-name include textures (no style textures): Style 1 without its OFFER art
    const art = roles(S1);
    const included: ReadyUiTextures = { ...requiredOnly(kit) };
    for (const [role, name] of Object.entries(STYLE_1_INCLUDE_NAMES) as Array<[ReadyUiSkinRole, ReadyUiOptionalTextureName]>) {
      const texture = art[role];
      if (texture) included[name] = texture;
    }
    const legacy = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: included, variant: 'figma', id: 'legacy', onRefill: () => {}, onOffer: () => log.push('offer') });
    legacy.show({ ...LIVES, offer: OFFER });
    advance(kit.core, 400);
    expect(legacy.skin).toBe(S1);
    expect(offerOf(legacy)).toBeNull();
    legacy.destroy();
    expect(log).toEqual([]);
  });
});

describe('Lives without REFILL and without the rewarded button: the button row closes up', () => {
  for (const [skin, lift] of [[S1, 1603 - 1351], [READY_UI_STYLE_2, 1474 - 1289]] as const) {
    it(`${skin.id}: the window ends ${lift} units higher (the margin under the content stays), centred again`, () => {
      const kit = createKit();
      const view = new LivesWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, roles(skin), skin), theme: { skin }, id: 'lives', onRefill: () => {}, onWatchAd: () => {} });
      view.resize(1080, 2344);
      const W = skin.windows.lives.window;
      view.show({ ...LIVES, refillOffer: false, adOffer: false });
      advance(kit.core, 400);
      const height = W.height - lift;
      expect(panelOf(view).hitArea).toMatchObject({ width: 960, height });
      const surface = field<NineSliceSprite>(view, 'surface');
      const pad = skin.assets.windowSurface.nineSlice.pad;
      expect(surface.height).toBeCloseTo(height + (pad?.top ?? 0) + (pad?.bottom ?? 0), 9);
      // the collapsed window is centred on the frame
      expect(panelOf(view).y + (W.y - 1172)).toBeCloseTo(1172 - height / 2, 9);
      view.close('button');
      advance(kit.core, 300);
      // one action back: the full window again
      view.show({ ...LIVES, adOffer: false });
      advance(kit.core, 400);
      expect(panelOf(view).hitArea).toMatchObject({ height: W.height });
      expect(surface.height).toBeCloseTo(W.height + (pad?.top ?? 0) + (pad?.bottom ?? 0), 9);
      view.destroy();
    });
  }
});

describe('theme_light_4 OFFER panel (Style 2): the orange popup 100 under the window, 14 right of it', () => {
  it('draws the style data: offset panel, its own caption look per hero, the coin art as the price coin, no ×', () => {
    const kit = createKit();
    const art = roles(READY_UI_STYLE_2);
    const log: string[] = [];
    const view = new LivesWindowView({
      ui: kit.ui, motion: kit.motion, textures: styled(kit, art, READY_UI_STYLE_2), theme: { skin: READY_UI_STYLE_2 }, id: 'lives',
      onRefill: () => {}, onWatchAd: () => {}, onOffer: (p) => log.push(`offer:${p.offer?.price}`)
    });
    view.resize(1080, 2344);
    view.show({ ...LIVES, offer: OFFER });
    advance(kit.core, 400);
    const offer = offerOf(view) as OfferPanel;
    expect([offer.x, offer.y]).toEqual([74 - 540, 794 + 756 + 100 - 1172]);
    expect(panelOf(view).hitArea).toMatchObject({ x: -480, width: 974, height: 756 + 100 + 600 });
    expect(offer.closeButton).toBeNull();
    expect(field<Sprite>(offer, 'priceCoin').texture).toBe(art.offerCoinArt);
    const caption = field<Text>(offer, 'heroLabel');
    expect([caption.text, caption.style.fontSize, caption.style.fill, caption.style.fontFamily]).toEqual(['35d', 70, 0x3f598c, 'Carlito']);
    view.close('button');
    advance(kit.core, 300);
    view.show({ ...LIVES, offer: { ...OFFER, icon: 'offerCoinArt', iconLabel: '2000' } });
    advance(kit.core, 400);
    const coinCaption = field<Text>(offer, 'heroLabel');
    expect([coinCaption.text, coinCaption.style.fontSize, coinCaption.style.fill]).toEqual(['2000', 90, 0xffffff]);
    expect(coinCaption.style.stroke).toMatchObject({ color: 0x963304, width: 8 });
    expect(field<Sprite>(offer, 'hero').texture).toBe(art.offerCoinArt);
    tap(offer.buyButton, kit);
    advance(kit.core, 300);
    expect(log).toEqual(['offer:900']);
    view.destroy();
    expect(kit.ui.getStats().buttons).toBe(0);
  });
});
