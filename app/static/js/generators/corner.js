// Угловая кухня буквой «Г» (этап 6). Использует buildItem из corpus.js
// как основу: ряд A вдоль X, ряд B вдоль Z с поворотом на 90°.
// Итоговый интерфейс — как у corpus.js: { parts, anim, dims }.
//
// Координаты предмета (как в corpus.js, но с привязкой к заднему углу):
//   origin (0,0) — задний левый (угловой) угол, x — вдоль ряда A (0..lenA),
//   z — от задней стены к фасадам. Ряд A: z 0..d (корпус), фасад в +z.
//   Ряд B: x 0..d (корпус), z d..d+lenB (угловой квадрат принадлежит ряду A),
//   фасад в +x (на восток, вглубь кухни). Столешница: 38 мм, свес 30 мм.
//
// Параметры (все необязательны):
//   t=16, w/moduleW=600 (ширина одного модуля), h=720, d=560, plinth=100,
//   modulesA/modules=3, modulesB=2, shelves=1, front='door1' (frontA/frontB —
//   отдельно для каждого ряда), drawers=3 (drawersA/drawersB), top=true,
//   handle='bar160'. Бары на алиасы: modules->A, w->moduleW.
//   Также поддерживаются поля corpus/facade/handle/colors — они передаются
//   в buildItem как есть (см. withDefaults), здесь не обязательны.
//
// Ограничение сцены (не правим здесь): scene.js открывает ящики, сдвигая
// pivot строго по +z, поэтому ящики ряда B визуально будут уезжать на юг,
// а не на восток, пока в scene.js не появится ось движения ящика
// (см. docs/agents/corner.md). Двери ряда B (поворот pivot вокруг Y)
// открываются корректно с тем же знаком, что и у ряда A.

import { buildItem } from './corpus.js';

const TOP_T = 38;   // столешница
const OVERHANG = 30; // свес столешницы спереди (как в corpus.js)

