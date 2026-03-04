// ============================================
//  Technical Indicators Engine — FULL SUITE
// ============================================

export interface Candle {
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    time: number | string;
}

export interface IndicatorSettings {
    rsiPeriod?: number;
    bollingerStdDev?: number;
    supertrendAtrPeriod?: number;
    supertrendMultiplier?: number;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function normalizeIndicatorSettings(settings: IndicatorSettings = {}) {
    const rsiPeriod = clamp(Math.round(Number(settings.rsiPeriod ?? 14)), 5, 50);
    const bollingerStdDev = clamp(Number(settings.bollingerStdDev ?? 2), 1, 4);
    const supertrendAtrPeriod = clamp(Math.round(Number(settings.supertrendAtrPeriod ?? 10)), 5, 60);
    const supertrendMultiplier = clamp(Number(settings.supertrendMultiplier ?? 3), 1, 10);

    return {
        rsiPeriod,
        bollingerStdDev: parseFloat(bollingerStdDev.toFixed(2)),
        supertrendAtrPeriod,
        supertrendMultiplier: parseFloat(supertrendMultiplier.toFixed(2))
    };
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calcRSI(closes: number[], period = 14) {
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
export function calcEMA(data: number[], period: number) {
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
export function calcSMA(data: number[], period: number) {
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
export function calcMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const emaFast = calcEMA(closes, fastPeriod);
    const emaSlow = calcEMA(closes, slowPeriod);
    if (!emaFast || !emaSlow) return null;
    const offset = slowPeriod - fastPeriod;
    const macdLine: number[] = [];
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
export function calcBollingerBands(closes: number[], period = 20, stdDev = 2) {
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
export function calcATR(candles: Candle[], period = 14) {
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
 * Calculate Supertrend (direction + dynamic trailing band)
 */
export function calcSupertrend(candles: Candle[], period = 10, multiplier = 3) {
    if (!candles || candles.length < Math.max(period + 2, 20)) return null;

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        );
        trueRanges.push(tr);
    }
    if (trueRanges.length < period + 1) return null;

    const atrSeries: Array<number | null> = Array(candles.length).fill(null);
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    atrSeries[period] = atr;
    for (let i = period + 1; i < candles.length; i++) {
        atr = ((atr * (period - 1)) + trueRanges[i - 1]) / period;
        atrSeries[i] = atr;
    }

    const finalUpper: number[] = Array(candles.length).fill(0);
    const finalLower: number[] = Array(candles.length).fill(0);
    const direction: Array<1 | -1> = Array(candles.length).fill(1);

    for (let i = period; i < candles.length; i++) {
        const atrValue = atrSeries[i];
        if (atrValue === null) continue;

        const hl2 = (candles[i].high + candles[i].low) / 2;
        const basicUpper = hl2 + (multiplier * atrValue);
        const basicLower = hl2 - (multiplier * atrValue);

        if (i === period) {
            finalUpper[i] = basicUpper;
            finalLower[i] = basicLower;
            direction[i] = candles[i].close >= basicLower ? 1 : -1;
            continue;
        }

        const prevUpper = finalUpper[i - 1];
        const prevLower = finalLower[i - 1];
        const prevClose = candles[i - 1].close;

        finalUpper[i] = (basicUpper < prevUpper || prevClose > prevUpper) ? basicUpper : prevUpper;
        finalLower[i] = (basicLower > prevLower || prevClose < prevLower) ? basicLower : prevLower;

        const prevDirection = direction[i - 1];
        if (prevDirection === -1 && candles[i].close > finalUpper[i]) {
            direction[i] = 1;
        } else if (prevDirection === 1 && candles[i].close < finalLower[i]) {
            direction[i] = -1;
        } else {
            direction[i] = prevDirection;
        }
    }

    const last = candles.length - 1;
    const dir = direction[last];
    const supertrendValue = dir === 1 ? finalLower[last] : finalUpper[last];
    const distancePct = candles[last].close === 0
        ? 0
        : ((candles[last].close - supertrendValue) / candles[last].close) * 100;

    return {
        direction: dir === 1 ? 'UP' : 'DOWN',
        signal: dir === 1 ? 'BUY' : 'SELL',
        value: parseFloat(supertrendValue.toFixed(2)),
        upper: parseFloat(finalUpper[last].toFixed(2)),
        lower: parseFloat(finalLower[last].toFixed(2)),
        distancePct: parseFloat(distancePct.toFixed(2)),
        period,
        multiplier
    };
}

/**
 * Calculate Stochastic Oscillator (%K and %D)
 */
export function calcStochastic(candles: Candle[], kPeriod = 14, dPeriod = 3) {
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
 * Calculate ADX (Average Directional Index)
 */
export function calcADX(candles: Candle[], period = 14) {
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
export function calcWilliamsR(candles: Candle[], period = 14) {
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
export function calcCCI(candles: Candle[], period = 20) {
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
export function calcMFI(candles: Candle[], period = 14) {
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
export function calcPivotPoints(candles: Candle[]) {
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
export function calcVWAP(candles: Candle[]) {
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
 * Calculate RSI series (Wilder smoothing)
 */
export function calcRSISeries(closes: number[], period = 14) {
    if (closes.length < period + 1) return [] as Array<number | null>;

    const rsiSeries = Array<number | null>(closes.length).fill(null);
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsiSeries[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = ((avgGain * (period - 1)) + (diff > 0 ? diff : 0)) / period;
        avgLoss = ((avgLoss * (period - 1)) + (diff < 0 ? -diff : 0)) / period;
        rsiSeries[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    }

    return rsiSeries;
}

function findSwingPivots(values: number[], type: 'high' | 'low', window = 2) {
    const pivots: number[] = [];
    for (let i = window; i < values.length - window; i++) {
        const current = values[i];
        let isPivot = true;
        for (let j = i - window; j <= i + window; j++) {
            if (j === i) continue;
            if (type === 'high' && current <= values[j]) { isPivot = false; break; }
            if (type === 'low' && current >= values[j]) { isPivot = false; break; }
        }
        if (isPivot) pivots.push(i);
    }
    return pivots;
}

/**
 * Detect RSI divergence using the latest swing points
 */
export function detectRSIDivergence(candles: Candle[], rsiSeries: Array<number | null>) {
    if (candles.length < 30 || rsiSeries.length !== candles.length) {
        return { signal: 'NONE', strength: 0, details: 'Insufficient data' };
    }

    const closes = candles.map(c => c.close);
    const highPivots = findSwingPivots(closes, 'high', 2).filter(i => rsiSeries[i] !== null);
    const lowPivots = findSwingPivots(closes, 'low', 2).filter(i => rsiSeries[i] !== null);

    const bearishCandidate = highPivots.length >= 2 ? highPivots.slice(-2) : null;
    const bullishCandidate = lowPivots.length >= 2 ? lowPivots.slice(-2) : null;

    let bearish = null as null | { strength: number; details: string };
    let bullish = null as null | { strength: number; details: string };

    if (bearishCandidate) {
        const [a, b] = bearishCandidate;
        const pa = closes[a];
        const pb = closes[b];
        const ra = rsiSeries[a] as number;
        const rb = rsiSeries[b] as number;
        if (pb > pa && rb < ra) {
            const priceDelta = ((pb - pa) / pa) * 100;
            const rsiDelta = ra - rb;
            const strength = clamp(Math.round((priceDelta * 8) + (rsiDelta * 1.5)), 1, 100);
            bearish = {
                strength,
                details: `Price HH (${pa.toFixed(2)} -> ${pb.toFixed(2)}) / RSI LH (${ra.toFixed(1)} -> ${rb.toFixed(1)})`
            };
        }
    }

    if (bullishCandidate) {
        const [a, b] = bullishCandidate;
        const pa = closes[a];
        const pb = closes[b];
        const ra = rsiSeries[a] as number;
        const rb = rsiSeries[b] as number;
        if (pb < pa && rb > ra) {
            const priceDelta = ((pa - pb) / pa) * 100;
            const rsiDelta = rb - ra;
            const strength = clamp(Math.round((priceDelta * 8) + (rsiDelta * 1.5)), 1, 100);
            bullish = {
                strength,
                details: `Price LL (${pa.toFixed(2)} -> ${pb.toFixed(2)}) / RSI HL (${ra.toFixed(1)} -> ${rb.toFixed(1)})`
            };
        }
    }

    if (!bullish && !bearish) {
        return { signal: 'NONE', strength: 0, details: 'No clear divergence' };
    }

    if (bullish && bearish) {
        return bullish.strength >= bearish.strength
            ? { signal: 'BULLISH', strength: bullish.strength, details: bullish.details }
            : { signal: 'BEARISH', strength: bearish.strength, details: bearish.details };
    }

    if (bullish) return { signal: 'BULLISH', strength: bullish.strength, details: bullish.details };
    return { signal: 'BEARISH', strength: (bearish as any).strength, details: (bearish as any).details };
}

/**
 * Calculate Stochastic RSI
 */
export function calcStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
    const rsiSeriesRaw = calcRSISeries(closes, rsiPeriod);
    const rsiSeries = rsiSeriesRaw.filter((v): v is number => v !== null);
    if (rsiSeries.length < stochPeriod + smoothK + smoothD) return null;

    const rawStochRsi: number[] = [];
    for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
        const slice = rsiSeries.slice(i - stochPeriod + 1, i + 1);
        const lowest = Math.min(...slice);
        const highest = Math.max(...slice);
        const value = highest === lowest ? 50 : ((rsiSeries[i] - lowest) / (highest - lowest)) * 100;
        rawStochRsi.push(value);
    }

    const kSeries = calcSMA(rawStochRsi, smoothK);
    if (!kSeries || kSeries.length < smoothD) return null;
    const dSeries = calcSMA(kSeries, smoothD);
    if (!dSeries) return null;

    const k = kSeries[kSeries.length - 1];
    const d = dSeries[dSeries.length - 1];

    let signal = 'NEUTRAL';
    if (k > d && k < 80) signal = 'BULLISH';
    else if (k < d && k > 20) signal = 'BEARISH';
    else if (k >= 80) signal = 'OVERBOUGHT';
    else if (k <= 20) signal = 'OVERSOLD';

    return {
        k: parseFloat(k.toFixed(2)),
        d: parseFloat(d.toFixed(2)),
        signal
    };
}

/**
 * Calculate Ichimoku snapshot
 */
export function calcIchimoku(candles: Candle[], currentPrice: number) {
    if (!candles || candles.length < 26) return null;

    const calcMidpoint = (period: number) => {
        if (candles.length < period) return null;
        const slice = candles.slice(-period);
        const highest = Math.max(...slice.map(c => c.high));
        const lowest = Math.min(...slice.map(c => c.low));
        return (highest + lowest) / 2;
    };

    const tenkan = calcMidpoint(9);
    const kijun = calcMidpoint(26);
    const spanB = calcMidpoint(52);
    const spanA = tenkan !== null && kijun !== null ? (tenkan + kijun) / 2 : null;

    if (tenkan === null || kijun === null || spanA === null || spanB === null) {
        return {
            tenkan: tenkan !== null ? parseFloat(tenkan.toFixed(2)) : null,
            kijun: kijun !== null ? parseFloat(kijun.toFixed(2)) : null,
            spanA: spanA !== null ? parseFloat(spanA.toFixed(2)) : null,
            spanB: spanB !== null ? parseFloat(spanB.toFixed(2)) : null,
            cloudTop: null,
            cloudBottom: null,
            signal: 'NEUTRAL',
            strength: 0
        };
    }

    const cloudTop = Math.max(spanA, spanB);
    const cloudBottom = Math.min(spanA, spanB);

    let signal = 'NEUTRAL';
    let strength = 50;
    if (currentPrice > cloudTop && tenkan > kijun) {
        signal = 'BULLISH';
        strength = 70 + (tenkan > spanA ? 10 : 0);
    } else if (currentPrice < cloudBottom && tenkan < kijun) {
        signal = 'BEARISH';
        strength = 70 + (tenkan < spanB ? 10 : 0);
    } else if (currentPrice > kijun) {
        signal = 'BULLISH';
        strength = 58;
    } else if (currentPrice < kijun) {
        signal = 'BEARISH';
        strength = 58;
    }

    return {
        tenkan: parseFloat(tenkan.toFixed(2)),
        kijun: parseFloat(kijun.toFixed(2)),
        spanA: parseFloat(spanA.toFixed(2)),
        spanB: parseFloat(spanB.toFixed(2)),
        cloudTop: parseFloat(cloudTop.toFixed(2)),
        cloudBottom: parseFloat(cloudBottom.toFixed(2)),
        signal,
        strength
    };
}

/**
 * Calculate OBV
 */
export function calcOBV(candles: Candle[]) {
    if (!candles || candles.length < 2) return null;
    let obv = 0;
    const series = [0];

    for (let i = 1; i < candles.length; i++) {
        const volume = candles[i].volume || 0;
        if (candles[i].close > candles[i - 1].close) obv += volume;
        else if (candles[i].close < candles[i - 1].close) obv -= volume;
        series.push(obv);
    }

    const lookback = Math.min(14, series.length - 1);
    const previous = series[series.length - 1 - lookback];
    const slope = previous === 0 ? 0 : ((series[series.length - 1] - previous) / Math.abs(previous || 1)) * 100;
    const trend = slope > 2 ? 'UP' : slope < -2 ? 'DOWN' : 'FLAT';

    return {
        value: Math.round(obv),
        slope: parseFloat(slope.toFixed(2)),
        trend
    };
}

/**
 * Calculate synthetic CVD from candle direction and volume
 */
export function calcCVD(candles: Candle[]) {
    if (!candles || candles.length < 2) return null;
    let cvd = 0;
    const series = [0];

    for (let i = 1; i < candles.length; i++) {
        const candle = candles[i];
        const range = Math.max(candle.high - candle.low, 1e-9);
        const body = Math.abs(candle.close - candle.open);
        const bodyWeight = clamp((body / range) + 0.15, 0.15, 1);
        const volume = candle.volume || 0;
        const direction = candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0;
        const delta = direction * volume * bodyWeight;
        cvd += delta;
        series.push(cvd);
    }

    const lookback = Math.min(14, series.length - 1);
    const previous = series[series.length - 1 - lookback];
    const slope = previous === 0 ? 0 : ((series[series.length - 1] - previous) / Math.abs(previous || 1)) * 100;
    const trend = slope > 2 ? 'UP' : slope < -2 ? 'DOWN' : 'FLAT';

    return {
        value: Math.round(cvd),
        slope: parseFloat(slope.toFixed(2)),
        trend
    };
}

/**
 * Calculate Volume Profile snapshot (POC / VAH / VAL)
 */
export function calcVolumeProfile(candles: Candle[], currentPrice: number, lookback = 120, bins = 24) {
    const slice = candles.slice(-lookback);
    if (slice.length < 10) return null;

    const low = Math.min(...slice.map(c => c.low));
    const high = Math.max(...slice.map(c => c.high));
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;

    const step = (high - low) / bins;
    const volumes = Array<number>(bins).fill(0);

    for (const candle of slice) {
        const typical = (candle.high + candle.low + candle.close) / 3;
        const idx = clamp(Math.floor((typical - low) / step), 0, bins - 1);
        volumes[idx] += candle.volume || 0;
    }

    const totalVolume = volumes.reduce((a, b) => a + b, 0) || 1;
    let pocIndex = 0;
    for (let i = 1; i < volumes.length; i++) {
        if (volumes[i] > volumes[pocIndex]) pocIndex = i;
    }

    const entries = volumes.map((vol, idx) => ({
        idx,
        vol,
        price: low + (step * (idx + 0.5))
    }));

    const sortedByVolume = [...entries].sort((a, b) => b.vol - a.vol);
    let acc = 0;
    const selected = new Set<number>();
    for (const item of sortedByVolume) {
        selected.add(item.idx);
        acc += item.vol;
        if (acc / totalVolume >= 0.7) break;
    }

    const selectedPrices = entries.filter(e => selected.has(e.idx)).map(e => e.price);
    const poc = entries[pocIndex].price;
    const vah = selectedPrices.length > 0 ? Math.max(...selectedPrices) : poc;
    const val = selectedPrices.length > 0 ? Math.min(...selectedPrices) : poc;

    const abovePoc = currentPrice >= poc;
    const upperVolume = entries.filter(e => e.price >= poc).reduce((sum, e) => sum + e.vol, 0);
    const lowerVolume = entries.filter(e => e.price < poc).reduce((sum, e) => sum + e.vol, 0);
    const skew = upperVolume > lowerVolume * 1.1 ? 'BUY' : lowerVolume > upperVolume * 1.1 ? 'SELL' : 'NEUTRAL';

    return {
        poc: parseFloat(poc.toFixed(2)),
        vah: parseFloat(vah.toFixed(2)),
        val: parseFloat(val.toFixed(2)),
        abovePoc,
        skew
    };
}

export function calcKeltnerChannels(candles: Candle[], period = 20, multiplier = 1.5) {
    if (!candles || candles.length < period + 1) return null;
    const closes = candles.map(c => c.close);
    const emaArr = calcEMA(closes, period);
    const atr = calcATR(candles, period);
    if (!emaArr || atr === null) return null;

    const middle = emaArr[emaArr.length - 1];
    const upper = middle + (atr * multiplier);
    const lower = middle - (atr * multiplier);
    const widthPct = middle === 0 ? 0 : ((upper - lower) / middle) * 100;

    return {
        upper: parseFloat(upper.toFixed(2)),
        middle: parseFloat(middle.toFixed(2)),
        lower: parseFloat(lower.toFixed(2)),
        widthPct: parseFloat(widthPct.toFixed(4))
    };
}

/**
 * Detect BB squeeze using Bollinger Bands inside Keltner Channels
 */
export function calcBBSqueeze(candles: Candle[], bbInput?: ReturnType<typeof calcBollingerBands> | null) {
    const closes = candles.map(c => c.close);
    const bb = bbInput || calcBollingerBands(closes, 20, 2);
    const kc = calcKeltnerChannels(candles, 20, 1.5);
    if (!bb || !kc) return null;

    const bbWidth = bb.middle === 0 ? 0 : ((bb.upper - bb.lower) / bb.middle) * 100;
    const kcWidth = kc.middle === 0 ? 0 : ((kc.upper - kc.lower) / kc.middle) * 100;
    const isSqueezing = bb.upper < kc.upper && bb.lower > kc.lower;
    const intensity = kcWidth === 0 ? 0 : clamp(((kcWidth - bbWidth) / kcWidth) * 100, -100, 100);

    return {
        isSqueezing,
        state: isSqueezing ? 'ON' : 'OFF',
        bbWidth: parseFloat(bbWidth.toFixed(4)),
        kcWidth: parseFloat(kcWidth.toFixed(4)),
        intensity: parseFloat(intensity.toFixed(2)),
        keltnerUpper: kc.upper,
        keltnerLower: kc.lower
    };
}

/**
 * Detect basic order block zones
 */
export function detectOrderBlocks(candles: Candle[], atr: number | null) {
    if (!candles || candles.length < 20) return [];
    const zones: Array<{ type: 'BULLISH' | 'BEARISH'; low: number; high: number; age: number }> = [];
    const threshold = atr ? atr * 0.8 : candles[candles.length - 1].close * 0.0015;
    const start = Math.max(5, candles.length - 120);

    for (let i = start; i < candles.length - 3; i++) {
        const c = candles[i];
        const next = candles.slice(i + 1, i + 4);
        const prevSlice = candles.slice(Math.max(0, i - 5), i);
        if (next.length < 3 || prevSlice.length < 3) continue;

        const prevHigh = Math.max(...prevSlice.map(x => x.high));
        const prevLow = Math.min(...prevSlice.map(x => x.low));
        const lastNextClose = next[next.length - 1].close;

        const bullishBreak = c.close < c.open && next.some(n => n.close > prevHigh) && (lastNextClose - c.close) > threshold;
        if (bullishBreak) {
            zones.push({
                type: 'BULLISH',
                low: parseFloat(c.low.toFixed(2)),
                high: parseFloat(Math.max(c.open, c.close).toFixed(2)),
                age: candles.length - 1 - i
            });
        }

        const bearishBreak = c.close > c.open && next.some(n => n.close < prevLow) && (c.close - lastNextClose) > threshold;
        if (bearishBreak) {
            zones.push({
                type: 'BEARISH',
                low: parseFloat(Math.min(c.open, c.close).toFixed(2)),
                high: parseFloat(c.high.toFixed(2)),
                age: candles.length - 1 - i
            });
        }
    }

    return zones.slice(-8);
}

/**
 * Detect Fair Value Gaps
 */
export function detectFVGs(candles: Candle[]) {
    if (!candles || candles.length < 5) return [];
    const gaps: Array<{ type: 'BULLISH' | 'BEARISH'; low: number; high: number; age: number }> = [];

    for (let i = 1; i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const next = candles[i + 1];

        if (prev.high < next.low) {
            gaps.push({
                type: 'BULLISH',
                low: parseFloat(prev.high.toFixed(2)),
                high: parseFloat(next.low.toFixed(2)),
                age: candles.length - 1 - i
            });
        }

        if (prev.low > next.high) {
            gaps.push({
                type: 'BEARISH',
                low: parseFloat(next.high.toFixed(2)),
                high: parseFloat(prev.low.toFixed(2)),
                age: candles.length - 1 - i
            });
        }
    }

    return gaps.slice(-10);
}

/**
 * Calculate Fibonacci retracement structure from recent swings
 */
export function calcFibonacciStructure(candles: Candle[], currentPrice: number) {
    const slice = candles.slice(-160);
    if (slice.length < 20) return null;

    let swingHigh = -Infinity;
    let swingLow = Infinity;
    let highIndex = -1;
    let lowIndex = -1;

    for (let i = 0; i < slice.length; i++) {
        if (slice[i].high > swingHigh) {
            swingHigh = slice[i].high;
            highIndex = i;
        }
        if (slice[i].low < swingLow) {
            swingLow = slice[i].low;
            lowIndex = i;
        }
    }

    if (!Number.isFinite(swingHigh) || !Number.isFinite(swingLow) || swingHigh <= swingLow) return null;

    const trend = highIndex > lowIndex ? 'UP' : lowIndex > highIndex ? 'DOWN' : 'RANGE';
    const range = swingHigh - swingLow;

    const levels = trend === 'DOWN'
        ? {
            '0.236': swingLow + range * 0.236,
            '0.382': swingLow + range * 0.382,
            '0.5': swingLow + range * 0.5,
            '0.618': swingLow + range * 0.618,
            '0.786': swingLow + range * 0.786
        }
        : {
            '0.236': swingHigh - range * 0.236,
            '0.382': swingHigh - range * 0.382,
            '0.5': swingHigh - range * 0.5,
            '0.618': swingHigh - range * 0.618,
            '0.786': swingHigh - range * 0.786
        };

    const entries = Object.entries(levels).map(([name, price]) => ({ name, price }));
    entries.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
    const nearest = entries[0];

    const gpMin = Math.min(levels['0.5'], levels['0.618']);
    const gpMax = Math.max(levels['0.5'], levels['0.618']);
    const inGoldenPocket = currentPrice >= gpMin && currentPrice <= gpMax;

    return {
        trend,
        swingHigh: parseFloat(swingHigh.toFixed(2)),
        swingLow: parseFloat(swingLow.toFixed(2)),
        levels: {
            '0.236': parseFloat(levels['0.236'].toFixed(2)),
            '0.382': parseFloat(levels['0.382'].toFixed(2)),
            '0.5': parseFloat(levels['0.5'].toFixed(2)),
            '0.618': parseFloat(levels['0.618'].toFixed(2)),
            '0.786': parseFloat(levels['0.786'].toFixed(2))
        },
        nearestLevel: nearest ? nearest.name : null,
        nearestPrice: nearest ? parseFloat(nearest.price.toFixed(2)) : null,
        inGoldenPocket
    };
}

function aggregateCandles(candles: Candle[], multiplier: number) {
    if (multiplier <= 1) return candles.slice();
    const aggregated: Candle[] = [];

    for (let i = 0; i < candles.length; i += multiplier) {
        const chunk = candles.slice(i, i + multiplier);
        if (chunk.length < Math.max(2, Math.floor(multiplier * 0.6))) continue;
        aggregated.push({
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0),
            time: chunk[chunk.length - 1].time
        });
    }

    return aggregated;
}

function evaluateSimpleTrendSignal(candles: Candle[]) {
    if (candles.length < 30) return 'HOLD';
    const closes = candles.map(c => c.close);
    const ema9arr = calcEMA(closes, 9);
    const ema21arr = calcEMA(closes, 21);
    if (!ema9arr || !ema21arr) return 'HOLD';

    const ema9 = ema9arr[ema9arr.length - 1];
    const ema21 = ema21arr[ema21arr.length - 1];
    const price = closes[closes.length - 1];
    const ichimoku = calcIchimoku(candles, price);

    let bias = 0;
    bias += ema9 > ema21 ? 1 : -1;
    bias += price > ema21 ? 1 : -1;
    if (ichimoku?.signal === 'BULLISH') bias += 1;
    else if (ichimoku?.signal === 'BEARISH') bias -= 1;

    if (bias >= 2) return 'BUY';
    if (bias <= -2) return 'SELL';
    return 'HOLD';
}

/**
 * Local multi-timeframe confluence from aggregated candles
 */
export function calcLocalMTFConfluence(candles: Candle[]) {
    const tfConfigs = [
        { label: 'Base', m: 1 },
        { label: 'x3', m: 3 },
        { label: 'x12', m: 12 }
    ];

    const details: Array<{ tf: string; signal: 'BUY' | 'SELL' | 'HOLD' }> = [];
    let bullish = 0;
    let bearish = 0;
    let neutral = 0;

    for (const tf of tfConfigs) {
        const agg = aggregateCandles(candles, tf.m);
        const signal = evaluateSimpleTrendSignal(agg) as 'BUY' | 'SELL' | 'HOLD';
        details.push({ tf: tf.label, signal });
        if (signal === 'BUY') bullish++;
        else if (signal === 'SELL') bearish++;
        else neutral++;
    }

    const total = details.length || 1;
    const dominant = Math.max(bullish, bearish, neutral);
    const strength = Math.round((dominant / total) * 100);
    const signal = bullish > bearish ? 'BUY' : bearish > bullish ? 'SELL' : 'HOLD';

    return {
        bullish,
        bearish,
        neutral,
        total,
        strength,
        signal,
        details
    };
}

function makeComboBlock(bias: number, reasons: string[]) {
    const score = clamp(Math.round((bias + 100) / 2), 0, 100);
    const signal = score >= 60 ? 'BUY' : score <= 40 ? 'SELL' : 'NEUTRAL';
    return { score, signal, reasons };
}

/**
 * Build the pro confluence combo without replacing legacy indicators
 */
export function calculateProCombo(candles: Candle[], indicators: any, currentPrice: number) {
    const atr = indicators.atr || 0;

    const trendReasons: string[] = [];
    let trendBias = 0;
    if (indicators.ema9 !== null && indicators.ema21 !== null) {
        if (indicators.ema9 > indicators.ema21) { trendBias += 30; trendReasons.push('EMA 9/21 bullish'); }
        else { trendBias -= 30; trendReasons.push('EMA 9/21 bearish'); }
    }
    if (indicators.ichimoku?.signal === 'BULLISH') { trendBias += 35; trendReasons.push('Ichimoku bullish cloud'); }
    else if (indicators.ichimoku?.signal === 'BEARISH') { trendBias -= 35; trendReasons.push('Ichimoku bearish cloud'); }
    const trendBlock = makeComboBlock(trendBias, trendReasons);

    const momentumReasons: string[] = [];
    let momentumBias = 0;
    if (indicators.rsiDivergence?.signal === 'BULLISH') { momentumBias += 35; momentumReasons.push('RSI bullish divergence'); }
    else if (indicators.rsiDivergence?.signal === 'BEARISH') { momentumBias -= 35; momentumReasons.push('RSI bearish divergence'); }
    if (indicators.stochRsi?.signal === 'BULLISH') { momentumBias += 25; momentumReasons.push('Stoch RSI bullish cross'); }
    else if (indicators.stochRsi?.signal === 'BEARISH') { momentumBias -= 25; momentumReasons.push('Stoch RSI bearish cross'); }
    if (indicators.rsi !== null) {
        if (indicators.rsi > 55) momentumBias += 15;
        else if (indicators.rsi < 45) momentumBias -= 15;
    }
    const momentumBlock = makeComboBlock(momentumBias, momentumReasons);

    const volumeReasons: string[] = [];
    let volumeBias = 0;
    if (indicators.obv?.trend === 'UP') { volumeBias += 20; volumeReasons.push('OBV rising'); }
    else if (indicators.obv?.trend === 'DOWN') { volumeBias -= 20; volumeReasons.push('OBV falling'); }
    if (indicators.cvd?.trend === 'UP') { volumeBias += 20; volumeReasons.push('CVD positive'); }
    else if (indicators.cvd?.trend === 'DOWN') { volumeBias -= 20; volumeReasons.push('CVD negative'); }
    if (indicators.volumeProfile?.skew === 'BUY') { volumeBias += 20; volumeReasons.push('Volume profile buy-side skew'); }
    else if (indicators.volumeProfile?.skew === 'SELL') { volumeBias -= 20; volumeReasons.push('Volume profile sell-side skew'); }
    if (indicators.volumeProfile?.poc) {
        if (currentPrice > indicators.volumeProfile.poc) volumeBias += 10;
        else if (currentPrice < indicators.volumeProfile.poc) volumeBias -= 10;
    }
    const volumeBlock = makeComboBlock(volumeBias, volumeReasons);

    const volatilityReasons: string[] = [];
    let volatilityBias = 0;
    if (indicators.bbSqueeze?.isSqueezing) {
        volatilityReasons.push('BB squeeze active');
        if (trendBlock.signal === 'BUY') volatilityBias += 15;
        else if (trendBlock.signal === 'SELL') volatilityBias -= 15;
    } else {
        if (indicators.bbUpper !== null && currentPrice > indicators.bbUpper) {
            volatilityBias += 20;
            volatilityReasons.push('Price breaking above BB upper');
        } else if (indicators.bbLower !== null && currentPrice < indicators.bbLower) {
            volatilityBias -= 20;
            volatilityReasons.push('Price breaking below BB lower');
        }
    }
    if (atr > 0) {
        const atrPct = (atr / currentPrice) * 100;
        volatilityReasons.push(`ATR ${atrPct.toFixed(2)}%`);
    }
    const volatilityBlock = makeComboBlock(volatilityBias, volatilityReasons);

    const structureReasons: string[] = [];
    let structureBias = 0;

    const nearestBullOB = (indicators.orderBlocks || [])
        .filter((z: any) => z.type === 'BULLISH')
        .sort((a: any, b: any) => a.age - b.age)[0];
    const nearestBearOB = (indicators.orderBlocks || [])
        .filter((z: any) => z.type === 'BEARISH')
        .sort((a: any, b: any) => a.age - b.age)[0];

    if (nearestBullOB && currentPrice >= nearestBullOB.low - atr * 0.6 && currentPrice <= nearestBullOB.high + atr * 0.6) {
        structureBias += 25;
        structureReasons.push('Price near bullish order block');
    }
    if (nearestBearOB && currentPrice >= nearestBearOB.low - atr * 0.6 && currentPrice <= nearestBearOB.high + atr * 0.6) {
        structureBias -= 25;
        structureReasons.push('Price near bearish order block');
    }

    const nearestBullFvg = (indicators.fvgs || [])
        .filter((z: any) => z.type === 'BULLISH')
        .sort((a: any, b: any) => a.age - b.age)[0];
    const nearestBearFvg = (indicators.fvgs || [])
        .filter((z: any) => z.type === 'BEARISH')
        .sort((a: any, b: any) => a.age - b.age)[0];

    if (nearestBullFvg && currentPrice >= nearestBullFvg.low && currentPrice <= nearestBullFvg.high + atr * 0.4) {
        structureBias += 20;
        structureReasons.push('Inside bullish FVG');
    }
    if (nearestBearFvg && currentPrice <= nearestBearFvg.high && currentPrice >= nearestBearFvg.low - atr * 0.4) {
        structureBias -= 20;
        structureReasons.push('Inside bearish FVG');
    }

    if (indicators.fibonacci?.inGoldenPocket) {
        if (indicators.fibonacci.trend === 'UP') {
            structureBias += 20;
            structureReasons.push('Fib golden pocket in uptrend');
        } else if (indicators.fibonacci.trend === 'DOWN') {
            structureBias -= 20;
            structureReasons.push('Fib golden pocket in downtrend');
        }
    }
    const structureBlock = makeComboBlock(structureBias, structureReasons);

    const confirmationReasons: string[] = [];
    let confirmationBias = 0;
    if (indicators.mtfConfluence) {
        confirmationReasons.push(`MTF ${indicators.mtfConfluence.signal} (${indicators.mtfConfluence.strength}%)`);
        if (indicators.mtfConfluence.signal === 'BUY') confirmationBias += Math.round(indicators.mtfConfluence.strength * 0.6);
        else if (indicators.mtfConfluence.signal === 'SELL') confirmationBias -= Math.round(indicators.mtfConfluence.strength * 0.6);
    }
    const confirmationBlock = makeComboBlock(confirmationBias, confirmationReasons);

    const weights = {
        trend: 0.22,
        momentum: 0.18,
        volume: 0.18,
        volatility: 0.12,
        structure: 0.18,
        confirmation: 0.12
    };

    const comboScore = Math.round(
        trendBlock.score * weights.trend +
        momentumBlock.score * weights.momentum +
        volumeBlock.score * weights.volume +
        volatilityBlock.score * weights.volatility +
        structureBlock.score * weights.structure +
        confirmationBlock.score * weights.confirmation
    );

    const signal = comboScore >= 60 ? 'BUY' : comboScore <= 40 ? 'SELL' : 'HOLD';
    const summary = [
        `Trend ${trendBlock.signal} (${trendBlock.score})`,
        `Momentum ${momentumBlock.signal} (${momentumBlock.score})`,
        `Volume ${volumeBlock.signal} (${volumeBlock.score})`,
        `Volatility ${volatilityBlock.signal} (${volatilityBlock.score})`,
        `Structure ${structureBlock.signal} (${structureBlock.score})`,
        `MTF ${confirmationBlock.signal} (${confirmationBlock.score})`
    ];

    return {
        score: comboScore,
        signal,
        blocks: {
            trend: trendBlock,
            momentum: momentumBlock,
            volume: volumeBlock,
            volatility: volatilityBlock,
            structure: structureBlock,
            confirmation: confirmationBlock
        },
        summary
    };
}

/**
 * Detect candlestick patterns
 */
export function detectPatterns(candles: Candle[]) {
    if (candles.length < 8) return [];

    const lookback = Math.min(50, candles.length);
    const startIndex = Math.max(2, candles.length - lookback);
    const scored: Array<any> = [];
    const recentRanges = candles
        .slice(-Math.min(30, candles.length))
        .map((c) => Math.max(c.high - c.low, 1e-9));
    const avgRangeGlobal = recentRanges.length > 0
        ? recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length
        : 1;
    const atrGlobal = calcATR(candles, 14);
    const latestPrice = Math.max(1e-9, Math.abs(candles[candles.length - 1]?.close || 0));
    const atrBase = Number.isFinite(Number(atrGlobal)) ? Number(atrGlobal) : 0;
    const baseVolatility = Math.max(avgRangeGlobal, atrBase, latestPrice * 0.0006);

    const toEpochMs = (value: number | string) => {
        const n = Number(value);
        if (Number.isFinite(n)) {
            if (n > 1e14) return Math.floor(n / 1000); // microseconds
            if (n > 1e12) return Math.floor(n); // milliseconds
            return Math.floor(n * 1000); // seconds
        }
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : Date.now();
    };

    const chooseDecimals = (price: number) => {
        const abs = Math.abs(price);
        if (abs >= 5000) return 2;
        if (abs >= 100) return 3;
        if (abs >= 1) return 4;
        return 6;
    };

    const roundPx = (price: number, reference: number) => {
        const decimals = chooseDecimals(reference);
        return parseFloat(price.toFixed(decimals));
    };

    const buildTradePlan = (
        type: 'bullish' | 'bearish' | 'neutral',
        index: number,
        quality: number,
        opts?: { horizonBars?: number; rr?: number }
    ) => {
        if (type === 'neutral') return null;
        const c = candles[index];
        if (!c) return null;

        const entry = c.close;
        const range = Math.max(c.high - c.low, 1e-9);
        const volatility = Math.max(baseVolatility, range * 0.8, Math.abs(entry) * 0.00045);
        const rr = clamp(Number(opts?.rr ?? (1.3 + quality * 0.95)), 1.15, 2.8);
        const horizonBars = clamp(Math.round(Number(opts?.horizonBars ?? (4 + quality * 8))), 2, 18);
        const riskBase = Math.max(volatility * (0.55 + (1 - quality) * 0.3), range * 0.72);

        let stopLoss = entry;
        let takeProfit = entry;
        if (type === 'bullish') {
            stopLoss = Math.min(c.low - volatility * 0.2, entry - riskBase);
            const risk = Math.max(entry - stopLoss, volatility * 0.35);
            takeProfit = entry + (risk * rr);
        } else {
            stopLoss = Math.max(c.high + volatility * 0.2, entry + riskBase);
            const risk = Math.max(stopLoss - entry, volatility * 0.35);
            takeProfit = entry - (risk * rr);
        }

        const risk = Math.max(Math.abs(entry - stopLoss), 1e-9);
        const reward = Math.abs(takeProfit - entry);
        const riskReward = reward / risk;
        const action = type === 'bullish' ? 'BUY' : 'SELL';

        return {
            nextAction: action,
            entryPrice: roundPx(entry, entry),
            stopLoss: roundPx(stopLoss, entry),
            takeProfit: roundPx(takeProfit, entry),
            riskReward: parseFloat(riskReward.toFixed(2)),
            horizonBars
        };
    };

    const pushPattern = (
        name: string,
        type: 'bullish' | 'bearish' | 'neutral',
        emoji: string,
        index: number,
        quality = 0.5,
        planOpts?: { horizonBars?: number; rr?: number }
    ) => {
        const recency = clamp(1 - ((candles.length - 1 - index) / lookback), 0, 1);
        const confidence = clamp(Math.round(45 + (quality * 35) + (recency * 20)), 35, 95);
        const score = confidence + Math.round(recency * 10);
        const plan = buildTradePlan(type, index, quality, planOpts);
        scored.push({
            name,
            type,
            emoji,
            confidence,
            nextAction: plan?.nextAction || 'WAIT',
            entryPrice: plan?.entryPrice,
            stopLoss: plan?.stopLoss,
            takeProfit: plan?.takeProfit,
            riskReward: plan?.riskReward,
            horizonBars: plan?.horizonBars,
            timestamp: toEpochMs(candles[index]?.time),
            _score: score,
            _index: index
        });
    };

    for (let i = startIndex; i < candles.length; i++) {
        const c = candles[i];
        const p = candles[i - 1];
        const pp = candles[i - 2];
        const bodySize = Math.abs(c.close - c.open);
        const range = Math.max(c.high - c.low, 1e-9);
        const upperWick = c.high - Math.max(c.open, c.close);
        const lowerWick = Math.min(c.open, c.close) - c.low;
        const bodyRatio = bodySize / range;
        const upperRatio = upperWick / range;
        const lowerRatio = lowerWick / range;

        if (bodyRatio <= 0.11) {
            pushPattern('Doji', 'neutral', '⚖️', i, 1 - bodyRatio);
        }

        if (lowerRatio >= 0.55 && upperRatio <= 0.18 && bodyRatio <= 0.35 && c.close >= c.open) {
            pushPattern('Hammer', 'bullish', '🔨', i, lowerRatio, { horizonBars: 6, rr: 1.75 });
        }

        if (upperRatio >= 0.55 && lowerRatio <= 0.18 && bodyRatio <= 0.35 && c.close <= c.open) {
            pushPattern('Shooting Star', 'bearish', '⭐', i, upperRatio, { horizonBars: 6, rr: 1.75 });
        }

        const pBody = Math.abs(p.close - p.open);
        if (
            p.close < p.open &&
            c.close > c.open &&
            c.open <= p.close &&
            c.close >= p.open &&
            bodySize >= pBody * 0.9
        ) {
            const quality = clamp(bodySize / Math.max(pBody, 1e-9), 0.5, 1.8) / 1.8;
            pushPattern('Bullish Engulfing', 'bullish', '🟢', i, quality, { horizonBars: 7, rr: 1.9 });
        }

        if (
            p.close > p.open &&
            c.close < c.open &&
            c.open >= p.close &&
            c.close <= p.open &&
            bodySize >= pBody * 0.9
        ) {
            const quality = clamp(bodySize / Math.max(pBody, 1e-9), 0.5, 1.8) / 1.8;
            pushPattern('Bearish Engulfing', 'bearish', '🔴', i, quality, { horizonBars: 7, rr: 1.9 });
        }

        const ppBody = Math.abs(pp.close - pp.open);
        if (
            pp.close < pp.open &&
            pBody < ppBody * 0.45 &&
            c.close > c.open &&
            c.close > (pp.open + pp.close) / 2
        ) {
            pushPattern('Morning Star', 'bullish', '🌅', i, 0.74, { horizonBars: 8, rr: 2.0 });
        }

        if (
            pp.close > pp.open &&
            pBody < ppBody * 0.45 &&
            c.close < c.open &&
            c.close < (pp.open + pp.close) / 2
        ) {
            pushPattern('Evening Star', 'bearish', '🌆', i, 0.74, { horizonBars: 8, rr: 2.0 });
        }
    }

    // Micro-structure patterns with confirmation on the next candle to avoid flicker.
    const anchorIndex = candles.length - 2;
    const confirmIndex = candles.length - 1;
    if (anchorIndex >= 5 && confirmIndex > anchorIndex) {
        const windowStart = Math.max(0, anchorIndex - 11);
        const microWindow = candles.slice(windowStart, anchorIndex + 1);
        if (microWindow.length >= 6) {
            const anchor = candles[anchorIndex];
            const confirm = candles[confirmIndex];
            const highs = microWindow.slice(0, -1).map((c) => c.high);
            const lows = microWindow.slice(0, -1).map((c) => c.low);
            const resistance = Math.max(...highs);
            const support = Math.min(...lows);
            const avgRange = microWindow.reduce((sum, c) => sum + Math.max(1e-9, c.high - c.low), 0) / microWindow.length;
            const anchorRange = Math.max(anchor.high - anchor.low, 1e-9);
            const bodyStrength = Math.abs(anchor.close - anchor.open) / anchorRange;
            const upperWickStrength = (anchor.high - Math.max(anchor.open, anchor.close)) / anchorRange;
            const lowerWickStrength = (Math.min(anchor.open, anchor.close) - anchor.low) / anchorRange;

            const breakoutBuffer = avgRange * 0.14;
            const breakoutUp =
                anchor.close > (resistance + breakoutBuffer) &&
                bodyStrength >= 0.45 &&
                confirm.close >= anchor.close - (avgRange * 0.12);
            const breakoutDown =
                anchor.close < (support - breakoutBuffer) &&
                bodyStrength >= 0.45 &&
                confirm.close <= anchor.close + (avgRange * 0.12);
            const rejectionResistance =
                anchor.high >= resistance &&
                anchor.close < (resistance - (avgRange * 0.06)) &&
                upperWickStrength >= 0.34 &&
                confirm.close <= anchor.high;
            const reclaimSupport =
                anchor.low <= support &&
                anchor.close > (support + (avgRange * 0.06)) &&
                lowerWickStrength >= 0.34 &&
                confirm.close >= anchor.low;

            if (breakoutUp) pushPattern('Brisee Micro-Resistance', 'bullish', '🚀', anchorIndex, 0.84, { horizonBars: 5, rr: 1.7 });
            if (breakoutDown) pushPattern('Brisee Micro-Support', 'bearish', '📉', anchorIndex, 0.84, { horizonBars: 5, rr: 1.7 });
            if (rejectionResistance) pushPattern('Rejet Micro-Resistance', 'bearish', '⛔', anchorIndex, 0.7, { horizonBars: 6, rr: 1.6 });
            if (reclaimSupport) pushPattern('Reprise Micro-Support', 'bullish', '✅', anchorIndex, 0.7, { horizonBars: 6, rr: 1.6 });
        }
    }

    // EMA pullback with one-candle confirmation to reduce noise.
    const closes = candles.map((c) => c.close);
    if (closes.length >= 24 && candles.length >= 3) {
        const ema9 = calcEMA(closes, 9);
        const ema21 = calcEMA(closes, 21);
        if (ema9 && ema21 && ema9.length >= 2 && ema21.length >= 2) {
            const fastNow = ema9[ema9.length - 1];
            const slowNow = ema21[ema21.length - 1];
            const fastPrev = ema9[ema9.length - 2];
            const slowPrev = ema21[ema21.length - 2];

            const pullbackIndex = candles.length - 2;
            const confirm = candles[candles.length - 1];
            const pullbackCandle = candles[pullbackIndex];
            const nearFast = Math.abs(pullbackCandle.close - fastPrev) <= Math.max(avgRangeGlobal * 0.65, Math.abs(fastPrev) * 0.0012);
            const trendUp = fastNow > slowNow && fastPrev >= slowPrev;
            const trendDown = fastNow < slowNow && fastPrev <= slowPrev;

            if (nearFast && trendUp && confirm.close > fastNow) {
                pushPattern('Pullback EMA confirmé', 'bullish', '📈', pullbackIndex, 0.68, { horizonBars: 7, rr: 1.9 });
            } else if (nearFast && trendDown && confirm.close < fastNow) {
                pushPattern('Pullback EMA confirmé', 'bearish', '📉', pullbackIndex, 0.68, { horizonBars: 7, rr: 1.9 });
            }
        }
    }

    // Deduplicate by name/type, keeping the strongest and most recent.
    const bestByKey = new Map<string, any>();
    for (const item of scored) {
        const key = `${item.name}:${item.type}`;
        const prev = bestByKey.get(key);
        if (!prev || item._score > prev._score || (item._score === prev._score && item._index > prev._index)) {
            bestByKey.set(key, item);
        }
    }

    return Array.from(bestByKey.values())
        .sort((a, b) => (b._score - a._score) || (b._index - a._index))
        .slice(0, 8)
        .map(({ _score, _index, ...pattern }) => pattern);
}

/**
 * Determine overall trend direction
 */
export function determineTrend(indicators: any, currentPrice: number) {
    let bullishCount = 0;
    let bearishCount = 0;
    let totalSignals = 0;
    const reasons = [];

    // EMA Trend
    if (indicators.ema9 !== null && indicators.ema21 !== null) {
        totalSignals++;
        if (indicators.ema9 > indicators.ema21) {
            bullishCount++;
            reasons.push('EMA 9 > 21 ↑');
        } else {
            bearishCount++;
            reasons.push('EMA 9 < 21 ↓');
        }
    }
    if (indicators.ema50 !== null && indicators.ema200 !== null) {
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
    if (indicators.ema50 !== null && currentPrice) {
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
            reasons.push('MACD Haussier ↑');
        } else {
            bearishCount++;
            reasons.push('MACD Baissier ↓');
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
            reasons.push('Prix > VWAP ↑');
        } else {
            bearishCount++;
            reasons.push('Prix < VWAP ↓');
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
export function calculateAllIndicators(candles: Candle[], settings: IndicatorSettings = {}) {
    if (!candles || candles.length < 30) return null;

    const normalized = normalizeIndicatorSettings(settings);
    const {
        rsiPeriod,
        bollingerStdDev,
        supertrendAtrPeriod,
        supertrendMultiplier
    } = normalized;

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    const rsi = calcRSI(closes, rsiPeriod);
    const rsiSeries = calcRSISeries(closes, rsiPeriod);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes, 20, bollingerStdDev);
    const atr = calcATR(candles);
    const stochastic = calcStochastic(candles);
    const stochRsi = calcStochRSI(closes, rsiPeriod);
    const rsiDivergence = detectRSIDivergence(candles, rsiSeries);
    const adx = calcADX(candles);
    const williamsR = calcWilliamsR(candles);
    const cci = calcCCI(candles);
    const mfi = calcMFI(candles);
    const pivotPoints = calcPivotPoints(candles);
    const vwap = calcVWAP(candles);
    const obv = calcOBV(candles);
    const cvd = calcCVD(candles);
    const volumeProfile = calcVolumeProfile(candles, currentPrice);
    const keltner = calcKeltnerChannels(candles, 20, 1.5);
    const bbSqueeze = calcBBSqueeze(candles, bb);
    const ichimoku = calcIchimoku(candles, currentPrice);
    const supertrend = calcSupertrend(candles, supertrendAtrPeriod, supertrendMultiplier);
    const orderBlocks = detectOrderBlocks(candles, atr);
    const fvgs = detectFVGs(candles);
    const fibonacci = calcFibonacciStructure(candles, currentPrice);
    const mtfConfluence = calcLocalMTFConfluence(candles);
    const patterns = detectPatterns(candles);


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
        stochRsi,
        rsiDivergence,
        adx,
        williamsR,
        cci,
        mfi,
        pivotPoints,
        vwap,
        vwapSession: vwap,
        vwapRolling: vwap,
        obv,
        cvd,
        volumeProfile,
        keltner,
        bbSqueeze,
        ichimoku,
        supertrend,
        orderBlocks,
        fvgs,
        fibonacci,
        mtfConfluence,
        patterns,
        ema9, ema21, ema50, ema200,
        emaArrays: { ema9: ema9arr, ema21: ema21arr, ema50: ema50arr, ema200: ema200arr },
        trend: null as any,
        proCombo: null as any,
        compositeScore: 0
    };

    (indicators as any).indicatorSettings = normalized;

    indicators.trend = determineTrend(indicators, currentPrice);
    indicators.proCombo = calculateProCombo(candles, indicators, currentPrice);
    indicators.compositeScore = indicators.proCombo ? indicators.proCombo.score - 50 : indicators.trend.bullishPct - 50;

    return indicators;
}
