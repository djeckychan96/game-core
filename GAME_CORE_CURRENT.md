# GAME_CORE_CURRENT

_Состояние на: 2026-09-25_

Каноническое **текущее** инженерное состояние Game Core: принятый baseline, актуальные proof, ограничения и
roadmap. Это не changelog: история — в `git log`, в `docs/superpowers/specs/` и в чатах проекта. Обзор продукта —
[README.md](README.md), шаблон подключения новой игры — [INTEGRATION_PROMPT.md](INTEGRATION_PROMPT.md).

## Миссия

Game Core — общая production-платформа для HTML5/web-игр команды.

**GAMEPLAY + GAME CORE + BACKGROUND / ASSET SKIN / CONFIG**

Game-specific gameplay остаётся вне Core. Core растёт только так:

**реальная потребность игры → generic pattern → Core API → regression test**

Главная продуктовая цель: сократить число решений и строк production-glue, которые AI/инженер заново пишет
для каждой новой игры.

### Модель продуктовой семьи (решение product owner, 2026-09-25)

**Своё у каждой игры:** gameplay / механика, фоны, данные уровней и контента, game-specific art там, где нужно.

**Общее через Game Core:** LevelMap команды, HUD, production UI, экономическая инфраструктура, жизни, save,
реклама, покупки, аналитика, платформы, общие production/meta-механики.

Между играми в основном меняются gameplay, фоны, asset skin / цвета, config / product data.

- Meta-механики оригинальных/reference-игр автоматически не копируются.
- Чужая level map из reference-игры не переносится: используется своя Core `LevelMapView`.
- Календарь после 45-го уровня сейчас не переносится.
- Daily tasks / календарь / другие LiveOps — позже, когда product owner реально решит использовать их в играх.
  LiveOps идут тем же путём: real need → generic pattern → Core API → regression test.

---

## Current runtime baseline

- ветка: `feat/production-profile-v1`, pushed в `origin/feat/production-profile-v1`;
- **runtime/API baseline: `b094da3`** — OrientationGuard V1;
- версия пакета: `0.2.0`;
- не merged в `main`;
- stable release tag для текущего baseline нет (теги `v0.1.0` / `v0.2.0` — старые точки на `main`, `bb42fc6`
  от 2026-09-15, к baseline отношения не имеют);
- игры закрепляют точный commit/tag Core; никакого silent latest.

Documentation commits поверх `b094da3` не меняют runtime, API и tests и новым baseline не считаются.
Pin игры на docs-коммит даёт тот же runtime, но другой `BUILD_INFO.commit`. SoliPix `vendor:core` требует
`HEAD` Core == pin, чистое tracked-дерево и `dist/BUILD_INFO` этого commit с `dirty: false` — перед vendoring
пересобрать dist (`npm run build`): dist, собранный до commit, несёт чужой `BUILD_INFO` и будет отвергнут.

## Accepted Core chain

| Commit | Что |
|---|---|
| `fa9105b` | LevelMap pulse lifecycle fix: motions узла отменяются до уничтожения узла |
| `a29cec8` | Gameplay Contract V1 + GameProductionProfile V1 (types + `validateGameProductionProfile`) |
| `97b6d39` | SaveGate V1 |
| `92464ad` | Yandex: безопасная full-object patch semantics записи в облако |
| `d773319` | SoftCurrencyWallet V1 |
| `e8fbfc2` | Purchase consume-order safety: подтверждённая покупка больше не ждёт consume перед выдачей товара |
| `b24be3f` | crash-window regression proofs: доказаны ограничения legacy purchase path |
| `75a7aea` | Yandex honest storage ACK |
| `4504e52` | PurchaseLedger V1: opt-in durable / idempotent выдача consumables |
| `bc2c2a4` | Rewarded Availability Recovery (B17) |
| `af70d17` | `ResultWindowView` outcome `win` \| `fail`: generic retry / exit fail mode |
| `b094da3` | OrientationGuard V1: portrait-only touch games |

Commits между ними (`b56923d`, `f45a00d`, `e6c69df`) — только документация.

## Accepted capabilities

