import sys
sys.path.insert(0, 'backend')
from app.services.sop_retrieval import get_sop_retriever
retriever = get_sop_retriever()

# Test semantic search only
semantic = retriever._semantic_search("What PPE is required for hazardous materials", k=5)
print("Semantic search results:")
for s in semantic[:3]:
    print(f"  ID: {s.get('chunk_id')}")
    print(f"  Page: {s.get('page_start')}")
    print(f"  bbox_x0: {s.get('bbox_x0')}")
    print(f"  bbox_y0: {s.get('bbox_y0')}")
    print(f"  bbox_x1: {s.get('bbox_x1')}")
    print(f"  bbox_y1: {s.get('bbox_y1')}")
    print()