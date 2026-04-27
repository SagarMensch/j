import os
import time
from playwright.sync_api import sync_playwright

DOWNLOAD_DIR = "equipment_manuals"
# The exact URL from your screenshot
SEARCH_URL = "https://sieportal.siemens.com/en-ww/search?scope=knowledgebase&Type=siePortal&SearchTerm=&SortingOption=CreationDateDesc&EntryTypes=Manual&Page=0&PageSize=40"

def run():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
    print("Starting Playwright Browser...")
    with sync_playwright() as p:
        # Launch Chrome visibly so you can watch it click and navigate!
        # Set headless=True if you want it to run invisibly in the background.
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        
        print(f"Navigating to {SEARCH_URL}")
        # Wait until network is idle to ensure Siemens JavaScript finishes rendering the page
        page.goto(SEARCH_URL, wait_until="networkidle")
        
        try:
            cookie_btn = page.locator("button", has_text="Accept All Cookies").first
            if cookie_btn.is_visible(timeout=3000):
                cookie_btn.click()
                print("Accepted cookies on search page.")
        except Exception:
            pass
            
        # Give it a few extra seconds for the result list to fully populate
        time.sleep(5)
        
        print("Extracting manual links from the search page...")
        # Find all anchor tags that point to document details (like in your screenshots)
        links_elements = page.query_selector_all("a[href*='/cs/document/']")
        hrefs = []
        for el in links_elements:
            href = el.get_attribute("href")
            if href and "/cs/document/" in href and href not in hrefs:
                hrefs.append(href)
                
        # Fix relative vs absolute URLs
        final_urls = []
        for href in hrefs:
            if href.startswith("/"):
                final_urls.append("https://support.industry.siemens.com" + href)
            elif href.startswith("http"):
                final_urls.append(href)
                
        print(f"Found {len(final_urls)} manuals on the page!")
        
        downloaded = 0
        for i, url in enumerate(final_urls):
            print(f"\n[{i+1}/{len(final_urls)}] Visiting: {url}")
            
            detail_page = context.new_page()
            try:
                detail_page.goto(url, wait_until="networkidle", timeout=30000)
                time.sleep(3) # Wait for the download box to render
                
                try:
                    cookie_btn = detail_page.locator("button", has_text="Accept All Cookies").first
                    if cookie_btn.is_visible(timeout=1000):
                        cookie_btn.click()
                        time.sleep(1)
                except Exception:
                    pass
                
                # Look for the exact "PDF document" text link shown in your second screenshot
                pdf_link = detail_page.locator("a", has_text="PDF document").first
                
                if pdf_link.is_visible():
                    print("  -> Found 'PDF document' link! Forcing native download...")
                    
                    try:
                        # Force Chrome to download instead of opening PDF viewer & prevent new tabs
                        pdf_link.evaluate("node => node.removeAttribute('target')")
                        pdf_link.evaluate("node => node.setAttribute('download', '')")
                        
                        with detail_page.expect_download(timeout=20000) as download_info:
                            pdf_link.click(force=True)
                        
                        download = download_info.value
                        filename = os.path.join(DOWNLOAD_DIR, download.suggested_filename)
                        download.save_as(filename)
                        
                        print(f"  -> Success! Saved to {filename}")
                        downloaded += 1
                    except Exception as e:
                        print(f"  -> Download Failed or Timed out: {str(e)[:80]}")
                else:
                    print("  -> No 'PDF document' link found on this page.")
                    
            except Exception as e:
                print(f"  -> Failed: {str(e)[:100]}")
            finally:
                detail_page.close()

            if downloaded >= 40: # Stop if we hit 40
                break
                
        print(f"\n🎉 Finished! Downloaded {downloaded} Siemens manuals.")
        browser.close()

if __name__ == "__main__":
    run()
