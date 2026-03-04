import React from 'react';
import { useMarketStore } from './store/marketStore';
import { useWebSocket } from './hooks/useWebSocket';

import Chart from './components/Chart';
import IndicatorsPanel from './components/IndicatorsPanel';
import MultiTFPanel from './components/MultiTFPanel';
import CompositeScorePanel from './components/CompositeScorePanel';
import AISignalPanel from './components/AISignalPanel';
import NewsPanel from './components/NewsPanel';
import TrendMetersPanel from './components/TrendMetersPanel';
import PatternsPanel from './components/PatternsPanel';
import PivotPointsPanel from './components/PivotPointsPanel';
import MarketInfoPanel from './components/MarketInfoPanel';
import SignalHistoryPanel from './components/SignalHistoryPanel';
import MT5ExecutionPanel from './components/MT5ExecutionPanel';
import ChatMessenger from './components/ChatMessenger';
import PerfectEntryZoneHub from './components/PerfectEntryZoneHub';
import TradingSessionsPanel from './components/TradingSessionsPanel';
import MacroCalendarPanel from './components/MacroCalendarPanel';
import TradovateIndicatorsHub from './components/TradovateIndicatorsHub';
import SuperalgosHub from './components/SuperalgosHub';
import MiniRiskPanel from './components/MiniRiskPanel';
import { isSymbolMarketClosed, getMarketClosedReason } from './utils/marketHours';

type InstrumentCategoryKey = 'commodities' | 'forex' | 'crypto' | 'stocks' | 'indices' | 'other';
type InstrumentGroup = {
    key: InstrumentCategoryKey;
    label: string;
    icon: string;
    symbols: string[];
};

const INSTRUMENT_META: Record<string, { icon: string; name: string; source: string; decimals: number }> = {
    // Commodities
    'XAU/USD': { icon: '🥇', name: 'Gold Spot', source: 'TradingView scanner (primary)', decimals: 2 },
    'XAG/USD': { icon: '🥈', name: 'Silver Spot', source: 'TradingView scanner (primary)', decimals: 3 },
    'WTI/USD': { icon: '🛢️', name: 'WTI Crude Oil', source: 'TradingView scanner (primary)', decimals: 2 },
    // Forex
    'EUR/USD': { icon: '💶', name: 'Euro / Dollar', source: 'TradingView scanner (primary)', decimals: 5 },
    'GBP/USD': { icon: '💷', name: 'Pound / Dollar', source: 'TradingView scanner (primary)', decimals: 5 },
    'USD/JPY': { icon: '💴', name: 'Dollar / Yen', source: 'TradingView scanner (primary)', decimals: 3 },
    'CHF/JPY': { icon: '🇨🇭', name: 'Swiss Franc / Yen', source: 'TradingView scanner (primary)', decimals: 3 },
    'AUD/USD': { icon: '🦘', name: 'Australian Dollar / USD', source: 'TradingView scanner (primary)', decimals: 5 },
    // Crypto
    'BTC/USD': { icon: '₿', name: 'Bitcoin Spot', source: 'TradingView scanner (primary)', decimals: 2 },
    'ETH/USD': { icon: 'Ξ', name: 'Ethereum Spot', source: 'TradingView scanner (primary)', decimals: 2 },
    'SOL/USD': { icon: '◎', name: 'Solana Spot', source: 'TradingView scanner (primary)', decimals: 2 },
    // Stocks
    'AAPL/USD': { icon: '🍎', name: 'Apple Inc.', source: 'TradingView scanner (primary)', decimals: 2 },
    'TSLA/USD': { icon: '⚡', name: 'Tesla Inc.', source: 'TradingView scanner (primary)', decimals: 2 },
    'NVDA/USD': { icon: '🟩', name: 'NVIDIA Corp.', source: 'TradingView scanner (primary)', decimals: 2 },
    // Indices
    'SPX500/USD': { icon: '📊', name: 'S&P 500 Index', source: 'TradingView scanner (primary)', decimals: 2 },
    'NAS100/USD': { icon: '🧠', name: 'Nasdaq 100 Index', source: 'TradingView scanner (primary)', decimals: 2 },
    'US30/USD': { icon: '🏛️', name: 'Dow Jones 30', source: 'TradingView scanner (primary)', decimals: 2 },
};

const INSTRUMENT_GROUPS: InstrumentGroup[] = [
    {
        key: 'commodities',
        label: 'Commodities',
        icon: '🛢️',
        symbols: ['XAU/USD', 'XAG/USD', 'WTI/USD'],
    },
    {
        key: 'forex',
        label: 'Forex',
        icon: '💱',
        symbols: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'CHF/JPY', 'AUD/USD'],
    },
    {
        key: 'crypto',
        label: 'Crypto',
        icon: '₿',
        symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
    },
    {
        key: 'stocks',
        label: 'Stocks',
        icon: '📈',
        symbols: ['AAPL/USD', 'TSLA/USD', 'NVDA/USD'],
    },
    {
        key: 'indices',
        label: 'Indices',
        icon: '📊',
        symbols: ['SPX500/USD', 'NAS100/USD', 'US30/USD'],
    },
];

