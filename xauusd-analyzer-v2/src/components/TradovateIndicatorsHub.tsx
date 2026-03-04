import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators, Candle as IndicatorCandle } from '../utils/indicators';
import TradeActionCard from './TradeActionCard';
import { buildTradeVerdict } from '../utils/tradeVerdict';

type CatalogSectionKey = 'builtin' | 'examples' | 'tools' | 'typescript' | 'tutorial';
type TradeSignal = 'BUY' | 'SELL' | 'HOLD';

type CatalogSection = {
    key: CatalogSectionKey;
    label: string;
    icon: string;
    prefix: string;
    files: string[];
    note: string;
};

type CatalogEntry = {
    id: string;
    section: CatalogSectionKey;
    sectionLabel: string;
    path: string;
    file: string;
    name: string;
};

type LiveAnalysis = {
    signal: TradeSignal;
    confidence: number;
    valueLabel: string;
    narrative: string;
    reasons: string[];
};

type CoreMatrixRow = {
    id: string;
    label: string;
    value: string;
    signal: TradeSignal;
    note: string;
};

const BUILTIN_FILES = [
    'massIndex.js', 'rateOfChange.js', 'sma.js', 'williamR.js', 'adl.js', 'volume.js', 'mfi.js', 'momentum.js',
    'volatility.js', 'dpo.js', 'pivotPoints.js', 'cmf.js', 'rsi.js', 'chaikinOscillator.js', 'tma.js', 'trix.js',
    'performance.js', 'aroon.js', 'ppo.js', 'forceIndex.js', 'bbwidth.js', 'vwap.js', 'slowStochastic.js', 'adx.js',
    'wma.js', 'emv.js', 'keltnerChannels.js', 'priceChannel.js', 'pvt.js', 'ac.js', 'cumulativeDelta.js', 'percentB.js',
    'bband.js', 'envelopes.js', 'hma.js', 'cci.js', 'typicalPrice.js', 'psar.js', 'macd.js', 'ema.js', 'stochastic.js', 'atr.js'
];

const EXAMPLE_FILES = [
    'substantialGain.js', '03-EMA.js', '04-DoubleEMA.js', 'alligator.js', '01-SimpleOffset.js',
    'priceChannel.js', '07-FourierMA.js', '02-ParameterizedOffset.js', '05-SignalingATR.js'
];

const TOOL_FILES = [
    'moneyFlowVolume.js', 'SMA.js', 'trueRange.js', 'CBuffer.js', 'meta.js', 'predef.js', 'MMA.js', 'WMA.js',
    'StdDev.js', 'medianPrice.js', 'MovingExtreme.js', 'MovingLow.js', 'MovingHigh.js', 'typicalPrice.js', 'plotting.js', 'EMA.js'
];

const TYPESCRIPT_FILES = [
    'drawing-tool.d.ts', 'scheme-styles.d.ts', 'plotter.d.ts', 'scaler.d.ts', 'indicator.d.ts', 'plots.d.ts',
    'params.d.ts', 'shifts.d.ts', 'calculator.d.ts', 'TimeSeries.d.ts', 'dlls.d.ts', 'canvas.d.ts',
    'graphics/GraphicsResponse.d.ts', 'graphics/DisplayObject.d.ts', 'graphics/Style.d.ts', 'graphics/Scale.d.ts'
];

const TUTORIAL_FILES = [
    'index.md', 'ExponentialMovingAverage.md', 'SignalingATR.md', 'DrawingTools.md', 'Plotters.md', 'Graphics.md',
    'Alligator.md', 'FourierMovingAverage.md', 'Spectrogram.md', 'ParameterizedPriceOffset.md', 'DoubleEMA.md',
    'SimplePriceOffset.md', 'BuiltinTools.md', 'HumanFriendlierEMA.md'
];

const SECTIONS: CatalogSection[] = [
    {
        key: 'builtin',
        label: 'Builtin Indicators',
        icon: 'fx',
        prefix: 'builtin',
        files: BUILTIN_FILES,
        note: 'Live-capable indicators (RSI, MACD, VWAP, ATR, BBands, ADX, etc.).'
    },
    {
        key: 'examples',
        label: 'Examples',
        icon: 'ex',
        prefix: 'examples',
        files: EXAMPLE_FILES,
        note: 'Ready examples you can adapt for AriAlgo custom analyzers.'
    },
    {
        key: 'tools',
        label: 'Tools',
        icon: 'tl',
        prefix: 'tools',
        files: TOOL_FILES,
        note: 'Low-level math helpers (EMA, SMA, StdDev, TrueRange, plotting).'
    },
    {
        key: 'typescript',
        label: 'TypeScript Types',
        icon: 'ts',
        prefix: 'typescript',
        files: TYPESCRIPT_FILES,
        note: 'Definitions for typed, robust indicator implementation.'
    },
    {
        key: 'tutorial',
        label: 'Tutorial',
        icon: 'md',
        prefix: 'tutorial',
        files: TUTORIAL_FILES,
        note: 'Step-by-step docs to build and structure custom indicators.'
    }
];

