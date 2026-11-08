// Тесты генераторов (node tests/test_generators.mjs).
// Приёмка этапа 1: деталировка должна совпадать с прототипом mebel3d.html
// для тех же параметров. Ожидаемые значения посчитаны по формулам прототипа
// вручную для его же пресетов.
import { buildItemByType } from '../app/static/js/generators/index.js';
import { summarizeCut } from '../app/static/js/generators/cutlist.js';
import { PRESETS } from '../app/static/js/generators/common.js';

let failed = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failed++; console.error('FAIL:', msg, '\n  ожидалось:', JSON.stringify(expected), '\n  получено:', JSON.stringify(actual)); }
  else console.log('ok  :', msg);
}
function close(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) { failed++; console.error('FAIL:', msg, `ожидалось ~${expected}, получено ${actual}`); }
  else console.log('ok  :', msg);
}

// --- Шкаф (пресет прототипа): 2 двери, 4 полки, цоколь 80 ---
const w = buildItemByType('wardrobe', {});
eq(w.dims, { w: 1000, h: 2200, d: 550, lift: 0 }, 'шкаф: габариты');
eq(w.anim.doors.length, 2, 'шкаф: 2 двери');
eq(w.anim.drawers.length, 0, 'шкаф: без ящиков');
const wCut = summarizeCut(w.parts);
eq(wCut.rows.map(r => [r.name, r.a, r.b, r.q]).sort(), [
  ['Боковина', 2120, 546, 2],
  ['Крышка', 968, 546, 1],
  ['Дно', 968, 546, 1],
  ['Задняя стенка ХДФ 4 мм', 2116, 996, 1],
  ['Цоколь', 1000, 80, 1],
  ['Полка', 968, 526, 4],
  ['Фасад', 2114, 495.5, 2]
].sort(), 'шкаф: состав деталей (формулы прототипа)');
close(wCut.dspArea, 7.583742, 1e-6, 'шкаф: площадь ДСП, м²');
eq(wCut.sheets, 2, 'шкаф: листов 2750×1830 с запасом 15%');

// --- Тумба: 3 ящика, полки отключаются при ящиках ---
const c = buildItemByType('chest', {});
eq(c.anim.drawers.length, 3, 'тумба: 3 ящика');
const cCut = summarizeCut(c.parts);
eq(cCut.rows.map(r => [r.name, r.q]).sort(), [
  ['Боковина', 2], ['Крышка', 1], ['Дно', 1],
  ['Задняя стенка ХДФ 4 мм', 1], ['Цоколь', 1],
  ['Фасад ящика', 3], ['Боковина ящика', 6],
  ['Задняя стенка ящика', 3], ['Дно ящика ХДФ 4 мм', 3]
].sort(), 'тумба: состав деталей');
close(cCut.dspArea, 2.3975824, 1e-4, 'тумба: площадь ДСП, м²');
eq(cCut.sheets, 1, 'тумба: 1 лист');

// --- Кухня низ: 3 модуля, 1 дверь в каждом, столешница ---
const kb = buildItemByType('kitchen_base', {});
eq(kb.dims.w, 1800, 'кухня низ: ширина ряда 3×600');
eq(kb.anim.doors.length, 3, 'кухня низ: 3 двери');
const kbTop = kb.parts.find(p => p.name === 'Столешница 38 мм');
eq(kbTop && [kbTop.cut, kbTop.size], [[1800, 590], [1800, 38, 590]], 'кухня низ: столешница 38 мм, свес 30 мм');
const kbCut = summarizeCut(kb.parts);
close(kbCut.dspArea, 6.15066, 1e-6, 'кухня низ: площадь ДСП, м²');
eq(kbCut.sheets, 2, 'кухня низ: 2 листа');

// --- Кухня верх: без цоколя, lift 1400, ручка снизу ---
const kw = buildItemByType('kitchen_wall', {});
eq(kw.dims.lift, 1400, 'кухня верх: высота от пола 1400');
eq(kw.parts.some(p => p.name === 'Цоколь'), false, 'кухня верх: без цоколя');
eq(kw.parts.some(p => p.name === 'Столешница 38 мм'), false, 'кухня верх: без столешницы');
const kwCut = summarizeCut(kw.parts);
close(kwCut.dspArea, 4.21878, 1e-6, 'кухня верх: площадь ДСП, м²');

// --- Ящики: зазор 13 мм по бокам, выезд 70% ---
const d = buildItemByType('chest', {}).anim.drawers[0];
// bw = 800 − 2·16 − 26 = 742, bd = 546−60? нет: D4=416, bd=356, travel = 356·0.7 = 249.2
eq(d.travel, 249.2, 'ящик: выезд 70% глубины короба');
const dSide = buildItemByType('chest', {}).parts.find(p => p.name === 'Боковина ящика');
eq(dSide.size, [16, 159.33333333333334, 356], 'ящик: короб с зазором 13 мм по бокам');

// --- Неизвестный тип ---
let threw = false;
try { buildItemByType('unknown_xyz', {}); } catch (e) { threw = true; }
eq(threw, true, 'неизвестный тип мебели даёт ошибку');

// --- Все 8 пресетов существуют ---
eq(Object.keys(PRESETS).sort(), ['bed', 'chest', 'kitchen_base', 'kitchen_corner', 'kitchen_wall', 'sliding_wardrobe', 'table', 'wardrobe'], 'пресеты 8 типов');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты генераторов прошли');
process.exit(failed ? 1 : 0);
