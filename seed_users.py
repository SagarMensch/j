import sys
from pathlib import Path
from sqlalchemy import text

REPO_ROOT = Path(r"c:\Users\ratho\Sequelstring AI\ingrevia").resolve()
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.config import get_settings
settings = get_settings()

from sqlalchemy import create_engine
from urllib.parse import quote_plus
import uuid

pw = quote_plus(settings.POSTGRES_PASSWORD)
dsn = f"postgresql+psycopg://{settings.POSTGRES_USER}:{pw}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
eng = create_engine(dsn)

def seed_users():
    try:
        raw_conn = eng.raw_connection()
        cursor = raw_conn.cursor()
        
        # Check if users exist
        cursor.execute("SELECT id FROM users LIMIT 1")
        if cursor.fetchone():
            print("Users already exist. Skipping seed.")
        else:
            print("Seeding departments and users...")
            
            # Departments
            dept_prod = str(uuid.uuid4())
            dept_qual = str(uuid.uuid4())
            dept_log = str(uuid.uuid4())
            
            cursor.execute("INSERT INTO departments (id, name) VALUES (%s, %s), (%s, %s), (%s, %s)",
                           (dept_prod, "Production", dept_qual, "Quality", dept_log, "Logistics"))
            
            # Users
            op_id = "00000000-0000-0000-0000-000000000001"
            admin_id = "00000000-0000-0000-0000-000000000002"
            
            cursor.execute("""
                INSERT INTO users (id, employee_code, full_name, email, role, preferred_language, department_id)
                VALUES 
                (%s, %s, %s, %s, %s, %s, %s),
                (%s, %s, %s, %s, %s, %s, %s)
            """, (
                op_id, "EMP001", "Aarav Sharma", "aarav@ingrevia.com", "operator", "en", dept_prod,
                admin_id, "ADM001", "Admin User", "admin@ingrevia.com", "admin", "en", dept_qual
            ))
            
            raw_conn.commit()
            print("Users and Departments seeded successfully.")
            
        cursor.close()
        raw_conn.close()
    except Exception as e:
        print(f"Error seeding users: {e}")

if __name__ == "__main__":
    seed_users()
