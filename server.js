const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const XLSX = require('xlsx');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Scrapers
// Helper to perform login once
async function loginToEtfCheck(browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    await page.setViewport({ width: 375, height: 812 });

    console.log("[ETFCheck Auth] Starting Pre-login...");
    try {
        await page.goto('https://www.etfcheck.co.kr/mobile/global/etpitem/F00000PMNI/compose#top', { waitUntil: 'networkidle2', timeout: 60000 });

        const inputs = await page.$$('input');
        if (inputs.length > 0) {
            await page.type('input[type="email"]', 'gtoboy@nate.com');
            await page.type('input[type="password"]', 'qpalzm0024@@');

            const loginBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(b => b.innerText.trim() === '로그인');
            });

            if (loginBtn) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { }),
                    loginBtn.click()
                ]);
                console.log("[ETFCheck Auth] Login Successful.");
            }
        } else {
            console.log("[ETFCheck Auth] Already logged in or no inputs.");
        }
    } catch (e) {
        console.error("[ETFCheck Auth] Error:", e.message);
    } finally {
        await page.close();
    }
}

// Optimized Scraper for ETFCheck (Assumes login is done)
// maxItems: if provided, limits to N items and adds "기타" for remaining percentage
async function scrapeEtfCheck(page, url, id, totalAmount = 0, maxItems = 0) {
    console.log(`[${id}] Navigating...`);
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    await page.setViewport({ width: 375, height: 812 });

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for data (Login should be preserved)
        try {
            await page.waitForSelector('table tbody tr', { timeout: 10000 });
        } catch (e) {
            console.log(`[${id}] Table not found (Login lost?).`);
        }

        // Scroll
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight > 3000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 50);
            });
        });
        await new Promise(r => setTimeout(r, 2000));

    } catch (e) {
        console.log(`[${id}] Error:`, e.message);
    }

    // Title Extraction
    let title = "ETFCheck Fund";
    try {
        title = await page.evaluate(() => {
            const t = document.querySelector('.instrument-name')?.innerText || document.title;
            return t.split('|')[0].trim();
        });
    } catch (e) { }

    // Default Titles
    const defaults = {
        'ace': "ACE 구글밸류체인액티브",
        'tiger': "TIGER미국테크TOP10채권혼합",
        'kodex': "KODEX 미국성장커버드콜액티브",
        'wisdomtree': "WisdomTree U.S. Quality Dividend Growth Fund (DGRW)",
        'etf_hx77': "Neos Nasdaq 100 High Income ETF (QQQI)",
        'etf_mve2': "Schwab U.S. Dividend Equity ETF (SCHD)",
        'etf_mqes': "Neos S&P 500 High Income ETF (QDVO)",
        'etf_vr1y': "Invesco S&P 500 Momentum ETF (SPMO)",
        'sol_mix': "SOL 미국배당채권혼합50"
    };
    if (defaults[id]) title = defaults[id];

    let data = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr')).slice(4); // Remove top 4
        return rows.map((row) => {
            const cols = Array.from(row.querySelectorAll('td'));
            if (cols.length < 3) return null;
            const infoText = cols[0].innerText;
            const weightRaw = cols[2].innerText.split('\n')[0]; // Split by newline
            const infoLines = infoText.split('\n');
            let code = infoLines[0];
            let name = infoLines.length > 2 ? infoLines[2] : infoLines[0];
            return { code, name, qty: "-", amount: "-", weight: weightRaw.replace('%', '').trim() };
        }).filter(r => r && r.code).map((r, i) => ({ ...r, no: (i + 1).toString() }));
    });

    // If maxItems is set, limit to N items and add "기타" for remaining percentage
    if (maxItems > 0 && data && data.length > 0) {
        const topItems = data.slice(0, maxItems);
        const topSum = topItems.reduce((sum, item) => sum + parseFloat(item.weight || 0), 0);
        const otherWeight = Math.max(0, 100 - topSum);

        // Re-number items
        topItems.forEach((item, idx) => {
            item.no = (idx + 1).toString();
        });

        // Add "기타" as the next item if there's remaining percentage
        if (otherWeight > 0.01) {
            topItems.push({
                no: (topItems.length + 1).toString(),
                code: '기타',
                name: 'Others (기타)',
                qty: '-',
                amount: '-',
                weight: otherWeight.toFixed(2)
            });
        }

        data = topItems;
        console.log(`[${id}] Limited to ${topItems.length} items, 기타: ${otherWeight.toFixed(2)}%`);
    }

    // Calculate amounts based on weight if totalAmount is provided
    if (totalAmount > 0 && data) {
        console.log(`[${id}] Calculating amounts with Total: ${totalAmount}`);
        data = data.map(item => {
            const weight = parseFloat(item.weight);
            if (!isNaN(weight)) {
                const calAmount = Math.floor(totalAmount * (weight / 100));
                item.amount = calAmount.toLocaleString('ko-KR') + "원";
            }
            return item;
        });
        title += ` (${totalAmount.toLocaleString('ko-KR')}원)`;
    }

    return { id, title, components: data };
}

