// Параметрическая сборка корпуса. Формулы 1:1 из эталонного прототипа
// mebel3d.html (функция build), ТЗ п. 5. Чистая логика без three.js:
// возвращает список деталей, а меши из них строит scene.js.
//
// Система координат предмета: x — вдоль фасада (0..ширина), y — от пола,
// z — 0 в центре глубины, фасад в +z.
//
// Правила конструкции (ТЗ п. 5):
//   боковины t × высота корпуса × (глубина−4), крышка и дно между боковинами,
//   задняя стенка ХДФ 4 мм накладная, цоколь с отступом 60 мм от переднего края,
//   полки глубиной на 20 мм меньше корпуса, фасады накладные с зазором 3 мм,
//   ящики: зазор по бокам 13 мм, выезд ~70% глубины короба,
//   столешница 38 мм со свесом 30 мм спереди.

import { PRESETS, handleById } from './common.js';

const G = 3; // зазор между фасадами, мм

// Собирает один предмет (модульный ряд) по параметрам проекта.
// Возвращает { parts, anim, dims }:
//   parts — детали с размерами (size), позицией (pos), материалом и строкой раскроя (cut);
//   anim  — двери и ящики для анимации открытия;
//   dims  — габариты для размерных меток и камеры.
export function buildItem(p) {
  const t = p.t, W = p.w, H = p.h, D = p.d, N = p.modules;
  const P = Math.min(p.plinth, H - 100);
  const lift = p.type === 'kitchen_wall' ? p.lift : 0;
  const bodyH = H - P, D4 = D - 4, zc = 2;
  const shelves = p.front === 'drawers' ? 0 : p.shelves;
  const totW = W * N;

  const parts = [];
  const anim = { doors: [], drawers: [] };

  // part: { name, kind, cut, size, pos, material, edge, group }
  // cut — строка раскроя [a, b] в мм; у ручек раскроя нет.
  function add(o) { parts.push(o); }

  for (let m = 0; m < N; m++) {
    const ox = m * W, cx = ox + W / 2, by = lift + P;

    add({ name: 'Боковина', kind: 'dsp', cut: [bodyH, D4], size: [t, bodyH, D4], pos: [ox + t / 2, by + bodyH / 2, zc], material: 'corpus' });
    add({ name: 'Боковина', kind: 'dsp', cut: [bodyH, D4], size: [t, bodyH, D4], pos: [ox + W - t / 2, by + bodyH / 2, zc], material: 'corpus' });
    add({ name: 'Крышка', kind: 'dsp', cut: [W - 2 * t, D4], size: [W - 2 * t, t, D4], pos: [cx, lift + H - t / 2, zc], material: 'corpus' });
    add({ name: 'Дно', kind: 'dsp', cut: [W - 2 * t, D4], size: [W - 2 * t, t, D4], pos: [cx, by + t / 2, zc], material: 'corpus' });
    add({ name: 'Задняя стенка ХДФ 4 мм', kind: 'hdf', cut: [bodyH - 4, W - 4], size: [W - 4, bodyH - 4, 4], pos: [cx, by + bodyH / 2, -D / 2 + 2], material: 'hdf' });
    if (P > 0) {
      add({ name: 'Цоколь', kind: 'dsp', cut: [W, P], size: [W, P, t], pos: [cx, lift + P / 2, D / 2 - 60 - t / 2], material: 'corpus' });
    }

    // Полки равномерно по внутренней высоте
    const innerH = bodyH - 2 * t;
    for (let s = 1; s <= shelves; s++) {
      add({ name: 'Полка', kind: 'dsp', cut: [W - 2 * t, D4 - 20], size: [W - 2 * t, t, D4 - 20], pos: [cx, by + t + s * innerH / (shelves + 1), zc - 10], material: 'corpus' });
    }

    const zf = D / 2 + 1 + t / 2; // ось фасада: накладной, зазор 1 мм от корпуса
    if (p.front === 'door1' || p.front === 'doors2') {
      const nd = p.front === 'door1' ? 1 : 2;
      const dw = (W - G * (nd + 1)) / nd, dh = bodyH - 2 * G, dyc = by + bodyH / 2;
      for (let i = 0; i < nd; i++) {
        const left = i === 0, sg = left ? 1 : -1;
        const gid = 'm' + m + '_door' + i; // уникальный id на модуль — иначе двери ряда делят pivot
        // Петли по внешним краям: шарнир на внешнем краю двери, открытие наружу
        const pivot = [left ? ox + G : ox + W - G, dyc, zf];
        anim.doors.push({ id: gid, pivot, sign: left ? -1 : 1, angle: 1.75 });
        add({ name: 'Фасад', kind: 'dsp', cut: [dh, dw], size: [dw, dh, t], pos: [sg * dw / 2, 0, 0], material: 'facade', group: gid });
        // Ручка: у верхних кухонных снизу, у высоких шкафов ближе к верху
        let hy;
        if (p.type === 'kitchen_wall') hy = -dh / 2 + 110;
        else if (H > 1200) hy = clamp(1000 - dyc, -dh / 2 + 100, dh / 2 - 100);
        else hy = dh / 2 - 110;
        add({ name: null, kind: 'handle', cut: null, size: [12, handleById(p.handle).length, 14], pos: [sg * (dw - 40), hy, t / 2 + 7], material: 'handle', edge: false, group: gid });
      }
    } else if (p.front === 'drawers') {
      const nr = p.drawers, fh = (bodyH - G * (nr + 1)) / nr;
      for (let j = 0; j < nr; j++) {
        const yc = by + G + fh / 2 + j * (fh + G);
        const gid = 'm' + m + '_drawer' + j;
        // Короб ящика: зазор по бокам 13 мм (bw = W − 2t − 26)
        const bw = W - 2 * t - 26, bh = Math.max(60, fh - 50), bd = D4 - 60;
        const yb = -fh / 2 + 30 + bh / 2, zb = D / 2 - 1 - bd / 2;
        anim.drawers.push({ id: gid, pivot: [cx, yc, 0], travel: bd * 0.7 });
        add({ name: 'Фасад ящика', kind: 'dsp', cut: [W - 2 * G, fh], size: [W - 2 * G, fh, t], pos: [0, 0, zf], material: 'facade', group: gid });
        add({ name: null, kind: 'handle', cut: null, size: [handleById(p.handle).length, 12, 14], pos: [0, fh / 2 - 38, D / 2 + 1 + t + 7], material: 'handle', edge: false, group: gid });
        add({ name: 'Боковина ящика', kind: 'dsp', cut: [bd, bh], size: [t, bh, bd], pos: [-(bw / 2 - t / 2), yb, zb], material: 'corpus', group: gid });
        add({ name: 'Боковина ящика', kind: 'dsp', cut: [bd, bh], size: [t, bh, bd], pos: [bw / 2 - t / 2, yb, zb], material: 'corpus', group: gid });
        add({ name: 'Задняя стенка ящика', kind: 'dsp', cut: [bw - 2 * t, bh], size: [bw - 2 * t, bh, t], pos: [0, yb, D / 2 - 1 - bd + t / 2], material: 'corpus', group: gid });
        add({ name: 'Дно ящика ХДФ 4 мм', kind: 'hdf', cut: [bd - t, bw - 2 * t], size: [bw - 2 * t, 4, bd - t], pos: [0, -fh / 2 + 32, D / 2 - 1 - (bd - t) / 2], material: 'hdf', group: gid });
      }
    }
  }

  // Столешница одной плитой на весь ряд, свес 30 мм спереди
  if (p.top && (p.type === 'kitchen_base' || p.type === 'chest')) {
    add({ name: 'Столешница 38 мм', kind: 'top', cut: [totW, D + 30], size: [totW, 38, D + 30], pos: [totW / 2, lift + H + 19, 15], material: 'top' });
  }

  return { parts, anim, dims: { w: totW, h: H, d: D, lift } };
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Дополнение параметров проекта значениями по умолчанию из пресета типа.
export function withDefaults(p) {
  const preset = PRESETS[p.type];
  // Толщина ДСП не входит в пресеты (как в прототипе), по умолчанию 16 мм
  return preset ? { t: 16, ...preset, ...p, label: undefined } : p;
}
