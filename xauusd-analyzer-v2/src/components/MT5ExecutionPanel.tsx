import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import type { SignalRecord } from '../types/market';
import { getMarketClosedReason, isSymbolMarketClosed } from '../utils/marketHours';

type Direction = 'BUY' | 'SELL' | 'HOLD';

interface ApiSignalRecord {
    timestamp: string;
    symbol: string;
    signal: Direction;
    confidence?: number;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
    aiModel?: string;
}

interface SignalHistoryResponse {
    success: boolean;
    signals?: ApiSignalRecord[];
}

type ExecutionStatus = 'FILLED' | 'PARTIAL' | 'REJECTED' | 'CANCELLED';

interface ApiExecutionRecord {
    id: string;
    timestamp: string;
    symbol: string;
    side: Direction;
    status: ExecutionStatus;
    volume: number;
    plannedEntry?: number | null;
    fillPrice?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    confidence?: number;
    slippageAbs?: number | null;
    slippageBps?: number | null;
    sourceSignal?: string;
    signalAgeMs?: number | null;
    note?: string;
}

interface ExecutionLogResponse {
    success: boolean;
    total?: number;
    records?: ApiExecutionRecord[];
}

type BotRuntimeStatus = 'RUNNING' | 'STOPPED';

interface Mt5BotInfo {
    id: string;
    name: string;
    shortName?: string;
    description?: string;
    filename?: string;
    defaults?: {
        lotSize?: number;
        magicNumber?: number;
        maxLoss?: number;
        maxTrades?: number;
        sym1?: string;
        sym2?: string;
        sym3?: string;
    };
}

interface Mt5BotsState {
    status: BotRuntimeStatus;
    activeBotId: string | null;
    activeBotName?: string | null;
    params?: Record<string, unknown>;
    mode?: 'live' | 'paper';
    revision?: number;
    updatedAt?: string | null;
    note?: string;
    lastHeartbeatAt?: string | null;
}

interface Mt5BotsResponse {
    success: boolean;
    bots?: Mt5BotInfo[];
    state?: Mt5BotsState;
    bridge?: {
        tokenRequired?: boolean;
        staleMs?: number;
        onlineSymbols?: string[];
        online?: boolean;
        heartbeatOnline?: boolean;
        lastHeartbeatAt?: string | null;
        pendingCommands?: number;
        ackedCommands?: number;
        authFailures?: {
            total?: number;
            lastFailureAt?: string | null;
            lastFailureEndpoint?: string | null;
        };
    };
}

interface NormalizedSignal {
    timestampMs: number;
    symbol: string;
    signal: Direction;
    confidence: number;
    entryPrice: number;
    takeProfit: number;
    stopLoss: number;
    source: string;
}

