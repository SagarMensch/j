@echo off
set PYTHONPATH=C:\Users\ratho\Sequelstring AI\ingrevia
cd /d C:\Users\ratho\Sequelstring AI\ingrevia
.venv\Scripts\python.exe -m uvicorn backend.server:app --host 0.0.0.0 --port 8000