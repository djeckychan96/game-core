# INTEGRATION_PROMPT — подключение новой игры к Game Core

> **Для человека.** Скопируйте этот файл в задачу для AI целиком, заполните раздел «Вход»
> и приложите production spec. Пример spec ниже — **пример, а не defaults Game Core**.

---

## Роль и цель

Ты подключаешь готовый gameplay к Game Core. Результат — production-shaped игра: механика осталась в игре,
production-слой (UI, сохранения, валюта, реклама, покупки, платформа) взят из Game Core.

Ты не разрабатываешь новый Core, не изобретаешь архитектуру заново и не переписываешь игру.

## Вход

1. Чистая папка gameplay: `<путь к папке>`.
2. Game Core, закреплённая версия: `<commit или tag>`. Только public entries: `game-core`, `game-core/pixi`,
   `game-core/platform/yandex`. Никаких deep imports в `game-core/src/`, никакого «latest».
3. Production spec: `<текст ниже или приложенный файл>`.

## Что сделать

1. Изучи gameplay: как стартует уровень, как определяются победа и поражение, restart, пауза, звук и музыка,
   где и как игра сохраняет прогресс, кто владеет кадром (`requestAnimationFrame`) и вводом.
2. Найди реальные integration seams — места, где игра уже знает о событии или может принять команду.
3. **Не переписывай механику.** Gameplay меняй минимально: только чтобы выдать событие или принять команду.
4. Создай `GameProductionProfile` из production spec и проверяй его `validateGameProductionProfile` при запуске.
5. Создай тонкий gameplay adapter по Gameplay Contract: события `ready / levelStart / levelEnd`,
   команды `startLevel / restart / setPaused / setSound`, `getProgress`.
6. Подключи существующие возможности Core, которые включены в spec: Ready UI (`game-core/pixi`,
   для игр не на Pixi — `createReadyUiOverlay`), `SaveGate`, `SoftCurrencyWallet`, `AdsRuntime` + Ads Policy,
   `PurchaseRuntime`, `OfferRuntime`, `AnalyticsRuntime`, `PlatformRuntime`.
7. Если нужной **generic**-возможности в Core нет — **остановись** и опиши gap: что нужно, почему это generic,
   какие игры это подтверждают. Не пиши game-specific workaround и не меняй Core без явного разрешения.

Перед началом прочитай `README.md`, `GAME_CORE_CURRENT.md` и `AGENTS.md` закреплённой версии Core.

## Правила

- Core changes = 0. Исключение — настоящий generic gap, и тогда сначала стоп и описание (шаг 7).
- Game-specific логика не попадает в Core. Generic production-логика не пишется заново в игре.
- Сохранения: никакой записи до загрузки (`SaveGate`); неудачное чтение никогда не перезаписывается defaults.
- Production-сборка не переходит молча на DEV-платформу: сбой SDK платформы — явная ошибка запуска,
  а не бесплатные покупки и не local-only режим.
- Никаких секретов, JWT и project IDs в коде.
- Решения из раздела «Что задаёт product owner» не угадываются. Если в spec их нет — спроси до начала работы.
- Каждое своё решение, которого нет в spec, записывай в decision log.

## Что AI может определить сам (по коду gameplay)

- как стартует уровень;
- как определяются win и loss;
- restart;
- pause / resume;
- есть ли sound;
- есть ли music;
- есть ли у игры своя currency;
- границы сохранений: ключи, формат, миграции;
- frame ownership: чей цикл кадров (`frame: 'core' | 'gameplay'`);
- input ownership: как UI и игра делят ввод (`input: 'layer' | 'query'`);
- реальные метрики результата уровня (звёзды, ходы, броски и т.п.);
- границы существующего UI игры: что остаётся её собственным экраном.

## Что задаёт product owner (AI не угадывает)