**Gameplay Contract / Production Profile V1** (`a29cec8`)
- события игры: `ready / levelStart / levelEnd`, опционально `levelExit`;
- команды: `startLevel / restart / setPaused / setSound`, опционально `setMusic / next`; `getProgress`;
- режимы: `frame: core | gameplay`, `input: layer | query`; progression `linear | open`;
- `GameProductionProfile`: `progression`, `ui`, `economy`, `monetization`, `platform`, `save`; строгий validator
  (неизвестные поля, секреты, дубли product ID отвергаются);
- Contract V1 — это types + validator: Core сам не подписывается на события игры и не исполняет `setPaused`;
  host передаёт результаты нужным runtime (например, `SoftCurrencyWallet.applyLevelResult`).

**SaveGate V1** (`97b6d39`)
- запись разрешена только после загрузки и `open()`;
- `missing` (новый игрок) отличается от `failed` (чтение не удалось); при `failed` defaults не перезаписывают
  неизвестное состояние;
- запись только в объявленные `save.keys`; состояние Core — отдельная запись `<profile.id>.core`;
- опциональные `save.groups` — независимые домены отказа;
- ошибки storage — результат `{ ok, reason }`, не исключение через gameplay;
- после `75a7aea` `ok: true` означает подтверждённую нижележащую запись.

**Yandex storage** (`92464ad` + `75a7aea`)
- Yandex `setData` заменяет весь объект: adapter читает полный объект один раз за сессию, накладывает patch и
  отправляет объект целиком; записи и `clear` идут одной очередью;
- `storage.set` отвечает `true` только после физической записи, которая содержит state именно этого caller;
  сбой (или остановка цепочки на более раннем сбое) отвечает `false` всем ещё не записанным ожидающим;
- контракт `PlatformStorage.set`: `true` = подтверждённая запись, несущая patch; DEV adapter ему соответствует.

**SoftCurrencyWallet V1** (`d773319`)
- одна soft currency с `owner: 'core'`; валюта игры (`owner: 'gameplay'`) остаётся в игре, кошелёк не создаётся;
- состояние — Core-запись `wallet` через `SaveGate`; неудачное чтение → `unavailable` (баланс `null`, изменения
  отклоняются);
- награда за уровень: первое прохождение — один раз на уровень, повтор — только opt-in `replayReward`,
  поражение — никогда; числа наград задаёт профиль игры.

**Purchases** (`e8fbfc2`, `b24be3f`, `4504e52`) — см. раздел «Покупки».

**Rewarded Availability Recovery / B17** (`bc2c2a4`, Yandex adapter)
- временная ошибка rewarded больше не выключает rewarded до конца сессии;
- подтверждённый `onRewarded` и глобальное событие `online` восстанавливают availability;
- recovery сам reward не выдаёт; обычное закрытие без `onRewarded` availability не восстанавливает;
- public API: 0 изменений.

**ResultWindowView fail mode** (`af70d17`)
- `ResultWindowParams.outcome?: 'win' | 'fail'` (default `win`); опции `onExit` / `exitLabel`;
- fail: без звёзд и награды, RETRY → `onRetry`, EXIT → `onExit` (если передан); × / backdrop → только `onDismiss`;
- `rewardCoins` остаётся обязательным параметром (fail передаёт 0, значение игнорируется).

**OrientationGuard V1** (`b094da3`, `game-core/pixi`)
- `createOrientationGuard({ orientation: 'portrait' })`: блокирует только
  `(orientation: landscape) and (pointer: coarse)` — mobile/touch landscape; desktop wide не блокируется;
- cover поверх страницы с текстом, глотает input; уже идущий pointer capture (drag) host обязан завершить сам
  в `onChange(true)`;
- guard только блокирует input — pause он не делает (см. риски);
- `ui.orientation` в Profile не добавлен.

## Core regression

На `b094da3`:

- `npm test`: **804 / 804 PASS** (64 test-файла; повторно запущен 2026-09-25);
- `tsc`: **PASS**;
- build: **PASS**;
- orientation browser proof (`npm run showcase:orientation`): **PASS** —
  390×844 touch portrait → normal; 844×390 touch landscape → orientation blocker; 1280×800 desktop → blocker
  отсутствует.

## Состав Core

