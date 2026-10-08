# GAME_CORE_CURRENT

_Обновлено: 2026-10-08, после завершения Claude UI slice `d8156e6` (четверг, UTC+7)_

Каноническое **текущее** инженерное состояние Game Core и активной интеграции Puzzle Drop. Это не полный исторический журнал: история остаётся в `git log`, полном handoff-файле и командных переписках. Здесь остаются факты, которые влияют на текущие архитектурные, продуктовые и roadmap-решения.

**Статус на момент обновления:** Claude закончил Core UI slice и сделал **локальный** commit `d8156e6`. Его тесты/скриншоты приведены **по финальному отчёту Claude**, не по независимой проверке владельцем. Владелец ещё **не принял визуально** этот commit, **не пушил** его и **не repin'ил Puzzle**. Pushed/accepted Core baseline — `7ac6b42`; Puzzle по-прежнему `4d75c7c` с pin `7ac6b42`.

---

## 1. Миссия и главный принцип

Game Core — единый production SDK / production kernel для HTML5/web-игр команды.

Целевой поток:

**готовый gameplay → минимальный neutral host seam → pinned Game Core → config/meta → QA build → production build**

Game-specific gameplay остаётся game-owned. Core не должен становиться gameplay engine.

Главный принцип:

**generic bug / generic mechanic исправляется один раз в Core, затем контролируемо раскатывается по играм через exact pin/repin. Никакого silent latest.**

Проверка архитектуры теперь идёт не только на SoliPix: Puzzle Drop стала второй независимой production-интеграцией и уже выявила реальные gaps Core.

---

## 2. Текущий Game Core baseline

Repository:

`~/Desktop/games-workspace/game-core`

Branch:

`feat/production-profile-v1`

### Accepted / pushed baseline

**`7ac6b42`** — принят пользователем вручную, запушен и используется Puzzle через clean vendor clone/exact pin. Новейший локальный коммит `d8156e6` его **не заменяет до ручной приёмки**.

В цепочке принятого baseline важны:

| Commit | Capability |
|---|---|
| `75d974c` | единый `LevelMapScreen` contract для Style 1 + Style 2: select level → PLAY → `onPlay(level)`, bottom nav `SHOP | HOME | LOCK`; Style 1 получил собственные theme art/PLAY/nav |
| `b3eb4d6` | generic Moves foundation: `LevelBalance`, `LevelBalanceSource`, `MoveRuntime`, static/server-ready source seam, snapshot/restore |
| `f034339` | звёзды `0..3` по абсолютным thresholds remaining moves; `baseCoinReward`; `coinRewardForStars()` с 25/50/75/100%, округление вверх |
| `46a7d54` | contract cleanup: stars — качество победы, а не факт completion; победа с `0★` валидна |
| `7ac6b42` | bounded motion polish: PLAY breathing, HUD gain/spend feedback, LOCK shake |

На `7ac6b42` были зелёные Core tests/build/guards; известные базовые DTS diagnostics остаются только в `hud.test.ts:259` и `winConfetti.test.ts:393`.

### Latest local Core UI commit — ждёт ручной приёмки

**`d8156e6` — `feat(pixi): sync Result, Moves, settings button and No Ads with theme_light_6`**.

- Branch: `feat/production-profile-v1`.
- **COMMITTED LOCALLY: YES. PUSHED: NO. ACCEPTED: NOT YET.**
- Figma scope: **только `theme_light_6` / `28:45250`**.
- Добавлено/изменено: style-specific WIN для двух стилей, новый `MovesView`, новый `SettingsButtonView` и контракт layout, No Ads для двух стилей, focused Gallery proof.
- Style 2 FAIL собран временно из Style 2 деталей, поскольку отдельного FAIL-макета в `theme_light_6` нет.
- **Shop не синхронизирован:** Figma Shop — немодальный tab/screen с навигацией снизу; старый Core `ShopWindowView` — modal. Нужен самостоятельный архитектурный slice, а не косметическая подмена.
- По отчёту Claude: **1473/1473 тестов** (было 1447; +26), build OK, 4 guards PASS, DTS без новых диагностик (два известных выше).
- По отчёту Claude: **33 Gallery screenshots**, полный focused 390×844 пакет (оба стиля, WIN 0–3★, FAIL, Moves 38/10/1/0, No Ads, меню), частичный 320×568 / 1280×800, без ошибок консоли; нет нового pixel-perfect сравнения с HEAD.
- `git status --short` после commit по отчёту: **` M GAME_CORE_CURRENT.md`** (owner-controlled, не входил в commit). Это *не* означает полностью чистое рабочее дерево.
- **READY TO REPIN (по Claude) ≠ APPROVED TO REPIN:** repin только после ручной проверки и push владельцем.

