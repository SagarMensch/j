import sys

# The structure expects 'app' to be importable
# So we need to add backend to path and import app directly
sys.path.insert(0, r"C:\Users\ratho\Sequelstring AI\ingrevia\backend")

from app.core.config import get_settings

settings = get_settings()
print(f"Settings loaded. Postgres: {settings.has_postgres_credentials}")