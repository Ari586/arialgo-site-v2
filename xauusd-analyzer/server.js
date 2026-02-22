require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SITE_ACCESS_CODE = process.env.SITE_ACCESS_CODE || '';
const SITE_ACCESS_USER = process.env.SITE_ACCESS_USER || 'ari';
const ACCESS_REALM = 'Ari Trading Bot';
const ACCESS_LOG_FILE = path.join(__dirname, 'access_clicks.jsonl');

app.use(cors());
app.use(express.json());

function extractClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp) return cfIp.trim();

    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
    if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).split(',')[0].trim();

    const xrip = req.headers['x-real-ip'];
    if (typeof xrip === 'string' && xrip) return xrip.trim();

    return req.socket?.remoteAddress || req.ip || 'unknown';
}

function inferDeviceType(userAgent = '') {
    const ua = String(userAgent).toLowerCase();
    if (!ua || ua === 'unknown') return 'UNKNOWN';
    if (ua.includes('bot') || ua.includes('spider') || ua.includes('crawl')) return 'BOT';
    if (ua.includes('tablet') || ua.includes('ipad')) return 'TABLET';
    if (ua.includes('mobi') || ua.includes('android')) return 'MOBILE';
    return 'DESKTOP';
}

function inferBrowser(userAgent = '') {
    const ua = String(userAgent);
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
    return 'Unknown';
}

function inferOS(userAgent = '') {
    const ua = String(userAgent);
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown';
}

function appendAccessLog(entry) {
    try {
        fs.appendFileSync(ACCESS_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (e) {
        console.log('Access log write error:', e.message);
    }
}

function loadAccessLogEntries() {
    try {
        if (!fs.existsSync(ACCESS_LOG_FILE)) return [];
        const content = fs.readFileSync(ACCESS_LOG_FILE, 'utf8');
        if (!content.trim()) return [];
        return content
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                try { return JSON.parse(line); } catch { return null; }
            })
            .filter(Boolean);
    } catch (e) {
        console.log('Access log read error:', e.message);
        return [];
    }
}

function trackAccess(req, event, details = {}) {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = extractClientIp(req);
    const timestamp = new Date().toISOString();
    const fingerprint = `${ip}|${userAgent}`;
    const extraDetails = { ...details };
    delete extraDetails.source;
    delete extraDetails.path;
    delete extraDetails.authorized;

    appendAccessLog({
        timestamp,
        event,
        source: details.source || (req.path && req.path.startsWith('/api') ? 'api' : 'web'),
        path: details.path || req.originalUrl || req.url,
        method: req.method,
        ip,
        userAgent,
        deviceType: inferDeviceType(userAgent),
        browser: inferBrowser(userAgent),
        os: inferOS(userAgent),
        authorized: details.authorized !== undefined ? !!details.authorized : true,
        fingerprint,
        details: extraDetails,
    });
}

function toTimestampMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : 0;
}

function summarizeAccessDevices(entries = []) {
    const byFingerprint = new Map();

    for (const entry of entries) {
        const ip = entry.ip || 'unknown';
        const userAgent = entry.userAgent || 'unknown';
        const key = entry.fingerprint || `${ip}|${userAgent}`;
        const ts = toTimestampMs(entry.timestamp);

        if (!byFingerprint.has(key)) {
            byFingerprint.set(key, {
                fingerprint: key,
                ip,
                deviceType: entry.deviceType || 'UNKNOWN',
                browser: entry.browser || 'Unknown',
                os: entry.os || 'Unknown',
                userAgent,
                firstSeen: entry.timestamp || null,
                lastSeen: entry.timestamp || null,
                firstSeenMs: ts,
                lastSeenMs: ts,
                totalEvents: 0,
                successfulEvents: 0,
                deniedEvents: 0,
                lastEvent: entry.event || 'unknown',
                lastPath: entry.path || '/',
                events: {},
                sources: {},
            });
        }

        const agg = byFingerprint.get(key);
        agg.totalEvents += 1;
        if (entry.authorized === false) agg.deniedEvents += 1;
        else agg.successfulEvents += 1;

        const evt = entry.event || 'unknown';
        agg.events[evt] = (agg.events[evt] || 0) + 1;

        const src = entry.source || 'unknown';
        agg.sources[src] = (agg.sources[src] || 0) + 1;

        if (ts > 0 && (agg.firstSeenMs === 0 || ts < agg.firstSeenMs)) {
            agg.firstSeenMs = ts;
            agg.firstSeen = entry.timestamp || agg.firstSeen;
        }
        if (ts >= agg.lastSeenMs) {
            agg.lastSeenMs = ts;
            agg.lastSeen = entry.timestamp || agg.lastSeen;
            agg.lastEvent = evt;
            agg.lastPath = entry.path || agg.lastPath;
            agg.deviceType = entry.deviceType || agg.deviceType;
            agg.browser = entry.browser || agg.browser;
            agg.os = entry.os || agg.os;
            agg.userAgent = userAgent || agg.userAgent;
            agg.ip = ip || agg.ip;
        }
    }

    return Array.from(byFingerprint.values())
        .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
        .map(device => ({
            fingerprint: device.fingerprint,
            ip: device.ip,
            deviceType: device.deviceType,
            browser: device.browser,
            os: device.os,
            userAgent: device.userAgent,
            firstSeen: device.firstSeen,
            lastSeen: device.lastSeen,
            totalEvents: device.totalEvents,
            successfulEvents: device.successfulEvents,
            deniedEvents: device.deniedEvents,
            lastEvent: device.lastEvent,
            lastPath: device.lastPath,
            events: device.events,
            sources: device.sources,
        }));
}

function isBasicAuthAuthorized(authorizationHeader) {
    if (!SITE_ACCESS_CODE) return true;
    if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) return false;
    try {
        const encoded = authorizationHeader.slice(6).trim();
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const sepIndex = decoded.indexOf(':');
        if (sepIndex < 0) return false;
        const username = decoded.slice(0, sepIndex);
        const password = decoded.slice(sepIndex + 1);
        const userOk = SITE_ACCESS_USER === '*' || username === SITE_ACCESS_USER;
        return userOk && password === SITE_ACCESS_CODE;
    } catch {
        return false;
    }
}

function requireAccessCode(req, res, next) {
    if (!SITE_ACCESS_CODE) return next();
    if (req.method === 'OPTIONS') return next();

    if (isBasicAuthAuthorized(req.headers?.authorization)) {
        const acceptHeader = typeof req.headers?.accept === 'string' ? req.headers.accept : '';
        const isHtmlPageRequest = req.method === 'GET' && !req.path.startsWith('/api') && acceptHeader.includes('text/html');
        if (isHtmlPageRequest) {
            trackAccess(req, 'page_open', { authorized: true, source: 'web' });
        }
        return next();
    }

    trackAccess(req, 'auth_denied', { authorized: false });
    res.setHeader('WWW-Authenticate', `Basic realm="${ACCESS_REALM}", charset="UTF-8"`);
    return res.status(401).send('Access code required');
}

app.use(requireAccessCode);

// ============================================================
//  INSTRUMENT CONFIGURATION
// ============================================================
const INSTRUMENTS = {
    'XAU/USD': { name: 'Gold', icon: '🥇', basePrice: 5100, volatility: 0.0008, decimals: 2, yahoo: 'GC=F' },
    'BTC/USD': { name: 'Bitcoin', icon: '₿', basePrice: 96500, volatility: 0.002, decimals: 2, yahoo: 'BTC-USD' },
    'ETH/USD': { name: 'Ethereum', icon: 'Ξ', basePrice: 2750, volatility: 0.003, decimals: 2, yahoo: 'ETH-USD' }
};

const XAU_CLOSE_HOUR_UTC_FRIDAY = 22;
const XAU_OPEN_HOUR_UTC_SUNDAY = 22;

function isXauMarketClosed(now = new Date()) {
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    if (day === 6) return true; // Saturday
    if (day === 5 && hour >= XAU_CLOSE_HOUR_UTC_FRIDAY) return true; // Friday after close
    if (day === 0 && hour < XAU_OPEN_HOUR_UTC_SUNDAY) return true; // Sunday before open
    return false;
}

function isMarketClosed(symbol, now = new Date()) {
    if (symbol === 'XAU/USD') return isXauMarketClosed(now);
    return false;
}

function getMarketClosedReason(symbol) {
    if (symbol === 'XAU/USD') {
        return 'XAU/USD market closed (Friday 22:00 UTC to Sunday 22:00 UTC). Use BTC/USD or ETH/USD.';
    }
    return `${symbol} market temporarily closed.`;
}

// Per-instrument state
const instrumentState = {};
const newsCache = {};

function getNewsCacheEntry(symbol = 'GLOBAL') {
    if (!newsCache[symbol]) {
        newsCache[symbol] = { items: [], timestamp: 0, globalSentiment: null };
    }
    return newsCache[symbol];
}

for (const [symbol, config] of Object.entries(INSTRUMENTS)) {
    instrumentState[symbol] = {
        lastKnownPrice: config.basePrice,
        simulatedHistory: [],
        dayHigh: 0,
        dayLow: Infinity
    };
}

// ============================================================
//  DATA SOURCES
// ============================================================

// TwelveData cache per instrument+interval
const twelveDataCache = {};
const TWELVE_CACHE_MS = 15000;

async function fetchTwelveData(symbol, interval = '1min', outputsize = 100) {
    const cacheKey = `${symbol}_${interval}`;
    const now = Date.now();
    if (twelveDataCache[cacheKey] && (now - twelveDataCache[cacheKey].timestamp) < TWELVE_CACHE_MS) {
        return twelveDataCache[cacheKey].data;
    }

    const fetch = (await import('node-fetch')).default;
    const apiKey = process.env.TWELVEDATA_API_KEY || 'demo';
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
    try {
        const res = await fetch(url, { timeout: 8000 });
        const data = await res.json();
        if (data.values && data.values.length > 0) {
            const result = data.values.map(v => ({
                time: Math.floor(new Date(v.datetime).getTime() / 1000),
                open: parseFloat(v.open),
                high: parseFloat(v.high),
                low: parseFloat(v.low),
                close: parseFloat(v.close),
                volume: parseFloat(v.volume || Math.floor(Math.random() * 500 + 100))
            })).reverse();
            twelveDataCache[cacheKey] = { data: result, timestamp: now };
            return result;
        }
    } catch (e) {
        console.log(`TwelveData ${symbol} failed:`, e.message);
    }
    return null;
}