const CORE_PACK = ['rsi.js', 'vwap.js', 'macd.js', 'bband.js', 'atr.js', 'stochastic.js', 'adx.js', 'ema.js'];

function prettyName(file: string): string {
    const leaf = file.split('/').pop() || file;
    return leaf
        .replace(/\.(js|d\.ts|md)$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

const CATALOG: CatalogEntry[] = SECTIONS.flatMap((section) =>
    section.files.map((file) => ({
        id: `${section.key}:${file}`,
        section: section.key,
        sectionLabel: section.label,
        path: `${section.prefix}/${file}`,
        file,
        name: prettyName(file)
    }))
);

const HISTORY_SIZE = 320;

async function fetchHistory(symbol: string, timeframe: string) {
    const url = `/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=${HISTORY_SIZE}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`History fetch failed (${response.status})`);
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchJson<T = any>(url: string): Promise<T> {
    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = typeof payload?.message === 'string' ? payload.message : `Request failed (${response.status})`;
        throw new Error(message);
    }
    return payload as T;
}

function normalizeCandles(rawRows: any[]): IndicatorCandle[] {
    const candles: IndicatorCandle[] = [];
    rawRows.forEach((row) => {
            const open = Number(row?.open);
            const high = Number(row?.high);
            const low = Number(row?.low);
            const close = Number(row?.close);
            const volume = Number(row?.volume) || 0;
            const directTime = Number(row?.time);
            const fallbackTs = Date.parse(String(row?.timestamp || ''));
            const time = Number.isFinite(directTime)
                ? (directTime > 1e12 ? directTime : directTime * 1000)
                : (Number.isFinite(fallbackTs) ? fallbackTs : Date.now());

            if (![open, high, low, close].every(Number.isFinite)) return;
            candles.push({ open, high, low, close, volume, time });
        });
    return candles;
}

function formatNumber(value: number | null | undefined, decimals = 2) {
    if (!Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function asDisplay(value: any) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
}

function pickNumber(payload: any, keys: string[]): number | null {
    if (!payload || typeof payload !== 'object') return null;
    for (const key of keys) {
        const value = Number(payload[key]);
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function normalizeBridgeList(payload: any): any[] {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.items)) return payload.items;
        if (Array.isArray(payload.data)) return payload.data;
        if (Array.isArray(payload.positions)) return payload.positions;
        if (Array.isArray(payload.orders)) return payload.orders;
        if (Array.isArray(payload.results)) return payload.results;
    }
    return [];
}

function getSignalClass(signal: TradeSignal) {
    if (signal === 'BUY') return 'buy';
    if (signal === 'SELL') return 'sell';
    return 'hold';
}

function buildSelectedAnalysis(path: string, indicators: any, currentPrice: number): LiveAnalysis {
    if (!indicators || !Number.isFinite(currentPrice)) {
        return {
            signal: 'HOLD',
            confidence: 0,
            valueLabel: 'No live data',
            narrative: 'Waiting for enough candles to analyze.',
            reasons: ['Insufficient candle history']
        };
    }

    const key = path.toLowerCase();

    if (key.includes('rsi')) {
        const rsi = indicators.rsi;
        if (!Number.isFinite(Number(rsi))) {
            return { signal: 'HOLD', confidence: 15, valueLabel: 'RSI unavailable', narrative: 'Not enough RSI data.', reasons: ['Need more bars'] };
        }
        if (rsi <= 30) {
            return {
                signal: 'BUY',
                confidence: 76,
                valueLabel: `RSI ${formatNumber(rsi)}`,
                narrative: 'Oversold zone detected.',
                reasons: ['RSI <= 30', 'Potential rebound setup']
            };
        }
        if (rsi >= 70) {
            return {
                signal: 'SELL',
                confidence: 76,
                valueLabel: `RSI ${formatNumber(rsi)}`,
                narrative: 'Overbought zone detected.',
                reasons: ['RSI >= 70', 'Potential pullback setup']
            };
        }
        return {
            signal: 'HOLD',
            confidence: 52,
            valueLabel: `RSI ${formatNumber(rsi)}`,
            narrative: 'RSI is neutral.',
            reasons: ['RSI between 30 and 70']
        };
    }

    if (key.includes('macd')) {
        const hist = Number(indicators.macdHistogram);
        const line = Number(indicators.macdLine);
        const signal = Number(indicators.macdSignal);
        if (![hist, line, signal].every(Number.isFinite)) {
            return { signal: 'HOLD', confidence: 20, valueLabel: 'MACD unavailable', narrative: 'Not enough MACD data.', reasons: ['Need more bars'] };
        }
        if (hist > 0 && line > signal) {
            return {
                signal: 'BUY',
                confidence: 71,
                valueLabel: `Hist ${formatNumber(hist, 4)}`,
                narrative: 'Bullish MACD momentum.',
                reasons: ['Histogram positive', 'MACD line above signal']
            };
        }
        if (hist < 0 && line < signal) {
            return {
                signal: 'SELL',
                confidence: 71,
                valueLabel: `Hist ${formatNumber(hist, 4)}`,
                narrative: 'Bearish MACD momentum.',
                reasons: ['Histogram negative', 'MACD line below signal']
            };
        }
        return {
            signal: 'HOLD',
            confidence: 50,
            valueLabel: `Hist ${formatNumber(hist, 4)}`,
            narrative: 'MACD transition phase.',
            reasons: ['No clean directional edge']
        };
    }

    if (key.includes('vwap')) {
        const vwap = Number(indicators.vwap);
        if (!Number.isFinite(vwap)) {
            return { signal: 'HOLD', confidence: 20, valueLabel: 'VWAP unavailable', narrative: 'Not enough VWAP data.', reasons: ['Need volume bars'] };
        }
        const diffPct = ((currentPrice - vwap) / vwap) * 100;
        if (currentPrice > vwap) {
            return {
                signal: 'BUY',
                confidence: Math.min(84, 58 + Math.round(Math.abs(diffPct) * 8)),
                valueLabel: `${formatNumber(currentPrice)} > ${formatNumber(vwap)}`,
                narrative: 'Price is above VWAP.',
                reasons: [`VWAP spread +${formatNumber(diffPct, 2)}%`, 'Session bias bullish']
            };
        }
        return {
            signal: 'SELL',
            confidence: Math.min(84, 58 + Math.round(Math.abs(diffPct) * 8)),
            valueLabel: `${formatNumber(currentPrice)} < ${formatNumber(vwap)}`,
            narrative: 'Price is below VWAP.',
            reasons: [`VWAP spread ${formatNumber(diffPct, 2)}%`, 'Session bias bearish']
        };
    }

    if (key.includes('bband') || key.includes('percentb') || key.includes('bbwidth')) {
        const upper = Number(indicators.bbUpper);
        const lower = Number(indicators.bbLower);
        if (![upper, lower].every(Number.isFinite)) {
            return { signal: 'HOLD', confidence: 20, valueLabel: 'Bands unavailable', narrative: 'Not enough Bollinger data.', reasons: ['Need 20+ bars'] };
        }
        if (currentPrice <= lower) {
            return {
                signal: 'BUY',
                confidence: 69,
                valueLabel: `Price ${formatNumber(currentPrice)} near lower band`,
                narrative: 'Mean reversion long setup.',
                reasons: ['Touch lower band', 'Oversold volatility edge']
            };
        }
        if (currentPrice >= upper) {
            return {
                signal: 'SELL',
                confidence: 69,
                valueLabel: `Price ${formatNumber(currentPrice)} near upper band`,
                narrative: 'Mean reversion short setup.',
                reasons: ['Touch upper band', 'Overbought volatility edge']
            };
        }
        return {
            signal: 'HOLD',
            confidence: 48,
            valueLabel: `Inside bands (${formatNumber(lower)} - ${formatNumber(upper)})`,
            narrative: 'No band extreme currently.',
            reasons: ['Price in middle range']
        };
    }

    if (key.includes('stochastic')) {
        const k = Number(indicators.stochastic?.k);
        const d = Number(indicators.stochastic?.d);
        if (![k, d].every(Number.isFinite)) {
            return { signal: 'HOLD', confidence: 20, valueLabel: 'Stoch unavailable', narrative: 'Not enough stochastic data.', reasons: ['Need more bars'] };
        }
        if (k > d && k < 25) {
            return {
                signal: 'BUY',
                confidence: 66,
                valueLabel: `%K ${formatNumber(k)} / %D ${formatNumber(d)}`,
                narrative: 'Bullish cross in lower zone.',
                reasons: ['%K > %D', 'Low-zone momentum recovery']
            };
        }
        if (k < d && k > 75) {
            return {
                signal: 'SELL',
                confidence: 66,
                valueLabel: `%K ${formatNumber(k)} / %D ${formatNumber(d)}`,
                narrative: 'Bearish cross in upper zone.',
                reasons: ['%K < %D', 'High-zone momentum fade']
            };
        }
        return {
            signal: 'HOLD',
            confidence: 46,
            valueLabel: `%K ${formatNumber(k)} / %D ${formatNumber(d)}`,
            narrative: 'Stochastic no-entry state.',
            reasons: ['No qualified cross setup']
        };
    }

    if (key.includes('adx')) {
        const adx = Number(indicators.adx?.adx);
        const plus = Number(indicators.adx?.plusDI);
        const minus = Number(indicators.adx?.minusDI);
        if (![adx, plus, minus].every(Number.isFinite)) {
            return { signal: 'HOLD', confidence: 20, valueLabel: 'ADX unavailable', narrative: 'Not enough ADX data.', reasons: ['Need 2*period bars'] };
        }
        const trendReady = adx >= 20;
        if (trendReady && plus > minus) {
            return {
                signal: 'BUY',
                confidence: Math.min(82, 50 + Math.round(adx)),
                valueLabel: `ADX ${formatNumber(adx)} | +DI ${formatNumber(plus)} / -DI ${formatNumber(minus)}`,
                narrative: 'Directional strength favors bulls.',
                reasons: ['ADX >= 20', '+DI above -DI']
            };
        }
        if (trendReady && plus < minus) {
            return {
                signal: 'SELL',
                confidence: Math.min(82, 50 + Math.round(adx)),
                valueLabel: `ADX ${formatNumber(adx)} | +DI ${formatNumber(plus)} / -DI ${formatNumber(minus)}`,
                narrative: 'Directional strength favors bears.',
                reasons: ['ADX >= 20', '-DI above +DI']
            };
        }
        return {
            signal: 'HOLD',
            confidence: 42,
            valueLabel: `ADX ${formatNumber(adx)}`,
            narrative: 'Trend strength still weak/neutral.',
            reasons: ['ADX below trend threshold']
        };
    }

    if (key.includes('ema') || key.includes('sma') || key.includes('wma') || key.includes('hma') || key.includes('moving')) {
        const ema21 = Number(indicators.ema21);
        const ema50 = Number(indicators.ema50);
        if (![ema21, ema50].every(Number.isFinite)) {
            return { signal: 'HOLD', confidence: 20, valueLabel: 'MA unavailable', narrative: 'Not enough MA data.', reasons: ['Need 50+ bars'] };
        }
        if (currentPrice > ema21 && ema21 > ema50) {
            return {
                signal: 'BUY',
                confidence: 67,
                valueLabel: `P ${formatNumber(currentPrice)} | EMA21 ${formatNumber(ema21)} | EMA50 ${formatNumber(ema50)}`,
                narrative: 'Price and MA stack are bullish.',
                reasons: ['Price > EMA21 > EMA50']
            };
        }
        if (currentPrice < ema21 && ema21 < ema50) {
            return {
                signal: 'SELL',
                confidence: 67,
                valueLabel: `P ${formatNumber(currentPrice)} | EMA21 ${formatNumber(ema21)} | EMA50 ${formatNumber(ema50)}`,
                narrative: 'Price and MA stack are bearish.',
                reasons: ['Price < EMA21 < EMA50']
            };
        }
        return {
            signal: 'HOLD',
            confidence: 45,
            valueLabel: `P ${formatNumber(currentPrice)} | EMA21 ${formatNumber(ema21)} | EMA50 ${formatNumber(ema50)}`,
            narrative: 'Mixed MA structure.',
            reasons: ['No clean MA alignment']
        };
    }

    const comboSignal = (indicators.proCombo?.signal || 'HOLD') as TradeSignal;
    const comboScore = Number(indicators.proCombo?.score || 50);
    return {
        signal: comboSignal,
        confidence: Math.max(30, Math.min(90, Math.round(comboScore))),
        valueLabel: `Composite ${comboScore}/100`,
        narrative: 'AriAlgo composite engine fallback.',
        reasons: ['Using proCombo consensus as default analyzer']
    };
}

function buildCoreMatrix(indicators: any, currentPrice: number): CoreMatrixRow[] {
    if (!indicators || !Number.isFinite(currentPrice)) return [];

    const rows: CoreMatrixRow[] = [];
    const rsi = Number(indicators.rsi);
    if (Number.isFinite(rsi)) {
        rows.push({
            id: 'rsi',
            label: 'RSI',
            value: formatNumber(rsi),
            signal: rsi < 30 ? 'BUY' : rsi > 70 ? 'SELL' : 'HOLD',
            note: rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral range'
        });
    }

    const hist = Number(indicators.macdHistogram);
    if (Number.isFinite(hist)) {
        rows.push({
            id: 'macd',
            label: 'MACD Hist',
            value: formatNumber(hist, 4),
            signal: hist > 0 ? 'BUY' : hist < 0 ? 'SELL' : 'HOLD',
            note: hist > 0 ? 'Positive momentum' : hist < 0 ? 'Negative momentum' : 'Flat momentum'
        });
    }

    const vwap = Number(indicators.vwap);
    if (Number.isFinite(vwap)) {
        rows.push({
            id: 'vwap',
            label: 'VWAP',
            value: formatNumber(vwap),
            signal: currentPrice > vwap ? 'BUY' : currentPrice < vwap ? 'SELL' : 'HOLD',
            note: currentPrice > vwap ? 'Price above VWAP' : 'Price below VWAP'
        });
    }

    const bbUpper = Number(indicators.bbUpper);
    const bbLower = Number(indicators.bbLower);
    if (Number.isFinite(bbUpper) && Number.isFinite(bbLower)) {
        rows.push({
            id: 'bb',
            label: 'Bollinger',
            value: `${formatNumber(bbLower)} - ${formatNumber(bbUpper)}`,
            signal: currentPrice <= bbLower ? 'BUY' : currentPrice >= bbUpper ? 'SELL' : 'HOLD',
            note: currentPrice <= bbLower ? 'Lower band touch' : currentPrice >= bbUpper ? 'Upper band touch' : 'Inside bands'
        });
    }

    const adx = Number(indicators.adx?.adx);
    const plus = Number(indicators.adx?.plusDI);
    const minus = Number(indicators.adx?.minusDI);
    if ([adx, plus, minus].every(Number.isFinite)) {
        rows.push({
            id: 'adx',
            label: 'ADX / DI',
            value: `${formatNumber(adx)} (${formatNumber(plus)} / ${formatNumber(minus)})`,
            signal: adx >= 20 ? (plus > minus ? 'BUY' : 'SELL') : 'HOLD',
            note: adx >= 20 ? 'Trend active' : 'Weak trend'
        });
    }

    const stochK = Number(indicators.stochastic?.k);
    const stochD = Number(indicators.stochastic?.d);
    if ([stochK, stochD].every(Number.isFinite)) {
        rows.push({
            id: 'stoch',
            label: 'Stochastic',
            value: `${formatNumber(stochK)} / ${formatNumber(stochD)}`,
            signal: stochK > stochD ? 'BUY' : stochK < stochD ? 'SELL' : 'HOLD',
            note: stochK > stochD ? 'Bullish crossover bias' : 'Bearish crossover bias'
        });
    }

    return rows;
}

export default function TradovateIndicatorsHub() {
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const currentTimeframe = useMarketStore((state) => state.currentTimeframe);
    const prices = useMarketStore((state) => state.prices);
    const orderbook = useMarketStore((state) => state.orderbook);

    const [search, setSearch] = React.useState('');
    const [sectionFilter, setSectionFilter] = React.useState<CatalogSectionKey | 'all'>('all');
    const [selectedId, setSelectedId] = React.useState<string>(CATALOG[0]?.id || '');

    const historyQuery = useQuery({
        queryKey: ['ari-indicator-analyzer-history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        refetchInterval: 2500,
        staleTime: 1000,
        retry: 1
    });

    const rithmicStatusQuery = useQuery({
        queryKey: ['ari-rithmic-status'],
        queryFn: () => fetchJson('/api/rithmic/status?ping=true'),
        refetchInterval: 15000,
        staleTime: 5000,
        retry: 0
    });

    const rithmicEnabled = Boolean(rithmicStatusQuery.data?.enabled);
    const rithmicConfigured = Boolean(rithmicStatusQuery.data?.configured);
    const rithmicAccountHint = String(rithmicStatusQuery.data?.accountHint || '').trim();

    const rithmicQuoteQuery = useQuery({
        queryKey: ['ari-rithmic-quote', currentSymbol, rithmicAccountHint],
        queryFn: () => {
            const params = new URLSearchParams({ symbol: currentSymbol });
            if (rithmicAccountHint) params.set('account', rithmicAccountHint);
            return fetchJson(`/api/rithmic/quote?${params.toString()}`);
        },
        enabled: rithmicEnabled && rithmicConfigured,
        refetchInterval: 3000,
        staleTime: 1000,
        retry: 0
    });

    const rithmicPositionsQuery = useQuery({
        queryKey: ['ari-rithmic-positions', rithmicAccountHint],
        queryFn: () => {
            const params = new URLSearchParams();
            if (rithmicAccountHint) params.set('account', rithmicAccountHint);
            const qs = params.toString();
            return fetchJson(`/api/rithmic/positions${qs ? `?${qs}` : ''}`);
        },
        enabled: rithmicEnabled && rithmicConfigured,
        refetchInterval: 6000,
        staleTime: 2500,
        retry: 0
    });

    const rithmicOrdersQuery = useQuery({
        queryKey: ['ari-rithmic-orders', rithmicAccountHint],
        queryFn: () => {
            const params = new URLSearchParams();
            if (rithmicAccountHint) params.set('account', rithmicAccountHint);
            const qs = params.toString();
            return fetchJson(`/api/rithmic/orders${qs ? `?${qs}` : ''}`);
        },
        enabled: rithmicEnabled && rithmicConfigured,
        refetchInterval: 6000,
        staleTime: 2500,
        retry: 0
    });

    const candles = React.useMemo(() => normalizeCandles(Array.isArray(historyQuery.data) ? historyQuery.data : []), [historyQuery.data]);
    const indicators = React.useMemo(() => calculateAllIndicators(candles), [candles]);
    const livePrice = Number(prices[currentSymbol]);
    const currentPrice = Number.isFinite(livePrice) && livePrice > 0
        ? livePrice
        : Number(candles[candles.length - 1]?.close || 0);

    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        return CATALOG.filter((item) => {
            if (sectionFilter !== 'all' && item.section !== sectionFilter) return false;
            if (!q) return true;
            return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q);
        });
    }, [search, sectionFilter]);

    React.useEffect(() => {
        if (!filtered.length) return;
        const exists = filtered.some((item) => item.id === selectedId);
        if (!exists) setSelectedId(filtered[0].id);
    }, [filtered, selectedId]);

    const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null;
    const selectedAnalysis = React.useMemo(
        () => buildSelectedAnalysis(selected?.path || '', indicators, currentPrice),
        [selected?.path, indicators, currentPrice]
    );
    const coreMatrix = React.useMemo(() => buildCoreMatrix(indicators, currentPrice), [indicators, currentPrice]);
    const actionableVerdict = React.useMemo(() => {
        const trendBias = Number(indicators?.trend?.bullishPct ?? 50) - 50;
        const pressureBias = orderbook && (!orderbook.symbol || orderbook.symbol === currentSymbol)
            ? ((Number(orderbook.ratio ?? 0.5) - 0.5) * 2)
            : 0;
        const reasons = [
            selectedAnalysis.narrative,
            ...selectedAnalysis.reasons,
            `Core matrix rows: ${coreMatrix.length}`
        ].filter(Boolean);

        return buildTradeVerdict({
            currentPrice,
            signalHint: selectedAnalysis.signal,
            confidenceHint: selectedAnalysis.confidence,
            atr: Number(indicators?.atr ?? 0),
            trendBias,
            pressureBias,
            reasons,
            timeframe: currentTimeframe
        });
    }, [coreMatrix.length, currentPrice, currentSymbol, currentTimeframe, indicators?.atr, indicators?.trend?.bullishPct, orderbook, selectedAnalysis.confidence, selectedAnalysis.narrative, selectedAnalysis.reasons, selectedAnalysis.signal]);
    const rithmicBridgeOnline = Boolean(rithmicStatusQuery.data?.success && rithmicEnabled && rithmicConfigured);
    const rithmicBridgeSignal: TradeSignal = !rithmicEnabled ? 'SELL' : rithmicBridgeOnline ? 'BUY' : 'HOLD';
    const rithmicBridgeStatus = !rithmicEnabled
        ? 'DISABLED'
        : !rithmicConfigured
            ? 'NOT CONFIGURED'
            : rithmicBridgeOnline
                ? 'ONLINE'
                : 'DEGRADED';

    const rithmicQuotePayload = (rithmicQuoteQuery.data as any)?.data ?? (rithmicQuoteQuery.data as any) ?? null;
    const rithmicBid = pickNumber(rithmicQuotePayload, ['bid', 'bestBid', 'bidPrice', 'b']);
    const rithmicAsk = pickNumber(rithmicQuotePayload, ['ask', 'bestAsk', 'askPrice', 'a']);
    const rithmicLast = pickNumber(rithmicQuotePayload, ['last', 'lastPrice', 'price', 'mark']);
    const rithmicSpread = rithmicBid !== null && rithmicAsk !== null ? (rithmicAsk - rithmicBid) : null;

    const rithmicPositions = React.useMemo(
        () => normalizeBridgeList((rithmicPositionsQuery.data as any)?.data ?? (rithmicPositionsQuery.data as any)),
        [rithmicPositionsQuery.data]
    );
    const rithmicOrders = React.useMemo(
        () => normalizeBridgeList((rithmicOrdersQuery.data as any)?.data ?? (rithmicOrdersQuery.data as any)),
        [rithmicOrdersQuery.data]
    );

    const sectionCounts = React.useMemo(
        () =>
            SECTIONS.reduce<Record<string, number>>((acc, section) => {
                acc[section.key] = CATALOG.filter((item) => item.section === section.key).length;
                return acc;
            }, {}),
        []
    );

    return (
        <div className="tradovate-hub">
            <div className="tradovate-head">
                <div>
                    <h2>AriAlgo Indicator Analyzer</h2>
                    <p>
                        Module d’analyse technique en temps réel avec bibliothèque complète d’indicateurs et de scripts.
                    </p>
                </div>
            </div>

            <TradeActionCard
                title="Actionable Trade Verdict"
                modelLabel={`Tradovate Matrix · ${selected?.name || 'Live Analyzer'}`}
                symbol={currentSymbol}
                verdict={actionableVerdict}
            />

            <div className="tradovate-meta-row">
                <div className="tradovate-kpi">
                    <span>Total files</span>
                    <strong>{CATALOG.length}</strong>
                </div>
                <div className="tradovate-kpi">
                    <span>Live candles</span>
                    <strong>{candles.length}</strong>
                </div>
                <div className="tradovate-kpi">
                    <span>Symbol / TF</span>
                    <strong>{currentSymbol} · {currentTimeframe}</strong>
                </div>
                <div className="tradovate-kpi">
                    <span>Analyzer</span>
                    <strong>{selectedAnalysis.signal}</strong>
                </div>
                <div className="tradovate-kpi">
                    <span>Broker Bridge</span>
                    <strong className={`tradovate-bridge-status ${getSignalClass(rithmicBridgeSignal)}`}>{rithmicBridgeStatus}</strong>
                </div>
            </div>

            <div className="tradovate-controls">
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search indicator or path (ex: rsi, macd, vwap, tools/EMA)"
                />
                <div className="tradovate-filter-chips">
                    <button className={sectionFilter === 'all' ? 'active' : ''} onClick={() => setSectionFilter('all')}>
                        All
                    </button>
                    {SECTIONS.map((section) => (
                        <button
                            key={section.key}
                            className={sectionFilter === section.key ? 'active' : ''}
                            onClick={() => setSectionFilter(section.key)}
                        >
                            {section.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="tradovate-grid">
                <aside className="tradovate-sidebar">
                    <h3>Section Notes</h3>
                    <div className="tradovate-section-notes">
                        {SECTIONS.map((section) => (
                            <div key={section.key} className="tradovate-note-card">
                                <div className="tradovate-note-head">
                                    <span>{section.icon.toUpperCase()}</span>
                                    <strong>{section.label}</strong>
                                </div>
                                <p>{section.note}</p>
                            </div>
                        ))}
                    </div>

                    <h3>Core Trading Pack</h3>
                    <div className="tradovate-core-pack">
                        {CORE_PACK.map((file) => (
                            <span key={file}>{file.replace('.js', '').toUpperCase()}</span>
                        ))}
                    </div>
                </aside>

                <section className="tradovate-list">
                    {SECTIONS.map((section) => {
                        const rows = filtered.filter((item) => item.section === section.key);
                        if (!rows.length) return null;
                        return (
                            <div key={section.key} className="tradovate-list-group">
                                <div className="tradovate-list-head">
                                    <h3>{section.label}</h3>
                                    <span>{rows.length}</span>
                                </div>
                                <div className="tradovate-list-rows">
                                    {rows.map((item) => (
                                        <button
                                            key={item.id}
                                            className={`tradovate-row ${selected?.id === item.id ? 'active' : ''}`}
                                            onClick={() => setSelectedId(item.id)}
                                        >
                                            <strong>{item.name}</strong>
                                            <small>{item.path}</small>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                    {!filtered.length && <div className="tradovate-empty">No result for current filter/search.</div>}
                </section>

                <aside className="tradovate-detail">
                    <h3>Live Analyzer</h3>
                    <div className={`tradovate-analyzer-card ${getSignalClass(selectedAnalysis.signal)}`}>
                        <div className="tradovate-analyzer-head">
                            <strong>{selectedAnalysis.signal}</strong>
                            <span>{selectedAnalysis.confidence}% conf.</span>
                        </div>
                        <div className="tradovate-analyzer-stat">{selectedAnalysis.valueLabel}</div>
                        <p>{selectedAnalysis.narrative}</p>
                        <ul className="tradovate-analyzer-reasons">
                            {selectedAnalysis.reasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                            ))}
                        </ul>
                        {historyQuery.isFetching && <small>Refreshing live candles...</small>}
                        {historyQuery.isError && <small>History feed unavailable now.</small>}
                    </div>

                    <h3>Core Matrix</h3>
                    <div className="tradovate-core-matrix">
                        {coreMatrix.map((row) => (
                            <div key={row.id} className="tradovate-core-row">
                                <div>
                                    <strong>{row.label}</strong>
                                    <small>{row.note}</small>
                                </div>
                                <div>
                                    <span>{row.value}</span>
                                    <em className={`tradovate-signal-pill ${getSignalClass(row.signal)}`}>{row.signal}</em>
                                </div>
                            </div>
                        ))}
                        {!coreMatrix.length && (
                            <div className="tradovate-empty">Core matrix will appear once enough live candles are loaded.</div>
                        )}
                    </div>

                    <h3>AriAlgo Broker Bridge</h3>
                    <div className="tradovate-detail-card">
                        <span className="tradovate-detail-label">Status</span>
                        <strong>{rithmicBridgeStatus}</strong>
                        <span className="tradovate-detail-label">Base URL</span>
                        <code>{asDisplay(rithmicStatusQuery.data?.baseUrl)}</code>
                        <span className="tradovate-detail-label">Account Hint</span>
                        <code>{asDisplay(rithmicStatusQuery.data?.accountHint)}</code>
                        {rithmicStatusQuery.isFetching && <p>Checking bridge health...</p>}
                        {rithmicStatusQuery.isError && <p>Bridge status unavailable right now.</p>}
                    </div>

                    <div className="tradovate-detail-card">
                        <span className="tradovate-detail-label">Live Quote ({currentSymbol})</span>
                        <div className="tradovate-core-matrix">
                            <div className="tradovate-core-row">
                                <div>
                                    <strong>Bid / Ask</strong>
                                    <small>From Rithmic bridge</small>
                                </div>
                                <div>
                                    <span>{formatNumber(rithmicBid)} / {formatNumber(rithmicAsk)}</span>
                                </div>
                            </div>
                            <div className="tradovate-core-row">
                                <div>
                                    <strong>Last / Spread</strong>
                                    <small>Bridge normalized snapshot</small>
                                </div>
                                <div>
                                    <span>{formatNumber(rithmicLast)} / {formatNumber(rithmicSpread, 3)}</span>
                                </div>
                            </div>
                        </div>
                        {rithmicQuoteQuery.isError && <p>Quote endpoint returned no live payload for this symbol.</p>}
                    </div>

                    <div className="tradovate-detail-card">
                        <span className="tradovate-detail-label">Positions ({rithmicPositions.length})</span>
                        <div className="tradovate-core-matrix">
                            {rithmicPositions.slice(0, 4).map((position, index) => (
                                <div key={`pos-${index}`} className="tradovate-core-row">
                                    <div>
                                        <strong>{asDisplay(position?.symbol || position?.instrument || position?.contract)}</strong>
                                        <small>{asDisplay(position?.side || position?.direction || position?.type)}</small>
                                    </div>
                                    <div>
                                        <span>{asDisplay(position?.qty ?? position?.quantity ?? position?.size)}</span>
                                    </div>
                                </div>
                            ))}
                            {!rithmicPositions.length && <div className="tradovate-empty">No open positions from bridge.</div>}
                        </div>
                    </div>

                    <div className="tradovate-detail-card">
                        <span className="tradovate-detail-label">Orders ({rithmicOrders.length})</span>
                        <div className="tradovate-core-matrix">
                            {rithmicOrders.slice(0, 4).map((order, index) => (
                                <div key={`ord-${index}`} className="tradovate-core-row">
                                    <div>
                                        <strong>{asDisplay(order?.symbol || order?.instrument || order?.contract)}</strong>
                                        <small>{asDisplay(order?.status || order?.state || order?.side)}</small>
                                    </div>
                                    <div>
                                        <span>{asDisplay(order?.qty ?? order?.quantity ?? order?.size ?? order?.id)}</span>
                                    </div>
                                </div>
                            ))}
                            {!rithmicOrders.length && <div className="tradovate-empty">No active orders from bridge.</div>}
                        </div>
                    </div>

                    <h3>Selected Item</h3>
                    {selected ? (
                        <>
                            <div className="tradovate-detail-card">
                                <span className="tradovate-detail-label">Name</span>
                                <strong>{selected.name}</strong>
                                <span className="tradovate-detail-label">Section</span>
                                <strong>{selected.sectionLabel}</strong>
                                <span className="tradovate-detail-label">Path</span>
                                <code>{selected.path}</code>
                            </div>

                            <div className="tradovate-detail-card">
                                <span className="tradovate-detail-label">Starter Snippet</span>
                                <pre>{`const moduleRef = require("${selected.path}");\nmodule.exports = moduleRef;`}</pre>
                            </div>

                            <div className="tradovate-detail-card">
                                <span className="tradovate-detail-label">AriAlgo Integration</span>
                                <p>
                                    This module is now linked to the live analyzer context above. You can extend this into direct
                                    signal scoring, chart overlays, and strategy conditions without changing your current tabs.
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="tradovate-empty">Select an item to inspect details.</div>
                    )}
                </aside>
            </div>
        </div>
    );
}
