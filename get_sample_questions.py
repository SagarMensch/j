import sys
import json
from pathlib import Path

REPO_ROOT = Path(r"c:\Users\ratho\Sequelstring AI\ingrevia").resolve()
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.db.postgres import engine
from sqlalchemy import text

def fetch_sample_chunks():
    samples = []
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT d.code, dc.content 
            FROM document_chunks dc 
            JOIN document_revisions dr ON dr.id = dc.revision_id 
            JOIN documents d ON d.id = dr.document_id 
            WHERE length(dc.content) > 300 
            ORDER BY RANDOM() 
            LIMIT 5
        """)).mappings()
        for row in rows:
            samples.append({"code": row['code'], "content": row['content']})
            
    with open("sample_chunks.json", "w") as f:
        json.dump(samples, f, indent=2)

if __name__ == "__main__":
    fetch_sample_chunks()
