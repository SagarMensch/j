import sys
sys.path.insert(0, 'backend')
from app.db.postgres import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT dc.id, dc.page_start, dc.content
        FROM document_chunks dc
        JOIN document_revisions dr ON dc.revision_id = dr.id
        JOIN documents d ON dr.document_id = d.id
        WHERE d.code = 'SMP-MNT-002' AND dc.content ILIKE '%HARDNESS AND DISSOLVED METALS%'
        LIMIT 5
    """))
    print("Hardness chunk:")
    for row in result:
        print(f"page_start: {row[1]}")
        print(f"Content: {row[2][:500]}...")
        print()
        # Check for page numbers in content
        import re
        pages = re.findall(r'Page (\d+)', row[2])
        print(f"Page references in content: {pages}")