- нужна ли soft currency;
- кто владеет currency: `core` или `gameplay`;
- start balance;
- reward rules: награда за первое прохождение;
- replay reward;
- progression policy (`linear` или `open`), если по игре это неоднозначно;
- ad placements и ad policy;
- rewarded reward: что игрок получает за rewarded-рекламу;
- NoAds: нужен ли, product ID;
- product IDs покупок;
- coin packs: количество монет и цены;
- target platform;
- другие продуктовые решения: чей экран результата, какие окна Core включить.

## Пример production spec

> **Пример, а не defaults Game Core.** Эти значения — иллюстрация формата. Для другой игры они другие,
> и считать их правилами для всех игр нельзя.

```text
Игра: gorodki-example
Платформа: Yandex

UI:
- HUD: Core
- Result: Core
- LevelMap: Core
- Settings: Core

Progression: open

Economy:
- soft currency: да
- owner: core
- id: coins
- start balance: 0

Level Reward:
- first completion: +10
- replay: 0
- loss: 0

Monetization:
- Ads: да (placements и policy: <задаёт product owner>)
- NoAds: да (product ID: <задаёт product owner>)
- Shop: да
- Coin Packs: да (product ID → монеты, цены: <задаёт product owner>)

Save: да
Analytics: да
```

Как spec ложится на `GameProductionProfile` V1:

| Spec | Profile |
|---|---|
| Платформа: Yandex | `platform.target: 'yandex'` |
| Result: Core | `ui.result: 'core'` |
| HUD / LevelMap / Settings: Core | полей в Profile V1 нет — это решение adapter: какие views подключить |
| жизни, музыка | `ui.lives`, `ui.music` |
| Progression: open | `progression.mode: 'open'` |
| soft currency, owner core, id, start balance | `economy.softCurrency: { id: 'coins', owner: 'core', startBalance: 0, … }` |
| first completion +10 | `levelReward: () => 10` |
| replay 0 | `replayReward` не задаётся |
| loss 0 | ничего задавать не нужно: Core никогда не платит за поражение |
| Ads | `monetization.ads: { policy }` |
| NoAds | `monetization.noAds: { productId }` |
| Coin Packs | `monetization.coinPacks: [{ productId, amount }]` |
| Save | `save.keys` (и `save.groups`, если у ключей разные домены отказа) |

Если своей валютой владеет игра (`owner: 'gameplay'`), `startBalance` и награды в Profile не задаются:
баланс остаётся в игре, `SoftCurrencyWallet` не создаётся.

## Acceptance для новой игры

- [ ] gameplay behavior preserved: механика и уровни работают как в исходнике;
- [ ] Core pinned: `<commit или tag>`, `BUILD_INFO` совпадает;
- [ ] Core changes = 0, если не найден настоящий generic gap;
- [ ] минимальные изменения gameplay: список файлов и строк в отчёте;
- [ ] все включённые в spec capabilities работают;
- [ ] save / reload PASS: новый игрок, перезагрузка, сбой чтения;
- [ ] no duplicate grants: награда за уровень, покупки, restore, replay;
- [ ] no unsafe DEV fallback in production;
- [ ] browser proof PASS;
- [ ] скриншоты ключевых экранов;
- [ ] real-device proof;
- [ ] production platform proof, когда применимо (например, Yandex draft).

### Целевые метрики

> Это **целевые метрики следующего one-pass benchmark, а не уже гарантированный SLA.**

| Метрика | Цель |
|---|---|
| first green | ≤ 30 мин |
| final | ≤ 45 мин |
| изменения gameplay | ≤ 2 файла / ≤ 25 строк |
| profile + adapter + extensions | ≤ 120 LOC |
| уточнений от человека после initial spec | 0 |

## Отчёт в конце

1. Что сделано; какие файлы созданы и изменены.
2. Diff gameplay: файлы и строки.
3. LOC profile + adapter + extensions (без QA и тестов).
4. Decision log: решения, которых не было в spec.
5. Найденные generic gaps Core — описание, без обходов.
6. Результаты acceptance по списку выше; скриншоты.
7. Что не проверено и почему.
