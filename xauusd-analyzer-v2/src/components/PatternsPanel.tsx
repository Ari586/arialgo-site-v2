import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

export default function PatternsPanel() {
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

    const patterns = indicators.patterns || [];
    const recentOrderBlocks = (indicators.orderBlocks || []).slice(-2).reverse();
    const recentFvgs = (indicators.fvgs || []).slice(-2).reverse();
    const fib = indicators.fibonacci;

    const structureItems: Array<{ label: string; value: string; tone: 'bullish' | 'bearish' | 'neutral' }> = [];
    recentOrderBlocks.forEach((ob: any, idx: number) => {
        structureItems.push({
            label: `Order Block ${idx + 1}`,
            value: `${ob.type} ${ob.low.toFixed(2)} - ${ob.high.toFixed(2)}`,
            tone: ob.type === 'BULLISH' ? 'bullish' : 'bearish'
        });
    });
    recentFvgs.forEach((gap: any, idx: number) => {
        structureItems.push({
            label: `FVG ${idx + 1}`,
            value: `${gap.type} ${gap.low.toFixed(2)} - ${gap.high.toFixed(2)}`,
            tone: gap.type === 'BULLISH' ? 'bullish' : 'bearish'
        });
    });
    if (fib) {
        structureItems.push({
            label: 'Fibonacci',
            value: `${fib.trend} | nearest ${fib.nearestLevel || 'n/a'} @ ${fib.nearestPrice || 'n/a'}${fib.inGoldenPocket ? ' | GOLDEN POCKET' : ''}`,
            tone: fib.trend === 'UP' ? 'bullish' : fib.trend === 'DOWN' ? 'bearish' : 'neutral'
        });
    }

    return (
        <div style={{ padding: '4px' }}>
            {patterns.length === 0 && structureItems.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '16px', fontSize: '13px', fontStyle: 'italic' }}>
                    Aucun pattern détecté ({currentTimeframe})
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {patterns.length > 0 && patterns.map((p: any, i: number) => (
                        <div key={`p-${i}`} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            background: p.type === 'bullish' ? 'var(--buy-bg)' : p.type === 'bearish' ? 'var(--sell-bg)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${p.type === 'bullish' ? 'rgba(0,230,118,0.3)' : p.type === 'bearish' ? 'rgba(255,82,82,0.3)' : 'var(--border)'}`,
                            padding: '12px 16px',
                            borderRadius: '8px'
                        }}>
                            <span style={{ fontSize: '24px' }}>{p.emoji}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--text-main)' }}>{p.name}</div>
                                <div style={{ fontSize: '11px', color: p.type === 'bullish' ? 'var(--buy)' : p.type === 'bearish' ? 'var(--sell)' : 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                                    {p.type === 'bullish' ? 'HAUSSIER' : p.type === 'bearish' ? 'BAISSIER' : 'NEUTRE'}
                                </div>
                            </div>
                        </div>
                    ))}

                    {structureItems.length > 0 && (
                        <div style={{ marginTop: '6px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 'bold', marginBottom: '6px' }}>STRUCTURE (OB / FVG / FIB)</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {structureItems.map((item, idx) => (
                                    <div key={`s-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                                        <span style={{ color: item.tone === 'bullish' ? 'var(--buy)' : item.tone === 'bearish' ? 'var(--sell)' : 'var(--text-main)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                            {item.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
