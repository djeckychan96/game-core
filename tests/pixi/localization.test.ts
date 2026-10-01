import { describe, expect, it } from 'vitest';
import { Container, Text, Texture } from 'pixi.js';
import { LocalizationRuntime } from '../../src/localization';
import {
  ConfirmWindowView,
  HudView,
  LevelMapView,
  LivesWindowView,
  NoAdsWindowView,
  READY_UI_CATALOGS,
  READY_UI_STYLE_1,
  ResultWindowView,
  SettingsWindowView,
  ShopWindowView,
  StarterPackWindowView
} from '../../src/pixi';
import type { ReadyUiSkinRole, ReadyUiSkinTextures, ReadyUiTextures } from '../../src/pixi';
import type { UiButton } from '../../src/pixi/UiButton';
import { createKit } from './setup';

type Kit = ReturnType<typeof createKit>;

function field<T>(view: object, name: string): T {
  const value = (view as Record<string, unknown>)[name];
  if (value === undefined || value === null) throw new Error(`no field ${name}`);
  return value as T;
}

function i18n(locale: 'ru' | 'en'): LocalizationRuntime {
  return new LocalizationRuntime({ rawLocale: locale, supportedLocales: ['ru', 'en'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });
}

function allTexts(root: Container): string[] {
  const found: string[] = [];
  const visit = (node: Container): void => {
    for (const child of node.children as Container[]) {
      if (child instanceof Text && child.text) found.push(child.text);
      visit(child);
    }
  };
  visit(root);
  return found;
}

function styledTextures(kit: Kit): ReadyUiTextures {
  const roles: ReadyUiSkinTextures = {};
  for (const role of Object.keys(READY_UI_STYLE_1.assets) as ReadyUiSkinRole[]) roles[role] = Texture.WHITE;
  return { ...kit.textures, skins: { [READY_UI_STYLE_1.id]: roles } };
}

describe('Ready UI localization dependency', () => {
  it('a RU provider changes every existing semantic default without changing skin selection', () => {
    {
      const kit = createKit();
      const view = new ConfirmWindowView({ ...kit, i18n: i18n('ru'), onConfirm: () => undefined });
      expect([field<Text>(view, 'title').text, field<Text>(view, 'body').text, field<UiButton>(view, 'confirmButton').labelText?.text, view.variant])
        .toEqual(['ВЫ УВЕРЕНЫ?', 'Вы потеряете 1 жизнь', 'ВЫХОД', 'donor']);
    }
    {
      const kit = createKit();
      const view = new LivesWindowView({ ...kit, i18n: i18n('ru'), onRefill: () => undefined, onWatchAd: () => undefined });
      expect([field<Text>(view, 'title').text, field<Text>(view, 'nextLabel').text, field<UiButton>(view, 'refillButton').labelText?.text, field<string>(view, 'fullLabel')])
        .toEqual(['ЖИЗНИ', 'Новая жизнь через', 'ПОПОЛНИТЬ!', 'МАКС']);
    }
    {
      const kit = createKit();
      const view = new SettingsWindowView({ ...kit, i18n: i18n('ru'), haptic: true, onToggle: () => undefined, onHome: () => undefined, onRestart: () => undefined });
      const toggles = field<Record<string, { label: Text }>>(view, 'toggles');
      expect([field<Text>(view, 'title').text, toggles.sound!.label.text, toggles.music!.label.text, toggles.haptic!.label.text,
        field<UiButton>(view, 'homeButton').labelText?.text, field<UiButton>(view, 'restartButton').labelText?.text])
        .toEqual(['НАСТРОЙКИ', 'ЗВУК', 'МУЗЫКА', 'ВИБРО', 'ВЫХОД', 'ЗАНОВО']);
    }
    {
      const kit = createKit();
      const view = new ResultWindowView({ ...kit, i18n: i18n('ru'), onNext: () => undefined, onRetry: () => undefined, onExit: () => undefined });
      view.show({ level: 7, outcome: 'fail', rewardCoins: 0 });
      expect([field<Text>(view, 'titleText').text, field<Text>(view, 'subtitleText').text, field<Text>(view, 'rewardCaption').text,
        field<UiButton>(view, 'nextButton').labelText?.text, field<UiButton>(view, 'failRetryButton').labelText?.text, field<UiButton>(view, 'exitButton').labelText?.text])
        .toEqual(['УРОВЕНЬ 7', 'НЕ ПРОЙДЕН', 'НАГРАДА', 'ДАЛЕЕ', 'ЗАНОВО', 'К УРОВНЯМ']);
    }
    {
      const kit = createKit();
      const hud = new HudView({ ...kit, i18n: i18n('ru'), lives: 5, maxLives: 5 });
      expect(field<{ capsuleText: Text }>(hud, 'lives').capsuleText.text).toBe('МАКС');
      const map = new LevelMapView({ ...kit, id: 'localized-map', i18n: i18n('ru'), levels: [{ index: 1, hard: true }], currentLevel: 1, onSelectLevel: () => undefined });
      expect(field<string>(map, 'hardLabel')).toBe('СЛОЖНЫЙ');
    }
    {
      const kit = createKit();
      const shop = new ShopWindowView({ ...kit, i18n: i18n('ru'), onBuy: () => undefined });
      expect(field<Text>(shop, 'title').text).toBe('ЗОЛОТО');
      const noAds = new NoAdsWindowView({ ...kit, id: 'localized-no-ads', i18n: i18n('ru'), onBuy: () => undefined });
      expect(allTexts(noAds)).toEqual(expect.arrayContaining(['БЕЗ', 'РЕКЛАМЫ']));
      noAds.show({ price: '99 ₽' });
      expect(field<Text>(noAds, 'description').text).toBe('Убирает всплывающую рекламу.\nРеклама за награду остается');
    }
    {
      const kit = createKit();
      const starter = new StarterPackWindowView({ ...kit, i18n: i18n('ru'), onBuy: () => undefined });
      starter.show({ price: '199 ₽', rewards: { coins: 3500 } });
      expect(field<Text>(starter, 'title').text).toBe('СТАРТОВЫЙ\nНАБОР');
    }
  });

  it('the EN provider supplies catalog copy where Style 1 legacy casing differs', () => {
    const kit = createKit();
    const view = new LivesWindowView({
      ...kit,
      textures: styledTextures(kit),
      theme: { skin: READY_UI_STYLE_1 },
      i18n: i18n('en'),
      onRefill: () => undefined,
      onWatchAd: () => undefined
    });
    expect(view.skin).toBe(READY_UI_STYLE_1);
    expect(allTexts(view)).toEqual(expect.arrayContaining(['REFILL HEARTS!', 'Next heart in', 'REFILL', 'GET']));
    expect(field<string>(view, 'fullLabel')).toBe('MAX');
    expect(allTexts(view)).not.toContain('NEXT HEART IN');
    expect(allTexts(view)).not.toContain('REFILL NOW!');
  });

  it('explicit per-instance and per-show copy wins over i18n', () => {
    const kit = createKit();
    const confirm = new ConfirmWindowView({
      ...kit,
      i18n: i18n('ru'),
      title: 'TITLE OVERRIDE',
      body: 'BODY OVERRIDE',
      confirmLabel: 'ACTION OVERRIDE',
      onConfirm: () => undefined
    });
    expect([field<Text>(confirm, 'title').text, field<Text>(confirm, 'body').text, field<UiButton>(confirm, 'confirmButton').labelText?.text])
      .toEqual(['TITLE OVERRIDE', 'BODY OVERRIDE', 'ACTION OVERRIDE']);

    const result = new ResultWindowView({ ...kit, id: 'explicit-result', i18n: i18n('ru'), onNext: () => undefined });
    result.show({ level: 7, rewardCoins: 10, title: 'LEVEL OVERRIDE', subtitle: 'SUBTITLE OVERRIDE' });
    expect([field<Text>(result, 'titleText').text, field<Text>(result, 'subtitleText').text]).toEqual(['LEVEL OVERRIDE', 'SUBTITLE OVERRIDE']);

    const livesKit = createKit();
    const lives = new LivesWindowView({
      ...livesKit,
      i18n: i18n('ru'),
      title: 'LIVES OVERRIDE',
      nextLifeLabel: 'NEXT OVERRIDE',
      refillLabel: 'REFILL OVERRIDE',
      fullLabel: 'FULL OVERRIDE',
      onRefill: () => undefined
    });
    expect([
      field<Text>(lives, 'title').text,
      field<Text>(lives, 'nextLabel').text,
      field<UiButton>(lives, 'refillButton').labelText?.text,
      field<string>(lives, 'fullLabel')
    ]).toEqual(['LIVES OVERRIDE', 'NEXT OVERRIDE', 'REFILL OVERRIDE', 'FULL OVERRIDE']);

    const hudKit = createKit();
    const hud = new HudView({ ...hudKit, i18n: i18n('ru'), lives: 5, maxLives: 5, fullLivesLabel: 'FULL OVERRIDE' });
    expect(field<{ capsuleText: Text }>(hud, 'lives').capsuleText.text).toBe('FULL OVERRIDE');
    const map = new LevelMapView({
      ...hudKit,
      id: 'explicit-map',
      i18n: i18n('ru'),
      hardLabel: 'HARD OVERRIDE',
      levels: [{ index: 1, hard: true }],
      currentLevel: 1,
      onSelectLevel: () => undefined
    });
    expect(field<string>(map, 'hardLabel')).toBe('HARD OVERRIDE');

    const shopKit = createKit();
    const shop = new ShopWindowView({ ...shopKit, i18n: i18n('ru'), title: 'SHOP OVERRIDE', onBuy: () => undefined });
    expect(field<Text>(shop, 'title').text).toBe('SHOP OVERRIDE');
    shop.show({ items: [], title: '' });
    expect(field<Text>(shop, 'title').text).toBe('');

    const offerKit = createKit();
    const noAds = new NoAdsWindowView({ ...offerKit, i18n: i18n('ru'), wordNo: 'NO OVERRIDE', wordAds: 'ADS OVERRIDE', onBuy: () => undefined });
    noAds.show({ price: '$1', description: 'DESCRIPTION OVERRIDE' });
    expect(allTexts(noAds)).toEqual(expect.arrayContaining(['NO OVERRIDE', 'ADS OVERRIDE', 'DESCRIPTION OVERRIDE']));

    const starterKit = createKit();
    const starter = new StarterPackWindowView({ ...starterKit, i18n: i18n('ru'), onBuy: () => undefined });
    starter.show({ title: 'STARTER OVERRIDE', price: '$2', rewards: { coins: 1 } });
    expect(field<Text>(starter, 'title').text).toBe('STARTER OVERRIDE');
  });

  it('without i18n the exact donor and Style 1 legacy defaults remain unchanged', () => {
    const donorKit = createKit();
    const donor = new ConfirmWindowView({ ...donorKit, onConfirm: () => undefined });
    expect([field<Text>(donor, 'title').text, field<Text>(donor, 'body').text, field<UiButton>(donor, 'confirmButton').labelText?.text])
      .toEqual(['ARE YOU SURE?', 'You will lose 1 heart', 'EXIT']);

    const styleKit = createKit();
    const styleLives = new LivesWindowView({
      ...styleKit,
      textures: styledTextures(styleKit),
      theme: { skin: READY_UI_STYLE_1 },
      onRefill: () => undefined,
      onWatchAd: () => undefined
    });
    expect(allTexts(styleLives)).toEqual(expect.arrayContaining(['REFILL HEARTS!', 'NEXT HEART IN', 'REFILL NOW!', 'GET', '+1']));
  });

  it.each(['ru', 'en'] as const)('Style 1 Settings uses the %s provider in map and gameplay layouts', (locale) => {
    const kit = createKit();
    const provider = i18n(locale);
    const view = new SettingsWindowView({
      ...kit,
      textures: styledTextures(kit),
      theme: { skin: READY_UI_STYLE_1 },
      i18n: provider,
      haptic: true,
      onToggle: () => undefined,
      onHome: () => undefined,
      onRestart: () => undefined
    });
    view.show({ sound: true, music: true, haptic: true, gameButtons: false });
    expect(field<Text>(view, 'title').text).toBe(provider.t('core.settings.title'));
    view.close('programmatic');
    kit.core.update(200);
    view.show({ sound: true, music: true, haptic: true, gameButtons: true });
    expect(allTexts(view)).toEqual(expect.arrayContaining([
      provider.t('core.settings.sound'),
      provider.t('core.settings.music'),
      provider.t('core.settings.haptic'),
      provider.t('core.settings.exit'),
      provider.t('core.settings.restart')
    ]));
  });
});
