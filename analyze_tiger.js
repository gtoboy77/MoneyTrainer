const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        const url = 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7472170000';
        console.log(`Navigating to ${url}...`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Look for "구성종목" or similar tabs
        // Mirae Asset usually has tabs.
        console.log("Page loaded. Dumping meaningful text to find 'Constituents' tab...");

        // Check for "PDF" or "구성종목" tab text
        const tabs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a, button, li')).map(el => el.innerText.trim()).filter(t => t.includes('구성종목') || t.includes('PDF'));
        });
        console.log("Potential tabs:", tabs);

        // Try to click "구성종목" if it exists
        try {
            const constituentTab = await page.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('ul.tab_type1 li a, .tab_area a')).find(el => el.innerText.includes('구성종목') || el.innerText.includes('PDF'));
            });

            if (constituentTab) {
                console.log("Found constituent tab. Clicking...");
                await constituentTab.click();
                await new Promise(r => setTimeout(r, 2000)); // Wait for data load
            }
        } catch (e) {
            console.log("Error clicking tab:", e.message);
        }

        // Try to find a table
        const tableData = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            const results = [];
            tables.forEach((table, idx) => {
                const rows = Array.from(table.querySelectorAll('tbody tr'));
                const data = rows.map(r => Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim()));
                if (data.length > 0) {
                    results.push({ tableIndex: idx, sample: data.slice(0, 3) });
                }
            });
            return results;
        });

        console.log("Tables found:", JSON.stringify(tableData, null, 2));

        // Title
        const title = await page.evaluate(() => document.title);
        console.log("Title:", title);

        await browser.close();

    } catch (error) {
        console.error('An error occurred:', error);
    }
})();
