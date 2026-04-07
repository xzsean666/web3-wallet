const fs = require('fs');
const { getAddress } = require('viem');

let content = fs.readFileSync('src/stores/wallet.ts', 'utf8');

// Use regex to find all contractAddress fields
content = content.replace(/contractAddress:\s*"([^"]+)"/g, (match, addr) => {
    try {
        const checksummed = getAddress(addr);
        return `contractAddress: "${checksummed}"`;
    } catch {
        return match;
    }
});

fs.writeFileSync('src/stores/wallet.ts', content);
