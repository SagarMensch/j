import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.config import get_settings
get_settings.cache_clear()
settings = get_settings()

from sqlalchemy import create_engine
from urllib.parse import quote_plus
pw = quote_plus(settings.POSTGRES_PASSWORD)
dsn = f"postgresql+psycopg://{settings.POSTGRES_USER}:{pw}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
eng = create_engine(dsn)

sql_file = REPO_ROOT / "backend" / "sql" / "stage1_supabase_schema.sql"
sql_content = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n" + sql_file.read_text(encoding="utf-8")

try:
    raw_conn = eng.raw_connection()
    cursor = raw_conn.cursor()
    cursor.execute(sql_content)
    raw_conn.commit()
    cursor.close()
    raw_conn.close()
    print("Schema initialized successfully.")
except Exception as e:
    print(f"Error initializing schema: {e}")
    print(f"Error initializing schema: {e}")
