import requests

# Test basic connectivity
try:
    resp = requests.get("http://localhost:8000/", timeout=5)
    print(f"Root endpoint: {resp.status_code}")
except Exception as e:
    print(f"Root error: {e}")

# Test health endpoint
try:
    resp = requests.get("http://localhost:8000/api/health", timeout=5)
    print(f"Health endpoint: {resp.status_code}")
except Exception as e:
    print(f"Health error: {e}")