// Swissquote for forex (XAU/USD)
async function fetchSwissquoteTick(symbol) {
    if (symbol !== 'XAU/USD') return null;
    const fetch = (await import('node-fetch')).default;
    try {
        const url = 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD';
        const res = await fetch(url, { timeout: 5000 });
        const data = await res.json();
        if (data && data.length > 0) {
            const q = data[0];
            const bid = q.spreadProfilePrices?.[0]?.bid || 0;
            const ask = q.spreadProfilePrices?.[0]?.ask || 0;
            const price = (bid + ask) / 2;
            if (price > 500) {
                return { price, bid, ask, spread: parseFloat((ask - bid).toFixed(2)), timestamp: q.ts };
            }
        }
    } catch (e) {
        console.log('Swissquote failed:', e.message);
    }
    return null;
}

// Yahoo Finance for candle history (free, no key required)
const yahooCache = {};
const YAHOO_CACHE_MS = 30000;

async function fetchYahooFinanceHistory(symbol, interval = '1min', outputsize = 200) {
    const config = INSTRUMENTS[symbol];
    if (!config || !config.yahoo) return null;

    const cacheKey = `yahoo_${symbol}_${interval}`;
    const now = Date.now();
    if (yahooCache[cacheKey] && (now - yahooCache[cacheKey].timestamp) < YAHOO_CACHE_MS) {
        return yahooCache[cacheKey].data;
    }

    const fetch = (await import('node-fetch')).default;

    // Map interval to Yahoo Finance format
    const intervalMap = { '1min': '1m', '5min': '5m', '15min': '15m', '1h': '1h', '4h': '1h' };
    const yahooInterval = intervalMap[interval] || '1m';

    // Map range based on interval
    const rangeMap = { '1m': '1d', '5m': '5d', '15m': '5d', '1h': '1mo' };
    const range = rangeMap[yahooInterval] || '1d';

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${config.yahoo}?interval=${yahooInterval}&range=${range}`;
        const res = await fetch(url, {
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
        });
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result || !result.timestamp) return null;

        const timestamps = result.timestamp;
        const quotes = result.indicators?.quote?.[0];
        if (!quotes) return null;

        const candles = [];
        for (let i = 0; i < timestamps.length; i++) {
            const o = quotes.open?.[i];
            const h = quotes.high?.[i];
            const l = quotes.low?.[i];
            const c = quotes.close?.[i];
            const v = quotes.volume?.[i];
            if (o != null && h != null && l != null && c != null) {
                candles.push({
                    time: timestamps[i],
                    open: parseFloat(o.toFixed(config.decimals)),
                    high: parseFloat(h.toFixed(config.decimals)),
                    low: parseFloat(l.toFixed(config.decimals)),
                    close: parseFloat(c.toFixed(config.decimals)),
                    volume: v || 0
                });
            }
        }

        if (candles.length > 0) {
            yahooCache[cacheKey] = { data: candles, timestamp: now };
            console.log(`✅ Yahoo Finance: ${candles.length} live candles for ${symbol}`);
            return candles;
        }
    } catch (e) {
        console.log(`Yahoo Finance ${symbol} failed:`, e.message);
    }
    return null;
}

// CoinGecko for crypto (BTC, ETH) — free, no key
async function fetchCryptoTick(symbol) {
    const fetch = (await import('node-fetch')).default;
    const coinMap = { 'BTC/USD': 'bitcoin', 'ETH/USD': 'ethereum' };
    const coinId = coinMap[symbol];
    if (!coinId) return null;

    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
        const res = await fetch(url, { timeout: 5000 });
        const data = await res.json();
        if (data[coinId]) {
            const price = data[coinId].usd;
            return {
                price,
                bid: price * 0.9999,
                ask: price * 1.0001,
                spread: parseFloat((price * 0.0002).toFixed(2)),
                change24h: data[coinId].usd_24h_change,
                timestamp: Date.now()
            };
        }
    } catch (e) {
        console.log(`CoinGecko ${symbol} failed:`, e.message);
    }
    return null;
}

// ============================================================
//  BINANCE API — Best for crypto (free, no key, 1200 req/min)
// ============================================================
const binanceSymbols = { 'BTC/USD': 'BTCUSDT', 'ETH/USD': 'ETHUSDT' };

async function fetchBinanceTick(symbol) {
    const binanceSymbol = binanceSymbols[symbol];
    if (!binanceSymbol) return null;
    const fetch = (await import('node-fetch')).default;

    try {
        const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`;
        const res = await fetch(url, { timeout: 5000 });
        const data = await res.json();
        if (data && data.lastPrice) {
            const price = parseFloat(data.lastPrice);
            const bid = parseFloat(data.bidPrice);
            const ask = parseFloat(data.askPrice);
            console.log(`✅ Binance tick ${symbol}: $${price}`);
            return {
                price,
                bid,
                ask,
                spread: parseFloat((ask - bid).toFixed(2)),
                change24h: parseFloat(data.priceChangePercent),
                volume24h: parseFloat(data.volume),
                timestamp: Date.now()
            };
        }
    } catch (e) {
        console.log(`Binance tick ${symbol} failed:`, e.message);
    }
    return null;
}

const binanceCandleCache = {};
const BINANCE_CACHE_MS = 15000;

async function fetchBinanceHistory(symbol, interval = '1min', outputsize = 200) {
    const binanceSymbol = binanceSymbols[symbol];
    if (!binanceSymbol) return null;

    const cacheKey = `binance_${symbol}_${interval}`;
    const now = Date.now();
    if (binanceCandleCache[cacheKey] && (now - binanceCandleCache[cacheKey].timestamp) < BINANCE_CACHE_MS) {
        return binanceCandleCache[cacheKey].data;
    }

    const fetch = (await import('node-fetch')).default;
    const intervalMap = {
        '1s': '1s', '5s': '1s', '15s': '1s', '30s': '1s',
        '1min': '1m', '5min': '5m', '15min': '15m', '1h': '1h', '4h': '4h'
    };

    // For aggregate timeframes (5s, 15s, 30s), we fetch 1s and aggregate
    const binanceInterval = intervalMap[interval] || '1m';

    // If aggregating, we need more base candles. e.g. for 200 15s candles, we need 200 * 15 = 3000 1s candles. Binance limit is 1000 per request.
    // To keep it simple and within the 1000 limit, we cap the outputsize for sub-minute.
    const multiplier = interval === '5s' ? 5 : interval === '15s' ? 15 : interval === '30s' ? 30 : 1;
    const fetchLimit = Math.min(outputsize * multiplier, 1000);

    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${fetchLimit}`;
        const res = await fetch(url, { timeout: 8000 });
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
            let candles = data.map(k => ({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(parseFloat(k[1]).toFixed(2)),
                high: parseFloat(parseFloat(k[2]).toFixed(2)),
                low: parseFloat(parseFloat(k[3]).toFixed(2)),
                close: parseFloat(parseFloat(k[4]).toFixed(2)),
                volume: parseFloat(k[5])
            }));

            // Perform Aggregation if needed
            if (multiplier > 1) {
                const aggr = [];
                let current = null;

                for (const c of candles) {
                    const bucket = Math.floor(c.time / multiplier) * multiplier;

                    if (!current || current.time !== bucket) {
                        if (current) aggr.push(current);
                        current = { ...c, time: bucket };
                    } else {
                        current.high = Math.max(current.high, c.high);
                        current.low = Math.min(current.low, c.low);
                        current.close = c.close;
                        current.volume += c.volume;
                    }
                }
                if (current) aggr.push(current);

                // Keep only the requested outputsize
                candles = aggr.slice(-outputsize);
            }

            binanceCandleCache[cacheKey] = { data: candles, timestamp: now };
            console.log(`✅ Binance: ${candles.length} candles for ${symbol} (${interval})`);
            return candles;
        }
    } catch (e) {
        console.log(`Binance history ${symbol} failed:`, e.message);
    }
    return null;
}

// ============================================================
//  KRAKEN API — Good for XAU/USD + crypto (free, no key)
// ============================================================
const krakenSymbols = { 'XAU/USD': 'XAUXUSD', 'BTC/USD': 'XXBTZUSD', 'ETH/USD': 'XETHZUSD' };

async function fetchKrakenTick(symbol) {
    const krakenPair = krakenSymbols[symbol];
    if (!krakenPair) return null;
    const fetch = (await import('node-fetch')).default;

    try {
        const url = `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`;
        const res = await fetch(url, { timeout: 5000 });
        const data = await res.json();
        if (data.result) {
            const key = Object.keys(data.result)[0];
            const tick = data.result[key];
            const bid = parseFloat(tick.b[0]);
            const ask = parseFloat(tick.a[0]);
            const price = (bid + ask) / 2;
            console.log(`✅ Kraken tick ${symbol}: $${price.toFixed(2)}`);
            return {
                price,
                bid,
                ask,
                spread: parseFloat((ask - bid).toFixed(2)),
                volume24h: parseFloat(tick.v[1]),
                timestamp: Date.now()
            };
        }
    } catch (e) {
        console.log(`Kraken tick ${symbol} failed:`, e.message);
    }
    return null;
}

const krakenCandleCache = {};
const KRAKEN_CACHE_MS = 15000;

async function fetchKrakenHistory(symbol, interval = '1min', outputsize = 200) {
    const krakenPair = krakenSymbols[symbol];
    if (!krakenPair) return null;

    const cacheKey = `kraken_${symbol}_${interval}`;
    const now = Date.now();
    if (krakenCandleCache[cacheKey] && (now - krakenCandleCache[cacheKey].timestamp) < KRAKEN_CACHE_MS) {
        return krakenCandleCache[cacheKey].data;
    }

    const fetch = (await import('node-fetch')).default;
    const intervalMap = { '1min': 1, '5min': 5, '15min': 15, '1h': 60, '4h': 240 };
    const krakenInterval = intervalMap[interval] || 1;

    try {
        const url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=${krakenInterval}`;
        const res = await fetch(url, { timeout: 8000 });
        const data = await res.json();

        if (data.result) {
            const key = Object.keys(data.result).find(k => k !== 'last');
            const ohlc = data.result[key];
            if (ohlc && ohlc.length > 0) {
                const config = INSTRUMENTS[symbol] || { decimals: 2 };
                const candles = ohlc.slice(-outputsize).map(k => ({
                    time: parseInt(k[0]),
                    open: parseFloat(parseFloat(k[1]).toFixed(config.decimals)),
                    high: parseFloat(parseFloat(k[2]).toFixed(config.decimals)),
                    low: parseFloat(parseFloat(k[3]).toFixed(config.decimals)),
                    close: parseFloat(parseFloat(k[4]).toFixed(config.decimals)),
                    volume: parseFloat(k[6])
                }));
                krakenCandleCache[cacheKey] = { data: candles, timestamp: now };
                console.log(`✅ Kraken: ${candles.length} candles for ${symbol}`);
                return candles;
            }
        }
    } catch (e) {
        console.log(`Kraken history ${symbol} failed:`, e.message);
    }
    return null;
}

