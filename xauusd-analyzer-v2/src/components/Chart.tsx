import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const formatTimeframeLabel = (tf: string) => {
    if (tf === '1min') return '1M';
    if (tf === '5min') return '5M';
    if (tf === '15min') return '15M';
    return tf.toUpperCase();
};

const formatPrice = (value?: number) => {
    if (!value || value <= 0) return '—';
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

export default function Chart() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<any>(null);
    const emaSeriesRef = useRef<Record<string, any>>({});
    const priceLinesRef = useRef<any[]>([]);

    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const setTimeframe = useMarketStore(state => state.setTimeframe);
    const signalHistory = useMarketStore(state => state.signalHistory);

    const prices = useMarketStore(state => state.prices);
    const livePrice = prices[currentSymbol];
    const [showNewsMarkers, setShowNewsMarkers] = useState(false);
    const [showTradeLevels, setShowTradeLevels] = useState(true);

    // Force reset to a valid timeframe if symbol changes
    useEffect(() => {
        if (currentSymbol === 'XAU/USD' && ['1s', '5s', '15s', '30s'].includes(currentTimeframe)) {
            setTimeframe('1min');
        }
    }, [currentSymbol, currentTimeframe, setTimeframe]);

    const { data: history, isLoading } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });

    const indicators = useMemo(() => {
        if (!history || history.length < 30) return null;
        const candles = [...history];
        if (livePrice) {
            const last = { ...candles[candles.length - 1] };
            last.close = livePrice;
            last.high = Math.max(last.high, livePrice);
            last.low = Math.min(last.low, livePrice);
            candles[candles.length - 1] = last;
        }
        return calculateAllIndicators(candles);
    }, [history, livePrice]);

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

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: '#0f141d' },
                textColor: '#b2b5be',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.08)',
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.08)',
                timeVisible: true,
                secondsVisible: false,
            },
            crosshair: {
                mode: 1, // Normal crosshair
                vertLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 0 },
                horzLine: { color: 'rgba(255, 255, 255, 0.15)', width: 1, style: 0 },
            },
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#00e676',
            downColor: '#ff5252',
            borderVisible: false,
            wickUpColor: '#00e676',
            wickDownColor: '#ff5252',
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

        const emaColors = { ema9: '#ff9800', ema21: '#2196f3', ema50: '#e91e63', ema200: '#9c27b0' };
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

            try {
                // @ts-ignore - ignoring exact Time type mismatch
                seriesRef.current.setData(uniqueData);

                // Setup Volume Data
                const volData = uniqueData.map((c: any) => ({
                    time: c.time,
                    value: c.volume,
                    color: c.close >= c.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 82, 82, 0.2)'
                }));
                volumeSeriesRef.current.setData(volData);

                // Keep chart clean: markers are optional and text is hidden to avoid covering candles.
                if (!showNewsMarkers || newsItems.length === 0) {
                    seriesRef.current.setMarkers([]);
                } else {
                    const markers: any[] = [];
                    const recentCandles = uniqueData.slice(-Math.min(40, uniqueData.length));
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

            } catch (e) {
                console.error('Error setting chart data', e);
            }
        }
    }, [history, newsItems, showNewsMarkers]);

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

    // Update live price ticket
    useEffect(() => {
        if (seriesRef.current && livePrice && history?.length > 0) {
            const lastCandle = history[history.length - 1];
            const time = lastCandle.time ? Number(lastCandle.time) : new Date(lastCandle.timestamp).getTime() / 1000;

            try {
                // @ts-ignore
                seriesRef.current.update({
                    time: time as import('lightweight-charts').UTCTimestamp, // Add to current candle
                    open: lastCandle.open,
                    high: Math.max(lastCandle.high, livePrice),
                    low: Math.min(lastCandle.low, livePrice),
                    close: livePrice,
                });
                if (volumeSeriesRef.current) {
                    volumeSeriesRef.current.update({
                        time: time as import('lightweight-charts').UTCTimestamp,
                        value: lastCandle.volume || 0,
                        color: livePrice >= lastCandle.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 82, 82, 0.2)'
                    });
                }
            } catch (e) { }
        }
    }, [livePrice, history]);

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
                lineWidth: 1,
                lineStyle: 1, // Dotted
                axisLabelVisible: false,
                title: '',
            }));
        }

        // TP Line
        if (takeProfit) {
            lines.push(seriesRef.current.createPriceLine({
                price: takeProfit,
                color: '#00e676',
                lineWidth: 1,
                lineStyle: 0, // Solid
                axisLabelVisible: false,
                title: '',
            }));
        }

        // SL Line
        if (stopLoss) {
            lines.push(seriesRef.current.createPriceLine({
                price: stopLoss,
                color: '#ff5252',
                lineWidth: 1,
                lineStyle: 0, // Solid
                axisLabelVisible: false,
                title: '',
            }));
        }

        priceLinesRef.current = lines;
    }, [signalHistory, currentSymbol, currentTimeframe, latestSignal, showTradeLevels]);

    const [countdown, setCountdown] = useState<string>('00:00');

    // Dynamic Countdown Timer Logic
    useEffect(() => {
        const updateTimer = () => {
            // Parse timeframe to milliseconds
            let multiplierMs = 15 * 60 * 1000; // default 15m
            if (currentTimeframe.endsWith('s')) {
                multiplierMs = parseInt(currentTimeframe) * 1000;
            } else if (currentTimeframe.endsWith('min') || currentTimeframe.endsWith('m')) {
                multiplierMs = parseInt(currentTimeframe) * 60 * 1000;
            } else if (currentTimeframe.endsWith('h')) {
                multiplierMs = parseInt(currentTimeframe) * 60 * 60 * 1000;
            }

            const now = new Date();
            const msCurrent = now.getTime();
            const msNext = Math.ceil(msCurrent / multiplierMs) * multiplierMs;
            const diff = msNext - msCurrent;

            if (diff <= 0) {
                setCountdown('00:00');
                return;
            }

            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);

            if (multiplierMs < 60000) {
                // Format just seconds for sub-minute timeframes
                setCountdown(`${s.toString().padStart(2, '0')}s`);
            } else {
                setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [currentTimeframe]);

    const fallbackPrice = history && history.length > 0 ? history[history.length - 1]?.close : undefined;
    const displayPrice = livePrice || fallbackPrice;
    const prevClose = history && history.length > 1 ? history[history.length - 2]?.close : undefined;
    const changeValue = displayPrice && prevClose ? displayPrice - prevClose : 0;
    const changePercent = prevClose ? (changeValue / prevClose) * 100 : 0;
    const changeDirection = changeValue >= 0 ? 'up' : 'down';
    const ohlc = useMemo(() => {
        if (!history || history.length === 0) return null;
        const last = history[history.length - 1];
        const close = livePrice || last.close;
        return {
            open: last.open,
            high: livePrice ? Math.max(last.high, livePrice) : last.high,
            low: livePrice ? Math.min(last.low, livePrice) : last.low,
            close,
        };
    }, [history, livePrice]);

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
                            <span className="chart-price-main">{formatPrice(displayPrice)}</span>
                            <span className={`chart-price-change ${changeDirection}`}>
                                {changeValue >= 0 ? '+' : ''}{changeValue.toFixed(2)} ({changeValue >= 0 ? '+' : ''}{changePercent.toFixed(2)}%)
                            </span>
                            <span className="chart-chip">TF {formatTimeframeLabel(currentTimeframe)} • {countdown}</span>
                        </div>
                    </div>

                    <div className="chart-switches">
                        <button
                            className={`chart-toggle ${showTradeLevels ? 'active' : ''}`}
                            onClick={() => setShowTradeLevels(v => !v)}
                            type="button"
                        >
                            Lignes Trade
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

                {ohlc && (
                    <div className="chart-ohlc-row">
                        <span className="chart-ohlc-item">O {formatPrice(ohlc.open)}</span>
                        <span className="chart-ohlc-item">H {formatPrice(ohlc.high)}</span>
                        <span className="chart-ohlc-item">L {formatPrice(ohlc.low)}</span>
                        <span className="chart-ohlc-item">C {formatPrice(ohlc.close)}</span>
                    </div>
                )}

                {levelSummary && (
                    <div className="chart-level-strip">
                        <span className={`chart-level-badge ${levelSummary.signal === 'BUY' ? 'buy' : levelSummary.signal === 'SELL' ? 'sell' : 'hold'}`}>
                            {levelSummary.signal} ({Math.round(levelSummary.confidence)}%)
                        </span>
                        <span className="chart-level-item">Entrée {formatPrice(levelSummary.entryPrice)}</span>
                        <span className="chart-level-item tp">TP {formatPrice(levelSummary.takeProfit)}</span>
                        <span className="chart-level-item sl">SL {formatPrice(levelSummary.stopLoss)}</span>
                    </div>
                )}

                <div className="chart-timeframes">
                    {currentSymbol !== 'XAU/USD' && ['1s', '5s', '15s', '30s'].map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`tf-btn tf-fast ${tf === currentTimeframe ? 'active' : ''}`}
                            type="button"
                        >
                            {tf.toUpperCase()}
                        </button>
                    ))}
                    {['1min', '5min', '15min', '1h', '4h'].map(tf => (
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
                {isLoading && <div className="chart-loading">Chargement du chart...</div>}
                <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
            </div>
        </div>
    );
}
