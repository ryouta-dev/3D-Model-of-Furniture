// ИИ-чат и настройки ИИ (этап 4). Вызывает бэкенд /api/ai/generate.
// ИИ предлагает проекты, оператор подтверждает — откат кнопкой ↶ сверху.
import * as editor from './editor.js';
import { confirmDialog } from './ui.js';
// Этап 4 шаг 2: прикрепление фото (vision) — input file multiple, base64 в images:[{data,media_type}].
const $ = (s) => document.querySelector(s);

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 МБ
const MAX_IMAGES = 4;

let variants = [];
let selectedImages = []; // [{data (base64 без префикса), media_type, name}]

function status(text) {
  const el = $('#ai-status');
  if (el) el.textContent = text;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(new Error('Не удалось прочитать фото'));
    r.readAsDataURL(file);
  });
}

function renderPhotoList() {
  const box = $('#ai-photos');
  if (!box) return;
  box.innerHTML = '';
  selectedImages.forEach((im, idx) => {
    const row = document.createElement('div');
    row.className = 'ai-photo-row';
    const label = document.createElement('span');
    label.textContent = `${im.name || 'фото'} · ${im.media_type}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Убрать';
    btn.onclick = () => {
      selectedImages.splice(idx, 1);
      renderPhotoList();
      status(selectedImages.length ? `Фото прикреплено: ${selectedImages.length}` : 'Фото убраны');
    };
    row.append(label, btn);
    box.appendChild(row);
  });
}

function ensurePhotoInput() {
  let input = $('#ai-photos-input');
  if (input) return input;
  const prompt = $('#ai-prompt');
  if (!prompt || !prompt.parentElement) return null;
  const wrap = document.createElement('div');
  wrap.innerHTML =
    '<label for="ai-photos-input">Фото комнаты или образца (JPG, PNG, WebP до 5 МБ, до ' +
    MAX_IMAGES + ') </label>' +
    '<input id="ai-photos-input" type="file" accept="image/jpeg,image/png,image/webp" multiple>' +
    '<div id="ai-photos"></div>';
  prompt.after(wrap);
  input = $('#ai-photos-input');
  if (input) {
    input.onchange = async () => {
      const files = [...(input.files || [])];
      for (const f of files) {
        if (selectedImages.length >= MAX_IMAGES) {
          status('Не больше ' + MAX_IMAGES + ' фото');
          break;
        }
        if (!ALLOWED_TYPES.includes(f.type)) {
          status('Фото должно быть JPG, PNG или WebP: ' + f.name);
          continue;
        }
        if (f.size > MAX_BYTES) {
          status('Фото больше 5 МБ: ' + f.name);
          continue;
        }
        try {
          const data = await fileToBase64(f);
          selectedImages.push({ data, media_type: f.type, name: f.name });
          status('Фото прикреплено: ' + selectedImages.length);
        } catch {
          status('Не удалось прочитать файл: ' + f.name);
        }
      }
      input.value = '';
      renderPhotoList();
    };
  }
  return input;
}

async function runAi(mode) {
  const promptEl = $('#ai-prompt');
  const prompt = promptEl ? promptEl.value.trim() : '';
  if (!prompt) { status('Введите описание или правку'); return; }
  const p = editor.getProject();
  if (!p) return;
  status('Думаю… это может занять до минуты');
  try {
    const images = selectedImages.map(({ data, media_type }) => ({ data, media_type }));
    const res = await fetch('/api/ai/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: p.id, prompt, mode, images })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status('Ошибка: ' + (data.detail || res.status));
      return;
    }
    if (data.questions && data.questions.length) {
      status('Уточните: ' + data.questions.join(' '));
      return;
    }
    variants = data.projects || [];
    renderVariants();
    status(variants.length ? `Готово вариантов: ${variants.length}. Выберите «Применить».` : 'ИИ ничего не вернул');
  } catch {
    status('Нет связи с сервером');
  }
}

function summarize(p) {
  const items = (p.items || []).map((it) => `${it.w}×${it.h}×${it.d}`).join(', ');
  return `${p.name || 'Без названия'} — предметов: ${(p.items || []).length}${items ? ' · ' + items : ''}`;
}

function renderVariants() {
  const box = $('#ai-variants');
  if (!box) return;
  box.innerHTML = '';
  variants.forEach((cand, i) => {
    const card = document.createElement('div');
    card.className = 'ai-card';
    const h = document.createElement('div');
    h.textContent = `Вариант ${i + 1}: ${summarize(cand)}`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Применить';
    btn.onclick = async () => {
      if (await confirmDialog(`Применить вариант ${i + 1}? Текущий проект будет заменён. Откат — кнопка ↶ сверху или Ctrl+Z.`, 'Применить')) {
        editor.applyAiProject(cand);
        status(`Применён вариант ${i + 1}. Откат — кнопка ↶ сверху или Ctrl+Z.`);
      }
    };
    card.append(h, btn);
    box.appendChild(card);
  });
}

// --- Настройки ---
export async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    const base = $('#ai-baseurl'), model = $('#ai-model'), key = $('#ai-key'), test = $('#ai-test');
    if (base) base.value = s.baseUrl || '';
    if (model) model.value = s.model || '';
    if (key) { key.value = ''; key.placeholder = s.hasKey ? `Ключ сохранён (${s.keyHint})` : 'Вставьте API-ключ'; }
    if (test) test.textContent = s.hasKey ? 'Проверить' : 'Сохраните ключ';
  } catch {}
}

export async function saveSettings() {
  const base = $('#ai-baseurl'), model = $('#ai-model'), key = $('#ai-key');
  const body = { baseUrl: base.value.trim(), model: model.value.trim() };
  if (key.value.trim()) body.apiKey = key.value.trim();
  const res = await fetch('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const s = await res.json();
  status(s.hasKey ? 'Настройки сохранены' : 'Настройки сохранены, но ключ не задан');
  await loadSettings();
}

export async function testSettings() {
  status('Проверяю подключение…');
  try {
    const res = await fetch('/api/settings/test', { method: 'POST' });
    const d = await res.json();
    status(d.ok ? `Соединение работает (ответ: ${d.answer || 'ok'})` : 'Ошибка: ' + (d.error || 'неизвестно'));
  } catch {
    status('Нет связи с сервером');
  }
}

export function init() {
  ensurePhotoInput();
  const bGen = $('#btn-ai-generate'), bVar = $('#btn-ai-variants'), bEdit = $('#btn-ai-edit');
  if (bGen) bGen.onclick = () => runAi('generate');
  if (bVar) bVar.onclick = () => runAi('variants');
  if (bEdit) bEdit.onclick = () => runAi('edit');
  const bSave = $('#btn-ai-save'), bTest = $('#btn-ai-test');
  if (bSave) bSave.onclick = saveSettings;
  if (bTest) bTest.onclick = testSettings;
  loadSettings();
}
