// ============================================
//  Technical Indicators Engine — FULL SUITE
// ============================================

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return parseFloat((100 - (100 / (1 + avgGain / avgLoss))).toFixed(2));
}

/**
 * Calculate EMA
 */
export function calcEMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [ema];
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
        result.push(ema);
    }
    return result;
}

/**
 * Calculate SMA
 */
export function calcSMA(data, period) {
    if (data.length < period) return null;
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
    }
    return result;
}

/**
 * Calculate MACD
 */
export function calcMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const emaFast = calcEMA(closes, fastPeriod);
    const emaSlow = calcEMA(closes, slowPeriod);
    if (!emaFast || !emaSlow) return null;
    const offset = slowPeriod - fastPeriod;
    const macdLine = [];
    for (let i = 0; i < emaSlow.length; i++) {
        macdLine.push(emaFast[i + offset] - emaSlow[i]);
    }
    const signalLine = calcEMA(macdLine, signalPeriod);
    if (!signalLine) return null;
    const histogramOffset = macdLine.length - signalLine.length;
    const histogram = signalLine.map((s, i) => macdLine[i + histogramOffset] - s);
    return {
        macdLine: parseFloat(macdLine[macdLine.length - 1].toFixed(4)),
        signalLine: parseFloat(signalLine[signalLine.length - 1].toFixed(4)),
        histogram: parseFloat(histogram[histogram.length - 1].toFixed(4)),
        histogramArray: histogram
    };
}

/**
 * Calculate Bollinger Bands
 */
export function calcBollingerBands(closes, period = 20, stdDev = 2) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    return {
        upper: parseFloat((sma + stdDev * sd).toFixed(2)),
        middle: parseFloat(sma.toFixed(2)),
        lower: parseFloat((sma - stdDev * sd).toFixed(2)),
        bandwidth: parseFloat(((stdDev * sd * 2) / sma * 100).toFixed(4))
    };
}

/**
 * Calculate ATR (Average True Range)
 */
export function calcATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        );
        trueRanges.push(tr);
    }
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trueRanges.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
    }
    return parseFloat(atr.toFixed(2));
}

/**
 * Calculate Stochastic Oscillator (%K and %D)
 */
export function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
    if (candles.length < kPeriod) return null;
    const kValues = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const slice = candles.slice(i - kPeriod + 1, i + 1);
        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const k = high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100;
        kValues.push(k);
    }
    const dValues = calcSMA(kValues, dPeriod);
    return {
        k: parseFloat(kValues[kValues.length - 1].toFixed(2)),
        d: dValues ? parseFloat(dValues[dValues.length - 1].toFixed(2)) : null
    };
}

/**
 * Calculate ADX (Average Directional Index) — Trend Strength
 */
export function calcADX(candles, period = 14) {
    if (candles.length < period * 2 + 1) return null;

    const plusDM = [], minusDM = [], tr = [];
    for (let i = 1; i < candles.length; i++) {
        const upMove = candles[i].high - candles[i - 1].high;
        const downMove = candles[i - 1].low - candles[i].low;
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        tr.push(Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        ));
    }

    // Smoothed values
    let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

    const dxValues = [];
    for (let i = period; i < tr.length; i++) {
        smoothTR = smoothTR - (smoothTR / period) + tr[i];
        smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
        smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];

        const plusDI = (smoothPlusDM / smoothTR) * 100;
        const minusDI = (smoothMinusDM / smoothTR) * 100;
        const diSum = plusDI + minusDI;
        const dx = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100;
        dxValues.push({ dx, plusDI, minusDI });
    }

    if (dxValues.length < period) return null;
    let adx = dxValues.slice(0, period).reduce((a, b) => a + b.dx, 0) / period;
    for (let i = period; i < dxValues.length; i++) {
        adx = (adx * (period - 1) + dxValues[i].dx) / period;
    }

    const last = dxValues[dxValues.length - 1];
    return {
        adx: parseFloat(adx.toFixed(2)),
        plusDI: parseFloat(last.plusDI.toFixed(2)),
        minusDI: parseFloat(last.minusDI.toFixed(2)),
        trendStrength: adx > 50 ? 'VERY_STRONG' : adx > 25 ? 'STRONG' : adx > 20 ? 'DEVELOPING' : 'WEAK'
    };
}

/**
 * Calculate Williams %R
 */
export function calcWilliamsR(candles, period = 14) {
    if (candles.length < period) return null;
    const slice = candles.slice(-period);
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    const close = candles[candles.length - 1].close;
    if (high === low) return -50;
    return parseFloat((((high - close) / (high - low)) * -100).toFixed(2));
}

/**
 * Calculate CCI (Commodity Channel Index)
 */
export function calcCCI(candles, period = 20) {
    if (candles.length < period) return null;
    const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
    const slice = typicalPrices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const meanDeviation = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    if (meanDeviation === 0) return 0;
    return parseFloat(((typicalPrices[typicalPrices.length - 1] - mean) / (0.015 * meanDeviation)).toFixed(2));
}

