# -*- coding: utf-8 -*-
"""Тесты экспорта (этап 3): автономный HTML содержит только свой проект."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import exporter, projects  # noqa: E402
from app.schema import validate_project  # noqa: E402

ITEM = {
    "id": "i1", "type": "wardrobe",
    "position": {"x": 0, "z": 0}, "rotationY": 0,
    "w": 1000, "h": 2200, "d": 550, "t": 16, "plinth": 80,
    "modules": 1, "shelves": 4, "front": "doors2", "drawers": 3,
    "top": False, "lift": 0,
    "corpus": "white", "facade": "sonoma", "handle": "bar160",
}

PROJECT = {
    "version": 1, "id": "p1", "name": "Шкаф для Айгуль", "client": "Айгуль",
    "notes": "", "items": [ITEM],
    "room": {"enabled": True, "width": 3600, "depth": 3200, "height": 2700,
             "wallTexture": "paint_white", "floorTexture": "laminate_oak",
             "windows": [{"wall": "back", "x": 800, "width": 1200, "height": 1300, "sill": 900}]},
    "price": {"total": 150000, "currency": "KZT", "lines": []},
}


def test_export_settings_defaults_hide_cutlist():
    cfg = exporter.default_settings(PROJECT)
    assert cfg["showCutlist"] is False  # по ответу оператора: скрыть
    assert cfg["allowColorSwitch"] is True
    assert "sonoma" in cfg["allowedColors"]


def test_export_html_is_autonomous():
    html = exporter.build_client_html(PROJECT, exporter.default_settings(PROJECT))
    data = html.encode("utf-8")
    assert len(data) < 15 * 1024 * 1024
    assert "Шкаф для Айгуль" in html
    assert "window.__PROJECT__" in html and '"id": "p1"' in html
    assert "127.0.0.1" not in html and "localhost" not in html
    assert "/api/projects" not in html  # нет ссылок на локальный сервер
    assert "Кухня для Айгуль" not in html  # нет чужих проектов
    # Регрессия: three.core без рендера давал пустую страницу.
    # В бандле должен быть WebGLRenderer из three.module.js.
    assert "WebGLRenderer" in html and "PMREMGenerator" in html
    # Регрессия 2: дубли buildBed/buildTable (bed.js + index.js) давали
    # SyntaxError и пустую страницу; алиас bedBuild должен разрешаться.
    assert html.count("function buildBed(") == 1
    assert html.count("function buildTable(") == 1
    assert "const buildBed = bedBuild" not in html
    assert "const buildTable = tableBuild" not in html
    assert "const bedBuild = buildBed" in html
    assert "const tableBuild = buildTable" in html
    # Регрессия 3: пол комнаты и земля в одной плоскости y=0 (рябь),
    # AA/DPR на телефоне, сглаженные метки размеров.
    assert "groundPlane.visible" in html
    assert "antialias: true" in html
    assert "plankTexture" in html


def test_export_respects_settings():
    with_cut = exporter.build_client_html(PROJECT, {**exporter.default_settings(PROJECT), "showCutlist": True})
    without_cut = exporter.build_client_html(PROJECT, exporter.default_settings(PROJECT))
    assert "Деталировка" in with_cut  # заголовок панели в шаблоне есть всегда? проверяем данные
    # Важно: деталировка считается в клиенте, но настройка уходит в SETTINGS
    assert '"showCutlist": true' in with_cut
    assert '"showCutlist": false' in without_cut
    assert '"allowColorSwitch": true' in with_cut


def test_export_password_hash_not_plain():
    html = exporter.build_with_password(PROJECT, exporter.default_settings(PROJECT), "secret123")
    assert "secret123" not in html
    assert '"passwordHash"' in html
    assert exporter.password_hash("secret123") in html
    # Тот же хэш считается в JS (FNV-1a) — проверяем детерминированность
    assert exporter.password_hash("secret123") == exporter.password_hash("secret123")
    assert exporter.password_hash("secret123") != exporter.password_hash("wrong")


def test_export_validation_and_write(monkeypatch, tmp_path):
    monkeypatch.setattr(projects, "DATA_DIR", tmp_path / "data")
    data = projects.create("Кухня")
    full = dict(data, items=[dict(ITEM, type="kitchen_base", w=600, h=720, d=560)])
    # save требует валидный проект
    projects.save(data["id"], full)
    path = projects.write_export(data["id"], "<html>test</html>")
    assert path.exists() and path.read_text(encoding="utf-8") == "<html>test</html>"
    assert projects.export_path(data["id"]) == path
    # Битый settings в validate_project
    assert any("allowedColors" in e for e in validate_project(dict(full, export={"allowedColors": "sonoma"})))
    assert validate_project(full) == []


def test_export_api_via_testclient(monkeypatch, tmp_path):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setattr(projects, "DATA_DIR", tmp_path / "data")
    data = projects.create("Шкаф")
    full = dict(data, items=[ITEM])
    projects.save(data["id"], full)
    client = TestClient(app)
    res = client.post(f"/api/projects/{data['id']}/export", json={"showCutlist": True})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/html")
    assert "Шкаф" in res.text
    assert '"showCutlist": true' in res.text
    assert res.headers.get("content-disposition", "").endswith("-client.html\"")
    # Предпросмотр отдаёт тот же файл
    prev = client.get(f"/api/projects/{data['id']}/export/preview")
    assert prev.status_code == 200
    assert "Шкаф" in prev.text
    # Несуществующий проект — 404
    assert client.post("/api/projects/nope/export", json={}).status_code == 404