// ============================================================
//  SIMULATED DATA
// ============================================================
function generateSimulatedCandle(symbol, basePrice, index) {
    const config = INSTRUMENTS[symbol] || INSTRUMENTS['XAU/USD'];
    const volatility = config.volatility;
    const trend = Math.sin(index * 0.05) * (volatility * 1.2);
    const noise = (Math.random() - 0.5) * 2 * volatility;
    const change = trend + noise;
    const open = basePrice;
    const close = parseFloat((open * (1 + change)).toFixed(config.decimals));
    const high = parseFloat((Math.max(open, close) * (1 + Math.random() * volatility * 0.5)).toFixed(config.decimals));
    const low = parseFloat((Math.min(open, close) * (1 - Math.random() * volatility * 0.5)).toFixed(config.decimals));
    const volume = Math.floor(Math.random() * 1000 + 500);
    return { open: parseFloat(open.toFixed(config.decimals)), high, low, close, volume };
}

function initSimulatedHistory(symbol, count = 200) {
    const state = instrumentState[symbol];
    const config = INSTRUMENTS[symbol];
    state.simulatedHistory = [];
    let price = state.lastKnownPrice * (1 - 0.005);
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < count; i++) {
        const candle = generateSimulatedCandle(symbol, price, i);
        candle.time = now - (count - i) * 60;
        state.simulatedHistory.push(candle);
        price = candle.close;
    }
    state.lastKnownPrice = price;
    return state.simulatedHistory;
}

function addSimulatedCandle(symbol) {
    const state = instrumentState[symbol];
    const now = Math.floor(Date.now() / 1000);
    const candle = generateSimulatedCandle(symbol, state.lastKnownPrice, state.simulatedHistory.length);
    candle.time = now;
    state.lastKnownPrice = candle.close;
    state.simulatedHistory.push(candle);
    if (state.simulatedHistory.length > 500) state.simulatedHistory.shift();
    return candle;
}

// ============================================================
//  ROUTES
// ============================================================