/**
 * Calculate MFI (Money Flow Index)
 */
export function calcMFI(candles, period = 14) {
    if (candles.length < period + 1) return null;
    let posFlow = 0, negFlow = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const prevTp = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
        const mf = tp * (candles[i].volume || 1);
        if (tp > prevTp) posFlow += mf;
        else negFlow += mf;
    }
    if (negFlow === 0) return 100;
    const mfr = posFlow / negFlow;
    return parseFloat((100 - (100 / (1 + mfr))).toFixed(2));
}

/**
 * Calculate Pivot Points (Standard)
 */
export function calcPivotPoints(candles) {
    if (candles.length < 2) return null;
    // Use previous candle as "previous session"
    const prev = candles[candles.length - 2];
    const pivot = (prev.high + prev.low + prev.close) / 3;
    return {
        r3: parseFloat((pivot + 2 * (prev.high - prev.low)).toFixed(2)),
        r2: parseFloat((pivot + (prev.high - prev.low)).toFixed(2)),
        r1: parseFloat((2 * pivot - prev.low).toFixed(2)),
        pivot: parseFloat(pivot.toFixed(2)),
        s1: parseFloat((2 * pivot - prev.high).toFixed(2)),
        s2: parseFloat((pivot - (prev.high - prev.low)).toFixed(2)),
        s3: parseFloat((pivot - 2 * (prev.high - prev.low)).toFixed(2))
    };
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 */
export function calcVWAP(candles) {
    if (candles.length < 2) return null;
    let cumTPV = 0, cumVol = 0;
    for (const c of candles) {
        const tp = (c.high + c.low + c.close) / 3;
        const vol = c.volume || 1;
        cumTPV += tp * vol;
        cumVol += vol;
    }
    return cumVol === 0 ? null : parseFloat((cumTPV / cumVol).toFixed(2));
}

/**
 * Detect candlestick patterns
 */
export function detectPatterns(candles) {
    if (candles.length < 3) return [];
    const patterns = [];
    const c = candles[candles.length - 1];
    const p = candles[candles.length - 2];
    const pp = candles[candles.length - 3];
    const bodySize = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const range = c.high - c.low;

    // Doji
    if (bodySize < range * 0.1 && range > 0) {
        patterns.push({ name: 'Doji', type: 'neutral', emoji: '⚖️' });
    }

    // Hammer (bullish reversal)
    if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5 && bodySize > 0) {
        patterns.push({ name: 'Hammer', type: 'bullish', emoji: '🔨' });
    }

    // Shooting Star (bearish reversal)
    if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5 && bodySize > 0) {
        patterns.push({ name: 'Shooting Star', type: 'bearish', emoji: '⭐' });
    }

    // Engulfing Bullish
    if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close) {
        patterns.push({ name: 'Bullish Engulfing', type: 'bullish', emoji: '🟢' });
    }

    // Engulfing Bearish
    if (p.close > p.open && c.close < c.open && c.close < p.open && c.open > p.close) {
        patterns.push({ name: 'Bearish Engulfing', type: 'bearish', emoji: '🔴' });
    }

    // Morning Star (bullish)
    const ppBody = Math.abs(pp.close - pp.open);
    const pBody = Math.abs(p.close - p.open);
    if (pp.close < pp.open && pBody < ppBody * 0.3 && c.close > c.open && c.close > (pp.open + pp.close) / 2) {
        patterns.push({ name: 'Morning Star', type: 'bullish', emoji: '🌅' });
    }

    // Evening Star (bearish)
    if (pp.close > pp.open && pBody < ppBody * 0.3 && c.close < c.open && c.close < (pp.open + pp.close) / 2) {
        patterns.push({ name: 'Evening Star', type: 'bearish', emoji: '🌆' });
    }

    return patterns;
}

/**
 * Determine overall trend direction
 */
