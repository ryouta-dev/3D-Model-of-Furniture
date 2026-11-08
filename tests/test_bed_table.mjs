// Тесты генераторов кровати и стола (node tests/test_bed_table.mjs).
// Этап 6: build(params) -> { parts, anim, dims } как у corpus.js; детали с cut
// попадают в деталировку через summarizeCut. Ожидаемые числа посчитаны по
// формулам bed.js/table.js вручную.
import { buildBed } from '../app/static/js/generators/bed.js';
import { buildTable } from '../app/static/js/generators/table.js';
import { summarizeCut } from '../app/static/js/generators/cutlist.js';

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

// --- Кровать по умолчанию ---
const bed = buildBed({});
eq(bed.dims, { w: 1600, h: 1000, d: 2000, lift: 0 }, 'кровать: габариты по умолчанию');
eq([bed.anim.doors.length, bed.anim.drawers.length], [0, 0], 'кровать: анимаций нет');
eq(bed.parts.length, 14, 'кровать: 1 изголовье + 2 царги + изножье + планка + 5 ламелей + 4 ножки');
eq(bed.parts.map(p => p.name), [
  'Изголовье', 'Царга', 'Царга', 'Изножье', 'Центральная планка',
  'Ламель основания', 'Ламель основания', 'Ламель основания', 'Ламель основания', 'Ламель основания',
  'Ножка опоры', 'Ножка опоры', 'Ножка опоры', 'Ножка опоры'
], 'кровать: состав деталей по порядку');
eq(bed.parts.every(p => p.cut && Number.isFinite(p.cut[0]) && Number.isFinite(p.cut[1])), true, 'кровать: у всех деталей есть cut');
eq(bed.parts.every(p => p.size.every(Number.isFinite) && p.pos.every(Number.isFinite)), true, 'кровать: размеры и позиции конечны');
eq(bed.parts[0].cut, [1600, 1000], 'кровать: изголовье W×H');
eq(bed.parts[1].cut, [1984, 200], 'кровать: царга (L−t)×200');
eq(bed.parts[3].cut, [1568, 200], 'кровать: изножье (W−2t)×200');
eq(bed.parts[5].size, [1568, 16, 150], 'кровать: ламель (W−2t)×t×150');
eq(bed.parts[10].cut, [200, 50], 'кровать: ножка 200×50');
eq(buildBed({}).parts.length, 14, 'кровать: алиас build совпадает с buildBed');

// Позиции: изголовье в -z, ножки не выходят за габарит, ламели на царгах
eq(Math.max(...bed.parts.map(p => p.pos[2] + p.size[2] / 2)), 1000, 'кровать: детали не выступают за изножье');
eq(Math.min(...bed.parts.map(p => p.pos[2] - p.size[2] / 2)), -1000, 'кровать: детали не выступают за изголовье');
eq(bed.parts[5].pos[1], 408, 'кровать: ламель лежит на царгах (200+200+8)');
eq(bed.parts[10].pos[1], 100, 'кровать: ножка от пола');

// Деталировка через summarizeCut
const bedCut = summarizeCut(bed.parts);
eq(bedCut.rows.map(r => [r.name, r.a, r.b, r.q]).sort(), [
  ['Изголовье', 1600, 1000, 1],
  ['Царга', 1984, 200, 2],
  ['Изножье', 1568, 200, 1],
  ['Центральная планка', 1984, 200, 1],
  ['Ламель основания', 1568, 150, 5],
  ['Ножка опоры', 200, 50, 4]
].sort(), 'кровать: деталировка summarizeCut');
eq(bedCut.dspCount, 14, 'кровать: все 14 деталей — ДСП');

// Нестандартные размеры и толщина 18
const bed2 = buildBed({ w: 1400, d: 1900, h: 1100, t: 18 });
eq(bed2.parts[0].cut, [1400, 1100], 'кровать 1400×1900: изголовье');
eq(bed2.parts[1].cut, [1882, 200], 'кровать t=18: царга (L−t)×200');
eq(bed2.dims, { w: 1400, h: 1100, d: 1900, lift: 0 }, 'кровать 1400×1900: dims');

// --- Стол по умолчанию ---
const tab = buildTable({});
eq(tab.dims, { w: 1200, h: 750, d: 700, lift: 0 }, 'стол: габариты по умолчанию');
eq(tab.parts.length, 9, 'стол: 1 столешница + 4 ножки + 4 фартука');
eq(tab.parts[0], { name: 'Столешница 38 мм', kind: 'top', cut: [1200, 700], size: [1200, 38, 700], pos: [600, 731, 0], material: 'top' }, 'стол: столешница 38 мм, верхний край на 750');
eq(tab.parts.filter(p => p.name === 'Ножка стола').length, 4, 'стол: 4 ножки');
eq(tab.parts[1].cut, [712, 50], 'стол: ножка (H−38)×50');
eq(tab.parts[1].pos, [125, 356, -225], 'стол: ножка с отступом 100 мм от краёв');
eq(tab.parts.filter(p => p.name === 'Царга стола').length, 4, 'стол: 4 фартука');
eq(tab.parts.every(p => p.cut && Number.isFinite(p.cut[0]) && Number.isFinite(p.cut[1])), true, 'стол: у всех деталей есть cut');
const tabCut = summarizeCut(tab.parts);
eq(tabCut.rows.map(r => r.name).sort(), ['Ножка стола', 'Столешница 38 мм', 'Царга стола', 'Царга стола'], 'стол: rows включают столешницу kind=top (как в corpus.js)');
eq(tabCut.dspCount, 8, 'стол: 4 ножки + 4 фартука в ДСП-раскрое');

// Панельные опоры
const tabP = buildTable({ supports: 'panel' });
eq(tabP.parts.length, 4, 'стол panel: столешница + 2 опоры + 1 царга');
eq(tabP.parts.filter(p => p.name === 'Опора панельная').length, 2, 'стол panel: 2 опоры');
eq(tabP.parts[1].size, [16, 712, 600], 'стол panel: опора t×(H−38)×(D−100)');

// Ноль/мусор вместо чисел — дефолты, без NaN
const bedBad = buildBed({ w: 0, d: NaN, h: -5, t: 'x' });
eq(bedBad.dims, { w: 1600, h: 1000, d: 2000, lift: 0 }, 'кровать: мусорные числа → дефолты');
eq(bedBad.parts.every(p => p.size.every(Number.isFinite)), true, 'кровать: мусорные числа не дают NaN');
const tabBad = buildTable({ w: 0, d: null, h: undefined });
eq(tabBad.dims, { w: 1200, h: 750, d: 700, lift: 0 }, 'стол: мусорные числа → дефолты');
eq(tabBad.parts.every(p => p.size.every(Number.isFinite)), true, 'стол: мусорные числа не дают NaN');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты кровати и стола прошли');
process.exit(failed ? 1 : 0);
