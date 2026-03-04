import React, { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&outputsize=1000`);
    const data = await res.json();
    return data.data || [];
};

type CompositeScorePanelProps = {
    compact?: boolean;
};

export default function CompositeScorePanel({ compact = false }: CompositeScorePanelProps) {
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

    const normalizedScore = Math.max(0, Math.min(100, score));
    const scoreColor = normalizedScore > 55 ? 'var(--buy)' : normalizedScore < 45 ? 'var(--sell)' : 'var(--gold)';
    const trendScore = Math.max(0, Math.min(100, 50 + ((indicators.proCombo?.blocks?.trend?.score ?? 0) * 3)));
    const momentumScore = Math.max(0, Math.min(100, 50 + ((indicators.proCombo?.blocks?.momentum?.score ?? 0) * 3)));
    const structureScore = Math.max(0, Math.min(100, 50 + ((indicators.proCombo?.blocks?.structure?.score ?? 0) * 3)));

    // 3D semicircle gauge geometry
    const cx = 98;
    const cy = 110;
    const radius = 78;
    const gaugePath = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
    const arcLength = Math.PI * radius;
    const strokeOffset = arcLength - ((normalizedScore / 100) * arcLength);

    // Needle from left (0) to right (100) across the top arc.
    const angleDeg = 180 - (normalizedScore * 1.8);
    const angleRad = (angleDeg * Math.PI) / 180;
    const needleLen = 56;
    const needleX = cx + (needleLen * Math.cos(angleRad));
    const needleY = cy - (needleLen * Math.sin(angleRad));

    return (
        <div className={`composite-score-panel ${compact ? 'compact' : ''}`}>
            <div className="composite-score-gauge-wrap">
                <svg viewBox="0 0 196 136" className="composite-score-gauge-svg" role="img" aria-label="Composite confidence 3D gauge">
                    <defs>
                        <linearGradient id="compositeTrack3d" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
                            <stop offset="45%" stopColor="rgba(255,255,255,0.08)" />
                            <stop offset="100%" stopColor="rgba(255,255,255,0.22)" />
                        </linearGradient>
                        <radialGradient id="compositeCore3d" cx="48%" cy="38%" r="66%">
                            <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
                            <stop offset="100%" stopColor="rgba(0,0,0,0.26)" />
                        </radialGradient>
                    </defs>

                    <path d={gaugePath} className="composite-gauge-track-shadow" />
                    <path d={gaugePath} className="composite-gauge-track" />
                    <path d={gaugePath} className="composite-gauge-track-sheen" />
                    <path
                        d={gaugePath}
                        className="composite-gauge-progress"
                        stroke={scoreColor}
                        strokeDasharray={arcLength}
                        strokeDashoffset={strokeOffset}
                    />
                    <path
                        d={gaugePath}
                        className="composite-gauge-progress-glow"
                        stroke={scoreColor}
                        strokeDasharray={arcLength}
                        strokeDashoffset={strokeOffset}
                    />

                    <line x1={cx} y1={cy} x2={needleX} y2={needleY} className="composite-gauge-needle" style={{ stroke: scoreColor }} />
                    <circle cx={cx} cy={cy} r="11" className="composite-gauge-hub" />
                    <circle cx={cx} cy={cy} r="9" fill="url(#compositeCore3d)" />
                    <circle cx={cx} cy={cy} r="3" style={{ fill: scoreColor }} />

                    <text x={cx} y="80" textAnchor="middle" className="composite-score-value">{normalizedScore}</text>
                    <text x={cx} y="94" textAnchor="middle" className="composite-score-label">COMPOSITE</text>
                    <text x="20" y="124" className="composite-gauge-side sell">SELL</text>
                    <text x="176" y="124" textAnchor="end" className="composite-gauge-side buy">BUY</text>
                </svg>
            </div>

            <div className="composite-score-state" style={{ color: scoreColor }}>
                {score >= 75 ? 'FORTEMENT HAUSSIER' : score >= 60 ? 'HAUSSIER' : score <= 25 ? 'FORTEMENT BAISSIER' : score <= 40 ? 'BAISSIER' : 'NEUTRE'}
            </div>

            <div className="composite-score-legend">
                <div className="composite-score-legend-item">
                    <span className="composite-score-dot" style={{ background: scoreColor }} />
                    <span>Global</span>
                    <strong>{Math.round(normalizedScore)}%</strong>
                </div>
                <div className="composite-score-legend-item">
                    <span className="composite-score-dot" style={{ background: 'var(--buy)' }} />
                    <span>Trend</span>
                    <strong>{Math.round(trendScore)}%</strong>
                </div>
                <div className="composite-score-legend-item">
                    <span className="composite-score-dot" style={{ background: 'var(--gold)' }} />
                    <span>Momentum</span>
                    <strong>{Math.round(momentumScore)}%</strong>
                </div>
                <div className="composite-score-legend-item">
                    <span className="composite-score-dot" style={{ background: 'var(--accent)' }} />
                    <span>Structure</span>
                    <strong>{Math.round(structureScore)}%</strong>
                </div>
            </div>

            {indicators.proCombo && (
                <div className="composite-score-summary">
                    {(indicators.proCombo.summary || []).slice(0, compact ? 1 : 3).map((line: string, idx: number) => (
                        <div key={idx}>{line}</div>
                    ))}
                </div>
            )}
        </div>
    );
}
