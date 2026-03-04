require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { listMt5Bots, getMt5BotDefinition, renderMt5BotSource } = require('./mt5_bot_catalog');
let createRedisClient = null;
try {
    ({ createClient: createRedisClient } = require('redis'));
} catch {
    createRedisClient = null;
}
const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const SITE_ACCESS_CODE = process.env.SITE_ACCESS_CODE || '';
const SITE_ACCESS_USER = process.env.SITE_ACCESS_USER || 'ari';
const ACCESS_REALM = 'Ari Trading Bot';
const ACCESS_COOKIE_NAME = 'ari_access_token_v1';
const ACCESS_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const ACCESS_LOG_FILE = path.join(__dirname, 'access_clicks.jsonl');

app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '12mb' }));
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
        trackAccess(req, 'payload_too_large', {
            authorized: true,
            source: req.path && req.path.startsWith('/api') ? 'api' : 'web',
            path: req.originalUrl || req.url,
            limit: process.env.JSON_BODY_LIMIT || '12mb',
        });
        return res.status(413).json({ success: false, error: 'payload_too_large' });
    }
    return next(err);
});

function parsePositiveInt(input, fallback) {
    const n = Number.parseInt(String(input ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolean(input, fallback = false) {
    const raw = String(input ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
}

const PRICE_STREAM_INTERVAL_MS = parsePositiveInt(process.env.PRICE_STREAM_INTERVAL_MS, 450);
const ORDERBOOK_STREAM_INTERVAL_MS = parsePositiveInt(process.env.ORDERBOOK_STREAM_INTERVAL_MS, 2500);
const NEWS_STREAM_INTERVAL_MS = parsePositiveInt(process.env.NEWS_STREAM_INTERVAL_MS, 60000);
const LIVE_TICK_SOURCE_TIMEOUT_MS = parsePositiveInt(process.env.LIVE_TICK_SOURCE_TIMEOUT_MS, 1200);
const CHAT_REDIS_URL = String(process.env.CHAT_REDIS_URL || '').trim();
const CHAT_REDIS_CHANNEL = String(process.env.CHAT_REDIS_CHANNEL || 'ari_chat_bus_v1').trim();
const CHAT_REDIS_HEARTBEAT_MS = parsePositiveInt(process.env.CHAT_REDIS_HEARTBEAT_MS, 6000);
const CHAT_REDIS_REMOTE_STALE_MS = parsePositiveInt(process.env.CHAT_REDIS_REMOTE_STALE_MS, 26000);
const CHAT_INSTANCE_ID = String(process.env.K_REVISION || process.env.K_SERVICE || '').trim()
    || `inst_${Math.random().toString(36).slice(2, 8)}`;
const RITHMIC_ENABLED = parseBoolean(process.env.RITHMIC_ENABLED, false);
const RITHMIC_API_BASE_URL = String(process.env.RITHMIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
const RITHMIC_API_TOKEN = String(process.env.RITHMIC_API_TOKEN || '').trim();
const RITHMIC_ACCOUNT_HINT = String(process.env.RITHMIC_ACCOUNT_HINT || '').trim();
const RITHMIC_TIMEOUT_MS = parsePositiveInt(process.env.RITHMIC_TIMEOUT_MS, 8000);
const ENABLE_PRIMARY_EXCHANGE_FEEDS = parseBoolean(process.env.ENABLE_PRIMARY_EXCHANGE_FEEDS, true);
const PRIMARY_EXCHANGE_TIMEOUT_MS = parsePositiveInt(process.env.PRIMARY_EXCHANGE_TIMEOUT_MS, 900);
const PRIMARY_EXCHANGE_CACHE_MS = parsePositiveInt(process.env.PRIMARY_EXCHANGE_CACHE_MS, 1200);
const PRIMARY_EXCHANGE_DEBUG = parseBoolean(process.env.PRIMARY_EXCHANGE_DEBUG, false);
const NASDAQ_PRIMARY_BASE_URL = String(process.env.NASDAQ_PRIMARY_BASE_URL || 'https://api.nasdaq.com/api').trim().replace(/\/+$/, '');
const PRIMARY_EXCHANGE_BRIDGE_URL = String(process.env.PRIMARY_EXCHANGE_BRIDGE_URL || '').trim().replace(/\/+$/, '');
const PRIMARY_EXCHANGE_BRIDGE_TOKEN = String(process.env.PRIMARY_EXCHANGE_BRIDGE_TOKEN || '').trim();
const CBOE_SPX_QUOTE_URL = String(process.env.CBOE_SPX_QUOTE_URL || '').trim();
const CBOE_US30_QUOTE_URL = String(process.env.CBOE_US30_QUOTE_URL || '').trim();
const CME_XAU_QUOTE_URL = String(process.env.CME_XAU_QUOTE_URL || '').trim();
const CME_XAG_QUOTE_URL = String(process.env.CME_XAG_QUOTE_URL || '').trim();
const CME_WTI_QUOTE_URL = String(process.env.CME_WTI_QUOTE_URL || '').trim();
const EURONEXT_AEX_QUOTE_URL = String(process.env.EURONEXT_AEX_QUOTE_URL || '').trim();
const EURONEXT_CAC40_QUOTE_URL = String(process.env.EURONEXT_CAC40_QUOTE_URL || '').trim();
const EURONEXT_BEL20_QUOTE_URL = String(process.env.EURONEXT_BEL20_QUOTE_URL || '').trim();
const PRIMARY_LICENSE_MODE = String(process.env.PRIMARY_LICENSE_MODE || 'paper').trim().toLowerCase();
const PRIMARY_LICENSE_NASDAQ = String(process.env.PRIMARY_LICENSE_NASDAQ || '').trim();
const PRIMARY_LICENSE_NYSE = String(process.env.PRIMARY_LICENSE_NYSE || '').trim();
const PRIMARY_LICENSE_CME = String(process.env.PRIMARY_LICENSE_CME || '').trim();
const PRIMARY_LICENSE_CBOE = String(process.env.PRIMARY_LICENSE_CBOE || '').trim();
const PRIMARY_LICENSE_EURONEXT = String(process.env.PRIMARY_LICENSE_EURONEXT || '').trim();
const MARKET_BUS_ENABLED = parseBoolean(process.env.MARKET_BUS_ENABLED, true);
const MARKET_BUS_CHANNEL = String(process.env.MARKET_BUS_CHANNEL || CHAT_REDIS_CHANNEL || 'ari_market_bus_v1').trim();
const REALTIME_STALE_MS = parsePositiveInt(process.env.REALTIME_STALE_MS, 5000);
const REALTIME_WARN_MS = parsePositiveInt(process.env.REALTIME_WARN_MS, 1500);

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

function buildAccessCookieValue() {
    if (!SITE_ACCESS_CODE) return '';
    return Buffer.from(`${SITE_ACCESS_USER}:${SITE_ACCESS_CODE}`, 'utf8').toString('base64url');
}

function parseCookieMap(cookieHeader) {
    const raw = String(cookieHeader || '').trim();
    if (!raw) return {};
    const out = {};
    const segments = raw.split(';');
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!key) continue;
        out[key] = decodeURIComponent(value);
    }
    return out;
}

function isCookieAuthorized(req) {
    if (!SITE_ACCESS_CODE) return true;
    const cookies = parseCookieMap(req.headers?.cookie);
    const token = cookies[ACCESS_COOKIE_NAME];
    if (!token) return false;
    return token === buildAccessCookieValue();
}

function parseAccessCodeCandidate(req) {
    const query = req.query || {};
    const candidate = query.access || query.code || query.access_code || query.pass;
    return String(candidate || '').trim();
}

function isQueryAccessAuthorized(req) {
    if (!SITE_ACCESS_CODE) return false;
    const code = parseAccessCodeCandidate(req);
    if (!code) return false;
    return code === SITE_ACCESS_CODE;
}

function setAccessCookie(req, res) {
    if (!SITE_ACCESS_CODE) return;
    const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase().includes('https')
        || process.env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE_NAME, buildAccessCookieValue(), {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: ACCESS_COOKIE_MAX_AGE_MS,
        path: '/',
    });
}

function sanitizeUrlWithoutAccessQuery(req) {
    const query = { ...(req.query || {}) };
    delete query.access;
    delete query.code;
    delete query.access_code;
    delete query.pass;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === undefined || item === null || item === '') continue;
                params.append(key, String(item));
            }
            continue;
        }
        params.append(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${req.path}?${qs}` : req.path;
}

function isPublicStaticPath(pathname = '') {
    if (!pathname) return false;
    if (pathname.startsWith('/assets/')) return true;
    return pathname === '/favicon.ico'
        || pathname === '/manifest.webmanifest'
        || pathname === '/robots.txt';
}

function requireAccessCode(req, res, next) {
    if (!SITE_ACCESS_CODE) return next();
    if (req.method === 'OPTIONS') return next();
    if (isPublicStaticPath(req.path)) return next();

    if (isBasicAuthAuthorized(req.headers?.authorization)) {
        setAccessCookie(req, res);
        const acceptHeader = typeof req.headers?.accept === 'string' ? req.headers.accept : '';
        const isHtmlPageRequest = req.method === 'GET' && !req.path.startsWith('/api') && acceptHeader.includes('text/html');
        if (isHtmlPageRequest) {
            trackAccess(req, 'page_open', { authorized: true, source: 'web' });
        }
        return next();
    }

    if (isCookieAuthorized(req)) {
        return next();
    }

    if (isQueryAccessAuthorized(req)) {
        setAccessCookie(req, res);
        trackAccess(req, 'auth_granted_query', { authorized: true, source: 'web' });
        const redirectTarget = sanitizeUrlWithoutAccessQuery(req);
        return res.redirect(302, redirectTarget);
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
    // Commodities
    'XAU/USD': { name: 'Gold', icon: '🥇', basePrice: 5100, volatility: 0.0008, decimals: 2, yahoo: 'GC=F' },
    'XAG/USD': { name: 'Silver', icon: '🥈', basePrice: 32, volatility: 0.0012, decimals: 3, yahoo: 'SI=F' },
    'WTI/USD': { name: 'WTI Crude Oil', icon: '🛢️', basePrice: 78, volatility: 0.0014, decimals: 2, yahoo: 'CL=F' },
    // Forex
    'EUR/USD': { name: 'Euro / US Dollar', icon: '💶', basePrice: 1.09, volatility: 0.0007, decimals: 5, yahoo: 'EURUSD=X' },
    'GBP/USD': { name: 'Pound / US Dollar', icon: '💷', basePrice: 1.27, volatility: 0.0008, decimals: 5, yahoo: 'GBPUSD=X' },
    'USD/JPY': { name: 'US Dollar / Yen', icon: '💴', basePrice: 151.2, volatility: 0.0009, decimals: 3, yahoo: 'JPY=X' },
    'CHF/JPY': { name: 'Swiss Franc / Yen', icon: '🇨🇭', basePrice: 170.1, volatility: 0.0009, decimals: 3, yahoo: 'CHFJPY=X' },
    'AUD/USD': { name: 'Australian Dollar / US Dollar', icon: '🦘', basePrice: 0.66, volatility: 0.0009, decimals: 5, yahoo: 'AUDUSD=X' },
    // Crypto
    'BTC/USD': { name: 'Bitcoin', icon: '₿', basePrice: 96500, volatility: 0.002, decimals: 2, yahoo: 'BTC-USD' },
    'ETH/USD': { name: 'Ethereum', icon: 'Ξ', basePrice: 2750, volatility: 0.003, decimals: 2, yahoo: 'ETH-USD' },
    'SOL/USD': { name: 'Solana', icon: '◎', basePrice: 175, volatility: 0.0034, decimals: 2, yahoo: 'SOL-USD' },
    // Stocks
    'AAPL/USD': { name: 'Apple Inc.', icon: '🍎', basePrice: 215, volatility: 0.0016, decimals: 2, yahoo: 'AAPL' },
    'TSLA/USD': { name: 'Tesla Inc.', icon: '⚡', basePrice: 220, volatility: 0.0028, decimals: 2, yahoo: 'TSLA' },
    'NVDA/USD': { name: 'NVIDIA Corp.', icon: '🟩', basePrice: 920, volatility: 0.0022, decimals: 2, yahoo: 'NVDA' },
    // Indices
    'SPX500/USD': { name: 'S&P 500', icon: '📊', basePrice: 5200, volatility: 0.001, decimals: 2, yahoo: '^GSPC' },
    'NAS100/USD': { name: 'Nasdaq 100', icon: '🧠', basePrice: 18300, volatility: 0.0012, decimals: 2, yahoo: '^NDX' },
    'US30/USD': { name: 'Dow Jones 30', icon: '🏛️', basePrice: 39000, volatility: 0.0009, decimals: 2, yahoo: '^DJI' }
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
        return 'XAU/USD market closed (Friday 22:00 UTC to Sunday 22:00 UTC). Use crypto pairs (BTC/USD, ETH/USD, SOL/USD).';
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
        dayLow: Infinity,
        lastKnownPriceSource: 'bootstrap',
        lastKnownPriceTimestamp: Date.now(),
        lastKnownBid: null,
        lastKnownAsk: null,
        lastKnownSpread: null,
        lastOrderbookSnapshot: null,
        lastOrderbookTimestamp: 0
    };
}

function classifyMarketDataSource(sourceRaw) {
    const source = String(sourceRaw || '').toLowerCase();
    if (!source) return { source: 'unknown', actor: 'UNKNOWN', sourceClass: 'UNKNOWN' };
    if (source.includes('market-closed')) return { source, actor: 'CLOSED', sourceClass: 'CLOSED' };
    if (source.includes('mt5-bridge')) return { source, actor: 'BROKER', sourceClass: 'BROKER' };
    if (source.includes('binance') || source.includes('kraken') || source.includes('nasdaq') || source.includes('nyse') || source.includes('cme') || source.includes('cboe')) {
        return { source, actor: 'EXCHANGE', sourceClass: 'PRIMARY' };
    }
    if (source.includes('tradingview') || source.includes('coingecko') || source.includes('finnhub') || source.includes('polygon') || source.includes('alpha') || source.includes('yahoo') || source.includes('twelvedata')) {
        return { source, actor: 'VENDOR', sourceClass: 'AGGREGATED' };
    }
    if (source.includes('simulated')) return { source, actor: 'SIMULATED', sourceClass: 'SIMULATED' };
    return { source, actor: 'VENDOR', sourceClass: 'AGGREGATED' };
}

function inferProviderChain(actor) {
    if (actor === 'EXCHANGE') return ['Exchange', 'AriAlgo Engine'];
    if (actor === 'BROKER') return ['Exchange', 'Broker Bridge', 'AriAlgo Engine'];
    if (actor === 'VENDOR') return ['Exchange', 'Data Vendor', 'AriAlgo Engine'];
    if (actor === 'SIMULATED') return ['Synthetic Generator', 'AriAlgo Engine'];
    if (actor === 'CLOSED') return ['Market Closed Snapshot', 'AriAlgo Engine'];
    return ['Unknown Source', 'AriAlgo Engine'];
}

const realtimeTelemetry = {
    startedAtMs: Date.now(),
    ticksTotal: 0,
    orderbookTotal: 0,
    signalTotal: 0,
    priceBroadcastTotal: 0,
    orderbookBroadcastTotal: 0,
    streamPricesRuns: 0,
    streamPricesErrors: 0,
    streamOrderbookRuns: 0,
    streamOrderbookErrors: 0,
    streamNewsRuns: 0,
    streamNewsErrors: 0,
    redisMarketPublished: 0,
    redisMarketReceived: 0,
    redisMarketDropped: 0,
    lastPriceStreamAtMs: 0,
    lastOrderbookStreamAtMs: 0,
    lastNewsStreamAtMs: 0,
    symbol: {}
};

function getRealtimeSymbolStats(symbol) {
    if (!realtimeTelemetry.symbol[symbol]) {
        realtimeTelemetry.symbol[symbol] = {
            ticks: 0,
            orderbooks: 0,
            signals: 0,
            lastTickAtMs: 0,
            lastTickTimestamp: 0,
            lastTickAgeMs: null,
            lastSource: 'unknown',
            lastOrderbookAtMs: 0,
            lastOrderbookSource: 'unknown',
            maxTickAgeMs: 0,
            sumTickAgeMs: 0
        };
    }
    return realtimeTelemetry.symbol[symbol];
}

function recordRealtimeTick(symbol, tick = {}) {
    const stats = getRealtimeSymbolStats(symbol);
    const now = Date.now();
    const tickTimestamp = toNum(tick.timestamp, now);
    const tickAgeMs = Math.max(0, now - tickTimestamp);

    stats.ticks += 1;
    stats.lastTickAtMs = now;
    stats.lastTickTimestamp = tickTimestamp;
    stats.lastTickAgeMs = tickAgeMs;
    stats.lastSource = String(tick.source || tick.provider || stats.lastSource || 'unknown');
    stats.maxTickAgeMs = Math.max(toNum(stats.maxTickAgeMs, 0), tickAgeMs);
    stats.sumTickAgeMs = toNum(stats.sumTickAgeMs, 0) + tickAgeMs;

    realtimeTelemetry.ticksTotal += 1;
}

function recordRealtimeOrderbook(symbol, snapshot = {}) {
    const stats = getRealtimeSymbolStats(symbol);
    const now = Date.now();
    stats.orderbooks += 1;
    stats.lastOrderbookAtMs = now;
    stats.lastOrderbookSource = String(snapshot.source || stats.lastOrderbookSource || 'unknown');
    realtimeTelemetry.orderbookTotal += 1;
}

function recordRealtimeSignal(symbol) {
    const stats = getRealtimeSymbolStats(symbol);
    stats.signals += 1;
    realtimeTelemetry.signalTotal += 1;
}

function updateInstrumentTickState(symbol, tick = {}) {
    const state = instrumentState[symbol];
    if (!state) return;
    const price = toNum(tick.price, state.lastKnownPrice);
    if (price > 0) state.lastKnownPrice = price;
    if (Number.isFinite(price) && price > 0) {
        state.dayHigh = Math.max(toNum(state.dayHigh, price), price);
        state.dayLow = Math.min(toNum(state.dayLow, price), price);
    }
    state.lastKnownPriceSource = String(tick.source || tick.provider || state.lastKnownPriceSource || 'unknown');
    state.lastKnownPriceTimestamp = toNum(tick.timestamp, Date.now());
    const bid = toNum(tick.bid, NaN);
    const ask = toNum(tick.ask, NaN);
    const spread = toNum(tick.spread, NaN);
    state.lastKnownBid = Number.isFinite(bid) ? bid : null;
    state.lastKnownAsk = Number.isFinite(ask) ? ask : null;
    state.lastKnownSpread = Number.isFinite(spread) ? spread : null;
    recordRealtimeTick(symbol, tick);
}

function updateInstrumentOrderbookState(symbol, snapshot = {}) {
    const state = instrumentState[symbol];
    if (!state) return;
    const bids = Array.isArray(snapshot.bids) ? snapshot.bids : [];
    const asks = Array.isArray(snapshot.asks) ? snapshot.asks : [];
    state.lastOrderbookSnapshot = {
        source: String(snapshot.source || 'unknown'),
        ratio: toNum(snapshot.ratio, 0.5),
        pressure: String(snapshot.pressure || 'NEUTRAL'),
        depthLevels: Math.min(bids.length, asks.length),
        bids: bids.slice(0, 10),
        asks: asks.slice(0, 10)
    };
    state.lastOrderbookTimestamp = toNum(snapshot.timestamp, Date.now());
    recordRealtimeOrderbook(symbol, snapshot);
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

const primaryExchangeTickCache = {};
const primaryExchangeRouting = {
    'AAPL/USD': { venue: 'NASDAQ', provider: 'nasdaq', ticker: 'AAPL', assetClass: 'stocks' },
    'TSLA/USD': { venue: 'NASDAQ', provider: 'nasdaq', ticker: 'TSLA', assetClass: 'stocks' },
    'NVDA/USD': { venue: 'NASDAQ', provider: 'nasdaq', ticker: 'NVDA', assetClass: 'stocks' },
    'NAS100/USD': { venue: 'NASDAQ', provider: 'nasdaq', ticker: 'NDX', assetClass: 'index' },
    'SPX500/USD': { venue: 'CBOE', provider: 'cboe', endpointUrl: CBOE_SPX_QUOTE_URL, endpointSymbol: 'SPX' },
    'US30/USD': { venue: 'CBOE', provider: 'cboe', endpointUrl: CBOE_US30_QUOTE_URL, endpointSymbol: 'DJX' },
    'XAU/USD': { venue: 'CME', provider: 'cme', endpointUrl: CME_XAU_QUOTE_URL, endpointSymbol: 'GC' },
    'XAG/USD': { venue: 'CME', provider: 'cme', endpointUrl: CME_XAG_QUOTE_URL, endpointSymbol: 'SI' },
    'WTI/USD': { venue: 'CME', provider: 'cme', endpointUrl: CME_WTI_QUOTE_URL, endpointSymbol: 'CL' }
};

const euronextWatchlist = [
    { market: 'Paris', venue: 'EURONEXT_PARIS', symbol: 'CAC40', endpointUrl: EURONEXT_CAC40_QUOTE_URL },
    { market: 'Amsterdam', venue: 'EURONEXT_AMSTERDAM', symbol: 'AEX', endpointUrl: EURONEXT_AEX_QUOTE_URL },
    { market: 'Brussels', venue: 'EURONEXT_BRUSSELS', symbol: 'BEL20', endpointUrl: EURONEXT_BEL20_QUOTE_URL }
];

function buildPrimaryLicenseStatusMap() {
    const byVenue = {
        NASDAQ: PRIMARY_LICENSE_NASDAQ,
        NYSE: PRIMARY_LICENSE_NYSE,
        CME: PRIMARY_LICENSE_CME,
        CBOE: PRIMARY_LICENSE_CBOE,
        EURONEXT: PRIMARY_LICENSE_EURONEXT,
    };

    const result = {};
    for (const [venue, token] of Object.entries(byVenue)) {
        const hasToken = !!String(token || '').trim();
        result[venue] = {
            venue,
            mode: PRIMARY_LICENSE_MODE,
            configured: hasToken,
            status: hasToken ? 'configured' : 'missing',
            tokenHint: hasToken ? `${String(token).slice(0, 4)}***` : null,
        };
    }
    return result;
}

function getPrimaryLicenseForVenue(rawVenue = '') {
    const venue = String(rawVenue || '').trim().toUpperCase();
    const all = buildPrimaryLicenseStatusMap();
    return all[venue] || {
        venue: venue || 'UNKNOWN',
        mode: PRIMARY_LICENSE_MODE,
        configured: false,
        status: 'unknown',
        tokenHint: null,
    };
}

function parseLooseNumber(value, fallback = NaN) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const raw = String(value).trim();
    if (!raw) return fallback;
    let cleaned = raw
        .replace(/\u2212/g, '-')
        .replace(/\u00a0/g, '')
        .replace(/[^0-9,.\-+]/g, '');
    if (cleaned.includes(',') && !cleaned.includes('.')) {
        cleaned = cleaned.replace(',', '.');
    }
    cleaned = cleaned.replace(/,/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getPrimaryExchangeDescriptor(symbol) {
    return primaryExchangeRouting[symbol] || null;
}

function getPrimarySpread(symbol, price) {
    const decimals = INSTRUMENTS[symbol]?.decimals ?? 2;
    const minMove = 1 / (10 ** decimals);
    const ratio = toNum(tradingViewSymbolConfig?.[symbol]?.spreadRatio, symbol.includes('/USD') ? 0.00009 : 0.00012);
    return Math.max(price * ratio, minMove * 4);
}

function normalizePrimaryTick(symbol, provider, rawTick = {}) {
    const decimals = INSTRUMENTS[symbol]?.decimals ?? 2;
    const price = parseLooseNumber(rawTick.price, NaN);
    if (!Number.isFinite(price) || price <= 0) return null;

    const bidRaw = parseLooseNumber(rawTick.bid, NaN);
    const askRaw = parseLooseNumber(rawTick.ask, NaN);
    const fallbackSpread = getPrimarySpread(symbol, price);
    const spread = Number.isFinite(askRaw) && Number.isFinite(bidRaw)
        ? Math.max(0, askRaw - bidRaw)
        : fallbackSpread;
    const bid = Number.isFinite(bidRaw) ? bidRaw : (price - (spread / 2));
    const ask = Number.isFinite(askRaw) ? askRaw : (price + (spread / 2));

    return {
        price: parseFloat(price.toFixed(decimals)),
        bid: parseFloat(bid.toFixed(decimals)),
        ask: parseFloat(ask.toFixed(decimals)),
        spread: parseFloat(Math.max(0, spread).toFixed(decimals)),
        change24h: Number.isFinite(parseLooseNumber(rawTick.change24h, NaN))
            ? parseFloat(parseLooseNumber(rawTick.change24h, 0).toFixed(4))
            : undefined,
        volume24h: Number.isFinite(parseLooseNumber(rawTick.volume24h, NaN))
            ? Math.max(0, parseLooseNumber(rawTick.volume24h, 0))
            : undefined,
        timestamp: toNum(rawTick.timestamp, Date.now()),
        provider,
        source: `${provider}-primary`,
        primaryVenue: String(rawTick.primaryVenue || provider).toUpperCase()
    };
}

function interpolatePrimaryUrl(template, descriptor = {}, symbol = '') {
    if (!template) return '';
    return String(template)
        .replace(/\{symbol\}/g, encodeURIComponent(symbol))
        .replace(/\{ticker\}/g, encodeURIComponent(String(descriptor.ticker || descriptor.endpointSymbol || symbol)))
        .replace(/\{venue\}/g, encodeURIComponent(String(descriptor.venue || 'PRIMARY')))
        .replace(/\{timestamp\}/g, String(Date.now()));
}

async function fetchPrimaryEndpointTick(urlTemplate, descriptor, symbol) {
    if (!urlTemplate) return null;
    const url = interpolatePrimaryUrl(urlTemplate, descriptor, symbol);
    if (!url) return null;
    const fetch = (await import('node-fetch')).default;
    try {
        const res = await fetch(url, {
            timeout: PRIMARY_EXCHANGE_TIMEOUT_MS,
            headers: {
                'Accept': 'application/json,text/plain,*/*',
                'User-Agent': 'Mozilla/5.0 (AriAlgo/1.0; +https://ari-algo.local)'
            }
        });
        if (!res.ok) return null;
        const contentType = String(res.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('json')) return null;
        const payload = await res.json();
        const root = payload?.data || payload?.quote || payload?.result || payload || {};
        const tick = normalizePrimaryTick(symbol, descriptor.provider, {
            price: root.price ?? root.last ?? root.lastPrice ?? root.last_trade ?? root.lastSalePrice ?? root.lastTradePrice ?? root.value,
            bid: root.bid ?? root.bidPrice ?? root.bestBid ?? root.bboBid,
            ask: root.ask ?? root.askPrice ?? root.bestAsk ?? root.bboAsk,
            change24h: root.change24h ?? root.changePercent ?? root.netChange ?? root.percentageChange,
            volume24h: root.volume24h ?? root.volume ?? root.totalVolume,
            timestamp: root.timestamp ?? payload?.timestamp ?? Date.now(),
            primaryVenue: descriptor.venue
        });
        return tick;
    } catch (e) {
        if (PRIMARY_EXCHANGE_DEBUG) console.log(`Primary endpoint ${descriptor.provider} ${symbol} failed:`, e.message);
        return null;
    }
}

async function fetchPrimaryExchangeBridgeTick(symbol, descriptor) {
    if (!PRIMARY_EXCHANGE_BRIDGE_URL) return null;
    const fetch = (await import('node-fetch')).default;
    const directTemplate = PRIMARY_EXCHANGE_BRIDGE_URL.includes('{symbol}') || PRIMARY_EXCHANGE_BRIDGE_URL.includes('{ticker}');
    const url = directTemplate
        ? interpolatePrimaryUrl(PRIMARY_EXCHANGE_BRIDGE_URL, descriptor, symbol)
        : `${PRIMARY_EXCHANGE_BRIDGE_URL}/tick?symbol=${encodeURIComponent(symbol)}&venue=${encodeURIComponent(descriptor.venue || '')}&ticker=${encodeURIComponent(descriptor.ticker || descriptor.endpointSymbol || symbol)}`;
    try {
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'AriAlgo/1.0'
        };
        if (PRIMARY_EXCHANGE_BRIDGE_TOKEN) headers.Authorization = `Bearer ${PRIMARY_EXCHANGE_BRIDGE_TOKEN}`;
        const res = await fetch(url, { timeout: PRIMARY_EXCHANGE_TIMEOUT_MS, headers });
        if (!res.ok) return null;
        const payload = await res.json();
        const root = payload?.data || payload?.tick || payload || {};
        return normalizePrimaryTick(symbol, descriptor.provider, {
            price: root.price ?? root.last ?? root.mid ?? root.lastPrice,
            bid: root.bid ?? root.bestBid,
            ask: root.ask ?? root.bestAsk,
            change24h: root.change24h ?? root.changePercent ?? root.change,
            volume24h: root.volume24h ?? root.volume,
            timestamp: root.timestamp ?? payload?.timestamp ?? Date.now(),
            primaryVenue: descriptor.venue
        });
    } catch (e) {
        if (PRIMARY_EXCHANGE_DEBUG) console.log(`Primary bridge ${symbol} failed:`, e.message);
        return null;
    }
}

async function fetchNasdaqPrimaryTick(symbol, descriptor) {
    if (!descriptor?.ticker || !NASDAQ_PRIMARY_BASE_URL) return null;
    const fetch = (await import('node-fetch')).default;
    const url = `${NASDAQ_PRIMARY_BASE_URL}/quote/${encodeURIComponent(descriptor.ticker)}/info?assetclass=${encodeURIComponent(descriptor.assetClass || 'stocks')}`;
    try {
        const res = await fetch(url, {
            timeout: PRIMARY_EXCHANGE_TIMEOUT_MS,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Referer': 'https://www.nasdaq.com/',
                'Origin': 'https://www.nasdaq.com'
            }
        });
        if (!res.ok) return null;
        const payload = await res.json();
        const d = payload?.data || {};
        const p = d?.primaryData || {};
        return normalizePrimaryTick(symbol, 'nasdaq', {
            price: p.lastSalePrice ?? p.lastTrade ?? p.lastTradePrice ?? d.lastSalePrice,
            bid: p.bidPrice ?? p.bid,
            ask: p.askPrice ?? p.ask,
            change24h: p.percentageChange ?? p.netChange,
            volume24h: p.volume ?? d.volume,
            timestamp: Date.now(),
            primaryVenue: 'NASDAQ'
        });
    } catch (e) {
        if (PRIMARY_EXCHANGE_DEBUG) console.log(`Nasdaq primary ${symbol} failed:`, e.message);
        return null;
    }
}

async function fetchPrimaryExchangeTick(symbol) {
    if (!ENABLE_PRIMARY_EXCHANGE_FEEDS) return null;
    const descriptor = getPrimaryExchangeDescriptor(symbol);
    if (!descriptor) return null;

    const cacheKey = `${descriptor.provider}_${symbol}`;
    const cached = primaryExchangeTickCache[cacheKey];
    const now = Date.now();
    if (cached && (now - cached.timestamp) < PRIMARY_EXCHANGE_CACHE_MS) {
        return cached.data;
    }

    let tick = null;
    tick = await fetchPrimaryExchangeBridgeTick(symbol, descriptor);
    if (!tick && descriptor.provider === 'nasdaq') {
        tick = await fetchNasdaqPrimaryTick(symbol, descriptor);
    }
    if (!tick && descriptor.provider === 'cboe') {
        tick = await fetchPrimaryEndpointTick(descriptor.endpointUrl, descriptor, symbol);
    }
    if (!tick && descriptor.provider === 'cme') {
        tick = await fetchPrimaryEndpointTick(descriptor.endpointUrl, descriptor, symbol);
    }
    if (!tick && descriptor.provider === 'euronext') {
        tick = await fetchPrimaryEndpointTick(descriptor.endpointUrl, descriptor, symbol);
    }

    if (tick) {
        primaryExchangeTickCache[cacheKey] = { data: tick, timestamp: now };
        return tick;
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
                return {
                    price,
                    bid,
                    ask,
                    spread: parseFloat((ask - bid).toFixed(2)),
                    timestamp: q.ts,
                    provider: 'swissquote',
                    source: 'swissquote'
                };
            }
        }
    } catch (e) {
        console.log('Swissquote failed:', e.message);
    }
    return null;
}

// TradingView scanner fallback for XAU/USD (prefer Capital.com when available).
const tradingViewSymbolConfig = {
    'XAU/USD': {
        regions: ['cfd', 'global'],
        tickers: ['CAPITALCOM:GOLD', 'CAPITALCOM:XAUUSD', 'CAPITALCOM:GOLDSPOT', 'OANDA:XAUUSD', 'FX_IDC:XAUUSD', 'TVC:GOLD'],
        preferred: ['CAPITALCOM:GOLD', 'CAPITALCOM:XAUUSD', 'CAPITALCOM:GOLDSPOT', 'OANDA:XAUUSD', 'FX_IDC:XAUUSD', 'TVC:GOLD'],
        spreadRatio: 0.00008
    },
    'XAG/USD': {
        regions: ['cfd', 'global'],
        tickers: ['OANDA:XAGUSD', 'FOREXCOM:XAGUSD', 'TVC:SILVER'],
        preferred: ['OANDA:XAGUSD', 'FOREXCOM:XAGUSD', 'TVC:SILVER'],
        spreadRatio: 0.0001
    },
    'WTI/USD': {
        regions: ['cfd', 'global'],
        tickers: ['TVC:USOIL', 'CAPITALCOM:OIL_CRUDE', 'TVC:WTI'],
        preferred: ['TVC:USOIL', 'CAPITALCOM:OIL_CRUDE', 'TVC:WTI'],
        spreadRatio: 0.00015
    },
    'EUR/USD': {
        regions: ['forex', 'global'],
        tickers: ['OANDA:EURUSD', 'FX:EURUSD', 'FX_IDC:EURUSD'],
        preferred: ['OANDA:EURUSD', 'FX:EURUSD', 'FX_IDC:EURUSD'],
        spreadRatio: 0.00006
    },
    'GBP/USD': {
        regions: ['forex', 'global'],
        tickers: ['OANDA:GBPUSD', 'FX:GBPUSD', 'FX_IDC:GBPUSD'],
        preferred: ['OANDA:GBPUSD', 'FX:GBPUSD', 'FX_IDC:GBPUSD'],
        spreadRatio: 0.00006
    },
    'USD/JPY': {
        regions: ['forex', 'global'],
        tickers: ['OANDA:USDJPY', 'FX:USDJPY', 'FX_IDC:USDJPY'],
        preferred: ['OANDA:USDJPY', 'FX:USDJPY', 'FX_IDC:USDJPY'],
        spreadRatio: 0.00006
    },
    'CHF/JPY': {
        regions: ['forex', 'global'],
        tickers: ['OANDA:CHFJPY', 'FX:CHFJPY', 'FX_IDC:CHFJPY'],
        preferred: ['OANDA:CHFJPY', 'FX:CHFJPY', 'FX_IDC:CHFJPY'],
        spreadRatio: 0.00006
    },
    'AUD/USD': {
        regions: ['forex', 'global'],
        tickers: ['OANDA:AUDUSD', 'FX:AUDUSD', 'FX_IDC:AUDUSD'],
        preferred: ['OANDA:AUDUSD', 'FX:AUDUSD', 'FX_IDC:AUDUSD'],
        spreadRatio: 0.00006
    },
    'BTC/USD': {
        regions: ['crypto', 'global'],
        tickers: ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD', 'BITSTAMP:BTCUSD'],
        preferred: ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD', 'BITSTAMP:BTCUSD'],
        spreadRatio: 0.00006
    },
    'ETH/USD': {
        regions: ['crypto', 'global'],
        tickers: ['BINANCE:ETHUSDT', 'COINBASE:ETHUSD', 'BITSTAMP:ETHUSD'],
        preferred: ['BINANCE:ETHUSDT', 'COINBASE:ETHUSD', 'BITSTAMP:ETHUSD'],
        spreadRatio: 0.00007
    },
    'SOL/USD': {
        regions: ['crypto', 'global'],
        tickers: ['BINANCE:SOLUSDT', 'COINBASE:SOLUSD', 'KRAKEN:SOLUSD'],
        preferred: ['BINANCE:SOLUSDT', 'COINBASE:SOLUSD', 'KRAKEN:SOLUSD'],
        spreadRatio: 0.00009
    },
    'AAPL/USD': {
        regions: ['america', 'global'],
        tickers: ['NASDAQ:AAPL'],
        preferred: ['NASDAQ:AAPL'],
        spreadRatio: 0.00009
    },
    'TSLA/USD': {
        regions: ['america', 'global'],
        tickers: ['NASDAQ:TSLA'],
        preferred: ['NASDAQ:TSLA'],
        spreadRatio: 0.0001
    },
    'NVDA/USD': {
        regions: ['america', 'global'],
        tickers: ['NASDAQ:NVDA'],
        preferred: ['NASDAQ:NVDA'],
        spreadRatio: 0.0001
    },
    'SPX500/USD': {
        regions: ['cfd', 'global'],
        tickers: ['OANDA:SPX500USD', 'TVC:SPX'],
        preferred: ['OANDA:SPX500USD', 'TVC:SPX'],
        spreadRatio: 0.00009
    },
    'NAS100/USD': {
        regions: ['cfd', 'global'],
        tickers: ['OANDA:NAS100USD', 'TVC:NDX'],
        preferred: ['OANDA:NAS100USD', 'TVC:NDX'],
        spreadRatio: 0.00009
    },
    'US30/USD': {
        regions: ['cfd', 'global'],
        tickers: ['OANDA:US30USD', 'TVC:DJI'],
        preferred: ['OANDA:US30USD', 'TVC:DJI'],
        spreadRatio: 0.00009
    }
};
const TRADINGVIEW_CACHE_MS = parsePositiveInt(process.env.TRADINGVIEW_CACHE_MS, 450);
const tradingViewCache = {};

async function fetchTradingViewXauTick(symbol) {
    const cfg = tradingViewSymbolConfig[symbol];
    if (!cfg) return null;

    const decimals = INSTRUMENTS[symbol]?.decimals ?? 5;
    const minMove = 1 / (10 ** decimals);
    const cacheKey = `tradingview_${symbol.replace(/\W+/g, '_').toLowerCase()}_tick`;
    const now = Date.now();
    if (tradingViewCache[cacheKey] && (now - tradingViewCache[cacheKey].timestamp) < TRADINGVIEW_CACHE_MS) {
        return tradingViewCache[cacheKey].data;
    }

    const fetch = (await import('node-fetch')).default;
    const payload = {
        symbols: { tickers: cfg.tickers, query: { types: [] } },
        columns: ['close', 'open', 'high', 'low', 'change', 'volume', 'description']
    };

    for (const region of cfg.regions) {
        try {
            const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
                method: 'POST',
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'https://www.tradingview.com',
                    'Referer': 'https://www.tradingview.com/'
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            const rows = Array.isArray(data?.data) ? data.data : [];
            if (rows.length === 0) continue;

            const preferred = cfg.preferred
                .map(ticker => rows.find(r => r?.s === ticker))
                .find(Boolean) || rows[0];
            const d = Array.isArray(preferred?.d) ? preferred.d : [];
            const price = Number(d[0]);
            if (!Number.isFinite(price) || price <= 0) continue;

            const spread = Math.max(price * cfg.spreadRatio, minMove * 8);
            const bid = parseFloat((price - spread / 2).toFixed(decimals));
            const ask = parseFloat((price + spread / 2).toFixed(decimals));

            const tick = {
                price: parseFloat(price.toFixed(decimals)),
                bid,
                ask,
                spread: parseFloat((ask - bid).toFixed(decimals)),
                open: Number.isFinite(Number(d[1])) ? Number(d[1]) : undefined,
                high: Number.isFinite(Number(d[2])) ? Number(d[2]) : undefined,
                low: Number.isFinite(Number(d[3])) ? Number(d[3]) : undefined,
                change24h: Number.isFinite(Number(d[4])) ? Number(d[4]) : undefined,
                volume24h: Number.isFinite(Number(d[5])) ? Number(d[5]) : undefined,
                provider: 'tradingview',
                source: 'tradingview',
                providerRegion: symbol === 'XAU/USD' ? 'cfd' : region,
                providerSymbol: preferred?.s || null,
                providerDescription: typeof d[6] === 'string' ? d[6] : null,
                timestamp: Date.now()
            };

            tradingViewCache[cacheKey] = { data: tick, timestamp: now };
            return tick;
        } catch (e) {
            console.log(`TradingView ${region} ${symbol} failed:`, e.message);
        }
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
    const coinMap = { 'BTC/USD': 'bitcoin', 'ETH/USD': 'ethereum', 'SOL/USD': 'solana' };
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
                timestamp: Date.now(),
                provider: 'coingecko',
                source: 'coingecko'
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
const binanceSymbols = { 'BTC/USD': 'BTCUSDT', 'ETH/USD': 'ETHUSDT', 'SOL/USD': 'SOLUSDT' };

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
                timestamp: Date.now(),
                provider: 'binance',
                source: 'binance'
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
const krakenSymbols = { 'BTC/USD': 'XXBTZUSD', 'ETH/USD': 'XETHZUSD', 'SOL/USD': 'SOLUSD' };

function isCryptoInstrument(symbol) {
    return symbol === 'BTC/USD' || symbol === 'ETH/USD' || symbol === 'SOL/USD';
}

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
                timestamp: Date.now(),
                provider: 'kraken',
                source: 'kraken'
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

function normalizeOutputsize(value, min = 20, max = 2000) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return 200;
    return Math.min(max, Math.max(min, parsed));
}

function intervalToSeconds(interval = '1min') {
    const map = { '1s': 1, '5s': 5, '15s': 15, '30s': 30, '1min': 60, '3min': 180, '5min': 300, '15min': 900, '1h': 3600, '4h': 14400 };
    return map[interval] || 60;
}

function buildTickAlignedHistory(symbol, interval, outputsize, anchorPrice) {
    const config = INSTRUMENTS[symbol] || INSTRUMENTS['XAU/USD'];
    const decimals = config.decimals ?? 2;
    const stepSec = intervalToSeconds(interval);
    const count = normalizeOutputsize(outputsize);
    const now = Math.floor(Date.now() / 1000);
    const candles = [];

    // Keep XAU "tick-history" smooth and near current spot.
    let lastClose = Number(anchorPrice);
    for (let i = count - 1; i >= 0; i--) {
        const t = now - (i * stepSec);
        const noise = (Math.random() - 0.5) * config.volatility * 0.6;
        const drift = Math.sin((t / stepSec) * 0.08) * config.volatility * 0.2;
        const open = lastClose;
        const close = open * (1 + noise + drift);
        const high = Math.max(open, close) * (1 + Math.random() * config.volatility * 0.35);
        const low = Math.min(open, close) * (1 - Math.random() * config.volatility * 0.35);
        candles.push({
            time: t,
            open: Number(open.toFixed(decimals)),
            high: Number(high.toFixed(decimals)),
            low: Number(low.toFixed(decimals)),
            close: Number(close.toFixed(decimals)),
            volume: Math.floor(Math.random() * 500 + 200)
        });
        lastClose = close;
    }

    if (candles.length > 0) {
        const shift = Number(anchorPrice) - candles[candles.length - 1].close;
        if (Number.isFinite(shift) && Math.abs(shift) > 0) {
            for (const c of candles) {
                c.open = Number((c.open + shift).toFixed(decimals));
                c.high = Number((c.high + shift).toFixed(decimals));
                c.low = Number((c.low + shift).toFixed(decimals));
                c.close = Number((c.close + shift).toFixed(decimals));
            }
        }
    }

    return candles;
}

// ============================================================
//  ROUTES
// ============================================================

function getLiveTickSourceChain(symbol) {
    const sources = [];
    sources.push(() => fetchMt5BridgeTick(symbol));
    const hasPrimary = !!getPrimaryExchangeDescriptor(symbol);
    if (hasPrimary) {
        // Direct exchange feed (or bridge to direct exchange infra) before vendor aggregators.
        sources.push(() => fetchPrimaryExchangeTick(symbol));
    }

    if (isCryptoInstrument(symbol)) {
        // Priority for lowest-latency crypto feeds.
        sources.push(() => fetchBinanceTick(symbol));
        sources.push(() => fetchKrakenTick(symbol));
        sources.push(() => fetchTradingViewXauTick(symbol));
        sources.push(() => fetchCryptoTick(symbol));
        return sources;
    }

    if (symbol === 'XAU/USD') {
        // Swissquote is typically faster for XAU spot updates.
        sources.push(() => fetchSwissquoteTick(symbol));
        sources.push(() => fetchTradingViewXauTick(symbol));
        return sources;
    }

    // Forex / stocks / indices / commodities.
    sources.push(() => fetchTradingViewXauTick(symbol));
    return sources;
}

async function runTickSourceWithTimeout(fetchFn, timeoutMs) {
    try {
        return await Promise.race([
            Promise.resolve().then(() => fetchFn()),
            new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ]);
    } catch {
        return null;
    }
}

async function fetchBestLiveTick(symbol) {
    const sources = getLiveTickSourceChain(symbol);
    if (!sources.length) return null;

    const fastTimeout = Math.max(250, LIVE_TICK_SOURCE_TIMEOUT_MS);
    try {
        const racedTick = await Promise.any(
            sources.map((fetchFn) =>
                runTickSourceWithTimeout(fetchFn, fastTimeout).then((tick) => {
                    if (tick) return tick;
                    throw new Error('empty tick');
                })
            )
        );
        if (racedTick) return racedTick;
    } catch {
        // Fallback below keeps compatibility if all fast attempts miss.
    }

    for (const fetchFn of sources) {
        const tick = await runTickSourceWithTimeout(fetchFn, fastTimeout * 2);
        if (tick) return tick;
    }

    return null;
}

function buildRithmicQueryString(queryObj = {}) {
    const params = new URLSearchParams();
    Object.entries(queryObj).forEach(([key, rawVal]) => {
        if (rawVal === undefined || rawVal === null || rawVal === '') return;
        if (Array.isArray(rawVal)) {
            rawVal.forEach((v) => {
                if (v === undefined || v === null || v === '') return;
                params.append(key, String(v));
            });
            return;
        }
        params.set(key, String(rawVal));
    });
    const built = params.toString();
    return built ? `?${built}` : '';
}

function buildRithmicPath(rawPath) {
    const normalized = String(rawPath || '').trim();
    if (!normalized) return '/';
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) return '/';
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function rithmicConfigSnapshot() {
    return {
        enabled: RITHMIC_ENABLED,
        configured: Boolean(RITHMIC_API_BASE_URL),
        baseUrl: RITHMIC_API_BASE_URL || null,
        accountHint: RITHMIC_ACCOUNT_HINT || null,
        tokenConfigured: Boolean(RITHMIC_API_TOKEN),
        timeoutMs: RITHMIC_TIMEOUT_MS,
    };
}

async function callRithmicUpstream({ method = 'GET', pathName = '/', query = {}, body = undefined }) {
    if (!RITHMIC_ENABLED) {
        return {
            ok: false,
            status: 503,
            payload: { success: false, error: 'rithmic_disabled', message: 'Set RITHMIC_ENABLED=true to activate bridge.' }
        };
    }
    if (!RITHMIC_API_BASE_URL) {
        return {
            ok: false,
            status: 503,
            payload: { success: false, error: 'rithmic_not_configured', message: 'Set RITHMIC_API_BASE_URL in env.' }
        };
    }

    const targetPath = buildRithmicPath(pathName);
    const queryString = buildRithmicQueryString(query);
    const url = `${RITHMIC_API_BASE_URL}${targetPath}${queryString}`;

    const headers = {
        Accept: 'application/json',
    };
    if (RITHMIC_API_TOKEN) {
        headers.Authorization = `Bearer ${RITHMIC_API_TOKEN}`;
        headers['X-API-Key'] = RITHMIC_API_TOKEN;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), RITHMIC_TIMEOUT_MS);

    try {
        const options = {
            method,
            headers,
            signal: controller.signal,
        };
        if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        const text = await response.text();
        let payload = null;
        try {
            payload = text ? JSON.parse(text) : {};
        } catch {
            payload = { raw: text };
        }

        return {
            ok: response.ok,
            status: response.status,
            payload,
            url
        };
    } catch (error) {
        return {
            ok: false,
            status: 502,
            payload: {
                success: false,
                error: 'rithmic_upstream_unreachable',
                message: error && error.message ? error.message : 'Unknown upstream error'
            },
            url
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
}

// Get live price for any instrument
app.get('/api/price', async (req, res) => {
    const symbol = req.query.symbol || 'XAU/USD';
    const state = instrumentState[symbol];
    if (!state) return res.json({ success: false, error: 'Unknown symbol' });

    if (isMarketClosed(symbol)) {
        const price = state.lastKnownPrice || INSTRUMENTS[symbol]?.basePrice || 0;
        const payload = {
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
        };
        updateInstrumentTickState(symbol, payload);
        return res.json(payload);
    }

    const liveData = await fetchBestLiveTick(symbol);
    if (liveData) {
        const payload = {
            success: true,
            source: liveData.source || liveData.provider || 'live',
            symbol,
            ...liveData
        };
        updateInstrumentTickState(symbol, payload);
        return res.json(payload);
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
                const payload = {
                    success: true, source: 'yahoo', symbol, price,
                    bid: price * 0.9999, ask: price * 1.0001,
                    spread: parseFloat((price * 0.0002).toFixed(2)),
                    timestamp: Date.now()
                };
                updateInstrumentTickState(symbol, payload);
                return res.json(payload);
            }
        } catch (e) { /* fall through */ }
    }

    // Last resort: simulated
    const candle = addSimulatedCandle(symbol);
    const fallbackPayload = {
        success: true, source: 'simulated', symbol,
        price: candle.close, bid: candle.close * 0.9999, ask: candle.close * 1.0001,
        spread: parseFloat((candle.close * 0.0002).toFixed(2)), timestamp: Date.now()
    };
    updateInstrumentTickState(symbol, fallbackPayload);
    res.json(fallbackPayload);
});

// Get candlestick history
app.get('/api/history', async (req, res) => {
    const symbol = req.query.symbol || 'XAU/USD';
    const interval = req.query.interval || '1min';
    const outputsize = normalizeOutputsize(req.query.outputsize);
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

    const mt5History = getMt5BridgeHistory(symbol, interval, outputsize);
    if (mt5History && mt5History.length > 10) {
        const latest = mt5History[mt5History.length - 1];
        if (latest?.close > 0) state.lastKnownPrice = latest.close;
        return res.json({
            success: true,
            source: 'mt5-bridge',
            symbol,
            data: mt5History.slice(-outputsize)
        });
    }

    // Multi-source candle chain (ordered by reliability)
    const sources = [];

    if (symbol === 'XAU/USD') {
        try {
            const xauTick = await fetchTradingViewXauTick(symbol);
            if (xauTick && Number.isFinite(xauTick.price)) {
                const data = buildTickAlignedHistory(symbol, interval, outputsize, xauTick.price);
                if (data.length > 0) {
                    state.lastKnownPrice = xauTick.price;
                    return res.json({ success: true, source: 'tick-history', symbol, data: data.slice(-outputsize) });
                }
            }
        } catch (e) {
            console.log(`tick-history ${symbol} failed:`, e.message);
        }
    }

    if (isCryptoInstrument(symbol)) {
        // Crypto: Binance → Kraken → Yahoo → TwelveData
        sources.push({ name: 'binance', fn: () => fetchBinanceHistory(symbol, interval, outputsize) });
        sources.push({ name: 'kraken', fn: () => fetchKrakenHistory(symbol, interval, outputsize) });
    }
    sources.push({ name: 'yahoo', fn: () => fetchYahooFinanceHistory(symbol, interval, outputsize) });
    sources.push({ name: 'twelvedata', fn: () => fetchTwelveData(symbol, interval, outputsize) });

    for (const src of sources) {
        try {
            const data = await src.fn();
            if (data && data.length > 10) {
                state.lastKnownPrice = data[data.length - 1].close;
                return res.json({ success: true, source: src.name, symbol, data: data.slice(-outputsize) });
            }
        } catch (e) {
            console.log(`${src.name} history ${symbol} failed:`, e.message);
        }
    }

    // Last fallback for XAU/USD: align simulated candles to TradingView spot tick.
    if (symbol === 'XAU/USD') {
        try {
            const tvTick = await fetchTradingViewXauTick(symbol);
            if (tvTick && Number.isFinite(tvTick.price)) {
                state.lastKnownPrice = tvTick.price;
            }
        } catch (e) { /* ignore */ }
    }

    // Fallback: simulated
    if (state.simulatedHistory.length === 0) initSimulatedHistory(symbol, outputsize);
    res.json({ success: true, source: 'simulated', symbol, data: state.simulatedHistory.slice(-outputsize) });
});

// Available instruments
app.get('/api/instruments', (req, res) => {
    const list = Object.entries(INSTRUMENTS).map(([symbol, config]) => ({
        symbol,
        name: config.name,
        icon: config.icon,
        price: instrumentState[symbol].lastKnownPrice,
        primaryExchange: getPrimaryExchangeDescriptor(symbol)?.venue || null
    }));
    res.json({ success: true, instruments: list });
});

app.get('/api/primary-exchange/status', async (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    const probe = parseBoolean(req.query.probe, false);
    const entries = Object.entries(primaryExchangeRouting)
        .filter(([k]) => !symbol || k === symbol)
        .map(([k, descriptor]) => {
            const cacheKey = `${descriptor.provider}_${k}`;
            const cached = primaryExchangeTickCache[cacheKey];
            const venueLicense = getPrimaryLicenseForVenue(descriptor.venue);
            return {
                symbol: k,
                venue: descriptor.venue,
                provider: descriptor.provider,
                ticker: descriptor.ticker || descriptor.endpointSymbol || null,
                configured: !!(descriptor.ticker || descriptor.endpointUrl || PRIMARY_EXCHANGE_BRIDGE_URL),
                endpointConfigured: !!descriptor.endpointUrl,
                licenseConfigured: venueLicense.configured,
                licenseStatus: venueLicense.status,
                cacheAgeMs: cached ? (Date.now() - toNum(cached.timestamp, 0)) : null,
                cachedSource: cached?.data?.source || null
            };
        });

    const euronextConfigured = euronextWatchlist.map((item) => ({
        market: item.market,
        venue: item.venue,
        symbol: item.symbol,
        endpointConfigured: !!item.endpointUrl
    }));

    let probeResult = null;
    if (probe && symbol && primaryExchangeRouting[symbol]) {
        const t0 = Date.now();
        const tick = await fetchPrimaryExchangeTick(symbol);
        probeResult = {
            symbol,
            ok: !!tick,
            latencyMs: Date.now() - t0,
            source: tick?.source || null,
            price: Number.isFinite(Number(tick?.price)) ? Number(tick.price) : null,
            timestamp: toNum(tick?.timestamp, null)
        };
    }

    res.json({
        success: true,
        enabled: ENABLE_PRIMARY_EXCHANGE_FEEDS,
        timeoutMs: PRIMARY_EXCHANGE_TIMEOUT_MS,
        cacheMs: PRIMARY_EXCHANGE_CACHE_MS,
        licenseMode: PRIMARY_LICENSE_MODE,
        licenses: buildPrimaryLicenseStatusMap(),
        bridgeConfigured: !!PRIMARY_EXCHANGE_BRIDGE_URL,
        routes: entries,
        euronextWatchlist: euronextConfigured,
        probe: probeResult
    });
});

app.get('/api/primary-exchange/licenses', (req, res) => {
    res.json({
        success: true,
        enabled: ENABLE_PRIMARY_EXCHANGE_FEEDS,
        mode: PRIMARY_LICENSE_MODE,
        bridgeConfigured: !!PRIMARY_EXCHANGE_BRIDGE_URL,
        bridgeTokenConfigured: !!PRIMARY_EXCHANGE_BRIDGE_TOKEN,
        licenses: buildPrimaryLicenseStatusMap()
    });
});

// ============================================================
//  MULTI-AI ENGINE — Gemini, Groq, OpenRouter, Ollama
// ============================================================

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const TRADING_AGENTS_API_URL = String(process.env.TRADING_AGENTS_API_URL || '').trim();
const TRADING_AGENTS_API_KEY = String(process.env.TRADING_AGENTS_API_KEY || '').trim();
const TRADING_AGENTS_TIMEOUT_MS = parsePositiveInt(process.env.TRADING_AGENTS_TIMEOUT_MS, 45000);
const TRADING_AGENTS_MODEL_LABEL = String(process.env.TRADING_AGENTS_MODEL_LABEL || 'TradingAgents Graph').trim() || 'TradingAgents Graph';
const TRADING_AGENTS_INCLUDE_IN_AUTO = parseBoolean(process.env.TRADING_AGENTS_INCLUDE_IN_AUTO, false);
const TRADING_AGENTS_ENABLED = !!TRADING_AGENTS_API_URL;

// Signal history storage
const SIGNAL_HISTORY_FILE = path.join(__dirname, 'signal_history.json');
const MT5_EXECUTION_LOG_FILE = path.join(__dirname, 'mt5_execution_log.json');
const MT5_BOT_STATE_FILE = path.join(__dirname, 'mt5_bot_state.json');
const MT5_COMMAND_STATE_FILE = path.join(__dirname, 'mt5_command_state.json');
const MT5_BRIDGE_TOKEN = String(process.env.MT5_BRIDGE_TOKEN || SITE_ACCESS_CODE || '').trim();
const MT5_BRIDGE_STALE_MS = parsePositiveInt(process.env.MT5_BRIDGE_STALE_MS, 12000);
const MT5_BRIDGE_HISTORY_MAX = parsePositiveInt(process.env.MT5_BRIDGE_HISTORY_MAX, 3000);
const MT5_SIGNAL_MAX_AGE_MS = parsePositiveInt(process.env.MT5_SIGNAL_MAX_AGE_MS, 180000);
const MT5_COMMAND_TTL_MS = parsePositiveInt(process.env.MT5_COMMAND_TTL_MS, 45000);
const MT5_MANUAL_COMMAND_TTL_MS = parsePositiveInt(process.env.MT5_MANUAL_COMMAND_TTL_MS, 900000);
const MT5_MIN_CONFIDENCE = Math.min(95, Math.max(1, parsePositiveInt(process.env.MT5_MIN_CONFIDENCE, 55)));
const MT5_LIVE_GUARD_DEFAULT_ARMED = parseBoolean(process.env.MT5_LIVE_GUARD_DEFAULT_ARMED, true);

const mt5BridgeTicks = {};
const mt5BridgeHistory = {};

const MT5_BRIDGE_SYMBOL_ALIASES = {
    XAUUSD: 'XAU/USD',
    XAUUSDM: 'XAU/USD',
    GOLD: 'XAU/USD',
    XAGUSD: 'XAG/USD',
    XAGUSDM: 'XAG/USD',
    WTIUSD: 'WTI/USD',
    USOIL: 'WTI/USD',
    EURUSD: 'EUR/USD',
    GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY',
    CHFJPY: 'CHF/JPY',
    CHFJPYM: 'CHF/JPY',
    AUDUSD: 'AUD/USD',
    BTCUSD: 'BTC/USD',
    BTCUSDM: 'BTC/USD',
    ETHUSD: 'ETH/USD',
    ETHUSDM: 'ETH/USD',
    SOLUSD: 'SOL/USD',
    SOLUSDM: 'SOL/USD',
    AAPL: 'AAPL/USD',
    TSLA: 'TSLA/USD',
    NVDA: 'NVDA/USD',
    SPX500: 'SPX500/USD',
    NAS100: 'NAS100/USD',
    US30: 'US30/USD'
};

function normalizeMt5BridgeSymbol(rawSymbol = '') {
    const direct = String(rawSymbol || '').trim();
    if (INSTRUMENTS[direct]) return direct;

    const compact = direct.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!compact) return '';

    if (MT5_BRIDGE_SYMBOL_ALIASES[compact]) return MT5_BRIDGE_SYMBOL_ALIASES[compact];

    if (compact.endsWith('M') && MT5_BRIDGE_SYMBOL_ALIASES[compact.slice(0, -1)]) {
        return MT5_BRIDGE_SYMBOL_ALIASES[compact.slice(0, -1)];
    }

    if (compact.length >= 6) {
        const guess = `${compact.slice(0, 3)}/${compact.slice(3, 6)}`;
        if (INSTRUMENTS[guess]) return guess;
    }

    return '';
}

function toUnixMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1_000_000_000_000) return Math.round(value);
        if (value > 1_000_000_000) return Math.round(value * 1000);
    }
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function toUnixMsStrict(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1_000_000_000_000) return Math.round(value);
        if (value > 1_000_000_000) return Math.round(value * 1000);
        return value > 0 ? Math.round(value) : 0;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBridgeInterval(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '1min';
    if (raw === 'm1' || raw === '1m' || raw === '1min') return '1min';
    if (raw === 'm5' || raw === '5m' || raw === '5min') return '5min';
    if (raw === 'm15' || raw === '15m' || raw === '15min') return '15min';
    if (raw === 'h1' || raw === '1h') return '1h';
    if (raw === 'h4' || raw === '4h') return '4h';
    return raw;
}

function normalizeBridgeCandles(symbol, candlesInput = []) {
    if (!Array.isArray(candlesInput) || candlesInput.length === 0) return [];
    const decimals = INSTRUMENTS[symbol]?.decimals ?? 2;

    const normalized = candlesInput.map((row) => {
        const timeMs = toUnixMs(row?.time);
        const timeSec = Math.floor(timeMs / 1000);
        const open = toNum(row?.open, NaN);
        const high = toNum(row?.high, NaN);
        const low = toNum(row?.low, NaN);
        const close = toNum(row?.close, NaN);
        const volume = Math.max(0, toNum(row?.volume, 0));
        if (!(timeSec > 0) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
            return null;
        }
        return {
            time: timeSec,
            open: Number(open.toFixed(decimals)),
            high: Number(high.toFixed(decimals)),
            low: Number(low.toFixed(decimals)),
            close: Number(close.toFixed(decimals)),
            volume
        };
    }).filter(Boolean);

    if (!normalized.length) return [];

    const unique = new Map();
    for (const candle of normalized) unique.set(candle.time, candle);
    return [...unique.values()]
        .sort((a, b) => a.time - b.time)
        .slice(-MT5_BRIDGE_HISTORY_MAX);
}

function aggregateCandlesByStep(candles, stepSec, outputsize = 200) {
    const input = Array.isArray(candles) ? candles : [];
    if (!input.length || !(stepSec > 0)) return [];

    const buckets = [];
    let current = null;

    for (const c of input) {
        const bucketTime = Math.floor(c.time / stepSec) * stepSec;
        if (!current || current.time !== bucketTime) {
            if (current) buckets.push(current);
            current = {
                time: bucketTime,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume
            };
            continue;
        }
        current.high = Math.max(current.high, c.high);
        current.low = Math.min(current.low, c.low);
        current.close = c.close;
        current.volume += c.volume;
    }
    if (current) buckets.push(current);
    return buckets.slice(-outputsize);
}

function getMt5BridgeHistory(symbol, interval = '1min', outputsize = 200) {
    const pack = mt5BridgeHistory[symbol];
    if (!pack || !Array.isArray(pack.candles) || pack.candles.length < 8) return null;

    const maxHistoryAgeMs = Math.max(MT5_BRIDGE_STALE_MS * 25, 8 * 60 * 1000);
    if ((Date.now() - toNum(pack.updatedAtMs, 0)) > maxHistoryAgeMs) return null;

    const safeOutput = normalizeOutputsize(outputsize, 20, 2000);
    const normalizedInterval = normalizeBridgeInterval(interval);

    if (normalizedInterval === '1min') {
        return pack.candles.slice(-safeOutput);
    }

    const step = intervalToSeconds(normalizedInterval);
    if (step < 60 || step % 60 !== 0) return null;

    return aggregateCandlesByStep(pack.candles, step, safeOutput);
}

function fetchMt5BridgeTick(symbol) {
    const tick = mt5BridgeTicks[symbol];
    if (!tick) return null;
    const now = Date.now();
    if ((now - toNum(tick.timestamp, 0)) > MT5_BRIDGE_STALE_MS) return null;
    return {
        price: toNum(tick.price, 0),
        bid: toNum(tick.bid, toNum(tick.price, 0)),
        ask: toNum(tick.ask, toNum(tick.price, 0)),
        spread: toNum(tick.spread, 0),
        timestamp: toNum(tick.timestamp, now),
        provider: 'mt5-bridge',
        source: 'mt5-bridge',
        brokerSymbol: tick.brokerSymbol || null
    };
}

function readMt5BotState() {
    try {
        if (!fs.existsSync(MT5_BOT_STATE_FILE)) return null;
        const raw = fs.readFileSync(MT5_BOT_STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        console.log('MT5 bot state load error:', e.message);
        return null;
    }
}

function buildDefaultMt5BotState() {
    return {
        status: 'STOPPED',
        activeBotId: null,
        params: {},
        mode: 'live',
        revision: 0,
        updatedAt: null,
        note: '',
        lastHeartbeatAt: null,
        heartbeat: null,
        lastExecutionAt: null
    };
}

let mt5BotState = Object.assign(buildDefaultMt5BotState(), readMt5BotState() || {});

function saveMt5BotState() {
    try {
        fs.writeFileSync(MT5_BOT_STATE_FILE, JSON.stringify(mt5BotState, null, 2));
    } catch (e) {
        console.log('MT5 bot state save error:', e.message);
    }
}

function readBridgeTokenFromReq(req) {
    const fromHeader = typeof req.headers['x-mt5-token'] === 'string' ? req.headers['x-mt5-token'] : '';
    const fromBody = typeof req.body?.token === 'string' ? req.body.token : '';
    const fromQuery = typeof req.query?.token === 'string' ? req.query.token : '';
    return String(fromHeader || fromBody || fromQuery || '').trim();
}

function isMt5BridgeAuthorized(req) {
    if (!MT5_BRIDGE_TOKEN) return true;
    return readBridgeTokenFromReq(req) === MT5_BRIDGE_TOKEN;
}

const mt5BridgeAuthTelemetry = {
    unauthorizedTotal: 0,
    byEndpoint: {},
    lastFailureAt: null,
    lastFailureEndpoint: null,
    lastFailureReason: null
};

function trackMt5BridgeUnauthorized(req, endpoint, reason = 'mt5_bridge_token_invalid') {
    const key = String(endpoint || req?.path || 'unknown').trim() || 'unknown';
    mt5BridgeAuthTelemetry.unauthorizedTotal += 1;
    mt5BridgeAuthTelemetry.byEndpoint[key] = toNum(mt5BridgeAuthTelemetry.byEndpoint[key], 0) + 1;
    mt5BridgeAuthTelemetry.lastFailureAt = new Date().toISOString();
    mt5BridgeAuthTelemetry.lastFailureEndpoint = key;
    mt5BridgeAuthTelemetry.lastFailureReason = String(reason || 'mt5_bridge_token_invalid');
}

function buildDefaultMt5CommandState() {
    return {
        lastIssuedByScope: {},
        lastAckByScope: {},
        pendingById: {},
        ackById: {},
        liveGuardArmed: MT5_LIVE_GUARD_DEFAULT_ARMED,
        liveGuardUpdatedAt: null,
        liveGuardReason: '',
        liveGuardChangedBy: 'bootstrap',
        updatedAt: null
    };
}

function readMt5CommandState() {
    try {
        if (!fs.existsSync(MT5_COMMAND_STATE_FILE)) return null;
        const raw = fs.readFileSync(MT5_COMMAND_STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        console.log('MT5 command state load error:', e.message);
        return null;
    }
}

let mt5CommandState = Object.assign(buildDefaultMt5CommandState(), readMt5CommandState() || {});
if (typeof mt5CommandState.liveGuardArmed !== 'boolean') {
    mt5CommandState.liveGuardArmed = MT5_LIVE_GUARD_DEFAULT_ARMED;
}
if (typeof mt5CommandState.liveGuardUpdatedAt !== 'string') {
    mt5CommandState.liveGuardUpdatedAt = null;
}
if (typeof mt5CommandState.liveGuardReason !== 'string') {
    mt5CommandState.liveGuardReason = '';
}
if (typeof mt5CommandState.liveGuardChangedBy !== 'string') {
    mt5CommandState.liveGuardChangedBy = 'bootstrap';
}

function saveMt5CommandState() {
    try {
        mt5CommandState.updatedAt = new Date().toISOString();
        fs.writeFileSync(MT5_COMMAND_STATE_FILE, JSON.stringify(mt5CommandState, null, 2));
    } catch (e) {
        console.log('MT5 command state save error:', e.message);
    }
}

function getMt5LiveGuardSnapshot() {
    return {
        armed: mt5CommandState.liveGuardArmed !== false,
        updatedAt: mt5CommandState.liveGuardUpdatedAt || null,
        reason: String(mt5CommandState.liveGuardReason || '').trim() || '',
        changedBy: String(mt5CommandState.liveGuardChangedBy || '').trim() || 'unknown'
    };
}

function isMt5LiveExecutionArmed() {
    return mt5CommandState.liveGuardArmed !== false;
}

function setMt5LiveExecutionGuard(armed, reason = '', changedBy = 'web-ui') {
    const nowIso = new Date().toISOString();
    mt5CommandState.liveGuardArmed = !!armed;
    mt5CommandState.liveGuardUpdatedAt = nowIso;
    mt5CommandState.liveGuardReason = String(reason || '').trim().slice(0, 220);
    mt5CommandState.liveGuardChangedBy = String(changedBy || 'web-ui').trim().slice(0, 80) || 'web-ui';
    saveMt5CommandState();
    return getMt5LiveGuardSnapshot();
}

function toSignalTimestampMs(signal) {
    if (!signal || typeof signal !== 'object') return 0;
    if (typeof signal.timestampMs === 'number' && Number.isFinite(signal.timestampMs)) return Math.round(signal.timestampMs);
    if (typeof signal.timestamp === 'number' && Number.isFinite(signal.timestamp)) {
        return signal.timestamp > 1_000_000_000_000 ? Math.round(signal.timestamp) : Math.round(signal.timestamp * 1000);
    }
    return toUnixMs(signal.timestamp || signal.time || signal.createdAt || Date.now());
}

function buildSignalFingerprint(signal) {
    if (!signal) return '';
    const ts = toSignalTimestampMs(signal);
    const symbol = String(signal.symbol || '');
    const side = normalizeExecutionSide(signal.signal || signal.side || 'HOLD');
    const entry = toNum(signal.entryPrice, 0).toFixed(5);
    const tp = toNum(signal.takeProfit, 0).toFixed(5);
    const sl = toNum(signal.stopLoss, 0).toFixed(5);
    const confidence = toNum(signal.confidence, 0).toFixed(2);
    return `${symbol}|${side}|${ts}|${entry}|${tp}|${sl}|${confidence}`;
}

function normalizeMt5ScopeKey(accountId, symbol) {
    const account = String(accountId || 'default').trim() || 'default';
    return `${account}|${symbol}`;
}

function normalizeExecutionStatusAny(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'FILLED' || raw === 'PARTIAL' || raw === 'REJECTED' || raw === 'CANCELLED') return raw;
    if (raw === 'DONE' || raw === 'EXECUTED' || raw === 'OK') return 'FILLED';
    if (raw === 'FAIL' || raw === 'FAILED' || raw === 'ERROR') return 'REJECTED';
    return 'FILLED';
}

function cleanupMt5CommandState(nowMs = Date.now()) {
    const pending = mt5CommandState.pendingById || {};
    const acks = mt5CommandState.ackById || {};
    const keepPending = {};
    const keepAck = {};
    const ackRetentionMs = 24 * 60 * 60 * 1000;

    for (const [commandId, cmd] of Object.entries(pending)) {
        const expiresAtMs = toNum(cmd?.expiresAtMs, 0);
        const issuedAtMs = toNum(cmd?.issuedAtMs, 0);
        if (expiresAtMs > 0 && nowMs - expiresAtMs > ackRetentionMs) continue;
        if (issuedAtMs > 0 && nowMs - issuedAtMs > ackRetentionMs * 2) continue;
        keepPending[commandId] = cmd;
    }

    for (const [commandId, ack] of Object.entries(acks)) {
        const ackedAtMs = toNum(ack?.ackedAtMs, 0);
        if (ackedAtMs > 0 && nowMs - ackedAtMs > ackRetentionMs) continue;
        keepAck[commandId] = ack;
    }

    mt5CommandState.pendingById = keepPending;
    mt5CommandState.ackById = keepAck;
}

function normalizeBotAllowedSymbols() {
    if (String(mt5BotState?.activeBotId || '') !== 'ari-scalperm-multi') return null;
    const params = mt5BotState?.params && typeof mt5BotState.params === 'object' ? mt5BotState.params : {};
    const mapped = ['sym1', 'sym2', 'sym3']
        .map((key) => normalizeMt5BridgeSymbol(params[key]))
        .filter((symbol) => !!symbol);
    if (!mapped.length) return null;
    return new Set(mapped);
}

function getLatestExecutableSignalForSymbol(symbol) {
    const history = loadSignalHistory();
    if (!Array.isArray(history) || history.length === 0) return null;
    const now = Date.now();
    const candidates = history
        .filter((s) => s && s.symbol === symbol)
        .map((s) => ({
            ...s,
            __ts: toSignalTimestampMs(s),
            __side: normalizeExecutionSide(s.signal),
            __entry: toNum(s.entryPrice, 0),
            __tp: toNum(s.takeProfit, 0),
            __sl: toNum(s.stopLoss, 0),
            __confidence: toNum(s.confidence, 0)
        }))
        .filter((s) => (s.__side === 'BUY' || s.__side === 'SELL'))
        .filter((s) => s.__entry > 0 && s.__tp > 0 && s.__sl > 0)
        .filter((s) => s.__confidence >= MT5_MIN_CONFIDENCE)
        .filter((s) => s.__ts > 0 && (now - s.__ts) <= MT5_SIGNAL_MAX_AGE_MS)
        .sort((a, b) => b.__ts - a.__ts);

    if (!candidates.length) return null;
    const best = candidates[0];
    return {
        timestamp: best.timestamp,
        timestampMs: best.__ts,
        symbol: best.symbol,
        signal: best.__side,
        confidence: best.__confidence,
        entryPrice: best.__entry,
        takeProfit: best.__tp,
        stopLoss: best.__sl,
        aiModel: best.aiModel || 'backend'
    };
}

function createMt5CommandId(symbol) {
    return `cmd_${symbol.replace(/\W+/g, '').toLowerCase()}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function findManualPendingMt5Command(symbol, accountId, nowMs = Date.now()) {
    const pendingById = mt5CommandState?.pendingById && typeof mt5CommandState.pendingById === 'object'
        ? mt5CommandState.pendingById
        : {};
    const ackById = mt5CommandState?.ackById && typeof mt5CommandState.ackById === 'object'
        ? mt5CommandState.ackById
        : {};

    const candidates = Object.values(pendingById)
        .filter((cmd) => cmd && cmd.manual === true)
        .filter((cmd) => String(cmd.symbol || '') === symbol)
        .filter((cmd) => toNum(cmd.expiresAtMs, 0) > nowMs)
        .filter((cmd) => !ackById[String(cmd.commandId || '')])
        .filter((cmd) => {
            const target = String(cmd.targetAccountId || '').trim();
            return !target || target === accountId;
        })
        .sort((a, b) => toNum(a.issuedAtMs, 0) - toNum(b.issuedAtMs, 0));

    return candidates.length ? candidates[0] : null;
}

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

    const symbol = String(signal?.symbol || '').trim();
    if (symbol && INSTRUMENTS[symbol]) {
        recordRealtimeSignal(symbol);
        const wsPayload = {
            type: 'signal',
            ...signal,
            symbol,
            timestamp: toNum(toTimestampFromSignal(signal?.timestamp), Date.now())
        };
        broadcast(symbol, wsPayload);
        void publishMarketBusEvent('market_signal', wsPayload);
    }
}