const MT5_SYMBOL_MAP: Record<string, string> = {
    // Commodities
    'XAU/USD': 'XAUUSD',
    'XAG/USD': 'XAGUSD',
    'WTI/USD': 'USOIL',
    // Forex
    'EUR/USD': 'EURUSD',
    'GBP/USD': 'GBPUSD',
    'USD/JPY': 'USDJPY',
    'CHF/JPY': 'CHFJPY',
    'AUD/USD': 'AUDUSD',
    // Crypto
    'BTC/USD': 'BTCUSD',
    'ETH/USD': 'ETHUSD',
    'SOL/USD': 'SOLUSD',
    // Stocks
    'AAPL/USD': 'AAPL',
    'TSLA/USD': 'TSLA',
    'NVDA/USD': 'NVDA',
    // Indices
    'SPX500/USD': 'SPX500',
    'NAS100/USD': 'NAS100',
    'US30/USD': 'US30',
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

const toNumber = (value: unknown): number => {
    const asNumber = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(asNumber) ? asNumber : 0;
};

const fetchLatestSignalForSymbol = async (symbol: string): Promise<ApiSignalRecord | null> => {
    const res = await fetch(`/api/signal-history?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as SignalHistoryResponse;
    const signals = data?.signals || [];
    if (!signals.length) return null;
    return signals[signals.length - 1] ?? null;
};

const fetchExecutionLogForSymbol = async (symbol: string): Promise<ApiExecutionRecord[]> => {
    const res = await fetch(`/api/mt5/execution-log?symbol=${encodeURIComponent(symbol)}&limit=20`);
    if (!res.ok) return [];
    const data = (await res.json()) as ExecutionLogResponse;
    return Array.isArray(data.records) ? data.records : [];
};

const postExecutionLog = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/mt5/execution-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || 'Execution log failed'));
    }
    return data as { success: boolean; record?: ApiExecutionRecord };
};

const fetchMt5Bots = async (): Promise<Mt5BotsResponse> => {
    const res = await fetch('/api/mt5/bots');
    if (!res.ok) {
        throw new Error(`mt5 bots fetch failed (${res.status})`);
    }
    return res.json();
};

const postMt5BotControl = async (payload: Record<string, unknown>): Promise<{ success: boolean; state?: Mt5BotsState }> => {
    const res = await fetch('/api/mt5/bots/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data?.success === false) {
        throw new Error(String(data?.error || 'mt5 bot control failed'));
    }
    return data;
};

const normalizeLocalSignal = (signal: SignalRecord | undefined): NormalizedSignal | null => {
    if (!signal) return null;
    return {
        timestampMs: signal.timestamp,
        symbol: signal.symbol,
        signal: signal.signal,
        confidence: toNumber(signal.confidence),
        entryPrice: toNumber(signal.entryPrice),
        takeProfit: toNumber(signal.takeProfit),
        stopLoss: toNumber(signal.stopLoss),
        source: 'frontend-live',
    };
};

const normalizeApiSignal = (signal: ApiSignalRecord | null): NormalizedSignal | null => {
    if (!signal) return null;
    const timestampMs = Date.parse(signal.timestamp);
    return {
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
        symbol: signal.symbol,
        signal: signal.signal,
        confidence: toNumber(signal.confidence),
        entryPrice: toNumber(signal.entryPrice),
        takeProfit: toNumber(signal.takeProfit),
        stopLoss: toNumber(signal.stopLoss),
        source: signal.aiModel || 'backend',
    };
};

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fallback below.
    }

    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(area);
        return copied;
    } catch {
        return false;
    }
}

const formatPrice = (symbol: string, value: number) => {
    if (value <= 0) return '—';
    const decimals = SYMBOL_DECIMALS[symbol] ?? 2;
    return value.toFixed(decimals);
};

export default function MT5ExecutionPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const localHistory = useMarketStore(state => state.signalHistory);
    const [selectedBotId, setSelectedBotId] = React.useState('');
    const [botLotSize, setBotLotSize] = React.useState('0.01');
    const [botMagic, setBotMagic] = React.useState('123456');
    const [botMaxLoss, setBotMaxLoss] = React.useState('2.0');
    const [botMaxTrades, setBotMaxTrades] = React.useState('10');
    const [volume, setVolume] = React.useState('0.10');
    const [fillPriceInput, setFillPriceInput] = React.useState('');
    const [executionStatus, setExecutionStatus] = React.useState<ExecutionStatus>('FILLED');
    const [executionNote, setExecutionNote] = React.useState('');
    const [copyStatus, setCopyStatus] = React.useState<string>('');
    const isMarketClosed = isSymbolMarketClosed(currentSymbol);
    const marketClosedReason = getMarketClosedReason(currentSymbol);

    React.useEffect(() => {
        if (!copyStatus) return;
        const id = window.setTimeout(() => setCopyStatus(''), 2200);
        return () => window.clearTimeout(id);
    }, [copyStatus]);

    const latestLocalSignal = React.useMemo(
        () => localHistory.find((s) => s.symbol === currentSymbol),
        [localHistory, currentSymbol]
    );

    const { data: latestApiSignal, isFetching, refetch } = useQuery({
        queryKey: ['signal-history-latest', currentSymbol],
        queryFn: () => fetchLatestSignalForSymbol(currentSymbol),
        refetchInterval: 15000,
        staleTime: 10000,
    });
    const {
        data: executionRecords = [],
        isFetching: isFetchingExecutionLog,
        refetch: refetchExecutionLog
    } = useQuery({
        queryKey: ['mt5-execution-log', currentSymbol],
        queryFn: () => fetchExecutionLogForSymbol(currentSymbol),
        refetchInterval: 12000,
        staleTime: 8000
    });
    const {
        data: mt5BotsData,
        isFetching: isFetchingBots,
        refetch: refetchMt5Bots
    } = useQuery({
        queryKey: ['mt5-bots-runtime'],
        queryFn: fetchMt5Bots,
        refetchInterval: 8000,
        staleTime: 5000
    });

    const executionMutation = useMutation({
        mutationFn: postExecutionLog,
        onSuccess: () => {
            setCopyStatus('Exécution broker enregistrée');
            setExecutionNote('');
            setFillPriceInput('');
            refetchExecutionLog();
        },
        onError: (err: any) => {
            setCopyStatus(`Journal erreur: ${String(err?.message || 'échec enregistrement')}`);
        }
    });
    const botControlMutation = useMutation({
        mutationFn: postMt5BotControl,
        onSuccess: () => {
            refetchMt5Bots();
            setCopyStatus('Bot MT5 mis à jour');
        },
        onError: (err: any) => {
            setCopyStatus(`Bot erreur: ${String(err?.message || 'échec')}`);
        }
    });

    const latestSignal = React.useMemo(() => {
        const local = normalizeLocalSignal(latestLocalSignal);
        const backend = normalizeApiSignal(latestApiSignal || null);
        if (!local) return backend;
        if (!backend) return local;
        return local.timestampMs >= backend.timestampMs ? local : backend;
    }, [latestLocalSignal, latestApiSignal]);

    const mt5Bots = React.useMemo(() => Array.isArray(mt5BotsData?.bots) ? mt5BotsData!.bots! : [], [mt5BotsData]);
    const activeBotId = mt5BotsData?.state?.activeBotId || null;
    const botStatus: BotRuntimeStatus = mt5BotsData?.state?.status || 'STOPPED';
    const heartbeatOnline = mt5BotsData?.bridge?.heartbeatOnline === true;
    const bridgeOnlineSymbols = Array.isArray(mt5BotsData?.bridge?.onlineSymbols) ? mt5BotsData!.bridge!.onlineSymbols! : [];
    const pendingBridgeCommands = Math.max(0, Number(mt5BotsData?.bridge?.pendingCommands || 0));
    const authFailuresTotal = Math.max(0, Number(mt5BotsData?.bridge?.authFailures?.total || 0));
    const uiBridgeStatus = heartbeatOnline ? 'ONLINE' : botStatus === 'RUNNING' ? 'CONNECTING' : 'OFFLINE';
    const uiBridgeColor = heartbeatOnline ? 'var(--buy)' : botStatus === 'RUNNING' ? 'var(--gold)' : 'var(--sell)';
    const heartbeatRef = mt5BotsData?.bridge?.lastHeartbeatAt || mt5BotsData?.state?.lastHeartbeatAt;
    const heartbeatLabel = heartbeatRef
        ? new Date(String(heartbeatRef)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';

    const selectedBot = React.useMemo(
        () => mt5Bots.find((bot) => bot.id === selectedBotId) || mt5Bots.find((bot) => bot.id === activeBotId) || mt5Bots[0],
        [mt5Bots, selectedBotId, activeBotId]
    );

    React.useEffect(() => {
        if (!selectedBotId && selectedBot?.id) {
            setSelectedBotId(selectedBot.id);
        }
    }, [selectedBotId, selectedBot]);

    React.useEffect(() => {
        if (!selectedBot) return;
        const activeParams = (mt5BotsData?.state?.params || {}) as Record<string, unknown>;
        const defaults = selectedBot.defaults || {};
        const hasActiveForSelected = mt5BotsData?.state?.activeBotId === selectedBot.id;

        const lot = hasActiveForSelected ? activeParams.lotSize : defaults.lotSize;
        const magic = hasActiveForSelected ? activeParams.magicNumber : defaults.magicNumber;
        const maxLoss = hasActiveForSelected ? activeParams.maxLoss : defaults.maxLoss;
        const maxTrades = hasActiveForSelected ? activeParams.maxTrades : defaults.maxTrades;

        setBotLotSize(String(lot ?? 0.01));
        setBotMagic(String(magic ?? 123456));
        setBotMaxLoss(String(maxLoss ?? 2.0));
        setBotMaxTrades(String(maxTrades ?? 10));
    }, [selectedBot, mt5BotsData?.state?.activeBotId, mt5BotsData?.state?.revision]);

    const mt5Symbol = MT5_SYMBOL_MAP[currentSymbol] || currentSymbol.replace('/', '');

    const side: Direction = latestSignal?.signal || 'HOLD';
    const hasExecutableSide = !!latestSignal && (side === 'BUY' || side === 'SELL');
    const hasTradeLevels = !!latestSignal
        && latestSignal.entryPrice > 0
        && latestSignal.takeProfit > 0
        && latestSignal.stopLoss > 0;
    const risk = hasTradeLevels ? Math.abs((latestSignal?.entryPrice || 0) - (latestSignal?.stopLoss || 0)) : 0;
    const reward = hasTradeLevels ? Math.abs((latestSignal?.takeProfit || 0) - (latestSignal?.entryPrice || 0)) : 0;
    const rr = risk > 0 ? reward / risk : 0;
    const sideColor = side === 'BUY' ? 'var(--buy)' : side === 'SELL' ? 'var(--sell)' : 'var(--gold)';
    const sideBg = side === 'BUY' ? 'var(--buy-bg)' : side === 'SELL' ? 'var(--sell-bg)' : 'rgba(255,255,255,0.05)';
    const updatedLabel = latestSignal?.timestampMs
        ? new Date(latestSignal.timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';
    const entryValue = toNumber(latestSignal?.entryPrice);
    const tpValue = toNumber(latestSignal?.takeProfit);
    const slValue = toNumber(latestSignal?.stopLoss);
    const confidenceValue = Math.round(toNumber(latestSignal?.confidence));
    const sourceValue = String(latestSignal?.source || 'backend');

    const ticketText = [
        'MT5 ORDER TICKET',
        `Symbol: ${mt5Symbol}`,
        `Type: ${side}`,
        `Volume: ${volume}`,
        `Entry: ${formatPrice(currentSymbol, entryValue)}`,
        `Stop Loss: ${formatPrice(currentSymbol, slValue)}`,
        `Take Profit: ${formatPrice(currentSymbol, tpValue)}`,
        `Confidence: ${confidenceValue}%`,
        `Source: ${sourceValue}`,
        `Updated: ${updatedLabel}`,
        risk > 0 ? `Risk/Reward: ${rr.toFixed(2)}` : 'Risk/Reward: N/A',
    ].join('\n');

    const compactOrderText = `${side} ${mt5Symbol} | Entry ${formatPrice(currentSymbol, entryValue)} | SL ${formatPrice(currentSymbol, slValue)} | TP ${formatPrice(currentSymbol, tpValue)} | Vol ${volume}`;

    const handleCopyTicket = async () => {
        const ok = await copyToClipboard(ticketText);
        setCopyStatus(ok ? 'Ticket MT5 copié' : 'Copie impossible');
    };

    const handleCopyLevels = async () => {
        const ok = await copyToClipboard(compactOrderText);
        setCopyStatus(ok ? 'Niveaux copiés' : 'Copie impossible');
    };

    const handleLogExecution = () => {
        if (!hasExecutableSide || !hasTradeLevels) {
            setCopyStatus('Signal non exécutable pour journal');
            return;
        }
        if (executionMutation.isPending) return;

        const parsedVolume = Number(volume);
        if (!Number.isFinite(parsedVolume) || parsedVolume <= 0) {
            setCopyStatus('Volume invalide');
            return;
        }

        const normalizedFill = Number(String(fillPriceInput || '').replace(',', '.'));
        const fillPrice = Number.isFinite(normalizedFill) && normalizedFill > 0 ? normalizedFill : undefined;

        executionMutation.mutate({
            symbol: currentSymbol,
            side,
            status: executionStatus,
            volume: parsedVolume,
            plannedEntry: entryValue,
            fillPrice,
            stopLoss: slValue,
            takeProfit: tpValue,
            confidence: confidenceValue,
            sourceSignal: sourceValue,
            signalTimestamp: latestSignal?.timestampMs || Date.now(),
            note: executionNote
        });
    };

    const handleStartBot = () => {
        if (!selectedBot?.id) {
            setCopyStatus('Sélectionne un bot');
            return;
        }
        const lotSize = Math.max(0.001, toNumber(String(botLotSize).replace(',', '.')) || 0.01);
        const magicNumber = Math.max(1, Math.floor(toNumber(botMagic) || 123456));
        const maxLoss = Math.max(0.1, toNumber(String(botMaxLoss).replace(',', '.')) || 2);
        const maxTrades = Math.max(1, Math.floor(toNumber(botMaxTrades) || 10));

        botControlMutation.mutate({
            action: activeBotId === selectedBot.id ? 'update' : 'start',
            botId: selectedBot.id,
            mode: 'live',
            note: `Activated from web panel on ${currentSymbol}`,
            params: { lotSize, magicNumber, maxLoss, maxTrades }
        });
    };

    const handleStopBot = () => {
        botControlMutation.mutate({
            action: 'stop',
            note: 'Stopped from web panel'
        });
    };

    const handleDownloadBot = () => {
        if (!selectedBot?.id) {
            setCopyStatus('Aucun bot sélectionné');
            return;
        }
        const params = new URLSearchParams({
            lotSize: String(Math.max(0.001, toNumber(String(botLotSize).replace(',', '.')) || 0.01)),
            magicNumber: String(Math.max(1, Math.floor(toNumber(botMagic) || 123456))),
            maxLoss: String(Math.max(0.1, toNumber(String(botMaxLoss).replace(',', '.')) || 2)),
            maxTrades: String(Math.max(1, Math.floor(toNumber(botMaxTrades) || 10))),
            download: '1'
        });
        window.open(`/api/mt5/bots/source/${encodeURIComponent(selectedBot.id)}?${params.toString()}`, '_blank', 'noopener,noreferrer');
    };

    const handleDownloadAutoExecutor = () => {
        window.open('/api/mt5/executor/source?download=1', '_blank', 'noopener,noreferrer');
    };

    const handleDownloadPythonExecutor = () => {
        window.open('/api/mt5/executor/python?download=1', '_blank', 'noopener,noreferrer');
    };

    return (
        <div style={{ padding: '0 8px 8px 8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-tertiary)', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                        MT5 BOT CONTROL
                    </span>
                    <span style={{ fontSize: '10px', color: botStatus === 'RUNNING' ? 'var(--buy)' : 'var(--gold)', fontWeight: 800 }}>
                        {botStatus}
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        Bridge: <span style={{ color: uiBridgeColor, fontWeight: 700 }}>{uiBridgeStatus}</span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textAlign: 'right' }}>
                        Heartbeat: <span style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{heartbeatLabel}</span>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                    <div>Queue: <span style={{ color: pendingBridgeCommands > 0 ? 'var(--gold)' : 'var(--text-main)', fontWeight: 700 }}>{pendingBridgeCommands}</span></div>
                    <div style={{ textAlign: 'right' }}>
                        Auth errors: <span style={{ color: authFailuresTotal > 0 ? 'var(--sell)' : 'var(--text-main)', fontWeight: 700 }}>{authFailuresTotal}</span>
                    </div>
                </div>
                {!heartbeatOnline && botStatus === 'RUNNING' && (
                    <div style={{ marginBottom: '8px', fontSize: '10px', color: 'var(--gold)' }}>
                        Bot RUNNING sans heartbeat récent. Télécharge l&apos;EA auto-préconfiguré et vérifie WebRequest MT5.
                    </div>
                )}

                <select
                    value={selectedBotId}
                    onChange={(e) => setSelectedBotId(e.target.value)}
                    style={{
                        width: '100%',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-main)',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        fontSize: '12px',
                        marginBottom: '8px'
                    }}
                >
                    {mt5Bots.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                            {bot.name}
                        </option>
                    ))}
                </select>

                {selectedBot?.description && (
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        {selectedBot.description}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '8px', marginBottom: '8px' }}>
                    <input
                        value={botLotSize}
                        onChange={(e) => setBotLotSize(e.target.value)}
                        placeholder="LotSize"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: '6px', padding: '6px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                    />
                    <input
                        value={botMagic}
                        onChange={(e) => setBotMagic(e.target.value)}
                        placeholder="MagicNumber"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: '6px', padding: '6px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                    />
                    <input
                        value={botMaxLoss}
                        onChange={(e) => setBotMaxLoss(e.target.value)}
                        placeholder="MaxLoss"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: '6px', padding: '6px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                    />
                    <input
                        value={botMaxTrades}
                        onChange={(e) => setBotMaxTrades(e.target.value)}
                        placeholder="MaxTrades"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: '6px', padding: '6px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                    <button
                        onClick={handleStartBot}
                        disabled={!selectedBot || botControlMutation.isPending}
                        style={{
                            flex: 1,
                            cursor: !selectedBot || botControlMutation.isPending ? 'not-allowed' : 'pointer',
                            opacity: !selectedBot || botControlMutation.isPending ? 0.6 : 1,
                            background: 'rgba(0,230,118,0.10)',
                            border: '1px solid rgba(0,230,118,0.55)',
                            color: 'var(--buy)',
                            borderRadius: '6px',
                            padding: '8px',
                            fontSize: '11px',
                            fontWeight: 800
                        }}
                    >
                        {botControlMutation.isPending ? 'SYNC...' : activeBotId === selectedBot?.id ? 'UPDATE BOT' : 'START BOT'}
                    </button>
                    <button
                        onClick={handleStopBot}
                        disabled={botControlMutation.isPending || botStatus !== 'RUNNING'}
                        style={{
                            flex: 1,
                            cursor: botControlMutation.isPending || botStatus !== 'RUNNING' ? 'not-allowed' : 'pointer',
                            opacity: botControlMutation.isPending || botStatus !== 'RUNNING' ? 0.6 : 1,
                            background: 'rgba(255,82,82,0.10)',
                            border: '1px solid rgba(255,82,82,0.55)',
                            color: 'var(--sell)',
                            borderRadius: '6px',
                            padding: '8px',
                            fontSize: '11px',
                            fontWeight: 800
                        }}
                    >
                        STOP BOT
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={handleDownloadBot}
                        disabled={!selectedBot}
                        style={{
                            flex: 1,
                            cursor: !selectedBot ? 'not-allowed' : 'pointer',
                            opacity: !selectedBot ? 0.6 : 1,
                            background: 'rgba(245,176,65,0.10)',
                            border: '1px solid var(--gold)',
                            color: 'var(--gold)',
                            borderRadius: '6px',
                            padding: '8px',
                            fontSize: '11px',
                            fontWeight: 800
                        }}
                    >
                        DOWNLOAD MQ5
                    </button>
                    <button
                        onClick={() => refetchMt5Bots()}
                        style={{
                            flex: 1,
                            cursor: 'pointer',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-main)',
                            borderRadius: '6px',
                            padding: '8px',
                            fontSize: '11px',
                            fontWeight: 700
                        }}
                    >
                        {isFetchingBots ? 'SYNC...' : `BRIDGE ${bridgeOnlineSymbols.join(', ') || '—'}`}
                    </button>
                </div>
                <button
                    onClick={handleDownloadAutoExecutor}
                    style={{
                        width: '100%',
                        marginTop: '8px',
                        cursor: 'pointer',
                        background: 'rgba(44,108,247,0.12)',
                        border: '1px solid rgba(44,108,247,0.55)',
                        color: 'var(--accent)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800
                    }}
                >
                    DOWNLOAD AUTO EXECUTOR (WEB → MT5)
                </button>
                <button
                    onClick={handleDownloadPythonExecutor}
                    style={{
                        width: '100%',
                        marginTop: '8px',
                        cursor: 'pointer',
                        background: 'rgba(34,197,94,0.12)',
                        border: '1px solid rgba(34,197,94,0.55)',
                        color: 'var(--buy)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800
                    }}
                >
                    DOWNLOAD PYTHON EXECUTOR (AUTO)
                </button>
            </div>

            {(isMarketClosed || !latestSignal) && (
                <div style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-tertiary)', padding: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {isMarketClosed
                        ? <>Marché fermé pour <strong>{currentSymbol}</strong>. <span style={{ color: 'var(--gold)' }}>{marketClosedReason}</span></>
                        : <>Aucun signal prêt sur <strong>{currentSymbol}</strong>. Lance une analyse IA pour générer un ticket.</>}
                </div>
            )}

            <div style={{ border: `1px solid ${sideColor}`, background: sideBg, borderRadius: '8px', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>PRÊT POUR MT5</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>MAJ {updatedLabel}{isFetching ? ' • sync...' : ''}</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: 900, letterSpacing: '1px', color: sideColor }}>{side}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '3px' }}>ENTRÉE</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700 }}>{formatPrice(currentSymbol, entryValue)}</div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '3px' }}>TP</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--buy)' }}>{formatPrice(currentSymbol, tpValue)}</div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '3px' }}>SL</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--sell)' }}>{formatPrice(currentSymbol, slValue)}</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Symbole MT5</div>
                    <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{mt5Symbol}</div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '8px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Confiance / RR</div>
                    <div style={{ fontWeight: 700, marginTop: '2px' }}>
                        {confidenceValue}% / {risk > 0 ? rr.toFixed(2) : 'N/A'}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }} htmlFor="mt5-volume">Volume</label>
                <input
                    id="mt5-volume"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    style={{
                        flex: 1,
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-main)',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)'
                    }}
                    placeholder="0.10"
                />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    onClick={handleCopyTicket}
                    disabled={!hasExecutableSide || !hasTradeLevels}
                    style={{
                        flex: 1,
                        cursor: hasExecutableSide && hasTradeLevels ? 'pointer' : 'not-allowed',
                        opacity: hasExecutableSide && hasTradeLevels ? 1 : 0.5,
                        background: 'rgba(245,176,65,0.1)',
                        border: '1px solid var(--gold)',
                        color: 'var(--gold)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontWeight: 700,
                        fontSize: '11px'
                    }}
                >
                    Copier ticket MT5
                </button>
                <button
                    onClick={handleCopyLevels}
                    disabled={!hasExecutableSide || !hasTradeLevels}
                    style={{
                        flex: 1,
                        cursor: hasExecutableSide && hasTradeLevels ? 'pointer' : 'not-allowed',
                        opacity: hasExecutableSide && hasTradeLevels ? 1 : 0.5,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-main)',
                        borderRadius: '6px',
                        padding: '8px',
                        fontWeight: 700,
                        fontSize: '11px'
                    }}
                >
                    Copier niveaux
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input
                    value={fillPriceInput}
                    onChange={(e) => setFillPriceInput(e.target.value)}
                    placeholder={`Fill réel (${formatPrice(currentSymbol, entryValue)})`}
                    style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-main)',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)'
                    }}
                />
                <select
                    value={executionStatus}
                    onChange={(e) => setExecutionStatus(e.target.value as ExecutionStatus)}
                    style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-main)',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        fontSize: '12px'
                    }}
                >
                    <option value="FILLED">FILLED</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="REJECTED">REJECTED</option>
                    <option value="CANCELLED">CANCELLED</option>
                </select>
            </div>

            <textarea
                value={executionNote}
                onChange={(e) => setExecutionNote(e.target.value)}
                placeholder="Note broker / slippage / contexte exécution..."
                maxLength={220}
                rows={2}
                style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-main)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '11px',
                    resize: 'vertical'
                }}
            />

            <button
                onClick={handleLogExecution}
                disabled={!hasExecutableSide || !hasTradeLevels || executionMutation.isPending}
                style={{
                    cursor: hasExecutableSide && hasTradeLevels && !executionMutation.isPending ? 'pointer' : 'not-allowed',
                    opacity: hasExecutableSide && hasTradeLevels && !executionMutation.isPending ? 1 : 0.55,
                    background: 'rgba(0,230,118,0.10)',
                    border: '1px solid rgba(0,230,118,0.55)',
                    color: 'var(--buy)',
                    borderRadius: '6px',
                    padding: '8px',
                    fontSize: '11px',
                    fontWeight: 800,
                    letterSpacing: '0.3px'
                }}
            >
                {executionMutation.isPending ? 'ENREGISTREMENT...' : 'ENREGISTRER EXÉCUTION BROKER'}
            </button>

            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-tertiary)', padding: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                        JOURNAL EXÉCUTION BROKER
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        {isFetchingExecutionLog ? 'sync...' : `${executionRecords.length} entrée(s)`}
                    </span>
                </div>
                {executionRecords.length === 0 ? (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Aucune exécution enregistrée pour {currentSymbol}.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '170px', overflowY: 'auto' }}>
                        {executionRecords.slice(0, 8).map((record) => {
                            const isBuySide = record.side === 'BUY';
                            const sideTone = isBuySide ? 'var(--buy)' : 'var(--sell)';
                            const slip = Number(record.slippageBps);
                            const slipLabel = Number.isFinite(slip) ? `${slip >= 0 ? '+' : ''}${slip.toFixed(2)} bps` : 'n/a';
                            return (
                                <div
                                    key={record.id}
                                    style={{
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        padding: '6px 7px',
                                        background: 'rgba(255,255,255,0.02)',
                                        fontSize: '10px',
                                        lineHeight: 1.4
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 800, color: sideTone }}>
                                            {record.side} {record.status}
                                        </span>
                                        <span style={{ color: 'var(--text-secondary)' }}>
                                            {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)' }}>
                                        Vol {record.volume} | Plan {formatPrice(currentSymbol, Number(record.plannedEntry || 0))} | Fill {formatPrice(currentSymbol, Number(record.fillPrice || 0))}
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)' }}>
                                        Slippage {slipLabel}{record.signalAgeMs ? ` | Signal age ${Math.round(record.signalAgeMs / 1000)}s` : ''}
                                    </div>
                                    {record.note && (
                                        <div style={{ color: 'var(--text-main)' }}>{record.note}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <button
                onClick={() => {
                    refetch();
                    refetchExecutionLog();
                }}
                style={{
                    cursor: 'pointer',
                    background: 'transparent',
                    border: '1px dashed var(--border)',
                    color: 'var(--text-secondary)',
                    borderRadius: '6px',
                    padding: '6px',
                    fontSize: '10px',
                    letterSpacing: '0.2px'
                }}
            >
                Rafraîchir le ticket
            </button>

            <div style={{ fontSize: '11px', color: copyStatus ? 'var(--gold)' : 'var(--text-secondary)', minHeight: '16px' }}>
                {copyStatus || 'Mode auto: EA MQ5 ou Python Executor via /api/mt5/executor/next.'}
            </div>
        </div>
    );
}