// Get live price for any instrument
app.get('/api/price', async (req, res) => {
    const symbol = req.query.symbol || 'XAU/USD';
    const state = instrumentState[symbol];
    if (!state) return res.json({ success: false, error: 'Unknown symbol' });

    if (isMarketClosed(symbol)) {
        const price = state.lastKnownPrice || INSTRUMENTS[symbol]?.basePrice || 0;
        return res.json({
            success: true,
            source: 'market-closed',
            symbol,
            marketStatus: 'closed',
            reason: getMarketClosedReason(symbol),
            price,
            bid: parseFloat((price * 0.9999).toFixed(3)),
            ask: parseFloat((price * 1.0001).toFixed(3)),
            spread: parseFloat((price * 0.0002).toFixed(2)),
            timestamp: Date.now()
        });
    }

    // Multi-source price chain (ordered by reliability)
    const sources = [];

    if (symbol === 'BTC/USD' || symbol === 'ETH/USD') {
        // Crypto: Binance → Kraken → CoinGecko → Yahoo
        sources.push(() => fetchBinanceTick(symbol));
        sources.push(() => fetchKrakenTick(symbol));
        sources.push(() => fetchCryptoTick(symbol));
    } else {
        // XAU/USD: Kraken → Swissquote → Yahoo
        sources.push(() => fetchKrakenTick(symbol));
        sources.push(() => fetchSwissquoteTick(symbol));
    }

    // Try each source in order
    for (const fetchFn of sources) {
        try {
            const liveData = await fetchFn();
            if (liveData) {
                state.lastKnownPrice = liveData.price;
                return res.json({ success: true, source: 'live', symbol, ...liveData });
            }
        } catch (e) { /* try next */ }
    }

    // Fallback: Yahoo Finance price (universal)
    const config = INSTRUMENTS[symbol];
    if (config && config.yahoo) {
        try {
            const fetch = (await import('node-fetch')).default;
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${config.yahoo}?interval=1m&range=1d`;
            const yRes = await fetch(url, {
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
            });
            const yData = await yRes.json();
            const meta = yData?.chart?.result?.[0]?.meta;
            if (meta && meta.regularMarketPrice) {
                const price = meta.regularMarketPrice;
                state.lastKnownPrice = price;
                return res.json({
                    success: true, source: 'live', symbol, price,
                    bid: price * 0.9999, ask: price * 1.0001,
                    spread: parseFloat((price * 0.0002).toFixed(2)),
                    timestamp: Date.now()
                });
            }
        } catch (e) { /* fall through */ }
    }

    // Last resort: simulated
    const candle = addSimulatedCandle(symbol);
    res.json({
        success: true, source: 'simulated', symbol,
        price: candle.close, bid: candle.close * 0.9999, ask: candle.close * 1.0001,
        spread: parseFloat((candle.close * 0.0002).toFixed(2)), timestamp: Date.now()
    });
});

// Get candlestick history
app.get('/api/history', async (req, res) => {
    const symbol = req.query.symbol || 'XAU/USD';
    const interval = req.query.interval || '1min';
    const outputsize = parseInt(req.query.outputsize) || 200;
    const state = instrumentState[symbol];
    if (!state) return res.json({ success: false, error: 'Unknown symbol' });

    if (isMarketClosed(symbol)) {
        let closedData = await fetchYahooFinanceHistory(symbol, interval, outputsize);
        if (closedData && closedData.length > 0) {
            state.lastKnownPrice = closedData[closedData.length - 1].close;
        } else {
            if (state.simulatedHistory.length === 0) initSimulatedHistory(symbol, outputsize);
            closedData = state.simulatedHistory.slice(-outputsize);
        }
        return res.json({
            success: true,
            source: 'market-closed',
            symbol,
            marketStatus: 'closed',
            reason: getMarketClosedReason(symbol),
            data: closedData.slice(-outputsize)
        });
    }

    // Multi-source candle chain (ordered by reliability)
    const sources = [];

    if (symbol === 'BTC/USD' || symbol === 'ETH/USD') {
        // Crypto: Binance → Kraken → Yahoo → TwelveData
        sources.push({ name: 'binance', fn: () => fetchBinanceHistory(symbol, interval, outputsize) });
        sources.push({ name: 'kraken', fn: () => fetchKrakenHistory(symbol, interval, outputsize) });
    } else {
        // XAU/USD: Kraken → Yahoo → TwelveData
        sources.push({ name: 'kraken', fn: () => fetchKrakenHistory(symbol, interval, outputsize) });
    }
    sources.push({ name: 'yahoo', fn: () => fetchYahooFinanceHistory(symbol, interval, outputsize) });
    sources.push({ name: 'twelvedata', fn: () => fetchTwelveData(symbol, interval, outputsize) });

    for (const src of sources) {
        try {
            const data = await src.fn();
            if (data && data.length > 10) {
                state.lastKnownPrice = data[data.length - 1].close;
                return res.json({ success: true, source: src.name, symbol, data });
            }
        } catch (e) {
            console.log(`${src.name} history ${symbol} failed:`, e.message);
        }
    }

    // Fallback: simulated
    if (state.simulatedHistory.length === 0) initSimulatedHistory(symbol, outputsize);
    res.json({ success: true, source: 'simulated', symbol, data: state.simulatedHistory });
});

// Available instruments
app.get('/api/instruments', (req, res) => {
    const list = Object.entries(INSTRUMENTS).map(([symbol, config]) => ({
        symbol,
        name: config.name,
        icon: config.icon,
        price: instrumentState[symbol].lastKnownPrice
    }));
    res.json({ success: true, instruments: list });
});

// ============================================================
//  MULTI-AI ENGINE — Gemini, Groq, OpenRouter, Ollama
// ============================================================

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Signal history storage
const SIGNAL_HISTORY_FILE = path.join(__dirname, 'signal_history.json');

function loadSignalHistory() {
    try {
        if (fs.existsSync(SIGNAL_HISTORY_FILE)) return JSON.parse(fs.readFileSync(SIGNAL_HISTORY_FILE, 'utf-8'));
    } catch (e) { console.log('Signal history load error:', e.message); }
    return [];
}

function saveSignal(signal) {
    try {
        const history = loadSignalHistory();
        history.push(signal);
        fs.writeFileSync(SIGNAL_HISTORY_FILE, JSON.stringify(history.slice(-200), null, 2));
    } catch (e) { console.log('Signal save error:', e.message); }
}

function parseAIResponse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { }
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { } }
    return null;
}

// ------- Gemini 2.0 Flash -------
async function callGemini(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'COLLE_TA_CLE_ICI') return null;
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 500, responseMimeType: 'application/json' }
            }),
            timeout: 15000
        }
    );
    const data = await res.json();
    const parsed = parseAIResponse(data.candidates?.[0]?.content?.parts?.[0]?.text);
    if (parsed?.signal) { console.log(`🧠 Gemini: ${parsed.signal} (${parsed.confidence}%)`); return { ...parsed, source: 'gemini' }; }
    return null;
}

// ------- Groq (Llama 3.3 70B — free, ultra fast) -------
async function callGroq(prompt) {
    if (!GROQ_API_KEY) return null;
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: 'Tu es un expert en analyse technique de trading. Réponds UNIQUEMENT en JSON valide.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3, max_tokens: 500, response_format: { type: 'json_object' }
        }),
        timeout: 10000
    });
    const data = await res.json();
    const parsed = parseAIResponse(data.choices?.[0]?.message?.content);
    if (parsed?.signal) { console.log(`⚡ Groq: ${parsed.signal} (${parsed.confidence}%)`); return { ...parsed, source: 'groq' }; }
    return null;
}

// ------- OpenRouter (Mixtral 8x7B — free tier) -------
async function callOpenRouter(prompt) {
    if (!OPENROUTER_API_KEY) return null;
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'Trading Pro Analyzer'
        },
        body: JSON.stringify({
            model: 'mistralai/mixtral-8x7b-instruct',
            messages: [
                { role: 'system', content: 'Tu es un expert en analyse technique de trading. Réponds UNIQUEMENT en JSON valide.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3, max_tokens: 500
        }),
        timeout: 15000
    });
    const data = await res.json();
    const parsed = parseAIResponse(data.choices?.[0]?.message?.content);
    if (parsed?.signal) { console.log(`🌐 OpenRouter: ${parsed.signal} (${parsed.confidence}%)`); return { ...parsed, source: 'openrouter' }; }
    return null;
}

// ------- Ollama (local) -------
async function callOllama(prompt) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemma3:4b', prompt, stream: false, format: 'json' }),
        timeout: 30000
    });
    const data = await res.json();
    const parsed = parseAIResponse(data.response);
    if (parsed?.signal) { console.log(`🤖 Ollama: ${parsed.signal} (${parsed.confidence}%)`); return { ...parsed, source: 'ollama' }; }
    return null;
}

// ------- Unified AI Caller -------
async function callAI(prompt, requestedModel = 'auto') {
    const providers = [
        { name: 'Gemini', fn: () => callGemini(prompt), id: 'gemini' },
        { name: 'Groq', fn: () => callGroq(prompt), id: 'groq' },
        { name: 'OpenRouter', fn: () => callOpenRouter(prompt), id: 'openrouter' },
        { name: 'Ollama', fn: () => callOllama(prompt), id: 'ollama' },
        { name: 'Codex', fn: () => callGroq(prompt), id: 'codex' }, // Mapping Codex to Groq for speed/power
        { name: 'Copilot', fn: () => callGemini(prompt), id: 'copilot' }, // Mapping Copilot to Gemini
    ];

    // If a specific model is requested, try it first
    if (requestedModel && requestedModel !== 'auto') {
        const p = providers.find(x => x.id === requestedModel);
        if (p) {
            try {
                const r = await p.fn();
                if (r) return { ...r, source: requestedModel };
            } catch (e) {
                console.log(`Requested AI ${requestedModel} failed, falling back...`);
            }
        }
    }

    for (const p of providers) {
        try { const r = await p.fn(); if (r) return r; } catch (e) { console.log(`${p.name} failed:`, e.message); }
    }
    return null;
}

// Signal history endpoint
app.get('/api/signal-history', (req, res) => {
    const history = loadSignalHistory();
    const symbol = req.query.symbol;
    const filtered = symbol ? history.filter(s => s.symbol === symbol) : history;
    res.json({ success: true, signals: filtered.slice(-50) });
});

// Signal accuracy endpoint
app.get('/api/signal-accuracy', (req, res) => {
    const history = loadSignalHistory();
    const symbol = req.query.symbol;
    const filtered = symbol ? history.filter(s => s.symbol === symbol) : history;
    let total = 0, wins = 0, losses = 0;
    for (const sig of filtered) { if (sig.result) { total++; if (sig.result === 'win') wins++; else if (sig.result === 'loss') losses++; } }
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    res.json({ success: true, total, wins, losses, winRate: parseFloat(winRate), pending: filtered.length - total });
});

// AI Models info endpoint
app.get('/api/ai-models', (req, res) => {
    res.json({
        success: true, models: [
            { id: 'gemini', name: 'Gemini 2.0 Flash', provider: 'Google', active: !!(GEMINI_API_KEY && GEMINI_API_KEY !== 'COLLE_TA_CLE_ICI') },
            { id: 'groq', name: 'Llama 3.3 70B', provider: 'Groq', active: !!GROQ_API_KEY },
            { id: 'openrouter', name: 'Mixtral 8x7B', provider: 'OpenRouter', active: !!OPENROUTER_API_KEY },
            { id: 'ollama', name: 'Gemma 3 4B', provider: 'Ollama (local)', active: true }
        ]
    });
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function avgZonePrice(zone) {
    if (!zone) return null;
    return toNum((toNum(zone.low) + toNum(zone.high)) / 2, null);
}

function nearestZone(zones, type, currentPrice) {
    const list = (zones || []).filter(z => z.type === type);
    if (!list.length) return null;
    return list.sort((a, b) => Math.abs(toNum(avgZonePrice(a), currentPrice) - currentPrice) - Math.abs(toNum(avgZonePrice(b), currentPrice) - currentPrice))[0];
}

function buildStrictTradePlan(side, indicators, currentPrice, atr) {
    const fib = indicators?.fibonacci || {};
    const orderBlocks = indicators?.orderBlocks || [];
    const fvgList = indicators?.fvgs || [];
    const upSide = side === 'BUY';
    const nearOb = nearestZone(orderBlocks, upSide ? 'BULLISH' : 'BEARISH', currentPrice);
    const nearFvg = nearestZone(fvgList, upSide ? 'BULLISH' : 'BEARISH', currentPrice);

    const fib50 = toNum(fib?.levels?.['0.5'], null);
    const fib618 = toNum(fib?.levels?.['0.618'], null);
    const fibPocketMid = fib50 !== null && fib618 !== null ? (fib50 + fib618) / 2 : null;

    let entryPrice = currentPrice;
    if (nearOb) {
        entryPrice = upSide ? Math.min(currentPrice, toNum(nearOb.high, currentPrice)) : Math.max(currentPrice, toNum(nearOb.low, currentPrice));
    } else if (nearFvg) {
        entryPrice = toNum(avgZonePrice(nearFvg), currentPrice);
    } else if (fibPocketMid !== null) {
        entryPrice = toNum(fibPocketMid, currentPrice);
    }

    let stopLoss;
    if (upSide) {
        const structureStop = nearOb ? toNum(nearOb.low, currentPrice - atr * 1.5) - (atr * 0.25) : currentPrice - atr * 1.2;
        stopLoss = Math.min(entryPrice - atr * 0.8, structureStop);
    } else {
        const structureStop = nearOb ? toNum(nearOb.high, currentPrice + atr * 1.5) + (atr * 0.25) : currentPrice + atr * 1.2;
        stopLoss = Math.max(entryPrice + atr * 0.8, structureStop);
    }

    const risk = upSide ? Math.max(entryPrice - stopLoss, atr * 0.6) : Math.max(stopLoss - entryPrice, atr * 0.6);
    const takeProfit = upSide ? entryPrice + risk * 2.0 : entryPrice - risk * 2.0;

    return {
        entryPrice: parseFloat(entryPrice.toFixed(2)),
        stopLoss: parseFloat(stopLoss.toFixed(2)),
        takeProfit: parseFloat(takeProfit.toFixed(2))
    };
}

function evaluateStrictComboRules(indicators, currentPrice) {
    const combo = indicators?.proCombo;
    const blocks = combo?.blocks;
    const comboScore = toNum(combo?.score, toNum(indicators?.compositeScore, 0) + 50);
    const atr = Math.max(toNum(indicators?.atr, currentPrice * 0.005), currentPrice * 0.001);

    if (!blocks) {
        return {
            available: false,
            score: comboScore,
            signal: 'HOLD',
            summary: 'Strict combo unavailable (legacy payload).',
            buy: { pass: false, passCount: 0, confidence: 0, checks: [], plan: null },
            sell: { pass: false, passCount: 0, confidence: 0, checks: [], plan: null }
        };
    }

    const evaluateSide = (side) => {
        const opposite = side === 'BUY' ? 'SELL' : 'BUY';
        const trendScore = toNum(blocks?.trend?.score, 50);
        const momentumScore = toNum(blocks?.momentum?.score, 50);
        const volumeScore = toNum(blocks?.volume?.score, 50);
        const volatilityScore = toNum(blocks?.volatility?.score, 50);
        const structureScore = toNum(blocks?.structure?.score, 50);
        const confirmationScore = toNum(blocks?.confirmation?.score, 50);

        const trendOk = blocks?.trend?.signal === side && trendScore >= 58;
        const momentumOk = blocks?.momentum?.signal === side && momentumScore >= 55;
        const volumeOk = blocks?.volume?.signal === side && volumeScore >= 55;
        let volatilityOk = blocks?.volatility?.signal !== opposite && volatilityScore >= 45;
        const structureOk = blocks?.structure?.signal === side && structureScore >= 55;
        const confirmationOk = blocks?.confirmation?.signal === side && confirmationScore >= 55;

        if (indicators?.bbSqueeze?.isSqueezing) {
            if (side === 'BUY' && indicators.bbUpper) volatilityOk = volatilityOk && currentPrice >= (toNum(indicators.bbUpper) * 0.998);
            if (side === 'SELL' && indicators.bbLower) volatilityOk = volatilityOk && currentPrice <= (toNum(indicators.bbLower) * 1.002);
        }

        const checks = [
            { name: 'Trend', ok: trendOk },
            { name: 'Momentum', ok: momentumOk },
            { name: 'Volume', ok: volumeOk },
            { name: 'Volatility', ok: volatilityOk },
            { name: 'Structure', ok: structureOk },
            { name: 'Confirmation', ok: confirmationOk }
        ];

        const passCount = checks.filter(c => c.ok).length;
        const mandatoryPass = trendOk && confirmationOk;
        const pass = mandatoryPass && passCount >= 5;
        const confidence = clamp(Math.round((comboScore * 0.55) + (passCount * 7) + (pass ? 8 : -8)), 5, 98);
        const plan = pass ? buildStrictTradePlan(side, indicators, currentPrice, atr) : null;

        return { pass, passCount, confidence, checks, plan };
    };

    const buy = evaluateSide('BUY');
    const sell = evaluateSide('SELL');

    let signal = 'HOLD';
    if (buy.pass && !sell.pass) signal = 'BUY';
    else if (sell.pass && !buy.pass) signal = 'SELL';
    else if (buy.pass && sell.pass) signal = comboScore >= 50 ? 'BUY' : 'SELL';

    const summary = `Strict filter -> BUY ${buy.passCount}/6 | SELL ${sell.passCount}/6`;
    return { available: true, score: comboScore, signal, summary, buy, sell };
}

// Main AI signal endpoint
app.post('/api/ai-signal', async (req, res) => {
    const { indicators, candles, currentPrice, symbol: inputSymbol, aiModel } = req.body;
    const symbol = inputSymbol || 'XAU/USD';
    const config = INSTRUMENTS[symbol] || INSTRUMENTS['XAU/USD'];

    if (isMarketClosed(symbol)) {
        const closedResult = {
            success: true,
            source: 'market-closed',
            signal: 'HOLD',
            confidence: 100,
            reasoning: getMarketClosedReason(symbol),
            entryPrice: 0,
            takeProfit: 0,
            stopLoss: 0,
            marketStatus: 'closed'
        };
        saveSignal({
            timestamp: new Date().toISOString(),
            symbol,
            price: toNum(currentPrice, instrumentState[symbol]?.lastKnownPrice || config.basePrice),
            signal: 'HOLD',
            confidence: 100,
            entryPrice: 0,
            takeProfit: 0,
            stopLoss: 0,
            aiModel: 'market-closed',
            result: null
        });
        return res.json(closedResult);
    }

    const symbolNewsCache = getNewsCacheEntry(symbol || 'XAU/USD');
    const globalNewsCache = getNewsCacheEntry('GLOBAL');
    const contextNewsItems = symbolNewsCache.items.length > 0 ? symbolNewsCache.items : globalNewsCache.items;
    const contextGlobalSentiment = symbolNewsCache.globalSentiment || globalNewsCache.globalSentiment;

    const newsContext = contextNewsItems.length > 0
        ? `\n\nACTUALITÉS RÉCENTES:\n${contextNewsItems.slice(0, 5).map(n => `- [${n.sentiment}] ${n.title}`).join('\n')}\nSentiment global: ${contextGlobalSentiment?.sentiment || 'N/A'} (score: ${contextGlobalSentiment?.score || 0})`
        : '';

    const prompt = `Tu es un expert senior en trading de ${config.name} (${symbol}). Analyse ces données et donne un signal actionnable.

INSTRUMENT: ${symbol} — PRIX: $${currentPrice}

─── INDICATEURS ───
RSI(14): ${indicators.rsi} | MACD: ${indicators.macdLine}/${indicators.macdSignal} (hist: ${indicators.macdHistogram})
EMA: 9=${indicators.ema9}, 21=${indicators.ema21}, 50=${indicators.ema50}, 200=${indicators.ema200}
BB: U=${indicators.bbUpper}, M=${indicators.bbMiddle}, L=${indicators.bbLower} | ATR: ${indicators.atr}
Stoch: K=${indicators.stochastic?.k || 'N/A'}/D=${indicators.stochastic?.d || 'N/A'}
ADX: ${indicators.adx?.adx || 'N/A'} (+DI:${indicators.adx?.plusDI || 'N/A'} -DI:${indicators.adx?.minusDI || 'N/A'})
Williams%R: ${indicators.williamsR || 'N/A'} | CCI: ${indicators.cci || 'N/A'} | MFI: ${indicators.mfi || 'N/A'}
Score composite: ${indicators.compositeScore}
Ichimoku: Tenkan=${indicators.ichimoku?.tenkan || 'N/A'} Kijun=${indicators.ichimoku?.kijun || 'N/A'} Cloud=${indicators.ichimoku?.signal || 'N/A'}
Stoch RSI: K=${indicators.stochRsi?.k || 'N/A'} D=${indicators.stochRsi?.d || 'N/A'} Sig=${indicators.stochRsi?.signal || 'N/A'}
RSI Divergence: ${indicators.rsiDivergence?.signal || 'N/A'} (${indicators.rsiDivergence?.details || 'N/A'})
OBV=${indicators.obv?.value || 'N/A'} (${indicators.obv?.trend || 'N/A'}) | CVD=${indicators.cvd?.value || 'N/A'} (${indicators.cvd?.trend || 'N/A'})
Volume Profile: POC=${indicators.volumeProfile?.poc || 'N/A'} VAH=${indicators.volumeProfile?.vah || 'N/A'} VAL=${indicators.volumeProfile?.val || 'N/A'} Skew=${indicators.volumeProfile?.skew || 'N/A'}
BB Squeeze: ${indicators.bbSqueeze?.state || 'N/A'} intensity=${indicators.bbSqueeze?.intensity || 'N/A'}
Structure: OB=${(indicators.orderBlocks || []).length} FVG=${(indicators.fvgs || []).length} FibNearest=${indicators.fibonacci?.nearestLevel || 'N/A'} FibTrend=${indicators.fibonacci?.trend || 'N/A'}
MTF Confluence: ${indicators.mtfConfluence?.signal || 'N/A'} (${indicators.mtfConfluence?.strength || 'N/A'}%)
Combo Pro: ${indicators.proCombo?.signal || 'N/A'} score=${indicators.proCombo?.score || 'N/A'}

─── BOUGIES ───
${(candles || []).slice(-10).map(c => `O:${c.open} H:${c.high} L:${c.low} C:${c.close}`).join('\n')}
${newsContext}

RÉPONDS en JSON strict: {"signal":"BUY","confidence":75,"reasoning":"Explication 2-3 phrases","entryPrice":0,"takeProfit":0,"stopLoss":0}`;

    const strictRules = evaluateStrictComboRules(indicators, currentPrice);

    // Try all AI providers
    const aiResult = await callAI(prompt, aiModel);
    if (aiResult) {
        const aiSignal = ['BUY', 'SELL', 'HOLD'].includes(aiResult.signal) ? aiResult.signal : 'HOLD';

        if (strictRules.available && (aiSignal === 'BUY' || aiSignal === 'SELL')) {
            const sideEval = aiSignal === 'BUY' ? strictRules.buy : strictRules.sell;

            // Reject directional AI signal if strict confluence is not validated.
            if (!sideEval.pass) {
                const filteredResult = {
                    success: true,
                    source: 'strict-filter',
                    signal: 'HOLD',
                    confidence: clamp(Math.round(sideEval.confidence * 0.6), 20, 90),
                    reasoning: `Signal IA ${aiSignal} filtré: confluence stricte non validée (${sideEval.passCount}/6). ${strictRules.summary}.`,
                    entryPrice: 0,
                    takeProfit: 0,
                    stopLoss: 0,
                    strictRules: {
                        summary: strictRules.summary,
                        buy: strictRules.buy.passCount,
                        sell: strictRules.sell.passCount
                    }
                };
                saveSignal({
                    timestamp: new Date().toISOString(),
                    symbol,
                    price: currentPrice,
                    signal: filteredResult.signal,
                    confidence: filteredResult.confidence,
                    entryPrice: 0,
                    takeProfit: 0,
                    stopLoss: 0,
                    aiModel: `${aiResult.source || aiModel || 'ai'}-strict-filtered`,
                    result: null
                });
                return res.json(filteredResult);
            }

            const planned = sideEval.plan || {};
            const mergedResult = {
                success: true,
                source: aiResult.source || 'ai',
                signal: aiSignal,
                confidence: clamp(Math.round((toNum(aiResult.confidence, 60) * 0.6) + (sideEval.confidence * 0.4)), 1, 99),
                reasoning: `${aiResult.reasoning || 'Signal IA.'} | Confluence stricte validée (${sideEval.passCount}/6).`,
                entryPrice: toNum(aiResult.entryPrice, 0) > 0 ? parseFloat(toNum(aiResult.entryPrice).toFixed(2)) : toNum(planned.entryPrice, 0),
                takeProfit: toNum(aiResult.takeProfit, 0) > 0 ? parseFloat(toNum(aiResult.takeProfit).toFixed(2)) : toNum(planned.takeProfit, 0),
                stopLoss: toNum(aiResult.stopLoss, 0) > 0 ? parseFloat(toNum(aiResult.stopLoss).toFixed(2)) : toNum(planned.stopLoss, 0),
                strictRules: {
                    summary: strictRules.summary,
                    buy: strictRules.buy.passCount,
                    sell: strictRules.sell.passCount
                }
            };
            saveSignal({
                timestamp: new Date().toISOString(),
                symbol,
                price: currentPrice,
                signal: mergedResult.signal,
                confidence: mergedResult.confidence,
                entryPrice: mergedResult.entryPrice || 0,
                takeProfit: mergedResult.takeProfit || 0,
                stopLoss: mergedResult.stopLoss || 0,
                aiModel: aiResult.source || aiModel || 'ai',
                result: null
            });
            return res.json(mergedResult);
        }

        const genericAIResult = {
            success: true,
            source: aiResult.source || 'ai',
            signal: aiSignal,
            confidence: clamp(toNum(aiResult.confidence, 60), 1, 99),
            reasoning: strictRules.available
                ? `${aiResult.reasoning || 'Signal IA.'} | ${strictRules.summary}.`
                : (aiResult.reasoning || 'Signal IA.'),
            entryPrice: aiSignal === 'HOLD' ? 0 : parseFloat(toNum(aiResult.entryPrice, currentPrice).toFixed(2)),
            takeProfit: aiSignal === 'HOLD' ? 0 : parseFloat(toNum(aiResult.takeProfit, 0).toFixed(2)),
            stopLoss: aiSignal === 'HOLD' ? 0 : parseFloat(toNum(aiResult.stopLoss, 0).toFixed(2)),
            strictRules: strictRules.available ? { summary: strictRules.summary } : undefined
        };
        saveSignal({
            timestamp: new Date().toISOString(),
            symbol,
            price: currentPrice,
            signal: genericAIResult.signal,
            confidence: genericAIResult.confidence,
            entryPrice: genericAIResult.entryPrice || 0,
            takeProfit: genericAIResult.takeProfit || 0,
            stopLoss: genericAIResult.stopLoss || 0,
            aiModel: aiResult.source || aiModel || 'ai',
            result: null
        });
        return res.json(genericAIResult);
    }

    // Strict algorithmic fallback (preferred when combo is available)
    if (strictRules.available) {
        if (strictRules.signal === 'BUY' || strictRules.signal === 'SELL') {
            const sideEval = strictRules.signal === 'BUY' ? strictRules.buy : strictRules.sell;
            const plan = sideEval.plan || {};
            const strictAlgoResult = {
                success: true,
                source: 'strict-algorithmic',
                signal: strictRules.signal,
                confidence: clamp(sideEval.confidence, 35, 98),
                reasoning: `Confluence stricte validée (${sideEval.passCount}/6). ${strictRules.summary}.`,
                entryPrice: toNum(plan.entryPrice, currentPrice),
                takeProfit: toNum(plan.takeProfit, 0),
                stopLoss: toNum(plan.stopLoss, 0),
                strictRules: {
                    summary: strictRules.summary,
                    buy: strictRules.buy.passCount,
                    sell: strictRules.sell.passCount
                }
            };
            saveSignal({
                timestamp: new Date().toISOString(),
                symbol,
                price: currentPrice,
                signal: strictAlgoResult.signal,
                confidence: strictAlgoResult.confidence,
                entryPrice: strictAlgoResult.entryPrice || 0,
                takeProfit: strictAlgoResult.takeProfit || 0,
                stopLoss: strictAlgoResult.stopLoss || 0,
                aiModel: 'strict-algorithmic',
                result: null
            });
            return res.json(strictAlgoResult);
        }

        const strictHoldResult = {
            success: true,
            source: 'strict-algorithmic',
            signal: 'HOLD',
            confidence: clamp(Math.round(((strictRules.buy.passCount + strictRules.sell.passCount) * 5) + 20), 20, 70),
            reasoning: `Aucune confluence stricte suffisante. ${strictRules.summary}.`,
            entryPrice: 0,
            takeProfit: 0,
            stopLoss: 0,
            strictRules: {
                summary: strictRules.summary,
                buy: strictRules.buy.passCount,
                sell: strictRules.sell.passCount
            }
        };
        saveSignal({
            timestamp: new Date().toISOString(),
            symbol,
            price: currentPrice,
            signal: strictHoldResult.signal,
            confidence: strictHoldResult.confidence,
            entryPrice: 0,
            takeProfit: 0,
            stopLoss: 0,
            aiModel: 'strict-algorithmic',
            result: null
        });
        return res.json(strictHoldResult);
    }

    // Legacy algorithmic fallback (for old payloads without pro combo)
    const score = indicators.compositeScore || 0;
    const signal = score > 20 ? 'BUY' : score < -20 ? 'SELL' : 'HOLD';
    const atr = indicators.atr || (currentPrice * 0.005);
    let entryPrice = 0, takeProfit = 0, stopLoss = 0;
    if (signal === 'BUY') { entryPrice = currentPrice; takeProfit = currentPrice + (atr * 3); stopLoss = currentPrice - (atr * 1.5); }
    else if (signal === 'SELL') { entryPrice = currentPrice; takeProfit = currentPrice - (atr * 3); stopLoss = currentPrice + (atr * 1.5); }

    const algoResult = {
        success: true, source: 'algorithmic', signal,
        confidence: Math.min(Math.abs(score), 95),
        reasoning: `Signal algorithmique legacy (score: ${score}).`,
        entryPrice: parseFloat(entryPrice.toFixed(2)), takeProfit: parseFloat(takeProfit.toFixed(2)), stopLoss: parseFloat(stopLoss.toFixed(2))
    };
    saveSignal({ timestamp: new Date().toISOString(), symbol, price: currentPrice, ...algoResult, aiModel: 'algorithmic', result: null });
    res.json(algoResult);
});

// ============================================================
//  TELEGRAM ALERTS
// ============================================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendTelegramAlert(signal) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        const fetch = (await import('node-fetch')).default;
        const emoji = signal.signal === 'BUY' ? '🟢' : signal.signal === 'SELL' ? '🔴' : '⚪';
        const text = `${emoji} *SIGNAL: ${signal.signal} ${signal.symbol}*
💰 Entry: $${signal.entryPrice} | TP: $${signal.takeProfit} | SL: $${signal.stopLoss}
📊 Confiance: ${signal.confidence}% | IA: ${signal.aiModel}
📝 ${signal.reasoning || ''}`;

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }),
            timeout: 5000
        });
        console.log(`📱 Telegram alert sent: ${signal.signal} ${signal.symbol}`);
    } catch (e) {
        console.log('Telegram send error:', e.message);
    }
}

// Telegram config endpoint
app.post('/api/telegram-config', express.json(), (req, res) => {
    const { botToken, chatId } = req.body;
    if (botToken) process.env.TELEGRAM_BOT_TOKEN = botToken;
    if (chatId) process.env.TELEGRAM_CHAT_ID = chatId;
    res.json({ success: true, configured: !!(botToken && chatId) });
});

app.get('/api/telegram-status', (req, res) => {
    res.json({
        success: true,
        configured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        chatId: process.env.TELEGRAM_CHAT_ID ? `...${process.env.TELEGRAM_CHAT_ID.slice(-4)}` : null
    });
});

// Telegram test endpoint
app.post('/api/telegram-test', async (req, res) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
        return res.json({ success: false, error: 'Telegram not configured' });
    }
    await sendTelegramAlert({
        signal: 'TEST', symbol: 'XAU/USD', entryPrice: 5100, takeProfit: 5150, stopLoss: 5050,
        confidence: 99, aiModel: 'test', reasoning: '🧪 Test alert from Trading Pro Analyzer'
    });
    res.json({ success: true, message: 'Test alert sent!' });
});

// ============================================================
//  BINANCE ORDERBOOK
// ============================================================
app.get('/api/orderbook', async (req, res) => {
    const symbol = req.query.symbol || 'BTC/USD';
    const binanceSymbol = binanceSymbols[symbol];
    if (!binanceSymbol) return res.json({ success: false, error: 'Orderbook only available for crypto (BTC/USD, ETH/USD)' });

    try {
        const fetch = (await import('node-fetch')).default;
        const depth = await fetch(`https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=15`, { timeout: 5000 });
        const data = await depth.json();

        const bids = (data.bids || []).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty), total: parseFloat(price) * parseFloat(qty) }));
        const asks = (data.asks || []).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty), total: parseFloat(price) * parseFloat(qty) }));

        const bidVolume = bids.reduce((s, b) => s + b.total, 0);
        const askVolume = asks.reduce((s, a) => s + a.total, 0);
        const ratio = bidVolume / (bidVolume + askVolume);
        const pressure = ratio > 0.55 ? 'BUY' : ratio < 0.45 ? 'SELL' : 'NEUTRAL';

        res.json({ success: true, symbol, bids, asks, bidVolume: Math.round(bidVolume), askVolume: Math.round(askVolume), ratio: parseFloat(ratio.toFixed(3)), pressure });
    } catch (e) {
        console.log('Orderbook error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// ============================================================
//  MULTI-TIMEFRAME ANALYSIS
// ============================================================
app.get('/api/multi-tf', async (req, res) => {
    const symbol = req.query.symbol || 'XAU/USD';
    if (isMarketClosed(symbol)) {
        return res.json({
            success: true,
            symbol,
            marketStatus: 'closed',
            reason: getMarketClosedReason(symbol),
            timeframes: {},
            confluence: { signal: 'HOLD', strength: 0, buyCount: 0, sellCount: 0, totalTF: 0 }
        });
    }

    const timeframes = ['1min', '5min', '15min', '1h'];
    const results = {};

    for (const tf of timeframes) {
        try {
            // Try Binance for crypto, Kraken for gold, Yahoo as fallback
            let candles = null;
            if (binanceSymbols[symbol]) candles = await fetchBinanceHistory(symbol, tf, 50);
            if (!candles) candles = await fetchKrakenHistory(symbol, tf, 50);
            if (!candles) candles = await fetchYahooFinanceHistory(symbol, tf, 50);

            if (candles && candles.length >= 14) {
                // Calculate RSI for each timeframe
                const closes = candles.map(c => c.close);
                let gains = 0, losses = 0;
                for (let i = 1; i < Math.min(15, closes.length); i++) {
                    const diff = closes[i] - closes[i - 1];
                    if (diff > 0) gains += diff; else losses -= diff;
                }
                const avgGain = gains / 14;
                const avgLoss = losses / 14;
                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                const rsi = parseFloat((100 - (100 / (1 + rs))).toFixed(1));

                // Simple trend from EMA
                const lastPrice = closes[closes.length - 1];
                const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
                const trend = lastPrice > sma20 ? 'BULL' : 'BEAR';
                const signal = rsi > 70 ? 'SELL' : rsi < 30 ? 'BUY' : (trend === 'BULL' ? 'BUY' : 'SELL');

                results[tf] = { rsi, trend, signal, lastPrice: parseFloat(lastPrice.toFixed(2)), candles: candles.length };
            } else {
                results[tf] = { rsi: null, trend: 'N/A', signal: 'N/A', lastPrice: null, candles: 0 };
            }
        } catch (e) {
            results[tf] = { rsi: null, trend: 'N/A', signal: 'N/A', lastPrice: null, candles: 0, error: e.message };
        }
    }

    // Calculate confluence
    const signals = Object.values(results).filter(r => r.signal && r.signal !== 'N/A').map(r => r.signal);
    const buyCount = signals.filter(s => s === 'BUY').length;
    const sellCount = signals.filter(s => s === 'SELL').length;
    const confluence = signals.length > 0 ? Math.max(buyCount, sellCount) / signals.length : 0;
    const consensusSignal = buyCount > sellCount ? 'BUY' : sellCount > buyCount ? 'SELL' : 'HOLD';

    res.json({
        success: true, symbol, timeframes: results,
        confluence: { signal: consensusSignal, strength: parseFloat((confluence * 100).toFixed(0)), buyCount, sellCount, totalTF: signals.length }
    });
});

// ============================================================
//  NEWS SENTIMENT ANALYSIS ENGINE
// ============================================================

// Sentiment keywords
const BULLISH_KEYWORDS = [
    'rally', 'surge', 'soar', 'jump', 'gain', 'rise', 'climb', 'bull', 'bullish',
    'record high', 'all-time high', 'breakout', 'recovery', 'optimism', 'upbeat',
    'dovish', 'rate cut', 'stimulus', 'easing', 'demand', 'safe haven', 'inflation fears',
    'hausse', 'haussier', 'montée', 'rebond', 'croissance', 'achat',
    'growth', 'positive', 'strong', 'outperform', 'upgrade', 'buy signal',
    'gold demand', 'bitcoin adoption', 'institutional buying', 'etf inflow',
    'geopolitical tension', 'war', 'conflict', 'sanctions', 'uncertainty',
    'dollar weakness', 'fed pause', 'quantitative easing'
];

const BEARISH_KEYWORDS = [
    'crash', 'plunge', 'tumble', 'drop', 'fall', 'decline', 'bear', 'bearish',
    'sell-off', 'selloff', 'correction', 'collapse', 'downturn', 'pessimism',
    'hawkish', 'rate hike', 'tightening', 'tapering', 'recession',
    'baisse', 'baissier', 'chute', 'effondrement', 'vente',
    'negative', 'weak', 'underperform', 'downgrade', 'sell signal',
    'outflow', 'liquidation', 'ban', 'regulation crackdown',
    'dollar strength', 'fed hike', 'quantitative tightening',
    'profit taking', 'overbought', 'bubble'
];

const IMPACT_KEYWORDS = [
    'fed', 'federal reserve', 'ecb', 'bce', 'central bank', 'interest rate',
    'inflation', 'cpi', 'ppi', 'gdp', 'employment', 'unemployment', 'nfp',
    'non-farm', 'fomc', 'powell', 'lagarde', 'yellen',
    'war', 'conflict', 'sanctions', 'trade war', 'tariff',
    'opec', 'oil', 'energy crisis', 'supply chain',
    'etf', 'halving', 'mining', 'defi', 'regulation',
    'breaking', 'urgent', 'flash crash', 'black swan'
];

function analyzeSentiment(title, description = '') {
    const text = `${title} ${description}`.toLowerCase();
    let bullScore = 0, bearScore = 0, impact = 0;

    BULLISH_KEYWORDS.forEach(kw => {
        if (text.includes(kw)) bullScore += (kw.split(' ').length > 1 ? 2 : 1);
    });
    BEARISH_KEYWORDS.forEach(kw => {
        if (text.includes(kw)) bearScore += (kw.split(' ').length > 1 ? 2 : 1);
    });
    IMPACT_KEYWORDS.forEach(kw => {
        if (text.includes(kw)) impact += 1;
    });

    let sentiment, score;
    if (bullScore > bearScore) {
        sentiment = 'BULLISH';
        score = Math.min(bullScore * 15, 100);
    } else if (bearScore > bullScore) {
        sentiment = 'BEARISH';
        score = -Math.min(bearScore * 15, 100);
    } else {
        sentiment = 'NEUTRAL';
        score = 0;
    }

    const impactLevel = impact >= 3 ? 'HIGH' : impact >= 1 ? 'MEDIUM' : 'LOW';

    return { sentiment, score, impact: impactLevel, bullScore, bearScore };
}

// News cache
const NEWS_CACHE_MS = 120000; // 2 min cache

function decodeXmlValue(value = '') {
    return String(value)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
}

function extractXmlTag(block, tagName) {
    const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = String(block || '').match(re);
    return match ? decodeXmlValue(match[1]) : '';
}

function parseRSSFeedXml(xmlText, defaultSource = 'News') {
    const xml = String(xmlText || '');
    if (!xml) return [];

    const channelBlock = (xml.match(/<channel[\s\S]*?<\/channel>/i) || [xml])[0];
    const channelTitle = extractXmlTag(channelBlock, 'title') || defaultSource;

    let itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    let isAtom = false;
    if (itemBlocks.length === 0) {
        itemBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
        isAtom = itemBlocks.length > 0;
    }

    const nowIso = new Date().toISOString();
    return itemBlocks.map((block) => {
        const title = extractXmlTag(block, 'title');
        const description = extractXmlTag(block, 'description') || extractXmlTag(block, 'summary') || extractXmlTag(block, 'content');
        const pubDate = extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'updated') || extractXmlTag(block, 'published') || nowIso;

        let link = extractXmlTag(block, 'link');
        if (isAtom && !link) {
            const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
            link = hrefMatch ? decodeXmlValue(hrefMatch[1]) : '';
        }

        return {
            title,
            link,
            pubDate,
            description,
            source: channelTitle
        };
    }).filter((item) => item.title);
}

function isNewsRelevantForSymbol(symbol, titleLower, impact) {
    const isXauRelevant = titleLower.includes('gold') || titleLower.includes('precious') || titleLower.includes('xau') || titleLower.includes('fed') || titleLower.includes('inflation') || titleLower.includes('dollar');
    const isBtcRelevant = titleLower.includes('bitcoin') || titleLower.includes('btc') || titleLower.includes('crypto') || titleLower.includes('blockchain');
    const isEthRelevant = titleLower.includes('ethereum') || titleLower.includes('eth') || titleLower.includes('crypto') || titleLower.includes('defi');
    const isMacroRelevant = titleLower.includes('market') || titleLower.includes('economy') || titleLower.includes('trade');

    if (symbol === 'XAU/USD') return isXauRelevant || isMacroRelevant || impact === 'HIGH';
    if (symbol === 'BTC/USD') return isBtcRelevant || isMacroRelevant || impact === 'HIGH';
    if (symbol === 'ETH/USD') return isEthRelevant || isMacroRelevant || impact === 'HIGH';
    return isMacroRelevant || impact === 'HIGH';
}

// Fetch news from multiple RSS sources via rss2json + direct XML fallback
async function fetchNewsFromRSS(symbol) {
    const feeds = {
        'XAU/USD': [
            'https://feeds.reuters.com/reuters/businessNews',
            'https://www.investing.com/rss/news_285.rss', // Gold news
        ],
        'BTC/USD': [
            'https://feeds.reuters.com/reuters/businessNews',
            'https://cointelegraph.com/rss',
        ],
        'ETH/USD': [
            'https://feeds.reuters.com/reuters/businessNews',
            'https://cointelegraph.com/rss',
        ],
        'GLOBAL': [
            'https://feeds.reuters.com/reuters/businessNews',
            'https://cointelegraph.com/rss',
            'https://www.investing.com/rss/news.rss',
        ]
    };

    const symbolKey = feeds[symbol] ? symbol : 'GLOBAL';
    const symbolFeeds = feeds[symbolKey] || feeds['GLOBAL'];
    const allItems = [];
    const seenLinks = new Set();

    const fetch = (await import('node-fetch')).default;

    const pushItem = (item, fallbackSource = 'News') => {
        const title = String(item?.title || '').trim();
        if (!title) return 0;

        const link = String(item?.link || '').trim() || `${fallbackSource}-${title.slice(0, 24)}`;
        if (seenLinks.has(link)) return 0;

        const description = String(item?.description || item?.content || '');
        const sentiment = analyzeSentiment(title, description);
        const titleLower = title.toLowerCase();
        const isRelevant = isNewsRelevantForSymbol(symbol, titleLower, sentiment.impact);

        if (!isRelevant && allItems.length >= 5) return 0;

        seenLinks.add(link);
        allItems.push({
            title,
            link,
            pubDate: item?.pubDate || new Date().toISOString(),
            source: item?.source || fallbackSource,
            sentiment: sentiment.sentiment,
            sentimentScore: sentiment.score,
            impact: sentiment.impact,
            relevant: isRelevant
        });
        return 1;
    };

    for (const feedUrl of symbolFeeds) {
        let addedFromFeed = 0;

        try {
            const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=10`;
            const res = await fetch(apiUrl, { timeout: 8000 });
            const data = await res.json();

            if (data.status === 'ok' && Array.isArray(data.items)) {
                for (const item of data.items) {
                    addedFromFeed += pushItem({
                        title: item.title,
                        link: item.link,
                        pubDate: item.pubDate,
                        description: item.description || '',
                        source: data.feed?.title || 'News'
                    }, data.feed?.title || 'News');
                }
            } else if (data?.status && data.status !== 'ok') {
                console.log(`rss2json returned ${data.status} for ${feedUrl}`);
            }
        } catch (e) {
            console.log(`RSS2JSON fetch failed for ${feedUrl}:`, e.message);
        }

        if (addedFromFeed > 0) continue;

        // Fallback: parse raw XML feed directly if rss2json is unavailable/rate-limited.
        try {
            const rawRes = await fetch(feedUrl, {
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
            });
            const xmlText = await rawRes.text();
            const parsedItems = parseRSSFeedXml(xmlText, new URL(feedUrl).hostname);
            for (const item of parsedItems.slice(0, 12)) {
                pushItem(item, item.source || new URL(feedUrl).hostname);
            }
        } catch (e) {
            console.log(`Raw RSS fetch failed for ${feedUrl}:`, e.message);
        }
    }

    // Sort by relevance + recency
    allItems.sort((a, b) => {
        if (a.relevant !== b.relevant) return b.relevant ? 1 : -1;
        return new Date(b.pubDate) - new Date(a.pubDate);
    });

    return allItems.slice(0, 15);
}

// Calculate global sentiment from all news
function calculateGlobalSentiment(newsItems) {
    if (!newsItems || newsItems.length === 0) {
        return { sentiment: 'NEUTRAL', score: 0, bullishCount: 0, bearishCount: 0, neutralCount: 0, total: 0 };
    }

    let totalScore = 0;
    let bullishCount = 0, bearishCount = 0, neutralCount = 0;

    newsItems.forEach(item => {
        totalScore += item.sentimentScore;
        if (item.sentiment === 'BULLISH') bullishCount++;
        else if (item.sentiment === 'BEARISH') bearishCount++;
        else neutralCount++;
    });

    const avgScore = totalScore / newsItems.length;
    const sentiment = avgScore > 10 ? 'BULLISH' : avgScore < -10 ? 'BEARISH' : 'NEUTRAL';

    return {
        sentiment,
        score: parseFloat(avgScore.toFixed(1)),
        bullishCount,
        bearishCount,
        neutralCount,
        total: newsItems.length,
        highImpact: newsItems.filter(n => n.impact === 'HIGH').length
    };
}

// News endpoint
app.get('/api/news', async (req, res) => {
    const symbol = req.query.symbol || 'XAU/USD';
    const now = Date.now();
    const cacheEntry = getNewsCacheEntry(symbol);

    // Check cache
    if (cacheEntry.items.length > 0 && (now - cacheEntry.timestamp) < NEWS_CACHE_MS) {
        return res.json({
            success: true,
            source: 'cached',
            items: cacheEntry.items,
            globalSentiment: cacheEntry.globalSentiment
        });
    }

    try {
        const fetchedItems = await fetchNewsFromRSS(symbol);
        const items = fetchedItems.length > 0 ? fetchedItems : generateFallbackNews(symbol);
        const source = fetchedItems.length > 0 ? 'rss' : 'generated-empty';
        const globalSentiment = calculateGlobalSentiment(items);

        cacheEntry.items = items;
        cacheEntry.timestamp = now;
        cacheEntry.globalSentiment = globalSentiment;

        res.json({ success: true, source, items, globalSentiment });
    } catch (e) {
        console.log('News fetch error:', e.message);
        // Return fallback generated news
        const fallbackItems = generateFallbackNews(symbol);
        const globalSentiment = calculateGlobalSentiment(fallbackItems);
        cacheEntry.items = fallbackItems;
        cacheEntry.timestamp = now;
        cacheEntry.globalSentiment = globalSentiment;
        res.json({ success: true, source: 'generated', items: fallbackItems, globalSentiment });
    }
});

app.post('/api/track-open', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const trackedPath = typeof body.path === 'string' && body.path.trim()
        ? body.path.trim()
        : (req.headers?.referer || req.originalUrl || req.url);
    const source = typeof body.source === 'string' && body.source.trim()
        ? body.source.trim()
        : 'web-app';

    const details = { path: trackedPath, source, authorized: true };
    if (typeof body.symbol === 'string' && body.symbol.trim()) {
        details.symbol = body.symbol.trim();
    }
    if (typeof body.note === 'string' && body.note.trim()) {
        details.note = body.note.trim();
    }

    trackAccess(req, 'link_open', details);
    res.json({ success: true, tracked: true });
});

