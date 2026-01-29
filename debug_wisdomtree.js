const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    try {
        console.log("Navigating...");
        await page.goto('https://www.wisdomtree.com/investments/etfs/equity/dgrw', { waitUntil: 'networkidle2', timeout: 60000 });

        const title = await page.title();
        console.log("Title:", title);

        // Check for common holdings to see if data is present
        const pageText = await page.evaluate(() => document.body.innerText);
        console.log("Has Microsoft?", pageText.includes("Microsoft"));

        // Try to find and click "View All Holdings"
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('a, button, div[role="button"], span'));
            const target = buttons.find(el => el.innerText.trim().includes('View All Holdings') || el.innerText.trim().includes('All Holdings'));
            if (target) {
                target.click();
                return true;
            }
            return false;
        });
        console.log("Clicked 'View All Holdings'?", clicked);

        if (clicked) {
            console.log("Waiting for table to update...");
            await new Promise(r => setTimeout(r, 5000));
        }

        // Look for any table
        const tables = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('table')).map((t, i) => ({
                index: i,
                id: t.id,
                class: t.className,
                rows: t.rows.length,
                firstRowParams: t.rows.length > 0 ? t.rows[0].innerText.replace(/\n/g, '|') : 'empty'
            }));
        });
        console.log("Tables found:", JSON.stringify(tables, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