- **Foundation:** `CoreRuntime`, `UiRuntime`, `MotionRuntime`, `FxRuntime`.
- **Production integration:** Gameplay Contract, `GameProductionProfile`, `SaveGate`, `SoftCurrencyWallet`,
  `PurchaseLedger` (opt-in режим `PurchaseRuntime`).
- **Production runtimes:** `AdsRuntime` + Ads Policy, `PurchaseRuntime`, `OfferRuntime`, `AnalyticsRuntime`,
  `PlatformRuntime`.
- **Ready UI** (`game-core/pixi`): `HudView`, `LevelMapView`, `SettingsWindowView`, `ResultWindowView`
  (win / fail), `ShopWindowView`, `NoAdsWindowView`, `LivesWindowView`, `StarterPackWindowView`; primitives
  `UiButton`, `ModalWindow`; `ReadyUiOverlay` для игр не на Pixi; `OrientationGuard`.
- **Platforms:** DEV (`createDevPlatform`), Yandex (`game-core/platform/yandex`, отдельный entry).
  CleverApps — только значение `provider` в типах конфигурации, adapter отсутствует.

Ads / Purchase правила: NoAds cadence — policy/config; `no_ads` — entitlement, никогда не consume; coin packs —
consumable; restore заново подтверждает entitlement; product IDs и секреты платформы в Core не хардкодятся.

---

## Покупки

Две модели выдачи consumables:

- **Legacy path** (без `ledger`): `grant` + реестр токенов + `restoreGrant`. Порядок после `e8fbfc2`: claim →
  grant → consume, consume не ждётся. Crash durability — **best-effort**: реестр токенов и состояние товара — две
  независимые записи host, поэтому при падении между ними остаются окна потери или двойной выдачи. Они
  зафиксированы как `LEGACY OPEN` (`test.fails`) в `tests/purchases/crash-windows.test.ts`.
- **Production-safe path — `PurchaseLedger`** (`PurchaseRuntimeOptions.ledger`, opt-in): одна операция
  `apply({ token, productId, rewards, context })` → `applied | already_applied | not_durable`.

Инвариант PurchaseLedger: **purchase token + purchase effect сохраняются владельцем данных ОДНОЙ durable
operation.** Consume — только после подтверждённого `applied` / `already_applied`; `not_durable`, исключение или
мусорный ответ → ничего не consume, покупка остаётся на платформе для следующего restore (fail closed).

Core отвечает за orchestration. Core **не** обещает атомарность между двумя независимыми host records и не может
проверить атомарность владельца: для gameplay-owned валюты это обязанность host. Entitlements (`no_ads`) через
ledger не идут: они никогда не consume и заново подтверждаются restore. Контракт, обязанности владельца, guest,
multi-device и события — spec PurchaseRuntime v0.6 §10–§11.

Новые production consumables подключать через `PurchaseLedger`.

---

## SoliPix — reference / acceptance game

SoliPix — текущая основная reference/acceptance-игра для production/platform hardening.

- canonical source: `~/Desktop/games-workspace/solipix-core-clean/` (у repo нет remote);
- `solipix-yandex-draft/` — superseded, **не** отдельный source of truth;
- current commit: **`e027767`**, pinned Core: **`b094da3`** (vendored в `vendor/game-core`, `npm run check:core`);
- изменения gameplay-механики в последнем integration slice: **0**.

Подключено:

- canonical source / build pipeline: `build` (plain copy) → `scan:package` → `smoke:package` → `pack`;
- exact Core pin;
- Yandex fail-closed: сбой запуска Yandex SDK → явная ошибка запуска, без fallback на DEV (production entry не
  содержит DEV-платформы);
- gameplay-owned coins (Wallet не используется — валюта принадлежит игре);
- cloud save: запись игры через host `save.js` поверх `PlatformStorage` Core (honest ACK); `SaveGate` не нужен,
  пока у SoliPix нет Core-записи;
- `PurchaseLedger`: coins и `appliedPurchaseTokens` уходят одной записью одного объекта; без durable cloud save
  (guest / неудачное чтение) coin pack не продаётся — платёж не открывается;
