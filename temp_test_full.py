import requests
import json

# Test the chunk content endpoint
url = "http://localhost:8000/api/query"
data = {
    "query": "What are the steps to prepare an environmental sample for hardness",
    "language": "en",
    "role": "operator",
    "top_k": 3
}

print("Testing query API...")
try:
    resp = requests.post(url, json=data, timeout=60)
    result = resp.json()
    
    print(f"Answer: {result.get('answer', '')[:200]}")
    print(f"\nEvidence count: {len(result.get('evidence', []))}")
    
    if result.get('evidence'):
        ev = result['evidence'][0]
        chunk_id = ev.get('chunk_id')
        print(f"\nFirst evidence chunk_id: {chunk_id}")
        print(f"Page: {ev.get('page_start')}")
        print(f"BBox: ({ev.get('bbox_x0')}, {ev.get('bbox_y0')}) to ({ev.get('bbox_x1')}, {ev.get('bbox_y1')})")
        
        # Now test the chunk endpoint
        print(f"\n\nTesting chunk endpoint: /api/chunks/{chunk_id}/content")
        chunk_resp = requests.get(f"http://localhost:8000/api/chunks/{chunk_id}/content", timeout=30)
        print(f"Status: {chunk_resp.status_code}")
        if chunk_resp.status_code == 200:
            chunk_data = chunk_resp.json()
            print(f"Page number: {chunk_data.get('page', {}).get('page_number')}")
            print(f"Content preview: {chunk_data.get('page', {}).get('raw_text', '')[:200]}...")
            print(f"BBox from response: ({chunk_data.get('bbox_x0')}, {chunk_data.get('bbox_y0')}) to ({chunk_data.get('bbox_x1')}, {chunk_data.get('bbox_y1')})")
        else:
            print(f"Error: {chunk_resp.text}")
except Exception as e:
    print(f"Error: {e}")
