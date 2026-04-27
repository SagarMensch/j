import subprocess
import sys
import os

os.chdir(r"C:\Users\ratho\Sequelstring AI\ingrevia")
os.environ["PYTHONPATH"] = r"C:\Users\ratho\Sequelstring AI\ingrevia"

python_exe = r"C:\Users\ratho\Sequelstring AI\ingrevia\.venv\Scripts\python.exe"

proc = subprocess.Popen(
    [python_exe, "-m", "uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8000"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
print(f"Started backend with PID: {proc.pid}")