import { Container, Graphics, type NineSliceSprite, Rectangle, Sprite, type FederatedPointerEvent, type FederatedWheelEvent, type Text, type Texture } from 'pixi.js';
import type { MotionHandle, QuestChange, QuestClaimResult, QuestReward, QuestSnapshot, QuestView, WindowHiddenReason } from '../index';
import { SparkleView, playSparkleLoop } from './fx/Sparkle';
import { ModalWindow, type ModalWindowOptions } from './ModalWindow';
import { createNineSlice, type NineSliceSpec } from './nineSlice';
import { localizedText } from './localization';
import { READY_UI_LEGACY_TEXT } from './locales/legacy';
import {
  resolveWindowSkin,
  selectWindowSkin,
  skinNineSlice,
  skinTextBoxLook,
  skinTextLook,
  type ReadyUiSkin,
  type ReadyUiSkinBox,
  type ReadyUiSkinDailyQuestsLayout,
  type ReadyUiSkinLivesTextBox,
  type ReadyUiSkinWrappedTextBox,
  type WindowSkinLook
} from './skin';
import { UiButton } from './UiButton';
import { applyTextResolution, createFigmaLabel, figmaLabelAdvance, formatTimer, placeFigmaLabel, type FigmaTextLook } from './text';

/** What the window reads and calls — a Core `QuestService` satisfies it (types only: the kit imports no runtime). */
export interface DailyQuestsSource {
  snapshot(): QuestSnapshot;
  claim(questId: string): QuestClaimResult;
  onChange(listener: (change: QuestChange) => void): () => void;
}

export interface DailyQuestsWindowViewOptions extends Omit<ModalWindowOptions, 'id' | 'fit'> {
  id?: string;
  /** The day's quests: the window renders `snapshot()`, claims through `claim()` and follows `onChange` while it is up. */
  quests: DailyQuestsSource;
  /** Window copy (each: explicit, else the i18n key `core.quests.*`, else the English default). */
  title?: string;
  goLabel?: string;
  claimLabel?: string;
  doneTitle?: string;
  doneBody?: string;
  nextLabel?: string;
  /** A quest's text for its localization key (`titleKey` / `descriptionKey`); default the window's i18n, else the key. */
  text?: (key: string, quest: QuestView) => string;
  /**
   * The host has a route for this quest's GO (GDD: the shop for an ad or a purchase, the map for levels …). Absent or
   * false: GO is shown disabled — never a button that looks working and does nothing.
   */
  canGo?: (quest: QuestView) => boolean;
  /** GO tapped: runs after the window closed (GDD: the popup closes before the player is moved). */
  onGo?: (quest: QuestView) => void;
  /** A claim the service accepted (the reward is paid): the host's feedback (a sound, the HUD). */
  onClaimed?: (quest: QuestView, result: QuestClaimResult) => void;
  /** The progress text; default `questProgressText`. */
  progressText?: (quest: QuestView) => string;
  /** A quest's icon; default the style's cup (`questCup`). */
  questIcon?: (quest: QuestView) => Texture | null | undefined;
  /** A reward's icon; default the style's coin (`rewardCoin`). */
  rewardIcon?: (reward: QuestReward) => Texture | null | undefined;
}

/** `progress / target`; play time (seconds in the service) in whole minutes — the GDD counts it in minutes. */
export function questProgressText(quest: QuestView): string {
  if (quest.event === 'play_time') return `${Math.floor(quest.progress / 60)}/${Math.ceil(quest.target / 60)}`;
  return `${quest.progress}/${quest.target}`;
}

/** The all-claimed screen's stars: each flashes in turn inside one loop. */
export const DAILY_QUESTS_SPARKS_LOOP = Object.freeze({ loopMs: 4000, stepMs: 420, delayMs: 300 });

/** A row leaving the list after its claim, and the rows closing the gap. */
const LEAVE_MS = 220;
const DRAG_THRESHOLD = 12;

type QuestsLook = WindowSkinLook<'dailyQuests'>;
type Mode = 'list' | 'done';

interface Labels {
  go: string;
  claim: string;
}

/** One quest row: built once per quest id, updated in place from each snapshot. */
class QuestRow extends Container {
  quest: QuestView;
  readonly button: UiButton;
  /** The row is fading out after its claim; it is no longer part of the list. */
  leaving = false;
  private readonly icon: Sprite;
  private readonly nameText: Text;
  private readonly description: Text;
  private readonly fill: NineSliceSprite;
  private readonly progress: Text;
  private readonly amount: Text;
  private readonly coin: Sprite;
  private readonly buttonText: Text;