// Helper to fetch total amount from Google Sheets
async function fetchTotalAmount(cell, sheetName = '계좌정보') {
    try {
        const url = `https://docs.google.com/spreadsheets/d/18-fow21K94Xkb1iR2pCQfZYut9DxUPdKHZNam87odk4/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&range=${cell}`;
        const response = await fetch(url);
        const text = await response.text();
        const cleanText = text.replace(/[\"\\s₩,]/g, '');
        const amount = parseInt(cleanText, 10);
        return isNaN(amount) ? 0 : amount;
    } catch (e) {
        console.error(`Failed to fetch total amount from ${cell}:`, e.message);
        return 0;
    }
}

// Scrapers
const scrapers = {
    ace: async (page) => {
        const total = await fetchTotalAmount('D26');
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/483340/compose', 'ace', total, 15);
    },
    tiger: async (page) => {
        const total = await fetchTotalAmount('D22');
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/472170/compose', 'tiger', total, 15);
    },
    kodex: async (page) => {
        const total = await fetchTotalAmount('D28');
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/0144L0/compose', 'kodex', total, 15);
    },
    capital: async (page) => {
        console.log("[Capital] Downloading Excel...");
        const totalAmount = await fetchTotalAmount('D41'); // CGDV

        let title = "Capital Group Dividend Value ETF (CGDV)";
        let data = [];

        try {
            // Download Excel file from Capital Group API
            const excelUrl = 'https://www.capitalgroup.com/api/investments/investment-service/v1/etfs/cgdv/download/daily-holdings?audience=advisor&redirect=true';
            const response = await fetch(excelUrl);

            if (!response.ok) {
                throw new Error(`Failed to download Excel: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });

            // Find "Daily Fund Holdings" sheet
            const sheetName = workbook.SheetNames.find(name => name.includes('Daily Fund Holdings')) || workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Convert sheet to JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            // Find header row with "Ticker" and "Percent of Net Assets"
            let headerRowIndex = -1;
            let tickerColIndex = -1;
            let weightColIndex = -1;
            let nameColIndex = -1;

            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (Array.isArray(row)) {
                    const tickerIdx = row.findIndex(cell => cell && String(cell).toLowerCase().includes('ticker'));
                    const weightIdx = row.findIndex(cell => cell && String(cell).toLowerCase().includes('percent of net assets'));
                    const nameIdx = row.findIndex(cell => cell && (String(cell).toLowerCase().includes('security name') || String(cell).toLowerCase().includes('name')));

                    if (tickerIdx !== -1 && weightIdx !== -1) {
                        headerRowIndex = i;
                        tickerColIndex = tickerIdx;
                        weightColIndex = weightIdx;
                        nameColIndex = nameIdx !== -1 ? nameIdx : 0;
                        break;
                    }
                }
            }

            if (headerRowIndex === -1) {
                console.log("[Capital] Could not find header row in Excel");
                throw new Error("Header row not found");
            }

            console.log(`[Capital] Found headers at row ${headerRowIndex}: Ticker=${tickerColIndex}, Weight=${weightColIndex}, Name=${nameColIndex}`);

            // Extract data rows
            for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!Array.isArray(row) || row.length === 0) continue;

                const ticker = row[tickerColIndex];
                const weight = row[weightColIndex];
                const name = row[nameColIndex];

                // Skip empty rows or non-stock entries
                if (!ticker || String(ticker).trim() === '' || String(ticker).trim() === '-') continue;

                let weightValue = parseFloat(String(weight).replace('%', '').trim());
                if (isNaN(weightValue) || weightValue <= 0) continue;

                // Excel has weights as decimals (e.g., 0.0597 = 5.97%), convert to percentage
                if (weightValue < 1) {
                    weightValue = weightValue * 100;
                }

                data.push({
                    no: data.length + 1,
                    code: String(ticker).trim(),
                    name: name ? String(name).trim() : String(ticker).trim(),
                    qty: '-',
                    amount: '-',
                    weight: weightValue.toFixed(2)
                });
            }

            console.log(`[Capital] Parsed ${data.length} holdings from Excel`);

            // Filter out "Total" row and take top 10, then add "기타" for the rest
            data = data.filter(item =>
                !String(item.code).toLowerCase().includes('total') &&
                !String(item.name).toLowerCase().includes('total')
            );

            // Sort by weight descending and take top 10
            data.sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight));

            const top10 = data.slice(0, 10);
            const top10Sum = top10.reduce((sum, item) => sum + parseFloat(item.weight), 0);
            const otherWeight = Math.max(0, 100 - top10Sum);

            // Re-number top 10
            top10.forEach((item, idx) => {
                item.no = idx + 1;
            });

            // Add "기타" as item 11
            if (otherWeight > 0) {
                top10.push({
                    no: 11,
                    code: '기타',
                    name: 'Others (기타)',
                    qty: '-',
                    amount: '-',
                    weight: otherWeight.toFixed(2)
                });
            }

            data = top10;
            console.log(`[Capital] Top 10 + 기타: ${data.length} items, 기타 weight: ${otherWeight.toFixed(2)}%`);

        } catch (e) {
            console.error("[Capital] Excel parsing error:", e.message);
            data = [];
        }

        // Apply Custom Calculation for Capital if totalAmount exists
        if (totalAmount > 0 && data.length > 0) {
            data = data.map(item => {
                const weight = parseFloat(item.weight);
                if (!isNaN(weight)) {
                    const calAmount = Math.floor(totalAmount * (weight / 100));
                    item.amount = calAmount.toLocaleString('ko-KR') + "원";
                }
                return item;
            });
            title += ` (${totalAmount.toLocaleString('ko-KR')}원)`;
        }

        return { id: 'capital', title, components: data };
    },
    wisdomtree: async (page) => {
        const total = await fetchTotalAmount('D39'); // DGRW
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00000PMNI/compose#top', 'wisdomtree', total, 15);
    },
    etf_hx77: async (page) => {
        const total = await fetchTotalAmount('D45'); // QQQI
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00001HX77/compose', 'etf_hx77', total, 15);
    },
    etf_mve2: async (page) => {
        const total = await fetchTotalAmount('D37'); // SCHD (Updated to D37)
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00000MVE2/compose', 'etf_mve2', total, 15);
    },
    etf_mqes: async (page) => {
        const total = await fetchTotalAmount('D47'); // QDVO
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00001MQES/compose', 'etf_mqes', total, 15);
    },
    etf_vr1y: async (page) => {
        const total = await fetchTotalAmount('D43'); // SPMO
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00000VR1Y/compose', 'etf_vr1y', total, 15);
    },
    sol_mix: async (page) => {
        const total = await fetchTotalAmount('D35'); // SOL Mix
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/490490/compose', 'sol_mix', total, 15);
    },
    custom_googl: async (page) => {
        const total = await fetchTotalAmount('D49'); // GOOGL Direct
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_googl',
            title: 'Alphabet Inc. (GOOGL) Direct',
            components: [{
                no: '1',
                code: 'GOOGL',
                name: 'Alphabet Inc. Class A',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_bonds_extra: async (page) => {
        const val1 = await fetchTotalAmount('D66');
        const val2 = await fetchTotalAmount('D51');
        const total = val1 + val2;
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_bonds_extra',
            title: 'Additional Bonds (D66+D51)',
            components: [{
                no: '1',
                code: '국고채권 기타', // "국고채권" keyword ensures aggregation to "채권"
                name: 'Korea Treasury Bond (D66+D51)',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_reits: async (page) => {
        const val1 = await fetchTotalAmount('D15');
        const val2 = await fetchTotalAmount('D19');
        const total = val1 + val2;
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_reits',
            title: 'REITs Aggregated (D15+D19)',
            components: [{
                no: '1',
                code: '리츠',
                name: 'Real Estate Investment Trusts (Aggregated)',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_cash: async (page) => {
        const val1 = await fetchTotalAmount('E4', '26년01월'); // Existing
        const val2 = await fetchTotalAmount('C11', '26년01월'); // Added C11
        const total = val1 + val2;
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_cash',
            title: 'KRW Cash (26년01월!E4+C11)',
            components: [{
                no: '1',
                code: '원화현금',
                name: 'KRW Cash',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_real_estate: async (page) => {
        const total = await fetchTotalAmount('G23', '26년01월'); // Real Estate
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_real_estate',
            title: 'Real Estate (26년01월!G23)',
            components: [{
                no: '1',
                code: '부동산',
                name: 'Real Estate',
                weight: '100',
                amount: amountStr
            }]
        };
    }
};

app.get('/api/constituents', async (req, res) => {
    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    // Use system Chromium if available (Docker environment)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const browser = await puppeteer.launch(launchOptions);

    try {
        // Perform Helper Login First
        await loginToEtfCheck(browser);

        // Helper to run a scraper in its own page context
        const runScraper = async (scraperFn, name) => {
            let page = null;
            try {
                page = await browser.newPage();
                await page.setViewport({ width: 1280, height: 800 });
                // Optimization: block images/fonts
                await page.setRequestInterception(true);
                page.on('request', (req) => {
                    if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                        req.abort();
                    } else {
                        req.continue();
                    }
                });

                return await scraperFn(page);
            } catch (err) {
                console.error(`[${name}] Error:`, err.message);
                return { id: name.toLowerCase(), title: `${name} (Error)`, components: [], error: err.message };
            } finally {
                if (page) await page.close().catch(() => { });
            }
        };

        console.log("Starting parallel scrapes...");
        const results = await Promise.all([
            runScraper(scrapers.ace, "ACE"),
            runScraper(scrapers.tiger, "Tiger"),
            runScraper(scrapers.kodex, "Kodex"),
            runScraper(scrapers.capital, "Capital"),
            runScraper(scrapers.wisdomtree, "WisdomTree"),
            runScraper(scrapers.etf_hx77, "ETF_HX77"),
            runScraper(scrapers.etf_mve2, "ETF_MVE2"),
            runScraper(scrapers.etf_mqes, "ETF_MQES"),
            runScraper(scrapers.etf_vr1y, "ETF_VR1Y"),
            runScraper(scrapers.sol_mix, "SOL_MIX"),
            runScraper(scrapers.custom_bonds_extra, "CUSTOM_BONDS_EXTRA"),
            runScraper(scrapers.custom_reits, "CUSTOM_REITS"),
            runScraper(scrapers.custom_cash, "CUSTOM_CASH"),
            runScraper(scrapers.custom_real_estate, "CUSTOM_REAL_ESTATE"),
            runScraper(scrapers.custom_googl, "CUSTOM_GOOGL")
        ]);

        const successfulData = results.filter(r => r !== null);

        // Check if all failed
        if (successfulData.length === 0 && results.length > 0) {
            throw new Error("All scrapers failed.");
        }

        res.json({ success: true, data: successfulData });

    } catch (error) {
        console.error("Global Scrape Error:", error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        await browser.close().catch(e => console.error("Error closing browser:", e));
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
