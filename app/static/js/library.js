// Библиотека образцов (этап 5): декоры, ручки, примеры цеха.
// Фото приходят base64, превью отдаёт бэкенд /api/library/<kind>/<id>/photo.
import { confirmDialog, promptDialog, toast } from './ui.js';

const $ = (s) => document.querySelector(s);

let tab = 'decors';

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error('Ошибка');
  return res.json();
}

function photoInput() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/webp';
  return inp;
}

async function readPhoto(file) {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { photoBase64: btoa(bin), mediaType: file.type };
}

export async function renderLibrary() {
  const grid = $('#library-grid');
  const tabs = document.querySelectorAll('[data-lib-tab]');
  for (const t of tabs) {
    t.classList.toggle('primary', t.dataset.libTab === tab);
    t.setAttribute('aria-pressed', t.dataset.libTab === tab ? 'true' : 'false');
  }
  const list = await api(`/api/library/${tab}`);
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<p class="empty">Пока пусто. Добавьте первый образец ниже.</p>';
  }
  for (const e of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('h3');
    title.textContent = e.name || e.title;
    card.appendChild(title);
    if (e.hex) {
      const sw = document.createElement('div');
      sw.className = 'sw-color';
      sw.style.cssText = 'height:26px;border-radius:5px;border:1px solid var(--line);margin:6px 0';
      sw.style.background = e.hex;
      card.appendChild(sw);
    }
    if (e.hasPhoto) {
      const img = document.createElement('img');
      img.src = `/api/library/${tab}/${e.id}/photo`;
      img.alt = title.textContent;
      img.className = 'lib-photo';
      card.appendChild(img);
    }
    if (e.description || e.notes) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = e.description || e.notes;
      card.appendChild(p);
    }
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Удалить';
    del.onclick = async () => {
      if (await confirmDialog(`Удалить «${title.textContent}»?`)) {
        await api(`/api/library/${tab}/${e.id}`, { method: 'DELETE' });
        renderLibrary();
      }
    };
    card.appendChild(del);
    grid.appendChild(card);
  }
}

export function initLibrary(open) {
  document.querySelectorAll('[data-lib-tab]').forEach((b) => {
    b.onclick = () => { tab = b.dataset.libTab; renderLibrary(); };
  });
  const addBtn = $('#btn-lib-add');
  if (addBtn) addBtn.onclick = async () => {
    const name = await promptDialog(tab === 'examples' ? 'Название примера:' : 'Название:');
    if (!name) return;
    let photo = { photoBase64: '', mediaType: '' };
    if (await confirmDialog('Добавить фото? Отмена — только текст.', 'Добавить фото')) {
      const f = photoInput();
      await new Promise((res) => { f.onchange = res; f.click(); });
      if (!f.files[0]) { toast('Фото не выбрано — образец не добавлен'); return; }
      photo = await readPhoto(f.files[0]);
    }
    try {
      if (tab === 'decors') {
        const hex = (await promptDialog('Цвет, например #CFAE82:', '#CFAE82')) || '#CFAE82';
        await api('/api/library/decors', { method: 'POST', body: JSON.stringify({ name, hex, ...photo }) });
      } else if (tab === 'handles') {
        const desc = (await promptDialog('Описание (форма, размер, цвет):', '')) || '';
        await api('/api/library/handles', { method: 'POST', body: JSON.stringify({ name, description: desc, ...photo }) });
      } else {
        const notes = (await promptDialog('Заметки (размеры, стиль):', '')) || '';
        await api('/api/library/examples', { method: 'POST', body: JSON.stringify({ title: name, notes, ...photo }) });
      }
      renderLibrary();
      if (open) open();
    } catch {
      toast('Не удалось добавить образец');
    }
  };
}
