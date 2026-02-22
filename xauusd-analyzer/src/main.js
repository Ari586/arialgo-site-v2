// ============================================
//  TRADING PRO ANALYZER — Main Bootstrap
//  Supports: XAU/USD, BTC/USD, ETH/USD
// ============================================
import { initChart, setChartData, updateCandle, drawEMAs, setPredictionZones } from './chart.js';
import { calculateAllIndicators } from './indicators.js';
import { generateCompositeScore, requestAISignal } from './signals.js';
import { fetchPrice, fetchHistory } from './api.js';

// State
let candles = [];
let currentSymbol = 'XAU/USD';
let currentTimeframe = '1min';
let lastPrice = null;
let dayHigh = 0;
let dayLow = Infinity;
let aiRequestPending = false;
let priceInterval = null;
let aiInterval = null;

// ============================================
//  INITIALIZATION
// ============================================
async function init() {
    console.log('⚡ Trading Pro Analyzer starting...');

    initChart('chartContainer');

    // Timeframe selector
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTimeframe = e.target.dataset.tf;
            loadHistory();
        });
    });

    // Instrument selector
    document.querySelectorAll('.inst-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget;
            document.querySelectorAll('.inst-btn').forEach(b => b.classList.remove('active'));
            target.classList.add('active');
            switchInstrument(target.dataset.symbol);
        });
    });

    // First load
    await loadHistory();

    // Start polling
    startPolling();

    // Start candle countdown timer
    startCountdown();

    // Initial news + AI
    setTimeout(refreshNews, 1000);
    setTimeout(refreshAI, 3000);
}

function startPolling() {
    if (priceInterval) clearInterval(priceInterval);
    if (aiInterval) clearInterval(aiInterval);
    if (newsInterval) clearInterval(newsInterval);
    priceInterval = setInterval(refreshPrice, 5000);
    aiInterval = setInterval(refreshAI, 30000);
    newsInterval = setInterval(refreshNews, 120000); // News every 2 min
}

async function switchInstrument(symbol) {
    currentSymbol = symbol;
    lastPrice = null;
    dayHigh = 0;
    dayLow = Infinity;
    candles = [];

    // Update UI labels
    document.getElementById('tickerLabel').textContent = symbol;
    document.getElementById('currentPrice').textContent = '—';
    document.getElementById('priceChange').textContent = '—';
    document.getElementById('signalText').textContent = 'ANALYZING';
    document.getElementById('signalText').className = 'signal-text';
    document.getElementById('signalIcon').textContent = '🔄';
    document.title = `${symbol} — Trading Pro Analyzer`;

    // Reset indicators
    document.querySelectorAll('.ind-value').forEach(el => el.textContent = '—');
    document.querySelectorAll('.ind-signal').forEach(el => { el.textContent = '—'; el.className = 'ind-signal'; });

    // Reload data
    await loadHistory();

    // Immediate AI refresh
    setTimeout(refreshAI, 1500);
}

// ============================================
//  LOAD HISTORY
// ============================================
async function loadHistory() {
    const data = await fetchHistory(currentSymbol, currentTimeframe, 200);
    if (!data || !data.data) return;

    candles = data.data;
    setChartData(candles);
    updateSource(data.source);
    processIndicators();
}

// ============================================
//  REFRESH PRICE
// ============================================
async function refreshPrice() {
    const data = await fetchPrice(currentSymbol);
    if (!data || !data.price) return;

    const price = data.price;
    updatePriceTicker(price, data);
    updateSource(data.source);

    // Update or add candle
    const now = Math.floor(Date.now() / 1000);
    if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        const intervalSec = getIntervalSeconds(currentTimeframe);

        if (now - lastCandle.time < intervalSec) {
            lastCandle.close = price;
            lastCandle.high = Math.max(lastCandle.high, price);
            lastCandle.low = Math.min(lastCandle.low, price);
            updateCandle(lastCandle);
        } else {
            const newCandle = {
                time: now,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: Math.floor(Math.random() * 500 + 100)
            };
            candles.push(newCandle);
            if (candles.length > 500) candles.shift();
            updateCandle(newCandle);
        }
    }

    processIndicators();
    document.getElementById('timestamp').textContent = new Date().toLocaleTimeString('fr-FR');
}

