# Интегратор: этап 6 — новые типы мебели (corner / sliding / bed / table)

> Роль: не править код, только diff-план для главного агента после работы
> остальных. Источники истины: `TZ_mebel3d.md` п.6 и п.12 этапа 6,
> `HISTORY.md`, `app/static/js/generators/corpus.js` (интерфейс),
> `app/static/js/scene.js` (рендер), `app/exporter.py` (бандл).

## 1. Что уже есть (зафиксировать как инвариант)

### 1.1. ТЗ п.6 — четыре новых типа

```text
wardrobe / chest / kitchen_base / kitchen_wall      — сейчас (этап 1)
sliding_wardrobe / kitchen_corner / bed / table      — этап 6
```

В задаче употребляются сокращённые имена `corner/sliding/bed/table`,
в проекте/ТЗ использовать полные ключи (`sliding_wardrobe`, `kitchen_corner`).
Дороткие алиасы НЕ вводить — сломаются валидация, пресеты и ИИ.

### 1.2. Интерфейс генераторов (`index.js`, `corpus.js`)

```js
// build(params) -> { parts, anim, dims }
```

- `corpus.js: buildItem(p)` — параметрический корпус, формулы 1:1 из прототипа.
  Принимает `p` после `withDefaults(p)` (мердж пресета + `t: 16`).
- `index.js: make(type)` → `buildItem(withDefaults({...params, type}))`,
  `GENERATORS = { wardrobe, chest, kitchen_base, kitchen_wall }`,
  `buildItemByType(type, params)` бросает `Error('Неизвестный тип мебели: …')`.
- `cutlist.js: summarizeCut(parts)` считает площадь только при `kind === 'dsp'`,
  ручки (`cut: null`) пропускает.
- `scene.js: buildMeshesFor(item, built)` — строит меши ТОЛЬКО из `parts`:
  - Box по `size * MM`, позиция `pos * MM`, материал из таблицы
    (`material === 'corpus'|'facade'` → `materials[material + '_' + colorById(item[material]).id]`,
    иначе `materials[part.material]`);
  - если `part.group` — ищет запись в `anim.doors` / `anim.drawers`,
    создаёт pivot-Group в `info.pivot * MM`, анимация:
    `doors → rotation.y = sign * openT * angle`, `drawers → position.z = travel * MM * openT`;
  - ребро (EdgesGeometry) добавляется при `part.edge !== false`.
- `editor.js: addItem` кладёт `w/h/d` из пресета рядом, `renderParams`/`renderCut`
  вызывают `buildItemByType` и рисуют панель/деталировку из возврата.
- `export-client.js: buildMeshesFor` — дублирует логику `scene.js` 1:1
  (кроме материалов дерева/металла — дубликат `scene.js: setMaterials`).

**Вывод:** каждый новый тип — чистый модуль без three.js,
возвращающий `{parts, anim, dims}` в уже принятом формате.
Сцена ничего не пересчитывает, поэтому все формулы — внутри генераторов.

### 1.3. Система координат предмета

Только эта система приемлема для новых типов (иначе сломаются
`footprint`/`clampToRoom`/`updateDims` в `scene.js` и `fitRoomToFurniture` в `editor.js`):

- `x`: `0 … W` — от левого края по фасаду (для corner — по ширине габарита);
- `y`: от пола вверх (0 = пол), `lift` — сдвиг всего предмета от пола;
- `z`: `−D/2 … +D/2`, в центре глубины, фасад смотрит в `+z`, задняя стенка `−z`.
- Размеры в мм, `MM = 0.001` — конверсия в метры при рендере.
- `dims = { w, h, d, lift }` — это ГАБАРИТ предмета.
  Для `corner` (Г-образный) габаритом является bounding-box,
  пустой внутренний угол — внутри габарита.
  `scene.js: footprint()` считает по 4 углам прямоугольника габарита.

### 1.4. Уже принятые диапазоны (не трогать для старых типов)

