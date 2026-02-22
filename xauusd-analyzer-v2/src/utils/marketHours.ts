const XAU_CLOSE_HOUR_UTC_FRIDAY = 22;
const XAU_OPEN_HOUR_UTC_SUNDAY = 22;

export function isXauMarketClosed(now = new Date()): boolean {
    const day = now.getUTCDay();
    const hour = now.getUTCHours();

    if (day === 6) return true; // Saturday
    if (day === 5 && hour >= XAU_CLOSE_HOUR_UTC_FRIDAY) return true; // Friday after close
    if (day === 0 && hour < XAU_OPEN_HOUR_UTC_SUNDAY) return true; // Sunday before open
    return false;
}

export function isSymbolMarketClosed(symbol: string, now = new Date()): boolean {
    if (symbol === 'XAU/USD') return isXauMarketClosed(now);
    return false;
}

export function getMarketClosedReason(symbol: string): string {
    if (symbol === 'XAU/USD') {
        return 'XAU/USD fermé (vendredi 22:00 UTC à dimanche 22:00 UTC). Utilise BTC/USD ou ETH/USD.';
    }
    return `${symbol} fermé temporairement.`;
}
