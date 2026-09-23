# GAME_CORE_CURRENT

_Обновлено: 2026-09-23_

Каноническое **текущее** инженерное состояние Game Core. Здесь нет истории: она в `git log`
и в `docs/superpowers/specs/`. Обзор продукта — [README.md](README.md), шаблон подключения новой игры —
[INTEGRATION_PROMPT.md](INTEGRATION_PROMPT.md).

## Миссия

Game Core — production SDK для HTML5/web-игр.

Целевой поток:

**чистый gameplay + короткий production spec → тонкий adapter/profile → Game Core → production-ready игра**

Game-specific gameplay остаётся вне Core. Core растёт только так:

**реальная потребность игры → generic pattern → Core API → regression test**

Главная продуктовая цель сейчас: сократить число решений и строк production-glue, которые AI заново пишет
для каждой новой игры.

---

## Current runtime baseline

- ветка: `feat/production-profile-v1`, pushed в `origin/feat/production-profile-v1`;
- **runtime/API baseline: `d773319`** — SoftCurrencyWallet V1;
- версия пакета: `0.2.0`;
- не merged в `main`, stable release tag нет;
- игры закрепляют точный commit/tag Core, без «latest».

Documentation commits поверх `d773319` не меняют runtime, API и tests. Новым baseline они не считаются:
runtime/API baseline остаётся `d773319`.

Цепочка accepted commits (от `fix/levelmap-pulse-lifecycle`):

| Commit | Что |
|---|---|
| `fa9105b` | LevelMap pulse lifecycle fix: motions узла отменяются до уничтожения узла |
| `a29cec8` | Gameplay Contract V1 + Game Production Profile V1 (types + `validateGameProductionProfile`) |
| `97b6d39` | SaveGate V1 |
| `92464ad` | безопасная семантика записи в облако Yandex (storage patch) |
| `d773319` | SoftCurrencyWallet V1 |

Production UI — **asset-based** Ready UI (стиль Trail Arrow). Большой programmatic Theme/Bubble эксперимент
в текущее production-направление не входит.

## Accepted

**Gameplay Contract / Production Profile V1** (`a29cec8`)
- события игры: `ready / levelStart / levelEnd`, опционально `levelExit`;
- команды: `startLevel / restart / setPaused / setSound`, опционально `setMusic / next`; `getProgress`;
- режимы: `frame: core | gameplay`, `input: layer | query`; progression `linear | open`;
- `GameProductionProfile`: `progression`, `ui`, `economy`, `monetization`, `platform`, `save`;
  строгий validator (неизвестные поля, секреты, дубли product ID отвергаются).

**SaveGate V1** (`97b6d39`)
- запись разрешена только после загрузки и `open()`;
- `missing` (чтение успешно, данных нет — новый игрок) отличается от `failed` (чтение не удалось);
- при `failed` defaults никогда не перезаписывают неизвестное состояние;
- запись только в объявленные `save.keys`; состояние Core — отдельная запись `<profile.id>.core`;
- опциональные `save.groups` — независимые домены отказа;
- ошибки storage — структурированный результат `{ ok, reason }`, не исключение через gameplay.

**Yandex safe storage patch semantics** (`92464ad`)
- Yandex `setData` заменяет весь объект, поэтому adapter перед первой записью сессии читает полный объект,
  накладывает patch и отправляет результат целиком;
- подтверждённый снимок двигается только после успешной записи; записи и `clear` идут одной очередью;
- regression: fake с replace-семантикой воспроизводит старый баг; реальное сохранение на Yandex draft SoliPix — PASS.

**SoftCurrencyWallet V1** (`d773319`)
- одна soft currency с `owner: 'core'`; валюта игры (`owner: 'gameplay'`) остаётся в игре, кошелёк не создаётся;
- состояние — Core-запись `wallet` через `SaveGate`, без второй системы сохранений;
- неудачное чтение или битая запись → `unavailable`: баланс неизвестен (`null`), любые изменения отклоняются;
- `grant / trySpend / applyLevelResult / save`, `onChange`; результаты возвращаются, не бросаются;
- награда за уровень: первое прохождение платится один раз на уровень (запоминается в сохранении),
  повтор — только через opt-in `replayReward` профиля, поражение — никогда;
