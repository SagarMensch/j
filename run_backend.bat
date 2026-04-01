@echo off
setlocal
set "REPO_ROOT=%~dp0"

if exist "%REPO_ROOT%.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%REPO_ROOT%.venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

cd /d "%REPO_ROOT%backend"
"%PYTHON_EXE%" -m uvicorn server:app --host 0.0.0.0 --port 8000