---

## 3. Core architecture — подтверждённая поверхность

Основные runtime / production capabilities:

- `CoreRuntime`
- `UiRuntime`
- `MotionRuntime`
- `FxRuntime`
- `GameplayContract V1`
- `GameProductionProfile V1`
- `SaveGate`
- `SoftCurrencyWallet`
- `PurchaseRuntime` / `PurchaseLedger`
- `AdsRuntime` / Ads policy
- `AnalyticsRuntime`
- `PlatformRuntime`
- `LivesRuntime V1.1`
- `ContinueOfferRuntime V1.1`
- `MoveRuntime`
- `LevelBalance` / `LevelBalanceSource`
- `starsForMovesLeft()`
- `coinRewardForStars()`
- QA Runtime / QA Panel с физическим QA/RELEASE разделением
- DEV, Yandex, CleverApps/Facebook foundation

Core остаётся renderer/gameplay-agnostic там, где это возможно. Moves runtime знает только limit/used/added/remaining/exhausted; решение WIN/FAIL принимает host после завершения gameplay action.

---

## 4. Moves / stars / reward contract

### LevelBalance

Для limited level:

- `progressionKey`
- `sourceLevelId?`
- `moveLimit`
- `star3MinMovesLeft`
- `star2MinMovesLeft`
- `star1MinMovesLeft`
- `baseCoinReward?`

Validation:

`0 <= star1 <= star2 <= star3 <= moveLimit`

`moveLimit: null` = unlimited, для stars нужен explicit policy.

### MoveRuntime

- `start(balance)`
- `consume(count=1)`
- `add(count)`
- `end()`
- `snapshot()` / `restore()`
- extra moves увеличивают remaining, но **не изменяют thresholds исходного LevelBalance**;
- при remaining=0 runtime не решает FAIL автоматически; host ждёт gameplay settle и проверяет WIN first.

### Stars

`starsForMovesLeft()` возвращает `0 | 1 | 2 | 3`.

Пример Артёма:

- moveLimit 40
- remaining >= 30 → 3★
- >=20 → 2★
- >=10 → 1★
- <10 → 0★

Extra moves участвуют в remaining. Победа с 0★ остаётся completion.

### Dynamic coin policy — capability Core

`coinRewardForStars(N, stars)`:

- 3★ → N
- 2★ → ceil(3/4 N)
- 1★ → ceil(2/4 N)
- 0★ → ceil(1/4 N)

Но **Puzzle baseline сейчас использует правило Олега: first WIN = 5 coins**. Rewarded WIN = 50 зафиксирован как будущий config/seam, но не подключён. Star-tiered policy готова и может быть включена после финального GDD Артёма.

---

## 5. Ready UI / Figma — current source of truth

Production UI остаётся asset-based + 9-slice; dynamic/localized text — runtime text.

### Единственный актуальный дизайн для новых изменений

Figma file:

`https://www.figma.com/design/5FWFwdO4QGeDfeQtloLNOS/Untitled`

**Current source of truth: `theme_light_6`, node `28:45250`.**

`theme_light_5` (`24:35889`) — предыдущий snapshot, для новых правок не использовать. Старые theme_light_1..4 пользователь удалил из рабочей Figma, чтобы не засорять файл.

Mapping:

- **Style 2 = light**
- **Style 1 = dark/purple**

Ключевые `theme_light_6` nodes:

- gameplay light / Style 2: `28:48114`
- gameplay dark / Style 1: `28:48205`
- main menu / LevelMap light: `28:48400`
- main menu / LevelMap dark: `28:48486`
- WIN light: `28:48352`
- WIN dark: `28:48286`
- No Ads light: `28:48041`
- No Ads dark: `28:48065`
- Piggy Bank light: `28:47955`
- Piggy Bank dark: `28:48017`
- Daily Tasks light: `28:47989`
- Daily Tasks dark: `28:48003`
- market light family: `28:46095` / related
- market dark family: `28:46015` / related
- gameplay MOVES text refs: light `28:48179`, dark `28:48251`

В gameplay Figma также видны:

- компактная MOVES panel;
- блок текущих звёзд;
- locked `Lv7` element;
- boosters;
- варианты MOVES со следами ног вне основного gameplay — считать draft/animation exploration, пока художница не подтвердит смысл.

### `d8156e6`: точный UI contract, известные отличия, ограничения

**Result WIN**

- Style 1 (dark), Figma `28:48286`: прежний арт ленты/монеты/кнопок, новая раскладка под центр x=540; Figma PC композиция смещена (лента x=612.5). Нет свечения; чёрный крестик 45%; кнопки 440×200 и 460×200 — по отчёту Claude.
- Style 2 (light), Figma `28:48352`: свой красный баннер, лучи, `icon_star`, монета, число с обводкой, зелёная/жёлтая кнопки. **Известные отклонения:** добавлен красный крестик над концом ленты (в Figma его нет), боковые звёзды без наклона 30°. Проверить при ручной приёмке, не выдавать за pixel-perfect.
- Style 2 FAIL: временная сборка из Style 2 арта без отдельного актуального Figma-макета. Не считать окончательным решением художницы.
- `WinStars`/fireworks/confetti совместимы в **Core Gallery** по тесту/отчёту Claude, но их реальный вызов в **Puzzle** остаётся непроверенным и ранее не отображался.

**MovesView**

- Отдельный визуальный компонент (`setRemaining`, `show`, `hide`), не владеет `MoveRuntime` и не знает game rules.
- Style 1: белая панель/жёлтое число с обводкой, Figma `28:48247`. Style 2: синяя панель/белый текст, Figma `28:48175`.
- 4 footprint-варианта задокументированы, **не анимированы**; значение/семантика ждут ответа художницы. `28:48272` фактически копия обычной панели.

**SettingsButtonView**

- Новый art/layout contract: кнопка 214, якорь верхний правый угол, отступы 90/90 в Figma-координатах; источники `28:48211` / `28:48119`.
- У `theme_light_6` main-menu нет собственной кнопки Settings: шестерёнка LevelMap HUD не переделывалась.
- Перестановка кнопки под HUD на узком телефоне показана **только в Gallery demo**; production-host обязан задать корректные `insets`, это не универсальный авто-layout Core.

**No Ads**

- Figma `28:48065` dark и `28:48041` light: оба используют фиолетовое окно с лучами, но собственные крестики, картинки, шрифты/детали.
- Существующие callbacks и параметры сохранены; `coinPrice?` необязателен, без него coin-icon на кнопке не появляется (возможно real-money price, нельзя угадывать SKU/сумму).
- Известные отличия: PoetsenOne заменён на Carlito; Style 1 розовый градиент заменён flat color; блёстки/мягкая тень заголовка не реализованы. Донорский вид не изменён.
- Новый арт в Core **не означает**, что в Puzzle уже есть работающий entry/entitlement flow.

### Existing motion

Ранее принятые и входящие в pushed baseline `7ac6b42`:

- modal open/close;
- button press/release;
- WIN stars + confetti/firework effect;
- PLAY breathing opt-in;
- HUD gain/spend feedback opt-in;
- LOCK shake.

---

## 6. Puzzle Drop — current production integration

Repository:

`~/Desktop/games-workspace/puzzle-core-clean`

Branch:

`integration/game-core`

Fresh Oleg source:

`~/Desktop/games-workspace/puzzle_drop_source_2026-10-07`

Old donor/source:

`~/Desktop/games-workspace/puzzle_game_source_2026-10-02_v2`

### Upstream/history separation

- `d2b94c2` — old 2026-10-02 source import
- `6ff9510` — pure Oleg 2026-10-07 upstream commit on `upstream/oleg`
- `fcc7670` — merge fresh Oleg gameplay into Game Core integration
- `c92bab5` — neutral gameplay host hooks (`GameScene.ts` only)
- `d9cf774` — neutral host input gates for moves/wand
- `cbf1192` — encrypted bounded Yandex/Facebook packaging fix
- `c273bbe` — repin Puzzle to Core `7ac6b42`
- `4d75c7c` — Puzzle moves/meta integration

No remote/push workflow for Puzzle is established yet. Plan: Oleg creates private Git repo with current 07.10 source in `main`, adds user as collaborator/write; user's `integration/game-core` remains integration branch. Neutral gameplay hook commits are intended to be cherry-picked/merged back into Oleg main so future upstream versions retain the integration seam.

### Oleg 07.10 gameplay changes