  constructor(
    private readonly owner: DailyQuestsWindowView,
    private readonly L: ReadyUiSkinDailyQuestsLayout['row'],
    private readonly A: QuestsLook['art'],
    private readonly skin: ReadyUiSkin,
    private readonly look: FigmaTextLook,
    quest: QuestView,
    onAction: (questId: string) => void
  ) {
    super();
    this.quest = quest;
    const theme = owner.theme;
    const back = createNineSlice(A.questSlot, skinNineSlice(skin, 'questSlot', 'dailyQuests'), L.width, L.height);
    back.position.set(L.width / 2, L.height / 2);
    back.eventMode = 'none';
    this.icon = boxSprite(A.questCup, L.icon);
    const label = (box: ReadyUiSkinLivesTextBox): Text => {
      const node = createFigmaLabel(theme, '', box.fontSize, skinTextBoxLook(look, box));
      node.eventMode = 'none';
      return node;
    };
    this.nameText = label(L.name);
    this.description = label(L.description);
    const empty = createNineSlice(A.questBarEmpty, skinNineSlice(skin, 'questBarEmpty', 'dailyQuests'), L.bar.width, L.bar.height);
    empty.position.set(L.bar.x + L.bar.width / 2, L.bar.y + L.bar.height / 2);
    empty.eventMode = 'none';
    this.fill = createNineSlice(A.questBarFull, skinNineSlice(skin, 'questBarFull', 'dailyQuests'), L.bar.width, L.bar.height);
    this.fill.eventMode = 'none';
    this.progress = label(L.progress);
    this.amount = createFigmaLabel(theme, '', L.reward.amount.fontSize, skinTextBoxLook(look, { x: 0, y: 0, width: 0, height: 0, ...L.reward.amount }));
    this.amount.eventMode = 'none';
    this.coin = new Sprite(A.rewardCoin);
    this.coin.eventMode = 'none';
    this.button = new UiButton({
      ui: owner.uiRuntime,
      id: `${owner.id}:quest:${quest.id}`,
      theme,
      texture: A.questButton,
      width: L.button.width,
      height: L.button.height,
      pressScale: 0.9,
      onTap: () => onAction(this.quest.id)
    });
    this.button.position.set(L.button.x + L.button.width / 2, L.button.y + L.button.height / 2);
    this.buttonText = createFigmaLabel(theme, '', L.buttonLabel.fontSize, skinTextBoxLook(look, L.buttonLabel));
    this.buttonText.eventMode = 'none';
    this.button.addChild(this.buttonText);
    // Figma bottom → top: the back, the cup, the texts, the bar (empty, fill, numbers), the reward, the button
    this.addChild(back, this.icon, this.nameText, this.description, empty, this.fill, this.progress, this.amount, this.coin, this.button);
    this.boundsArea = new Rectangle(0, 0, L.width, L.height);
  }

  update(quest: QuestView, labels: Labels): void {
    this.quest = quest;
    const L = this.L;
    const owner = this.owner;
    this.icon.texture = owner.iconFor(quest) ?? this.A.questCup;
    setText(this.nameText, owner.textFor(quest.titleKey, quest), L.name, 'left');
    setText(this.description, owner.textFor(quest.descriptionKey, quest), L.description, 'left');
    // the fill: Figma resizes daily_tasks_bar_full to the progress share; nothing at 0, never narrower than its ends
    const share = quest.target > 0 ? Math.min(1, quest.progress / quest.target) : 0;
    this.fill.visible = share > 0;
    if (share > 0) {
      const width = share >= 1 ? L.bar.width : Math.min(L.bar.width, Math.max(L.bar.fillMin, L.bar.width * share));
      this.fill.width = width;
      this.fill.position.set(L.bar.x + width / 2, L.bar.y + L.bar.height / 2);
    }
    setText(this.progress, owner.progressFor(quest), L.progress, 'center');
    // the reward: amount, gap, coin — one row centred on the button column
    const R = L.reward;
    this.coin.texture = owner.rewardIconFor(quest.reward) ?? this.A.rewardCoin;
    this.coin.width = R.coin.width;
    this.coin.height = R.coin.height;
    this.amount.text = String(quest.reward.amount);
    const advance = figmaLabelAdvance(this.amount);
    const left = R.centerX - (advance + R.gap + R.coin.width) / 2;
    placeFigmaLabel(this.amount, { x: left, y: R.y, width: advance, height: R.height, align: 'left' });
    this.coin.position.set(left + advance + R.gap, R.coin.y);
    // the button: Claim for a completed quest, GO for an active one (disabled without a host route)
    const completed = quest.state === 'completed';
    placeWrapped(this.buttonText, completed ? labels.claim : labels.go, L.buttonLabel, -L.button.width / 2, -L.button.height / 2);
    this.button.setEnabled(completed || owner.goAllowed(quest));
  }

