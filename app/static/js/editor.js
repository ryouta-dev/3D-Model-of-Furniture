// Редактор: состояние проекта, панели параметров, отмена/возврат, автосохранение.
import { buildItemByType } from './generators/index.js';
import { summarizeCut } from './generators/cutlist.js';
import { PRESETS, COLORS, FRONTS, RANGE, COUNTS, DIMS, HANDLES, rangeFor, colorById } from './generators/common.js';
import { defaultRoom, normalizeRoom, WALL_TEXTURES, FLOOR_TEXTURES, ROOM_RANGES } from './room.js';
import { downloadCutCsv } from './cutlist_csv.js';
import { toast } from './ui.js';

function defaultExport(project) {
  const colors = [];
  for (const it of project?.items || []) {
    for (const k of ['facade', 'corpus']) {
      if (it[k] && !colors.includes(it[k])) colors.push(it[k]);
    }
  }
  return {
    showCutlist: false,
    allowColorSwitch: true,
    allowedColors: colors.length ? colors : ['white', 'sonoma', 'walnut', 'graphite'],
    showRoom: true,
    showPrice: false,
    passwordHash: null,
    ...(project?.export || {})
  };
}

const $ = (s) => document.querySelector(s);

const state = {
  project: null,
  selected: null,   // id выбранного предмета
  dirty: false,
  undoStack: [],
  redoStack: [],
  saveTimer: null,
  customDecors: [],
  customHandles: []
};

export async function loadLibrary() {
  try {
    const [decors, handles] = await Promise.all([
      fetch('/api/library/decors').then((r) => r.json()),
      fetch('/api/library/handles').then((r) => r.json())
    ]);
    state.customDecors = Array.isArray(decors) ? decors.map((d) => ({ id: d.id, name: d.name, hex: d.hex, wood: false })) : [];
    state.customHandles = Array.isArray(handles) ? handles.map((h) => ({ id: h.id, name: h.name, length: h.length || 160 })) : [];
    // Добавляем свои декоры в общий список цветов для сцены.
    for (const d of state.customDecors) {
      if (!COLORS.some((c) => c.id === d.id)) COLORS.push(d);
    }
    const mod = await import('./scene.js');
    if (mod.refreshMaterials) mod.refreshMaterials();
    renderAll();
  } catch {
    toast('Не удалось загрузить библиотеку образцов');
  }
}

export function getProject() { return state.project; }
export function getSelected() { return state.selected; }

// --- Загрузка и сохранение ---
export async function load(pid) {
  const res = await fetch(`/api/projects/${pid}`);
  if (!res.ok) throw new Error('Проект не найден');
  state.project = await res.json();
  state.project.room = normalizeRoom(state.project.room);
  state.project.export = defaultExport(state.project);
  if (!state.project.price) state.project.price = { total: null, currency: 'KZT', lines: [] };
  ensurePriceLines(state.project.price);
  state.selected = state.project.items[0]?.id || null;
  state.undoStack = [];
  state.redoStack = [];
  setStatus('');
  renderAll();
}

