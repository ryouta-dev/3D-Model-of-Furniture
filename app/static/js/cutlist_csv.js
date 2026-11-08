// Выгрузка деталировки в CSV (ТЗ п. 7.3, бэклог п. 11).
// Чистые функции работают и в node (тесты), скачивание — только в браузере.
// Формулы не трогает: берёт готовые parts из генераторов через
// buildItemByType + summarizeCut, как таблица в editor.js#renderCut.

import { buildItemByType } from './generators/index.js';
import { summarizeCut } from './generators/cutlist.js';

// Число → строка без потери: целые без суффикса, дробные с точкой.
export function fmtNum(v) {
  if (v == null || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// Один столбец CSV: разделитель ';' (Excel ru), кавычки при необходимости.
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// rows: [{name, kind, a, b, q}] (как возвращает summarizeCut).
// summaryByT: { "16": {area, count}, ... } или null — блок «Итого» ниже таблицы.
export function toCsv(rows, summaryByT = null) {
  const lines = ['Деталь;Длина, мм;Ширина, мм;Кол-во;Тип;Площадь, м2'];
  for (const r of rows) {
    const area = (r.a * r.b * r.q) / 1e6;
    lines.push([
      csvCell(r.name),
      fmtNum(r.a),
      fmtNum(r.b),
      fmtNum(r.q),
      csvCell(r.kind || ''),
      area.toFixed(3),
    ].join(';'));
  }
  if (summaryByT) {
    lines.push('');
    const parts = Object.entries(summaryByT)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([t, s]) => `ДСП ${t} мм: ${s.count} дет., ${s.area.toFixed(2)} м2`);
    lines.push(csvCell('Итого') + ';' + csvCell(parts.join(' · ')));
  }
  return lines.join('\r\n') + '\r\n';
}

// Сводит детали всех предметов проекта: группировка name|a|b, как в таблице.
export function getCutRows(project) {
  const rows = new Map();
  const dspByT = {};
  for (const item of project?.items || []) {
    let built;
    try {
      built = buildItemByType(item.type, item);
    } catch {
      continue; // неизвестный тип — пропускаем, а не роняем выгрузку
    }
    const sum = summarizeCut(built.parts);
    const tKey = item.t || 16;
    (dspByT[tKey] = dspByT[tKey] || { area: 0, count: 0 });
    dspByT[tKey].area += sum.dspArea;
    dspByT[tKey].count += sum.dspCount;
    for (const r of sum.rows) {
      const key = `${r.name}|${r.a}|${r.b}`;
      if (rows.has(key)) rows.get(key).q += r.q;
      else rows.set(key, { ...r });
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.a * b.b * b.q - a.a * b.b * b.q);
  // Пустая деталировка: Итого не пишем, чтобы не путать пустой файл со сводкой.
  return { rows: sorted, dspByT: Object.keys(dspByT).length ? dspByT : null };
}

// Проект → готовый CSV-текст с BOM (чтобы Excel открыл кириллицу сразу).
export function buildCutCsv(project) {
  const { rows, dspByT } = getCutRows(project);
  return '\uFEFF' + toCsv(rows, dspByT);
}

// Скачивание CSV через Blob. Возвращает число строк данных (без заголовка).
export function downloadCutCsv(project) {
  const { rows } = getCutRows(project);
  const text = buildCutCsv(project);
  const pid = (project && project.id) || 'mebel3d';
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return { file: `${pid}-cutlist.csv`, rows: rows.length, text };
  }
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pid}-cutlist.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { file: `${pid}-cutlist.csv`, rows: rows.length };
}
