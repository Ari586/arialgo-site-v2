// ============================================
//  API Client — Data Fetching (via Vite proxy)
// ============================================

/**
 * Fetch current price for a given symbol
 */
export async function fetchPrice(symbol = 'XAU/USD') {
    try {
        const res = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}`);
        return await res.json();
    } catch (e) {
        console.error('Price fetch error:', e);
        return null;
    }
}

/**
 * Fetch candlestick history for a given symbol
 */
export async function fetchHistory(symbol = 'XAU/USD', interval = '1min', outputsize = 200) {
    try {
        const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}`);
        return await res.json();
    } catch (e) {
        console.error('History fetch error:', e);
        return null;
    }
}