- product rename → Puzzle Drop;
- board starts empty, cards drop/deal from decks;
- wand/magic assembles a whole picture;
- deferred hint/wand execution after animations;
- praise after each assembled picture;
- new sounds;
- redraw-on-change optimization (`Redraw.ts`);
- production content encryption for pictures + `levels.json`;
- save key changed to `puzzle_drop.save.v1`;
- `fflate`, `tools/contentPack.ts`, `content.key`;
- 24k level pictures remained byte-identical.

### Neutral gameplay host seam

`c92bab5` exposes no Game Core imports:

- `onPlayerMove(info)` — only accepted player move;
- `onBoardSettled({...info, won})` — after action/animations settle, WIN is known;
- `onMagicUsed(info)` — wand usage, does not count as move.

`d9cf774` adds neutral questions:

- `canPlayerMove()`
- `canUseMagic()`

This closes the exploit where extra drags could occur after the last allowed move while animations were still running, and allows delayed wand to be blocked safely at 0 moves.

These commits are intentionally small and should be returned to Oleg's main once Git collaboration is configured.

---

## 7. Puzzle current playable meta flow (`4d75c7c`)

### Balance

Static source: `level-balance.provisional.json`, version `provisional-qa-v1-sim-L100x6`.

Coverage: first 100 progression entries. Position/index is key, not raw level id, because ids repeat.

Provisional generation:

- real `Board`, no rendering;
- first 100 levels × 4 difficulty variants × 6 seeds;
- bounded run ~4.6 min;
- heuristic "reasonable player" chooses picture-completing/largest-group moves + 10% random;
- no wand;
- provisional thresholds derived from median/P90; final tuning belongs to Artem/GDD.

Current limits roughly 47–117, median ~65.

### Attempt/lives

- max/start lives: 5;
- +1 each 30 min;
- PLAY/new attempt spends 1;
- WIN refunds life;
- FAIL/exit no refund;
- Restart = new attempt = spend another life;
- reload during active attempt currently returns to map/lobby and spent life remains spent; board state is not reconstructed because fresh 07.10 gameplay does not implement party-state persistence yet.

### Moves

- successful player drag → `consume(1)`;
- invalid/drop-back → no spend;
- wand → no move spend;
- remaining 0 → block new moves/wand, wait `onBoardSettled`;
- if `won=true` → WIN wins over FAIL;
- otherwise → temporary No Moves flow.

### No Moves — TEMP

Current temporary UI: Core Confirm-like window without final art.

- TEMP continue: free `+5` from config;
- thresholds do not change;
- close/give up → final FAIL;
- actual coins/rewarded Continue waits for GDD / booster integration.

### FAIL

Core Result FAIL:

- life stays lost;
- RETRY/new attempt spends another life;
- exit → map.

### Stars

Only Core `starsForMovesLeft()`.

- 0/1/2/3 supported;
- best result stored;
- 0★ win is still completed.

### Coins

Active baseline per Oleg:

- first completion WIN = +5 coins;
- replay reward disabled;
- rewarded 50 only config/seam, not active;
- star-tiered policy is available in Core but not active until product decision.

### Save

Core record still currently named `puzzle_game.core` and stores:

- lives;
- wallet;
- best stars;
- active moves snapshot / progression info.

Fresh gameplay key is `puzzle_drop.save.v1`.

Name alignment of the Core record can be decided before release; do not casually migrate without compatibility plan.

---

## 8. Puzzle encrypted production packaging

Commit `cbf1192` repaired packers after Oleg's encrypted content pipeline.

Shared subset logic:

`tools/game-core/content-subset.mjs`

Production flow:

full source levels → first N progression entries → required encrypted assets → rebuild encrypted subset `index.bin` with existing cipher/key → platform ZIP.

Rules:

- keep encryption;
- no plaintext `levels.json`/level pictures in final ZIP;
- do not invent second crypto system;
- use same `content.key` deterministically;
- select by progression position, not raw id;
- package fails loudly for missing/mismatched assets;
- same shared subset seam for Yandex/Facebook.

Current Puzzle Yandex candidate:

`release/yandex/puzzle-yandex-draft-L100-4d75c7c-core-7ac6b42.zip`

- 100 progression levels;
- ZIP ~93.24 MB;
- unpacked ~94.37 MB;
- 1450 files;
- encrypted content;
- final smoke: **40/40 PASS**;
- no debug globals;
- Yandex SDK/save/gameplay lifecycle exercised.

