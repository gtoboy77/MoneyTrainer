const https = require('https');

const url = "https://www.aceetf.co.kr/fund/K55101EB6099";

console.log(`Fetching ${url}...`);

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log(`Page fetched. Length: ${data.length}`);

        // Find __NEXT_DATA__
        const startTag = '<script id="__NEXT_DATA__" type="application/json">';
        const endTag = '</script>';

        const startIndex = data.indexOf(startTag);
        if (startIndex !== -1) {
            console.log("Found __NEXT_DATA__ script tag.");
            const dataStartIndex = startIndex + startTag.length;
            const dataEndIndex = data.indexOf(endTag, dataStartIndex);

            if (dataEndIndex !== -1) {
                const jsonStr = data.substring(dataStartIndex, dataEndIndex);
                try {
                    const jsonData = JSON.parse(jsonStr);
                    console.log("Successfully parsed __NEXT_DATA__ JSON.");

                    // Inspect props -> pageProps
                    if (jsonData.props && jsonData.props.pageProps) {
                        const pageProps = jsonData.props.pageProps;
                        console.log("Keys in pageProps:", Object.keys(pageProps));
                    }
                } catch (e) {
                    console.error("Error parsing JSON:", e);
                }
            }
        }

        // Find all script src
        console.log("\n--- Script Sources ---");
        const scriptSrcRegex = /<script[^>]+src="([^"]+)"/g;
        let match;
        while ((match = scriptSrcRegex.exec(data)) !== null) {
            console.log("Script Src:", match[1]);
        }

        // Search for API patterns
        console.log("\n--- Potential API Patterns ---");
        const apiRegex = /["'](\/api\/[^"']+)["']|["'](\/fund\/[^"']+)["']/g;
        while ((match = apiRegex.exec(data)) !== null) {
            console.log("Found path:", match[1] || match[2]);
        }

        // Search specifically for the fund code to see context
        console.log("\n--- Fund Code Context ---");
        const codeIndex = data.indexOf("K55101EB6099");
        if (codeIndex !== -1) {
            console.log(data.substring(codeIndex - 100, codeIndex + 100));
        } else {
            console.log("Fund code not found in raw HTML text (besides URL).");
        }

        // Search for constituents of "ACE 미국30년국채액티브(H)"
        console.log("\n--- Constituent Keywords ---");
        const keywords = ["Treasury", "Bond", "TLT", "미국채", "PDF", "구성종목"];
        keywords.forEach(k => {
            const idx = data.indexOf(k);
            if (idx !== -1) {
                console.log(`Found keyword '${k}': ${data.substring(idx - 50, idx + 50)}`);
            } else {
                console.log(`Keyword '${k}' not found in HTML.`);
            }
        });

    });

}).on('error', (err) => {
    console.error('Error: ' + err.message);
});
