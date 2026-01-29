const https = require('https');

const buildId = "build-20260120";
const code = "K55101EB6099";
const url = `https://www.aceetf.co.kr/_next/data/${buildId}/fund/pdf.json?fundCode=${code}`;

console.log(`Fetching ${url}...`);

https.get(url, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log("Successfully parsed JSON.");

            // Navigate to pageProps
            if (json.pageProps) {
                console.log("pageProps Keys:", Object.keys(json.pageProps));

                // Check specific keys
                const potentialData = json.pageProps.pdf || json.pageProps.data || json.pageProps.constituents;
                if (potentialData) {
                    console.log("Found data in pageProps:");
                    console.log(JSON.stringify(potentialData).substring(0, 500));
                } else {
                    // Search recursively or print first level
                    console.log("Full pageProps (first 500 chars):", JSON.stringify(json.pageProps).substring(0, 500));
                }
            }
        } catch (e) {
            console.error("Error parsing JSON:", e);
            console.log("Raw data (first 200 chars):", data.substring(0, 200));
        }
    });
}).on('error', e => console.error(e));
