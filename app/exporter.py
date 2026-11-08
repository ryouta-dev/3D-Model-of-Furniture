# -*- coding: utf-8 -*-
"""Сборка автономного HTML для клиента (этап 3, ТЗ п. 8).

Один файл со всем внутри: three.js, генераторы, комната, просмотрщик,
JSON проекта. Никаких ссылок на локальный сервер, ключи и чужие проекты.
three.core.js и генераторы — ES-модули; для автономного файла мы
преобразуем их в классические скрипты (убираем import/export),
чтобы файл открывался без сборки и без интернета.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"
THREE_CORE = STATIC / "vendor" / "three" / "three.core.js"
THREE_MODULE = STATIC / "vendor" / "three" / "three.module.js"

GENERATOR_FILES = [
    STATIC / "js" / "generators" / "common.js",
    STATIC / "js" / "room.js",
    STATIC / "js" / "generators" / "corpus.js",
    STATIC / "js" / "generators" / "corner.js",
    STATIC / "js" / "generators" / "sliding.js",
    STATIC / "js" / "generators" / "bed.js",
    STATIC / "js" / "generators" / "table.js",
    STATIC / "js" / "generators" / "index.js",
    STATIC / "js" / "generators" / "cutlist.js",
]
CLIENT_JS = STATIC / "js" / "export-client.js"

MAX_SIZE = 15 * 1024 * 1024  # целевой размер по ТЗ — до 15 МБ


def password_hash(password: str) -> str:
    """FNV-1a 32-бит — простая защита на стороне клиента, не полноценная.

    Клиентский JS считает тот же хэш; пароль в экспорте не лежит открытым
    текстом, но обойти проверку может любой, посмотрев исходник страницы.
    Это честно так и указано в интерфейсе.
    """
    h = 0x811C9DC5
    for ch in password.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def default_settings(project: dict) -> dict:
    colors = []
    for it in project.get("items", []):
        for key in ("facade", "corpus"):
            v = it.get(key)
            if v and v not in colors:
                colors.append(v)
    return {
        "showCutlist": False,
        "allowColorSwitch": True,
        "allowedColors": colors or ["white", "sonoma", "walnut", "graphite"],
        "showRoom": True,
        "showPrice": False,
        "passwordHash": None,
    }


def normalize_settings(project: dict, raw: dict | None) -> dict:
    data = default_settings(project)
    if isinstance(raw, dict):
        for key in ("showCutlist", "allowColorSwitch", "showRoom", "showPrice"):
            if isinstance(raw.get(key), bool):
                data[key] = raw[key]
        if isinstance(raw.get("allowedColors"), list) and raw["allowedColors"]:
            data["allowedColors"] = [c for c in raw["allowedColors"] if isinstance(c, str) and c]
        if isinstance(raw.get("passwordHash"), str) and raw["passwordHash"]:
            data["passwordHash"] = raw["passwordHash"]
    return data


def _export_names(text: str) -> list[str]:
    names: list[str] = []
    for m in re.finditer(r"export\s*\{([^}]+)\}", text, re.S):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            # alias вида "A as B" — берём экспортируемое имя B
            name = part.split(" as ")[-1].strip()
            if name not in names:
                names.append(name)
    return names


def _import_names(text: str) -> list[str]:
    names: list[str] = []
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*'[^']+'", text, re.S):
        for part in m.group(1).split(","):
            part = part.strip()
            if part:
                names.append(part)
    return names


def _bundle_three() -> str:
    """Собирает three.js в классический скрипт.

    three.core.js без WebGLRenderer и PMREMGenerator — их даёт
    three.module.js. Поэтому бандлим оба файла, каждый в своей IIFE,
    чтобы внутренние имена (например _m1$1) не сталкивались.
    """
    core_text = THREE_CORE.read_text(encoding="utf-8")
    core_names = _export_names(core_text)
    core_body = re.sub(r"export\s*\{[^}]+\}\s*;", "", core_text, flags=re.S)
    core_bundle = ";\n(function(){\n" + core_body + "\n;window.THREE = {" + ",".join(core_names) + "};\n})();\n"

    mod_text = THREE_MODULE.read_text(encoding="utf-8")
    mod_names = [n for n in _export_names(mod_text) if n not in core_names]
    import_names = _import_names(mod_text)
    mod_body = re.sub(r"import\s*\{[^}]+\}\s*from\s*'[^']+';", "", mod_text, flags=re.S)
    mod_body = re.sub(r"export\s*\{[^}]+\}(?:\s*from\s*'[^']+')?\s*;", "", mod_body, flags=re.S)
    destructure = "const {" + ",".join(import_names) + "} = window.THREE;\n" if import_names else ""
    mod_bundle = ";\n(function(){\n" + destructure + mod_body + "\n;Object.assign(window.THREE, {" + ",".join(mod_names) + "});\n})();\n"
    return core_bundle + "\n" + mod_bundle


def _strip_es(text: str, rename_clamp: bool = False, declared_funcs: set | None = None) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("import "):
            # Импорт вида { A as B } превращается в алиас на глобал бандла
            # (файлы идут в порядке зависимостей); { A } — уже глобал, пропускаем.
            m = re.match(r"import\s*\{([^}]+)\}\s*from\s*'[^']+'", stripped)
            if m:
                for part in m.group(1).split(","):
                    part = part.strip()
                    if " as " in part:
                        orig, local = [p.strip() for p in part.split(" as ", 1)]
                        indent = line[: len(line) - len(line.lstrip())]
                        lines.append(f"{indent}const {local} = {orig};")
            continue
        if stripped.startswith("export {"):
            # export { A as B } — в классическом бандле имя уже глобал, строка не нужна.
            continue
        if stripped.startswith("export "):
            body = stripped[len("export "):]
            # export const buildBed = bedBuild — дубль функции из bed.js (уже глобал).
            # Такие алиасы-эксспорты пропускаем, иначе SyntaxError: already declared.
            m = re.match(r"const\s+([A-Za-z_$][\w$]*)\s*=", body)
            if m and declared_funcs and m.group(1) in declared_funcs:
                continue
            # export const/function/class -> оставить декларацию как есть
            line = line[: len(line) - len(line.lstrip())] + body
        lines.append(line)
    out = "\n".join(lines)
    if rename_clamp:
        # В three.core.js есть свой clamp; в corpus.js — свой. Разводим имена,
        # чтобы не было коллизии в классическом скрипте.
        out = out.replace("function clamp(", "function corpusClamp(")
        out = out.replace("clamp(1000", "corpusClamp(1000")
        out = out.replace("clamp(-dh", "corpusClamp(-dh")
    return out


def _bundle_generators() -> str:
    texts = [(path, path.read_text(encoding="utf-8")) for path in GENERATOR_FILES]
    # Все function-объявления бандла: их имена уже глобалы, алиас-экспорты
    # с такими именами (buildBed/buildTable из index.js) — дубли, их режем.
    declared_funcs: set[str] = set()
    for _, text in texts:
        declared_funcs.update(re.findall(r"function\s+([A-Za-z_$][\w$]*)\s*\(", text))
    parts = []
    for path, text in texts:
        is_corpus = path.name == "corpus.js"
        parts.append(_strip_es(text, rename_clamp=is_corpus, declared_funcs=declared_funcs))
    return "\n".join(parts)


_CLIENT_CSS = """
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: #f2f1ed; color: #26221c; font: 15px/1.45 "Segoe UI", system-ui, sans-serif; }
body.night { background: #101214; color: #e8e6e1; }
header { padding: 12px 16px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 20px; margin: 0; }
#price { font-weight: 600; color: #b07d2b; }
#gate { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
#gate .card { background: #fff; color: #222; border-radius: 12px; padding: 20px; width: min(92vw, 360px); }
#gate input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 8px; }
#gate button { width: 100%; margin-top: 8px; padding: 8px; background: #d8a24a; border: 0; border-radius: 8px; font-weight: 600; }
#view-wrap { position: relative; height: calc(100vh - 140px); height: calc(100dvh - 140px); min-height: 320px; }
#view { position: absolute; inset: 0; }
#view canvas { display: block; touch-action: none; }
#toolbar { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
button { font: inherit; background: #fff; border: 1px solid #d8d4cc; border-radius: 8px; padding: 7px 12px; cursor: pointer; }
body.night button { background: #181b1e; }
#colors { padding: 10px 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.swatch { width: 30px; height: 30px; border-radius: 8px; cursor: pointer; border: 2px solid transparent; outline: 1px solid #ccc; }
.swatch.sel { border-color: #d8a24a; }
.dim-label { position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0; background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 2px 7px; font-size: 12px; white-space: nowrap; }
#cut-panel { padding: 16px; }
#cut-panel table { width: 100%; border-collapse: collapse; font-size: 13px; }
#cut-panel th, #cut-panel td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e3e0d8; }
.hidden { display: none !important; }
.hint { padding: 0 16px 12px; color: #888; font-size: 13px; }
/* --- Адаптив под телефон --- */
#toolbar { max-width: calc(100% - 24px); }
button:focus-visible, .swatch:focus-visible, input:focus-visible { outline: 2px solid #d8a24a; outline-offset: 2px; }
button { -webkit-tap-highlight-color: transparent; }
@media (max-width: 640px) {
  body { font-size: 14px; }
  header { padding: 8px 12px; gap: 8px; }
  h1 { font-size: 15px; }
  #price { font-size: 14px; }
  #view-wrap { height: calc(100vh - 118px); height: calc(100dvh - 118px); min-height: 260px; }
  /* Тулбар — две строки кнопок на всю ширину, а не горизонтальная лента:
     на телефоне листать ленту вслепую неудобно, кнопки должны быть видны. */
  #toolbar { left: 0; right: 0; bottom: 0; max-width: none; padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px)); gap: 6px; flex-wrap: wrap; justify-content: center; overflow-x: visible; background: rgba(255,255,255,0.92); -webkit-overflow-scrolling: touch; }
  body.night #toolbar { background: rgba(16,18,20,0.92); }
  #toolbar button { min-height: 44px; padding: 10px 12px; font-size: 14px; border-radius: 10px; flex: 1 1 28%; max-width: 45%; }
  #colors { padding: 8px 12px; overflow-x: auto; flex-wrap: nowrap; }
  #colors span { flex: 0 0 auto; }
  .swatch { width: 44px; height: 44px; border-radius: 10px; flex: 0 0 auto; }
  .dim-label { font-size: 11px; padding: 3px 6px; }
  .hint { font-size: 12px; padding: 0 12px 16px; }
  #cut-panel { padding: 12px; overflow-x: auto; }
  #cut-panel table { font-size: 12px; min-width: 320px; }
  #gate input { padding: 12px; font-size: 16px; } /* 16px — без автозума при фокусе */
  #gate button { padding: 12px; font-size: 16px; min-height: 48px; }
}
@media (max-height: 500px) and (orientation: landscape) {
  #view-wrap { height: calc(100vh - 60px); height: calc(100dvh - 60px); min-height: 200px; }
  header { padding: 6px 12px; }
  button { min-height: 40px; padding: 8px 12px; }
}
"""


def _custom_bundle(project: dict) -> str:
    """Свои декоры/ручки из библиотеки, используемые проектом (этап 5)."""
    try:
        from . import library as _lib
        decors = _lib.list_kind("decors")
        handles = _lib.list_kind("handles")
    except Exception:
        return ""
    used_colors = {it.get(k) for it in project.get("items", []) for k in ("corpus", "facade")}
    used_handles = {it.get("handle") for it in project.get("items", [])}
    lines = []
    for d in decors:
        if d.get("id") in used_colors:
            lines.append(f"COLORS.push({{id: {json.dumps(d['id'])}, name: {json.dumps(d.get('name',''))}, hex: {json.dumps(d.get('hex','#cccccc'))}}});")
    for h in handles:
        if h.get("id") in used_handles:
            lines.append(f"HANDLES.push({{id: {json.dumps(h['id'])}, name: {json.dumps(h.get('name',''))}, length: {int(h.get('length') or 160)}}});")
    return "\n".join(lines)


def build_client_html(project: dict, settings: dict) -> str:
    """Собирает автономный HTML. project — данные project.json."""
    three_js = _bundle_three()
    gen_js = _bundle_generators() + "\n" + _custom_bundle(project)
    client_js = CLIENT_JS.read_text(encoding="utf-8")
    proj_json = json.dumps(project, ensure_ascii=False)
    set_json = json.dumps(settings, ensure_ascii=False)
    title = (project.get("name") or "Проект").replace("<", "&lt;").replace(">", "&gt;")

    html = (
        "<!doctype html>\n<html lang=\"ru\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{title} — 3D</title>\n"
        f"<style>{_CLIENT_CSS}</style>\n</head>\n<body>\n"
        "<div id=\"gate\" class=\"hidden\"><div class=\"card\">"
        "<h2>Пароль</h2><p>Введите пароль для просмотра проекта.</p>"
        "<input id=\"gate-input\" type=\"password\" autocomplete=\"off\">"
        "<button id=\"gate-btn\">Открыть</button>"
        "<p id=\"gate-msg\" style=\"color:#b04a3a\"></p>"
        "</div></div>\n"
        "<header><h1 id=\"proj-title\"></h1><span id=\"price\" class=\"hidden\"></span></header>\n"
        "<div id=\"view-wrap\"><div id=\"view\"></div>"
        "<div id=\"toolbar\">"
        "<button id=\"btn-open\">Открыть двери</button>"
        "<button id=\"btn-fit\">Вписать</button>"
        "<button id=\"btn-day\">Ночь</button>"
        "<button id=\"btn-room\">Комната: вкл</button>"
        "<button id=\"btn-dims\">Показать размеры</button>"
        "</div></div>\n"
        "<div id=\"colors\" class=\"hidden\"><span>Цвет фасадов:</span></div>\n"
        "<section id=\"cut-panel\" class=\"hidden\"><h2>Деталировка</h2><div id=\"cut\"></div></section>\n"
        "<p class=\"hint\">Вращайте модель мышью или пальцем, масштаб — колесом или щипком. "
        "Клик по двери открывает её. Это презентационная страница, не редактор.</p>\n"
        f"<script>window.__PROJECT__ = {proj_json};</script>\n"
        f"<script>window.__SETTINGS__ = {set_json};</script>\n"
        f"<script>{three_js}</script>\n"
        f"<script>{gen_js}</script>\n"
        f"<script>{client_js}</script>\n"
        "</body>\n</html>\n"
    )
    if len(html.encode("utf-8")) > MAX_SIZE:
        raise ValueError(f"Экспорт получился больше 15 МБ ({len(html.encode('utf-8')) // 1024 // 1024} МБ) — отключите деталировку или обратитесь к разработчику")
    return html


def build_with_password(project: dict, settings: dict, password: str | None) -> str:
    cfg = normalize_settings(project, settings)
    if password:
        cfg["passwordHash"] = password_hash(password)
    return build_client_html(project, cfg)
