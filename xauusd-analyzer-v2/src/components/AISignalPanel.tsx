import React, { useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { getMarketClosedReason, isSymbolMarketClosed } from '../utils/marketHours';

type Direction = 'BUY' | 'SELL' | 'HOLD';

interface AISignalResponse {
    success?: boolean;
    source?: string;
    signal: Direction;
    confidence?: number;
    reasoning?: string;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
}

interface ScalpPredictionResponse {
    success?: boolean;
    source?: string;
    signal: Direction;
    confidence?: number;
    score?: number;
    horizonMinutes?: number;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
    reasoning?: string;
    reasons?: string[];
    targetTime?: string;
}

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

const postAISignal = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/ai-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json() as Promise<AISignalResponse>;
};

const postScalp3m = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/scalp-3m', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json() as Promise<ScalpPredictionResponse>;
};

const formatLevel = (value?: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '—';
};

export default function AISignalPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);
    const isMarketClosed = isSymbolMarketClosed(currentSymbol);
    const marketClosedReason = getMarketClosedReason(currentSymbol);
    const lastScalpRunRef = useRef(0);

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });

    const candlesForAnalysis = useMemo(() => {
        if (!history || history.length < 30) return [];
        const candles = [...history];
        if (livePrice) {
            const last = { ...candles[candles.length - 1] };
            last.close = livePrice;
            last.high = Math.max(last.high, livePrice);
            last.low = Math.min(last.low, livePrice);
            candles[candles.length - 1] = last;
        }
        return candles;
    }, [history, livePrice]);

    const indicators = useMemo(() => {
        if (!candlesForAnalysis || candlesForAnalysis.length < 30) return null;
        return calculateAllIndicators(candlesForAnalysis);
    }, [candlesForAnalysis]);

    const addSignal = useMarketStore(state => state.addSignal);
    const selectedAI = useMarketStore(state => state.selectedAI);
    const setSelectedAI = useMarketStore(state => state.setSelectedAI);

    const mutation = useMutation({
        mutationFn: postAISignal,
        onSuccess: (data) => {
            if (data && data.signal) {
                addSignal({
                    id: Math.random().toString(36).substring(7),
                    timestamp: Date.now(),
                    symbol: currentSymbol,
                    timeframe: currentTimeframe,
                    signal: data.signal,
                    price: livePrice || 0,
                    confidence: data.confidence || 0,
                    entryPrice: data.entryPrice,
                    takeProfit: data.takeProfit,
                    stopLoss: data.stopLoss
                });
            }
        }
    });

    const scalpMutation = useMutation({
        mutationFn: postScalp3m
    });

    const aiPayload = useMemo(() => {
        if (!indicators || !livePrice || candlesForAnalysis.length < 30) return null;
        return {
            symbol: currentSymbol,
            currentPrice: livePrice,
            candles: candlesForAnalysis.slice(-80),
            indicators,
            aiModel: selectedAI
        };
    }, [indicators, livePrice, candlesForAnalysis, currentSymbol, selectedAI]);

    const scalpPayload = useMemo(() => {
        if (!indicators || !livePrice || candlesForAnalysis.length < 30) return null;
        return {
            symbol: currentSymbol,
            timeframe: currentTimeframe,
            currentPrice: livePrice,
            candles: candlesForAnalysis.slice(-120),
            indicators
        };
    }, [indicators, livePrice, candlesForAnalysis, currentSymbol, currentTimeframe]);

    const runAiAnalysis = React.useCallback(() => {
        if (!aiPayload || mutation.isPending) return;
        mutation.mutate(aiPayload);
    }, [aiPayload, mutation]);

    const runScalpRefresh = React.useCallback(() => {
        if (!scalpPayload || scalpMutation.isPending) return;
        lastScalpRunRef.current = Date.now();
        scalpMutation.mutate(scalpPayload);
    }, [scalpPayload, scalpMutation]);

    // Fast 3m scalp refresh (every ~7s max, tied to live tick updates).
    React.useEffect(() => {
        if (isMarketClosed || !scalpPayload || scalpMutation.isPending) return;
        const now = Date.now();
        if (now - lastScalpRunRef.current < 7000) return;
        lastScalpRunRef.current = now;
        scalpMutation.mutate(scalpPayload);
    }, [isMarketClosed, scalpPayload, scalpMutation, livePrice]);

    const AI_MODELS = [
        { id: 'ollama', name: 'Ollama', icon: '🤖' },
        { id: 'gemini', name: 'Gemini', icon: '✨' },
        { id: 'groq', name: 'Groq', icon: '🚀' },
        { id: 'codex', name: 'Codex', icon: '📜' },
        { id: 'copilot', name: 'Copilot', icon: '💻' }
    ];

    if (isMarketClosed) {
        return (
            <div style={{
                padding: '12px',
                fontSize: '12px',
                color: 'var(--gold)',
                background: 'rgba(245,176,65,0.08)',
                border: '1px solid var(--gold)',
                borderRadius: '8px',
                margin: '4px 8px 8px 8px'
            }}>
                MARCHE FERME pour {currentSymbol}.<br />
                <span style={{ color: 'var(--text-secondary)' }}>{marketClosedReason}</span>
            </div>
        );
    }

    const signalData = mutation.data;
    const isBuy = signalData?.signal === 'BUY';
    const isSell = signalData?.signal === 'SELL';
    const colorType = isBuy ? 'buy' : isSell ? 'sell' : 'neutral';
    const scalpData = scalpMutation.data;
    const scalpColor = scalpData?.signal === 'BUY' ? 'var(--buy)' : scalpData?.signal === 'SELL' ? 'var(--sell)' : 'var(--gold)';
    const scalpBg = scalpData?.signal === 'BUY'
        ? 'var(--buy-bg)'
        : scalpData?.signal === 'SELL'
            ? 'var(--sell-bg)'
            : 'rgba(255,255,255,0.05)';
    const scalpEta = scalpData?.targetTime
        ? new Date(scalpData.targetTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';
    const hasInputs = !!aiPayload;

    return (
        <div className="ai-panel" style={{ padding: '0 8px 8px 8px' }}>
            <div className="ai-selector" style={{ display: 'flex', gap: '4px', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                {AI_MODELS.map(m => (
                    <button
                        key={m.id}
                        onClick={() => setSelectedAI(m.id)}
                        title={m.name}
                        style={{
                            flex: 1,
                            padding: '6px 2px',
                            background: selectedAI === m.id ? 'rgba(255,215,0,0.1)' : 'transparent',
                            border: '1px solid',
                            borderColor: selectedAI === m.id ? 'var(--gold)' : 'transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '2px'
                        }}
                    >
                        <span>{m.icon}</span>
                        <span style={{ fontSize: '8px', fontWeight: 700, opacity: selectedAI === m.id ? 1 : 0.5 }}>{m.name.toUpperCase()}</span>
                    </button>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <button
                    onClick={runAiAnalysis}
                    disabled={!hasInputs || mutation.isPending}
                    style={{
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        borderRadius: '6px',
                        border: '1px solid var(--gold)',
                        background: mutation.isPending ? 'rgba(255,215,0,0.08)' : 'rgba(255,215,0,0.14)',
                        color: 'var(--gold)',
                        cursor: !hasInputs || mutation.isPending ? 'not-allowed' : 'pointer',
                        opacity: !hasInputs || mutation.isPending ? 0.6 : 1
                    }}
                >
                    {mutation.isPending ? 'ANALYSE IA...' : 'ANALYSE IA MANUELLE'}
                </button>
                <button
                    onClick={runScalpRefresh}
                    disabled={!scalpPayload || scalpMutation.isPending}
                    style={{
                        padding: '8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.5px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-main)',
                        cursor: !scalpPayload || scalpMutation.isPending ? 'not-allowed' : 'pointer',
                        opacity: !scalpPayload || scalpMutation.isPending ? 0.6 : 1
                    }}
                >
                    {scalpMutation.isPending ? 'SCALP 3M...' : 'RAFRAICHIR SCALP 3M'}
                </button>
            </div>

            {!hasInputs && (
                <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    En attente de suffisamment de données marché...
                </div>
            )}

            {signalData && (
                <>
                    <div className={`ai-header ${colorType}`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div className="ai-badge">{signalData.source?.toUpperCase() || 'ALGORITHMIQUE'}</div>
                            <div className="ai-confidence">
                                FIABILITÉ: <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{signalData.confidence || 0}%</span>
                            </div>
                        </div>
                        <div className="ai-action">{signalData.signal}</div>
                    </div>

                    <div className="trade-levels">
                        <div className="level-box entry">
                            <span className="level-label">ENTRÉE</span>
                            <span className="level-value">{formatLevel(signalData.entryPrice || livePrice)}</span>
                        </div>
                        <div className="level-box tp">
                            <span className="level-label">TAKE PROFIT</span>
                            <span className="level-value">{formatLevel(signalData.takeProfit)}</span>
                        </div>
                        <div className="level-box sl">
                            <span className="level-label">STOP LOSS</span>
                            <span className="level-value">{formatLevel(signalData.stopLoss)}</span>
                        </div>
                    </div>

                    <div className="ai-reasoning" style={{ marginBottom: '12px' }}>
                        <strong>💡 Raisonnement IA:</strong> <br />
                        {signalData.reasoning || "Analyse basée sur de multiples indicateurs techniques et momentum."}
                    </div>
                </>
            )}

            {!signalData && !mutation.isPending && (
                <div className="ai-reasoning" style={{ marginBottom: '12px' }}>
                    Clique sur <strong>ANALYSE IA MANUELLE</strong> pour générer un signal complet (plus lent, mais détaillé).
                </div>
            )}

            <div style={{ border: `1px solid ${scalpColor}`, background: scalpBg, borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.6px', color: 'var(--text-secondary)' }}>
                        PREDICTION SCALPING 3 MIN
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        ETA {scalpEta}
                    </div>
                </div>
                {scalpData ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '22px', fontWeight: 900, color: scalpColor }}>{scalpData.signal}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-main)' }}>
                                Confiance <strong>{Math.round(Number(scalpData.confidence) || 0)}%</strong> | Score <strong>{Number(scalpData.score || 0).toFixed(1)}</strong>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                            <div className="level-box entry">
                                <span className="level-label">ENTRÉE</span>
                                <span className="level-value">{formatLevel(scalpData.entryPrice || livePrice)}</span>
                            </div>
                            <div className="level-box tp">
                                <span className="level-label">TP 3M</span>
                                <span className="level-value">{formatLevel(scalpData.takeProfit)}</span>
                            </div>
                            <div className="level-box sl">
                                <span className="level-label">SL 3M</span>
                                <span className="level-value">{formatLevel(scalpData.stopLoss)}</span>
                            </div>
                        </div>
                        <div style={{ fontSize: '12px', lineHeight: 1.45 }}>
                            {scalpData.reasoning || 'Analyse scalping en cours...'}
                        </div>
                        {Array.isArray(scalpData.reasons) && scalpData.reasons.length > 0 && (
                            <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {scalpData.reasons.slice(0, 4).map((reason, idx) => (
                                    <li key={`${reason}-${idx}`}>{reason}</li>
                                ))}
                            </ul>
                        )}
                    </>
                ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {scalpMutation.isPending ? 'Calcul scalping 3m...' : 'Scalp 3m en attente des données de marché.'}
                    </div>
                )}
            </div>

            <style>{`
                @keyframes loaderMsg { 0% { left: -30%; } 100% { left: 100%; } }
                .ai-header {
                    padding: 16px;
                    border-radius: 8px;
                    text-align: center;
                    margin-bottom: 12px;
                    border: 1px solid var(--border);
                }
                .ai-header.buy { background: var(--buy-bg); border-color: var(--buy); color: var(--buy); }
                .ai-header.sell { background: var(--sell-bg); border-color: var(--sell); color: var(--sell); }
                .ai-header.neutral, .ai-header.hold { background: rgba(255,255,255,0.05); border-color: var(--gold); color: var(--gold); }
                
                .ai-action { font-size: 28px; font-weight: 900; letter-spacing: 2px; }
                .ai-badge { background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; }
                .ai-confidence { font-size: 11px; opacity: 0.8;}

                .trade-levels { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
                .level-box { background: var(--bg-tertiary); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border); }
                .level-label { display: block; font-size: 9px; font-weight: bold; color: var(--text-secondary); margin-bottom: 4px; }
                .level-value { font-family: var(--font-mono); font-weight: bold; font-size: 13px; }
                .level-box.tp .level-value { color: var(--buy); }
                .level-box.sl .level-value { color: var(--sell); }

                .ai-reasoning { background: var(--bg-tertiary); padding: 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; color: var(--text-main); border-left: 3px solid var(--gold); }
            `}</style>
        </div>
    );
}
