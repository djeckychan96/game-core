# GAME_CORE_CURRENT

**Дата состояния:** 2026-10-15 (Новосибирск, UTC+7).  
**Основание:** приложенный `GAME_CORE_CURRENT(4).md` от 08.10, последовательные отчёты Claude Code, результаты ручной приёмки владельца и QA Евгения 13.10.  
**Проверено через подключённый GitHub (15.10):** удалённая ветка `djeckychan96/game-core` / `feat/production-profile-v1` находится на `6727ee997cd861f958d6960fa6ffc491c82ae351` перед этим документационным обновлением.  
**Сверено на Mac (Claude Code, 15.10):** `git fetch` + `git ls-remote` — Core local HEAD = `origin/feat/production-profile-v1` = `6727ee9`, расхождений нет (0 ahead / 0 behind). Puzzle-репозиторий, ветка Олега и QA draft проверены **только read-only** (`git log`/`ls-remote`, без fetch и изменений). Этот документ добавлен отдельным doc-коммитом поверх `6727ee9`; его SHA — `git log -1 -- GAME_CORE_CURRENT.md`, факт push — по `git ls-remote`.

## 0. TL;DR — состояние и границы

- **Game Core:** универсальный production SDK/kernel для HTML5-игр, не движок геймплея. Code HEAD **`6727ee9`** — локально и на GitHub одинаково (GitHub API + `git fetch`/`ls-remote` на Mac 15.10, до отдельного документационного коммита). Функции Piggy Bank и анимация `pig_anima` визуально приняты пользователем.
- **Puzzle Drop + Core:** ветка `integration/game-core`, последний **известный локальный HEAD — `8ad68a5`**, Core vendor exact pin **`6727ee9`** (`vendor/game-core/GAME-CORE.json`, `dirty:false`). Remote `origin/integration/game-core` — **`71fac4d`** (подтверждено `git ls-remote` 15.10); локальная ветка впереди на 6 непушенных коммитов (`3749d4f`, `e38e872`, `2836155`, `5dd280c`, `42fe880`, `8ad68a5`), рабочее дерево чистое. Puzzle не пушить автоматически вслед за Core.
- **Отдельный standalone gameplay Олега:** опубликована ветка [`handoff/oleg-gameplay-fixes-20261014`](https://github.com/djeckychan96/puzzle-core-integration/tree/handoff/oleg-gameplay-fixes-20261014), HEAD `199f5dba9cffcb05b18a9fa733be086a6ab7f564`; 4 коммита, 3 игровых файла, без Game Core. Пользователь визуально принял standalone-версию и разрешил/подтвердил push.
- **Яндекс QA Евгения:** защищённый черновик `qa/yandex-draft-2026-10-13` / `f2547e7` (Core pin `f153a18`; ветка локальная — на GitHub её нет по `git ls-remote` 15.10); тестировщик проверял именно его, НЕ текущий dev HEAD. QA-ветку/архив нельзя тихо менять. Перед повторным QA — новый пакет и матрица SHA.
- **После QA 13.10:** B3/B4, B5, B6 и подтверждённая часть B8 исправлены локально; B2-перекрытие плашки исправлено локально, **визуальная приёмка пользователем не зафиксирована**; B13 признан внешним / требуется доказательство на POCO; остальные B1/B2/B7/B9/B10/B11/B12 требуют отдельных решений/работ.
- **Документ:** запись через GitHub connector вернула HTTP 403, поэтому обновление сделано Claude Code на Mac отдельным документационным commit в `feat/production-profile-v1` (коммит создан на самом Mac — отдельный pull на Mac не нужен). Push — только обычный, без force; итоговый SHA подтверждается `git ls-remote`, а не этим текстом. Далее QA UI, не трогая frozen Yandex draft.

---

## 1. Архитектура и правила разработки

Главная схема: **готовый game-specific gameplay → небольшой neutral host seam → pinned Game Core → Puzzle-specific config/meta/adapters → QA → production**.

- Generic UI, FX, moves, economy, save, purchases, ads, analytics, platform, localization и runtime — **Game Core**.
- Правила карт/ходов как жанровая логика, генерация поля, сцены и собственные ресурсы — **gameplay Олега**.
- Wiring, platform startup, map/gameplay transitions, provider-specific integration, отображение game-specific данных — **Puzzle integration**.
- Ошибку править по **root cause**, не по названию файла. Один writer на repo/branch. Сначала reproduce, затем минимальный fix, regression test и отдельный коммит.
- Изменения Core распространяются в играх **только точным vendor pin/repin**, не `latest` и не ручным копированием артефактов.
- Ручная приёмка на iPhone/реальном Яндексе необходима для продуктовых визуальных изменений; зелёные тесты не заменяют её.
- `AGENTS.md` у Claude в workspace запрещает **subagents/workflows**. Для Claude prompts использовать короткие ограниченные задачи. По умолчанию **NO PUSH / NO ZIP**; исключение — чёткое прямое разрешение владельца на конкретный remote/branch (например текущая задача push Core).
- Не менять незавершённую QA-сборку Евгения и `qa/yandex-draft-2026-10-13` без отдельного запроса.
- `GAME_CORE_CURRENT.md` — owner-controlled. Обновление **этого документа** прямо санкционировано 15.10; не объявлять такое разрешение постоянным для будущих задач.

## 2. Репозитории и рабочие каталоги

| Назначение | Путь на Mac | Ветка | GitHub |
|---|---|---|---|
| Core SDK | `~/Desktop/games-workspace/game-core` | `feat/production-profile-v1` | `https://github.com/djeckychan96/game-core.git` |
| Puzzle + Core integration | `~/Desktop/games-workspace/puzzle-core-clean` | `integration/game-core` | `https://github.com/djeckychan96/puzzle-core-integration.git` (private) |
| Оригинал Олега 07.10 | `~/Desktop/games-workspace/puzzle_drop_source_2026-10-07` | папка-источник; `upstream/oleg` = локальный Git snapshot `6ff9510` | не отдельный remote Олега |
| Standalone handoff Олегу | `~/Desktop/games-workspace/puzzle-oleg-handoff` | `handoff/oleg-gameplay-fixes-20261014` | опубликована в Puzzle repo |
| Замороженный Яндекс QA | `~/Desktop/games-workspace/puzzle-qa-draft` | `qa/yandex-draft-2026-10-13`, `f2547e7` | сохранять отдельно |

`puzzle-oleg-handoff` и `puzzle-qa-draft` — это **git worktree того же репозитория**, что и `puzzle-core-clean` (`git worktree list`), а не отдельные клоны: ветки и объекты общие, поэтому команды вроде `git branch -D`/`git gc`/`git worktree remove` в одном каталоге затрагивают все три. На GitHub в Puzzle repo (ls-remote 15.10) только две ветки: `integration/game-core` и `handoff/oleg-gameplay-fixes-20261014`; `upstream/oleg`, `main` и `qa/*` — локальные.

`origin` в Puzzle — private repo владельца. Олег не имеет собственного upstream-репозитория на момент подготовки handoff. `upstream/oleg` — **локальная** ветка с нашим импортом оригинала `6ff9510`, а не автоматически свежие файлы с его ПК. Если Олег менял код после 07.10, синхронизировать через 3-way merge/отдельные коммиты.

**GitHub безопасность:** репозиторий `game-core` отдельный; не предоставлять Олегу туда write. В Puzzle ему нужен отдельный `oleg/gameplay` branch; доступ Collaborator с write без branch protection технически может затронуть чужие ветки, поэтому правила Claude не заменяют GitHub branch protection. Не пушить с `--force` и не merge whole `integration/game-core` в standalone gameplay.

## 3. Текущая поверхность Game Core

Подтверждённая концептуальная поверхность: `CoreRuntime`, `UiRuntime`, `MotionRuntime`, `FxRuntime`, `GameplayContract V1`, `GameProductionProfile V1`, `SaveGate`, `SoftCurrencyWallet`, `PurchaseRuntime` / `PurchaseLedger`, `AdsRuntime`, `AnalyticsRuntime`, `PlatformRuntime`, `LivesRuntime V1.1`, `ContinueOfferRuntime V1.1`, `MoveRuntime`, `LevelBalance` / `LevelBalanceSource`, stars/rewards, `QuestService`, `PiggyBankService`, QA runtime/panel, localization UI, Pixi Ready UI/screens, Pixi FX `ClickRippleEffect`.

### Moves, stars и награды

- `MoveRuntime`: `start(balance)`, `consume`, `add`, `end`, `snapshot/restore`; generic runtime **не определяет WIN/FAIL** — host ждёт завершения gameplay/анимаций и решает WIN сначала.
- `starsForMovesLeft()` = 0–3★, победа с 0★ легальна. Thresholds по **абсолютному остатку ходов**; extra moves увеличивают remaining, но не переставляют thresholds. При remaining 0 нельзя выдавать FAIL до `onBoardSettled`.
- `coinRewardForStars(N,stars)` в Core умеет 25/50/75/100% с округлением вверх, но в Puzzle фактическая нормальная первая победа **5 coins**, повторная награда за уже пройденный уровень отключена; политику Tier rewards нельзя включать без продукта/GDD.
- Боевые пробелы (replay completed level, boosters/Continue и т.д.) проверять на **текущей** версии, не считать открытыми только потому, что они открыты в старом документе от 08.10.

### Save, platform и QA границы

- `SaveGate` обеспечивает durability, миграции должны быть совместимы. Для квестовых наград добавлен атомарный `batchCore` (Core `889e7f6`), чтобы claim не терялся/не дублировался.
- `SoftCurrencyWallet` — реальный кошелёк Puzzle, не путать его с QA mint/покупками и piggy balance.
- Yandex: реальный SDK и provider timing проверяются отдельно от fake SDK тестов. На QA должны быть видны Core и Puzzle SHA в Settings. QA панель отдельно от RELEASE; нельзя отправлять QA credits/команды в публичный пакет.
- Encrypted Yandex content: прогрессионный L100 subset, свой `content.key`, encrypted `index.bin` и картинки. Не публиковать plaintext levels/assets и секретные ключи. Пакет с тестовой QA-панелью не считать релизным.

## 4. Хронология важных Core milestones (после старого baseline 08.10)

| SHA | Содержание / факт |
|---|---|
| `7ac6b42` | Принятый ранее baseline: LevelMap contract, MoveRuntime, stars/coins, PLAY/HUD/LOCK motion |
| `d8156e6` | Figma UI (`theme_light_6`): Style1/2 Result WIN, MovesView, SettingsButtonView, No Ads |
| `2f66ce1` | Новый generic `ShopScreen` обоих стилей |
| `3516424` | `ShopScreen` mobile/desktop compositions (`theme_light_7`): phone frame на 320×568, compact desktop (1280×800) |
| `34e5b6e` | `theme_light_8`: Style2 Shop cards/nav, Shop motion, heart count |
| `d8aac3c` | `theme_light_8` gameplay row art как skin roles Style1/2 (boosterBack, levelEmblem, lockedSlot*) |
| `0f13b1e` | `LivesWindowView.adEnabled` — GET виден, но неактивен без rewarded |
| `74e7062` | OFFER `enabled` / `dimDisabled` — оффер показан, но не продаётся |
| `ddc173e` | `theme_light_9`: Style2 MOVES tab, booster diamond, No Ads entry art; NoAds enabled |
| `05d6a2e` | `ShopScreen` mobile frame поднимается на status-bar band (Style1 awning) |
| `55f9c60` | No Ads + WIN decorative animations по Figma |
| `6e0305d` | QuestService foundation по GDD Артёма |
| `889e7f6` | Atomic SaveGate `batchCore` / durable quest claims |
| `f153a18` | Daily Quests Figma UI, исходная QA-пинованная база Core |
| `4c96078` | Language Picker для Settings, RU/EN (Puzzle `4080619`) |
| `ed5599c` | PiggyBankService foundation, persist, stage/collect/buy contract, QA hooks |
| `b43f3fb` | PiggyBankWindowView (Style1/2), оригинальный арт Figma, Puzzle интеграция `0617a96` |
| `6727ee9` | Figma keyframe motion для кнопки копилки, включая скрытие конфликтующего старого блика; принята пользователем |

Таблица сверена с `git log 7ac6b42..6727ee9` на Mac 15.10: это **все** code-коммиты после baseline (кроме docs `9e1e488` от 08.10), все — предки `6727ee9`. Puzzle-коммит `e91aa2a` в ранней редакции ошибочно стоял здесь — перенесён в таблицу Puzzle (§7).

**Game Core code HEAD `6727ee9` опубликован на GitHub** (GitHub API 15.10 и `git ls-remote` на Mac 15.10). Попытка GitHub API update_file для этого документа вернула 403, поэтому документ обновлён отдельным doc commit на Mac. Последний известный полный Core run из отчёта Claude после motion: **1631 tests + build**, browser Style1/2 portrait/landscape. Перепроверено на Mac 15.10 на `6727ee9`: `npm test` — **1631/1631 passed, 106 files**; `npm run build` — OK (check-pixi-build / pixi-types / platform-build / qa-build).

## 5. Копилка — принятая feature/economy

- Универсальный Core `PiggyBankService`, Puzzle-specific config. В игре работает через map entry → popup/tutorial → buy.
- По каждому успешному первому level completion в копилку stage `floor(earned * 150 / 100)`; если level reward = 5, это **7** монет, а не 7.5. Нормальная награда в кошельке остаётся. Бонус привязан к уникальному attempt key, сохраняется идемпотентно.
- `collect()` переносит pending на карте; purchase/credit atomic через SaveGate.
- Порог покупки = **50% capacity**, **НЕ** зависит от количества монет кошелька для анимации и доступности кнопки. Если для оплаты не хватает 900, открывается магазин монет.
- Вместимость уровней: **3000 → 5000 → 7500 → 10000 → 10000…**. После первого выкупа минимум на следующем уровне становится **2500** вместо 1500. **Цена фиксирована 900 игровых монет** в текущем Puzzle config; real-money IAP не используется. Сумма payout = текущие накопления, wallet debited by 900 and credited by payout exactly once.
- Текущая модель экономически спорная по времени накопления: при +7 за level требуется около 215 побед до первых 1500, если всё наполняется лишь обычными победами. Не менять без решения Артёма.
- QA hooks `piggy.balance`, `piggy.buy` только в QA. Квестовые rewards/QA grants не должны наполнять Piggy. Piggy payout трактуется как earn для Quest, 900 payment как spend — текущая реализация, при необходимости согласовать.
- Popup использует исходные Figma assets Style 1/2, RU/EN, tutorial upon first open, затем `i`; ожидания по финальным текстам остаются продуктовой задачей.
- **Принятая Figma motion:** `pig_anima` file `5FWFwdO4QGeDfeQtloLNOS`, node `90:27944`; **3 animation tracks** (pig `90:27946`, coin `90:27945`, spark `90:27947`), единый loop 2000ms. Запуск при 50%+, даже с нулевым wallet; остановка после buy, закрытия карты/SHOP. Старый декоративный spark №1 скрывается только при анимации. MotionRuntime не переписывался. Style1 во время motion использует light-outline pig из текущих исходных ассетов (ожидается отдельный тёмный вариант художницы).

## 6. UI, Figma и Motion — актуальный источник

- Figma personal Full-seat copy: `https://www.figma.com/design/5FWFwdO4QGeDfeQtloLNOS/Untitled`.
- **Актуальная family для новых сверок — `theme_light_11`**, а не `theme_light_6`/старые QA скриншоты. Старые узлы могут быть релевантны только при воспроизведении конкретного принятого старого slice.
- Mapping: **Style 2 = light**, **Style 1 = dark/purple**.
- Piggy popup nodes: Style2 main `67:30376`, tutorial `67:30416`; Style1 main `67:30801`, tutorial `67:30442`.
- Key animation: Figma `pig_anima` `90:27944`, оригинальная временная структура используется в Game Core.
- Ready UI: LevelMap, HudView, MovesView, SettingsButtonView, Result WIN/FAIL, Lives, Confirm, ShopScreen, Daily Quests, Language Picker, Piggy Bank, No Ads / banners, motion, 9-slice, two styles. Арт Figma экспортировать из личного файла, не подменять похожими картинками.
- **Ripple в Puzzle:** Core `src/pixi/fx/ClickRippleEffect.ts` из `game-core/pixi`, Puzzle integration commit `5dd280c` + module `tap-ripple.ts`. Два белых кольца 10→56 px, 620 ms, нет новых текстур. Использует Pixi `EventBoundary.dispatch` subscription, НЕ patch. Tap only empty map/game area; no drag/UI/board hits, windows/shop block. Пользователь проверил на iPhone и **принял**. Небольшой известный нюанс: tap по плашке обучения тоже может показать волну; изменять только при явном замечании владельца.
- Динамические UI/FX должны отключаться при скрытых сценах, не плодить ticker/subscription и не ломать Pixi input/hitArea.

## 7. Puzzle Drop — dev integration: фактические возможности

- На карте можно выбирать и запускать progression levels, поддерживаются Style1/Style2, completed replay и best stars (проверять в текущем smoke при новых изменениях), HUD lives/coins, shop, settings, No Ads screen, quests, piggy, ADS/rewarded пути по текущим контрактам.
- Gameplay Олега: пустая доска → раздача карт, карты/колоды, wand/hint, motion/combo/praise. UI оболочка даёт lives/coins/moves/stars/boosters/quests/settings/shop/language.
- Level attempt: life spent on PLAY/restart; WIN refund, fail/quit no refund; 0★ WIN считается completion. При нуле MOVES host ждёт завершения игрового действия, затем WIN или Continue/FAIL.
- Daily Quests: QuestService core, реальное emission events из Puzzle, atomic claim; точные условия/навигирование `GO` остаются предметом UX/GDD согласования.
- Shop: полноценный tab/screen Style1/2 и маршрутизация, но **реальные покупки/No Ads IAP ещё не интегрированы**, QA purchase UI может быть заглушкой, не обещать entitlement.
- Language Picker RU/EN реализован локально, **не входил в старый Яндекс QA draft** `f2547e7`.
- Yandex gameplay draft 100 levels, encryption; current dev version значительно новее QA frozen build. Не сравнивать результаты на этих версиях без SHA и условий.

### Ключевые Puzzle commits после старого 08.10

| SHA | Содержание / статус |
|---|---|
| `4d75c7c` | Старый Puzzle baseline moves/meta integration (08.10) |
| `e91aa2a` | Final UI QA 08.10: settings справа, WIN reward 0 на replay, TEST shop catalog |
| `b6abe55` | No Ads + WIN Figma decorative wiring |
| `56f6d0b` | Daily quests events + map entry |
| `82b8f4d` | Booster purchase modal Figma, map Quest/ADS column alignment |
| `4080619` | Language Picker host integration |
| `d9502b5` | QA panel + version strings cherry-picked from QA draft (не сам QA build) |
| `0617a96` | Core repin `b43f3fb` + Piggy Bank game integration |
| `45dbd6f` | Piggy Figma animation + star-fix, Core pin `6727ee9` |
| `c161e33` | **B3 + B4** Yandex first-boot guest/player race, lives/coins + level visibility |
| `88dd9c2` | **B6** gameplay `BoardView.fxLayer.eventMode='none'` |
| `71fac4d` | QA regression test `test:board`, отдельно от gameplay code |
| `3749d4f` | **B8 partial** active play time: не считать page load как input |
| `e38e872` | **B5 gameplay** `Sound.ts` double-play race fix |
| `2836155` | **B5 integration** BgmGame requested from LevelMap after first touch |
| `5dd280c` | Ripple effect подключён из Core, **вручную принят** |
| `42fe880` | B2 tutorial tip gameplay position/9-slice, зависит от integration seam |
| `8ad68a5` | B2 lower Ready UI seam + tests; локально проверен Claude, ручная приёмка пока не зафиксирована |

**Важная оговорка по B2 SHA:** `42fe880` содержит часть изменений в `GameScene`, а `8ad68a5` — Puzzle integration/tests; отдельная 9-slice adaptation для Олега была позже оформлена в его standalone ветке `199f5db`.

## 8. QA 13.10 — статусы по группам

Источник: `13.10_ПазлоПад.xlsx` + триаж `Puzzle_QA_triage_2026-10-13.xlsx`. 13 номерных багов B1–B13 (без всех номеров подряд) и отдельный UX-01, суммарно **18 рабочих пунктов** после разделения B2. 25 пунктов чек-листа на 3 устройства отмечались «не пройдено» как шаблон — это **не доказательство 75 реальных падений**.

| Баг | Текущее состояние и основание |
|---|---|
| **B3** wallet/lives unavailable на холодном Yandex load | Fix Puzzle `c161e33`, regression fake SDK + старый QA код воспроизведён; **проверка настоящего Яндекса с новым билдом ещё нужна** |
| **B4** видимых уровней 3 вместо 4 до F5 | Та же причина B3 (неизвестный HUD и изменённая геометрия), отдельного коммита нет |
| **B6** рука обучения блокирует карту | Fix `88dd9c2`, `fxLayer.eventMode='none'`, проверен Chrome/focused input tests; вошёл в standalone Олега |
| **B5** музыка на карте до прохождения первого уровня | Fix integration `2836155` request `BgmGame` after gesture; gameplay Sound race `e38e872`; iPhone/rewarded real QA ещё проверить |
| **B8** квест «10 минут AFK» | Точный 10min AFK не воспроизвёлся. Найден и исправлен bug: page load считался первым tap, давал до 60s (`3749d4f`). Правила play_time в GDD не определены: карта/магазин/idle timeout 60s — спросить Артёма |
| **B13** рекламный баннер POCO F4 GT | Не наш iframe; Яндекс host-page sticky banner. Screenshot дефекта на POCO нет, контрольный Redmi Note7 нормальный. **No code changes**, нужна проверка POCO / Yandex support |
| **B2 tip overlap** | Исправлено `42fe880` + `8ad68a5`; в Chrome 6 configs без overlap, 9-slice artwork, change field size while tutorial. **Ручная приёмка ещё не сообщалась**. Маленький экран/desktop: поле уменьшалось примерно на 19% / 22% во время обучения — проверить UX |
| **B2 decorative stars background** | Подтверждено: актуальный Style2 мягкие крупные звёзды, Style1 dark stars; следующий **неисполненный** task. Никакого локального фикса фона пока нет |
| **B2 Style1 booster backing** | Текущие white squares вместо dark-style hexagon с orange stroke; требует Core skin + repin, отдельный slice |
| **B2 Style2 diamond backing, MOVES orange tab** | В актуальной Figma это корректно; замечание по старому дизайну/ожидает финального подтверждения художницы, не переделывать автоматически |
| **B2 header/compact deck** | Существующий вариант **принят владельцем**, не перестраивать из-за несовпадения с новыми exploratory Figma canvases. При изменении — отдельное согласование |
| **B1** map HUD lives/coins/stars | Отделить последствия B3 от реального отсутствия total-stars; сверить `theme_light_11` |
| **B7** quest GO buttons | Часть маршрутов намеренно не подключена, нужны решения продукта по destinations и false affordances |
| **B9** bottom nav inactive icons | Проверить по актуальному Figma и на малом экране |
| **B10** Settings language switching flash | Воспроизвести на актуальной Language Picker ветке, устранить confirmed blink отдельно |
| **B11** landscape orientation splash | Требуется решение Олега/Артёма; не выключать landscape вслепую, он был сознательно поддержан |
| **B12** No Ads за 900 coins | В QA UI заглушка, **не** реальная покупка. Нельзя выдавать фейковое entitlement; требуется решение продукта/реальный flow |
| **UX-01** длинный оранжевый MOVES tab | Макет `theme_light_11` действительно до низа, вопрос финального арт-утверждения |

**QA smoke debt:** `dist-yandex` было 32/34 — 2 проверки ожидали отсутствие любых записей при boot, но Daily Quests записывают visit. Эти два теста падали уже до B3. Перед release определить корректный контракт и поправить tests/logic, не маскировать сломанную durability.

## 9. Standalone handoff Олегу — опубликован 14.10

Олегу **не нужен Game Core**, ему нужна актуальная автономная gameplay-папка. Пользователь визуально проверил localhost:8951 (iPhone), принял и разрешил push.

- GitHub (private): `https://github.com/djeckychan96/puzzle-core-integration/tree/handoff/oleg-gameplay-fixes-20261014`.
- Handoff HEAD: **`199f5dba9cffcb05b18a9fa733be086a6ab7f564`** (совпадает с `git ls-remote` 15.10).
- Base: импорт кода Олега 07.10 `6ff9510`; изменения **ровно трёх файлов:** `src/core/Sound.ts`, `src/game/BoardView.ts`, `src/scenes/GameScene.ts`.

| Standalone SHA | Изменение |
|---|---|
| `82188eb` | hint hand input fix (cherry-pick Puzzle `88dd9c2`) |
| `ab60e3f` | audio double loading fix (cherry-pick Puzzle `e38e872`) |
| `0c76aed` | compact deck, top header и position адаптированы к standalone (без Core) |
| `199f5db` | independent 9-slice tutorial background |

Не включены: Game Core, Map, Ready UI, SaveGate, shop, quests, piggy, QA panel, host-only hooks. Для будущих правок использовать `oleg/gameplay`, Core integration owner остаётся `integration/game-core`. Изменения из обеих сторон вливаются осмысленно, standalone handoff не становится direct vendor source. Олегу выдана подробная инструкция `PUZZLE_OLEG_CLAUDE_GIT_WORKFLOW_2026-10-14.md` (документ подготовлен; фактическая установка и работа его Claude не подтверждены).

## 10. Ближайший план (15.10)

1. **Сделано 15.10 на Mac:** `git fetch`/`ls-remote` (Core `6727ee9` local = remote, без расхождений), этот документ — **один** документационный commit в `feat/production-profile-v1`; push — только обычный, результат — по `git ls-remote`. Puzzle не пушился. Права GitHub connector на запись отсутствуют (403) — публикация документов только через Mac.
2. **Перед новым ChatGPT-чатом:** сохранить `GAME_CORE_CURRENT.md` + полный handoff `GAME_CORE_HANDOFF_FULL_2026-10-15.md`; загрузить оба в новый чат. Чат не знает локальную среду/SSH автоматически, нужно использовать отчёты Claude.
3. Проверить B2 tutorial-tip UX на iPhone (особенно 320×568); если всё принято — отмечать принятым. **Не запускать** пока ранее подготовленный prompt «фон со звёздами» без нового задания.
4. Продолжить QA backlog: **B2 фон Style1/2** отдельным slice → **Style1 booster hex skin** с Core repin → B9/B10 → B1/B7 → B11/B12 product decisions. Не возобновлять большие переписывания header/board.
5. В реальном Яндекс QA сформировать **новую версию**, не перезаписывая frozen `f2547e7`. Реально проверить B3 cold start, rewarded audio, QA guards, encryped packaging, saved progress; закрыть 32/34 smoke debt. ZIP/push Puzzle — только по отдельному разрешению и после приёмки.
6. Для Олега: принять его future gameplay additions как изолированные коммиты/ветку, сравнить против published handoff, после тестов интегрировать. Не разрешать ему изменять `game-core`.
7. Игровая экономика: порог копилки/цена 900 утверждены на текущий config, но экономический баланс накопления и play_time квесты требуют решения Артёма. Purchase/NoAds product не притворяться работающим без backend/entitlement.

## 11. Локальный запуск и проверки

```bash
# Puzzle, из ~/Desktop/games-workspace/puzzle-core-clean
npm run dev            # = vite --host 0.0.0.0 --port 8941
# Style2: http://<LOCAL_MAC_IP>:8941/?uiStyle=style2
# Style1: http://<LOCAL_MAC_IP>:8941/?uiStyle=style1

# Standalone Oleg handoff, если dev server ещё запущен: :8951

# Puzzle tests (scripts из package.json puzzle-core-clean, сверено 15.10)
npm run typecheck
npm run test:meta
npm run test:shell
npm run test:board
npm run test:tutorial
npm run test:music
npm run test:ripple
npm run test:pack

# Core, из ~/Desktop/games-workspace/game-core
npm test
npm run build
npm run showcase       # vite.showcase.config.ts, :5180, root examples/pixi-showcase
# gallery: http://<LOCAL_MAC_IP>:5180/ui-gallery.html?style=2&screen=win
```

IP меняется между Wi-Fi/хотспотом; последние примеры `192.168.0.129`, `172.20.10.13` не гарантия текущего адреса. На iPhone и Mac нужна одна сеть.

## 12. Верификация Git / публикация — явные стоп-условия

Никаких утверждений «всё залито» без результата `git push` и последующего `git ls-remote`/`git rev-parse`.

Core перед публикацией:

```bash
cd ~/Desktop/games-workspace/game-core
git status --short --branch
git remote -v
git log -8 --oneline
git fetch origin feat/production-profile-v1
git rev-parse HEAD
git rev-parse origin/feat/production-profile-v1
```

Если remote branch отстаёт и все локальные commits приняты, обновить owner-controlled файл (отдельный doc commit), сделать проверки и `git push origin feat/production-profile-v1`. Если remote diverged, история имеет неизвестные коммиты, есть чужие незакоммиченные изменения, чувствительные файлы или Core HEAD не совпадает с последним известным (code `6727ee9` + doc commit 15.10 этого файла) — **остановиться, не делать force/merge/rebase наугад** и запросить решение владельца.

---

**Источник фактов:** отчёты Claude Code и пользовательская приёмка до 14.10, старый canonical от 08.10, QA workbook 13.10; дополнительно **GitHub API 15.10 подтвердил Core remote SHA `6727ee997cd861f958d6960fa6ffc491c82ae351` до документационного коммита**, а Claude Code на Mac 15.10 сверил Core (`fetch`/`ls-remote`), все SHA таблиц §4/§7/§9, vendor pins (`6727ee9` в integration, `f153a18` в QA draft) и scripts §11 с фактическим Git. Запись через GitHub API была отклонена HTTP 403; SHA документационного коммита и результат push — в отчёте Claude и `git ls-remote`.
