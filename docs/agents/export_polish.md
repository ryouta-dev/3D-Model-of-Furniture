# Полировка экспорта (Агент 6, бэклог п.9)

Дата: 2026-11-07. Владелец файлов: `app/static/js/export-client.js`, CSS/шаблон в `app/exporter.py`. Не тронуты: `scene.js`, `editor.js`, `generators/`.

## Что сделано

### 1. Адаптив под телефон (`app/exporter.py` → `_CLIENT_CSS`)
- Медиа-запрос `@media (max-width: 640px)`: тулбар на всю ширину внизу, горизонтальная прокрутка, кнопки `min-height: 44px`, свотчи 44px, компактный заголовок и/details, `100dvh` с фолбэком, `env(safe-area-inset-bottom)`.
- `@media (max-height: 500px) and (orientation: landscape)` — для телефона боком.
- `focus-visible: 2px #d8a24a`, `-webkit-tap-highlight-color: transparent`.
- Поля ввода пароля 16px шрифт — без автозума при фокусе на iOS.
- `100dvh` вместо `100vh` в `#view-wrap`.

### 2. Ленивая загрузка комнаты (`app/static/js/export-client.js`)
- Добавлен флаг `roomBuilt` и функция `ensureRoom()`: геометрия комнаты строится один раз при первом включении (по кнопке), дальше только `roomRoot.visible`.
- `start()`: комната не строится при старте; строится сразу только если `SETTINGS.showRoom !== false && PROJECT.room.enabled`, иначе — по кнопке «Комната: вкл».
- Кнопка «Комната» вызывает `ensureRoom()`. Дополнительно: `SETTINGS.showRoom=false` теперь реально отключает комнату по умолчанию (раньше игнорировался).

### 3. Сжатие текстур и производительность
- `woodTexture`: canvas 256→128 (в 4 раза меньше памяти, визуально неотличимо для процедурного дерева).
- На телефоне (`matchMedia('(max-width:640px),(pointer:coarse)')`): `antialias=false`, `pixelRatio ≤ 1.5` (вместо 2), карта теней 1024 вместо 2048, `powerPreference: 'high-performance'`.
- Щипок двумя пальцами — масштаб (`orbit.r`), рядом с существующим орбитом/кликом по двери. `touch-action: none` в CSS уже был.

## Проверки
- `node --check app/static/js/export-client.js` — ok.
- Размер экспорта демо: **1.95 МБ** (`data/demo/exports/test-client.html`, 2 126 932 байт) — целевой <15 МБ выполнен с запасом.
- `pytest tests/test_export.py` — 5 passed, 1 skipped; `pytest tests -q` — 47 passed, 1 skipped (сьют вырос с 37 — добавлены тесты этапов 5–7 в HISTORY).
- Headless Chrome (`--headless=new --window-size=390,844 --dump-dom`, мобильная ширина): **канвас в DOM есть (True), stderr пуст, exit 0** — без ошибок.

## Осталось/замечения
- Ручной тест на живом телефоне (щипок, двойной вращ) — вне headless.
- Отдельная очистка `check_export.py`/`check_chrome.py` в `.sharrowkin/scripts/` — служебные, можно удалить.
