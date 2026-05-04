import os
import sys
from sqlalchemy import create_engine, text

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from server import engine

with engine.connect() as conn:
    rows = conn.execute(
        text(
            """
            SELECT d.code, dr.file_path, d.source_filename
            FROM document_revisions dr
            JOIN documents d ON d.id = dr.document_id
            """
        )
    ).mappings().all()
    
    for row in rows:
        print(dict(row))