- `no_ads` restore;
- B17 rewarded recovery — поведение Yandex adapter, host-кода нет;
- Core `ResultWindowView` — **только fail**: экран победы остаётся собственным DOM-экраном SoliPix;
- terminal fail / retry flow;
- `OrientationGuard`.

### Terminal fail

0 ходов → окно «НЕТ ХОДОВ». Продолжить за coins, продолжить за rewarded или «ЗАНОВО» (restart) —
**не** terminal fail.

Игрок закрывает окно × без продолжения →
`levelEnd({ level, win: false, firstCompletion: false, metrics: { movesLeft: 0 } })`, один на забег →
Core `ResultWindowView` `outcome: 'fail'`: «УРОВЕНЬ N» / «НЕ ПРОЙДЕН».

- ЗАНОВО → `restartLevel`;
- К УРОВНЯМ → существующий flow выхода на карту уровней;
- × → безопасный выход на карту;
- закрытие по backdrop отключено.

Gameplay source для этого не переписывался (host `outcome.js` + `ui.js`). `levelEnd` пока не потребляется Core
(Contract V1 — types): host отдаёт его наружу.

### Orientation

`createOrientationGuard({ orientation: 'portrait' })`:

- mobile portrait → normal;
- mobile/touch landscape → «Поверните устройство», gameplay input заблокирован;
- desktop wide → normal;
- поворот во время drag: host безопасно завершает drag, ход не тратится.

Известные ограничения (pause-runtime **не** закрыт): generic pause arbitration нет; музыка под orientation
overlay может продолжать играть; некоторые уже запущенные анимации могут завершиться.

### Test status (`e027767`)

- `npm test`: **70 / 70 PASS**;
- source smoke: **69 / 69 PASS**;
- package smoke: **32 / 32 PASS**;
- production artifact: `release/solipix-yandex-e027767-core-b094da3.zip`; autonomous package: **PASS**.

### Real Yandex

**PurchaseLedger proof** — предыдущая reference build SoliPix `4c1adbf` + Core `4504e52`, реальный Yandex SDK,
проверено вручную:

- `platformKind = yandex`; cloud save writable; PurchaseLedger `durable = true`;
- real purchase: coins начислены ровно один раз; applied и confirmed purchase tokens совпали;
- reload сохранил balance; `purchases.restore()` не выдал consumable повторно; повторный reload сохранил balance;
- `not_durable` diagnostics = `[]`.

Crash/failure paths подтверждены автоматическими Core tests (`tests/purchases/ledger.test.ts`,
`crash-windows.test.ts`); вручную все crash cases не симулировались.

Итог: **PurchaseLedger V1 production-proven на real Yandex для normal purchase / save / reload / restore path.**

**Current build `e027767`** загружен в реальный Yandex draft, пользователь выполнил manual smoke: основной flow
**PASS**, найден один generic visual defect — Result FAIL desktop scale (ниже). Это Core Ready UI bug, не баг
gameplay SoliPix.

## Городки — Wallet/Result proof

Репозитории: исходник `gorodki-source-clean/` (архив Олега), интеграция `gorodki-core-clean/` — commit `4ac59c1`
на Core `d773319` (у repo нет remote; на `b094da3` не перепинивались).

- Three.js r169 + Rapier 0.14; Core changes during integration: **0**; механика не менялась;
- Core Wallet, HUD coins, Core ResultWindow с наградой: **PASS**;
- manual real-device persistence: **PASS** (0 → 10 → reload 10 → повтор 10 → новый уровень 20 → reload 20);
- full browser smoke после подключения кошелька не завершён (timeout под SwiftShader); приёмка — ручная;
- на реальном Yandex не проверялись; реклама и платежи не подключались.

## Trail Arrow — production donor

Current donor: `trail_arrow-source-2026-09-24/`, версия **0.1.31** (не git repo; содержит реальные `.env.*` —
содержимое не печатать). Боевые «Стрелки» сейчас **не** мигрируются на Game Core — это production donor:

**real production fix → generic pattern → Core → regression**

Уже перенесено: purchase consume-order lesson (`e8fbfc2`), B17 rewarded recovery (`bc2c2a4`).

Открытый donor backlog:

- purchase failure classification (сейчас Yandex adapter сводит любую ошибку SDK к `cancelled`);
- late purchases;
- B16 rewarded integrity (offline / слишком короткий показ → без награды);
- требования CleverApps;
- специфика Facebook / Samsung;
- donor-геометрия и gaps Ready UI.

---

## Ready UI

Ready UI — **asset-based**. Core владеет логикой, состоянием, вводом, motion, layout и семантическими слотами;
художник/игра — asset pack, цвета, game-specific art. Programmatic Bubble/theme architecture **не возвращать**.

Скин = `loadReadyUiAssets({ baseUrl })` поверх фиксированного набора ключей asset pack; views рисуют текстуры в
фиксированные design-unit боксы.

### Второй asset skin — подтверждённая потребность

У команды появилась новая production game. Решение product owner: интерфейсы берутся из существующей игры
Pixel Flow, художница меняет цвета / визуальный стиль под новую игру. Это первый реальный второй asset skin
для Game Core. Механизм смены pack уже есть (`loadReadyUiAssets({ baseUrl })`) — новую theme architecture
не строить.

Art pipeline:

**Pixel Flow source/reference → map к semantic Core asset slots → второй asset package → художница
заменяет/перекрашивает assets → showcase / screenshots → production game**

Layout и размеры не считать окончательными, пока product owner не подтвердит, что геометрия Pixel Flow тоже
сохраняется. Второй skin пока не сделан и не production-integrated.

### Окна новой игры → Core

| Нужно (product owner) | Core |
|---|---|
| Bank | `ShopWindowView` |
| Settings | `SettingsWindowView` |
| Lives | `LivesWindowView` (только UI) |
| Win / Fail | `ResultWindowView` |
| Exit | **нет** — Generic Confirm / Exit Dialog |
| Hint Purchase | **нет** — Generic Hint Purchase / Offer Dialog |

Жанровые окна не создавать: оба gap закрываются generic-диалогами.

### Актуальные generic gaps

- `LivesWindowView` есть, `LivesRuntime` нет; `HudView` всегда рисует жизни (нет режима без жизней);
- optional music в Settings не исполнено: `SettingsWindowView` всегда рисует музыку;
- `LevelMapView` open mode («все уровни открыты») — при реальной необходимости;
- Generic Confirm / Exit Dialog отсутствует;
- Generic Hint Purchase / Offer Dialog отсутствует;
- Result FAIL desktop scale bug.

### Открытый generic bug: RESULT FAIL DESKTOP SCALE

На desktop Yandex draft (SoliPix `e027767`) fail Result занимает чрезмерно большую часть viewport: ribbon слишком
широкая, заголовок слишком крупный, Retry / Exit слишком крупные. Mobile portrait выглядит приемлемо.

Root cause подтверждён visual proof: fail-композиция короче win, auto-fit даёт fail больший scale, чем win
(замер на приёмке `af70d17`, 1280×800: fit scale fail ≈ 0.97 против win ≈ 0.79).

Нужен отдельный bounded Core slice — **ResultWindow desktop visual parity / scale regression**:

- fail не должен увеличиваться только потому, что его content bounds короче;
- win behavior не ломать;
- visual regression в Core.

Рядом, но отдельно: win на 1280×800 обрезает верхнюю звезду (звёзды не входят в измеряемые bounds при fit) —
pre-existing, частью этого бага не считается.

Это следующий visual Core fix.

---

## Lives

`LivesWindowView` существует; `LivesRuntime` отсутствует. Теперь это подтверждённая реальная capability need;
reference proof — SoliPix.

Цель `LivesRuntime` — generic reusable lives state / policy:

- current / max;
- persistence;
- spend policy и refund policy;
- regeneration и refill;
- rewarded grant;
- callbacks / state.

Product values — из config/profile, правила конкретной игры не хардкодятся (у Trail Arrow, например, жизнь
списывается при входе в уровень; в других проектах — при первом ходе: момент списания — это config).

Цель: одна lives capability подключается к новому gameplay через стандартный host seam/profile, без собственной
системы жизней в repo игры.

## Платформы

