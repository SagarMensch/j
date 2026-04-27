import sys
sys.path.insert(0, 'backend')
from app.services.sop_retrieval import get_sop_retriever
import json

retriever = get_sop_retriever()
result = retriever.query(query_text='What PPE is required', language='en', role='operator', user_id=None, top_k=3)

for i, ev in enumerate(result['evidence']):
    print(f"Evidence {i+1}:")
    print(f"  Doc: {ev.get('document_code')}, Page: {ev.get('page_start')}")
    print(f"  bbox_x0: {ev.get('bbox_x0')}, bbox_y0: {ev.get('bbox_y0')}, bbox_x1: {ev.get('bbox_x1')}, bbox_y1: {ev.get('bbox_y1')}")
    print(f"  Content: {ev.get('content', '')[:150]}...")
    print()