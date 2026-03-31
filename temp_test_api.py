import requests

url = "http://localhost:8000/api/query"
data = {
    "query": "safety",
    "language": "en",
    "role": "operator"
}

try:
    resp = requests.post(url, json=data, timeout=30)
    result = resp.json()
    print("Status:", resp.status_code)
    print("Evidence count:", len(result.get('evidence', [])))
    if result.get('evidence'):
        ev = result['evidence'][0]
        print("First evidence bbox:", ev.get('bbox_x0'), ev.get('bbox_y0'), ev.get('bbox_x1'), ev.get('bbox_y1'))
except Exception as e:
    print(f"Error: {e}")