Core adapters: **DEV**, **Yandex**. **CleverApps adapter отсутствует** — теперь высокий priority: следующая
реальная игра планируется главным образом под Facebook.

Current production finding (Trail Arrow 0.1.31):

- Facebook = ZIP → Facebook Web Hosting → Facebook Instant; не наш server hosting;
- Samsung = ZIP → platform Web Hosting;
- свой server нужен в первую очередь для VK, OK, web и возможного отдельного Facebook Canvas case.

Build-модель: **ONE SOURCE → ONE DETERMINISTIC BUILD PIPELINE → PLATFORM-SPECIFIC ARTIFACTS.** Цель — не один
физически одинаковый ZIP: target выбирается явно при сборке, platform shell/config различаются по target.

### CleverApps — текущий gap

По Trail Arrow audit до adapter нужны generic contract gaps:

- purchase failure classification: retryable / code / unavailable / not_ready / timeout;
- structured launch parameters (сейчас только `launchPayload(): string`);
- richer banner result: code / reason / layout height, где применимо (сейчас boolean);
- `studioId` в connector config;
- ad denial / error reason/code, где generic contract это оправдывает.

CleverApps-specific SDK / FBInstant / GSInstant в root Core **не** попадают: нужна отдельная platform entry
(как `game-core/platform/yandex`).

## QA process

Reference builds имеют exact game commit, exact Core commit и platform/build identity.

**Tester воспроизводит bug → указывает build / device / browser → bug классифицируется: Core | game | platform |
product → fix у правильного владельца → regression → retest.**

SoliPix — текущая основная reference/acceptance-игра для production/platform hardening.

## Planned capabilities (не реализовано)

**QA panel / tooling V1** — внутриигровая QA panel в специальных QA builds. Направление V1:

- FPS / текущие performance indicators;
- game commit, Core commit, platform/build info;
- reset текущего уровня;
- частичный / полный reset прогресса.

Production users доступа к QA capability иметь не должны. Password-in-JS не считается security solution;
точный access mechanism ещё не принят.

**Deterministic platform build pipeline** — AI сборку не придумывает: правила живут в Game Core/tooling,
AI/инженер только вызывает готовый pipeline:

```
build --platform=yandex | facebook | samsung | vk | ok
```

(или эквивалентный deterministic CLI/API). Artifact включает platform shell/config, exact Game commit, exact Core
commit, `BUILD_INFO`, package scan, archive / hash. Сейчас автономная упаковка доказана только на SoliPix
(собственные tools игры), не обобщена.

Self-hosted deploy для VK / OK / web — следующий infrastructure layer, не blocker для Facebook Instant.

---

## Текущие ограничения и риски

- **Result FAIL desktop scale** — visual bug Core Ready UI (см. выше).
- **`LivesRuntime` отсутствует**; `HudView` всегда рисует жизни.
- **Pause arbitration не централизован:** orientation / modal / ad не согласуют pause между собой;
  `setPaused` в Contract V1 — только тип.
- **SoliPix terminal fail после reload:** reload при открытом fail Result восстанавливает доску с 0 ходов →
  снова «НЕТ ХОДОВ» → возможен новый run / второй `levelEnd` для того же логического забега. В Contract V1 нет
  run identity; при opt-in `replayReward` дублированный `levelEnd` заплатил бы повторно.
- **Victory `levelEnd` в SoliPix пока не подключён** (подключён только terminal fail).
- **Multi-device Yandex:** `setData` заменяет весь объект, объект читается раз за сессию → два устройства,
  пишущие одновременно, перезаписывают друг друга (last writer wins); PurchaseLedger гарантирует exactly-once
  только в пределах одной save lineage.
- **CleverApps adapter отсутствует** — Facebook / Samsung через Core пока не поддержаны.
- **Второй asset skin ещё не production-integrated.**
- **Stable v1 tag / release flow нет.**
- **Production Composer отсутствует:** Contract/Profile не исполняются стандартным bootstrap; связку ads /
  purchase / NoAds / save / fail-closed собирает host каждой игры.
- PurchaseLedger: список applied tokens в SoliPix не чистится (растёт на каждую покупку coin pack; лимит Yandex
  cloud save ~200 KB); эффект, ставший durable через неоднозначную запись, позже ответит `already_applied` и
  не даст `granted` / revenue event.