const FALLBACK_SYMBOLS = INSTRUMENT_GROUPS.flatMap((group) => group.symbols);
const UNKNOWN_GROUP: InstrumentGroup = { key: 'other', label: 'Marché', icon: '🧩', symbols: [] };
const DEFAULT_META = { icon: '💱', name: 'Instrument', source: 'Feed agrégé', decimals: 2 };
const THEME_STORAGE_KEY = 'ari_trading_theme';
const REGION_PROBE_CACHE_KEY = 'ari_region_probe_v1';
const REGION_PROBE_CACHE_MS = 6 * 60 * 60 * 1000;
const REGION_SWITCH_THRESHOLD_MS = 120;
const REGION_PROBE_TIMEOUT_MS = 2200;
const DASHBOARD_TAB_KEY = 'ari_dashboard_tab';
const CHAT_NAME_KEY = 'ari_chat_name_v2';

type RegionMirror = {
    id: string;
    label: string;
    origin: string;
    host: string;
};

type RegionProbeSample = RegionMirror & { latency: number };

type RegionSuggestion = {
    currentHost: string;
    bestHost: string;
    bestLabel: string;
    currentLatency: number;
    bestLatency: number;
    targetUrl: string;
};

type RealtimeSymbolStatus = {
    symbol: string;
    source?: string;
    tickAgeMs?: number | null;
    stale?: boolean;
    warning?: boolean;
};

type RealtimeStatusSnapshot = {
    healthScore?: number;
    staleSymbols?: string[];
    warningSymbols?: string[];
    websocket?: {
        clients?: number;
    };
    execution?: {
        mt5?: {
            online?: boolean;
            pendingCommands?: number;
        };
    };
    primaryExchanges?: {
        enabled?: boolean;
        licenseMode?: string;
        licenses?: Record<string, { configured?: boolean }>;
    };
    symbols?: RealtimeSymbolStatus[];
};

type ThemeMode = 'light' | 'dark' | 'cyber';
const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'cyber'];

const REGION_MIRRORS: RegionMirror[] = [
    {
        id: 'africa-south1',
        label: 'Afrique (Madagascar)',
        origin: 'https://xauusd-analyzer-l6k4n52jzq-bq-l6k4n52jzq-bq.a.run.app',
        host: 'xauusd-analyzer-l6k4n52jzq-bq-l6k4n52jzq-bq.a.run.app'
    },
    {
        id: 'asia-east2',
        label: 'Asie (Hong Kong)',
        origin: 'https://xauusd-analyzer-l6k4n52jzq-df-l6k4n52jzq-df.a.run.app',
        host: 'xauusd-analyzer-l6k4n52jzq-df-l6k4n52jzq-df.a.run.app'
    },
    {
        id: 'asia-east1',
        label: 'Asie (Taiwan)',
        origin: 'https://xauusd-analyzer-l6k4n52jzq-de-l6k4n52jzq-de.a.run.app',
        host: 'xauusd-analyzer-l6k4n52jzq-de-l6k4n52jzq-de.a.run.app'
    },
    {
        id: 'europe-west9',
        label: 'Europe',
        origin: 'https://xauusd-analyzer-l6k4n52jzq-od-l6k4n52jzq-od.a.run.app',
        host: 'xauusd-analyzer-l6k4n52jzq-od-l6k4n52jzq-od.a.run.app'
    },
    {
        id: 'us-central1',
        label: 'US',
        origin: 'https://xauusd-analyzer-l6k4n52jzq-uc-l6k4n52jzq-uc.a.run.app',
        host: 'xauusd-analyzer-l6k4n52jzq-uc-l6k4n52jzq-uc.a.run.app'
    }
];

function isRunAppHost(host: string): boolean {
    return /\.a\.run\.app$/i.test(host);
}

function toFiniteLatency(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : Number.POSITIVE_INFINITY;
}

function getSymbolDecimals(symbol: string): number {
    return INSTRUMENT_META[symbol]?.decimals ?? 2;
}

function getQuoteCurrency(symbol: string): string {
    const parts = String(symbol).split('/');
    return parts[1] || 'USD';
}

function isCryptoSymbol(symbol: string): boolean {
    return symbol === 'BTC/USD' || symbol === 'ETH/USD' || symbol === 'SOL/USD';
}

