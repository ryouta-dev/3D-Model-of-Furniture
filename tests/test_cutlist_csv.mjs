// Тесты выгрузки деталировки в CSV (node tests/test_cutlist_csv.mjs).
// Бэклог п. 11: форматы, экранирование, BOM, сводка по проекту.
import { csvCell, fmtNum, toCsv, getCutRows, buildCutCsv } from '../app/static/js/cutlist_csv.js';

let failed = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failed++; console.error('FAIL:', msg, '\n  ожидалось:', JSON.stringify(expected), '\n  получено:', JSON.stringify(actual)); }
  else console.log('ok  :', msg);
}
function ok(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
  else console.log('ok  :', msg);
}

// --- fmtNum ---
eq(fmtNum(2120), '2120', 'fmtNum целое');
eq(fmtNum(495.5), '495.5', 'fmtNum дробное');
eq(fmtNum(null), '', 'fmtNum null');
eq(fmtNum(NaN), '', 'fmtNum NaN');

// --- csvCell ---
eq(csvCell('Боковина'), 'Боковина', 'csvCell обычная строка');
eq(csvCell('a;b'), '"a;b"', 'csvCell с разделителем — в кавычках');
eq(csvCell('сказал "привет"'), '"сказал ""привет"""', 'csvCell кавычки удваиваются');
eq(csvCell(null), '', 'csvCell null');

// --- toCsv: заголовок + строки + Итого ---
const rows = [
  { name: 'Боковина', kind: 'dsp', a: 2120, b: 546, q: 2 },
  { name: 'Фасад', kind: 'dsp', a: 2114, b: 495.5, q: 2 },
];
const csv = toCsv(rows, { '16': { area: 7.58, count: 4 } });
const lines = csv.replace(/\r\n$/, '').split('\r\n');
eq(lines[0], 'Деталь;Длина, мм;Ширина, мм;Кол-во;Тип;Площадь, м2', 'toCsv заголовок');
eq(lines.length, 5, 'toCsv: заголовок + 2 строки + пустая + Итого');
ok(lines[1].startsWith('Боковина;2120;546;2;dsp;'), 'toCsv первая строка: ' + lines[1]);
ok(lines[2].startsWith('Фасад;2114;495.5;2;dsp;'), 'toCsv вторая строка: ' + lines[2]);
ok(lines[4].startsWith('Итого;'), 'toCsv строка Итого: ' + lines[4]);
ok(lines[4].includes('ДСП 16 мм: 4 дет., 7.58 м2'), 'toCsv сводка ДСП по толщине');
ok(csv.endsWith('\r\n'), 'toCsv окончание CRLF для Excel');

// --- toCsv без сводки ---
const csv2 = toCsv(rows, null);
ok(!csv2.includes('Итого'), 'toCsv без summary — нет блока Итого');

// --- getCutRows / buildCutCsv на демо-проекте ---
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const demoPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'demo', 'project.json');
const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
const got = getCutRows(demo);
ok(got.rows.length > 0, `getCutRows демо: ${got.rows.length} строк деталей`);
ok(got.dspByT && got.dspByT['16'] && got.dspByT['16'].count > 0, 'getCutRows демо: сводка ДСП 16 есть');

const text = buildCutCsv(demo);
ok(text.charCodeAt(0) === 0xFEFF, 'buildCutCsv: BOM для Excel (кириллица)');
ok(text.includes('Боковина;'), 'buildCutCsv: детали на месте');
ok(text.split('\r\n').length >= got.rows.length + 1, 'buildCutCsv: число строк = заголовок + детали');

// --- Пустой проект не падает ---
const empty = getCutRows({ id: 'x', items: [] });
eq(empty.rows, [], 'getCutRows пустой проект: нет строк');
eq(empty.dspByT, null, 'getCutRows пустой проект: нет сводки');

// --- Неизвестный тип пропускается, а не роняет выгрузку ---
const mixed = getCutRows({ id: 'x', items: [
  { id: 'i1', type: 'bed', position: { x: 0, z: 0 }, w: 600, h: 720, d: 560, t: 16, plinth: 0, lift: 0, modules: 1, shelves: 0, front: 'open', drawers: 1, top: false, corpus: 'white', facade: 'white', handle: 'bar160' },
  demo.items[0],
] });
ok(mixed.rows.length > 0, 'getCutRows смешанный проект: битый тип пропущен');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты cutlist_csv прошли');
process.exit(failed ? 1 : 0);