Boundary behavior: level 101 wraps content to level 1 in bounded L100 build. Acceptable for current QA draft; production boundary policy remains to be decided.

---

## 9. Manual Puzzle QA on 2026-10-08 — P0/P1 и связь с Core UI slice

Автотесты старого Puzzle candidate проходили, но ручной тест владельца обнаружил продуктовые/UI gaps. **Они остаются открытыми в Puzzle commit `4d75c7c` независимо от появления `d8156e6` в Core.**

| Gap | Состояние после `d8156e6` |
|---|---|
| Style 2 показывал Style 1 WIN | **Core candidate** теперь содержит отдельный Style 2 WIN; в Puzzle ещё нет repin/проверки фактического выбора скина |
| В настоящем Puzzle WIN не видно fireworks/confetti | Core Gallery FX по отчёту совместимы, **Puzzle wiring ещё не исправлен / не проверен** |
| Completed-level replay отсутствует | **Открыто в Puzzle:** selection/PLAY не позволяют переиграть завершённое для улучшения звёзд |
| Settings неправильной формы/слева | В Core candidate есть `SettingsButtonView`, **Puzzle host integration/anchor ещё нужно обновить** |
| Bottom `SHOP` не работает | **Открыто:** требуется отдельный Core `ShopScreen` / tab ownership slice или bounded архитектурно корректное решение |
| Coin HUD без `+` входа в магазин | **Открыто:** должен вести в тот же Shop |
| No Ads / offer exposure неполный | Новый Core UI существует, **Puzzle entry/entitlement wiring не готов**, не выдумывать purchase products |
| Style 2 total stars на LevelMap | Проверить Figma `theme_light_6`; если присутствует и отсутствует в Puzzle, внести в bounded integration |

Replay required for future stars-gate/biomes (GDD ещё готовится): tap completed node → select → PLAY exact progression level → обычная трата жизни → best stars only improve → current progression не откатывается → first-WIN +5 повторно не платится, replay reward 0 до нового product config.

Приёмка: **owner manual visual/product QA обязательна**, automation = регрессионная страховка. Появление локального Core commit не закрывает Puzzle P0 автоматически.

---

## 10. Tester Evgeny — QA state

### Game Core Gallery

Separate Game Core UI Gallery Yandex QA build was successfully accepted by Yandex draft moderation and sent to tester Evgeny.

The gallery line proved isolated Core UI independent of Puzzle/PixSol.

### Evgeny's UI comparison report

Spreadsheet:

`Сравнение_интерфейсов_Стрелка3Д_ПикСол.xlsx`

Evgeny compared Arrow3D/PixSol screens and flagged areas such as:

- missing total-stars counter on LevelMap;
- inconsistent HUD icon sizing;
- Settings size/text/button differences;
- Lives window sizing/text, missing refill-for-coins / rewarded-life buttons;
- Shop visual/size/card/close differences;
- different product pack quantities/prices.

Interpretation rule now:

**Do not blindly make Style 2 equal Style 1/Arrow.** The report is a checklist of suspicious areas; every visual is now judged against its own `theme_light_6` light/dark source. Product/economy differences are not automatically UI bugs.

Important current follow-up candidates from the report:

- Style 2 LevelMap total stars if shown in `theme_light_6`;
- proper style-specific Shop;
- correct Settings/Lives per each style;
- Shop entry points;
- HUD consistency.

---

## 11. Team product decisions / conversations

### Oleg

Current product/engineering direction:

- Puzzle should use Game Core meta, not copy Jigsaw meta;
- current Puzzle reward baseline: **5 coins per normal level completion; rewarded path intended as 50 coins** (borrowed from Arrow/old engine baseline);
- No Moves → if not win, loss flow is conceptually straightforward; relevant UI exists in Figma;
- saving tab-exit state is technically feasible according to Oleg, but the actual 07.10 source delivered does not yet contain board-state save/resume;
- Oleg wants Game Core/Puzzle proof in Yandex and next game (Arrow3D) should integrate much faster;
- shared private Git repo is desired so Oleg can push fresh gameplay and user can pull/merge; neutral host hooks should be returned to Oleg main.

### Artem (game designer)

Confirmed:

