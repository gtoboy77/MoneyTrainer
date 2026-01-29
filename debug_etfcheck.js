const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    // Simulate Mobile
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    await page.setViewport({ width: 375, height: 812 });

    // Intercept requests to find API
    const apiRequests = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
            apiRequests.push(req.url());
        }
        req.continue();
    });

    // Capture responses too
    page.on('response', async (response) => {
        const url = response.url();
        if ((url.includes('api') || url.includes('json')) && response.request().resourceType() !== 'image') {
            try {
                const text = await response.text();
                if (text.includes('Microsoft') || text.includes('MSFT')) {
                    console.log("!!! FOUND POTENTIAL API MATCH !!!");
                    console.log("URL:", url);
                    console.log("Snippet:", text.substring(0, 200));
                }
            } catch (e) { }
        }
    });

    try {
        console.log("Navigating to ETFCheck (Mobile)...");
        await page.goto('https://www.etfcheck.co.kr/mobile/global/etpitem/F00000PMNI/compose#top', { waitUntil: 'networkidle2', timeout: 60000 });

        const title = await page.title();
        console.log("Title:", title);

        await new Promise(r => setTimeout(r, 5000));

        // Dump body text to see what's loaded
        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log("Body Text Snippet (first 500 chars):", bodyText.substring(0, 500));
        console.log("Has 'Microsoft'?", bodyText.includes('Microsoft'));
        console.log("Has 'MSFT'?", bodyText.includes('MSFT'));
        console.log("Has '구성종목'?", bodyText.includes('구성종목'));

        // Scroll loop to trigger lazy loading
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight > 4000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 50);
            });
        });
        await new Promise(r => setTimeout(r, 3000));

        // Dump table rows again
        const tables = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('table')).map(t => {
                const headers = Array.from(t.querySelectorAll('th')).map(h => h.innerText.trim());
                const rows = Array.from(t.querySelectorAll('tbody tr')).slice(0, 5).map(r => ({
                    txt: r.innerText.replace(/\n/g, '|'),
                    cells: Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim())
                }));
                return { headers, rows };
            });
        });
        console.log("Tables found:", JSON.stringify(tables, null, 2));

        // Fallback: Check for divs that look like grid rows
        const gridItems = await page.evaluate(() => {
            // Look for Microsoft to find the right container
            const msft = Array.from(document.querySelectorAll('*')).find(el => el.innerText === "MSFT" || el.innerText === "Microsoft Corporation");
            if (!msft) return "Microsoft not found";

            // Traverse up to find the row/container
            let parent = msft.parentElement;
            while (parent && parent.innerText.length < 200) {
                parent = parent.parentElement;
            }

            return parent ? { tag: parent.tagName, class: parent.className, text: parent.innerText } : "Container not identified";
        });
        console.log("Grid Item Analysis:", JSON.stringify(gridItems, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
