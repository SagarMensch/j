@echo off
setlocal
set "REPO_ROOT=%~dp0"

echo Starting Ingreia demo services...
echo.

start "Ingreia Backend" cmd /k "cd /d ""%REPO_ROOT%"" && call run_backend.bat"
start "Ingreia Frontend" cmd /k "cd /d ""%REPO_ROOT%frontend-nextjs"" && npm run dev"

echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3000
echo.
echo Use this script for the demo. Keep both windows open.

endlocal
