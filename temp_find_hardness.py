import sys
sys.path.insert(0, 'backend')
from app.db.postgres import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT dc.id, dc.page_start, dc.content, d.code as doc_code
        FROM document_chunks dc
        JOIN document_revisions dr ON dc.revision_id = dr.id
        JOIN documents d ON dr.document_id = d.id
        WHERE dc.content ILIKE '%hardness%' OR dc.content ILIKE '%cubitainer%'
        ORDER BY dc.page_start
        LIMIT 10
    """))
    print("Chunks with hardness content:")
    for row in result:
        print(f"Doc: {row[3]}, Page: {row[1]}")
        print(f"Content: {row[2][:300]}...")
        print()