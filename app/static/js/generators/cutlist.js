// Деталировка: сводка деталей, площадь ДСП и ориентировочное число листов.
// Логика 1:1 из прототипа (renderCut): группировка по названию и размеру,
// площадь только ДСП, листы 2750×1830 с запасом 15%.

import { SHEET } from './common.js';

// parts → { rows: [{ name, kind, a, b, q }], dspArea (м²), dspCount, sheets }
export function summarizeCut(parts) {
  const map = new Map();
  for (const p of parts) {
    if (!p.cut) continue; // ручки в раскрой не попадают
    const a = Math.round(p.cut[0] * 10) / 10, b = Math.round(p.cut[1] * 10) / 10;
    const key = p.name + '|' + a + '|' + b;
    if (map.has(key)) map.get(key).q++;
    else map.set(key, { name: p.name, kind: p.kind, a, b, q: 1 });
  }
  const rows = [...map.values()];
  let dspArea = 0, dspCount = 0;
  for (const r of rows) {
    if (r.kind === 'dsp') {
      dspArea += r.a * r.b * r.q / 1e6;
      dspCount += r.q;
    }
  }
  const sheetArea = SHEET.w * SHEET.h * (1 - SHEET.reserve) / 1e6;
  const sheets = Math.max(1, Math.ceil(dspArea / sheetArea));
  return { rows, dspArea, dspCount, sheets };
}
