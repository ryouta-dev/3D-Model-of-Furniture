# -*- coding: utf-8 -*-
"""Тесты библиотеки (этап 5): декоры, ручки, примеры, фото."""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import library  # noqa: E402

TINY_PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


@pytest.fixture(autouse=True)
def tmp_lib(monkeypatch, tmp_path):
    monkeypatch.setattr(library, "LIB_DIR", tmp_path / "library")
    return tmp_path


def test_add_decor_with_photo():
    d = library.add_decor("Мой дуб", "#AABBCC", TINY_PNG, "image/png")
    assert d["id"] == "moy-dub"
    assert library.list_kind("decors")[0]["name"] == "Мой дуб"
    assert library.photo_path("decors", d["id"]).exists()


def test_add_handle_and_example():
    h = library.add_handle("Ручка цеха", "чёрная, 160", "", "", 160)
    assert h["description"] == "чёрная, 160"
    e = library.add_example("Кухня Айгуль", "тёмные фасады", TINY_PNG, "image/png")
    assert e["title"] == "Кухня Айгуль"
    assert library.photo_path("examples", e["id"]).exists()


def test_validation():
    with pytest.raises(ValueError):
        library.add_decor("", "#fff")
    with pytest.raises(ValueError):
        library.add_decor("x", "nothex")
    with pytest.raises(ValueError):
        library.add_decor("x", "#fff", TINY_PNG, "image/gif")
    with pytest.raises(ValueError):
        library.add_handle("")
    with pytest.raises(ValueError):
        library.add_example("")


def test_delete_removes_photo():
    d = library.add_decor("Удалить", "#000000", TINY_PNG, "image/png")
    library.delete("decors", d["id"])
    assert library.list_kind("decors") == []
    assert library.photo_path("decors", d["id"]) is None
