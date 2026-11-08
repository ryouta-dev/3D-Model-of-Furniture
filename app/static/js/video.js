// Видео (Этап 7): запись канваса 3D в WebM с облетаом камеры.
// Пишем canvas.captureStream + MediaRecorder, скачиваем .webm.
// Облет переиспользует режим презентации сцены (scene.setPresent).
// Для публикации — только инструкция Netlify/Cloudflare в UI.
// API-публикация и ключи хостинга — отдельная версия, здесь не закладываются.

import { getCanvas, setPresent, fitView } from './scene.js';
import * as editor from './editor.js';

const $ = (s) => document.querySelector(s);

let recorder = null;
let chunks = [];
let timer = null;
let countdownTimer = null;
let recording = false;
let finishPromise = null;

function setStatus(text) {
  const el = $('#video-status');
  if (el) el.textContent = text;
}

function setButtonsBusy(busy) {
  const start = $('#btn-video-start');
  const stop = $('#btn-video-stop');
  const toolbar = $('#btn-video');
  if (start) start.disabled = busy;
  if (stop) stop.disabled = !busy;
  if (toolbar) {
    toolbar.disabled = busy;
    toolbar.textContent = busy ? '■ Идёт запись…' : '▶ Запись видео';
  }
}

function projectFileName() {
  const p = editor && editor.getProject ? editor.getProject() : null;
  return (p ? p.id : 'mebel3d') + '-video.webm';
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // isTypeSupported недоступен — попробуем дефолт
    }
  }
  return '';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function startCountdown(totalSec) {
  const startedAt = performance.now();
  const statusStart = `Идёт запись, осталось ~${totalSec} сек. Не трогайте модель.`;
  setStatus(statusStart);
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const left = Math.max(0, Math.ceil(totalSec - elapsed));
    setStatus(`Идёт запись, осталось ~${left} сек. Не трогайте модель.`);
    if (left <= 0) clearInterval(countdownTimer);
  }, 500);
}

function cleanup() {
  recording = false;
  clearTimeout(timer);
  clearInterval(countdownTimer);
  setButtonsBusy(false);
  setPresent(false);
  recorder = null;
}

export async function startVideoRecording() {
  if (recording) return;
  const p = editor && editor.getProject ? editor.getProject() : null;
  if (!p || !p.items || !p.items.length) {
    setStatus('Добавьте мебель в проект — записывать пока нечего.');
    return;
  }
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    setStatus('Этот браузер не поддерживает запись видео (нужен Chromium/Chrome).');
    return;
  }
  let canvas = null;
  try {
    canvas = getCanvas();
  } catch {
    canvas = document.querySelector('#view canvas');
  }
  if (!canvas || !canvas.captureStream) {
    setStatus('Не удалось получить канвас 3D. Откройте редактор и попробуйте снова.');
    return;
  }
  let stream = null;
  try {
    try {
      stream = canvas.captureStream(30);
    } catch {
      stream = canvas.captureStream();
    }
  } catch {
    setStatus('Не удалось начать захват канваса. Обновите страницу и попробуйте снова.');
    return;
  }
  const mimeType = pickMimeType();
  let rec = null;
  try {
    rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
  } catch (e) {
    try {
      rec = new MediaRecorder(stream);
    } catch {
      setStatus('Не удалось создать запись видео в этом браузере.');
      return;
    }
  }

  const durationEl = $('#video-duration');
  const totalSec = Math.min(60, Math.max(3, Number(durationEl?.value) || 8));

  chunks = [];
  recorder = rec;
  recording = true;
  setButtonsBusy(true);

  finishPromise = new Promise((resolve) => {
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      if (blob && blob.size) {
        downloadBlob(blob, projectFileName());
        setStatus(`Видео готово (${Math.round(blob.size / 1024 / 1024 * 10) / 10} МБ), файл скачался.`);
      } else {
        setStatus('Видео получилось пустым — попробуйте ещё раз и не трогайте модель во время записи.');
      }
      cleanup();
      resolve(blob);
    };
    rec.onerror = () => {
      setStatus('Запись прервалась. Попробуйте ещё раз.');
      cleanup();
      resolve(null);
    };
  });

  // Включаем облет презентации и стартуем запись.
  try {
    fitView();
  } catch {}
  setPresent(true);
  rec.start(500);
  startCountdown(totalSec);
  timer = setTimeout(() => { stopVideoRecording(); }, totalSec * 1000);
}

export async function stopVideoRecording() {
  if (!recording || !recorder) return;
  clearTimeout(timer);
  clearInterval(countdownTimer);
  setStatus('Заканчиваю видео…');
  try {
    if (recorder.state !== 'inactive') recorder.stop();
  } catch {
    cleanup();
  }
}

function initVideo() {
  const toolbar = $('#btn-video');
  const start = $('#btn-video-start');
  const stop = $('#btn-video-stop');
  if (stop) stop.disabled = true;
  if (toolbar) {
    toolbar.addEventListener('click', () => {
      if (recording) stopVideoRecording();
      else startVideoRecording();
    });
  }
  if (start) {
    start.addEventListener('click', () => {
      if (!recording) startVideoRecording();
    });
  }
  if (stop) {
    stop.addEventListener('click', () => { stopVideoRecording(); });
  }
  // Если пользователь вручную остановил презентацию (клик по модели),
  // запись продолжает идти со статичным видом — так и задумано,
  // подсказка просит во время записи не трогать модель.
}

initVideo();
