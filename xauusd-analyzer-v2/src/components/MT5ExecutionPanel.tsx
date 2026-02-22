import React from 'react';
import { useQuery } from '@tanstack/react-query';
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
    'XAU/USD': 'XAUUSD',
    'BTC/USD': 'BTCUSD',
    'ETH/USD': 'ETHUSD',
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

const formatPrice = (value: number) => (value > 0 ? value.toFixed(2) : '—');

export default function MT5ExecutionPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const localHistory = useMarketStore(state => state.signalHistory);
    const [volume, setVolume] = React.useState('0.10');
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

    const latestSignal = React.useMemo(() => {
        const local = normalizeLocalSignal(latestLocalSignal);
        const backend = normalizeApiSignal(latestApiSignal || null);
        if (!local) return backend;
        if (!backend) return local;
        return local.timestampMs >= backend.timestampMs ? local : backend;
    }, [latestLocalSignal, latestApiSignal]);

    const mt5Symbol = MT5_SYMBOL_MAP[currentSymbol] || currentSymbol.replace('/', '');

    if (isMarketClosed) {
        return (
            <div style={{ padding: '4px 8px 8px 8px', color: 'var(--gold)', fontSize: '12px' }}>
                Marché fermé pour <strong>{currentSymbol}</strong>.<br />
                <span style={{ color: 'var(--text-secondary)' }}>{marketClosedReason}</span>
            </div>
        );
    }

    if (!latestSignal) {
        return (
            <div style={{ padding: '4px 8px 8px 8px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                Aucun signal prêt pour exécution MT5 sur <strong>{currentSymbol}</strong>. Lance une analyse IA pour générer un ticket.
            </div>
        );
    }

    const side = latestSignal.signal;
    const hasExecutableSide = side === 'BUY' || side === 'SELL';
    const hasTradeLevels = latestSignal.entryPrice > 0 && latestSignal.takeProfit > 0 && latestSignal.stopLoss > 0;
    const risk = hasTradeLevels ? Math.abs(latestSignal.entryPrice - latestSignal.stopLoss) : 0;
    const reward = hasTradeLevels ? Math.abs(latestSignal.takeProfit - latestSignal.entryPrice) : 0;
    const rr = risk > 0 ? reward / risk : 0;
    const sideColor = side === 'BUY' ? 'var(--buy)' : side === 'SELL' ? 'var(--sell)' : 'var(--gold)';
    const sideBg = side === 'BUY' ? 'var(--buy-bg)' : side === 'SELL' ? 'var(--sell-bg)' : 'rgba(255,255,255,0.05)';
    const updatedLabel = latestSignal.timestampMs
        ? new Date(latestSignal.timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';

    const ticketText = [
        'MT5 ORDER TICKET',
        `Symbol: ${mt5Symbol}`,
        `Type: ${side}`,
        `Volume: ${volume}`,
        `Entry: ${formatPrice(latestSignal.entryPrice)}`,
        `Stop Loss: ${formatPrice(latestSignal.stopLoss)}`,
        `Take Profit: ${formatPrice(latestSignal.takeProfit)}`,
        `Confidence: ${Math.round(latestSignal.confidence)}%`,
        `Source: ${latestSignal.source}`,
        `Updated: ${updatedLabel}`,
        risk > 0 ? `Risk/Reward: ${rr.toFixed(2)}` : 'Risk/Reward: N/A',
    ].join('\n');

    const compactOrderText = `${side} ${mt5Symbol} | Entry ${formatPrice(latestSignal.entryPrice)} | SL ${formatPrice(latestSignal.stopLoss)} | TP ${formatPrice(latestSignal.takeProfit)} | Vol ${volume}`;

    const handleCopyTicket = async () => {
        const ok = await copyToClipboard(ticketText);
        setCopyStatus(ok ? 'Ticket MT5 copié' : 'Copie impossible');
    };

    const handleCopyLevels = async () => {
        const ok = await copyToClipboard(compactOrderText);
        setCopyStatus(ok ? 'Niveaux copiés' : 'Copie impossible');
    };

    return (
        <div style={{ padding: '0 8px 8px 8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700 }}>{formatPrice(latestSignal.entryPrice)}</div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '3px' }}>TP</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--buy)' }}>{formatPrice(latestSignal.takeProfit)}</div>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '3px' }}>SL</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--sell)' }}>{formatPrice(latestSignal.stopLoss)}</div>
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
                        {Math.round(latestSignal.confidence)}% / {risk > 0 ? rr.toFixed(2) : 'N/A'}
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

            <button
                onClick={() => refetch()}
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
                {copyStatus || 'Exécution manuelle MT5: F9 -> symbole -> volume -> SL/TP -> ordre.'}
            </div>
        </div>
    );
}