function formatInstrumentPrice(symbol: string, value: number): string {
    if (!value || value <= 0) return '—';
    const decimals = getSymbolDecimals(symbol);
    return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function normalizeVisitorName(raw: string): string {
    return String(raw || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 28);
}

function App() {
    const { status: wsStatus, chatStatus, sendChatRegister, sendChatMessage, sendChatPayload, onChatEvent } = useWebSocket();
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const instruments = useMarketStore((state) => state.instruments);
    const prices = useMarketStore((state) => state.prices);
    const setSymbol = useMarketStore((state) => state.setSymbol);
    const initRef = React.useRef(false);
    const [regionSuggestion, setRegionSuggestion] = React.useState<RegionSuggestion | null>(null);
    const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
        if (typeof window === 'undefined') return 'light';
        const saved = String(window.localStorage.getItem(THEME_STORAGE_KEY) || '').toLowerCase();
        return saved === 'dark' || saved === 'cyber' ? (saved as ThemeMode) : 'light';
    });
    const [activeTab, setActiveTab] = React.useState<'terminal' | 'pez' | 'tradovate' | 'superalgos'>(() => {
        if (typeof window === 'undefined') return 'terminal';
        const saved = String(window.localStorage.getItem(DASHBOARD_TAB_KEY) || '').toLowerCase();
        return saved === 'pez' || saved === 'tradovate' || saved === 'superalgos' ? saved : 'terminal';
    });
    const [visitorName, setVisitorName] = React.useState<string>(() => {
        if (typeof window === 'undefined') return '';
        try {
            return normalizeVisitorName(window.localStorage.getItem(CHAT_NAME_KEY) || '');
        } catch {
            return '';
        }
    });
    const [visitorInput, setVisitorInput] = React.useState<string>(() => visitorName);
    const [visitorError, setVisitorError] = React.useState('');
    const [onlineVisitors, setOnlineVisitors] = React.useState<number | null>(null);
    const [realtimeStatus, setRealtimeStatus] = React.useState<RealtimeStatusSnapshot | null>(null);
    const sidePanelsRef = React.useRef<HTMLElement | null>(null);
    const marketRailRef = React.useRef<HTMLDivElement | null>(null);

    const price = prices[currentSymbol] || 0;
    const symbols = React.useMemo(() => {
        const serverSymbols = Array.isArray(instruments) ? instruments.filter(Boolean) : [];
        return Array.from(new Set([...FALLBACK_SYMBOLS, ...serverSymbols]));
    }, [instruments]);
    const groupedSymbols = React.useMemo(() => {
        const groups = INSTRUMENT_GROUPS
            .map((group) => ({ ...group, symbols: group.symbols.filter((symbol) => symbols.includes(symbol)) }))
            .filter((group) => group.symbols.length > 0);

        const known = new Set(groups.flatMap((group) => group.symbols));
        const unknownSymbols = symbols.filter((symbol) => !known.has(symbol));
        if (unknownSymbols.length > 0) {
            groups.push({ ...UNKNOWN_GROUP, symbols: unknownSymbols });
        }
        return groups;
    }, [symbols]);
    const currentGroupKey = React.useMemo<InstrumentCategoryKey>(() => {
        const matching = groupedSymbols.find((group) => group.symbols.includes(currentSymbol));
        return matching?.key || 'other';
    }, [groupedSymbols, currentSymbol]);
    const [expandedGroupKey, setExpandedGroupKey] = React.useState<InstrumentCategoryKey | null>(null);
    const marketClosedCount = React.useMemo(
        () => symbols.filter((sym) => isSymbolMarketClosed(sym)).length,
        [symbols]
    );
    const marketOpenCount = Math.max(0, symbols.length - marketClosedCount);
    const marketStatusLabel = React.useMemo(() => {
        if (marketClosedCount <= 0) return null;
        if (marketOpenCount <= 0) {
            return `Marché fermé (${marketClosedCount}/${symbols.length})`;
        }
        return `Marché mixte: ${marketOpenCount}/${symbols.length} ouverts`;
    }, [marketClosedCount, marketOpenCount, symbols.length]);
    const currentMeta = INSTRUMENT_META[currentSymbol];
    const chartEngineLabel = 'AriAlgo + TradingView';
    const visitorReady = visitorName.length > 0;
    const cycleThemeMode = React.useCallback(() => {
        setThemeMode((prev) => {
            const idx = THEME_CYCLE.indexOf(prev);
            return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        });
    }, []);
    const themeSwitchTitle = themeMode === 'light'
        ? 'Passer en thème sombre'
        : themeMode === 'dark'
            ? 'Passer en thème cyber'
            : 'Passer en thème clair';
    const currentRealtimeSymbol = React.useMemo(() => {
        const list = Array.isArray(realtimeStatus?.symbols) ? realtimeStatus!.symbols! : [];
        return list.find((item) => item.symbol === currentSymbol) || null;
    }, [realtimeStatus, currentSymbol]);
    const currentTickAgeMs = Number.isFinite(Number(currentRealtimeSymbol?.tickAgeMs))
        ? Math.max(0, Math.round(Number(currentRealtimeSymbol?.tickAgeMs || 0)))
        : null;
    const realtimeBadgeColor = currentRealtimeSymbol?.stale
        ? '#ff5a7a'
        : currentRealtimeSymbol?.warning
            ? '#f7c75c'
            : '#2ee6a6';
    const realtimeStatusText = currentRealtimeSymbol?.stale
        ? 'STALE'
        : currentRealtimeSymbol?.warning
            ? 'DELAY'
            : 'REALTIME';
    const realtimeHealthScore = Math.max(0, Math.min(100, Math.round(Number(realtimeStatus?.healthScore || 0))));
    const mt5ExecutionOnline = !!realtimeStatus?.execution?.mt5?.online;
    const mt5PendingCommands = Math.max(0, Math.round(Number(realtimeStatus?.execution?.mt5?.pendingCommands || 0)));
    const currentLiveSourceLabel = currentRealtimeSymbol?.source
        ? String(currentRealtimeSymbol.source)
        : (currentMeta?.source || 'Feed agrégé');
    const primaryLicenseMissing = React.useMemo(() => {
        const licenses = realtimeStatus?.primaryExchanges?.licenses;
        if (!licenses || typeof licenses !== 'object') return 0;
        return Object.values(licenses).filter((item) => !item?.configured).length;
    }, [realtimeStatus]);

    React.useEffect(() => {
        if (!symbols.includes(currentSymbol)) {
            const fallback = symbols.includes('XAU/USD') ? 'XAU/USD' : symbols[0];
            if (fallback && fallback !== currentSymbol) setSymbol(fallback);
        }
    }, [currentSymbol, symbols, setSymbol]);

    React.useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setInterval> | null = null;

        const pullRealtimeStatus = async () => {
            try {
                const res = await fetch('/api/realtime/status');
                const payload = await res.json();
                if (!active) return;
                if (payload?.success && payload?.data) {
                    setRealtimeStatus(payload.data as RealtimeStatusSnapshot);
                }
            } catch {
                // keep UI resilient if monitoring endpoint is unreachable
            }
        };

        void pullRealtimeStatus();
        timer = setInterval(() => {
            void pullRealtimeStatus();
        }, 5000);

        return () => {
            active = false;
            if (timer) clearInterval(timer);
        };
    }, []);

    React.useEffect(() => {
        if (initRef.current) return;
        if (symbols.includes('XAU/USD') && isCryptoSymbol(currentSymbol)) {
            setSymbol('XAU/USD');
        }
        initRef.current = true;
    }, [currentSymbol, symbols, setSymbol]);

    React.useEffect(() => {
        const payload = {
            source: 'frontend',
            path: `${window.location.pathname}${window.location.search}`,
            note: 'app-mounted',
        };

        fetch('/api/track-open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => {
            // Intentionally silent: tracking must not block UI.
        });
    }, []);

    React.useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.setAttribute('data-theme', themeMode);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
        }
    }, [themeMode]);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(DASHBOARD_TAB_KEY, activeTab);
    }, [activeTab]);

    React.useEffect(() => {
        if (wsStatus !== 'connected') {
            setOnlineVisitors(0);
        } else if (visitorReady) {
            // Fallback value until the first presence snapshot is received.
            setOnlineVisitors((prev) => (prev === null || prev <= 0 ? 1 : prev));
        }
    }, [wsStatus, visitorReady]);

    React.useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (!marketRailRef.current) return;
            const target = event.target as Node | null;
            if (target && marketRailRef.current.contains(target)) return;
            setExpandedGroupKey(null);
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, []);

    React.useEffect(() => {
        return onChatEvent((event) => {
            if (!event || typeof event !== 'object') return;
            const type = String(event.type || '');
            if (type !== 'chat_peers' && type !== 'chat_registered') return;

            const peers = Array.isArray((event as { peers?: unknown[] }).peers)
                ? (event as { peers?: unknown[] }).peers || []
                : [];
            const ids = new Set<string>();
            peers.forEach((peer) => {
                if (!peer || typeof peer !== 'object') return;
                const id = typeof (peer as { clientId?: unknown }).clientId === 'string'
                    ? String((peer as { clientId?: unknown }).clientId).trim()
                    : '';
                if (id) ids.add(id);
            });

            if (ids.size > 0) {
                setOnlineVisitors(ids.size);
            } else if (wsStatus === 'connected' && visitorReady) {
                setOnlineVisitors(1);
            }
        });
    }, [onChatEvent, wsStatus, visitorReady]);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const currentHost = window.location.host;
        if (!isRunAppHost(currentHost)) return;

        const dismissedKey = `ari_region_hint_dismissed_${currentHost}`;
        if (window.localStorage.getItem(dismissedKey) === '1') return;

        let cancelled = false;
        const currentOrigin = `${window.location.protocol}//${window.location.host}`;
        const mirrors: RegionMirror[] = [...REGION_MIRRORS];
        if (!mirrors.some((mirror) => mirror.host === currentHost)) {
            mirrors.unshift({
                id: 'current',
                label: 'Région actuelle',
                origin: currentOrigin,
                host: currentHost
            });
        }

        const readCachedSuggestion = () => {
            try {
                const raw = window.localStorage.getItem(REGION_PROBE_CACHE_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw) as (RegionSuggestion & { ts?: number }) | null;
                if (!parsed || typeof parsed !== 'object') return null;
                if (parsed.currentHost !== currentHost) return null;
                if (!parsed.ts || (Date.now() - parsed.ts) > REGION_PROBE_CACHE_MS) return null;
                return parsed;
            } catch {
                return null;
            }
        };

        const writeCachedSuggestion = (suggestion: RegionSuggestion | null) => {
            try {
                if (!suggestion) {
                    window.localStorage.removeItem(REGION_PROBE_CACHE_KEY);
                    return;
                }
                window.localStorage.setItem(
                    REGION_PROBE_CACHE_KEY,
                    JSON.stringify({ ...suggestion, ts: Date.now() })
                );
            } catch {
                // Ignore localStorage failures.
            }
        };

        const cached = readCachedSuggestion();
        if (cached && cached.bestHost && cached.bestHost !== currentHost) {
            setRegionSuggestion(cached);
            return;
        }

        const probe = async (mirror: RegionMirror): Promise<RegionProbeSample> => {
            const startedAt = performance.now();
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), REGION_PROBE_TIMEOUT_MS);
            try {
                await fetch(`${mirror.origin}/api/health?probe=${Date.now()}`, {
                    method: 'GET',
                    cache: 'no-store',
                    mode: 'cors',
                    signal: controller.signal
                });
                return { ...mirror, latency: toFiniteLatency(performance.now() - startedAt) };
            } catch {
                return { ...mirror, latency: Number.POSITIVE_INFINITY };
            } finally {
                clearTimeout(timer);
            }
        };

        const runProbe = async () => {
            const samples = await Promise.all(mirrors.map((mirror) => probe(mirror)));
            if (cancelled) return;

            const valid = samples
                .filter((sample) => Number.isFinite(sample.latency))
                .sort((a, b) => a.latency - b.latency);
            if (valid.length === 0) return;

            const best = valid[0];
            const current = samples.find((sample) => sample.host === currentHost);
            if (!current || !Number.isFinite(current.latency)) return;

            const gain = current.latency - best.latency;
            if (best.host !== currentHost && gain >= REGION_SWITCH_THRESHOLD_MS) {
                const targetUrl = `${best.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
                const suggestion: RegionSuggestion = {
                    currentHost,
                    bestHost: best.host,
                    bestLabel: best.label,
                    currentLatency: toFiniteLatency(current.latency),
                    bestLatency: toFiniteLatency(best.latency),
                    targetUrl
                };
                setRegionSuggestion(suggestion);
                writeCachedSuggestion(suggestion);
                return;
            }

            setRegionSuggestion(null);
            writeCachedSuggestion(null);
        };

        runProbe().catch(() => {
            // Silent fallback.
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const dismissRegionSuggestion = React.useCallback(() => {
        setRegionSuggestion(null);
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(`ari_region_hint_dismissed_${window.location.host}`, '1');
            window.localStorage.removeItem(REGION_PROBE_CACHE_KEY);
        } catch {
            // Ignore localStorage failures.
        }
    }, []);

    const jumpToPanels = React.useCallback(() => {
        sidePanelsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const confirmVisitorName = React.useCallback(() => {
        const normalized = normalizeVisitorName(visitorInput);
        if (!normalized) {
            setVisitorError('Veuillez entrer votre nom avant de continuer.');
            return;
        }
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem(CHAT_NAME_KEY, normalized);
            } catch {
                // Ignore storage failures.
            }
        }
        setVisitorName(normalized);
        setVisitorInput(normalized);
        setVisitorError('');
    }, [visitorInput]);

    return (
        <div className="app-container">
            {!visitorReady && (
                <div className="visitor-gate">
                    <div className="visitor-gate-card">
                        <div className="visitor-gate-title">Identification visiteur requise</div>
                        <div className="visitor-gate-sub">
                            Après le login sécurisé, entrez votre nom avant d’accéder au dashboard et au chat.
                        </div>
                        <input
                            value={visitorInput}
                            onChange={(e) => {
                                setVisitorInput(e.target.value.slice(0, 28));
                                if (visitorError) setVisitorError('');
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmVisitorName();
                            }}
                            placeholder="Votre nom (identifiant chat)"
                            className="visitor-gate-input"
                            autoFocus
                        />
                        {visitorError && <div className="visitor-gate-error">{visitorError}</div>}
                        <button type="button" className="visitor-gate-btn" onClick={confirmVisitorName}>
                            Continuer
                        </button>
                    </div>
                </div>
            )}

            <div className={!visitorReady ? 'app-shell-locked' : undefined}>
                {/* HEADER */}
                <header className="top-bar">
                    <div className="logo">
                        <span className="brand-mark">AA</span>
                        <span className="brand-stack">
                            <span className="gold">AriAlgo</span>
                            <span className="logo-sub">Quant Trading Terminal</span>
                        </span>
                    </div>

                    <div className="view-mode-toggle">
                        <button
                            type="button"
                            className={`view-mode-btn ${activeTab === 'terminal' ? 'active' : ''}`}
                            onClick={() => setActiveTab('terminal')}
                        >
                            ARIALGO TERMINAL
                        </button>
                        <button
                            type="button"
                            className={`view-mode-btn ${activeTab === 'pez' ? 'active' : ''}`}
                            onClick={() => setActiveTab('pez')}
                        >
                            ARIALGO ZONES
                        </button>
                        <button
                            type="button"
                            className={`view-mode-btn ${activeTab === 'tradovate' ? 'active' : ''}`}
                            onClick={() => setActiveTab('tradovate')}
                        >
                            ARIALGO ANALYZER
                        </button>
                        <button
                            type="button"
                            className={`view-mode-btn ${activeTab === 'superalgos' ? 'active' : ''}`}
                            onClick={() => setActiveTab('superalgos')}
                        >
                            ARIALGO SUPERALGOS
                        </button>
                    </div>

                    {activeTab === 'terminal' && (
                        <button type="button" className="mobile-panels-btn" onClick={jumpToPanels}>
                            Menus
                        </button>
                    )}

                    <div className="price-ticker">
                        <span className="ticker-market-tag">
                            Marché: {groupedSymbols.find((group) => group.key === currentGroupKey)?.label || 'Marché'}
                        </span>
                        <span className="ticker-source">
                            Source: <span style={{ color: 'var(--text-main)' }}>{currentLiveSourceLabel}</span>
                        </span>
                        <span className="ticker-chart-engine">
                            Chart: <span style={{ color: 'var(--text-main)' }}>{chartEngineLabel}</span>
                        </span>
                        <span className="ticker-price-main">{formatInstrumentPrice(currentSymbol, price)} {getQuoteCurrency(currentSymbol)}</span>
                    </div>

                    <div className="status-badge status-badge-stack">
                        <div className="status-row">
                            <span className={`status-dot ${wsStatus}`}></span>
                            <span className="status-text">{wsStatus === 'connected' ? 'LIVE' : 'CONNECTING...'}</span>
                            <button
                                type="button"
                                onClick={cycleThemeMode}
                                className="theme-toggle-btn"
                                title={themeSwitchTitle}
                            >
                                {themeMode.toUpperCase()}
                            </button>
                        </div>
                        {marketStatusLabel && (
                            <span style={{ fontSize: '9px', color: 'var(--gold)', paddingRight: '2px' }}>{marketStatusLabel}</span>
                        )}
                        <span
                            style={{
                                fontSize: '9px',
                                color: realtimeBadgeColor,
                                padding: '1px 7px',
                                borderRadius: '999px',
                                border: `1px solid ${realtimeBadgeColor}`,
                                background: 'rgba(255,255,255,0.06)',
                                fontWeight: 800
                            }}
                        >
                            {realtimeStatusText}
                            {currentTickAgeMs !== null ? ` ${currentTickAgeMs}ms` : ''}
                        </span>
                        <span
                            style={{
                                fontSize: '9px',
                                color: 'var(--text-main)',
                                padding: '1px 7px',
                                borderRadius: '999px',
                                border: '1px solid rgba(255,255,255,0.22)',
                                background: 'rgba(255,255,255,0.08)',
                                fontWeight: 700
                            }}
                        >
                            Visiteurs en ligne: {Math.max(0, Number(onlineVisitors ?? (wsStatus === 'connected' ? 1 : 0)))}
                        </span>
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                            Health {realtimeHealthScore}% · MT5 {mt5ExecutionOnline ? 'ON' : 'OFF'} · Queue {mt5PendingCommands}
                        </span>
                        <span style={{ fontSize: '9px', color: primaryLicenseMissing > 0 ? '#f7c75c' : 'var(--text-secondary)' }}>
                            Licences {primaryLicenseMissing > 0 ? `incomplètes (${primaryLicenseMissing})` : 'OK'}
                        </span>
                        {currentRealtimeSymbol?.source && (
                            <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                                Feed {String(currentRealtimeSymbol.source).toUpperCase()}
                            </span>
                        )}
                        {wsStatus === 'connected' && (
                            <span style={{ fontSize: '9px', color: 'var(--text-secondary)', paddingRight: '2px' }}>mises à jour par seconde</span>
                        )}
                    </div>
                </header>

                <div className="floating-market-rail" ref={marketRailRef} aria-label="Sélecteur de marchés">
                    {groupedSymbols.map((group) => {
                        const isExpanded = expandedGroupKey === group.key;
                        const hasCurrentSymbol = group.symbols.includes(currentSymbol);

                        return (
                            <div
                                key={group.key}
                                className={`market-bubble-group ${isExpanded ? 'expanded' : ''} ${hasCurrentSymbol ? 'has-active' : ''}`}
                            >
                                <button
                                    type="button"
                                    className={`market-bubble-trigger ${hasCurrentSymbol ? 'is-selected' : ''}`}
                                    onClick={() => setExpandedGroupKey((prev) => (prev === group.key ? null : group.key))}
                                    aria-expanded={isExpanded}
                                    aria-controls={`market-bubble-panel-${group.key}`}
                                    title={`${group.label} (${group.symbols.length})`}
                                >
                                    <span className="market-bubble-icon">{group.icon}</span>
                                </button>

                                <div
                                    id={`market-bubble-panel-${group.key}`}
                                    className="market-bubble-panel"
                                    role="region"
                                    aria-label={`${group.label} instruments`}
                                >
                                    <div className="market-bubble-panel-title">
                                        <span>{group.icon}</span>
                                        <span>{group.label}</span>
                                    </div>
                                    <div className="market-bubble-symbol-grid">
                                        {group.symbols.map((sym) => {
                                            const meta = INSTRUMENT_META[sym] || { ...DEFAULT_META, name: sym };
                                            const isClosed = isSymbolMarketClosed(sym);
                                            return (
                                                <button
                                                    key={sym}
                                                    className={`market-bubble-symbol-btn ${currentSymbol === sym ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setSymbol(sym);
                                                        setExpandedGroupKey(null);
                                                    }}
                                                    title={isClosed ? getMarketClosedReason(sym) : `Trade ${meta.name}`}
                                                    style={isClosed ? { opacity: 0.58 } : undefined}
                                                >
                                                    <span className="market-bubble-symbol-icon">{meta.icon}</span>
                                                    <span>{sym}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {regionSuggestion && (
                    <div
                        style={{
                            margin: '8px 10px 0',
                            padding: '8px 10px',
                            border: '1px solid rgba(245,176,65,0.45)',
                            background: 'rgba(245,176,65,0.08)',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            flexWrap: 'wrap'
                        }}
                    >
                        <span style={{ fontSize: '12px', color: 'var(--text-main)' }}>
                            Réseau détecté: <strong>{regionSuggestion.bestLabel}</strong> est plus proche
                            ({regionSuggestion.bestLatency}ms vs {regionSuggestion.currentLatency}ms).
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <a
                                href={regionSuggestion.targetUrl}
                                style={{
                                    border: '1px solid rgba(0,230,118,0.55)',
                                    background: 'rgba(0,230,118,0.14)',
                                    color: 'var(--buy)',
                                    textDecoration: 'none',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '6px 9px'
                                }}
                            >
                                Basculer
                            </a>
                            <button
                                onClick={dismissRegionSuggestion}
                                style={{
                                    border: '1px solid var(--border)',
                                    background: 'transparent',
                                    color: 'var(--text-secondary)',
                                    borderRadius: '6px',
                                    fontSize: '11px',
                                    padding: '6px 8px',
                                    cursor: 'pointer'
                                }}
                            >
                                Ignorer
                            </button>
                        </div>
                    </div>
                )}

                {/* DASHBOARD LAYOUT */}
                {activeTab === 'terminal' ? (
                    <main className="dashboard">
                        {/* LEFT COLUMN: Chart + Main Analysis */}
                        <section className="col-main">
                            {/* Top: Chart */}
                            <div className="card chart-card" style={{ flex: '0 0 auto' }}>
                                <Chart themeMode={themeMode} />
                            </div>

                            {/* Quant cards: moved out of chart header */}
                            <div className="bottom-row score-mtf-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                                <div className="card half-card composite-score-card">
                                    <h2 className="card-title">Composite Score</h2>
                                    <CompositeScorePanel compact />
                                </div>
                                <div className="card half-card mini-risk-card">
                                    <h2 className="card-title">Micro Simulator $75</h2>
                                    <MiniRiskPanel compact />
                                </div>
                                <div className="card half-card mtf-matrix-card">
                                    <h2 className="card-title">Multi-Timeframe Matrix</h2>
                                    <MultiTFPanel compact />
                                </div>
                            </div>

                            {/* Middle: Trend + Pattern + Market Intelligence */}
                            <div className="bottom-row trend-pattern-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                                <div className="trend-regime-stack">
                                    <div className="card half-card trend-regime-card">
                                        <h2 className="card-title">Trend Regime</h2>
                                        <TrendMetersPanel />
                                    </div>
                                    <div className="card half-card indicator-desk-card">
                                        <h2 className="card-title">Indicator Desk</h2>
                                        <IndicatorsPanel />
                                    </div>
                                </div>
                                <div className="pattern-news-stack">
                                    <div className="card half-card pattern-scanner-card">
                                        <h2 className="card-title">Pattern Scanner</h2>
                                        <PatternsPanel />
                                    </div>
                                    <div className="card half-card market-intelligence-card">
                                        <h2 className="card-title">Market Intelligence</h2>
                                        <NewsPanel />
                                    </div>
                                </div>
                            </div>

                            {/* Additional tools row to balance main/side columns */}
                            <div className="stats-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                                <div className="card half-card">
                                    <h2 className="card-title">Pivot Levels</h2>
                                    <PivotPointsPanel />
                                </div>
                                <div className="card half-card">
                                    <h2 className="card-title">Market Snapshot</h2>
                                    <MarketInfoPanel />
                                </div>
                                <div className="card half-card">
                                    <h2 className="card-title">Order Book Depth</h2>
                                    <OrderBookPanel />
                                </div>
                            </div>

                            <div className="bottom-row single-panel-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                                <div className="card half-card span-all">
                                    <h2 className="card-title">Signal Journal</h2>
                                    <SignalHistoryPanel />
                                </div>
                            </div>

                            <div className="bottom-row single-panel-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                                <div className="card half-card span-all">
                                    <h2 className="card-title">Macro Calendar</h2>
                                    <MacroCalendarPanel />
                                </div>
                            </div>
                        </section>

                        {/* RIGHT COLUMN: Scrollers (AI Signal, Score, Indicators, etc) */}
                        <aside className="col-side panels" ref={sidePanelsRef}>
                            <div className="card">
                                <h2 className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>AI Trade Engine</span>
                                    <span style={{ fontSize: '10px', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', letterSpacing: '1px' }}>MULTI-MODELS</span>
                                </h2>
                                <AISignalPanel />
                            </div>

                            <div className="card">
                                <h2 className="card-title">Trading Sessions</h2>
                                <TradingSessionsPanel />
                            </div>

                            <div className="card">
                                <h2 className="card-title">MT5 Execution & Bots</h2>
                                <MT5ExecutionPanel />
                            </div>
                        </aside>
                    </main>
                ) : activeTab === 'pez' ? (
                    <main className="dashboard library-layout">
                        <section className="library-main">
                            <PerfectEntryZoneHub />
                        </section>
                    </main>
                ) : activeTab === 'tradovate' ? (
                    <main className="dashboard library-layout">
                        <section className="library-main">
                            <TradovateIndicatorsHub />
                        </section>
                    </main>
                ) : (
                    <main className="dashboard library-layout">
                        <section className="library-main">
                            <SuperalgosHub />
                        </section>
                    </main>
                )}
            </div>
            {visitorReady && (
                <ChatMessenger
                    wsStatus={chatStatus}
                    sendChatRegister={sendChatRegister}
                    sendChatMessage={sendChatMessage}
                    sendChatPayload={sendChatPayload}
                    onChatEvent={onChatEvent}
                />
            )}
        </div>
    );
}

function OrderBookPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const orderbook = useMarketStore(state => state.orderbook);
    const decimals = getSymbolDecimals(currentSymbol);
    if (!orderbook || !orderbook.bids.length || !orderbook.asks.length) return <div className="p-4 text-secondary">Awaiting Orderbook data...</div>;

    return (
        <div className="ob-table" style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            <div className={`ob-pressure ${orderbook.pressure.toLowerCase()}`} style={{ padding: '6px', borderRadius: '4px', marginBottom: '8px', fontWeight: 'bold', textAlign: 'center' }}>
                {orderbook.pressure} ({Math.round(orderbook.ratio * 100)}% BUY / {Math.round((1 - orderbook.ratio) * 100)}% SELL)
            </div>
            {orderbook.source && (
                <div style={{ textAlign: 'center', marginBottom: '6px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                    Source: {orderbook.source}
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', color: 'var(--text-secondary)', paddingBottom: '4px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
                <span>Price</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Total</span>
            </div>
            <div style={{ paddingRight: '4px' }}>
                {orderbook.asks.slice(0, 10).reverse().map((a: any, i: number) => (
                    <div key={`ask-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', color: 'var(--sell)', cursor: 'crosshair' }} className="ob-row">
                        <span>{a.price.toFixed(decimals)}</span>
                        <span style={{ textAlign: 'right' }}>{a.qty.toFixed(4)}</span>
                        <span style={{ textAlign: 'right' }}>{a.total.toFixed(0)}</span>
                    </div>
                ))}
                <div style={{ textAlign: 'center', margin: '8px 0', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '4px' }}>
                    Spread: {(orderbook.asks[0].price - orderbook.bids[0].price).toFixed(decimals)}
                </div>
                {orderbook.bids.slice(0, 10).map((b: any, i: number) => (
                    <div key={`bid-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', color: 'var(--buy)', cursor: 'crosshair' }} className="ob-row">
                        <span>{b.price.toFixed(decimals)}</span>
                        <span style={{ textAlign: 'right' }}>{b.qty.toFixed(4)}</span>
                        <span style={{ textAlign: 'right' }}>{b.total.toFixed(0)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default App;