```js
// common.js
RANGE   = { w:[300,2400], h:[200,2600], d:[150,800], plinth:[0,200], lift:[0,2000] }
COUNTS  = { modules:[1,6], shelves:[0,8], drawers:[1,6] }
FRONTS  = [['open',…], ['door1',…], ['doors2',…], ['drawers',…]]
```

```python
# schema.py
TYPES      = {"wardrobe","chest","kitchen_base","kitchen_wall"}
FRONTS     = {"open","door1","doors2","drawers"}
RANGES     = {"w":(300,2400), "h":(200,2600), "d":(150,800), "plinth":(0,200), "lift":(0,2000)}
COUNTS     = {"modules":(1,6), "shelves":(0,8), "drawers":(1,6)}
THICKNESS  = (16,18)
```

## 2. Четыре новых типа — договорённости для других агентов

> Здесь фиксируются имена, пресеты и новые поля. Главному агенту выбирать
> не нужно — если другой агент реализовал тип с другим именем/полем,
> править агента, а не план.

| Ключ `type` | Метка | Суть |
|---|---|---|
| `sliding_wardrobe` | «Шкаф-купе» | Прямоугольный шкаф, как `wardrobe`, но двери — раздвижные купе |
| `kitchen_corner` | «Кухня, угол» | Г-образный кухонный комплект: основной ряд + боковая ветвь |
| `bed` | «Кровать» | Каркас + изголовье + матрас (не ДСП!) + опц. ящики |
| `table` | «Стол» | Столешница + ножки / опоры |

### 2.1. Пресеты (`common.js: PRESETS`)

Все значения — мм, структура предмета та же, что у старых типов.
Пресеты дополняют `withDefaults` — при слиянии старта `version: 1` не меняется.

```js
sliding_wardrobe: {
  label: 'Шкаф-купе', w: 1000, h: 2200, d: 550,
  shelves: 4, front: 'sliding', drawers: 3,
  plinth: 80, top: false, modules: 1, lift: 0
}
kitchen_corner: {
  label: 'Кухня, угол', w: 2400, h: 720, d: 1800,
  shelves: 1, front: 'door1', drawers: 3,
  plinth: 100, top: true, modules: 3, lift: 0
}
bed: {
  label: 'Кровать', w: 1400, h: 950, d: 2000,
  shelves: 0, front: 'open', drawers: 2,
  plinth: 0, top: false, modules: 1, lift: 0
}
table: {
  label: 'Стол', w: 1200, h: 750, d: 800,
  shelves: 0, front: 'open', drawers: 0,
  plinth: 0, top: true, modules: 1, lift: 0
}
```

Пояснения:

- `sliding_wardrobe`: габариты 1:1 как у `wardrobe`. `front` = новое значение
  `'sliding'`, число раздвижных панелей — 2 (можно 3, отдельным счётчиком
  не усложнять; панели делят ширину пополам).
- `kitchen_corner`: `w` — длина основного ряда по X, `d` — длина боковой
  ветви по Z. Стандартная глубина ветвей = 560 (как `kitchen_base`).
  `modules` = число модулей основного ряда; боковая ветвь на 2 модуля.
  `lift/plinth/top` — как у `kitchen_base` (h=720, plinth=100, top=true).
- `bed`: `w` — ширина (X), `d` — длина (Z, изголовье у `-z`),
  `h` — высота изголовья (каркас ~450 + изголовье). `drawers` — подклад ящиков
  под кроватью (еслиятиец нет — 0, но поле обязано быть).
- `table`: `w/d` — столешница, `h` ≈ 750, `top=true` переиспользует столешницу
  38 мм без свеса? **Важно:** в `corpus.js` столешница `38 мм со свесом 30 мм
  спереди` — для стола генератор свой, свес не нужен, столешница ровно `w×d`.
  В пресете `top` держать `true` для совместимости, но смысл поля для стола
  не тот же. Главному агенту: поле `top` для bed/table интерпретировать
  локально в генераторе, схему `top: bool` не трогать.

### 2.2. Новые поля (минимум, опциональны в JSON)

