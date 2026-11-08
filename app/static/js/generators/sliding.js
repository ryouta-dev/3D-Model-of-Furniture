// Шкаф-купе (Этап 6). Отдельный модуль-генератор с общим интерфейсом:
// buildSliding(params) → { parts, anim, dims } — как buildItem в corpus.js.
//
// Купе = корпус как wardrobe (формулы 1:1 из corpus.js), но вместо распашных
// дверей — 2–3 раздвижные фасады на направляющих сверху/снизу.
//
// Параметры (как у wardrobe, плюс свои):
//   w, h, d, t, plinth, shelves, modules, lift, handle — те же поля предмета;
//   slidingDoors — число раздвижных фасадов, 2 или 3 (по умолчанию 2).
//   Допустим также дубль params.doors (алиас). Значения вне 2..3 обрезаются.
//
import { buildItem } from './corpus.js';

const SG = 3; // зазор фасадов от корпуса, мм — как в corpus.js
const OVERLAP = 30; // нахлёст соседних раздвижных фасадов, мм
const GUIDE_TOP_H = 40; // высота верхней направляющей, мм
const GUIDE_BOT_H = 15; // высота нижней направляющей, мм
const GUIDE_DEPTH = 45; // глубина направляющих (две колеи), мм
const TRACK_GAP = 30; // разнос передней/задней колеи по z, мм

// Значения по умолчанию — как пресет wardrobe в common.js, но ширина больше:
// купе обычно шире одиночного шкафа. modules — один короб на всю ширину.
export const SLIDING_DEFAULTS = {
  w: 1500, h: 2200, d: 550, t: 16, plinth: 80,
  shelves: 4, drawers: 3, top: false, modules: 1, lift: 0,
  slidingDoors: 2,
};

function clampDoors(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return 2;
  return Math.min(3, Math.max(2, n));
}

export function buildSliding(params = {}) {
  const p = { ...SLIDING_DEFAULTS, ...params };
  const N = clampDoors(params.slidingDoors ?? params.doors ?? SLIDING_DEFAULTS.slidingDoors);
  const modules = p.modules ?? 1;

  // Корпус — переиспользуем формулы wardrobe через corpus.js, но без дверей:
  // front 'open' не добавляет ни фасадов, ни петель.
  const base = buildItem({
    ...p,
    type: 'wardrobe',
    front: 'open',
    modules,
    lift: 0, // у шкафа lift всегда 0 (как в corpus.js для не-кухни)
  });
  const parts = [...base.parts];
  const anim = { doors: [], drawers: [], sliding: [] };

  const t = p.t ?? 16;
  const W = p.w, H = p.h, D = p.d;
  const totW = W * modules;
  const P = Math.min(p.plinth ?? 80, H - 100);
  const bodyH = H - P;
  const by = P; // lift = 0 для купе
  const cy = by + bodyH / 2;

  // Раздвижные фасады: общая ширина проёма перекрывается с нахлёстом.
  // Сумма ширин = Wopen + OVERLAP*(N-1), откуда dw ниже.
  const Wopen = totW - 2 * SG;
  const dw = (Wopen + OVERLAP * (N - 1)) / N;
  const dh = bodyH - 2 * SG;
  const travel = dw - OVERLAP; // ход одной двери вбок до упора в соседнюю

  for (let i = 0; i < N; i++) {
    const id = 'sliding' + i;
    const cx = SG + dw / 2 + i * (dw - OVERLAP);
    // Колеи чередуются: чётные — передняя, нечётные — задняя.
    const cz = i % 2 === 0 ? D / 2 - 10 : D / 2 - 10 - TRACK_GAP;
    anim.sliding.push({
      id,
      pivot: [cx, cy, cz],
      travel,
      direction: i % 2 === 0 ? 1 : -1, // чётные едут вправо, нечётные — влево
      axis: 'x',
    });
    parts.push({
      name: 'Фасад-купе',
      kind: 'dsp',
      cut: [dh, dw],
      size: [dw, dh, t],
      pos: [0, 0, 0], // относительно пивота
      material: 'facade',
      group: id,
    });
  }

  // Направляющие сверху/снизу на всю ширину. Профиль (металл), не ДСП:
  // в деталировке kind 'profile' не попадает в площадь ДСП.
  parts.push({
    name: 'Направляющая верхняя',
    kind: 'profile',
    cut: [totW, GUIDE_TOP_H],
    size: [totW, GUIDE_TOP_H, GUIDE_DEPTH],
    pos: [totW / 2, H - GUIDE_TOP_H / 2, D / 2 - GUIDE_DEPTH / 2 - 5],
    material: 'handle',
    edge: false,
  });
  parts.push({
    name: 'Направляющая нижняя',
    kind: 'profile',
    cut: [totW, GUIDE_BOT_H],
    size: [totW, GUIDE_BOT_H, GUIDE_DEPTH],
    pos: [totW / 2, P + GUIDE_BOT_H / 2, D / 2 - GUIDE_DEPTH / 2 - 5],
    material: 'handle',
    edge: false,
  });

  return { parts, anim, dims: { w: totW, h: H, d: D, lift: 0 } };
}