function loadMt5ExecutionLog() {
    try {
        if (!fs.existsSync(MT5_EXECUTION_LOG_FILE)) return [];
        const raw = fs.readFileSync(MT5_EXECUTION_LOG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.log('MT5 execution log load error:', e.message);
        return [];
    }
}

function saveMt5ExecutionLog(records) {
    try {
        const list = Array.isArray(records) ? records.slice(-1000) : [];
        fs.writeFileSync(MT5_EXECUTION_LOG_FILE, JSON.stringify(list, null, 2));
    } catch (e) {
        console.log('MT5 execution log save error:', e.message);
    }
}

function toNullableNumber(value, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return clamp(n, min, max);
}

function normalizeExecutionSide(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'BUY' || raw === 'SELL' || raw === 'HOLD') return raw;
    return 'HOLD';
}

function normalizeExecutionStatus(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'FILLED' || raw === 'PARTIAL' || raw === 'REJECTED' || raw === 'CANCELLED') return raw;
    return 'FILLED';
}

function toTimestampFromSignal(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function roundBySymbol(symbol, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const decimals = INSTRUMENTS[symbol]?.decimals ?? 2;
    return Number(value.toFixed(Math.min(Math.max(decimals, 0), 8)));
}

function parseAIResponse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { }
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { } }
    return null;
}

