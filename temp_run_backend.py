import subprocess
import sys
import os

# Change to project directory
os.chdir(r"C:\Users\ratho\Sequelstring AI\ingrevia")

# Set environment
env = os.environ.copy()
env["PYTHONPATH"] = r"C:\Users\ratho\Sequelstring AI\ingrevia"

# Use venv python
python = r"C:\Users\ratho\Sequelstring AI\ingrevia\.venv\Scripts\python.exe"

# Start uvicorn
result = subprocess.run(
    [python, "-m", "uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8000"],
    env=env,
    capture_output=True,
    text=True
)

print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)