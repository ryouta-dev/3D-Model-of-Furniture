// Тесты угловой кухни (node tests/test_corner.mjs).
// buildCorner из generators/corner.js: два ряда kitchen_base из corpus.js,
// второй повёрнут на 90°, столешница 38 мм, свес 30 мм.
import { buildCorner } from '../app/static/js/generators/corner.js';
import { buildItem } from '../app/static/js/generators/corpus.js';
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

// --- По умолчанию: modulesA=3, modulesB=2, модуль 600, D=560, H=720 ---
const c = buildCorner({});
eq([c.dims.w, c.dims.h, c.dims.d, c.dims.lift, c.dims.lenA, c.dims.lenB],
  [1800, 720, 560 + 1200, 0, 1800, 1200], 'Г: габариты (1800 x 1760), lenA/lenB');
eq(c.anim.doors.length, 5, 'Г: 3 двери ряда A + 2 двери ряда B');
eq(c.anim.drawers.length, 0, 'Г: без ящиков при front=door1');
eq(new Set(c.anim.doors.map((d) => d.id)).size, 5, 'Г: id дверей уникальны (префиксы A:/B:)');
eq(c.anim.doors.every((d) => d.id.startsWith('A:') || d.id.startsWith('B:')), true, 'Г: id дверей с префиксами рядов');
eq(c.parts.every((p) => !p.group || c.anim.doors.some((d) => d.id === p.group) || c.anim.drawers.some((d) => d.id === p.group)), true,
  'Г: каждая групповая деталь ссылается на anim');

// Сумма деталей = сумма двух рядов kitchen_base без столешниц + 2 плиты.
// Один ряд kitchen_base(3 модуля, door1): 3*(2 бок+крышка+дно+ХДФ+цоколь+полка)=24 + 3 фасада + 3 ручки = 30.
const rowA = buildItem({ type: 'kitchen_base', t: 16, w: 600, h: 720, d: 560, plinth: 100, modules: 3, top: false, shelves: 1, front: 'door1', drawers: 3, handle: 'bar160', lift: 0 });
const rowB = buildItem({ type: 'kitchen_base', t: 16, w: 600, h: 720, d: 560, plinth: 100, modules: 2, top: false, shelves: 1, front: 'door1', drawers: 3, handle: 'bar160', lift: 0 });
eq(c.parts.length, rowA.parts.length + rowB.parts.length + 2, 'Г: число деталей = ряд A + ряд B + 2 плиты');
const sideCount = c.parts.filter((p) => p.name === 'Боковина').length;
eq(sideCount, 2 * (3 + 2), 'Г: боковины 2 на модуль, угловой квадрат не дублируется');

// --- Столешница 38 мм ---
const tops = c.parts.filter((p) => p.name === 'Столешница 38 мм');
eq(tops.length, 2, 'Г: две плиты столешницы (L-образно)');
eq(tops.map((p) => [p.cut, p.size[1]]).sort(), [[[1170, 590], 38], [[1800, 590], 38]], 'Г: плиты 1800x590 и (1200-30)x590, толщина 38');
eq(tops.every((p) => p.kind === 'top' && p.material === 'top'), true, 'Г: плиты kind/material=top');
const topA = tops.find((p) => p.size[0] === 1800), topB = tops.find((p) => p.size[2] === 1170);
eq(topA.pos[2] - topA.size[2] / 2, 0, 'Г: плита A впритык к задней стене (z=0)');
eq(topA.pos[2] + topA.size[2] / 2, 560 + 30, 'Г: плита A со свесом 30 спереди');
eq(topB.pos[0] - topB.size[0] / 2, 0, 'Г: плита B впритык к левой стене (x=0)');
eq(topB.pos[0] + topB.size[0] / 2, 560 + 30, 'Г: плита B со свесом 30 спереди (+x)');
eq(topB.pos[2] - topB.size[2] / 2, topA.pos[2] + topA.size[2] / 2, 'Г: плиты не перекрываются и не расходятся (стык на свесе A)');
eq(topB.pos[2] + topB.size[2] / 2, 560 + 1200, 'Г: плита B заканчивается впритык к концу ряда B');

