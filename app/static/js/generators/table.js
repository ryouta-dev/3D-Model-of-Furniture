// Стол (этап 6). Чистая логика без three.js: возвращает { parts, anim, dims }
// как corpus.js — меши из деталей строит scene.js, формулы только здесь.
//
// Система координат предмета (как в corpus.js): x — вдоль столешницы (0..W),
// y — от пола, z — 0 в центре глубины.
//
// Конструкция (все размеры — мм, допущения, см. docs/agents/bed_table.md):
//   столешница W × 38 × D (38 мм, как в corpus.js, свеса нет — размер задаёт
//   оператор), 4 ножки 50 × (H−38) × 50 с отступом 100 мм от краёв,
//   4 фартука (царги) высотой 120 мм толщиной t под столешницей.
//   Режим опор: p.supports === 'panel' (или p.opors === 'panel' /
//   p.legsType === 'panel') — вместо ножек две панели-опоры t × (H−38) × (D−100).
// Высота стола H (p.h, по умолчанию 750), толщина фартуков t (p.t, по умолчанию 16).

export function buildTable(p = {}) {
  const t = tableNum(p.t, 16);
  const W = tableNum(p.w, 1200);
  const D = tableNum(p.d, 700);
  const H = tableNum(p.h, 750);

  const TOP_T = 38;    // толщина столешницы
  const LEG = 50;      // сечение ножек
  const INSET = 100;   // отступ ножек от краёв столешницы
  const APRON_H = 120; // высота фартуков

  const parts = [];
  const anim = { doors: [], drawers: [] };

  function add(o) { parts.push(o); }

  const legH = Math.max(50, H - TOP_T);
  const insetX = Math.min(INSET, Math.max(0, W / 2 - LEG / 2 - 20));
  const insetZ = Math.min(INSET, Math.max(0, D / 2 - LEG / 2 - 20));
  const lx = insetX + LEG / 2, rx = W - insetX - LEG / 2;
  const nz = D / 2 - insetZ - LEG / 2;
  const apronY = H - TOP_T - APRON_H / 2;

  // Столешница: толщина 38 мм, верхний край на высоте H
  add({ name: 'Столешница 38 мм', kind: 'top', cut: [W, D], size: [W, TOP_T, D], pos: [W / 2, H - TOP_T / 2, 0], material: 'top' });

  const asPanel = p.supports === 'panel' || p.opors === 'panel' || p.legsType === 'panel';

  if (asPanel) {
    // Две панели-опоры вместо ножек (глубина на 100 мм меньше столешницы)
    const pd = Math.max(100, D - 100);
    const px1 = Math.min(100, W / 2 - t / 2 - 20) + t / 2;
    add({ name: 'Опора панельная', kind: 'dsp', cut: [pd, legH], size: [t, legH, pd], pos: [px1, legH / 2, 0], material: 'corpus' });
    add({ name: 'Опора панельная', kind: 'dsp', cut: [pd, legH], size: [t, legH, pd], pos: [W - px1, legH / 2, 0], material: 'corpus' });
    // Поперечный фартук между панельными опорами (сзади, у стены)
    const fl = W - 2 * px1;
    if (fl > 50) {
      add({ name: 'Царга стола', kind: 'dsp', cut: [fl, APRON_H], size: [fl, APRON_H, t], pos: [W / 2, apronY, -(pd / 2 - t / 2)], material: 'corpus' });
    }
  } else {
    // 4 ножки
    for (const [x, z] of [[lx, -nz], [rx, -nz], [lx, nz], [rx, nz]]) {
      add({ name: 'Ножка стола', kind: 'dsp', cut: [legH, LEG], size: [LEG, legH, LEG], pos: [x, legH / 2, z], material: 'corpus' });
    }
    // Фартуки: продольные (перед/зад) и поперечные (лева/права) между ножками
    const frontLen = Math.max(50, rx - lx - LEG);
    const sideLen = Math.max(50, 2 * nz - LEG);
    add({ name: 'Царга стола', kind: 'dsp', cut: [frontLen, APRON_H], size: [frontLen, APRON_H, t], pos: [W / 2, apronY, nz], material: 'corpus' });
    add({ name: 'Царга стола', kind: 'dsp', cut: [frontLen, APRON_H], size: [frontLen, APRON_H, t], pos: [W / 2, apronY, -nz], material: 'corpus' });
    add({ name: 'Царга стола', kind: 'dsp', cut: [sideLen, APRON_H], size: [t, APRON_H, sideLen], pos: [lx, apronY, 0], material: 'corpus' });
    add({ name: 'Царга стола', kind: 'dsp', cut: [sideLen, APRON_H], size: [t, APRON_H, sideLen], pos: [rx, apronY, 0], material: 'corpus' });
  }

  return { parts, anim, dims: { w: W, h: H, d: D, lift: 0 } };
}

function tableNum(v, dflt) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : dflt;
}
