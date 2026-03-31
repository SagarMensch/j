import os
import time
from playwright.sync_api import sync_playwright

DOWNLOAD_DIR = "schneider_manuals"
START_URL = "https://www.se.com/in/en/download/"
MAX_DOCS = 40

def run():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
    print("Starting Schneider Electric Interactive Browser...")
    with sync_playwright() as p:
        # Launch Chrome visibly so you can watch and interact!
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        
        print(f"Navigating to {START_URL}")
        page.goto(START_URL, wait_until="networkidle")
        
        # Accept SE cookies automatically
        try:
            print("Accepting cookies if present...")
            # Try to click the OneTrust cookie accept button
            cookie_btn = page.locator("button#onetrust-accept-btn-handler, button:has-text('Accept All Cookies')").first
            if cookie_btn.is_visible(timeout=5000):
                cookie_btn.click()
        except Exception:
            pass
            
        print("\n" + "="*70)
        print("▶️  PAUSING FOR YOU TO SEARCH!")
        print("Please use the Google Chrome window that just opened.")
        print("Click 'Explore by product category' or type your search query.")
        print("Filter the results until you see exactly the documents you want.")
        print("="*70 + "\n")
        
        # Wait for the user to hit ENTER in the terminal
        input("✅ Press ENTER here in the terminal when your results are loaded and ready to download!")
        
        print("\nScanning the page for PDF download links...")
        
        # On Schneider, PDF downloads are usually hosted on download.schneider-electric.com
        # Or they have hrefs pointing to .pdf files
        links_elements = page.locator("a[href]").all()
        
        download_urls = []
        # Find all valid document links
        for el in links_elements:
            href = el.get_attribute("href")
            if href and ("download.schneider-electric.com" in href or href.lower().endswith(".pdf")):
                if href not in download_urls:
                    download_urls.append(href)
                    
        print(f"Found {len(download_urls)} document links on your screen!")
        
        if len(download_urls) == 0:
            print("No document downloads found! Make sure you didn't click into a page that has no actual files.")
            browser.close()
            return
            
        print("Initiating automatic downloads...")
        
        downloaded = 0
        for i, url in enumerate(download_urls):
            if downloaded >= MAX_DOCS:
                break
                
            print(f"[{i+1}/{len(download_urls)}] Fetching: {url.split('/')[-1][:40]}...")
            
            try:
                # Use contextual request to download binary and bypass viewers
                resp = context.request.get(url, timeout=15000)
                if resp.ok:
                    # Snag the filename from the headers or URL
                    cd = resp.headers.get("content-disposition", "")
                    filename = f"schneider_manual_{downloaded+1}.pdf"
                    if "filename=" in cd:
                        filename = cd.split("filename=")[1].strip('"\'')
                    else:
                        safe_name = url.split("/")[-1].split("?")[0]
                        if safe_name.endswith(".pdf"):
                            filename = safe_name
                            
                    # Clean filename
                    safe_filename = "".join([c for c in filename if c.isalpha() or c.isdigit() or c in ' .-_']).strip()
                    filepath = os.path.join(DOWNLOAD_DIR, safe_filename)
                    
                    with open(filepath, "wb") as f:
                        f.write(resp.body())
                        
                    print(f"  -> Success! Saved to {filepath}")
                    downloaded += 1
                else:
                    print(f"  -> Expected document but got HTTP {resp.status}")
            except Exception as e:
                print(f"  -> Error: {str(e)[:60]}")
                time.sleep(1) # Backoff
                
        print(f"\n🎉 Finished downloading {downloaded} curated Schneider manuals to your '{DOWNLOAD_DIR}' folder!")
        browser.close()

if __name__ == "__main__":
    run()
