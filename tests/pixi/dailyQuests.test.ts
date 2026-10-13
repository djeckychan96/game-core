import { describe, expect, it } from 'vitest';
import { Texture, TextureSource } from 'pixi.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, createKit, pointer } from './setup';
import {
  DAILY_QUESTS_GDD_V1_CATALOGS,
  LocalizationRuntime,
  QuestService,
  SaveGate,
  SoftCurrencyWallet,
  createWalletQuestRewards,
  dailyQuestsGddV1,
  mergeLocalizationCatalogs,
  questDayStart,
  trackWalletForQuests
} from '../../src/index';
import type { GameProductionProfile, PlatformStorage, QuestChange, QuestDef, QuestView } from '../../src/index';
import { DailyQuestsWindowView, questProgressText, type DailyQuestsSource } from '../../src/pixi/DailyQuestsWindowView';
import { READY_UI_CATALOGS } from '../../src/pixi/locales';
import { READY_UI_OPTIONAL_ASSET_FILES, type ReadyUiOptionalTextureName, type ReadyUiTextures } from '../../src/pixi/assets';
import { requiredSkinRoles, validateReadyUiSkin, type ReadyUiSkin, type ReadyUiSkinAssetKey, type ReadyUiSkinTextures } from '../../src/pixi/skin';
import { READY_UI_STYLE_1 } from '../../src/pixi/skins/style1';
import { READY_UI_STYLE_2 } from '../../src/pixi/skins/style2';
import type { UiButton } from '../../src/pixi/UiButton';

type Kit = ReturnType<typeof createKit>;
const S2 = READY_UI_STYLE_2;
const rootDir = resolve(__dirname, '../..');
const PROFILE: Pick<GameProductionProfile, 'id' | 'save' | 'economy'> = {
  id: 'game',
  save: { keys: ['game_state'] },
  economy: { softCurrency: { id: 'coins', owner: 'core', startBalance: 0 } }
};
const CONFIG = dailyQuestsGddV1('coins');
/** Local 10:00 on 2026-10-13 at UTC+7. */
const T0 = Date.UTC(2026, 9, 13, 3, 0, 0);
const FIXED = new Set(['daily_login', 'daily_ad_02', 'daily_level_03', 'daily_gold_100', 'group_payer_spend_gold_01', 'group_payer_purchase']);
const labelled = (label: string): Texture => new Texture({ source: new TextureSource({ width: 2, height: 2, label }) });

function styled(kit: Kit, skin: ReadyUiSkin): ReadyUiTextures {
  const required = { ...kit.textures };
  for (const name of Object.keys(READY_UI_OPTIONAL_ASSET_FILES) as ReadyUiOptionalTextureName[]) delete required[name];
  const roles: ReadyUiSkinTextures = {};
  for (const key of Object.keys(skin.assets) as ReadyUiSkinAssetKey[]) roles[key] = labelled(`${skin.id}:${key}`);
  return { ...required, skins: { [skin.id]: roles } };
}

/** A lossless WebP's pixel size (VP8L header). */
function px(file: string): number[] {
  const b = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
  expect(b.toString('ascii', 12, 16), file).toBe('VP8L');
  const bits = b.readUInt32LE(21);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}

function memoryStorage(): PlatformStorage {
  const data: Record<string, unknown> = {};
  return {
    isCloud: () => true,
    ready: async () => {},
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, JSON.parse(JSON.stringify(data[key]))])),
    set: (patch) => {
      Object.assign(data, JSON.parse(JSON.stringify(patch)));
      return Promise.resolve(true);
    },
    clear: async (keys) => {
      for (const key of keys) delete data[key];
    }
  };
}

/** The game side: SaveGate + wallet + QuestService (a fixed 6-quest day), wallet changes tracked as quest events. */
async function game(options: { storage?: PlatformStorage; available?: (quest: QuestDef) => boolean } = {}) {
  const storage = options.storage ?? memoryStorage();
  const clock = { t: T0, now: () => clock.t, timezoneOffsetMinutes: () => -420 };
  const gate = new SaveGate({ storage, profile: PROFILE });
  const wallet = new SoftCurrencyWallet({ gate, profile: PROFILE });
  const quests = new QuestService({
    gate, config: CONFIG, rewards: createWalletQuestRewards(wallet), clock, random: () => 0.3,
    resolveGroup: () => 'payer', available: options.available ?? ((quest) => FIXED.has(quest.id))
  });
  await Promise.all([gate.load(), wallet.load(), quests.load()]);
  gate.open();
  trackWalletForQuests(wallet, quests);
  return { storage, clock, gate, wallet, quests };
}

