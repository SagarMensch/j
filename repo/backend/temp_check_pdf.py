import os
import sys
from sqlalchemy import create_engine, text

# Add current dir to path to import app if needed
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from server import engine

with engine.connect() as conn:
    row = conn.execute(
        text(
            """
            SELECT dr.id, dr.file_path, d.source_filename
            FROM document_revisions dr
            JOIN documents d ON d.id = dr.document_id
            WHERE dr.id = '0ca28298-fedb-46c0-8ca8-39f92d33fd5a'
            """
        )
    ).mappings().first()
    
    print("Row:", dict(row) if row else "Not found")
