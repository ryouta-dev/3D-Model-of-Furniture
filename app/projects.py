# -*- coding: utf-8 -*-
"""Хранение проектов в папке data/ — по папке на проект, внутри project.json.

Папка data/ лежит рядом с кодом, но не внутри него: код можно обновлять,
не трогая проекты (ТЗ п. 10).
"""
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

from .schema import validate_project

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# Кириллица → латиница для понятных id файлов (2026-11-07-kuhnya-dlya-aygul)
_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _write_json(path: Path, data: dict) -> None:
    # Запись через временный файл + replace: при крахе середины файл не оборвётся.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _slug(name: str) -> str:
    out = "".join(_TRANSLIT.get(ch, ch) for ch in name.lower())
    out = "".join(ch if ch.isalnum() else "-" for ch in out)
    return "-".join(part for part in out.split("-") if part)[:40]


def _dir(pid: str) -> Path:
    # id — это имя папки, запрещаем выход за data/
    if not pid or "/" in pid or "\\" in pid or pid in (".", ".."):
        raise ValueError("Недопустимый id проекта")
    return DATA_DIR / pid


def _new_id(name: str) -> str:
    base = f"{time.strftime('%Y-%m-%d')}-{_slug(name) or 'project'}"
    pid, n = base, 1
    while (DATA_DIR / pid).exists():
        n += 1
        pid = f"{base}-{n}"
    return pid


def _empty_project(pid: str, name: str, client: str) -> dict:
    return {
        "version": 1,
        "id": pid,
        "name": name,
        "client": client,
        "notes": "",
        "room": None,
        "items": [],
        "price": {"total": None, "currency": "KZT", "lines": []},
    }


def list_projects() -> list[dict]:
    if not DATA_DIR.exists():
        return []
    out = []
    for pj in sorted(DATA_DIR.glob("*/project.json")):
        try:
            data = json.loads(pj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue  # битый файл не должен ломать весь список
        out.append({
            "id": data.get("id", pj.parent.name),
            "name": data.get("name", "Без названия"),
            "client": data.get("client", ""),
            "updated": pj.stat().st_mtime,
            "items": len(data.get("items", [])),
        })
    out.sort(key=lambda p: p["updated"], reverse=True)
    return out


def create(name: str, client: str = "") -> dict:
    DATA_DIR.mkdir(exist_ok=True)
    pid = _new_id(name.strip() or "Новый проект")
    data = _empty_project(pid, name.strip() or "Новый проект", client.strip())
    # Новый проект пуст — валидация «хотя бы один предмет» тут не нужна
    _write_json(_dir(pid) / "project.json", data)
    return data


def load(pid: str) -> dict:
    path = _dir(pid) / "project.json"
    return json.loads(path.read_text(encoding="utf-8"))


def save(pid: str, data: dict) -> None:
    errors = validate_project(data)
    if errors:
        raise ValueError(errors)
    data["id"] = pid  # id проекта = имя папки, не даём разъехаться
    _write_json(_dir(pid) / "project.json", data)


def duplicate(pid: str) -> dict:
    src = load(pid)
    name = f"{src.get('name', 'Проект')} (копия)"
    new_pid = _new_id(name)
    data = dict(src)
    data["id"] = new_pid
    data["name"] = name
    # Копия сохраняет исходник как есть, в том числе пустой проект —
    # валидация save() тут не нужна (см. create()).
    _write_json(_dir(new_pid) / "project.json", data)
    return data


def delete(pid: str) -> None:
    shutil.rmtree(_dir(pid))


def rename(pid: str, name: str) -> dict:
    data = load(pid)
    data["name"] = name.strip() or data["name"]
    # Переименование не трогает items, поэтому пустой проект тоже
    # переименовывается — без валидации «хотя бы один предмет».
    _write_json(_dir(pid) / "project.json", data)
    return data


def export_path(pid: str) -> Path:
    return _dir(pid) / "exports" / f"{pid}-client.html"


def write_export(pid: str, html: str) -> Path:
    path = export_path(pid)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(html, encoding="utf-8")
    os.replace(tmp, path)
    return path
