import requests

# Quick test of the chunk endpoint
chunk_id = "dc9ba783-f247-4941-bf7d-f34fe6858674"
url = f"http://localhost:8000/api/chunks/{chunk_id}/content"

try:
    resp = requests.get(url, timeout=10)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"Page: {data['page']['page_number']}")
        print(f"BBox: ({data.get('bbox_x0')}, {data.get('bbox_y0')}) to ({data.get('bbox_x1')}, {data.get('bbox_y1')})")
        print(f"Content: {data['page']['raw_text'][:150]}...")
    else:
        print(resp.text)
except Exception as e:
    print(f"Error: {e}")
