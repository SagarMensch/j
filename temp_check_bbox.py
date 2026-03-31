import sys
sys.path.insert(0, 'backend')
from app.db.postgres import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT id, page_start, bbox_x0, bbox_y0, bbox_x1, bbox_y1 
        FROM document_chunks 
        WHERE id = 'b4c25f6e-0bc7-4820-90c1-0b5d0f6dc73c'
    """)).fetchone()
    print(f"ID: {result[0]}")
    print(f"Page: {result[1]}")
    print(f"BBox: ({result[2]}, {result[3]}) to ({result[4]}, {result[5]})")