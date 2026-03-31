import sys
sys.path.insert(0, 'backend')
from app.db.postgres import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT dc.id, dc.page_start, dc.bbox_x0, dc.bbox_y0, dc.bbox_x1, dc.bbox_y1, 
               dc.content, d.code as doc_code
        FROM document_chunks dc
        JOIN document_revisions dr ON dc.revision_id = dr.id
        JOIN documents d ON dr.document_id = d.id
        WHERE dc.content ILIKE '%required%PPE%' 
           OR dc.content ILIKE '%PPE%required%'
           OR dc.content ILIKE '%wear%PPE%'
           OR dc.content ILIKE '%personal protective equipment%required%'
        ORDER BY dc.page_start
        LIMIT 5
    """))
    print("Chunks with specific PPE requirements:")
    for row in result:
        print(f"Doc: {row[7]}, Page: {row[1]}, BBox: ({row[2]}, {row[3]}) to ({row[4]}, {row[5]})")
        print(f"Content: {row[6][:500]}...")
        print()
        print("-" * 50)