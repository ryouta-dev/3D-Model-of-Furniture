// Кровать (этап 6). Чистая логика без three.js: возвращает { parts, anim, dims }
// как corpus.js — меши из деталей строит scene.js, формулы только здесь.
//
// Система координат предмета (как в corpus.js): x — вдоль ширины (0..W),
// y — от пола, z — 0 в центре длины, изголовье в -z, изножье в +z.
//
// Конструкция (все размеры — мм, допущения, см. docs/agents/bed_table.md):
//   изголовье W × H × t в торце (-z),
//   две боковые царги t × 200 × (L−t) на ножках 200 мм,
//   изножье (W−2t) × 200 × t, центральная продольная планка,
//   основание — 5 поперечных ламелей (W−2t) × 150 × t на царгах,
//   4 ножки 50 × 200 × 50 с отступом 60 мм от торцов.
// Спальное место: ширина W (p.w), длина L (p.d), высота изголовья H (p.h).
// Толщина ДСП t (p.t, 16 или 18, по умолчанию 16).

export function buildBed(p = {}) {
  const t = bedNum(p.t, 16);
  const W = bedNum(p.w, 1600); // ширина спального места
  const L = bedNum(p.d, 2000); // длина спального места (глубина предмета)
  const H = bedNum(p.h, 1000); // высота изголовья от пола

  const LEG_H = 200;   // высота ножек
  const RAIL_H = 200;  // высота царг и изножья
  const SLAT_D = 150;  // глубина ламелей основания
  const SLATS = 5;     // число поперечных ламелей
  const LEG = 50;      // сечение ножек (квадрат)

  const parts = [];
  const anim = { doors: [], drawers: [] };

  // part: { name, kind, cut, size, pos, material }
  // cut — строка раскроя [a, b] в мм для summarizeCut; size — [x, y, z] в мм.
  function add(o) { parts.push(o); }

  const innerW = W - 2 * t;       // внутренняя ширина между царгами
  const railLen = L - t;          // царга: от изголовья до изножья
  const railZ = t / 2;            // центр царги по z: (-L/2+t .. L/2)
  const railY = LEG_H + RAIL_H / 2;
  const baseY = LEG_H + RAIL_H;   // верх царги — опора ламелей

  // Изголовье: весь торец кровати, от пола до высоты H
  add({ name: 'Изголовье', kind: 'dsp', cut: [W, H], size: [W, H, t], pos: [W / 2, H / 2, -L / 2 + t / 2], material: 'facade' });

  // Боковые царги
  add({ name: 'Царга', kind: 'dsp', cut: [railLen, RAIL_H], size: [t, RAIL_H, railLen], pos: [t / 2, railY, railZ], material: 'corpus' });
  add({ name: 'Царга', kind: 'dsp', cut: [railLen, RAIL_H], size: [t, RAIL_H, railLen], pos: [W - t / 2, railY, railZ], material: 'corpus' });

  // Изножье (передняя планка торца)
  add({ name: 'Изножье', kind: 'dsp', cut: [innerW, RAIL_H], size: [innerW, RAIL_H, t], pos: [W / 2, railY, L / 2 - t / 2], material: 'corpus' });

  // Центральная продольная планка (опора ламелей на широких кроватях)
  add({ name: 'Центральная планка', kind: 'dsp', cut: [railLen, RAIL_H], size: [t, RAIL_H, railLen], pos: [W / 2, railY, railZ], material: 'corpus' });

  // Основание: поперечные ламели равномерно по длине
  const zFirst = -L / 2 + t + SLAT_D / 2;
  const zLast = L / 2 - SLAT_D / 2;
  for (let i = 0; i < SLATS; i++) {
    const z = SLATS === 1 ? railZ : zFirst + (i * (zLast - zFirst)) / (SLATS - 1);
    add({ name: 'Ламель основания', kind: 'dsp', cut: [innerW, SLAT_D], size: [innerW, t, SLAT_D], pos: [W / 2, baseY + t / 2, z], material: 'corpus' });
  }

  // Ножки опоры: 4 шт, отступ 60 мм от внешних торцов
  const lx = 60 + LEG / 2, rx = W - 60 - LEG / 2;
  const hz = -L / 2 + t + 60, fz = L / 2 - 60;
  for (const [x, z] of [[lx, hz], [rx, hz], [lx, fz], [rx, fz]]) {
    add({ name: 'Ножка опоры', kind: 'dsp', cut: [LEG_H, LEG], size: [LEG, LEG_H, LEG], pos: [x, LEG_H / 2, z], material: 'corpus' });
  }

  return { parts, anim, dims: { w: W, h: H, d: L, lift: 0 } };
}

function bedNum(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : dflt;
}
