import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

export default function MarketInfoPanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);
    const orderbook = useMarketStore(state => state.orderbook);

    const { data: history } = useQuery({
        queryKey: ['history', currentSymbol, currentTimeframe],
        queryFn: () => fetchHistory(currentSymbol, currentTimeframe),
        staleTime: 60000,
    });

    const vwap = useMemo(() => {
        if (!history || history.length < 30) return null;
        const indicators = calculateAllIndicators(history); // ignoring live tick for daily vwap
        return indicators?.vwap;
    }, [history]);

    const bid = orderbook && orderbook.bids.length > 0 ? orderbook.bids[0].price : livePrice;
    const ask = orderbook && orderbook.asks.length > 0 ? orderbook.asks[0].price : livePrice;
    const spread = (ask && bid) ? (ask - bid) : 0;

    let dayHigh = livePrice, dayLow = livePrice;
    if (history && history.length > 0) {
        // approximate day high/low from history if needed, or simply the last known candle's high/low
        dayHigh = Math.max(...history.slice(-96).map((c: any) => c.high), livePrice || 0);
        dayLow = Math.min(...history.slice(-96).map((c: any) => c.low), livePrice || dayHigh);
    }

    return (
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Bid</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{bid?.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Ask</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{ask?.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Spread</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--gold)' }}>{spread?.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Day High</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{dayHigh?.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Day Low</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>{dayLow?.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>VWAP</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--buy)' }}>{vwap ? vwap.toFixed(2) : '—'}</span>
            </div>
        </div>
    );
}
