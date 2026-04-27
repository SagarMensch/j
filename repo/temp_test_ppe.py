import sys
sys.path.insert(0, 'backend')
from app.services.sop_retrieval import get_sop_retriever

retriever = get_sop_retriever()
result = retriever.query(query_text='What PPE is required for hazardous materials', language='en', role='operator', user_id=None, top_k=3)

print("Query: What PPE is required for hazardous materials")
print("=" * 60)
for i, ev in enumerate(result['evidence']):
    print(f"\nEvidence {i+1}:")
    print(f"  Document: {ev.get('document_code')}")
    print(f"  Page: {ev.get('page_start')}")
    print(f"  BBox: ({ev.get('bbox_x0')}, {ev.get('bbox_y0')}) to ({ev.get('bbox_x1')}, {ev.get('bbox_y1')})")
    print(f"  Content preview: {ev.get('content', '')[:200]}...")