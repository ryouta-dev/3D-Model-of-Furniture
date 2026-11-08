// Тесты строк цены (node tests/test_price_lines.mjs).
// Бэклог п. 14: price.lines — пресеты Материал/Работа/Доставка, ручной ввод.
import { defaultPriceLines, ensurePriceLines, priceLinesSum, PRICE_LINE_PRESETS } from '../app/static/js/editor.js';

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

// Пресеты
eq(PRICE_LINE_PRESETS, ['Материал', 'Работа', 'Доставка'], 'пресеты строк цены');
eq(defaultPriceLines(), [
  { name: 'Материал', amount: null },
  { name: 'Работа', amount: null },
  { name: 'Доставка', amount: null },
], 'defaultPriceLines — 3 строки с null');

// Пустые → пресеты
const p1 = { total: null, currency: 'KZT', lines: [] };
ensurePriceLines(p1);
eq(p1.lines.map((l) => l.name), ['Материал', 'Работа', 'Доставка'], 'ensurePriceLines [] → пресеты');

// Свои строки сохраняются
const p2 = { total: 50000, currency: 'KZT', lines: [{ name: 'Материал', amount: 30000 }, { name: 'Работа', amount: 20000 }] };
ensurePriceLines(p2);
eq(p2.lines, [{ name: 'Материал', amount: 30000 }, { name: 'Работа', amount: 20000 }], 'ensurePriceLines свои строки не трогает');

// Битые записи выравниваются
const p3 = { lines: [{ name: 'x', amount: 'abc' }, { amount: 100 }, null] };
ensurePriceLines(p3);
eq(p3.lines[0], { name: 'x', amount: null }, 'ensurePriceLines битая сумма → null');
eq(p3.lines[1].name, 'Строка', 'ensurePriceLines без названия → Заглушка');
eq(p3.lines[2], { name: 'Строка', amount: null }, 'ensurePriceLines null → строка-заглушка');

// Сумма
eq(priceLinesSum([{ amount: 30000 }, { amount: 20000 }, { amount: null }, { amount: '' }]), 50000, 'priceLinesSum с null и пустыми');
eq(priceLinesSum([]), 0, 'priceLinesSum пусто');
eq(priceLinesSum(null), 0, 'priceLinesSum null');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты строк цены прошли');
process.exit(failed ? 1 : 0);
