# -*- coding: utf-8 -*-
"""Библиотека образцов (этап 5, ТЗ п. 7.4): декоры, фурнитура, примеры цеха.

Хранится в data/library/ (папка данных, не код):
  decors.json / handles.json / examples.json + фото <id>.jpg рядом.
Фото приходят base64 из фронтенда; проверяем тип и размер.
"""
from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path

from .projects import _slug

ROOT = Path(__file__).resolve().parent.parent
LIB_DIR = ROOT / "data" / "library"

ALLOWED_MEDIA = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO = 5 * 1024 * 1024  # 5 МБ


def _path(kind: str) -> Path:
    name = {"decors": "decors.json", "handles": "handles.json", "examples": "examples.json"}[kind]
    return LIB_DIR / name


def _photo_dir(kind: str) -> Path:
    return LIB_DIR / kind


def _load(kind: str) -> list[dict]:
    p = _path(kind)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save(kind: str, data: list[dict]) -> None:
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    p = _path(kind)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


def _new_id(kind: str, name: str, existing: list[dict]) -> str:
    base = _slug(name) or kind.rstrip("s")
    ids = {e.get("id") for e in existing}
    pid, n = base, 1
    while pid in ids:
        n += 1
        pid = f"{base}-{n}"
    return pid


def _save_photo(kind: str, entry_id: str, photo_b64: str, media: str) -> None:
    if not photo_b64:
        return
    if media not in ALLOWED_MEDIA:
        raise ValueError("Фото должно быть JPG, PNG или WebP")
    try:
        raw = base64.b64decode(photo_b64, validate=True)
    except Exception:
        raise ValueError("Не удалось прочитать фото")
    if len(raw) > MAX_PHOTO:
        raise ValueError("Фото больше 5 МБ")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[media]
    d = _photo_dir(kind)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{entry_id}.{ext}").write_bytes(raw)


def photo_path(kind: str, entry_id: str) -> Path | None:
    if "/" in entry_id or "\\" in entry_id or entry_id in (".", ".."):
        return None
    d = _photo_dir(kind)
    if not d.exists():
        return None
    for ext in ("jpg", "png", "webp"):
        p = d / f"{entry_id}.{ext}"
        if p.exists():
            return p
    return None


def list_kind(kind: str) -> list[dict]:
    return _load(kind)


def add_decor(name: str, color: str, photo_b64: str = "", media: str = "") -> dict:
    if not name or not name.strip():
        raise ValueError("Укажите название декора")
    if not color or not color.startswith("#"):
        raise ValueError("Укажите цвет (например, #CFAE82)")
    items = _load("decors")
    entry = {"id": _new_id("decors", name.strip(), items), "name": name.strip(),
             "hex": color.strip(), "hasPhoto": bool(photo_b64), "created": time.time()}
    _save_photo("decors", entry["id"], photo_b64, media)
    items.append(entry)
    _save("decors", items)
    return entry


def add_handle(name: str, description: str = "", photo_b64: str = "", media: str = "", length: int = 160) -> dict:
    if not name or not name.strip():
        raise ValueError("Укажите название ручки")
    items = _load("handles")
    entry = {"id": _new_id("handles", name.strip(), items), "name": name.strip(),
             "description": (description or "").strip(), "length": int(length or 160),
             "hasPhoto": bool(photo_b64), "created": time.time()}
    _save_photo("handles", entry["id"], photo_b64, media)
    items.append(entry)
    _save("handles", items)
    return entry


def add_example(title: str, notes: str = "", photo_b64: str = "", media: str = "") -> dict:
    if not title or not title.strip():
        raise ValueError("Укажите название примера")
    items = _load("examples")
    entry = {"id": _new_id("examples", title.strip(), items), "title": title.strip(),
             "notes": (notes or "").strip(), "hasPhoto": bool(photo_b64), "created": time.time()}
    _save_photo("examples", entry["id"], photo_b64, media)
    items.append(entry)
    _save("examples", items)
    return entry


def delete(kind: str, entry_id: str) -> None:
    items = [e for e in _load(kind) if e.get("id") != entry_id]
    _save(kind, items)
    p = photo_path(kind, entry_id)
    if p:
        try:
            p.unlink()
        except OSError:
            pass
