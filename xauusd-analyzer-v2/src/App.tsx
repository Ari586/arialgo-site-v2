import React from 'react';
import { useMarketStore } from './store/marketStore';
import { useWebSocket } from './hooks/useWebSocket';

import Chart from './components/Chart';
import IndicatorsPanel from './components/IndicatorsPanel';
import MultiTFPanel from './components/MultiTFPanel';
import AISignalPanel from './components/AISignalPanel';
import NewsPanel from './components/NewsPanel';
import TrendMetersPanel from './components/TrendMetersPanel';
import PatternsPanel from './components/PatternsPanel';
import CompositeScorePanel from './components/CompositeScorePanel';
import PivotPointsPanel from './components/PivotPointsPanel';
import MarketInfoPanel from './components/MarketInfoPanel';
import SignalHistoryPanel from './components/SignalHistoryPanel';
import MT5ExecutionPanel from './components/MT5ExecutionPanel';
import { isSymbolMarketClosed, getMarketClosedReason } from './utils/marketHours';

function App() {
    const wsStatus = useWebSocket();
    const currentSymbol = useMarketStore((state) => state.currentSymbol);
    const prices = useMarketStore((state) => state.prices);
    const setSymbol = useMarketStore((state) => state.setSymbol);

    const price = prices[currentSymbol] || 0;
    const xauClosed = isSymbolMarketClosed('XAU/USD');

    React.useEffect(() => {
        if (currentSymbol === 'XAU/USD' && xauClosed) {
            setSymbol('BTC/USD');
        }
    }, [currentSymbol, xauClosed, setSymbol]);

    React.useEffect(() => {
        const payload = {
            source: 'frontend',
            path: `${window.location.pathname}${window.location.search}`,
            note: 'app-mounted',
        };

        fetch('/api/track-open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => {
            // Intentionally silent: tracking must not block UI.
        });
    }, []);

    return (
        <div className="app-container">
            {/* HEADER */}
            <header className="top-bar">
                <div className="logo">
                    <span style={{ fontSize: '20px' }}>⚡</span> ARI<span className="gold"> TRADING BOT</span>
                </div>

                <div className="instrument-selector">
                    {[
                        { sym: 'XAU/USD', icon: '🥇', name: 'Gold (Kraken)' },
                        { sym: 'BTC/USD', icon: '₿', name: 'Bitcoin (Binance)' },
                        { sym: 'ETH/USD', icon: 'Ξ', name: 'Ethereum (Binance)' }
                    ].map(({ sym, icon, name }) => {
                        const isClosed = isSymbolMarketClosed(sym);
                        return (
                        <button
                            key={sym}
                            className={`inst-btn ${currentSymbol === sym ? 'active' : ''}`}
                            onClick={() => setSymbol(sym)}
                            title={isClosed ? getMarketClosedReason(sym) : `Trade ${name}`}
                            disabled={isClosed}
                            style={isClosed ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                        >
                            <span style={{ marginRight: '6px' }}>{icon}</span>
                            {sym}{isClosed ? ' (Fermé)' : ''}
                        </button>
                    );
                    })}
                </div>

                <div className="price-ticker" style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                        Source: <span style={{ color: 'var(--text-main)' }}>{currentSymbol === 'XAU/USD' ? 'Kraken' : 'Binance'}</span>
                    </span>
                    <span className="ticker-price">${price ? price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</span>
                </div>

                <div className="status-badge" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`status-dot ${wsStatus}`}></span>
                        <span style={{ fontWeight: 800 }}>{wsStatus === 'connected' ? 'LIVE' : 'CONNECTING...'}</span>
                    </div>
                    {xauClosed && (
                        <span style={{ fontSize: '9px', color: 'var(--gold)', paddingRight: '2px' }}>XAU fermé week-end</span>
                    )}
                    {wsStatus === 'connected' && (
                        <span style={{ fontSize: '9px', color: 'var(--text-secondary)', paddingRight: '2px' }}>mises à jour par seconde</span>
                    )}
                </div>
            </header>

            {/* DASHBOARD LAYOUT */}
            <main className="dashboard">
                {/* LEFT COLUMN: Chart + Main Analysis */}
                <section className="col-main" style={{ overflowY: 'auto' }}>
                    {/* Top: Chart */}
                    <div className="card chart-card" style={{ minHeight: '400px', flex: '0 0 auto' }}>
                        <Chart />
                    </div>

                    {/* Middle: Trend & Patterns */}
                    <div className="bottom-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                        <div className="card half-card">
                            <h2 className="card-title">📊 Tendance Générale</h2>
                            <TrendMetersPanel />
                        </div>
                        <div className="card half-card">
                            <h2 className="card-title">🕯️ Patterns Détectés</h2>
                            <PatternsPanel />
                        </div>
                    </div>

                    {/* Bottom: Multi-TF & News */}
                    <div className="bottom-row" style={{ minHeight: 'auto', flex: '0 0 auto' }}>
                        <div className="card half-card">
                            <h2 className="card-title">🕒 Analyse Multi-Timeframe</h2>
                            <MultiTFPanel />
                        </div>
                        <div className="card half-card">
                            <h2 className="card-title">📰 Actualités du Marché</h2>
                            <NewsPanel />
                        </div>
                    </div>
                </section>

                {/* RIGHT COLUMN: Scrollers (AI Signal, Score, Indicators, etc) */}
                <aside className="col-side panels">
                    <div className="card">
                        <h2 className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>🤖 Signal IA</span>
                            <span style={{ fontSize: '10px', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', letterSpacing: '1px' }}>OLLAMA LLaMA3</span>
                        </h2>
                        <AISignalPanel />
                    </div>

                    <div className="card">
                        <h2 className="card-title">🧾 Exécution MT5</h2>
                        <MT5ExecutionPanel />
                    </div>

                    <div className="card" style={{ paddingBottom: '0' }}>
                        <h2 className="card-title">🎯 Score Composite</h2>
                        <CompositeScorePanel />
                    </div>

                    <div className="card">
                        <h2 className="card-title">📈 Tous les Indicateurs</h2>
                        <IndicatorsPanel />
                    </div>

                    <div className="card">
                        <h2 className="card-title">📐 Pivot Points</h2>
                        <PivotPointsPanel />
                    </div>

                    <div className="card">
                        <h2 className="card-title">📋 Market Info</h2>
                        <MarketInfoPanel />
                    </div>

                    <div className="card">
                        <h2 className="card-title">📊 Carnet d'Ordres (Depth)</h2>
                        <OrderBookPanel />
                    </div>

                    <div className="card">
                        <h2 className="card-title">📜 Historique Signaux</h2>
                        <SignalHistoryPanel />
                    </div>
                </aside>
            </main>
        </div>
    );
}

function OrderBookPanel() {
    const orderbook = useMarketStore(state => state.orderbook);
    if (!orderbook || !orderbook.bids.length) return <div className="p-4 text-secondary">Awaiting Orderbook data...</div>;

    return (
        <div className="ob-table" style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            <div className={`ob-pressure ${orderbook.pressure.toLowerCase()}`} style={{ padding: '6px', borderRadius: '4px', marginBottom: '8px', fontWeight: 'bold', textAlign: 'center' }}>
                {orderbook.pressure} ({Math.round(orderbook.ratio * 100)}% BUY)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', color: 'var(--text-secondary)', paddingBottom: '4px', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
                <span>Price</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Total</span>
            </div>
            <div style={{ paddingRight: '4px' }}>
                {orderbook.asks.slice(0, 8).reverse().map((a: any, i: number) => (
                    <div key={`ask-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', color: 'var(--sell)', cursor: 'crosshair' }} className="ob-row">
                        <span>{a.price.toFixed(2)}</span>
                        <span style={{ textAlign: 'right' }}>{a.qty.toFixed(4)}</span>
                        <span style={{ textAlign: 'right' }}>{a.total.toFixed(0)}</span>
                    </div>
                ))}
                <div style={{ textAlign: 'center', margin: '8px 0', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '4px' }}>
                    Spread: {(orderbook.asks[0].price - orderbook.bids[0].price).toFixed(2)}
                </div>
                {orderbook.bids.slice(0, 8).map((b: any, i: number) => (
                    <div key={`bid-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', color: 'var(--buy)', cursor: 'crosshair' }} className="ob-row">
                        <span>{b.price.toFixed(2)}</span>
                        <span style={{ textAlign: 'right' }}>{b.qty.toFixed(4)}</span>
                        <span style={{ textAlign: 'right' }}>{b.total.toFixed(0)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default App;
