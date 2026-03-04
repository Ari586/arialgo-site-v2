import React from 'react';
import { formatSymbolPrice } from '../utils/priceFormat';
import { TradeVerdict } from '../utils/tradeVerdict';

type TradeActionCardProps = {
    title: string;
    modelLabel: string;
    symbol: string;
    verdict: TradeVerdict;
};

function getTone(signal: TradeVerdict['signal']) {
    if (signal === 'BUY') {
        return {
            border: 'rgba(46, 230, 166, 0.42)',
            chipBg: 'rgba(46, 230, 166, 0.16)',
            chipFg: 'var(--buy)'
        };
    }
    if (signal === 'SELL') {
        return {
            border: 'rgba(255, 90, 122, 0.42)',
            chipBg: 'rgba(255, 90, 122, 0.16)',
            chipFg: 'var(--sell)'
        };
    }
    return {
        border: 'rgba(247, 199, 92, 0.42)',
        chipBg: 'rgba(247, 199, 92, 0.16)',
        chipFg: 'var(--gold)'
    };
}

export default function TradeActionCard({ title, modelLabel, symbol, verdict }: TradeActionCardProps) {
    const tone = getTone(verdict.signal);

    return (
        <section
            style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${tone.border}`,
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '12px',
                boxShadow: 'var(--glow-soft)'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-main)' }}>{title}</h3>
                    <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '12px' }}>{modelLabel}</p>
                </div>
                <div
                    style={{
                        background: tone.chipBg,
                        border: `1px solid ${tone.border}`,
                        color: tone.chipFg,
                        borderRadius: '999px',
                        padding: '6px 12px',
                        fontWeight: 800,
                        fontSize: '12px',
                        letterSpacing: '0.6px'
                    }}
                >
                    {verdict.signal} · {verdict.confidence}%
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', marginBottom: '10px' }}>
                <Metric label="Entry" value={formatSymbolPrice(symbol, verdict.entry)} />
                <Metric label="Stop Loss" value={formatSymbolPrice(symbol, verdict.stopLoss)} />
                <Metric label="Take Profit" value={formatSymbolPrice(symbol, verdict.takeProfit)} />
                <Metric label="R:R" value={verdict.rr.toFixed(2)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: '12px', marginBottom: verdict.reasons.length ? '8px' : 0 }}>
                <span>Horizon estimé: <strong style={{ color: 'var(--text-main)' }}>{verdict.horizon}</strong></span>
                <span style={{ maxWidth: '100%' }}>{verdict.invalidation}</span>
            </div>

            {verdict.reasons.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {verdict.reasons.map((reason) => (
                        <span
                            key={reason}
                            style={{
                                fontSize: '11px',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border)',
                                borderRadius: '999px',
                                padding: '4px 8px',
                                background: 'var(--bg-tertiary)'
                            }}
                        >
                            {reason}
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div
            style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px'
            }}
        >
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--text-main)', fontWeight: 700 }}>{value}</div>
        </div>
    );
}
