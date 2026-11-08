# -*- coding: utf-8 -*-
"""Тесты ИИ-фото (этап 4 шаг 2): валидация картинок, vision-формат, лог без base64."""
import base64
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ai, settings  # noqa: E402

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

SMALL_PNG = base64.b64encode(b"\x89PNG fake-image-bytes").decode("ascii")
SMALL_JPEG = base64.b64encode(b"\xff\xd8\xff fake-jpeg").decode("ascii")
SMALL_WEBP = base64.b64encode(b"RIFF....WEBP fake-webp").decode("ascii")


def test_validate_images_ok():
    cleaned = ai.validate_images([
        {"data": SMALL_PNG, "media_type": "image/png"},
        {"data": SMALL_JPEG, "media_type": "image/jpeg"},
        {"data": SMALL_WEBP, "media_type": "image/webp"},
    ])
    assert len(cleaned) == 3
    assert cleaned[0]["media_type"] == "image/png"
    assert cleaned[0]["data"] == SMALL_PNG


def test_validate_images_rejects_bad_type():
    with pytest.raises(ai.AiError, match="JPG, PNG или WebP"):
        ai.validate_images([{"data": SMALL_PNG, "media_type": "image/gif"}])


def test_validate_images_rejects_too_big(tmp_path):
    big = base64.b64encode(b"x" * (5 * 1024 * 1024 + 1)).decode("ascii")
    with pytest.raises(ai.AiError, match="5 МБ"):
        ai.validate_images([{"data": big, "media_type": "image/jpeg"}])


def test_validate_images_rejects_bad_base64():
    with pytest.raises(ai.AiError, match="прочитать"):
        ai.validate_images([{"data": "%%%not-base64%%%", "media_type": "image/png"}])


def test_validate_images_rejects_too_many():
    imgs = [{"data": SMALL_PNG, "media_type": "image/png"} for _ in range(ai.MAX_IMAGES + 1)]
    with pytest.raises(ai.AiError, match="Слишком много"):
        ai.validate_images(imgs)


def test_validate_images_none_and_empty():
    assert ai.validate_images(None) == []
    assert ai.validate_images([]) == []


def test_build_user_content_vision_format():
    text = ai.build_user_content("сделай кухню", [{"data": SMALL_PNG, "media_type": "image/png"}])
    assert isinstance(text, list)
    assert text[0] == {"type": "text", "text": "сделай кухню"}
    assert text[1] == {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{SMALL_PNG}"}}


def test_build_user_content_without_images_is_string():
    assert ai.build_user_content("текст", None) == "текст"
    assert ai.build_user_content("текст", []) == "текст"


def test_generate_sends_vision_and_logs_without_base64(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "LOG_PATH", tmp_path / "ai_logs.jsonl")
    monkeypatch.setattr(settings, "SETTINGS_PATH", tmp_path / "settings.json")
    settings.save({"baseUrl": "https://x/v1", "model": "m", "apiKey": "sk-test"})
    captured = {}
    def fake(_settings, messages):
        captured["messages"] = messages
        return json.dumps(GOOD)
    monkeypatch.setattr(ai, "_call_provider", fake)
    secret_b64 = SMALL_PNG
    out = ai.generate("кухня по фото", CURRENT, "generate", [{"data": secret_b64, "media_type": "image/png"}])
    assert out["projects"] == [GOOD]
    user = captured["messages"][1]
    assert isinstance(user["content"], list)
    assert user["content"][1]["type"] == "image_url"
    assert user["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    # Лог — только счётчик и media, base64 не попадает.
    log = (tmp_path / "ai_logs.jsonl").read_text(encoding="utf-8")
    assert secret_b64 not in log
    assert "image/png" in log
    assert "images" in log


def test_generate_without_images_backwards_compatible(monkeypatch):
    captured = {}
    def fake(_settings, messages):
        captured["messages"] = messages
        return json.dumps(GOOD)
    monkeypatch.setattr(ai, "_call_provider", fake)
    out = ai.generate("кухня", CURRENT, "generate")
    assert out["projects"] == [GOOD]
    assert isinstance(captured["messages"][1]["content"], str)