const i18n = (locale: string) =>
  new LocalizationRuntime({ rawLocale: locale, supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: mergeLocalizationCatalogs(READY_UI_CATALOGS, DAILY_QUESTS_GDD_V1_CATALOGS) });

function windowFor(kit: Kit, source: DailyQuestsSource, extra: Partial<ConstructorParameters<typeof DailyQuestsWindowView>[0]> = {}): DailyQuestsWindowView {
  const view = new DailyQuestsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, S2), theme: { skin: S2 }, i18n: i18n('en'), quests: source, ...extra });
  view.resize(390, 844);
  return view;
}

function open(kit: Kit, view: DailyQuestsWindowView): void {
  view.show();
  advance(kit.core, 400);
  expect(view.state).toBe('shown');
}

function tap(kit: Kit, target: UiButton): void {
  target.emit('pointerdown', pointer(1, 1) as never);
  advance(kit.core, 80);
  target.emit('pointerup', pointer(1, 1) as never);
  advance(kit.core, 400);
}

/** Every Text under a container. */
function texts(root: { children: readonly unknown[] }): string[] {
  const out: string[] = [];
  const walk = (node: { children?: readonly unknown[]; text?: unknown; visible?: boolean }): void => {
    if (node.visible === false) return;
    if (typeof node.text === 'string' && node.text !== '') out.push(node.text);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(root as never);
  return out;
}

/** A source spy: counts claim calls and live listeners around a real QuestService. */
function spy(quests: QuestService) {
  const stats = { claims: 0, listeners: 0, snapshots: 0 };
  const source: DailyQuestsSource = {
    snapshot: () => {
      stats.snapshots++;
      return quests.snapshot();
    },
    claim: (id) => {
      stats.claims++;
      return quests.claim(id);
    },
    onChange: (listener: (change: QuestChange) => void) => {
      stats.listeners++;
      const stop = quests.onChange(listener);
      return () => {
        stats.listeners--;
        stop();
      };
    }
  };
  return { source, stats };
}

describe('theme_light_11 Daily Quests — the Style 2 package', () => {
  it('covers dailyQuests with the popup, the new row art and the reused coin / glow / star; files are Figma renders at their boxes', () => {
    expect(() => validateReadyUiSkin(S2)).not.toThrow();
    expect(S2.covers).toContain('dailyQuests');
    expect(requiredSkinRoles(S2, 'dailyQuests')).toEqual(['windowSurface', 'windowClose', 'questSlot', 'questCup', 'questBarEmpty', 'questBarFull', 'questButton', 'rewardCoin', 'questTimer', 'questGlow', 'questSpark']);
    expect(px(S2.assets.questSlot!.file)).toEqual([92, 96]);
    expect(px(S2.assets.questBarEmpty!.file)).toEqual([66, 84]);
    expect(px(S2.assets.questBarFull!.file)).toEqual([66, 84]);
    expect(px(S2.assets.questButton!.file)).toEqual([230, 130]);
    expect(px(S2.assets.questCup!.file)).toEqual([510, 510]);
    expect(px(S2.assets.questTimer!.file)).toEqual([230, 230]);
    expect(px(S2.assets.iconQuests!.file)).toEqual([250, 250]);
    expect(S2.assets.windowSurface?.file).toBe('style2/settings_panel.webp');
    expect(S2.windows.dailyQuests?.title).toEqual(S2.windows.settings?.map.title);
  });

  it('a style that does not cover dailyQuests is refused (there is no donor look)', async () => {
    const kit = createKit();
    const { quests } = await game();
    const uncovered = { ...S2, id: 'style-2-no-quests', covers: S2.covers.filter((view) => view !== 'dailyQuests') } as ReadyUiSkin;
    expect(() => new DailyQuestsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, uncovered), theme: { skin: uncovered }, quests })).toThrow(/covers 'dailyQuests'/);
  });

  it('Style 1 (theme_light_11 dark row) draws the same window: its window shell, its own glow and the rays behind the cup', async () => {
    const S1 = READY_UI_STYLE_1;
    expect(() => validateReadyUiSkin(S1)).not.toThrow();
    expect(requiredSkinRoles(S1, 'dailyQuests')).toContain('questRays');
    expect(Object.keys(S1.assets).some((key) => key.includes(':'))).toBe(false);
    expect(px(S1.assets.questSlot!.file)).toEqual([92, 92]);
    expect(px(S1.assets.questBarEmpty!.file)).toEqual([60, 50]);
    expect(px(S1.assets.questButton!.file)).toEqual([230, 130]);
    expect(px(S1.assets.questCup!.file)).toEqual([510, 510]);
    expect(px(S1.assets.iconQuests!.file)).toEqual([250, 250]);
    const kit = createKit();
    const { quests } = await game();
    const view = new DailyQuestsWindowView({ ui: kit.ui, motion: kit.motion, textures: styled(kit, S1), theme: { skin: S1 }, i18n: i18n('en'), quests });
    view.resize(390, 844);
    open(kit, view);
    expect(view.rowIds).toHaveLength(6);
    expect(texts(view)).toContain('DAILY QUESTS');
    view.destroy();
  });
});