function setStatus(text) {
  const el = $('#save-status');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function scheduleSave() {
  state.dirty = true;
  setStatus('Сохраняю…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 800);
}

async function save() {
  if (!state.project.items.length) {
    // Пустой проект сервер не примет (нужен хотя бы один предмет).
    // Название и правки подхватятся при первом сохранении с предметом.
    setStatus('Добавьте предмет, чтобы сохранить изменения');
    return;
  }
  try {
    const res = await fetch(`/api/projects/${state.project.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.project)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const list = Array.isArray(err.detail) ? err.detail : [err.detail || res.status];
      setStatus('Ошибка сохранения: ' + list.join('; '));
      return;
    }
    state.dirty = false;
    const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    setStatus('Сохранено ' + t);
  } catch {
    setStatus('Нет связи с сервером');
  }
}

// --- Отмена/возврат (ТЗ п. 9: минимум 20 шагов) ---
function snapshot() {
  state.undoStack.push(JSON.stringify({ items: state.project.items, room: state.project.room }));
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
}

function restore(json) {
  const snap = JSON.parse(json);
  // Поддерживаем старый формат (только items) на всякий случай.
  state.project.items = Array.isArray(snap) ? snap : snap.items;
  if (!Array.isArray(snap) && 'room' in snap) state.project.room = snap.room;
  if (!state.project.items.some((i) => i.id === state.selected)) {
    state.selected = state.project.items[0]?.id || null;
  }
  renderAll();
  scheduleSave();
}

export function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify({ items: state.project.items, room: state.project.room }));
  restore(state.undoStack.pop());
}

export function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify({ items: state.project.items, room: state.project.room }));
  restore(state.redoStack.pop());
}

// Видимые кнопки ↶/↷ в топбаре: disabled и подпись со счётчиком шагов.
export function syncUndoButtons() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (!u || !r) return;
  u.disabled = !state.undoStack.length;
  r.disabled = !state.redoStack.length;
  u.title = `Отменить (Ctrl+Z) — шагов назад: ${state.undoStack.length}`;
  r.title = `Вернуть (Ctrl+Y) — шагов вперёд: ${state.redoStack.length}`;
}

// --- Изменения ---
function nextId() {
  let n = 1;
  while (state.project.items.some((i) => i.id === 'i' + n)) n++;
  return 'i' + n;
}

export function addItem(type) {
  snapshot();
  const preset = PRESETS[type];
  // Кладём ряд впритык к предыдущим, чтобы предметы не накладывались.
  const offsetX = state.project.items.reduce(
    (sum, it) => sum + (it.w || 0) * (it.modules || 1), 0);
  const item = {
    id: nextId(), type,
    position: { x: offsetX, z: 0 }, rotationY: 0,
    w: preset.w, h: preset.h, d: preset.d, t: 16,
    plinth: preset.plinth, lift: preset.lift,
    modules: preset.modules, shelves: preset.shelves,
    front: preset.front, drawers: preset.drawers, top: preset.top,
    corpus: 'white', facade: 'sonoma', handle: 'bar160'
  };
  state.project.items.push(item);
  state.selected = item.id;
  renderAll();
  scheduleSave();
}

export function removeItem(id) {
  if (state.project.items.length <= 1) {
    // В проекте должен быть хотя бы один предмет (схема), пустой
    // сервер не примет — запрещаем и не расходимся с диском.
    setStatus('Нельзя удалить последний предмет — в проекте должен быть хотя бы один');
    return;
  }
  snapshot();
  state.project.items = state.project.items.filter((i) => i.id !== id);
  if (state.selected === id) state.selected = state.project.items[0]?.id || null;
  renderAll();
  scheduleSave();
}

function updateItem(id, key, value) {
  const item = state.project.items.find((i) => i.id === id);
  if (!item) return;
  if (item[key] === value) return;
  snapshot();
  item[key] = value;
  renderAll();
  scheduleSave();
}

export function select(id) {
  state.selected = id;
  renderAll();
}

export function setProjectName(name) {
  state.project.name = name;
  scheduleSave();
}

// Применение проекта от ИИ: снапшот для отката, id проекта не трогаем.
export function applyAiProject(candidate) {
  if (!candidate || !Array.isArray(candidate.items)) return;
  snapshot();
  const id = state.project.id;
  state.project = JSON.parse(JSON.stringify(candidate));
  state.project.id = id; // id = папка, ИИ не должен его менять
  state.project.version = 1;
  if (!state.project.price) state.project.price = { total: null, currency: 'KZT', lines: [] };
  ensurePriceLines(state.project.price);
  if (!('export' in state.project)) state.project.export = defaultExport(state.project);
  state.project.room = normalizeRoom(state.project.room);
  fitRoomToFurniture(false);
  state.selected = state.project.items[0]?.id || null;
  renderAll();
  scheduleSave();
}

// Комната под мебель: сначала мебель, потом комната.
// Кухня — в левый угол (вплотную к левой и задней стенам), верх ровно над низом.
// Комната расширяется под кухню с запасом. snapshot=false — из applyAiProject.
export function fitRoomToFurniture(snapshotFirst = true) {
  const room = state.project.room;
  if (!room || !room.enabled || !state.project.items.length) return;
  const boxes = [];
  for (const it of state.project.items) {
    try {
      const built = buildItemByType(it.type, it);
      boxes.push({ it, built });
    } catch {}
  }
  if (!boxes.length) return;

  if (snapshotFirst) snapshot();

  // кухонные ряды: низ и верх отдельно, сортируем по текущей X и ставим вплотную.
  const base = boxes.filter((b) => b.it.type === 'kitchen_base').sort((a, b) => a.it.position.x - b.it.position.x);
  const wall = boxes.filter((b) => b.it.type === 'kitchen_wall').sort((a, b) => a.it.position.x - b.it.position.x);
  const other = boxes.filter((b) => b.it.type !== 'kitchen_base' && b.it.type !== 'kitchen_wall');

  const totalBase = base.reduce((s, b) => s + b.built.dims.w, 0);
  const totalWall = wall.reduce((s, b) => s + b.built.dims.w, 0);
  const kitchenW = Math.max(totalBase, totalWall);
  const baseD = base.length ? Math.max(...base.map((b) => b.built.dims.d)) : 0;
  const wallD = wall.length ? Math.max(...wall.map((b) => b.built.dims.d)) : 0;

  // Комната под кухню: ширина +600, глубина = кухня +1200 (проход).
  if (kitchenW) {
    const needW = kitchenW + 600;
    const needD = Math.max(baseD, wallD) + 1200;
    if (room.width < needW) room.width = Math.ceil(needW / 100) * 100;
    if (room.depth < needD) room.depth = Math.ceil(needD / 100) * 100;
  }

  // Левый угол: X от левой стены, Z спинкой к задней стене.
  let x = -room.width / 2;
  for (const { it, built } of base) {
    it.position.x = Math.round(x);
    it.position.z = Math.round(-room.depth / 2 + built.dims.d / 2);
    x += built.dims.w;
  }
  // Верх ровно над низом: те же X с левого края.
  let wx = -room.width / 2;
  for (const { it, built } of wall) {
    it.position.x = Math.round(wx);
    it.position.z = Math.round(-room.depth / 2 + built.dims.d / 2);
    wx += built.dims.w;
  }
  // Остальная мебель — рядом с кухней или по центру, но внутри комнаты.
  let ox = kitchenW ? (-room.width / 2 + kitchenW + 200) : -room.width / 2;
  for (const { it, built } of other) {
    const effW = built.dims.w, effD = built.dims.d;
    if (ox + effW > room.width / 2) ox = -room.width / 2;
    it.position.x = Math.round(Math.min(Math.max(ox, -room.width / 2), room.width / 2 - effW));
    it.position.z = Math.round(-room.depth / 2 + effD / 2);
    ox += effW + 100;
  }

  renderAll();
  scheduleSave();
}

// --- Размещение предмета на полу ---
export function moveItem(id, x, z) {
  const item = state.project.items.find((i) => i.id === id);
  if (!item) return;
  snapshot();
  item.position = { x: Math.round(x), z: Math.round(z) };
  renderAll();
  scheduleSave();
}

export function rotateItem(id, delta) {
  const item = state.project.items.find((i) => i.id === id);
  if (!item) return;
  snapshot();
  let rot = (item.rotationY || 0) + delta;
  rot = Math.round((rot / (Math.PI / 2))) * (Math.PI / 2); // только 90°
  item.rotationY = rot;
  renderAll();
  scheduleSave();
}

export function snapToWall(id) {
  const item = state.project.items.find((i) => i.id === id);
  const room = state.project.room;
  if (!item) return;
  if (!room || !room.enabled) {
    setStatus('Включите комнату для привязки к стене');
    return;
  }
  let built;
  try {
    built = buildItemByType(item.type, item);
  } catch {
    return;
  }
  const rot = item.rotationY || 0;
  const effD = Math.abs(Math.cos(rot)) > 0.5 ? built.dims.d : built.dims.w;
  snapshot();
  // Ставим к задней стене: центр предмета на depth/2 от стены.
  item.position.z = -room.depth / 2 + effD / 2;
  // X центрируем, но не выводим за стены.
  item.position.x = Math.min(Math.max(-room.width / 2, item.position.x), room.width / 2 - built.dims.w);
  renderAll();
  scheduleSave();
}

// --- Комната ---
export function setRoomEnabled(on) {
  snapshot();
  if (on) state.project.room = defaultRoom();
  else if (state.project.room) state.project.room.enabled = false;
  renderAll();
  scheduleSave();
}

export function updateRoom(key, value) {
  if (!state.project.room) return;
  let v = value;
  if (ROOM_RANGES[key]) {
    const [lo, hi] = ROOM_RANGES[key];
    v = Math.min(hi, Math.max(lo, Number(value) || lo));
  }
  if (state.project.room[key] === v) return;
  snapshot();
  state.project.room[key] = v;
  renderAll();
  scheduleSave();
}

// --- Экспорт для клиента ---
export function updateExport(key, value) {
  if (state.project.export[key] === value) return;
  state.project.export[key] = value;
  scheduleSave();
  renderExport();
}

export function toggleExportColor(id) {
  const list = state.project.export.allowedColors;
  const i = list.indexOf(id);
  if (i >= 0) {
    if (list.length <= 1) return; // хотя бы один цвет
    list.splice(i, 1);
  } else list.push(id);
  scheduleSave();
  renderExport();
}

export function setPriceTotal(value) {
  const v = value === '' ? null : Number(value);
  if (!state.project.price) state.project.price = { total: null, currency: 'KZT', lines: [] };
  ensurePriceLines(state.project.price);
  state.project.price.total = Number.isFinite(v) ? v : null;
  scheduleSave();
}

// --- Строки цены (бэклог п. 14: материал/работа/доставка, ТЗ п. 11) ---
// Цена — ручная заглушка до прайса цеха: строки не калькулируются, только ввод.

export const PRICE_LINE_PRESETS = ['Материал', 'Работа', 'Доставка'];

export function defaultPriceLines() {
  return PRICE_LINE_PRESETS.map((name) => ({ name, amount: null }));
}

// Нормализация строк цены: пустые → пресеты, битые записи выравниваем.
export function ensurePriceLines(price) {
  if (!price || typeof price !== 'object') return;
  if (!Array.isArray(price.lines) || !price.lines.length) {
    price.lines = defaultPriceLines();
    return;
  }
  price.lines = price.lines.map((l) => ({
    name: l && typeof l.name === 'string' && l.name.trim() ? l.name : 'Строка',
    amount: l && Number.isFinite(Number(l.amount)) && l.amount !== '' && l.amount != null ? Number(l.amount) : null,
  }));
}

export function priceLinesSum(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + (Number.isFinite(Number(l?.amount)) && l.amount != null && l.amount !== '' ? Number(l.amount) : 0), 0);
}

export function setPriceLine(idx, field, value) {
  const price = state.project.price;
  if (!price || !price.lines[idx]) return;
  if (field === 'amount') {
    const v = value === '' || value == null ? null : Number(value);
    price.lines[idx].amount = Number.isFinite(v) ? v : null;
  } else if (field === 'name') {
    price.lines[idx].name = String(value);
  }
  scheduleSave();
  renderExport();
}

export function addPriceLine() {
  const price = state.project.price;
  if (!price) return;
  ensurePriceLines(price);
  price.lines.push({ name: 'Дополнительно', amount: null });
  scheduleSave();
  renderExport();
}

export function removePriceLine(idx) {
  const price = state.project.price;
  if (!price || price.lines.length <= 1) return;
  price.lines.splice(idx, 1);
  scheduleSave();
  renderExport();
}

export function applyPriceLinesToTotal() {
  const price = state.project.price;
  if (!price) return;
  ensurePriceLines(price);
  const sum = priceLinesSum(price.lines);
  price.total = price.lines.some((l) => l.amount != null && l.amount !== '') ? Math.round(sum) : null;
  scheduleSave();
  renderExport();
}

export function exportCutCsv() {
  if (!state.project) return null;
  const res = downloadCutCsv(state.project);
  setStatus(`CSV скачан: ${res.rows} строк (${res.file})`);
  return res;
}

// --- Отрисовка ---
export function renderAll() {
  renderItemPanel();
  renderParams();
  renderRoom();
  renderExport();
  renderCut();
  syncUndoButtons();
  document.dispatchEvent(new CustomEvent('scene:rebuild'));
}

function renderItemPanel() {
  const ul = $('#item-list');
  ul.innerHTML = '';
  for (const [idx, item] of state.project.items.entries()) {
    const li = document.createElement('li');
    if (item.id === state.selected) li.className = 'sel';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-pressed', item.id === state.selected ? 'true' : 'false');
    const no = document.createElement('span');
    no.className = 'no';
    no.textContent = String(idx + 1).padStart(2, '0');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = colorById(item.facade).hex;
    chip.title = colorById(item.facade).name;
    const label = document.createElement('span');
    label.textContent = `${PRESETS[item.type]?.label || item.type} ${item.w}×${item.h}×${item.d}`;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Удалить предмет';
    del.setAttribute('aria-label', `Удалить: ${label.textContent}`);
    del.onclick = (e) => { e.stopPropagation(); removeItem(item.id); };
    li.append(no, chip, label, del);
    li.onclick = () => select(item.id);
    li.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(item.id); }
    };
    ul.appendChild(li);
  }
}

function renderParams() {
  const box = $('#params');
  const item = state.project.items.find((i) => i.id === state.selected);
  box.innerHTML = '';
  if (!item) {
    box.innerHTML = '<p class="muted">Выберите предмет или добавьте новый.</p>';
    return;
  }
  const row = (label, input) => {
    const div = document.createElement('div');
    div.className = 'prow';
    const l = document.createElement('label');
    l.textContent = label;
    if (input && (input.tagName === 'INPUT' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA')) {
      if (!input.id) input.id = 'f-' + Math.random().toString(36).slice(2, 8);
      l.htmlFor = input.id;
    }
    div.append(l, input);
    return div;
  };
  const num = (key, label, step = 10) => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = step;
    inp.value = item[key];
    inp.onchange = () => {
      const [lo, hi] = RANGE[key] || COUNTS[key] || [0, 99999];
      const v = Math.min(hi, Math.max(lo, Number(inp.value) || 0));
      inp.value = v;
      updateItem(item.id, key, v);
    };
    return row(label, inp);
  };
  const sel = (key, label, options) => {
    const s = document.createElement('select');
    for (const [v, name] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = name;
      s.appendChild(o);
    }
    s.value = item[key];
    s.onchange = () => updateItem(item.id, key, s.value);
    return row(label, s);
  };
  const selNum = (key, label, options) => {
    const s = document.createElement('select');
    for (const [v, name] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = name;
      s.appendChild(o);
    }
    s.value = item[key];
    s.onchange = () => updateItem(item.id, key, Number(s.value));
    return row(label, s);
  };
  const check = (key, label) => {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!item[key];
    c.onchange = () => updateItem(item.id, key, c.checked);
    return row(label, c);
  };
  const swatches = (key, label) => {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', label);
    for (const col of [...COLORS, ...state.customDecors]) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'swatch' + (item[key] === col.id ? ' sel' : '');
      sw.title = col.name;
      sw.setAttribute('aria-label', `${col.name}${col.code ? ' · ' + col.code : ''}`);
      sw.setAttribute('aria-pressed', item[key] === col.id ? 'true' : 'false');
      const c = document.createElement('span');
      c.className = 'sw-color';
      c.style.background = col.hex;
      const n = document.createElement('span');
      n.className = 'sw-name';
      n.textContent = col.name;
      const d = document.createElement('span');
      d.className = 'sw-code';
      d.textContent = col.code || col.id;
      sw.append(c, n, d);
      sw.onclick = () => updateItem(item.id, key, col.id);
      wrap.appendChild(sw);
    }
    return row(label, wrap);
  };

  const rotRow = document.createElement('div');
  rotRow.className = 'prow';
  const rotLabel = document.createElement('label');
  rotLabel.textContent = 'Размещение';
  const rotBtns = document.createElement('div');
  rotBtns.className = 'btn-row';
  const bRot = document.createElement('button');
  bRot.textContent = '↻ 90°';
  bRot.title = 'Повернуть на 90°';
  bRot.onclick = () => rotateItem(item.id, Math.PI / 2);
  const bWall = document.createElement('button');
  bWall.textContent = 'К стене';
  bWall.title = 'Придвинуть к задней стене';
  bWall.onclick = () => snapToWall(item.id);
  const bX = document.createElement('input');
  bX.type = 'number'; bX.step = 50; bX.value = item.position.x; bX.title = 'X, мм';
  bX.onchange = () => moveItem(item.id, Number(bX.value) || 0, item.position.z);
  const bZ = document.createElement('input');
  bZ.type = 'number'; bZ.step = 50; bZ.value = item.position.z; bZ.title = 'Z, мм';
  bZ.onchange = () => moveItem(item.id, item.position.x, Number(bZ.value) || 0);
  rotBtns.append(bRot, bWall, bX, bZ);
  rotRow.append(rotLabel, rotBtns);

  // Группы параметров вместо плоской ленты; нерелевантные поля скрываем
  // по диапазону типа (rangeFor): у кровати/стола нет цоколя и подъёма.
  const group = (title, ...els) => {
    const g = document.createElement('div');
    g.className = 'group';
    const h = document.createElement('h3');
    h.className = 'subh';
    h.textContent = title;
    g.append(h, ...els);
    return g;
  };
  const noCabinet = item.type === 'bed' || item.type === 'table';
  const dims = DIMS.filter(([k]) => ['w', 'h', 'd'].includes(k) || (rangeFor(item.type, k) || [0, 0])[1] > 0);
  const fronts = noCabinet ? [['open', 'Открытый']] : (item.type === 'sliding_wardrobe' ? [['sliding', 'Раздвижные']] : FRONTS);
  const facadeGroup = [
    sel('front', 'Фасад', fronts),
  ];
  if (item.front !== 'open') facadeGroup.push(sel('handle', 'Ручка', [...HANDLES.map((h) => [h.id, h.name]), ...state.customHandles.map((h) => [h.id, h.name])]));
  if (!noCabinet) facadeGroup.push(num('drawers', 'Ящиков', 1));
  if (['kitchen_base', 'kitchen_corner', 'table'].includes(item.type)) facadeGroup.push(check('top', 'Столешница'));
  facadeGroup.push(swatches('corpus', 'Корпус'), swatches('facade', 'Фасады'));

  const sizeGroup = [
    sel('type', 'Тип', Object.entries(PRESETS).map(([v, p]) => [v, p.label])),
    ...dims.map(([k, name]) => num(k, name + ', мм')),
    selNum('t', 'Толщина ДСП', [[16, '16 мм'], [18, '18 мм']]),
  ];
  if (!noCabinet) sizeGroup.push(num('modules', 'Модулей', 1), num('shelves', 'Полок', 1));

  const placeHint = document.createElement('p');
  placeHint.className = 'hint';
  placeHint.textContent = 'X/Z — миллиметры от центра комнаты: X вправо, Z: минус — к задней стене.';

  box.append(
    group('Размеры', ...sizeGroup),
    group('Фасад и фурнитура', ...facadeGroup),
    group('Размещение', rotRow, placeHint)
  );
}

function renderRoom() {
  const box = $('#room-params');
  if (!box) return;
  box.innerHTML = '';
  const room = state.project.room;
  const row = (label, input) => {
    const div = document.createElement('div');
    div.className = 'prow';
    const l = document.createElement('label');
    l.textContent = label;
    if (input && (input.tagName === 'INPUT' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA')) {
      if (!input.id) input.id = 'f-' + Math.random().toString(36).slice(2, 8);
      l.htmlFor = input.id;
    }
    div.append(l, input);
    return div;
  };
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = !!(room && room.enabled);
  check.onchange = () => setRoomEnabled(check.checked);
  box.append(row('Комната', check));
  if (!room || !room.enabled) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Комната выключена — сцена в студийном режиме.';
    box.appendChild(p);
    return;
  }
  const num = (key, label) => {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = 100; inp.value = room[key];
    inp.onchange = () => updateRoom(key, Number(inp.value));
    return row(label, inp);
  };
  const sel = (key, label, options) => {
    const s = document.createElement('select');
    for (const [v, name] of options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = name;
      s.appendChild(o);
    }
    s.value = room[key];
    s.onchange = () => updateRoom(key, s.value);
    return row(label, s);
  };
  box.append(
    num('width', 'Ширина, мм'),
    num('depth', 'Глубина, мм'),
    num('height', 'Высота, мм'),
    sel('wallTexture', 'Стены', WALL_TEXTURES.map((t) => [t.id, t.name])),
    sel('floorTexture', 'Пол', FLOOR_TEXTURES.map((t) => [t.id, t.name]))
  );
  const fitBtn = document.createElement('button');
  fitBtn.textContent = 'Подогнать комнату под мебель';
  fitBtn.title = 'Сначала мебель, потом комната под неё';
  fitBtn.onclick = () => fitRoomToFurniture(true);
  box.appendChild(fitBtn);
}

function renderExport() {
  const box = $('#export-params');
  if (!box) return;
  box.innerHTML = '';
  const exp = state.project.export;
  const price = state.project.price || { total: null, currency: 'KZT', lines: [] };
  const row = (label, input) => {
    const div = document.createElement('div');
    div.className = 'prow';
    const l = document.createElement('label');
    l.textContent = label;
    if (input && (input.tagName === 'INPUT' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA')) {
      if (!input.id) input.id = 'f-' + Math.random().toString(36).slice(2, 8);
      l.htmlFor = input.id;
    }
    div.append(l, input);
    return div;
  };
  const check = (key, label) => {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!exp[key];
    c.onchange = () => updateExport(key, c.checked);
    return row(label, c);
  };
  box.append(
    check('showCutlist', 'Деталировка клиенту'),
    check('allowColorSwitch', 'Цвета клиенту'),
    check('showRoom', 'Комната клиенту'),
    check('showPrice', 'Цена клиенту')
  );

  // Разрешённые цвета фасадов — сводка выбранных.
  const colorsRow = row('Цвета фасадов', (() => {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Цвета фасадов');
    for (const col of COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'swatch' + (exp.allowedColors.includes(col.id) ? ' sel' : '');
      sw.title = col.name;
      sw.setAttribute('aria-label', `${col.name} · ${col.code}`);
      sw.setAttribute('aria-pressed', exp.allowedColors.includes(col.id) ? 'true' : 'false');
      const c = document.createElement('span');
      c.className = 'sw-color';
      c.style.background = col.hex;
      const n = document.createElement('span');
      n.className = 'sw-name';
      n.textContent = col.name;
      const d = document.createElement('span');
      d.className = 'sw-code';
      d.textContent = col.code;
      sw.append(c, n, d);
      sw.onclick = () => toggleExportColor(col.id);
      wrap.appendChild(sw);
    }
    return wrap;
  })());
  box.appendChild(colorsRow);

  // Цена (заглушка ТЗ п.11).
  ensurePriceLines(price);
  const priceInp = document.createElement('input');
  priceInp.type = 'number'; priceInp.step = 1000;
  priceInp.value = price.total ?? '';
  priceInp.placeholder = 'Итого, ' + (price.currency || 'KZT');
  priceInp.onchange = () => setPriceTotal(priceInp.value);
  box.appendChild(row('Цена, KZT', priceInp));

  // Строки цены: материал/работа/доставка + свободные (ТЗ п. 11, бэклог п. 14).
  const linesHead = document.createElement('p');
  linesHead.className = 'muted';
  linesHead.style.margin = '8px 0 4px';
  linesHead.textContent = 'Строки цены (ручной ввод, без расчёта до прайса):';
  box.appendChild(linesHead);
  const priceHint = document.createElement('p');
  priceHint.className = 'hint';
  priceHint.textContent = 'Клиент видит только «Цена, KZT» выше. Кнопка ниже подставляет в неё сумму строк.';
  box.appendChild(priceHint);
  price.lines.forEach((line, idx) => {
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = line.name;
    nameInp.placeholder = 'Название строки';
    nameInp.spellcheck = false;
    nameInp.onchange = () => setPriceLine(idx, 'name', nameInp.value);
    const amtInp = document.createElement('input');
    amtInp.type = 'number'; amtInp.step = 500; amtInp.min = 0;
    amtInp.value = line.amount ?? '';
    amtInp.placeholder = (price.currency || 'KZT');
    amtInp.onchange = () => setPriceLine(idx, 'amount', amtInp.value);
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = '✕';
    del.title = 'Удалить строку';
    del.style.padding = '4px 8px';
    del.disabled = price.lines.length <= 1;
    del.onclick = () => removePriceLine(idx);
    const wrap = document.createElement('div');
    wrap.className = 'btn-row';
    wrap.style.marginBottom = '4px';
    wrap.append(nameInp, amtInp, del);
    nameInp.style.flex = '1 1 auto';
    amtInp.style.flex = '0 0 90px';
    box.appendChild(wrap);
  });
  const sumRow = document.createElement('div');
  sumRow.className = 'btn-row';
  const sumLab = document.createElement('span');
  sumLab.className = 'muted';
  sumLab.style.fontSize = '12px';
  sumLab.textContent = `Сумма строк: ${priceLinesSum(price.lines)} ${price.currency || 'KZT'}`;
  const toTotal = document.createElement('button');
  toTotal.textContent = 'Итого из строк → в «Цена»';
  toTotal.title = 'Подставить сумму строк в итоговую цену';
  toTotal.onclick = () => applyPriceLinesToTotal();
  const addLine = document.createElement('button');
  addLine.textContent = '+ Строка';
  addLine.onclick = () => addPriceLine();
  sumRow.append(sumLab, toTotal, addLine);
  box.appendChild(sumRow);

  // Пароль.
  const passInp = document.createElement('input');
  passInp.type = 'password';
  passInp.placeholder = 'Без пароля';
  passInp.autocomplete = 'off';
  box.appendChild(row('Пароль', passInp));
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = 'Пароль — простая защита на странице. Это не полноценная безопасность: пароль виден в исходнике страницы.';
  box.appendChild(hint);

  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = 'Создать HTML для клиента';
  btn.id = 'btn-export';
  btn.onclick = () => window.dispatchEvent(new CustomEvent('export:build', { detail: { password: passInp.value } }));
  box.appendChild(btn);

  const help = document.createElement('div');
  help.id = 'export-help';
  help.className = 'hidden';
  help.innerHTML =
    '<h3>Как опубликовать</h3>' +
    '<ol><li>Файл HTML скачался на компьютер.</li>' +
    '<li>Открой <b>app.netlify.com/drop</b> или <b>pages.cloudflare.com</b> и перетащи файл.</li>' +
    '<li>Получишь ссылку — отправь её владельцу цеха, он покажет клиенту.</li></ol>' +
    '<p class="muted">Файл автономный: без запущенного приложения, без интернета кроме загрузки самой страницы.</p>';
  box.appendChild(help);
}

function renderCut() {
  const body = $('#cut-body');
  body.innerHTML = '';
  const rows = new Map();
  let dspByT = {};
  for (const item of state.project.items) {
    let built;
    try {
      built = buildItemByType(item.type, item);
    } catch {
      continue; // неизвестный тип — пропускаем, а не роняем редактор
    }
    const sum = summarizeCut(built.parts);
    const tKey = item.t || 16;
    (dspByT[tKey] = dspByT[tKey] || { area: 0, count: 0 });
    dspByT[tKey].area += sum.dspArea;
    dspByT[tKey].count += sum.dspCount;
    for (const r of sum.rows) {
      const key = `${r.name}|${r.a}|${r.b}`;
      if (rows.has(key)) rows.get(key).q += r.q;
      else rows.set(key, { ...r });
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.a * b.b * b.q - a.a * b.b * b.q);
  for (const r of sorted) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = r.name;
    const td2 = document.createElement('td'); td2.className = 'm'; td2.textContent = `${r.a}×${r.b}`;
    const td3 = document.createElement('td'); td3.className = 'm'; td3.textContent = r.q;
    tr.append(td1, td2, td3);
    body.appendChild(tr);
  }
  const parts = Object.entries(dspByT)
    .map(([t, s]) => `ДСП ${t} мм: ${s.count} дет., ${s.area.toFixed(2)} м²`)
    .join(' · ');
  $('#cut-sum').textContent = parts || 'Нет деталей';
  // Кнопка CSV: один раз создаём, дальше только она есть в DOM (бэклог п. 11).
  let csvBtn = document.querySelector('#btn-cut-csv');
  if (!csvBtn) {
    csvBtn = document.createElement('button');
    csvBtn.id = 'btn-cut-csv';
    csvBtn.textContent = 'Скачать деталировку CSV';
    csvBtn.style.marginTop = '8px';
    csvBtn.onclick = () => exportCutCsv();
    $('#cut-sum').after(csvBtn);
  }
}
