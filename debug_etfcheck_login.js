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

    try {
        console.log("Navigating to ETFCheck login page...");
        // Usually redirects to login if not authenticated, or we can find login button
        await page.goto('https://www.etfcheck.co.kr/mobile/global/etpitem/F00000PMNI/compose#top', { waitUntil: 'networkidle2', timeout: 60000 });

        // Check if we are on login page or see login inputs
        console.log("Checking for login inputs...");
        const inputs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('input')).map(i => ({
                type: i.type,
                name: i.name,
                placeholder: i.placeholder,
                id: i.id
            }));
        });
        console.log("Inputs found:", JSON.stringify(inputs, null, 2));

        if (inputs.length > 0) {
            console.log("Attempting Login...");

            // Try to find email and password inputs
            await page.type('input[type="email"], input[name="email"], input[placeholder*="이메일"]', 'gtoboy@nate.com');
            await page.type('input[type="password"]', 'qpalzm0024@@');

            // Click login button
            const loginClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a'));
                const loginBtn = buttons.find(b => b.innerText.trim() === '로그인' || b.innerText.includes('Log In'));
                if (loginBtn) {
                    loginBtn.click();
                    return true;
                }
                return false;
            });
            console.log("Login button clicked:", loginClicked);

            if (loginClicked) {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log("Navigation timeout or already handled"));
                console.log("Post-login title:", await page.title());
            }
        }

        console.log("Waiting for data...");
        await new Promise(r => setTimeout(r, 5000));

        // Scroll to load data
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

        // Dump data
        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log("Has Microsoft?", bodyText.includes('Microsoft') || bodyText.includes('MSFT'));

        // Try to capture table rows
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

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
})();
