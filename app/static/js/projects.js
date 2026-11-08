// Экран проектов: список, создание, копия, переименование, удаление.
// Плюс превью-миниатюра в карточке (ТЗ п. 9, бэклог п. 12): скриншот канваса
// редактора → уменьшенный dataURL JPEG → localStorage. В project.json превью
// НЕ хранится (иначе раздувался бы файл проекта и экспорт).
import { confirmDialog, promptDialog } from './ui.js';

const $ = (s) => document.querySelector(s);

const api = {
  async list() { return (await fetch('/api/projects')).json(); },
  async create(name) {
    return (await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })).json();
  },
  async duplicate(id) {
    return (await fetch(`/api/projects/${id}/duplicate`, { method: 'POST' })).json();
  },
  async rename(id, name) {
    return (await fetch(`/api/projects/${id}/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })).json();
  },
  async remove(id) { return fetch(`/api/projects/${id}`, { method: 'DELETE' }); }
};

// --- Превью в localStorage (не в project.json) ---

export const THUMB_PREFIX = 'mebel3d-thumb:';
const THUMB_MAX_W = 480; // превью только для карточки, большой PNG не нужен
const THUMB_QUALITY = 0.75;

export function thumbKey(id) { return THUMB_PREFIX + id; }

export function getThumb(id) {
  try {
    const v = localStorage.getItem(thumbKey(id));
    return v && v.startsWith('data:image/') ? v : null;
  } catch { return null; }
}

// Сохранение с запасным вариантом при переполнении квоты localStorage.
export function saveThumb(id, dataUrl) {
  if (!id || !dataUrl || !String(dataUrl).startsWith('data:image/')) return false;
  try {
    localStorage.setItem(thumbKey(id), dataUrl);
    return true;
  } catch {
    // Квота переполнена: пробуем ещё раз меньше (480→320 уже вызывающий,
    // здесь просто не ломаем редактор и не затираем старое превью).
    return false;
  }
}

export function clearThumb(id) {
  try { localStorage.removeItem(thumbKey(id)); } catch {}
}

export function copyThumb(fromId, toId) {
  const thumb = getThumb(fromId);
  if (thumb && toId && toId !== fromId) saveThumb(toId, thumb);
}

// Уменьшает канвас редактора до JPEG dataURL. Только в браузере.
export function captureCanvasThumb(canvas, maxW = THUMB_MAX_W, quality = THUMB_QUALITY) {
  if (!canvas || !canvas.width || typeof document === 'undefined') return null;
  const w = canvas.width, h = canvas.height;
  const scale = Math.min(1, maxW / w);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const g = out.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#101214';
  g.fillRect(0, 0, out.width, out.height);
  try {
    g.drawImage(canvas, 0, 0, out.width, out.height);
  } catch { return null; } // канвас пуст/ещё не отрисован
  return out.toDataURL('image/jpeg', quality);
}

// Снимает превью с живого канваса редактора (#view canvas) и сохраняет.
export function saveThumbFromCurrentCanvas(projectId) {
  if (!projectId || typeof document === 'undefined') return null;
  const canvas = document.querySelector('#view canvas');
  if (!canvas || !canvas.width) return null;
  let url = captureCanvasThumb(canvas);
  if (!url) return null;
  // При переполнении квоты пробуем вдвое меньше и грубее.
  if (!saveThumb(projectId, url)) {
    url = captureCanvasThumb(canvas, 240, 0.55) || url;
    saveThumb(projectId, url);
  }
  return url;
}

function currentEditorId() {
  const m = location.hash.match(/^#\/project\/(.+)$/);
  return m ? m[1] : null;
}

// Автосохранение превью, пока открыт редактор: последний кадр канваса.
// Триггер — периодический, без правок scene.js/main.js (не мои файлы).
// Интервал 20 с: достаточно свежего превью, без рывков по памяти.
let lastEditorId = null;
let thumbSavedAt = 0;
function autoThumbTick() {
  const pid = currentEditorId();
  if (!pid) return;
  lastEditorId = pid;
  const now = Date.now();
  const editorVisible = document.querySelector('#screen-editor')?.classList.contains('hidden') === false;
  if (editorVisible && now - thumbSavedAt >= 20000) {
    if (saveThumbFromCurrentCanvas(pid)) thumbSavedAt = now;
  }
}
if (typeof window !== 'undefined' && typeof setInterval !== 'undefined' && !window.__mebel3dThumbAuto) {
  window.__mebel3dThumbAuto = true;
  setInterval(autoThumbTick, 5000);
}
// При уходе из редактора на список — сразу сохраняем последний кадр,
// чтобы карточка не показывала устаревшую миниатюру.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window.__mebel3dThumbHash) {
  window.__mebel3dThumbHash = true;
  window.addEventListener('hashchange', () => {
    const pid = currentEditorId();
    if (pid) lastEditorId = pid;
    else if (lastEditorId) {
      saveThumbFromCurrentCanvas(lastEditorId);
      thumbSavedAt = Date.now();
    }
  });
}

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

export async function renderProjects(onOpen) {
  const grid = $('#projects-grid');
  // Перед отрисовкой списка снимаем превью с последнего кадра (если был редактор).
  // Канвас скрыт, но preserveDrawingBuffer:true — кадр всё ещё доступен.
  if (lastEditorId) saveThumbFromCurrentCanvas(lastEditorId);
  const list = await api.list();
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<p class="empty">Проектов пока нет. Нажмите «+ Новый проект».</p>';
    return;
  }
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const thumb = getThumb(p.id);
    const img = document.createElement('img');
    img.className = 'lib-photo thumb-preview';
    img.alt = thumb ? `Превью проекта «${p.name}»` : '';
    img.src = thumb || '';
    img.title = thumb ? p.name : 'Превью пока нет — откройте проект, содержащееся превью сохранится в карточке';
    if (!thumb) img.style.display = 'none';
    card.appendChild(img);
    const body = document.createElement('div');
    body.innerHTML = `
      <h3></h3>
      <div class="meta"></div>
      <div class="actions">
        <button data-act="open" class="primary">Открыть</button>
        <button data-act="dup">Копия</button>
        <button data-act="ren">Переименовать</button>
        <button data-act="del" class="danger">Удалить</button>
      </div>`;
    body.querySelector('h3').textContent = p.name;
    const meta = body.querySelector('.meta');
    meta.textContent = `${p.client ? p.client + ' · ' : ''}${p.items} предм. · `;
    const idSpan = document.createElement('span');
    idSpan.className = 'code';
    idSpan.textContent = 'ID ' + p.id;
    meta.append(idSpan, document.createTextNode(' · ' + fmtDate(p.updated)));
    body.querySelector('[data-act="open"]').onclick = () => onOpen(p.id);
    body.querySelector('[data-act="dup"]').onclick = async () => {
      const copy = await api.duplicate(p.id);
      if (copy && copy.id) copyThumb(p.id, copy.id);
      renderProjects(onOpen);
    };
    body.querySelector('[data-act="ren"]').onclick = async () => {
      const name = await promptDialog('Новое название:', p.name);
      if (name && name.trim()) { await api.rename(p.id, name.trim()); renderProjects(onOpen); }
    };
    body.querySelector('[data-act="del"]').onclick = async () => {
      if (await confirmDialog(`Удалить проект «${p.name}»? Восстановить будет нельзя.`)) {
        await api.remove(p.id);
        clearThumb(p.id); // превью в localStorage тоже удаляем, чтобы не копить мусор
        renderProjects(onOpen);
      }
    };
    card.appendChild(body);
    grid.appendChild(card);
  }
}

export async function createProject(onOpen) {
  const name = await promptDialog('Название проекта:', 'Новый проект');
  if (name === null) return;
  const p = await api.create(name.trim() || 'Новый проект');
  onOpen(p.id);
}