Главный принцип: **старые проекты обязаны валидироваться и дальше**.
Поэтому все новые поля — обязательные только в пресетах, опциональные
в `schema.py`; старые предметы, которых их нет, подхватывают дефолты
из `withDefaults`/пресетов.

| Поле | Где | Дефолт | Зачем |
|---|---|---|---|
| `slidingPanels` | `sliding_wardrobe` | 2 (1…3) | Двери-купе: 2 или 3 панели-шторки |
| `cornerArmW` | `kitchen_corner` | 600 (600…900) | Ширина боковой ветви (длина перпендикулярного ряда) |
| `cornerSide` | `kitchen_corner` | `'left'` (`'left'\|'right'`) | Угол слева или справа от основного ряда |
| `headH` | `bed` | 950 (600…1300) | Высота изголовья (если `h` представить как габарит, дублировать не надо — см. резерв) |
| `legs` | `table` | `'4'` (`'4'\|'panel'\|'central'`) | 4 ножки / панельные опоры / центральная |

Рекомендация главному агенту: брать только поля, без которых тип
не имеет смысла (`slidingPanels`, `cornerArmW`, `cornerSide`).
`headH` при необходимости выразить через существующее `h`,
`legs` сделать строкой-расширением, но проверку делать по белому списку
`{'4','panel','central'}`, **не** гаданием `str`.

### 2.3. Диапазоны — per-type, не глобально

Сейчас `RANGE` один глобальный, но для кровати `d` 2000 не входит в `[150,800]`,
для стола `h` 750 — входит, а для corner `w/d` 2400/1800 — тоже не входят.
Разрывать глобальный диапазон под всех невозможно.

План: ввести per-type таблицы, глобальные — как fallback для старых типов
и как условие «галочки» в `editor.js` UI-предупреждения.

```js
// common.js
export const TYPE_RANGES = {
  // для остальных типов падает на RANGE
  sliding_wardrobe: { w:[600,2400], h:[1800,2600], d:[450,800], plinth:[0,200], lift:[0,0] },
  kitchen_corner:   { w:[1200,3600], h:[720,720],   d:[1200,3600], plinth:[0,200], lift:[0,0] },
  bed:              { w:[800,1800],  h:[500,1300],  d:[1800,2200], plinth:[0,0],  lift:[0,0] },
  table:            { w:[600,2400],  h:[600,900],   d:[500,1200],  plinth:[0,0],  lift:[0,0] },
};
export function rangeFor(type, key) {
  return (TYPE_RANGES[type] && TYPE_RANGES[type][key]) || RANGE[key];
}
```

```python
# schema.py
TYPE_RANGES = {
  "sliding_wardrobe": {"w":(600,2400), "h":(1800,2600), "d":(450,800), "plinth":(0,200), "lift":(0,0)},
  "kitchen_corner":   {"w":(1200,3600), "h":(720,720),   "d":(1200,3600), "plinth":(0,200), "lift":(0,0)},
  "bed":              {"w":(800,1800),  "h":(500,1300),  "d":(1800,2200), "plinth":(0,0),  "lift":(0,0)},
  "table":            {"w":(600,2400),  "h":(600,900),   "d":(500,1200), "plinth":(0,0),  "lift":(0,0)},
}
```

Как применять в валидации: если `item.type in TYPE_RANGES` — проверять
каждый ключ из `w/h/d/plinth/lift` по `TYPE_RANGES[type]`, а не по `RANGES`.
Старые типы сверяются по старому `RANGES`. Не дублировать `if`-ветки для
каждого типа по отдельности — один helper `range_for(type, key)`.

**Не добавлять `h=(720,720)` как «точку», а проверять `h == 720`:**
в схеме кухонного угла высоту переиспользуют от `kitchen_base` (720),
поэтому допустимые `h` = `{720}`. Для UI это отдельный нюанс — в панели
скрывать `h` для corner, пока цех не даст другой пресет.

### 2.4. Фасады (`front`)