const TRADING_AGENTS_SYMBOL_MAP = {
    'XAU/USD': 'GC=F',
    'XAG/USD': 'SI=F',
    'WTI/USD': 'CL=F',
    'EUR/USD': 'EURUSD=X',
    'GBP/USD': 'GBPUSD=X',
    'USD/JPY': 'JPY=X',
    'CHF/JPY': 'CHFJPY=X',
    'AUD/USD': 'AUDUSD=X',
    'BTC/USD': 'BTC-USD',
    'ETH/USD': 'ETH-USD',
    'SOL/USD': 'SOL-USD',
    'AAPL/USD': 'AAPL',
    'TSLA/USD': 'TSLA',
    'NVDA/USD': 'NVDA',
    'SPX500/USD': '^GSPC',
    'NAS100/USD': '^NDX',
    'US30/USD': '^DJI'
};

function mapSymbolForTradingAgents(symbol = 'XAU/USD') {
    return TRADING_AGENTS_SYMBOL_MAP[symbol] || symbol.replace('/', '').toUpperCase();
}

function currentUtcDateString() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function normalizeAsOfDate(input) {
    const raw = String(input || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return currentUtcDateString();
}

function normalizeDecisionSignal(input) {
    const raw = String(input || '').trim().toUpperCase();
    if (!raw) return null;
    if (raw === 'BUY' || raw === 'SELL' || raw === 'HOLD') return raw;
    if (raw === 'LONG' || raw === 'BULLISH') return 'BUY';
    if (raw === 'SHORT' || raw === 'BEARISH') return 'SELL';
    if (raw === 'NEUTRAL' || raw === 'WAIT') return 'HOLD';
    return null;
}

function inferSignalFromText(text) {
    const raw = String(text || '').toUpperCase();
    if (!raw) return null;
    const buyIdx = raw.search(/\b(BUY|LONG|BULLISH)\b/);
    const sellIdx = raw.search(/\b(SELL|SHORT|BEARISH)\b/);
    const holdIdx = raw.search(/\b(HOLD|NEUTRAL|WAIT)\b/);

    if (buyIdx >= 0 && sellIdx < 0) return 'BUY';
    if (sellIdx >= 0 && buyIdx < 0) return 'SELL';
    if (holdIdx >= 0 && buyIdx < 0 && sellIdx < 0) return 'HOLD';

    if (buyIdx >= 0 && sellIdx >= 0) return buyIdx <= sellIdx ? 'BUY' : 'SELL';
    return holdIdx >= 0 ? 'HOLD' : null;
}

function normalizeTradingAgentsResult(payload = {}, fallbackPrice = 0) {
    const body = (payload && typeof payload === 'object') ? payload : {};
    const decisionNode = (body.decision && typeof body.decision === 'object') ? body.decision : {};
    const candidateSignals = [
        body.signal,
        body.action,
        body.recommendation,
        decisionNode.signal,
        decisionNode.action,
        decisionNode.recommendation
    ];

    let signal = null;
    for (const value of candidateSignals) {
        signal = normalizeDecisionSignal(value);
        if (signal) break;
    }

    const reasoningText = [
        body.reasoning,
        body.summary,
        body.explanation,
        decisionNode.reasoning,
        decisionNode.summary,
        body.decisionText
    ].find((x) => typeof x === 'string' && String(x).trim().length > 0);

    if (!signal) {
        signal = inferSignalFromText(reasoningText || body.rawDecision || body.text || body.decision || '');
    }
    if (!signal) signal = 'HOLD';

    const confidence = clamp(
        Math.round(toNum(
            body.confidence ?? decisionNode.confidence,
            signal === 'HOLD' ? 58 : 64
        )),
        1,
        99
    );

    const entryPrice = signal === 'HOLD'
        ? 0
        : parseFloat(toNum(
            body.entryPrice ?? decisionNode.entryPrice,
            fallbackPrice
        ).toFixed(2));
    const takeProfit = signal === 'HOLD'
        ? 0
        : parseFloat(toNum(
            body.takeProfit ?? decisionNode.takeProfit,
            0
        ).toFixed(2));
    const stopLoss = signal === 'HOLD'
        ? 0
        : parseFloat(toNum(
            body.stopLoss ?? decisionNode.stopLoss,
            0
        ).toFixed(2));

    let reasoning = String(reasoningText || '').trim();
    if (!reasoning) {
        const rawDecision = body.rawDecision ?? body.decision ?? body.text ?? '';
        if (typeof rawDecision === 'string' && rawDecision.trim()) {
            reasoning = rawDecision.trim().slice(0, 380);
        }
    }
    if (!reasoning) {
        reasoning = `TradingAgents recommendation: ${signal}.`;
    }

    return {
        signal,
        confidence,
        reasoning,
        entryPrice,
        takeProfit,
        stopLoss,
        bridgeMeta: {
            rawSignal: body.signal || decisionNode.signal || null,
            asOfDate: body.asOfDate || null,
            ticker: body.ticker || body.symbol || null
        }
    };
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

// ------- TradingAgents bridge -------
async function callTradingAgents(context = {}) {
    if (!TRADING_AGENTS_ENABLED) return null;

    const fetch = (await import('node-fetch')).default;
    const base = TRADING_AGENTS_API_URL.replace(/\/+$/g, '');
    const endpoint = base.endsWith('/decision') ? base : `${base}/decision`;
    const sourceSymbol = String(context.symbol || 'XAU/USD');
    const mappedSymbol = mapSymbolForTradingAgents(sourceSymbol);
    const payload = {
        symbol: mappedSymbol,
        sourceSymbol,
        asOfDate: normalizeAsOfDate(context.asOfDate),
        currentPrice: toNum(context.currentPrice, 0),
        timeframe: String(context.timeframe || ''),
        prompt: String(context.prompt || ''),
        indicators: context.indicators || {},
        candles: Array.isArray(context.candles) ? context.candles.slice(-220) : [],
        patternBias: context.patternBias || null,
        news: Array.isArray(context.newsItems)
            ? context.newsItems.slice(0, 8).map((n) => ({
                title: String(n?.title || ''),
                sentiment: String(n?.sentiment || ''),
                publishedAt: n?.publishedAt || null
            }))
            : []
    };

    const headers = { 'Content-Type': 'application/json' };
    if (TRADING_AGENTS_API_KEY) {
        headers['x-api-key'] = TRADING_AGENTS_API_KEY;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRADING_AGENTS_TIMEOUT_MS);
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!res.ok) {
            const reason = await res.text().catch(() => '');
            console.log(`TradingAgents bridge HTTP ${res.status}: ${reason.slice(0, 180)}`);
            return null;
        }
        const data = await res.json();
        if (!data || typeof data !== 'object' || data.success === false) {
            console.log('TradingAgents bridge invalid payload');
            return null;
        }
        const parsed = normalizeTradingAgentsResult(data, payload.currentPrice);
        if (!parsed || !parsed.signal) return null;
        console.log(`🧩 TradingAgents: ${parsed.signal} (${parsed.confidence}%)`);
        return {
            ...parsed,
            source: 'tradingagents',
            ticker: mappedSymbol
        };
    } catch (e) {
        console.log(`TradingAgents bridge failed: ${e.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// ------- Unified AI Caller -------
async function callAI(prompt, requestedModel = 'auto', context = {}) {
    const providers = [
        {
            name: 'TradingAgents',
            fn: () => callTradingAgents({ ...context, prompt }),
            id: 'tradingagents',
            enabled: TRADING_AGENTS_ENABLED,
            useInAuto: TRADING_AGENTS_INCLUDE_IN_AUTO
        },
        { name: 'GPT-5', fn: () => callOpenRouter(prompt), id: 'gpt-5' },
        { name: 'Claude Opus', fn: () => callOpenRouter(prompt), id: 'claude-opus' },
        { name: 'GLM', fn: () => callOpenRouter(prompt), id: 'glm' },
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
        if (p && p.enabled !== false) {
            try {
                const r = await p.fn();
                if (r) return { ...r, source: requestedModel };
            } catch (e) {
                console.log(`Requested AI ${requestedModel} failed, falling back...`);
            }
        }
    }

    const autoProviders = providers.filter((p) => p.enabled !== false && p.useInAuto !== false);
    for (const p of autoProviders) {
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

// MT5 execution log endpoints
app.get('/api/mt5/execution-log', (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 20;

    const records = loadMt5ExecutionLog()
        .filter((r) => !symbol || r.symbol === symbol)
        .sort((a, b) => toNum(b.executedAtMs, 0) - toNum(a.executedAtMs, 0));

    res.json({
        success: true,
        total: records.length,
        records: records.slice(0, limit),
    });
});

app.post('/api/mt5/execution-log', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';

    if (!symbol || !INSTRUMENTS[symbol]) {
        return res.status(400).json({ success: false, error: 'Invalid or unsupported symbol' });
    }

    const side = normalizeExecutionSide(body.side);
    const status = normalizeExecutionStatus(body.status);
    const volume = toNullableNumber(body.volume, 0, 1_000_000);
    if (!volume || volume <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid volume' });
    }

    const plannedEntry = roundBySymbol(symbol, toNullableNumber(body.plannedEntry, 0, Number.MAX_SAFE_INTEGER));
    const fillPrice = roundBySymbol(symbol, toNullableNumber(body.fillPrice, 0, Number.MAX_SAFE_INTEGER));
    const stopLoss = roundBySymbol(symbol, toNullableNumber(body.stopLoss, 0, Number.MAX_SAFE_INTEGER));
    const takeProfit = roundBySymbol(symbol, toNullableNumber(body.takeProfit, 0, Number.MAX_SAFE_INTEGER));
    const confidence = toNullableNumber(body.confidence, 0, 100);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 400) : '';
    const sourceSignal = typeof body.sourceSignal === 'string' ? body.sourceSignal.trim().slice(0, 80) : '';

    const signalTs = toTimestampFromSignal(body.signalTimestamp);
    const executedAtMs = Date.now();
    const signalAgeMs = signalTs ? Math.max(0, executedAtMs - signalTs) : null;

    let slippageAbs = null;
    let slippageBps = null;
    if (plannedEntry !== null && plannedEntry > 0 && fillPrice !== null && fillPrice > 0) {
        slippageAbs = roundBySymbol(symbol, fillPrice - plannedEntry);
        slippageBps = Number((((fillPrice - plannedEntry) / plannedEntry) * 10000).toFixed(2));
    }

    const record = {
        id: `exec_${executedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date(executedAtMs).toISOString(),
        executedAtMs,
        symbol,
        side,
        status,
        volume: Number(volume.toFixed(3)),
        plannedEntry,
        fillPrice,
        stopLoss,
        takeProfit,
        confidence,
        sourceSignal: sourceSignal || undefined,
        signalTimestamp: signalTs ? new Date(signalTs).toISOString() : undefined,
        signalAgeMs,
        slippageAbs,
        slippageBps,
        note: note || undefined,
    };

    const records = loadMt5ExecutionLog();
    records.push(record);
    saveMt5ExecutionLog(records);

    return res.json({ success: true, record });
});

app.post('/api/mt5/ingest', (req, res) => {
    if (!isMt5BridgeAuthorized(req)) {
        trackMt5BridgeUnauthorized(req, '/api/mt5/ingest');
        return res.status(401).json({ success: false, error: 'mt5_bridge_token_invalid' });
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const rawSymbol = String(body.symbol || body.brokerSymbol || body.mt5Symbol || '').trim();
    const symbol = normalizeMt5BridgeSymbol(rawSymbol);
    if (!symbol || !INSTRUMENTS[symbol]) {
        return res.status(400).json({ success: false, error: 'unsupported_symbol', rawSymbol });
    }

    const decimals = INSTRUMENTS[symbol]?.decimals ?? 2;
    const priceCandidate = toNum(body.price, 0);
    const bidCandidate = toNum(body.bid, 0);
    const askCandidate = toNum(body.ask, 0);
    const derivedPrice = priceCandidate > 0
        ? priceCandidate
        : (bidCandidate > 0 && askCandidate > 0 ? (bidCandidate + askCandidate) / 2 : 0);

    if (!(derivedPrice > 0)) {
        return res.status(400).json({ success: false, error: 'invalid_price' });
    }

    const normalizedPrice = Number(derivedPrice.toFixed(decimals));
    const normalizedBid = Number((bidCandidate > 0 ? bidCandidate : normalizedPrice).toFixed(decimals));
    const normalizedAsk = Number((askCandidate > 0 ? askCandidate : normalizedPrice).toFixed(decimals));
    const spread = Number(Math.max(0, normalizedAsk - normalizedBid).toFixed(decimals));
    const timestampMs = toUnixMs(body.timestamp || body.time || Date.now());
    const interval = normalizeBridgeInterval(body.interval || body.timeframe || '1min');
    const candles = normalizeBridgeCandles(symbol, body.candles);

    updateInstrumentTickState(symbol, {
        source: 'mt5-bridge',
        provider: 'mt5-bridge',
        price: normalizedPrice,
        bid: normalizedBid,
        ask: normalizedAsk,
        spread,
        timestamp: timestampMs
    });

    mt5BridgeTicks[symbol] = {
        symbol,
        brokerSymbol: rawSymbol || null,
        price: normalizedPrice,
        bid: normalizedBid,
        ask: normalizedAsk,
        spread,
        interval,
        timestamp: timestampMs,
        updatedAtMs: Date.now()
    };

    if (candles.length > 0) {
        mt5BridgeHistory[symbol] = {
            symbol,
            brokerSymbol: rawSymbol || null,
            interval,
            candles,
            updatedAtMs: Date.now()
        };
    }

    const wsPayload = {
        type: 'price',
        symbol,
        source: 'mt5-bridge',
        provider: 'mt5-bridge',
        brokerSymbol: rawSymbol || null,
        price: normalizedPrice,
        bid: normalizedBid,
        ask: normalizedAsk,
        spread,
        timestamp: timestampMs
    };
    broadcast(symbol, wsPayload);
    void publishMarketBusEvent('market_tick', wsPayload);

    return res.json({
        success: true,
        symbol,
        source: 'mt5-bridge',
        acceptedCandles: candles.length,
        price: normalizedPrice,
        timestamp: timestampMs
    });
});

app.get('/api/mt5/bots', (req, res) => {
    const bots = listMt5Bots();
    const now = Date.now();
    const onlineSymbols = Object.entries(mt5BridgeTicks)
        .filter(([, tick]) => (now - toNum(tick.timestamp, 0)) <= MT5_BRIDGE_STALE_MS)
        .map(([symbol]) => symbol);
    const heartbeatMs = toUnixMsStrict(mt5BotState?.lastHeartbeatAt);
    const heartbeatOnline = heartbeatMs > 0 && (now - heartbeatMs) <= MT5_BRIDGE_STALE_MS;
    const pendingById = mt5CommandState?.pendingById && typeof mt5CommandState.pendingById === 'object'
        ? mt5CommandState.pendingById
        : {};
    const ackById = mt5CommandState?.ackById && typeof mt5CommandState.ackById === 'object'
        ? mt5CommandState.ackById
        : {};
    const pendingCommands = Object.keys(pendingById).length;
    const ackedCommands = Object.keys(ackById).length;

    const activeBot = mt5BotState.activeBotId ? getMt5BotDefinition(mt5BotState.activeBotId) : null;

    return res.json({
        success: true,
        bots,
        state: {
            status: mt5BotState.status || 'STOPPED',
            activeBotId: mt5BotState.activeBotId || null,
            activeBotName: activeBot?.name || null,
            params: mt5BotState.params || {},
            mode: mt5BotState.mode || 'live',
            revision: toNum(mt5BotState.revision, 0),
            updatedAt: mt5BotState.updatedAt || null,
            note: mt5BotState.note || '',
            lastHeartbeatAt: mt5BotState.lastHeartbeatAt || null,
            heartbeat: mt5BotState.heartbeat || null,
            lastExecutionAt: mt5BotState.lastExecutionAt || null
        },
        bridge: {
            tokenRequired: !!MT5_BRIDGE_TOKEN,
            staleMs: MT5_BRIDGE_STALE_MS,
            manualCommandTtlMs: MT5_MANUAL_COMMAND_TTL_MS,
            onlineSymbols,
            online: heartbeatOnline || onlineSymbols.length > 0,
            heartbeatOnline,
            lastHeartbeatAt: mt5BotState.lastHeartbeatAt || null,
            pendingCommands,
            ackedCommands,
            authFailures: {
                total: toNum(mt5BridgeAuthTelemetry.unauthorizedTotal, 0),
                byEndpoint: mt5BridgeAuthTelemetry.byEndpoint || {},
                lastFailureAt: mt5BridgeAuthTelemetry.lastFailureAt || null,
                lastFailureEndpoint: mt5BridgeAuthTelemetry.lastFailureEndpoint || null,
                lastFailureReason: mt5BridgeAuthTelemetry.lastFailureReason || null
            }
        },
        liveGuard: getMt5LiveGuardSnapshot()
    });
});

app.get('/api/mt5/bots/runtime', (req, res) => {
    const botId = mt5BotState.activeBotId || '';
    const runtimeSource = botId
        ? `/api/mt5/bots/source/${encodeURIComponent(botId)}`
        : null;

    return res.json({
        success: true,
        status: mt5BotState.status || 'STOPPED',
        activeBotId: botId || null,
        params: mt5BotState.params || {},
        revision: toNum(mt5BotState.revision, 0),
        mode: mt5BotState.mode || 'live',
        updatedAt: mt5BotState.updatedAt || null,
        note: mt5BotState.note || '',
        sourceEndpoint: runtimeSource,
        nextCommandEndpoint: '/api/mt5/executor/next',
        ackEndpoint: '/api/mt5/executor/ack',
        heartbeatEndpoint: '/api/mt5/bots/heartbeat',
        executorSourceEndpoint: '/api/mt5/executor/source',
        executorPythonSourceEndpoint: '/api/mt5/executor/python',
        signalMaxAgeMs: MT5_SIGNAL_MAX_AGE_MS,
        commandTtlMs: MT5_COMMAND_TTL_MS,
        manualCommandTtlMs: MT5_MANUAL_COMMAND_TTL_MS,
        minConfidence: MT5_MIN_CONFIDENCE,
        bridgeStaleMs: MT5_BRIDGE_STALE_MS,
        liveGuard: getMt5LiveGuardSnapshot(),
        serverTime: new Date().toISOString()
    });
});

app.get('/api/mt5/diagnostics', (req, res) => {
    const now = Date.now();
    const heartbeatMs = toUnixMsStrict(mt5BotState?.lastHeartbeatAt);
    const pendingById = mt5CommandState?.pendingById && typeof mt5CommandState.pendingById === 'object'
        ? mt5CommandState.pendingById
        : {};
    const ackById = mt5CommandState?.ackById && typeof mt5CommandState.ackById === 'object'
        ? mt5CommandState.ackById
        : {};
    const heartbeatAgeMs = heartbeatMs > 0 ? Math.max(0, now - heartbeatMs) : null;
    const onlineSymbols = Object.entries(mt5BridgeTicks)
        .filter(([, tick]) => (now - toNum(tick.timestamp, 0)) <= MT5_BRIDGE_STALE_MS)
        .map(([symbol]) => symbol);

    return res.json({
        success: true,
        mt5: {
            status: String(mt5BotState?.status || 'STOPPED'),
            activeBotId: mt5BotState?.activeBotId || null,
            lastHeartbeatAt: mt5BotState?.lastHeartbeatAt || null,
            heartbeatAgeMs,
            heartbeatOnline: heartbeatMs > 0 && heartbeatAgeMs !== null && heartbeatAgeMs <= MT5_BRIDGE_STALE_MS,
            bridgeOnline: onlineSymbols.length > 0,
            staleAfterMs: MT5_BRIDGE_STALE_MS,
            onlineSymbols,
            pendingCommands: Object.keys(pendingById).length,
            ackedCommands: Object.keys(ackById).length,
            liveGuard: getMt5LiveGuardSnapshot()
        },
        bridgeAuth: {
            tokenRequired: !!MT5_BRIDGE_TOKEN,
            unauthorizedTotal: toNum(mt5BridgeAuthTelemetry.unauthorizedTotal, 0),
            byEndpoint: mt5BridgeAuthTelemetry.byEndpoint || {},
            lastFailureAt: mt5BridgeAuthTelemetry.lastFailureAt || null,
            lastFailureEndpoint: mt5BridgeAuthTelemetry.lastFailureEndpoint || null,
            lastFailureReason: mt5BridgeAuthTelemetry.lastFailureReason || null
        },
        runtime: {
            signalMaxAgeMs: MT5_SIGNAL_MAX_AGE_MS,
            commandTtlMs: MT5_COMMAND_TTL_MS,
            manualCommandTtlMs: MT5_MANUAL_COMMAND_TTL_MS,
            minConfidence: MT5_MIN_CONFIDENCE
        }
    });
});

app.get('/api/mt5/live-guard', (req, res) => {
    return res.json({
        success: true,
        liveGuard: getMt5LiveGuardSnapshot()
    });
});

app.post('/api/mt5/live-guard', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const armedRaw = body.armed;
    let armed = null;

    if (typeof armedRaw === 'boolean') {
        armed = armedRaw;
    } else if (typeof armedRaw === 'string') {
        const normalized = armedRaw.trim().toLowerCase();
        if (['true', '1', 'on', 'yes', 'armed'].includes(normalized)) armed = true;
        if (['false', '0', 'off', 'no', 'disarmed'].includes(normalized)) armed = false;
    } else if (typeof armedRaw === 'number') {
        armed = armedRaw > 0;
    }

    if (armed === null) {
        return res.status(400).json({ success: false, error: 'armed_boolean_required' });
    }

    const reason = typeof body.reason === 'string' ? body.reason : '';
    const actorRaw = body.changedBy || req.headers['x-actor'] || req.headers['x-user'] || req.headers['x-forwarded-user'] || 'web-ui';
    const actor = String(actorRaw || 'web-ui').trim().slice(0, 80) || 'web-ui';
    const liveGuard = setMt5LiveExecutionGuard(armed, reason, actor);
    return res.json({ success: true, liveGuard });
});

app.post('/api/mt5/bots/control', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const action = String(body.action || '').trim().toLowerCase();
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 220) : '';
    const nowIso = new Date().toISOString();

    if (action === 'stop') {
        mt5BotState = {
            ...mt5BotState,
            status: 'STOPPED',
            note,
            updatedAt: nowIso,
            revision: toNum(mt5BotState.revision, 0) + 1
        };
        saveMt5BotState();
        return res.json({ success: true, state: mt5BotState });
    }

    if (action !== 'start' && action !== 'switch' && action !== 'update') {
        return res.status(400).json({ success: false, error: 'Invalid action. Use start|stop|switch|update' });
    }

    const botId = String(body.botId || '').trim();
    const bot = getMt5BotDefinition(botId);
    if (!bot) {
        return res.status(400).json({ success: false, error: 'Unknown botId' });
    }

    const params = body.params && typeof body.params === 'object' ? body.params : {};
    const rendered = renderMt5BotSource(botId, params);
    if (!rendered) {
        return res.status(400).json({ success: false, error: 'Unable to render bot source' });
    }

    const mode = String(body.mode || mt5BotState.mode || 'live').toLowerCase() === 'paper' ? 'paper' : 'live';
    mt5BotState = {
        ...mt5BotState,
        status: 'RUNNING',
        activeBotId: botId,
        params: rendered.params,
        mode,
        note,
        updatedAt: nowIso,
        revision: toNum(mt5BotState.revision, 0) + 1
    };
    saveMt5BotState();

    return res.json({
        success: true,
        state: mt5BotState,
        activeBot: {
            id: bot.id,
            name: bot.name,
            filename: bot.filename,
            sourceEndpoint: `/api/mt5/bots/source/${encodeURIComponent(bot.id)}`
        }
    });
});

