// Точка входа: маршрутизация между экраном проектов и редактором.
import { initScene, fitView, setOpen, setTheme, getTheme, setDayNight, getDayNight, setPresent, takeScreenshot } from './scene.js';
import * as editor from './editor.js';
import * as ai from './ai.js';
import { renderLibrary, initLibrary } from './library.js';
import { renderProjects, createProject } from './projects.js';
import { toast } from './ui.js';

const $ = (s) => document.querySelector(s);

function show(screen) {
  $('#screen-projects').classList.toggle('hidden', screen !== 'projects');
  $('#screen-editor').classList.toggle('hidden', screen !== 'editor');
  $('#screen-library').classList.toggle('hidden', screen !== 'library');
  $('#btn-back').classList.toggle('hidden', screen !== 'editor');
  $('#proj-name').classList.toggle('hidden', screen !== 'editor');
  $('#proj-no').classList.toggle('hidden', screen !== 'editor');
  $('#save-status').classList.toggle('hidden', screen !== 'editor');
  $('#btn-undo').classList.toggle('hidden', screen !== 'editor');
  $('#btn-redo').classList.toggle('hidden', screen !== 'editor');
}

function openEditor(pid) {
  location.hash = '#/project/' + pid;
}

async function enterEditor(pid) {
  show('editor');
  try {
    await editor.load(pid);
  } catch {
    location.hash = '#/';
    return;
  }
  $('#proj-name').value = editor.getProject().name;
  $('#proj-no').textContent = 'ID ' + editor.getProject().id;
  fitView();
}

async function enterProjects() {
  show('projects');
  await renderProjects(openEditor);
}

async function enterLibrary() {
  show('library');
  await renderLibrary();
}

function route() {
  if (location.hash.startsWith('#/library')) { enterLibrary(); return; }
  const m = location.hash.match(/^#\/project\/(.+)$/);
  if (m) enterEditor(m[1]);
  else enterProjects();
}

// --- Тема ---
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  setTheme(t);
  localStorage.setItem('mebel3d-theme', t);
  const btn = $('#btn-theme');
  btn.textContent = t === 'dark' ? 'Тема: тёмная' : 'Тема: светлая';
  btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
}
$('#btn-theme').onclick = () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
$('#btn-undo').onclick = () => editor.undo();
$('#btn-redo').onclick = () => editor.redo();

// --- Панели редактора ---
for (const btn of document.querySelectorAll('#add-row button')) {
  btn.onclick = () => editor.addItem(btn.dataset.add);
}
$('#btn-back').onclick = () => { location.hash = '#/'; };
$('#btn-library').onclick = () => { location.hash = '#/library'; };
$('#btn-new').onclick = () => createProject(openEditor);
$('#btn-open').onclick = (e) => {
  const opening = e.target.dataset.open !== '1';
  e.target.dataset.open = opening ? '1' : '';
  e.target.textContent = opening ? 'Закрыть двери' : 'Открыть двери';
  e.target.setAttribute('aria-pressed', opening ? 'true' : 'false');
  setOpen(opening);
};
$('#btn-fit').onclick = () => fitView();
$('#btn-day').onclick = (e) => {
  const night = getDayNight() !== 'night';
  setDayNight(night ? 'night' : 'day');
  e.target.textContent = night ? 'День' : 'Ночь';
  e.target.setAttribute('aria-pressed', night ? 'true' : 'false');
};
$('#btn-present').onclick = (e) => {
  const on = e.target.dataset.present !== '1';
  e.target.dataset.present = on ? '1' : '';
  e.target.textContent = on ? 'Стоп' : 'Презентация';
  e.target.setAttribute('aria-pressed', on ? 'true' : 'false');
  setPresent(on);
};
$('#btn-shot').onclick = async () => {
  const p = editor.getProject();
  const name = (p ? p.id : 'mebel3d') + '-screenshot';
  try {
    await takeScreenshot(name);
  } catch {
    toast('Не удалось сделать скриншот — браузер заблокировал скачивание');
  }
};
$('#proj-name').onchange = () => {
  editor.setProjectName($('#proj-name').value.trim() || 'Без названия');
  $('#proj-name').value = editor.getProject().name;
};
document.addEventListener('scene:rebuild', () => {
  const p = editor.getProject();
  if (p) initScene(p.items, editor.getSelected(), p.room);
});
document.addEventListener('scene:select', (e) => editor.select(e.detail));
document.addEventListener('scene:move', (e) => {
  const { id, x, z } = e.detail;
  editor.moveItem(id, x, z);
});
document.addEventListener('scene:present', () => {
  const btn = $('#btn-present');
  if (btn) { btn.dataset.present = ''; btn.textContent = 'Презентация'; btn.setAttribute('aria-pressed', 'false'); }
});

// --- Экспорт для клиента (этап 3) ---
window.addEventListener('export:build', async (e) => {
  const p = editor.getProject();
  if (!p) return;
  const password = e.detail?.password || '';
  const status = $('#save-status');
  status.textContent = 'Собираю HTML…';
  try {
    // Сначала сохраняем проект (цена и настройки экспорта).
    await fetch(`/api/projects/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p)
    });
    const res = await fetch(`/api/projects/${p.id}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password || undefined })
    });
    if (!res.ok) {
      let msg = 'Не удалось собрать HTML';
      try { msg = (await res.json()).detail || msg; } catch {}
      status.textContent = msg;
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.id}-client.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const help = $('#export-help');
    if (help) help.classList.remove('hidden');
    status.textContent = 'HTML готов, файл скачался';
  } catch {
    status.textContent = 'Нет связи с сервером';
  }
});

// Отмена/возврат. В полях ввода Ctrl+Z — обычная отмена текста, не проекта.
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
  if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
    e.preventDefault();
    editor.redo();
  }
});

// Старт
applyTheme(localStorage.getItem('mebel3d-theme') ||
  (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
ai.init();
initLibrary(enterLibrary);
window.addEventListener('hashchange', route);
route();