- `FRONTS` дополнить одним значением: `['sliding','Раздвижные двери']`.
  Только `sliding_wardrobe` принимает `front='sliding'`.
  Остальные типы — только старые 4 значения.
- `corpus.js` не подсказывает, что делать с `'sliding'` — если генератор
  модуля не разработал, `corpus.js` молча сделает открытый шкаф.
  Поэтому в `corpus.js` предсказуемо игнорировать `'sliding'` — значит
  принимать это значение только в валидации для `sliding_wardrobe`,
  а для остальных типов его отвергать.
- `editor.js`: поле «Фасад» для `sliding_wardrobe` показывает список
  `FRONTS` как есть; для `bed`/`table` скрыть (см. §5).
- `FRONTS` в `schema.py` — аналогично: `FRONTS = {"open","door1","doors2","drawers","sliding"}`.
  Для типов, кроме `sliding_wardrobe`, `'sliding'` — ошибка валидации
  с одной строкой по-русски, а не проброс.

### 2.5. Материалы и kinds — только из утверждённого списка

`scene.js`/`export-client.js` имеют фиксированный набор материалов:

```js
materials['corpus_'+id], materials['facade_'+id],
materials.hdf, materials.top, materials.handle,
materials.skirting, materials.frame, materials.glass
```

**Правило для новых генераторов:** использовать ТОЛЬКО

| Назначение | `material` | `kind` |
|---|---|---|
| ДСП-детали каркаса/полки/боковины | `'corpus'` | `'dsp'` |
| Фасады/изголовье/столешница ДСП | `'facade'` | `'dsp'` |
| ХДФ-дно ящиков | `'hdf'` | `'hdf'` |
| Столешница / матрас (тёмная плита) | `'top'` | `'top'` (для матраса `cut: null`) |
| Ручки | `'handle'` | `'handle'`, `cut: null`, `edge: false` |
| Стекло зеркал купе, стекло витрины | `'glass'` | `'glass'`, `cut: null` |

Запрещено вводить новые строки `material` (`'mattress'`, `'metalLeg'`,
`'mirror'` и т.п.) — сломается и редактор, и экспорт (в `export-client.js`
нет таких материалов и будет `materials[part.material] === undefined`,
меш создастся с `undefined`-материалом).

Отображение:

- **Матрас кровати** — `top` (тёмный матовый), `kind: 'top'`, `cut: null`.
  В деталировку не идёт, площадь ДСП не раздувает.
- **Ножки стола** — `handle` (металл), `kind: 'metal'`, `cut: null`.
  Альтернатива — `corpus`, если ножки — ДСП-панели.
- **Двери купе** — `facade` + 1–2 `glass` зеркальных панели.
- **Угловой комплект** — `corpus`/`facade`/`top`, как кухня.

Если другому агенту срочно нужен новый материал — сначала главная пара
`scene.js: setMaterials` + `export-client.js: makeMaterials`, потом генератор.

### 2.6. Анимация (`anim`)

Старый формат обязателен для типов, умеющих `doors/drawers`:

```js
anim = {
  doors:   [{ id, pivot:[x,y,z], sign: -1|1, angle: 1.75 }],
  drawers: [{ id, pivot:[x,y,z], travel: mm }]
}
```

- `sliding_wardrobe`: раздвижные двери — новый тип движения.
  Рекомендация — локальное распространение формата:

```js
anim.sliding = [{ id, pivot:[x,y,z], axis: 'x', travel: mm }]
```

  Скорости: `pivot` = точка опоры панели, `travel` = сдвиг по X
  внутри купе (`dw * 0.85` до перекрытия). `angle`/`sign` нет.

  **Блокер для других агентов:** сцены `scene.js applyOpen` и
  `export-client.js applyOpen` сегодня умеют только `doors/drawers`.
  Если главный агент НЕ хочет трогать сцены, панели для `sliding`
  сделать статическими (без anim) — проект валидируется, рендер OK,
  но раздвижность — следующим шагом. Выбор — за главным агентом,
  решение зафиксировать одной строкой в HISTORY.md.

