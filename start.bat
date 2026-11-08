@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Мебель 3D

where python >nul 2>nul
if errorlevel 1 (
  echo Python не найден. Установите его с python.org и запустите start.bat снова.
  pause
  exit /b 1
)

if not exist .venv (
  echo Первый запуск: создаю окружение и ставлю зависимости, это займёт минуту...
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

echo Запускаю приложение на http://127.0.0.1:8765 ...
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8765"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8765