  override destroy(): void {
    this.button.destroy();
    super.destroy({ children: true });
  }
}

/** A sprite over a render box (decoration: no input). */
function boxSprite(texture: Texture, box: ReadyUiSkinBox, dx = 0, dy = 0): Sprite {
  const sprite = new Sprite(texture);
  sprite.position.set(box.x + dx, box.y + dy);
  sprite.width = box.width;
  sprite.height = box.height;
  sprite.eventMode = 'none';
  return sprite;
}

/** Re-sizes a 9-slice made by `createNineSlice` to a new logical height (its bleed and centring kept). */
function resizeNineSliceHeight(sprite: NineSliceSprite, spec: NineSliceSpec, width: number, height: number): void {
  const pad = spec.pad ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const fullWidth = width + pad.left + pad.right;
  const fullHeight = height + pad.top + pad.bottom;
  sprite.width = fullWidth;
  sprite.height = fullHeight;
  sprite.anchor.set((pad.left + width / 2) / fullWidth, (pad.top + height / 2) / fullHeight);
}

/** A one-line Figma text in its box (shrinking to the box width), offset by `dx` / `dy`. */
function setText(label: Text, value: string, box: ReadyUiSkinLivesTextBox, align: 'left' | 'center', dx = 0, dy = 0): void {
  if (label.text !== value) label.text = value;
  placeFigmaLabel(label, { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height, align: box.align ?? align });
}