- `kitchen_corner`: `doors`/`drawers` как у обычной кухни,
  разнесённые по двум осям. pivot точек считать в общей системе координат.
- `bed`: только `drawers` (подкровать ящики, если `drawers>0`), без doors.
  Если ящиков нет — `anim = { doors: [], drawers: [] }`.
- `table`: `anim = { doors: [], drawers: [] }` всегда (нет открывающегося).

## 3. Diff-план по файлам

### 3.1. `app/static/js/generators/common.js`

Добавить: 4 пресета (§2.1), `FRONTS` + `'sliding'`, per-type диапазоны
(новый `TYPE_RANGES` + helper `rangeFor`), опционально
`COUNTS.slidingPanels = [2,3]` и `COUNTS.legs` НЕ как `[min,max]`, а список
значений (см. §2.2).

Убрать дублирование `clamp`:

```js
export function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
```

И в `corpus.js` удалить локальный `function clamp`, импортировать
`clampNum` из `common.js`, переписать единственное место вызова
`clamp(1000 - dyc, …)` на `clampNum(1000 - dyc, …)`.
Так exporter перестаёт depender на хрупкий `rename_clamp`
(см. §4). Детей в других файлах не создавать свой `clamp`.

Не менять существующие `RANGE`/`COUNTS` — старые проекты, ИИ и тесты
полагаются на их значение.

### 3.2. `app/static/js/generators/index.js`

Только реестр + импорты нового кода. Никакой логики.

```js
import { buildCorner }  from './corner.js';
import { buildSliding } from './sliding.js';
import { buildBed }     from './bed.js';
import { buildTable }   from './table.js';

export const GENERATORS = {
  wardrobe, chest, kitchen_base, kitchen_wall,
  sliding_wardrobe: buildSliding,
  kitchen_corner:   buildCorner,
  bed:              buildBed,
  table:            buildTable,
};
```

Имена файлов — на усмотрение агентов, но только один экспорт на файл
(`buildX`), остальное — внутренние helpers внутри функции.
`buildItemByType` и `make` не трогать.

### 3.3. Новые файлы генераторов (`generators/*.js`)

Правило для агентов:

- Один экспорт `export function buildX(params) { … return {parts,anim,dims} }`.
- Все хелперы — ВНУТРИ `buildX`, ни одного `const G` / `function clamp`
  на верхнем уровне (коллизия при бандле — см. §4).
- Координаты — по §1.3. Для ребра у материалов `glass/top` — `edge: false`
  аналогично ручкам.
- `dims.lift` всегда 0, кроме если генератор не kitchen_wall.
- Никакого импорта three.js и `#` в имени деталей не нужно.
- `withDefaults`: либо `withDefaults(params)` из `corpus.js` (для sliding,
 использующего корпусную логику), либо локальное слияние с `PRESETS[type]`
  для новых геометрий (corner/bed/table), где часть полей пресета
  не актуальна. Не плодить имена `withDefaults`.

### 3.4. `app/schema.py`

- `TYPES` — добавить 4 ключа. Порядок не важен, но в тексте ошибки
  `', '.join(sorted(TYPES))` — автоматически 8 типов.
- `FRONTS` — добавить `'sliding'`, проверка по `item.type` (см. §2.4).
- `TYPE_RANGES` (§2.3) + per-type валидация `w/h/d/plinth/lift`.
- `COUNTS` — расширить `COUNTS.slidingPanels = (2,3)`.
  `bed.drawers` использует старый `drawers (0,6)` — наоборот: currently
  `(1,6)`, для bed/array допустим 0. Поэтому минимальное (0) для bed/table
  делать per-type override, а не глобально менять 1→0.
- Опциональные поля §2.2: проверять, только если ключ есть;
  отсутствие — не ошибка. Тип, диапазоны — в `validate_item` междобавлением.
- Не вводить `version: 2`; схема остаётся `version == 1`.
- Русские сообщения, как остальные (пример: `«knob» неизвестное значение …`).

### 3.5. `app/static/js/editor.js`

