// Тесты генератора шкафа-купе (Этап 6).
// Запуск: node tests/test_sliding.mjs
// Корпус сверяется с corpus.js (wardrobe без дверей), фасады — с формулами
// sliding.js: нахлёст 30 мм, зазор 3 мм, ход = dw − 30.
import { buildSliding, SLIDING_DEFAULTS } from '../app/static/js/generators/sliding.js';
import { buildItem } from '../app/static/js/generators/corpus.js';
import { buildItemByType } from '../app/static/js/generators/index.js';
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

// --- Габариты и число фасадов (по умолчанию 2) ---
const s2 = buildSliding({});
eq(s2.dims, { w: 1500, h: 2200, d: 550, lift: 0 }, 'купе: габариты по умолчанию');
eq(s2.anim.sliding.length, 2, 'купе: по умолчанию 2 раздвижных фасада');
eq(s2.anim.doors.length, 0, 'купе: распашных дверей нет');
eq(s2.anim.drawers.length, 0, 'купе: ящиков нет');
eq(s2.parts.filter((x) => x.name === 'Фасад-купе').length, 2, 'купе: 2 фасада в деталях');

const s3 = buildSliding({ slidingDoors: 3 });
eq(s3.anim.sliding.length, 3, 'купе: 3 фасада при slidingDoors=3');
eq(s3.parts.filter((x) => x.name === 'Фасад-купе').length, 3, 'купе: 3 фасада в деталях');
eq(buildSliding({ slidingDoors: 7 }).anim.sliding.length, 3, 'купе: обрезка до 3 дверей');
eq(buildSliding({ slidingDoors: 1 }).anim.sliding.length, 2, 'купе: обрезка до 2 дверей');
eq(buildSliding({ doors: 3 }).anim.sliding.length, 3, 'купе: алиас doors тоже работает');

// --- Корпус совпадает с wardrobe без дверей (формулы corpus.js) ---
const open = buildItem({
  ...SLIDING_DEFAULTS, type: 'wardrobe', front: 'open', modules: 1, lift: 0,
});
const corpusNames = (out) => summarizeCut(out.parts).rows
  .filter((r) => r.name !== 'Фасад-купе' && r.name !== 'Направляющая верхняя' && r.name !== 'Направляющая нижняя')
  .map((r) => [r.name, r.a, r.b, r.q]).sort();
eq(corpusNames(s2), corpusNames(open), 'купе: корпус = wardrobe без дверей (деталировка)');
// И действительно без фасадов/петель:
eq(s2.parts.some((x) => x.name === 'Фасад' || x.name === 'Фасад ящика'), false, 'купе: нет распашных фасадов');
eq(s2.parts.some((x) => x.name === 'Боковина'), true, 'купе: боковины корпуса есть');

// --- Размеры фасадов: dw = (Wopen + 30) / N, зазор 3 мм ---
// W=1500, G=3 → Wopen=1494, N=2 → dw=(1494+30)/2=762; bodyH=2200−80=2120 → dh=2114
const f = s2.parts.filter((x) => x.name === 'Фасад-купе');
eq(f[0].size, [762, 2114, 16], 'купе: размер фасада 762×2114×16 при W=1500, N=2');
eq(f[0].cut, [2114, 762], 'купе: раскрой фасада [2114, 762]');
eq(f.map((x) => x.group), ['sliding0', 'sliding1'], 'купе: группы фасадов sliding0/1');
eq(f.every((x) => x.material === 'facade' && x.kind === 'dsp'), true, 'купе: фасады — ДСП, материал facade');
// Ход двери = dw − нахлёст = 732
close(s2.anim.sliding[0].travel, 732, 1e-9, 'купе: ход двери 732 мм (762−30)');
eq(s2.anim.sliding.map((x) => x.axis), ['x', 'x'], 'купе: движение только по X');
// Центры закрытого положения: G+dw/2 и +dw−30
close(s2.anim.sliding[0].pivot[0], 3 + 381, 1e-9, 'купе: центр первой двери');
close(s2.anim.sliding[1].pivot[0], 3 + 381 + 732, 1e-9, 'купе: центр второй двери');
eq(s2.anim.sliding[0].pivot[1], 80 + 1060, 'купе: центр двери по высоте = P+bodyH/2');
eq(s2.anim.sliding.some((x) => 'angle' in x || 'sign' in x), false, 'купе: без петель (нет angle/sign)');

// --- Три двери: dw = (1494 + 60)/3 = 518 ---
const f3 = buildSliding({ slidingDoors: 3 }).parts.filter((x) => x.name === 'Фасад-купе');
eq(f3[0].size[0], 518, 'купе: ширина фасада 518 при N=3');
close(buildSliding({ slidingDoors: 3 }).anim.sliding[0].travel, 488, 1e-9, 'купе: ход при N=3 = 488');
// Сумма ширин минус нахлёст покрывает проём ровно:
close(2 * 762 - 30, 1494, 1e-9, 'купе: 2 фасада с нахлёстом закрывают проём');
close(3 * 518 - 60, 1494, 1e-9, 'купе: 3 фасада с нахлёстом закрывают проём');

// --- Направляющие сверху/снизу на всю ширину ---
const top = s2.parts.find((x) => x.name === 'Направляющая верхняя');
const bot = s2.parts.find((x) => x.name === 'Направляющая нижняя');
eq([top.size, bot.size], [[1500, 40, 45], [1500, 15, 45]], 'купе: размеры направляющих');
eq([top.cut, bot.cut], [[1500, 40], [1500, 15]], 'купе: раскрой направляющих');
eq([top.material, bot.material], ['handle', 'handle'], 'купе: направляющие — металл (handle)');
eq([top.kind, bot.kind], ['profile', 'profile'], 'купе: направляющие — профиль, не ДСП');
close(top.pos[1], 2200 - 20, 1e-9, 'купе: верхняя направляющая у крышки');
close(bot.pos[1], 80 + 7.5, 1e-9, 'купе: нижняя направляющая на дне (над цоколем)');

// --- Деталировка: фасады-купе и профили видны, площадь ДСП включает фасады ---
const cut = summarizeCut(s2.parts);
const byName = (n) => cut.rows.find((r) => r.name === n);
eq([byName('Фасад-купе')?.a, byName('Фасад-купе')?.b, byName('Фасад-купе')?.q], [2114, 762, 2], 'купе: фасады в деталировке');
eq([byName('Направляющая верхняя')?.q, byName('Направляющая нижняя')?.q], [1, 1], 'купе: направляющие в деталировке');
// Площадь ДСП = корпус открытой версии + 2 фасада (2114×762 мм):
close(cut.dspArea, 10.348504, 1e-9, 'купе: площадь ДСП с фасадами, м²');
eq(cut.dspCount, 11, 'купе: 11 деталей ДСП (2+1+1+1+4+2)');
eq(cut.sheets, 3, 'купе: 3 листа 2750×1830 с запасом 15%');
// Профиль не входит в площадь ДСП: без фасадов площадь была бы
// 10.348504 − 2·2.114·0.762 = 10.348504 − 3.221736 = 7.126768 м²
eq(cut.rows.filter((r) => r.kind === 'profile').length, 2, 'купе: 2 профиля в деталировке');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты купе прошли');
process.exit(failed ? 1 : 0);
