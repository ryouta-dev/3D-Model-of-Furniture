# -*- coding: utf-8 -*-
"""Тесты нормализации ИИ: слияние модулей, компактная схема, выравнивание.

normalize_projects — чистая функция (бэклог п. 5). Вход не мутируется,
scene/editor/generators не затрагиваются.
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ai  # noqa: E402
from app.schema import validate_project  # noqa: E402


def _base(i, x, **kw):
    it = {
        "id": i, "type": "kitchen_base", "position": {"x": x, "z": 0}, "rotationY": 0,
        "w": 600, "h": 720, "d": 560, "t": 16, "plinth": 100, "modules": 1,
        "shelves": 1, "front": "door1", "drawers": 3, "top": True, "lift": 0,
        "corpus": "white", "facade": "sonoma", "handle": "bar160",
    }
    it.update(kw)
    return it


def _wall(i, x, **kw):
    it = {
        "id": i, "type": "kitchen_wall", "position": {"x": x, "z": 0}, "rotationY": 0,
        "w": 600, "h": 720, "d": 320, "t": 16, "plinth": 0, "modules": 1,
        "shelves": 1, "front": "door1", "drawers": 3, "top": False, "lift": 1400,
        "corpus": "white", "facade": "sonoma", "handle": "bar160",
    }
    it.update(kw)
    return it


def _project(items, **kw):
    p = {
        "version": 1, "id": "ai1", "name": "Кухня", "client": "", "notes": "",
        "room": {"enabled": True, "width": 3600, "depth": 3200, "height": 2700,
                 "wallTexture": "paint_white", "floorTexture": "laminate_oak",
                 "windows": [], "panorama": None},
        "items": items,
        "price": {"total": None, "currency": "KZT", "lines": []},
    }
    p.update(kw)
    return p


def _seven_separate():
    items = [_base(f"b{i}", (i - 1) * 600) for i in range(1, 5)]  # 4 низа
    items += [_wall(f"w{i}", (i - 1) * 600) for i in range(1, 4)]  # 3 верха
    return _project(items)


def test_seven_separate_merge_into_two_rows():
    out = ai.normalize_projects([_seven_separate()])
    assert len(out) == 1
    items = out[0]["items"]
    assert len(items) == 2
    by_type = {it["type"]: it for it in items}
    assert by_type["kitchen_base"]["modules"] == 4
    assert by_type["kitchen_wall"]["modules"] == 3
    assert by_type["kitchen_base"]["w"] == 600
    assert validate_project(_project(items)) == []


def test_different_fronts_not_merged():
    items = [_base("b1", 0), _base("b2", 600, front="drawers"), _base("b3", 1200, front="drawers")]
    out = ai.normalize_projects([_project(items)])
    merged = out[0]["items"]
    # b1 один, b2+b3 слились (фронты одинаковые)
    assert len(merged) == 2
    drawers_row = [it for it in merged if it["front"] == "drawers"][0]
    assert drawers_row["modules"] == 2


def test_different_facade_not_merged():
    items = [_base("b1", 0), _base("b2", 600, facade="walnut")]
    out = ai.normalize_projects([_project(items)])
    assert len(out[0]["items"]) == 2


def test_gap_not_merged():
    items = [_base("b1", 0), _base("b2", 2000)]  # разрыв 1400 мм
    out = ai.normalize_projects([_project(items)])
    assert len(out[0]["items"]) == 2


def test_total_modules_over_six_not_merged():
    items = [_base(f"b{i}", (i - 1) * 600) for i in range(1, 8)]  # 7 модулей подряд
    out = ai.normalize_projects([_project(items)])
    # Схема modules 1–6: сливать до 7 нельзя — остаются отдельные
    assert len(out[0]["items"]) == 7


def test_already_rows_unchanged_idempotent():
    # Вход с уже выровненным верхом (спинки на одной линии) — не трогаем.
    aligned_wall = _wall("i2", 0, modules=3)
    aligned_wall["position"] = {"x": 0, "z": (320 - 560) / 2}
    p = _project([
        _base("i1", 0, modules=3),
        aligned_wall,
    ])
    out = ai.normalize_projects([p])
    assert out[0]["items"] == p["items"]
    # Повторный прогон даёт то же самое
    assert ai.normalize_projects(out)[0]["items"] == out[0]["items"]


def test_align_top_over_bottom():
    items = [
        _base("b1", 0, modules=3),
        _wall("w1", 999, z_off=0) if False else _wall("w1", 999),
    ]
    # Верху задаём неверную позицию/высоту — нормализация выровняет
    items[1]["position"] = {"x": 777, "z": 500}
    items[1]["lift"] = 500
    items[1]["plinth"] = 50
    items[1]["top"] = True
    out = ai.normalize_projects([_project(items)])
    base, wall = out[0]["items"]
    assert wall["position"]["x"] == base["position"]["x"] == 0
    # Спинки на одной линии: z_верха = z_низа + (d_верха - d_низа)/2
    assert wall["position"]["z"] == base["position"]["z"] + (320 - 560) / 2
    assert wall["lift"] == 1400 and wall["plinth"] == 0 and wall["top"] is False
    assert base["lift"] == 0 and base["top"] is True


def test_non_kitchen_untouched():
    wardrobe = {
        "id": "wb", "type": "wardrobe", "position": {"x": 2000, "z": 600}, "rotationY": 0,
        "w": 1000, "h": 2200, "d": 550, "t": 16, "plinth": 80, "lift": 0, "modules": 1,
        "shelves": 4, "front": "doors2", "drawers": 3, "top": False,
        "corpus": "white", "facade": "sonoma", "handle": "bar160",
    }
    p = _project([_base("b1", 0), _base("b2", 600), wardrobe])
    out = ai.normalize_projects([p])
    items = out[0]["items"]
    assert len(items) == 2
    assert any(it["type"] == "wardrobe" and it["id"] == "wb" for it in items)
    assert items[-1]["id"] == "wb"


def test_input_not_mutated():
    p = _seven_separate()
    snapshot = copy.deepcopy(p)
    ai.normalize_projects([p])
    assert p == snapshot


def test_compact_straight_converts():
    compact = _project([
        {"id": "m1", "row": "base", "wall": "back", "start": 0, "w": 600, "front": "door1"},
        {"id": "m2", "row": "base", "wall": "back", "start": 600, "w": 600, "front": "door1"},
        {"id": "m3", "row": "wall", "wall": "back", "start": 0, "w": 600, "front": "door1"},
        {"id": "m4", "row": "wall", "wall": "back", "start": 600, "w": 600, "front": "door1"},
    ], common={"t": 16, "corpus": "white", "facade": "sonoma", "handle": "bar160"})
    out = ai.normalize_projects([compact])
    items = out[0]["items"]
    assert all("row" not in it and "type" in it for it in items)
    assert "common" not in out[0]
    by_type = {it["type"]: it for it in items}
    assert by_type["kitchen_base"]["modules"] == 2
    assert by_type["kitchen_wall"]["modules"] == 2
    assert validate_project(out[0]) == []
    assert ai._compact_schema_errors(out) == []


def test_compact_corner_not_converted():
    compact = _project([
        {"id": "m1", "row": "base", "wall": "back", "start": 0, "w": 600, "front": "door1"},
        {"id": "m2", "row": "base", "wall": "left", "start": 0, "w": 600, "front": "door1"},
    ], common={"t": 16})
    out = ai.normalize_projects([compact])
    # Угловая схема этап 6: остаётся как есть -> generate выдаст ошибку ретрая
    assert "row" in out[0]["items"][0]
    assert ai._compact_schema_errors(out) != []


def test_compact_without_envelope_not_converted():
    # Без version/id/name компакт не угадывается (см. _compact_envelope_ok).
    compact = {"assumptions": ["x"], "room": {"width": 3600, "depth": 3000, "height": 2700},
               "items": [{"id": "b1", "row": "base", "wall": "back", "start": 0, "w": 800,
                          "purpose": "sink", "front": "doors2", "shelves": 1}],
               "common": {"t": 16}}
    out = ai.normalize_projects([compact])
    assert out[0] == compact
    assert ai._compact_schema_errors(out) != []


def test_generate_returns_merged_rows(monkeypatch):
    import json as _json
    seven = _seven_separate()
    monkeypatch.setattr(ai, "_call_provider", lambda s, m: _json.dumps(seven))
    out = ai.generate("кухня 4 модуля вниз 3 вверх", {"version": 1, "id": "p1", "name": "X", "items": [_base("i1", 0)]}, "generate")
    assert len(out["projects"]) == 1
    assert len(out["projects"][0]["items"]) == 2