Минимальный дифф, без пересборки панели:

1. **Меню добавления** строится из `PRESETS` (`renderParams`/`addItem`) —
   новые типы появятся сами, ничего не нужно, кроме пресетов.
2. **Условный UI** (`renderParams`): для каждого типа скрывать нерелевантные
   контролы (иначе Оператор выставит `plinth` кровати, а это мусор в JSON):

   | Контрол | sliding | corner | bed | table |
   |---|---|---|---|---|
   | `w/h/d` | ✓ | ??? | ✓ | ✓ |
   | `t` | ✓ | ✓ | ✓ (каркас) | ✓ (столешница) |
   | `plinth` | ✓ | ✓ | ✗ | ✗ |
   | `lift` | ✗ (=0) | ✗ (=0) | ✗ (=0) | ✗ (=0) |
   | `modules` | ✓ | ✓ | ✗ (=1) | ✗ (=1) |
   | `shelves` | ✓ | ✓ | ✗ (=0) | ✗ (=0) |
   | `front` | sliding-модуль | ✓ | ✗ | ✗ |
   | `drawers` | ✓ | ✓ | ✓ (0…6) | ✗ (=0) |
   | `top` | ✗ | ✓ | ✗ | ✓ |
   | `slidingPanels` | ✓ | ✗ | ✗ | ✗ |
   | `cornerArmW/cornerSide` | ✗ | ✓ | ✗ | ✗ |

   `???` для corner — `h` фиксирована (720), вывести как недоступное поле
   или скрыть. Не делать редактируемый `h` без всей логики «высоты».
3. **Диапазоны в `num()`**: использовать `rangeFor(type, key)` из
   `common.js` вместо `RANGE[key] || COUNTS[key]`. `editor.js` импортирует
   уже существующие `RANGE`/`COUNTS`; добавить импорт `rangeFor`.
4. **`addItem` смещение**: `offsetX = Σ w*modules` ломается для corner
   (ширина вместо В двух ветвей), bed (x=ширина мечты vs длина) и table.
   Минимальный фикс: брать `dims.w` из пресета + тех. пауза 100 мм
   вдоль X. Для corner это временно некорректно — Оператор перетащит
   после добавления. Ограничения по Z: `position.z = 0` — мешающий
   угол кровати/кухни у стенки, Operator дотянет.
5. **`fitRoomToFurniture`**: `kitchen_corner` как окружающей ветвь,
   так и `bed`/`table` — сейчас попадут в ветку `other` («кухня + остальное»).
   Минимальный дифф: для `kitchen_corner` выставлять габариты комнаты
   `width = max(w, …) + 600`, `depth = max(d, …) + 1200` и класть
   `position` в левый угол (`x = −width/2`, `z = −depth/2 + d/2`),
   как у `kitchen_base`. Не вводит новых выборок кроме явного условия
   `if (it.type === 'kitchen_corner')`.
6. **`renderCut`**: ничего не трогать — `summarizeCut` уже показывает всё,
   что генератор отдал в `parts`, независимо от типа.

Блоки никуда не выдавливать: `editor.js` не знает о `scenes` —
только о `buildItemByType` и `PRESETS`.

### 3.6. Файлы вне основного диффа (упомянуть главному агенту)

| Файл | Зачем |
|---|---|
| `app/static/js/scene.js` | новый `materials` только если новый материал; `applyOpen` для `anim.sliding` |
| `app/static/js/export-client.js` | зеркало тех же правок сцены |
| `app/exporter.py` | `GENERATOR_FILES` += новые файлы; `rename_clamp` убрать (§4) |
| `app/ai_rules.md` | дописать новые типы, глубины, диапазоны (§5) |
| `tests/test_generators.mjs` | заменить «неизвестный тип = bed» на произвольное неизвестное имя, добавить проверки новых типов |
| `tests/test_schema.py` | тесты валидации новых диапазонов/FRONTS/опциональных полей |
| `docs/HISTORY.md` | запись о merge и решении по `sliding` anim |