// ============================================
//  PROCESS ALL INDICATORS
// ============================================
function processIndicators() {
    if (candles.length < 30) return;

    const currentPrice = candles[candles.length - 1].close;
    const indicators = calculateAllIndicators(candles);
    const composite = generateCompositeScore(indicators, currentPrice);

    drawEMAs(candles, indicators.emaArrays);

    updateIndicatorsUI(indicators, currentPrice);
    updateCompositeGauge(composite);
    updateTrend(indicators.trend);
    updatePivots(indicators.pivotPoints, currentPrice);
    updatePatterns(indicators.patterns);
    updateMarketInfo(indicators, currentPrice);

    window.__lastIndicators = indicators;
    window.__lastComposite = composite;
}

// ============================================
//  UPDATE UI FUNCTIONS
// ============================================

function updatePriceTicker(price, data) {
    const el = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');

    // Format price based on instrument
    const formatted = currentSymbol === 'BTC/USD' ?
        `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` :
        `$${price.toFixed(2)}`;
    el.textContent = formatted;

    if (lastPrice !== null) {
        const diff = price - lastPrice;
        const pct = ((diff / lastPrice) * 100).toFixed(3);
        const sign = diff >= 0 ? '+' : '';

        el.className = `ticker-price ${diff >= 0 ? 'up' : 'down'}`;
        changeEl.textContent = `${sign}${diff.toFixed(2)} (${sign}${pct}%)`;
        changeEl.className = `ticker-change ${diff >= 0 ? 'up' : 'down'}`;

        const ticker = document.getElementById('priceTicker');
        ticker.classList.remove('flash-up', 'flash-down');
        void ticker.offsetWidth;
        ticker.classList.add(diff >= 0 ? 'flash-up' : 'flash-down');
    }

    if (price > dayHigh) dayHigh = price;
    if (price < dayLow) dayLow = price;
    document.getElementById('dayHigh').textContent = `$${dayHigh.toFixed(2)}`;
    document.getElementById('dayLow').textContent = `$${dayLow.toFixed(2)}`;

    if (data.bid) document.getElementById('bidPrice').textContent = `$${data.bid.toFixed(2)}`;
    if (data.ask) document.getElementById('askPrice').textContent = `$${data.ask.toFixed(2)}`;
    if (data.spread) document.getElementById('spreadVal').textContent = `$${data.spread.toFixed(2)}`;

    lastPrice = price;
}

function updateSource(source) {
    const el = document.getElementById('dataSource');
    el.className = `data-source ${source === 'simulated' ? 'simulated' : 'live'}`;
    el.querySelector('.source-text').textContent = source === 'simulated' ? '● Simulated' : '● LIVE';
}

