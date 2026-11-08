# -*- coding: utf-8 -*-
"""Тесты хранения проектов: пустые проекты, копия/переименование, slug, id."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import projects  # noqa: E402
from app.schema import validate_project  # noqa: E402

ITEM = {
    "id": "i1", "type": "kitchen_base",
    "position": {"x": 0, "z": 0}, "rotationY": 0,
    "w": 600, "h": 720, "d": 560, "t": 16, "plinth": 100,
    "modules": 3, "shelves": 1, "front": "door1", "drawers": 3,
    "top": True, "lift": 0,
    "corpus": "white", "facade": "sonoma", "handle": "bar160",
}


@pytest.fixture(autouse=True)
def tmp_data(monkeypatch, tmp_path):
    monkeypatch.setattr(projects, "DATA_DIR", tmp_path / "data")
    return tmp_path


def test_create_and_load_empty_project():
    data = projects.create("Кухня для Айгуль", "Айгуль")
    assert data["items"] == []
    assert data["id"].startswith("20")  # дата + slug
    assert "kuhnya" in data["id"]
    assert projects.load(data["id"])["name"] == "Кухня для Айгуль"


def test_rename_empty_project_works():
    data = projects.create("Старое")
    renamed = projects.rename(data["id"], "Новое имя")
    assert renamed["name"] == "Новое имя"
    assert projects.load(data["id"])["name"] == "Новое имя"


def test_duplicate_empty_project_works():
    data = projects.create("Пустой")
    copy = projects.duplicate(data["id"])
    assert copy["id"] != data["id"]
    assert copy["name"].endswith("(копия)")
    assert projects.load(copy["id"])["items"] == []


def test_duplicate_and_rename_nonempty_project():
    data = projects.create("Кухня")
    full = dict(data, items=[ITEM])
    projects.save(data["id"], full)
    renamed = projects.rename(data["id"], "Кухня 2")
    assert renamed["items"] == [ITEM]
    copy = projects.duplicate(data["id"])
    assert projects.load(copy["id"])["items"] == [ITEM]


def test_save_validates_and_rewrites_id():
    data = projects.create("Кухня")
    broken = dict(data, id="чужой", items=[])
    with pytest.raises(ValueError):
        projects.save(data["id"], broken)  # пустой items не проходит валидацию
    ok = dict(data, id="чужой", items=[ITEM])
    projects.save(data["id"], ok)
    assert projects.load(data["id"])["id"] == data["id"]  # id = папка
    assert validate_project(projects.load(data["id"])) == []


def test_slug_translit_and_uniqueness():
    assert projects._slug("Кухня для Айгуль") == "kuhnya-dlya-aygul"
    assert projects._slug("Шкаф-купе №5") == "shkaf-kupe-5"
    a = projects.create("Демо")
    b = projects.create("Демо")
    assert a["id"] != b["id"]  # суффикс -2 при коллизии


def test_invalid_id_rejected():
    with pytest.raises(ValueError):
        projects.load("../etc")
    with pytest.raises(ValueError):
        projects.load("")


def test_delete_and_list():
    a = projects.create("А")
    projects.create("Б")
    assert len(projects.list_projects()) == 2
    projects.delete(a["id"])
    listed = projects.list_projects()
    assert len(listed) == 1 and listed[0]["id"] != a["id"]
    # Битый project.json не должен ронять список
    bad = tmp_path = projects.DATA_DIR / "broken"
    bad.mkdir(parents=True, exist_ok=True)
    (bad / "project.json").write_text("not json", encoding="utf-8")
    assert isinstance(projects.list_projects(), list)


def test_save_is_atomic_and_reloadable():
    data = projects.create("Кухня")
    projects.save(data["id"], dict(data, items=[ITEM], notes="тест"))
    raw = json.loads(projects.load(data["id"]) and (projects.DATA_DIR / data["id"] / "project.json").read_text(encoding="utf-8"))
    assert raw["notes"] == "тест"
    assert not list((projects.DATA_DIR / data["id"]).glob("*.tmp"))
