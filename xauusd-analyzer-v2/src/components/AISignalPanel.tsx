import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { getMarketClosedReason, isSymbolMarketClosed } from '../utils/marketHours';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

const postAISignal = async (payload: any) => {
    const res = await fetch('/api/ai-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return res.json();
};

export default function AISignalPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);
    const [lastAnalysedTime, setLastAnalysedTime] = useState<number>(0);
    const isMarketClosed = isSymbolMarketClosed(currentSymbol);
    const marketClosedReason = getMarketClosedReason(currentSymbol);

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });

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

    // Auto-trigger analysis when data is ready (debounce by 10s locally)
    React.useEffect(() => {
        if (isMarketClosed) return;
        if (!history || history.length < 30 || !livePrice) return;

        const now = Date.now();
        if (now - lastAnalysedTime > 15000 && !mutation.isPending) {
            const candles = [...history];
            const last = { ...candles[candles.length - 1] };
            last.close = livePrice;
            last.high = Math.max(last.high, livePrice);
            last.low = Math.min(last.low, livePrice);
            candles[candles.length - 1] = last;

            const indicators = calculateAllIndicators(candles);
            if (indicators) {
                mutation.mutate({
                    symbol: currentSymbol,
                    currentPrice: livePrice,
                    candles: candles.slice(-50),
                    indicators,
                    aiModel: selectedAI // PASS SELECTED MODEL
                });
                setLastAnalysedTime(now);
            }
        }
    }, [history, livePrice, currentSymbol, lastAnalysedTime, currentTimeframe, selectedAI, isMarketClosed]);

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

    if (!mutation.data && mutation.isPending) return (
        <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>🤖 Analyse {selectedAI.toUpperCase()} en cours...</div>
            <div style={{ width: '100%', height: '2px', background: 'var(--border)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', width: '30%', height: '100%', background: 'var(--gold)', animation: 'loaderMsg 2s infinite' }}></div>
            </div>
        </div>
    );

    if (!mutation.data) return <div className="p-4" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>En attente des données de marché...</div>;

    const signalData = mutation.data;
    const isBuy = signalData.signal === 'BUY';
    const isSell = signalData.signal === 'SELL';
    const colorType = isBuy ? 'buy' : isSell ? 'sell' : 'neutral';

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
                    <span className="level-value">{signalData.entryPrice || livePrice?.toFixed(2) || '—'}</span>
                </div>
                <div className="level-box tp">
                    <span className="level-label">TAKE PROFIT</span>
                    <span className="level-value">{signalData.takeProfit || '—'}</span>
                </div>
                <div className="level-box sl">
                    <span className="level-label">STOP LOSS</span>
                    <span className="level-value">{signalData.stopLoss || '—'}</span>
                </div>
            </div>

            <div className="ai-reasoning">
                <strong>💡 Raisonnement:</strong> <br />
                {signalData.reasoning || "Analyse basée sur de multiples indicateurs techniques et momentum."}
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