function updateIndicatorsUI(ind, price) {
    // Helper to shorten large numbers for display
    const sn = (v) => v == null ? '—' : (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2));

    setIndicator('rsi', ind.rsi, ind.rsi,
        ind.rsi !== null ? (ind.rsi / 100 * 100) : 50,
        ind.rsi !== null ? (ind.rsi > 70 ? 'sell' : ind.rsi < 30 ? 'buy' : 'neutral') : 'neutral',
        ind.rsi !== null ? (ind.rsi > 70 ? 'SURACHETÉ' : ind.rsi < 30 ? 'SURVENDU' : 'NEUTRE') : '—');

    const macdDir = ind.macdLine !== null && ind.macdSignal !== null;
    setIndicator('macd', ind.macdLine !== null ? ind.macdLine.toFixed(3) : '—', null,
        macdDir ? (ind.macdLine > ind.macdSignal ? 70 : 30) : 50,
        macdDir ? (ind.macdLine > ind.macdSignal ? 'buy' : 'sell') : 'neutral',
        macdDir ? (ind.macdLine > ind.macdSignal ? 'HAUSSIER' : 'BAISSIER') : '—');

    const ema921 = ind.ema9 !== null && ind.ema21 !== null;
    setIndicator('ema', ema921 ? `${sn(ind.ema9)}/${sn(ind.ema21)}` : '—', null,
        ema921 ? (ind.ema9 > ind.ema21 ? 75 : 25) : 50,
        ema921 ? (ind.ema9 > ind.ema21 ? 'buy' : 'sell') : 'neutral',
        ema921 ? (ind.ema9 > ind.ema21 ? 'HAUSSIER' : 'BAISSIER') : '—');

    const ema50200 = ind.ema50 !== null && ind.ema200 !== null;
    setIndicator('ema50', ema50200 ? `${sn(ind.ema50)}/${sn(ind.ema200)}` : '—', null,
        ema50200 ? (ind.ema50 > ind.ema200 ? 80 : 20) : 50,
        ema50200 ? (ind.ema50 > ind.ema200 ? 'buy' : 'sell') : 'neutral',
        ema50200 ? (ind.ema50 > ind.ema200 ? 'GOLDEN ↑' : 'DEATH ↓') : '—');

    if (ind.bbUpper !== null) {
        const bbPos = ((price - ind.bbLower) / (ind.bbUpper - ind.bbLower) * 100).toFixed(0);
        setIndicator('bb', `${bbPos}%`, null,
            parseFloat(bbPos),
            bbPos > 80 ? 'sell' : bbPos < 20 ? 'buy' : 'neutral',
            bbPos > 80 ? 'HAUT ↓' : bbPos < 20 ? 'BAS ↑' : 'MILIEU');
    }

    setIndicator('atr', ind.atr !== null ? `$${ind.atr}` : '—', null,
        ind.atr !== null ? Math.min(ind.atr / 30 * 100, 100) : 50,
        'neutral', ind.atr !== null ? (ind.atr > 15 ? 'HAUTE VOL' : 'BASSE VOL') : '—');

    if (ind.stochastic) {
        setIndicator('stoch', `${ind.stochastic.k}/${ind.stochastic.d || '—'}`, null,
            ind.stochastic.k,
            ind.stochastic.k > 80 ? 'sell' : ind.stochastic.k < 20 ? 'buy' : 'neutral',
            ind.stochastic.k > 80 ? 'SURACHETÉ' : ind.stochastic.k < 20 ? 'SURVENDU' : 'NEUTRE');
    }

    if (ind.adx) {
        setIndicator('adx', ind.adx.adx.toFixed(1), null,
            Math.min(ind.adx.adx, 100),
            ind.adx.plusDI > ind.adx.minusDI ? 'buy' : 'sell',
            `${ind.adx.trendStrength === 'VERY_STRONG' ? 'TRÈS FORT' : ind.adx.trendStrength === 'STRONG' ? 'FORT' : ind.adx.trendStrength === 'DEVELOPING' ? 'EN DEV.' : 'FAIBLE'}`);
    }

    if (ind.williamsR !== null) {
        setIndicator('willr', ind.williamsR.toFixed(1), null,
            100 + ind.williamsR,
            ind.williamsR > -20 ? 'sell' : ind.williamsR < -80 ? 'buy' : 'neutral',
            ind.williamsR > -20 ? 'SURACHETÉ' : ind.williamsR < -80 ? 'SURVENDU' : 'NEUTRE');
    }

    if (ind.cci !== null) {
        setIndicator('cci', ind.cci.toFixed(1), null,
            Math.min(Math.max((ind.cci + 200) / 4, 0), 100),
            ind.cci > 100 ? 'buy' : ind.cci < -100 ? 'sell' : 'neutral',
            ind.cci > 100 ? 'HAUSSIER' : ind.cci < -100 ? 'BAISSIER' : 'NEUTRE');
    }

    if (ind.mfi !== null) {
        setIndicator('mfi', ind.mfi.toFixed(1), null,
            ind.mfi,
            ind.mfi > 80 ? 'sell' : ind.mfi < 20 ? 'buy' : 'neutral',
            ind.mfi > 80 ? 'SURACHETÉ' : ind.mfi < 20 ? 'SURVENDU' : 'NEUTRE');
    }

    if (ind.vwap !== null) {
        setIndicator('vwap', `$${ind.vwap}`, null,
            price > ind.vwap ? 70 : 30,
            price > ind.vwap ? 'buy' : 'sell',
            price > ind.vwap ? 'AU-DESSUS ↑' : 'EN-DESSOUS ↓');
        document.getElementById('vwapInfo').textContent = `$${ind.vwap}`;
    }
}