app.get('/api/mt5/bots/source/:botId', (req, res) => {
    const botId = String(req.params.botId || '').trim();
    const overrides = {
        lotSize: req.query.lotSize,
        magicNumber: req.query.magicNumber,
        maxLoss: req.query.maxLoss,
        maxTrades: req.query.maxTrades,
        sym1: req.query.sym1,
        sym2: req.query.sym2,
        sym3: req.query.sym3
    };
    const rendered = renderMt5BotSource(botId, overrides);
    if (!rendered) {
        return res.status(404).json({ success: false, error: 'bot_not_found' });
    }

    const forceDownload = String(req.query.download || '1') !== '0';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (forceDownload) {
        res.setHeader('Content-Disposition', `attachment; filename=\"${rendered.filename}\"`);
    }
    return res.send(rendered.source);
});

app.post('/api/mt5/bots/heartbeat', (req, res) => {
    if (!isMt5BridgeAuthorized(req)) {
        trackMt5BridgeUnauthorized(req, '/api/mt5/bots/heartbeat');
        return res.status(401).json({ success: false, error: 'mt5_bridge_token_invalid' });
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    const heartbeat = {
        terminal: String(body.terminal || body.client || 'mt5').trim().slice(0, 40) || 'mt5',
        accountId: String(body.accountId || body.account || '').trim().slice(0, 40) || null,
        broker: String(body.broker || '').trim().slice(0, 80) || null,
        server: String(body.server || '').trim().slice(0, 80) || null,
        symbol: normalizeMt5BridgeSymbol(body.symbol || body.brokerSymbol || ''),
        equity: toNullableNumber(body.equity, 0, 1_000_000_000),
        balance: toNullableNumber(body.balance, 0, 1_000_000_000),
        openPositions: Math.max(0, Math.floor(toNum(body.openPositions, 0))),
        lastAction: String(body.lastAction || '').trim().slice(0, 80) || null,
        latencyMs: Math.max(0, Math.floor(toNum(body.latencyMs, 0))),
        timestamp: nowIso
    };

    mt5BotState = {
        ...mt5BotState,
        heartbeat,
        lastHeartbeatAt: nowIso,
        lastExecutionAt: body.lastExecutionAt ? new Date(toUnixMs(body.lastExecutionAt)).toISOString() : mt5BotState.lastExecutionAt
    };
    saveMt5BotState();

    return res.json({
        success: true,
        status: mt5BotState.status || 'STOPPED',
        activeBotId: mt5BotState.activeBotId || null,
        params: mt5BotState.params || {},
        revision: toNum(mt5BotState.revision, 0),
        mode: mt5BotState.mode || 'live',
        serverTime: nowIso,
        staleAfterMs: MT5_BRIDGE_STALE_MS,
        nextPollMs: Math.min(Math.max(Math.floor(MT5_BRIDGE_STALE_MS / 2), 1200), 8000),
        online: (nowMs - toUnixMs(mt5BotState.lastHeartbeatAt || nowIso)) <= MT5_BRIDGE_STALE_MS
    });
});

app.post('/api/mt5/manual-order', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
    const side = normalizeExecutionSide(body.side);
    const dryRun = parseBoolean(body.dryRun, false);

    if (!symbol || !INSTRUMENTS[symbol]) {
        return res.status(400).json({ success: false, error: 'invalid_or_unsupported_symbol' });
    }
    if (side !== 'BUY' && side !== 'SELL') {
        return res.status(400).json({ success: false, error: 'invalid_side_buy_or_sell_required' });
    }

    const volumeRaw = toNum(body.volume, 0);
    const volume = clamp(volumeRaw > 0 ? volumeRaw : 0.01, 0.001, 100);
    if (!(volume > 0)) {
        return res.status(400).json({ success: false, error: 'invalid_volume' });
    }

    const entryPrice = roundBySymbol(symbol, toNullableNumber(body.entryPrice, 0, Number.MAX_SAFE_INTEGER));
    const takeProfit = roundBySymbol(symbol, toNullableNumber(body.takeProfit, 0, Number.MAX_SAFE_INTEGER));
    const stopLoss = roundBySymbol(symbol, toNullableNumber(body.stopLoss, 0, Number.MAX_SAFE_INTEGER));
    const confidence = clamp(Math.round(toNum(body.confidence, 70)), 1, 99);
    const sourceSignal = String(body.sourceSignal || 'manual-live').trim().slice(0, 80) || 'manual-live';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 240) : '';

    if (!(entryPrice > 0) || !(takeProfit > 0) || !(stopLoss > 0)) {
        return res.status(400).json({ success: false, error: 'entry_tp_sl_required_and_must_be_positive' });
    }

    if (side === 'BUY') {
        if (!(takeProfit > entryPrice)) {
            return res.status(400).json({ success: false, error: 'buy_take_profit_must_be_above_entry' });
        }
        if (!(stopLoss < entryPrice)) {
            return res.status(400).json({ success: false, error: 'buy_stop_loss_must_be_below_entry' });
        }
    } else {
        if (!(takeProfit < entryPrice)) {
            return res.status(400).json({ success: false, error: 'sell_take_profit_must_be_below_entry' });
        }
        if (!(stopLoss > entryPrice)) {
            return res.status(400).json({ success: false, error: 'sell_stop_loss_must_be_above_entry' });
        }
    }

    const accountIdCandidate = String(body.accountId || body.account || '').trim();
    const fallbackAccountId = String(mt5BotState?.heartbeat?.accountId || '').trim();
    const targetAccountId = accountIdCandidate || fallbackAccountId || '';
    const brokerSymbol = String(body.brokerSymbol || '').trim() || String(symbol).replace('/', '');
    const nowMs = Date.now();
    const expiresAtMs = nowMs + MT5_MANUAL_COMMAND_TTL_MS;
    const commandId = createMt5CommandId(symbol);
    const heartbeatMs = toUnixMsStrict(mt5BotState?.lastHeartbeatAt);
    const bridgeOnline = heartbeatMs > 0 && (nowMs - heartbeatMs) <= MT5_BRIDGE_STALE_MS;

    const command = {
        commandId,
        scope: targetAccountId ? normalizeMt5ScopeKey(targetAccountId, symbol) : `manual|${symbol}`,
        side,
        symbol,
        brokerSymbol,
        volume: Number(volume.toFixed(3)),
        entryPrice,
        takeProfit,
        stopLoss,
        confidence,
        sourceSignal,
        signalTimestamp: new Date(nowMs).toISOString(),
        signalAgeMs: 0,
        fingerprint: `manual|${commandId}`,
        issuedAtMs: nowMs,
        issuedAt: new Date(nowMs).toISOString(),
        expiresAtMs,
        expiresAt: new Date(expiresAtMs).toISOString(),
        status: 'PENDING',
        manual: true,
        targetAccountId: targetAccountId || null,
        note: note || undefined
    };

    if (dryRun) {
        return res.json({
            success: true,
            dryRun: true,
            bridgeOnline,
            botStatus: String(mt5BotState?.status || 'STOPPED'),
            command
        });
    }

    if (!isMt5LiveExecutionArmed()) {
        return res.status(423).json({
            success: false,
            error: 'live_execution_disarmed',
            liveGuard: getMt5LiveGuardSnapshot()
        });
    }

    if (!mt5CommandState.pendingById || typeof mt5CommandState.pendingById !== 'object') {
        mt5CommandState.pendingById = {};
    }
    mt5CommandState.pendingById[commandId] = command;
    saveMt5CommandState();

    return res.json({
        success: true,
        queued: true,
        bridgeOnline,
        botStatus: String(mt5BotState?.status || 'STOPPED'),
        command: {
            commandId: command.commandId,
            side: command.side,
            symbol: command.symbol,
            brokerSymbol: command.brokerSymbol,
            volume: command.volume,
            entryPrice: command.entryPrice,
            takeProfit: command.takeProfit,
            stopLoss: command.stopLoss,
            confidence: command.confidence,
            issuedAt: command.issuedAt,
            expiresAt: command.expiresAt,
            targetAccountId: command.targetAccountId || null
        }
    });
});

app.post('/api/mt5/executor/next', (req, res) => {
    if (!isMt5BridgeAuthorized(req)) {
        trackMt5BridgeUnauthorized(req, '/api/mt5/executor/next');
        return res.status(401).json({ success: false, error: 'mt5_bridge_token_invalid' });
    }

    cleanupMt5CommandState(Date.now());

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const accountId = String(body.accountId || body.account || body.login || 'default').trim() || 'default';
    const rawBrokerSymbol = String(body.brokerSymbol || body.symbol || body.mt5Symbol || '').trim();
    let symbol = normalizeMt5BridgeSymbol(rawBrokerSymbol);

    const allowedSymbols = normalizeBotAllowedSymbols();
    if (!symbol && allowedSymbols && allowedSymbols.size > 0) {
        symbol = [...allowedSymbols][0];
    }
    if (!symbol && mt5BotState?.heartbeat?.symbol && INSTRUMENTS[mt5BotState.heartbeat.symbol]) {
        symbol = mt5BotState.heartbeat.symbol;
    }
    if (!symbol) symbol = 'XAU/USD';

    if (!INSTRUMENTS[symbol]) {
        return res.status(400).json({ success: false, error: 'unsupported_symbol', symbol });
    }

    const nowMs = Date.now();
    if (!isMt5LiveExecutionArmed()) {
        return res.json({
            success: true,
            hasCommand: false,
            command: null,
            reason: 'live_guard_disarmed',
            symbol,
            status: mt5BotState.status || 'STOPPED',
            liveGuard: getMt5LiveGuardSnapshot()
        });
    }

    const manualPending = findManualPendingMt5Command(symbol, accountId, nowMs);
    if (manualPending) {
        return res.json({
            success: true,
            hasCommand: true,
            reason: 'manual_pending_command',
            symbol,
            status: mt5BotState.status || 'RUNNING',
            command: {
                commandId: manualPending.commandId,
                side: manualPending.side,
                symbol: manualPending.symbol,
                brokerSymbol: manualPending.brokerSymbol,
                volume: manualPending.volume,
                entryPrice: manualPending.entryPrice,
                takeProfit: manualPending.takeProfit,
                stopLoss: manualPending.stopLoss,
                confidence: manualPending.confidence,
                issuedAt: manualPending.issuedAt,
                expiresAt: manualPending.expiresAt,
                signalTimestamp: manualPending.signalTimestamp,
                sourceSignal: manualPending.sourceSignal
            }
        });
    }

    if (allowedSymbols && !allowedSymbols.has(symbol)) {
        return res.json({
            success: true,
            hasCommand: false,
            command: null,
            reason: `symbol_not_allowed_for_active_bot:${symbol}`,
            symbol,
            status: mt5BotState.status || 'STOPPED'
        });
    }

    if (String(mt5BotState.status || 'STOPPED') !== 'RUNNING') {
        return res.json({
            success: true,
            hasCommand: false,
            command: null,
            reason: 'bot_stopped',
            symbol,
            status: mt5BotState.status || 'STOPPED'
        });
    }

    const scope = normalizeMt5ScopeKey(accountId, symbol);
    const latestSignal = getLatestExecutableSignalForSymbol(symbol);
    if (!latestSignal) {
        saveMt5CommandState();
        return res.json({
            success: true,
            hasCommand: false,
            command: null,
            reason: 'no_fresh_signal',
            symbol,
            status: mt5BotState.status || 'STOPPED',
            minConfidence: MT5_MIN_CONFIDENCE,
            signalMaxAgeMs: MT5_SIGNAL_MAX_AGE_MS
        });
    }

    const fingerprint = buildSignalFingerprint(latestSignal);
    const lastAck = mt5CommandState.lastAckByScope?.[scope];
    if (lastAck && String(lastAck.fingerprint || '') === fingerprint) {
        return res.json({
            success: true,
            hasCommand: false,
            command: null,
            reason: 'signal_already_acknowledged',
            symbol,
            status: mt5BotState.status || 'RUNNING',
            acknowledgedAt: lastAck.ackedAt || null
        });
    }

    const lastIssued = mt5CommandState.lastIssuedByScope?.[scope];
    if (lastIssued && String(lastIssued.fingerprint || '') === fingerprint) {
        const existingId = String(lastIssued.commandId || '');
        const existing = mt5CommandState.pendingById?.[existingId];
        if (existing && toNum(existing.expiresAtMs, 0) > nowMs) {
            return res.json({
                success: true,
                hasCommand: true,
                reason: 'replay_pending_command',
                symbol,
                command: {
                    commandId: existing.commandId,
                    side: existing.side,
                    symbol: existing.symbol,
                    brokerSymbol: existing.brokerSymbol,
                    volume: existing.volume,
                    entryPrice: existing.entryPrice,
                    takeProfit: existing.takeProfit,
                    stopLoss: existing.stopLoss,
                    confidence: existing.confidence,
                    issuedAt: existing.issuedAt,
                    expiresAt: existing.expiresAt,
                    signalTimestamp: existing.signalTimestamp,
                    sourceSignal: existing.sourceSignal
                }
            });
        }

        return res.json({
            success: true,
            hasCommand: false,
            command: null,
            reason: 'pending_command_expired_waiting_new_signal',
            symbol,
            status: mt5BotState.status || 'RUNNING'
        });
    }

    const params = mt5BotState?.params && typeof mt5BotState.params === 'object' ? mt5BotState.params : {};
    const reqVolume = toNum(body.volume, 0);
    const botVolume = toNum(params.lotSize, 0.01);
    const volume = clamp(reqVolume > 0 ? reqVolume : botVolume, 0.001, 100);
    const commandId = createMt5CommandId(symbol);
    const expiresAtMs = nowMs + MT5_COMMAND_TTL_MS;
    const brokerSymbol = rawBrokerSymbol || String(symbol).replace('/', '');

    const command = {
        commandId,
        scope,
        side: latestSignal.signal,
        symbol,
        brokerSymbol,
        volume: Number(volume.toFixed(3)),
        entryPrice: roundBySymbol(symbol, latestSignal.entryPrice),
        takeProfit: roundBySymbol(symbol, latestSignal.takeProfit),
        stopLoss: roundBySymbol(symbol, latestSignal.stopLoss),
        confidence: Math.round(toNum(latestSignal.confidence, 0)),
        sourceSignal: String(latestSignal.aiModel || 'backend'),
        signalTimestamp: new Date(toSignalTimestampMs(latestSignal)).toISOString(),
        signalAgeMs: Math.max(0, nowMs - toSignalTimestampMs(latestSignal)),
        fingerprint,
        issuedAtMs: nowMs,
        issuedAt: new Date(nowMs).toISOString(),
        expiresAtMs,
        expiresAt: new Date(expiresAtMs).toISOString(),
        status: 'PENDING'
    };

    if (!mt5CommandState.pendingById || typeof mt5CommandState.pendingById !== 'object') {
        mt5CommandState.pendingById = {};
    }
    if (!mt5CommandState.lastIssuedByScope || typeof mt5CommandState.lastIssuedByScope !== 'object') {
        mt5CommandState.lastIssuedByScope = {};
    }

    mt5CommandState.pendingById[commandId] = command;
    mt5CommandState.lastIssuedByScope[scope] = {
        commandId,
        fingerprint,
        issuedAt: command.issuedAt,
        issuedAtMs: command.issuedAtMs,
        expiresAt: command.expiresAt,
        expiresAtMs: command.expiresAtMs
    };
    saveMt5CommandState();

    return res.json({
        success: true,
        hasCommand: true,
        symbol,
        status: mt5BotState.status || 'RUNNING',
        command: {
            commandId: command.commandId,
            side: command.side,
            symbol: command.symbol,
            brokerSymbol: command.brokerSymbol,
            volume: command.volume,
            entryPrice: command.entryPrice,
            takeProfit: command.takeProfit,
            stopLoss: command.stopLoss,
            confidence: command.confidence,
            issuedAt: command.issuedAt,
            expiresAt: command.expiresAt,
            signalTimestamp: command.signalTimestamp,
            sourceSignal: command.sourceSignal
        }
    });
});

app.post('/api/mt5/executor/ack', (req, res) => {
    if (!isMt5BridgeAuthorized(req)) {
        trackMt5BridgeUnauthorized(req, '/api/mt5/executor/ack');
        return res.status(401).json({ success: false, error: 'mt5_bridge_token_invalid' });
    }

    cleanupMt5CommandState(Date.now());
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const commandId = String(body.commandId || '').trim();
    if (!commandId) {
        return res.status(400).json({ success: false, error: 'commandId_required' });
    }

    const existingAck = mt5CommandState.ackById?.[commandId];
    if (existingAck) {
        return res.json({ success: true, duplicate: true, ack: existingAck });
    }

    const pending = mt5CommandState.pendingById?.[commandId];
    if (!pending) {
        return res.status(404).json({ success: false, error: 'command_not_found' });
    }

    const symbol = String(pending.symbol || '');
    if (!symbol || !INSTRUMENTS[symbol]) {
        return res.status(400).json({ success: false, error: 'command_symbol_invalid' });
    }

    const status = normalizeExecutionStatusAny(body.status || body.result || 'FILLED');
    const executedAtMs = Date.now();
    const signalTs = toTimestampFromSignal(pending.signalTimestamp);
    const fillPrice = roundBySymbol(symbol, toNullableNumber(body.fillPrice, 0, Number.MAX_SAFE_INTEGER));
    const plannedEntry = roundBySymbol(symbol, toNullableNumber(pending.entryPrice, 0, Number.MAX_SAFE_INTEGER));
    const volume = toNullableNumber(body.volume, 0, 1_000_000) ?? toNum(pending.volume, 0.01);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';

    let slippageAbs = null;
    let slippageBps = null;
    if (plannedEntry !== null && plannedEntry > 0 && fillPrice !== null && fillPrice > 0) {
        slippageAbs = roundBySymbol(symbol, fillPrice - plannedEntry);
        slippageBps = Number((((fillPrice - plannedEntry) / plannedEntry) * 10000).toFixed(2));
    }

    const ack = {
        commandId,
        scope: pending.scope,
        symbol,
        side: normalizeExecutionSide(pending.side),
        status,
        ackedAtMs: executedAtMs,
        ackedAt: new Date(executedAtMs).toISOString(),
        fillPrice,
        volume: Number(Number(volume).toFixed(3)),
        note: note || undefined,
        fingerprint: pending.fingerprint || '',
        signalTimestamp: pending.signalTimestamp || null
    };

    if (!mt5CommandState.ackById || typeof mt5CommandState.ackById !== 'object') mt5CommandState.ackById = {};
    if (!mt5CommandState.lastAckByScope || typeof mt5CommandState.lastAckByScope !== 'object') mt5CommandState.lastAckByScope = {};
    mt5CommandState.ackById[commandId] = ack;
    mt5CommandState.lastAckByScope[pending.scope] = ack;
    delete mt5CommandState.pendingById[commandId];
    saveMt5CommandState();

    mt5BotState = {
        ...mt5BotState,
        lastExecutionAt: new Date(executedAtMs).toISOString()
    };
    saveMt5BotState();

    const record = {
        id: `exec_auto_${executedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date(executedAtMs).toISOString(),
        executedAtMs,
        symbol,
        side: normalizeExecutionSide(pending.side),
        status,
        volume: Number(Number(volume).toFixed(3)),
        plannedEntry,
        fillPrice,
        stopLoss: roundBySymbol(symbol, toNullableNumber(pending.stopLoss, 0, Number.MAX_SAFE_INTEGER)),
        takeProfit: roundBySymbol(symbol, toNullableNumber(pending.takeProfit, 0, Number.MAX_SAFE_INTEGER)),
        confidence: toNullableNumber(pending.confidence, 0, 100),
        sourceSignal: `${String(pending.sourceSignal || 'backend')}|mt5-auto`,
        signalTimestamp: signalTs ? new Date(signalTs).toISOString() : undefined,
        signalAgeMs: signalTs ? Math.max(0, executedAtMs - signalTs) : null,
        slippageAbs,
        slippageBps,
        note: note || undefined
    };
    const records = loadMt5ExecutionLog();
    records.push(record);
    saveMt5ExecutionLog(records);

    return res.json({ success: true, ack, record });
});

app.get('/api/mt5/executor/source', (req, res) => {
    const sourcePath = path.join(__dirname, 'mt5', 'Ari_MT5_AutoExecutor.mq5');
    try {
        if (!fs.existsSync(sourcePath)) {
            return res.status(404).json({ success: false, error: 'executor_source_missing' });
        }
        let source = fs.readFileSync(sourcePath, 'utf8');
        const forwardedProtoRaw = req.headers['x-forwarded-proto'];
        const forwardedHostRaw = req.headers['x-forwarded-host'];
        const headerHost = req.get('host');
        const proto = String(Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw || req.protocol || 'https')
            .split(',')[0]
            .trim() || 'https';
        const host = String(Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw || headerHost || '')
            .split(',')[0]
            .trim();

        const inferredBaseUrl = host ? `${proto}://${host}` : '';
        const forcedBaseUrl = String(process.env.MT5_EXECUTOR_API_BASE_URL || '').trim();
        const includeSecrets = parseBoolean(req.query.includeSecrets, true);
        const sanitizeForMql = (value) => String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, ' ')
            .trim();

        const baseUrl = sanitizeForMql(String(req.query.baseUrl || '').trim() || forcedBaseUrl || inferredBaseUrl);
        const user = sanitizeForMql(String(req.query.user || '').trim() || SITE_ACCESS_USER || '');
        const code = includeSecrets
            ? sanitizeForMql(String(req.query.code || '').trim() || SITE_ACCESS_CODE || '')
            : '';
        const token = includeSecrets
            ? sanitizeForMql(String(req.query.token || '').trim() || MT5_BRIDGE_TOKEN || '')
            : '';

        source = source.replace(/\{\{API_BASE_URL\}\}/g, baseUrl);
        source = source.replace(/\{\{SITE_USER\}\}/g, user);
        source = source.replace(/\{\{SITE_CODE\}\}/g, code);
        source = source.replace(/\{\{BRIDGE_TOKEN\}\}/g, token);

        const forceDownload = String(req.query.download || '1') !== '0';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        if (forceDownload) {
            res.setHeader('Content-Disposition', 'attachment; filename=\"Ari_MT5_AutoExecutor.mq5\"');
        }
        return res.send(source);
    } catch (e) {
        return res.status(500).json({ success: false, error: 'executor_source_read_failed' });
    }
});

app.get('/api/mt5/executor/python', (req, res) => {
    const sourcePath = path.join(__dirname, 'mt5', 'Ari_MT5_PythonExecutor.py');
    try {
        if (!fs.existsSync(sourcePath)) {
            return res.status(404).json({ success: false, error: 'executor_python_source_missing' });
        }
        let source = fs.readFileSync(sourcePath, 'utf8');
        const forwardedProtoRaw = req.headers['x-forwarded-proto'];
        const forwardedHostRaw = req.headers['x-forwarded-host'];
        const headerHost = req.get('host');
        const proto = String(Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw || req.protocol || 'https')
            .split(',')[0]
            .trim() || 'https';
        const host = String(Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw || headerHost || '')
            .split(',')[0]
            .trim();

        const inferredBaseUrl = host ? `${proto}://${host}` : '';
        const forcedBaseUrl = String(process.env.MT5_EXECUTOR_API_BASE_URL || '').trim();
        const includeSecrets = parseBoolean(req.query.includeSecrets, true);
        const sanitizeForPy = (value) => String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, ' ')
            .trim();

        const baseUrl = sanitizeForPy(String(req.query.baseUrl || '').trim() || forcedBaseUrl || inferredBaseUrl);
        const user = sanitizeForPy(String(req.query.user || '').trim() || SITE_ACCESS_USER || '');
        const code = includeSecrets
            ? sanitizeForPy(String(req.query.code || '').trim() || SITE_ACCESS_CODE || '')
            : '';
        const token = includeSecrets
            ? sanitizeForPy(String(req.query.token || '').trim() || MT5_BRIDGE_TOKEN || '')
            : '';

        source = source.replace(/\{\{API_BASE_URL\}\}/g, baseUrl);
        source = source.replace(/\{\{SITE_USER\}\}/g, user);
        source = source.replace(/\{\{SITE_CODE\}\}/g, code);
        source = source.replace(/\{\{BRIDGE_TOKEN\}\}/g, token);

        const forceDownload = String(req.query.download || '1') !== '0';
        res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
        if (forceDownload) {
            res.setHeader('Content-Disposition', 'attachment; filename=\"Ari_MT5_PythonExecutor.py\"');
        }
        return res.send(source);
    } catch (e) {
        return res.status(500).json({ success: false, error: 'executor_python_source_read_failed' });
    }
});

// AI Models info endpoint
app.get('/api/ai-models', (req, res) => {
    res.json({
        success: true, models: [
            { id: 'tradingagents', name: TRADING_AGENTS_MODEL_LABEL, provider: 'TradingAgents bridge', active: TRADING_AGENTS_ENABLED },
            { id: 'gpt-5', name: 'GPT-5', provider: 'OpenRouter', active: !!OPENROUTER_API_KEY },
            { id: 'claude-opus', name: 'Claude Opus', provider: 'OpenRouter', active: !!OPENROUTER_API_KEY },
            { id: 'glm', name: 'GLM', provider: 'OpenRouter', active: !!OPENROUTER_API_KEY },
            { id: 'gemini', name: 'Gemini 2.0 Flash', provider: 'Google', active: !!(GEMINI_API_KEY && GEMINI_API_KEY !== 'COLLE_TA_CLE_ICI') },
            { id: 'ollama', name: 'Gemma 3 4B', provider: 'Ollama (local)', active: true }
        ]
    });
});

app.get('/api/tradingagents/status', (req, res) => {
    res.json({
        success: true,
        enabled: TRADING_AGENTS_ENABLED,
        endpoint: TRADING_AGENTS_ENABLED ? TRADING_AGENTS_API_URL : null,
        timeoutMs: TRADING_AGENTS_TIMEOUT_MS,
        includeInAuto: TRADING_AGENTS_INCLUDE_IN_AUTO,
        modelLabel: TRADING_AGENTS_MODEL_LABEL
    });
});