describe('DailyQuestsWindowView — the list from the QuestService snapshot', () => {
  it('one row per unclaimed quest in the snapshot order, texts by key, progress and the real reward (never a sample 900)', async () => {
    const kit = createKit();
    const { quests } = await game();
    const view = windowFor(kit, quests);
    open(kit, view);
    const snapshot = quests.snapshot();
    expect(view.screen).toBe('list');
    expect(view.rowIds).toEqual(snapshot.quests.map((quest) => quest.id));
    const shown = texts(view);
    expect(shown).toContain('DAILY QUESTS');
    expect(shown).toContain('Watch ads');
    expect(shown).toContain('Watch 2 ads');
    expect(shown).toContain('0/2');
    expect(shown).toContain('15'); // daily_ad_02's Balance reward
    expect(shown).not.toContain('900');
    // a four-quest day (no group) → four rows: the count is the snapshot's, not Figma's eight
    const kit2 = createKit();
    const small = await game({ available: (quest) => FIXED.has(quest.id) && quest.category !== 'group' });
    const view2 = windowFor(kit2, small.quests);
    open(kit2, view2);
    expect(view2.rowIds).toHaveLength(4);
  });

  it('GO is disabled without a host route and closes the window then routes with one; play time counts in minutes', async () => {
    const kit = createKit();
    const { quests } = await game();
    const routed: string[] = [];
    const view = windowFor(kit, quests, { canGo: (quest) => quest.event === 'level_complete', onGo: (quest) => routed.push(quest.id) });
    open(kit, view);
    expect(view.rowOf('daily_ad_02')!.button.enabled).toBe(false);
    const go = view.rowOf('daily_level_03')!.button;
    expect(go.enabled).toBe(true);
    tap(kit, go);
    expect(view.state).toBe('hidden');
    expect(routed).toEqual(['daily_level_03']);
    expect(questProgressText({ event: 'play_time', progress: 125, target: 600 } as QuestView)).toBe('2/10');
  });

  it('Claim pays exactly once through the service: double taps, the change event and a re-open never pay again', async () => {
    const kit = createKit();
    const { quests, wallet } = await game();
    const { source, stats } = spy(quests);
    const claimed: string[] = [];
    const view = windowFor(kit, source, { onClaimed: (quest) => claimed.push(quest.id) });
    quests.track({ type: 'login' });
    open(kit, view);
    const button = view.rowOf('daily_login')!.button;
    expect(texts(button)).toEqual(['Claim reward']);
    tap(kit, button);
    tap(kit, button); // the row is leaving: its button is off
    expect(stats.claims).toBe(1);
    expect(claimed).toEqual(['daily_login']);
    expect(wallet.balance).toBe(10);
    advance(kit.core, 400);
    expect(view.rowIds).not.toContain('daily_login'); // GDD: a claimed quest leaves the list
    expect(view.rowIds).toHaveLength(5);
    view.close('button');
    advance(kit.core, 300);
    open(kit, view);
    expect(view.rowIds).not.toContain('daily_login');
    expect(wallet.balance).toBe(10);
  });

  it('progress while open re-renders the row in place; a completed quest offers Claim, not the done screen', async () => {
    const kit = createKit();
    const { quests } = await game();
    const view = windowFor(kit, quests);
    open(kit, view);
    quests.track({ type: 'level_complete' });
    expect(texts(view.rowOf('daily_level_03') as never)).toContain('1/3');
    for (const event of ['login', 'level_complete', 'level_complete'] as const) quests.track({ type: event });
    for (let i = 0; i < 2; i++) quests.track({ type: 'rewarded_ad' });
    quests.track({ type: 'currency_spent', amount: 100 });
    quests.track({ type: 'currency_earned', amount: 100 });
    quests.track({ type: 'purchase', id: 'purchase:t' });
    expect(quests.snapshot().quests.every((quest) => quest.state === 'completed')).toBe(true);
    // every quest completed but none claimed: still the list (GDD «Завершен» = claimed)
    expect(view.screen).toBe('list');
    expect(view.rowIds).toHaveLength(6);
  });
});