// --- Поворот ряда B: размеры Sx/Sz меняются, фасады смотрят на +x ---
const bSide = c.parts.find((p) => p.name === 'Боковина' && p.pos[0] < 560 && p.pos[0] > 20 && p.size[0] === 556);
eq(!!bSide, true, 'Г: боковина ряда B повёрнута (size 556 x bodyH x 16)');
const bDoor = c.anim.doors.find((d) => d.id.startsWith('B:'));
eq(bDoor.pivot[0], 560 + 1 + 16 / 2, 'Г: pivot двери B у фасада (+x): zf локального ряда (289) + D/2');
eq(bDoor.pivot[2] <= 560 + 1200 && bDoor.pivot[2] >= 560, true, 'Г: pivot двери B внутри ряда B по z (560..1760)');
const bFacade = c.parts.filter((p) => p.group && p.group.startsWith('B:') && p.name === 'Фасад');
eq(bFacade.length, 2, 'Г: фасады ряда B есть');
eq(bFacade.every((p) => p.size[0] === 16 && p.size[2] > 400), true, 'Г: фасад B повёрнут (толщина 16 по x)');
const bDoorCenter = c.parts.find((p) => p.group === bDoor.id && p.name === 'Фасад');
eq(bDoorCenter.pos[0], 0, 'Г: смещение фасада B от pivot только по z (поворот)');
eq(Math.abs(bDoorCenter.pos[2]), bDoorCenter.size[2] / 2, 'Г: фасад B на полширины от pivot по z');

// --- Деталировка через summarizeCut ---
const cut = summarizeCut(c.parts);
const topRows = cut.rows.filter((r) => r.name === 'Столешница 38 мм');
eq(topRows.map((r) => [r.a, r.b, r.q]).sort(), [[1170, 590, 1], [1800, 590, 1]], 'Г: раскрой столешниц в деталировке');
const expectedArea = summarizeCut([...rowA.parts, ...rowB.parts, ...tops]).dspArea;
close(cut.dspArea, expectedArea, 1e-9, 'Г: площадь ДСП = сумма двух рядов + плиты (без удвоения угла)');
eq(cut.sheets >= 1, true, 'Г: листы считаются');

// --- Ящики в обоих рядах ---
const dr = buildCorner({ front: 'drawers', drawers: 2 });
eq(dr.anim.drawers.length, 2 * (3 + 2), 'Г: ящики 2 на модуль в обоих рядах (2*(3+2))');
eq(dr.anim.drawers.every((d) => d.travel > 0), true, 'Г: у ящиков есть выезд (travel)');
eq(new Set(dr.anim.drawers.map((d) => d.id)).size, dr.anim.drawers.length, 'Г: id ящиков уникальны');
const bDrawer = dr.anim.drawers.find((d) => d.id.startsWith('B:'));
eq(bDrawer.pivot[0] >= 0 && bDrawer.pivot[0] <= 560, true, 'Г: pivot ящика B в полосе ряда B по x');
const bDrawerSide = dr.parts.find((p) => p.group === bDrawer.id && p.name === 'Боковина ящика');
eq(bDrawerSide.size[0] > 100 && bDrawerSide.size[2] === 16, true, 'Г: короб ящика B повёрнут (bd по x, толщина по z)');

// --- Свои числа модулей ---
const small = buildCorner({ modulesA: 2, modulesB: 1 });
eq([small.dims.lenA, small.dims.lenB, small.dims.w, small.dims.d], [1200, 600, 1200, 1160], 'Г: modulesA=2, modulesB=1');
eq(small.anim.doors.length, 3, 'Г: 2+1 двери');
const onlyA = buildCorner({ modulesB: 0 });
eq([onlyA.dims.d, onlyA.parts.filter((p) => p.name === 'Столешница 38 мм').length, onlyA.anim.doors.length], [560, 1, 3], 'Г: modulesB=0 — один ряд');
const noTop = buildCorner({ top: false });
eq(noTop.parts.some((p) => p.name === 'Столешница 38 мм'), false, 'Г: top=false — без столешницы');

// --- Разные фасады по рядам ---
const mixed = buildCorner({ frontA: 'drawers', frontB: 'door1', drawers: 1 });
eq(mixed.anim.drawers.length, 3, 'Г: frontA=drawers (3 модуля x1 ящик)');
eq(mixed.anim.doors.length, 2, 'Г: frontB=door1 (2 двери)');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты угловой кухни прошли');
process.exit(failed ? 1 : 0);