- every level has N moves;
- 0/1/2/3 stars depend on absolute remaining-move thresholds configured per level;
- extra moves obtained after exhaustion DO participate in remaining moves and can improve star tier; thresholds themselves stay constant;
- wand is a booster/resource and **does not spend a move**; no per-level use cap, only inventory quantity;
- Restart spends a life;
- desired No Moves UX: offer extra moves for coins or rewarded ad; decline → FAIL/lost attempt;
- temporary placeholder is acceptable while full GDD is being written;
- dynamic coin reward proposal: per-level N split by star tiers 25/50/75/100%, rounded up; Core supports this but Puzzle active baseline remains Oleg's fixed 5 until product decision;
- future progression idea accepted by Oleg: batches/biomes can require N total stars, forcing replay of old levels to improve stars; Artem will prepare GDD;
- tutorial/first-level special rule is not finalized yet.

Artem also delivered documents for boosters and Piggy Bank.

### Booster GDD direction

Generic booster concept:

- booster has charge inventory;
- use with charge → spend 1 charge and apply;
- zero charge → acquisition popup via coins or rewarded when available;
- after acquiring charge, booster applies immediately;
- Extra Moves booster example/default: +5 moves; config-driven; current TEMP free +5 should later migrate onto this real booster/continue flow.

### Piggy Bank GDD direction

Concept already described enough for later runtime design:

- extra portion of earned coins accumulates in bank;
- normal level reward still goes to player;
- bank has capacity / levels;
- purchase becomes available from ~50% fill;
- at full capacity accrual stops;
- buying grants bank contents, resets cycle, next bank level/capacity can increase;
- LevelMap icon/progress + dedicated popup + coin-to-bank FX are envisioned;
- actual payment/SKU/price/final percentages and complete production integration are not yet frozen.

**Piggy Bank must NOT block Friday Puzzle demo.**

### Artist

Latest work is in `theme_light_6` and includes:

- final-ish Moves panel on gameplay;
- Piggy Bank light/dark;
- Daily Tasks light/dark;
- new No Ads light/dark;
- current-star gameplay block;
- locked `Lv7` element;
- side feature icons on LevelMap (Piggy/Ads/third trophy-like feature), some meanings/product rules still pending;
- footprint variants around MOVES appear to be exploration/animation frames; owner will ask artist for exact meaning before implementing.

---

## 12. Server / internal QA hosting

Sysadmin is preparing a simple static server, likely nginx.

Storage discussion:

- long-term target 100+ GB;
- current need ~20 GB is enough;
- one game can easily be 1–2 GB source/assets;
- static hosting is intended for direct internal QA URLs so tester does not depend on Yandex moderation for every build;
- no mandatory single file was identified that requires special monitoring/backups from the app itself.

Until server is ready, Yandex draft remains a temporary QA/staging path.

---

## 13. Friday demo goal / hard scope

Target: by Friday evening show Oleg a convincing complete result:

1. **Game Core separately** — UI Gallery / generic production shell, two styles, shared components, motion, Yandex-ready packaging.
2. **Puzzle Drop on the same Core** — real Oleg gameplay left intact except neutral hooks/input gates; LevelMap → PLAY → moves → WIN/FAIL → progress/save.
3. Two styles must actually be visually distinct and correct.
4. Real Yandex draft should be playable on desktop/mobile.
5. Moves / lives / coins / 0–3★ / FAIL / Restart / replay / save should feel coherent.
6. Motion/polish should be visible but not at the cost of stability.
7. Demonstrate the architectural value: improving Core once can be repinned into multiple games; next Arrow3D integration should be materially faster.

### P0 before Friday demo

- **ручная приёмка локального `d8156e6`** в Game Core Gallery (или bounded исправление отклонений);
- **владелец push accepted `d8156e6`, только затем exact repin Puzzle** на новый Core commit;
- ensure correct Style 1/Style 2 Result + WIN fireworks **в настоящем Puzzle path**, не только Gallery;
- replay completed levels;
- correct Settings button/layout через новый `SettingsButtonView` и host `insets` в Puzzle;
- production MovesView replaces TEMP text;
- Shop entry must not be dead: согласовать/сделать proper generic Shop screen/tab или bounded корректный interim путь (не подменять старым modal вслепую);
- coin `+` entry to Shop;
- total stars on Style 2 LevelMap if required by `theme_light_6`;
- No Ads correct visual / entry only where logic is valid;
- manual iPhone + Yandex draft pass;
- tester Evgeny gets current Puzzle candidate.

### Explicitly do NOT let these block Friday

