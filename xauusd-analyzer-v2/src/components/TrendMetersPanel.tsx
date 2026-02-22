import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

export default function TrendMetersPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });

    const indicators = useMemo(() => {
        if (!history || history.length < 30) return null;
        const candles = [...history];
        if (livePrice) {
            const last = { ...candles[candles.length - 1] };
            last.close = livePrice;
            last.high = Math.max(last.high, livePrice);
            last.low = Math.min(last.low, livePrice);
            candles[candles.length - 1] = last;
        }
        return calculateAllIndicators(candles);
    }, [history, livePrice]);

    if (!indicators) return null;

    const trend = indicators.trend;
    const proCombo = indicators.proCombo;
    const comboBlocks = proCombo?.blocks ? [
        { key: 'trend', label: 'Trend', data: proCombo.blocks.trend },
        { key: 'momentum', label: 'Momentum', data: proCombo.blocks.momentum },
        { key: 'volume', label: 'Volume', data: proCombo.blocks.volume },
        { key: 'volatility', label: 'Volatility', data: proCombo.blocks.volatility },
        { key: 'structure', label: 'Structure', data: proCombo.blocks.structure },
        { key: 'confirmation', label: 'MTF', data: proCombo.blocks.confirmation }
    ] : [];

    return (
        <div className="trend-panel" style={{ display: 'flex', gap: '16px', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ flex: 1, textAlign: 'center', padding: '12px', background: 'var(--buy-bg)', borderRadius: '8px', border: '1px solid var(--buy)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--buy)', fontWeight: 'bold', marginBottom: '4px' }}>ACHAT</div>
                    <div style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-main)' }}>{trend.bullishPct}%</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{trend.bullishCount} Signaux</div>
                </div>
                <div style={{ width: '16px' }} />
                <div style={{ flex: 1, textAlign: 'center', padding: '12px', background: 'var(--sell-bg)', borderRadius: '8px', border: '1px solid var(--sell)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--sell)', fontWeight: 'bold', marginBottom: '4px' }}>VENTE</div>
                    <div style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-main)' }}>{trend.bearishPct}%</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{trend.bearishCount} Signaux</div>
                </div>
            </div>

            {proCombo && (
                <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>COMBO PRO CONFLUENCE :</div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: proCombo.signal === 'BUY' ? 'var(--buy)' : proCombo.signal === 'SELL' ? 'var(--sell)' : 'var(--gold)' }}>
                            {proCombo.signal} {proCombo.score}
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        {comboBlocks.map((block: any) => (
                            <div key={block.key} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', background: 'rgba(255,255,255,0.02)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontWeight: 'bold' }}>{block.label}</span>
                                    <span style={{ color: block.data.signal === 'BUY' ? 'var(--buy)' : block.data.signal === 'SELL' ? 'var(--sell)' : 'var(--gold)', fontWeight: 'bold' }}>
                                        {block.data.signal}
                                    </span>
                                </div>
                                <div style={{ fontSize: '15px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{block.data.score}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '8px' }}>FACTEURS CLÉS :</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {trend.reasons.slice(0, 5).map((reason: string, i: number) => (
                        <div key={i} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: reason.includes('↑') ? 'var(--buy)' : 'var(--sell)' }}>
                                {reason.includes('↑') ? '↗' : '↘'}
                            </span>
                            {reason.replace('↑', '').replace('↓', '')}
                        </div>
                    ))}
                    {trend.reasons.length > 5 && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                            + {trend.reasons.length - 5} autres facteurs
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