app.get('/api/access-devices', (req, res) => {
    const limitRaw = Number(req.query.limit);
    const sinceHoursRaw = Number(req.query.sinceHours);
    const eventFilter = typeof req.query.event === 'string' ? req.query.event.trim() : '';
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 100;
    const sinceHours = Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0
        ? Math.min(sinceHoursRaw, 24 * 365)
        : 0;
    const cutoff = sinceHours > 0 ? Date.now() - (sinceHours * 60 * 60 * 1000) : 0;

    let entries = loadAccessLogEntries();

    if (eventFilter) {
        entries = entries.filter(entry => entry.event === eventFilter);
    }

    if (cutoff > 0) {
        entries = entries.filter(entry => {
            const ts = toTimestampMs(entry.timestamp);
            return ts >= cutoff;
        });
    }

    const devices = summarizeAccessDevices(entries).slice(0, limit);

    res.json({
        success: true,
        totalEvents: entries.length,
        totalDevices: devices.length,
        filters: {
            limit,
            event: eventFilter || null,
            sinceHours: sinceHours || null,
        },
        devices,
    });
});

// Fallback news if RSS fails
function generateFallbackNews(symbol) {
    const templates = {
        'XAU/USD': [
            { title: 'Gold prices steady amid market uncertainty', sentiment: 'NEUTRAL', impact: 'MEDIUM' },
            { title: 'Federal Reserve signals cautious approach on rates', sentiment: 'BULLISH', impact: 'HIGH' },
            { title: 'Dollar index fluctuates as traders await economic data', sentiment: 'NEUTRAL', impact: 'MEDIUM' },
            { title: 'Geopolitical tensions support safe-haven demand', sentiment: 'BULLISH', impact: 'HIGH' },
            { title: 'Inflation data expected to influence precious metals', sentiment: 'NEUTRAL', impact: 'HIGH' },
        ],
        'BTC/USD': [
            { title: 'Bitcoin holds above key support level', sentiment: 'BULLISH', impact: 'MEDIUM' },
            { title: 'Crypto market sees renewed institutional interest', sentiment: 'BULLISH', impact: 'HIGH' },
            { title: 'Regulatory developments weigh on digital assets', sentiment: 'BEARISH', impact: 'HIGH' },
            { title: 'Bitcoin ETF inflows continue positive trend', sentiment: 'BULLISH', impact: 'HIGH' },
            { title: 'Cryptocurrency trading volume increases', sentiment: 'NEUTRAL', impact: 'MEDIUM' },
        ],
        'ETH/USD': [
            { title: 'Ethereum network activity surges to monthly high', sentiment: 'BULLISH', impact: 'MEDIUM' },
            { title: 'DeFi total value locked continues to grow', sentiment: 'BULLISH', impact: 'MEDIUM' },
            { title: 'ETH staking rewards attract institutional capital', sentiment: 'BULLISH', impact: 'HIGH' },
            { title: 'Gas fees remain low, boosting Ethereum usage', sentiment: 'BULLISH', impact: 'MEDIUM' },
            { title: 'Market analysts divided on ETH price direction', sentiment: 'NEUTRAL', impact: 'LOW' },
        ],
        'GLOBAL': [
            { title: 'Global risk sentiment mixed as traders watch macro data', sentiment: 'NEUTRAL', impact: 'HIGH' },
            { title: 'Central banks signal cautious policy path', sentiment: 'NEUTRAL', impact: 'HIGH' },
            { title: 'Crypto market capitalization edges higher', sentiment: 'BULLISH', impact: 'MEDIUM' },
            { title: 'Safe-haven demand rises on geopolitical uncertainty', sentiment: 'BULLISH', impact: 'HIGH' },
            { title: 'Dollar strength pressures risk assets in late session', sentiment: 'BEARISH', impact: 'MEDIUM' },
        ]
    };

    return (templates[symbol] || templates['GLOBAL'] || templates['XAU/USD']).map((t, i) => ({
        ...t,
        sentimentScore: t.sentiment === 'BULLISH' ? 30 : t.sentiment === 'BEARISH' ? -30 : 0,
        link: '#',
        pubDate: new Date(Date.now() - i * 3600000).toISOString(),
        source: 'Market Analysis',
        relevant: true
    }));
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now(), instruments: Object.keys(INSTRUMENTS) });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback for frontend routing
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================
//  WEBSOCKET SERVER — Real-time streaming
// ============================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track client subscriptions
const wsClients = new Map();

