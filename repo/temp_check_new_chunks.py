import json

filepath = r"kaggle\working\chunks_with_embeddings (1).json"
with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"Count: {len(data)}")
print(f"Keys: {list(data[0].keys())}")
print(f"Embedding len: {len(data[0].get('embedding', []))}")
print(f"Sample doc_code: {set(c.get('doc_code') for c in data[:50])}")