- Core не читает метрики игры и не хранит числа наград: их задаёт профиль игры.

## Core regression

На `d773319`:

- automated tests: **724/724** (59 test-файлов);
- `tsc`: **PASS**;
- build: **PASS** (`BUILD_INFO.commit = d773319`, `dirty = false`);
- `smoke:platform`: **PASS**;
- `smoke:platform-yandex`: **PASS**.

2026-09-23 при documentation slice повторно запущены `npm test` (724/724) и `tsc` — PASS.

## Состав Core

- **Foundation:** `CoreRuntime`, `UiRuntime`, `MotionRuntime`, `FxRuntime`.
- **Production integration:** Gameplay Contract, `GameProductionProfile`, `SaveGate`, `SoftCurrencyWallet`.
- **Production runtimes:** `AdsRuntime` + Ads Policy, `PurchaseRuntime`, `OfferRuntime`, `AnalyticsRuntime`,
  `PlatformRuntime`.
- **Ready UI** (`game-core/pixi`): `HudView`, `LevelMapView`, `SettingsWindowView`, `ResultWindowView`,
  `ShopWindowView`, `NoAdsWindowView`, `LivesWindowView`, `StarterPackWindowView`; primitives `UiButton`,
  `ModalWindow`; `ReadyUiOverlay` для игр не на Pixi.
- **Platforms:** DEV (`createDevPlatform`), Yandex (`game-core/platform/yandex`).
  CleverApps — только значение `provider` в типах конфигурации, адаптера нет.

Порядок платформ: Yandex → VK / OK через CleverApps → Facebook через CleverApps → Samsung.

Ads / Purchase правила: NoAds cadence — это policy/config; `no_ads` — entitlement, никогда не consume;
coin packs — consumable; restore заново подтверждает entitlement; product IDs и секреты платформы в Core
не хардкодятся.

---

## SoliPix — production/platform proof

Репозитории: clean integration `solipix-core-clean/` (`b4c9710`), автономный пакет `solipix-yandex-draft/`.

- gameplay остался на DOM/CSS, на Pixi не переписывался;
- Core changes during clean integration: **0**; интеграция ≈ 45 мин, вмешательств человека 0;
- `npm test` 40/40, browser smoke 42/42;
- real iPhone: **PASS**.

Автономный production-пакет:

- собран на Core **`92464ad`** (на `d773319` не пересобирался);
- ZIP с `index.html` в корне, Core dist, Pixi и арт Ready UI внутри, без зависимостей от рабочей папки,
  symlinks и `node_modules/game-core`;
- static scan: **PASS** (symlinks 0, missing asset references 0);
- proof на распакованном ZIP: **47/47**;
- Core changes для упаковки: **0**.

Реальный Yandex Games draft — **PASS**, проверено вручную:

- запуск Yandex SDK;
- Core UI;
- gameplay;
- real ads;
- real payments;
- real save;
- интеграция с платформой.

Fail-closed: сбой production-запуска Yandex больше не переключает игру на DEV — бесплатные «покупки»
DEV-платформы в production-пакете невозможны, ошибка запуска явная. Это доказано для пакета SoliPix;
generic-правило в Core пока не централизовано.

SoliPix использует свою экономику (owner: gameplay) и свой экран победы; `SaveGate` и `SoftCurrencyWallet`
появились после этой интеграции и в SoliPix не используются.

## Городки — Wallet/Result proof

Репозитории: исходник `gorodki-source-clean/` (архив Олега), интеграция `gorodki-core-clean/`.

Исходная игра: Three.js r169 + Rapier 0.14, 104 фигуры, без платформы, рекламы, покупок и валюты.