- `AnalyticsRuntime` не подключён ни в одной реальной игре.
- Fresh one-pass cold integration новой production game пока не доказан.

## Текущий статус

Game Core уже доказан:

- на нескольких независимых gameplay stacks (SoliPix DOM/CSS, Городки Three.js + Rapier);
- на реальном Yandex;
- на real purchase / save / restore path;
- с reusable production UI;
- с generic fail flow;
- с orientation protection.

Текущий этап — не доказательство «можно ли интегрировать Core», а укрепление общей production-платформы:
reference-game hardening, reusable meta mechanics, artist-driven asset skins, Facebook / CleverApps,
QA / build infrastructure, уменьшение game-specific glue.

Не утверждать, что любой gameplay автоматически production-ready.

## Roadmap

**NOW:**

1. Fix ResultWindow FAIL desktop scaling + Core visual regression.
2. Rebuild / re-pin SoliPix после generic visual fix и дать exact build тестировщику.
3. `LivesRuntime` V1 + SoliPix lives proof.
4. CleverApps Contract Prep V1 по Trail Arrow 0.1.31.

   Если Facebook credentials / production deadline станут срочными, пункты 3 и 4 можно поменять местами.

**NEXT:**

5. `game-core/platform/cleverapps` — сначала Facebook.
6. Real Facebook artifact / proof.
7. Samsung option того же adapter.
8. Ready UI: Pixel Flow second asset skin; Generic Confirm / Dialog; Generic Hint Purchase / Offer.
9. QA panel / tooling V1 — после фиксации acceptance requirements.
10. Deterministic platform build pipeline.
11. Self-hosted VK / OK / web deploy.
12. Production Composer / Bootstrap V1.
13. Fresh one-pass cold integration новой production game.
14. Stable release candidate / tag.

LiveOps (calendar, daily tasks и т. п.) в ближайший roadmap не входят, пока нет принятой product need.

Целевые метрики one-pass integration (п. 13; цели, а не текущие claims): Core changes **0**; first green
**≤ 30 мин**, final **≤ 45 мин**; production glue (profile + adapter + extensions) **≤ 120 LOC**; gameplay
**≤ 2 файла / ≤ 25 строк**; уточнений от человека после initial spec **0**; решений, придуманных AI, **≤ 3**.

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
18. Platform-specific SDK живут в отдельных platform entries, не в root Core.

## Не строить заранее

Вне Core, пока повторяющиеся реальные игры не докажут необходимость: match-3 правила, карточные механики, бой,
game-specific физика, AI противников, жанровые правила экономики, уникальные Victory-layouts, hard currency,
game-specific правила жизней (generic `LivesRuntime` — подтверждённая потребность, см. «Lives»), бустеры,
множители наград за rewarded-рекламу, мультивалютность, LiveOps без принятой product need.

Game Core — **production SDK**, а не универсальный gameplay engine.

UI: второй скин — это второй asset pack поверх существующих компонентов (`loadReadyUiAssets({ baseUrl })`),
а не новая theming-архитектура. Большую programmatic theming архитектуру не открывать заново.

## Модель работы

- **Пользователь** — product / tech owner, принимает продуктовые и архитектурные решения.
- **ChatGPT** — архитектура, дизайн задач, review, acceptance criteria, roadmap, дизайн benchmark.
- **Claude Code** — реализация, тесты, browser proof, commits.
- **Тестировщик** — ручная проверка reference builds, воспроизведение багов с build / device / browser.
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
- `solipix-core-clean/` — canonical source SoliPix (reference/acceptance game);
- `solipix-yandex-draft/` — superseded упаковка на Core `92464ad`, не source of truth;
- `gorodki-source-clean/`, `gorodki-core-clean/`;
- `trail_arrow-source-2026-09-24/` — current production donor 0.1.31;
- `trail_arrow-latest/` — Trail Arrow 0.1.22 (старый OfferRuntime proof), не current donor.

Старые инкрементальные и экспериментальные папки интеграций — не канонический вход для новых cold benchmarks.
Команды LAN / iPhone — рабочее знание чата, а не public API SDK.
