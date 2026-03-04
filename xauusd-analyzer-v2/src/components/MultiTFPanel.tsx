import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';

const fetchMultiTF = async (symbol: string) => {
    const res = await fetch(`/api/multi-tf?symbol=${symbol}`);
    const data = await res.json();
    return data;
};

type MultiTFPanelProps = {
    compact?: boolean;
};

export default function MultiTFPanel({ compact = false }: MultiTFPanelProps) {
    const currentSymbol = useMarketStore(state => state.currentSymbol);

    const { data: mtfData, isLoading, error } = useQuery({
        queryKey: ['multi-tf', currentSymbol],
        queryFn: () => fetchMultiTF(currentSymbol),
        refetchInterval: 30000, // Poll every 30s
    });

    if (isLoading) return <div className="p-4 text-secondary">Loading Multi-TF Data...</div>;
    if (error || !mtfData || !mtfData.success) return <div className="p-4 text-sell">Failed to load Multi-TF Data</div>;
    if (mtfData.marketStatus === 'closed') {
        return (
            <div className="p-4" style={{ color: 'var(--gold)', fontSize: '12px', lineHeight: 1.5 }}>
                <strong>Marche ferme</strong><br />
                <span style={{ color: 'var(--text-secondary)' }}>{mtfData.reason || 'Instrument indisponible pour le moment.'}</span>
            </div>
        );
    }

    const { timeframes, confluence } = mtfData;
    const timeframesList = ['1min', '5min', '15min', '1h'];

    return (
        <div className={`mtf-panel ${compact ? 'compact' : ''}`}>
            {confluence && (
                <div className={`mtf-consensus ${confluence.signal.toLowerCase()}`}>
                    <div className="mtf-consensus-label">CONSENSUS GLOBAL</div>
                    <div className="mtf-consensus-value">{confluence.signal === 'HOLD' ? 'NEUTRE' : confluence.signal === 'BUY' ? 'ACHAT' : 'VENTE'} ({confluence.strength}%)</div>
                    <div className="mtf-consensus-score">Achat: {confluence.buyCount} | Vente: {confluence.sellCount}</div>
                </div>
            )}

            <div className="mtf-grid">
                <div className="mtf-row mtf-header">
                    <span>TF</span>
                    <span>RSI</span>
                    <span>Trend</span>
                    <span style={{ textAlign: 'right' }}>Signal</span>
                </div>
                {timeframesList.map(tf => {
                    const data = timeframes[tf];
                    if (!data) return null;
                    return (
                        <div key={tf} className="mtf-row">
                            <span className="tf-badge">{tf.replace('min', 'm')}</span>
                            <span style={{ color: data.rsi && data.rsi > 70 ? 'var(--sell)' : data.rsi && data.rsi < 30 ? 'var(--buy)' : 'var(--text-main)' }}>
                                {data.rsi ? data.rsi.toFixed(1) : '—'}
                            </span>
                            <span style={{ color: data.trend === 'BULL' || data.trend === 'UP' ? 'var(--buy)' : data.trend === 'BEAR' || data.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)' }}>
                                {data.trend === 'BULL' ? 'HAUSSIER' : data.trend === 'BEAR' ? 'BAISSIER' : 'NEUTRE'} {data.trend === 'BULL' ? '↑' : data.trend === 'BEAR' ? '↓' : ''}
                            </span>
                            <span className={`signal-badge ${data.signal.toLowerCase()}`}>
                                {data.signal === 'HOLD' ? 'NEUTRE' : data.signal === 'BUY' ? 'ACHAT' : 'VENTE'}
                            </span>
                        </div>
                    );
                })}
            </div>

            <style>{`
                .mtf-panel { padding: 4px; }
                .mtf-consensus {
                    padding: 12px;
                    border-radius: 8px;
                    text-align: center;
                    margin-bottom: 16px;
                    border: 1px solid var(--border);
                }
                .mtf-consensus.buy { background: var(--buy-bg); border-color: var(--buy); color: var(--buy); }
                .mtf-consensus.sell { background: var(--sell-bg); border-color: var(--sell); color: var(--sell); }
                .mtf-consensus.neutral, .mtf-consensus.hold { background: rgba(255,255,255,0.05); color: var(--gold); border-color: var(--gold); }
                
                .mtf-consensus-label { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; opacity: 0.8; }
                .mtf-consensus-value { font-size: 18px; font-weight: 800; margin: 4px 0; }
                .mtf-consensus-score { font-size: 11px; opacity: 0.7; }

                .mtf-row {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1.5fr 1fr;
                    gap: 8px;
                    align-items: center;
                    padding: 8px 0;
                    border-bottom: 1px solid var(--border);
                    font-size: 13px;
                }
                .mtf-row:last-child {
                    border-bottom: none;
                }
                .mtf-header {
                    color: var(--text-secondary);
                    font-weight: 600;
                    font-size: 11px;
                    border-bottom: 1px solid var(--border);
                    padding-bottom: 4px;
                    margin-bottom: 4px;
                }
                .tf-badge {
                    background: var(--bg-tertiary);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: var(--font-mono);
                    font-weight: bold;
                    text-align: center;
                    font-size: 11px;
                }
                .signal-badge {
                    font-weight: 800;
                    text-align: right;
                }
                .signal-badge.buy { color: var(--buy); }
                .signal-badge.sell { color: var(--sell); }
                .signal-badge.neutral, .signal-badge.hold { color: var(--gold); }

                .mtf-panel.compact {
                    padding: 2px;
                }
                .mtf-panel.compact .mtf-consensus {
                    padding: 6px 7px;
                    margin-bottom: 6px;
                    border-radius: 6px;
                }
                .mtf-panel.compact .mtf-consensus-label {
                    font-size: 8px;
                }
                .mtf-panel.compact .mtf-consensus-value {
                    font-size: 12px;
                    margin: 2px 0;
                    line-height: 1.2;
                }
                .mtf-panel.compact .mtf-consensus-score {
                    font-size: 9px;
                    line-height: 1.2;
                }
                .mtf-panel.compact .mtf-row {
                    grid-template-columns: 0.72fr 0.72fr 1.35fr 0.95fr;
                    gap: 6px;
                    padding: 5px 0;
                    font-size: 10px;
                }
                .mtf-panel.compact .mtf-header {
                    font-size: 8.5px;
                    padding-bottom: 2px;
                    margin-bottom: 2px;
                }
                .mtf-panel.compact .tf-badge {
                    font-size: 9px;
                    padding: 1px 4px;
                }
            `}</style>
        </div>
    );
}
