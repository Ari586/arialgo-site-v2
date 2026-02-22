import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '../store/marketStore';
import { calculateAllIndicators } from '../utils/indicators';

const fetchHistory = async (symbol: string, timeframe: string) => {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
    const data = await res.json();
    return data.data || [];
};

export default function IndicatorsPanel() {
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

    if (!indicators) {
        return <div className="p-4" style={{ color: 'var(--text-secondary)' }}>Calcul des indicateurs...</div>;
    }

    const {
        rsi, macdLine, macdSignal,
        ema9, ema21, ema50, ema200, bbUpper, bbLower,
        atr, stochastic, adx, williamsR, cci, mfi, vwap,
        ichimoku, rsiDivergence, stochRsi, obv, cvd, volumeProfile, bbSqueeze, fibonacci, mtfConfluence
    } = indicators;

    const indItems = [
        { label: 'RSI (14)', value: rsi?.toFixed(2) || '---', signal: (rsi && rsi > 70) ? 'SURACHAT' : (rsi && rsi < 30) ? 'SURVENTE' : 'NEUTRE', color: (rsi && rsi > 70) ? 'var(--sell)' : (rsi && rsi < 30) ? 'var(--buy)' : 'var(--text-main)', fill: rsi || 50 },
        { label: 'MACD', value: (macdLine !== null && macdSignal !== null) ? `${macdLine.toFixed(2)} | ${macdSignal.toFixed(2)}` : '---', signal: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 'ACHAT' : 'VENTE') : 'NEUTRE', color: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (macdLine !== null && macdSignal !== null) ? (macdLine > macdSignal ? 70 : 30) : 50 },
        { label: 'EMA 9 / 21', value: (ema9 !== null && ema21 !== null) ? `${ema9.toFixed(2)} / ${ema21.toFixed(2)}` : '---', signal: (ema9 !== null && ema21 !== null) ? (ema9 > ema21 ? 'ACHAT' : 'VENTE') : 'NEUTRE', color: (ema9 !== null && ema21 !== null) ? (ema9 > ema21 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (ema9 !== null && ema21 !== null) ? (ema9 > ema21 ? 75 : 25) : 50 },
        { label: 'EMA 50 / 200', value: (ema50 !== null && ema200 !== null) ? `${ema50.toFixed(2)} / ${ema200.toFixed(2)}` : '---', signal: (ema50 !== null && ema200 !== null) ? (ema50 > ema200 ? 'ACHAT' : 'VENTE') : 'NEUTRE', color: (ema50 !== null && ema200 !== null) ? (ema50 > ema200 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (ema50 !== null && ema200 !== null) ? (ema50 > ema200 ? 80 : 20) : 50 },
        { label: 'Bollinger', value: (bbLower !== null && bbUpper !== null) ? `${bbLower.toFixed(2)} - ${bbUpper.toFixed(2)}` : '---', signal: (bbUpper !== null && bbLower !== null) ? (livePrice > bbUpper ? 'SURACHAT' : livePrice < bbLower ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (bbUpper !== null && bbLower !== null) ? (livePrice > bbUpper ? 'var(--sell)' : livePrice < bbLower ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: (bbUpper !== null && bbLower !== null && bbUpper !== bbLower) ? ((livePrice - bbLower) / (bbUpper - bbLower)) * 100 : 50 },
        { label: 'ATR (14)', value: atr?.toFixed(2) || '---', signal: 'VOLATILITÉ', color: 'var(--gold)', fill: atr ? Math.min((atr / 30) * 100, 100) : 50 },
        { label: 'Stochastic', value: stochastic?.k?.toFixed(2) || '---', signal: (stochastic?.k !== undefined) ? (stochastic.k > 80 ? 'SURACHAT' : stochastic.k < 20 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (stochastic?.k !== undefined) ? (stochastic.k > 80 ? 'var(--sell)' : stochastic.k < 20 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: stochastic?.k || 50 },
        { label: 'ADX', value: adx?.adx?.toFixed(2) || '---', signal: adx?.trendStrength || 'NEUTRE', color: (adx?.adx !== undefined && adx.adx > 25) ? 'var(--buy)' : 'var(--text-secondary)', fill: adx?.adx || 0 },
        { label: 'Williams %R', value: williamsR?.toFixed(2) || '---', signal: (williamsR !== null) ? (williamsR > -20 ? 'SURACHAT' : williamsR < -80 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (williamsR !== null) ? (williamsR > -20 ? 'var(--sell)' : williamsR < -80 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: 100 + (williamsR || -50) },
        { label: 'CCI (20)', value: cci?.toFixed(2) || '---', signal: (cci !== null) ? (cci > 100 ? 'SURACHAT' : cci < -100 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (cci !== null) ? (cci > 100 ? 'var(--sell)' : cci < -100 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: cci ? Math.min(Math.max((cci + 200) / 4, 0), 100) : 50 },
        { label: 'MFI (14)', value: mfi?.toFixed(2) || '---', signal: (mfi !== null) ? (mfi > 80 ? 'SURACHAT' : mfi < 20 ? 'SURVENTE' : 'NEUTRE') : 'NEUTRE', color: (mfi !== null) ? (mfi > 80 ? 'var(--sell)' : mfi < 20 ? 'var(--buy)' : 'var(--text-main)') : 'var(--text-secondary)', fill: mfi || 50 },
        { label: 'VWAP', value: vwap?.toFixed(2) || '---', signal: (vwap !== null) ? (livePrice > vwap ? 'HAUSSIER' : 'BAISSIER') : 'NEUTRE', color: (vwap !== null) ? (livePrice > vwap ? 'var(--buy)' : 'var(--sell)') : 'var(--text-secondary)', fill: (vwap !== null && livePrice > vwap) ? 75 : 25 },
        { label: 'Ichimoku', value: ichimoku ? `${ichimoku.tenkan?.toFixed(2)} / ${ichimoku.kijun?.toFixed(2)}` : '---', signal: ichimoku?.signal || 'NEUTRE', color: ichimoku?.signal === 'BULLISH' ? 'var(--buy)' : ichimoku?.signal === 'BEARISH' ? 'var(--sell)' : 'var(--gold)', fill: ichimoku?.strength || 50 },
        { label: 'RSI Divergence', value: rsiDivergence?.signal || 'NONE', signal: rsiDivergence?.details || 'Aucune divergence', color: rsiDivergence?.signal === 'BULLISH' ? 'var(--buy)' : rsiDivergence?.signal === 'BEARISH' ? 'var(--sell)' : 'var(--text-secondary)', fill: rsiDivergence?.signal === 'BULLISH' ? (50 + (rsiDivergence?.strength || 0) / 2) : rsiDivergence?.signal === 'BEARISH' ? (50 - (rsiDivergence?.strength || 0) / 2) : 50 },
        { label: 'Stoch RSI', value: stochRsi ? `${stochRsi.k.toFixed(2)} / ${stochRsi.d.toFixed(2)}` : '---', signal: stochRsi?.signal || 'NEUTRE', color: stochRsi?.signal === 'BULLISH' || stochRsi?.signal === 'OVERSOLD' ? 'var(--buy)' : stochRsi?.signal === 'BEARISH' || stochRsi?.signal === 'OVERBOUGHT' ? 'var(--sell)' : 'var(--text-secondary)', fill: stochRsi?.k || 50 },
        { label: 'OBV', value: obv ? obv.value.toLocaleString() : '---', signal: obv?.trend || 'FLAT', color: obv?.trend === 'UP' ? 'var(--buy)' : obv?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)', fill: obv ? Math.max(0, Math.min(100, 50 + obv.slope)) : 50 },
        { label: 'CVD', value: cvd ? cvd.value.toLocaleString() : '---', signal: cvd?.trend || 'FLAT', color: cvd?.trend === 'UP' ? 'var(--buy)' : cvd?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)', fill: cvd ? Math.max(0, Math.min(100, 50 + cvd.slope)) : 50 },
        { label: 'Volume Profile', value: volumeProfile ? `POC ${volumeProfile.poc.toFixed(2)}` : '---', signal: volumeProfile?.skew || 'NEUTRE', color: volumeProfile?.skew === 'BUY' ? 'var(--buy)' : volumeProfile?.skew === 'SELL' ? 'var(--sell)' : 'var(--text-secondary)', fill: volumeProfile?.abovePoc ? 65 : 35 },
        { label: 'BB Squeeze', value: bbSqueeze ? `${bbSqueeze.state} (${bbSqueeze.intensity.toFixed(1)}%)` : '---', signal: bbSqueeze?.isSqueezing ? 'COMPRESSION' : 'EXPANSION', color: bbSqueeze?.isSqueezing ? 'var(--gold)' : 'var(--text-main)', fill: bbSqueeze?.isSqueezing ? 20 : 70 },
        { label: 'Fibonacci', value: fibonacci ? `${fibonacci.nearestLevel || 'n/a'} @ ${fibonacci.nearestPrice || 'n/a'}` : '---', signal: fibonacci ? `${fibonacci.trend}${fibonacci.inGoldenPocket ? ' | GP' : ''}` : 'NEUTRE', color: fibonacci?.trend === 'UP' ? 'var(--buy)' : fibonacci?.trend === 'DOWN' ? 'var(--sell)' : 'var(--text-secondary)', fill: fibonacci?.trend === 'UP' ? 70 : fibonacci?.trend === 'DOWN' ? 30 : 50 },
        { label: 'MTF Confluence', value: mtfConfluence ? `${mtfConfluence.signal} ${mtfConfluence.strength}%` : '---', signal: mtfConfluence ? `${mtfConfluence.bullish}/${mtfConfluence.bearish}/${mtfConfluence.neutral}` : 'n/a', color: mtfConfluence?.signal === 'BUY' ? 'var(--buy)' : mtfConfluence?.signal === 'SELL' ? 'var(--sell)' : 'var(--gold)', fill: mtfConfluence ? (mtfConfluence.signal === 'SELL' ? 100 - mtfConfluence.strength : mtfConfluence.strength) : 50 },
    ];

    return (
        <div className="indicators-grid-list">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {indItems.map((ind, i) => (
                    <div key={i} style={{
                        background: 'var(--bg-tertiary)',
                        padding: '10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>{ind.label}</div>
                        <div style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: ind.color, marginBottom: '6px' }}>{ind.value}</div>
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden', marginBottom: '8px' }}>
                            <div style={{ width: `${Math.max(0, Math.min(100, ind.fill))}%`, height: '100%', background: ind.color, transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ fontSize: '9px', fontWeight: 'bold', letterSpacing: '0.5px', color: ind.color, background: 'rgba(255,255,255,0.05)', display: 'inline-block', padding: '2px 4px', borderRadius: '4px', width: 'fit-content' }}>
                            {ind.signal}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