function setIndicator(name, value, rawValue, barPct, signalClass, signalText) {
    const valEl = document.getElementById(`${name}Value`);
    const fillEl = document.getElementById(`${name}Fill`);
    const sigEl = document.getElementById(`${name}Signal`);

    if (valEl) valEl.textContent = value;
    if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, barPct))}%`;
    if (sigEl) {
        sigEl.textContent = signalText;
        sigEl.className = `ind-signal ${signalClass}`;
    }
}

function updateCompositeGauge(composite) {
    const arc = document.getElementById('gaugeArc');
    const text = document.getElementById('gaugeText');
    const normalizedScore = (composite.score + 100) / 200;
    const dashOffset = 251.2 * (1 - normalizedScore);
    arc.setAttribute('stroke-dashoffset', dashOffset.toFixed(1));
    text.textContent = composite.score > 0 ? `+${composite.score}` : composite.score;

    if (composite.score > 20) text.setAttribute('fill', '#00e676');
    else if (composite.score < -20) text.setAttribute('fill', '#ff4444');
    else text.setAttribute('fill', '#FFD700');
}

function updateTrend(trend) {
    if (!trend) return;
    const dirEl = document.getElementById('trendDirection');
    const strEl = document.getElementById('trendStrength');
    const badge = document.getElementById('trendBadge');

    if (trend.direction === 'HAUSSIÈRE') {
        dirEl.textContent = '📈 HAUSSIÈRE';
        badge.className = 'trend-badge bullish';
    } else if (trend.direction === 'BAISSIÈRE') {
        dirEl.textContent = '📉 BAISSIÈRE';
        badge.className = 'trend-badge bearish';
    } else {
        dirEl.textContent = '⚖️ NEUTRE';
        badge.className = 'trend-badge neutral';
    }
    strEl.textContent = trend.strength;

    document.getElementById('bullishFill').style.width = `${trend.bullishPct}%`;
    document.getElementById('bearishFill').style.width = `${trend.bearishPct}%`;
    document.getElementById('bullishPct').textContent = `${trend.bullishPct}%`;
    document.getElementById('bearishPct').textContent = `${trend.bearishPct}%`;

    document.getElementById('trendReasons').innerHTML = trend.reasons
        .map(r => `<span class="reason-tag ${r.includes('↑') ? 'bullish' : r.includes('↓') ? 'bearish' : ''}">${r}</span>`)
        .join('');
}

function updatePivots(pivots, price) {
    if (!pivots) return;
    document.getElementById('pivotR3').textContent = `$${pivots.r3}`;
    document.getElementById('pivotR2').textContent = `$${pivots.r2}`;
    document.getElementById('pivotR1').textContent = `$${pivots.r1}`;
    document.getElementById('pivotP').textContent = `$${pivots.pivot}`;
    document.getElementById('pivotS1').textContent = `$${pivots.s1}`;
    document.getElementById('pivotS2').textContent = `$${pivots.s2}`;
    document.getElementById('pivotS3').textContent = `$${pivots.s3}`;
}

function updatePatterns(patterns) {
    const el = document.getElementById('patternsList');
    if (!patterns || patterns.length === 0) {
        el.innerHTML = '<span class="no-pattern">Aucun pattern détecté</span>';
        return;
    }
    el.innerHTML = patterns.map(p =>
        `<span class="pattern-tag ${p.type}">${p.emoji} ${p.name}</span>`
    ).join('');
}

function updateMarketInfo(ind, price) {
    // Already handled in updatePriceTicker
}

// ============================================
//  NEWS SENTIMENT
// ============================================
let newsInterval = null;

async function refreshNews() {
    try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(currentSymbol)}`);
        const data = await res.json();
        if (!data.success) return;

        displayNews(data.items, data.globalSentiment);
    } catch (e) {
        console.warn('News fetch error:', e.message);
    }
}

