const WEEKEND_CLOSE_HOUR_UTC_FRIDAY = 22;
const WEEKEND_OPEN_HOUR_UTC_SUNDAY = 22;

const CRYPTO_SYMBOLS = new Set(['BTC/USD', 'ETH/USD', 'SOL/USD']);
const FOREX_SYMBOLS = new Set(['EUR/USD', 'GBP/USD', 'USD/JPY', 'CHF/JPY', 'AUD/USD']);
const COMMODITY_SYMBOLS = new Set(['XAU/USD', 'XAG/USD', 'WTI/USD']);
const STOCK_SYMBOLS = new Set(['AAPL/USD', 'TSLA/USD', 'NVDA/USD']);
const INDEX_SYMBOLS = new Set(['SPX500/USD', 'NAS100/USD', 'US30/USD']);

export type MarketAssetClass = 'crypto' | 'forex' | 'commodities' | 'stocks' | 'indices' | 'other';

export function isWeekendMarketClosed(now = new Date()): boolean {
    const day = now.getUTCDay();
    const hour = now.getUTCHours();

    if (day === 6) return true; // Saturday
    if (day === 5 && hour >= WEEKEND_CLOSE_HOUR_UTC_FRIDAY) return true; // Friday after close
    if (day === 0 && hour < WEEKEND_OPEN_HOUR_UTC_SUNDAY) return true; // Sunday before open
    return false;
}

export function getMarketAssetClass(symbol: string): MarketAssetClass {
    if (CRYPTO_SYMBOLS.has(symbol)) return 'crypto';
    if (FOREX_SYMBOLS.has(symbol)) return 'forex';
    if (COMMODITY_SYMBOLS.has(symbol)) return 'commodities';
    if (STOCK_SYMBOLS.has(symbol)) return 'stocks';
    if (INDEX_SYMBOLS.has(symbol)) return 'indices';
    return 'other';
}

export function isSymbolMarketClosed(symbol: string, now = new Date()): boolean {
    const assetClass = getMarketAssetClass(symbol);
    if (assetClass === 'crypto') return false;
    if (assetClass === 'forex' || assetClass === 'commodities' || assetClass === 'stocks' || assetClass === 'indices') {
        return isWeekendMarketClosed(now);
    }
    return false;
}

export function getMarketClosedReason(symbol: string): string {
    const assetClass = getMarketAssetClass(symbol);
    if (assetClass === 'crypto') {
        return `${symbol} reste ouvert 24/7.`;
    }
    if (assetClass === 'forex' || assetClass === 'commodities' || assetClass === 'stocks' || assetClass === 'indices') {
        return `${symbol} fermé le week-end (vendredi 22:00 UTC à dimanche 22:00 UTC). Les marchés crypto restent ouverts 24/7.`;
    }
    return `${symbol} fermé temporairement.`;
}
