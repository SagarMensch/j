@echo off
setlocal
set "REPO_ROOT=%~dp0"

cd /d "%REPO_ROOT%"

py -3.12 -m venv .venv312
call ".venv312\Scripts\activate.bat"
python -m pip install --upgrade pip setuptools wheel
pip install -r backend\requirements.txt

echo.
echo Python 3.12 backend environment is ready at .venv312
echo Use run_backend.bat or start_demo.bat to start the backend with Python 3.12.

endlocal