app.post('/api/tradingagents/decision', async (req, res) => {
    if (!TRADING_AGENTS_ENABLED) {
        return res.status(503).json({
            success: false,
            error: 'TradingAgents bridge not configured',
            hint: 'Set TRADING_AGENTS_API_URL in backend env'
        });
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const symbol = String(body.sourceSymbol || body.symbol || 'XAU/USD');
    const currentPrice = toNum(body.currentPrice, instrumentState[symbol]?.lastKnownPrice || INSTRUMENTS[symbol]?.basePrice || 0);
    const result = await callTradingAgents({
        symbol,
        currentPrice,
        timeframe: body.timeframe || '',
        asOfDate: body.asOfDate,
        prompt: body.prompt || '',
        indicators: body.indicators || {},
        candles: Array.isArray(body.candles) ? body.candles : [],
        patternBias: body.patternBias || null,
        newsItems: Array.isArray(body.news) ? body.news : []
    });

    if (!result) {
        return res.status(502).json({
            success: false,
            error: 'TradingAgents bridge unavailable or returned invalid payload'
        });
    }

    return res.json({ success: true, ...result });
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

function normalizePatternSignal(pattern = {}) {
    const raw = String(pattern.signal || pattern.type || pattern.tone || '').toUpperCase();
    if (raw === 'BUY' || raw === 'BULLISH' || raw === 'HAUSSIER') return 'BUY';
    if (raw === 'SELL' || raw === 'BEARISH' || raw === 'BAISSIER') return 'SELL';
    return 'HOLD';
}

function evaluatePatternBias(patterns = []) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
        return {
            signal: 'HOLD',
            score: 0,
            bullishCount: 0,
            bearishCount: 0,
            total: 0,
            summary: 'Aucun pattern détecté',
            tags: []
        };
    }

    const recent = patterns.slice(-6);
    let score = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    const tags = [];

    for (let i = 0; i < recent.length; i++) {
        const item = recent[i] || {};
        const direction = normalizePatternSignal(item);
        const confidence = clamp(toNum(item.confidence, 60), 20, 100);
        const recencyWeight = Math.max(0.55, 1 - ((recent.length - 1 - i) * 0.12));
        const points = Math.round((confidence / 100) * 6 * recencyWeight);
        const label = String(item.name || direction);

        if (direction === 'BUY') {
            bullishCount += 1;
            score += points;
            tags.push(`+${points} ${label}`);
        } else if (direction === 'SELL') {
            bearishCount += 1;
            score -= points;
            tags.push(`-${points} ${label}`);
        } else {
            tags.push(`0 ${label}`);
        }
    }

    const signal = score >= 4 ? 'BUY' : score <= -4 ? 'SELL' : 'HOLD';
    return {
        signal,
        score,
        bullishCount,
        bearishCount,
        total: recent.length,
        summary: `Patterns ${signal} (bull:${bullishCount} bear:${bearishCount} score:${score})`,
        tags: tags.slice(-4)
    };
}

function evaluateStrictComboRules(indicators, currentPrice) {
    const combo = indicators?.proCombo;
    const blocks = combo?.blocks;
    const comboScore = toNum(combo?.score, toNum(indicators?.compositeScore, 0) + 50);
    const atr = Math.max(toNum(indicators?.atr, currentPrice * 0.005), currentPrice * 0.001);
    const patternBias = evaluatePatternBias(indicators?.patterns || []);

    if (!blocks) {
        return {
            available: false,
            score: comboScore,
            signal: 'HOLD',
            summary: 'Strict combo unavailable (legacy payload).',
            checkCount: 7,
            patternBias,
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
        const patternOk = patternBias.signal === 'HOLD' || patternBias.signal === side;
        const patternGate = patternBias.total >= 2 ? patternOk : true;

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
            { name: 'Confirmation', ok: confirmationOk },
            { name: 'Patterns', ok: patternOk }
        ];

        const passCount = checks.filter(c => c.ok).length;
        const mandatoryPass = trendOk && confirmationOk;
        const pass = mandatoryPass && patternGate && passCount >= 5;
        const confidence = clamp(
            Math.round((comboScore * 0.55) + (passCount * 7) + (pass ? 8 : -8) + (patternBias.signal === side ? 4 : patternBias.signal === 'HOLD' ? 0 : -4)),
            5,
            98
        );
        const plan = pass ? buildStrictTradePlan(side, indicators, currentPrice, atr) : null;

        return { pass, passCount, confidence, checks, plan };
    };

    const buy = evaluateSide('BUY');
    const sell = evaluateSide('SELL');

    let signal = 'HOLD';
    if (buy.pass && !sell.pass) signal = 'BUY';
    else if (sell.pass && !buy.pass) signal = 'SELL';
    else if (buy.pass && sell.pass) signal = comboScore >= 50 ? 'BUY' : 'SELL';

    const summary = `Strict filter -> BUY ${buy.passCount}/7 | SELL ${sell.passCount}/7 | ${patternBias.summary}`;
    return { available: true, score: comboScore, signal, summary, checkCount: 7, patternBias, buy, sell };
}

function evaluateScalp3mPrediction(indicators = {}, candles = [], currentPrice = 0, symbol = 'XAU/USD') {
    const n = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const safePrice = Math.max(toNum(currentPrice, 0), 0);
    const atr = Math.max(toNum(indicators?.atr, safePrice * 0.0012), safePrice * 0.0008);
    let score = 0;
    const reasons = [];
    const patternBias = evaluatePatternBias(indicators?.patterns || []);

    const add = (points, text) => {
        if (!points || !Number.isFinite(points)) return;
        score += points;
        reasons.push({ points, text });
    };

    const ema9 = n(indicators?.ema9);
    const ema21 = n(indicators?.ema21);
    if (ema9 !== null && ema21 !== null) {
        const trendBull = ema9 > ema21;
        add(trendBull ? 18 : -18, trendBull ? 'EMA 9 > EMA 21 (momentum acheteur)' : 'EMA 9 < EMA 21 (momentum vendeur)');
    }
    if (ema9 !== null) {
        add(safePrice > ema9 ? 8 : -8, safePrice > ema9 ? 'Prix au-dessus EMA 9' : 'Prix sous EMA 9');
    }

    const macdLine = n(indicators?.macdLine);
    const macdSignal = n(indicators?.macdSignal);
    const macdHistogram = n(indicators?.macdHistogram);
    if (macdLine !== null && macdSignal !== null) {
        const bullish = macdLine > macdSignal;
        let pts = bullish ? 10 : -10;
        if (macdHistogram !== null) {
            if (bullish && macdHistogram > 0) pts += 2;
            if (!bullish && macdHistogram < 0) pts -= 2;
        }
        add(pts, bullish ? 'MACD bullish' : 'MACD bearish');
    }

    const rsi = n(indicators?.rsi);
    if (rsi !== null) {
        if (rsi >= 52 && rsi <= 70) add(10, 'RSI en zone haussière');
        else if (rsi >= 30 && rsi <= 48) add(-10, 'RSI en zone baissière');
        else if (rsi > 75) add(-8, 'RSI surachat (risque pullback)');
        else if (rsi < 25) add(8, 'RSI survente (risque rebond)');
    }

    const stochSignal = String(indicators?.stochRsi?.signal || '').toUpperCase();
    if (stochSignal === 'BULLISH' || stochSignal === 'OVERSOLD') add(7, 'Stoch RSI orienté BUY');
    else if (stochSignal === 'BEARISH' || stochSignal === 'OVERBOUGHT') add(-7, 'Stoch RSI orienté SELL');

    const divSignal = String(indicators?.rsiDivergence?.signal || '').toUpperCase();
    if (divSignal === 'BULLISH') add(9, 'Divergence RSI haussière');
    else if (divSignal === 'BEARISH') add(-9, 'Divergence RSI baissière');

    const obvTrend = String(indicators?.obv?.trend || '').toUpperCase();
    if (obvTrend === 'UP') add(5, 'OBV en hausse');
    else if (obvTrend === 'DOWN') add(-5, 'OBV en baisse');

    const cvdTrend = String(indicators?.cvd?.trend || '').toUpperCase();
    if (cvdTrend === 'UP') add(5, 'CVD en hausse');
    else if (cvdTrend === 'DOWN') add(-5, 'CVD en baisse');

    const volSkew = String(indicators?.volumeProfile?.skew || '').toUpperCase();
    if (volSkew === 'BUY') add(6, 'Volume profile acheteur');
    else if (volSkew === 'SELL') add(-6, 'Volume profile vendeur');

    const ichimokuSignal = String(indicators?.ichimoku?.signal || '').toUpperCase();
    if (ichimokuSignal === 'BULLISH') add(7, 'Ichimoku bullish');
    else if (ichimokuSignal === 'BEARISH') add(-7, 'Ichimoku bearish');

    const adx = n(indicators?.adx?.adx);
    const plusDI = n(indicators?.adx?.plusDI);
    const minusDI = n(indicators?.adx?.minusDI);
    if (adx !== null) {
        if (adx >= 28) add(7, 'ADX élevé (trend fort)');
        else if (adx >= 20) add(3, 'ADX valide (trend exploitable)');
        else if (adx < 14) add(-6, 'ADX faible (marché bruité)');
    }
    if (plusDI !== null && minusDI !== null) {
        if (plusDI > minusDI) add(4, '+DI > -DI');
        else if (plusDI < minusDI) add(-4, '-DI > +DI');
    }

    const fibTrend = String(indicators?.fibonacci?.trend || '').toUpperCase();
    if (fibTrend === 'UP') add(4, 'Structure Fibonacci UP');
    else if (fibTrend === 'DOWN') add(-4, 'Structure Fibonacci DOWN');
    if (indicators?.fibonacci?.inGoldenPocket === true) {
        if (fibTrend === 'UP') add(3, 'Golden Pocket haussière');
        else if (fibTrend === 'DOWN') add(-3, 'Golden Pocket baissière');
    }

    const mtfSignal = String(indicators?.mtfConfluence?.signal || '').toUpperCase();
    const mtfStrength = clamp(toNum(indicators?.mtfConfluence?.strength, 0), 0, 100);
    if (mtfSignal === 'BUY') add(Math.round(mtfStrength * 0.1), `Confluence MTF BUY (${mtfStrength}%)`);
    else if (mtfSignal === 'SELL') add(-Math.round(mtfStrength * 0.1), `Confluence MTF SELL (${mtfStrength}%)`);

    const proScore = n(indicators?.proCombo?.score);
    if (proScore !== null) {
        add(Math.round((proScore - 50) * 0.3), `Score combo ${proScore.toFixed(1)}`);
    }

    if (patternBias.signal === 'BUY') {
        add(8 + Math.min(6, Math.round(patternBias.bullishCount * 1.5)), `Patterns bullish (${patternBias.bullishCount}/${patternBias.total})`);
    } else if (patternBias.signal === 'SELL') {
        add(-(8 + Math.min(6, Math.round(patternBias.bearishCount * 1.5))), `Patterns bearish (${patternBias.bearishCount}/${patternBias.total})`);
    } else if (patternBias.total > 0) {
        add(0, `Patterns neutres (${patternBias.total})`);
    }

    if (candles.length >= 3) {
        const last = candles[candles.length - 1] || {};
        const prev = candles[candles.length - 2] || {};
        const prev2 = candles[candles.length - 3] || {};
        const c0 = n(last.close);
        const c1 = n(prev.close);
        const c2 = n(prev2.close);
        if (c0 !== null && c1 !== null && c2 !== null) {
            if (c0 > c1 && c1 > c2) add(9, '3 clôtures ascendantes');
            else if (c0 < c1 && c1 < c2) add(-9, '3 clôtures descendantes');
        }
        const h0 = n(last.high), h1 = n(prev.high), l0 = n(last.low), l1 = n(prev.low);
        if (h0 !== null && h1 !== null && l0 !== null && l1 !== null) {
            if (h0 > h1 && l0 > l1) add(6, 'Price action HH/HL');
            else if (h0 < h1 && l0 < l1) add(-6, 'Price action LH/LL');
        }
    }

    if (safePrice > 0) {
        const atrPct = (atr / safePrice) * 100;
        if (atrPct < 0.03) add(-3, 'Volatilité trop faible');
        else if (atrPct > 1.2) add(-3, 'Volatilité excessive');
        else add(3, 'Volatilité adaptée au scalp');
    }

    let signal = 'HOLD';
    const trendWeak = adx !== null && adx < 14;
    const trigger = trendWeak ? 24 : 20;
    if (score >= trigger) signal = 'BUY';
    else if (score <= -trigger) signal = 'SELL';

    const absScore = Math.abs(score);
    const confidence = signal === 'HOLD'
        ? clamp(Math.round(45 + Math.min(20, absScore * 0.5)), 35, 70)
        : clamp(Math.round(58 + Math.min(35, absScore * 0.8)), 55, 97);

    const entryPrice = parseFloat(safePrice.toFixed(2));
    let takeProfit = 0;
    let stopLoss = 0;
    if (signal === 'BUY') {
        const tpMult = adx !== null && adx >= 24 ? 0.95 : 0.78;
        const slMult = adx !== null && adx >= 24 ? 0.52 : 0.56;
        takeProfit = parseFloat((entryPrice + (atr * tpMult)).toFixed(2));
        stopLoss = parseFloat((entryPrice - (atr * slMult)).toFixed(2));
    } else if (signal === 'SELL') {
        const tpMult = adx !== null && adx >= 24 ? 0.95 : 0.78;
        const slMult = adx !== null && adx >= 24 ? 0.52 : 0.56;
        takeProfit = parseFloat((entryPrice - (atr * tpMult)).toFixed(2));
        stopLoss = parseFloat((entryPrice + (atr * slMult)).toFixed(2));
    }

    const rankedReasons = reasons
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .slice(0, 5);
    const compactReasons = rankedReasons.map(r => `${r.points > 0 ? '+' : ''}${r.points} ${r.text}`);

    return {
        signal,
        confidence,
        score: parseFloat(score.toFixed(1)),
        horizonMinutes: 3,
        entryPrice,
        takeProfit,
        stopLoss,
        reasoning: signal === 'HOLD'
            ? `Pas de biais net sur 3 minutes (score ${score.toFixed(1)}). Attendre meilleure confluence.`
            : `Scalp 3 minutes ${signal} (score ${score.toFixed(1)}).`,
        reasons: compactReasons,
        patternBias,
        symbol,
        targetTime: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString()
    };
}

app.post('/api/scalp-3m', async (req, res) => {
    const { indicators, candles, currentPrice, symbol: inputSymbol, timeframe } = req.body || {};
    const symbol = inputSymbol || 'XAU/USD';
    const config = INSTRUMENTS[symbol] || INSTRUMENTS['XAU/USD'];
    const safePrice = toNum(currentPrice, instrumentState[symbol]?.lastKnownPrice || config.basePrice);

    if (!INSTRUMENTS[symbol]) {
        return res.json({ success: false, error: 'Unknown symbol' });
    }

    if (isMarketClosed(symbol)) {
        return res.json({
            success: true,
            source: 'scalp-rules',
            symbol,
            timeframe: timeframe || '1min',
            signal: 'HOLD',
            confidence: 100,
            score: 0,
            horizonMinutes: 3,
            entryPrice: parseFloat(safePrice.toFixed(2)),
            takeProfit: 0,
            stopLoss: 0,
            reasoning: getMarketClosedReason(symbol),
            reasons: ['Marché fermé'],
            targetTime: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
            marketStatus: 'closed'
        });
    }

    const normalizedCandles = Array.isArray(candles)
        ? candles
            .slice(-200)
            .map(c => ({
                open: toNum(c?.open, 0),
                high: toNum(c?.high, 0),
                low: toNum(c?.low, 0),
                close: toNum(c?.close, 0),
                volume: toNum(c?.volume, 0),
                time: toNum(c?.time, 0)
            }))
            .filter(c => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
        : [];

    const prediction = evaluateScalp3mPrediction(indicators || {}, normalizedCandles, safePrice, symbol);

    res.json({
        success: true,
        source: 'scalp-rules',
        symbol,
        timeframe: timeframe || '1min',
        ...prediction
    });
});

function timeframeToSeconds(timeframe = '1min') {
    const value = String(timeframe || '').toLowerCase();
    if (value === '1s') return 1;
    if (value === '5s') return 5;
    if (value === '15s') return 15;
    if (value === '30s') return 30;
    if (value === '1m' || value === '1min') return 60;
    if (value === '3m' || value === '3min') return 180;
    if (value === '5m' || value === '5min') return 300;
    if (value === '15m' || value === '15min') return 900;
    if (value === '30m' || value === '30min') return 1800;
    if (value === '1h' || value === 'h1') return 3600;
    if (value === '4h' || value === 'h4') return 14400;
    return 60;
}

function mapModeHorizonMinutes(mode = 'scalp-3m') {
    const key = String(mode || 'scalp-3m').toLowerCase();
    if (key === 'scalp-1m') return 1;
    if (key === 'intraday') return 45;
    if (key === 'swing') return 240;
    return 3;
}

function normalizeCandlesInput(candles = []) {
    if (!Array.isArray(candles)) return [];
    return candles
        .map((c) => ({
            open: toNum(c?.open, 0),
            high: toNum(c?.high, 0),
            low: toNum(c?.low, 0),
            close: toNum(c?.close, 0),
            volume: toNum(c?.volume, 0),
            time: toNum(c?.time, 0)
        }))
        .filter((c) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
}

const TRADING_SESSION_WINDOWS = [
    { key: 'tokyo', id: 'TOKYO', label: 'Tokyo', timeZone: 'Asia/Tokyo', startHour: 9, endHour: 18 },
    { key: 'london', id: 'LONDON', label: 'Londres', timeZone: 'Europe/London', startHour: 8, endHour: 17 },
    { key: 'newYork', id: 'NEW_YORK', label: 'New York', timeZone: 'America/New_York', startHour: 8, endHour: 17 },
    { key: 'sydney', id: 'SYDNEY', label: 'Sydney', timeZone: 'Australia/Sydney', startHour: 8, endHour: 17 }
];

function getLocalHourMinute(date = new Date(), timeZone = 'UTC') {
    try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        });
        const parts = formatter.formatToParts(date);
        const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
        const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
        return {
            hour,
            minute,
            label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        };
    } catch {
        return { hour: 0, minute: 0, label: '--:--' };
    }
}

