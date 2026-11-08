# -*- coding: utf-8 -*-
"""Тесты валидации project.json (ТЗ п. 10: валидация JSON от ИИ)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schema import validate_item, validate_project  # noqa: E402

ITEM = {
    "id": "i1", "type": "kitchen_base",
    "position": {"x": 0, "z": 0}, "rotationY": 0,
    "w": 600, "h": 720, "d": 560, "t": 16, "plinth": 100,
    "modules": 3, "shelves": 1, "front": "door1", "drawers": 3,
    "top": True, "lift": 0,
    "corpus": "white", "facade": "sonoma", "handle": "bar160",
}


def test_valid_project_passes():
    data = {"version": 1, "id": "p1", "name": "Кухня", "items": [ITEM]}
    assert validate_project(data) == []


def test_unknown_type_rejected():
    bad = dict(ITEM, type="unknown_xyz")
    errs = validate_item(bad, 0)
    assert any("неизвестный тип" in e for e in errs)


def test_size_out_of_range():
    errs = validate_item(dict(ITEM, w=100), 0)
    assert any("w" in e and "300" in e for e in errs)


def test_thickness_must_be_16_or_18():
    errs = validate_item(dict(ITEM, t=18.5), 0)
    assert any("16 или 18" in e for e in errs)


def test_front_and_counts():
    errs = validate_item(dict(ITEM, front="sliding", modules=0, drawers=9), 0)
    assert any("фасад" in e for e in errs)
    assert any("modules" in e for e in errs)
    assert any("drawers" in e for e in errs)


def test_missing_materials():
    errs = validate_item({k: v for k, v in ITEM.items() if k != "facade"}, 0)
    assert any("facade" in e for e in errs)


def test_empty_items_rejected():
    errs = validate_project({"version": 1, "id": "p", "name": "x", "items": []})
    assert any("items" in e for e in errs)


def test_room_ranges():
    data = {"version": 1, "id": "p", "name": "x", "items": [ITEM],
            "room": {"enabled": True, "width": 100, "depth": 3200, "height": 2700}}
    errs = validate_project(data)
    assert any("width" in e for e in errs)


def test_not_a_dict():
    assert validate_project([1, 2]) == ["Проект должен быть JSON-объектом"]


def test_room_windows_validated():
    base = {"version": 1, "id": "p", "name": "x", "items": [ITEM]}
    good = dict(base, room={"enabled": True, "width": 3600, "depth": 3200, "height": 2700,
                            "wallTexture": "paint_white", "floorTexture": "laminate_oak",
                            "windows": [{"wall": "back", "x": 800, "width": 1200,
                                         "height": 1300, "sill": 900}]})
    assert validate_project(good) == []
    bad_wall = dict(base, room={"enabled": True, "width": 3600, "depth": 3200, "height": 2700,
                                "windows": [{"wall": "ceiling", "x": 0, "width": 100, "height": 100, "sill": 0}]})
    assert any("стена" in e for e in validate_project(bad_wall))
    bad_enabled = dict(base, room={"enabled": "да", "width": 3600, "depth": 3200, "height": 2700})
    assert any("enabled" in e for e in validate_project(bad_enabled))
