// GAME CORE UI SHOWCASE — a standalone page that shows the Pixi Ready UI kit shipped inside
// game-core, with no game attached. The host (this file) owns the Pixi Application and ticker;
// the kit is driven only through `core.update(deltaMS)`.
//
// Production Ready UI on screen: HUD (lives / coins / stars / settings), the level map, the PLAY
// button, the two offer icons, and every window. The thin strips at the very bottom are the DEMO
// TOOLBAR (opens each window directly) and the OFFER strip (drives the OfferRuntime demo's fake
// clock); both are deliberately styled unlike the game UI.
import { Application, Container, type FederatedPointerEvent, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { AnalyticsRuntime, BUILD_INFO, CoreRuntime, MemoryOfferStateStore, MotionRuntime, OfferRuntime, PurchaseRuntime, UiRuntime, createAdsAnalyticsHandler, createGrantedPurchaseStore, createOfferAnalyticsHandler, createPurchaseAdsHandler, createPurchaseAnalyticsHandler, type OfferEvent, type OfferReward, type PurchaseEvent, type PurchaseResult, type RestoreResult } from 'game-core';
import {
  ALT_READY_UI_THEME,
  BUBBLE_READY_UI_THEME,
  ClickRippleEffect,
  DEFAULT_CLICK_RIPPLE,
  HudView,
  LevelMapView,
  LivesWindowView,
  NoAdsWindowView,
  ResultWindowView,
  SettingsWindowView,
  ShopWindowView,
  StarterPackWindowView,
  UiButton,
  createLabel,
  formatTimer,
  loadReadyUiAssets,
  resolveTheme,
  type ClickRippleConfig,
  type ReadyUiTextures
} from 'game-core/pixi';
import { DEMO_MAX_LIVES, DEMO_REFILL_PRICE, DEMO_SHOP_ITEMS, createDemoState } from './demoData';
import { createAdsDemo } from './adsDemo';
import { DemoAnalyticsTransport, demoAnalyticsContext, eventLabel } from './analyticsDemo';
import { DEMO_OFFER_CATALOG, DEMO_OFFER_CHAIN, REWARD_COINS, formatClock, offerLabel, offerToWindowParams } from './offerDemo';
import { DemoPaymentsAdapter, demoPrice, type DemoSheetOutcome } from './purchaseDemo';

interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function readSafeInsets(): SafeInsets {
  const probe = document.getElementById('safe-probe');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const style = getComputedStyle(probe);
  const px = (value: string) => Math.max(0, parseFloat(value) || 0);
  return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
}

/** Donor main screen: PLAY is 522 × 228 design units at 1.424 × the contain scale on a phone. */
const PLAY_SCALE = 1.424;
const PLAY_BOTTOM_RATIO = 98 / 844;
const TOOLBAR_H = 30;
const OFFER_STRIP_H = 50; // pills + the OFFERS, PURCHASE and ANALYTICS status lines
/** The donor's pan threshold: a finger that travelled further panned/scrolled, it did not tap. */
const EMPTY_TAP_THRESHOLD_PX = 12;
/** The demo's fake server clock starts here (unix seconds). A game injects `serverNow()` instead. */
const DEMO_EPOCH_SEC = 1_760_000_000;
/** The demo's stand-in for the platform payment sheet: a MotionRuntime delay, no real IAP. */
const DEMO_PAYMENT_MS = 1200;

/**
 * The ripple pill cycles these. Index 0 is the production ocean — `DEFAULT_CLICK_RIPPLE`, 1:1 with
 * Trail Arrow's `ArrowRenderer.spawnOceanRipple`. The halo variant only demonstrates the Core-only
 * option for light backgrounds; a game configures the effect once and keeps it.
 */
const RIPPLE_PRESETS: Array<{ name: string; config: Partial<ClickRippleConfig> | null }> = [
  { name: 'OCEAN · Trail Arrow production', config: {} },
  { name: 'OCEAN + HALO · demo for light backgrounds', config: { haloAlpha: 0.35 } },
  { name: 'RIPPLE · OFF', config: null }
];

async function boot(): Promise<void> {
  // Theme System V1 proof: `?theme=alt` skins the same UI with the demo ocean theme, `?theme=bubble` with the glossy
  // Bubble theme (V1.1); `?theme=art` keeps the v0.4 PNG skins
  const themeParam = new URLSearchParams(location.search).get('theme');
  const theme = resolveTheme(themeParam === 'art' ? { skin: 'art' } : undefined, themeParam === 'alt' ? ALT_READY_UI_THEME : themeParam === 'bubble' ? BUBBLE_READY_UI_THEME : undefined);
  const app = new Application();
  const resolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  await app.init({
    resizeTo: window,
    resolution,
    autoDensity: true,
    antialias: true,
    background: theme.colors.mapBackground,
    powerPreference: 'high-performance'
  });
  document.getElementById('app')!.appendChild(app.canvas);
  app.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  // --- Game Core foundation: one clock (the Pixi ticker), one cancellation tree ---
  const core = new CoreRuntime();
  const motion = new MotionRuntime();
  const ui = new UiRuntime({ motion });
  core.registerRuntime('ui', ui);
  core.registerRuntime('motion', motion);
  // The fake server clock of the OfferRuntime demo: advanced by frame time here (a game injects its
  // server-anchored `serverNow()`), jumped by the OFFER strip. Never Date.now(), never a timer.
  const clock = { nowMs: DEMO_EPOCH_SEC * 1000 };
  let tickTimers: (deltaMs: number) => void = () => {};
  app.ticker.add((ticker) => {
    clock.nowMs += ticker.deltaMS;
    core.update(ticker.deltaMS);
    tickTimers(ticker.deltaMS);
  });

  const textures: ReadyUiTextures = await loadReadyUiAssets({ baseUrl: './pixi-ui/' });
  document.getElementById('boot')?.remove();

  const state = createDemoState();
  const settings = { sound: true, music: true };
  const totalStars = () => state.levels.reduce((sum, level) => sum + (level.stars ?? 0), 0);
  const screen = new Container();
  const modals = new Container();
  // Click ripple (Game Core Pixi FX): rings draw over the game screen and under the modals. The
  // effect only draws; which pointer-up counts as "a tap on empty space" is decided below (host).
  const ripple = new ClickRippleEffect({ motion, id: 'showcase' });
  app.stage.addChild(screen, ripple, modals);

  // --- windows (created once, shown on demand) ---
  const resultWindow = new ResultWindowView({
    ui, motion, textures, theme,
    onNext: (params) => {
      // demo progression: a win on the current level unlocks the next one
      const level = state.levels[params.level - 1];
      if (level) level.stars = Math.max(level.stars ?? 0, params.stars ?? 0);
      if (params.level === state.currentLevel && state.currentLevel < state.levels.length) state.currentLevel += 1;
      state.coins += params.rewardCoins;
      hud.setCoins(state.coins);
      hud.setStars(totalStars());
      map.setProgress({ levels: state.levels, currentLevel: state.currentLevel });
      map.scrollToLevel(state.currentLevel);
    },
    onRetry: (params) => openResult(params.level)
  });
  const shopWindow = new ShopWindowView({
    ui, motion, textures, theme,
    onBuy: (item) => demoPurchase(item.id, 'shop') // real money → PurchaseRuntime, never a direct grant
  });
  const livesWindow = new LivesWindowView({
    ui, motion, textures, theme,
    onRefill: (params) => {
      if (state.coins < params.refillPrice) return openShop();
      state.coins -= params.refillPrice;
      state.lives = DEMO_MAX_LIVES;
      hud.setCoins(state.coins);
      hud.setLives(state.lives, formatTimer(state.refillSeconds));
    },
    onWatchAd: () => { state.lives = Math.min(DEMO_MAX_LIVES, state.lives + 1); hud.setLives(state.lives, formatTimer(state.refillSeconds)); }
  });
  const settingsWindow = new SettingsWindowView({
    ui, motion, textures, theme,
    onToggle: (setting, enabled) => { if (setting === 'sound' || setting === 'music') settings[setting] = enabled; }
  });
  const noAdsWindow = new NoAdsWindowView({ ui, motion, textures, theme, onBuy: () => toast('NO ADS — purchase is the host\'s job') });
  // The starter-pack window is data-only. When it shows a chain offer, BUY runs the demo purchase
  // below (`shownOfferId`); the static demo (`openStarter`) just adds the coins like before.
  const starterWindow = new StarterPackWindowView({
    ui, motion, textures, theme,
    onBuy: (params) => {
      const productId = shownOfferId;
      shownOfferId = null;
      if (!productId) {
        state.coins += params.rewards.coins;
        hud.setCoins(state.coins);
        toast('STARTER PACK — purchase is the host\'s job');
        return;
      }
      demoPurchase(productId, 'offer_window');
    }
  });
  modals.addChild(resultWindow, shopWindow, livesWindow, settingsWindow, noAdsWindow, starterWindow);

  const openResult = (level: number) => {
    const won = state.levels[level - 1];
    const stars = 1 + ((level * 7) % 3); // deterministic demo stars 1..3
    resultWindow.show({ level, stars, rewardCoins: 40 + (level % 5) * 15, retry: (won?.stars ?? 0) > 0 || level < state.currentLevel });
  };
  const openShop = () => shopWindow.show({ items: DEMO_SHOP_ITEMS });
  const openLives = () => livesWindow.show({ lives: state.lives, maxLives: DEMO_MAX_LIVES, timerText: formatTimer(state.refillSeconds), refillPrice: DEMO_REFILL_PRICE });
  const openSettings = () => settingsWindow.show({ ...settings, version: `VERSION ${BUILD_INFO.version}` });
  const openNoAds = () => noAdsWindow.show({ price: '$1.99' });
  /** The static starter-pack demo (no chain): fixed params, no timer. */
  const openStarter = () => {
    shownOfferId = null;
    starterWindow.setTimer('');
    starterWindow.setBuyEnabled(true);
    return starterWindow.show({ price: '$0.99', rewards: { coins: 3500, infiniteLives: '1h', boosters: 'x3' } });
  };

  // --- AnalyticsRuntime demo: a fake transport, paced by the same core.update as everything else ---
  // Core-owned behavior (the offer chain) is instrumented at composition level below
  // (`createOfferAnalyticsHandler`); the page adds its own events like a game would.
  const analyticsTransport = new DemoAnalyticsTransport();
  const analytics = new AnalyticsRuntime({
    transport: analyticsTransport,
    context: demoAnalyticsContext(() => state.currentLevel),
    now: () => Math.floor(clock.nowMs / 1000)
  });
  core.registerRuntime('analytics', analytics);
  // --- AdsRuntime demo: the donor's ad rules for one scripted fake player (ADS pill). It only DECIDES —
  // no ad SDK exists here; events reach analytics through the composition handler.
  const adsDemo = createAdsDemo((next) => createAdsAnalyticsHandler(analytics, next));
  core.registerRuntime('ads', adsDemo.ads);

  analytics.trackSessionStart({ sessionNumber: 1 });
  analytics.trackLoadingDone(performance.now()); // the host measures; Core has no clock

  // --- OfferRuntime demo: Trail Arrow's LiveOps chain on the fake clock ---
  // The runtime knows nothing about this page: state, clock, level, catalog and "welcome owned"
  // are injected; rewards are granted here (host), the window only receives data.
  const offerState = new MemoryOfferStateStore();
  const offerEvents: OfferEvent[] = [];
  let shownOfferId: string | null = null; // productId the starter window currently shows, null for the static demo
  let offerAutoShown = false;              // donor: the current offer pops once per session
  const offers = new OfferRuntime({
    config: DEMO_OFFER_CHAIN,
    state: offerState,
    input: {
      now: () => Math.floor(clock.nowMs / 1000),
      level: () => state.currentLevel,
      hasPrice: (productId) => DEMO_OFFER_CATALOG[productId] !== undefined,
      welcomeOwned: () => state.starterPackOwned
    },
    onEvent: createOfferAnalyticsHandler(analytics, (event) => {
      offerEvents.push(event);
      if (event.type === 'activated') {
        toast(`OFFER ACTIVATED · ${offerLabel(event.offer)} · ${event.offer.productId}`);
        if (!offerAutoShown) { offerAutoShown = true; openOffer(); }
      } else if (event.type === 'expired') {
        toast(`OFFER EXPIRED · ${offerLabel(event.offer)}`);
      } else if (event.type === 'purchased') {
        toast(event.moved ? `PURCHASED ${event.offer.productId} · chain → cooldown` : `PURCHASED ${event.offer.productId} · chain not moved`);
      } else {
        toast('OFFER BLOCKED · no catalog price');
      }
      refreshOfferUi();
    })
  });
  core.registerRuntime('offers', offers);

  /** Shows the chain's current offer in the starter-pack window (data from the runtime, timer from the clock). */
  const openOffer = (): boolean => {
    const active = offers.getActive();
    if (!active) {
      toast(`NO ACTIVE OFFER · ${cooldownText()}`);
      return false;
    }
    shownOfferId = active.productId;
    const shown = starterWindow.show(offerToWindowParams(active, DEMO_OFFER_CATALOG[active.productId] ?? '?'));
    starterWindow.setTimer(formatClock(offers.secondsLeft()));
    starterWindow.setBuyEnabled(!purchasing());
    return shown;
  };

  // --- PurchaseRuntime demo: BUY → fake payments adapter → grant → AnalyticsRuntime → OfferRuntime ---
  // The runtime imports neither of the other two: this composition is the only link. Rewards come
  // from the host's catalogs (the offer chain's rewards, the shop table); the price of the purchase
  // event from the demo catalog (`demoPrice`); the registry is the in-memory one (a game persists it).
  const payments = new DemoPaymentsAdapter();
  const grantedPurchases = createGrantedPurchaseStore();
  const purchaseEvents: PurchaseEvent<OfferReward[]>[] = [];
  let lastPurchase: PurchaseResult | null = null;
  let lastRestore: RestoreResult | null = null;
  let profileSaves = 0; // a game: profile.save() / markDirty() on every `granted`
  const purchases = new PurchaseRuntime<OfferReward[]>({
    payments,
    granted: grantedPurchases,
    resolveGrant: (productId) => {
      const item = DEMO_SHOP_ITEMS.find((it) => it.id === productId);
      return offers.offerByProduct(productId)?.rewards ?? (item ? [{ id: REWARD_COINS, amount: item.amount }] : undefined);
    },
    // Rewards are host-owned data: the demo credits coins to the HUD and just names the rest.
    grant: (productId, rewards) => {
      for (const reward of rewards) {
        if (reward.id === REWARD_COINS) { state.coins += reward.amount; hud.setCoins(state.coins); }
      }
      if (offers.offerByProduct(productId)?.tier === 0) state.starterPackOwned = true;
    },
    // analytics → ads.markPayer (composition bridge) → the page's own handler
    onEvent: createPurchaseAnalyticsHandler(analytics, demoPrice, createPurchaseAdsHandler(adsDemo.ads, (event) => {
      purchaseEvents.push(event);
      if (event.type === 'granted') {
        profileSaves++;
        adsDemo.recordPayment(demoPrice(event.productId)?.revenue ?? 0); // host-side pay_count / pay_sum / pay_max
        offers.onPurchased(event.productId); // a product outside the chain is a no-op there
        toast(`${event.restored ? 'RESTORED' : 'PURCHASE OK'} · ${event.productId} · granted once · ${event.token ?? 'no token'}`);
      } else if (event.type === 'cancelled') {
        toast(`PURCHASE CANCELLED · ${event.productId}`);
      } else if (event.type === 'error') {
        toast(`PURCHASE ERROR · ${event.reason}`);
      }
      refreshPurchaseUi();
    }))
  });
  const purchasing = () => purchases.getPending() !== null; // donor `purchasing`: the payment sheet is open

  /** The demo purchase: the fake platform's payment sheet stays open for a MotionRuntime delay (host ticker). */
  const demoPurchase = (productId: string, source: string) => {
    const opensSheet = !purchasing(); // a second BUY while paying is answered `busy` by the runtime
    const running = purchases.purchase(productId, source);
    if (opensSheet) {
      toast(`PAYMENT SHEET… (demo, ${productId})`);
      motion.delay({
        scope: 'showcase:purchase',
        durationMs: DEMO_PAYMENT_MS,
        onComplete: () => payments.closeSheet(),
        onCancel: () => payments.closeSheet('cancel')
      });
    }
    refreshOfferUi();
    refreshPurchaseUi();
    return running.then((result) => {
      lastPurchase = result;
      if (result.status === 'busy') toast('PURCHASE BUSY · one payment at a time');
      refreshOfferUi();
      refreshPurchaseUi();
      return result;
    });
  };
  /** One restore pass — a game runs it at boot and in waves after a purchase that did not answer ok. */
  const demoRestore = () =>
    purchases.restore().then((result) => {
      lastRestore = result;
      if (result.granted.length === 0) toast(`RESTORE · ${result.status} · nothing new (${result.found} held)`);
      refreshOfferUi();
      refreshPurchaseUi();
      return result;
    });
  const refreshPurchaseUi = () => {
    const stats = purchases.getStats();
    const last = purchaseEvents[purchaseEvents.length - 1];
    const lastText = !last ? '—' : last.type === 'error' ? `error:${last.reason}` : `${last.type} ${last.productId}`;
    purchaseStatus.text = `PURCHASE · ${stats.pending ? `PAYING ${stats.pending}` : `last ${lastPurchase?.status ?? '—'}`} · ${lastText}`
      + ` · granted ${stats.granted} (restored ${stats.restored}) · dup ${stats.duplicates} · held ${payments.held.length} · saves ${profileSaves}${stats.payer ? ' · PAYER' : ''}`;
    purchaseStatus.scale.set(1);
    purchaseStatus.scale.set(Math.min(1, (app.screen.width - 12) / Math.max(1, purchaseStatus.width)));
  };

  const cooldownText = (): string => {
    const stats = offers.getStats();
    if (stats.welcome === 0) return state.currentLevel < DEMO_OFFER_CHAIN.startLevel ? `waiting for level ${DEMO_OFFER_CHAIN.startLevel}` : 'welcome pending';
    const wait = stats.nextAt - Math.floor(clock.nowMs / 1000);
    return wait > 0 ? `next T${Math.min(DEMO_OFFER_CHAIN.topTier, Math.max(1, stats.nextTier || 1))} in ${formatClock(wait)}` : `T${Math.max(1, stats.nextTier || 1)} due`;
  };

  /** Icon, icon timer, window timer and the status caption follow the runtime (called every second and after every jump). */
  const refreshOfferUi = () => {
    const active = offers.getActive();
    const left = offers.secondsLeft();
    starterIcon.visible = active !== null; // donor: the map icon is visible only while an offer is active
    offerIconTimer.visible = active !== null;
    offerIconTimer.text = formatClock(left);
    if (shownOfferId !== null && starterWindow.state !== 'hidden') {
      if (active && active.productId === shownOfferId) {
        starterWindow.setTimer(formatClock(left));
        starterWindow.setBuyEnabled(!purchasing());
      } else if (!purchasing() && starterWindow.state !== 'leaving') {
        // donor: the offer expired while its window was open (and no purchase is in flight) → close it
        shownOfferId = null;
        starterWindow.close('programmatic');
      }
    }
    const elapsedH = ((clock.nowMs / 1000 - DEMO_EPOCH_SEC) / 3600).toFixed(1);
    offerStatus.text = active
      ? `OFFERS · ACTIVE ${offerLabel(active)} ${active.productId} · ${formatClock(left)} · clock +${elapsedH}h${purchasing() ? ' · PAYING' : ''}`
      : `OFFERS · ${cooldownText()} · clock +${elapsedH}h${purchasing() ? ' · PAYING' : ''}`;
  };

  /** OFFER strip controls: move the fake clock, then one explicit tick (what a host does after a resume). */
  const jumpClock = (seconds: number, label: string) => {
    clock.nowMs += seconds * 1000;
    const changed = offers.tick();
    refreshOfferUi();
    toast(`${label} · ${changed ? 'chain moved' : 'no transition'}`);
  };
  const offerExpire = () => {
    const stats = offers.getStats();
    if (!stats.active) return toast('EXPIRE · no active offer');
    jumpClock(Math.max(0, stats.until - Math.floor(clock.nowMs / 1000)), 'EXPIRE');
  };
  const offerNext = () => {
    const stats = offers.getStats();
    if (stats.active) return toast('NEXT · an offer is active — EXPIRE or BUY it first');
    const wait = stats.nextAt - Math.floor(clock.nowMs / 1000);
    jumpClock(Math.max(0, wait), 'NEXT');
  };
  const offerReset = () => {
    motion.cancelScope('showcase:purchase'); // closes the open payment sheet as cancelled
    offerAutoShown = false;
    shownOfferId = null;
    state.starterPackOwned = false;
    offerState.load({});
    offerEvents.length = 0;
    clock.nowMs = DEMO_EPOCH_SEC * 1000;
    if (starterWindow.state !== 'hidden') starterWindow.close('programmatic');
    offers.tick();
    refreshOfferUi();
    toast('OFFER CHAIN RESET');
  };

  // --- HUD ---
  const hud = new HudView({
    ui, motion, textures, theme,
    coins: state.coins,
    lives: state.lives,
    maxLives: DEMO_MAX_LIVES,
    stars: totalStars(),
    onCoinsTap: openShop,
    onLivesTap: openLives,
    onSettingsTap: openSettings
  });
  hud.setLives(state.lives, formatTimer(state.refillSeconds));

  // --- Level map ---
  const map = new LevelMapView({
    ui, motion, textures, theme,
    levels: state.levels,
    currentLevel: state.currentLevel,
    onSelectLevel: (level) => { if (state.lives <= 0) return openLives(); openResult(level); },
    onLockedTap: (level) => toast(`LEVEL ${level} IS LOCKED`),
    onFocusChange: ({ selectedLevel }) => playSub.text = `Level ${selectedLevel}`
  });

  // --- PLAY (donor: big green button under the map, "PLAY" + "Level N") ---
  const playButton = new UiButton({
    ui, id: 'showcase:play', theme, texture: textures.btnPlay, width: 522, height: 228,
    label: 'PLAY', fontSize: 110, labelOffsetY: -34, pressScale: 0.9,
    onTap: () => { if (state.lives <= 0) return openLives(); openResult(map.selectedLevel); }
  });
  if (playButton.labelText) playButton.labelText.style.stroke = { color: 0x000000, width: 10, join: 'round' };
  const playSub = createLabel(theme, `Level ${map.selectedLevel}`, { fontSize: 44, stroke: 5, fill: theme.colors.textMuted });
  playSub.y = 40;
  playButton.addChild(playSub);

  // --- analytics demo actions: a fake rewarded ad and an explicit flush (a host: visibilitychange) ---
  const analyticsDemoAd = () => {
    analytics.advertisement({ type: 'rewarded', placement: 'showcase_strip', status: 'complete' });
    toast('ANALYTICS · advertisement queued (fake rewarded)');
    refreshAnalyticsUi();
  };
  const analyticsDemoFlush = () => {
    void analytics.flush().then(() => {
      toast(`ANALYTICS · flushed · batch #${analyticsTransport.batches.length}: ${analyticsTransport.lastBatch.length} event(s)`);
      refreshAnalyticsUi();
    });
  };
  const refreshAnalyticsUi = () => {
    const stats = analytics.getStats();
    const last = analyticsTransport.lastBatch.map(eventLabel).join(', ');
    analyticsStatus.text = `ANALYTICS · queued ${stats.queued} · sent ${stats.sent} · batches ${stats.batchesSent} · last [${last}]`;
    analyticsStatus.scale.set(1);
    analyticsStatus.scale.set(Math.min(1, (app.screen.width - 12) / Math.max(1, analyticsStatus.width))); // a long batch still fits a phone
  };

  // --- offer icons on the map (donor: starter pack left with the chain timer under it, no ads right) ---
  const starterIcon = new UiButton({ ui, id: 'showcase:offer-starter', theme, texture: textures.starterIcon, width: 100, height: 100, pressScale: 0.9, onTap: () => openOffer() });
  const offerIconTimer = createLabel(theme, '', { fontSize: 15, stroke: 3 });
  const noAdsIcon = new UiButton({ ui, id: 'showcase:offer-noads', theme, texture: textures.noAdsIcon, width: 100, height: 100, pressScale: 0.9, onTap: openNoAds });

  // --- DEMO TOOLBAR + OFFER STRIP (not part of the Ready UI): flat dark strips with tiny pills ---
  const toolbar = new Container();
  const toolbarBg = new Graphics();
  toolbarBg.eventMode = 'static'; // the strips are UI: a tap on them is consumed, never a ripple
  toolbar.addChild(toolbarBg);
  let ripplePreset = 0;
  const setRipplePreset = (index: number) => {
    ripplePreset = ((index % RIPPLE_PRESETS.length) + RIPPLE_PRESETS.length) % RIPPLE_PRESETS.length;
    const preset = RIPPLE_PRESETS[ripplePreset]!;
    if (preset.config) ripple.configure({ ...DEFAULT_CLICK_RIPPLE, ...preset.config });
    else ripple.cancelAll();
    toast(preset.name);
  };
  const makePill = (id: string, label: string, onTap: () => void, tint: number): UiButton => {
    const pill = new UiButton({ ui, id, theme, texture: Texture.WHITE, width: 56, height: 20, label, fontSize: 9, labelOffsetY: 0, pressScale: 0.9, onTap });
    pill.background.tint = tint;
    pill.background.alpha = 0.9;
    if (pill.labelText) { pill.labelText.style.stroke = { color: 0x000000, width: 0 }; pill.labelText.style.fill = 0xdfe6ff; }
    return pill;
  };
  const toolbarItems: Array<[string, () => void]> = [
    ['RESULT', () => openResult(map.selectedLevel)], ['SHOP', openShop], ['LIVES', openLives],
    ['SETTINGS', openSettings], ['NO ADS', openNoAds], ['OFFER', () => openOffer()],
    ['RIPPLE', () => setRipplePreset(ripplePreset + 1)], ['ADS', () => toggleAdsTimeline()]
  ];
  const pills = toolbarItems.map(([label, onTap], i) => {
    const pill = makePill(`showcase:toolbar:${i}`, label, onTap, 0x3a4160);
    toolbar.addChild(pill);
    return pill;
  });
  const caption = createLabel(theme, `DEMO · game-core ${BUILD_INFO.version}`, { fontSize: 8, stroke: false, fill: 0x9aa3c7 });
  toolbar.addChild(caption);
  // OFFER strip: the fake clock controls (+12h / +24h / +48h / EXPIRE / NEXT / RESET) and the chain status
  const offerStrip = new Container();
  const offerStripBg = new Graphics();
  offerStripBg.eventMode = 'static';
  offerStrip.addChild(offerStripBg);
  const offerItems: Array<[string, () => void]> = [
    ['+12H', () => jumpClock(12 * 3600, '+12H')], ['+24H', () => jumpClock(24 * 3600, '+24H')], ['+48H', () => jumpClock(48 * 3600, '+48H')],
    ['EXPIRE', offerExpire], ['NEXT', offerNext], ['RESET', offerReset],
    ['AD', () => analyticsDemoAd()], ['FLUSH', () => analyticsDemoFlush()]
  ];
  const offerPills = offerItems.map(([label, onTap], i) => {
    const pill = makePill(`showcase:offer:${i}`, label, onTap, 0x5a3a2a);
    offerStrip.addChild(pill);
    return pill;
  });
  const offerStatus = createLabel(theme, 'OFFERS', { fontSize: 8, stroke: false, fill: 0xffd9a0 });
  offerStrip.addChild(offerStatus);
  const purchaseStatus = createLabel(theme, 'PURCHASE', { fontSize: 8, stroke: false, fill: 0xb8ffb0 });
  offerStrip.addChild(purchaseStatus);
  const analyticsStatus = createLabel(theme, 'ANALYTICS', { fontSize: 8, stroke: false, fill: 0xa0e0ff });
  offerStrip.addChild(analyticsStatus);

  // ADS timeline: the scripted fake player (L1 → L15 → L20 → rewarded → cooldown → payer → NO_ADS); a tap hides it
  const adsPanel = new Container();
  adsPanel.visible = false;
  adsPanel.eventMode = 'static';
  const adsPanelBg = new Graphics();
  const adsTimelineText = new Text({ text: '', style: { fontFamily: 'Menlo, Consolas, monospace', fontSize: 9, lineHeight: 12, fill: 0xd8ffe0 } });
  adsPanel.addChild(adsPanelBg, adsTimelineText);
  adsPanel.on('pointertap', () => { adsPanel.visible = false; });
  const layoutAdsPanel = () => {
    const top = hud.barHeight + 44;
    adsTimelineText.scale.set(1);
    adsTimelineText.scale.set(Math.min(1, (app.screen.width - 28) / Math.max(1, adsTimelineText.width)));
    adsTimelineText.position.set(14, top + 8);
    adsPanelBg.clear().roundRect(6, top, app.screen.width - 12, adsTimelineText.height + 16, 8).fill({ color: 0x07140c, alpha: 0.92 });
  };
  const runAdsScenario = () => {
    adsDemo.run();
    adsTimelineText.text = [adsDemo.summary(adsDemo.ads.getStats()), ...adsDemo.lines()].join('\n');
    adsPanel.visible = true;
    layoutAdsPanel();
    return adsDemo.timeline;
  };
  const toggleAdsTimeline = () => {
    if (adsPanel.visible) adsPanel.visible = false;
    else runAdsScenario();
  };

  screen.addChild(map, hud, starterIcon, offerIconTimer, noAdsIcon, playButton, offerStrip, toolbar, adsPanel);

  // --- toast (a MotionRuntime-driven label, no timers) ---
  let toastLabel: Text | null = null;
  const toast = (message: string) => {
    motion.cancelScope('showcase:toast');
    toastLabel?.destroy();
    toastLabel = createLabel(theme, message, { fontSize: 15, stroke: 3, wordWrap: app.screen.width - 32 });
    toastLabel.position.set(app.screen.width / 2, hud.barHeight + 24);
    toastLabel.alpha = 0;
    screen.addChild(toastLabel);
    const label = toastLabel;
    motion.sequence({
      scope: 'showcase:toast',
      steps: [
        { type: 'tween', bindings: [{ get: () => label.alpha, set: (v) => { label.alpha = v; }, to: 1 }], durationMs: 160 },
        { type: 'delay', durationMs: 1400 },
        { type: 'tween', bindings: [{ get: () => label.alpha, set: (v) => { label.alpha = v; }, to: 0 }], durationMs: 300 }
      ],
      onComplete: () => { if (toastLabel === label) { label.destroy(); toastLabel = null; } }
    });
  };

  // --- empty-tap gate: HOST policy, deliberately not in Core ---
  // A pointer-down counts only if it lands on a free surface (the stage background or the map's
  // empty ribbon — never a button, a badge, a window, the toolbar), while no window is blocking,
  // and the matching pointer-up did not travel past the donor's 12 px pan threshold (a map scroll
  // is not a tap). Core knows none of this. Trail Arrow's own gate lives in its ArrowRenderer:
  // pinch/pan state, `arrowAtLoose` (a tap near an arrow is an arrow tap, never a ripple) — all
  // game-specific, so a game brings its own conditions here in the same way.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen; // empty space now hits the stage instead of nothing
  const freeSurfaces = new Set<unknown>([app.stage, map]);
  let emptyPress: { pointerId: number; x: number; y: number } | null = null;
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    emptyPress = null;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (ui.isBlocking() || !freeSurfaces.has(event.target)) return;
    emptyPress = { pointerId: event.pointerId, x: event.global.x, y: event.global.y };
  });
  app.stage.on('pointerup', (event: FederatedPointerEvent) => {
    const press = emptyPress;
    emptyPress = null;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.global.x - press.x, event.global.y - press.y) > EMPTY_TAP_THRESHOLD_PX) return;
    if (RIPPLE_PRESETS[ripplePreset]!.config === null) return;
    ripple.spawnGlobal(event.global.x, event.global.y);
  });
  app.stage.on('pointercancel', () => { emptyPress = null; });

  // --- layout ---
  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    const safe = readSafeInsets();
    const s = Math.min(w / theme.designWidth, h / theme.designHeight);

    hud.resize(w, h, { insets: { top: safe.top, left: safe.left, right: safe.right }, pixelRatio: resolution });
    // the ripple is NOT scaled with the UI: like the donor it is a fixed size in screen px everywhere

    // demo toolbar: inside the bottom safe area, the OFFER strip right above it, PLAY clears both
    const toolbarTop = h - safe.bottom - TOOLBAR_H;
    toolbarBg.clear().rect(0, toolbarTop - 4, w, TOOLBAR_H + 4 + safe.bottom).fill({ color: 0x080a12, alpha: 0.78 });
    const pillGap = 4;
    const placeRow = (row: UiButton[], top: number) => {
      const pillW = Math.min(56, (w - 16 - pillGap * (row.length - 1)) / row.length);
      const pillScale = pillW / 56;
      const rowW = row.length * pillW + (row.length - 1) * pillGap;
      row.forEach((pill, i) => {
        pill.setIdleScale(pillScale);
        pill.position.set(w / 2 - rowW / 2 + pillW / 2 + i * (pillW + pillGap), top);
      });
    };
    placeRow(pills, toolbarTop + TOOLBAR_H / 2 - 2);
    caption.position.set(w / 2, toolbarTop + TOOLBAR_H - 1);
    caption.visible = safe.bottom > 6;
    const offerTop = toolbarTop - 4 - OFFER_STRIP_H;
    offerStripBg.clear().rect(0, offerTop, w, OFFER_STRIP_H).fill({ color: 0x1a1008, alpha: 0.82 });
    placeRow(offerPills, offerTop + 11);
    offerStatus.position.set(w / 2, offerTop + OFFER_STRIP_H - 26);
    purchaseStatus.position.set(w / 2, offerTop + OFFER_STRIP_H - 16);
    analyticsStatus.position.set(w / 2, offerTop + OFFER_STRIP_H - 6);

    // PLAY: donor size and its 98/844 bottom margin, never under the strips
    const playScale = Math.min(PLAY_SCALE * s, (w - 40) / 522);
    const playH = 228 * playScale;
    const playBottom = Math.min(h - h * PLAY_BOTTOM_RATIO, offerTop - 12);
    playButton.setIdleScale(playScale);
    playButton.position.set(w / 2, playBottom - playH / 2);
    const playTop = playBottom - playH;

    // offer icons: 16% of the short side (64..120 px), 10 px from the edges, a quarter down
    const iconSize = Math.max(64, Math.min(120, Math.min(w, h) * 0.16));
    starterIcon.setIdleScale(iconSize / 100);
    noAdsIcon.setIdleScale(iconSize / 100);
    starterIcon.position.set(safe.left + 10 + iconSize / 2, h / 4);
    noAdsIcon.position.set(w - safe.right - 10 - iconSize / 2, h / 4);
    offerIconTimer.position.set(starterIcon.x, starterIcon.y + iconSize / 2 + 12);

    // the map runs from under the HUD to the top of PLAY (nodes slide under the button)
    map.resize(w, h, { insets: { top: hud.barHeight - 10 * s, bottom: h - playTop - 8 * s, left: safe.left, right: safe.right }, pixelRatio: resolution });

    const modalInsets = { top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right };
    for (const win of [resultWindow, shopWindow, livesWindow, settingsWindow, noAdsWindow, starterWindow]) {
      win.resize(w, h, { insets: modalInsets, pixelRatio: resolution });
    }
    if (toastLabel) toastLabel.position.set(w / 2, hud.barHeight + 24);
    if (adsPanel.visible) layoutAdsPanel();
  };
  app.renderer.on('resize', layout);
  layout();
  // iOS reports safe-area/orientation a frame late
  window.addEventListener('orientationchange', () => setTimeout(layout, 60));
  refreshOfferUi();
  refreshPurchaseUi();

  // --- demo timers driven by the host ticker (lives refill countdown, offer timers) ---
  let timerAcc = 0;
  tickTimers = (deltaMs: number): void => {
    timerAcc += deltaMs;
    while (timerAcc >= 1000) {
      timerAcc -= 1000;
      if (state.lives < DEMO_MAX_LIVES) {
        state.refillSeconds -= 1;
        if (state.refillSeconds <= 0) {
          state.refillSeconds = 30 * 60;
          state.lives += 1;
          hud.setLives(state.lives, formatTimer(state.refillSeconds));
        } else {
          hud.setLivesTimer(formatTimer(state.refillSeconds));
        }
        livesWindow.setTimer(formatTimer(state.refillSeconds));
      }
      refreshOfferUi(); // once a second, like the donor's map icon and window timers
      refreshPurchaseUi();
      refreshAnalyticsUi();
    }
  };

  // dev hooks for automated visual checks (Playwright)
  (window as unknown as { __showcase: unknown }).__showcase = {
    app, core, ui, motion, map, hud, state,
    resultWindow, shopWindow, livesWindow, settingsWindow, noAdsWindow, starterWindow,
    playButton, toolbar, offerStrip, starterIcon, noAdsIcon,
    ripple, ripplePresets: RIPPLE_PRESETS, setRipplePreset,
    openResult, openShop, openLives, openSettings, openNoAds, openStarter, openOffer,
    offers, offerState, offerEvents,
    offerClock: { now: () => Math.floor(clock.nowMs / 1000), jump: (seconds: number) => jumpClock(seconds, `+${seconds}s`), expire: offerExpire, next: offerNext, reset: offerReset },
    offerDemo: { shownOfferId: () => shownOfferId, purchasing, iconTimer: offerIconTimer, status: offerStatus },
    purchases, payments, grantedPurchases, purchaseEvents,
    purchaseDemo: {
      buy: demoPurchase, restore: demoRestore, status: purchaseStatus,
      setOutcome: (outcome: DemoSheetOutcome) => { payments.nextOutcome = outcome; },
      last: () => ({ purchase: lastPurchase, restore: lastRestore, saves: profileSaves })
    },
    analytics, analyticsTransport,
    analyticsDemo: { ad: analyticsDemoAd, flush: analyticsDemoFlush, status: analyticsStatus },
    ads: adsDemo.ads,
    adsDemo: { run: runAdsScenario, timeline: adsDemo.timeline, lines: adsDemo.lines, profile: adsDemo.profile, panel: adsPanel, text: adsTimelineText },
    layout,
    stats: () => core.getStats()
  };
}

boot().catch((error) => {
  console.error('[showcase] boot failed', error);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = `BOOT FAILED: ${String((error as Error)?.message ?? error)}`;
});
