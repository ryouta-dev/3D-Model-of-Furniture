# -*- coding: utf-8 -*-
"""Локальный сервер «Мебель 3D»: API проектов + статика редактора.

Запуск: start.bat (или .venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8765)
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import ai, exporter, library, projects
from . import settings as ai_settings

app = FastAPI(title="Мебель 3D")
STATIC = Path(__file__).resolve().parent / "static"


@app.middleware("http")
async def no_cache_static(request, call_next):
    # JS/CSS/HTML не кэшируем сильно — правки видны после F5, а не после Ctrl+F5.
    resp = await call_next(request)
    if request.url.path.startswith(("/js/", "/css/", "/vendor/")) or request.url.path in ("/", "/index.html"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def _not_found(e: FileNotFoundError):
    raise HTTPException(404, "Проект не найден")


@app.get("/api/projects")
def api_list():
    return projects.list_projects()


@app.post("/api/projects")
def api_create(body: dict):
    return projects.create(body.get("name", ""), body.get("client", ""))


@app.get("/api/projects/{pid}")
def api_get(pid: str):
    try:
        return projects.load(pid)
    except (FileNotFoundError, ValueError) as e:
        _not_found(e)


@app.put("/api/projects/{pid}")
def api_save(pid: str, body: dict):
    try:
        projects.save(pid, body)
    except ValueError as e:
        raise HTTPException(400, detail=e.args[0])  # список ошибок валидации
    except FileNotFoundError:
        raise HTTPException(404, "Проект не найден")
    return {"ok": True}


@app.post("/api/projects/{pid}/duplicate")
def api_duplicate(pid: str):
    try:
        return projects.duplicate(pid)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Проект не найден")


@app.post("/api/projects/{pid}/rename")
def api_rename(pid: str, body: dict):
    try:
        return projects.rename(pid, body.get("name", ""))
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Проект не найден")


@app.delete("/api/projects/{pid}")
def api_delete(pid: str):
    try:
        projects.delete(pid)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Проект не найден")
    return {"ok": True}


@app.post("/api/projects/{pid}/export")
def api_export(pid: str, body: dict | None = None):
    """Собирает автономный HTML для клиента и отдаёт его файлом."""
    try:
        project = projects.load(pid)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Проект не найден")
    body = body or {}
    # Настройки: из тела запроса, иначе из сохранённых в проекте.
    saved = project.get("export") if isinstance(project.get("export"), dict) else {}
    settings = {**saved, **{k: v for k, v in body.items() if k != "password"}}
    password = body.get("password") or None
    try:
        html = exporter.build_with_password(project, settings, password)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    path = projects.write_export(pid, html)
    return FileResponse(
        path,
        media_type="text/html",
        filename=path.name,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


@app.get("/api/projects/{pid}/export/preview")
def api_export_preview(pid: str):
    """Просмотр последнего собранного HTML (локально, до публикации)."""
    try:
        path = projects.export_path(pid)
        if not path.exists():
            raise HTTPException(404, "Сначала создайте HTML для клиента")
        return FileResponse(path, media_type="text/html")
    except ValueError:
        raise HTTPException(404, "Проект не найден")


# --- Библиотека образцов (этап 5) ---

@app.get("/api/library/{kind}")
def api_library_list(kind: str):
    if kind not in ("decors", "handles", "examples"):
        raise HTTPException(404, "Раздел библиотеки не найден")
    return library.list_kind(kind)


@app.post("/api/library/{kind}")
def api_library_add(kind: str, body: dict):
    try:
        if kind == "decors":
            return library.add_decor(body.get("name", ""), body.get("hex", ""),
                                     body.get("photoBase64", ""), body.get("mediaType", ""))
        if kind == "handles":
            return library.add_handle(body.get("name", ""), body.get("description", ""),
                                      body.get("photoBase64", ""), body.get("mediaType", ""),
                                      int(body.get("length") or 160))
        if kind == "examples":
            return library.add_example(body.get("title", ""), body.get("notes", ""),
                                       body.get("photoBase64", ""), body.get("mediaType", ""))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    raise HTTPException(404, "Раздел библиотеки не найден")


@app.get("/api/library/{kind}/{entry_id}/photo")
def api_library_photo(kind: str, entry_id: str):
    if kind not in ("decors", "handles", "examples"):
        raise HTTPException(404, "Раздел библиотеки не найден")
    path = library.photo_path(kind, entry_id)
    if not path:
        raise HTTPException(404, "Фото не найдено")
    return FileResponse(path, media_type=f"image/{path.suffix[1:]}")


@app.delete("/api/library/{kind}/{entry_id}")
def api_library_delete(kind: str, entry_id: str):
    if kind not in ("decors", "handles", "examples"):
        raise HTTPException(404, "Раздел библиотеки не найден")
    library.delete(kind, entry_id)
    return {"ok": True}


# --- Настройки и ИИ (этап 4) ---

@app.get("/api/settings")
def api_settings_get():
    return ai_settings.public()


@app.put("/api/settings")
def api_settings_put(body: dict):
    # Ключ обновляется только если пришло непустое значение.
    if body.get("apiKey"):
        ai_settings.save({**ai_settings.load(), **body})
    else:
        data = {**ai_settings.load(), **{k: v for k, v in body.items() if k != "apiKey"}}
        ai_settings.save(data)
    return ai_settings.public()


@app.post("/api/settings/test")
def api_settings_test():
    return ai.test_connection()


@app.post("/api/ai/generate")
def api_ai_generate(body: dict):
    pid = body.get("pid", "")
    try:
        current = projects.load(pid)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Проект не найден")
    mode = body.get("mode") if body.get("mode") in ("generate", "variants", "edit") else "generate"
    try:
        return ai.generate(body.get("prompt", ""), current, mode, body.get("images"))
    except ai.AiError as e:
        raise HTTPException(400, detail=str(e))


# Статика редактора — монтируем последним, чтобы API имело приоритет.
app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