function clampInt(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

// Поворот на 90° вокруг Y (THREE rotationY = +90°): (x,z)->(z,-x),
// размер [sx,sy,sz] -> [sz,sy,sx]. Смещения деталей группы поворачиваются
// вокруг их pivot, глобальные детали — с учётом сдвига в угол.
function rotSize(size) { return [size[2], size[1], size[0]]; }
function rotOffset(pos) { return [pos[2], pos[1], -pos[0]]; }
function rotPoint(pos, dx, dz) { return [pos[2] + dx, pos[1], -pos[0] + dz]; }

export function buildCorner(params = {}) {
  const t = params.t ?? 16;
  const moduleW = params.w ?? params.moduleW ?? 600;
  const H = params.h ?? 720;
  const D = params.d ?? 560;
  const plinth = params.plinth ?? 100;
  const modulesA = clampInt(params.modulesA ?? params.modules ?? 3, 0, 6, 3);
  const modulesB = clampInt(params.modulesB ?? 2, 0, 6, 2);
  const lenA = modulesA * moduleW;
  const lenB = modulesB * moduleW;
  const topFlag = params.top ?? true;

  function rowParams(modules, frontKey, drawersKey) {
    return {
      ...params,
      type: 'kitchen_base',
      t, w: moduleW, h: H, d: D, plinth,
      modules,
      top: false, // столешницу добавляем сами (L-образно, без двойного угла)
      shelves: params.shelves ?? 1,
      front: params[frontKey] ?? params.front ?? 'door1',
      drawers: params[drawersKey] ?? params.drawers ?? 3,
      lift: 0,
    };
  }

  const parts = [];
  const anim = { doors: [], drawers: [] };

  function mergeRow(built, prefix, transform) {
    // corpus.js даёт неуникальные id на модуль (door0 в каждом модуле),
    // а scene.js группирует детали по id: без дедупликации все двери ряда
    // сели бы на первый pivot. Делаем id уникальными по порядку появления
    // (очередь на каждый исходный id, в порядке anim) + префикс ряда.
    const queues = new Map(); // origId -> [uniqueId, ...] по порядку anim
    function enqueue(list, kind) {
      for (const d of list) {
        const q = queues.get(kind + '|' + d.id) ?? [];
        q.push(prefix + ':' + d.id + '#' + q.length);
        queues.set(kind + '|' + d.id, q);
      }
    }
    enqueue(built.anim.doors, 'door');
    enqueue(built.anim.drawers, 'drawer');
    // Детали одного pivot идут модулями подряд (цикл по модулям в corpus.js):
    // все детали модуля делят один pivot, число деталей на pivot у всех
    // модулей одинаково (дверь 2, ящик 5), поэтому j-я деталь с данным id
    // принадлежит модулю floor(j / деталейНаPivot) и берёт q[модуль].
    const appearance = new Map();
    const partIds = built.parts.map((part) => {
      if (!part.group) return null;
      const kind = part.group.includes('drawer') ? 'drawer' : 'door';
      const key = kind + '|' + part.group;
      const q = queues.get(key);
      if (!q) return prefix + ':' + part.group;
      const total = built.parts.filter((x) => x.group === part.group).length;
      const perModule = Math.max(1, Math.round(total / q.length));
      const idx = appearance.get(key) ?? 0;
      appearance.set(key, idx + 1);
      return q[Math.min(q.length - 1, Math.floor(idx / perModule))];
    });
    built.parts.forEach((part, i) => {
      const p = { ...part, size: transform.size(part.size) };
      if (part.group) {
        p.group = partIds[i];
        p.pos = transform.offset(part.pos);
      } else {
        p.pos = transform.point(part.pos);
      }
      parts.push(p);
    });
    const doorIdx = new Map(), drawerIdx = new Map();
    for (const d of built.anim.doors) {
      const i = doorIdx.get(d.id) ?? 0; doorIdx.set(d.id, i + 1);
      anim.doors.push({ ...d, id: queues.get('door|' + d.id)[i], pivot: transform.point(d.pivot) });
    }
    for (const d of built.anim.drawers) {
      const i = drawerIdx.get(d.id) ?? 0; drawerIdx.set(d.id, i + 1);
      anim.drawers.push({ ...d, id: queues.get('drawer|' + d.id)[i], pivot: transform.point(d.pivot) });
    }
  }

  // Ряд A: только сдвиг по z на D/2 (corpus: z -D/2..D/2 -> 0..D).
  if (modulesA > 0) {
    mergeRow(buildItem(rowParams(modulesA, 'frontA', 'drawersA')), 'A', {
      size: (s) => [...s],
      offset: (p) => [...p],
      point: (p) => [p[0], p[1], p[2] + D / 2],
    });
  }

  // Ряд B: rotY +90° + сдвиг (D/2, D+lenB). Sx/Sz меняются местами.
  if (modulesB > 0) {
    mergeRow(buildItem(rowParams(modulesB, 'frontB', 'drawersB')), 'B', {
      size: rotSize,
      offset: rotOffset,
      point: (p) => rotPoint(p, D / 2, D + lenB),
    });
  }

  // Столешница 38 мм, свес 30 мм. Угол — один раз (в плите ряда A).
  // Плита B не перекрывает плиту A: она начинается с z = D+30.
  if (topFlag) {
    if (modulesA > 0) {
      parts.push({
        name: 'Столешница 38 мм', kind: 'top',
        cut: [lenA, D + OVERHANG], size: [lenA, TOP_T, D + OVERHANG],
        pos: [lenA / 2, H + TOP_T / 2, D / 2 + OVERHANG / 2], material: 'top',
      });
    }
    const lenBtop = lenB - OVERHANG;
    if (lenBtop > 0) {
      parts.push({
        name: 'Столешница 38 мм', kind: 'top',
        cut: [lenBtop, D + OVERHANG], size: [D + OVERHANG, TOP_T, lenBtop],
        pos: [(D + OVERHANG) / 2, H + TOP_T / 2, D + OVERHANG + lenBtop / 2],
        material: 'top',
      });
    } else if (lenBtop === 0) {
      // Длина ряда B <= свеса: хватит плиты A, отдельную плиту не добавляем.
    }
  }

  const dims = {
    w: Math.max(lenA, D),
    h: H,
    d: Math.max(D + lenB, D),
    lift: 0,
    lenA,
    lenB,
  };
  return { parts, anim, dims };
}
