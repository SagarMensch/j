import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("DATABASE_URL")

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("""
        SELECT dr.id, dr.file_path, d.source_filename
        FROM document_revisions dr
        JOIN documents d ON d.id = dr.document_id
        WHERE dr.id = '0ca28298-fedb-46c0-8ca8-39f92d33fd5a'
    """)
    row = cur.fetchone()
    print("Row:", row)
except Exception as e:
    print("Error:", e)