wss.on('connection', (ws) => {
    const clientId = Math.random().toString(36).slice(2, 8);
    wsClients.set(clientId, { ws, symbol: 'BTC/USD' });
    console.log(`🔌 WS client connected: ${clientId}`);

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'subscribe' && INSTRUMENTS[data.symbol]) {
                wsClients.get(clientId).symbol = data.symbol;
                ws.send(JSON.stringify({ type: 'subscribed', symbol: data.symbol }));
                console.log(`📡 Client ${clientId} subscribed to ${data.symbol}`);
            }
        } catch (e) { /* ignore */ }
    });

    ws.on('close', () => {
        wsClients.delete(clientId);
        console.log(`🔌 WS client disconnected: ${clientId}`);
    });

    // Send initial state
    ws.send(JSON.stringify({ type: 'connected', instruments: Object.keys(INSTRUMENTS) }));
});

// Broadcast to all clients subscribed to a symbol
function broadcast(symbol, data) {
    for (const [, client] of wsClients) {
        if (client.symbol === symbol && client.ws.readyState === 1) {
            client.ws.send(JSON.stringify(data));
        }
    }
}

// Price streaming loop — every 3s
async function streamPrices() {
    for (const symbol of Object.keys(INSTRUMENTS)) {
        // Check if anyone is subscribed
        const hasSubscribers = [...wsClients.values()].some(c => c.symbol === symbol);
        if (!hasSubscribers) continue;

        if (isMarketClosed(symbol)) {
            const price = instrumentState[symbol].lastKnownPrice || INSTRUMENTS[symbol]?.basePrice || 0;
            broadcast(symbol, {
                type: 'price',
                symbol,
                source: 'market-closed',
                marketStatus: 'closed',
                reason: getMarketClosedReason(symbol),
                price,
                bid: parseFloat((price * 0.9999).toFixed(3)),
                ask: parseFloat((price * 1.0001).toFixed(3)),
                spread: parseFloat((price * 0.0002).toFixed(2)),
                timestamp: Date.now()
            });
            continue;
        }

        try {
            const sources = [];
            if (symbol === 'BTC/USD' || symbol === 'ETH/USD') {
                sources.push(() => fetchBinanceTick(symbol));
                sources.push(() => fetchKrakenTick(symbol));
                sources.push(() => fetchCryptoTick(symbol));
            } else {
                sources.push(() => fetchKrakenTick(symbol));
                sources.push(() => fetchSwissquoteTick(symbol));
            }

            for (const fn of sources) {
                try {
                    const tick = await fn();
                    if (tick) {
                        instrumentState[symbol].lastKnownPrice = tick.price;
                        broadcast(symbol, { type: 'price', symbol, ...tick, source: 'live' });
                        break;
                    }
                } catch (e) { /* try next */ }
            }
        } catch (e) { /* silent */ }
    }
}

