import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { subscribeLiveTick } from '../utils/liveTickBus';

const formatTimeframeLabel = (tf: string) => {
    const value = parseInt(tf, 10);
    if (!Number.isFinite(value) || value <= 0) return tf.toUpperCase();
    if (tf.endsWith('s')) return `${value}S`;
    if (tf.endsWith('min') || tf.endsWith('m')) return `${value}M`;
    if (tf.endsWith('h')) return `${value}H`;
    return tf.toUpperCase();
};

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
    'US30/USD': 2,
};

const TRADINGVIEW_SYMBOL_MAP: Record<string, string> = {
    // Commodities
    'XAU/USD': 'OANDA:XAUUSD',
    'XAG/USD': 'OANDA:XAGUSD',
    'WTI/USD': 'TVC:USOIL',
    // Forex
    'EUR/USD': 'OANDA:EURUSD',
    'GBP/USD': 'OANDA:GBPUSD',
    'USD/JPY': 'OANDA:USDJPY',
    'CHF/JPY': 'OANDA:CHFJPY',
    'AUD/USD': 'OANDA:AUDUSD',
    // Crypto
    'BTC/USD': 'BINANCE:BTCUSDT',
    'ETH/USD': 'BINANCE:ETHUSDT',
    'SOL/USD': 'BINANCE:SOLUSDT',
    // Stocks
    'AAPL/USD': 'NASDAQ:AAPL',
    'TSLA/USD': 'NASDAQ:TSLA',
    'NVDA/USD': 'NASDAQ:NVDA',
    // Indices
    'SPX500/USD': 'OANDA:SPX500USD',
    'NAS100/USD': 'OANDA:NAS100USD',
    'US30/USD': 'OANDA:US30USD',
};

const LIVE_TICK_FRESH_MS = 1500;

const toTradingViewInterval = (tf: string): string => {
    if (tf.endsWith('s')) return '1';
    if (tf === '1min' || tf === '1m') return '1';
    if (tf === '3min' || tf === '3m') return '3';
    if (tf === '5min' || tf === '5m') return '5';
    if (tf === '15min' || tf === '15m') return '15';
    if (tf === '30min' || tf === '30m') return '30';
    if (tf === '1h') return '60';
    if (tf === '4h') return '240';
    return '15';
};

