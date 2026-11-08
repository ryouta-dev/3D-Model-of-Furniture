// Общие диалоги и тост вместо нативных prompt/confirm/alert.
// Нативные диалоги ломают фокус и не объясняют последствия — свои на <dialog>.
const $ = (s) => document.querySelector(s);

let toastTimer = null;
export function toast(text, ms = 3600) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function runDialog({ title, text = '', label = '', value = '', okText = 'ОК', needInput = false }) {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    if (!dlg || typeof dlg.showModal !== 'function') {
      // Запасной вариант, если <dialog> недоступен.
      resolve(needInput ? null : false);
      return;
    }
    $('#dlg-title').textContent = title;
    $('#dlg-text').textContent = text;
    $('#dlg-text').classList.toggle('hidden', !text);
    const lab = $('#dlg-label'), inp = $('#dlg-input'), ok = $('#dlg-ok'), cancel = $('#dlg-cancel');
    lab.textContent = label;
    lab.classList.toggle('hidden', !needInput);
    inp.classList.toggle('hidden', !needInput);
    inp.value = value;
    ok.textContent = okText;
    const done = (result) => {
      dlg.removeEventListener('close', onClose);
      resolve(result);
    };
    const onClose = () => {
      // close без submit = Отмена/Esc.
      done(needInput ? null : false);
    };
    $('#dlg-form').onsubmit = (e) => {
      e.preventDefault();
      const result = needInput ? inp.value : true;
      // preventDefault может уже закрыть диалог (method=dialog) — закрываем, если открыт.
      try { if (dlg.open) dlg.close(); } catch {}
      dlg.removeEventListener('close', onClose);
      resolve(result);
    };
    cancel.onclick = () => dlg.close();
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    if (needInput) { inp.focus(); inp.select(); }
    else ok.focus();
  });
}

export function confirmDialog(message, okText = 'Удалить') {
  return runDialog({ title: 'Подтвердите действие', text: message, okText });
}

export function promptDialog(label, value = '') {
  return runDialog({ title: label, label, value, okText: 'Сохранить', needInput: true });
}