function isWithinSessionMinutes(currentMinutes, startMinutes, endMinutes) {
    if (startMinutes === endMinutes) return true;
    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function buildTradingSessionContext(now = new Date(), options = {}) {
    const mode = String(options.mode || 'scalp-3m').toLowerCase();
    const hasNews = !!options.hasNews;
    const newsCount = clamp(Number(options.newsCount || 0), 0, 50);
    const sentiment = String(options.sentiment || 'NEUTRAL').toUpperCase();

    const sessions = {};
    const activeSessions = [];

    for (const cfg of TRADING_SESSION_WINDOWS) {
        const local = getLocalHourMinute(now, cfg.timeZone);
        const currentMin = (local.hour * 60) + local.minute;
        const startMin = cfg.startHour * 60;
        const endMin = cfg.endHour * 60;
        const open = isWithinSessionMinutes(currentMin, startMin, endMin);
        sessions[cfg.key] = {
            id: cfg.id,
            name: cfg.label,
            timezone: cfg.timeZone,
            localTime: local.label,
            open
        };
        if (open) activeSessions.push(cfg.id);
    }

    const overlapLondonNewYork = !!(sessions.london?.open && sessions.newYork?.open);
    const overlapSydneyTokyo = !!(sessions.sydney?.open && sessions.tokyo?.open);

    let volatilityScore = 22 + (activeSessions.length * 15);
    if (overlapSydneyTokyo) volatilityScore = Math.max(volatilityScore, 73);
    if (overlapLondonNewYork) volatilityScore = Math.max(volatilityScore, 90);
    volatilityScore = clamp(Math.round(volatilityScore), 0, 100);

    let liquidityScore = 24 + (activeSessions.length * 17);
    if (sessions.london?.open) liquidityScore += 8;
    if (sessions.newYork?.open) liquidityScore += 10;
    if (overlapSydneyTokyo) liquidityScore = Math.max(liquidityScore, 68);
    if (overlapLondonNewYork) liquidityScore = Math.max(liquidityScore, 93);
    liquidityScore = clamp(Math.round(liquidityScore), 0, 100);

    let newsPublicationScore = 28;
    if (sessions.london?.open) newsPublicationScore += 16;
    if (sessions.newYork?.open) newsPublicationScore += 20;
    if (overlapLondonNewYork) newsPublicationScore += 12;
    if (hasNews) newsPublicationScore += Math.min(20, newsCount * 4);
    if (sentiment === 'BEARISH' || sentiment === 'BULLISH') newsPublicationScore += 4;
    newsPublicationScore = clamp(Math.round(newsPublicationScore), 0, 100);

    const minVolatilityByMode = mode === 'scalp-1m'
        ? 48
        : mode === 'scalp-3m'
            ? 42
            : mode === 'intraday'
                ? 34
                : 22;
    const minLiquidityByMode = mode === 'scalp-1m'
        ? 52
        : mode === 'scalp-3m'
            ? 48
            : mode === 'intraday'
                ? 42
                : 30;
    const newsStressThreshold = mode === 'swing' ? 90 : 78;

    const lowVolPenalty = Math.max(0, minVolatilityByMode - volatilityScore) * 1.25;
    const lowLiquidityPenalty = Math.max(0, minLiquidityByMode - liquidityScore) * 1.35;
    const newsStressPenalty = Math.max(0, newsPublicationScore - newsStressThreshold) * 0.9;
    const overlapStressPenalty = overlapLondonNewYork && (mode === 'scalp-1m' || mode === 'scalp-3m') ? 6 : 0;

    const sessionRiskScore = clamp(
        Math.round(16 + lowVolPenalty + lowLiquidityPenalty + newsStressPenalty + overlapStressPenalty),
        0,
        100
    );

    const activeLabel = activeSessions.length > 0
        ? activeSessions.join(', ')
        : 'Aucune session majeure ouverte';
    const overlapLabel = overlapLondonNewYork
        ? 'Chevauchement Londres-New York actif'
        : overlapSydneyTokyo
            ? 'Chevauchement Sydney-Tokyo actif'
            : 'Pas de chevauchement majeur';
    const summary = `${activeLabel}. ${overlapLabel}. Volatilité ${volatilityScore}/100, liquidité ${liquidityScore}/100, fenêtre news ${newsPublicationScore}/100.`;

    return {
        generatedAt: now.toISOString(),
        sessions,
        activeSessions,
        overlaps: {
            londonNewYork: overlapLondonNewYork,
            sydneyTokyo: overlapSydneyTokyo
        },
        volatilityScore,
        liquidityScore,
        newsPublicationScore,
        sessionRiskScore,
        thresholds: {
            minVolatility: minVolatilityByMode,
            minLiquidity: minLiquidityByMode,
            newsStress: newsStressThreshold
        },
        summary
    };
}

function buildRiskFilterSummary({ riskScore = 0, summary = '', checklist = [], blockAt = 78, warnAt = 55 }) {
    const score = clamp(Math.round(toNum(riskScore, 0)), 0, 100);
    const blockTrade = score >= blockAt;
    const caution = !blockTrade && score >= warnAt;
    const riskLevel = blockTrade ? 'HIGH' : caution ? 'MEDIUM' : 'LOW';
    return {
        riskScore: score,
        riskLevel,
        blockTrade,
        caution,
        summary,
        blockers: blockTrade ? [summary] : [],
        warnings: caution ? [summary] : [],
        checklist
    };
}

function getModeFreshnessTargetMs(mode = 'scalp-3m') {
    const safeMode = String(mode || 'scalp-3m').toLowerCase();
    if (safeMode === 'scalp-1m') return 1800;
    if (safeMode === 'scalp-3m') return 2600;
    if (safeMode === 'intraday') return 7000;
    if (safeMode === 'swing') return 22000;
    return 5000;
}

function normalizeOrderbookSnapshot(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const bids = Array.isArray(raw.bids) ? raw.bids : [];
    const asks = Array.isArray(raw.asks) ? raw.asks : [];
    if (!bids.length || !asks.length) return null;
    return {
        source: String(raw.source || 'unknown'),
        ratio: toNum(raw.ratio, 0.5),
        pressure: String(raw.pressure || 'NEUTRAL').toUpperCase(),
        depthLevels: Math.min(bids.length, asks.length),
        timestamp: toNum(raw.timestamp, Date.now())
    };
}

function buildMarketDataContext({ symbol, mode, timeframe, providedContext = {}, state = {} }) {
    const now = Date.now();
    const freshTargetMs = getModeFreshnessTargetMs(mode);

    const priceMeta = providedContext?.priceMeta && typeof providedContext.priceMeta === 'object'
        ? providedContext.priceMeta
        : {};
    const orderbookProvided = normalizeOrderbookSnapshot(providedContext?.orderbook || null);
    const orderbookState = normalizeOrderbookSnapshot(state?.lastOrderbookSnapshot || null);
    const orderbook = orderbookProvided || orderbookState;

    const sourceRaw = String(priceMeta.source || state.lastKnownPriceSource || 'unknown');
    const sourceInfo = classifyMarketDataSource(sourceRaw);
    const providerChain = inferProviderChain(sourceInfo.actor);

    const rawTimestamp = toNum(priceMeta.timestamp, toNum(state.lastKnownPriceTimestamp, 0));
    const tickAgeMs = rawTimestamp > 0 ? Math.max(0, now - rawTimestamp) : null;
    const l1Fresh = tickAgeMs !== null ? tickAgeMs <= freshTargetMs : false;

    const l2DepthLevels = orderbook ? Math.max(0, Math.round(toNum(orderbook.depthLevels, 0))) : 0;
    const l2Available = l2DepthLevels >= 5;
    const l2Source = String(orderbook?.source || 'none').toLowerCase();
    const l2IsSynthetic = l2Source.includes('simulated');
    const l2IsReal = l2Source.includes('binance') || l2Source.includes('rithmic') || l2Source.includes('book');

    let feedTier = 'L1_ONLY';
    if (l2Available && l2IsReal) feedTier = 'L2_REAL';
    else if (l2Available && l2IsSynthetic) feedTier = 'L2_SYNTHETIC';
    else if (l2Available) feedTier = 'L2_PARTIAL';
    if (sourceInfo.actor === 'CLOSED') feedTier = 'MARKET_CLOSED';

    let riskScore = 0;
    if (sourceInfo.actor === 'EXCHANGE') riskScore += 14;
    else if (sourceInfo.actor === 'BROKER') riskScore += 18;
    else if (sourceInfo.actor === 'VENDOR') riskScore += 30;
    else if (sourceInfo.actor === 'SIMULATED') riskScore += 58;
    else if (sourceInfo.actor === 'CLOSED') riskScore += 100;
    else riskScore += 44;

    if (tickAgeMs === null) riskScore += 18;
    else if (tickAgeMs > freshTargetMs * 2.2) riskScore += 36;
    else if (tickAgeMs > freshTargetMs * 1.35) riskScore += 20;
    else if (tickAgeMs > freshTargetMs) riskScore += 10;

    if (mode === 'scalp-1m') {
        if (!l2Available) riskScore += 24;
        else if (l2IsSynthetic) riskScore += 16;
    } else if (mode === 'scalp-3m') {
        if (!l2Available) riskScore += 16;
        else if (l2IsSynthetic) riskScore += 10;
    } else if (mode === 'intraday') {
        if (!l2Available) riskScore += 8;
    }

    riskScore = clamp(Math.round(riskScore), 0, 100);

    const checklist = [
        {
            id: 'provider_class',
            label: 'Classe fournisseur',
            passed: sourceInfo.actor === 'EXCHANGE' || sourceInfo.actor === 'BROKER' || sourceInfo.actor === 'VENDOR',
            details: `${sourceInfo.actor} (${sourceInfo.sourceClass})`
        },
        {
            id: 'l1_freshness',
            label: 'Fraîcheur L1',
            passed: l1Fresh,
            details: tickAgeMs === null ? 'timestamp absent' : `${tickAgeMs}ms (target ${freshTargetMs}ms)`
        },
        {
            id: 'l2_depth',
            label: 'Profondeur L2',
            passed: l2Available,
            details: `${l2DepthLevels} niveaux (${feedTier})`
        },
        {
            id: 'market_actor_chain',
            label: 'Chaîne fournisseur',
            passed: providerChain.length >= 2,
            details: providerChain.join(' → ')
        }
    ];

    const summary = `Source ${sourceRaw || 'unknown'} | ${sourceInfo.actor} | ${feedTier} | L1 ${tickAgeMs === null ? 'n/a' : `${tickAgeMs}ms`} | L2 ${l2DepthLevels} niveaux.`;

    const blockAt = mode === 'scalp-1m' ? 82 : mode === 'scalp-3m' ? 86 : 90;
    const warnAt = mode === 'scalp-1m' ? 54 : mode === 'scalp-3m' ? 58 : 62;
    const filter = buildRiskFilterSummary({
        riskScore,
        summary,
        checklist,
        blockAt,
        warnAt
    });

    return {
        source: sourceRaw || 'unknown',
        actor: sourceInfo.actor,
        sourceClass: sourceInfo.sourceClass,
        providerChain,
        timeframe,
        freshnessTargetMs: freshTargetMs,
        l1: {
            fresh: l1Fresh,
            tickAgeMs,
            bid: toNum(priceMeta.bid, toNum(state.lastKnownBid, NaN)),
            ask: toNum(priceMeta.ask, toNum(state.lastKnownAsk, NaN)),
            spread: toNum(priceMeta.spread, toNum(state.lastKnownSpread, NaN))
        },
        l2: {
            available: l2Available,
            source: orderbook?.source || 'none',
            depthLevels: l2DepthLevels,
            ratio: orderbook ? toNum(orderbook.ratio, 0.5) : null,
            pressure: orderbook ? String(orderbook.pressure || 'NEUTRAL').toUpperCase() : 'NEUTRAL',
            synthetic: l2IsSynthetic,
            real: l2IsReal
        },
        feedTier,
        filter
    };
}

function computeGeometrySnapshot(candles = [], indicators = {}) {
    if (!Array.isArray(candles) || candles.length < 3) {
        return {
            slopePerCandle: 0,
            slopePctPerCandle: 0,
            channelBreak: 'NONE',
            fibZone: null
        };
    }
    const lookback = candles.slice(-12);
    const first = toNum(lookback[0]?.close, 0);
    const last = toNum(lookback[lookback.length - 1]?.close, first);
    const slopePerCandle = parseFloat(((last - first) / Math.max(1, lookback.length - 1)).toFixed(6));
    const slopePctPerCandle = first > 0
        ? parseFloat((((last - first) / first) * (100 / Math.max(1, lookback.length - 1))).toFixed(6))
        : 0;

    const prevSlice = candles.slice(-7, -1);
    const prevHigh = prevSlice.length ? Math.max(...prevSlice.map((c) => toNum(c.high, last))) : last;
    const prevLow = prevSlice.length ? Math.min(...prevSlice.map((c) => toNum(c.low, last))) : last;
    let channelBreak = 'NONE';
    if (last > prevHigh) channelBreak = 'UP_BREAK';
    else if (last < prevLow) channelBreak = 'DOWN_BREAK';

    const fibZone = indicators?.fibonacci?.inGoldenPocket
        ? 'GOLDEN_POCKET'
        : (indicators?.fibonacci?.nearestLevel || null);

    return {
        slopePerCandle,
        slopePctPerCandle,
        channelBreak,
        fibZone
    };
}

app.post('/api/strategy-signal', async (req, res) => {
    const {
        indicators = {},
        candles = [],
        currentPrice,
        symbol: inputSymbol,
        timeframe = '1min',
        mode = 'scalp-3m',
        usdBias = 'AUTO',
        marketContext = {}
    } = req.body || {};

    const symbol = inputSymbol || 'XAU/USD';
    const config = INSTRUMENTS[symbol] || INSTRUMENTS['XAU/USD'];
    const state = instrumentState[symbol] || {};
    const safePrice = toNum(currentPrice, state?.lastKnownPrice || config.basePrice);
    const safeMode = ['scalp-1m', 'scalp-3m', 'intraday', 'swing'].includes(String(mode)) ? String(mode) : 'scalp-3m';
    const normalizedCandles = normalizeCandlesInput(candles).slice(-1800);
    const marketDataContext = buildMarketDataContext({
        symbol,
        mode: safeMode,
        timeframe,
        providedContext: marketContext,
        state
    });
    const prediction = evaluateScalp3mPrediction(indicators || {}, normalizedCandles, safePrice, symbol);
    const strictRules = evaluateStrictComboRules(indicators || {}, safePrice);
    const patternBias = evaluatePatternBias(indicators?.patterns || []);

    if (!INSTRUMENTS[symbol]) return res.json({ success: false, error: 'Unknown symbol' });

    if (isMarketClosed(symbol)) {
        const closedSessionContext = buildTradingSessionContext(new Date(), {
            mode: safeMode,
            hasNews: false,
            newsCount: 0,
            sentiment: 'NEUTRAL'
        });
        const closedSessionFilter = buildRiskFilterSummary({
            riskScore: 100,
            summary: `Marché fermé. ${closedSessionContext.summary}`,
            checklist: [
                {
                    id: 'active_sessions',
                    label: 'Sessions actives',
                    passed: false,
                    details: closedSessionContext.activeSessions.length > 0
                        ? closedSessionContext.activeSessions.join(', ')
                        : 'Aucune'
                },
                { id: 'market_open', label: 'Marché ouvert', passed: false, details: 'Fermé' }
            ],
            blockAt: 70,
            warnAt: 50
        });
        return res.json({
            success: true,
            source: 'strategy-rules',
            symbol,
            timeframe,
            mode: safeMode,
            usdBiasMode: String(usdBias || 'AUTO').toUpperCase(),
            signal: 'HOLD',
            confidence: 100,
            score: 0,
            horizonMinutes: mapModeHorizonMinutes(safeMode),
            entryPrice: 0,
            takeProfit: 0,
            stopLoss: 0,
            reasoning: getMarketClosedReason(symbol),
            blockedReason: getMarketClosedReason(symbol),
            targetTime: new Date(Date.now() + mapModeHorizonMinutes(safeMode) * 60 * 1000).toISOString(),
            riskGate: {
                enabled: true,
                blocked: true,
                initialSignal: 'HOLD',
                blockers: ['Marché fermé'],
                warnings: [],
                thresholds: { minDirectionalChecks: 4, minReliability: 52, minAgreementPct: 52, minConfidence: 55, minScalpScore: 14 },
                metrics: {
                    timeframe,
                    timeframeSeconds: timeframeToSeconds(timeframe),
                    openSpikeRiskScore: 100,
                    newsRiskScore: 100,
                    dataQualityRiskScore: 100,
                    macroRiskScore: 100,
                    usdRiskScore: 100,
                    marketDataRiskScore: 100,
                    sessionRiskScore: 100,
                    sessionVolatilityScore: closedSessionContext.volatilityScore,
                    sessionLiquidityScore: closedSessionContext.liquidityScore,
                    sessionNewsWindowScore: closedSessionContext.newsPublicationScore
                },
                filters: {
                    openSpike: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' }),
                    news: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' }),
                    dataQuality: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' }),
                    macroCalendar: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' }),
                    usd: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' }),
                    marketData: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' }),
                    session: closedSessionFilter
                }
            },
            geometry: {
                ...computeGeometrySnapshot(normalizedCandles, indicators),
                patternBias: patternBias.signal
            },
            marketData: {
                ...marketDataContext,
                feedTier: 'MARKET_CLOSED',
                filter: buildRiskFilterSummary({ riskScore: 100, summary: 'Marché fermé' })
            },
            sessionFilter: closedSessionFilter,
            tradingSessions: closedSessionContext
        });
    }

    const checkCount = toNum(strictRules?.checkCount, 7);
    const buyPassCount = toNum(strictRules?.buy?.passCount, 0);
    const sellPassCount = toNum(strictRules?.sell?.passCount, 0);
    const directionalChecks = Math.max(buyPassCount, sellPassCount);
    const agreementPct = clamp(Math.round((directionalChecks / Math.max(1, checkCount)) * 100), 0, 100);

    let signal = String(prediction.signal || 'HOLD').toUpperCase();
    let confidence = clamp(toNum(prediction.confidence, 50), 1, 99);
    let score = toNum(prediction.score, 0);
    if (strictRules.available && (strictRules.signal === 'BUY' || strictRules.signal === 'SELL')) {
        signal = strictRules.signal;
        const sideEval = signal === 'BUY' ? strictRules.buy : strictRules.sell;
        confidence = clamp(Math.round((confidence * 0.45) + (toNum(sideEval?.confidence, confidence) * 0.55)), 1, 99);
        score = parseFloat(((score * 0.45) + ((toNum(sideEval?.passCount, 0) - 3) * 12)).toFixed(1));
    }

    const marketDataFilter = marketDataContext.filter || buildRiskFilterSummary({ riskScore: 50, summary: 'Market data context unavailable' });
    const l2Ratio = toNum(marketDataContext?.l2?.ratio, NaN);
    if (signal === 'BUY' && Number.isFinite(l2Ratio)) {
        if (l2Ratio >= 0.57) {
            confidence = clamp(confidence + 4, 1, 99);
            score = parseFloat((score + 1.8).toFixed(1));
        } else if (l2Ratio <= 0.43) {
            confidence = clamp(confidence - 6, 1, 99);
            score = parseFloat((score - 2.6).toFixed(1));
        }
    } else if (signal === 'SELL' && Number.isFinite(l2Ratio)) {
        if (l2Ratio <= 0.43) {
            confidence = clamp(confidence + 4, 1, 99);
            score = parseFloat((score + 1.8).toFixed(1));
        } else if (l2Ratio >= 0.57) {
            confidence = clamp(confidence - 6, 1, 99);
            score = parseFloat((score - 2.6).toFixed(1));
        }
    }
    if (marketDataFilter.caution) {
        confidence = clamp(confidence - 4, 1, 99);
    }

    const horizonMinutes = mapModeHorizonMinutes(safeMode);
    const atr = Math.max(toNum(indicators?.atr, safePrice * 0.0012), safePrice * 0.0008);
    let entryPrice = toNum(prediction.entryPrice, safePrice);
    let takeProfit = toNum(prediction.takeProfit, 0);
    let stopLoss = toNum(prediction.stopLoss, 0);
    if ((takeProfit <= 0 || stopLoss <= 0) && (signal === 'BUY' || signal === 'SELL')) {
        const tpMul = safeMode === 'swing' ? 2.8 : safeMode === 'intraday' ? 1.8 : safeMode === 'scalp-1m' ? 0.55 : 0.8;
        const slMul = safeMode === 'swing' ? 1.6 : safeMode === 'intraday' ? 1.05 : safeMode === 'scalp-1m' ? 0.38 : 0.55;
        if (signal === 'BUY') {
            takeProfit = entryPrice + (atr * tpMul);
            stopLoss = entryPrice - (atr * slMul);
        } else {
            takeProfit = entryPrice - (atr * tpMul);
            stopLoss = entryPrice + (atr * slMul);
        }
    }

    const last = normalizedCandles[normalizedCandles.length - 1] || {};
    const rangePct = safePrice > 0 ? ((toNum(last.high, safePrice) - toNum(last.low, safePrice)) / safePrice) * 100 : 0;
    const openSpikeFilter = buildRiskFilterSummary({
        riskScore: rangePct * 140,
        summary: rangePct > 0.55 ? 'Range bougie élevé (risque spike).' : 'Spike control OK.',
        checklist: [
            { id: 'range_pct', label: 'Range % bougie', passed: rangePct <= 0.55, details: `${rangePct.toFixed(3)}%` },
            { id: 'atr_guard', label: 'ATR guardrail', passed: atr > 0, details: `ATR ${atr.toFixed(3)}` }
        ]
    });

    const dataQualityRisk = normalizedCandles.length >= 320 ? 16 : normalizedCandles.length >= 180 ? 34 : normalizedCandles.length >= 90 ? 62 : 88;
    const dataQualityFilter = buildRiskFilterSummary({
        riskScore: dataQualityRisk,
        summary: normalizedCandles.length >= 180 ? 'Qualité data stable.' : 'Historique insuffisant (fiabilité réduite).',
        checklist: [
            { id: 'candle_count', label: 'Volume de candles', passed: normalizedCandles.length >= 180, details: `${normalizedCandles.length}` }
        ]
    });

    const symbolNewsCache = getNewsCacheEntry(symbol || 'XAU/USD');
    const globalNewsCache = getNewsCacheEntry('GLOBAL');
    const sentiment = String(symbolNewsCache.globalSentiment?.sentiment || globalNewsCache.globalSentiment?.sentiment || 'NEUTRAL').toUpperCase();
    const hasNews = (symbolNewsCache.items?.length || 0) > 0 || (globalNewsCache.items?.length || 0) > 0;
    let newsRiskScore = hasNews ? 36 : 48;
    if ((signal === 'BUY' && sentiment === 'BEARISH') || (signal === 'SELL' && sentiment === 'BULLISH')) newsRiskScore = 79;
    const newsFilter = buildRiskFilterSummary({
        riskScore: newsRiskScore,
        summary: hasNews ? `News sentiment ${sentiment}.` : 'Peu de news récentes (contexte faible).',
        checklist: [
            { id: 'news_feed', label: 'News feed', passed: hasNews, details: hasNews ? 'OK' : 'Sparse' },
            { id: 'sentiment_alignment', label: 'Alignement sentiment', passed: newsRiskScore < 78, details: sentiment }
        ]
    });

    const sessionNewsCount = (symbolNewsCache.items?.length || 0) + (globalNewsCache.items?.length || 0);
    const sessionContext = buildTradingSessionContext(new Date(), {
        mode: safeMode,
        hasNews,
        newsCount: sessionNewsCount,
        sentiment
    });
    const overlapCode = sessionContext.overlaps.londonNewYork
        ? 'LONDON-NEWYORK'
        : sessionContext.overlaps.sydneyTokyo
            ? 'SYDNEY-TOKYO'
            : 'NONE';
    const sessionFilter = buildRiskFilterSummary({
        riskScore: sessionContext.sessionRiskScore,
        summary: sessionContext.summary,
        checklist: [
            {
                id: 'active_sessions',
                label: 'Sessions actives',
                passed: sessionContext.activeSessions.length > 0,
                details: sessionContext.activeSessions.length > 0 ? sessionContext.activeSessions.join(', ') : 'Aucune'
            },
            {
                id: 'volatility_window',
                label: 'Volatilité de session',
                passed: sessionContext.volatilityScore >= toNum(sessionContext.thresholds?.minVolatility, 0),
                details: `${sessionContext.volatilityScore}/100 (min ${toNum(sessionContext.thresholds?.minVolatility, 0)})`
            },
            {
                id: 'liquidity_window',
                label: 'Liquidité de session',
                passed: sessionContext.liquidityScore >= toNum(sessionContext.thresholds?.minLiquidity, 0),
                details: `${sessionContext.liquidityScore}/100 (min ${toNum(sessionContext.thresholds?.minLiquidity, 0)})`
            },
            {
                id: 'news_publication_window',
                label: 'Fenêtre news économiques',
                passed: sessionContext.newsPublicationScore < toNum(sessionContext.thresholds?.newsStress, 100),
                details: `${sessionContext.newsPublicationScore}/100 (stress ${toNum(sessionContext.thresholds?.newsStress, 100)})`
            },
            {
                id: 'session_overlap_control',
                label: 'Contrôle chevauchement',
                passed: !(sessionContext.overlaps.londonNewYork && (safeMode === 'scalp-1m' || safeMode === 'scalp-3m')),
                details: overlapCode
            }
        ],
        blockAt: 88,
        warnAt: 62
    });

    const macroCalendarFilter = buildRiskFilterSummary({
        riskScore: 44,
        summary: 'Filtre macro en mode prudent (proxy).',
        checklist: [{ id: 'macro_proxy', label: 'Proxy macro actif', passed: true, details: 'No hard event feed' }]
    });

    const usdBiasMode = String(usdBias || 'AUTO').toUpperCase();
    const usdContext = {
        source: 'manual',
        indexSymbol: 'DXY',
        bias: usdBiasMode,
        changePct: null,
        strengthScore: usdBiasMode === 'STRONG' ? 75 : usdBiasMode === 'WEAK' ? 25 : 50,
        price: null,
        fresh: false,
        updatedAt: new Date().toISOString()
    };
    let usdRiskScore = usdBiasMode === 'AUTO' ? 35 : 45;
    if (symbol === 'XAU/USD') {
        if (usdBiasMode === 'STRONG' && signal === 'BUY') usdRiskScore = 74;
        if (usdBiasMode === 'WEAK' && signal === 'SELL') usdRiskScore = 74;
    }
    const usdFilter = buildRiskFilterSummary({
        riskScore: usdRiskScore,
        summary: `USD bias ${usdBiasMode}.`,
        checklist: [{ id: 'usd_bias', label: 'Alignement USD', passed: usdRiskScore < 74, details: usdBiasMode }]
    });

    const filters = [openSpikeFilter, newsFilter, dataQualityFilter, macroCalendarFilter, usdFilter, marketDataFilter, sessionFilter];
    const blockedFilters = filters.filter((f) => f.blockTrade);
    const warnings = filters.flatMap((f) => Array.isArray(f.warnings) ? f.warnings : []);
    const blocked = blockedFilters.length > 0;
    const blockedReason = blocked ? blockedFilters.map((f) => f.summary).join(' | ') : undefined;

    const reliabilityScore = clamp(
        Math.round((confidence * 0.6) + (agreementPct * 0.25) + (Math.min(100, Math.abs(score) * 2) * 0.15)),
        0,
        100
    );

    if (blocked) {
        signal = 'HOLD';
        entryPrice = 0;
        takeProfit = 0;
        stopLoss = 0;
    }

    const geometry = {
        ...computeGeometrySnapshot(normalizedCandles, indicators),
        patternBias: patternBias.signal
    };
    const reasons = [
        ...(Array.isArray(prediction?.reasons) ? prediction.reasons : []),
        strictRules?.summary,
        patternBias?.summary,
        `Market data: ${marketDataFilter.summary}`,
        `Sessions: ${sessionContext.summary}`
    ].filter(Boolean).slice(0, 8);

    return res.json({
        success: true,
        source: 'strategy-rules',
        symbol,
        timeframe,
        mode: safeMode,
        usdBiasMode,
        usdContext,
        signal,
        confidence,
        score,
        horizonMinutes,
        entryPrice: signal === 'HOLD' ? 0 : parseFloat(toNum(entryPrice, 0).toFixed(2)),
        takeProfit: signal === 'HOLD' ? 0 : parseFloat(toNum(takeProfit, 0).toFixed(2)),
        stopLoss: signal === 'HOLD' ? 0 : parseFloat(toNum(stopLoss, 0).toFixed(2)),
        reasoning: blocked
            ? `Signal bloqué par garde-fous: ${blockedReason}.`
            : (prediction.reasoning || `Mode ${safeMode} actif.`),
        reasons,
        targetTime: new Date(Date.now() + horizonMinutes * 60 * 1000).toISOString(),
        blockedReason,
        riskGate: {
            enabled: true,
            blocked,
            initialSignal: String(prediction.signal || 'HOLD').toUpperCase(),
            blockers: blocked ? blockedFilters.map((f) => f.summary) : [],
            warnings,
            thresholds: { minDirectionalChecks: 4, minReliability: 52, minAgreementPct: 52, minConfidence: 55, minScalpScore: 14 },
            metrics: {
                timeframe,
                timeframeSeconds: timeframeToSeconds(timeframe),
                openSpikeRiskScore: openSpikeFilter.riskScore,
                newsRiskScore: newsFilter.riskScore,
                dataQualityRiskScore: dataQualityFilter.riskScore,
                macroRiskScore: macroCalendarFilter.riskScore,
                usdRiskScore: usdFilter.riskScore,
                marketDataRiskScore: marketDataFilter.riskScore,
                sessionRiskScore: sessionFilter.riskScore,
                sessionVolatilityScore: sessionContext.volatilityScore,
                sessionLiquidityScore: sessionContext.liquidityScore,
                sessionNewsWindowScore: sessionContext.newsPublicationScore,
                marketDataFeedTier: marketDataContext.feedTier,
                marketDataSourceClass: marketDataContext.sourceClass,
                marketDataL1AgeMs: marketDataContext.l1?.tickAgeMs,
                marketDataL2DepthLevels: marketDataContext.l2?.depthLevels
            },
            filters: {
                openSpike: openSpikeFilter,
                news: newsFilter,
                dataQuality: dataQualityFilter,
                macroCalendar: macroCalendarFilter,
                usd: usdFilter,
                marketData: marketDataFilter,
                session: sessionFilter
            }
        },
        technicalSummary: {
            totalChecks: checkCount,
            directionalChecks,
            bullishChecks: buyPassCount,
            bearishChecks: sellPassCount,
            neutralChecks: Math.max(0, checkCount - directionalChecks),
            agreementPct,
            activationPct: clamp(Math.round(Math.min(100, Math.abs(score) * 3.2)), 0, 100),
            reliabilityScore,
            rawScore: score,
            maxRawScore: 100
        },
        geometry,
        newsFilter,
        openSpikeFilter,
        dataQualityFilter,
        macroCalendarFilter,
        usdFilter,
        marketDataFilter,
        marketData: marketDataContext,
        sessionFilter,
        tradingSessions: sessionContext
    });
});

app.post('/api/backtest-strategy', async (req, res) => {
    const {
        symbol: inputSymbol,
        timeframe = '1min',
        mode = 'scalp-3m',
        usdBias = 'AUTO',
        candles = [],
        indicatorSamples = [],
        maxSamples = 320
    } = req.body || {};

    const symbol = inputSymbol || 'XAU/USD';
    const safeMode = ['scalp-1m', 'scalp-3m', 'intraday', 'swing'].includes(String(mode)) ? String(mode) : 'scalp-3m';
    const normalizedCandles = normalizeCandlesInput(candles).slice(-2400);
    const samples = Array.isArray(indicatorSamples)
        ? indicatorSamples
            .map((s) => ({ index: Math.max(0, Math.round(toNum(s?.index, -1))), indicators: s?.indicators || {} }))
            .filter((s) => s.index >= 0)
        : [];

    if (!INSTRUMENTS[symbol]) return res.json({ success: false, error: 'Unknown symbol' });
    if (normalizedCandles.length < 120 || samples.length < 20) {
        return res.json({
            success: false,
            source: 'backtest-rules',
            symbol,
            mode: safeMode,
            timeframe,
            error: 'Not enough candles/indicator snapshots'
        });
    }

    const tfSeconds = timeframeToSeconds(timeframe);
    const horizonMinutes = mapModeHorizonMinutes(safeMode);
    const horizonBars = Math.max(1, Math.round((horizonMinutes * 60) / tfSeconds));
    const sampleCap = clamp(Math.round(toNum(maxSamples, 320)), 80, 1200);

    const modeThresholds = {
        'scalp-1m': {
            minDirectionalChecks: 5,
            minReliability: 58,
            minAgreementPct: 56,
            minConfidence: 60,
            minScalpScore: 16,
            minRiskReward: 1.4,
            roundTripCostBps: 3.8,
            breakEvenBandPct: 0.02,
            minAdx: 16,
            minAtrPct: 0.03,
            maxAtrPct: 1.8,
            minEdgePct: 0.03,
            minSpacingBars: 2,
            slippageAtrMultiplier: 0.04,
            minSlippagePct: 0.003,
            maxSlippagePct: 0.035
        },
        'scalp-3m': {
            minDirectionalChecks: 5,
            minReliability: 56,
            minAgreementPct: 55,
            minConfidence: 58,
            minScalpScore: 15,
            minRiskReward: 1.35,
            roundTripCostBps: 3.2,
            breakEvenBandPct: 0.018,
            minAdx: 15,
            minAtrPct: 0.025,
            maxAtrPct: 2.0,
            minEdgePct: 0.028,
            minSpacingBars: 2,
            slippageAtrMultiplier: 0.038,
            minSlippagePct: 0.0025,
            maxSlippagePct: 0.032
        },
        intraday: {
            minDirectionalChecks: 4,
            minReliability: 55,
            minAgreementPct: 53,
            minConfidence: 56,
            minScalpScore: 18,
            minRiskReward: 1.4,
            roundTripCostBps: 2.6,
            breakEvenBandPct: 0.015,
            minAdx: 14,
            minAtrPct: 0.02,
            maxAtrPct: 2.4,
            minEdgePct: 0.024,
            minSpacingBars: 1,
            slippageAtrMultiplier: 0.03,
            minSlippagePct: 0.002,
            maxSlippagePct: 0.028
        },
        swing: {
            minDirectionalChecks: 4,
            minReliability: 53,
            minAgreementPct: 52,
            minConfidence: 55,
            minScalpScore: 20,
            minRiskReward: 1.45,
            roundTripCostBps: 2.2,
            breakEvenBandPct: 0.013,
            minAdx: 12,
            minAtrPct: 0.015,
            maxAtrPct: 3.2,
            minEdgePct: 0.02,
            minSpacingBars: 1,
            slippageAtrMultiplier: 0.025,
            minSlippagePct: 0.0015,
            maxSlippagePct: 0.024
        }
    };
    const thresholds = modeThresholds[safeMode] || modeThresholds['scalp-3m'];
    const roundTripCostPct = thresholds.roundTripCostBps / 100;

    let evaluatedSamples = 0;
    let blockedSignals = 0;
    let trades = 0;
    let buySignals = 0;
    let sellSignals = 0;
    let breakEvenTrades = 0;
    let wins = 0;
    let losses = 0;
    let totalReturnPct = 0;
    let grossProfitPct = 0;
    let grossLossPct = 0;
    let maxWinPct = Number.NEGATIVE_INFINITY;
    let maxLossPct = Number.POSITIVE_INFINITY;
    let confidenceAcc = 0;
    let riskRewardAcc = 0;
    let holdingBarsAcc = 0;
    let tpHits = 0;
    let slHits = 0;
    let timeExitTrades = 0;
    let blockedBySignal = 0;
    let blockedByQuality = 0;
    let blockedByPattern = 0;
    let blockedByRegime = 0;
    let blockedByRiskReward = 0;
    let blockedByEdge = 0;
    let blockedByCooldown = 0;

    let equityCurve = 0;
    let equityPeak = 0;
    let maxDrawdownPct = 0;
    let nextTradableIndex = 0;

    const orderedSamples = samples
        .sort((a, b) => a.index - b.index)
        .slice(-sampleCap);

    const simulateTradeExit = (side, startIdx, endIdx, entryPrice, takeProfit, stopLoss) => {
        let exitPrice = toNum(normalizedCandles[endIdx]?.close, entryPrice);
        let exitType = 'TIME';
        let exitIndex = endIdx;

        for (let barIdx = startIdx + 1; barIdx <= endIdx; barIdx++) {
            const bar = normalizedCandles[barIdx] || {};
            const high = toNum(bar.high, entryPrice);
            const low = toNum(bar.low, entryPrice);
            const open = toNum(bar.open, entryPrice);

            if (side === 'BUY') {
                const hitTp = high >= takeProfit;
                const hitSl = low <= stopLoss;
                if (!hitTp && !hitSl) continue;

                if (hitTp && hitSl) {
                    const distToStop = Math.abs(open - stopLoss);
                    const distToTp = Math.abs(takeProfit - open);
                    if (distToStop <= distToTp) {
                        exitPrice = stopLoss;
                        exitType = 'SL';
                    } else {
                        exitPrice = takeProfit;
                        exitType = 'TP';
                    }
                } else if (hitSl) {
                    exitPrice = stopLoss;
                    exitType = 'SL';
                } else {
                    exitPrice = takeProfit;
                    exitType = 'TP';
                }
                exitIndex = barIdx;
                break;
            }

            if (side === 'SELL') {
                const hitTp = low <= takeProfit;
                const hitSl = high >= stopLoss;
                if (!hitTp && !hitSl) continue;

                if (hitTp && hitSl) {
                    const distToStop = Math.abs(stopLoss - open);
                    const distToTp = Math.abs(open - takeProfit);
                    if (distToStop <= distToTp) {
                        exitPrice = stopLoss;
                        exitType = 'SL';
                    } else {
                        exitPrice = takeProfit;
                        exitType = 'TP';
                    }
                } else if (hitSl) {
                    exitPrice = stopLoss;
                    exitType = 'SL';
                } else {
                    exitPrice = takeProfit;
                    exitType = 'TP';
                }
                exitIndex = barIdx;
                break;
            }
        }

        return {
            exitPrice: toNum(exitPrice, entryPrice),
            exitType,
            exitIndex,
            holdingBars: Math.max(1, exitIndex - startIdx)
        };
    };

    for (const sample of orderedSamples) {
        if (evaluatedSamples >= sampleCap) break;
        const idx = sample.index;
        if (idx < 5 || idx + horizonBars >= normalizedCandles.length) continue;
        if (idx < nextTradableIndex) {
            blockedSignals += 1;
            blockedByCooldown += 1;
            continue;
        }

        const entryPrice = toNum(normalizedCandles[idx]?.close, 0);
        if (entryPrice <= 0) continue;

        const contextCandles = normalizedCandles.slice(Math.max(0, idx - 140), idx + 1);
        const pred = evaluateScalp3mPrediction(sample.indicators || {}, contextCandles, entryPrice, symbol);
        evaluatedSamples += 1;

        const side = String(pred?.signal || 'HOLD').toUpperCase();
        const directionalChecks = Math.max(0, Math.min(10, Array.isArray(pred?.reasons) ? pred.reasons.length : 0));
        const agreementPct = clamp(Math.round(Math.min(100, Math.abs(toNum(pred?.score, 0)) * 3.2)), 0, 100);
        const reliabilityScore = clamp(Math.round((toNum(pred?.confidence, 0) * 0.7) + (agreementPct * 0.3)), 0, 100);
        const confidence = toNum(pred?.confidence, 0);
        const patternSignal = String(pred?.patternBias?.signal || 'HOLD').toUpperCase();
        const patternConflict = (patternSignal === 'BUY' || patternSignal === 'SELL') && patternSignal !== side;
        const adx = Math.max(0, toNum(sample.indicators?.adx?.adx, 0));

        const atrValue = Math.max(toNum(sample.indicators?.atr, 0), entryPrice * 0.0006);
        const atrPct = entryPrice > 0 ? ((atrValue / entryPrice) * 100) : 0;
        const regimeBlocked = (
            adx < thresholds.minAdx ||
            atrPct < thresholds.minAtrPct ||
            atrPct > thresholds.maxAtrPct
        );
        let plannedTp = toNum(pred?.takeProfit, 0);
        let plannedSl = toNum(pred?.stopLoss, 0);
        if (side === 'BUY') {
            if (!(plannedTp > entryPrice)) plannedTp = entryPrice + (atrValue * 0.9);
            if (!(plannedSl < entryPrice)) plannedSl = entryPrice - (atrValue * 0.62);
        } else if (side === 'SELL') {
            if (!(plannedTp < entryPrice)) plannedTp = entryPrice - (atrValue * 0.9);
            if (!(plannedSl > entryPrice)) plannedSl = entryPrice + (atrValue * 0.62);
        }

        const riskAbs = side === 'BUY'
            ? Math.max(entryPrice - plannedSl, atrValue * 0.35)
            : Math.max(plannedSl - entryPrice, atrValue * 0.35);
        const rewardAbs = side === 'BUY'
            ? Math.max(plannedTp - entryPrice, 0)
            : Math.max(entryPrice - plannedTp, 0);
        const riskReward = rewardAbs > 0 ? (rewardAbs / Math.max(riskAbs, 1e-9)) : 0;
        const slippagePct = clamp(
            atrPct * thresholds.slippageAtrMultiplier,
            thresholds.minSlippagePct,
            thresholds.maxSlippagePct
        );
        const effectiveRoundTripCostPct = roundTripCostPct + slippagePct;
        const rewardPct = entryPrice > 0 ? (rewardAbs / entryPrice) * 100 : 0;
        const edgePct = rewardPct - effectiveRoundTripCostPct;

        const signalInvalid = side === 'HOLD' || (side !== 'BUY' && side !== 'SELL');
        const qualityInvalid = (
            directionalChecks < thresholds.minDirectionalChecks ||
            reliabilityScore < thresholds.minReliability ||
            agreementPct < thresholds.minAgreementPct ||
            confidence < thresholds.minConfidence ||
            Math.abs(toNum(pred?.score, 0)) < thresholds.minScalpScore
        );
        const rrInvalid = riskReward < thresholds.minRiskReward;
        const edgeInvalid = edgePct < thresholds.minEdgePct;

        const shouldBlock = (
            signalInvalid ||
            qualityInvalid ||
            patternConflict ||
            regimeBlocked ||
            rrInvalid ||
            edgeInvalid
        );

        if (shouldBlock) {
            blockedSignals += 1;
            if (signalInvalid) blockedBySignal += 1;
            if (qualityInvalid) blockedByQuality += 1;
            if (patternConflict) blockedByPattern += 1;
            if (regimeBlocked) blockedByRegime += 1;
            if (rrInvalid) blockedByRiskReward += 1;
            if (edgeInvalid) blockedByEdge += 1;
            continue;
        }

        const simulated = simulateTradeExit(side, idx, idx + horizonBars, entryPrice, plannedTp, plannedSl);
        const rawRetPct = side === 'BUY'
            ? ((simulated.exitPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - simulated.exitPrice) / entryPrice) * 100;
        const retPct = rawRetPct - effectiveRoundTripCostPct;

        trades += 1;
        confidenceAcc += confidence;
        riskRewardAcc += riskReward;
        holdingBarsAcc += simulated.holdingBars;
        if (side === 'BUY') buySignals += 1;
        else sellSignals += 1;
        if (simulated.exitType === 'TP') tpHits += 1;
        else if (simulated.exitType === 'SL') slHits += 1;
        else timeExitTrades += 1;

        totalReturnPct += retPct;
        maxWinPct = Math.max(maxWinPct, retPct);
        maxLossPct = Math.min(maxLossPct, retPct);

        if (retPct > thresholds.breakEvenBandPct) {
            wins += 1;
            grossProfitPct += retPct;
        } else if (retPct < -thresholds.breakEvenBandPct) {
            losses += 1;
            grossLossPct += Math.abs(retPct);
        } else {
            breakEvenTrades += 1;
        }

        equityCurve += retPct;
        equityPeak = Math.max(equityPeak, equityCurve);
        const drawdown = Math.max(0, equityPeak - equityCurve);
        maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
        nextTradableIndex = Math.max(nextTradableIndex, simulated.exitIndex + Math.max(1, thresholds.minSpacingBars));
    }

    const winRate = trades > 0 ? (wins / trades) * 100 : 0;
    const lossRate = trades > 0 ? (losses / trades) * 100 : 0;
    const avgReturnPct = trades > 0 ? totalReturnPct / trades : 0;
    const expectancyPct = avgReturnPct;
    const profitFactor = grossLossPct > 0 ? grossProfitPct / grossLossPct : (grossProfitPct > 0 ? 9.99 : 0);
    const avgConfidence = trades > 0 ? confidenceAcc / trades : 0;
    const avgRiskReward = trades > 0 ? riskRewardAcc / trades : 0;
    const avgHoldingBars = trades > 0 ? holdingBarsAcc / trades : 0;

    const firstClose = toNum(normalizedCandles[0]?.close, 0);
    const lastClose = toNum(normalizedCandles[normalizedCandles.length - 1]?.close, firstClose);
    const benchmarkBuyHoldPct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

    return res.json({
        success: true,
        source: 'backtest-rules',
        symbol,
        mode: safeMode,
        usdBiasMode: String(usdBias || 'AUTO').toUpperCase(),
        usdContext: {
            source: 'manual',
            indexSymbol: 'DXY',
            bias: String(usdBias || 'AUTO').toUpperCase(),
            changePct: null,
            strengthScore: String(usdBias || 'AUTO').toUpperCase() === 'STRONG' ? 75 : String(usdBias || 'AUTO').toUpperCase() === 'WEAK' ? 25 : 50,
            price: null,
            fresh: false,
            updatedAt: new Date().toISOString()
        },
        timeframe,
        bars: normalizedCandles.length,
        horizonBars,
        horizonMinutes,
        evaluatedSamples,
        blockedSignals,
        trades,
        buySignals,
        sellSignals,
        breakEvenTrades,
        winRate: parseFloat(winRate.toFixed(2)),
        lossRate: parseFloat(lossRate.toFixed(2)),
        avgReturnPct: parseFloat(avgReturnPct.toFixed(4)),
        expectancyPct: parseFloat(expectancyPct.toFixed(4)),
        profitFactor: parseFloat(profitFactor.toFixed(4)),
        maxWinPct: Number.isFinite(maxWinPct) ? parseFloat(maxWinPct.toFixed(4)) : 0,
        maxLossPct: Number.isFinite(maxLossPct) ? parseFloat(maxLossPct.toFixed(4)) : 0,
        maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(4)),
        grossProfitPct: parseFloat(grossProfitPct.toFixed(4)),
        grossLossPct: parseFloat(grossLossPct.toFixed(4)),
        avgConfidence: parseFloat(avgConfidence.toFixed(2)),
        avgRiskReward: parseFloat(avgRiskReward.toFixed(3)),
        avgHoldingBars: parseFloat(avgHoldingBars.toFixed(2)),
        tpHits,
        slHits,
        timeExitTrades,
        blockedBySignal,
        blockedByQuality,
        blockedByPattern,
        blockedByRegime,
        blockedByRiskReward,
        blockedByEdge,
        blockedByCooldown,
        benchmarkBuyHoldPct: parseFloat(benchmarkBuyHoldPct.toFixed(4)),
        thresholds
    });
});

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
    const aiSentiment = String(contextGlobalSentiment?.sentiment || 'NEUTRAL').toUpperCase();
    const aiSessionContext = buildTradingSessionContext(new Date(), {
        mode: 'scalp-3m',
        hasNews: contextNewsItems.length > 0,
        newsCount: contextNewsItems.length,
        sentiment: aiSentiment
    });
    const aiSessionSummary = aiSessionContext.summary;
    const aiSessionActive = aiSessionContext.activeSessions.length > 0
        ? aiSessionContext.activeSessions.join(', ')
        : 'Aucune';
    const aiSessionOverlap = aiSessionContext.overlaps.londonNewYork
        ? 'LONDON-NEWYORK'
        : aiSessionContext.overlaps.sydneyTokyo
            ? 'SYDNEY-TOKYO'
            : 'NONE';

    const newsContext = contextNewsItems.length > 0
        ? `\n\nACTUALITÉS RÉCENTES:\n${contextNewsItems.slice(0, 5).map(n => `- [${n.sentiment}] ${n.title}`).join('\n')}\nSentiment global: ${contextGlobalSentiment?.sentiment || 'N/A'} (score: ${contextGlobalSentiment?.score || 0})`
        : '';
    const detectedPatterns = Array.isArray(indicators?.patterns) ? indicators.patterns : [];
    const patternBias = evaluatePatternBias(detectedPatterns);
    const patternText = detectedPatterns.length > 0
        ? detectedPatterns
            .slice(-6)
            .map((p) => `${p.name || 'Pattern'}:${normalizePatternSignal(p)}`)
            .join(', ')
        : 'Aucun';

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
Patterns: ${patternText} | Bias patterns: ${patternBias.signal} (score ${patternBias.score})