## 4. clamp и коллизии имён в бандле three.js

### 4.1. Как собирается бандл (факты)

`app/exporter.py`:

- `_bundle_three()` — читает `three.core.js` и `three.module.js`,
  режет `export {…}` и `import {…} from '…'`, каждый файл оборачивает
  в СВОЮ IIFE (`(function(){ … window.THREE = {…} })()`), module добавляет
  6 символов через `Object.assign(window.THREE, {…})`.
  Internal three-имена (`_m1$1`, `clamp` внутри three) изолированы —
  IIFE-обёртка прячет их от глобального скоупа.
- `_bundle_generators()` — `GENERATOR_FILES`:
  `common.js`, `room.js`, `corpus.js`, `index.js`, `cutlist.js`.
  `_strip_es` вырезает строки `import …`, срезает `export ` у начала строки,
  без обёрток: весь код попадает в один классический `<script>`.
  `rename_clamp=true` только для `corpus.js`:
  `function clamp(` → `function corpusClamp(` и два точных вызова
  `clamp(1000` / `clamp(-dh`.

### 4.2. Риски

1. **Любой новый генератор с `function clamp` или `const G` / `const T`**
   на верхнем уровне = коллизия. В бандле `corpus.js` (без переименование)
   и `corner.js` легально переопределят друг друга — вызовы предыдущего
   файла пойдут в новую функцию. Это не компилируется ошибкой.
2. **`rename_clamp` хрупкий**: заменяет только два литеральных вызова.
   Следующий `clamp(foo` в `corner.js`/`sliding.js` не заменится,
   и получится вызов three-`clamp` или глобального `clamp` из другого файла.
3. **Коллизии `utils`**: `room.js` экспортирует `normalizeRoom`,
   `buildRoomSpec` и т.д. Новые генераторы не должны дублировать имена
   `MM`, `COLORS`, `HANDLES`, `PRESETS`, `handleById`, `colorById`,
   `buildItem`, `withDefaults`, `summarizeCut`, `buildItemByType` —
   после strip'а это станут глобальные `const/function`, их повтор
   = `SyntaxError` или переопределение.
4. **Коллизии с three внутри одного скрипта**, если `_strip_es`
   оставит имя `clamp`/`THREE`/`PMREMGenerator` и т.п., но three
   уже обёрнут в IIFE, поэтому глобально не утекает. Опасны только
   имена, которые exporter кладёт рядом: `window.__PROJECT__` и
   `window.__SETTINGS__` — генераторы не должны их трогать.
5. **`export-client.js` уже食材明細 переопределил globals-собства**
   (`materials`, `doors`, `drawers`, `builtList` внутри IIFE) —
   генераторы идут в своём скрипте до него, поэтому им нельзя вводить
   топлевел `var materials` / `var doors` и т.п. — они объявятся
   в IIFE просмотрщика как разные сущности, но пользователи
   генератора в классическом скрипте их не используют.
6. **`buildItemByType` после добавления типов** не изменился — если
   в списке `GENERATOR_FILES` забыли новый файл, в экспорте
   "`Неизвестный тип мебели`" бросит ошибку при рендере,
   в `test_export.py` проверки не сработают (файл открывается,
   но предмет не рисуется).

### 4.3. План нейтрализации (для главного агента)

1. **Перенести `clamp` в `common.js`** как `clampNum(v, lo, hi)`,
   удалить локальный `clamp` из `corpus.js` (§3.1). Новые генераторы
   импортируют только его. В `_strip_es` оставить `rename_clamp`
   для обратной совместимости, но она перестанет быть нужна —
   позже удалить флаг `rename_clamp` и ветку переименование,
   оставив генерацию из `common.js` единственным источником.
2. **Правило именования**: в новых файлах верхнеуровневые сущности —
   только экспортируемый `buildX`. Все хелперы — внутри `buildX`
   или префиксированы (`cornerClamp` и т.п.). Не вызывать
   `_strip_es` с `export ` внутри строк, не использовать
   `/*export */` в любых именах новых файл.
