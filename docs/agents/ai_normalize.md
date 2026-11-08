# Агент 5: Нормализация ИИ — отчёт

## Задача
После валидации сливать отдельные модули кухни в ряды, конвертировать компактную схему `row/wall/start` в полные предметы для прямой кухни, выравнивать верх над низом. Чистая функция `normalize_projects(list) -> list`. Не трогать `scene/editor/generators`.

## Что сделано

### `app/ai.py` — только normalize-часть
- Добавлен `import copy`.
- Новые функции (чистая логика, без IO):
  - `normalize_projects(projects)` — публичная точка входа. Копия входа, вход не мутируется. Порядок: компакт → слияние → выравнивание.
  - `_expand_compact_project(p)` — прямая компактная кухня (`wall=back`, конверт `version/id/name` на месте) → полные предметы. Группировка одинаковых модулей в ряды, `start` → `position.x`, дефолты из `generators/common.js` PRESETS, полна комната/цена при отсутствии, `common/check/assumptions` удаляются. Угловая (`wall != back`) и компакт без конверта возвращают `None` и остаются ошибкой для ретрая.
  - `_merge_kitchen_rows(items)` — слияние `kitchen_base`/`kitchen_wall` при одинаковых параметрах (включая `front`, `corpus`, `facade`, `handle`, габариты). Только contiguous-участки (`x == prev.x + w*modules`, `z` совпадает), итого `modules <= 6` (схема), порядок низ → верх → остальное.
  - `_align_kitchen(items)` — верх над низом: низ `lift=0/top=true`, верх `lift=1400/plinth=0/top=false`, верх получает левый край `x` низа и спинку `z = z_низа + (d_верха - d_низа)/2`, `rotationY=0`.
- `generate()` вызывает `normalize_projects` сразу после `_as_project_list`, до `_compact_schema_errors` и `validate_project` (на нормализованном выходе). Прямая компактная теперь проходит валидацию, угловая по-прежнему даёт подсказку про этап 6.

### `tests/test_ai_normalize.py` — 13 тестов
- 7 отдельных предметов (4 низа + 3 верха) → 2 ряда (`modules=4/3`), валидация проходит.
- Разные `front`/`facade` не сливаются; разрыв не сливается; итого `>6` не сливается.
- Уже ряды + выровненный верх — идемпотентны.
- Выравнивание верха над низом (`x`, `z` спинок, `lift/plinth/top`).
- Не кухня (шкаф) не трогается; вход не мутируется.
- Компакт прямая → полные предметы, `common` убран, валидация чистая.
- Компакт угловая и без конверта — не конвертируется, остаётся ошибка ретрая.
- `generate()` через мок провайдера возвращает слитые ряды.

## Проверки
- `.venv\Scripts\python.exe -m pytest tests/test_ai_normalize.py tests/test_ai.py -q` → 22 passed.
- `.venv\Scripts\python.exe -m pytest tests -q` → 60 passed, 1 skipped.
- `node tests\test_generators.mjs` → все ok (генераторы не тронуты).
- `node tests\test_room.mjs` → все ok.

## Ограничения и решения
- Слияние только при полном совпадении параметров кроме `id/position/modules`; разные ширины `w` в ряду не поддерживаются (как в генераторах: ряд = `w × modules`).
- Компакт без `version/id/name` не угадывается (нет проекта для сохранения) — это сохраняет старый тест `test_compact_corner_schema_gives_clear_error` зелёным.
- `position` трактуется как левый край `x`, центр `z` (как `scene.js`/`editor.js`).
