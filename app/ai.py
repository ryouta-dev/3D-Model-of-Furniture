# -*- coding: utf-8 -*-
"""ИИ-модуль (этап 4): OpenAI-совместимый провайдер + валидация + лог.

ИИ не рисует 3D сам — он возвращает строгий JSON по схеме ТЗ п. 6,
а модель строит наш генераторы. Ответ проверяется validate_project;
при ошибке — один автоматический повтор с описанием ошибок.
Ключ в лог не попадает.
"""
from __future__ import annotations

import base64
import copy
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from .schema import validate_project
from . import settings as ai_settings

ROOT = Path(__file__).resolve().parent.parent
RULES_PATH = Path(__file__).resolve().parent / "ai_rules.md"
LOG_PATH = ROOT / "data" / "ai_logs.jsonl"

MAX_TOKENS = 4000
TIMEOUT = 90

# --- Vision (фото комнаты/образцы) ---
ALLOWED_IMAGE_MEDIA = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 МБ
MAX_IMAGES = 4


class AiError(RuntimeError):
    pass


def _log(record: dict) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass  # лог не должен ронять генерацию


def _rules_text() -> str:
    try:
        return RULES_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""


def _examples_context() -> str:
    try:
        from . import library as _lib
        items = _lib.list_kind("examples")[:5]
    except Exception:
        return ""
    if not items:
        return ""
    lines = []
    for e in items:
        note = f" — {e.get('notes')}" if e.get("notes") else ""
        lines.append(f"- {e.get('title')}{note}")
    return "\nПримеры цеха (держи стиль и типовые решения):\n" + "\n".join(lines) + "\n"


