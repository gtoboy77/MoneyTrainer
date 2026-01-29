import requests
from bs4 import BeautifulSoup
import re
import json

url = "https://www.aceetf.co.kr/fund/K55101EB6099"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

try:
    print(f"Fetching {url}...")
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    html = response.text
    soup = BeautifulSoup(html, 'html.parser')
    
    print(f"Page Title: {soup.title.string if soup.title else 'No Title'}")
    
    # 1. Search for explicit keywords in text
    keywords = ["구성종목", "PDF", "포트폴리오", "보유종목"]
    found_keywords = [k for k in keywords if k in html]
    print(f"Keywords found in HTML: {found_keywords}")
    
    # 2. Look for potential API calls in script tags
    print("\n--- Scanning <script> tags for API endpoints or data ---")
    scripts = soup.find_all('script')
    for i, script in enumerate(scripts):
        if not script.string: continue
        
        # Look for JSON data or API URLs
        if "K55101EB6099" in script.string:
            print(f"Found code 'K55101EB6099' in script {i}:")
            snippet = script.string[:200].replace('\n', ' ') + "..."
            print(f"  Snippet: {snippet}")
            
            # Try to extract potential API URLs
            urls = re.findall(r'/[a-zA-Z0-9/_?=&.]+', script.string)
            api_candidates = [u for u in urls if 'ajax' in u or 'api' in u or 'json' in u]
            if api_candidates:
                print(f"  Possible API URLs: {api_candidates}")

    # 3. Look for hidden inputs that might carry data
    print("\n--- Scanning Input tags ---")
    inputs = soup.find_all('input')
    for inp in inputs:
        if inp.get('name') in ['fundCd', 'classCd', 'itemCd']:
             print(f"Found input: {inp}")

    # 4. Check typical ACE ETF API patterns
    # Often they use an internal ID. Let's see if we can find one.
    
except Exception as e:
    print(f"Error: {e}")