describe('DailyQuestsWindowView — all claimed, the timer, the day change, cleanup', () => {
  async function allCompleted() {
    const g = await game();
    for (const event of ['login', 'level_complete', 'level_complete', 'level_complete', 'rewarded_ad', 'rewarded_ad'] as const) g.quests.track({ type: event });
    g.quests.track({ type: 'currency_spent', amount: 100 });
    g.quests.track({ type: 'currency_earned', amount: 100 });
    g.quests.track({ type: 'purchase', id: 'purchase:t' });
    return g;
  }

  it('the done screen only when every quest is claimed; its timer counts down to the local midnight each second', async () => {
    const kit = createKit();
    const g = await allCompleted();
    const view = windowFor(kit, g.quests);
    open(kit, view);
    for (const id of view.rowIds) tap(kit, view.rowOf(id)!.button);
    advance(kit.core, 400);
    expect(g.quests.snapshot().allClaimed).toBe(true);
    expect(view.screen).toBe('done');
    const shown = texts(view);
    expect(shown).toContain('All daily quests completed!');
    expect(shown).toContain('New quests in:');
    expect(view.timerText).toBe('14:00:00'); // local 10:00 at UTC+7 → 14 h to 00:00
    g.clock.t += 61_000;
    advance(kit.core, 1100, 50);
    expect(view.timerText).toBe('13:58:59');
  });

  it('local midnight while open: the clock shows the new day\'s set (the new list, not the done screen)', async () => {
    const kit = createKit();
    const g = await allCompleted();
    const view = windowFor(kit, g.quests);
    open(kit, view);
    for (const id of view.rowIds) tap(kit, view.rowOf(id)!.button);
    advance(kit.core, 400);
    expect(view.screen).toBe('done');
    const day = g.quests.snapshot().day!;
    g.clock.t = questDayStart(day + 1, g.clock) + 500;
    advance(kit.core, 1200, 50);
    expect(view.screen).toBe('list');
    expect(g.quests.snapshot().day).toBe(day + 1);
    expect(view.rowIds).toHaveLength(6);
  });

  it('hidden or destroyed: the change subscription, the clock and every motion of the window stop', async () => {
    const kit = createKit();
    const { quests } = await game();
    const { source, stats } = spy(quests);
    const view = windowFor(kit, source);
    open(kit, view);
    expect(stats.listeners).toBe(1);
    view.close('button');
    advance(kit.core, 300);
    expect(view.state).toBe('hidden');
    expect(stats.listeners).toBe(0);
    const before = stats.snapshots;
    advance(kit.core, 3000, 100);
    expect(stats.snapshots).toBe(before); // no clock while hidden
    open(kit, view);
    expect(stats.listeners).toBe(1);
    view.destroy();
    expect(stats.listeners).toBe(0);
    expect(kit.motion.getStats().activeMotions).toBe(0);
    quests.track({ type: 'login' }); // no listener left to touch the destroyed view
  });

  it('RU through the localization runtime: the window copy and the quest texts', async () => {
    const kit = createKit();
    const { quests } = await game();
    const view = windowFor(kit, quests, { i18n: i18n('ru') });
    open(kit, view);
    const shown = texts(view);
    expect(shown).toContain('ЕЖЕДНЕВНЫЕ ЗАДАНИЯ');
    expect(shown).toContain('Посмотреть 2 рекламных ролика');
    expect(shown).toContain('GO');
  });
});