export function determineTrend(indicators, currentPrice) {
    let bullishCount = 0;
    let bearishCount = 0;
    let totalSignals = 0;
    const reasons = [];

    // EMA Trend
    if (indicators.ema9 && indicators.ema21) {
        totalSignals++;
        if (indicators.ema9 > indicators.ema21) {
            bullishCount++;
            reasons.push('EMA 9 > 21 ↑');
        } else {
            bearishCount++;
            reasons.push('EMA 9 < 21 ↓');
        }
    }
    if (indicators.ema50 && indicators.ema200) {
        totalSignals++;
        if (indicators.ema50 > indicators.ema200) {
            bullishCount++;
            reasons.push('Golden Cross (50>200) ↑');
        } else {
            bearishCount++;
            reasons.push('Death Cross (50<200) ↓');
        }
    }

    // Price vs EMAs
    if (indicators.ema50 && currentPrice) {
        totalSignals++;
        if (currentPrice > indicators.ema50) {
            bullishCount++;
            reasons.push('Price > EMA50 ↑');
        } else {
            bearishCount++;
            reasons.push('Price < EMA50 ↓');
        }
    }

    // MACD
    if (indicators.macdLine !== null && indicators.macdSignal !== null) {
        totalSignals++;
        if (indicators.macdLine > indicators.macdSignal) {
            bullishCount++;
            reasons.push('MACD Bullish ↑');
        } else {
            bearishCount++;
            reasons.push('MACD Bearish ↓');
        }
    }

    // RSI
    if (indicators.rsi !== null) {
        totalSignals++;
        if (indicators.rsi > 50) {
            bullishCount++;
            reasons.push(`RSI ${indicators.rsi} > 50 ↑`);
        } else {
            bearishCount++;
            reasons.push(`RSI ${indicators.rsi} < 50 ↓`);
        }
    }

    // ADX direction
    if (indicators.adx) {
        totalSignals++;
        if (indicators.adx.plusDI > indicators.adx.minusDI) {
            bullishCount++;
            reasons.push('ADX +DI > -DI ↑');
        } else {
            bearishCount++;
            reasons.push('ADX +DI < -DI ↓');
        }
    }

    // Stochastic
    if (indicators.stochastic) {
        totalSignals++;
        if (indicators.stochastic.k > 50) {
            bullishCount++;
            reasons.push(`Stoch %K ${indicators.stochastic.k} ↑`);
        } else {
            bearishCount++;
            reasons.push(`Stoch %K ${indicators.stochastic.k} ↓`);
        }
    }

    // VWAP
    if (indicators.vwap && currentPrice) {
        totalSignals++;
        if (currentPrice > indicators.vwap) {
            bullishCount++;
            reasons.push('Price > VWAP ↑');
        } else {
            bearishCount++;
            reasons.push('Price < VWAP ↓');
        }
    }

    const bullishPct = totalSignals > 0 ? Math.round((bullishCount / totalSignals) * 100) : 50;
    const bearishPct = 100 - bullishPct;

    let direction, strength;
    if (bullishPct >= 75) { direction = 'HAUSSIÈRE'; strength = 'FORTE'; }
    else if (bullishPct >= 60) { direction = 'HAUSSIÈRE'; strength = 'MODÉRÉE'; }
    else if (bearishPct >= 75) { direction = 'BAISSIÈRE'; strength = 'FORTE'; }
    else if (bearishPct >= 60) { direction = 'BAISSIÈRE'; strength = 'MODÉRÉE'; }
    else { direction = 'NEUTRE'; strength = 'INDÉCISE'; }

    return {
        direction,
        strength,
        bullishPct,
        bearishPct,
        bullishCount,
        bearishCount,
        totalSignals,
        reasons
    };
}

/**
 * Calculate ALL indicators from candles
 */
export function calculateAllIndicators(candles) {
    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes);
    const atr = calcATR(candles);
    const stochastic = calcStochastic(candles);
    const adx = calcADX(candles);
    const williamsR = calcWilliamsR(candles);
    const cci = calcCCI(candles);
    const mfi = calcMFI(candles);
    const pivotPoints = calcPivotPoints(candles);
    const vwap = calcVWAP(candles);
    const patterns = detectPatterns(candles);

    // EMAs
    const ema9arr = calcEMA(closes, 9);
    const ema21arr = calcEMA(closes, 21);
    const ema50arr = calcEMA(closes, 50);
    const ema200arr = calcEMA(closes, 200);

    const ema9 = ema9arr ? parseFloat(ema9arr[ema9arr.length - 1].toFixed(2)) : null;
    const ema21 = ema21arr ? parseFloat(ema21arr[ema21arr.length - 1].toFixed(2)) : null;
    const ema50 = ema50arr ? parseFloat(ema50arr[ema50arr.length - 1].toFixed(2)) : null;
    const ema200 = ema200arr ? parseFloat(ema200arr[ema200arr.length - 1].toFixed(2)) : null;

    const indicators = {
        rsi,
        macdLine: macd ? macd.macdLine : null,
        macdSignal: macd ? macd.signalLine : null,
        macdHistogram: macd ? macd.histogram : null,
        bbUpper: bb ? bb.upper : null,
        bbMiddle: bb ? bb.middle : null,
        bbLower: bb ? bb.lower : null,
        bbBandwidth: bb ? bb.bandwidth : null,
        atr,
        stochastic,
        adx,
        williamsR,
        cci,
        mfi,
        pivotPoints,
        vwap,
        patterns,
        ema9, ema21, ema50, ema200,
        emaArrays: { ema9: ema9arr, ema21: ema21arr, ema50: ema50arr, ema200: ema200arr }
    };

    // Trend determination
    indicators.trend = determineTrend(indicators, currentPrice);

    return indicators;
}
