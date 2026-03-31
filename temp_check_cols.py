import sys
sys.path.insert(0, 'backend')
from app.db.postgres import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' and table_name = 'document_chunks' ORDER BY ordinal_position"))
    print("Columns in document_chunks:")
    for row in result:
        print(f"  {row[0]}: {row[1]}")