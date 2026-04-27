import sys
import os

os.chdir(r"C:\Users\ratho\Sequelstring AI\ingrevia")
sys.path.insert(0, r"C:\Users\ratho\Sequelstring AI\ingrevia")
os.environ["PYTHONPATH"] = r"C:\Users\ratho\Sequelstring AI\ingrevia"

# Test imports
try:
    from backend.server import app
    print("Import successful!")
except Exception as e:
    print(f"Import error: {e}")
    import traceback
    traceback.print_exc()