const formatPrice = (symbol: string, value?: number) => {
    if (!value || value <= 0) return '—';
    const decimals = SYMBOL_DECIMALS[symbol] ?? 2;
    return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const formatAxisPrice = (symbol: string, value: number) => {
    const decimals = SYMBOL_DECIMALS[symbol] ?? 2;
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const getPriceFormatOptions = (symbol: string) => {
    const precision = SYMBOL_DECIMALS[symbol] ?? 2;
    return {
        type: 'price' as const,
        precision,
        minMove: Number((1 / (10 ** precision)).toFixed(precision))
    };
};

const formatChange = (symbol: string, value: number) => {
    const decimals = SYMBOL_DECIMALS[symbol] ?? 2;
    const sign = value >= 0 ? '+' : '-';
    return `${sign}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

const maxFinite = (...values: Array<number | undefined | null>) => {
    const finite = values.filter((v): v is number => Number.isFinite(Number(v)));
    if (finite.length === 0) return null;
    return Math.max(...finite);
};

const minFinite = (...values: Array<number | undefined | null>) => {
    const finite = values.filter((v): v is number => Number.isFinite(Number(v)));
    if (finite.length === 0) return null;
    return Math.min(...finite);
};

type LocalCandle = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

const timeframeToSeconds = (tf: string): number => {
    const value = parseInt(tf, 10);
    if (!Number.isFinite(value) || value <= 0) return 60;
    if (tf.endsWith('s')) return value;
    if (tf.endsWith('min') || tf.endsWith('m')) return value * 60;
    if (tf.endsWith('h')) return value * 3600;
    return 60;
};

const toLocalCandle = (raw: any): LocalCandle | null => {
    if (!raw) return null;
    const time = raw.time ? Number(raw.time) : new Date(raw.timestamp).getTime() / 1000;
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    if (![time, open, high, low, close].every(Number.isFinite)) return null;
    return {
        time: Math.floor(time),
        open,
        high,
        low,
        close,
        volume: Number(raw.volume) || 0
    };
};

const normalizeTimestampMs = (rawTs?: number): number => {
    const ts = Number(rawTs);
    if (!Number.isFinite(ts) || ts <= 0) return Date.now();
    if (ts > 1e15) return Math.floor(ts / 1e6); // nanoseconds
    if (ts > 1e13) return Math.floor(ts / 1e3); // microseconds
    if (ts > 1e11) return Math.floor(ts); // milliseconds
    return Math.floor(ts * 1000); // seconds
};

const fetchHistory = async (symbol: string, timeframe: string, outputsize = 1000) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=${encodeURIComponent(String(outputsize))}`);
    const data = await res.json();
    return data.data || [];
};

type ChartProps = {
    themeMode?: 'light' | 'dark' | 'cyber';
};

type ChartProvider = 'ari' | 'tradingview';

type TradingViewOverlayLine = {
    id: string;
    label: string;
    price: number;
    yPct: number;
    color: string;
    emphasis?: boolean;
};

type HdwmFrameKey = 'h4' | 'd' | 'w' | 'm';

type HdwmFrameData = {
    key: HdwmFrameKey;
    title: string;
    prefix: string;
    color: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    pivot: number;
    r1: number;
    s1: number;
    r2: number;
    s2: number;
    trueRangeTicks: number;
    fluctuationPct: number;
};

const HDWM_FRAME_CONFIG = [
    { key: 'h4' as const, title: 'H4', prefix: 'H4', color: '#ef4444' },
    { key: 'd' as const, title: 'DAILY', prefix: 'D', color: '#16a34a' },
    { key: 'w' as const, title: 'WEEKLY', prefix: 'W', color: '#2563eb' },
    { key: 'm' as const, title: 'MONTHLY', prefix: 'M', color: '#d4a017' },
];

const FAST_TIMEFRAMES = ['1s', '5s', '15s', '30s'] as const;
const STANDARD_TIMEFRAMES = ['1min', '3min', '5min', '15min', '30min', '1h', '4h'] as const;
const TRADINGVIEW_ZOOM_TIMEFRAMES = ['1min', '3min', '5min', '15min', '30min', '1h', '4h'] as const;
const TV_LEVEL_ORDER = [
    'r3', 'r2', 'r1', 'pivot', 's1', 's2', 's3',
    'vwap', 'poc', 'vah', 'val',
    'tp-max-buy', 'tp-max-sell',
    'hdwm-m-r2', 'hdwm-m-r1', 'hdwm-m-p', 'hdwm-m-s1', 'hdwm-m-s2',
    'hdwm-w-r2', 'hdwm-w-r1', 'hdwm-w-p', 'hdwm-w-s1', 'hdwm-w-s2',
    'hdwm-d-r2', 'hdwm-d-r1', 'hdwm-d-p', 'hdwm-d-s1', 'hdwm-d-s2',
    'hdwm-h4-r2', 'hdwm-h4-r1', 'hdwm-h4-p', 'hdwm-h4-s1', 'hdwm-h4-s2'
];

const DEFAULT_TV_LEVEL_SELECTION: Record<string, boolean> = {
    'r3': true,
    'r2': true,
    'r1': true,
    'pivot': true,
    's1': true,
    's2': true,
    's3': true,
    'vwap': true,
    'poc': true,
    'vah': true,
    'val': true,
    'tp-max-buy': true,
    'tp-max-sell': true,
    'hdwm-m-r2': true,
    'hdwm-m-r1': true,
    'hdwm-m-p': true,
    'hdwm-m-s1': true,
    'hdwm-m-s2': true,
    'hdwm-w-r2': true,
    'hdwm-w-r1': true,
    'hdwm-w-p': true,
    'hdwm-w-s1': true,
    'hdwm-w-s2': true,
    'hdwm-d-r2': true,
    'hdwm-d-r1': true,
    'hdwm-d-p': true,
    'hdwm-d-s1': true,
    'hdwm-d-s2': true,
    'hdwm-h4-r2': true,
    'hdwm-h4-r1': true,
    'hdwm-h4-p': true,
    'hdwm-h4-s1': true,
    'hdwm-h4-s2': true
};

const formatNumber = (value?: number, maximumFractionDigits = 2) => {
    if (!Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, {
        maximumFractionDigits,
    });
};

const formatCompactVolume = (value?: number) => {
    if (!Number.isFinite(Number(value))) return '—';
    const n = Number(value);
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatClockWithMs = (timestampMs?: number | null) => {
    if (!Number.isFinite(Number(timestampMs))) return '—';
    const d = new Date(Number(timestampMs));
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
};

const roundToDecimals = (value: number, decimals: number) => Number(value.toFixed(decimals));

const getHdwmBucketStartSec = (timeSec: number, frame: HdwmFrameKey): number => {
    if (frame === 'h4') {
        return Math.floor(timeSec / 14400) * 14400;
    }
    const dayStart = Math.floor(timeSec / 86400) * 86400;
    if (frame === 'd') {
        return dayStart;
    }
    const date = new Date(timeSec * 1000);
    if (frame === 'w') {
        const dayOfWeek = date.getUTCDay();
        const daysSinceMonday = (dayOfWeek + 6) % 7;
        return dayStart - (daysSinceMonday * 86400);
    }
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
};

const aggregateHdwmCandles = (candles: LocalCandle[], frame: HdwmFrameKey): LocalCandle[] => {
    if (!Array.isArray(candles) || candles.length === 0) return [];

    const sorted = [...candles].sort((a, b) => a.time - b.time);
    const result: LocalCandle[] = [];
    let currentBucket = Number.NaN;
    let current: LocalCandle | null = null;

    for (const candle of sorted) {
        const bucketStart = getHdwmBucketStartSec(candle.time, frame);
        if (!current || bucketStart !== currentBucket) {
            if (current) result.push(current);
            currentBucket = bucketStart;
            current = {
                time: bucketStart,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: Number(candle.volume) || 0
            };
            continue;
        }
        current.high = Math.max(current.high, candle.high);
        current.low = Math.min(current.low, candle.low);
        current.close = candle.close;
        current.volume += Number(candle.volume) || 0;
    }

    if (current) result.push(current);
    return result;
};

const buildHdwmFrameData = (
    candles: LocalCandle[],
    config: { key: HdwmFrameKey; title: string; prefix: string; color: string },
    decimals: number,
    minTick: number
): HdwmFrameData | null => {
    const grouped = aggregateHdwmCandles(candles, config.key);
    if (grouped.length < 2) return null;

    const prev = grouped[grouped.length - 2];
    const open = Number(prev.open);
    const high = Number(prev.high);
    const low = Number(prev.low);
    const close = Number(prev.close);
    const volume = Number(prev.volume) || 0;

    if (![open, high, low, close].every(Number.isFinite) || open <= 0) return null;

    const pivot = (high + low + close) / 3;
    const r1 = (pivot * 2) - low;
    const s1 = (pivot * 2) - high;
    const r2 = pivot + (high - low);
    const s2 = pivot - (high - low);
    const trueRangeTicks = minTick > 0 ? (high - low) / minTick : 0;
    const fluctuationPct = open !== 0 ? ((high - low) / open) * 100 : 0;

    return {
        key: config.key,
        title: config.title,
        prefix: config.prefix,
        color: config.color,
        open: roundToDecimals(open, decimals),
        high: roundToDecimals(high, decimals),
        low: roundToDecimals(low, decimals),
        close: roundToDecimals(close, decimals),
        volume,
        pivot: roundToDecimals(pivot, decimals),
        r1: roundToDecimals(r1, decimals),
        s1: roundToDecimals(s1, decimals),
        r2: roundToDecimals(r2, decimals),
        s2: roundToDecimals(s2, decimals),
        trueRangeTicks: Number(trueRangeTicks.toFixed(2)),
        fluctuationPct: Number(fluctuationPct.toFixed(2))
    };
};

const getChartPalette = (themeMode: 'light' | 'dark' | 'cyber') => {
    if (themeMode === 'cyber') {
        return {
            bg: '#090414',
            text: '#c6d4ff',
            grid: '#221539',
            border: '#382857',
            crosshair: '#7f7bff',
            volumeUp: 'rgba(0, 255, 176, 0.40)',
            volumeDown: 'rgba(255, 59, 212, 0.38)'
        };
    }
    if (themeMode === 'dark') {
        return {
            bg: '#101722',
            text: '#a8b3c7',
            grid: '#1d2a3a',
            border: '#2a3950',
            crosshair: '#4f6079',
            volumeUp: 'rgba(8, 153, 129, 0.38)',
            volumeDown: 'rgba(242, 54, 69, 0.36)'
        };
    }
    return {
        bg: '#ffffff',
        text: '#667085',
        grid: '#edf1f7',
        border: '#e2e8f0',
        crosshair: '#c7cfdd',
        volumeUp: 'rgba(8, 153, 129, 0.32)',
        volumeDown: 'rgba(242, 54, 69, 0.30)'
    };
};

export default function Chart({ themeMode = 'light' }: ChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const tvContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<any>(null);
    const emaSeriesRef = useRef<Record<string, any>>({});
    const priceLinesRef = useRef<any[]>([]);
    const pivotLinesRef = useRef<any[]>([]);
    const liveCandleRef = useRef<LocalCandle | null>(null);
    const livePriceRef = useRef<number | null>(null);
    const lastUiPricePushRef = useRef<number>(0);
    const historyRef = useRef<any[] | null>(null);

    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const setTimeframe = useMarketStore(state => state.setTimeframe);
    const signalHistory = useMarketStore(state => state.signalHistory);

    const [showNewsMarkers, setShowNewsMarkers] = useState(false);
    const [showTradeLevels, setShowTradeLevels] = useState(true);
    const [showPivotLevels, setShowPivotLevels] = useState(false);
    const [showHdwmTable, setShowHdwmTable] = useState(false);
    const [tvLevelSelection, setTvLevelSelection] = useState<Record<string, boolean>>(() => ({ ...DEFAULT_TV_LEVEL_SELECTION }));
    const [chartProvider, setChartProvider] = useState<ChartProvider>('tradingview');
    const [liveCandleSnapshot, setLiveCandleSnapshot] = useState<LocalCandle | null>(null);
    const [livePriceSnapshot, setLivePriceSnapshot] = useState<number | undefined>(undefined);
    const [tvLastTickTs, setTvLastTickTs] = useState<number | null>(null);
    const [tvNowTs, setTvNowTs] = useState<number>(() => Date.now());
    const [tvEmbedMode, setTvEmbedMode] = useState<'script' | 'iframe'>('script');
    const [tvIframeLoaded, setTvIframeLoaded] = useState(false);
    const isAndroidChrome = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        return /Android/i.test(ua)
            && /Chrome\/\d+/i.test(ua)
            && !/EdgA|OPR|SamsungBrowser|UCBrowser/i.test(ua);
    }, []);
    const chartPalette = useMemo(() => getChartPalette(themeMode), [themeMode]);
    const tradingViewSymbol = useMemo(() => (
        TRADINGVIEW_SYMBOL_MAP[currentSymbol] || `OANDA:${currentSymbol.replace('/', '')}`
    ), [currentSymbol]);
    const tradingViewInterval = useMemo(() => toTradingViewInterval(currentTimeframe), [currentTimeframe]);
    const useTvIframeFallback = chartProvider === 'tradingview' && tvEmbedMode === 'iframe';
    const tradingViewIframeSrc = useMemo(() => {
        if (!useTvIframeFallback) return '';
        const toolbarbg = themeMode === 'light' ? 'f1f3f6' : themeMode === 'cyber' ? '120b1f' : '1f2937';
        const tvTheme = themeMode === 'light' ? 'light' : 'dark';
        const studies = encodeURIComponent(JSON.stringify(['Pivot Points Standard@tv-basicstudies']));
        return `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tradingViewSymbol)}&interval=${encodeURIComponent(tradingViewInterval)}&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=${toolbarbg}&theme=${tvTheme}&style=1&timezone=Etc%2FUTC&studies=${studies}&withdateranges=1&hideideas=1&locale=fr`;
    }, [useTvIframeFallback, tradingViewSymbol, tradingViewInterval, themeMode]);

    useEffect(() => {
        if (chartProvider !== 'tradingview') return;
        setTvEmbedMode('script');
        setTvIframeLoaded(false);
    }, [chartProvider, tradingViewSymbol, tradingViewInterval, themeMode]);

    useEffect(() => {
        if (chartProvider !== 'tradingview') return;
        let rafId = 0;
        const loop = () => {
            setTvNowTs(Date.now());
            rafId = window.requestAnimationFrame(loop);
        };
        rafId = window.requestAnimationFrame(loop);
        return () => {
            if (rafId) window.cancelAnimationFrame(rafId);
        };
    }, [chartProvider]);

    const { data: history, isLoading } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: currentTimeframe.endsWith('s') ? 0 : 60000,
        refetchInterval: currentTimeframe.endsWith('s') ? 2000 : currentTimeframe === '1min' ? 12000 : 25000,
        refetchIntervalInBackground: true,
    });

    const { data: hdwmHistory } = useQuery({
        queryKey: ['history-hdwm', currentSymbol],
        queryFn: () => fetchHistory(currentSymbol, '1h', 2400),
        staleTime: 60000,
        refetchInterval: 45000,
        refetchIntervalInBackground: true,
    });

    useEffect(() => {
        historyRef.current = Array.isArray(history) ? history : null;
    }, [history]);

    const indicators = useMemo(() => {
        if (!history || history.length < 30) return null;
        const candles = [...history];
        if (livePriceSnapshot) {
            const last = { ...candles[candles.length - 1] };
            last.close = livePriceSnapshot;
            last.high = Math.max(last.high, livePriceSnapshot);
            last.low = Math.min(last.low, livePriceSnapshot);
            candles[candles.length - 1] = last;
        }
        return calculateAllIndicators(candles);
    }, [history, livePriceSnapshot]);

    const latestSignal = useMemo(() => (
        signalHistory.find(s => s.symbol === currentSymbol && s.timeframe === currentTimeframe)
    ), [signalHistory, currentSymbol, currentTimeframe]);

    const levelSummary = useMemo(() => {
        if (!latestSignal || !latestSignal.entryPrice || !latestSignal.takeProfit || !latestSignal.stopLoss) return null;
        return {
            signal: latestSignal.signal,
            entryPrice: latestSignal.entryPrice,
            takeProfit: latestSignal.takeProfit,
            stopLoss: latestSignal.stopLoss,
            confidence: latestSignal.confidence || 0,
        };
    }, [latestSignal]);

    const hdwmFrames = useMemo(() => {
        if (!Array.isArray(hdwmHistory) || hdwmHistory.length < 60) return [] as HdwmFrameData[];

        const localCandles = hdwmHistory
            .map((raw) => toLocalCandle(raw))
            .filter((candle): candle is LocalCandle => candle !== null)
            .sort((a, b) => a.time - b.time);
        if (localCandles.length < 60) return [] as HdwmFrameData[];

        const decimals = SYMBOL_DECIMALS[currentSymbol] ?? 2;
        const minTick = 1 / (10 ** decimals);

        return HDWM_FRAME_CONFIG
            .map((config) => buildHdwmFrameData(localCandles, config, decimals, minTick))
            .filter((item): item is HdwmFrameData => item !== null);
    }, [hdwmHistory, currentSymbol]);

    const hdwmFrameMap = useMemo(() => {
        const next: Partial<Record<HdwmFrameKey, HdwmFrameData>> = {};
        for (const frame of hdwmFrames) next[frame.key] = frame;
        return next;
    }, [hdwmFrames]);

    const tradingViewPivotOverlay = useMemo(() => {
        const pp = indicators?.pivotPoints;
        const pivot = Number(pp?.pivot);
        const r1 = Number(pp?.r1);
        const r2 = Number(pp?.r2);
        const r3 = Number(pp?.r3);
        const s1 = Number(pp?.s1);
        const s2 = Number(pp?.s2);
        const s3 = Number(pp?.s3);
        const vwap = Number(indicators?.vwapSession ?? indicators?.vwap);
        const poc = Number(indicators?.volumeProfile?.poc);
        const vah = Number(indicators?.volumeProfile?.vah);
        const val = Number(indicators?.volumeProfile?.val);

        if ((!pp && !Number.isFinite(vwap) && !Number.isFinite(poc) && hdwmFrames.length === 0) || !Array.isArray(history) || history.length < 20) {
            return {
                lines: [] as TradingViewOverlayLine[],
                pivot: null as number | null,
                tpMaxBuy: null as number | null,
                tpMaxSell: null as number | null,
                vwap: null as number | null,
                poc: null as number | null
            };
        }

        const recent = history.slice(-320).map((c: any) => ({
            open: Number(c?.open),
            high: Number(c?.high),
            low: Number(c?.low),
            close: Number(c?.close)
        })).filter((c: any) => [c.open, c.high, c.low, c.close].every((n: number) => Number.isFinite(n)));
        if (recent.length === 0) {
            return {
                lines: [] as TradingViewOverlayLine[],
                pivot: null as number | null,
                tpMaxBuy: null as number | null,
                tpMaxSell: null as number | null,
                vwap: null as number | null,
                poc: null as number | null
            };
        }

        if (Number.isFinite(livePriceSnapshot) && livePriceSnapshot && recent.length > 0) {
            const last = { ...recent[recent.length - 1] };
            last.close = Number(livePriceSnapshot);
            last.high = Math.max(last.high, Number(livePriceSnapshot));
            last.low = Math.min(last.low, Number(livePriceSnapshot));
            recent[recent.length - 1] = last;
        }

        const highs = recent.map((c: any) => c.high);
        const lows = recent.map((c: any) => c.low);
        const baseRangeHigh = Math.max(...highs);
        const baseRangeLow = Math.min(...lows);
        if (!Number.isFinite(baseRangeHigh) || !Number.isFinite(baseRangeLow) || baseRangeHigh <= baseRangeLow) {
            return {
                lines: [] as TradingViewOverlayLine[],
                pivot: null as number | null,
                tpMaxBuy: null as number | null,
                tpMaxSell: null as number | null,
                vwap: null as number | null,
                poc: null as number | null
            };
        }

        const tpMaxBuy = maxFinite(
            levelSummary?.signal === 'BUY' ? levelSummary.takeProfit : undefined,
            r3,
            r2,
            r1
        );
        const tpMaxSell = minFinite(
            levelSummary?.signal === 'SELL' ? levelSummary.takeProfit : undefined,
            s3,
            s2,
            s1
        );

        const hdwmLines = hdwmFrames.flatMap((frame) => ([
            { id: `hdwm-${frame.key}-r2`, label: `${frame.prefix} R2`, price: frame.r2, color: frame.color },
            { id: `hdwm-${frame.key}-r1`, label: `${frame.prefix} R1`, price: frame.r1, color: frame.color },
            { id: `hdwm-${frame.key}-p`, label: `${frame.prefix} P`, price: frame.pivot, color: frame.color, emphasis: true },
            { id: `hdwm-${frame.key}-s1`, label: `${frame.prefix} S1`, price: frame.s1, color: frame.color },
            { id: `hdwm-${frame.key}-s2`, label: `${frame.prefix} S2`, price: frame.s2, color: frame.color },
        ]));

        const rawLines = [
            { id: 'tp-max-buy', label: 'TP MAX BUY', price: tpMaxBuy, color: '#16a34a', emphasis: true },
            { id: 'r3', label: 'R3', price: r3, color: '#ef4444' },
            { id: 'r2', label: 'R2', price: r2, color: '#ef4444' },
            { id: 'r1', label: 'R1', price: r1, color: '#ef4444' },
            { id: 'pivot', label: 'P', price: pivot, color: '#f59e0b', emphasis: true },
            { id: 'vwap', label: 'VWAP', price: vwap, color: '#2962ff', emphasis: true },
            { id: 'poc', label: 'POC', price: poc, color: '#7c3aed', emphasis: true },
            { id: 'vah', label: 'VAH', price: vah, color: '#7c3aed' },
            { id: 'val', label: 'VAL', price: val, color: '#7c3aed' },
            { id: 's1', label: 'S1', price: s1, color: '#089981' },
            { id: 's2', label: 'S2', price: s2, color: '#089981' },
            { id: 's3', label: 'S3', price: s3, color: '#089981' },
            { id: 'tp-max-sell', label: 'TP MAX SELL', price: tpMaxSell, color: '#dc2626', emphasis: true },
            ...hdwmLines,
        ];

        const overlayPrices = rawLines
            .map((item) => Number(item.price))
            .filter((value) => Number.isFinite(value));
        const overlayRangeHigh = overlayPrices.length > 0 ? Math.max(...overlayPrices) : baseRangeHigh;
        const overlayRangeLow = overlayPrices.length > 0 ? Math.min(...overlayPrices) : baseRangeLow;
        const rangeHigh = Math.max(baseRangeHigh, overlayRangeHigh);
        const rangeLow = Math.min(baseRangeLow, overlayRangeLow);
        if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow) || rangeHigh <= rangeLow) {
            return {
                lines: [] as TradingViewOverlayLine[],
                pivot: null as number | null,
                tpMaxBuy: null as number | null,
                tpMaxSell: null as number | null,
                vwap: null as number | null,
                poc: null as number | null
            };
        }

        const pad = Math.max((rangeHigh - rangeLow) * 0.08, (rangeHigh - rangeLow) * 0.01);
        const yMax = rangeHigh + pad;
        const yMin = rangeLow - pad;
        const span = yMax - yMin;
        if (!Number.isFinite(span) || span <= 0) {
            return {
                lines: [] as TradingViewOverlayLine[],
                pivot: null as number | null,
                tpMaxBuy: null as number | null,
                tpMaxSell: null as number | null,
                vwap: null as number | null,
                poc: null as number | null
            };
        }

        const lines = rawLines
            .filter((item) => Number.isFinite(item.price))
            .map((item) => {
                const price = Number(item.price);
                const yPct = ((yMax - price) / span) * 100;
                return { ...item, price, yPct };
            })
            .filter((item) => item.yPct >= -1 && item.yPct <= 101)
            .sort((a, b) => a.yPct - b.yPct) as TradingViewOverlayLine[];

        return {
            lines,
            pivot: Number.isFinite(pivot) ? pivot : null,
            tpMaxBuy: tpMaxBuy ?? null,
            tpMaxSell: tpMaxSell ?? null,
            vwap: Number.isFinite(vwap) ? vwap : null,
            poc: Number.isFinite(poc) ? poc : null
        };
    }, [history, indicators, livePriceSnapshot, levelSummary, hdwmFrames]);

    const tradingViewLevelChoices = useMemo(() => {
        const map = new Map<string, TradingViewOverlayLine>();
        for (const line of tradingViewPivotOverlay.lines) {
            map.set(line.id, line);
        }
        const ordered: TradingViewOverlayLine[] = [];
        const used = new Set<string>();

        for (const id of TV_LEVEL_ORDER) {
            const line = map.get(id);
            if (!line) continue;
            ordered.push(line);
            used.add(id);
        }

        const remainder = tradingViewPivotOverlay.lines.filter((line) => !used.has(line.id));
        return [...ordered, ...remainder];
    }, [tradingViewPivotOverlay.lines]);

    const visibleTradingViewLines = useMemo(() => (
        tradingViewPivotOverlay.lines.filter((line) => tvLevelSelection[line.id] ?? true)
    ), [tradingViewPivotOverlay.lines, tvLevelSelection]);

    const toggleTvLevel = (id: string) => {
        setTvLevelSelection((prev) => ({
            ...prev,
            [id]: !(prev[id] ?? true)
        }));
    };

    const setAllTvLevels = (value: boolean) => {
        setTvLevelSelection((prev) => {
            const next = { ...prev };
            for (const line of tradingViewPivotOverlay.lines) next[line.id] = value;
            return next;
        });
    };

    const zoomTradingView = (direction: 'in' | 'out') => {
        const order = [...TRADINGVIEW_ZOOM_TIMEFRAMES];
        let idx = order.indexOf(currentTimeframe as any);
        if (idx < 0) idx = 0;
        const nextIdx = direction === 'in'
            ? Math.max(0, idx - 1)
            : Math.min(order.length - 1, idx + 1);
        const nextTf = order[nextIdx];
        if (nextTf !== currentTimeframe) {
            setTimeframe(nextTf);
        }
    };

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const palette = getChartPalette(themeMode);
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: palette.bg },
                textColor: palette.text,
            },
            grid: {
                vertLines: { color: palette.grid },
                horzLines: { color: palette.grid },
            },
            rightPriceScale: {
                borderColor: palette.border,
            },
            timeScale: {
                borderColor: palette.border,
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: {
                mode: 1, // Normal crosshair
                vertLine: { color: palette.crosshair, width: 1, style: 0 },
                horzLine: { color: palette.crosshair, width: 1, style: 0 },
            },
            localization: {
                priceFormatter: (value: number) => formatAxisPrice(currentSymbol, value)
            }
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#089981',
            downColor: '#f23645',
            borderVisible: false,
            wickUpColor: '#089981',
            wickDownColor: '#f23645',
            priceFormat: getPriceFormatOptions(currentSymbol),
        });

        // Volume histogram
        const volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: '', // set as an overlay by setting a blank priceScaleId
        });

        // Scale margins are set on the price scale itself, not the series config in v4+
        chart.priceScale('').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        const emaColors = { ema9: '#f59e0b', ema21: '#2962ff', ema50: '#8b5cf6', ema200: '#0ea5e9' };
        const emas: Record<string, any> = {};
        for (const [name, color] of Object.entries(emaColors)) {
            emas[name] = chart.addLineSeries({
                color,
                lineWidth: 1,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
        }

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;
        volumeSeriesRef.current = volumeSeries;
        emaSeriesRef.current = emas;

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    useEffect(() => {
        if (!seriesRef.current || !chartRef.current) return;
        seriesRef.current.applyOptions({
            priceFormat: getPriceFormatOptions(currentSymbol),
        });
        chartRef.current.applyOptions({
            localization: {
                priceFormatter: (value: number) => formatAxisPrice(currentSymbol, value)
            }
        });
    }, [currentSymbol]);

    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            layout: {
                background: { color: chartPalette.bg },
                textColor: chartPalette.text,
            },
            grid: {
                vertLines: { color: chartPalette.grid },
                horzLines: { color: chartPalette.grid },
            },
            rightPriceScale: {
                borderColor: chartPalette.border,
            },
            timeScale: {
                borderColor: chartPalette.border,
                timeVisible: true,
                secondsVisible: currentTimeframe.endsWith('s'),
            },
            crosshair: {
                mode: 1,
                vertLine: { color: chartPalette.crosshair, width: 1, style: 0 },
                horzLine: { color: chartPalette.crosshair, width: 1, style: 0 },
            }
        });
    }, [chartPalette, currentTimeframe]);

    useEffect(() => {
        if (chartProvider !== 'tradingview' || tvEmbedMode !== 'script' || !tvContainerRef.current) return;

        const container = tvContainerRef.current;
        container.innerHTML = '';
        const containerRect = container.getBoundingClientRect();
        const widgetWidth = Math.max(320, Math.floor(containerRect.width || container.clientWidth || 320));
        const widgetHeight = Math.max(280, Math.floor(containerRect.height || container.clientHeight || 420));
        let disposed = false;
        let widgetReady = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let observer: MutationObserver | null = null;

        const markWidgetReady = () => {
            widgetReady = true;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
        };

        const widgetRoot = document.createElement('div');
        widgetRoot.className = 'tradingview-widget-container';
        widgetRoot.style.width = '100%';
        widgetRoot.style.height = '100%';

        const widgetMount = document.createElement('div');
        widgetMount.className = 'tradingview-widget-container__widget';
        widgetMount.style.width = '100%';
        widgetMount.style.height = '100%';

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
        script.text = JSON.stringify({
            autosize: false,
            width: widgetWidth,
            height: widgetHeight,
            symbol: tradingViewSymbol,
            interval: tradingViewInterval,
            timezone: 'Etc/UTC',
            theme: themeMode === 'light' ? 'light' : 'dark',
            style: '1',
            locale: 'fr',
            allow_symbol_change: false,
            hide_side_toolbar: false,
            withdateranges: true,
            enable_publishing: false,
            details: true,
            hotlist: false,
            calendar: false,
            studies: [
                'Pivot Points Standard@tv-basicstudies'
            ],
            support_host: 'https://www.tradingview.com'
        });

        widgetRoot.appendChild(widgetMount);
        widgetRoot.appendChild(script);
        container.appendChild(widgetRoot);

        observer = new MutationObserver(() => {
            const iframe = container.querySelector('iframe');
            if (!iframe) return;
            iframe.addEventListener('load', markWidgetReady, { once: true });
        });
        observer.observe(container, { childList: true, subtree: true });

        if (isAndroidChrome) {
            fallbackTimer = setTimeout(() => {
                if (disposed || widgetReady) return;
                setTvEmbedMode('iframe');
            }, 5000);
        }

        return () => {
            disposed = true;
            if (observer) observer.disconnect();
            if (fallbackTimer) clearTimeout(fallbackTimer);
            container.innerHTML = '';
        };
    }, [chartProvider, tvEmbedMode, tradingViewInterval, tradingViewSymbol, themeMode, isAndroidChrome]);

    // Fetch News Data for Chart Markers
    const fetchNews = async (symbol: string) => {
        const res = await fetch(`/api/news?symbol=${symbol}`);
        return await res.json();
    };

    const { data: newsData } = useQuery({
        queryKey: ['news', currentSymbol],
        queryFn: () => fetchNews(currentSymbol),
        refetchInterval: 120000,
    });
    const newsItems = useMemo(() => (newsData?.items || newsData?.news || []), [newsData]);

    // Update historical data and markers
    useEffect(() => {
        if (seriesRef.current && volumeSeriesRef.current && history?.length > 0) {
            // lightweight-charts needs time as a UNIX timestamp (number)
            const formattedData = history.map((d: any) => ({
                time: (d.time ? Number(d.time) : new Date(d.timestamp).getTime() / 1000) as import('lightweight-charts').UTCTimestamp,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume || 0
            })).filter((d: any) => !isNaN(d.time as number)).sort((a: any, b: any) => (a.time as number) - (b.time as number));

            // Remove duplicates by time
            const uniqueData = formattedData.filter((v: any, i: number, a: any[]) => a.findIndex(t => (t.time === v.time)) === i);
            const mergedData = [...uniqueData];
            const live = liveCandleRef.current;
            if (live && Number.isFinite(live.time)) {
                const idx = mergedData.findIndex((d: any) => Number(d.time) === live.time);
                const livePoint = {
                    time: live.time as import('lightweight-charts').UTCTimestamp,
                    open: live.open,
                    high: live.high,
                    low: live.low,
                    close: live.close,
                    volume: live.volume || 0
                };
                if (idx >= 0) {
                    mergedData[idx] = livePoint;
                } else if (mergedData.length === 0 || live.time > Number(mergedData[mergedData.length - 1].time)) {
                    mergedData.push(livePoint);
                }
            }

            try {
                // @ts-ignore - ignoring exact Time type mismatch
                seriesRef.current.setData(mergedData);

                // Setup Volume Data
                const volData = mergedData.map((c: any) => ({
                    time: c.time,
                    value: c.volume,
                    color: c.close >= c.open ? chartPalette.volumeUp : chartPalette.volumeDown
                }));
                volumeSeriesRef.current.setData(volData);

                // Keep chart clean: markers are optional and text is hidden to avoid covering candles.
                if (!showNewsMarkers || newsItems.length === 0) {
                    seriesRef.current.setMarkers([]);
                } else {
                    const markers: any[] = [];
                    const recentCandles = mergedData.slice(-Math.min(40, mergedData.length));
                    const newsSubset = newsItems.slice(0, 3);

                    newsSubset.forEach((article: any, index: number) => {
                        const candleIndex = Math.min(
                            recentCandles.length - 1,
                            Math.floor((index + 1) * (recentCandles.length / (newsSubset.length + 1)))
                        );
                        const candle = recentCandles[candleIndex];
                        if (!candle) return;

                        const sentiment = String(article?.sentiment || '').toLowerCase();
                        const title = String(article?.title || '').toLowerCase();
                        const isBullish = sentiment.includes('bull') || title.includes('bull') || title.includes('gain') || title.includes('rise');
                        const isBearish = sentiment.includes('bear') || title.includes('bear') || title.includes('drop') || title.includes('fall');

                        markers.push({
                            time: candle.time,
                            position: isBearish ? 'aboveBar' : 'belowBar',
                            color: isBearish ? '#ff5252' : isBullish ? '#00e676' : '#2196f3',
                            shape: isBearish ? 'arrowDown' : isBullish ? 'arrowUp' : 'circle',
                            text: '',
                            size: 0.8
                        });
                    });

                    markers.sort((a, b) => a.time - b.time);
                    seriesRef.current.setMarkers(markers);
                }

                const last = mergedData.length > 0 ? mergedData[mergedData.length - 1] : null;
                if (last) {
                    const seeded: LocalCandle = {
                        time: Number(last.time),
                        open: Number(last.open),
                        high: Number(last.high),
                        low: Number(last.low),
                        close: Number(last.close),
                        volume: Number(last.volume) || 0,
                    };
                    liveCandleRef.current = seeded;
                    setLiveCandleSnapshot(seeded);
                }

            } catch (e) {
                console.error('Error setting chart data', e);
            }
        }
    }, [history, newsItems, showNewsMarkers, chartPalette]);

    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            timeScale: {
                timeVisible: true,
                secondsVisible: currentTimeframe.endsWith('s'),
            },
        });
    }, [currentTimeframe]);

    // Update EMAs
    useEffect(() => {
        if (indicators?.emaArrays && emaSeriesRef.current && history?.length > 0) {
            const timeMap = history.map((d: any) => d.time ? Number(d.time) : new Date(d.timestamp).getTime() / 1000);

            for (const [name, arr] of Object.entries(indicators.emaArrays)) {
                const series = emaSeriesRef.current[name];
                if (series && arr && Array.isArray(arr)) {
                    const offset = history.length - arr.length;
                    if (offset < 0) continue;

                    const emaData = [];
                    const seen = new Set();
                    for (let i = 0; i < arr.length; i++) {
                        const t = timeMap[i + offset];
                        if (t && !seen.has(t)) {
                            seen.add(t);
                            emaData.push({ time: t, value: arr[i] });
                        }
                    }
                    try { series.setData(emaData.sort((a, b) => a.time - b.time)); } catch (e) { }
                }
            }
        }
    }, [indicators, history]);

    const applyLivePriceToChart = (price: number, timestampMs?: number) => {
        if (!seriesRef.current || !Number.isFinite(price) || price <= 0) return;

        const bucketSeconds = timeframeToSeconds(currentTimeframe);
        const eventSec = Math.floor(normalizeTimestampMs(timestampMs) / 1000);
        const bucketTime = Math.floor(eventSec / bucketSeconds) * bucketSeconds;
        const seededFromHistory = historyRef.current && historyRef.current.length > 0
            ? toLocalCandle(historyRef.current[historyRef.current.length - 1])
            : null;
        const current = liveCandleRef.current || seededFromHistory;
        if (!current) return;

        let nextCandle: LocalCandle;
        if (bucketTime > current.time) {
            nextCandle = {
                time: bucketTime,
                open: current.close,
                high: Math.max(current.close, price),
                low: Math.min(current.close, price),
                close: price,
                volume: 0,
            };
        } else if (bucketTime === current.time) {
            nextCandle = {
                ...current,
                high: Math.max(current.high, price),
                low: Math.min(current.low, price),
                close: price,
            };
        } else {
            nextCandle = {
                ...current,
                high: Math.max(current.high, price),
                low: Math.min(current.low, price),
                close: price,
            };
        }

        liveCandleRef.current = nextCandle;

        try {
            // @ts-ignore
            seriesRef.current.update({
                time: nextCandle.time as import('lightweight-charts').UTCTimestamp,
                open: nextCandle.open,
                high: nextCandle.high,
                low: nextCandle.low,
                close: nextCandle.close,
            });
            if (volumeSeriesRef.current) {
                volumeSeriesRef.current.update({
                    time: nextCandle.time as import('lightweight-charts').UTCTimestamp,
                    value: nextCandle.volume || 0,
                    color: nextCandle.close >= nextCandle.open ? chartPalette.volumeUp : chartPalette.volumeDown
                });
            }
        } catch (e) {
            // Silent chart update fallback.
        }
    };

    // Hot path: listen to live ticks directly without going through React store updates.
    useEffect(() => {
        const unsubscribe = subscribeLiveTick((tick) => {
            if (tick.symbol !== currentSymbol) return;
            if (!Number.isFinite(Number(tick.price)) || Number(tick.price) <= 0) return;

            const price = Number(tick.price);
            const tickTsMs = normalizeTimestampMs(Number(tick.timestamp));
            livePriceRef.current = price;
            applyLivePriceToChart(price, tickTsMs);
            setTvLastTickTs(tickTsMs);

            const isTradingViewLive = chartProvider === 'tradingview';
            const now = Date.now();
            if (isTradingViewLive || (now - lastUiPricePushRef.current) >= 120) {
                if (!isTradingViewLive) {
                    lastUiPricePushRef.current = now;
                }
                setLivePriceSnapshot(price);
                if (liveCandleRef.current) {
                    setLiveCandleSnapshot({ ...liveCandleRef.current });
                }
            }
        });
        return unsubscribe;
    }, [currentSymbol, currentTimeframe, chartPalette, chartProvider]);

    useEffect(() => {
        liveCandleRef.current = null;
        livePriceRef.current = null;
        lastUiPricePushRef.current = 0;
        setLivePriceSnapshot(undefined);
        setLiveCandleSnapshot(null);
        setTvLastTickTs(null);
    }, [currentSymbol, currentTimeframe]);

    const fallbackPrice = liveCandleSnapshot?.close ?? (history && history.length > 0 ? history[history.length - 1]?.close : undefined);
    const displayPrice = livePriceSnapshot || fallbackPrice;
    const prevClose = history && history.length > 1 ? history[history.length - 2]?.close : undefined;
    const changeValue = displayPrice && prevClose ? displayPrice - prevClose : 0;
    const changePercent = prevClose ? (changeValue / prevClose) * 100 : 0;
    const changeDirection = changeValue >= 0 ? 'up' : 'down';
    const tvTickAgeMs = tvLastTickTs ? Math.max(0, tvNowTs - tvLastTickTs) : null;
    const tvTickPrice = displayPrice || fallbackPrice;
    const ohlc = useMemo(() => {
        if (liveCandleSnapshot) {
            return {
                open: liveCandleSnapshot.open,
                high: liveCandleSnapshot.high,
                low: liveCandleSnapshot.low,
                close: liveCandleSnapshot.close,
            };
        }
        if (!history || history.length === 0) return null;
        const last = history[history.length - 1];
        const close = livePriceSnapshot || last.close;
        return {
            open: last.open,
            high: livePriceSnapshot ? Math.max(last.high, livePriceSnapshot) : last.high,
            low: livePriceSnapshot ? Math.min(last.low, livePriceSnapshot) : last.low,
            close,
        };
    }, [history, livePriceSnapshot, liveCandleSnapshot]);

    // Handle Prediction Lines (Entry, TP, SL)
    useEffect(() => {
        if (!seriesRef.current || !signalHistory) return;

        // Clear existing lines
        priceLinesRef.current.forEach(line => {
            seriesRef.current?.removePriceLine(line);
        });
        priceLinesRef.current = [];

        if (!showTradeLevels) return;

        // Find latest signal for this symbol/timeframe
        const latest = latestSignal;
        if (!latest || !latest.entryPrice) return;

        const { entryPrice, takeProfit, stopLoss } = latest;

        const lines = [];

        // Entry Line
        if (entryPrice) {
            lines.push(seriesRef.current.createPriceLine({
                price: entryPrice,
                color: '#f5b041',
                lineWidth: 2,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: 'ENTRY',
            }));
        }

        // TP Line
        if (takeProfit) {
            lines.push(seriesRef.current.createPriceLine({
                price: takeProfit,
                color: '#00e676',
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: 'TP',
            }));
        }

        // SL Line
        if (stopLoss) {
            lines.push(seriesRef.current.createPriceLine({
                price: stopLoss,
                color: '#ff5252',
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: 'SL',
            }));
        }

        priceLinesRef.current = lines;
    }, [signalHistory, currentSymbol, currentTimeframe, latestSignal, showTradeLevels]);

    // Ari chart structural levels: Pivot, VWAP, POC/VAH/VAL
    useEffect(() => {
        if (!seriesRef.current) return;

        pivotLinesRef.current.forEach((line) => {
            seriesRef.current?.removePriceLine(line);
        });
        pivotLinesRef.current = [];

        if (!showPivotLevels || chartProvider !== 'ari') return;

        const pp = indicators?.pivotPoints;
        const vwap = Number(indicators?.vwapSession ?? indicators?.vwap);
        const vp = indicators?.volumeProfile;
        const defs = [
            { price: Number(pp?.r3), color: '#ef4444', title: 'R3', style: 2, width: 1 },
            { price: Number(pp?.r2), color: '#ef4444', title: 'R2', style: 1, width: 1 },
            { price: Number(pp?.r1), color: '#ef4444', title: 'R1', style: 1, width: 1 },
            { price: Number(pp?.pivot), color: '#f59e0b', title: 'PIVOT', style: 0, width: 2 },
            { price: vwap, color: '#2962ff', title: 'VWAP', style: 0, width: 2 },
            { price: Number(vp?.poc), color: '#7c3aed', title: 'POC', style: 0, width: 2 },
            { price: Number(vp?.vah), color: '#7c3aed', title: 'VAH', style: 2, width: 1 },
            { price: Number(vp?.val), color: '#7c3aed', title: 'VAL', style: 2, width: 1 },
            { price: Number(pp?.s1), color: '#089981', title: 'S1', style: 1, width: 1 },
            { price: Number(pp?.s2), color: '#089981', title: 'S2', style: 1, width: 1 },
            { price: Number(pp?.s3), color: '#089981', title: 'S3', style: 2, width: 1 },
        ];

        const nextLines = defs
            .filter((d) => Number.isFinite(d.price))
            .map((d) => seriesRef.current!.createPriceLine({
                price: Number(d.price),
                color: d.color,
                lineWidth: d.width as 1 | 2 | 3 | 4,
                lineStyle: d.style,
                axisLabelVisible: true,
                title: d.title,
            }));

        pivotLinesRef.current = nextLines;
    }, [indicators, showPivotLevels, chartProvider, currentSymbol, currentTimeframe]);

    const [countdown, setCountdown] = useState<string>('00:00');
    const [countdownSecondsLeft, setCountdownSecondsLeft] = useState<number>(0);
    const timeframeSeconds = useMemo(() => Math.max(1, timeframeToSeconds(currentTimeframe)), [currentTimeframe]);
    const countdownUrgentThreshold = Math.max(5, Math.min(20, Math.floor(timeframeSeconds * 0.08)));
    const countdownWarningThreshold = Math.max(countdownUrgentThreshold + 5, Math.min(90, Math.floor(timeframeSeconds * 0.2)));
    const countdownTone = countdownSecondsLeft > 0 && countdownSecondsLeft <= countdownUrgentThreshold
        ? 'urgent'
        : countdownSecondsLeft > 0 && countdownSecondsLeft <= countdownWarningThreshold
            ? 'warning'
            : 'normal';

    // Dynamic Countdown Timer Logic
    useEffect(() => {
        const updateTimer = () => {
            const bucketSeconds = Math.max(1, timeframeToSeconds(currentTimeframe));
            const nowMs = Date.now();
            const nowSeconds = nowMs / 1000;
            const latestCandleTime = Number(liveCandleRef.current?.time);

            let nextCloseSeconds: number;
            if (Number.isFinite(latestCandleTime) && latestCandleTime > 0 && latestCandleTime <= (nowSeconds + bucketSeconds)) {
                const barsSinceLatest = Math.max(0, Math.floor((nowSeconds - latestCandleTime) / bucketSeconds));
                nextCloseSeconds = latestCandleTime + ((barsSinceLatest + 1) * bucketSeconds);
            } else {
                nextCloseSeconds = Math.ceil(nowSeconds / bucketSeconds) * bucketSeconds;
            }

            let totalSeconds = Math.max(0, Math.ceil(nextCloseSeconds - nowSeconds));
            if (totalSeconds <= 0 || totalSeconds > bucketSeconds) {
                const elapsed = Math.floor(nowSeconds) % bucketSeconds;
                totalSeconds = elapsed === 0 ? bucketSeconds : (bucketSeconds - elapsed);
            }

            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            setCountdownSecondsLeft(totalSeconds);
            if (hours > 0) {
                setCountdown(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            } else {
                setCountdown(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 250);
        return () => clearInterval(interval);
    }, [currentTimeframe]);

    const hdwmRows = [
        { id: 'pivot', label: 'P', render: (frame: HdwmFrameData) => formatPrice(currentSymbol, frame.pivot) },
        { id: 'r1', label: 'R1', render: (frame: HdwmFrameData) => formatPrice(currentSymbol, frame.r1) },
        { id: 's1', label: 'S1', render: (frame: HdwmFrameData) => formatPrice(currentSymbol, frame.s1) },
        { id: 'r2', label: 'R2', render: (frame: HdwmFrameData) => formatPrice(currentSymbol, frame.r2) },
        { id: 's2', label: 'S2', render: (frame: HdwmFrameData) => formatPrice(currentSymbol, frame.s2) },
        { id: 'tr', label: 'TR Ticks', render: (frame: HdwmFrameData) => formatNumber(frame.trueRangeTicks, 0) },
        { id: 'volat', label: 'Volat %', render: (frame: HdwmFrameData) => `${formatNumber(frame.fluctuationPct, 2)}%` },
        { id: 'vol', label: 'Vol', render: (frame: HdwmFrameData) => formatCompactVolume(frame.volume) },
    ];
    const hdwmHasData = hdwmFrames.length > 0;

    return (
        <div className="chart-shell">
            <div className="chart-toolbar">
                <div className="chart-toolbar-main">
                    <div className="chart-headline">
                        <div className="chart-title-row">
                            <h2 className="chart-title">{currentSymbol.replace('/', '')}</h2>
                            <span className="chart-market-tag">Spot</span>
                            <span className="chart-live-state">Live</span>
                        </div>
                        <div className="chart-price-row">
                            <span className="chart-price-main">{formatPrice(currentSymbol, displayPrice)}</span>
                            <span className={`chart-price-change ${changeDirection}`}>
                                {formatChange(currentSymbol, changeValue)} ({changeValue >= 0 ? '+' : ''}{changePercent.toFixed(2)}%)
                            </span>
                            <div className="chart-right-meta">
                                <div className={`chart-countdown ${countdownTone}`} role="status" aria-live="polite">
                                    <span className="chart-countdown-meta">TF {formatTimeframeLabel(currentTimeframe)}</span>
                                    <span className="chart-countdown-value">{countdown}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="chart-switches">
                        <button
                            className={`chart-toggle ${chartProvider === 'tradingview' ? 'active' : ''}`}
                            onClick={() => setChartProvider('tradingview')}
                            type="button"
                        >
                            TradingView
                        </button>
                        <button
                            className={`chart-toggle ${chartProvider === 'ari' ? 'active' : ''}`}
                            onClick={() => setChartProvider('ari')}
                            type="button"
                        >
                            Ari Chart
                        </button>
                        <button
                            className={`chart-toggle ${showTradeLevels ? 'active' : ''}`}
                            onClick={() => setShowTradeLevels(v => !v)}
                            type="button"
                        >
                            Lignes Trade
                        </button>
                        <button
                            className={`chart-toggle ${showPivotLevels ? 'active' : ''}`}
                            onClick={() => setShowPivotLevels(v => !v)}
                            type="button"
                        >
                            Pivot + VWAP
                        </button>
                        <button
                            className={`chart-toggle ${showNewsMarkers ? 'active' : ''}`}
                            onClick={() => setShowNewsMarkers(v => !v)}
                            type="button"
                        >
                            Marqueurs News
                        </button>
                    </div>
                </div>

                {chartProvider === 'tradingview' && (
                    <>
                        <div className="chart-tv-info">
                            <span className="chart-chip">TV: {tradingViewSymbol}</span>
                            <span className={`chart-chip chart-chip-live ${tvTickAgeMs != null && tvTickAgeMs <= LIVE_TICK_FRESH_MS ? 'fresh' : 'stale'}`}>
                                Tick {formatPrice(currentSymbol, tvTickPrice)} · {formatClockWithMs(tvLastTickTs)} · {tvTickAgeMs != null ? `${tvTickAgeMs}ms` : '—'}
                            </span>
                            <div className="chart-tv-controls">
                                <button
                                    className="chart-tv-zoom-btn"
                                    type="button"
                                    onClick={() => zoomTradingView('in')}
                                    title="Zoom avant TradingView"
                                >
                                    Zoom +
                                </button>
                                <button
                                    className="chart-tv-zoom-btn"
                                    type="button"
                                    onClick={() => zoomTradingView('out')}
                                    title="Zoom arrière TradingView"
                                >
                                    Zoom -
                                </button>
                                <span className="chart-chip">TF TV {formatTimeframeLabel(currentTimeframe)}</span>
                                <span className="chart-chip">Molette / Pincer</span>
                                <button
                                    className={`chart-tv-zoom-btn ${showHdwmTable ? 'active' : ''}`}
                                    type="button"
                                    onClick={() => setShowHdwmTable((prev) => !prev)}
                                    title="Afficher ou masquer le tableau institutionnel HDWM"
                                >
                                    Tableau HDWM {showHdwmTable ? 'ON' : 'OFF'}
                                </button>
                                {isAndroidChrome && (
                                    <button
                                        className={`chart-tv-zoom-btn ${tvEmbedMode === 'iframe' ? 'active' : ''}`}
                                        type="button"
                                        onClick={() => setTvEmbedMode((prev) => prev === 'script' ? 'iframe' : 'script')}
                                        title="Basculer le mode de rendu TradingView pour Android Chrome"
                                    >
                                        Mode compat {tvEmbedMode === 'iframe' ? 'ON' : 'OFF'}
                                    </button>
                                )}
                            </div>
                            {currentTimeframe.endsWith('s') && (
                                <span className="chart-tv-warning">Secondes non garanties sur widget public, fallback 1m.</span>
                            )}
                        </div>

                        {showPivotLevels && (
                            <div className="chart-tv-level-picker">
                                <button
                                    type="button"
                                    className="chart-tv-level-btn"
                                    onClick={() => setAllTvLevels(true)}
                                >
                                    Tout afficher
                                </button>
                                <button
                                    type="button"
                                    className="chart-tv-level-btn"
                                    onClick={() => setAllTvLevels(false)}
                                >
                                    Tout masquer
                                </button>
                                {tradingViewLevelChoices.map((line) => {
                                    const active = tvLevelSelection[line.id] ?? true;
                                    return (
                                        <button
                                            key={line.id}
                                            type="button"
                                            className={`chart-tv-level-btn ${active ? 'active' : 'inactive'}`}
                                            style={{
                                                borderColor: line.color,
                                                color: active ? 'var(--text-main)' : line.color,
                                                background: active ? `${line.color}22` : 'var(--bg-secondary)'
                                            }}
                                            onClick={() => toggleTvLevel(line.id)}
                                            title={`${line.label} ${formatPrice(currentSymbol, line.price)}`}
                                        >
                                            {line.label} {formatPrice(currentSymbol, line.price)}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {showHdwmTable && (
                            <div className="chart-tv-hdwm-wrap">
                                <div className="chart-tv-hdwm-title">Institutional Pivots HDWM & Volume</div>
                                <div className="chart-tv-hdwm-scroll">
                                    <table className="chart-tv-hdwm-table">
                                        <thead>
                                            <tr>
                                                <th>Niveau</th>
                                                {HDWM_FRAME_CONFIG.map((cfg) => (
                                                    <th key={cfg.key} style={{ color: cfg.color }}>{cfg.title}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {hdwmRows.map((row) => (
                                                <tr key={row.id}>
                                                    <th>{row.label}</th>
                                                    {HDWM_FRAME_CONFIG.map((cfg) => {
                                                        const frame = hdwmFrameMap[cfg.key];
                                                        return (
                                                            <td key={`${row.id}-${cfg.key}`}>
                                                                {frame ? row.render(frame) : '—'}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {ohlc && (
                    <div className="chart-ohlc-row">
                        <span className="chart-ohlc-item">O {formatPrice(currentSymbol, ohlc.open)}</span>
                        <span className="chart-ohlc-item">H {formatPrice(currentSymbol, ohlc.high)}</span>
                        <span className="chart-ohlc-item">L {formatPrice(currentSymbol, ohlc.low)}</span>
                        <span className="chart-ohlc-item">C {formatPrice(currentSymbol, ohlc.close)}</span>
                    </div>
                )}

                {levelSummary && (
                    <div className="chart-level-strip">
                        <span className={`chart-level-badge ${levelSummary.signal === 'BUY' ? 'buy' : levelSummary.signal === 'SELL' ? 'sell' : 'hold'}`}>
                            {levelSummary.signal} ({Math.round(levelSummary.confidence)}%)
                        </span>
                        <span className="chart-level-item">Entrée {formatPrice(currentSymbol, levelSummary.entryPrice)}</span>
                        <span className="chart-level-item tp">TP {formatPrice(currentSymbol, levelSummary.takeProfit)}</span>
                        <span className="chart-level-item sl">SL {formatPrice(currentSymbol, levelSummary.stopLoss)}</span>
                    </div>
                )}

                <div className="chart-timeframes">
                    {FAST_TIMEFRAMES.map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`tf-btn tf-fast ${tf === currentTimeframe ? 'active' : ''}`}
                            type="button"
                        >
                            {tf.toUpperCase()}
                        </button>
                    ))}
                    {STANDARD_TIMEFRAMES.map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`tf-btn ${tf === currentTimeframe ? 'active' : ''}`}
                            type="button"
                        >
                            {formatTimeframeLabel(tf)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="chart-stage">
                {isLoading && chartProvider === 'ari' && <div className="chart-loading">Chargement du chart...</div>}
                <div className={`chart-pane ${chartProvider === 'ari' ? 'active' : 'hidden'}`}>
                    <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
                </div>
                <div className={`chart-pane ${chartProvider === 'tradingview' ? 'active' : 'hidden'}`}>
                    {useTvIframeFallback ? (
                        <>
                            <iframe
                                title="TradingView Main Chart"
                                src={tradingViewIframeSrc}
                                className="chart-tv-iframe-fallback"
                                allowFullScreen
                                referrerPolicy="origin"
                                onLoad={() => setTvIframeLoaded(true)}
                            />
                            {!tvIframeLoaded && (
                                <div className="chart-loading">
                                    Chargement TradingView mobile...
                                    {' '}
                                    <a
                                        href={tradingViewIframeSrc}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                                    >
                                        Ouvrir
                                    </a>
                                </div>
                            )}
                        </>
                    ) : (
                        <div ref={tvContainerRef} className="chart-tv-host" />
                    )}
                    {showHdwmTable && (
                        <div className="chart-tv-hdwm-overlay-panel">
                            <div className="chart-tv-hdwm-title">Tableau Quantitatif HDWM</div>
                            {!hdwmHasData ? (
                                <div className="chart-tv-hdwm-empty">
                                    Donnees HDWM indisponibles pour l'instant.
                                </div>
                            ) : (
                                <div className="chart-tv-hdwm-scroll">
                                    <table className="chart-tv-hdwm-table">
                                        <thead>
                                            <tr>
                                                <th>Niveau</th>
                                                {HDWM_FRAME_CONFIG.map((cfg) => (
                                                    <th key={`overlay-${cfg.key}`} style={{ color: cfg.color }}>{cfg.title}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {hdwmRows.map((row) => (
                                                <tr key={`overlay-${row.id}`}>
                                                    <th>{row.label}</th>
                                                    {HDWM_FRAME_CONFIG.map((cfg) => {
                                                        const frame = hdwmFrameMap[cfg.key];
                                                        return (
                                                            <td key={`overlay-${row.id}-${cfg.key}`}>
                                                                {frame ? row.render(frame) : '—'}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                    {showPivotLevels && visibleTradingViewLines.length > 0 && (
                        <div className="chart-tv-level-overlay">
                            {visibleTradingViewLines.map((line) => (
                                <div
                                    key={line.id}
                                    className={`chart-tv-level-line ${line.emphasis ? 'emphasis' : ''}`}
                                    style={{ top: `${line.yPct}%`, borderTopColor: line.color }}
                                >
                                    <span className="chart-tv-level-tag" style={{ color: line.color, borderColor: line.color }}>
                                        {line.label} {formatPrice(currentSymbol, line.price)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