─── CONTEXTE SESSIONS DE TRADING ───
Sessions actives: ${aiSessionActive}
Chevauchement: ${aiSessionOverlap}
Volatilité session: ${aiSessionContext.volatilityScore}/100
Liquidité session: ${aiSessionContext.liquidityScore}/100
Fenêtre de publication news: ${aiSessionContext.newsPublicationScore}/100
Résumé session: ${aiSessionSummary}

─── BOUGIES ───
${(candles || []).slice(-10).map(c => `O:${c.open} H:${c.high} L:${c.low} C:${c.close}`).join('\n')}
${newsContext}

RÉPONDS en JSON strict: {"signal":"BUY","confidence":75,"reasoning":"Explication 2-3 phrases","entryPrice":0,"takeProfit":0,"stopLoss":0}`;

    const strictRules = evaluateStrictComboRules(indicators, currentPrice);

    // Try all AI providers
    const aiResult = await callAI(prompt, aiModel, {
        symbol,
        currentPrice,
        indicators,
        candles,
        newsItems: contextNewsItems,
        patternBias: patternBias.signal
    });
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
                    reasoning: `Signal IA ${aiSignal} filtré: confluence stricte non validée (${sideEval.passCount}/${strictRules.checkCount || 7}). ${strictRules.summary}.`,
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
                reasoning: `${aiResult.reasoning || 'Signal IA.'} | Confluence stricte validée (${sideEval.passCount}/${strictRules.checkCount || 7}).`,
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
                reasoning: `Confluence stricte validée (${sideEval.passCount}/${strictRules.checkCount || 7}). ${strictRules.summary}.`,
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
function getOrderbookSpreadRatio(symbol) {
    const ratio = toNum(tradingViewSymbolConfig?.[symbol]?.spreadRatio, 0);
    if (ratio > 0) return ratio;
    if (isCryptoInstrument(symbol)) return 0.00008;
    return 0.00012;
}

function buildSyntheticOrderbook(symbol, price, levels = 10) {
    const config = INSTRUMENTS[symbol] || {};
    const decimals = Number.isFinite(config.decimals) ? config.decimals : 2;
    const safePrice = Math.max(0.0001, toNum(price, toNum(config.basePrice, 1)));
    const minMove = 1 / (10 ** Math.min(Math.max(decimals, 0), 8));
    const spread = Math.max(safePrice * getOrderbookSpreadRatio(symbol), minMove * 6);
    const bookLevels = Math.max(5, Math.min(20, Math.round(toNum(levels, 10))));

    const notionalBase = safePrice >= 10000
        ? 1200
        : safePrice >= 1000
            ? 3000
            : safePrice >= 100
                ? 15000
                : safePrice >= 10
                    ? 30000
                    : 100000;
    const qtyBase = Math.max(notionalBase / safePrice, minMove * 1000);

    const nowPhase = ((Date.now() / 1000) % 180) / 180;
    const bias = Math.sin(nowPhase * Math.PI * 2) * 0.08;
    const bids = [];
    const asks = [];

    for (let i = 0; i < bookLevels; i += 1) {
        const level = i + 1;
        const step = spread * (0.55 + (i * 0.78));
        const bidPrice = Number((safePrice - step).toFixed(decimals));
        const askPrice = Number((safePrice + step).toFixed(decimals));
        const depthWeight = 1 + (level * 0.22);
        const randomA = 0.82 + (Math.random() * 0.36);
        const randomB = 0.82 + (Math.random() * 0.36);
        const bidQty = Number((qtyBase * depthWeight * randomA * (1 + bias)).toFixed(Math.min(6, decimals + 3)));
        const askQty = Number((qtyBase * depthWeight * randomB * (1 - bias)).toFixed(Math.min(6, decimals + 3)));
        bids.push({ price: bidPrice, qty: bidQty, total: Number((bidPrice * bidQty).toFixed(2)) });
        asks.push({ price: askPrice, qty: askQty, total: Number((askPrice * askQty).toFixed(2)) });
    }

    const bidVolume = bids.reduce((sum, row) => sum + row.total, 0);
    const askVolume = asks.reduce((sum, row) => sum + row.total, 0);
    const ratio = bidVolume + askVolume > 0 ? bidVolume / (bidVolume + askVolume) : 0.5;
    const pressure = ratio > 0.55 ? 'BUY' : ratio < 0.45 ? 'SELL' : 'NEUTRAL';

    return {
        bids,
        asks,
        bidVolume: Math.round(bidVolume),
        askVolume: Math.round(askVolume),
        ratio: parseFloat(ratio.toFixed(3)),
        pressure,
        source: 'simulated-l2',
        depthLevels: Math.min(bids.length, asks.length),
        timestamp: Date.now()
    };
}

async function fetchBinanceOrderbookLevel2(symbol, limit = 10) {
    const binanceSymbol = binanceSymbols[symbol];
    if (!binanceSymbol) return null;
    const fetch = (await import('node-fetch')).default;
    const depth = await fetch(`https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=${Math.max(5, Math.min(50, limit))}`, { timeout: 5000 });
    const data = await depth.json();

    const bids = (data.bids || []).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty), total: parseFloat(price) * parseFloat(qty) }));
    const asks = (data.asks || []).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty), total: parseFloat(price) * parseFloat(qty) }));

    const bidVolume = bids.reduce((s, b) => s + b.total, 0);
    const askVolume = asks.reduce((s, a) => s + a.total, 0);
    const ratio = bidVolume + askVolume > 0 ? bidVolume / (bidVolume + askVolume) : 0.5;
    const pressure = ratio > 0.55 ? 'BUY' : ratio < 0.45 ? 'SELL' : 'NEUTRAL';

    return {
        bids,
        asks,
        bidVolume: Math.round(bidVolume),
        askVolume: Math.round(askVolume),
        ratio: parseFloat(ratio.toFixed(3)),
        pressure,
        source: 'binance-l2',
        depthLevels: Math.min(bids.length, asks.length),
        timestamp: Date.now()
    };
}

app.get('/api/orderbook', async (req, res) => {
    const symbol = req.query.symbol || 'BTC/USD';
    if (!INSTRUMENTS[symbol]) return res.json({ success: false, error: 'Unknown symbol' });
    const livePrice = toNum(instrumentState[symbol]?.lastKnownPrice, toNum(INSTRUMENTS[symbol]?.basePrice, 0));

    try {
        if (binanceSymbols[symbol]) {
            const liveL2 = await fetchBinanceOrderbookLevel2(symbol, 15);
            if (liveL2) {
                updateInstrumentOrderbookState(symbol, liveL2);
                return res.json({
                    success: true,
                    symbol,
                    ...liveL2
                });
            }
        }
    } catch (e) {
        console.log(`Orderbook crypto fallback ${symbol}:`, e.message);
    }

    const synthetic = buildSyntheticOrderbook(symbol, livePrice > 0 ? livePrice : toNum(INSTRUMENTS[symbol]?.basePrice, 0), 10);
    updateInstrumentOrderbookState(symbol, synthetic);
    return res.json({
        success: true,
        symbol,
        ...synthetic
    });
});

// ============================================================
//  MACRO CALENDAR (synthetic schedule + impact model)
// ============================================================
function parseMacroValue(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const compact = raw.replace(/,/g, '');
    const sign = compact.startsWith('-') ? -1 : 1;
    const numeric = parseFloat(compact.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(numeric)) return null;
    if (/[kK]\b/.test(compact)) return sign * numeric * 1_000;
    if (/[mM]\b/.test(compact)) return sign * numeric * 1_000_000;
    if (/[bB]\b/.test(compact)) return sign * numeric * 1_000_000_000;
    return sign * numeric;
}

function inferMacroImpact(expected, actual, positiveWhenHigher = true) {
    const exp = parseMacroValue(expected);
    const act = parseMacroValue(actual);
    if (exp === null || act === null || act === exp) return 'neutral';
    const better = act > exp;
    if (positiveWhenHigher) return better ? 'bullish' : 'bearish';
    return better ? 'bearish' : 'bullish';
}

function formatRelativeCountdown(targetTs, nowTs) {
    const deltaMs = targetTs - nowTs;
    const abs = Math.abs(deltaMs);
    const mins = Math.round(abs / 60000);
    const hours = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);

    if (deltaMs >= 0) {
        if (days >= 1) return `In ${days}d`;
        if (hours >= 1) return `In ${hours}h`;
        return `In ${Math.max(1, mins)}m`;
    }
    if (days >= 1) return `${days}d ago`;
    if (hours >= 1) return `${hours}h ago`;
    return `${Math.max(1, mins)}m ago`;
}

app.get('/api/macro-calendar', (req, res) => {
    const symbol = String(req.query.symbol || 'XAU/USD');
    const now = Date.now();

    const templates = [
        { id: 'nfp', title: 'Non-Farm Payrolls', country: 'US', flag: '🇺🇸', importance: 'high', offsetHours: -48, previous: '228K', expected: '242K', actual: '256K', positiveWhenHigher: true },
        { id: 'cpi_us', title: 'US CPI (YoY)', country: 'US', flag: '🇺🇸', importance: 'high', offsetHours: -22, previous: '2.9%', expected: '3.0%', actual: '3.1%', positiveWhenHigher: false },
        { id: 'fed_rate', title: 'Fed Interest Rate Decision', country: 'US', flag: '🇺🇸', importance: 'high', offsetHours: 14, previous: '5.25%', expected: '5.25%', actual: null, positiveWhenHigher: false },
        { id: 'core_pce', title: 'US Core PCE', country: 'US', flag: '🇺🇸', importance: 'high', offsetHours: 30, previous: '2.8%', expected: '2.7%', actual: null, positiveWhenHigher: false },
        { id: 'fomc_minutes', title: 'FOMC Minutes', country: 'US', flag: '🇺🇸', importance: 'medium', offsetHours: 44, previous: '-', expected: '-', actual: null, positiveWhenHigher: false },
        { id: 'ism_pmi', title: 'US ISM Manufacturing PMI', country: 'US', flag: '🇺🇸', importance: 'medium', offsetHours: 60, previous: '49.8', expected: '50.4%', actual: null, positiveWhenHigher: true },
        { id: 'gdp_us', title: 'US GDP QoQ', country: 'US', flag: '🇺🇸', importance: 'high', offsetHours: 76, previous: '2.1%', expected: '2.3%', actual: null, positiveWhenHigher: true },
        { id: 'jobless', title: 'US Initial Jobless Claims', country: 'US', flag: '🇺🇸', importance: 'medium', offsetHours: 92, previous: '226K', expected: '231K', actual: null, positiveWhenHigher: false },
        { id: 'ecb_rate', title: 'ECB Rate Decision', country: 'EU', flag: '🇪🇺', importance: 'high', offsetHours: 104, previous: '4.50%', expected: '4.50%', actual: null, positiveWhenHigher: false },
        { id: 'cpi_eu', title: 'Eurozone CPI (YoY)', country: 'EU', flag: '🇪🇺', importance: 'high', offsetHours: 122, previous: '2.7%', expected: '2.6%', actual: null, positiveWhenHigher: false },
        { id: 'gdp_eu', title: 'Eurozone GDP QoQ', country: 'EU', flag: '🇪🇺', importance: 'medium', offsetHours: 138, previous: '0.3%', expected: '0.4%', actual: null, positiveWhenHigher: true },
        { id: 'boj_rate', title: 'BoJ Policy Rate', country: 'JP', flag: '🇯🇵', importance: 'high', offsetHours: 158, previous: '0.10%', expected: '0.10%', actual: null, positiveWhenHigher: false },
        { id: 'tokyo_cpi', title: 'Tokyo CPI', country: 'JP', flag: '🇯🇵', importance: 'medium', offsetHours: 173, previous: '2.4%', expected: '2.5%', actual: null, positiveWhenHigher: false },
        { id: 'uk_cpi', title: 'UK CPI (YoY)', country: 'UK', flag: '🇬🇧', importance: 'high', offsetHours: 190, previous: '3.7%', expected: '3.5%', actual: null, positiveWhenHigher: false },
        { id: 'boe_rate', title: 'BoE Rate Decision', country: 'UK', flag: '🇬🇧', importance: 'high', offsetHours: 210, previous: '5.25%', expected: '5.25%', actual: null, positiveWhenHigher: false },
        { id: 'opec', title: 'OPEC+ Meeting', country: 'INT', flag: '🌍', importance: 'medium', offsetHours: 228, previous: '-', expected: '-', actual: null, positiveWhenHigher: true },
        { id: 'cad_cpi', title: 'Canada CPI (YoY)', country: 'CA', flag: '🇨🇦', importance: 'medium', offsetHours: 248, previous: '2.9%', expected: '2.8%', actual: null, positiveWhenHigher: false },
        { id: 'aus_employment', title: 'Australia Employment Change', country: 'AU', flag: '🇦🇺', importance: 'medium', offsetHours: 266, previous: '37K', expected: '28K', actual: null, positiveWhenHigher: true },
    ];

    const events = templates.map((item) => {
        const timestamp = now + (item.offsetHours * 3600 * 1000);
        const isPast = timestamp <= now;
        const impact = isPast
            ? inferMacroImpact(item.expected, item.actual, item.positiveWhenHigher)
            : 'neutral';
        return {
            id: item.id,
            title: item.title,
            country: item.country,
            flag: item.flag,
            importance: item.importance,
            previous: item.previous,
            expected: item.expected,
            actual: isPast ? item.actual : null,
            timestamp,
            status: isPast ? 'past' : 'upcoming',
            countdown: formatRelativeCountdown(timestamp, now),
            impact
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    return res.json({
        success: true,
        symbol,
        source: 'synthetic-macro-calendar',
        generatedAt: new Date(now).toISOString(),
        total: events.length,
        events
    });
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

    const timeframes = ['1min', '3min', '5min', '15min', '1h'];
    const results = {};

    for (const tf of timeframes) {
        try {
            // Try exchange-native feeds first, then Yahoo/TwelveData fallback.
            let candles = null;
            if (binanceSymbols[symbol]) candles = await fetchBinanceHistory(symbol, tf, 50);
            if (!candles && krakenSymbols[symbol]) candles = await fetchKrakenHistory(symbol, tf, 50);
            if (!candles) candles = await fetchYahooFinanceHistory(symbol, tf, 50);
            if (!candles && symbol === 'XAU/USD') candles = await fetchTwelveData(symbol, tf, 50);

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

app.post('/api/client-error', (req, res) => {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const message = String(body.message || '').slice(0, 800);
    const source = String(body.source || 'client').slice(0, 64);
    const href = String(body.href || '').slice(0, 500);
    const stack = String(body.stack || '').slice(0, 4000);
    const componentStack = String(body.componentStack || '').slice(0, 4000);

    trackAccess(req, 'client_runtime_error', {
        authorized: true,
        source: 'web-app',
        path: href || req.originalUrl || req.url,
        message,
        clientSource: source,
    });

    console.log('[CLIENT_ERROR]', JSON.stringify({
        source,
        message,
        href,
        stack,
        componentStack,
        userAgent: req.headers['user-agent'] || '',
        ip: extractClientIp(req),
        ts: new Date().toISOString(),
    }));

    res.json({ success: true });
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

app.get('/api/rithmic/status', async (req, res) => {
    const ping = parseBoolean(req.query.ping, true);
    const config = rithmicConfigSnapshot();

    if (!ping || !config.enabled || !config.configured) {
        return res.json({
            success: config.enabled && config.configured,
            mode: 'config',
            ...config
        });
    }

    const probe = await callRithmicUpstream({ method: 'GET', pathName: req.query.path || '/health' });
    if (!probe.ok) {
        return res.status(probe.status).json({
            success: false,
            mode: 'probe',
            ...config,
            upstreamPath: buildRithmicPath(req.query.path || '/health'),
            upstreamError: probe.payload,
        });
    }

    return res.json({
        success: true,
        mode: 'probe',
        ...config,
        upstreamPath: buildRithmicPath(req.query.path || '/health'),
        upstreamData: probe.payload,
    });
});

app.get('/api/rithmic/accounts', async (req, res) => {
    const result = await callRithmicUpstream({ method: 'GET', pathName: '/accounts', query: req.query });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ success: true, source: 'rithmic', data: result.payload });
});

app.get('/api/rithmic/positions', async (req, res) => {
    const result = await callRithmicUpstream({ method: 'GET', pathName: '/positions', query: req.query });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ success: true, source: 'rithmic', data: result.payload });
});

app.get('/api/rithmic/orders', async (req, res) => {
    const result = await callRithmicUpstream({ method: 'GET', pathName: '/orders', query: req.query });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ success: true, source: 'rithmic', data: result.payload });
});

app.get('/api/rithmic/quote', async (req, res) => {
    const result = await callRithmicUpstream({ method: 'GET', pathName: '/quote', query: req.query });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ success: true, source: 'rithmic', data: result.payload });
});

app.post('/api/rithmic/orders', async (req, res) => {
    const result = await callRithmicUpstream({ method: 'POST', pathName: '/orders', query: req.query, body: req.body || {} });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ success: true, source: 'rithmic', data: result.payload });
});

app.delete('/api/rithmic/orders/:orderId', async (req, res) => {
    const orderId = String(req.params.orderId || '').trim();
    const pathName = orderId ? `/orders/${encodeURIComponent(orderId)}` : '/orders';
    const result = await callRithmicUpstream({ method: 'DELETE', pathName, query: req.query });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({ success: true, source: 'rithmic', data: result.payload });
});

app.all('/api/rithmic/proxy', async (req, res) => {
    const method = String(req.query.method || req.method || 'GET').toUpperCase();
    const pathName = buildRithmicPath(req.query.path || (req.body && req.body.path) || '/');
    const body = method === 'GET' || method === 'HEAD'
        ? undefined
        : (req.body && typeof req.body === 'object' && 'payload' in req.body ? req.body.payload : req.body);

    const query = { ...req.query };
    delete query.method;
    delete query.path;

    const result = await callRithmicUpstream({ method, pathName, query, body });
    if (!result.ok) return res.status(result.status).json(result.payload);
    return res.json({
        success: true,
        source: 'rithmic',
        path: pathName,
        method,
        data: result.payload
    });
});

function buildExecutionBridgeStatus(nowMs = Date.now()) {
    const heartbeatMs = toUnixMsStrict(mt5BotState?.lastHeartbeatAt);
    const pending = mt5CommandState?.pendingById && typeof mt5CommandState.pendingById === 'object'
        ? Object.values(mt5CommandState.pendingById)
        : [];
    const ackById = mt5CommandState?.ackById && typeof mt5CommandState.ackById === 'object'
        ? mt5CommandState.ackById
        : {};
    const oldestPendingMs = pending.length > 0
        ? pending.reduce((min, item) => {
            const ts = toUnixMs(item?.issuedAt || item?.createdAt || 0);
            if (!Number.isFinite(ts) || ts <= 0) return min;
            return Math.min(min, ts);
        }, Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
    const pendingMaxAgeMs = Number.isFinite(oldestPendingMs) ? Math.max(0, nowMs - oldestPendingMs) : 0;

    return {
        mt5: {
            online: heartbeatMs > 0 && (nowMs - heartbeatMs) <= MT5_BRIDGE_STALE_MS,
            status: String(mt5BotState?.status || 'STOPPED'),
            activeBotId: mt5BotState?.activeBotId || null,
            lastHeartbeatAt: mt5BotState?.lastHeartbeatAt || null,
            liveGuard: getMt5LiveGuardSnapshot(),
            staleAfterMs: MT5_BRIDGE_STALE_MS,
            pendingCommands: pending.length,
            pendingMaxAgeMs,
            ackedCommands: Object.keys(ackById).length
        },
        rithmic: {
            enabled: RITHMIC_ENABLED,
            configured: Boolean(RITHMIC_API_BASE_URL),
            tokenConfigured: Boolean(RITHMIC_API_TOKEN)
        }
    };
}

function buildRealtimeStatusSnapshot() {
    const nowMs = Date.now();
    const perSymbol = Object.entries(instrumentState).map(([symbol, state]) => {
        const stats = getRealtimeSymbolStats(symbol);
        const lastTickTs = toNum(state.lastKnownPriceTimestamp, 0);
        const tickAgeMs = lastTickTs > 0 ? Math.max(0, nowMs - lastTickTs) : null;
        const lastOrderbookTs = toNum(state.lastOrderbookTimestamp, 0);
        const orderbookAgeMs = lastOrderbookTs > 0 ? Math.max(0, nowMs - lastOrderbookTs) : null;
        return {
            symbol,
            source: state.lastKnownPriceSource || 'unknown',
            tickAgeMs,
            orderbookAgeMs,
            stale: tickAgeMs === null ? true : tickAgeMs > REALTIME_STALE_MS,
            warning: tickAgeMs !== null && tickAgeMs > REALTIME_WARN_MS,
            ticks: toNum(stats.ticks, 0),
            avgTickAgeMs: stats.ticks > 0 ? Math.round(toNum(stats.sumTickAgeMs, 0) / Math.max(1, toNum(stats.ticks, 0))) : null
        };
    });

    const staleSymbols = perSymbol.filter((s) => s.stale).map((s) => s.symbol);
    const warningSymbols = perSymbol.filter((s) => s.warning && !s.stale).map((s) => s.symbol);
    const readySymbols = perSymbol.length - staleSymbols.length;
    const healthScore = perSymbol.length > 0
        ? clamp(Math.round((readySymbols / perSymbol.length) * 100), 0, 100)
        : 0;

    return {
        timestamp: nowMs,
        uptimeSec: Math.max(0, Math.round((nowMs - realtimeTelemetry.startedAtMs) / 1000)),
        healthScore,
        thresholds: {
            warnMs: REALTIME_WARN_MS,
            staleMs: REALTIME_STALE_MS
        },
        websocket: {
            clients: wsClients.size
        },
        redis: {
            chatReady: chatRedisReady,
            chatChannel: CHAT_REDIS_CHANNEL,
            marketBusEnabled: MARKET_BUS_ENABLED,
            marketChannel: MARKET_BUS_CHANNEL,
            marketPublished: realtimeTelemetry.redisMarketPublished,
            marketReceived: realtimeTelemetry.redisMarketReceived,
            marketDropped: realtimeTelemetry.redisMarketDropped
        },
        streams: {
            prices: {
                runs: realtimeTelemetry.streamPricesRuns,
                errors: realtimeTelemetry.streamPricesErrors,
                lastAtMs: realtimeTelemetry.lastPriceStreamAtMs || null
            },
            orderbook: {
                runs: realtimeTelemetry.streamOrderbookRuns,
                errors: realtimeTelemetry.streamOrderbookErrors,
                lastAtMs: realtimeTelemetry.lastOrderbookStreamAtMs || null
            },
            news: {
                runs: realtimeTelemetry.streamNewsRuns,
                errors: realtimeTelemetry.streamNewsErrors,
                lastAtMs: realtimeTelemetry.lastNewsStreamAtMs || null
            }
        },
        traffic: {
            ticksTotal: realtimeTelemetry.ticksTotal,
            orderbookTotal: realtimeTelemetry.orderbookTotal,
            signalTotal: realtimeTelemetry.signalTotal,
            priceBroadcastTotal: realtimeTelemetry.priceBroadcastTotal,
            orderbookBroadcastTotal: realtimeTelemetry.orderbookBroadcastTotal
        },
        primaryExchanges: {
            enabled: ENABLE_PRIMARY_EXCHANGE_FEEDS,
            licenseMode: PRIMARY_LICENSE_MODE,
            licenses: buildPrimaryLicenseStatusMap()
        },
        execution: buildExecutionBridgeStatus(nowMs),
        staleSymbols,
        warningSymbols,
        symbols: perSymbol
    };
}

app.get('/api/realtime/status', (req, res) => {
    res.json({
        success: true,
        data: buildRealtimeStatusSnapshot()
    });
});

app.get('/api/realtime/metrics', (req, res) => {
    const status = buildRealtimeStatusSnapshot();
    const summary = {
        healthScore: status.healthScore,
        wsClients: status.websocket.clients,
        staleCount: status.staleSymbols.length,
        warningCount: status.warningSymbols.length,
        ticksTotal: status.traffic.ticksTotal,
        priceStreamErrors: status.streams.prices.errors,
        orderbookStreamErrors: status.streams.orderbook.errors
    };
    res.json({ success: true, summary, data: status });
});

app.get('/api/execution/status', (req, res) => {
    res.json({
        success: true,
        timestamp: Date.now(),
        data: buildExecutionBridgeStatus(Date.now())
    });
});

app.get('/api/health', (req, res) => {
    const realtime = buildRealtimeStatusSnapshot();
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        instruments: Object.keys(INSTRUMENTS),
        rithmic: rithmicConfigSnapshot(),
        realtime: {
            healthScore: realtime.healthScore,
            staleSymbols: realtime.staleSymbols.length,
            wsClients: realtime.websocket.clients
        }
    });
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
const chatClientToServerId = new Map();
const MAX_CHAT_TEXT_LENGTH = 2000;
const MAX_CHAT_MEDIA_DATA_URL_LENGTH = 3_200_000;
const remoteChatPeers = new Map();
let chatRedisPub = null;
let chatRedisSub = null;
let chatRedisReady = false;
let chatRedisSeq = 0;
let chatHeartbeatTimer = null;
let chatRemoteCleanupTimer = null;

function getNowMs() {
    return Date.now();
}

function safeWsSend(ws, payload) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(payload));
    return true;
}

function sanitizeChatId(raw, fallback) {
    const sanitized = String(raw || '')
        .trim()
        .replace(/[^a-zA-Z0-9_.:-]/g, '')
        .slice(0, 56);
    return sanitized || fallback;
}

function sanitizeChatName(raw, fallback) {
    const sanitized = String(raw || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 28);
    return sanitized || fallback;
}

function chatNameToIdSeed(name) {
    const base = String(name || '').trim();
    if (!base) return '';

    let ascii = base;
    try {
        ascii = base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    } catch {
        ascii = base;
    }

    return ascii.replace(/\s+/g, '_');
}

function getLocalChatPeersList() {
    return [...wsClients.values()]
        .filter((client) => !!client.chatClientId)
        .map((client) => ({
            clientId: client.chatClientId,
            name: client.chatName || client.chatClientId,
            symbol: client.symbol || null,
            instanceId: CHAT_INSTANCE_ID
        }));
}

function upsertRemoteChatPeer(peer, sourceInstanceId, seenAt = getNowMs()) {
    if (!peer || typeof peer !== 'object') return;
    const clientId = sanitizeChatId(peer.clientId, '');
    if (!clientId) return;

    const name = sanitizeChatName(peer.name, clientId);
    const symbol = typeof peer.symbol === 'string' ? peer.symbol : null;
    const instanceId = String(sourceInstanceId || peer.instanceId || '').trim();

    // Never store local peers in the remote cache.
    if (instanceId && instanceId === CHAT_INSTANCE_ID) return;

    remoteChatPeers.set(clientId, {
        clientId,
        name,
        symbol,
        instanceId: instanceId || 'remote',
        lastSeen: seenAt
    });
}

function removeRemoteChatPeer(clientId) {
    if (!clientId) return;
    remoteChatPeers.delete(clientId);
}

function pruneRemoteChatPeers() {
    const now = getNowMs();
    for (const [clientId, peer] of remoteChatPeers.entries()) {
        if ((now - Number(peer.lastSeen || 0)) > CHAT_REDIS_REMOTE_STALE_MS) {
            remoteChatPeers.delete(clientId);
        }
    }
}

function getChatPeersList() {
    pruneRemoteChatPeers();
    const merged = new Map();

    for (const peer of getLocalChatPeersList()) {
        merged.set(peer.clientId, {
            clientId: peer.clientId,
            name: peer.name,
            symbol: peer.symbol || null
        });
    }

    for (const peer of remoteChatPeers.values()) {
        if (!merged.has(peer.clientId)) {
            merged.set(peer.clientId, {
                clientId: peer.clientId,
                name: peer.name || peer.clientId,
                symbol: peer.symbol || null
            });
        }
    }

    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function hasAnyKnownChatPeer(clientId) {
    if (!clientId) return false;
    if (chatClientToServerId.has(clientId)) return true;
    const remote = remoteChatPeers.get(clientId);
    if (!remote) return false;
    return (getNowMs() - Number(remote.lastSeen || 0)) <= CHAT_REDIS_REMOTE_STALE_MS;
}

function broadcastChat(payload, excludedServerClientId = null) {
    let delivered = 0;
    for (const [serverClientId, client] of wsClients) {
        if (!client.chatClientId) continue;
        if (excludedServerClientId && serverClientId === excludedServerClientId) continue;
        if (safeWsSend(client.ws, payload)) delivered += 1;
    }
    return delivered;
}

function pushPeersSnapshot(targetServerClientId = null) {
    const payload = {
        type: 'chat_peers',
        peers: getChatPeersList(),
        timestamp: Date.now()
    };

    if (targetServerClientId) {
        const client = wsClients.get(targetServerClientId);
        if (client) safeWsSend(client.ws, payload);
        return;
    }

    broadcastChat(payload);
}

async function publishChatBus(eventType, payload, channel = CHAT_REDIS_CHANNEL) {
    if (!chatRedisReady || !chatRedisPub) return false;
    const envelope = {
        type: 'chat_bus',
        eventType,
        origin: CHAT_INSTANCE_ID,
        id: `${CHAT_INSTANCE_ID}_${Date.now().toString(36)}_${(++chatRedisSeq).toString(36)}`,
        timestamp: getNowMs(),
        payload
    };

    try {
        await chatRedisPub.publish(channel || CHAT_REDIS_CHANNEL, JSON.stringify(envelope));
        return true;
    } catch (error) {
        console.log(`[CHAT] Redis publish error: ${error?.message || error}`);
        return false;
    }
}

async function publishMarketBusEvent(eventType, payload) {
    if (!MARKET_BUS_ENABLED) return false;
    if (!chatRedisReady || !chatRedisPub) return false;
    const ok = await publishChatBus(eventType, payload, MARKET_BUS_CHANNEL || CHAT_REDIS_CHANNEL);
    if (ok) realtimeTelemetry.redisMarketPublished += 1;
    return ok;
}

async function publishPresenceHeartbeat() {
    if (!chatRedisReady) return false;
    const peers = getLocalChatPeersList().map((peer) => ({
        clientId: peer.clientId,
        name: peer.name,
        symbol: peer.symbol || null
    }));

    return publishChatBus('presence_heartbeat', {
        instanceId: CHAT_INSTANCE_ID,
        peers
    });
}

function routeIncomingBusChatMessage(payload) {
    if (!payload || payload.type !== 'chat_message') return;
    const toChatClientId = sanitizeChatId(payload.to, '');

    if (toChatClientId) {
        const targetServerClientId = chatClientToServerId.get(toChatClientId);
        if (!targetServerClientId) return;
        const targetClient = wsClients.get(targetServerClientId);
        if (!targetClient) return;
        safeWsSend(targetClient.ws, payload);
        return;
    }

    broadcastChat(payload);
}

function routeIncomingBusCallEvent(payload) {
    if (!payload || typeof payload.type !== 'string') return;
    const toChatClientId = sanitizeChatId(payload.to, '');
    if (!toChatClientId) return;
    const targetServerClientId = chatClientToServerId.get(toChatClientId);
    if (!targetServerClientId) return;
    const targetClient = wsClients.get(targetServerClientId);
    if (!targetClient) return;
    safeWsSend(targetClient.ws, payload);
}

function routeIncomingBusSignal(payload) {
    if (!payload || payload.type !== 'chat_signal') return;
    const toChatClientId = sanitizeChatId(payload.to, '');
    if (!toChatClientId) return;
    const targetServerClientId = chatClientToServerId.get(toChatClientId);
    if (!targetServerClientId) return;
    const targetClient = wsClients.get(targetServerClientId);
    if (!targetClient) return;
    safeWsSend(targetClient.ws, payload);
}

function routeIncomingBusGroupSync(payload) {
    if (!payload || payload.type !== 'chat_group_sync') return;
    const toChatClientId = sanitizeChatId(payload.to, '');
    if (!toChatClientId) return;
    const targetServerClientId = chatClientToServerId.get(toChatClientId);
    if (!targetServerClientId) return;
    const targetClient = wsClients.get(targetServerClientId);
    if (!targetClient) return;
    safeWsSend(targetClient.ws, payload);
}

function routeIncomingBusMarketTick(payload) {
    if (!payload || typeof payload !== 'object') return;
    const symbol = String(payload.symbol || '').trim();
    if (!symbol || !INSTRUMENTS[symbol]) {
        realtimeTelemetry.redisMarketDropped += 1;
        return;
    }
    const price = toNum(payload.price, 0);
    if (!(price > 0)) {
        realtimeTelemetry.redisMarketDropped += 1;
        return;
    }
    const message = {
        type: 'price',
        symbol,
        price,
        bid: toNum(payload.bid, NaN),
        ask: toNum(payload.ask, NaN),
        spread: toNum(payload.spread, NaN),
        source: String(payload.source || 'remote-market-bus'),
        timestamp: toNum(payload.timestamp, Date.now()),
        marketStatus: payload.marketStatus || undefined,
        reason: payload.reason || undefined
    };
    updateInstrumentTickState(symbol, message);
    realtimeTelemetry.redisMarketReceived += 1;
    broadcast(symbol, message);
}

function routeIncomingBusMarketOrderbook(payload) {
    if (!payload || typeof payload !== 'object') return;
    const symbol = String(payload.symbol || '').trim();
    if (!symbol || !INSTRUMENTS[symbol]) {
        realtimeTelemetry.redisMarketDropped += 1;
        return;
    }
    const message = {
        type: 'orderbook',
        symbol,
        bids: Array.isArray(payload.bids) ? payload.bids : [],
        asks: Array.isArray(payload.asks) ? payload.asks : [],
        ratio: toNum(payload.ratio, 0.5),
        pressure: String(payload.pressure || 'NEUTRAL').toUpperCase(),
        source: String(payload.source || 'remote-market-bus'),
        depthLevels: toNum(payload.depthLevels, 0),
        timestamp: toNum(payload.timestamp, Date.now())
    };
    updateInstrumentOrderbookState(symbol, message);
    realtimeTelemetry.redisMarketReceived += 1;
    broadcast(symbol, message);
}

function routeIncomingBusMarketSignal(payload) {
    if (!payload || typeof payload !== 'object') return;
    const symbol = String(payload.symbol || '').trim();
    if (!symbol || !INSTRUMENTS[symbol]) {
        realtimeTelemetry.redisMarketDropped += 1;
        return;
    }
    realtimeTelemetry.redisMarketReceived += 1;
    recordRealtimeSignal(symbol);
    broadcast(symbol, {
        type: 'signal',
        ...payload,
        symbol
    });
}

function handlePresenceHeartbeatPayload(payload, timestamp) {
    if (!payload || typeof payload !== 'object') return;
    const instanceId = String(payload.instanceId || '').trim();
    if (!instanceId || instanceId === CHAT_INSTANCE_ID) return;
    const peers = Array.isArray(payload.peers) ? payload.peers : [];
    const seenAt = Number.isFinite(Number(timestamp)) ? Number(timestamp) : getNowMs();
    const activeIds = new Set();

    for (const peer of peers) {
        const clientId = sanitizeChatId(peer?.clientId, '');
        if (!clientId) continue;
        activeIds.add(clientId);
        upsertRemoteChatPeer(peer, instanceId, seenAt);
    }

    for (const [clientId, peer] of remoteChatPeers.entries()) {
        if (peer.instanceId === instanceId && !activeIds.has(clientId)) {
            remoteChatPeers.delete(clientId);
        }
    }
}

function handleIncomingChatBus(rawMessage) {
    if (!rawMessage) return;
    let envelope = null;
    try {
        envelope = JSON.parse(rawMessage);
    } catch {
        return;
    }

    if (!envelope || typeof envelope !== 'object') return;
    if (String(envelope.origin || '') === CHAT_INSTANCE_ID) return;

    const eventType = String(envelope.eventType || '');
    const payload = envelope.payload;
    const seenAt = Number.isFinite(Number(envelope.timestamp))
        ? Number(envelope.timestamp)
        : getNowMs();

    if (eventType === 'presence_join') {
        const clientId = sanitizeChatId(payload?.clientId, '');
        if (!clientId) return;
        upsertRemoteChatPeer({
            clientId,
            name: payload?.name,
            symbol: payload?.symbol || null
        }, String(payload?.instanceId || envelope.origin || ''), seenAt);

        broadcastChat({
            type: 'chat_presence',
            event: 'joined',
            clientId,
            name: sanitizeChatName(payload?.name, clientId),
            timestamp: seenAt
        });
        pushPeersSnapshot();
        return;
    }

    if (eventType === 'presence_left') {
        const clientId = sanitizeChatId(payload?.clientId, '');
        if (!clientId) return;
        removeRemoteChatPeer(clientId);
        broadcastChat({
            type: 'chat_presence',
            event: 'left',
            clientId,
            name: sanitizeChatName(payload?.name, clientId),
            timestamp: seenAt
        });
        pushPeersSnapshot();
        return;
    }

    if (eventType === 'presence_heartbeat') {
        handlePresenceHeartbeatPayload(payload, seenAt);
        pushPeersSnapshot();
        return;
    }

    if (eventType === 'chat_message') {
        routeIncomingBusChatMessage(payload);
        return;
    }

    if (eventType === 'chat_call_event') {
        routeIncomingBusCallEvent(payload);
        return;
    }

    if (eventType === 'chat_signal') {
        routeIncomingBusSignal(payload);
        return;
    }

    if (eventType === 'chat_group_sync') {
        routeIncomingBusGroupSync(payload);
        return;
    }

    if (eventType === 'market_tick') {
        routeIncomingBusMarketTick(payload);
        return;
    }

    if (eventType === 'market_orderbook') {
        routeIncomingBusMarketOrderbook(payload);
        return;
    }

    if (eventType === 'market_signal') {
        routeIncomingBusMarketSignal(payload);
    }
}

async function initChatRedisBus() {
    if (!CHAT_REDIS_URL) {
        console.log('[CHAT] Redis bus disabled (CHAT_REDIS_URL not set).');
        return;
    }

    if (typeof createRedisClient !== 'function') {
        console.log('[CHAT] Redis package not installed. Chat bus running in single-instance mode.');
        return;
    }

    try {
        chatRedisPub = createRedisClient({ url: CHAT_REDIS_URL });
        chatRedisSub = createRedisClient({ url: CHAT_REDIS_URL });

        chatRedisPub.on('error', (error) => {
            console.log(`[CHAT] Redis pub error: ${error?.message || error}`);
        });
        chatRedisSub.on('error', (error) => {
            console.log(`[CHAT] Redis sub error: ${error?.message || error}`);
        });

        await chatRedisPub.connect();
        await chatRedisSub.connect();

        const channels = [CHAT_REDIS_CHANNEL];
        if (MARKET_BUS_CHANNEL && !channels.includes(MARKET_BUS_CHANNEL)) {
            channels.push(MARKET_BUS_CHANNEL);
        }
        for (const ch of channels) {
            await chatRedisSub.subscribe(ch, (message) => {
                handleIncomingChatBus(message);
            });
        }

        chatRedisReady = true;
        console.log(`[CHAT] Redis bus connected (${channels.join(', ')}) as ${CHAT_INSTANCE_ID}`);

        chatHeartbeatTimer = setInterval(() => {
            pruneRemoteChatPeers();
            void publishPresenceHeartbeat();
        }, CHAT_REDIS_HEARTBEAT_MS);

        chatRemoteCleanupTimer = setInterval(() => {
            pruneRemoteChatPeers();
        }, Math.max(5000, Math.floor(CHAT_REDIS_REMOTE_STALE_MS / 2)));

        void publishPresenceHeartbeat();
    } catch (error) {
        chatRedisReady = false;
        console.log(`[CHAT] Redis bus init failed: ${error?.message || error}`);
    }
}

async function shutdownChatRedisBus() {
    if (chatHeartbeatTimer) {
        clearInterval(chatHeartbeatTimer);
        chatHeartbeatTimer = null;
    }
    if (chatRemoteCleanupTimer) {
        clearInterval(chatRemoteCleanupTimer);
        chatRemoteCleanupTimer = null;
    }

    if (chatRedisSub) {
        try {
            await chatRedisSub.unsubscribe(CHAT_REDIS_CHANNEL);
        } catch {
            // ignore unsubscribe errors
        }
        if (MARKET_BUS_CHANNEL && MARKET_BUS_CHANNEL !== CHAT_REDIS_CHANNEL) {
            try {
                await chatRedisSub.unsubscribe(MARKET_BUS_CHANNEL);
            } catch {
                // ignore unsubscribe errors
            }
        }
        try {
            await chatRedisSub.quit();
        } catch {
            // ignore quit errors
        }
        chatRedisSub = null;
    }

    if (chatRedisPub) {
        try {
            await chatRedisPub.quit();
        } catch {
            // ignore quit errors
        }
        chatRedisPub = null;
    }
    chatRedisReady = false;
}

wss.on('connection', (ws) => {
    const serverClientId = `ws_${Math.random().toString(36).slice(2, 10)}`;
    wsClients.set(serverClientId, {
        ws,
        symbol: 'BTC/USD',
        chatClientId: null,
        chatName: null
    });
    console.log(`🔌 WS client connected: ${serverClientId}`);

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (!data || typeof data !== 'object') return;
            const client = wsClients.get(serverClientId);
            if (!client) return;

            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
                return;
            }

            if (data.type === 'subscribe' && INSTRUMENTS[data.symbol]) {
                const current = wsClients.get(serverClientId);
                if (current) {
                    current.symbol = data.symbol;
                    if (current.chatClientId) void publishPresenceHeartbeat();
                }
                ws.send(JSON.stringify({ type: 'subscribed', symbol: data.symbol }));
                console.log(`📡 Client ${serverClientId} subscribed to ${data.symbol}`);

                // Push an immediate tick so UI does not wait for the next stream cycle.
                (async () => {
                    try {
                        if (isMarketClosed(data.symbol)) {
                            const lastPrice = instrumentState[data.symbol]?.lastKnownPrice || INSTRUMENTS[data.symbol]?.basePrice || 0;
                            const payload = {
                                type: 'price',
                                symbol: data.symbol,
                                source: 'market-closed',
                                marketStatus: 'closed',
                                reason: getMarketClosedReason(data.symbol),
                                price: lastPrice,
                                bid: parseFloat((lastPrice * 0.9999).toFixed(3)),
                                ask: parseFloat((lastPrice * 1.0001).toFixed(3)),
                                spread: parseFloat((lastPrice * 0.0002).toFixed(2)),
                                timestamp: Date.now()
                            };
                            updateInstrumentTickState(data.symbol, payload);
                            safeWsSend(ws, payload);
                            return;
                        }

                        const immediateTick = await fetchBestLiveTick(data.symbol);
                        if (immediateTick) {
                            const payload = {
                                type: 'price',
                                symbol: data.symbol,
                                ...immediateTick,
                                source: immediateTick.source || immediateTick.provider || 'live'
                            };
                            updateInstrumentTickState(data.symbol, payload);
                            safeWsSend(ws, payload);
                        }
                    } catch (e) {
                        // Best-effort warm start.
                    }
                })();
                return;
            }

            if (data.type === 'unsubscribe' && INSTRUMENTS[data.symbol]) {
                const current = wsClients.get(serverClientId);
                if (current && current.symbol === data.symbol) {
                    current.symbol = 'BTC/USD';
                    if (current.chatClientId) void publishPresenceHeartbeat();
                }
                ws.send(JSON.stringify({ type: 'unsubscribed', symbol: data.symbol }));
                return;
            }

            if (data.type === 'chat_register') {
                const requestedName = sanitizeChatName(data.name || data.displayName, '');
                if (!requestedName) {
                    safeWsSend(ws, {
                        type: 'chat_ack',
                        ok: false,
                        error: 'Name is required before chat connection',
                        timestamp: Date.now()
                    });
                    return;
                }

                const fallbackId = `chat_${Math.random().toString(36).slice(2, 8)}`;
                const idFromName = sanitizeChatId(chatNameToIdSeed(requestedName), '');
                let requestedId = idFromName || sanitizeChatId(data.clientId, fallbackId);

                const existingOwner = chatClientToServerId.get(requestedId);
                if (existingOwner && existingOwner !== serverClientId) {
                    requestedId = `${requestedId}_${Math.random().toString(36).slice(2, 6)}`;
                }
                const remoteOwner = remoteChatPeers.get(requestedId);
                if (remoteOwner && remoteOwner.instanceId !== CHAT_INSTANCE_ID) {
                    requestedId = `${requestedId}_${Math.random().toString(36).slice(2, 6)}`;
                }

                if (client.chatClientId && chatClientToServerId.get(client.chatClientId) === serverClientId) {
                    chatClientToServerId.delete(client.chatClientId);
                }

                client.chatClientId = requestedId;
                client.chatName = requestedName;
                chatClientToServerId.set(requestedId, serverClientId);
                removeRemoteChatPeer(requestedId);

                safeWsSend(ws, {
                    type: 'chat_registered',
                    clientId: requestedId,
                    name: client.chatName,
                    peers: getChatPeersList(),
                    timestamp: Date.now()
                });

                broadcastChat({
                    type: 'chat_presence',
                    event: 'joined',
                    clientId: requestedId,
                    name: client.chatName,
                    timestamp: Date.now()
                }, serverClientId);

                if (chatRedisReady) {
                    void publishChatBus('presence_join', {
                        instanceId: CHAT_INSTANCE_ID,
                        clientId: requestedId,
                        name: client.chatName,
                        symbol: client.symbol || null
                    });
                    void publishPresenceHeartbeat();
                }
                pushPeersSnapshot();
                return;
            }

            if (data.type === 'chat_message') {
                if (!client.chatClientId) {
                    safeWsSend(ws, {
                        type: 'chat_ack',
                        ok: false,
                        error: 'Chat registration required',
                        timestamp: Date.now()
                    });
                    return;
                }

                const rawMessageType = String(data.messageType || 'text').toLowerCase();
                const messageType = rawMessageType === 'image' || rawMessageType === 'audio' ? rawMessageType : 'text';
                const text = String(data.text || data.message || '').trim().slice(0, MAX_CHAT_TEXT_LENGTH);
                const mediaData = typeof data.mediaData === 'string' ? data.mediaData : '';
                const isMedia = messageType === 'image' || messageType === 'audio';
                const hasValidMedia = isMedia
                    && mediaData.startsWith('data:')
                    && mediaData.length > 16
                    && mediaData.length <= MAX_CHAT_MEDIA_DATA_URL_LENGTH;

                if (messageType === 'text' && !text) return;
                if (isMedia && !hasValidMedia) {
                    safeWsSend(ws, {
                        type: 'chat_ack',
                        ok: false,
                        error: 'Invalid media payload',
                        timestamp: Date.now()
                    });
                    return;
                }

                const toChatClientId = typeof data.to === 'string' ? sanitizeChatId(data.to, '') : '';
                const messagePayload = {
                    type: 'chat_message',
                    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                    from: client.chatClientId,
                    fromName: client.chatName || client.chatClientId,
                    to: toChatClientId || null,
                    messageType,
                    text: text || undefined,
                    mediaData: isMedia ? mediaData : undefined,
                    mimeType: typeof data.mimeType === 'string' ? data.mimeType.slice(0, 120) : undefined,
                    fileName: typeof data.fileName === 'string' ? data.fileName.slice(0, 120) : undefined,
                    durationMs: Number.isFinite(Number(data.durationMs))
                        ? Math.max(0, Math.min(600000, Number(data.durationMs)))
                        : undefined,
                    timestamp: Date.now()
                };

                let delivered = 0;
                let relayedViaRedis = false;
                if (toChatClientId) {
                    const targetServerClientId = chatClientToServerId.get(toChatClientId);
                    if (!targetServerClientId && !chatRedisReady) {
                        safeWsSend(ws, {
                            type: 'chat_ack',
                            ok: false,
                            error: 'Target user not available',
                            timestamp: Date.now()
                        });
                        return;
                    }

                    if (targetServerClientId) {
                        const targetClient = wsClients.get(targetServerClientId);
                        if (targetClient && safeWsSend(targetClient.ws, messagePayload)) delivered += 1;
                    } else if (chatRedisReady) {
                        if (!hasAnyKnownChatPeer(toChatClientId)) {
                            safeWsSend(ws, {
                                type: 'chat_ack',
                                ok: false,
                                error: 'Target user not available',
                                timestamp: Date.now()
                            });
                            return;
                        }
                        relayedViaRedis = await publishChatBus('chat_message', messagePayload);
                    }

                    if (safeWsSend(ws, messagePayload)) delivered += 1;
                } else {
                    delivered = broadcastChat(messagePayload);
                    if (chatRedisReady) {
                        relayedViaRedis = await publishChatBus('chat_message', messagePayload);
                    }
                }

                safeWsSend(ws, {
                    type: 'chat_ack',
                    ok: true,
                    messageId: messagePayload.id,
                    delivered,
                    relayedViaRedis,
                    timestamp: Date.now()
                });
                return;
            }

            if (
                data.type === 'chat_call_invite'
                || data.type === 'chat_call_accept'
                || data.type === 'chat_call_reject'
                || data.type === 'chat_call_end'
            ) {
                if (!client.chatClientId) return;
                const toChatClientId = sanitizeChatId(data.to, '');
                if (!toChatClientId) return;

                const callEventPayload = {
                    type: data.type,
                    from: client.chatClientId,
                    fromName: client.chatName || client.chatClientId,
                    to: toChatClientId,
                    callType: data.callType === 'audio' ? 'audio' : 'video',
                    sessionId: sanitizeChatId(data.sessionId, `sess_${Date.now().toString(36)}`),
                    groupId: sanitizeChatId(data.groupId, '') || undefined,
                    reason: typeof data.reason === 'string' ? data.reason.slice(0, 160) : undefined,
                    timestamp: Date.now()
                };

                let delivered = false;
                let relayedViaRedis = false;
                const targetServerClientId = chatClientToServerId.get(toChatClientId);
                if (targetServerClientId) {
                    const target = wsClients.get(targetServerClientId);
                    if (target) delivered = safeWsSend(target.ws, callEventPayload);
                } else if (chatRedisReady && hasAnyKnownChatPeer(toChatClientId)) {
                    relayedViaRedis = await publishChatBus('chat_call_event', callEventPayload);
                }

                if (!delivered && !relayedViaRedis) {
                    safeWsSend(ws, {
                        type: 'chat_ack',
                        ok: false,
                        error: 'Target user not available',
                        event: data.type,
                        to: toChatClientId,
                        timestamp: Date.now()
                    });
                    return;
                }

                safeWsSend(ws, {
                    type: 'chat_ack',
                    ok: true,
                    event: data.type,
                    to: toChatClientId,
                    relayedViaRedis,
                    timestamp: Date.now()
                });
                return;
            }

            if (data.type === 'chat_signal') {
                if (!client.chatClientId) return;
                const toChatClientId = sanitizeChatId(data.to, '');
                const signalType = String(data.signalType || '').trim().slice(0, 32);
                if (!toChatClientId || !signalType) return;

                const signalPayload = {
                    type: 'chat_signal',
                    from: client.chatClientId,
                    fromName: client.chatName || client.chatClientId,
                    to: toChatClientId,
                    signalType,
                    sessionId: sanitizeChatId(data.sessionId, ''),
                    callType: data.callType === 'audio' ? 'audio' : 'video',
                    groupId: sanitizeChatId(data.groupId, '') || undefined,
                    sdp: data.sdp && typeof data.sdp === 'object' ? data.sdp : undefined,
                    candidate: data.candidate && typeof data.candidate === 'object' ? data.candidate : undefined,
                    timestamp: Date.now()
                };

                let delivered = false;
                let relayedViaRedis = false;
                const targetServerClientId = chatClientToServerId.get(toChatClientId);
                if (targetServerClientId) {
                    const target = wsClients.get(targetServerClientId);
                    if (target) delivered = safeWsSend(target.ws, signalPayload);
                } else if (chatRedisReady && hasAnyKnownChatPeer(toChatClientId)) {
                    relayedViaRedis = await publishChatBus('chat_signal', signalPayload);
                }

                if (!delivered && !relayedViaRedis) return;

                safeWsSend(ws, {
                    type: 'chat_ack',
                    ok: true,
                    event: 'chat_signal',
                    signalType,
                    to: toChatClientId,
                    relayedViaRedis,
                    timestamp: Date.now()
                });
                return;
            }

            if (data.type === 'chat_group_sync') {
                if (!client.chatClientId) return;
                const toChatClientId = sanitizeChatId(data.to, '');
                const groupId = sanitizeChatId(data.groupId, '');
                if (!toChatClientId || !groupId) return;

                const membersRaw = Array.isArray(data.members) ? data.members : [];
                const members = [];
                const seenMembers = new Set();
                for (const item of membersRaw) {
                    const memberId = sanitizeChatId(item, '');
                    if (!memberId || seenMembers.has(memberId)) continue;
                    seenMembers.add(memberId);
                    members.push(memberId);
                    if (members.length >= 24) break;
                }

                if (!members.includes(client.chatClientId)) members.push(client.chatClientId);
                if (!members.includes(toChatClientId)) members.push(toChatClientId);

                const syncPayload = {
                    type: 'chat_group_sync',
                    from: client.chatClientId,
                    fromName: client.chatName || client.chatClientId,
                    to: toChatClientId,
                    groupId,
                    callType: data.callType === 'audio' ? 'audio' : 'video',
                    members,
                    timestamp: Date.now()
                };

                let delivered = false;
                let relayedViaRedis = false;
                const targetServerClientId = chatClientToServerId.get(toChatClientId);
                if (targetServerClientId) {
                    const target = wsClients.get(targetServerClientId);
                    if (target) delivered = safeWsSend(target.ws, syncPayload);
                } else if (chatRedisReady && hasAnyKnownChatPeer(toChatClientId)) {
                    relayedViaRedis = await publishChatBus('chat_group_sync', syncPayload);
                }

                if (!delivered && !relayedViaRedis) {
                    safeWsSend(ws, {
                        type: 'chat_ack',
                        ok: false,
                        error: 'Target user not available',
                        event: 'chat_group_sync',
                        to: toChatClientId,
                        timestamp: Date.now()
                    });
                    return;
                }

                safeWsSend(ws, {
                    type: 'chat_ack',
                    ok: true,
                    event: 'chat_group_sync',
                    to: toChatClientId,
                    relayedViaRedis,
                    timestamp: Date.now()
                });
                return;
            }
        } catch (e) { /* ignore */ }
    });

    ws.on('close', () => {
        const current = wsClients.get(serverClientId);
        if (current?.chatClientId && chatClientToServerId.get(current.chatClientId) === serverClientId) {
            chatClientToServerId.delete(current.chatClientId);
            removeRemoteChatPeer(current.chatClientId);
            broadcastChat({
                type: 'chat_presence',
                event: 'left',
                clientId: current.chatClientId,
                name: current.chatName || current.chatClientId,
                timestamp: Date.now()
            }, serverClientId);
            if (chatRedisReady) {
                void publishChatBus('presence_left', {
                    instanceId: CHAT_INSTANCE_ID,
                    clientId: current.chatClientId,
                    name: current.chatName || current.chatClientId
                });
                void publishPresenceHeartbeat();
            }
            pushPeersSnapshot();
        }

        wsClients.delete(serverClientId);
        console.log(`🔌 WS client disconnected: ${serverClientId}`);
    });

    // Send initial state
    ws.send(JSON.stringify({ type: 'connected', instruments: Object.keys(INSTRUMENTS) }));
});

// Broadcast to all clients subscribed to a symbol
function broadcast(symbol, data) {
    let delivered = 0;
    for (const [, client] of wsClients) {
        if (client.symbol === symbol && client.ws.readyState === 1) {
            client.ws.send(JSON.stringify(data));
            delivered += 1;
        }
    }
    if (data?.type === 'price') realtimeTelemetry.priceBroadcastTotal += delivered;
    if (data?.type === 'orderbook') realtimeTelemetry.orderbookBroadcastTotal += delivered;
    return delivered;
}

let streamPricesInFlight = false;

// Price streaming loop — high-frequency live push
async function streamPrices() {
    if (streamPricesInFlight) return;
    streamPricesInFlight = true;
    realtimeTelemetry.streamPricesRuns += 1;
    realtimeTelemetry.lastPriceStreamAtMs = Date.now();
    try {
        const subscribedSymbols = [...new Set(
            [...wsClients.values()]
                .map((client) => client.symbol)
                .filter((symbol) => INSTRUMENTS[symbol])
        )];

        const results = await Promise.allSettled(subscribedSymbols.map(async (symbol) => {
            if (isMarketClosed(symbol)) {
                const price = instrumentState[symbol].lastKnownPrice || INSTRUMENTS[symbol]?.basePrice || 0;
                const payload = {
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
                };
                updateInstrumentTickState(symbol, payload);
                broadcast(symbol, payload);
                void publishMarketBusEvent('market_tick', payload);
                return;
            }

            const tick = await fetchBestLiveTick(symbol);
            if (!tick) return;

            const payload = {
                type: 'price',
                symbol,
                ...tick,
                source: tick.source || tick.provider || 'live'
            };
            updateInstrumentTickState(symbol, payload);
            broadcast(symbol, payload);
            void publishMarketBusEvent('market_tick', payload);
        }));
        const rejected = results.filter((r) => r.status === 'rejected').length;
        if (rejected > 0) realtimeTelemetry.streamPricesErrors += rejected;
    } catch (error) {
        realtimeTelemetry.streamPricesErrors += 1;
    } finally {
        streamPricesInFlight = false;
    }
}

// Orderbook streaming — every 5s
async function streamOrderbook() {
    realtimeTelemetry.streamOrderbookRuns += 1;
    realtimeTelemetry.lastOrderbookStreamAtMs = Date.now();
    const subscribedSymbols = [...new Set(
        [...wsClients.values()]
            .map((client) => client.symbol)
            .filter((symbol) => INSTRUMENTS[symbol])
    )];

    for (const symbol of subscribedSymbols) {
        try {
            let payload = null;

            if (binanceSymbols[symbol]) {
                payload = await fetchBinanceOrderbookLevel2(symbol, 10);
            }

            if (!payload) {
                let anchorPrice = toNum(instrumentState[symbol]?.lastKnownPrice, 0);
                if (!(anchorPrice > 0)) {
                    const tick = await fetchBestLiveTick(symbol);
                    if (tick?.price) {
                        anchorPrice = toNum(tick.price, 0);
                        instrumentState[symbol].lastKnownPrice = anchorPrice;
                    }
                }
                if (!(anchorPrice > 0)) {
                    anchorPrice = toNum(INSTRUMENTS[symbol]?.basePrice, 1);
                }
                payload = buildSyntheticOrderbook(symbol, anchorPrice, 10);
            }

            broadcast(symbol, {
                type: 'orderbook',
                symbol,
                bids: payload.bids,
                asks: payload.asks,
                ratio: payload.ratio,
                pressure: payload.pressure,
                source: payload.source,
                depthLevels: payload.depthLevels,
                timestamp: payload.timestamp || Date.now()
            });
            updateInstrumentOrderbookState(symbol, payload);
            void publishMarketBusEvent('market_orderbook', {
                symbol,
                bids: payload.bids,
                asks: payload.asks,
                ratio: payload.ratio,
                pressure: payload.pressure,
                source: payload.source,
                depthLevels: payload.depthLevels,
                timestamp: payload.timestamp || Date.now()
            });
        } catch (e) {
            // keep stream resilient
            realtimeTelemetry.streamOrderbookErrors += 1;
        }
    }
}

// News streaming — every 60s
async function streamNews() {
    realtimeTelemetry.streamNewsRuns += 1;
    realtimeTelemetry.lastNewsStreamAtMs = Date.now();
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
        } catch (e) {
            realtimeTelemetry.streamNewsErrors += 1;
        }
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
setInterval(streamPrices, PRICE_STREAM_INTERVAL_MS);
setInterval(streamOrderbook, ORDERBOOK_STREAM_INTERVAL_MS);
setInterval(streamNews, NEWS_STREAM_INTERVAL_MS);
void initChatRedisBus();

server.listen(PORT, () => {
    console.log(`\n🥇 Multi-Asset Analyzer API running at http://localhost:${PORT}`);
    if (SITE_ACCESS_CODE) {
        console.log(`🔒 Access code protection: ON (user: ${SITE_ACCESS_USER})`);
    } else {
        console.log(`🔓 Access code protection: OFF`);
    }
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`💬 Chat bus: ${CHAT_REDIS_URL ? `redis (${CHAT_REDIS_CHANNEL})` : 'local-only'}`);
    console.log(`🛰️ Market bus: ${MARKET_BUS_ENABLED ? (CHAT_REDIS_URL ? `redis (${MARKET_BUS_CHANNEL})` : 'disabled (redis unavailable)') : 'OFF'}`);
    console.log(`🧩 TradingAgents bridge: ${TRADING_AGENTS_ENABLED ? `ON (${TRADING_AGENTS_API_URL})` : 'OFF'}`);
    console.log(`🏛️ Primary exchange feeds: ${ENABLE_PRIMARY_EXCHANGE_FEEDS ? 'ON' : 'OFF'} (timeout=${PRIMARY_EXCHANGE_TIMEOUT_MS}ms, cache=${PRIMARY_EXCHANGE_CACHE_MS}ms, bridge=${PRIMARY_EXCHANGE_BRIDGE_URL ? 'configured' : 'none'})`);
    console.log(`📊 Instruments: ${Object.keys(INSTRUMENTS).join(', ')}`);
    console.log(`⚡ Live stream intervals: prices=${PRICE_STREAM_INTERVAL_MS}ms, orderbook=${ORDERBOOK_STREAM_INTERVAL_MS}ms, news=${NEWS_STREAM_INTERVAL_MS}ms`);
    console.log(`📰 News sentiment: /api/news?symbol=`);
    console.log(`📊 Endpoints: /api/price, /api/history, /api/instruments, /api/primary-exchange/status, /api/primary-exchange/licenses, /api/realtime/status, /api/realtime/metrics, /api/execution/status, /api/ai-signal, /api/tradingagents/status, /api/news, /api/mt5/ingest, /api/mt5/bots, /api/mt5/executor/next, /api/mt5/executor/source, /api/mt5/executor/python\n`);
    for (const symbol of Object.keys(INSTRUMENTS)) {
        initSimulatedHistory(symbol);
    }
});

let shuttingDownRedisBus = false;
const shutdownRedisOnce = () => {
    if (shuttingDownRedisBus) return;
    shuttingDownRedisBus = true;
    void shutdownChatRedisBus();
};
process.on('SIGTERM', shutdownRedisOnce);
process.on('SIGINT', shutdownRedisOnce);
