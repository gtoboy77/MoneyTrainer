const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // Set viewport to desktop size
        await page.setViewport({ width: 1280, height: 800 });

        const url = 'https://www.aceetf.co.kr/fund/K55101EB6099';
        console.log(`Navigating to ${url}...`);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log("Page loaded. Looking for '구성종목' or 'PDF' tab...");

        // Try to find the button or tab that says "구성종목" or "PDF"
        // The previous analysis showed: <button type="button" title="구성종목(PDF)">구성종목(PDF)</button>

        try {
            const pdfButton = await page.waitForSelector('button[title*="구성종목"]', { timeout: 5000 });
            if (pdfButton) {
                console.log("Found '구성종목' button. Clicking...");
                await pdfButton.click();
                // Wait for some network activity or table update
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            console.log("Could not find specific '구성종목' button, checking if table is already visible...");
        }

        // Wait for table
        console.log("Waiting for table...");
        try {
            await page.waitForSelector('table', { timeout: 10000 });
        } catch (e) {
            console.log("Timeout waiting for table. Dumping page text to debug...");
            const text = await page.evaluate(() => document.body.innerText);
            console.log(text.substring(0, 500));
        }

        // Extract data
        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            return rows.map(row => {
                const columns = Array.from(row.querySelectorAll('td'));
                return columns.map(col => col.innerText.trim());
            }).filter(row => row.length > 0);
        });

        console.log(`Create ${data.length} rows of data.`);
        if (data.length > 0) {
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.log("No data found in table.");
        }

        await browser.close();

    } catch (error) {
        console.error('An error occurred:', error);
    }
})();
