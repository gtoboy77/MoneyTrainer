const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR,ko']
    });
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to TradingView...");
        await page.goto('https://kr.tradingview.com/symbols/NASDAQ-DGRW/holdings/', { waitUntil: 'networkidle2', timeout: 60000 });

        const title = await page.title();
        console.log("Title:", title);

        // Scroll to trigger lazy usage
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight || totalHeight > 3000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        // Wait a bit after scroll
        await new Promise(r => setTimeout(r, 2000));

        // Look for div-based tables (TradingView often uses them) or any table
        const pageText = await page.evaluate(() => document.body.innerText);
        console.log("Has Microsoft?", pageText.includes("Microsoft"));

        const tables = await page.evaluate(() => {
            // Try standard table
            const stdTables = Array.from(document.querySelectorAll('table')).map(t => ({
                type: 'table',
                headers: Array.from(t.querySelectorAll('th')).map(h => h.innerText),
                rows: t.querySelectorAll('tr').length,
                sample: t.innerText.substring(0, 100)
            }));

            // Try div-based structure common in modern apps
            // Look for repeated class patterns
            return stdTables;
        });
        console.log("Tables Object:", JSON.stringify(tables, null, 2));

        // Attempt to extract rows based on text content if table not found
        if (tables.length === 0) {
            console.log("No standard tables found. Dumping likely row elements...");
            const textRows = await page.evaluate(() => {
                const divs = Array.from(document.querySelectorAll('div'));
                // Find divs that contain "MSFT" or "Microsoft"
                const microDivs = divs.filter(d => d.innerText.includes('Microsoft') && d.innerText.length < 200);
                return microDivs.map(d => ({
                    tag: d.tagName,
                    class: d.className,
                    text: d.innerText
                }));
            });
            console.log("Potential Rows:", JSON.stringify(textRows.slice(0, 5), null, 2));
        }

        // Dump first few rows
        const firstRows = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr')).slice(0, 5);
            return rows.map(row => {
                return Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim().replace(/\n/g, '|'));
            });
        });
        console.log("First 5 Rows:", JSON.stringify(firstRows, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
