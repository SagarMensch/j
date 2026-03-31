import os
import time
from playwright.sync_api import sync_playwright

DOWNLOAD_DIR = "equipment_manuals"
URL = "https://www.se.com/in/en/download/doc-group-type/120246088490-Installation+%26+User+Guides/"
MAX_DOCS = 40

def run():
    # Make sure we're dropping them in the same folder as before
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
    print("Starting Fully Automated Schneider Downloader...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        # accept_downloads must be true on the context for background downloads to succeed
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        
        print(f"Navigating to {URL}")
        page.goto(URL, wait_until="load", timeout=60000)
        
        # Give SE a tiny bit of time to render React lists
        time.sleep(3)
        
        # Accept SE Cookies
        try:
            cookie_btn = page.locator("button#onetrust-accept-btn-handler, button:has-text('Accept All Cookies')").first
            if cookie_btn.is_visible(timeout=5000):
                cookie_btn.click()
                print("Accepted Schneider cookies.")
                time.sleep(1)
        except:
            pass
            
        print("Gathering 'Download' buttons on the page...")
        
        # Schneider uses 'a' tags or buttons with 'Download' text for documents.
        # This locator perfectly targets them in a list!
        download_buttons = page.locator("a:has-text('Download'), button:has-text('Download')").all()
        
        print(f"Found {len(download_buttons)} 'Download' buttons. Starting downloads max {MAX_DOCS}...")
        
        downloaded = 0
        for i, btn in enumerate(download_buttons):
            if downloaded >= MAX_DOCS:
                break
                
            print(f"[{downloaded+1}/{MAX_DOCS}] Clicking 'Download' button {i+1}...")
            
            try:
                # Schneider sometimes requires the button to be visibly on screen
                btn.scroll_into_view_if_needed()
                
                # By expecting the download on the **context** instead of the page, 
                # we flawlessly catch downloads even if Schneider triggers them in a "new tab"!
                with context.expect_download(timeout=15000) as download_info:
                    btn.click()
                
                # Retrieve the incoming file stream
                download = download_info.value
                filename = os.path.join(DOWNLOAD_DIR, download.suggested_filename)
                download.save_as(filename)
                
                print(f"  -> Success! Saved native file: {download.suggested_filename}")
                downloaded += 1
                
            except Exception as e:
                error_msg = str(e)
                if "Target closed" in error_msg:
                    print("  -> Failed: Popup was closed randomly before download started.")
                elif "Timeout" in error_msg:
                    print("  -> Failed: Button click timed out without firing a download.")
                else:
                    print(f"  -> Failed: {error_msg[:60]}")
                    
                # Clean up rogue tabs if context.click() opened an empty popup
                if len(context.pages) > 1:
                    context.pages[-1].close()
                
        if downloaded == 0:
            print("\nWARNING: No files downloaded! Schneider might be blocking the clicks or the locator missed the docs.")
        else:
            print(f"\n🎉 Finished automatically downloading exactly {downloaded} manuals to '{DOWNLOAD_DIR}'!")
            
        browser.close()

if __name__ == "__main__":
    run()
