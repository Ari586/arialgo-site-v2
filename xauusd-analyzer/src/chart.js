// ============================================
//  TradingView Lightweight Charts v5 Integration
// ============================================
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';

let chart = null;
let candleSeries = null;
let volumeSeries = null;
let emaLines = {};

const EMA_COLORS = {
    ema9: '#ff9800',
    ema21: '#2196f3',
    ema50: '#e91e63',
    ema200: '#9c27b0'
};

/**
 * Initialize the chart
 */
export function initChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    chart = createChart(container, {
        layout: {
            background: { color: '#ffffff' },
            textColor: '#333333',
            fontFamily: 'Inter, sans-serif',
            fontSize: 12
        },
        grid: {
            vertLines: { color: 'rgba(0, 0, 0, 0.06)' },
            horzLines: { color: 'rgba(0, 0, 0, 0.06)' }
        },
        crosshair: {
            mode: 0,
            vertLine: { color: 'rgba(0, 0, 0, 0.2)', style: 2 },
            horzLine: { color: 'rgba(0, 0, 0, 0.2)', style: 2 }
        },
        rightPriceScale: {
            borderColor: 'rgba(0, 0, 0, 0.1)',
            scaleMargins: { top: 0.1, bottom: 0.2 }
        },
        timeScale: {
            borderColor: 'rgba(0, 0, 0, 0.1)',
            timeVisible: true,
            secondsVisible: false
        },
        handleScale: { axisPressedMouseMove: true },
        handleScroll: { mouseWheel: true, pressedMouseMove: true }
    });

    // Candlestick series (v5 API)
    candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#00e676',
        downColor: '#ff4444',
        borderUpColor: '#00e676',
        borderDownColor: '#ff4444',
        wickUpColor: '#00e67688',
        wickDownColor: '#ff444488'
    });

    // Volume histogram (v5 API)
    volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume'
    });

    chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
        drawTicks: false
    });

    // EMA lines (v5 API)
    for (const [name, color] of Object.entries(EMA_COLORS)) {
        emaLines[name] = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            title: name.toUpperCase(),
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
        });
    }

    // Auto-resize
    const ro = new ResizeObserver(() => {
        chart.applyOptions({
            width: container.clientWidth,
            height: container.clientHeight
        });
    });
    ro.observe(container);

    return chart;
}

/**
 * Set candlestick data
 */
export function setChartData(candles) {
    if (!candleSeries || !candles || candles.length === 0) return;

    // Deduplicate and sort by time
    const seen = new Set();
    const unique = candles.filter(c => {
        if (seen.has(c.time)) return false;
        seen.add(c.time);
        return true;
    }).sort((a, b) => a.time - b.time);

    candleSeries.setData(unique);

    // Volume
    const volData = unique.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 68, 68, 0.2)'
    }));
    volumeSeries.setData(volData);

    chart.timeScale().fitContent();
}

/**
 * Update the last candle or add a new one
 */
export function updateCandle(candle) {
    if (!candleSeries) return;
    candleSeries.update(candle);
    volumeSeries.update({
        time: candle.time,
        value: candle.volume || 0,
        color: candle.close >= candle.open ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 68, 68, 0.2)'
    });
}

/**
 * Draw EMA overlays on chart
 */
export function drawEMAs(candles, emaArrays) {
    if (!candles || !emaArrays) return;

    for (const [name, arr] of Object.entries(emaArrays)) {
        if (!arr || !emaLines[name]) continue;
        const offset = candles.length - arr.length;

        const seen = new Set();
        const data = arr.map((val, i) => {
            const time = candles[i + offset]?.time;
            if (!time || seen.has(time)) return null;
            seen.add(time);
            return { time, value: parseFloat(val.toFixed(2)) };
        }).filter(Boolean).sort((a, b) => a.time - b.time);

        if (data.length > 0) {
            emaLines[name].setData(data);
        }
    }
}

// Prediction Lines State
let tpLine = null;
let slLine = null;
let entryLine = null;

/**
 * Draw prediction zones (Entry, TP, SL) on chart
 */
export function setPredictionZones(signalData) {
    if (!candleSeries) return;

    // Remove existing lines
    if (tpLine) { candleSeries.removePriceLine(tpLine); tpLine = null; }
    if (slLine) { candleSeries.removePriceLine(slLine); slLine = null; }
    if (entryLine) { candleSeries.removePriceLine(entryLine); entryLine = null; }

    if (!signalData || signalData.signal === 'HOLD' || !signalData.takeProfit || !signalData.stopLoss || !signalData.entryPrice) {
        return;
    }

    tpLine = candleSeries.createPriceLine({
        price: signalData.takeProfit,
        color: '#00e676',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP',
    });

    slLine = candleSeries.createPriceLine({
        price: signalData.stopLoss,
        color: '#ff4444',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'SL',
    });

    entryLine = candleSeries.createPriceLine({
        price: signalData.entryPrice,
        color: '#ff9800', // Orange
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'ENTRY',
    });
}

/**
 * Get chart instance
 */
export function getChart() {
    return chart;
}
