import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';
import { formatSymbolPrice } from '../utils/priceFormat';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=1000`);
    const data = await res.json();
    return data.data || [];
};

export default function PivotPointsPanel() {
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

    if (!indicators || !indicators.pivotPoints) return null;

    const pp = indicators.pivotPoints;
    const formatPx = (value?: number | null) => formatSymbolPrice(currentSymbol, value);

    return (
        <div style={{ padding: '0 4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'min-content 1fr', gap: '8px', alignItems: 'center', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                {/* Resistances */}
                <span style={{ color: 'var(--sell)', fontWeight: 'bold' }}>R3</span>
                <span style={{ textAlign: 'right', color: 'var(--text-main)' }}>{formatPx(pp.r3)}</span>

                <span style={{ color: 'var(--sell)', fontWeight: 'bold' }}>R2</span>
                <span style={{ textAlign: 'right', color: 'var(--text-main)' }}>{formatPx(pp.r2)}</span>

                <span style={{ color: 'var(--sell)', fontWeight: 'bold' }}>R1</span>
                <span style={{ textAlign: 'right', color: 'var(--text-main)' }}>{formatPx(pp.r1)}</span>

                {/* Pivot */}
                <span style={{ color: 'var(--gold)', fontWeight: 'bold', marginTop: '4px', marginBottom: '4px' }}>P</span>
                <span style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 'bold', marginTop: '4px', marginBottom: '4px' }}>{formatPx(pp.pivot)}</span>

                {/* Supports */}
                <span style={{ color: 'var(--buy)', fontWeight: 'bold' }}>S1</span>
                <span style={{ textAlign: 'right', color: 'var(--text-main)' }}>{formatPx(pp.s1)}</span>

                <span style={{ color: 'var(--buy)', fontWeight: 'bold' }}>S2</span>
                <span style={{ textAlign: 'right', color: 'var(--text-main)' }}>{formatPx(pp.s2)}</span>

                <span style={{ color: 'var(--buy)', fontWeight: 'bold' }}>S3</span>
                <span style={{ textAlign: 'right', color: 'var(--text-main)' }}>{formatPx(pp.s3)}</span>
            </div>
        </div>
    );
}