function displayNews(items, globalSentiment) {
    // Global sentiment badge
    const badge = document.getElementById('newsSentimentBadge');
    const icon = document.getElementById('newsSentimentIcon');
    const text = document.getElementById('newsSentimentText');

    if (globalSentiment) {
        const cls = globalSentiment.sentiment.toLowerCase();
        badge.className = `news-sentiment-badge ${cls === 'bullish' ? 'bullish' : cls === 'bearish' ? 'bearish' : 'neutral'}`;
        icon.textContent = cls === 'bullish' ? '📈' : cls === 'bearish' ? '📉' : '⚖️';
        text.textContent = `${globalSentiment.sentiment} (${globalSentiment.score > 0 ? '+' : ''}${globalSentiment.score})`;

        // Meters
        const total = Math.max(globalSentiment.total, 1);
        document.getElementById('newsBullFill').style.width = `${(globalSentiment.bullishCount / total) * 100}%`;
        document.getElementById('newsBearFill').style.width = `${(globalSentiment.bearishCount / total) * 100}%`;
        document.getElementById('newsBullCount').textContent = globalSentiment.bullishCount;
        document.getElementById('newsBearCount').textContent = globalSentiment.bearishCount;

        // Store for AI
        window.__newsSentiment = globalSentiment;
    }

    // News feed
    const feed = document.getElementById('newsFeed');
    if (!items || items.length === 0) {
        feed.innerHTML = '<div class="news-loading">Aucune actualité disponible</div>';
        return;
    }

    feed.innerHTML = items.map(item => {
        const sentCls = item.sentiment === 'BULLISH' ? 'bullish' : item.sentiment === 'BEARISH' ? 'bearish' : 'neutral';
        const sentTag = item.sentiment === 'BULLISH' ? 'sentiment-bull' : item.sentiment === 'BEARISH' ? 'sentiment-bear' : 'sentiment-neutral';
        const impactTag = item.impact === 'HIGH' ? 'impact-high' : item.impact === 'MEDIUM' ? 'impact-medium' : '';
        const timeAgo = getTimeAgo(item.pubDate);

        return `<a class="news-item ${sentCls}" href="${item.link}" target="_blank" rel="noopener">
            <div class="news-title">${escapeHtml(item.title)}</div>
            <div class="news-meta">
                <span class="news-source">${escapeHtml(item.source)}</span>
                <div class="news-tags">
                    <span class="news-tag ${sentTag}">${item.sentiment}</span>
                    ${impactTag ? `<span class="news-tag ${impactTag}">⚡ ${item.impact}</span>` : ''}
                </div>
                <span class="news-time">${timeAgo}</span>
            </div>
        </a>`;
    }).join('');
}

function getTimeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}j`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
//  AI SIGNAL REFRESH
// ============================================
async function refreshAI() {
    if (aiRequestPending || candles.length < 30) return;
    aiRequestPending = true;

    const indicators = window.__lastIndicators;
    const composite = window.__lastComposite;
    if (!indicators || !composite) { aiRequestPending = false; return; }

    const currentPrice = candles[candles.length - 1].close;

    document.getElementById('signalIcon').textContent = '🔄';
    document.getElementById('signalText').textContent = 'ANALYZING...';
    document.getElementById('signalText').className = 'signal-text';

    const aiResult = await requestAISignal(indicators, candles, currentPrice, composite.score, currentSymbol);

    if (aiResult) {
        displaySignal(aiResult);
    } else {
        displaySignal({
            signal: composite.signal,
            confidence: composite.confidence,
            reasoning: `Score composite: ${composite.score}. Analyse basée sur ${Object.keys(composite.details).length} indicateurs pour ${currentSymbol}.`,
            source: 'composite'
        });
    }

    aiRequestPending = false;
}

function displaySignal(result) {
    const card = document.getElementById('signalCard');
    const icon = document.getElementById('signalIcon');
    const text = document.getElementById('signalText');
    const confFill = document.getElementById('confidenceFill');
    const confValue = document.getElementById('confidenceValue');
    const reasoning = document.getElementById('signalReasoning');
    const badge = document.getElementById('aiBadge');

    card.className = `card signal-card ${result.signal.toLowerCase()}`;

    if (result.signal === 'BUY') {
        icon.textContent = '🚀';
        text.textContent = 'ACHETER';
        text.className = 'signal-text buy';
    } else if (result.signal === 'SELL') {
        icon.textContent = '🔻';
        text.textContent = 'VENDRE';
        text.className = 'signal-text sell';
    } else {
        icon.textContent = '⏸️';
        text.textContent = 'ATTENDRE';
        text.className = 'signal-text hold';
    }

    confFill.style.width = `${result.confidence}%`;
    confValue.textContent = `${Math.round(result.confidence)}%`;
    reasoning.textContent = result.reasoning;
    badge.textContent = result.source === 'gemini' ? '🧠 Gemini AI' : result.source === 'ollama' ? '🤖 Ollama' : result.source === 'composite' ? '📊 Composite' : '⚡ Algo';

    // Update Trade Levels
    const tradeLevels = document.getElementById('tradeLevels');
    if (result.entryPrice && result.takeProfit && result.stopLoss && result.signal !== 'HOLD') {
        document.getElementById('entryValue').textContent = result.entryPrice;
        document.getElementById('tpValue').textContent = result.takeProfit;
        document.getElementById('slValue').textContent = result.stopLoss;
        tradeLevels.style.display = 'grid';
    } else {
        tradeLevels.style.display = 'none';
    }

    // Audio / Visual Alert for STRONG signals (>80% confidence)
    if (result.confidence >= 80 && (result.signal === 'BUY' || result.signal === 'SELL')) {
        playAlertSound(result.signal);
        triggerVisualAlert(result.signal);
    }

    // Draw visual prediction zones on the TradingView Chart
    setPredictionZones(result);
}

// Simple Web Audio API beep
function playAlertSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.type = type === 'BUY' ? 'sine' : 'sawtooth';
        osc.frequency.setValueAtTime(type === 'BUY' ? 880 : 440, ctx.currentTime); // High pitch for BUY, low for SELL

        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
        console.warn("Audio alert failed", e);
    }
}

function triggerVisualAlert(type) {
    const className = type === 'BUY' ? 'flash-buy' : 'flash-sell';
    document.body.classList.remove('flash-buy', 'flash-sell');
    // Trigger reflow to restart animation
    void document.body.offsetWidth;
    document.body.classList.add(className);
    setTimeout(() => {
        document.body.classList.remove(className);
    }, 1500);
}

// ============================================
//  CANDLE COUNTDOWN TIMER
// ============================================
let countdownInterval = null;

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdown, 200); // Update 5x/sec for smoothness
}

function updateCountdown() {
    const timerEl = document.getElementById('countdownTimer');
    if (!timerEl) return;

    const intervalSec = getIntervalSeconds(currentTimeframe);
    const now = Math.floor(Date.now() / 1000);

    // Calculate time until next candle based on clean intervals
    const elapsed = now % intervalSec;
    let remaining = intervalSec - elapsed;

    // Format the countdown
    let display;
    if (intervalSec >= 3600) {
        // Hours + minutes + seconds
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const s = remaining % 60;
        display = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else if (intervalSec >= 60) {
        // Minutes + seconds
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        display = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
        display = `00:${String(remaining).padStart(2, '0')}`;
    }

    timerEl.textContent = display;

    // Urgent mode when < 10 seconds
    if (remaining <= 10) {
        timerEl.classList.add('urgent');
    } else {
        timerEl.classList.remove('urgent');
    }

    // Update label with timeframe info
    const labelEl = document.getElementById('countdownTimer').previousElementSibling;
    if (labelEl) {
        const tfName = { '1min': '1M', '5min': '5M', '15min': '15M', '1h': '1H', '4h': '4H' };
        labelEl.textContent = `🕐 ${tfName[currentTimeframe] || currentTimeframe}`;
    }
}

// ============================================
//  MULTI-TIMEFRAME PANEL
// ============================================
async function updateMultiTF() {
    try {
        const res = await fetch(`/api/multi-tf?symbol=${currentSymbol}`);
        const data = await res.json();
        if (!data.success) return;

        const tfs = data.timeframes;
        for (const [tf, info] of Object.entries(tfs)) {
            const row = document.getElementById(`mtf-${tf}`);
            if (!row) continue;
            const spans = row.querySelectorAll('span');
            spans[1].textContent = info.rsi != null ? info.rsi : '—';
            spans[2].textContent = info.trend;
            spans[2].className = info.trend === 'BULL' ? 'trend-bull' : info.trend === 'BEAR' ? 'trend-bear' : '';
            spans[3].textContent = info.signal;
            spans[3].className = info.signal === 'BUY' ? 'signal-buy' : info.signal === 'SELL' ? 'signal-sell' : '';
        }

        const c = data.confluence;
        const badge = document.getElementById('mtfConsensus');
        badge.textContent = `${c.signal} ${c.strength}%`;
        badge.style.color = c.signal === 'BUY' ? '#00e676' : c.signal === 'SELL' ? '#ff5252' : '#888';
    } catch (e) { /* silent */ }
}

// ============================================
//  ORDERBOOK PANEL
// ============================================
async function updateOrderbook() {
    try {
        const res = await fetch(`/api/orderbook?symbol=${currentSymbol}`);
        const data = await res.json();
        if (!data.success) return;

        // Pressure badge
        const badge = document.getElementById('obPressure');
        badge.textContent = `${data.pressure} (${(data.ratio * 100).toFixed(0)}%)`;
        badge.className = `ob-pressure ${data.pressure.toLowerCase()}`;

        // Asks (reversed - highest at top)
        const maxTotal = Math.max(...[...data.asks, ...data.bids].map(o => o.total));
        const asksEl = document.getElementById('obAsks');
        asksEl.innerHTML = data.asks.slice(0, 8).reverse().map(a =>
            `<div class="ob-row ask"><span>${a.price.toFixed(2)}</span><span>${a.qty.toFixed(4)}</span><span>$${(a.total / 1000).toFixed(1)}K</span><div class="ob-depth" style="width:${(a.total / maxTotal * 100).toFixed(0)}%"></div></div>`
        ).join('');

        // Spread
        const spread = data.asks.length && data.bids.length ? (data.asks[0].price - data.bids[0].price).toFixed(2) : '—';
        document.getElementById('obSpreadRow').textContent = `Spread: $${spread}`;

        // Bids
        const bidsEl = document.getElementById('obBids');
        bidsEl.innerHTML = data.bids.slice(0, 8).map(b =>
            `<div class="ob-row bid"><span>${b.price.toFixed(2)}</span><span>${b.qty.toFixed(4)}</span><span>$${(b.total / 1000).toFixed(1)}K</span><div class="ob-depth" style="width:${(b.total / maxTotal * 100).toFixed(0)}%"></div></div>`
        ).join('');
    } catch (e) { /* silent — orderbook only for crypto */ }
}

// ============================================
//  SIGNAL HISTORY PANEL
// ============================================
async function updateSignalHistory() {
    try {
        // Fetch accuracy stats
        const accRes = await fetch(`/api/signal-accuracy?symbol=${currentSymbol}`);
        const acc = await accRes.json();
        if (acc.success) {
            document.getElementById('winRateBadge').textContent = `${acc.winRate}%`;
            document.getElementById('statTotal').textContent = acc.total + acc.pending;
            document.getElementById('statWins').textContent = acc.wins;
            document.getElementById('statLosses').textContent = acc.losses;
        }

        // Fetch history
        const histRes = await fetch(`/api/signal-history?symbol=${currentSymbol}`);
        const hist = await histRes.json();
        if (hist.success && hist.signals.length > 0) {
            const list = document.getElementById('signalHistoryList');
            list.innerHTML = hist.signals.slice(-15).reverse().map(s => {
                const time = new Date(s.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                const sigClass = (s.signal || '').toLowerCase();
                return `<div class="history-item">
                    <span class="history-signal ${sigClass}">${s.signal}</span>
                    <span>$${s.price?.toFixed ? s.price.toFixed(0) : s.price}</span>
                    <span class="history-ai">${s.aiModel || '—'}</span>
                    <span class="history-time">${time}</span>
                </div>`;
            }).join('');
        }
    } catch (e) { /* silent */ }
}

// ============================================
//  UTILITIES
// ============================================
function getIntervalSeconds(tf) {
    switch (tf) {
        case '1min': return 60;
        case '5min': return 300;
        case '15min': return 900;
        case '1h': return 3600;
        case '4h': return 14400;
        default: return 60;
    }
}

// ============================================
//  START
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    init();
    // Start new panel updates
    updateMultiTF();
    updateOrderbook();
    updateSignalHistory();
    setInterval(updateMultiTF, 30000);      // every 30s
    setInterval(updateOrderbook, 5000);     // every 5s
    setInterval(updateSignalHistory, 30000); // every 30s
});
