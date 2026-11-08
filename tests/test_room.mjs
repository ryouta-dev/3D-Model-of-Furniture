// Тесты комнаты (node tests/test_room.mjs). Чистая логика без three.js.
import { buildRoomSpec, normalizeRoom, defaultRoom } from '../app/static/js/room.js';

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

// Дифолтная комната из ТЗ п.6: 3600×3200×2700, одно окно сзади
const room = defaultRoom();
const spec = buildRoomSpec(room);
const kinds = spec.map((p) => p.kind);
ok(kinds.includes('floor'), 'комната: есть пол');
ok(kinds.filter((k) => k === 'wall').length === 3, 'комната: 3 стены (задняя, левая, правая)');
ok(kinds.includes('windowFrame') && kinds.includes('windowGlass'), 'комната: окно с рамой и стеклом');
ok(kinds.filter((k) => k === 'skirting').length >= 4, 'комната: плинтус и подоконник');

const floor = spec.find((p) => p.kind === 'floor');
eq(floor.size, [3600, 3200], 'комната: пол по размерам комнаты');
const back = spec.find((p) => p.name === 'Стена задняя');
eq(back.pos, [0, 1350, -1600], 'комната: задняя стена на -depth/2, высота/2 по центру');
const frame = spec.find((p) => p.kind === 'windowFrame');
eq(frame.size[0], 1200, 'комната: окно 1200 шириной из примера ТЗ');
eq(frame.pos[1], 900 + 650, 'комната: окно — sill + height/2');

// --- Окна на боковых стенах (wall: left/right) ---
// Комната 3600×3200: W/2=1800, D/2=1600. Окно x=500, width=1000 → центр по стене
// z = -1600 + 500 + 500 = -600; центр по высоте = sill 900 + 1300/2 = 1550.
const roomLeft = { ...defaultRoom(), windows: [{ wall: 'left', x: 500, width: 1000, height: 1300, sill: 900 }] };
const specLeft = buildRoomSpec(roomLeft);
const frameLeft = specLeft.find((p) => p.kind === 'windowFrame');
eq(frameLeft.rotY, Math.PI / 2, 'окно left: рама повёрнута rotY=PI/2');
eq(frameLeft.pos, [-1780, 1550, -600], 'окно left: x=-W/2+20, z отсчитывается от задней стены');
const glassLeft = specLeft.find((p) => p.kind === 'windowGlass');
eq(glassLeft.rotY, Math.PI / 2, 'окно left: стекло повёрнуто rotY=PI/2');
eq(glassLeft.pos, [-1755, 1550, -600], 'окно left: стекло на x=-W/2+45');
eq(glassLeft.size, [920, 1220], 'окно left: стекло на 80 меньше рамы');
const sillLeft = specLeft.find((p) => p.name === 'Подоконник');
eq(sillLeft.pos, [-1760, 885, -600], 'окно left: подоконник на x=-W/2+40');
eq(sillLeft.rotY, Math.PI / 2, 'окно left: подоконник повёрнут rotY=PI/2');

const roomRight = { ...defaultRoom(), windows: [{ wall: 'right', x: 500, width: 1000, height: 1300, sill: 900 }] };
const specRight = buildRoomSpec(roomRight);
const frameRight = specRight.find((p) => p.kind === 'windowFrame');
eq(frameRight.rotY, -Math.PI / 2, 'окно right: рама повёрнута rotY=-PI/2');
eq(frameRight.pos, [1780, 1550, -600], 'окно right: x=W/2-20, z отсчитывается от задней стены');
const glassRight = specRight.find((p) => p.kind === 'windowGlass');
eq(glassRight.pos, [1755, 1550, -600], 'окно right: стекло на x=W/2-45');
eq(glassRight.rotY, -Math.PI / 2, 'окно right: стекло повёрнуто rotY=-PI/2');
const sillRight = specRight.find((p) => p.name === 'Подоконник');
eq(sillRight.pos, [1760, 885, -600], 'окно right: подоконник на x=W/2-40');
eq(sillRight.rotY, -Math.PI / 2, 'окно right: подоконник повёрнут rotY=-PI/2');

// Боковое окно не должно лежать на задней стене, ширина идёт вдоль стены (по z, а не по x)
ok(Math.abs(frameLeft.pos[2]) !== 1600 - 20 || frameLeft.rotY !== 0, 'окно left: не на задней стене');
const frameLeftFar = buildRoomSpec({ ...defaultRoom(), windows: [{ wall: 'left', x: 1500, width: 1000, height: 1300, sill: 900 }] })
  .find((p) => p.kind === 'windowFrame');
ok(frameLeftFar.pos[2] !== frameLeft.pos[2], 'окно left: x сдвигает окно вдоль боковой стены (по z)');

// Обратная совместимость: без wall и с wall=back/front — окно на задней стене.
for (const wallVal of [undefined, 'back', 'front']) {
  const win = { x: 500, width: 1000, height: 1300, sill: 900 };
  if (wallVal !== undefined) win.wall = wallVal;
  const fr = buildRoomSpec({ ...defaultRoom(), windows: [win] }).find((p) => p.kind === 'windowFrame');
  eq(fr.rotY, 0, `окно wall=${String(wallVal)}: как заднее (rotY=0)`);
  eq(fr.pos, [-1800 + 500 + 500, 1550, -1580], `окно wall=${String(wallVal)}: на задней стене`);
}

// Неизвестная стена тоже падает в back, а не пропадает молча.
const frUnknown = buildRoomSpec({ ...defaultRoom(), windows: [{ wall: 'ceiling', x: 0, width: 1000, height: 1300, sill: 900 }] })
  .find((p) => p.kind === 'windowFrame');
ok(frUnknown && frUnknown.pos[2] === -1580, 'окно с неизвестной стеной: падает в back');

eq(buildRoomSpec(null), [], 'комната: null → пустая спецификация');
eq(buildRoomSpec({ enabled: false, width: 3600, depth: 3200, height: 2700 }), [], 'комната: выключена → пустая спецификация');
ok(normalizeRoom(null) === null, 'normalizeRoom(null) → null');
const n = normalizeRoom({ width: 4000 });
ok(n.depth === 3200 && n.height === 2700 && n.enabled === true, 'normalizeRoom: недостающие поля заполняются');

console.log(failed ? `\n${failed} тестов упало` : '\nВсе тесты комнаты прошли');
process.exit(failed ? 1 : 0);
