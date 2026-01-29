const https = require('https');

const code = 'K55101EB6099';
const url = `https://www.aceetf.co.kr/fund/pdf?fundCode=${code}`;

console.log(`Fetching PDF component: ${url}...`);

https.get(url, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        console.log(`Fetched ${data.length} bytes.`);
        console.log("--- Preview (first 500 chars) ---");
        console.log(data.substring(0, 500));

        console.log("\n--- Preview (last 500 chars) ---");
        console.log(data.substring(data.length - 500));

        if (data.includes("table")) {
            console.log("\n[SUCCESS] Found <table> tag.");
        }

        // Check for stock data
        if (data.includes("Treasury") || data.includes("Bond") || data.includes("US")) {
            console.log("\n[SUCCESS] Found 'Treasury' or 'Bond' keywords.");
        }
    });
}).on('error', e => console.error(e));
