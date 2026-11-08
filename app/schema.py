# -*- coding: utf-8 -*-
"""Проверка project.json по схеме из ТЗ (п. 6).

Возвращает список ошибок по-русски — их можно показать Оператору или
отправить ИИ на повтор (этап 4). Ничего не импортирует, работает и на
бэкенде, и в тестах.
"""
from __future__ import annotations

TYPES = {"wardrobe", "chest", "kitchen_base", "kitchen_wall",
         "sliding_wardrobe", "kitchen_corner", "bed", "table"}
FRONTS = {"open", "door1", "doors2", "drawers", "sliding"}
# Диапазоны из прототипа mebel3d.html (RANGE и счётчики .step)
RANGES = {"w": (300, 2400), "h": (200, 2600), "d": (150, 800), "plinth": (0, 200), "lift": (0, 2000)}
TYPE_RANGES = {
    "sliding_wardrobe": {"w": (600, 2400), "h": (1800, 2600), "d": (450, 800), "plinth": (0, 200), "lift": (0, 0)},
    "kitchen_corner": {"w": (1200, 3600), "h": (720, 720), "d": (1200, 3600), "plinth": (0, 200), "lift": (0, 0)},
    "bed": {"w": (800, 1800), "h": (500, 1300), "d": (1800, 2200), "plinth": (0, 0), "lift": (0, 0)},
    "table": {"w": (600, 2400), "h": (600, 900), "d": (500, 1200), "plinth": (0, 0), "lift": (0, 0)},
}
COUNTS = {"modules": (1, 6), "shelves": (0, 8), "drawers": (0, 6)}
THICKNESS = (16, 18)

ROOM_RANGES = {"width": (1000, 20000), "depth": (1000, 20000), "height": (2000, 5000)}
ROOM_WALLS = {"back", "left", "right", "front"}


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _range_err(errors, where, key, v, lo, hi):
    if not _num(v):
        errors.append(f"{where}: {key} должно быть числом")
    elif not (lo <= v <= hi):
        errors.append(f"{where}: {key} = {v} вне диапазона {lo}–{hi}")


def validate_item(item, idx: int) -> list[str]:
    errors: list[str] = []
    where = f"Предмет #{idx + 1}"
    if not isinstance(item, dict):
        return [f"{where}: должен быть объектом"]
    if not isinstance(item.get("id"), str) or not item["id"]:
        errors.append(f"{where}: нет id")
    t = item.get("type")
    if t not in TYPES:
        errors.append(f"{where}: неизвестный тип мебели «{t}» (допустимо: {', '.join(sorted(TYPES))})")
        return errors  # дальше проверять поля бессмысленно
    type_ranges = TYPE_RANGES.get(t, RANGES)
    for key, (lo, hi) in type_ranges.items():
        _range_err(errors, where, key, item.get(key), lo, hi)
    if item.get("t") not in THICKNESS:
        errors.append(f"{where}: толщина ДСП t должна быть 16 или 18 мм")
    for key, (lo, hi) in COUNTS.items():
        v = item.get(key)
        if not isinstance(v, int) or isinstance(v, bool) or not (lo <= v <= hi):
            errors.append(f"{where}: {key} должно быть целым от {lo} до {hi}")
    front = item.get("front")
    if front == "sliding" and t != "sliding_wardrobe":
        errors.append(f"{where}: раздвижные фасады только для шкафа-купе")
    elif front not in FRONTS:
        errors.append(f"{where}: фасад «{front}» — допустимо: {', '.join(sorted(FRONTS - {'sliding'}))}")
    if not isinstance(item.get("top"), bool):
        errors.append(f"{where}: top должно быть true/false")
    for key in ("corpus", "facade", "handle"):
        if not isinstance(item.get(key), str) or not item[key]:
            errors.append(f"{where}: не указан {key}")
    pos = item.get("position")
    if not isinstance(pos, dict) or not _num(pos.get("x")) or not _num(pos.get("z")):
        errors.append(f"{where}: position.x и position.z должны быть числами (мм)")
    elif not _num(item.get("rotationY", 0)):
        errors.append(f"{where}: rotationY должно быть числом")
    return errors


def validate_project(data) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["Проект должен быть JSON-объектом"]
    if data.get("version") != 1:
        errors.append("version должно быть 1 (других схем пока нет)")
    if not isinstance(data.get("id"), str) or not data["id"].strip():
        errors.append("Проект без id")
    if not isinstance(data.get("name"), str) or not data["name"].strip():
        errors.append("Проект без названия")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        errors.append("В проекте должен быть хотя бы один предмет (items)")
    else:
        for i, item in enumerate(items):
            errors.extend(validate_item(item, i))
    room = data.get("room")
    if room is not None:
        if not isinstance(room, dict):
            errors.append("room должно быть объектом")
        else:
            if "enabled" in room and not isinstance(room["enabled"], bool):
                errors.append("Комната: enabled должно быть true/false")
            for key, (lo, hi) in ROOM_RANGES.items():
                _range_err(errors, "Комната", key, room.get(key), lo, hi)
            for key in ("wallTexture", "floorTexture"):
                if key in room and (not isinstance(room[key], str) or not room[key]):
                    errors.append(f"Комната: {key} должен быть непустой строкой")
            wins = room.get("windows", [])
            if wins and not isinstance(wins, list):
                errors.append("room.windows должен быть списком")
            elif isinstance(wins, list):
                for j, w in enumerate(wins):
                    if not isinstance(w, dict):
                        errors.append(f"Комната: окно #{j + 1} должно быть объектом")
                        continue
                    if w.get("wall") not in ROOM_WALLS:
                        errors.append(f"Комната: окно #{j + 1} — стена должна быть back/left/right/front")
                    for key, (lo, hi) in {"x": (0, 20000), "width": (100, 10000),
                                          "height": (100, 5000), "sill": (0, 3000)}.items():
                        if key in w:
                            _range_err(errors, f"Комната: окно #{j + 1}", key, w.get(key), lo, hi)
    price = data.get("price")
    if price is not None:
        if not isinstance(price, dict):
            errors.append("price должно быть объектом")
        else:
            if price.get("total") is not None and not _num(price["total"]):
                errors.append("price.total должно быть числом или null")
            lines = price.get("lines", [])
            if lines and not isinstance(lines, list):
                errors.append("price.lines должен быть списком")
            elif isinstance(lines, list):
                for j, ln in enumerate(lines):
                    if not isinstance(ln, dict):
                        errors.append(f"Цена: строка #{j + 1} должна быть объектом")
                    elif ln.get("amount") is not None and not _num(ln["amount"]):
                        errors.append(f"Цена: строка #{j + 1} amount должно быть числом")
    exp = data.get("export")
    if exp is not None:
        if not isinstance(exp, dict):
            errors.append("export должен быть объектом")
        else:
            for key in ("showCutlist", "allowColorSwitch", "showRoom", "showPrice"):
                if key in exp and not isinstance(exp[key], bool):
                    errors.append(f"Экспорт: {key} должен быть true/false")
            if "allowedColors" in exp:
                ac = exp["allowedColors"]
                if not isinstance(ac, list) or any(not isinstance(c, str) or not c for c in ac):
                    errors.append("Экспорт: allowedColors должен быть списком непустых строк")
    return errors
