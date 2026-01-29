const https = require('https');

const buildId = "build-20260120";
const code = "K55101EB6099";

const paths = [
    `/_next/data/${buildId}/fund/${code}.json`,
    `/_next/data/${buildId}/fund/${code}/pdf.json`, // if nested
    `/_next/data/${buildId}/fund/pdf.json?fundCode=${code}` // query param style (unlikely for static)
];

async function fetchJson(path) {
    const url = `https://www.aceetf.co.kr${path}`;
    console.log(`Fetching ${url}...`);

    return new Promise(resolve => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    if (res.headers['content-type'] && res.headers['content-type'].includes('json')) {
                        const json = JSON.parse(data);
                        console.log(`[SUCCESS] JSON Data found at ${url}`);
                        console.log("Keys:", Object.keys(json.pageProps || {}));

                        // Check for constituents
                        const str = JSON.stringify(json);
                        if (str.includes("구성종목") || str.includes("PDF") || str.includes("Treasury")) {
                            console.log("Found keywords in JSON!");
                            // Print snippet
                            const idx = str.indexOf("종목명"); // 'Stock Name' in Korean
                            if (idx !== -1) console.log(str.substring(idx, idx + 200));
                        }
                    } else {
                        console.log(`[FAILED] Content-Type: ${res.headers['content-type']} (Length: ${data.length})`);
                    }
                } catch (e) {
                    console.error("Error parsing JSON");
                }
                resolve();
            });
        }).on('error', e => {
            console.error(e.message);
            resolve();
        });
    });
}

async function run() {
    for (const p of paths) {
        await fetchJson(p);
    }
}

run();
