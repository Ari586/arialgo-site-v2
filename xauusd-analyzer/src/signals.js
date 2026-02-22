// ============================================
//  AI Signal Generation Engine
// ============================================

const API_BASE = '';

/**
 * Generate composite technical score from indicators
 * Score: -100 (STRONG SELL) to +100 (STRONG BUY)
 */
export function generateCompositeScore(indicators, currentPrice) {
    let score = 0;
    let weights = { rsi: 20, macd: 25, ema: 25, bb: 15, atr: 15 };
    let details = {};

    // RSI Signal (weight: 20%)
    if (indicators.rsi !== null) {
        let rsiScore = 0;
        if (indicators.rsi < 20) rsiScore = 80;        // Extremely oversold → BUY
        else if (indicators.rsi < 30) rsiScore = 50;    // Oversold → BUY
        else if (indicators.rsi < 40) rsiScore = 20;    // Slightly oversold
        else if (indicators.rsi > 80) rsiScore = -80;   // Extremely overbought → SELL
        else if (indicators.rsi > 70) rsiScore = -50;   // Overbought → SELL
        else if (indicators.rsi > 60) rsiScore = -20;   // Slightly overbought
        else rsiScore = 0;                               // Neutral

        score += (rsiScore * weights.rsi) / 100;
        details.rsi = { value: indicators.rsi, score: rsiScore };
    }

    // MACD Signal (weight: 25%)
    if (indicators.macdLine !== null && indicators.macdSignal !== null) {
        let macdScore = 0;
        const macdDiff = indicators.macdLine - indicators.macdSignal;

        if (macdDiff > 0 && indicators.macdHistogram > 0) macdScore = 60;     // Bullish crossover
        else if (macdDiff > 0) macdScore = 30;                                  // Above signal
        else if (macdDiff < 0 && indicators.macdHistogram < 0) macdScore = -60; // Bearish crossover
        else if (macdDiff < 0) macdScore = -30;                                  // Below signal

        // Histogram momentum
        if (indicators.macdHistogram > 0.5) macdScore += 20;
        else if (indicators.macdHistogram < -0.5) macdScore -= 20;

        macdScore = Math.max(-100, Math.min(100, macdScore));
        score += (macdScore * weights.macd) / 100;
        details.macd = { value: indicators.macdLine, score: macdScore };
    }

    // EMA Trend (weight: 25%)
    if (indicators.ema9 !== null && indicators.ema21 !== null) {
        let emaScore = 0;

        // Short-term trend: EMA9 vs EMA21
        if (indicators.ema9 > indicators.ema21) emaScore += 30;
        else emaScore -= 30;

        // Price above/below EMAs
        if (currentPrice > indicators.ema9) emaScore += 15;
        else emaScore -= 15;

        if (currentPrice > indicators.ema21) emaScore += 10;
        else emaScore -= 10;

        // Long-term: EMA50 vs EMA200 (golden/death cross)
        if (indicators.ema50 !== null && indicators.ema200 !== null) {
            if (indicators.ema50 > indicators.ema200) emaScore += 30; // Golden cross
            else emaScore -= 30; // Death cross
        }

        emaScore = Math.max(-100, Math.min(100, emaScore));
        score += (emaScore * weights.ema) / 100;
        details.ema = { value: `${indicators.ema9}/${indicators.ema21}`, score: emaScore };
    }

    // Bollinger Bands (weight: 15%)
    if (indicators.bbUpper !== null && indicators.bbLower !== null) {
        let bbScore = 0;
        const bbRange = indicators.bbUpper - indicators.bbLower;
        const pricePosition = (currentPrice - indicators.bbLower) / bbRange; // 0 to 1

        if (pricePosition < 0.1) bbScore = 70;       // Near lower band → BUY
        else if (pricePosition < 0.25) bbScore = 40;
        else if (pricePosition > 0.9) bbScore = -70;  // Near upper band → SELL
        else if (pricePosition > 0.75) bbScore = -40;
        else bbScore = 0;

        score += (bbScore * weights.bb) / 100;
        details.bb = { value: pricePosition.toFixed(2), score: bbScore };
    }

    // ATR - used for confidence adjustment, not direction
    if (indicators.atr !== null) {
        details.atr = { value: indicators.atr, score: 0 };
    }

    score = Math.max(-100, Math.min(100, score));

    return {
        score: parseFloat(score.toFixed(1)),
        details,
        signal: score > 20 ? 'BUY' : score < -20 ? 'SELL' : 'HOLD',
        confidence: Math.min(Math.abs(score), 95)
    };
}

/**
 * Request AI analysis from Ollama via backend
 */
export async function requestAISignal(indicators, candles, currentPrice, compositeScore, symbol = 'XAU/USD') {
    try {
        const res = await fetch(`${API_BASE}/api/ai-signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                indicators: { ...indicators, compositeScore },
                candles,
                currentPrice,
                symbol
            })
        });

        const data = await res.json();
        if (data.success) {
            return {
                signal: data.signal,
                confidence: data.confidence,
                reasoning: data.reasoning,
                source: data.source
            };
        }
        throw new Error('Invalid response');
    } catch (e) {
        console.warn('AI Signal error:', e.message);
        return null;
    }
}