Текущее состояние — **integration commit `4ac59c1`** (на Core `d773319`, у repo нет remote):

- Core changes during integration: **0**;
- механика не менялась; за всю интеграцию изменены 2 gameplay-файла (`game.js`, `backgrounds.js`,
  +16/−15 строк), для кошелька — +3/−3 строки в `game.js`;
- `GameProductionProfile` Городков: `coins`, owner `core`, старт 0, первое прохождение +10 (demo-значение),
  повтор 0; платформа DEV, реклама выключена;
- Core Wallet (`SoftCurrencyWallet`): **PASS**;
- HUD coins (`HudView`): **PASS**;
- Core ResultWindow (`ResultWindowView` с наградой): **PASS**;
- manual real-device persistence: **PASS** — 0 → первое прохождение 10 → reload 10 → повтор 10 →
  следующий новый уровень 20 → reload 20;
- fast wallet-flow (Node): **10/10 PASS** (разовая проверка в сессии, в repo не закоммичена);
- static scan: **PASS**; синтаксис JS: **10/10 PASS**.

**Full browser smoke после подключения кошелька НЕ завершён:** прогон прошёл первую победу и Core NEXT,
затем упёрся в общий timeout из-за перегруженной машины (SwiftShader). Шаги reload / replay / 20 монет
автоматически не выполнились. Приёмка — ручная проверка на реальном устройстве.

База интеграции — холодный benchmark `74a8808` (до кошелька, Core `fa9105b`): первый зелёный smoke ≈ 47 мин,
финал 59 мин 55 с, host-glue 140 непустых строк, вмешательств человека 0, smoke 14/14 PASS, real iPhone PASS.
С кошельком host-glue — 223 непустые строки.

Городки не проверялись на реальном Yandex; реклама и платежи не подключались.

---

## Текущие ограничения и риски

- Contract/Profile не исполняются одним стандартным production bootstrap: нет Production Composer,
  связку собирает host каждой игры.
- Оркестрация Ads / Purchase / NoAds частично повторяется в hosts.
- Fail-closed поведение production-платформы не централизовано в Core.
- Ready UI capability gaps:
  - `HudView` всегда рисует жизни (в Городках видны, хотя в профиле `ui.lives: false`);
  - `SettingsWindowView` всегда рисует музыку;
  - `ResultWindowView` без generic-режима поражения;
  - `LevelMapView` без режима «все уровни открыты»;
  - часть neutral/default controls всё ещё требует host-патчей.
- Автономная упаковка доказана только на SoliPix, не обобщена.
- `AnalyticsRuntime` в реальной игре не подключён.
- Contract V1 не имеет run identity: при opt-in `replayReward` дублированный `levelEnd` заплатит ещё раз —
  host обязан отдавать один `levelEnd` на забег.
- Stable v1 tag и release flow нет.
- Self-service Quick Start / handoff пока не доказан на новой игре.
- Две устаревшие, не блокирующие проверки viewport-scale в `smoke:layout` требуют отдельной QA-чистки.
- CleverApps не production-complete.

Корректная формулировка статуса:

**Game Core доказан на двух разных gameplay-стеках, включая реальный Yandex production draft; дальше —
сокращать повторяющийся integration glue и расширять generic-возможности через реальные игры.**

Не утверждать, что «любая игра автоматически production-ready».

## Roadmap

**DONE:**

- Gameplay Contract / Production Profile;
- SaveGate;
- Yandex safe storage;
- SoftCurrencyWallet;
- SoliPix real Yandex proof;
- Gorodki Wallet/Result proof.

**NEXT:**

1. Ready UI capability gaps: lives — опционально, music — опционально, generic режимы Result,
   открытая LevelMap там, где нужно.
2. Production Composer / Bootstrap V1: Production Profile реально собирает нужный production shell
   из существующих capabilities.
3. `INTEGRATION_PROMPT.md` one-pass proof.
4. Fresh cold integration из чистого исходника игры.
5. Autonomous packaging generalized.
6. Stable release candidate.
7. VK / OK → Facebook → Samsung.

