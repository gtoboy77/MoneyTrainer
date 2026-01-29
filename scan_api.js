const https = require('https');

const codes = ['K55101EB6099', '453850'];
const paths = [
    '/api/fund/popup/pdf',
    '/api/fund/pdf',
    '/api/fund/constituents',
    '/fund/pdf',
    '/fund/ajax/pdf',
    '/api/v1/fund/pdf',
    '/api/etf/pdf',
    '/common/fund/pdf' // Generic guess
];

async function checkUrl(path, code) {
    // Construct URLs with query params or path params
    const candidates = [
        `https://www.aceetf.co.kr${path}?fundCode=${code}`,
        `https://www.aceetf.co.kr${path}?code=${code}`,
        `https://www.aceetf.co.kr${path}/${code}`
    ];

    for (const url of candidates) {
        try {
            await new Promise((resolve) => {
                https.get(url, (res) => {
                    if (res.statusCode === 200) {
                        let data = '';
                        res.on('data', c => data += c);
                        res.on('end', () => {
                            if (res.headers['content-type'] && res.headers['content-type'].includes('json')) {
                                console.log(`[SUCCESS] Found JSON at: ${url}`);
                                console.log(data.substring(0, 200));
                            } else if (data.includes("구성종목") || data.includes("PDF")) {
                                console.log(`[POTENTIAL] Content at: ${url} (Type: ${res.headers['content-type']})`);
                            } else {
                                // console.log(`[FAILED] ${url} - Status 200 but not useful data.`);
                            }
                            resolve();
                        });
                    } else {
                        // console.log(`[FAILED] ${url} - Status ${res.statusCode}`);
                        resolve();
                    }
                }).on('error', (e) => {
                    console.error(`Error fetching ${url}: ${e.message}`);
                    resolve();
                });
            });
        } catch (e) {

        }
    }
}

async function run() {
    console.log("Scanning API endpoints...");
    for (const p of paths) {
        for (const c of codes) {
            await checkUrl(p, c);
        }
    }
    console.log("Scan complete.");
}

run();