// Orderbook streaming — every 5s
async function streamOrderbook() {
    for (const symbol of ['BTC/USD', 'ETH/USD']) {
        const hasSubscribers = [...wsClients.values()].some(c => c.symbol === symbol);
        if (!hasSubscribers) continue;

        const binanceSymbol = binanceSymbols[symbol];
        if (!binanceSymbol) continue;
        try {
            const fetch = (await import('node-fetch')).default;
            const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=10`, { timeout: 5000 });
            const data = await res.json();
            const bids = (data.bids || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q), total: parseFloat(p) * parseFloat(q) }));
            const asks = (data.asks || []).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q), total: parseFloat(p) * parseFloat(q) }));
            const bidVol = bids.reduce((s, b) => s + b.total, 0);
            const askVol = asks.reduce((s, a) => s + a.total, 0);
            const ratio = bidVol / (bidVol + askVol);
            broadcast(symbol, { type: 'orderbook', symbol, bids, asks, ratio: parseFloat(ratio.toFixed(3)), pressure: ratio > 0.55 ? 'BUY' : ratio < 0.45 ? 'SELL' : 'NEUTRAL' });
        } catch (e) { /* silent */ }
    }
}

// News streaming — every 60s
async function streamNews() {
    const symbols = Object.keys(INSTRUMENTS);
    const allNews = [];
    const now = Date.now();

    for (const symbol of symbols) {
        try {
            const fetchedItems = await fetchNewsFromRSS(symbol);
            const items = fetchedItems.length > 0 ? fetchedItems : generateFallbackNews(symbol);
            if (items && items.length > 0) {
                allNews.push(...items);
                const symbolSentiment = calculateGlobalSentiment(items);
                const symbolCache = getNewsCacheEntry(symbol);
                symbolCache.items = items;
                symbolCache.timestamp = now;
                symbolCache.globalSentiment = symbolSentiment;
                // Broadcast for this symbol specifically
                broadcast(symbol, {
                    type: 'news',
                    symbol,
                    items: items.slice(0, 5),
                    globalSentiment: symbolSentiment
                });
            }
        } catch (e) { }
    }

    // Broadcast Global News to everyone
    if (allNews.length > 0) {
        const uniqueNews = allNews.filter((v, i, a) => a.findIndex(t => t.link === v.link) === i);
        const globalItems = uniqueNews.slice(0, 15);
        const globalSentiment = calculateGlobalSentiment(globalItems);
        const globalCache = getNewsCacheEntry('GLOBAL');
        globalCache.items = globalItems;
        globalCache.timestamp = now;
        globalCache.globalSentiment = globalSentiment;

        const globalMsg = JSON.stringify({
            type: 'news',
            symbol: 'GLOBAL',
            items: globalItems,
            globalSentiment
        });
        for (const [, client] of wsClients) {
            if (client.ws.readyState === 1) client.ws.send(globalMsg);
        }
    }
}

// Start streaming intervals
setInterval(streamPrices, 3000);
setInterval(streamOrderbook, 5000);
setInterval(streamNews, 60000); // Check news every minute

server.listen(PORT, () => {
    console.log(`\n🥇 Multi-Asset Analyzer API running at http://localhost:${PORT}`);
    if (SITE_ACCESS_CODE) {
        console.log(`🔒 Access code protection: ON (user: ${SITE_ACCESS_USER})`);
    } else {
        console.log(`🔓 Access code protection: OFF`);
    }
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`📊 Instruments: ${Object.keys(INSTRUMENTS).join(', ')}`);
    console.log(`📰 News sentiment: /api/news?symbol=`);
    console.log(`📊 Endpoints: /api/price, /api/history, /api/instruments, /api/ai-signal, /api/news\n`);
    for (const symbol of Object.keys(INSTRUMENTS)) {
        initSimulatedHistory(symbol);
    }
});
