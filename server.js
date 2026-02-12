const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const app = express();
const port = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));

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

        // Click "모두 보기" button to load all holdings
        try {
            const viewAllBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('a, button, span'));
                return buttons.find(b => b.innerText && b.innerText.trim().includes('모두 보기'));
            });
            if (viewAllBtn && viewAllBtn.asElement()) {
                await viewAllBtn.click();
                console.log(`[${id}] Clicked "모두 보기" button`);
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (e) {
            console.log(`[${id}] No "모두 보기" button found`);
        }

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
        'ace_nvidia': "ACE NVIDIA30블렌드블룸버그",
        'tiger': "TIGER미국테크TOP10채권혼합",
        'kodex': "KODEX 미국성장커버드콜액티브",
        'wisdomtree': "WisdomTree U.S. Quality Dividend Growth Fund (DGRW)",
        'etf_mve2': "Schwab U.S. Dividend Equity ETF (SCHD)",
        'sol_mix': "SOL 미국배당채권혼합50",
        'plus_hbm': "PLUS 글로벌 HBM"
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
    if (totalAmount > 0 && data && data.length > 0) {
        console.log(`[${id}] Calculating amounts with Total: ${totalAmount}`);

        // First pass: calculate amounts with Math.floor()
        let sumOfAmounts = 0;
        data = data.map(item => {
            const weight = parseFloat(item.weight);
            if (!isNaN(weight)) {
                const calAmount = Math.floor(totalAmount * (weight / 100));
                item._numericAmount = calAmount;
                sumOfAmounts += calAmount;
            } else {
                item._numericAmount = 0;
            }
            return item;
        });

        // Second pass: add remainder to last item
        const remainder = totalAmount - sumOfAmounts;
        if (remainder > 0 && data.length > 0) {
            const lastItem = data[data.length - 1];
            lastItem._numericAmount += remainder;
            console.log(`[${id}] Added remainder ${remainder}원 to last item (${lastItem.code})`);
        }

        // Convert to display string
        data = data.map(item => {
            item.amount = item._numericAmount.toLocaleString('ko-KR') + "원";
            delete item._numericAmount;
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
        const total = await fetchTotalAmount('D23');
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/483340/compose', 'ace', total);
    },
    ace_nvidia: async (page) => {
        const total = await fetchTotalAmount('D28'); // ACE NVIDIA30
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/448540/compose', 'ace_nvidia', total);
    },
    tiger: async (page) => {
        const total = await fetchTotalAmount('D19');
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/472170/compose', 'tiger', total);
    },
    kodex: async (page) => {
        const total = await fetchTotalAmount('D25');
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/0144L0/compose', 'kodex', total);
    },
    capital: async (page) => {
        console.log("[Capital] Downloading Excel...");
        const totalAmount = await fetchTotalAmount('D38'); // CGDV

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
            // First pass: calculate amounts with Math.floor()
            let sumOfAmounts = 0;
            data = data.map(item => {
                const weight = parseFloat(item.weight);
                if (!isNaN(weight)) {
                    const calAmount = Math.floor(totalAmount * (weight / 100));
                    item._numericAmount = calAmount;
                    sumOfAmounts += calAmount;
                } else {
                    item._numericAmount = 0;
                }
                return item;
            });

            // Second pass: add remainder to last item
            const remainder = totalAmount - sumOfAmounts;
            if (remainder > 0 && data.length > 0) {
                const lastItem = data[data.length - 1];
                lastItem._numericAmount += remainder;
                console.log(`[Capital] Added remainder ${remainder}원 to last item (${lastItem.code})`);
            }

            // Convert to display string
            data = data.map(item => {
                item.amount = item._numericAmount.toLocaleString('ko-KR') + "원";
                delete item._numericAmount;
                return item;
            });

            title += ` (${totalAmount.toLocaleString('ko-KR')}원)`;
        }

        return { id: 'capital', title, components: data };
    },
    wisdomtree: async (page) => {
        const total = await fetchTotalAmount('D36'); // DGRW
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00000PMNI/compose#top', 'wisdomtree', total);
    },
    etf_mve2: async (page) => {
        const total = await fetchTotalAmount('D34'); // SCHD
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/global/etpitem/F00000MVE2/compose', 'etf_mve2', total);
    },
    sol_mix: async (page) => {
        const total = await fetchTotalAmount('D32'); // SOL Mix
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/490490/compose', 'sol_mix', total);
    },
    plus_hbm: async (page) => {
        const total = await fetchTotalAmount('D59'); // PLUS 글로벌 HBM
        return scrapeEtfCheck(page, 'https://www.etfcheck.co.kr/mobile/etpitem/442580/compose', 'plus_hbm', total);
    },
    custom_googl: async (page) => {
        const total = await fetchTotalAmount('D40'); // GOOGL Direct
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
    custom_bonds: async (page) => {
        const val1 = await fetchTotalAmount('D60');
        const val2 = await fetchTotalAmount('D42');
        const total = val1 + val2;
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_bonds',
            title: 'Bonds (D60+D42)',
            components: [{
                no: '1',
                code: '국고채권',
                name: 'Korea Treasury Bond (D60+D42)',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_savings: async (page) => {
        const total = await fetchTotalAmount('D61');
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_savings',
            title: 'Savings (D61)',
            components: [{
                no: '1',
                code: '예적금',
                name: 'Savings & Deposits (D61)',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_cash: async (page) => {
        const total = await fetchTotalAmount('D62');
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_cash',
            title: 'KRW Cash (D62)',
            components: [{
                no: '1',
                code: '원화현금',
                name: 'KRW Cash (D62)',
                weight: '100',
                amount: amountStr
            }]
        };
    },
    custom_reits: async (page) => {
        const total = await fetchTotalAmount('D16');
        const amountStr = total > 0 ? total.toLocaleString('ko-KR') + "원" : "-";
        return {
            id: 'custom_reits',
            title: 'REITs (D16)',
            components: [{
                no: '1',
                code: '리츠',
                name: 'Real Estate Investment Trusts',
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
            runScraper(scrapers.ace_nvidia, "ACE_NVIDIA"),
            runScraper(scrapers.tiger, "Tiger"),
            runScraper(scrapers.kodex, "Kodex"),
            runScraper(scrapers.capital, "Capital"),
            runScraper(scrapers.wisdomtree, "WisdomTree"),
            runScraper(scrapers.etf_mve2, "ETF_MVE2"),
            runScraper(scrapers.sol_mix, "SOL_MIX"),
            runScraper(scrapers.plus_hbm, "PLUS_HBM"),
            runScraper(scrapers.custom_bonds, "CUSTOM_BONDS"),
            runScraper(scrapers.custom_savings, "CUSTOM_SAVINGS"),
            runScraper(scrapers.custom_cash, "CUSTOM_CASH"),
            runScraper(scrapers.custom_reits, "CUSTOM_REITS"),
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

// ===== Living Expenses API =====
const LIVING_TX_FILE = path.join(DATA_DIR, 'living_transactions.json');
const LIVING_OV_FILE = path.join(DATA_DIR, 'living_overrides.json');

function readJsonFile(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) { console.error('Read error:', filePath, e.message); }
    return fallback;
}
function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Load all transactions
app.get('/api/living/transactions', (req, res) => {
    res.json(readJsonFile(LIVING_TX_FILE, []));
});

// Save transactions (full replace)
app.post('/api/living/transactions', (req, res) => {
    const txs = req.body;
    if (!Array.isArray(txs)) return res.status(400).json({ error: 'Array expected' });
    writeJsonFile(LIVING_TX_FILE, txs);
    res.json({ success: true, count: txs.length });
});

// Load overrides
app.get('/api/living/overrides', (req, res) => {
    res.json(readJsonFile(LIVING_OV_FILE, {}));
});

// Save overrides
app.post('/api/living/overrides', (req, res) => {
    const ov = req.body;
    writeJsonFile(LIVING_OV_FILE, ov);
    res.json({ success: true });
});

// ===== Living Snapshots API =====
const SAVES_DIR = path.join(DATA_DIR, 'living_saves');
if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });

// List saved snapshots
app.get('/api/living/saves', (req, res) => {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    const saves = files.map(f => {
        const data = readJsonFile(path.join(SAVES_DIR, f), {});
        return { name: data.name || f.replace('.json', ''), file: f.replace('.json', ''), date: data.savedAt || '', count: (data.transactions || []).length };
    }).sort((a, b) => b.name.localeCompare(a.name));
    res.json(saves);
});

// Save a snapshot
app.post('/api/living/saves', (req, res) => {
    const { name, transactions, overrides } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const safeFile = name.replace(/[^a-zA-Z0-9가-힣_\-]/g, '_');
    const filePath = path.join(SAVES_DIR, safeFile + '.json');
    writeJsonFile(filePath, { name, transactions: transactions || [], overrides: overrides || {}, savedAt: new Date().toISOString() });
    res.json({ success: true, name });
});

// Load a snapshot
app.get('/api/living/saves/:file', (req, res) => {
    const filePath = path.join(SAVES_DIR, req.params.file + '.json');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
    res.json(readJsonFile(filePath, {}));
});

// Delete a snapshot
app.delete('/api/living/saves/:file', (req, res) => {
    const filePath = path.join(SAVES_DIR, req.params.file + '.json');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
