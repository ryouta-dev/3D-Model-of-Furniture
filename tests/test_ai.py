# -*- coding: utf-8 -*-
"""Тесты ИИ-модуля (этап 4): разбор JSON, повтор при битой валидации, настройки."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ai, settings  # noqa: E402
from app.schema import validate_project  # noqa: E402

ITEM = {
    "id": "i1", "type": "kitchen_base",
    "position": {"x": 0, "z": 0}, "rotationY": 0,
    "w": 600, "h": 720, "d": 560, "t": 16, "plinth": 100,
    "modules": 3, "shelves": 1, "front": "door1", "drawers": 3,
    "top": True, "lift": 0,
    "corpus": "white", "facade": "sonoma", "handle": "bar160",
}
GOOD = {"version": 1, "id": "ai1", "name": "Кухня", "items": [ITEM]}
CURRENT = {"version": 1, "id": "p1", "name": "Старый", "items": [ITEM]}


def test_extract_json_plain_and_fenced():
    assert ai.extract_json('{"a": 1}') == {"a": 1}
    assert ai.extract_json('Вот проект:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert ai.extract_json('текст {"a": 1} хвост') == {"a": 1}
    with pytest.raises(ai.AiError):
        ai.extract_json("нет json")


def test_generate_validates_and_returns(monkeypatch):
    monkeypatch.setattr(ai._call_provider, "__self__", None) if False else None
    import json as _json
    monkeypatch.setattr(ai, "_call_provider", lambda s, m: _json.dumps(GOOD))
    out = ai.generate("кухня 3 метра", CURRENT, "generate")
    assert out["projects"] == [GOOD]
    assert out["attempts"] == 1


def test_generate_retries_once_then_fails(monkeypatch):
    import json as _json
    calls = []
    def fake(settings, messages):
        calls.append(1)
        return _json.dumps({"version": 1, "id": "x", "name": "X", "items": []})  # пустые items
    monkeypatch.setattr(ai, "_call_provider", fake)
    with pytest.raises(ai.AiError) as e:
        ai.generate("кухня", CURRENT, "generate")
    assert len(calls) == 2  # один повтор по ТЗ
    assert "items" in str(e.value)


def test_generate_questions_not_invented(monkeypatch):
    import json as _json
    monkeypatch.setattr(ai, "_call_provider", lambda s, m: _json.dumps({"questions": ["Какая глубина?"]}))
    out = ai.generate("кухня", CURRENT, "generate")
    assert out["questions"] == ["Какая глубина?"]
    assert out["projects"] == []


def test_empty_questions_is_not_questions():
    # Пустой questions + items => это проект, а не вопросы (баг с пустым списком).
    projects, questions = ai._as_project_list({"questions": [], "items": [ITEM], "version": 1, "id": "x", "name": "X"})
    assert questions is None
    assert len(projects) == 1
    # Обёртки projects/project
    p2, _ = ai._as_project_list({"projects": [GOOD]})
    assert p2 == [GOOD]
    p3, _ = ai._as_project_list({"project": GOOD})
    assert p3 == [GOOD]


def test_corner_prompt_gives_clear_questions():
    out = ai.generate("угловая кухня буквой Г вдоль задней и левой стены", CURRENT, "generate")
    assert out["projects"] == []
    assert any("этап 6" in q for q in out["questions"])


def test_compact_corner_schema_gives_clear_error(monkeypatch):
    import json as _json
    compact = {"assumptions": ["x"], "questions": [], "room": {"width": 3600, "depth": 3000, "height": 2700},
               "items": [{"id": "b1", "row": "base", "wall": "back", "start": 0, "w": 800,
                          "purpose": "sink", "front": "doors2", "shelves": 1}],
               "common": {"t": 16}}
    monkeypatch.setattr(ai, "_call_provider", lambda s, m: _json.dumps(compact))
    with pytest.raises(ai.AiError) as e:
        ai.generate("кухня", CURRENT, "generate")
    assert "компактную схему" in str(e.value)
    assert "этап 6" in str(e.value)


def test_settings_masking(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SETTINGS_PATH", tmp_path / "settings.json")
    settings.save({"baseUrl": "https://example.com/v1", "model": "m1", "apiKey": "sk-secret-1234"})
    pub = settings.public()
    assert pub["hasKey"] is True and pub["keyHint"] == "••••1234"
    assert "sk-secret" not in str(pub)
    # Пустой ключ через API не затирает сохранённый (см. api_settings_put).
    assert settings.load()["apiKey"] == "sk-secret-1234"


def test_log_has_no_key(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "LOG_PATH", tmp_path / "ai_logs.jsonl")
    monkeypatch.setattr(settings, "SETTINGS_PATH", tmp_path / "settings.json")
    settings.save({"baseUrl": "https://x/v1", "model": "m", "apiKey": "sk-topsecret"})
    import json as _json
    monkeypatch.setattr(ai, "_call_provider", lambda s, m: _json.dumps(GOOD))
    ai.generate("кухня", CURRENT, "generate")
    log = (tmp_path / "ai_logs.jsonl").read_text(encoding="utf-8")
    assert "sk-topsecret" not in log
    assert "кухня" in log