/** A centred text block wrapping at the box width (Figma fixed width, AUTO height); a taller block shrinks into the box. */
function placeWrapped(label: Text, value: string, box: ReadyUiSkinWrappedTextBox, dx = 0, dy = 0): void {
  if (label.text !== value) label.text = value;
  label.scale.set(1);
  label.style.wordWrap = true;
  label.style.wordWrapWidth = box.width;
  label.style.align = 'center';
  if (box.lineHeight !== undefined) label.style.lineHeight = box.lineHeight;
  label.anchor.set(0.5);
  const k = label.height > box.height && label.height > 0 ? box.height / label.height : 1;
  label.scale.set(k);
  label.position.set(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/**
 * Daily Quests (theme_light_11 `screen_daily_quests`): the quest service's day in one window with two states, both
 * chosen by `quests.snapshot()` alone — no second quest logic here.
 *
 * - The LIST: one row per quest of today's set that is not claimed yet (GDD «Получение награды»: a claimed quest leaves
 *   the list), in the snapshot's order (mandatory, group, common). A row: the icon, the name and the task, the progress
 *   bar with `progress / target`, the reward (amount + coin) and the button — Claim for a completed quest (it calls
 *   `quests.claim()`; the row fades out once the service accepted it), GO for an active one (the host's `onGo` after the
 *   window closed; disabled when the host has no route, `canGo`). The rows scroll under the title tape when they do not
 *   fit; the window is as tall as its rows up to the screen.
 * - DONE (GDD «Выполнение всех квестов»): when EVERY quest of the day is claimed — `snapshot.allClaimed`, never merely
 *   completed — the cup, the congratulation and the time until the next set (`msUntilReset`), counted down each second.
 *
 * While it is up the window follows `quests.onChange` and a one-second clock of the host's MotionRuntime (so a new day
 * at local 00:00 shows the new set); both stop when it is hidden or destroyed. It needs a Ready UI style that covers
 * `dailyQuests` (Style 2: theme_light_11's light row) — there is no donor look.
 */
export class DailyQuestsWindowView extends ModalWindow<void> {
  readonly skin: ReadyUiSkin;
  private readonly look: QuestsLook;
  private readonly source: DailyQuestsSource;
  private readonly options: DailyQuestsWindowViewOptions;
  private readonly textLook: FigmaTextLook;
  private readonly labels: Labels;
  private readonly surface: NineSliceSprite;
  private readonly surfaceSpec: NineSliceSpec;
  private readonly titleLabel: Text;
  private readonly listLayer: Container;
  private readonly scrollArea: Container;
  private readonly content: Container;
  private readonly contentMask: Graphics;
  private readonly doneLayer: Container;
  private readonly doneTimer: Text;
  private readonly sparks: SparkleView[];
  private rows: QuestRow[] = [];
  private mode: Mode = 'list';
  private rowsDay: number | null = null;
  private windowH = 0;
  private scrollOffset = 0;
  private scrollMin = 0;
  private dragPointerId: number | null = null;
  private dragLastY = 0;
  private dragMoved = 0;
  private dragVelocity = 0;
  private unsubscribe: (() => void) | null = null;
  private clock: MotionHandle | null = null;
  private sparksLoop: MotionHandle | null = null;
  private syncing = false;
  private syncCount = 0;

  constructor(options: DailyQuestsWindowViewOptions) {
    const skin = selectWindowSkin('dailyQuests', undefined, options.theme?.skin);
    if (!skin) throw new Error("DailyQuestsWindowView: needs a Ready UI style that covers 'dailyQuests' (theme: { skin }) — it has no donor look");
    if (!options.quests || typeof options.quests.snapshot !== 'function' || typeof options.quests.claim !== 'function' || typeof options.quests.onChange !== 'function') {
      throw new TypeError('DailyQuestsWindowView: quests { snapshot, claim, onChange } is required (a QuestService)');
    }
    const look = resolveWindowSkin('DailyQuestsWindowView', 'dailyQuests', skin, options.textures, { variant: false, include: '' });
    super({
      ...options,
      id: options.id ?? 'daily-quests',
      backdropColor: options.backdropColor ?? skin.backdrop.color,
      backdropAlpha: options.backdropAlpha ?? skin.backdrop.alpha
    });
    this.skin = skin;
    this.look = look;
    this.source = options.quests;
    this.options = options;
    const L = look.layout;
    const A = look.art;
    const own = L.text;
    this.textLook = own ? { strokeOutside: own.strokeOutside, shadowY: own.shadowY, ...(own.fill !== undefined ? { fill: own.fill } : {}) } : skinTextLook(skin);
    const legacy = READY_UI_LEGACY_TEXT.quests;
    this.labels = {
      go: localizedText(options.goLabel, this.i18n, 'core.quests.go', legacy.go),
      claim: localizedText(options.claimLabel, this.i18n, 'core.quests.claim', legacy.claim)
    };
    const W = L.window.width;

    this.surfaceSpec = skinNineSlice(skin, 'windowSurface', 'dailyQuests');
    this.surface = createNineSlice(A.windowSurface, this.surfaceSpec, W, L.done.height);
    this.surface.eventMode = 'none';
    this.titleLabel = createFigmaLabel(this.theme, '', L.title.fontSize, skinTextBoxLook(this.textLook, L.title));
    this.titleLabel.eventMode = 'none';
    setText(this.titleLabel, localizedText(options.title, this.i18n, 'core.quests.title', legacy.title), L.title, 'center', -W / 2);

    // the LIST: a static input area over the visible band (drag / wheel anywhere on it) holding the moving rows
    this.listLayer = new Container();
    this.scrollArea = new Container();
    this.scrollArea.eventMode = 'static';
    this.content = new Container();
    this.contentMask = new Graphics();
    this.content.mask = this.contentMask;
    this.scrollArea.addChild(this.content, this.contentMask);
    this.listLayer.addChild(this.scrollArea);
    this.scrollArea.on('pointerdown', this.onPointerDown, this);
    this.scrollArea.on('globalpointermove', this.onPointerMove, this);
    this.scrollArea.on('pointerup', this.onPointerUp, this);
    this.scrollArea.on('pointerupoutside', this.onPointerUp, this);
    this.scrollArea.on('wheel', this.onWheel, this);

    // DONE: glow, rays, cup, stars, the congratulation, the timer panel
    const D = L.done;
    const dx = -W / 2;
    this.doneLayer = new Container();
    this.doneLayer.eventMode = 'none';
    const glow = boxSprite(A.questGlow, D.glow, dx);
    glow.measurable = false;
    this.doneLayer.addChild(glow);
    if (D.rays && A.questRays) {
      const rays = boxSprite(A.questRays, D.rays, dx);
      rays.measurable = false;
      this.doneLayer.addChild(rays);
    }
    this.doneLayer.addChild(boxSprite(A.questCup, D.cup, dx));
    this.sparks = D.sparks.map((spark) => {
      const view = new SparkleView({ texture: A.questSpark, width: spark.size });
      view.position.set(spark.x + dx, spark.y);
      return view;
    });
    for (const spark of this.sparks) this.doneLayer.addChild(spark);
    const wrapped = (value: string, box: ReadyUiSkinWrappedTextBox): Text => {
      const node = createFigmaLabel(this.theme, '', box.fontSize, skinTextBoxLook(this.textLook, box));
      placeWrapped(node, value, box, dx);
      return node;
    };
    this.doneLayer.addChild(
      wrapped(localizedText(options.doneTitle, this.i18n, 'core.quests.done_title', legacy.doneTitle), D.title),
      wrapped(localizedText(options.doneBody, this.i18n, 'core.quests.done_body', legacy.doneBody), D.body)
    );
    const panel = createNineSlice(A.questSlot, skinNineSlice(skin, 'questSlot', 'dailyQuests'), D.panel.width, D.panel.height);
    panel.position.set(D.panel.x + dx + D.panel.width / 2, D.panel.y + D.panel.height / 2);
    this.doneLayer.addChild(panel, boxSprite(A.questTimer, D.timerIcon, dx));
    const nextLabel = createFigmaLabel(this.theme, '', D.nextLabel.fontSize, skinTextBoxLook(this.textLook, D.nextLabel));
    setText(nextLabel, localizedText(options.nextLabel, this.i18n, 'core.quests.next_in', legacy.nextIn), D.nextLabel, 'center', dx);
    this.doneTimer = createFigmaLabel(this.theme, '', D.timer.fontSize, skinTextBoxLook(this.textLook, D.timer));
    this.doneLayer.addChild(nextLabel, this.doneTimer);
    this.doneLayer.visible = false;

    if (this.closeButton) {
      this.closeButton.background.texture = A.windowClose;
      this.closeButton.background.width = L.close.width;
      this.closeButton.background.height = L.close.height;
    }
    // bottom → top: the popup, the list or the done screen, the title over the tape; the × on top (placeClose)
    this.panel.addChildAt(this.surface, 0);
    this.panel.addChild(this.listLayer, this.doneLayer, this.titleLabel);
    this.windowH = this.listHeight();
    this.applyWindowHeight();
    this.layoutPanel();
  }

  /** What the window shows: the quest list, or the all-claimed screen. */
  get screen(): Mode {
    return this.mode;
  }

  /** The rows on screen (quest ids, top to bottom); a row fading out after its claim is not counted. */
  get rowIds(): string[] {
    return this.rows.filter((row) => !row.leaving).map((row) => row.quest.id);
  }

  /** The row of a quest (its GO / Claim button is `row.button`), or null. */
  rowOf(questId: string): { readonly quest: QuestView; readonly button: UiButton } | null {
    return this.rows.find((row) => row.quest.id === questId && !row.leaving) ?? null;
  }

  /** The countdown text of the all-claimed screen. */
  get timerText(): string {
    return this.doneTimer.text;
  }

  /** Content scroll in design units: 0 at the top, negative when scrolled down; `scrollable` = the rows do not fit. */
  get scrollY(): number {
    return this.scrollOffset;
  }

  get scrollable(): boolean {
    return this.scrollMin < 0;
  }

  /** The UiRuntime the rows' buttons register with. */
  get uiRuntime(): ModalWindowOptions['ui'] {
    return this.ui;
  }

  textFor(key: string, quest: QuestView): string {
    if (this.options.text) return this.options.text(key, quest);
    return this.i18n ? this.i18n.t(key) : key;
  }

  progressFor(quest: QuestView): string {
    return this.options.progressText ? this.options.progressText(quest) : questProgressText(quest);
  }

  iconFor(quest: QuestView): Texture | null {
    return this.options.questIcon?.(quest) ?? null;
  }

  rewardIconFor(reward: QuestReward): Texture | null {
    return this.options.rewardIcon?.(reward) ?? null;
  }

  goAllowed(quest: QuestView): boolean {
    return this.options.canGo?.(quest) === true;
  }

  protected applyParams(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.source.onChange(() => this.sync(true));
    this.rowsDay = null; // a fresh list on every show
    this.scrollOffset = 0;
    this.sync(false);
    this.armClock();
  }

  protected override onHiddenView(_reason: WindowHiddenReason): void {
    this.stopLive();
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return;
    this.stopLive();
    this.scrollArea.off('pointerdown', this.onPointerDown, this);
    this.scrollArea.off('globalpointermove', this.onPointerMove, this);
    this.scrollArea.off('pointerup', this.onPointerUp, this);
    this.scrollArea.off('pointerupoutside', this.onPointerUp, this);
    this.scrollArea.off('wheel', this.onWheel, this);
    for (const row of this.rows) row.destroy();
    this.rows = [];
    super.destroy(options);
  }

  /** The window's box: its top at the panel origin, growing downwards (the tape and the × above it are outside). */
  protected override panelBounds(): Rectangle {
    const L = this.look?.layout;
    if (!L) return super.panelBounds();
    return new Rectangle(-L.window.width / 2, 0, L.window.width, Math.max(1, this.windowH));
  }

  protected override closeButtonPosition(): { x: number; y: number } {
    const L = this.look?.layout;
    if (!L) return super.closeButtonPosition();
    return { x: L.close.x + L.close.width / 2 - L.window.width / 2, y: L.close.y + L.close.height / 2 };
  }

  /**
   * One scale for both states, independent of the row count: the style frame's contain fit, raised up to the scale at
   * which `minHeight` of the window fills the screen (a short landscape viewport keeps readable rows that scroll),
   * never more than twice the frame fit. The list is as tall as its rows up to the screen; the all-claimed screen
   * keeps its height and shrinks when the screen is shorter. The window (tape and × included) is centred.
   */
  protected override layoutPanel(): void {
    const look = this.look;
    if (!look) {
      super.layoutPanel();
      return;
    }
    const L = look.layout;
    this.placeClose();
    const safe = this.safeArea();
    const frame = this.skin.frame;
    const W = L.window.width;
    const top = this.windowTop();
    const frameScale = Math.min(safe.width / frame.width, safe.height / frame.height);
    const readable = Math.min((safe.width * 0.92) / W, (safe.height * 0.92) / (L.minHeight - top));
    let scale = Math.max(frameScale, Math.min(readable, frameScale * 2));
    const room = (safe.height * 0.92) / scale + top; // window units below the window top that fit on screen
    if (this.mode === 'done') {
      this.windowH = L.done.height;
      if (L.done.height - top > (safe.height * 0.92) / scale) scale = (safe.height * 0.92) / (L.done.height - top);
    } else {
      this.windowH = Math.max(L.list.y + L.list.bottom, Math.min(this.listHeight(), room));
    }
    this.applyWindowHeight();
    const height = this.windowH - top;
    const x = safe.x + safe.width / 2;
    const y = safe.y + safe.height / 2 - (top + height / 2) * scale;
    this.setIdle(x, y, scale);
    applyTextResolution(this.panel, scale * this.pixelRatio);
  }

  /** Re-reads the snapshot: the state, the rows (in place), the timer. `animate` = a change while open (a claim). */
  private sync(animate: boolean): void {
    if (this.syncing || this.destroyed) return;
    this.syncing = true;
    this.syncCount++;
    try {
      const snapshot = this.source.snapshot();
      const mode: Mode = snapshot.allClaimed ? 'done' : 'list';
      const modeChanged = mode !== this.mode;
      this.mode = mode;
      this.listLayer.visible = mode === 'list';
      this.doneLayer.visible = mode === 'done';
      if (mode === 'list') this.syncRows(snapshot, animate && !modeChanged && snapshot.day === this.rowsDay);
      else this.clearRows();
      this.rowsDay = snapshot.day;
      this.updateTimer(snapshot);
      if (modeChanged || !animate) this.layoutPanel();
      if (mode === 'done' && this.visible) this.startSparks();
      else this.stopSparks();
      if (modeChanged && mode === 'done' && animate) this.fadeIn(this.doneLayer);
    } finally {
      this.syncing = false;
    }
  }

  private syncRows(snapshot: QuestSnapshot, animate: boolean): void {
    const L = this.look.layout;
    const visible = snapshot.quests.filter((quest) => quest.state !== 'claimed');
    if (!animate) this.clearRows();
    const kept: QuestRow[] = [];
    for (const quest of visible) {
      let row = this.rows.find((candidate) => candidate.quest.id === quest.id && !candidate.leaving);
      if (!row) {
        row = new QuestRow(this, L.row, this.look.art, this.skin, this.textLook, quest, (id) => this.onRowAction(id));
        row.position.set(L.list.x - L.window.width / 2, L.list.y + kept.length * (L.row.height + L.list.gap));
        this.content.addChild(row);
      }
      row.update(quest, this.labels);
      kept.push(row);
    }
    // rows no longer listed: a claimed one fades out (a claim while open), anything else goes at once
    for (const row of this.rows) {
      if (kept.includes(row) || row.leaving) continue;
      const claimed = snapshot.quests.find((quest) => quest.id === row.quest.id)?.state === 'claimed';
      if (animate && claimed) this.leave(row);
      else row.destroy();
    }
    this.rows = [...kept, ...this.rows.filter((row) => row.leaving && !row.destroyed)];
    const targets = kept.map((_, i) => L.list.y + i * (L.row.height + L.list.gap));
    if (!animate) {
      kept.forEach((row, i) => (row.y = targets[i]!));
      return;
    }
    const toH = this.targetListHeight();
    const moves = kept.some((row, i) => Math.abs(row.y - targets[i]!) > 0.01) || Math.abs(this.windowH - toH) > 0.01;
    if (!moves) return;
    // the rows close the gap together and the window's bottom follows its last row (its top stays where it is)
    this.motion.cancelScope(`${this.id}:reflow`);
    const from = kept.map((row) => row.y);
    const fromH = this.windowH;
    let progress = 0;
    const apply = (): void => {
      kept.forEach((row, i) => {
        if (!row.destroyed) row.y = from[i]! + (targets[i]! - from[i]!) * progress;
      });
      this.windowH = fromH + (toH - fromH) * progress;
      this.applyWindowHeight();
    };
    this.motion.tween({
      scope: `${this.id}:reflow`,
      bindings: [{ get: () => progress, set: (value: number) => (progress = value), to: 1, from: 0 }],
      durationMs: LEAVE_MS,
      ease: 'easeOut',
      onUpdate: apply,
      onCancel: () => {
        progress = 1;
        apply();
      }
    });
  }

  private leave(row: QuestRow): void {
    row.leaving = true;
    row.button.controller.cancel();
    row.button.setEnabled(false);
    row.button.alpha = 1;
    const startScale = row.scale.x;
    this.motion.tween({
      scope: `${this.id}:list`,
      bindings: [
        { get: () => row.alpha, set: (value: number) => (row.alpha = value), to: 0 },
        { get: () => row.scale.x, set: (value: number) => row.scale.set(value), to: startScale * 0.94 }
      ],
      durationMs: LEAVE_MS,
      ease: 'easeIn',
      onComplete: () => this.dropRow(row),
      onCancel: () => this.dropRow(row)
    });
  }

  private dropRow(row: QuestRow): void {
    this.rows = this.rows.filter((candidate) => candidate !== row);
    if (!row.destroyed) row.destroy();
  }

  private clearRows(): void {
    this.motion.cancelScope(`${this.id}:reflow`);
    this.motion.cancelScope(`${this.id}:list`);
    for (const row of this.rows) if (!row.destroyed) row.destroy();
    this.rows = [];
  }

  private onRowAction(questId: string): void {
    const row = this.rows.find((candidate) => candidate.quest.id === questId && !candidate.leaving);
    if (!row || this.state !== 'shown') return;
    const quest = row.quest;
    if (quest.state === 'completed') {
      const before = this.syncCount;
      const result = this.source.claim(quest.id);
      if (result.ok) this.options.onClaimed?.(quest, result);
      // the service's change event re-rendered the list; without one (a refused claim) the row stays as it is
      if (this.syncCount === before) this.sync(true);
      return;
    }
    if (quest.state === 'active' && this.goAllowed(quest)) {
      const onGo = this.options.onGo;
      this.close('button', () => onGo?.(quest));
    }
  }

  /** The list window's full height: the rows plus the space above and under them. */
  private listHeight(): number {
    const L = this.look?.layout;
    if (!L) return 1;
    const count = this.rows.filter((row) => !row.leaving).length;
    return L.list.y + (count > 0 ? count * L.row.height + (count - 1) * L.list.gap : 0) + L.list.bottom;
  }

  /** The list height the current layout settles at (capped by the screen like layoutPanel). */
  private targetListHeight(): number {
    const L = this.look.layout;
    const scale = this.fitScale > 0 ? this.fitScale : 1;
    const top = this.windowTop();
    const room = (this.safeArea().height * 0.92) / scale + top;
    return Math.max(L.list.y + L.list.bottom, Math.min(this.listHeight(), room));
  }

  /** Where the window's art starts above its box (the title tape in the popup's pad, the ×). */
  private windowTop(): number {
    const L = this.look.layout;
    return Math.min(-(this.surfaceSpec.pad?.top ?? 0), L.close.y);
  }

  /** The popup at the window height (and the tap area with it); the list's visible band, its mask and scroll range. */
  private applyWindowHeight(): void {
    const L = this.look?.layout;
    if (!L) return;
    const W = L.window.width;
    resizeNineSliceHeight(this.surface, this.surfaceSpec, W, this.windowH);
    this.surface.position.set(0, this.windowH / 2);
    const top = this.windowTop();
    this.panel.hitArea = new Rectangle(-W / 2, top, W, this.windowH - top);
    const C = L.list.clip;
    const band = { x: -W / 2 + C.left, y: C.top, width: W - C.left - C.right, height: Math.max(1, this.windowH - C.top - C.bottom) };
    this.contentMask.clear().rect(band.x, band.y, band.width, band.height).fill({ color: 0xffffff });
    this.scrollArea.hitArea = new Rectangle(band.x, band.y, band.width, band.height);
    const count = this.rows.filter((row) => !row.leaving).length;
    const rowsBottom = L.list.y + (count > 0 ? count * L.row.height + (count - 1) * L.list.gap : 0);
    this.scrollMin = Math.min(0, this.windowH - L.list.bottom - rowsBottom);
    this.setScroll(this.scrollOffset);
  }

  private setScroll(value: number): void {
    this.scrollOffset = Math.max(this.scrollMin, Math.min(0, value));
    this.content.y = this.scrollOffset;
  }

  private updateTimer(snapshot: QuestSnapshot): void {
    const D = this.look.layout.done;
    const text = snapshot.msUntilReset === null ? '' : formatTimer(Math.ceil(snapshot.msUntilReset / 1000));
    setText(this.doneTimer, text, D.timer, 'center', -this.look.layout.window.width / 2);
  }

  /** The one-second clock of the host's MotionRuntime, re-armed to the next whole second of the countdown. */
  private armClock(): void {
    this.clock?.cancel();
    const ms = this.source.snapshot().msUntilReset;
    const durationMs = ms === null ? 1000 : (ms % 1000) + 1;
    this.clock = this.motion.delay({
      scope: `${this.id}:clock`,
      durationMs,
      onComplete: () => {
        this.clock = null;
        if (!this.visible || this.destroyed) return;
        this.sync(true);
        this.armClock();
      }
    });
  }

  private startSparks(): void {
    if (this.sparksLoop || !this.sparks.length) return;
    const S = DAILY_QUESTS_SPARKS_LOOP;
    this.sparksLoop = playSparkleLoop(this.motion, this.sparks, {
      loopMs: S.loopMs,
      delayMs: S.delayMs,
      flashes: this.sparks.map((_, i) => ({ sparkle: i, atMs: i * S.stepMs })),
      scope: `${this.id}:decor`
    });
  }

  private stopSparks(): void {
    const loop = this.sparksLoop;
    this.sparksLoop = null;
    loop?.cancel();
  }

  private fadeIn(target: Container): void {
    target.alpha = 0;
    this.motion.tween({
      scope: `${this.id}:list`,
      bindings: [{ get: () => target.alpha, set: (value: number) => (target.alpha = value), to: 1 }],
      durationMs: 240,
      ease: 'easeOut',
      onCancel: () => (target.alpha = 1)
    });
  }

  /** Everything that runs while the window is up: the subscription, the clock, the stars, a fling, the row motion. */
  private stopLive(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clock?.cancel();
    this.clock = null;
    this.stopSparks();
    this.motion.cancelScope(`${this.id}:scroll`);
    this.motion.cancelScope(`${this.id}:reflow`);
    this.motion.cancelScope(`${this.id}:list`);
    this.dragPointerId = null;
    for (const row of this.rows) if (!row.destroyed) row.button.controller.cancel();
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    this.motion.cancelScope(`${this.id}:scroll`);
    if (!this.scrollable || this.dragPointerId !== null) return;
    this.dragPointerId = event.pointerId;
    this.dragLastY = event.global.y;
    this.dragMoved = 0;
    this.dragVelocity = 0;
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    const dy = event.global.y - this.dragLastY;
    this.dragLastY = event.global.y;
    this.dragMoved += Math.abs(dy);
    this.dragVelocity = this.dragVelocity * 0.6 + dy * 0.4;
    if (this.dragMoved > DRAG_THRESHOLD) {
      // a drag cancels any row press, so the release is never a claim or a GO
      for (const row of this.rows) row.button.controller.cancel();
      this.setScroll(this.scrollOffset + dy / this.fitScale);
    }
  }

  private onPointerUp(event: FederatedPointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
    if (this.dragMoved <= DRAG_THRESHOLD || Math.abs(this.dragVelocity) < 1) return;
    const target = Math.max(this.scrollMin, Math.min(0, this.scrollOffset + (this.dragVelocity * 25) / this.fitScale));
    this.motion.tween({
      scope: `${this.id}:scroll`,
      bindings: [{ get: () => this.scrollOffset, set: (value: number) => this.setScroll(value), to: target }],
      durationMs: 800,
      ease: 'easeOut'
    });
  }

  private onWheel(event: FederatedWheelEvent): void {
    if (!this.scrollable) return;
    this.motion.cancelScope(`${this.id}:scroll`);
    this.setScroll(this.scrollOffset - event.deltaY / this.fitScale);
  }
}

