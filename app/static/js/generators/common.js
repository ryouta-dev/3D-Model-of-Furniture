// Общие константы конструктора. Значения перенесены из эталонного прототипа
// mebel3d.html и ТЗ п. 5; правила цеха потом выносятся в конфиг (ТЗ п. 7.5).

export const MM = 0.001; // модель строится в метрах, размеры в мм

// Лист ДСП и запас на раскрой 15% (ТЗ п. 5, п. 14.5)
export const SHEET = { w: 2750, h: 1830, reserve: 0.15 };

export const COLORS = [
  { id: 'white', name: 'Белый', hex: '#F0EFEA', code: 'ДСП-01' },
  { id: 'sonoma', name: 'Дуб сонома', hex: '#CFAE82', dark: '#9C7B52', wood: true, code: 'ДСП-08' },
  { id: 'walnut', name: 'Орех', hex: '#7B5233', dark: '#4F321E', wood: true, code: 'ДСП-03' },
  { id: 'wenge', name: 'Венге', hex: '#3D2C26', dark: '#241813', wood: true, code: 'ДСП-05' },
  { id: 'graphite', name: 'Графит', hex: '#464B4F', code: 'ДСП-21' },
  { id: 'grey', name: 'Серый', hex: '#A7ACAE', code: 'ДСП-14' },
  { id: 'green', name: 'Тёмно-зелёный', hex: '#2F4B40', code: 'ДСП-18' }
];

export const FRONTS = [['open', 'Открытый'], ['door1', '1 дверь'], ['doors2', '2 двери'], ['drawers', 'Ящики'], ['sliding', 'Раздвижные']];

// Каталог ручек (этап 5): минимум 5 стандартных. Свои ручки из библиотеки
// добавляются как {id, name} и используют геометрию bar по умолчанию.
export const HANDLES = [
  { id: 'bar160', name: 'Планка 160', length: 160 },
  { id: 'bar96', name: 'Планка 96', length: 96 },
  { id: 'bar320', name: 'Планка 320', length: 320 },
  { id: 'knob', name: 'Кнопка', length: 32 },
  { id: 'edge', name: 'Торцевая', length: 40 }
];

export function handleById(id) {
  return HANDLES.find((h) => h.id === id) || HANDLES[0];
}

export const RANGE = { w: [300, 2400], h: [200, 2600], d: [150, 800], plinth: [0, 200], lift: [0, 2000] };
export const TYPE_RANGES = {
  sliding_wardrobe: { w: [600, 2400], h: [1800, 2600], d: [450, 800], plinth: [0, 200], lift: [0, 0] },
  kitchen_corner: { w: [1200, 3600], h: [720, 720], d: [1200, 3600], plinth: [0, 200], lift: [0, 0] },
  bed: { w: [800, 1800], h: [500, 1300], d: [1800, 2200], plinth: [0, 0], lift: [0, 0] },
  table: { w: [600, 2400], h: [600, 900], d: [500, 1200], plinth: [0, 0], lift: [0, 0] }
};
export function rangeFor(type, key) {
  return (TYPE_RANGES[type] && TYPE_RANGES[type][key]) || RANGE[key];
}
export const COUNTS = { modules: [1, 6], shelves: [0, 8], drawers: [1, 6] };
export const DIMS = [['w', 'Ширина'], ['h', 'Высота'], ['d', 'Глубина'], ['plinth', 'Цоколь'], ['lift', 'Высота от пола']];

export const PRESETS = {
  wardrobe: { label: 'Шкаф', w: 1000, h: 2200, d: 550, shelves: 4, front: 'doors2', drawers: 3, plinth: 80, top: false, modules: 1, lift: 0 },
  chest: { label: 'Тумба', w: 800, h: 700, d: 420, shelves: 1, front: 'drawers', drawers: 3, plinth: 60, top: false, modules: 1, lift: 0 },
  kitchen_base: { label: 'Кухня, низ', w: 600, h: 720, d: 560, shelves: 1, front: 'door1', drawers: 3, plinth: 100, top: true, modules: 3, lift: 0 },
  kitchen_wall: { label: 'Кухня, верх', w: 600, h: 720, d: 320, shelves: 1, front: 'door1', drawers: 3, plinth: 0, top: false, modules: 3, lift: 1400 },
  sliding_wardrobe: { label: 'Шкаф-купе', w: 1500, h: 2200, d: 550, shelves: 4, front: 'sliding', drawers: 3, plinth: 80, top: false, modules: 1, lift: 0 },
  kitchen_corner: { label: 'Кухня, угол', w: 2400, h: 720, d: 1800, shelves: 1, front: 'door1', drawers: 3, plinth: 100, top: true, modules: 3, lift: 0 },
  bed: { label: 'Кровать', w: 1400, h: 1000, d: 2000, shelves: 0, front: 'open', drawers: 1, plinth: 0, top: false, modules: 1, lift: 0 },
  table: { label: 'Стол', w: 1200, h: 750, d: 800, shelves: 0, front: 'open', drawers: 0, plinth: 0, top: true, modules: 1, lift: 0 }
};

export function colorById(id) {
  return COLORS.find((c) => c.id === id) || COLORS[0];
}