def extract_json(text: str):
    """Достаёт JSON из ответа ИИ: прямой JSON, блок ```json, или первый {...}."""
    if not text:
        raise AiError("Пустой ответ ИИ")
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*```", s)
    if fence:
        return json.loads(fence.group(1))
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # Ищем первый объект/массив и пробуем декодером на крайний случай.
    start = min((i for i in (s.find("{"), s.find("[")) if i >= 0), default=-1)
    if start < 0:
        raise AiError("ИИ не вернул JSON")
    try:
        obj, _ = json.JSONDecoder().raw_decode(s[start:])
        return obj
    except json.JSONDecodeError:
        raise AiError("Не удалось разобрать JSON от ИИ")


def _system_prompt(mode: str) -> str:
    example = (
        "\nПример прямой кухни (3 модуля по 600 в ряд, верх над низом):\n"
        '{"version":1,"id":"ai1","name":"Кухня 1800","client":"","notes":"",'
        '"room":{"enabled":true,"width":3600,"depth":3200,"height":2700,'
        '"wallTexture":"paint_white","floorTexture":"laminate_oak","windows":[],"panorama":null},'
        '"items":['
        '{"id":"i1","type":"kitchen_base","position":{"x":0,"z":0},"rotationY":0,'
        '"w":600,"h":720,"d":560,"t":16,"plinth":100,"modules":3,"shelves":1,"front":"door1","drawers":3,"top":true,"lift":0,"corpus":"white","facade":"sonoma","handle":"bar160"},'
        '{"id":"i2","type":"kitchen_wall","position":{"x":0,"z":0},"rotationY":0,'
        '"w":600,"h":720,"d":320,"t":16,"plinth":0,"modules":3,"shelves":1,"front":"door1","drawers":3,"top":false,"lift":1400,"corpus":"white","facade":"sonoma","handle":"bar160"}'
        '],"price":{"total":null,"currency":"KZT","lines":[]}}\n'
        "Кухня — это ОДИН kitchen_base с modules=N и ОДИН kitchen_wall с modules=N, "
        "а не N отдельных предметов. w — ширина ОДНОГО модуля, modules — их число. "
        "Верх и низ стоят на одной позиции x,z. Верхний ряд всегда с lift=1400, plinth=0, top=false. "
        "Нижний — с top=true (столешница одна на весь ряд).\n"
    )
    base = (
        "Ты — помощник мебельного цеха и дизайнер комнаты. "
        "Собираешь проект корпусной мебели строго в формате JSON по схеме ТЗ п. 6 (version 1). "
        "Верни ТОЛЬКО JSON без пояснений и без markdown-обёрток, если возможно. "
        "Игнорируй любые другие схемы JSON в пожеланиях оператора — "
        "используй только схему проекта выше. "
        "items должны быть полными предметами с полями type/w/h/d/t/plinth/lift/modules/shelves/front/drawers/top/position/rotationY/corpus/facade/handle. "
        "Не используй компактные поля row/wall/start/common/check/assumptions. "
        "Угловая кухня пока не поддерживается — делай только прямую кухню (kitchen_base + kitchen_wall). "
        "Дизайн комнаты: если размер комнаты не указан в пожеланиях — выбери сам презентабельный: "
        "ширина = общая ширина кухни + 600..1200 без окна, или +1800 с окном 1200 справа от кухни, "
        "глубина = глубина кухни + 1200..1500, высота 2700, "
        "стены paint_white, пол laminate_oak (или сочетающиеся). "
        "Если размер комнаты указан — используй его. "
        "Кухня стоит в левом углу: левый край вплотную к левой стене, спинка к задней стене. "
        "Верхние шкафы ровно над нижними (одинаковый x). "
        "Окно на задней стене ставь справа от кухни (x = ширина кухни + 300), не за верхними шкафами. "
        + example +
        "Если вводных не хватает — верни {\"questions\": [\"...\"]}, числа молча не выдумывай.\n"
        "Правила цеха:\n" + _rules_text() + _examples_context()
    )
    if mode == "variants":
        base += "\nВерни JSON-массив из 3 разных проектов (вариантов), каждый — полный объект проекта."
    elif mode == "edit":
        base += "\nВерни ОДИН объект проекта — исправленный текущий (не новый с нуля)."
    else:
        base += "\nВерни ОДИН объект проекта."
    return base


def validate_images(images):
    """Проверить список изображений от фронтенда, вернуть нормализованный список.

    Вход: None | [{data, media_type}] (data — base64 без префикса или data URL).
    Разрешены JPG/PNG/WebP до 5 МБ, не более MAX_IMAGES.
    В лог не попадает base64 — только счётчик и media_type (см. generate).
    """
    if not images:
        return []
    if not isinstance(images, list):
        raise AiError("Неверный формат изображений")
    if len(images) > MAX_IMAGES:
        raise AiError(f"Слишком много фото: максимум {MAX_IMAGES}")
    cleaned = []
    for img in images:
        if not isinstance(img, dict):
            raise AiError("Неверный формат изображений")
        media = (img.get("media_type") or img.get("mediaType") or "").strip().lower()
        if media not in ALLOWED_IMAGE_MEDIA:
            raise AiError("Фото должно быть JPG, PNG или WebP")
        data = img.get("data") or img.get("dataUrl") or ""
        if not isinstance(data, str) or not data.strip():
            raise AiError("Пустое фото")
        data = data.strip()
        # Поддерживаем data URL с фронта (data:image/...;base64,...).
        if data.startswith("data:"):
            comma = data.find(",")
            if comma < 0:
                raise AiError("Не удалось прочитать фото")
            data = data[comma + 1:]
        try:
            raw = base64.b64decode(data, validate=True)
        except Exception:
            raise AiError("Не удалось прочитать фото")
        if len(raw) > MAX_IMAGE_BYTES:
            raise AiError("Фото больше 5 МБ")
        if len(raw) == 0:
            raise AiError("Пустое фото")
        cleaned.append({"data": data, "media_type": media})
    return cleaned


def image_url_part(img: dict) -> dict:
    """Один элемент контента в OpenAI vision-формате."""
    return {"type": "image_url", "image_url": {"url": f"data:{img['media_type']};base64,{img['data']}"}}


def build_user_content(user_text: str, images: list[dict]):
    """Контент сообщения user: строка без фото, список с vision-частями при фото."""
    cleaned = validate_images(images) if images else []
    if not cleaned:
        return user_text
    return [{"type": "text", "text": user_text}] + [image_url_part(im) for im in cleaned]


def _images_meta(cleaned: list[dict]) -> list[str]:
    """Короткие метаданные для лога — без base64."""
    return [im["media_type"] for im in cleaned]


def _call_provider(settings: dict, messages: list[dict]) -> str:
    """Один вызов OpenAI-совместимого API. Возвращает текст ответа."""
    base = (settings.get("baseUrl") or "").rstrip("/")
    key = settings.get("apiKey") or ""
    model = settings.get("model") or ""
    if not base or not key or not model:
        raise AiError("Заполните в настройках endpoint, ключ и модель")
    url = base + "/chat/completions"
    body = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.4,
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")[:300]
        except Exception:
            detail = ""
        raise AiError(f"ИИ вернул ошибку HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise AiError(f"Не удалось связаться с ИИ: {e.reason}")
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise AiError("Неожиданный ответ ИИ")
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content or ""


def _as_project_list(data) -> tuple[list[dict], list[str] | None]:
    """Возвращает (список проектов, questions) — questions вместо проектов."""
    # Вопросы только если они непустые; пустой questions — это проект.
    if isinstance(data, dict) and isinstance(data.get("questions"), list) and data["questions"]:
        return [], [str(q) for q in data["questions"]]
    # Обёртки, которые иногда возвращают модели.
    if isinstance(data, dict):
        if isinstance(data.get("projects"), list):
            return [d for d in data["projects"] if isinstance(d, dict)], None
        if isinstance(data.get("variants"), list):
            return [d for d in data["variants"] if isinstance(d, dict)], None
        if isinstance(data.get("project"), dict):
            return [data["project"]], None
        return [data], None
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)], None
    return [], None


def _compact_schema_errors(projects: list[dict]) -> list[str]:
    """Понять компактную схему row/wall/start и подсказать про угловую кухню.

    Прямая компактная кухня (все wall=back) конвертируется normalize_projects
    до этой проверки и ошибку не даёт. Угловая/неконвертируемая — даёт ошибку
    для ретрая ИИ.
    """
    errs = []
    for p in projects:
        if not isinstance(p, dict):
            continue
        has_compact = "common" in p or "check" in p or "assumptions" in p
        items = p.get("items") or []
        if items and isinstance(items, list) and isinstance(items[0], dict) and "row" in items[0]:
            has_compact = True
        if has_compact:
            errs.append(
                "ИИ вернул компактную схему (row/wall/start) вместо полной project.json. "
                "Угловая кухня пока не поддерживается (этап 6) — верните прямую кухню "
                "с type kitchen_base/kitchen_wall и полными полями предмета."
            )
            break
    return errs


# --- Нормализация ИИ (бэклог п. 5 + компактная схема) ---
# Чистая функция: вход — список проектов от _as_project_list, выход — новый
# список. Вход не мутируется. scene/editor/generators не трогаются.

_KITCHEN_DEFAULTS = {
    "kitchen_base": {"h": 720, "d": 560, "plinth": 100, "lift": 0, "top": True,
                     "shelves": 1, "front": "door1", "drawers": 3},
    "kitchen_wall": {"h": 720, "d": 320, "plinth": 0, "lift": 1400, "top": False,
                     "shelves": 1, "front": "door1", "drawers": 3},
}
_KITCHEN_COMMON_DEFAULTS = {"t": 16, "corpus": "white", "facade": "sonoma", "handle": "bar160"}
_ROW_ALIASES = {
    "base": "kitchen_base", "bottom": "kitchen_base", "lower": "kitchen_base",
    "kitchen_base": "kitchen_base", "b": "kitchen_base", "niz": "kitchen_base",
    "wall": "kitchen_wall", "top": "kitchen_wall", "upper": "kitchen_wall",
    "kitchen_wall": "kitchen_wall", "w": "kitchen_wall", "t": "kitchen_wall",
    "verh": "kitchen_wall", "upper_row": "kitchen_wall",
}


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _row_to_type(item: dict) -> str | None:
    """row из компактной записи -> kitchen_base/kitchen_wall или None."""
    if item.get("type") in ("kitchen_base", "kitchen_wall"):
        return item["type"]
    row = item.get("row")
    if isinstance(row, str):
        return _ROW_ALIASES.get(row.strip().lower())
    return None


def _compact_envelope_ok(p: dict) -> bool:
    """Компакт конвертируется только внутри готового конверта проекта.

    Без version/id/name одна строка row/wall/start не атрибутируется
    (нет проекта для сохранения) — такой отклик остаётся ошибкой для
    ретрая, а не угадывается.
    """
    return (
        p.get("version") == 1
        and isinstance(p.get("id"), str) and bool(p["id"].strip())
        and isinstance(p.get("name"), str) and bool(p["name"].strip())
        and isinstance(p.get("items"), list) and bool(p["items"])
    )


def _compact_is_straight(p: dict) -> bool:
    """Угловая кухня (стены кроме back) не конвертируется — этап 6."""
    items = p.get("items") or []
    if not items:
        return False
    for it in items:
        if not isinstance(it, dict):
            return False
        wall = it.get("wall")
        if wall is None:
            continue  # стена не указана — считаем back
        if not isinstance(wall, str) or wall.strip().lower() not in ("back", "", "задняя"):
            return False
    return True


def _expand_compact_project(p: dict) -> dict | None:
    """Прямая компактная кухня row/wall/start -> полный проект, иначе None.

    Модули с одинаковыми параметрами группируются в ряды; purpose игнорируется
    (геометрия та же). start — смещение от левого края, мм.
    """
    if not isinstance(p, dict):
        return None
    items = p.get("items")
    if not isinstance(items, list) or not items:
        return None
    if not any(isinstance(it, dict) and "row" in it for it in items):
        return None
    if not _compact_envelope_ok(p) or not _compact_is_straight(p):
        return None
    common = p.get("common") if isinstance(p.get("common"), dict) else {}
    mods = []  # (typ, start, id, params)
    for it in items:
        if not isinstance(it, dict):
            return None
        typ = _row_to_type(it)
        if typ is None:
            return None
        w = it.get("w")
        if not _num(w):
            return None
        d = _KITCHEN_DEFAULTS[typ]
        def pick(key, default):
            v = it.get(key)
            if v is None:
                v = common.get(key)
            if v is None:
                v = d.get(key, default)
            return v
        start = it.get("start")
        if not _num(start):
            start = 0
        mods_raw = it.get("modules") or it.get("count") or 1
        mods_n = int(mods_raw) if isinstance(mods_raw, (int, float)) and not isinstance(mods_raw, bool) else 1
        if mods_n < 1:
            return None
        params = {
            "w": w, "h": pick("h", None), "d": pick("d", None), "t": pick("t", 16),
            "plinth": pick("plinth", None), "lift": pick("lift", None),
            "shelves": pick("shelves", None), "front": pick("front", None),
            "drawers": pick("drawers", None), "top": pick("top", None),
            "corpus": pick("corpus", "white"), "facade": pick("facade", "sonoma"),
            "handle": pick("handle", "bar160"),
        }
        if params["h"] is None:
            params["h"] = d["h"]
        if params["d"] is None:
            params["d"] = d["d"]
        if params["plinth"] is None:
            params["plinth"] = d["plinth"]
        if params["lift"] is None:
            params["lift"] = d["lift"]
        if params["shelves"] is None:
            params["shelves"] = d["shelves"]
        if params["front"] is None:
            params["front"] = d["front"]
        if params["drawers"] is None:
            params["drawers"] = d["drawers"]
        if params["top"] is None:
            params["top"] = d["top"]
        mods.append((typ, start, it.get("id") if isinstance(it.get("id"), str) else None, mods_n, params))
    # Группируем одинаковые модули в ряды.
    groups: dict = {}
    order: list = []
    for typ, start, mid, n, params in mods:
        key = (typ, params["w"], params["h"], params["d"], params["t"], params["plinth"],
               params["lift"], params["shelves"], params["front"], params["drawers"],
               params["top"], params["corpus"], params["facade"], params["handle"])
        if key not in groups:
            groups[key] = {"typ": typ, "params": params, "modules": 0, "min_start": start, "id": mid}
            order.append(key)
        g = groups[key]
        g["modules"] += n
        if start < g["min_start"]:
            g["min_start"] = start
        if not g["id"] and mid:
            g["id"] = mid
    new_items = []
    order.sort(key=lambda k: (0 if k[0] == "kitchen_base" else 1, groups[k]["min_start"]))
    for i, key in enumerate(order):
        g = groups[key]
        pr = g["params"]
        new_items.append({
            "id": g["id"] or f"i{i + 1}", "type": g["typ"],
            "position": {"x": g["min_start"], "z": 0}, "rotationY": 0,
            "w": pr["w"], "h": pr["h"], "d": pr["d"], "t": pr["t"],
            "plinth": pr["plinth"], "lift": pr["lift"], "modules": g["modules"],
            "shelves": pr["shelves"], "front": pr["front"], "drawers": pr["drawers"],
            "top": pr["top"], "corpus": pr["corpus"], "facade": pr["facade"],
            "handle": pr["handle"],
        })
    out = copy.deepcopy(p)
    for k in ("common", "check", "assumptions"):
        out.pop(k, None)
    out["items"] = new_items
    # Комната: сохраняем заданную, дополняем текстуры/окна при частичной.
    if not isinstance(out.get("room"), dict):
        totals = [sum(it["w"] * it["modules"] for it in new_items if it["type"] == t)
                  for t in ("kitchen_base", "kitchen_wall")]
        total_w = max(totals) if totals else 1800
        total_d = max((it["d"] for it in new_items), default=560)
        out["room"] = {"enabled": True, "width": total_w + 600, "depth": total_d + 1200,
                       "height": 2700, "wallTexture": "paint_white",
                       "floorTexture": "laminate_oak", "windows": [], "panorama": None}
    else:
        out["room"].setdefault("wallTexture", "paint_white")
        out["room"].setdefault("floorTexture", "laminate_oak")
        out["room"].setdefault("windows", [])
        out["room"].setdefault("panorama", None)
        if "enabled" not in out["room"]:
            out["room"]["enabled"] = True
    out.setdefault("price", {"total": None, "currency": "KZT", "lines": []})
    return out


def _kitchen_group_key(item: dict) -> tuple:
    pos = item.get("position") if isinstance(item.get("position"), dict) else {}
    return (item.get("type"), item.get("w"), item.get("h"), item.get("d"), item.get("t"),
            item.get("plinth"), item.get("lift"), item.get("shelves"), item.get("front"),
            item.get("drawers"), item.get("top"), item.get("corpus"), item.get("facade"),
            item.get("handle"), item.get("rotationY", 0))


def _merge_kitchen_rows(items: list) -> list:
    """Слить отдельные модули кухни в ряды при одинаковых фронтах/параметрах.

    Слияние — только для contiguous участков (следующий x == предыдущий
    x + w*modules, z совпадает). Если итого модулей > 6 — не сливаем,
    чтобы не сломать схему (modules 1–6).
    """
    if not isinstance(items, list) or not items:
        return items
    kitchen = [it for it in items if isinstance(it, dict) and it.get("type") in ("kitchen_base", "kitchen_wall")]
    others = [it for it in items if not (isinstance(it, dict) and it.get("type") in ("kitchen_base", "kitchen_wall"))]
    if not kitchen:
        return items
    groups: dict = {}
    order: list = []
    for it in kitchen:
        k = _kitchen_group_key(it)
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(it)
    rows = []
    for k in order:
        grp = sorted(
            groups[k],
            key=lambda it: (it.get("position", {}).get("x", 0) if isinstance(it.get("position"), dict) else 0),
        )
        # Разбиваем на contiguous-участки.
        runs: list[list] = []
        cur: list = []
        for it in grp:
            if not cur:
                cur = [it]
                continue
            prev = cur[-1]
            px = prev.get("position", {}) if isinstance(prev.get("position"), dict) else {}
            cx = it.get("position", {}) if isinstance(it.get("position"), dict) else {}
            prev_x = px.get("x", 0) if _num(px.get("x")) else 0
            prev_z = px.get("z", 0) if _num(px.get("z")) else 0
            cur_x = cx.get("x", 0) if _num(cx.get("x")) else 0
            cur_z = cx.get("z", 0) if _num(cx.get("z")) else 0
            prev_w = prev.get("w", 0) if _num(prev.get("w")) else 0
            prev_m = prev.get("modules", 1) if isinstance(prev.get("modules"), int) else 1
            expected = prev_x + prev_w * prev_m
            if abs(cur_x - expected) <= 5 and abs(cur_z - prev_z) <= 5:
                cur.append(it)
            else:
                runs.append(cur)
                cur = [it]
        if cur:
            runs.append(cur)
        for run in runs:
            if len(run) == 1:
                rows.append(run[0])
                continue
            total = sum(it.get("modules", 1) if isinstance(it.get("modules"), int) else 1 for it in run)
            if total > 6:
                rows.extend(run)
                continue
            merged = copy.deepcopy(run[0])
            merged["modules"] = total
            rows.append(merged)
    # Порядок: низ, верх, остальное (детерминированно).
    rows.sort(key=lambda it: (0 if it.get("type") == "kitchen_base" else 1,
                              (it.get("position") or {}).get("x", 0) if isinstance(it.get("position"), dict) else 0))
    return rows + others


def _align_kitchen(items: list) -> None:
    """Выровнять верх над низом ( inplace на копии) + правила цеха.

    Низ: lift=0, top=True. Верх: lift=1400, plinth=0, top=False.
    Верх получает тот же левый край x и ту же спинку z, что у низа.
    """
    bases = [it for it in items if isinstance(it, dict) and it.get("type") == "kitchen_base"]
    walls = [it for it in items if isinstance(it, dict) and it.get("type") == "kitchen_wall"]
    for b in bases:
        b["lift"] = 0
        b["top"] = True
        b["rotationY"] = 0
    for w in walls:
        w["lift"] = 1400
        w["plinth"] = 0
        w["top"] = False
        w["rotationY"] = 0
    if not bases or not walls:
        return
    def _pos(it):
        p = it.get("position") if isinstance(it.get("position"), dict) else {}
        return (p.get("x", 0) if _num(p.get("x")) else 0,
                p.get("z", 0) if _num(p.get("z")) else 0)
    anchor = min(bases, key=lambda it: _pos(it)[0])
    ax, az = _pos(anchor)
    ad = anchor.get("d", 560) if _num(anchor.get("d")) else 560
    for w in walls:
        wd = w.get("d", 320) if _num(w.get("d")) else 320
        w["position"] = {"x": ax, "z": az + (wd - ad) / 2}


def normalize_projects(projects: list) -> list:
    """Нормализация списка проектов от ИИ: компакт -> ряды -> выравнивание.

    Чистая функция: возвращает новый список, вход не меняется.
    """
    if not isinstance(projects, list):
        return []
    out = []
    for proj in projects:
        if not isinstance(proj, dict):
            out.append(proj)
            continue
        p = copy.deepcopy(proj)
        expanded = _expand_compact_project(p)
        if expanded is not None:
            p = expanded
        items = p.get("items")
        if isinstance(items, list) and items and all(isinstance(it, dict) and "type" in it for it in items):
            p["items"] = _merge_kitchen_rows(copy.deepcopy(items))
            _align_kitchen(p["items"])
        out.append(p)
    return out


def generate(prompt: str, current: dict, mode: str = "generate", images=None) -> dict:
    """Собирает проекты. Возвращает {projects, questions, attempts}.

    images — опциональный список [{data, media_type}] (base64), уходит в провайдер
    в OpenAI vision-формате {type: image_url, image_url: {url: data:...}}.
    В лог пишутся только счётчик и media_type, без base64.
    """
    cleaned_images = validate_images(images) if images else []
    images_meta = _images_meta(cleaned_images)
    if not prompt or not prompt.strip():
        raise AiError("Введите описание")
    # Угловая кухня — этап 6, сейчас только прямая. Не даём ИИ развалить раскладку.
    low = prompt.lower()
    if any(k in low for k in ("углов", "буквой г", "г-образ", "вдоль левой стены", "вдоль задней стены и")):
        _log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": mode,
              "prompt": prompt[:500], "attempt": 0, "ok": True,
              "images": len(cleaned_images), "image_media": images_meta,
              "questions": ["corner_not_supported"]})
        return {"projects": [], "questions": [
            "Угловая кухня (буквой Г) пока не поддерживается — это этап 6. "
            "Сделайте прямую кухню вдоль одной стены: укажите ширину, "
            "число нижних и верхних модулей."
        ], "attempts": 0}
    settings = ai_settings.load()
    system = _system_prompt(mode)
    if cleaned_images:
        system += ("\nОператор прикрепил фото комнаты или образца. Учти пропорции, "
                   "цвета и компоновку на фото, но размеры бери из текста/проекта.")
    user_text = (
        f"Пожелания оператора:\n{prompt.strip()}\n\n"
        f"Текущий проект:\n{json.dumps(current, ensure_ascii=False)}"
    )
    user_content = build_user_content(user_text, images)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    last_errors: list[str] = []
    for attempt in (1, 2):
        start = time.time()
        try:
            raw = _call_provider(settings, messages)
        except AiError as e:
            _log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": mode,
                  "prompt": prompt[:500], "attempt": attempt, "ok": False,
                  "images": len(cleaned_images), "image_media": images_meta,
                  "error": str(e)})
            raise
        try:
            data = extract_json(raw)
        except (AiError, json.JSONDecodeError) as e:
            errors = [f"Не JSON: {e}"]
            projects, questions = [], None
        else:
            projects, questions = _as_project_list(data)
            if questions:
                _log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": mode,
                      "prompt": prompt[:500], "attempt": attempt, "ok": True,
                      "images": len(cleaned_images), "image_media": images_meta,
                      "questions": questions, "ms": int((time.time() - start) * 1000)})
                return {"projects": [], "questions": questions, "attempts": attempt}
            projects = normalize_projects(projects)
            errors = []
            errors.extend(_compact_schema_errors(projects))
            for p in projects:
                errors.extend(validate_project(p))
            if not projects:
                errors.append("ИИ вернул пустой список проектов")
        _log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": mode,
              "prompt": prompt[:500], "attempt": attempt, "ok": not errors,
              "images": len(cleaned_images), "image_media": images_meta,
              "errors": errors[:5], "raw": raw[:2000], "ms": int((time.time() - start) * 1000)})
        if not errors:
            return {"projects": projects, "questions": None, "attempts": attempt}
        last_errors = errors
        if attempt == 1:
            # Один автоматический повтор с описанием ошибок (ТЗ п. 7.5).
            messages.append({"role": "assistant", "content": raw[:4000]})
            messages.append({"role": "user", "content":
                "Твой прошлый ответ не прошёл проверку. Ошибки:\n- " + "\n- ".join(errors[:8])
                + "\nИсправь и верни только JSON по схеме."})
    raise AiError("ИИ дважды выдал некорректный проект: " + "; ".join(last_errors[:3]))


def test_connection() -> dict:
    """Быстрая проверка ключа/модели: крошечный запрос."""
    settings = ai_settings.load()
    messages = [{"role": "user", "content": "Ответь одним словом: ok"}]
    start = time.time()
    try:
        raw = _call_provider(settings, messages)
    except AiError as e:
        _log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": "test", "ok": False, "error": str(e)})
        return {"ok": False, "error": str(e)}
    _log({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": "test", "ok": True,
          "ms": int((time.time() - start) * 1000)})
    return {"ok": True, "answer": raw[:100]}