3. **`exporter.py: GENERATOR_FILES`** расширить ровно сразу после
   добавления кодовой части генераторов:
   `corner.js, sliding.js, bed.js, table.js` — порядок важен!
   `common.js` первым (константы), потом новые генераторы, потом
   `index.js` (обединяет), `cutlist.js`. `corpus.js` и `room.js`
   — где были. Новый генератор не должен импортировать `index.js`
   (циклический импорт в ES-модуле возможен, но поиск убьёт strip).
4. **Тест механический** перед коммитом:
   - `node tests/test_generators.mjs` — обновить тест на неизвестный тип:
     `buildItemByType('unknown_xyz', {})` должен бросать,
     а не `bed/table/corner/sliding`;
   - `node --check` на каждый сгенерированный JS (как в `test_export.py`);
   - прогнать экспорт демо и проверить, что 8 типов рендерятся без
     `SyntaxError`, в консоли нет `clamp is not a function`;
   - `exporter.build_client_html` с проектом из 8 типов — файл собирается,
     размер < 15 МБ.

## 5. Алгоритм интеграции для главного агента (порядок)

1. **Принять 4 новых файла** (corner/sliding/bed/table) с одним экспортом
   и локальными хелперами.
2. **Внести правки §3.1–§3.3**: `common.js` (`PRESETS`, `FRONTS`,
   `TYPE_RANGES`, `clampNum`), `corpus.js` (убрать локальный `clamp`),
   `index.js` (реестр).
3. **Бандл-переименование**: `common.js: clampNum` + `exporter.py`
   (`GENERATOR_FILES` + снять `rename_clamp` как опасность).
4. **Валидация**: `schema.py` (см. §3.4), тесты (§3.6).
5. **Редактор**: `editor.js` §3.5 (условный UI, rangeFor, fitRoom).
6. **Сцены**: решить про sliding anim:
   - вариант A — статические панели, без `anim.sliding`, сцены не трогаем;
   - вариант B — добавить поддержку `anim.sliding` в `scene.js` и
     `export-client.js` (applyOpen: `pivot.position.x += travel * openT`).
   Решение — одна правка + строка в HISTORY.md.
7. **ИИ**: обновить `app/ai_rules.md`:
   типы (§), стандартные глубины (кухня 560, шкаф 550, купе 550,
   угол 560, кровать 2000 в длине, стол 750), диапазоны §2.3,
   новые поля (§2.2), запрет выдумывать.
8. **Тесты**: `tests/test_generators.mjs` — для каждого типа:
   dims, состав деталей, площадь ДСП (вручную по формулам),
   для corner — наличие деталей обеих ветвей, для sliding —
   число панелей и `travel`, для bed — матрас не входит в `dspArea`,
   для table — столешница `w×d×38`.
9. **Браузер**: открыть `#/project/demo`, добавить по одному из новых
   типов, проверить рендер, перетаскивание, поворот, метки, кладку
   в комнату и экспорт (запуск файлов с диска без сервера).

## 6. Чек-лист приёмки после слияния

- [ ] `pytest -q` — все старые + новые тесты зелёные; старые проекты
      из `data/demo` валидируются без изменений
- [ ] `node tests/test_generators.mjs` — все старые 23 проверки ok
      (формулы `corpus.js` не изменились) + новые проверки этапа 6
- [ ] `node tests/test_room.mjs` — без изменений
- [ ] `buildItemByType` для неизвестного типа бросает ошибку с понятным текстом
- [ ] В редакторе добавление каждого нового типа создаёт предмет
      с пресетами, панели скрывают лишние контролы, деталировка считается
- [ ] Сцена рисует все 8 типов; дверцы/ящики кликабельно открывает;
      в eksporте (файл с диска) те же типы видны, консоль без ошибок
- [ ] `exporter.build_client_html` на проекте со всеми типами — < 15 МБ,
      без `localhost`, чужих проектов и ключей
- [ ] Документировано: `docs/HISTORY.md` + `app/ai_rules.md`
