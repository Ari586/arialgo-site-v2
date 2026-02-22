import React, { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

export default function CompositeScorePanel() {
    const currentSymbol = useMarketStore(state => state.currentSymbol);
    const currentTimeframe = useMarketStore(state => state.currentTimeframe);
    const livePrice = useMarketStore(state => state.prices[currentSymbol]);
    const [score, setScore] = useState(0);

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

    useEffect(() => {
        if (indicators) {
            // Prefer the pro combo score if available, fallback to legacy trend score.
            if (indicators.proCombo?.score !== undefined && indicators.proCombo?.score !== null) {
                setScore(indicators.proCombo.score);
            } else if (indicators.trend) {
                setScore(indicators.trend.bullishPct);
            }
        }
    }, [indicators]);

    if (!indicators) {
        return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>Calcul du score...</div>;
    }

    // SVG Gauge math
    const radius = 80;
    const circumference = Math.PI * radius; // Half circle
    // value goes from 0 (100% sell) to 100 (100% buy)
    const normalizedScore = Math.max(0, Math.min(100, score));
    const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;

    return (
        <div style={{ padding: '0 8px', textAlign: 'center' }}>
            <div style={{ position: 'relative', width: '200px', margin: '0 auto', height: '120px' }}>
                <svg viewBox="0 0 200 120" style={{ width: '100%', height: '100%' }}>
                    <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1e222d" strokeWidth="16" strokeLinecap="round" />
                    <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGradient)" strokeWidth="16" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
                    <defs>
                        <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#ff5252" />
                            <stop offset="50%" stopColor="#787b86" />
                            <stop offset="100%" stopColor="#00e676" />
                        </linearGradient>
                    </defs>
                    <text x="100" y="85" textAnchor="middle" style={{ fontSize: '36px', fontWeight: 900, fill: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{score}</text>

                    <text x="20" y="115" textAnchor="start" style={{ fontSize: '11px', fontWeight: 'bold', fill: 'var(--sell)' }}>VENTE</text>
                    <text x="180" y="115" textAnchor="end" style={{ fontSize: '11px', fontWeight: 'bold', fill: 'var(--buy)' }}>ACHAT</text>
                </svg>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: score > 55 ? 'var(--buy)' : score < 45 ? 'var(--sell)' : 'var(--gold)' }}>
                {score >= 75 ? 'FORTEMENT HAUSSIER' : score >= 60 ? 'HAUSSIER' : score <= 25 ? 'FORTEMENT BAISSIER' : score <= 40 ? 'BAISSIER' : 'NEUTRE'}
            </div>
            {indicators.proCombo && (
                <div style={{ marginTop: '10px', textAlign: 'left', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 10px' }}>
                    {(indicators.proCombo.summary || []).slice(0, 3).map((line: string, idx: number) => (
                        <div key={idx}>{line}</div>
                    ))}
                </div>
            )}
        </div>
    );
}
