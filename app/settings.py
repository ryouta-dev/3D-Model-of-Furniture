# -*- coding: utf-8 -*-
"""Настройки ИИ (провайдер, endpoint, ключ, модель) — только локально.

Хранятся в data/settings.json (папка данных, не код).
API-ключ наружу не отдаётся: GET возвращает только hasKey и подсказку
последних символов. В логи и экспорт ключ никогда не попадает.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SETTINGS_PATH = DATA_DIR / "settings.json"

DEFAULTS = {
    "provider": "openai_compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "",
    "apiKey": "",
}


def load() -> dict:
    if not SETTINGS_PATH.exists():
        return dict(DEFAULTS)
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return dict(DEFAULTS)
    return {**DEFAULTS, **(data if isinstance(data, dict) else {})}


def save(data: dict) -> dict:
    merged = {**DEFAULTS, **(data if isinstance(data, dict) else {})}
    DATA_DIR.mkdir(exist_ok=True)
    tmp = SETTINGS_PATH.with_name(SETTINGS_PATH.name + ".tmp")
    tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, SETTINGS_PATH)
    return merged


def public(data: dict | None = None) -> dict:
    """Безопасная версия для фронтенда — без ключа."""
    d = data if data is not None else load()
    key = d.get("apiKey") or ""
    return {
        "provider": d.get("provider", "openai_compatible"),
        "baseUrl": d.get("baseUrl", ""),
        "model": d.get("model", ""),
        "hasKey": bool(key),
        "keyHint": ("••••" + key[-4:]) if len(key) >= 4 else ("••••" if key else ""),
    }
