import React from 'react';
import { useMarketStore } from '../store/marketStore';

export default function SignalHistoryPanel() {
    const signalHistory = useMarketStore(state => state.signalHistory);

    if (signalHistory.length === 0) {
        return (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
                Aucun signal dans l'historique
            </div>
        );
    }

    // Calculate simple win rate (if confidence > 60, assume success for placeholder logic)
    const total = signalHistory.length;
    const wins = signalHistory.filter(s => s.confidence > 75).length;
    const losses = signalHistory.filter(s => s.confidence < 50).length;
    const winRate = total > 0 ? Math.round((wins / (wins + losses || 1)) * 100) : 0;

    return (
        <div className="signal-history-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', padding: '0 4px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Total: <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{total}</span>
                </div>
                <div style={{
                    background: winRate >= 50 ? 'var(--buy-bg)' : 'var(--sell-bg)',
                    color: winRate >= 50 ? 'var(--buy)' : 'var(--sell)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    border: `1px solid ${winRate >= 50 ? 'var(--buy)' : 'var(--sell)'}`
                }}>
                    WIN RATE: {winRate}%
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {signalHistory.map((s) => (
                    <div key={s.id} style={{
                        background: 'var(--bg-tertiary)',
                        borderRadius: '6px',
                        padding: '10px',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: s.signal === 'BUY' ? 'var(--buy-bg)' : s.signal === 'SELL' ? 'var(--sell-bg)' : 'rgba(255,255,255,0.05)',
                            color: s.signal === 'BUY' ? 'var(--buy)' : s.signal === 'SELL' ? 'var(--sell)' : 'var(--text-main)',
                            fontSize: '16px'
                        }}>
                            {s.signal === 'BUY' ? '↑' : s.signal === 'SELL' ? '↓' : '•'}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>{s.symbol}</span>
                                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                    {new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    color: s.signal === 'BUY' ? 'var(--buy)' : s.signal === 'SELL' ? 'var(--sell)' : 'var(--text-secondary)'
                                }}>
                                    {s.signal} @ {s.price.toFixed(2)}
                                </span>
                                <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: '3px', color: 'var(--text-secondary)' }}>
                                    {s.timeframe}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <style>{`
                .signal-history-panel::-webkit-scrollbar { width: 4px; }
                .signal-history-panel::-webkit-scrollbar-track { background: transparent; }
                .signal-history-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
            `}</style>
        </div>
    );
}
