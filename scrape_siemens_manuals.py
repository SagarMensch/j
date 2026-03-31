import os
import time
import requests
from duckduckgo_search import DDGS

DOWNLOAD_DIR = "equipment_manuals"
MAX_PDFS = 40

# We use a highly targeted query across siemens domains targeting public PDFs
QUERY = 'site:siemens.com filetype:pdf manual'

def download_pdfs():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
    print(f"Searching Public Domain for: {QUERY}\n")
    
    with DDGS() as ddgs:
        # Request up to 100 results to ensure we can get 40 valid PDFs
        results = list(ddgs.text(QUERY, max_results=100))
        
    print(f"Found {len(results)} potential results. Analyzing links and downloading...\n")
    
    downloaded = 0
    for res in results:
        if downloaded >= MAX_PDFS:
            break
            
        url = res.get("href")
        if not url:
            continue
            
        # Clean the title to make a valid Windows filename
        title = res.get("title", f"Siemens_Manual_{downloaded+1}")
        safe_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c in ' -']).strip()
        if not safe_title:
            safe_title = f"Siemens_Manual_{downloaded+1}"
            
        filename = os.path.join(DOWNLOAD_DIR, f"{safe_title[:80]}.pdf")
        
        # Skip if we already downloaded it
        if os.path.exists(filename):
            continue
            
        print(f"[{downloaded+1}/{MAX_PDFS}] Checking: {safe_title}...")
        try:
            # Mask as a standard browser
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            
            # Use stream=True to quickly verify Content-Type before downloading large files
            r = requests.get(url, headers=headers, stream=True, timeout=15)
            
            # Verify it's actually a PDF
            content_type = r.headers.get("Content-Type", "").lower()
            if "application/pdf" in content_type or ".pdf" in url.lower():
                with open(filename, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=1024*1024): # 1MB chunks
                        if chunk:
                            f.write(chunk)
                downloaded += 1
                print(f"  -> SUCCESS! Saved to: {filename}")
                time.sleep(0.5) # Polite delay
            else:
                print(f"  -> Skipped: Not a PDF (Type: {content_type})")
                
        except Exception as e:
            print(f"  -> Error or Time-out: {str(e)[:50]}")

    print(f"\nDone! Successfully downloaded {downloaded} Siemens manuals for your POC to the '{DOWNLOAD_DIR}' folder.")

if __name__ == "__main__":
    download_pdfs()
