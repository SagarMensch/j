import json

chunks = json.load(open('kaggle/working/chunks_with_embeddings.json', 'r'))

ppe_terms = ['PPE', 'PROTECTIVE', 'SAFETY GOGGLES', 'SAFETY GLOVES', 'HELMET', 'RESPIRATOR', 'FACE SHIELD', 'OVERALLS']
ppe_chunks = []
for c in chunks:
    text_upper = c['chunk_text'].upper()
    for term in ppe_terms:
        if term in text_upper:
            ppe_chunks.append(c)
            break

print(f'Found {len(ppe_chunks)} chunks with PPE-related terms')
for c in ppe_chunks[:5]:
    print(f"\nDoc: {c.get('doc_code')}, Page {c['page_number']}")
    print(f"BBox: ({c.get('bbox_x0')}, {c.get('bbox_y0')}) to ({c.get('bbox_x1')}, {c.get('bbox_y1')})")
    print(f"Content: {c['chunk_text'][:400]}...")