- Piggy Bank full runtime/payment;
- Daily Tasks;
- Star Gates/biomes implementation;
- final booster economy/inventory if GDD incomplete;
- full rewarded monetization;
- tutorial;
- server-side balance editor;
- Facebook full regression/staging;
- speculative architecture rewrite.

---

## 14. Operational / collaboration rules

1. One writer per repo/branch.
2. Claude/agents commit locally, **NO PUSH**; owner pushes manually after acceptance.
3. `GAME_CORE_CURRENT.md` is owner-controlled; agents must not modify it unless owner explicitly suspends this rule for one documentation update.
4. Generic gap → Core; game-specific integration → Puzzle adapter/host; neutral seam inside Oleg gameplay must be tiny and independently transferable upstream.
5. Manual visual/product QA by owner is now a mandatory final layer; automation remains regression coverage, not product truth.
6. Figma `theme_light_6` is visual source of truth, not old screenshots or tester size comparisons.
7. Product values remain config/GDD owned; do not let AI invent economy prices/thresholds as production defaults.
8. Games pin exact Core commit; every repin is explicit and tested.

---

## 15. Immediate next step and fixed sequence (2026-10-08, after `d8156e6`)

### FIRST: owner manually checks Core candidate — **one next bounded step, no new writer**

Claude завершил работу и остановился. Сначала владелец проверяет текущую Gallery:

- Mac: `http://127.0.0.1:5180/ui-gallery.html?style=2&screen=win` — Claude проверил HTTP 200.
- iPhone candidate: `http://192.168.0.129:5180/ui-gallery.html?style=1&screen=win` — сервер, по отчёту, слушает `0.0.0.0:5180`; **с iPhone URL не проверен**, Mac → LAN IP у Claude давал timeout. При недоступности сперва разобраться с LAN/VPN/firewall/IP, не утверждать, что мобильный proof пройден.
- Параметры: `style=1|2`, `screen=win|win-2|win-1|win-0|fail|gameplay|noads|map|settings-level|shop`, `moves=38|10|1|0` для gameplay, `locale=ru`.
- Пройти Style1/Style2 WIN **0★ и 3★**, звёзды/анимации/confetti, FAIL, Moves 38/10/1/0, Settings artwork/placement на нужных размерах, No Ads оба стиля, отсутствие критичных визуальных/interaction регрессий.
- При осмотре помнить известные отклонения: Style 2 красный крестик + ненаклонённые боковые звёзды, provisional Style 2 FAIL, упрощённые No Ads эффекты, Gallery-only Settings placement для узких экранов.
- Владелец решает **ACCEPT / FIX**. При FIX — **одна ограниченная Core-правка**, один writer, локальный commit без push, повторная ручная приёмка. При ACCEPT — **владелец** вручную пушит Core (не Claude).

### THEN: gated downstream work — только после Core ACCEPT + PUSH

1. Сделать **точный repin Puzzle** с Core `7ac6b42` на принятый новый hash, протестировать dependency/vendor setup, не использовать silent latest.
2. Одним bounded Puzzle integration slice собрать правильные Result style/FX в реальном WIN, production `MovesView`, `SettingsButtonView`/host insets, completed-level replay с корректной экономикой/progression, имеющиеся motion flags. **Не менять gameplay Олега, кроме строго минимального neutral seam при доказанной необходимости.**
3. Отдельно закрыть **Core Shop screen/tab architecture** и затем Puzzle SHOP/coin-plus routing; не раздувать текущий Puzzle slice новым subsystem. No Ads показывать только при валидном product/entitlement wiring.
4. Проверить total stars (Style 2 LevelMap) относительно `theme_light_6`, закрыть только подтверждённый gap.
5. Собрать новый encrypted **Yandex L100 ZIP** существующим `cbf1192` subset flow; ни один plaintext content asset не должен попасть в финальный ZIP.
6. **Ручной desktop + iPhone/Yandex** smoke с обоими стилями; потом передать конкретный актуальный билд тестировщику Евгению.
7. Пятница: багфиксы/стабильность/презентация отдельно Core Gallery и Puzzle; **не Piggy Bank, Daily Tasks, LiveOps, GDD-unfrozen monetization или реархитектура**.

Важная граница: результат `1473/1473` и 33 Gallery screenshots свидетельствует о локальном Core proof **по отчёту Claude**, но не равен owner acceptance, push, repin, работающему Puzzle WIN FX или выпущенному Yandex candidate.