Целевые метрики следующего one-pass benchmark (цели, а не текущие claims):

- Core changes during integration: **0**;
- first green: **≤ 30 мин**; final: **≤ 45 мин**;
- production glue (profile + adapter + extensions): **≤ 120 LOC**;
- gameplay: **≤ 2 файла / ≤ 25 строк**;
- уточнений от человека после initial spec: **0**;
- решений, придуманных AI: **≤ 3**.

---

## Правила архитектуры

1. Game-specific gameplay logic остаётся вне Core.
2. Generic bug → исправление в Core.
3. Game-specific bug → исправление в host/игре.
4. Один writer на repo/ветку.
5. Сначала воспроизвести и найти root cause, потом исправлять.
6. Пропущенный баг по возможности становится regression test.
7. «Tests green» недостаточно — нужно понимать, что именно они доказывают.
8. Визуальные изменения требуют скриншотов.
9. Важный production UI проверяется на реальном устройстве.
10. Никаких необъяснённых magic offsets / timeouts.
11. Не расширять scope внутри активного инженерного slice.
12. Предпочитать bounded tasks с hard stop.
13. Не добавлять в Core жанровые механики.
14. Не хардкодить в Core секреты, JWT, project IDs.
15. Игры закрепляют точную версию/tag Core; никаких тихих обновлений до latest.
16. Продуктовые значения, которые AI не может надёжно вывести, задаются в production spec/profile.
17. Новые generic API требуют доказательства из реальных интеграций.

## Не строить заранее

Вне Core, пока повторяющиеся реальные игры не докажут необходимость: match-3 правила, карточные механики,
бой, game-specific физика, AI противников, жанровые правила экономики, уникальные Victory-layouts,
hard currency, game-specific модель жизней, бустеры, множители наград за rewarded-рекламу, мультивалютность.

Game Core — **production SDK**, а не универсальный gameplay engine.

UI: стандартный Ready UI — asset-based. Core владеет логикой, состоянием, вводом, motion, layout и семантикой
компонентов; художник/игра — asset pack и game-specific art. Шов для другого скина (`uiSkin id → asset pack →
существующие компоненты`) — только когда реальный второй asset-скин это докажет. Большую programmatic theming
архитектуру не открывать заново.

## Модель работы

- **Пользователь** — product / tech owner, принимает продуктовые и архитектурные решения.
- **ChatGPT** — архитектура, дизайн задач, review, acceptance criteria, roadmap, дизайн benchmark.
- **Claude Code** — реализация, тесты, browser proof, commits.
- **Опциональный reviewer** — read-only review рискованных архитектурных изменений.

Процесс качества: дефект → воспроизведение → root cause → чья ответственность → исправление в правильном слое →
regression test → старые регрессии → browser proof → real-device / platform proof, когда нужно.

Слои QA: unit, component, geometry/layout, browser smoke, визуальные скриншоты, integration, fake-platform proof,
production smoke, реальное устройство, реальный platform draft.

Метрики зрелости на каждую новую игру: wall time интеграции, время до первого зелёного прогона,
production glue LOC, изменённые файлы/строки gameplay, QA LOC отдельно, требуемые изменения Core,
вмешательства/уточнения человека, решения, придуманные AI, повторные browser-прогоны, баги, найденные после
автоматической приёмки. QA/test LOC не смешивать с production integration LOC.

## Рабочие репозитории

Рабочая папка: `~/Desktop/games-workspace/`.

- `game-core/` — этот repo;
- `solipix-old/`, `solipix-core-clean/`, `solipix-yandex-draft/`;
- `gorodki-source-clean/`, `gorodki-core-clean/`;
- `trail_arrow-latest/`.

Старые инкрементальные и экспериментальные папки интеграций — не канонический вход для новых cold benchmarks.
Команды LAN / iPhone — рабочее знание чата, а не public API SDK.
