import sys
import os

# Add backend directory to path - this makes 'app' importable
sys.path.insert(0, r"C:\Users\ratho\Sequelstring AI\ingrevia\backend")
os.chdir(r"C:\Users\ratho\Sequelstring AI\ingrevia")

# Now import the app directly (app is under backend/ directory)
from app.core.config import get_settings
from server import app

if __name__ == "__main__":
    import uvicorn
    print("Starting backend server...")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )