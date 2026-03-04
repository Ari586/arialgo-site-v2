export type TradeSignal = 'BUY' | 'SELL' | 'HOLD';

export type TradeVerdict = {
    signal: TradeSignal;
    confidence: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    horizon: string;
    invalidation: string;
    reasons: string[];
};

export type BuildTradeVerdictParams = {
    currentPrice: number;
    signalHint?: string | null;
    confidenceHint?: number | null;
    atr?: number | null;
    trendBias?: number;
    pressureBias?: number;
    entryHint?: number | null;
    stopLossHint?: number | null;
    takeProfitHint?: number | null;
    reasons?: string[];
    timeframe?: string;
    horizonOverride?: string;
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown, fallback: number) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeSignal(value: unknown): TradeSignal | null {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'BUY') return 'BUY';
    if (raw === 'SELL') return 'SELL';
    if (raw === 'HOLD') return 'HOLD';
    if (raw === 'LONG') return 'BUY';
    if (raw === 'SHORT') return 'SELL';
    return null;
}

function timeframeToHorizon(tf: string | undefined): string {
    const key = String(tf || '').toLowerCase();
    if (key === '1s') return '5-20 sec';
    if (key === '5s') return '20-60 sec';
    if (key === '15s') return '1-3 min';
    if (key === '30s') return '2-5 min';
    if (key === '1m' || key === '1min') return '3-10 min';
    if (key === '5m' || key === '5min') return '15-45 min';
    if (key === '15m' || key === '15min') return '1-3 h';
    if (key === '1h') return '4-12 h';
    if (key === '4h') return '1-3 d';
    return 'intraday';
}

export function buildTradeVerdict(params: BuildTradeVerdictParams): TradeVerdict {
    const currentPrice = Math.max(0, safeNumber(params.currentPrice, 0));
    const atrBase = Math.max(currentPrice * 0.0025, safeNumber(params.atr, 0));
    const atrSafe = atrBase > 0 ? atrBase : Math.max(currentPrice * 0.003, 0.1);

    const hintSignal = normalizeSignal(params.signalHint);
    const confidenceHint = clamp(Math.round(safeNumber(params.confidenceHint, 0)), 0, 100);
    const trendBias = clamp(safeNumber(params.trendBias, 0), -100, 100);
    const pressureBias = clamp(safeNumber(params.pressureBias, 0), -1, 1);

    let score = 50;
    if (hintSignal === 'BUY') score += 14;
    if (hintSignal === 'SELL') score -= 14;
    score += Math.round(trendBias * 0.22);
    score += Math.round(pressureBias * 10);
    if (confidenceHint > 0) score += Math.round((confidenceHint - 50) * 0.22);
    score = clamp(score, 0, 100);

    const signal: TradeSignal = score >= 60 ? 'BUY' : score <= 40 ? 'SELL' : 'HOLD';
    const confidence = clamp(
        Math.round((confidenceHint > 0 ? confidenceHint * 0.62 : 31) + Math.abs(score - 50) * 0.95),
        35,
        96
    );

    const entry = Math.max(0, safeNumber(params.entryHint, currentPrice));
    const stopLossHint = safeNumber(params.stopLossHint, 0);
    const takeProfitHint = safeNumber(params.takeProfitHint, 0);

    let stopLoss = 0;
    let takeProfit = 0;

    if (signal === 'BUY') {
        stopLoss = stopLossHint > 0 ? stopLossHint : (entry - atrSafe * 1.45);
        takeProfit = takeProfitHint > 0 ? takeProfitHint : (entry + atrSafe * 2.3);
    } else if (signal === 'SELL') {
        stopLoss = stopLossHint > 0 ? stopLossHint : (entry + atrSafe * 1.45);
        takeProfit = takeProfitHint > 0 ? takeProfitHint : (entry - atrSafe * 2.3);
    } else {
        stopLoss = stopLossHint > 0 ? stopLossHint : (entry - atrSafe * 1.1);
        takeProfit = takeProfitHint > 0 ? takeProfitHint : (entry + atrSafe * 1.1);
    }

    const risk = Math.max(0.0000001, Math.abs(entry - stopLoss));
    const reward = Math.max(0, Math.abs(takeProfit - entry));
    const rr = reward / risk;
    const horizon = params.horizonOverride || timeframeToHorizon(params.timeframe);

    const invalidation = signal === 'BUY'
        ? 'Invalidation: clôture sous SL ou perte du support clé.'
        : signal === 'SELL'
            ? 'Invalidation: clôture au-dessus du SL ou reprise haussière nette.'
            : 'Invalidation: casser le range actuel avec volume directionnel.';

    const reasons = (Array.isArray(params.reasons) ? params.reasons : [])
        .map((reason) => String(reason || '').trim())
        .filter(Boolean)
        .slice(0, 5);

    if (reasons.length === 0) {
        if (hintSignal) reasons.push(`Signal source: ${hintSignal}`);
        if (Math.abs(trendBias) >= 10) reasons.push(`Trend bias: ${trendBias > 0 ? 'bullish' : 'bearish'}`);
        if (Math.abs(pressureBias) >= 0.15) reasons.push(`Orderflow bias: ${pressureBias > 0 ? 'buy' : 'sell'}`);
    }

    return {
        signal,
        confidence,
        entry,
        stopLoss,
        takeProfit,
        rr: Number(rr.toFixed(2)),
        horizon,
        invalidation,
        reasons
    };
}
