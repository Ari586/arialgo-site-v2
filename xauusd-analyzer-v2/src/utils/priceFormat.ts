const SYMBOL_DECIMALS: Record<string, number> = {
    // Commodities
    'XAU/USD': 2,
    'XAG/USD': 3,
    'WTI/USD': 2,
    // Forex
    'EUR/USD': 5,
    'GBP/USD': 5,
    'USD/JPY': 3,
    'CHF/JPY': 3,
    'AUD/USD': 5,
    // Crypto
    'BTC/USD': 2,
    'ETH/USD': 2,
    'SOL/USD': 2,
    // Stocks
    'AAPL/USD': 2,
    'TSLA/USD': 2,
    'NVDA/USD': 2,
    // Indices
    'SPX500/USD': 2,
    'NAS100/USD': 2,
    'US30/USD': 2
};

type FormatOptions = {
    allowZero?: boolean;
    allowNegative?: boolean;
    useGrouping?: boolean;
};

export function getSymbolDecimals(symbol: string): number {
    return SYMBOL_DECIMALS[symbol] ?? 2;
}

export function formatSymbolPrice(symbol: string, value?: number | null, options: FormatOptions = {}): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';

    const allowNegative = options.allowNegative ?? false;
    const allowZero = options.allowZero ?? false;
    const useGrouping = options.useGrouping ?? false;

    if (!allowNegative && n < 0) return '—';
    if (!allowZero && n === 0) return '—';

    const decimals = getSymbolDecimals(symbol);
    return n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping
    });
}
